-- 0008: Λειτουργίες συνομιλίας — διαγραφή μηνύματος (για μένα / για όλους),
-- απάντηση σε μήνυμα, αντιδράσεις, αναζήτηση στα μηνύματα, ομαδικές
-- συνομιλίες, παλαιότερα μηνύματα (σελιδοποίηση), λίστα μπλοκαρισμένων.
-- Idempotent — μπορεί να ξανατρέξει με ασφάλεια. Προϋποθέτει το 0007.
--
-- ΣΥΜΒΑΤΟΤΗΤΑ: το παλιό frontend συνεχίζει να δουλεύει. Τα RPCs που ήδη καλεί
-- κρατάνε τα ίδια ονόματα και τα ίδια πεδία· απλώς επιστρέφουν ΚΑΙ καινούργια.
-- Η μόνη ορατή διαφορά του: φορτώνει τα τελευταία 50 μηνύματα αντί για 200.

-- ---------------------------------------------------------------------------
-- 1. Νέοι πίνακες
-- ---------------------------------------------------------------------------

-- «Διαγραφή για μένα»: το μήνυμα μένει για τους άλλους, κρύβεται μόνο από εμένα.
create table if not exists public.message_hidden (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  hidden_at timestamptz not null default now(),
  primary key (message_id, user_id)
);
create index if not exists message_hidden_user_idx on public.message_hidden(user_id);

-- Μία αντίδραση ανά χρήστη ανά μήνυμα (όπως Viber/WhatsApp).
-- Η αφαίρεση ΔΕΝ είναι DELETE αλλά emoji = null: το Realtime δεν εφαρμόζει RLS
-- στα DELETE events, οπότε ένα DELETE θα έφτανε σε κάθε συνδρομητή. Τα UPDATE
-- φιλτράρονται κανονικά.
create table if not exists public.message_reactions (
  message_id uuid not null references public.messages(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  emoji text check (emoji is null or char_length(emoji) between 1 and 16),
  updated_at timestamptz not null default now(),
  primary key (message_id, user_id)
);
create index if not exists message_reactions_conversation_idx
  on public.message_reactions(conversation_id);

alter table public.message_hidden enable row level security;
alter table public.message_reactions enable row level security;

-- Μόνο ανάγνωση από τον browser. Κάθε εγγραφή περνάει από RPC.
revoke insert, update, delete on public.message_hidden from anon, authenticated;
revoke insert, update, delete on public.message_reactions from anon, authenticated;

drop policy if exists message_hidden_read_self on public.message_hidden;
create policy message_hidden_read_self
on public.message_hidden for select to authenticated
using (user_id = (select auth.uid()));

drop policy if exists message_reactions_read_members on public.message_reactions;
create policy message_reactions_read_members
on public.message_reactions for select to authenticated
using (public.is_conversation_member(conversation_id));

-- ---------------------------------------------------------------------------
-- 2. Σφίξιμο του INSERT στα messages
-- ---------------------------------------------------------------------------
-- Ο browser γράφει απευθείας στον πίνακα, άρα μπορεί να στείλει ό,τι στήλη
-- θέλει. Το trigger κλειδώνει όσα δεν του ανήκουν: την ώρα (αλλιώς ένα μήνυμα
-- θα μπορούσε να εμφανιστεί «χθες» ή «αύριο»), και ότι η απάντηση δείχνει σε
-- μήνυμα ΤΗΣ ΙΔΙΑΣ συνομιλίας (αλλιώς το replyTo θα διάβαζε ξένη συνομιλία).
create or replace function public.messages_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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

  return new;
end;
$$;

drop trigger if exists messages_before_insert on public.messages;
create trigger messages_before_insert
before insert on public.messages
for each row execute function public.messages_before_insert();

-- Ο χρήστης δεν πειράζει ποτέ μήνυμα με σκέτο UPDATE/DELETE· μόνο με RPC.
revoke update, delete on public.messages from anon, authenticated;
revoke update, delete on public.attachments from anon, authenticated;

-- Συνημμένα: το policy του 0001 ζητούσε μόνο «είμαι μέλος της συνομιλίας». Άρα
-- ένα μέλος μπορούσε να κρεμάσει δικό του αρχείο πάνω σε ΜΗΝΥΜΑ ΑΛΛΟΥ (να
-- εμφανιστεί «τιμολόγιο.pdf» σαν να το έστειλε εκείνος), ή να δηλώσει ως
-- συνημμένο αρχείο από ΞΕΝΟ φάκελο και έτσι να αποκτήσει δικαίωμα να το διαβάσει.
-- Το νέο app στέλνει συνημμένα μόνο μέσω send_message. Το απευθείας INSERT μένει
-- ανοιχτό μόνο για το παλιό app, μέχρι να ανέβει το καινούργιο, και μόνο για:
-- δικό μου μήνυμα, της ίδιας συνομιλίας, αρχείο από τον δικό μου φάκελο.
drop policy if exists attachments_insert_members on public.attachments;
create policy attachments_insert_members
on public.attachments
for insert
to authenticated
with check (
  split_part(storage_path, '/', 1) = (select auth.uid())::text
  and exists (
    select 1 from public.messages m
    where m.id = attachments.message_id
      and m.conversation_id = attachments.conversation_id
      and m.sender_id = (select auth.uid())
      and m.deleted_at is null
  )
);

-- Τα receipts γράφονται μόνο από το mark_conversation_read. Το policy του 0001
-- άφηνε τον καθένα να γράψει receipt για ΟΠΟΙΟΔΗΠΟΤΕ μήνυμα, άρα να εμφανιστεί
-- στο «διαβάστηκε από» μιας συνομιλίας στην οποία δεν ανήκει.
revoke insert, update, delete on public.message_receipts from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2β. Μόνο ενεργοί λογαριασμοί ενεργούν
-- ---------------------------------------------------------------------------
-- Όταν σβηστεί ένας λογαριασμός, το token που έχει ήδη ο browser του συνεχίζει
-- να ισχύει μέχρι να λήξει (έως μία ώρα). Χωρίς αυτόν τον έλεγχο, μέσα σε αυτή
-- την ώρα μπορούσε ακόμα να στέλνει μηνύματα, ως «Deleted user».
create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles where id = auth.uid() and deleted_at is null
  )
$$;

-- Ίδιο με το 0004, με δύο προσθήκες:
--  * μόνο ενεργός λογαριασμός ξεκινάει συνομιλία,
--  * με κάποιον που ΜΠΟΡΩ να βρω: είναι ορατός σε όλους στην αναζήτηση, ή
--    μοιραζόμαστε ήδη κάποια συνομιλία (π.χ. είμαστε στην ίδια ομάδα).
--    Πριν, αρκούσε να ξέρεις το εσωτερικό id κάποιου για να του στείλεις αίτημα,
--    ακόμα κι αν είχε διαλέξει «Κανείς» στο ποιος τον βρίσκει.
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

  if not exists (select 1 from profiles where id = target_user and deleted_at is null) then
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

  insert into conversations (kind, created_by, request_from, request_status)
  values ('direct', me, me, 'pending')
  returning id into new_id;

  insert into conversation_members (conversation_id, user_id)
  values (new_id, me), (new_id, target_user);

  return new_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Σχήμα μηνύματος: + deleted, senderName, replyTo, reactions
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
    'senderName', (select p.display_name from profiles p where p.id = m.sender_id),
    'body', case when m.deleted_at is not null then '' else m.ciphertext end,
    'deleted', m.deleted_at is not null,
    'encrypted', m.encryption_version > 0,
    'kind', 'text',
    'createdAt', m.created_at,
    -- Μόνο όσοι έχουν ανοιχτό το «Read receipts». Πριν, η ρύθμιση υπήρχε στην
    -- οθόνη αλλά δεν την κοίταζε κανείς: το «διαβάστηκε» φαινόταν πάντα.
    'readBy', coalesce((
      select jsonb_agg(r.user_id::text)
      from message_receipts r
      join profiles rp on rp.id = r.user_id and rp.read_receipts
      where r.message_id = m.id and r.read_at is not null
    ), '[]'::jsonb),
    -- Το delivered_at γράφεται την ώρα που ο άλλος ΑΝΟΙΓΕΙ τη συνομιλία, άρα
    -- είναι κι αυτό ένδειξη ανάγνωσης: ακολουθεί την ίδια ρύθμιση.
    'deliveredTo', coalesce((
      select jsonb_agg(r.user_id::text)
      from message_receipts r
      join profiles rp on rp.id = r.user_id and rp.read_receipts
      where r.message_id = m.id and r.delivered_at is not null
    ), '[]'::jsonb),
    'reactions', coalesce((
      select jsonb_agg(
        jsonb_build_object('userId', x.user_id::text, 'emoji', x.emoji)
        order by x.updated_at
      )
      from message_reactions x
      where x.message_id = m.id and x.emoji is not null
    ), '[]'::jsonb),
    'replyTo', (
      select jsonb_build_object(
        'id', r.id::text,
        'senderId', r.sender_id::text,
        'senderName', (select p.display_name from profiles p where p.id = r.sender_id),
        'body', case when r.deleted_at is not null then '' else left(r.ciphertext, 140) end,
        'deleted', r.deleted_at is not null,
        'attachmentName', (
          select public.safe_jsonb(a.encrypted_metadata)->>'name'
          from attachments a where a.message_id = r.id limit 1
        )
      )
      from messages r
      where r.id = m.reply_to
        -- Ποτέ παράθεση από ΑΛΛΗ συνομιλία. Το trigger το εμποδίζει για τα νέα
        -- μηνύματα· αυτό καλύπτει και ό,τι γράφτηκε πριν υπάρξει το trigger.
        and r.conversation_id = m.conversation_id
    ),
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
-- 4. Μηνύματα συνομιλίας, σελίδα-σελίδα
-- ---------------------------------------------------------------------------
-- before_message = το ΠΑΛΑΙΟΤΕΡΟ μήνυμα που έχει ήδη ο client· επιστρέφονται
-- τα page_size αμέσως πριν από αυτό. Χωρίς αυτό: τα πιο πρόσφατα.
-- Σύγκριση με (created_at, id) ώστε δύο μηνύματα με ίδια ώρα να μη χαθούν στο
-- όριο της σελίδας.
drop function if exists public.list_messages(uuid);

create or replace function public.list_messages(
  conversation uuid,
  before_message uuid default null,
  page_size integer default 50
)
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
      and not exists (
        select 1 from message_hidden h
        where h.message_id = mm.id and h.user_id = auth.uid()
      )
      and (
        before_message is null
        or (mm.created_at, mm.id) < (
          select b.created_at, b.id from messages b
          where b.id = before_message and b.conversation_id = conversation
        )
      )
    order by mm.created_at desc, mm.id desc
    limit least(greatest(coalesce(page_size, 50), 1), 200)
  ) m
  order by m.created_at, m.id
$$;

-- Ένα μεμονωμένο μήνυμα, για να ενημερώνεται η οθόνη όταν αλλάξει κάτι σε
-- αυτό (διαγραφή για όλους, αντίδραση) χωρίς να ξαναφορτώνει όλη η συνομιλία.
create or replace function public.get_message(message uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public.message_payload(m)
  from messages m
  where m.id = message
    and exists (
      select 1 from conversation_members cm
      where cm.conversation_id = m.conversation_id and cm.user_id = auth.uid()
    )
    and not exists (
      select 1 from message_hidden h
      where h.message_id = m.id and h.user_id = auth.uid()
    )
$$;

-- ---------------------------------------------------------------------------
-- 4β. «Διαβάστηκε» που σέβεται τη ρύθμιση
-- ---------------------------------------------------------------------------
-- Τα receipts γράφονται πάντα (από αυτά βγαίνει ο μετρητής αδιάβαστων ΜΟΥ).
-- Το last_read_at όμως το βλέπουν και τα άλλα μέλη (και φτάνει σε αυτά ζωντανά
-- μέσω Realtime), οπότε ενημερώνεται ΜΟΝΟ αν έχω ανοιχτό το «Read receipts».
-- Αυτό το UPDATE είναι και το σήμα που κάνει τα διπλά τικ του αποστολέα να
-- ανάψουν αμέσως, χωρίς να ξαναμπεί στη συνομιλία.
create or replace function public.mark_conversation_read(conversation uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  stamp timestamptz := now();
  newly_read integer;
begin
  if me is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if not exists (
    select 1 from conversation_members
    where conversation_id = conversation and user_id = me
  ) then
    raise exception 'Not a member of this conversation' using errcode = '42501';
  end if;

  with touched as (
    insert into message_receipts (message_id, user_id, delivered_at, read_at)
    select m.id, me, stamp, stamp
    from messages m
    where m.conversation_id = conversation
      and m.sender_id <> me
      and not exists (
        select 1 from message_receipts r
        where r.message_id = m.id and r.user_id = me and r.read_at is not null
      )
    on conflict (message_id, user_id) do update
    set read_at = coalesce(message_receipts.read_at, excluded.read_at),
        delivered_at = coalesce(message_receipts.delivered_at, excluded.delivered_at)
    returning 1
  )
  select count(*) into newly_read from touched;

  -- Τίποτα καινούργιο = κανένα σήμα. Αλλιώς κάθε άνοιγμα της συνομιλίας θα
  -- έστελνε event στους άλλους.
  if newly_read > 0 and exists (select 1 from profiles where id = me and read_receipts) then
    update conversation_members
    set last_read_at = stamp
    where conversation_id = conversation and user_id = me;
  end if;

  return stamp;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Λίστα συνομιλιών: + name, myRole, blockedByMe, ρόλοι μελών
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
    'name', c.name,
    'myRole', cm.role::text,
    'createdAt', c.created_at,
    'requestFrom', c.request_from::text,
    'requestStatus', c.request_status::text,
    'blockedByMe', c.kind = 'direct' and exists (
      select 1
      from conversation_members o
      join blocks b on b.blocker_id = auth.uid() and b.blocked_id = o.user_id
      where o.conversation_id = c.id and o.user_id <> auth.uid()
    ),
    'others', coalesce((
      select jsonb_agg(
        public.profile_payload(p) || jsonb_build_object('role', cm2.role::text)
        order by p.display_name
      )
      from conversation_members cm2
      join profiles p on p.id = cm2.user_id
      where cm2.conversation_id = c.id
        and cm2.user_id <> auth.uid()
    ), '[]'::jsonb),
    'last', (
      select public.message_payload(m)
      from messages m
      where m.conversation_id = c.id
        and not exists (
          select 1 from message_hidden h
          where h.message_id = m.id and h.user_id = auth.uid()
        )
      order by m.created_at desc, m.id desc
      limit 1
    ),
    'unread', (
      select count(*)
      from messages m
      where m.conversation_id = c.id
        and m.sender_id <> auth.uid()
        and m.deleted_at is null
        and not exists (
          select 1 from message_hidden h
          where h.message_id = m.id and h.user_id = auth.uid()
        )
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
-- 6. Αποστολή μηνύματος σε ένα βήμα (μήνυμα + συνημμένο + απάντηση)
-- ---------------------------------------------------------------------------
-- Πριν, ο browser έγραφε πρώτα το μήνυμα και μετά το συνημμένο· αν το δεύτερο
-- αποτύγχανε έμενε άδειο μήνυμα. Εδώ γίνονται μαζί ή καθόλου.
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

  -- Ίδιο client_id = ίδιο μήνυμα (διπλό πάτημα, επανάληψη μετά από timeout).
  select * into msg from messages
  where sender_id = me and client_message_id = client_id;
  if found then
    return public.message_payload(msg);
  end if;

  insert into messages (conversation_id, sender_id, ciphertext, encryption_version, client_message_id, reply_to)
  values (conversation, me, clean, 0, client_id, reply_to_message)
  returning * into msg;

  if attachment is not null then
    file_path := attachment->>'path';
    file_size := (attachment->>'size')::bigint;
    -- Μόνο αρχεία από τον ΔΙΚΟ ΤΟΥ φάκελο στο storage.
    if file_path is null or split_part(file_path, '/', 1) <> me::text then
      raise exception 'Attachment does not belong to you' using errcode = '42501';
    end if;
    insert into attachments (message_id, conversation_id, storage_path, encrypted_metadata, byte_size)
    values (
      msg.id,
      conversation,
      file_path,
      jsonb_build_object(
        'name', left(coalesce(attachment->>'name', 'file'), 180),
        'mime', left(coalesce(attachment->>'mime', 'application/octet-stream'), 120)
      )::text,
      file_size
    );
  end if;

  return public.message_payload(msg);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Διαγραφή μηνύματος
-- ---------------------------------------------------------------------------
-- for_everyone = false: κρύβεται μόνο από εμένα (οποιοδήποτε μήνυμα).
-- for_everyone = true : μόνο ο αποστολέας. Το κείμενο ΣΒΗΝΕΤΑΙ από τη βάση
--   (όχι απλή σήμανση), φεύγουν συνημμένα και αντιδράσεις, και μένει η ένδειξη
--   «Το μήνυμα διαγράφηκε». Επιστρέφει τα paths των αρχείων για να τα σβήσει ο
--   browser μέσω Storage API — η βάση δεν επιτρέπεται να το κάνει η ίδια.
create or replace function public.delete_message(message uuid, for_everyone boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  target messages%rowtype;
  paths jsonb := '[]'::jsonb;
begin
  if me is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select m.* into target
  from messages m
  join conversation_members cm
    on cm.conversation_id = m.conversation_id and cm.user_id = me
  where m.id = message;
  if not found then
    raise exception 'Message not found' using errcode = 'P0002';
  end if;

  if not for_everyone then
    insert into message_hidden (message_id, user_id)
    values (message, me)
    on conflict do nothing;
    return jsonb_build_object('scope', 'me', 'paths', paths);
  end if;

  if target.sender_id <> me then
    raise exception 'Only the sender can delete a message for everyone' using errcode = '42501';
  end if;

  if target.deleted_at is not null then
    return jsonb_build_object('scope', 'everyone', 'paths', paths);
  end if;

  select coalesce(jsonb_agg(a.storage_path), '[]'::jsonb) into paths
  from attachments a where a.message_id = message;

  delete from attachments where message_id = message;
  update message_reactions set emoji = null, updated_at = now()
  where message_id = message and emoji is not null;
  update messages set ciphertext = '', deleted_at = now(), edited_at = null
  where id = message;

  return jsonb_build_object('scope', 'everyone', 'paths', paths);
end;
$$;

-- Για να σβήσει ο browser τα αρχεία του μέσω Storage API χρειάζεται να τα
-- «βλέπει» και να επιτρέπεται να τα σβήσει. Μόνο τον δικό του φάκελο.
drop policy if exists media_read_own on storage.objects;
create policy media_read_own on storage.objects for select to authenticated
using (bucket_id = 'message-media' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists media_delete_own on storage.objects;
create policy media_delete_own on storage.objects for delete to authenticated
using (bucket_id = 'message-media' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ---------------------------------------------------------------------------
-- 8. Αντιδράσεις
-- ---------------------------------------------------------------------------
-- emoji = null ή '' αφαιρεί την αντίδραση. Το ίδιο emoji δεύτερη φορά επίσης.
create or replace function public.react_to_message(message uuid, reaction text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  target messages%rowtype;
  chosen text := nullif(trim(coalesce(reaction, '')), '');
begin
  if me is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select m.* into target
  from messages m
  join conversation_members cm
    on cm.conversation_id = m.conversation_id and cm.user_id = me
  where m.id = message;
  if not found then
    raise exception 'Message not found' using errcode = 'P0002';
  end if;
  if target.deleted_at is not null then
    raise exception 'Message was deleted' using errcode = '22023';
  end if;
  -- Όποιος δεν μπορεί να ΓΡΑΨΕΙ στη συνομιλία (μπλοκαρισμένος, απορριφθέν αίτημα,
  -- διαγραμμένος λογαριασμός) δεν μπορεί ούτε να αντιδράσει. Η αφαίρεση δικής του
  -- αντίδρασης επιτρέπεται πάντα.
  if chosen is not null and not public.can_post_to_conversation(target.conversation_id) then
    raise exception 'You cannot send messages to this conversation' using errcode = '42501';
  end if;
  -- Μόνο τα έξι emoji που προσφέρει η οθόνη. Αλλιώς η «αντίδραση» γίνεται
  -- κανάλι για 16 χαρακτήρες ελεύθερου κειμένου πάνω στο μήνυμα κάποιου άλλου.
  -- Γραμμένα με κωδικούς για να μην εξαρτώνται από την κωδικοποίηση του αρχείου:
  -- μπράβο, καρδιά, γέλιο, έκπληξη, λύπη, ευχαριστώ.
  if chosen is not null and chosen <> all (array[
    chr(128077),
    chr(10084) || chr(65039),
    chr(128514),
    chr(128558),
    chr(128546),
    chr(128591)
  ]) then
    raise exception 'Invalid reaction' using errcode = '22023';
  end if;

  insert into message_reactions (message_id, conversation_id, user_id, emoji)
  values (message, target.conversation_id, me, chosen)
  on conflict (message_id, user_id) do update
  set emoji = case
        when message_reactions.emoji is not distinct from excluded.emoji then null
        else excluded.emoji
      end,
      updated_at = now();

  return public.message_payload(target);
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Αναζήτηση μέσα στα μηνύματα
-- ---------------------------------------------------------------------------
-- Σε όλες τις συνομιλίες μου, ή σε μία. Ψάχνει κείμενο και ονόματα αρχείων.
create or replace function public.search_messages(search_term text, conversation uuid default null)
returns setof jsonb
language sql
stable
security definer
set search_path = public
as $$
  with input as (
    select
      length(trim(search_term)) as len,
      '%' || replace(replace(replace(trim(search_term), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pattern
  )
  select public.message_payload(m)
  from messages m
  cross join input i
  join conversation_members cm
    on cm.conversation_id = m.conversation_id and cm.user_id = auth.uid()
  join conversations c on c.id = m.conversation_id
  where auth.uid() is not null
    and i.len >= 2
    and (conversation is null or m.conversation_id = conversation)
    and c.request_status <> 'rejected'
    and m.deleted_at is null
    and m.encryption_version = 0
    and not exists (
      select 1 from message_hidden h
      where h.message_id = m.id and h.user_id = auth.uid()
    )
    and (
      m.ciphertext ilike i.pattern
      or exists (
        select 1 from attachments a
        where a.message_id = m.id
          and public.safe_jsonb(a.encrypted_metadata)->>'name' ilike i.pattern
      )
    )
  order by m.created_at desc, m.id desc
  limit 50
$$;

-- ---------------------------------------------------------------------------
-- 10. Μπλοκαρισμένοι
-- ---------------------------------------------------------------------------
-- Το ξεμπλοκάρισμα είναι σκέτο DELETE στο blocks (το policy blocks_self το
-- επιτρέπει ήδη). Χρειάζεται RPC μόνο για να πάρω ΟΝΟΜΑΤΑ, αφού το profiles
-- δεν διαβάζεται πια απευθείας.
create or replace function public.list_blocked()
returns setof jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public.profile_payload(p)
  from blocks b
  join profiles p on p.id = b.blocked_id
  where b.blocker_id = auth.uid()
  order by b.created_at desc
$$;

-- ---------------------------------------------------------------------------
-- 11. Ομαδικές συνομιλίες
-- ---------------------------------------------------------------------------
-- Στις ομάδες ένα block μεταξύ δύο μελών ΔΕΝ κλειδώνει όλη την ομάδα· ισχύει
-- μόνο στις ατομικές.
create or replace function public.can_post_to_conversation(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from conversations c
    join conversation_members mine
      on mine.conversation_id = c.id and mine.user_id = auth.uid()
    where c.id = target
      and public.is_active_user()
      and c.request_status <> 'rejected'
      and (
        c.kind = 'group'
        or not exists (
          select 1
          from conversation_members other
          join blocks b
            on (b.blocker_id = other.user_id and b.blocked_id = auth.uid())
            or (b.blocker_id = auth.uid() and b.blocked_id = other.user_id)
          where other.conversation_id = c.id
            and other.user_id <> auth.uid()
        )
      )
  )
$$;

-- Ποιους επιτρέπεται να βάλω σε ομάδα: μόνο επαφές μου (αποδεκτή ατομική
-- συνομιλία), όχι διαγραμμένους, χωρίς block προς καμία κατεύθυνση. Έτσι
-- κανείς δεν μπαίνει σε ομάδα από άγνωστο.
create or replace function public.addable_to_group(candidate uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_contact(candidate)
    and exists (select 1 from profiles p where p.id = candidate and p.deleted_at is null)
    and not exists (
      select 1 from blocks b
      where (b.blocker_id = auth.uid() and b.blocked_id = candidate)
         or (b.blocker_id = candidate and b.blocked_id = auth.uid())
    )
$$;

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

create or replace function public.add_group_members(conversation uuid, member_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  wanted uuid[];
  bad uuid;
  current_count integer;
  added integer;
begin
  if me is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from conversations c
    join conversation_members cm on cm.conversation_id = c.id
    where c.id = conversation and c.kind = 'group'
      and cm.user_id = me and cm.role = 'admin'
  ) then
    raise exception 'Only a group admin can add people' using errcode = '42501';
  end if;

  -- Δύο ταυτόχρονες αλλαγές μελών στην ίδια ομάδα μπαίνουν στη σειρά. Χωρίς
  -- αυτό, το όριο των 50 και η «πάντα ένας admin» μπορούν να σπάσουν.
  perform 1 from conversations where id = conversation for update;

  select coalesce(array_agg(distinct x), '{}') into wanted
  from unnest(coalesce(member_ids, '{}')) x
  where x is not null
    and not exists (
      select 1 from conversation_members cm
      where cm.conversation_id = conversation and cm.user_id = x
    );

  if coalesce(array_length(wanted, 1), 0) = 0 then
    return 0;
  end if;

  select count(*) into current_count
  from conversation_members where conversation_id = conversation;
  if current_count + array_length(wanted, 1) > 50 then
    raise exception 'A group can have up to 50 people' using errcode = '22023';
  end if;

  select x into bad from unnest(wanted) x where not public.addable_to_group(x) limit 1;
  if bad is not null then
    raise exception 'You can only add people you already chat with' using errcode = '42501';
  end if;

  insert into conversation_members (conversation_id, user_id, role)
  select conversation, x, 'member' from unnest(wanted) x;
  get diagnostics added = row_count;
  return added;
end;
$$;

-- Εσωτερικό: βγάζει κάποιον από ομάδα και κρατάει την ομάδα σε τάξη. Αν έφυγε
-- ο τελευταίος admin, γίνεται admin το παλαιότερο μέλος. Αν δεν έμεινε κανείς,
-- η ομάδα σβήνεται. ΔΕΝ καλείται από τον browser (κανένα grant).
create or replace function public.leave_group_internal(conversation uuid, leaving uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform 1 from conversations where id = conversation for update;

  delete from conversation_members
  where conversation_id = conversation and user_id = leaving;

  if not exists (select 1 from conversation_members where conversation_id = conversation) then
    delete from conversations where id = conversation and kind = 'group';
    return;
  end if;

  if not exists (
    select 1 from conversation_members
    where conversation_id = conversation and role = 'admin'
  ) then
    update conversation_members set role = 'admin'
    where conversation_id = conversation
      and user_id = (
        select user_id from conversation_members
        where conversation_id = conversation
        order by joined_at, user_id
        limit 1
      );
  end if;
end;
$$;

-- target = εγώ: αποχωρώ. target = άλλος: τον βγάζω (μόνο admin).
create or replace function public.remove_group_member(conversation uuid, target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  my_role public.member_role;
begin
  if me is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select cm.role into my_role
  from conversations c
  join conversation_members cm on cm.conversation_id = c.id
  where c.id = conversation and c.kind = 'group' and cm.user_id = me;
  if not found then
    raise exception 'Group not found' using errcode = 'P0002';
  end if;

  if target <> me and my_role <> 'admin' then
    raise exception 'Only a group admin can remove people' using errcode = '42501';
  end if;

  if not exists (
    select 1 from conversation_members
    where conversation_id = conversation and user_id = target
  ) then
    return;
  end if;

  perform public.leave_group_internal(conversation, target);
end;
$$;

create or replace function public.rename_group(conversation uuid, new_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  clean text := trim(coalesce(new_name, ''));
begin
  if me is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if char_length(clean) not between 1 and 60 then
    raise exception 'Group name must be 1 to 60 characters' using errcode = '22023';
  end if;

  update conversations c set name = clean
  where c.id = conversation and c.kind = 'group'
    and exists (
      select 1 from conversation_members cm
      where cm.conversation_id = c.id and cm.user_id = me and cm.role = 'admin'
    );
  if not found then
    raise exception 'Only a group admin can rename the group' using errcode = '42501';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 12. Διαγραφή λογαριασμού: καθαρίζει και τα καινούργια
-- ---------------------------------------------------------------------------
create or replace function public.delete_my_account()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  g uuid;
begin
  if me is null then
    raise exception 'Πρέπει να είσαι συνδεδεμένος για να διαγράψεις τον λογαριασμό σου.'
      using errcode = '28000';
  end if;

  if exists (select 1 from profiles where id = me and deleted_at is not null) then
    raise exception 'Ο λογαριασμός έχει ήδη διαγραφεί.' using errcode = '23505';
  end if;

  -- Από τις ομάδες φεύγει κανονικά. Στις ατομικές μένει ως «Deleted user»,
  -- ώστε ο άλλος να κρατήσει τη συνομιλία του.
  for g in
    select c.id from conversations c
    join conversation_members cm on cm.conversation_id = c.id
    where c.kind = 'group' and cm.user_id = me
  loop
    perform public.leave_group_internal(g, me);
  end loop;

  delete from public.blocks where blocker_id = me or blocked_id = me;
  delete from public.message_hidden where user_id = me;
  update public.message_reactions set emoji = null, updated_at = now()
  where user_id = me and emoji is not null;

  update public.profiles set
    email             = 'deleted-' || me::text || '@deleted.invalid',
    display_name      = 'Deleted user',
    username          = null,
    avatar_path       = null,
    bio               = '',
    discover_by_email = 'nobody',
    show_email        = 'nobody',
    read_receipts     = false,
    show_online       = false,
    deleted_at        = now(),
    updated_at        = now()
  where id = me;

  delete from auth.users where id = me;

  return jsonb_build_object('deleted', true, 'files_removed', 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- 13. Δικαιώματα
-- ---------------------------------------------------------------------------
revoke all on function public.messages_before_insert() from public, anon, authenticated;
revoke all on function public.leave_group_internal(uuid, uuid) from public, anon, authenticated;
-- Το message_payload δέχεται ολόκληρη γραμμή ΑΠΟ ΤΟΝ ΚΑΛΟΥΝΤΑ. Αν το καλούσε ο
-- browser, θα του έδινε μια ψεύτικη γραμμή με το id ξένου μηνύματος και θα
-- έπαιρνε πίσω αντιδράσεις, συνημμένα και την παράθεσή του. Το καλούν μόνο οι
-- security definer functions από κάτω, που έχουν ήδη ελέγξει ότι είσαι μέλος.
revoke all on function public.message_payload(public.messages) from public, anon, authenticated;
revoke all on function public.is_active_user() from public, anon;
revoke all on function public.start_direct_conversation(uuid) from public, anon;
revoke all on function public.list_messages(uuid, uuid, integer) from public, anon;
revoke all on function public.get_message(uuid) from public, anon;
revoke all on function public.list_conversations() from public, anon;
revoke all on function public.send_message(uuid, text, uuid, uuid, jsonb) from public, anon;
revoke all on function public.delete_message(uuid, boolean) from public, anon;
revoke all on function public.react_to_message(uuid, text) from public, anon;
revoke all on function public.search_messages(text, uuid) from public, anon;
revoke all on function public.list_blocked() from public, anon;
revoke all on function public.can_post_to_conversation(uuid) from public, anon;
revoke all on function public.addable_to_group(uuid) from public, anon;
revoke all on function public.create_group(text, uuid[]) from public, anon;
revoke all on function public.add_group_members(uuid, uuid[]) from public, anon;
revoke all on function public.remove_group_member(uuid, uuid) from public, anon;
revoke all on function public.rename_group(uuid, text) from public, anon;
revoke all on function public.delete_my_account() from public, anon;
revoke all on function public.mark_conversation_read(uuid) from public, anon;

grant execute on function public.mark_conversation_read(uuid) to authenticated;
grant execute on function public.is_active_user() to authenticated;
grant execute on function public.start_direct_conversation(uuid) to authenticated;
grant execute on function public.list_messages(uuid, uuid, integer) to authenticated;
grant execute on function public.get_message(uuid) to authenticated;
grant execute on function public.list_conversations() to authenticated;
grant execute on function public.send_message(uuid, text, uuid, uuid, jsonb) to authenticated;
grant execute on function public.delete_message(uuid, boolean) to authenticated;
grant execute on function public.react_to_message(uuid, text) to authenticated;
grant execute on function public.search_messages(text, uuid) to authenticated;
grant execute on function public.list_blocked() to authenticated;
-- Χρησιμοποιείται στο policy messages_insert_members, που τρέχει ως ο χρήστης.
grant execute on function public.can_post_to_conversation(uuid) to authenticated;
grant execute on function public.addable_to_group(uuid) to authenticated;
grant execute on function public.create_group(text, uuid[]) to authenticated;
grant execute on function public.add_group_members(uuid, uuid[]) to authenticated;
grant execute on function public.remove_group_member(uuid, uuid) to authenticated;
grant execute on function public.rename_group(uuid, text) to authenticated;
grant execute on function public.delete_my_account() to authenticated;

-- ---------------------------------------------------------------------------
-- 14. Realtime
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'message_reactions'
  ) then
    alter publication supabase_realtime add table public.message_reactions;
  end if;
end
$$;

alter table public.message_reactions replica identity full;

-- Το API (PostgREST) να δει αμέσως τις νέες υπογραφές.
notify pgrst, 'reload schema';
