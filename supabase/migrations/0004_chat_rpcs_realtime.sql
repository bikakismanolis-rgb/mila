-- 0004: Ό,τι λείπει για να τρέξουν τα chats απευθείας από τον browser,
-- χωρίς τον Express server. Idempotent — μπορεί να ξανατρέξει με ασφάλεια.
--
-- Το 0001 έφτιαξε τους πίνακες και τα policies ΑΝΑΓΝΩΣΗΣ, αλλά όχι τα εξής:
--   * κανένα INSERT policy σε conversations / conversation_members
--     -> κανείς δεν μπορεί να ξεκινήσει συνομιλία
--   * κανένας τρόπος να γίνει accept/reject ένα request
--   * κανένας τρόπος να ενημερωθεί το last_read_at (unread badges)
--   * τα tables δεν είναι στο publication supabase_realtime
--     -> δεν φτάνει τίποτα σε πραγματικό χρόνο
--
-- Οι mutations γίνονται με security definer RPCs αντί για RLS policies,
-- γιατί το RLS δουλεύει ανά γραμμή και όχι ανά στήλη: ένα σκέτο UPDATE policy
-- στο conversation_members θα άφηνε τον χρήστη να αλλάξει και το role του σε admin.

-- ---------------------------------------------------------------------------
-- 1. Έναρξη direct συνομιλίας (ατομική)
-- ---------------------------------------------------------------------------
-- Χρειάζεται RPC και όχι INSERT policy λόγω του κλασικού chicken-and-egg:
-- για να μπεις μέλος σε μια συνομιλία πρέπει να μπορείς να τη διαβάσεις,
-- αλλά μπορείς να τη διαβάσεις μόνο αν είσαι ήδη μέλος.
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
  if me is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if target_user = me then
    raise exception 'Cannot start a conversation with yourself' using errcode = '22023';
  end if;

  if not exists (select 1 from profiles where id = target_user) then
    raise exception 'User not found' using errcode = 'P0002';
  end if;

  -- Μπλοκάρισμα προς οποιαδήποτε κατεύθυνση σταματάει τη συνομιλία.
  if exists (
    select 1 from blocks
    where (blocker_id = me and blocked_id = target_user)
       or (blocker_id = target_user and blocked_id = me)
  ) then
    raise exception 'Conversation not allowed' using errcode = '42501';
  end if;

  -- Αν υπάρχει ήδη direct συνομιλία μεταξύ των δύο, επέστρεψέ την.
  select c.id into existing
  from conversations c
  join conversation_members a on a.conversation_id = c.id and a.user_id = me
  join conversation_members b on b.conversation_id = c.id and b.user_id = target_user
  where c.kind = 'direct'
  limit 1;

  if existing is not null then
    return existing;
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
-- 2. Αποδοχή / απόρριψη message request
-- ---------------------------------------------------------------------------
-- Μόνο ο παραλήπτης απαντάει, ποτέ αυτός που έστειλε το request.
create or replace function public.respond_to_request(conversation uuid, accept boolean)
returns public.request_status
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  convo conversations%rowtype;
  outcome public.request_status;
begin
  if me is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select * into convo from conversations where id = conversation;
  if not found then
    raise exception 'Conversation not found' using errcode = 'P0002';
  end if;

  if not exists (
    select 1 from conversation_members
    where conversation_id = conversation and user_id = me
  ) then
    raise exception 'Not a member of this conversation' using errcode = '42501';
  end if;

  if convo.request_from = me then
    raise exception 'Cannot respond to your own request' using errcode = '42501';
  end if;

  if convo.request_status <> 'pending' then
    return convo.request_status;
  end if;

  outcome := case when accept then 'accepted' else 'rejected' end::public.request_status;

  update conversations set request_status = outcome where id = conversation;

  return outcome;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Σήμανση ως διαβασμένο
-- ---------------------------------------------------------------------------
-- Ενημερώνει ΜΟΝΟ το last_read_at του ίδιου του χρήστη, ποτέ το role του.
create or replace function public.mark_conversation_read(conversation uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  stamp timestamptz := now();
begin
  if me is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  update conversation_members
  set last_read_at = stamp
  where conversation_id = conversation and user_id = me;

  if not found then
    raise exception 'Not a member of this conversation' using errcode = '42501';
  end if;

  -- Read receipts για τα μηνύματα των άλλων, αν ο χρήστης τα έχει ενεργά.
  insert into message_receipts (message_id, user_id, delivered_at, read_at)
  select m.id, me, stamp, stamp
  from messages m
  where m.conversation_id = conversation
    and m.sender_id <> me
  on conflict (message_id, user_id) do update
  set read_at = coalesce(message_receipts.read_at, excluded.read_at),
      delivered_at = coalesce(message_receipts.delivered_at, excluded.delivered_at);

  return stamp;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Δικαιώματα εκτέλεσης
-- ---------------------------------------------------------------------------
revoke all on function public.start_direct_conversation(uuid) from public, anon;
revoke all on function public.respond_to_request(uuid, boolean) from public, anon;
revoke all on function public.mark_conversation_read(uuid) from public, anon;

grant execute on function public.start_direct_conversation(uuid) to authenticated;
grant execute on function public.respond_to_request(uuid, boolean) to authenticated;
grant execute on function public.mark_conversation_read(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Μηνύματα: αποκλεισμός αποστολής σε μπλοκαρισμένη ή απορριφθείσα συνομιλία
-- ---------------------------------------------------------------------------
-- Το 0001 επιτρέπει σε κάθε μέλος να γράψει. Αυτό αγνοεί τα blocks και τα
-- απορριμμένα requests, οπότε το σφίγγουμε.
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
      and c.request_status <> 'rejected'
      and not exists (
        select 1
        from conversation_members other
        join blocks b
          on (b.blocker_id = other.user_id and b.blocked_id = auth.uid())
          or (b.blocker_id = auth.uid() and b.blocked_id = other.user_id)
        where other.conversation_id = c.id
          and other.user_id <> auth.uid()
      )
  )
$$;

revoke all on function public.can_post_to_conversation(uuid) from public, anon;
grant execute on function public.can_post_to_conversation(uuid) to authenticated;

drop policy if exists messages_insert_members on public.messages;
create policy messages_insert_members
on public.messages
for insert
to authenticated
with check (
  sender_id = auth.uid()
  and public.can_post_to_conversation(conversation_id)
);

-- ---------------------------------------------------------------------------
-- 6. Realtime
-- ---------------------------------------------------------------------------
-- Το publication supabase_realtime υπάρχει αλλά είναι άδειο — γι' αυτό δεν
-- έφτανε ποτέ τίποτα ζωντανά. Το RLS ισχύει κανονικά στα postgres_changes,
-- οπότε ο κάθε συνδρομητής βλέπει μόνο τις συνομιλίες του.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'message_receipts'
  ) then
    alter publication supabase_realtime add table public.message_receipts;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conversations'
  ) then
    alter publication supabase_realtime add table public.conversations;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conversation_members'
  ) then
    alter publication supabase_realtime add table public.conversation_members;
  end if;
end
$$;

-- Το Realtime χρειάζεται πλήρη γραμμή στα updates για να ξέρει ποιος
-- δικαιούται να τη δει.
alter table public.messages replica identity full;
alter table public.message_receipts replica identity full;
alter table public.conversations replica identity full;
alter table public.conversation_members replica identity full;
