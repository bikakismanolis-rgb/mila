-- Tests για το 0010: αναζήτηση, προφίλ, όρια, συσκευές, κρυπτογραφημένα
-- μηνύματα, φωτογραφία προφίλ. Κάθε έλεγχος τρέχει ΩΣ συγκεκριμένος χρήστης
-- (ρόλος authenticated + auth.uid()), όπως ακριβώς θα τον έτρεχε ο browser.
-- Αποτυχία = exception = το run.sh σταματάει με μη μηδενικό κωδικό.

\set ON_ERROR_STOP 1
set client_min_messages = warning;

-- ---------------------------------------------------------------------------
-- Βοηθητικά
-- ---------------------------------------------------------------------------
create schema if not exists test;
grant usage on schema test to authenticated, service_role;

create or replace function test.ok(condition boolean, label text) returns void
language plpgsql as $$
begin
  if condition is not true then
    raise exception 'TEST FAILED: %', label;
  end if;
end $$;

-- Εκτελεί SQL και περιμένει σφάλμα που ταιριάζει με το pattern (regex).
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

-- Ταυτότητες
\set alice '''a0000000-0000-4000-8000-000000000001'''
\set bob   '''b0000000-0000-4000-8000-000000000002'''
\set carol '''c0000000-0000-4000-8000-000000000003'''
\set dave  '''d0000000-0000-4000-8000-000000000004'''
\set erin  '''e0000000-0000-4000-8000-000000000005'''

insert into auth.users (id, email, raw_user_meta_data) values
  (:alice, 'alice@example.com', '{"display_name":"Alice Andrews"}'),
  (:bob,   'bob@example.com',   '{"display_name":"Bob Brown"}'),
  (:carol, 'carol@example.com', '{"display_name":"Carol Clark"}'),
  (:dave,  'dave@example.com',  '{"display_name":"Dave Davis"}'),
  (:erin,  'erin@example.com',  '{"display_name":"Erin Evans"}');

update profiles set bio = 'hello from ' || display_name;

-- Ψεύτικα δημόσια κλειδιά (87 χαρακτήρες base64url) και τυλιγμένα κλειδιά.
\set key_alice '''AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1'''
\set key_alice2 '''AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA2'''
\set key_bob   '''BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB1'''
\set key_carol '''CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC1'''
\set key_erin  '''EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE1'''
\set key_dave  '''DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD1'''
\set wrapped   '''wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww'''
\set envelope  '''{"iv":"aaaaaaaaaaaaaaaa","ct":"bbbbbbbbbbbbbbbbbbbbbbbb"}'''

-- ---------------------------------------------------------------------------
-- 1. Αναζήτηση: ο ξένος δεν βλέπει κανέναν με κομμάτι ονόματος
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', :alice, false);
set role authenticated;

select test.ok((select count(*) from search_profiles('bo')) = 0,
  'partial name finds no strangers');
select test.ok((select count(*) from search_profiles('example.com')) = 0,
  'partial email finds no strangers');
select test.ok((select count(*) from search_profiles('Bob Brown')) = 0,
  'even the full name finds no strangers');
select test.ok((select count(*) from search_profiles('BOB@example.com')) = 1,
  'full email finds the person (case insensitive)');
select test.ok((select r->>'email' from search_profiles('bob@example.com') r) = 'bob@example.com',
  'full email search returns the email that was typed');
select test.ok((select r->>'bio' from search_profiles('bob@example.com') r) = '',
  'stranger does not see bio');
select test.ok((select r->'avatarPath' from search_profiles('bob@example.com') r) = 'null'::jsonb,
  'stranger does not see avatar');
select test.ok((select r->'privacy' from search_profiles('bob@example.com') r) = 'null'::jsonb,
  'stranger does not see privacy settings');
select test.ok(not exists (select 1 from search_profiles('bob@example.com') r where r ? 'avatar'),
  'no third-party avatar URL anymore');

-- Το profiles δεν διαβάζεται απευθείας.
select test.ok((select count(*) from profiles) = 1, 'profiles table shows only my own row');

reset role;

-- Ο Bob κρύβεται: ούτε με ολόκληρο email.
update profiles set discover_by_email = 'nobody' where id = :bob;
select set_config('request.jwt.claim.sub', :carol, false);
set role authenticated;
select test.ok((select count(*) from search_profiles('bob@example.com')) = 0,
  'discover = nobody hides from full email search');
select test.fails($$select public.start_direct_conversation('b0000000-0000-4000-8000-000000000002')$$,
  'not allowed', 'cannot request someone hidden');
reset role;
update profiles set discover_by_email = 'everyone' where id = :bob;

-- ---------------------------------------------------------------------------
-- 2. Συσκευές
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', :alice, false);
set role authenticated;
select test.ok((select (register_device(:key_alice, 'Firefox')->>'revoked')::boolean) = false, 'alice registers');
select test.ok((select register_device(:key_alice, '')->>'id') = (select id::text from user_devices where public_key = :key_alice),
  'same key = same device');
select test.fails($$select public.register_device('not-a-key', '')$$, 'check constraint|violates', 'bad key rejected');
reset role;

select set_config('request.jwt.claim.sub', :bob, false);
set role authenticated;
select register_device(:key_bob, 'Chrome');
select test.fails(format('select public.register_device(%L, %L)', :key_alice, ''),
  'another account', 'cannot claim someone else''s key');
select test.ok((select count(*) from user_devices) = 1, 'user_devices shows only my devices');
reset role;

select set_config('request.jwt.claim.sub', :carol, false);
set role authenticated;
select register_device(:key_carol, 'Safari');
reset role;
select set_config('request.jwt.claim.sub', :dave, false);
set role authenticated;
select register_device(:key_dave, 'Edge');
reset role;
-- Η Erin δεν έχει ανοίξει ποτέ το νέο app: καμία συσκευή.

-- ---------------------------------------------------------------------------
-- 3. Αίτημα και κρυπτογραφημένα μηνύματα
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', :alice, false);
set role authenticated;
select start_direct_conversation(:bob) as ab \gset
select test.ok((select start_direct_conversation(:bob)) = :'ab', 'reopening returns same conversation');

-- Πριν την αποδοχή: ο αποστολέας ΔΕΝ βλέπει bio/φωτογραφία του παραλήπτη.
select test.ok((select c->'others'->0->>'bio' from list_conversations() c where c->>'id' = :'ab') = '',
  'requester does not see recipient bio before acceptance');

select jsonb_agg(jsonb_build_object('device', k->>'deviceId', 'key', :wrapped)) as ab_keys
from jsonb_array_elements(conversation_device_keys(:'ab')) k \gset
select test.ok(jsonb_array_length(:'ab_keys'::jsonb) = 2, 'device keys for both members');

-- Απλό κείμενο: όχι.
select test.fails(format($$select public.send_message(%L, 'hello', gen_random_uuid(), (select id from user_devices where public_key = %L), %L::jsonb)$$,
  :'ab', :key_alice, :'ab_keys'), 'must be encrypted', 'plaintext rejected');
-- Ούτε απευθείας INSERT στον πίνακα.
select test.fails(format($$insert into messages (conversation_id, sender_id, ciphertext, client_message_id, encryption_version) values (%L, %L, 'x', gen_random_uuid(), 1)$$,
  :'ab', :alice), 'permission denied', 'direct insert into messages blocked');

-- Λείπει το κλειδί του Bob.
select test.fails(format($$select public.send_message(%L, %L, gen_random_uuid(), (select id from user_devices where public_key = %L), %L::jsonb)$$,
  :'ab', :envelope, :key_alice,
  jsonb_build_array(jsonb_build_object('device', (select id from user_devices where public_key = :key_alice), 'key', :wrapped))),
  'out of date', 'missing recipient key rejected');

-- Συσκευή που δεν ανήκει: δεν τη βλέπει καν η Alice, οπότε δίνουμε το id με το χέρι.
reset role;
select id as carol_device from user_devices where public_key = :key_carol \gset
select set_config('request.jwt.claim.sub', :alice, false);
set role authenticated;
select test.fails(format($$select public.send_message(%L, %L, gen_random_uuid(), (select id from user_devices where public_key = %L), %L::jsonb)$$,
  :'ab', :envelope, :key_alice,
  (:'ab_keys'::jsonb) || jsonb_build_array(jsonb_build_object('device', :'carol_device', 'key', :wrapped))),
  'out of date', 'key for an outsider device rejected');

-- Κανονική αποστολή.
select send_message(:'ab', :envelope, gen_random_uuid(),
  (select id from user_devices where public_key = :key_alice), :'ab_keys'::jsonb) as first_msg \gset
select (:'first_msg'::jsonb)->>'id' as first_id \gset
select test.ok((:'first_msg'::jsonb)->>'body' = '', 'server returns no plaintext body');
select test.ok((:'first_msg'::jsonb)->'e2ee'->>'senderKey' = :key_alice, 'sender key recorded');

-- Ίδιο client id = ίδιο μήνυμα.
select gen_random_uuid() as cid \gset
select send_message(:'ab', :envelope, :'cid', (select id from user_devices where public_key = :key_alice), :'ab_keys'::jsonb);
select test.ok((select send_message(:'ab', :envelope, :'cid', (select id from user_devices where public_key = :key_alice), :'ab_keys'::jsonb)->>'id')
  = (select id::text from messages where client_message_id = :'cid'), 'idempotent send');

-- Μέχρι 3 μηνύματα πριν την αποδοχή.
reset role;

select set_config('request.jwt.claim.sub', :alice, false);
set role authenticated;
select count(*) as alice_sent from messages where sender_id = :alice \gset
reset role;
select test.ok(:alice_sent = 2, 'two messages so far');
select set_config('request.jwt.claim.sub', :alice, false);
set role authenticated;
select send_message(:'ab', :envelope, gen_random_uuid(), (select id from user_devices where public_key = :key_alice), :'ab_keys'::jsonb);
select test.fails(format($$select public.send_message(%L, %L, gen_random_uuid(), (select id from user_devices where public_key = %L), %L::jsonb)$$,
  :'ab', :envelope, :key_alice, :'ab_keys'),
  'wait until your request is accepted', 'fourth message before acceptance rejected');
reset role;

-- Ο Bob βλέπει την Alice (του έστειλε αίτημα) και δέχεται.
select set_config('request.jwt.claim.sub', :bob, false);
set role authenticated;
select test.ok((select c->'others'->0->>'bio' from list_conversations() c where c->>'id' = :'ab') = 'hello from Alice Andrews',
  'recipient sees requester bio');
select respond_to_request(:'ab', true);

-- Ο Bob παίρνει ΜΟΝΟ το δικό του τυλιγμένο κλειδί.
select test.ok((select jsonb_object_keys(m->'e2ee'->'keys') from list_messages(:'ab') m limit 1)
  = (select id::text from user_devices where public_key = :key_bob), 'bob receives only his key');
select test.ok((select count(*) from message_keys) = 3, 'bob reads only his message_keys rows');
select test.ok((select count(*) from message_keys where recipient_id = :alice) = 0, 'bob cannot read alice keys');
reset role;

-- Η Carol (εκτός συνομιλίας) δεν βλέπει τίποτα.
select set_config('request.jwt.claim.sub', :carol, false);
set role authenticated;
select test.ok(conversation_device_keys(:'ab') = '[]'::jsonb, 'outsider gets no device keys');
select test.ok((select count(*) from message_keys) = 0, 'outsider reads no keys');
select test.ok((select count(*) from messages) = 0, 'outsider reads no messages');
select test.ok(user_device_keys(:alice) = '[]'::jsonb, 'outsider cannot list alice devices');
reset role;

-- Μετά την αποδοχή: επαφές. Αναζήτηση με κομμάτι ονόματος δουλεύει.
select set_config('request.jwt.claim.sub', :alice, false);
set role authenticated;
select test.ok((select count(*) from search_profiles('bo')) = 1, 'contacts are found by partial name');
select test.ok((select r->>'bio' from search_profiles('bo') r) = 'hello from Bob Brown', 'contact sees bio');
select test.ok(jsonb_array_length(user_device_keys(:bob)) = 1, 'contact can fetch safety-code keys');

-- Νέα συσκευή της Alice: τα επόμενα μηνύματα χρειάζονται κλειδί και γι' αυτήν.
select register_device(:key_alice2, 'Phone');
-- Η λίστα κλειδιών που έχει ήδη ο browser καλύπτει κάθε ΜΕΛΟΣ, άρα περνάει.
select send_message(:'ab', :envelope, gen_random_uuid(),
  (select id from user_devices where public_key = :key_alice), :'ab_keys'::jsonb);
reset role;

-- ---------------------------------------------------------------------------
-- 4. Ομάδα: νέο μέλος χωρίς κλειδί = η αποστολή ζητάει φρέσκια λίστα
-- ---------------------------------------------------------------------------
-- Alice-Carol επαφές (για να μπει η Carol στην ομάδα).
select set_config('request.jwt.claim.sub', :alice, false);
set role authenticated;
select start_direct_conversation(:carol) as ac \gset
reset role;
select set_config('request.jwt.claim.sub', :carol, false);
set role authenticated;
select respond_to_request(:'ac', true);
reset role;

select set_config('request.jwt.claim.sub', :alice, false);
set role authenticated;
select create_group('Friends', array[:bob]::uuid[]) as grp \gset
select jsonb_agg(jsonb_build_object('device', k->>'deviceId', 'key', :wrapped)) as grp_keys
from jsonb_array_elements(conversation_device_keys(:'grp')) k \gset
select add_group_members(:'grp', array[:carol]::uuid[]);
select test.fails(format($$select public.send_message(%L, %L, gen_random_uuid(), (select id from user_devices where public_key = %L), %L::jsonb)$$,
  :'grp', :envelope, :key_alice, :'grp_keys'),
  'out of date', 'new group member must get a key');
select jsonb_agg(jsonb_build_object('device', k->>'deviceId', 'key', :wrapped)) as grp_keys
from jsonb_array_elements(conversation_device_keys(:'grp')) k \gset
select send_message(:'grp', :envelope, gen_random_uuid(),
  (select id from user_devices where public_key = :key_alice), :'grp_keys'::jsonb);
reset role;

-- Η Erin δεν έχει συσκευή: δεν μπορεί να της γράψει κανείς σε ατομική.
select set_config('request.jwt.claim.sub', :dave, false);
set role authenticated;
select start_direct_conversation(:erin) as de \gset
select jsonb_agg(jsonb_build_object('device', k->>'deviceId', 'key', :wrapped)) as de_keys
from jsonb_array_elements(conversation_device_keys(:'de')) k \gset
-- (0012) Δεν απορρίπτεται πια: φεύγει με κλειδί μόνο για τον Dave και μένει «σε αναμονή».
select send_message(:'de', :envelope, gen_random_uuid(),
  (select id from user_devices where public_key = :key_dave), :'de_keys'::jsonb) as de_msg \gset
select (:'de_msg'::jsonb)->>'id' as de_id \gset
select test.ok(((:'de_msg'::jsonb)->>'waiting')::boolean, 'message to someone without keys is waiting');
select test.ok(my_undelivered_keys((select id from user_devices where public_key = :key_dave)) = '[]'::jsonb,
  'nothing to deliver while the recipient has no device');
reset role;

-- Η Erin ανοίγει το νέο app: αποκτά συσκευή.
select set_config('request.jwt.claim.sub', :erin, false);
set role authenticated;
select register_device(:key_erin, 'Phone');
select test.ok(m->'e2ee'->'keys' = '{}'::jsonb, 'erin has no key yet') from list_messages(:'de') m where m->>'id' = :'de_id';
-- Η Erin δεν μπορεί να προσθέσει κλειδιά σε μήνυμα του Dave.
select test.ok(add_message_keys((select id from user_devices where public_key = :key_erin),
  jsonb_build_array(jsonb_build_object('message', :'de_id', 'device', (select id from user_devices where public_key = :key_erin), 'key', :wrapped))) = 0,
  'only the sender can add keys');
reset role;

-- Ο Dave (η ίδια συσκευή που το έστειλε) βλέπει τι περιμένει και το παραδίδει.
select set_config('request.jwt.claim.sub', :dave, false);
set role authenticated;
select my_undelivered_keys((select id from user_devices where public_key = :key_dave)) as pending \gset
select test.ok(jsonb_array_length(:'pending'::jsonb) = 1, 'one key to deliver');
select test.ok((:'pending'::jsonb)->0->>'myKey' = :wrapped, 'sender gets its own wrapped key back');
select test.ok(add_message_keys((select id from user_devices where public_key = :key_dave),
  jsonb_build_array(jsonb_build_object('message', :'de_id', 'device', (:'pending'::jsonb)->0->>'deviceId', 'key', :wrapped)))
  = 1, 'key delivered');
select test.ok(add_message_keys((select id from user_devices where public_key = :key_dave),
  jsonb_build_array(jsonb_build_object('message', :'de_id', 'device', (:'pending'::jsonb)->0->>'deviceId', 'key', :wrapped)))
  = 0, 'no double delivery');
select test.ok(not (get_message(:'de_id')->>'waiting')::boolean, 'no longer waiting');
select test.ok(my_undelivered_keys((select id from user_devices where public_key = :key_dave)) = '[]'::jsonb,
  'nothing left to deliver');
reset role;
select set_config('request.jwt.claim.sub', :erin, false);
set role authenticated;
select test.ok(m->'e2ee'->'keys' <> '{}'::jsonb, 'erin now has a key') from list_messages(:'de') m where m->>'id' = :'de_id';
reset role;

-- ---------------------------------------------------------------------------
-- 5. Διαγραφή για όλους: φεύγουν και τα κλειδιά
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', :alice, false);
set role authenticated;
select delete_message(:'first_id', true);
select test.ok((select m->'e2ee' from list_messages(:'ab') m where m->>'id' = :'first_id') = 'null'::jsonb,
  'deleted message has no crypto payload');
reset role;
select test.ok((select count(*) from message_keys where message_id = :'first_id') = 0, 'keys removed on delete');
select test.ok((select ciphertext from messages where id = :'first_id') = '', 'ciphertext wiped on delete');

-- ---------------------------------------------------------------------------
-- 6. Όρια
-- ---------------------------------------------------------------------------
-- Αναζήτηση με ολόκληρο email.
delete from rate_limit_events where action = 'user_lookup';
update rate_limit_rules set max_count = 3 where action = 'user_lookup' and window_seconds = 3600;
select set_config('request.jwt.claim.sub', :carol, false);
set role authenticated;
select count(*) from search_profiles('x1@example.com');
select count(*) from search_profiles('x2@example.com');
select count(*) from search_profiles('x3@example.com');
select test.fails($$select count(*) from public.search_profiles('x4@example.com')$$,
  'rate limit exceeded: user_lookup', 'lookup limit');
-- Αναζήτηση επαφών με όνομα δεν μετράει.
select test.ok((select count(*) from search_profiles('ali')) = 1, 'contact name search is not limited');
reset role;
-- Ούτε το αρχείο επαφών παρακάμπτει το όριο.
update rate_limit_rules set max_count = 2 where action = 'contact_match';
select set_config('request.jwt.claim.sub', :carol, false);
set role authenticated;
select test.fails(format($$select count(*) from public.match_contacts(array[%L, %L, %L])$$,
  encode(sha256('a@x.com'), 'hex'), encode(sha256('b@x.com'), 'hex'), encode(sha256('c@x.com'), 'hex')),
  'rate limit exceeded: contact_match', 'contact import limit');
select test.ok((select count(*) from match_contacts(array[encode(sha256('bob@example.com'), 'hex')])) = 1,
  'contact import within the limit works');
reset role;

-- Αιτήματα.
update rate_limit_rules set max_count = 1 where action = 'contact_request' and window_seconds = 3600;
select set_config('request.jwt.claim.sub', :erin, false);
set role authenticated;
select start_direct_conversation(:alice);
select test.fails(format('select public.start_direct_conversation(%L)', :bob),
  'rate limit exceeded: contact_request', 'request limit');
select start_direct_conversation(:alice);  -- υπάρχουσα: δεν μετράει
reset role;

-- Μηνύματα.
update rate_limit_rules set max_count = 1 where action = 'message' and window_seconds = 60;
delete from rate_limit_events where action = 'message';
select set_config('request.jwt.claim.sub', :bob, false);
set role authenticated;
select jsonb_agg(jsonb_build_object('device', k->>'deviceId', 'key', :wrapped)) as ab_keys
from jsonb_array_elements(conversation_device_keys(:'ab')) k \gset
select send_message(:'ab', :envelope, gen_random_uuid(), (select id from user_devices where public_key = :key_bob), :'ab_keys'::jsonb);
select test.fails(format($$select public.send_message(%L, %L, gen_random_uuid(), (select id from user_devices where public_key = %L), %L::jsonb)$$,
  :'ab', :envelope, :key_bob, :'ab_keys'),
  'rate limit exceeded: message', 'message limit');
reset role;

-- Αναφορές.
update rate_limit_rules set max_count = 1 where action = 'report';
select set_config('request.jwt.claim.sub', :bob, false);
set role authenticated;
insert into reports (reporter_id, reported_id, reason) values (:bob, :dave, 'spam');
select test.fails(format($$insert into reports (reporter_id, reported_id, reason) values (%L, %L, 'spam')$$, :bob, :dave),
  'rate limit exceeded: report', 'report limit');
reset role;

-- Εγγραφές (για όλο το app).
select set_config('request.jwt.claim.sub', '', false);
update rate_limit_rules
set max_count = (select coalesce(sum(weight), 0) from rate_limit_events where action = 'signup') + 1
where action = 'signup' and window_seconds = 3600;
insert into auth.users (email) values ('new1@example.com');
select test.fails($$insert into auth.users (email) values ('new2@example.com')$$,
  'rate limit exceeded: signup', 'signup limit');

-- ---------------------------------------------------------------------------
-- 7. Φωτογραφία προφίλ
-- ---------------------------------------------------------------------------
\set alice_avatar 'a0000000-0000-4000-8000-000000000001/abcdef1234.jpg'
select set_config('request.jwt.claim.sub', :alice, false);
set role authenticated;
insert into storage.objects (bucket_id, name, owner) values ('avatars', :'alice_avatar', :alice);
select test.fails(format($$insert into storage.objects (bucket_id, name) values ('avatars', %L)$$,
  'b0000000-0000-4000-8000-000000000002/abcdef1234.jpg'),
  'row-level security', 'cannot upload into another folder');
select test.fails($$select public.set_my_avatar('b0000000-0000-4000-8000-000000000002/abcdef1234.jpg')$$,
  'invalid avatar path', 'cannot point to another user file');
select test.fails($$select public.set_my_avatar('a0000000-0000-4000-8000-000000000001/missing123.jpg')$$,
  'not found', 'avatar must exist');
select test.ok((select set_my_avatar(:'alice_avatar')->'previous') = 'null'::jsonb, 'avatar set');
reset role;

-- Ο Bob (επαφή) τη βλέπει, η Erin (έστειλε η ίδια αίτημα στην Alice) όχι.
select set_config('request.jwt.claim.sub', :bob, false);
set role authenticated;
select test.ok((select c->'others'->0->>'avatarPath' from list_conversations() c where c->>'id' = :'ab') = :'alice_avatar',
  'contact sees avatar path');
select test.ok((select count(*) from storage.objects where name = :'alice_avatar') = 1, 'contact can read avatar file');
reset role;
select set_config('request.jwt.claim.sub', :erin, false);
set role authenticated;
select test.ok((select count(*) from storage.objects where name = :'alice_avatar') = 0,
  'requester cannot read the avatar of the person they contacted');
reset role;
select set_config('request.jwt.claim.sub', :dave, false);
set role authenticated;
select test.ok((select r->'avatarPath' from search_profiles('alice@example.com') r) = 'null'::jsonb,
  'search does not reveal avatar');
reset role;
-- Η Alice ΕΛΑΒΕ αίτημα από την Erin: βλέπει το bio της για να αποφασίσει.
select set_config('request.jwt.claim.sub', :alice, false);
set role authenticated;
select test.ok((select c->'others'->0->>'bio' from list_conversations() c
  where c->'others'->0->>'id' = 'e0000000-0000-4000-8000-000000000005') = 'hello from Erin Evans',
  'recipient of a request sees the requester');
reset role;

-- Όριο uploads φωτογραφίας.
update rate_limit_rules set max_count = 1 where action = 'upload_avatar';
select set_config('request.jwt.claim.sub', :alice, false);
set role authenticated;
select test.fails(format($$insert into storage.objects (bucket_id, name) values ('avatars', %L)$$,
  'a0000000-0000-4000-8000-000000000001/second1234.jpg'),
  'row-level security', 'avatar upload limit');
reset role;

-- ---------------------------------------------------------------------------
-- 8. Παλιά μηνύματα σε απλό κείμενο
-- ---------------------------------------------------------------------------
alter table messages disable trigger messages_before_insert;
insert into messages (conversation_id, sender_id, ciphertext, client_message_id, encryption_version)
values (:'ab', :alice, 'old plaintext', gen_random_uuid(), 0);
alter table messages enable trigger messages_before_insert;

select set_config('request.jwt.claim.sub', :alice, false);
set role authenticated;
select test.ok(count_my_unencrypted_messages() = 1, 'one legacy message');
select test.ok((select (delete_my_unencrypted_messages()->>'deleted')::int) = 1, 'legacy message deleted');
select test.ok(count_my_unencrypted_messages() = 0, 'no legacy messages left');
reset role;
select test.ok(not exists (select 1 from messages where ciphertext = 'old plaintext'), 'plaintext gone from the database');

-- ---------------------------------------------------------------------------
-- 9. Εξαγωγή και ειδοποιήσεις
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', :alice, false);
set role authenticated;
select test.ok((select bool_and(m->'e2ee' is not null and m->'e2ee' <> 'null'::jsonb)
  from jsonb_array_elements(export_my_data()->'messages') m
  where (m->>'encrypted')::boolean and m->>'deleted_at' is null),
  'export carries encrypted messages with my keys');
select test.fails('select public.push_targets(gen_random_uuid())', 'permission denied', 'users cannot call push_targets');
reset role;

set role service_role;
select test.ok((select (push_targets(m.id)->'payload'->>'body') = '' from messages m
  where m.encryption_version = 1 and m.deleted_at is null limit 1),
  'push notification carries no message text');
reset role;

-- ---------------------------------------------------------------------------
-- 10. (0011) Η εγγραφή δουλεύει χωρίς EXECUTE στις trigger functions
-- ---------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'auth_writer_test') then
    create role auth_writer_test nologin;
  end if;
end $$;
grant usage on schema auth to auth_writer_test;
grant insert on auth.users to auth_writer_test;
update rate_limit_rules set max_count = 100000 where action = 'signup';
set role auth_writer_test;
insert into auth.users (email) values ('trigger-check@example.com');
reset role;
select test.ok(exists (select 1 from profiles where email = 'trigger-check@example.com'),
  'signup trigger still creates the profile without EXECUTE grants');
select test.ok(not has_function_privilege('anon', 'public.handle_new_auth_user()', 'EXECUTE'),
  'anon cannot call the trigger function');

-- ---------------------------------------------------------------------------
-- 11. (0012) Κανένα «ιστορικό» σε νέα συσκευή όποιου είχε ήδη κλειδί
-- ---------------------------------------------------------------------------
-- Η Alice είχε κλειδί για τα μηνύματα του Bob· η δεύτερη συσκευή της
-- (key_alice2) δεν παίρνει παλιά κλειδιά, ακόμα κι αν το ζητήσει ο Bob.
select set_config('request.jwt.claim.sub', :bob, false);
set role authenticated;
select test.ok(not exists (
  select 1 from jsonb_array_elements(my_undelivered_keys((select id from user_devices where public_key = :key_bob))) x
  where x->>'deviceId' = (select id::text from user_devices where public_key = :key_alice2)
), 'no history for a new device of someone who already had a key');
reset role;
