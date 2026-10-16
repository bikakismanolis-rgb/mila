-- 0012: Μηνύματα σε όποιον δεν έχει ακόμα κλειδί. Idempotent, χωρίς drop.
--
-- ΤΟ ΠΡΟΒΛΗΜΑ: με το 0010, αν ο παραλήπτης δεν είχε ανοίξει ακόμα τη νέα
-- έκδοση (άρα δεν είχε κλειδί), η βάση αρνιόταν το μήνυμα. Στην πράξη:
-- καλείς κάποιον, του γράφεις, και δεν φεύγει τίποτα.
--
-- Η ΛΥΣΗ: το μήνυμα στέλνεται κανονικά, κρυπτογραφημένο, με κλειδιά για όσες
-- συσκευές υπάρχουν, και ο αποστολέας το βλέπει «σε αναμονή». Μόλις ο
-- παραλήπτης αποκτήσει συσκευή, η ΣΥΣΚΕΥΗ ΠΟΥ ΤΟ ΕΣΤΕΙΛΕ, την επόμενη φορά που
-- θα είναι ανοιχτή, του τυλίγει το κλειδί του μηνύματος. Ο server και πάλι
-- δεν βλέπει ποτέ κανένα κλειδί που ανοίγει.
--
-- ΤΟ ΟΡΙΟ (για να μη γίνει κερκόπορτα): κλειδιά προστίθενται ΜΟΝΟ για
-- ανθρώπους που δεν είχαν πάρει ΚΑΝΕΝΑ κλειδί για εκείνο το μήνυμα, και μόνο
-- για μηνύματα των τελευταίων 30 ημερών. Κάποιος που είχε ήδη συσκευή δεν
-- παίρνει «ιστορικό» σε καινούργια· έτσι μια συσκευή που θα πρόσθετε
-- κακόβουλα ο server δεν κερδίζει παλιά μηνύματα.

-- ---------------------------------------------------------------------------
-- 1. Αποστολή: όχι πια άρνηση όταν ο παραλήπτης δεν έχει κλειδί
-- ---------------------------------------------------------------------------
-- Ίδιο με το 0010, χωρίς τον έλεγχο «Recipient has not set up encryption yet».
create or replace function public.send_message(
  conversation uuid,
  body text,
  client_id uuid,
  sender_device uuid,
  keys jsonb,
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
  convo conversations%rowtype;
  device user_devices%rowtype;
  envelope jsonb := public.safe_jsonb(body);
  msg messages%rowtype;
  file_path text;
  file_size bigint;
  bad text;
  sent_while_pending integer;
begin
  if me is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if not public.can_post_to_conversation(conversation) then
    raise exception 'You cannot send messages to this conversation' using errcode = '42501';
  end if;

  select * into msg from messages
  where sender_id = me and client_message_id = client_id;
  if found then
    return public.message_payload(msg);
  end if;

  select * into convo from conversations where id = conversation;

  if convo.request_status = 'pending' and convo.request_from = me then
    select count(*) into sent_while_pending
    from messages where conversation_id = conversation and sender_id = me;
    if sent_while_pending >= 3 then
      raise exception 'Wait until your request is accepted' using errcode = 'P0001';
    end if;
  end if;

  perform public.hit_rate_limit('message', 1);

  select * into device from user_devices
  where id = sender_device and user_id = me and revoked_at is null;
  if not found then
    raise exception 'Unknown sending device' using errcode = '42501';
  end if;
  update user_devices set last_seen_at = now() where id = device.id;

  if coalesce(jsonb_typeof(envelope->'iv'), '') <> 'string'
     or coalesce(jsonb_typeof(envelope->'ct'), '') <> 'string'
     or (envelope->>'iv') !~ '^[A-Za-z0-9_-]{16}$'
     or (envelope->>'ct') !~ '^[A-Za-z0-9_-]{22,}$' then
    raise exception 'Messages must be encrypted' using errcode = '22023';
  end if;

  if coalesce(jsonb_typeof(keys), '') <> 'array'
     or jsonb_array_length(keys) not between 1 and 1000
     or exists (
       select 1 from jsonb_array_elements(keys) k
       where coalesce(k->>'key', '') !~ '^[A-Za-z0-9_-]{40,200}$'
     ) then
    raise exception 'Encryption keys are missing' using errcode = '22023';
  end if;

  select k->>'device' into bad
  from jsonb_array_elements(keys) k
  where not exists (
    select 1
    from user_devices d
    join conversation_members cm
      on cm.user_id = d.user_id and cm.conversation_id = conversation
    where d.id::text = k->>'device' and public.device_is_active(d)
  )
  limit 1;
  if found then
    raise exception 'Encryption keys are out of date' using errcode = 'P0001';
  end if;

  -- Όποιο μέλος ΕΧΕΙ συσκευή πρέπει να πάρει κλειδί τώρα. Όποιο δεν έχει,
  -- θα το πάρει αργότερα (βήμα 2).
  if exists (
    select 1
    from conversation_members cm
    join profiles p on p.id = cm.user_id and p.deleted_at is null
    where cm.conversation_id = conversation
      and exists (
        select 1 from user_devices d
        where d.user_id = cm.user_id and public.device_is_active(d)
      )
      and not exists (
        select 1
        from jsonb_array_elements(keys) k
        join user_devices d on d.id::text = k->>'device'
        where d.user_id = cm.user_id
      )
  ) then
    raise exception 'Encryption keys are out of date' using errcode = 'P0001';
  end if;

  insert into messages (
    conversation_id, sender_id, ciphertext, encryption_version,
    client_message_id, reply_to, sender_device_id, sender_key
  )
  values (
    conversation, me, body, 1,
    client_id, reply_to_message, device.id, device.public_key
  )
  returning * into msg;

  insert into message_keys (message_id, device_id, recipient_id, wrapped)
  select msg.id, d.id, d.user_id, k->>'key'
  from jsonb_array_elements(keys) k
  join user_devices d on d.id::text = k->>'device'
  on conflict do nothing;

  if attachment is not null then
    file_path := attachment->>'path';
    file_size := (attachment->>'size')::bigint;
    if file_path is null or split_part(file_path, '/', 1) <> me::text then
      raise exception 'Attachment does not belong to you' using errcode = '42501';
    end if;
    insert into attachments (message_id, conversation_id, storage_path, encrypted_metadata, byte_size)
    values (msg.id, conversation, file_path, '{"e2ee":1}', file_size);
  end if;

  return public.message_payload(msg);
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Παράδοση κλειδιών αργότερα
-- ---------------------------------------------------------------------------
-- Ποια μηνύματα που έστειλε ΑΥΤΗ η συσκευή μου περιμένουν κλειδί, και για
-- ποιες συσκευές. Μόνο η συσκευή που έστειλε μπορεί να τυλίξει ξανά το κλειδί
-- (ο παραλήπτης το ανοίγει με το δημόσιο κλειδί εκείνης).
create or replace function public.my_undelivered_keys(p_device uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'messageId', x.message_id::text,
    'conversationId', x.conversation_id::text,
    'clientId', x.client_id::text,
    'envelope', x.envelope,
    'myKey', x.my_key,
    'deviceId', x.device_id::text,
    'publicKey', x.public_key
  )), '[]'::jsonb)
  from (
    select m.id as message_id, m.conversation_id, m.client_message_id as client_id,
           m.ciphertext as envelope, mine.wrapped as my_key,
           d.id as device_id, d.public_key
    from user_devices me
    join messages m
      on m.sender_device_id = me.id
     and m.sender_id = me.user_id
     and m.sender_key = me.public_key
    join message_keys mine on mine.message_id = m.id and mine.device_id = me.id
    join conversation_members cm on cm.conversation_id = m.conversation_id
    join profiles p on p.id = cm.user_id and p.deleted_at is null
    join user_devices d on d.user_id = cm.user_id
    where me.id = p_device
      and me.user_id = auth.uid()
      and me.revoked_at is null
      and m.encryption_version = 1
      and m.deleted_at is null
      and m.created_at > now() - interval '30 days'
      and cm.user_id <> m.sender_id
      and public.device_is_active(d)
      and not exists (
        select 1 from message_keys k
        join user_devices kd on kd.id = k.device_id
        where k.message_id = m.id and kd.user_id = cm.user_id
      )
    order by m.created_at desc
    limit 500
  ) x
$$;

-- Ο αποστολέας προσθέτει τα κλειδιά. Ίδιοι κανόνες με το βήμα 2, ελεγμένοι
-- ξανά εδώ: δικό μου μήνυμα, σταλμένο από τη συσκευή μου, συσκευή ενεργή
-- μέλους της συνομιλίας, που ΔΕΝ είχε κανένα κλειδί για το μήνυμα.
create or replace function public.add_message_keys(p_device uuid, keys jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  added integer;
begin
  if me is null or not public.is_active_user() then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if coalesce(jsonb_typeof(keys), '') <> 'array'
     or jsonb_array_length(keys) not between 1 and 1000
     or exists (
       select 1 from jsonb_array_elements(keys) k
       where coalesce(k->>'key', '') !~ '^[A-Za-z0-9_-]{40,200}$'
     ) then
    raise exception 'Encryption keys are missing' using errcode = '22023';
  end if;

  -- Ένα INSERT ... SELECT βλέπει τα message_keys όπως ήταν ΠΡΙΝ ξεκινήσει,
  -- οπότε όλες οι συσκευές του ίδιου ανθρώπου περνάνε μαζί τον έλεγχο
  -- «δεν είχε κανένα κλειδί».
  insert into message_keys (message_id, device_id, recipient_id, wrapped)
  select m.id, d.id, d.user_id, k->>'key'
  from jsonb_array_elements(keys) k
  join messages m on m.id::text = k->>'message'
  join user_devices sender on sender.id = p_device
  join user_devices d on d.id::text = k->>'device'
  join conversation_members cm
    on cm.conversation_id = m.conversation_id and cm.user_id = d.user_id
  where sender.user_id = me
    and sender.revoked_at is null
    and m.sender_id = me
    and m.sender_device_id = sender.id
    and m.sender_key = sender.public_key
    and m.encryption_version = 1
    and m.deleted_at is null
    and m.created_at > now() - interval '30 days'
    and d.user_id <> me
    and public.device_is_active(d)
    and not exists (
      select 1 from message_keys k2
      join user_devices kd on kd.id = k2.device_id
      where k2.message_id = m.id and kd.user_id = d.user_id
    )
  on conflict do nothing;
  get diagnostics added = row_count;
  return added;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. «Σε αναμονή» στο μήνυμα
-- ---------------------------------------------------------------------------
-- true όταν κάποιο μέλος (εκτός αποστολέα) δεν έχει ακόμα κανένα κλειδί για
-- το μήνυμα. Ο αποστολέας βλέπει ρολογάκι αντί για τικ.
create or replace function public.message_waiting(m public.messages)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select m.encryption_version > 0 and m.deleted_at is null and exists (
    select 1
    from conversation_members cm
    join profiles p on p.id = cm.user_id and p.deleted_at is null
    where cm.conversation_id = m.conversation_id
      and cm.user_id <> m.sender_id
      and not exists (
        select 1 from message_keys k
        join user_devices d on d.id = k.device_id
        where k.message_id = m.id and d.user_id = cm.user_id
      )
  )
$$;

-- Ίδιο με το 0010 + 'waiting'.
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
    'body', case when m.deleted_at is not null or m.encryption_version > 0 then '' else m.ciphertext end,
    'deleted', m.deleted_at is not null,
    'encrypted', m.encryption_version > 0,
    'e2ee', public.message_crypto(m),
    'waiting', public.message_waiting(m),
    'kind', 'text',
    'createdAt', m.created_at,
    'readBy', coalesce((
      select jsonb_agg(r.user_id::text)
      from message_receipts r
      join profiles rp on rp.id = r.user_id and rp.read_receipts
      where r.message_id = m.id and r.read_at is not null
    ), '[]'::jsonb),
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
        'body', case when r.deleted_at is not null or r.encryption_version > 0 then '' else left(r.ciphertext, 140) end,
        'deleted', r.deleted_at is not null,
        'encrypted', r.encryption_version > 0,
        'e2ee', public.message_crypto(r),
        'attachmentName', case when r.encryption_version = 0 then (
          select public.safe_jsonb(a.encrypted_metadata)->>'name'
          from attachments a where a.message_id = r.id limit 1
        ) end
      )
      from messages r
      where r.id = m.reply_to
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
-- 4. Realtime: ο παραλήπτης μαθαίνει αμέσως ότι ήρθε κλειδί
-- ---------------------------------------------------------------------------
-- Το RLS (message_keys_read_own) ισχύει και στο Realtime: ο καθένας ακούει
-- μόνο τα δικά του κλειδιά.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'message_keys'
  ) then
    alter publication supabase_realtime add table public.message_keys;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 5. Δικαιώματα
-- ---------------------------------------------------------------------------
revoke all on function public.message_waiting(public.messages) from public, anon, authenticated;
revoke all on function public.message_payload(public.messages) from public, anon, authenticated;
revoke all on function public.my_undelivered_keys(uuid) from public, anon;
revoke all on function public.add_message_keys(uuid, jsonb) from public, anon;
revoke all on function public.send_message(uuid, text, uuid, uuid, jsonb, uuid, jsonb) from public, anon;
grant execute on function public.my_undelivered_keys(uuid) to authenticated;
grant execute on function public.add_message_keys(uuid, jsonb) to authenticated;
grant execute on function public.send_message(uuid, text, uuid, uuid, jsonb, uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
