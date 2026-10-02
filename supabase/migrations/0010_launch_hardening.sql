-- 0010: Ό,τι χρειάζεται η βάση για να ανοίξει το Mila σε αγνώστους.
-- Idempotent — μπορεί να ξανατρέξει με ασφάλεια. Προϋποθέτει το 0009.
--
--  1. Όρια ρυθμού: πόσα μηνύματα, αιτήματα, ομάδες και αναφορές ανά χρήστη.
--     Χωρίς αυτά, ένας λογαριασμός με ένα script γεμίζει χιλιάδες ανθρώπους
--     με spam μέσα σε λίγα λεπτά.
--  2. Αναστολή λογαριασμού από τον διαχειριστή (schema moderation). Μέχρι τώρα
--     μια αναφορά κατέληγε σε έναν πίνακα που δεν μπορούσε να κάνει τίποτα.
--  3. Συνημμένα: η βάση ελέγχει ότι το αρχείο ΥΠΑΡΧΕΙ στο storage, και κρατάει
--     το πραγματικό μέγεθος και τύπο του, όχι ό,τι δηλώνει ο browser.
--  4. Storage: όριο 15 MB (όσο λέει και η οθόνη), μόνο ασφαλείς τύποι αρχείων,
--     και όριο ανεβασμάτων ανά ημέρα.
--  5. Ονόματα: αφαιρούνται αόρατοι χαρακτήρες και χαρακτήρες αντιστροφής
--     κειμένου, και κάποια usernames («admin», «support», «mila») δεσμεύονται.
--  6. Indexes που έλειπαν: χωρίς αυτά κάθε συνομιλία με συνημμένα σάρωνε
--     ολόκληρο τον πίνακα attachments.
--
-- ΣΥΜΒΑΤΟΤΗΤΑ: δεν αλλάζει κανένα όνομα, καμία υπογραφή RPC, κανένα πεδίο
-- που διαβάζει το app. Το τωρινό frontend δουλεύει όπως πριν· απλώς κάποιες
-- ενέργειες μπορεί πλέον να απαντήσουν «πολλές προσπάθειες».

-- ---------------------------------------------------------------------------
-- 1. Indexes
-- ---------------------------------------------------------------------------
create index if not exists messages_sender_created_idx
  on public.messages (sender_id, created_at desc);
create index if not exists attachments_message_idx
  on public.attachments (message_id);
create index if not exists conversation_members_user_idx
  on public.conversation_members (user_id);
create index if not exists blocks_blocked_idx
  on public.blocks (blocked_id);
create index if not exists conversations_created_by_idx
  on public.conversations (created_by, created_at desc);
create index if not exists reports_reporter_created_idx
  on public.reports (reporter_id, created_at desc);
create index if not exists reports_reported_idx
  on public.reports (reported_id);

-- ---------------------------------------------------------------------------
-- 2. Αναστολή λογαριασμού
-- ---------------------------------------------------------------------------
-- Οι στήλες ΔΕΝ μπαίνουν στο grant update του 0007, άρα ο χρήστης δεν τις
-- αλλάζει. Τις βλέπει μόνο για τον εαυτό του (profiles_read_self).
alter table public.profiles add column if not exists suspended_at timestamptz;
alter table public.profiles add column if not exists suspension_note text;

-- Η αναφορά αποκτά «κατάσταση», ώστε να ξέρει ο διαχειριστής τι έχει δει.
alter table public.reports add column if not exists resolved_at timestamptz;
alter table public.reports add column if not exists resolution text;

-- Ενεργός = ούτε διαγραμμένος ούτε σε αναστολή. Αυτό το ελέγχουν ήδη το
-- can_post_to_conversation (άρα κάθε μήνυμα και κάθε αντίδραση), το
-- start_direct_conversation και το create_group, οπότε η αναστολή ισχύει
-- ΑΜΕΣΩΣ, χωρίς να περιμένουμε να λήξει το token του.
create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and deleted_at is null and suspended_at is null
  )
$$;

-- ---------------------------------------------------------------------------
-- 3. Μηνύματα: όρια ρυθμού
-- ---------------------------------------------------------------------------
-- Μέσα στο trigger, ώστε να πιάνει και το send_message και το απευθείας
-- INSERT που κάνουν ακόμα παλιές εκδόσεις του app.
--
-- Τα όρια είναι πολύ πάνω από ό,τι γράφει ένας άνθρωπος:
--   30 το λεπτό, 600 την ώρα.
--   10 μηνύματα σε αίτημα που δεν έχει γίνει ακόμα δεκτό. Ένας άγνωστος
--   συστήνεται· δεν πλημμυρίζει τα εισερχόμενα κάποιου που δεν απάντησε.
create or replace function public.messages_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  recent integer;
begin
  new.created_at := now();
  new.edited_at := null;
  new.deleted_at := null;

  if char_length(new.ciphertext) > 8000 then
    raise exception 'Message is too long' using errcode = '22001';
  end if;

  if new.reply_to is not null and not exists (
    select 1 from messages r
    where r.id = new.reply_to and r.conversation_id = new.conversation_id
  ) then
    raise exception 'Reply target is not in this conversation' using errcode = '23514';
  end if;

  select count(*) into recent from messages
  where sender_id = new.sender_id and created_at > now() - interval '1 minute';
  if recent >= 30 then
    raise exception 'Rate limit: too many messages, slow down' using errcode = '54000';
  end if;

  select count(*) into recent from messages
  where sender_id = new.sender_id and created_at > now() - interval '1 hour';
  if recent >= 600 then
    raise exception 'Rate limit: too many messages, slow down' using errcode = '54000';
  end if;

  if exists (
    select 1 from conversations c
    where c.id = new.conversation_id
      and c.kind = 'direct'
      and c.request_status = 'pending'
      and c.request_from = new.sender_id
  ) and (
    select count(*) from messages
    where conversation_id = new.conversation_id and sender_id = new.sender_id
  ) >= 10 then
    raise exception 'Rate limit: wait until your request is accepted' using errcode = '54000';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Νέες συνομιλίες: όριο, και όχι με λογαριασμό σε αναστολή
-- ---------------------------------------------------------------------------
-- Ίδιο με το 0008, με δύο προσθήκες: ο άλλος δεν πρέπει να είναι σε αναστολή,
-- και μέχρι 30 ΝΕΕΣ ατομικές συνομιλίες το 24ωρο. Το άνοιγμα υπάρχουσας δεν
-- μετράει.
create or replace function public.start_direct_conversation(target_user uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  existing uuid;
  new_id uuid;
begin
  if me is null or not public.is_active_user() then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if target_user = me then
    raise exception 'Cannot start a conversation with yourself' using errcode = '22023';
  end if;

  if not exists (
    select 1 from profiles
    where id = target_user and deleted_at is null and suspended_at is null
  ) then
    raise exception 'User not found' using errcode = 'P0002';
  end if;

  if exists (
    select 1 from blocks
    where (blocker_id = me and blocked_id = target_user)
       or (blocker_id = target_user and blocked_id = me)
  ) then
    raise exception 'Conversation not allowed' using errcode = '42501';
  end if;

  select c.id into existing
  from conversations c
  join conversation_members a on a.conversation_id = c.id and a.user_id = me
  join conversation_members b on b.conversation_id = c.id and b.user_id = target_user
  where c.kind = 'direct'
  limit 1;

  if existing is not null then
    return existing;
  end if;

  if not exists (
    select 1 from profiles p
    where p.id = target_user and p.discover_by_email = 'everyone'
  ) and not exists (
    select 1
    from conversation_members mine
    join conversation_members theirs on theirs.conversation_id = mine.conversation_id
    where mine.user_id = me and theirs.user_id = target_user
  ) then
    raise exception 'Conversation not allowed' using errcode = '42501';
  end if;

  if (
    select count(*) from conversations
    where created_by = me and kind = 'direct' and created_at > now() - interval '1 day'
  ) >= 30 then
    raise exception 'Rate limit: too many new conversations today' using errcode = '54000';
  end if;

  insert into conversations (kind, created_by, request_from, request_status)
  values ('direct', me, me, 'pending')
  returning id into new_id;

  insert into conversation_members (conversation_id, user_id)
  values (new_id, me), (new_id, target_user);

  return new_id;
end;
$$;

-- Σε ομάδα δεν μπαίνει λογαριασμός σε αναστολή.
create or replace function public.addable_to_group(candidate uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_contact(candidate)
    and exists (
      select 1 from profiles p
      where p.id = candidate and p.deleted_at is null and p.suspended_at is null
    )
    and not exists (
      select 1 from blocks b
      where (b.blocker_id = auth.uid() and b.blocked_id = candidate)
         or (b.blocker_id = candidate and b.blocked_id = auth.uid())
    )
$$;

-- Ίδιο με το 0008, + όριο 20 νέες ομάδες το 24ωρο.
create or replace function public.create_group(group_name text, member_ids uuid[])
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  clean text := trim(coalesce(group_name, ''));
  wanted uuid[];
  bad uuid;
  new_id uuid;
begin
  if me is null or not public.is_active_user() then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if char_length(clean) not between 1 and 60 then
    raise exception 'Group name must be 1 to 60 characters' using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct x), '{}') into wanted
  from unnest(coalesce(member_ids, '{}')) x
  where x is not null and x <> me;

  if coalesce(array_length(wanted, 1), 0) < 1 then
    raise exception 'Pick at least one person' using errcode = '22023';
  end if;
  if array_length(wanted, 1) > 49 then
    raise exception 'A group can have up to 50 people' using errcode = '22023';
  end if;

  select x into bad from unnest(wanted) x where not public.addable_to_group(x) limit 1;
  if bad is not null then
    raise exception 'You can only add people you already chat with' using errcode = '42501';
  end if;

  if (
    select count(*) from conversations
    where created_by = me and kind = 'group' and created_at > now() - interval '1 day'
  ) >= 20 then
    raise exception 'Rate limit: too many new groups today' using errcode = '54000';
  end if;

  insert into conversations (kind, name, created_by, request_from, request_status)
  values ('group', clean, me, null, 'accepted')
  returning id into new_id;

  insert into conversation_members (conversation_id, user_id, role)
  values (new_id, me, 'admin');

  insert into conversation_members (conversation_id, user_id, role)
  select new_id, x, 'member' from unnest(wanted) x;

  return new_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Αναζήτηση: κανείς σε αναστολή στα αποτελέσματα
-- ---------------------------------------------------------------------------
-- Ίδιο με το 0007, + suspended_at is null.
create or replace function public.search_profiles(search_term text)
returns setof jsonb
language sql
stable
security definer
set search_path = public
as $$
  with input as (
    select
      lower(trim(search_term)) as exact,
      '%' || replace(replace(replace(trim(search_term), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pattern
  )
  select
    case
      when lower(p.email) = i.exact and p.discover_by_email = 'everyone'
        then public.profile_payload(p) || jsonb_build_object('email', p.email)
      else public.profile_payload(p)
    end
  from public.profiles p
  cross join input i
  where auth.uid() is not null
    and p.id <> auth.uid()
    and p.deleted_at is null
    and p.suspended_at is null
    and length(i.exact) >= 2
    and not exists (
      select 1
      from public.blocks b
      where (b.blocker_id = auth.uid() and b.blocked_id = p.id)
         or (b.blocker_id = p.id and b.blocked_id = auth.uid())
    )
    and (
      (
        public.is_contact(p.id)
        and (
          p.display_name ilike i.pattern
          or coalesce(p.username, '') ilike i.pattern
          or (p.show_email <> 'nobody' and p.email ilike i.pattern)
        )
      )
      or (
        p.discover_by_email = 'everyone'
        and (
          p.display_name ilike i.pattern
          or coalesce(p.username, '') ilike i.pattern
          or lower(p.email) = i.exact
        )
      )
    )
  order by p.display_name
  limit 20
$$;

-- Ίδιο με το 0006, + suspended_at is null.
create or replace function public.match_contacts(email_hashes text[])
returns setof jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  select public.profile_payload(p)
  from profiles p
  where auth.uid() is not null
    and p.id <> auth.uid()
    and p.deleted_at is null
    and p.suspended_at is null
    and p.discover_by_email = 'everyone'
    and array_length(email_hashes, 1) between 1 and 500
    and encode(digest(lower(p.email), 'sha256'), 'hex') = any(email_hashes)
    and not exists (
      select 1 from blocks b
      where (b.blocker_id = auth.uid() and b.blocked_id = p.id)
         or (b.blocker_id = p.id and b.blocked_id = auth.uid())
    )
  limit 200
$$;

-- ---------------------------------------------------------------------------
-- 6. Αναφορές: όχι τον εαυτό σου, όχι πάνω από 20 την ημέρα
-- ---------------------------------------------------------------------------
create or replace function public.reports_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.created_at := now();
  new.resolved_at := null;
  new.resolution := null;

  if new.reporter_id = new.reported_id then
    raise exception 'You cannot report yourself' using errcode = '22023';
  end if;

  if (
    select count(*) from reports
    where reporter_id = new.reporter_id and created_at > now() - interval '1 day'
  ) >= 20 then
    raise exception 'Rate limit: too many reports today' using errcode = '54000';
  end if;

  return new;
end;
$$;

drop trigger if exists reports_before_insert on public.reports;
create trigger reports_before_insert
before insert on public.reports
for each row execute function public.reports_before_insert();

-- Ο χρήστης στέλνει αναφορά, δεν την αλλάζει και δεν τη σβήνει.
revoke update, delete on public.reports from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. Ονόματα και usernames
-- ---------------------------------------------------------------------------
-- Αόρατοι χαρακτήρες (zero-width) και χαρακτήρες που αντιστρέφουν τη φορά του
-- κειμένου επιτρέπουν να φτιάξει κάποιος όνομα που ΜΟΙΑΖΕΙ με άλλο. Δεν έχουν
-- θέση σε όνομα. Τα κενά μαζεύονται σε ένα.
create or replace function public.clean_display_name(raw text)
returns text
language sql
immutable
set search_path = ''
as $$
  select trim(regexp_replace(
    regexp_replace(
      coalesce(raw, ''),
      '[\u0001-\u001F\u007F­​-‏‪-‮⁠-⁤⁦-⁩﻿]',
      '',
      'g'
    ),
    '\s+', ' ', 'g'
  ))
$$;

create or replace function public.profiles_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.display_name := public.clean_display_name(new.display_name);
  if char_length(new.display_name) < 2 then
    -- Στην εγγραφή ποτέ σφάλμα: θα έριχνε ολόκληρη τη δημιουργία λογαριασμού.
    if tg_op = 'INSERT' then
      new.display_name := 'New user';
    else
      raise exception 'Display name must be at least 2 characters' using errcode = '23514';
    end if;
  end if;

  if new.username is not null
     and (tg_op = 'INSERT' or new.username is distinct from old.username)
     and new.username in (
       'admin', 'administrator', 'root', 'system', 'mila', 'milaapp', 'mila.app',
       'support', 'help', 'helpdesk', 'official', 'staff', 'team', 'moderator',
       'mod', 'security', 'abuse', 'privacy', 'legal', 'noreply', 'no.reply',
       'info', 'contact', 'deleted', 'null', 'undefined'
     ) then
    raise exception 'This username is reserved' using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_before_write on public.profiles;
create trigger profiles_before_write
before insert or update of display_name, username on public.profiles
for each row execute function public.profiles_before_write();

-- ---------------------------------------------------------------------------
-- 8. Αποστολή μηνύματος: το συνημμένο πρέπει να υπάρχει
-- ---------------------------------------------------------------------------
-- Ίδιο με το 0008, με μία αλλαγή στο συνημμένο: η βάση κοιτάζει το ίδιο το
-- αρχείο στο storage. Αν δεν υπάρχει, δεν γράφεται μήνυμα-φάντασμα. Το
-- μέγεθος και ο τύπος έρχονται από εκεί (αυτά που θα σερβίρει το storage),
-- όχι από τον browser.
create or replace function public.send_message(
  conversation uuid,
  body text,
  client_id uuid,
  reply_to_message uuid default null,
  attachment jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  clean text := coalesce(body, '');
  msg messages%rowtype;
  file_path text;
  file_size bigint;
  file_mime text;
begin
  if me is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if not public.can_post_to_conversation(conversation) then
    raise exception 'You cannot send messages to this conversation' using errcode = '42501';
  end if;

  if attachment is null and length(trim(clean)) = 0 then
    raise exception 'Empty message' using errcode = '22023';
  end if;

  select * into msg from messages
  where sender_id = me and client_message_id = client_id;
  if found then
    return public.message_payload(msg);
  end if;

  if attachment is not null then
    file_path := attachment->>'path';
    if file_path is null or split_part(file_path, '/', 1) <> me::text then
      raise exception 'Attachment does not belong to you' using errcode = '42501';
    end if;

    select
      nullif(o.metadata->>'size', '')::bigint,
      nullif(o.metadata->>'mimetype', '')
    into file_size, file_mime
    from storage.objects o
    where o.bucket_id = 'message-media' and o.name = file_path;
    if not found then
      raise exception 'Attachment not found' using errcode = 'P0002';
    end if;

    file_size := coalesce(file_size, nullif(attachment->>'size', '')::bigint);
    file_mime := coalesce(file_mime, attachment->>'mime', 'application/octet-stream');
  end if;

  insert into messages (conversation_id, sender_id, ciphertext, encryption_version, client_message_id, reply_to)
  values (conversation, me, clean, 0, client_id, reply_to_message)
  returning * into msg;

  if attachment is not null then
    insert into attachments (message_id, conversation_id, storage_path, encrypted_metadata, byte_size)
    values (
      msg.id,
      conversation,
      file_path,
      jsonb_build_object(
        'name', left(coalesce(attachment->>'name', 'file'), 180),
        'mime', left(file_mime, 120)
      )::text,
      file_size
    );
  end if;

  return public.message_payload(msg);
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Storage
-- ---------------------------------------------------------------------------
-- 15 MB, όσο λέει και η οθόνη (ήταν 50 MB στη βάση).
--
-- Μόνο τύποι που ο browser ΔΕΝ εκτελεί. Χωρίς αυτό, κάποιος ανέβαζε HTML ή
-- SVG με κώδικα, έπαιρνε signed URL για τον δικό του φάκελο, και είχε δωρεάν
-- σελίδα phishing πάνω στο domain της Supabase. Ό,τι δεν είναι στη λίστα το
-- app το ανεβάζει ως application/octet-stream, που ο browser απλώς κατεβάζει.
update storage.buckets
set file_size_limit = 15728640,
    allowed_mime_types = array[
      'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif',
      'image/heic', 'image/heif',
      'application/pdf', 'text/plain', 'text/csv',
      'application/zip', 'application/x-zip-compressed',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.oasis.opendocument.text',
      'application/vnd.oasis.opendocument.spreadsheet',
      'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/ogg', 'audio/webm',
      'video/mp4', 'video/quicktime', 'video/webm',
      'application/octet-stream'
    ]
where id = 'message-media';

-- Μέχρι 200 ανεβάσματα το 24ωρο ανά χρήστη, και μόνο από ενεργό λογαριασμό.
-- Χωρίς όριο, ένας λογαριασμός γέμιζε το storage του project (και τον
-- λογαριασμό της Supabase) μέσα σε μια νύχτα.
create or replace function public.media_upload_allowed()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_active_user()
    and (
      select count(*)
      from storage.objects o
      where o.bucket_id = 'message-media'
        and o.name like (select auth.uid())::text || '/%'
        and o.created_at > now() - interval '1 day'
    ) < 200
$$;

drop policy if exists media_insert_authenticated on storage.objects;
create policy media_insert_authenticated on storage.objects for insert to authenticated
with check (
  bucket_id = 'message-media'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and public.media_upload_allowed()
);

-- ---------------------------------------------------------------------------
-- 10. Εργαλεία διαχειριστή (schema moderation)
-- ---------------------------------------------------------------------------
-- ΜΟΝΟ από τον SQL editor της Supabase. Το schema δεν εκτίθεται στο API και
-- κανένας ρόλος του browser (anon, authenticated) δεν έχει πρόσβαση. Οδηγίες
-- χρήσης: docs/MODERATION.md.
create schema if not exists moderation;
revoke all on schema moderation from public, anon, authenticated;

create or replace view moderation.reports_overview
with (security_invoker = true)
as
select
  r.id,
  r.created_at,
  r.resolved_at,
  r.reason,
  r.resolution,
  reported.display_name as reported_name,
  reported.email        as reported_email,
  r.reported_id,
  reported.suspended_at as reported_suspended_at,
  (select count(*) from public.reports x where x.reported_id = r.reported_id) as reports_against_them,
  reporter.display_name as reporter_name,
  reporter.email        as reporter_email,
  r.reporter_id
from public.reports r
join public.profiles reported on reported.id = r.reported_id
join public.profiles reporter on reporter.id = r.reporter_id
order by (r.resolved_at is not null), r.created_at desc;

-- Αναστολή: σταματάει αμέσως κάθε αποστολή (is_active_user), τον βγάζει από
-- αναζήτηση, και τον «μπανάρει» στο auth ώστε να μην ξαναμπεί ούτε να
-- ανανεώσει τη σύνδεσή του. Τα μηνύματά του μένουν, ως αποδεικτικό.
create or replace function moderation.suspend_user(target uuid, note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
  set suspended_at = coalesce(suspended_at, now()),
      suspension_note = coalesce(note, suspension_note)
  where id = target and deleted_at is null;
  if not found then
    raise exception 'No active user with id %', target;
  end if;

  -- 100 χρόνια, όπως το κάνει και το κουμπί «Ban» της Supabase.
  update auth.users set banned_until = now() + interval '100 years' where id = target;
  delete from public.push_subscriptions where user_id = target;
end;
$$;

create or replace function moderation.unsuspend_user(target uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set suspended_at = null, suspension_note = null where id = target;
  update auth.users set banned_until = null where id = target;
end;
$$;

create or replace function moderation.resolve_report(report uuid, note text default null)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.reports
  set resolved_at = now(), resolution = coalesce(note, resolution)
  where id = report
$$;

-- Κατέβασμα περιεχομένου που παραβιάζει τους όρους. Ίδιο αποτέλεσμα με το
-- «Διαγραφή για όλους». Επιστρέφει τα αρχεία του, που σβήνονται από το
-- Storage της Supabase (η βάση δεν επιτρέπεται να τα σβήσει η ίδια).
create or replace function moderation.remove_message(message uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  paths jsonb;
begin
  select coalesce(jsonb_agg(a.storage_path), '[]'::jsonb) into paths
  from public.attachments a where a.message_id = message;

  delete from public.attachments where message_id = message;
  update public.message_reactions set emoji = null, updated_at = now()
  where message_id = message and emoji is not null;
  update public.messages set ciphertext = '', deleted_at = now(), edited_at = null
  where id = message;
  if not found then
    raise exception 'No message with id %', message;
  end if;

  return jsonb_build_object('removed', message, 'storage_paths_to_delete', paths);
end;
$$;

revoke all on all functions in schema moderation from public, anon, authenticated;
revoke all on all tables in schema moderation from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 11. Δικαιώματα
-- ---------------------------------------------------------------------------
revoke all on function public.reports_before_insert() from public, anon, authenticated;
revoke all on function public.profiles_before_write() from public, anon, authenticated;
revoke all on function public.messages_before_insert() from public, anon, authenticated;
revoke all on function public.clean_display_name(text) from public, anon;
revoke all on function public.media_upload_allowed() from public, anon;
revoke all on function public.is_active_user() from public, anon;
revoke all on function public.start_direct_conversation(uuid) from public, anon;
revoke all on function public.addable_to_group(uuid) from public, anon;
revoke all on function public.create_group(text, uuid[]) from public, anon;
revoke all on function public.search_profiles(text) from public, anon;
revoke all on function public.match_contacts(text[]) from public, anon;
revoke all on function public.send_message(uuid, text, uuid, uuid, jsonb) from public, anon;

grant execute on function public.clean_display_name(text) to authenticated;
-- Χρησιμοποιείται στο policy του storage, που τρέχει ως ο χρήστης.
grant execute on function public.media_upload_allowed() to authenticated;
grant execute on function public.is_active_user() to authenticated;
grant execute on function public.start_direct_conversation(uuid) to authenticated;
grant execute on function public.addable_to_group(uuid) to authenticated;
grant execute on function public.create_group(text, uuid[]) to authenticated;
grant execute on function public.search_profiles(text) to authenticated;
grant execute on function public.match_contacts(text[]) to authenticated;
grant execute on function public.send_message(uuid, text, uuid, uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
