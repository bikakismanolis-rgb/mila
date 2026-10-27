-- 0015: Η ειδοποίηση «Εισερχόμενη κλήση» φεύγει όταν σταματήσει να χτυπάει,
-- και μια κλήση που δεν συνδέθηκε ποτέ γράφεται ως τέτοια.
-- Idempotent, χωρίς drop: τρέχει και από τον SQL editor και από εργαλεία.
-- Προϋποθέτει το 0013. Συμβατό με το προηγούμενο site: μόνο προσθέτει.
--
-- ΤΙ ΑΛΛΑΖΕΙ, ΜΕ ΑΠΛΑ ΛΟΓΙΑ
--
--   Μέχρι τώρα (0013) έφευγαν δύο ειδοποιήσεις push για μια κλήση: «σε
--   καλεί» όταν ξεκινά και «αναπάντητη» όταν κλείνει χωρίς να σηκώσει κανείς.
--   Αν όμως σήκωνες από το laptop ή απέρριπτες από το κινητό, η «Εισερχόμενη
--   κλήση» με τα κουμπιά έμενε στις άλλες συσκευές σου μέχρι να την πατήσεις.
--
--   Τώρα:
--   * «τέλος» (call-ended) σε όποιον σταμάτησε να χτυπάει επειδή σήκωσε ή
--     απέρριψε, από οποιαδήποτε συσκευή του: όλες οι συσκευές του κλείνουν
--     την ειδοποίηση (apps/web/public/sw.js).
--   * «αναπάντητη» και σε ομαδική κλήση που μίλησαν άλλοι, σε όσους χτυπούσε
--     ακόμα όταν έκλεισε. Πριν, πήγαινε μόνο όταν δεν είχε σηκώσει κανείς.
--   * fail_call: η σύνδεση δεν στήθηκε ποτέ. Στο ιστορικό φαίνεται «Δεν
--     συνδέθηκε», όχι μια κλήση 40 δευτερολέπτων που δεν έγινε.
--
--   Οι ειδοποιήσεις μένουν χωρίς περιεχόμενο, όπως πριν: ποια κλήση, ποιος
--   καλεί, αν είναι βίντεο. Τίποτα από όσα ειπώθηκαν.

-- ---------------------------------------------------------------------------
-- 1. «Τέλος»: σε έναν άνθρωπο, που σταμάτησε να χτυπάει
-- ---------------------------------------------------------------------------
-- Για την Edge Function «push» (μόνο service_role). Ίδιοι κανόνες με το «σε
-- καλεί» (push_call_targets): όποιος δεν πήρε ειδοποίηση για την κλήση
-- (μπλοκ, ομάδα σε σίγαση) δεν παίρνει ούτε το «τέλος» της.
create or replace function public.push_call_ended_targets(p_call uuid, p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'payload', jsonb_build_object(
      'type', 'call',
      'event', 'ended',
      'callId', c.id::text,
      'conversationId', c.conversation_id::text,
      'title', case when cv.kind = 'group' then coalesce(cv.name, caller.display_name) else caller.display_name end,
      'callerName', split_part(caller.display_name, ' ', 1),
      'video', c.video,
      'isGroup', cv.kind = 'group'
    ),
    'subscriptions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id::text,
        'endpoint', s.endpoint,
        'p256dh', s.p256dh,
        'auth', s.auth
      ))
      from call_participants p
      join push_subscriptions s on s.user_id = p.user_id
      where p.call_id = c.id
        and p.user_id = p_user
        and p.user_id <> c.caller_id
        and p.state in ('joined', 'declined', 'left')
        and not exists (
          select 1 from blocks b where b.blocker_id = p.user_id and b.blocked_id = c.caller_id
        )
        and not (cv.kind = 'group' and exists (
          select 1 from conversation_prefs cp
          where cp.user_id = p.user_id and cp.conversation_id = c.conversation_id
            and cp.muted_until > now()
        ))
    ), '[]'::jsonb)
  )
  from calls c
  join conversations cv on cv.id = c.conversation_id
  join profiles caller on caller.id = c.caller_id
  where c.id = p_call
$$;

-- Χτυπούσε σε κάποιον και σταμάτησε επειδή σήκωσε ή απέρριψε. Το «αναπάντητη»
-- (χτυπούσε και η κλήση έκλεισε) το στέλνει το trigger της κλήσης, πιο κάτω.
-- Ξεχωριστό action ('call-ended') και όχι νέο event του 'call': μια παλιά
-- έκδοση της function θα το έπαιρνε για «σε καλεί» και θα ξαναχτυπούσε στους
-- υπόλοιπους μιας ομαδικής. Έτσι απλώς το αγνοεί.
create or replace function public.notify_call_participant_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  config push_config%rowtype;
begin
  if old.state <> 'ringing' or new.state not in ('joined', 'declined') then
    return null;
  end if;
  if not exists (select 1 from push_subscriptions s where s.user_id = new.user_id) then
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
    body := jsonb_build_object('action', 'call-ended', 'call_id', new.call_id, 'user_id', new.user_id),
    timeout_milliseconds := 8000
  );
  return null;
exception when others then
  raise warning 'notify_call_participant_change skipped: %', sqlerrm;
  return null;
end;
$$;

-- Στο τέλος της συναλλαγής, όπως και το calls_notify: τότε η κλήση έχει πάρει
-- την τελική της μορφή.
do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'call_participants_notify' and tgrelid = 'public.call_participants'::regclass
  ) then
    create constraint trigger call_participants_notify
    after update of state on public.call_participants
    deferrable initially deferred
    for each row execute function public.notify_call_participant_change();
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 2. «Αναπάντητη»: σε όσους χτυπούσε ακόμα όταν έκλεισε η κλήση
-- ---------------------------------------------------------------------------
-- Ίδιο με το 0013, με δύο αλλαγές: το «αναπάντητη» φεύγει κάθε φορά που
-- κλείνει μια κλήση και έμεινε κάποιος να χτυπάει (και σε ομαδική που μίλησαν
-- άλλοι), και η function καλείται μόνο αν κάποιος από αυτούς που αφορά η
-- ειδοποίηση έχει συνδρομή.
create or replace function public.notify_call_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  config push_config%rowtype;
  event text;
begin
  if tg_op = 'INSERT' and new.status = 'ringing' then
    event := 'ring';
  elsif new.status = 'ended' and (tg_op = 'INSERT' or old.status <> 'ended') then
    event := 'missed';
  else
    return null;
  end if;

  -- Τρέχει στο τέλος της συναλλαγής (deferred), οπότε οι συμμετέχοντες έχουν
  -- ήδη την τελική τους κατάσταση: 'ringing' για το «σε καλεί», 'missed' για
  -- το «αναπάντητη» (το finish_call τους γυρίζει από 'ringing' σε 'missed').
  if not exists (
    select 1
    from call_participants p
    join push_subscriptions s on s.user_id = p.user_id
    where p.call_id = new.id
      and p.user_id <> new.caller_id
      and p.state = case when event = 'ring' then 'ringing' else 'missed' end
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
    body := jsonb_build_object('action', 'call', 'call_id', new.id, 'event', event),
    timeout_milliseconds := 8000
  );
  return null;
exception when others then
  raise warning 'notify_call_change skipped: %', sqlerrm;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Κλήση που δεν συνδέθηκε ποτέ
-- ---------------------------------------------------------------------------
-- Ο browser το καλεί αντί για leave_call όταν σήκωσαν αλλά η σύνδεση δεν
-- στήθηκε (π.χ. δίκτυο που δεν αφήνει απευθείας σύνδεση και δεν υπάρχει
-- TURN). Σε ατομική κλήση κλείνει με 'failed'. Σε ομαδική είναι απλή έξοδος:
-- οι υπόλοιποι μπορεί να μιλάνε κανονικά μεταξύ τους.
create or replace function public.fail_call(p_call uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  c calls%rowtype;
  convo_kind conversation_kind;
begin
  if me is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  select * into c from calls where id = p_call for update;
  if not found or not public.is_conversation_member(c.conversation_id) then
    raise exception 'Call not found' using errcode = 'P0002';
  end if;

  select cv.kind into convo_kind from conversations cv where cv.id = c.conversation_id;
  if c.status <> 'active' or convo_kind <> 'direct' or not exists (
    select 1 from call_participants
    where call_id = c.id and user_id = me and state = 'joined'
  ) then
    return public.leave_call(c.id);
  end if;

  update call_participants set state = 'left', left_at = now()
  where call_id = c.id and user_id = me and state = 'joined';
  delete from call_heartbeats where call_id = c.id and user_id = me;
  perform public.finish_call(c.id, 'failed');

  select * into c from calls where id = c.id;
  return public.call_payload(c);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Δικαιώματα
-- ---------------------------------------------------------------------------
revoke all on function public.notify_call_participant_change() from public, anon, authenticated;
revoke all on function public.notify_call_change() from public, anon, authenticated;
revoke all on function public.push_call_ended_targets(uuid, uuid) from public, anon, authenticated;
grant execute on function public.push_call_ended_targets(uuid, uuid) to service_role;

revoke all on function public.fail_call(uuid) from public, anon;
grant execute on function public.fail_call(uuid) to authenticated;

notify pgrst, 'reload schema';
