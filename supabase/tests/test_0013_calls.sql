-- Tests για το 0013: κλήσεις, «σε σύνδεση», «παραδόθηκε», επεξεργασία,
-- σίγαση / καρφίτσωμα. Δικοί του χρήστες, ώστε να μην εξαρτάται από τα
-- υπόλοιπα tests. Κάθε έλεγχος τρέχει ΩΣ ο χρήστης, όπως από τον browser.

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

grant execute on all functions in schema test to authenticated, service_role;

-- Τα προηγούμενα tests χαμηλώνουν κάποια όρια για να τα ελέγξουν. Πίσω στις
-- αρχικές τιμές, με άδειο ιστορικό.
update rate_limit_rules set max_count = 30 where action = 'message' and window_seconds = 60;
update rate_limit_rules set max_count = 10 where action = 'contact_request' and window_seconds = 3600;
delete from rate_limit_events;

\set ann  '''11111111-0000-4000-8000-000000000001'''
\set ben  '''22222222-0000-4000-8000-000000000002'''
\set cat  '''33333333-0000-4000-8000-000000000003'''
\set dan  '''44444444-0000-4000-8000-000000000004'''

insert into auth.users (id, email, raw_user_meta_data) values
  (:ann, 'ann@example.org', '{"display_name":"Ann Archer"}'),
  (:ben, 'ben@example.org', '{"display_name":"Ben Baker"}'),
  (:cat, 'cat@example.org', '{"display_name":"Cat Cooper"}'),
  (:dan, 'dan@example.org', '{"display_name":"Dan Dixon"}');

\set k_ann  '''aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1'''
\set k_ann2 '''aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa2'''
\set k_ben  '''bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb1'''
\set k_ben2 '''bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb2'''
\set k_cat  '''cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc1'''
\set k_dan  '''dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd1'''
\set wrapped '''wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww'''
\set envelope '''{"iv":"aaaaaaaaaaaaaaaa","ct":"bbbbbbbbbbbbbbbbbbbbbbbb"}'''
\set envelope2 '''{"iv":"cccccccccccccccc","ct":"dddddddddddddddddddddddd"}'''

-- Συσκευές
select set_config('request.jwt.claim.sub', :ann, false);
set role authenticated;
select register_device(:k_ann, 'Laptop');
select register_device(:k_ann2, 'Phone');
reset role;
select set_config('request.jwt.claim.sub', :ben, false);
set role authenticated;
select register_device(:k_ben, 'Phone');
select register_device(:k_ben2, 'Laptop');
reset role;
select set_config('request.jwt.claim.sub', :cat, false);
set role authenticated;
select register_device(:k_cat, 'Phone');
reset role;
select set_config('request.jwt.claim.sub', :dan, false);
set role authenticated;
select register_device(:k_dan, 'Phone');
reset role;

select id as d_ann from user_devices where public_key = :k_ann \gset
select id as d_ann2 from user_devices where public_key = :k_ann2 \gset
select id as d_ben from user_devices where public_key = :k_ben \gset
select id as d_ben2 from user_devices where public_key = :k_ben2 \gset
select id as d_cat from user_devices where public_key = :k_cat \gset
select id as d_dan from user_devices where public_key = :k_dan \gset

-- ---------------------------------------------------------------------------
-- 1. Κανένα τηλεφώνημα από άγνωστο
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', :ann, false);
set role authenticated;
select start_direct_conversation(:ben) as ab \gset
select test.fails(format('select public.start_call(%L, false, %L)', :'ab', :'d_ann'),
  'once the request is accepted', 'no call before the request is accepted');
reset role;

select set_config('request.jwt.claim.sub', :ben, false);
set role authenticated;
select respond_to_request(:'ab', true);
-- Ο Ben δεν μπορεί να καλέσει με συσκευή της Ann.
select test.fails(format('select public.start_call(%L, false, %L)', :'ab', :'d_ann'),
  'unknown calling device', 'device must be mine');
reset role;

-- Ο Cat δεν είναι μέλος: δεν βλέπει, δεν καλεί, δεν μπαίνει.
select set_config('request.jwt.claim.sub', :cat, false);
set role authenticated;
select test.fails(format('select public.start_call(%L, false, %L)', :'ab', :'d_cat'),
  'cannot call', 'outsider cannot call');
reset role;

-- ---------------------------------------------------------------------------
-- 2. Κλήση που απαντιέται
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', :ann, false);
set role authenticated;
select start_call(:'ab', true, :'d_ann') as c1 \gset
select test.ok((:'c1'::jsonb)->>'status' = 'ringing', 'new call rings');
select test.ok(((:'c1'::jsonb)->>'video')::boolean, 'video flag kept');
select test.ok((select count(*) from calls) = 1, 'caller sees the call');
-- Δεύτερη κλήση στην ίδια συνομιλία = η ίδια.
select test.ok((select start_call(:'ab', false, :'d_ann')->>'id') = (:'c1'::jsonb)->>'id',
  'calling again returns the open call');
reset role;

select (:'c1'::jsonb)->>'id' as call1 \gset

select set_config('request.jwt.claim.sub', :cat, false);
set role authenticated;
select test.ok((select count(*) from calls) = 0, 'outsider sees no calls');
select test.ok((select count(*) from call_participants) = 0, 'outsider sees no participants');
select test.ok((select get_call(:'call1')) is null, 'outsider cannot read the call');
select test.fails(format('select public.join_call(%L, %L)', :'call1', :'d_cat'),
  'not found', 'outsider cannot join');
reset role;

select set_config('request.jwt.claim.sub', :ben, false);
set role authenticated;
select test.ok((select count(*) from calls) = 1, 'callee sees the call');
select test.ok((select state from call_participants where user_id = :ben) = 'ringing', 'callee is ringing');
-- Τηλεφώνημα πίσω την ίδια στιγμή = μπαίνει στην ίδια κλήση.
select test.ok((select start_call(:'ab', false, :'d_ben')->>'id') = :'call1', 'glare joins the same call');
select join_call(:'call1', :'d_ben') as j \gset
select test.ok((:'j'::jsonb)->>'status' = 'active', 'answered call is active');
select test.ok((:'j'::jsonb)->>'answeredAt' is not null, 'answer time recorded');
reset role;

-- Η Ann δεν μπαίνει από δεύτερη συσκευή όσο μιλάει από την πρώτη.
select set_config('request.jwt.claim.sub', :ann, false);
set role authenticated;
select test.fails(format('select public.join_call(%L, %L)', :'call1', :'d_ann2'),
  'another device', 'one device per person');
select test.ok((select call_heartbeat(:'call1')->>'status') = 'active', 'heartbeat returns status');
reset role;

select set_config('request.jwt.claim.sub', :ben, false);
set role authenticated;
select leave_call(:'call1') as l \gset
select test.ok((:'l'::jsonb)->>'status' = 'ended', 'hanging up ends a direct call');
select test.ok((:'l'::jsonb)->>'endReason' = 'completed', 'answered call ends completed');
select test.fails(format('select public.join_call(%L, %L)', :'call1', :'d_ben'),
  'ended', 'cannot join an ended call');
reset role;

-- ---------------------------------------------------------------------------
-- 3. Απόρριψη, ακύρωση, αναπάντητη
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', :ann, false);
set role authenticated;
select start_call(:'ab', false, :'d_ann')->>'id' as call2 \gset
reset role;
select set_config('request.jwt.claim.sub', :ben, false);
set role authenticated;
select test.ok((select decline_call(:'call2')->>'endReason') = 'declined', 'decline ends with declined');
reset role;

select set_config('request.jwt.claim.sub', :ann, false);
set role authenticated;
select start_call(:'ab', false, :'d_ann')->>'id' as call3 \gset
select test.ok((select leave_call(:'call3')->>'endReason') = 'missed', 'caller cancelling = missed');
reset role;
select test.ok((select state from call_participants where call_id = :'call3' and user_id = :ben) = 'missed',
  'callee sees it as missed');

-- Κανείς δεν απαντάει και ο καλών εξαφανίζεται: η κλήση «πεθαίνει» μόνη της.
select set_config('request.jwt.claim.sub', :ann, false);
set role authenticated;
select start_call(:'ab', false, :'d_ann')->>'id' as call4 \gset
reset role;
update calls set created_at = now() - interval '2 minutes' where id = :'call4';
select set_config('request.jwt.claim.sub', :ben, false);
set role authenticated;
select test.ok((select get_call(:'call4')->>'status') = 'ended', 'stale call reads as ended');
select test.ok((select get_call(:'call4')->>'endReason') = 'missed', 'stale unanswered call reads as missed');
select test.fails(format('select public.join_call(%L, %L)', :'call4', :'d_ben'), 'ended', 'cannot answer a stale call');
-- Και δεν μπλοκάρει νέα κλήση.
select start_call(:'ab', true, :'d_ben')->>'id' as call5 \gset
select test.ok(:'call5' <> :'call4', 'new call after a stale one');
select leave_call(:'call5');
reset role;
select test.ok((select status from calls where id = :'call4') = 'ended', 'stale call was closed for real');

-- ---------------------------------------------------------------------------
-- 4. «Μιλάει σε άλλη κλήση»
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', :cat, false);
set role authenticated;
select start_direct_conversation(:ben) as cb \gset
reset role;
select set_config('request.jwt.claim.sub', :ben, false);
set role authenticated;
select respond_to_request(:'cb', true);
reset role;

select set_config('request.jwt.claim.sub', :ann, false);
set role authenticated;
select start_call(:'ab', false, :'d_ann')->>'id' as call6 \gset
reset role;
select set_config('request.jwt.claim.sub', :ben, false);
set role authenticated;
select join_call(:'call6', :'d_ben');
reset role;
select set_config('request.jwt.claim.sub', :cat, false);
set role authenticated;
select start_call(:'cb', false, :'d_cat') as busy \gset
select test.ok((:'busy'::jsonb)->>'endReason' = 'busy', 'callee on another call = busy');
reset role;
select set_config('request.jwt.claim.sub', :ben, false);
set role authenticated;
select leave_call(:'call6');
reset role;

-- ---------------------------------------------------------------------------
-- 5. Ομαδική κλήση
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', :ben, false);
set role authenticated;
select create_group('Team', array[:ann, :cat]::uuid[]) as grp \gset
select start_call(:'grp', true, :'d_ben')->>'id' as g1 \gset
reset role;
select test.ok((select count(*) from call_participants where call_id = :'g1' and state = 'ringing') = 2,
  'group call rings everyone else');

select set_config('request.jwt.claim.sub', :ann, false);
set role authenticated;
select test.ok((select decline_call(:'g1')->>'status') = 'ringing', 'one decline does not end a group call');
reset role;
select set_config('request.jwt.claim.sub', :cat, false);
set role authenticated;
select test.ok((select join_call(:'g1', :'d_cat')->>'status') = 'active', 'group call becomes active');
reset role;
-- Η Ann άλλαξε γνώμη και μπαίνει.
select set_config('request.jwt.claim.sub', :ann, false);
set role authenticated;
select test.ok((select join_call(:'g1', :'d_ann')->>'status') = 'active', 'declined member can still join');
select test.ok((select leave_call(:'g1')->>'status') = 'active', 'group call continues with two');
reset role;
select set_config('request.jwt.claim.sub', :cat, false);
set role authenticated;
select test.ok((select leave_call(:'g1')->>'status') = 'ended', 'group call ends when one is left');
reset role;

-- Ιστορικό
select set_config('request.jwt.claim.sub', :ben, false);
set role authenticated;
select test.ok((select count(*) from list_calls()) >= 6, 'call history lists my calls');
select test.ok((select count(*) from list_calls(:'grp')) = 1, 'history per conversation');
select test.ok((select count(*) from list_calls(null, now() + interval '1 minute')) = 0, 'history since a time');
reset role;
select set_config('request.jwt.claim.sub', :dan, false);
set role authenticated;
select test.ok((select count(*) from list_calls()) = 0, 'outsider has no history');
reset role;

-- Ειδοποίηση: κανείς χωρίς συνδρομή = καμία κλήση στη function.
select test.ok((select count(*) from net.calls where body->>'action' = 'call') = 0,
  'no push request without subscriptions');
insert into push_subscriptions (user_id, endpoint, p256dh, auth)
values (:ben, 'https://fcm.googleapis.com/fcm/send/abcdefghijklmnopqrstuvwxyz',
        repeat('p', 87), repeat('a', 22));
select set_config('request.jwt.claim.sub', :ann, false);
set role authenticated;
select start_call(:'ab', false, :'d_ann')->>'id' as call7 \gset
reset role;
select test.ok((select count(*) from net.calls where body->>'action' = 'call' and body->>'event' = 'ring') = 1,
  'ring push queued');
select test.ok((select jsonb_array_length(push_call_targets(:'call7', 'ring')->'subscriptions')) = 1,
  'ring push goes to the callee');
select set_config('request.jwt.claim.sub', :ann, false);
set role authenticated;
select leave_call(:'call7');
reset role;
select test.ok((select count(*) from net.calls where body->>'action' = 'call' and body->>'event' = 'missed') = 1,
  'missed push queued');
select test.ok((select jsonb_array_length(push_call_targets(:'call7', 'missed')->'subscriptions')) = 1,
  'missed push goes to the callee');

set role authenticated;
select set_config('request.jwt.claim.sub', :ann, false);
select test.fails(format('select public.push_call_targets(%L, %L)', :'call7', 'ring'),
  'permission denied', 'users cannot read push targets');
select test.fails('select public.finish_call(gen_random_uuid())', 'permission denied',
  'users cannot finish calls directly');
reset role;

-- Η διάρκεια: από την απάντηση μέχρι το κλείσιμο, όχι μέχρι τον τελευταίο χτύπο.
select set_config('request.jwt.claim.sub', :ann, false);
set role authenticated;
select start_call(:'ab', false, :'d_ann')->>'id' as call8 \gset
reset role;
select set_config('request.jwt.claim.sub', :ben, false);
set role authenticated;
select join_call(:'call8', :'d_ben');
reset role;
update calls set answered_at = now() - interval '3 minutes', created_at = now() - interval '200 seconds'
where id = :'call8';
update call_heartbeats set seen_at = now() - interval '10 seconds' where call_id = :'call8';
select set_config('request.jwt.claim.sub', :ann, false);
set role authenticated;
select test.ok(
  (select extract(epoch from ((leave_call(:'call8')->>'endedAt')::timestamptz - now() + interval '3 minutes')) between 175 and 185),
  'hang-up duration runs until the hang-up');
reset role;

-- ---------------------------------------------------------------------------
-- 6. Σίγαση: δεν φτάνει ειδοποίηση μηνύματος
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', :ann, false);
set role authenticated;
select send_message(:'ab', :envelope, gen_random_uuid(), :'d_ann',
  format('[{"device":"%s","key":%s},{"device":"%s","key":%s},{"device":"%s","key":%s},{"device":"%s","key":%s}]',
    :'d_ann', to_jsonb(:wrapped::text), :'d_ann2', to_jsonb(:wrapped::text),
    :'d_ben', to_jsonb(:wrapped::text), :'d_ben2', to_jsonb(:wrapped::text))::jsonb) as m1 \gset
reset role;
select (:'m1'::jsonb)->>'id' as msg1 \gset
select test.ok((select jsonb_array_length(push_targets(:'msg1')->'subscriptions')) = 1, 'unmuted gets push');

select set_config('request.jwt.claim.sub', :ben, false);
set role authenticated;
select set_conversation_prefs(:'ab', jsonb_build_object('mutedUntil', now() + interval '8 hours'));
select test.ok((select r->>'mutedUntil' from list_conversations() r where r->>'id' = :'ab') is not null,
  'mute shows in the list');
reset role;
select test.ok((select jsonb_array_length(push_targets(:'msg1')->'subscriptions')) = 0, 'muted gets no push');

select set_config('request.jwt.claim.sub', :ann, false);
set role authenticated;
select test.ok((select r->'mutedUntil' from list_conversations() r where r->>'id' = :'ab') = 'null'::jsonb,
  'mute is private to the person who muted');
reset role;

select set_config('request.jwt.claim.sub', :ben, false);
set role authenticated;
select set_conversation_prefs(:'ab', '{"mutedUntil": null, "pinned": true}');
select test.ok((select r->>'pinnedAt' from list_conversations() r where r->>'id' = :'ab') is not null, 'pinned');
select set_conversation_prefs(:'ab', '{"archived": true}');
select test.ok((select (r->>'archived')::boolean and r->'pinnedAt' = 'null'::jsonb
  from list_conversations() r where r->>'id' = :'ab'), 'archiving unpins');
select set_conversation_prefs(:'cb', '{"pinned": true}');
select set_conversation_prefs(:'grp', '{"pinned": true}');
select set_conversation_prefs(:'ab', '{"pinned": true}');
reset role;
select set_config('request.jwt.claim.sub', :ben, false);
set role authenticated;
select start_direct_conversation(:dan) as bd \gset
select test.fails(format($$select public.set_conversation_prefs(%L, '{"pinned": true}')$$, :'bd'),
  'up to 3', 'at most three pins');
select test.ok((select r->>'lastCall' is not null from list_conversations() r where r->>'id' = :'ab'),
  'list shows the last call');
reset role;
select test.ok((select jsonb_array_length(push_targets(:'msg1')->'subscriptions')) = 1, 'unmuted again gets push');

-- ---------------------------------------------------------------------------
-- 7. «Παραδόθηκε» και «διαβάστηκε»
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', :ben, false);
set role authenticated;
select test.ok((select mark_delivered()) >= 1, 'delivery marks conversations');
select test.ok((select mark_delivered()) = 0, 'second time nothing new');
reset role;
select set_config('request.jwt.claim.sub', :ann, false);
set role authenticated;
select test.ok((select get_message(:'msg1')->'deliveredTo') ? :ben, 'sender sees delivered');
select test.ok(jsonb_array_length((select get_message(:'msg1')->'readBy')) = 0, 'not read yet');
reset role;
update profiles set read_receipts = false where id = :ben;
select set_config('request.jwt.claim.sub', :ann, false);
set role authenticated;
select test.ok((select get_message(:'msg1')->'deliveredTo') ? :ben, 'delivered shows even without read receipts');
reset role;
update profiles set read_receipts = true where id = :ben;

-- ---------------------------------------------------------------------------
-- 8. Επεξεργασία
-- ---------------------------------------------------------------------------
\set all_keys '''[{"device":"DA","key":"wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww"},{"device":"DA2","key":"wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww"},{"device":"DB","key":"wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww"},{"device":"DB2","key":"wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww"}]'''
select replace(replace(replace(replace(:all_keys, 'DA2', :'d_ann2'), 'DB2', :'d_ben2'), 'DA', :'d_ann'), 'DB', :'d_ben') as keys_ab \gset

select set_config('request.jwt.claim.sub', :ben, false);
set role authenticated;
select test.fails(format('select public.edit_message(%L, %L, %L, %L::jsonb)', :'msg1', :envelope2, :'d_ben', :'keys_ab'),
  'only the sender', 'only the sender edits');
reset role;

select set_config('request.jwt.claim.sub', :ann, false);
set role authenticated;
select edit_message(:'msg1', :envelope2, :'d_ann2', :'keys_ab'::jsonb) as edited \gset
select test.ok((:'edited'::jsonb)->>'editedAt' is not null, 'edit time shows');
select test.ok((:'edited'::jsonb)->'e2ee'->>'envelope' = :envelope2, 'new ciphertext stored');
select test.ok((:'edited'::jsonb)->'e2ee'->>'senderKey' = :k_ann2, 'sender key follows the editing device');
select test.fails(format('select public.edit_message(%L, %L, %L, %L::jsonb)', :'msg1', 'plain text', :'d_ann', :'keys_ab'),
  'must be encrypted', 'edit must be encrypted');
select test.fails(format($$select public.edit_message(%L, %L, %L, '[{"device":"%s","key":"%s"}]'::jsonb)$$,
    :'msg1', :envelope2, :'d_ann', :'d_ann', :wrapped),
  'out of date', 'edit must cover every member device');
reset role;
update messages set created_at = now() - interval '1 hour' where id = :'msg1';
select set_config('request.jwt.claim.sub', :ann, false);
set role authenticated;
select test.fails(format('select public.edit_message(%L, %L, %L, %L::jsonb)', :'msg1', :envelope, :'d_ann', :'keys_ab'),
  '15 minutes', 'edit window is 15 minutes');
reset role;

-- ---------------------------------------------------------------------------
-- 9. «Σε σύνδεση»
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', :ben, false);
set role authenticated;
select touch_presence(true);
reset role;
select set_config('request.jwt.claim.sub', :ann, false);
set role authenticated;
select test.ok((select (get_presence(:ben)->>'online')::boolean), 'contact sees online');
select test.ok((select r->'others'->0->'presence'->>'online' from list_conversations() r where r->>'id' = :'ab') = 'true',
  'list carries presence');
reset role;
select set_config('request.jwt.claim.sub', :dan, false);
set role authenticated;
select test.ok((select get_presence(:ben)) is null, 'stranger with a pending request sees nothing');
reset role;
select set_config('request.jwt.claim.sub', :ben, false);
set role authenticated;
select touch_presence(false);
reset role;
select set_config('request.jwt.claim.sub', :ann, false);
set role authenticated;
select test.ok(not (select (get_presence(:ben)->>'online')::boolean), 'going away shows offline');
select test.ok((select get_presence(:ben)->>'lastSeen') is not null, 'last seen shows');
reset role;
-- Αμοιβαιότητα: αν το κρύψω, δεν βλέπω ούτε των άλλων.
update profiles set show_online = false where id = :ann;
select set_config('request.jwt.claim.sub', :ann, false);
set role authenticated;
select test.ok((select get_presence(:ben)) is null, 'hiding mine hides theirs');
reset role;
update profiles set show_online = true where id = :ann;
update profiles set show_online = false where id = :ben;
select set_config('request.jwt.claim.sub', :ann, false);
set role authenticated;
select test.ok((select get_presence(:ben)) is null, 'hidden presence stays hidden');
reset role;
