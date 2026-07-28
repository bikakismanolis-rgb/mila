-- 0005: RPCs ανάγνωσης + σφίξιμο του profiles.
--
-- Επιστρέφουν ΤΟ ΙΔΙΟ JSON με τα endpoints του Express (/conversations,
-- /conversations/:id/messages, /contacts/match), ώστε το UI να μην χρειαστεί
-- να ξαναγραφτεί — αλλάζει μόνο από πού έρχονται τα δεδομένα.
--
-- Γίνονται RPCs και όχι σκέτα queries από τον browser για δύο λόγους:
-- ένα chat list θέλει joins σε 4 πίνακες (αλλιώς N+1 requests ανά συνομιλία),
-- και οι έλεγχοι privacy πρέπει να μένουν στη βάση.

-- ---------------------------------------------------------------------------
-- 0. Βοηθητικό: ασφαλές parse JSON
-- ---------------------------------------------------------------------------
-- Το attachments.encrypted_metadata είναι text. Στο encryption_version 0
-- κρατάει σκέτο JSON. Αν κάποτε μπει πραγματικό ciphertext, το cast θα σκάσει
-- αντί να ρίξει όλο το query.
create or replace function public.safe_jsonb(raw text)
returns jsonb
language plpgsql
immutable
as $$
begin
  return raw::jsonb;
exception when others then
  return '{}'::jsonb;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Σχήμα μηνύματος
-- ---------------------------------------------------------------------------
create or replace function public.message_payload(m public.messages)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', m.id::text,
    'conversationId', m.conversation_id::text,
    'senderId', m.sender_id::text,
    'body', case when m.deleted_at is not null then '' else m.ciphertext end,
    'encrypted', m.encryption_version > 0,
    'kind', 'text',
    'createdAt', m.created_at,
    'readBy', coalesce((
      select jsonb_agg(r.user_id::text)
      from message_receipts r
      where r.message_id = m.id and r.read_at is not null
    ), '[]'::jsonb),
    'deliveredTo', coalesce((
      select jsonb_agg(r.user_id::text)
      from message_receipts r
      where r.message_id = m.id and r.delivered_at is not null
    ), '[]'::jsonb),
    -- Το url το φτιάχνει ο client ως signed URL από το path· ο bucket
    -- message-media είναι private και δεν σερβίρει τίποτα απευθείας.
    'attachment', (
      select jsonb_build_object(
        'id', a.id::text,
        'path', a.storage_path,
        'size', a.byte_size,
        'name', coalesce(public.safe_jsonb(a.encrypted_metadata)->>'name', 'file'),
        'mime', coalesce(public.safe_jsonb(a.encrypted_metadata)->>'mime', 'application/octet-stream')
      )
      from attachments a
      where a.message_id = m.id
      limit 1
    )
  )
$$;

-- ---------------------------------------------------------------------------
-- 2. Λίστα συνομιλιών
-- ---------------------------------------------------------------------------
create or replace function public.list_conversations()
returns setof jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', c.id::text,
    'type', c.kind::text,
    'createdAt', c.created_at,
    'requestFrom', c.request_from::text,
    'requestStatus', c.request_status::text,
    'others', coalesce((
      select jsonb_agg(public.profile_payload(p))
      from conversation_members cm2
      join profiles p on p.id = cm2.user_id
      where cm2.conversation_id = c.id
        and cm2.user_id <> auth.uid()
    ), '[]'::jsonb),
    'last', (
      select public.message_payload(m)
      from messages m
      where m.conversation_id = c.id
      order by m.created_at desc
      limit 1
    ),
    'unread', (
      select count(*)
      from messages m
      where m.conversation_id = c.id
        and m.sender_id <> auth.uid()
        and not exists (
          select 1 from message_receipts r
          where r.message_id = m.id
            and r.user_id = auth.uid()
            and r.read_at is not null
        )
    )
  )
  from conversations c
  join conversation_members cm
    on cm.conversation_id = c.id and cm.user_id = auth.uid()
  where auth.uid() is not null
    and c.request_status <> 'rejected'
  order by coalesce(
    (select max(m.created_at) from messages m where m.conversation_id = c.id),
    c.created_at
  ) desc
$$;

-- ---------------------------------------------------------------------------
-- 3. Μηνύματα μιας συνομιλίας (τα τελευταία 200, αύξουσα σειρά)
-- ---------------------------------------------------------------------------
create or replace function public.list_messages(conversation uuid)
returns setof jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public.message_payload(m)
  from (
    select mm.*
    from messages mm
    where mm.conversation_id = conversation
      and exists (
        select 1 from conversation_members cm
        where cm.conversation_id = conversation
          and cm.user_id = auth.uid()
      )
    order by mm.created_at desc
    limit 200
  ) m
  order by m.created_at
$$;

-- ---------------------------------------------------------------------------
-- 4. Αντιστοίχιση επαφών με hashes email
-- ---------------------------------------------------------------------------
-- ΠΡΟΣΟΧΗ, γνωστός περιορισμός: τα σκέτα SHA-256 hashes email σπάνε με
-- λεξικό, γιατί τα email έχουν χαμηλή εντροπία. Ο σωστός σχεδιασμός θέλει
-- keyed HMAC με μυστικό που δεν φτάνει ποτέ στον client. Μένει ως έχει
-- προς το παρόν, αλλά δεν είναι ιδιωτικότητα — είναι συσκότιση.
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
-- 5. Δικαιώματα
-- ---------------------------------------------------------------------------
revoke all on function public.list_conversations() from public, anon;
revoke all on function public.list_messages(uuid) from public, anon;
revoke all on function public.match_contacts(text[]) from public, anon;
revoke all on function public.message_payload(public.messages) from public, anon;

grant execute on function public.list_conversations() to authenticated;
grant execute on function public.list_messages(uuid) to authenticated;
grant execute on function public.match_contacts(text[]) to authenticated;
grant execute on function public.message_payload(public.messages) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Σφίξιμο του profiles
-- ---------------------------------------------------------------------------
-- Το 0001 έβαλε: profiles_read_authenticated ... using (true).
-- Δηλαδή ΚΑΘΕ συνδεδεμένος χρήστης μπορούσε να κατεβάσει ολόκληρο τον πίνακα
-- profiles, με τα email όλων, αγνοώντας τα discover_by_email / show_email.
-- Με τον Express μπροστά δεν φαινόταν, γιατί ο browser δεν χτυπούσε τη βάση.
-- Τώρα που ο browser μιλάει απευθείας στο Postgres, είναι ορθάνοιχτη πόρτα.
--
-- Νέος κανόνας: βλέπεις τον εαυτό σου και όποιον μοιράζεσαι συνομιλία.
-- Η αναζήτηση/ανακάλυψη περνάει από τα search_profiles / match_contacts,
-- που είναι security definer και σέβονται τις ρυθμίσεις privacy.
drop policy if exists profiles_read_authenticated on public.profiles;

create policy profiles_read_self_and_contacts
on public.profiles
for select
to authenticated
using (
  id = auth.uid()
  or exists (
    select 1
    from conversation_members mine
    join conversation_members theirs
      on theirs.conversation_id = mine.conversation_id
    where mine.user_id = auth.uid()
      and theirs.user_id = profiles.id
  )
);
