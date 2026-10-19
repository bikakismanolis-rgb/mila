-- 0013: Κλήσεις (φωνή και βίντεο), «τελευταία φορά εδώ», «παραδόθηκε»,
-- επεξεργασία μηνύματος, σίγαση / καρφίτσωμα / αρχειοθέτηση συνομιλίας.
-- Idempotent, χωρίς drop: τρέχει και από τον SQL editor και από εργαλεία.
-- Προϋποθέτει το 0012. Συμβατό με το προηγούμενο site: μόνο προσθέτει.
--
-- ΚΛΗΣΕΙΣ, ΜΕ ΑΠΛΑ ΛΟΓΙΑ
--
--   Η εικόνα και ο ήχος πάνε ΚΑΤΕΥΘΕΙΑΝ από συσκευή σε συσκευή (WebRTC), όχι
--   μέσα από τη βάση. Η βάση κρατάει μόνο ότι «η Α κάλεσε τον Β στις 14:02,
--   μίλησαν 3 λεπτά»: για να χτυπήσει το τηλέφωνο, για το ιστορικό και για
--   την ειδοποίηση όταν το app είναι κλειστό.
--
--   Η «χειραψία» (ποιος είναι πού, με ποια κλειδιά κρυπτογράφησης του ήχου)
--   πάει από το Realtime της Supabase, κλειδωμένη με τα κλειδιά των συσκευών
--   (δες apps/web/src/calls.ts). Ο server δεν βλέπει τα κλειδιά του ήχου, άρα
--   δεν μπορεί να ακούσει ούτε να παρεμβληθεί.
--
--   Ποιος καλεί ποιον: μόνο σε συνομιλία που έχει γίνει δεκτή. Ένας άγνωστος
--   με αίτημα σε εκκρεμότητα δεν μπορεί να σου χτυπήσει το τηλέφωνο.
--
-- ΤΙ ΚΡΑΤΑΕΙ Ο SERVER: ποιος κάλεσε ποιον, πότε, αν ήταν βίντεο, αν απαντήθηκε
-- και πόσο κράτησε. Όχι τι ειπώθηκε.

-- ---------------------------------------------------------------------------
-- 1. Πίνακες κλήσεων
-- ---------------------------------------------------------------------------
create table if not exists public.calls (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  caller_id uuid not null references public.profiles(id),
  video boolean not null default false,
  -- ringing: χτυπάει · active: κάποιος απάντησε · ended: τέλος
  status text not null default 'ringing' check (status in ('ringing', 'active', 'ended')),
  end_reason text check (end_reason in ('completed', 'missed', 'declined', 'busy', 'failed')),
  created_at timestamptz not null default now(),
  answered_at timestamptz,
  ended_at timestamptz
);
create index if not exists calls_conversation_idx on public.calls(conversation_id, created_at desc);
-- Το πολύ μία ανοιχτή κλήση ανά συνομιλία. Αν δύο καλέσουν ο ένας τον άλλον
-- την ίδια στιγμή, ο δεύτερος απλώς μπαίνει στην κλήση του πρώτου.
create unique index if not exists calls_one_open_per_conversation
  on public.calls(conversation_id) where status <> 'ended';

-- Ένας άνθρωπος ανά κλήση (όχι ανά συσκευή): αν σηκώσει από το κινητό, το
-- laptop του σταματάει να χτυπάει.
create table if not exists public.call_participants (
  call_id uuid not null references public.calls(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  state text not null check (state in ('ringing', 'joined', 'declined', 'missed', 'left')),
  -- Η συσκευή από την οποία μπήκε (για τα άλλα μέλη: σε ποια συσκευή μιλάνε).
  device_id uuid,
  joined_at timestamptz,
  left_at timestamptz,
  primary key (call_id, user_id)
);
create index if not exists call_participants_user_idx on public.call_participants(user_id, call_id);

-- «Είμαι ακόμα στην κλήση», κάθε λίγα δευτερόλεπτα. Χωριστός πίνακας και ΟΧΙ
-- στο Realtime: αλλιώς κάθε χτύπος θα έφτανε σε όλα τα μέλη της ομάδας. Αν
-- κάποιος κλείσει απότομα το app, οι χτύποι σταματούν και η κλήση κλείνει μόνη της.
create table if not exists public.call_heartbeats (
  call_id uuid not null references public.calls(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  seen_at timestamptz not null default now(),
  primary key (call_id, user_id)
);

alter table public.calls enable row level security;
alter table public.call_participants enable row level security;
alter table public.call_heartbeats enable row level security;

-- Διαβάζουν μόνο τα μέλη της συνομιλίας (και το Realtime, που σέβεται το RLS).
-- Γράφει μόνο η βάση, μέσα από τα RPC παρακάτω.
revoke all on public.calls from anon, authenticated;
revoke all on public.call_participants from anon, authenticated;
revoke all on public.call_heartbeats from anon, authenticated;
grant select on public.calls to authenticated;
grant select on public.call_participants to authenticated;

-- Μέσα σε do-block αντί για «drop policy if exists»: έτσι το migration δεν
-- περιέχει κανένα drop και ξανατρέχει χωρίς ζημιά.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'calls' and policyname = 'calls_read_members'
  ) then
    create policy calls_read_members on public.calls for select to authenticated
    using (public.is_conversation_member(conversation_id));
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'call_participants'
      and policyname = 'call_participants_read_members'
  ) then
    create policy call_participants_read_members on public.call_participants for select to authenticated
    using (exists (
      select 1 from public.calls c
      where c.id = call_id and public.is_conversation_member(c.conversation_id)
    ));
  end if;
end
$$;

-- Σίγαση, καρφίτσωμα, αρχειοθέτηση: ανά άνθρωπο, δες το βήμα 6.
-- Χωριστός πίνακας και όχι στήλες του conversation_members: εκείνες τις
-- βλέπουν (και ζωντανά, μέσω Realtime) τα άλλα μέλη. Το ότι σε έβαλα σε σίγαση
-- δεν σε αφορά.
create table if not exists public.conversation_prefs (
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  muted_until timestamptz,
  archived boolean not null default false,
  pinned_at timestamptz,
  primary key (user_id, conversation_id)
);
alter table public.conversation_prefs enable row level security;
revoke all on public.conversation_prefs from anon, authenticated;

-- Όρια: φτάνουν για κανονική χρήση, κόβουν όποιον θα έβαζε το app να χτυπάει
-- σε λούπα.
insert into public.rate_limit_rules (action, window_seconds, max_count, per_user) values
  ('call', 3600, 30, true),
  ('call', 86400, 200, true)
on conflict (action, window_seconds) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Πότε μια κλήση έχει «πεθάνει» μόνη της
-- ---------------------------------------------------------------------------
-- Χτυπάει πάνω από 75 δευτερόλεπτα χωρίς απάντηση, ή κανείς από όσους είναι
-- μέσα δεν έχει δώσει σημεία ζωής τα τελευταία 40 (έκλεισε απότομα το app,
-- έπεσε το δίκτυο).
create or replace function public.call_is_stale(c public.calls)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select c.status <> 'ended' and (
    (c.status = 'ringing' and c.created_at < now() - interval '75 seconds')
    or (
      c.created_at < now() - interval '40 seconds'
      and not exists (
        select 1
        from call_heartbeats h
        join call_participants p on p.call_id = h.call_id and p.user_id = h.user_id
        where h.call_id = c.id
          and p.state = 'joined'
          and h.seen_at > now() - interval '40 seconds'
      )
    )
  )
$$;

-- Κλείνει μια κλήση. Όσοι χτυπούσαν ακόμα = αναπάντητη για αυτούς. Όσοι ήταν
-- μέσα = βγήκαν. Αν κλείνει επειδή «πέθανε» (from_stale), η ώρα του τέλους
-- είναι το τελευταίο σημείο ζωής, όχι τώρα: αλλιώς μια κλήση που κόπηκε θα
-- έδειχνε μεγαλύτερη διάρκεια από όση κράτησε.
create or replace function public.finish_call(
  target uuid,
  reason text default null,
  from_stale boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c calls%rowtype;
  last_seen timestamptz;
  final_reason text;
begin
  select * into c from calls where id = target for update;
  if not found or c.status = 'ended' then
    return;
  end if;

  select max(h.seen_at) into last_seen
  from call_heartbeats h
  join call_participants p on p.call_id = h.call_id and p.user_id = h.user_id
  where h.call_id = c.id and p.state = 'joined';

  final_reason := coalesce(
    reason,
    case when c.answered_at is null then 'missed' else 'completed' end
  );
  -- Μια κλήση που απαντήθηκε δεν είναι ποτέ «αναπάντητη».
  if c.answered_at is not null and final_reason in ('missed', 'declined') then
    final_reason := 'completed';
  end if;

  update calls set
    status = 'ended',
    end_reason = final_reason,
    ended_at = case
      when from_stale and c.answered_at is not null and last_seen is not null
        then least(now(), greatest(c.answered_at, last_seen))
      else now()
    end
  where id = c.id;

  update call_participants set state = 'missed'
  where call_id = c.id and state = 'ringing';
  update call_participants set state = 'left', left_at = coalesce(left_at, now())
  where call_id = c.id and state = 'joined';
  delete from call_heartbeats where call_id = c.id;
end;
$$;

create or replace function public.close_stale_calls(conversation uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c calls%rowtype;
begin
  for c in select * from calls where conversation_id = conversation and status <> 'ended' loop
    if public.call_is_stale(c) then
      perform public.finish_call(c.id, null, true);
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Η κλήση όπως τη βλέπει ο browser
-- ---------------------------------------------------------------------------
-- Αν η κλήση έχει «πεθάνει» αλλά δεν την έχει κλείσει ακόμα κανείς, δείχνεται
-- ήδη ως τελειωμένη (οι αναγνώσεις δεν γράφουν στη βάση).
create or replace function public.call_payload(c public.calls)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with s as (select public.call_is_stale(c) as stale)
  select jsonb_build_object(
    'id', c.id::text,
    'conversationId', c.conversation_id::text,
    'callerId', c.caller_id::text,
    'video', c.video,
    'status', case when s.stale then 'ended' else c.status end,
    'endReason', case
      when s.stale then case when c.answered_at is null then 'missed' else 'completed' end
      else c.end_reason
    end,
    'createdAt', c.created_at,
    'answeredAt', c.answered_at,
    'endedAt', case
      when s.stale then coalesce((
        select greatest(c.answered_at, max(h.seen_at)) from call_heartbeats h where h.call_id = c.id
      ), c.created_at + interval '75 seconds')
      else c.ended_at
    end,
    'participants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'userId', p.user_id::text,
        'state', case
          when s.stale and p.state = 'ringing' then 'missed'
          when s.stale and p.state = 'joined' then 'left'
          else p.state
        end,
        'deviceId', p.device_id::text,
        'joinedAt', p.joined_at,
        'leftAt', p.left_at
      ) order by p.joined_at nulls last, p.user_id)
      from call_participants p
      where p.call_id = c.id
    ), '[]'::jsonb)
  )
  from s
$$;

-- ---------------------------------------------------------------------------
-- 4. RPC κλήσεων
-- ---------------------------------------------------------------------------
create or replace function public.call_device_ok(device uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from user_devices d
    where d.id = device and d.user_id = auth.uid() and d.revoked_at is null
  )
$$;

-- Ξεκινάει κλήση. Αν υπάρχει ήδη ανοιχτή στη συνομιλία (κάποιος άλλος μόλις
-- σε πήρε, ή τρέχει ομαδική), επιστρέφει εκείνη· ο browser μπαίνει σε αυτήν.
create or replace function public.start_call(p_conversation uuid, p_video boolean, p_device uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  convo conversations%rowtype;
  c calls%rowtype;
  other uuid;
begin
  if me is null or not public.is_active_user() then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if not public.can_post_to_conversation(p_conversation) then
    raise exception 'You cannot call this conversation' using errcode = '42501';
  end if;
  select * into convo from conversations where id = p_conversation;
  if convo.request_status <> 'accepted' then
    raise exception 'Calls are possible once the request is accepted' using errcode = 'P0001';
  end if;
  if not public.call_device_ok(p_device) then
    raise exception 'Unknown calling device' using errcode = '42501';
  end if;

  perform public.close_stale_calls(p_conversation);

  select * into c from calls where conversation_id = p_conversation and status <> 'ended';
  if found then
    return public.call_payload(c);
  end if;

  if convo.kind = 'direct' then
    select cm.user_id into other
    from conversation_members cm
    join profiles p on p.id = cm.user_id and p.deleted_at is null
    where cm.conversation_id = p_conversation and cm.user_id <> me;
    if other is null then
      raise exception 'You cannot call this conversation' using errcode = '42501';
    end if;
  end if;

  perform public.hit_rate_limit('call', 1);

  begin
    insert into calls (conversation_id, caller_id, video)
    values (p_conversation, me, coalesce(p_video, false))
    returning * into c;
  exception when unique_violation then
    -- Ο άλλος πρόλαβε, την ίδια ακριβώς στιγμή.
    select * into c from calls where conversation_id = p_conversation and status <> 'ended';
    return public.call_payload(c);
  end;

  insert into call_participants (call_id, user_id, state, device_id, joined_at)
  values (c.id, me, 'joined', p_device, now());
  insert into call_participants (call_id, user_id, state)
  select c.id, cm.user_id, 'ringing'
  from conversation_members cm
  join profiles p on p.id = cm.user_id and p.deleted_at is null
  where cm.conversation_id = p_conversation and cm.user_id <> me;
  insert into call_heartbeats (call_id, user_id) values (c.id, me)
  on conflict (call_id, user_id) do update set seen_at = now();

  -- «Μιλάει σε άλλη κλήση»: σε ατομική, αν ο άλλος είναι ήδη μέσα σε κλήση
  -- που ζει. Βλέπει αναπάντητη, εγώ βλέπω «σε άλλη κλήση».
  if other is not null and exists (
    select 1
    from call_participants p
    join calls oc on oc.id = p.call_id and oc.status <> 'ended' and oc.id <> c.id
    join call_heartbeats h on h.call_id = p.call_id and h.user_id = p.user_id
    where p.user_id = other and p.state = 'joined' and h.seen_at > now() - interval '40 seconds'
  ) then
    perform public.finish_call(c.id, 'busy');
  end if;

  select * into c from calls where id = c.id;
  return public.call_payload(c);
end;
$$;

-- Μπαίνω στην κλήση: σηκώνω, ή μπαίνω σε ομαδική που τρέχει ήδη.
create or replace function public.join_call(p_call uuid, p_device uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  c calls%rowtype;
  p call_participants%rowtype;
  inside integer;
begin
  if me is null or not public.is_active_user() then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  select * into c from calls where id = p_call for update;
  if not found or not public.is_conversation_member(c.conversation_id) then
    raise exception 'Call not found' using errcode = 'P0002';
  end if;
  if not public.can_post_to_conversation(c.conversation_id) then
    raise exception 'You cannot call this conversation' using errcode = '42501';
  end if;
  if not public.call_device_ok(p_device) then
    raise exception 'Unknown calling device' using errcode = '42501';
  end if;
  if public.call_is_stale(c) then
    perform public.finish_call(c.id, null, true);
    raise exception 'Call has ended' using errcode = 'P0001';
  end if;
  if c.status = 'ended' then
    raise exception 'Call has ended' using errcode = 'P0001';
  end if;

  select * into p from call_participants where call_id = c.id and user_id = me;
  if found and p.state = 'joined' and p.device_id is distinct from p_device and exists (
    select 1 from call_heartbeats h
    where h.call_id = c.id and h.user_id = me and h.seen_at > now() - interval '40 seconds'
  ) then
    raise exception 'Call answered on another device' using errcode = 'P0001';
  end if;

  select count(*) into inside
  from call_participants x
  join call_heartbeats h on h.call_id = x.call_id and h.user_id = x.user_id
  where x.call_id = c.id and x.state = 'joined' and x.user_id <> me
    and h.seen_at > now() - interval '40 seconds';
  -- Σε ομαδική κάθε συσκευή συνδέεται με κάθε άλλη· πάνω από 8 το κινητό
  -- δεν τα βγάζει πέρα.
  if inside >= 7 then
    raise exception 'Call is full' using errcode = 'P0001';
  end if;

  insert into call_participants (call_id, user_id, state, device_id, joined_at)
  values (c.id, me, 'joined', p_device, now())
  on conflict (call_id, user_id) do update set
    state = 'joined',
    device_id = excluded.device_id,
    joined_at = coalesce(call_participants.joined_at, excluded.joined_at),
    left_at = null;
  insert into call_heartbeats (call_id, user_id) values (c.id, me)
  on conflict (call_id, user_id) do update set seen_at = now();

  if c.status = 'ringing' and me <> c.caller_id then
    update calls set status = 'active', answered_at = now() where id = c.id;
  end if;

  select * into c from calls where id = c.id;
  return public.call_payload(c);
end;
$$;

create or replace function public.decline_call(p_call uuid)
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

  update call_participants set state = 'declined'
  where call_id = c.id and user_id = me and state = 'ringing';

  if found and c.status = 'ringing' then
    select cv.kind into convo_kind from conversations cv where cv.id = c.conversation_id;
    -- Σε ατομική η απόρριψη κλείνει την κλήση. Σε ομάδα, μόνο αν δεν έμεινε
    -- κανείς άλλος να απαντήσει.
    if convo_kind = 'direct' or not exists (
      select 1 from call_participants x
      where x.call_id = c.id and x.user_id <> c.caller_id and x.state in ('ringing', 'joined')
    ) then
      perform public.finish_call(c.id, 'declined');
    end if;
  end if;

  select * into c from calls where id = c.id;
  return public.call_payload(c);
end;
$$;

-- Κλείνω. Σε ατομική τελειώνει για όλους. Σε ομάδα, όταν μείνει ένας και
-- δεν χτυπάει πια σε κανέναν άλλον. Αν ακόμα χτυπούσε σε μένα, είναι απόρριψη.
create or replace function public.leave_call(p_call uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  c calls%rowtype;
  convo_kind conversation_kind;
  remaining integer;
  still_ringing boolean;
begin
  if me is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  select * into c from calls where id = p_call for update;
  if not found or not public.is_conversation_member(c.conversation_id) then
    raise exception 'Call not found' using errcode = 'P0002';
  end if;
  if c.status = 'ended' then
    return public.call_payload(c);
  end if;
  if exists (
    select 1 from call_participants
    where call_id = c.id and user_id = me and state = 'ringing'
  ) then
    return public.decline_call(c.id);
  end if;

  update call_participants set state = 'left', left_at = now()
  where call_id = c.id and user_id = me and state = 'joined';
  delete from call_heartbeats where call_id = c.id and user_id = me;

  select cv.kind into convo_kind from conversations cv where cv.id = c.conversation_id;
  select count(*) into remaining
  from call_participants x
  where x.call_id = c.id and x.state = 'joined';
  select exists (
    select 1 from call_participants x
    where x.call_id = c.id and x.state = 'ringing'
  ) and c.created_at > now() - interval '75 seconds' into still_ringing;

  if convo_kind = 'direct'
     or remaining = 0
     or (remaining <= 1 and not still_ringing)
     or (c.status = 'ringing' and me = c.caller_id) then
    perform public.finish_call(c.id);
  end if;

  select * into c from calls where id = c.id;
  return public.call_payload(c);
end;
$$;

-- Σημείο ζωής, κάθε ~10 δευτερόλεπτα όσο είμαι μέσα. Γυρίζει την κλήση, ώστε
-- ο browser να καταλάβει ότι έκλεισε ακόμα κι αν χάθηκε το γεγονός του Realtime.
create or replace function public.call_heartbeat(p_call uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  c calls%rowtype;
begin
  select * into c from calls where id = p_call;
  if not found or me is null or not public.is_conversation_member(c.conversation_id) then
    raise exception 'Call not found' using errcode = 'P0002';
  end if;
  if c.status <> 'ended' and exists (
    select 1 from call_participants p where p.call_id = c.id and p.user_id = me and p.state = 'joined'
  ) then
    insert into call_heartbeats (call_id, user_id) values (c.id, me)
    on conflict (call_id, user_id) do update set seen_at = now();
  end if;
  return public.call_payload(c);
end;
$$;

create or replace function public.get_call(p_call uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public.call_payload(c)
  from calls c
  where c.id = p_call and public.is_conversation_member(c.conversation_id)
$$;

-- Ιστορικό κλήσεων: όλες (καρτέλα «Κλήσεις»), ή μιας συνομιλίας από κάποια
-- στιγμή και μετά (για να μπουν ανάμεσα στα μηνύματα). Όποιος μπήκε σε ομάδα
-- αργότερα δεν βλέπει τις κλήσεις από πριν.
create or replace function public.list_calls(
  p_conversation uuid default null,
  p_since timestamptz default null,
  p_limit integer default 100
)
returns setof jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public.call_payload(c)
  from calls c
  join conversation_members cm
    on cm.conversation_id = c.conversation_id and cm.user_id = auth.uid()
  join conversations cv on cv.id = c.conversation_id and cv.request_status <> 'rejected'
  where (p_conversation is null or c.conversation_id = p_conversation)
    and (p_since is null or c.created_at >= p_since)
    and c.created_at >= cm.joined_at - interval '1 minute'
  order by c.created_at desc
  limit least(greatest(coalesce(p_limit, 100), 1), 300)
$$;

-- ---------------------------------------------------------------------------
-- 5. Ειδοποίηση κλήσης (push) όταν το app είναι κλειστό
-- ---------------------------------------------------------------------------
-- Ίδιος δρόμος με τα μηνύματα (0009): trigger -> pg_net -> Edge Function «push».
-- 'ring' όταν ξεκινά, 'missed' όταν κλείνει χωρίς να την πάρει κανείς (η νέα
-- ειδοποίηση αντικαθιστά την «Εισερχόμενη κλήση» στην οθόνη).
create or replace function public.push_call_targets(p_call uuid, p_event text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'payload', jsonb_build_object(
      'type', 'call',
      'event', p_event,
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
        and p.user_id <> c.caller_id
        and p.state = case when p_event = 'ring' then 'ringing' else 'missed' end
        and not exists (
          select 1 from blocks b where b.blocker_id = p.user_id and b.blocked_id = c.caller_id
        )
        -- Σε ομάδα που έχω σε σίγαση, οι ομαδικές κλήσεις δεν χτυπάνε.
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

-- ---------------------------------------------------------------------------
-- 6. Σίγαση, καρφίτσωμα, αρχειοθέτηση (μόνο για μένα)
-- ---------------------------------------------------------------------------
-- prefs: {"mutedUntil": "<ώρα>" | null, "archived": bool, "pinned": bool}.
-- Ό,τι λείπει από το JSON μένει όπως ήταν.
create or replace function public.set_conversation_prefs(conversation uuid, prefs jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  cur conversation_prefs%rowtype;
  pins integer;
begin
  if me is null or not public.is_conversation_member(conversation) then
    raise exception 'Not a member of this conversation' using errcode = '42501';
  end if;

  insert into conversation_prefs (user_id, conversation_id)
  values (me, conversation)
  on conflict (user_id, conversation_id) do nothing;
  select * into cur from conversation_prefs where user_id = me and conversation_id = conversation;

  if prefs ? 'mutedUntil' then
    cur.muted_until := case
      when jsonb_typeof(prefs->'mutedUntil') = 'string' then (prefs->>'mutedUntil')::timestamptz
    end;
  end if;
  if prefs ? 'archived' then
    cur.archived := coalesce((prefs->>'archived')::boolean, false);
    -- Στο αρχείο δεν μένει καρφιτσωμένη (όπως στο WhatsApp).
    if cur.archived then cur.pinned_at := null; end if;
  end if;
  if prefs ? 'pinned' then
    if coalesce((prefs->>'pinned')::boolean, false) then
      if cur.pinned_at is null then
        select count(*) into pins from conversation_prefs
        where user_id = me and pinned_at is not null and conversation_id <> conversation;
        if pins >= 3 then
          raise exception 'You can pin up to 3 chats' using errcode = 'P0001';
        end if;
        cur.pinned_at := now();
        cur.archived := false;
      end if;
    else
      cur.pinned_at := null;
    end if;
  end if;

  update conversation_prefs set
    muted_until = cur.muted_until,
    archived = cur.archived,
    pinned_at = cur.pinned_at
  where user_id = me and conversation_id = conversation;

  return jsonb_build_object(
    'mutedUntil', cur.muted_until,
    'archived', cur.archived,
    'pinnedAt', cur.pinned_at
  );
end;
$$;

-- Οι ειδοποιήσεις μηνυμάτων παραλείπουν όσους έχουν τη συνομιλία σε σίγαση.
-- Ίδιο με το 0010, με αυτή την προσθήκη.
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
      'body', '',
      'senderName', split_part(sender.display_name, ' ', 1),
      'isGroup', c.kind = 'group',
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
        and not exists (
          select 1 from conversation_prefs cp
          where cp.user_id = cm.user_id and cp.conversation_id = m.conversation_id
            and cp.muted_until > now()
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
  elsif new.status = 'ended' and new.answered_at is null
        and new.end_reason in ('missed', 'busy')
        and (tg_op = 'INSERT' or old.status <> 'ended') then
    event := 'missed';
  else
    return null;
  end if;

  -- Τρέχει στο τέλος της συναλλαγής (deferred), οπότε οι συμμετέχοντες έχουν
  -- ήδη μπει. Κανείς χωρίς συνδρομή = καμία κλήση στη function.
  if not exists (
    select 1
    from call_participants p
    join push_subscriptions s on s.user_id = p.user_id
    where p.call_id = new.id and p.user_id <> new.caller_id
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

-- DEFERRABLE INITIALLY DEFERRED: τρέχει στο τέλος της συναλλαγής, αφού έχουν
-- μπει και οι συμμετέχοντες (το start_call τους βάζει μετά την κλήση).
do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'calls_notify' and tgrelid = 'public.calls'::regclass
  ) then
    create constraint trigger calls_notify
    after insert or update of status on public.calls
    deferrable initially deferred
    for each row execute function public.notify_call_change();
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 7. «Σε σύνδεση» και «τελευταία φορά εδώ»
-- ---------------------------------------------------------------------------
-- Ο browser λέει «είμαι εδώ» κάθε ~30 δευτερόλεπτα όσο το app είναι μπροστά,
-- και «έφυγα» όταν πάει στο παρασκήνιο. Το βλέπουν μόνο όσοι μοιράζονται μαζί
-- σου αποδεκτή συνομιλία, και μόνο αν το δείχνεις κι εσύ (όπως στο WhatsApp:
-- αν το κρύψεις, δεν βλέπεις ούτε των άλλων).
alter table public.profiles add column if not exists last_seen_at timestamptz;
alter table public.profiles add column if not exists online_until timestamptz;

create or replace function public.touch_presence(online boolean default true)
returns void
language sql
security definer
set search_path = public
as $$
  update profiles set
    last_seen_at = now(),
    online_until = case when online then now() + interval '75 seconds' else now() end
  where id = auth.uid() and deleted_at is null
$$;

create or replace function public.presence_payload(p public.profiles)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p.id <> auth.uid()
     and p.deleted_at is null
     and p.show_online
     and exists (select 1 from profiles me where me.id = auth.uid() and me.show_online)
     and exists (
       select 1
       from conversation_members mine
       join conversation_members theirs on theirs.conversation_id = mine.conversation_id
       join conversations c on c.id = mine.conversation_id
       where mine.user_id = auth.uid() and theirs.user_id = p.id and c.request_status = 'accepted'
     )
    then jsonb_build_object(
      'online', coalesce(p.online_until > now(), false),
      'lastSeen', p.last_seen_at
    )
  end
$$;

create or replace function public.get_presence(target uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public.presence_payload(p) from profiles p where p.id = target
$$;

-- Ίδιο με το 0010 + 'presence'.
create or replace function public.profile_payload(p public.profiles)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', p.id::text,
    'email', case
      when p.id = auth.uid() then p.email
      when p.deleted_at is not null then null
      when p.show_email <> 'nobody' and public.is_contact(p.id) then p.email
      else null
    end,
    'name', p.display_name,
    'username', coalesce(
      p.username,
      case
        when p.deleted_at is not null then null
        when p.id = auth.uid()
          or (p.show_email <> 'nobody' and public.is_contact(p.id))
        then coalesce(
          nullif(regexp_replace(lower(split_part(p.email, '@', 1)), '[^a-z0-9_.]', '', 'g'), ''),
          'user'
        )
      end
    ),
    'bio', case when p.deleted_at is null and public.can_see_profile(p.id) then p.bio else '' end,
    'avatarPath', case
      when p.deleted_at is null and public.can_see_profile(p.id) then p.avatar_path
    end,
    'deleted', p.deleted_at is not null,
    'presence', public.presence_payload(p),
    'privacy', case when p.id = auth.uid() then jsonb_build_object(
      'discover', p.discover_by_email,
      'showEmail', p.show_email,
      'receipts', p.read_receipts,
      'online', p.show_online
    ) end
  )
$$;

-- ---------------------------------------------------------------------------
-- 8. «Παραδόθηκε» (δύο γκρι τικ)
-- ---------------------------------------------------------------------------
-- Μόλις ανοίξει το app του παραλήπτη, τα μηνύματα που του ήρθαν σημειώνονται
-- ως παραδομένα. Το σήμα προς τον αποστολέα είναι το last_delivered_at του
-- μέλους (όπως το last_read_at για το «διαβάστηκε»).
alter table public.conversation_members add column if not exists last_delivered_at timestamptz;

create or replace function public.mark_delivered()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  touched uuid[];
begin
  if me is null then
    return 0;
  end if;

  with fresh as (
    insert into message_receipts (message_id, user_id, delivered_at)
    select m.id, me, now()
    from conversation_members cm
    join conversations c on c.id = cm.conversation_id and c.request_status <> 'rejected'
    join messages m on m.conversation_id = cm.conversation_id
    where cm.user_id = me
      and m.sender_id <> me
      and m.deleted_at is null
      and m.created_at > now() - interval '14 days'
      and not exists (
        select 1 from message_receipts r where r.message_id = m.id and r.user_id = me
      )
    on conflict (message_id, user_id) do nothing
    returning message_id
  )
  select coalesce(array_agg(distinct m.conversation_id), '{}') into touched
  from fresh join messages m on m.id = fresh.message_id;

  if coalesce(array_length(touched, 1), 0) > 0 then
    update conversation_members set last_delivered_at = now()
    where user_id = me and conversation_id = any(touched);
  end if;
  return coalesce(array_length(touched, 1), 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Επεξεργασία μηνύματος
-- ---------------------------------------------------------------------------
-- Μέσα σε 15 λεπτά, όπως στο WhatsApp. Ο browser κρυπτογραφεί ξανά το νέο
-- κείμενο για όλες τις συσκευές· εδώ αλλάζουν ciphertext και κλειδιά μαζί, με
-- τους ίδιους ελέγχους με την αποστολή.
create or replace function public.edit_message(
  message uuid,
  body text,
  sender_device uuid,
  keys jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  msg messages%rowtype;
  device user_devices%rowtype;
  envelope jsonb := public.safe_jsonb(body);
  bad text;
begin
  if me is null or not public.is_active_user() then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select * into msg from messages where id = message for update;
  if not found or msg.sender_id <> me then
    raise exception 'Only the sender can edit a message' using errcode = '42501';
  end if;
  if msg.deleted_at is not null or msg.encryption_version <> 1 then
    raise exception 'This message cannot be edited' using errcode = 'P0001';
  end if;
  if msg.created_at < now() - interval '15 minutes' then
    raise exception 'Messages can only be edited for 15 minutes' using errcode = 'P0001';
  end if;
  if not public.can_post_to_conversation(msg.conversation_id) then
    raise exception 'You cannot send messages to this conversation' using errcode = '42501';
  end if;

  perform public.hit_rate_limit('message', 1);

  select * into device from user_devices
  where id = sender_device and user_id = me and revoked_at is null;
  if not found then
    raise exception 'Unknown sending device' using errcode = '42501';
  end if;

  if char_length(coalesce(body, '')) > 65536 then
    raise exception 'Message is too long' using errcode = '22001';
  end if;
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
      on cm.user_id = d.user_id and cm.conversation_id = msg.conversation_id
    where d.id::text = k->>'device' and public.device_is_active(d)
  )
  limit 1;
  if found then
    raise exception 'Encryption keys are out of date' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from conversation_members cm
    join profiles p on p.id = cm.user_id and p.deleted_at is null
    where cm.conversation_id = msg.conversation_id
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

  update messages set
    ciphertext = body,
    edited_at = now(),
    sender_device_id = device.id,
    sender_key = device.public_key
  where id = msg.id
  returning * into msg;

  delete from message_keys where message_id = msg.id;
  insert into message_keys (message_id, device_id, recipient_id, wrapped)
  select msg.id, d.id, d.user_id, k->>'key'
  from jsonb_array_elements(keys) k
  join user_devices d on d.id::text = k->>'device'
  on conflict do nothing;

  return public.message_payload(msg);
end;
$$;

-- Ίδιο με το 0012, με: 'editedAt', και 'deliveredTo' ανεξάρτητα από τη
-- ρύθμιση «διαβάστηκε» (όπως στο WhatsApp: τα δύο γκρι τικ φαίνονται πάντα,
-- τα μπλε μόνο αν το επιτρέπει ο άλλος).
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
    'editedAt', case when m.deleted_at is null then m.edited_at end,
    'readBy', coalesce((
      select jsonb_agg(r.user_id::text)
      from message_receipts r
      join profiles rp on rp.id = r.user_id and rp.read_receipts
      where r.message_id = m.id and r.read_at is not null
    ), '[]'::jsonb),
    'deliveredTo', coalesce((
      select jsonb_agg(r.user_id::text)
      from message_receipts r
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
-- 10. Λίστα συνομιλιών: + σίγαση, καρφίτσωμα, αρχείο, τελευταία κλήση
-- ---------------------------------------------------------------------------
-- Ίδιο με το 0008, με αυτές τις προσθήκες. Η σειρά λαμβάνει υπόψη και τις
-- κλήσεις: μια αναπάντητη ανεβάζει τη συνομιλία στην κορυφή.
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
    'mutedUntil', case when cp.muted_until > now() then cp.muted_until end,
    'archived', coalesce(cp.archived, false),
    'pinnedAt', cp.pinned_at,
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
    'lastCall', (
      select public.call_payload(k)
      from calls k
      where k.conversation_id = c.id
        and k.created_at >= cm.joined_at - interval '1 minute'
      order by k.created_at desc
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
  left join conversation_prefs cp
    on cp.conversation_id = c.id and cp.user_id = auth.uid()
  where auth.uid() is not null
    and c.request_status <> 'rejected'
  order by greatest(
    coalesce((select max(m.created_at) from messages m where m.conversation_id = c.id), c.created_at),
    coalesce((select max(k.created_at) from calls k where k.conversation_id = c.id), c.created_at)
  ) desc
$$;

-- ---------------------------------------------------------------------------
-- 11. Realtime
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'calls'
  ) then
    alter publication supabase_realtime add table public.calls;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'call_participants'
  ) then
    alter publication supabase_realtime add table public.call_participants;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 12. Δικαιώματα
-- ---------------------------------------------------------------------------
-- Όσες παίρνουν ολόκληρη γραμμή, ή κάνουν δουλειά «από μέσα», μόνο από άλλες
-- functions (όπως το message_payload, δες 0008).
revoke all on function public.call_is_stale(public.calls) from public, anon, authenticated;
revoke all on function public.finish_call(uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.close_stale_calls(uuid) from public, anon, authenticated;
revoke all on function public.call_payload(public.calls) from public, anon, authenticated;
revoke all on function public.call_device_ok(uuid) from public, anon, authenticated;
revoke all on function public.presence_payload(public.profiles) from public, anon, authenticated;
revoke all on function public.profile_payload(public.profiles) from public, anon, authenticated;
revoke all on function public.message_payload(public.messages) from public, anon, authenticated;
revoke all on function public.notify_call_change() from public, anon, authenticated;
revoke all on function public.push_call_targets(uuid, text) from public, anon, authenticated;
revoke all on function public.push_targets(uuid) from public, anon, authenticated;
grant execute on function public.push_call_targets(uuid, text) to service_role;
grant execute on function public.push_targets(uuid) to service_role;

revoke all on function public.start_call(uuid, boolean, uuid) from public, anon;
revoke all on function public.join_call(uuid, uuid) from public, anon;
revoke all on function public.decline_call(uuid) from public, anon;
revoke all on function public.leave_call(uuid) from public, anon;
revoke all on function public.call_heartbeat(uuid) from public, anon;
revoke all on function public.get_call(uuid) from public, anon;
revoke all on function public.list_calls(uuid, timestamptz, integer) from public, anon;
revoke all on function public.set_conversation_prefs(uuid, jsonb) from public, anon;
revoke all on function public.touch_presence(boolean) from public, anon;
revoke all on function public.get_presence(uuid) from public, anon;
revoke all on function public.mark_delivered() from public, anon;
revoke all on function public.edit_message(uuid, text, uuid, jsonb) from public, anon;
revoke all on function public.list_conversations() from public, anon;

grant execute on function public.start_call(uuid, boolean, uuid) to authenticated;
grant execute on function public.join_call(uuid, uuid) to authenticated;
grant execute on function public.decline_call(uuid) to authenticated;
grant execute on function public.leave_call(uuid) to authenticated;
grant execute on function public.call_heartbeat(uuid) to authenticated;
grant execute on function public.get_call(uuid) to authenticated;
grant execute on function public.list_calls(uuid, timestamptz, integer) to authenticated;
grant execute on function public.set_conversation_prefs(uuid, jsonb) to authenticated;
grant execute on function public.touch_presence(boolean) to authenticated;
grant execute on function public.get_presence(uuid) to authenticated;
grant execute on function public.mark_delivered() to authenticated;
grant execute on function public.edit_message(uuid, text, uuid, jsonb) to authenticated;
grant execute on function public.list_conversations() to authenticated;

notify pgrst, 'reload schema';
