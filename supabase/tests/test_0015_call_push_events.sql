-- Tests για το 0015: ποιες ειδοποιήσεις push μπαίνουν στην ουρά για μια κλήση
-- («σε καλεί», «τέλος», «αναπάντητη»), σε ποιον πάνε, και η κλήση που δεν
-- συνδέθηκε ποτέ. Δικοί του χρήστες, ώστε να μην εξαρτάται από τα υπόλοιπα
-- tests. Κάθε ενέργεια τρέχει ΩΣ ο χρήστης, όπως από τον browser.

\set ON_ERROR_STOP 1
set client_min_messages = warning;

create schema if not exists test;
grant usage on schema test to authenticated, service_role;

create or replace function test.ok(condition boolean, label text) returns void
language plpgsql as $$
begin
  if condition is not true then
    raise exception 'TEST FAILED: %', label;
  end if;
end $$;

create or replace function test.fails(statement text, pattern text, label text) returns void
language plpgsql as $$
begin
  begin
    execute statement;
  exception when others then
    if sqlerrm !~* pattern then
      raise exception 'TEST FAILED: % (expected /%/, got: %)', label, pattern, sqlerrm;
    end if;
    return;
  end;
  raise exception 'TEST FAILED: % (no error, expected /%/)', label, pattern;
end $$;

-- Πόσα αιτήματα προς τη function «push» μπήκαν στην ουρά για μια κλήση.
create or replace function test.pushes(call text, kind text, who text default null) returns bigint
language sql as $$
  select count(*) from net.calls
  where body->>'call_id' = call
    and case kind
      when 'ended' then body->>'action' = 'call-ended'
      else body->>'action' = 'call' and body->>'event' = kind
    end
    and (who is null or body->>'user_id' = who)
$$;

grant execute on all functions in schema test to authenticated, service_role;

delete from rate_limit_events;

\set eve  '''55555555-0000-4000-8000-000000000005'''
\set fay  '''66666666-0000-4000-8000-000000000006'''
\set gus  '''77777777-0000-4000-8000-000000000007'''
\set hal  '''88888888-0000-4000-8000-000000000008'''

insert into auth.users (id, email, raw_user_meta_data) values
  (:eve, 'eve@example.org', '{"display_name":"Eve Evans"}'),
  (:fay, 'fay@example.org', '{"display_name":"Fay Fisher"}'),
  (:gus, 'gus@example.org', '{"display_name":"Gus Green"}'),
  (:hal, 'hal@example.org', '{"display_name":"Hal Hughes"}');

\set k_eve '''eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee1'''
\set k_fay '''ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff1'''
\set k_fay2 '''ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff2'''
\set k_gus '''gggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggg1'''
\set k_hal '''hhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhh1'''

select set_config('request.jwt.claim.sub', :eve, false);
set role authenticated;
select register_device(:k_eve, 'Phone');
reset role;
select set_config('request.jwt.claim.sub', :fay, false);
set role authenticated;
select register_device(:k_fay, 'Phone');
select register_device(:k_fay2, 'Laptop');
reset role;
select set_config('request.jwt.claim.sub', :gus, false);
set role authenticated;
select register_device(:k_gus, 'Phone');
reset role;
select set_config('request.jwt.claim.sub', :hal, false);
set role authenticated;
select register_device(:k_hal, 'Phone');
reset role;

select id as d_eve from user_devices where public_key = :k_eve \gset
select id as d_fay from user_devices where public_key = :k_fay \gset
select id as d_fay2 from user_devices where public_key = :k_fay2 \gset
select id as d_gus from user_devices where public_key = :k_gus \gset
select id as d_hal from user_devices where public_key = :k_hal \gset

-- Συνομιλίες: Eve–Fay, Eve–Hal, Eve–Gus, Gus–Fay, και η ομάδα Eve, Fay, Gus.
select set_config('request.jwt.claim.sub', :eve, false);
set role authenticated;
select start_direct_conversation(:fay) as ef \gset
select start_direct_conversation(:hal) as eh \gset
select start_direct_conversation(:gus) as eg \gset
reset role;
select set_config('request.jwt.claim.sub', :gus, false);
set role authenticated;
select start_direct_conversation(:fay) as gf \gset
select respond_to_request(:'eg', true);
reset role;
select set_config('request.jwt.claim.sub', :fay, false);
set role authenticated;
select respond_to_request(:'ef', true);
select respond_to_request(:'gf', true);
reset role;
select set_config('request.jwt.claim.sub', :hal, false);
set role authenticated;
select respond_to_request(:'eh', true);
reset role;
select set_config('request.jwt.claim.sub', :eve, false);
set role authenticated;
select create_group('Crew', array[:fay, :gus]::uuid[]) as grp \gset
reset role;

-- Η Fay (κινητό + laptop) και ο Gus δέχονται ειδοποιήσεις. Η Eve και ο Hal όχι.
insert into push_subscriptions (user_id, endpoint, p256dh, auth) values
  (:fay, 'https://fcm.googleapis.com/fcm/send/fay-phone-0000000000000000', repeat('p', 87), repeat('a', 22)),
  (:fay, 'https://fcm.googleapis.com/fcm/send/fay-laptop-000000000000000', repeat('q', 87), repeat('b', 22)),
  (:gus, 'https://fcm.googleapis.com/fcm/send/gus-phone-0000000000000000', repeat('r', 87), repeat('c', 22));

-- ---------------------------------------------------------------------------
-- 1. Σήκωσε από μία συσκευή: «τέλος» για όλες τις συσκευές της
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', :eve, false);
set role authenticated;
select start_call(:'ef', false, :'d_eve')->>'id' as c1 \gset
reset role;
select test.ok(test.pushes(:'c1', 'ring') = 1, 'ring queued');
select test.ok(test.pushes(:'c1', 'ended') = 0, 'no end while ringing');

select set_config('request.jwt.claim.sub', :fay, false);
set role authenticated;
select join_call(:'c1', :'d_fay2');
reset role;
select test.ok(test.pushes(:'c1', 'ended', :fay) = 1, 'answering queues an end push for the callee');
select test.ok(test.pushes(:'c1', 'ended') = 1, 'only for the callee');
select test.ok((select jsonb_array_length(push_call_ended_targets(:'c1', :fay)->'subscriptions')) = 2,
  'the end push reaches every device of the callee');
select test.ok((select jsonb_array_length(push_call_ended_targets(:'c1', :eve)->'subscriptions')) = 0,
  'never to the caller');
select test.ok((select push_call_ended_targets(:'c1', :fay)->'payload'->>'event') = 'ended', 'payload says ended');
-- Χωρίς περιεχόμενο, όπως το «σε καλεί»: μόνο ποια κλήση και ποιος.
select test.ok(
  (select array_agg(k order by k) from jsonb_object_keys(push_call_ended_targets(:'c1', :fay)->'payload') k)
    = array['callId', 'callerName', 'conversationId', 'event', 'isGroup', 'title', 'type', 'video'],
  'end payload carries no content');
select test.ok(
  (select array_agg(k order by k) from jsonb_object_keys(push_call_ended_targets(:'c1', :fay)->'payload') k)
    = (select array_agg(k order by k) from jsonb_object_keys(push_call_targets(:'c1', 'ring')->'payload') k),
  'end payload has the same fields as the ring payload');

select set_config('request.jwt.claim.sub', :eve, false);
set role authenticated;
select leave_call(:'c1');
reset role;
select test.ok(test.pushes(:'c1', 'missed') = 0, 'answered call: no missed push');
select test.ok(test.pushes(:'c1', 'ended') = 1, 'hanging up after answering sends nothing more');

-- ---------------------------------------------------------------------------
-- 2. Απέρριψε: «τέλος», όχι «αναπάντητη»
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', :eve, false);
set role authenticated;
select start_call(:'ef', true, :'d_eve')->>'id' as c2 \gset
reset role;
select set_config('request.jwt.claim.sub', :fay, false);
set role authenticated;
select decline_call(:'c2');
reset role;
select test.ok(test.pushes(:'c2', 'ended', :fay) = 1, 'declining queues an end push');
select test.ok(test.pushes(:'c2', 'missed') = 0, 'declined call: no missed push');
select test.ok((select jsonb_array_length(push_call_ended_targets(:'c2', :fay)->'subscriptions')) = 2,
  'declined on one device, every device stops');

-- ---------------------------------------------------------------------------
-- 3. Ο καλών το έκλεισε πριν σηκώσει: «αναπάντητη», όχι «τέλος»
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', :eve, false);
set role authenticated;
select start_call(:'ef', false, :'d_eve')->>'id' as c3 \gset
select leave_call(:'c3');
reset role;
select test.ok(test.pushes(:'c3', 'missed') = 1, 'cancelled call: missed push');
select test.ok(test.pushes(:'c3', 'ended') = 0, 'cancelled call: no end push');
select test.ok((select jsonb_array_length(push_call_targets(:'c3', 'missed')->'subscriptions')) = 2,
  'missed goes to every device of the callee');

-- ---------------------------------------------------------------------------
-- 4. Χωρίς συνδρομή: τίποτα στην ουρά
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', :eve, false);
set role authenticated;
select start_call(:'eh', false, :'d_eve')->>'id' as c4 \gset
reset role;
select set_config('request.jwt.claim.sub', :hal, false);
set role authenticated;
select join_call(:'c4', :'d_hal');
select leave_call(:'c4');
reset role;
select test.ok((select count(*) from net.calls where body->>'call_id' = :'c4') = 0,
  'no subscription, no push requests');

-- ---------------------------------------------------------------------------
-- 5. «Μιλάει σε άλλη κλήση»: μόνο «αναπάντητη»
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', :eve, false);
set role authenticated;
select start_call(:'ef', false, :'d_eve')->>'id' as c5 \gset
reset role;
select set_config('request.jwt.claim.sub', :fay, false);
set role authenticated;
select join_call(:'c5', :'d_fay');
reset role;
select set_config('request.jwt.claim.sub', :gus, false);
set role authenticated;
select start_call(:'gf', false, :'d_gus') as busy \gset
reset role;
select (:'busy'::jsonb)->>'id' as c6 \gset
select test.ok((:'busy'::jsonb)->>'endReason' = 'busy', 'busy call');
select test.ok(test.pushes(:'c6', 'ring') = 0, 'busy: no ring push');
select test.ok(test.pushes(:'c6', 'missed') = 1, 'busy: missed push');
select set_config('request.jwt.claim.sub', :fay, false);
set role authenticated;
select leave_call(:'c5');
reset role;

-- ---------------------------------------------------------------------------
-- 6. Ομαδική
-- ---------------------------------------------------------------------------
-- Σηκώνει η Fay: «τέλος» μόνο για εκείνη· στον Gus συνεχίζει να χτυπάει.
select set_config('request.jwt.claim.sub', :eve, false);
set role authenticated;
select start_call(:'grp', false, :'d_eve')->>'id' as g1 \gset
reset role;
select test.ok(test.pushes(:'g1', 'ring') = 1, 'group ring queued once');
select test.ok((select jsonb_array_length(push_call_targets(:'g1', 'ring')->'subscriptions')) = 3,
  'group ring reaches everyone else');
select set_config('request.jwt.claim.sub', :fay, false);
set role authenticated;
select join_call(:'g1', :'d_fay');
reset role;
select test.ok(test.pushes(:'g1', 'ended', :fay) = 1, 'group: end push for the one who answered');
select test.ok(test.pushes(:'g1', 'ended', :gus) = 0, 'group: still ringing for the others');
select test.ok((select jsonb_array_length(push_call_targets(:'g1', 'ring')->'subscriptions')) = 1,
  'group: a late ring would only reach those still ringing');

-- Μίλησαν η Eve και η Fay και το έκλεισαν, ενώ στον Gus χτυπούσε ακόμα:
-- για εκείνον είναι αναπάντητη.
select set_config('request.jwt.claim.sub', :fay, false);
set role authenticated;
select leave_call(:'g1');
reset role;
select set_config('request.jwt.claim.sub', :eve, false);
set role authenticated;
select test.ok((select leave_call(:'g1')->>'endReason') = 'completed', 'group call completed');
reset role;
select test.ok(test.pushes(:'g1', 'missed') = 1, 'group: missed push for those still ringing');
select test.ok((select jsonb_array_length(push_call_targets(:'g1', 'missed')->'subscriptions')) = 1,
  'group: missed only to them');
select test.ok((select push_call_targets(:'g1', 'missed')->'subscriptions'->0->>'endpoint') like '%gus-phone%',
  'group: missed reaches gus');
select test.ok(test.pushes(:'g1', 'ended', :gus) = 0, 'missed is not also an end push');

-- Απορρίπτει ο Gus: «τέλος» για εκείνον, η κλήση συνεχίζει να χτυπάει στη Fay.
select set_config('request.jwt.claim.sub', :eve, false);
set role authenticated;
select start_call(:'grp', true, :'d_eve')->>'id' as g2 \gset
reset role;
select set_config('request.jwt.claim.sub', :gus, false);
set role authenticated;
select test.ok((select decline_call(:'g2')->>'status') = 'ringing', 'group keeps ringing after one decline');
reset role;
select test.ok(test.pushes(:'g2', 'ended', :gus) = 1, 'group decline: end push for the one who declined');
select test.ok(test.pushes(:'g2', 'ended', :fay) = 0, 'group decline: nothing for the others');
-- Ομάδα σε σίγαση: δεν της χτύπησε, άρα δεν πάει ούτε «τέλος».
select set_config('request.jwt.claim.sub', :fay, false);
set role authenticated;
select set_conversation_prefs(:'grp', jsonb_build_object('mutedUntil', now() + interval '8 hours'));
select test.ok((select decline_call(:'g2')->>'endReason') = 'declined', 'everyone declined: the group call ends');
reset role;
select test.ok((select jsonb_array_length(push_call_ended_targets(:'g2', :fay)->'subscriptions')) = 0,
  'muted group: no end push');
select test.ok(test.pushes(:'g2', 'missed') = 0, 'everyone declined: no missed push');
select set_config('request.jwt.claim.sub', :fay, false);
set role authenticated;
select set_conversation_prefs(:'grp', '{"mutedUntil": null}');
reset role;

-- ---------------------------------------------------------------------------
-- 7. Κλήση που δεν συνδέθηκε ποτέ
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', :eve, false);
set role authenticated;
select start_call(:'ef', false, :'d_eve')->>'id' as c7 \gset
reset role;
select set_config('request.jwt.claim.sub', :fay, false);
set role authenticated;
select join_call(:'c7', :'d_fay');
select fail_call(:'c7') as f7 \gset
select test.ok((:'f7'::jsonb)->>'status' = 'ended', 'failed call ends');
select test.ok((:'f7'::jsonb)->>'endReason' = 'failed', 'and says failed, not completed');
reset role;
select set_config('request.jwt.claim.sub', :eve, false);
set role authenticated;
select test.ok((select fail_call(:'c7')->>'endReason') = 'failed', 'the other side failing too changes nothing');
select test.ok((select leave_call(:'c7')->>'endReason') = 'failed', 'nor does hanging up afterwards');
reset role;
select test.ok(test.pushes(:'c7', 'missed') = 0, 'failed call: no missed push');

-- Χτυπάει ακόμα: «δεν συνδέθηκε» από τον καλούμενο είναι απλή απόρριψη.
select set_config('request.jwt.claim.sub', :eve, false);
set role authenticated;
select start_call(:'ef', false, :'d_eve')->>'id' as c8 \gset
reset role;
select set_config('request.jwt.claim.sub', :fay, false);
set role authenticated;
select test.ok((select fail_call(:'c8')->>'endReason') = 'declined', 'fail while ringing = decline');
reset role;

-- Ομαδική: απλή έξοδος, οι άλλοι συνεχίζουν.
select set_config('request.jwt.claim.sub', :eve, false);
set role authenticated;
select start_call(:'grp', false, :'d_eve')->>'id' as g3 \gset
reset role;
select set_config('request.jwt.claim.sub', :fay, false);
set role authenticated;
select join_call(:'g3', :'d_fay');
reset role;
select set_config('request.jwt.claim.sub', :gus, false);
set role authenticated;
select join_call(:'g3', :'d_gus');
select test.ok((select fail_call(:'g3')->>'status') = 'active', 'group: a failed device just leaves');
reset role;
select test.ok((select state from call_participants where call_id = :'g3' and user_id = :gus) = 'left',
  'group: the failed member has left');
select set_config('request.jwt.claim.sub', :eve, false);
set role authenticated;
select test.ok((select leave_call(:'g3')->>'endReason') = 'completed', 'group: ends normally');
reset role;

-- Μόνο μέλη, και μόνο συνδεδεμένοι.
select set_config('request.jwt.claim.sub', :hal, false);
set role authenticated;
select test.fails(format('select public.fail_call(%L)', :'c7'), 'not found', 'outsider cannot fail a call');
reset role;
select test.ok(not has_function_privilege('anon', 'public.fail_call(uuid)', 'execute'), 'anon cannot fail a call');

-- ---------------------------------------------------------------------------
-- 8. Δικαιώματα
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', :fay, false);
set role authenticated;
select test.fails(format('select public.push_call_ended_targets(%L, %L)', :'c1', :fay),
  'permission denied', 'users cannot read end push targets');
reset role;
select test.ok(not has_function_privilege('authenticated', 'public.notify_call_participant_change()', 'execute'),
  'the trigger function is not callable');
select test.ok(has_function_privilege('service_role', 'public.push_call_ended_targets(uuid, uuid)', 'execute'),
  'the push function can read end targets');
