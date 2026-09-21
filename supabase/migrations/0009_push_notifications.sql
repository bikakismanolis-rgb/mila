-- 0009: Ειδοποιήσεις (Web Push) όταν έρχεται μήνυμα και το app είναι κλειστό.
-- Idempotent — μπορεί να ξανατρέξει με ασφάλεια. Προϋποθέτει το 0008.
--
-- ΤΟ ΤΑΞΙΔΙ ΜΙΑΣ ΕΙΔΟΠΟΙΗΣΗΣ
--   μήνυμα μπαίνει στο messages
--     -> trigger notify_new_message (εδώ)
--     -> pg_net καλεί την Edge Function «push» με το message_id
--     -> η function ρωτάει το push_targets (εδώ): ποιοι, τι να γράφει
--     -> στέλνει κρυπτογραφημένα στη συσκευή του καθενός
--
-- ΑΝ ΚΑΤΙ ΑΠΟ ΑΥΤΑ ΛΕΙΠΕΙ (η function δεν έχει ανέβει, το pg_net δεν υπάρχει),
-- τα μηνύματα συνεχίζουν να στέλνονται κανονικά. Απλώς δεν έρχεται ειδοποίηση.
-- Το trigger δεν επιτρέπεται ποτέ να ρίξει ένα INSERT.
--
-- ΚΑΝΕΝΑ ΜΥΣΤΙΚΟ ΔΕΝ ΓΡΑΦΕΤΑΙ ΜΕ ΤΟ ΧΕΡΙ: το μυστικό του webhook παράγεται εδώ,
-- τα κλειδιά VAPID τα φτιάχνει η function την πρώτη φορά. Και τα δύο μένουν στο
-- push_config, που δεν το διαβάζει ούτε ο anon ούτε ο συνδεδεμένος χρήστης.

create extension if not exists pg_net;

-- ---------------------------------------------------------------------------
-- 1. Συνδρομές συσκευών
-- ---------------------------------------------------------------------------
-- user_id -> auth.users με CASCADE: όταν σβηστεί ο λογαριασμός, φεύγουν μόνες
-- τους (το profiles μένει ως ταφόπλακα, γι' αυτό ΔΕΝ δείχνει εκεί).
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique check (char_length(endpoint) between 20 and 1000),
  p256dh text not null check (char_length(p256dh) between 80 and 100),
  auth text not null check (char_length(auth) between 20 and 30),
  user_agent text not null default '' check (char_length(user_agent) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions(user_id);

-- Μία γραμμή, πάντα. Ρυθμίσεις και μυστικά της αποστολής.
create table if not exists public.push_config (
  id boolean primary key default true check (id),
  function_url text not null,
  -- Το ΔΗΜΟΣΙΟ anon key (το ίδιο που υπάρχει μέσα στο bundle του site). Το
  -- χρειάζεται η πύλη της Supabase για να αφήσει το αίτημα να φτάσει στη
  -- function. Δεν δίνει κανένα δικαίωμα· την πόρτα την ανοίγει το webhook_secret.
  anon_key text not null,
  webhook_secret text not null default encode(extensions.gen_random_bytes(32), 'hex'),
  subject text not null default 'mailto:noreply@milamessenger.com',
  vapid_public text,
  vapid_private jsonb
);

insert into public.push_config (id, function_url, anon_key)
values (
  true,
  'https://jxjrggyjdqgbodvlqdte.supabase.co/functions/v1/push',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp4anJnZ3lqZHFnYm9kdmxxZHRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM0NzAwNjAsImV4cCI6MjA5OTA0NjA2MH0.YwK0gQXomZLdIf1Rc8iNRqpAyWW2TjVdF65ggWAKyqA'
)
on conflict (id) do nothing;

alter table public.push_subscriptions enable row level security;
alter table public.push_config enable row level security;

-- Κανένα policy = κανείς από τον browser. Και τα grants φεύγουν, για σιγουριά.
revoke all on public.push_subscriptions from anon, authenticated;
revoke all on public.push_config from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Ο browser δηλώνει / αποσύρει τη συσκευή του
-- ---------------------------------------------------------------------------
-- Δεκτές ΜΟΝΟ διευθύνσεις των γνωστών υπηρεσιών push (Google, Mozilla,
-- Microsoft, Apple). Αλλιώς κάποιος θα δήλωνε ό,τι URL ήθελε και ο server μας
-- θα του έστελνε αιτήματα.
create or replace function public.save_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_user_agent text default ''
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  host text;
begin
  if me is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  -- Το host επιτρέπεται να έχει ΜΟΝΟ γράμματα, ψηφία, τελείες και παύλες, και
  -- αμέσως μετά «/», «:θύρα» ή τέλος. Μια πιο χαλαρή έκφραση δεχόταν το
  -- «https://evil.com\.fcm.googleapis.com/…»: οι browsers διαβάζουν το «\» σαν
  -- «/», άρα το πραγματικό host εκεί είναι το evil.com.
  host := substring(lower(p_endpoint) from '^https://([a-z0-9.-]+)(?::[0-9]+)?(?:/|$)');
  if host is null or host !~ '(^|\.)(fcm\.googleapis\.com|push\.services\.mozilla\.com|notify\.windows\.com|push\.apple\.com)$' then
    raise exception 'Unsupported push service' using errcode = '22023';
  end if;

  -- Ίδια συσκευή, άλλος λογαριασμός: η συνδρομή περνάει στον καινούργιο.
  insert into push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (me, p_endpoint, p_p256dh, p_auth, left(coalesce(p_user_agent, ''), 200))
  on conflict (endpoint) do update
  set user_id = excluded.user_id,
      p256dh = excluded.p256dh,
      auth = excluded.auth,
      user_agent = excluded.user_agent,
      updated_at = now();

  -- Μέχρι 10 συσκευές ανά χρήστη· φεύγουν οι παλαιότερες.
  delete from push_subscriptions
  where user_id = me
    and id not in (
      select id from push_subscriptions
      where user_id = me
      order by updated_at desc
      limit 10
    );
end;
$$;

create or replace function public.remove_push_subscription(p_endpoint text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from push_subscriptions
  where endpoint = p_endpoint
    and user_id = auth.uid()
$$;

-- ---------------------------------------------------------------------------
-- 3. Για την Edge Function (ΜΟΝΟ service_role)
-- ---------------------------------------------------------------------------
create or replace function public.push_config_get()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'vapid_public', c.vapid_public,
    'vapid_private', c.vapid_private,
    'webhook_secret', c.webhook_secret,
    'subject', c.subject
  )
  from push_config c
$$;

-- Γράφει τα κλειδιά ΜΟΝΟ αν δεν υπάρχουν. Αν αλλάξουν, κάθε υπάρχουσα συνδρομή
-- παύει να ισχύει και όλοι πρέπει να ξανα-ενεργοποιήσουν τις ειδοποιήσεις.
create or replace function public.push_store_vapid(public_key text, private_key jsonb)
returns void
language sql
security definer
set search_path = public
as $$
  update push_config
  set vapid_public = public_key, vapid_private = private_key
  where vapid_public is null
$$;

create or replace function public.push_prune(ids uuid[])
returns void
language sql
security definer
set search_path = public
as $$
  delete from push_subscriptions where id = any(ids)
$$;

-- Ποιοι ειδοποιούνται για ένα μήνυμα, και τι γράφει η ειδοποίηση.
-- Όλα τα μέλη εκτός από τον αποστολέα. Όχι σε απορριφθείσα συνομιλία, όχι σε
-- όποιον έχει μπλοκάρει τον αποστολέα (σε ατομική δεν φτάνει καν εδώ: το
-- can_post_to_conversation έχει ήδη κόψει το μήνυμα· ο έλεγχος μετράει στις ομάδες).
create or replace function public.push_targets(message uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'payload', jsonb_build_object(
      'conversationId', m.conversation_id::text,
      'messageId', m.id::text,
      'title', case when c.kind = 'group' then coalesce(c.name, sender.display_name) else sender.display_name end,
      'body',
        case when c.kind = 'group' then split_part(sender.display_name, ' ', 1) || ': ' else '' end ||
        case
          when m.encryption_version > 0 then ''
          when length(m.ciphertext) > 0 then left(m.ciphertext, 140)
          else coalesce((
            select public.safe_jsonb(a.encrypted_metadata)->>'name'
            from attachments a where a.message_id = m.id limit 1
          ), '')
        end,
      'hasAttachment', exists (select 1 from attachments a where a.message_id = m.id),
      'isRequest', c.request_status = 'pending'
    ),
    'subscriptions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id::text,
        'endpoint', s.endpoint,
        'p256dh', s.p256dh,
        'auth', s.auth
      ))
      from conversation_members cm
      join push_subscriptions s on s.user_id = cm.user_id
      where cm.conversation_id = m.conversation_id
        and cm.user_id <> m.sender_id
        and not exists (
          select 1 from blocks b
          where b.blocker_id = cm.user_id and b.blocked_id = m.sender_id
        )
    ), '[]'::jsonb)
  )
  from messages m
  join conversations c on c.id = m.conversation_id
  join profiles sender on sender.id = m.sender_id
  where m.id = message
    and m.deleted_at is null
    and c.request_status <> 'rejected'
$$;

-- ---------------------------------------------------------------------------
-- 4. Το trigger που ξεκινάει την αποστολή
-- ---------------------------------------------------------------------------
-- Μετά το INSERT. Το net.http_post απλώς βάζει το αίτημα σε ουρά και γυρίζει
-- αμέσως· η αποστολή γίνεται στο παρασκήνιο και δεν καθυστερεί το μήνυμα.
-- Αν κανένας παραλήπτης δεν έχει δηλώσει συσκευή, δεν γίνεται καν κλήση.
create or replace function public.notify_new_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  config push_config%rowtype;
begin
  if not exists (
    select 1
    from conversation_members cm
    join push_subscriptions s on s.user_id = cm.user_id
    where cm.conversation_id = new.conversation_id
      and cm.user_id <> new.sender_id
  ) then
    return null;
  end if;

  select * into config from push_config;
  if not found then
    return null;
  end if;

  perform net.http_post(
    url := config.function_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || config.anon_key,
      'x-mila-secret', config.webhook_secret
    ),
    body := jsonb_build_object('action', 'message', 'message_id', new.id),
    timeout_milliseconds := 8000
  );
  return null;
exception when others then
  -- Ποτέ δεν αφήνουμε μια ειδοποίηση να χαλάσει ένα μήνυμα.
  raise warning 'notify_new_message skipped: %', sqlerrm;
  return null;
end;
$$;

drop trigger if exists messages_notify on public.messages;
create trigger messages_notify
after insert on public.messages
for each row execute function public.notify_new_message();

-- ---------------------------------------------------------------------------
-- 5. Δικαιώματα
-- ---------------------------------------------------------------------------
revoke all on function public.save_push_subscription(text, text, text, text) from public, anon;
revoke all on function public.remove_push_subscription(text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;
grant execute on function public.remove_push_subscription(text) to authenticated;

-- Αυτές ΜΟΝΟ η Edge Function (service_role). Επιστρέφουν κλειδιά και διευθύνσεις
-- συσκευών· αν τις καλούσε ένας χρήστης θα ήταν διαρροή.
revoke all on function public.push_config_get() from public, anon, authenticated;
revoke all on function public.push_store_vapid(text, jsonb) from public, anon, authenticated;
revoke all on function public.push_prune(uuid[]) from public, anon, authenticated;
revoke all on function public.push_targets(uuid) from public, anon, authenticated;
revoke all on function public.notify_new_message() from public, anon, authenticated;
grant execute on function public.push_config_get() to service_role;
grant execute on function public.push_store_vapid(text, jsonb) to service_role;
grant execute on function public.push_prune(uuid[]) to service_role;
grant execute on function public.push_targets(uuid) to service_role;

notify pgrst, 'reload schema';
