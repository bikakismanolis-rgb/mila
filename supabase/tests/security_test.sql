-- Tests ασφαλείας της βάσης: δύο άνθρωποι που μιλάνε, και ένας τρίτος που
-- προσπαθεί να μπει εκεί που δεν πρέπει. Τρέχει με scripts/test-db.sh, πάνω σε
-- καθαρή βάση με όλα τα migrations.
--
-- Κάθε έλεγχος τυπώνει «ok - …». Ο πρώτος που αποτυγχάνει σταματάει τα πάντα
-- με «FAIL: …».

\set ON_ERROR_STOP 1
\set VERBOSITY terse
set client_min_messages = notice;

\set alice 'a1111111-1111-4111-8111-111111111111'
\set bob   'b2222222-2222-4222-8222-222222222222'
\set carol 'c3333333-3333-4333-8333-333333333333'
\set dave  'd4444444-4444-4444-8444-444444444444'
\set erin  'e5555555-5555-4555-8555-555555555555'
\set frank 'f6666666-6666-4666-8666-666666666666'
\set zed   'aaaaaaaa-0000-4000-8000-000000000000'

-- ---------------------------------------------------------------------------
-- Βοηθητικά
-- ---------------------------------------------------------------------------
create schema tests;
grant usage on schema tests to public;

create function tests.ok(cond boolean, what text)
returns void
language plpgsql
as $$
begin
  if cond is distinct from true then
    raise exception 'FAIL: %', what;
  end if;
  raise notice 'ok - %', what;
end
$$;

-- Η εντολή ΠΡΕΠΕΙ να αποτύχει, με σφάλμα που ταιριάζει στο pattern.
create function tests.fails(statement text, pattern text, what text)
returns void
language plpgsql
as $$
declare
  failed_with text;
begin
  begin
    execute statement;
  exception when others then
    failed_with := sqlerrm;
  end;
  if failed_with is null then
    raise exception 'FAIL: % (it succeeded: %)', what, statement;
  end if;
  if failed_with !~* pattern then
    raise exception 'FAIL: % (expected /%/, got: %)', what, pattern, failed_with;
  end if;
  raise notice 'ok - %', what;
end
$$;

-- «Είμαι ο χρήστης Χ»: ό,τι θα έβαζε το JWT του αιτήματος.
create function tests.act_as(who uuid)
returns void
language sql
as $$
  select set_config('request.jwt.claim.sub', coalesce(who::text, ''), false);
$$;

-- ---------------------------------------------------------------------------
-- 0. Λογαριασμοί (το προφίλ το φτιάχνει το trigger, όπως στην εγγραφή)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  (:'alice', 'alice@example.com', '{"display_name": "Alice Smith"}'),
  (:'bob',   'bob@example.com',   '{"display_name": "Bob Jones"}'),
  (:'carol', 'carol@evil.test',   '{"display_name": "Carol Outsider"}'),
  (:'dave',  'dave@example.com',  '{"display_name": "Dave Leaving"}'),
  (:'erin',  'erin@example.com',  '{"display_name": "Erin Hidden"}'),
  (:'frank', 'frank@example.com', '{"display_name": "Frank Open"}'),
  (:'zed',   'zed@example.com',   '{"display_name": "​​Z"}');

update public.profiles set discover_by_email = 'nobody' where id = :'erin';

select tests.ok(
  (select display_name from public.profiles where id = :'zed') = 'New user',
  'a name made of invisible characters falls back to "New user" at signup'
);

-- ---------------------------------------------------------------------------
-- 1. Προφίλ και αναζήτηση
-- ---------------------------------------------------------------------------
set role authenticated;
select tests.act_as(:'carol');

select tests.ok((select count(*) from public.profiles) = 1,
  'a user can read only their own profile row');

select tests.fails($$update public.profiles set email = 'boss@example.com' where id = auth.uid()$$,
  'permission denied', 'nobody can change the email on their profile');

select tests.fails($$update public.profiles set suspended_at = null where id = auth.uid()$$,
  'permission denied', 'nobody can lift their own suspension');

with changed as (
  update public.profiles set bio = 'pwned' where id = :'alice' returning 1
)
select tests.ok((select count(*) from changed) = 0, 'nobody can edit someone else''s profile');

select tests.fails($$update public.profiles set username = 'admin' where id = auth.uid()$$,
  'reserved', 'reserved usernames are refused');

update public.profiles set display_name = E'Ca‮rol​  Outsider' where id = auth.uid();
select tests.ok((select display_name from public.profiles where id = auth.uid()) = 'Carol Outsider',
  'direction overrides, zero-width characters and double spaces are stripped from names');

select tests.ok(
  (select count(*) from public.search_profiles('alice smith')) = 1
  and (select x->>'email' from public.search_profiles('alice smith') x) is null,
  'a stranger finds a name, but not the email behind it');

select tests.ok(not exists (select 1 from public.search_profiles('alice@exa')),
  'part of an email finds nobody');

select tests.ok(
  (select x->>'email' from public.search_profiles('alice@example.com') x) = 'alice@example.com',
  'the whole email finds the person');

select tests.ok(not exists (select 1 from public.search_profiles('erin@example.com')),
  '"who can find me: nobody" hides you even from a full-email search');

select tests.ok(not exists (select 1 from public.search_profiles('__')),
  'search wildcards typed by the user are escaped');

select tests.fails($$select public.save_push_subscription('https://evil.example/fcm.googleapis.com/x', repeat('a', 87), repeat('b', 22))$$,
  'unsupported push service', 'push subscriptions only point at real push services');

-- ---------------------------------------------------------------------------
-- 2. Η Alice γράφει στον Bob (και ο Bob έχει ειδοποιήσεις)
-- ---------------------------------------------------------------------------
reset role;
select tests.act_as(null);
insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
values (:'bob', 'https://fcm.googleapis.com/fcm/send/bob-device', repeat('p', 87), repeat('a', 22));

set role authenticated;
select tests.act_as(:'alice');

select public.start_direct_conversation(:'bob') as ab \gset
select public.send_message(:'ab', 'hello bob', gen_random_uuid()) ->> 'id' as m1 \gset

select tests.ok((select count(*) from public.list_messages(:'ab')) = 1,
  'the sender sees her message');

select tests.ok(public.start_direct_conversation(:'bob') = :'ab',
  'starting a chat with the same person reopens the same conversation');

reset role;
select tests.ok(
  (select count(*) from net.requests where body->>'message_id' = :'m1') = 1
  and (select headers->>'x-mila-secret' from net.requests where body->>'message_id' = :'m1')
      = (select webhook_secret from public.push_config),
  'a new message triggers exactly one signed call to the push function');
set role authenticated;

-- ---------------------------------------------------------------------------
-- 3. Η Carol (άσχετη) προσπαθεί να μπει στη συνομιλία τους
-- ---------------------------------------------------------------------------
select tests.act_as(:'carol');

select tests.ok(not exists (select 1 from public.list_messages(:'ab')),
  'outsider: list_messages returns nothing');
select tests.ok(not exists (select 1 from public.messages where conversation_id = :'ab'),
  'outsider: the messages table hides the conversation');
select tests.ok(public.get_message(:'m1') is null,
  'outsider: get_message returns nothing');
select tests.ok(not exists (select 1 from public.conversations where id = :'ab'),
  'outsider: the conversation row is invisible');
select tests.ok(not exists (select 1 from public.conversation_members where conversation_id = :'ab'),
  'outsider: the member list is invisible');
select tests.ok(not exists (select 1 from public.search_messages('hello bob')),
  'outsider: message search finds nothing');
select tests.ok(public.export_my_data()::text not like '%hello bob%',
  'outsider: data export contains nothing of theirs');

select tests.fails(format('select public.send_message(%L, %L, gen_random_uuid())', :'ab', 'spam'),
  'cannot send messages', 'outsider cannot send into the conversation');
select tests.fails(format(
    'insert into public.messages (conversation_id, sender_id, ciphertext, client_message_id) values (%L, auth.uid(), %L, gen_random_uuid())',
    :'ab', 'spam'),
  'row-level security', 'outsider cannot insert a message directly');
select tests.fails(format(
    'insert into public.messages (conversation_id, sender_id, ciphertext, client_message_id) values (%L, %L, %L, gen_random_uuid())',
    :'ab', :'alice', 'forged'),
  'row-level security', 'nobody can send a message in someone else''s name');
select tests.fails(format('insert into public.conversation_members (conversation_id, user_id) values (%L, auth.uid())', :'ab'),
  'row-level security', 'outsider cannot add themselves as a member');
select tests.fails(format('select public.mark_conversation_read(%L)', :'ab'),
  'not a member', 'outsider cannot mark it as read');
select tests.fails(format('select public.react_to_message(%L, %L)', :'m1', U&'\+01F44D'),
  'not found', 'outsider cannot react');
select tests.fails(format('select public.delete_message(%L, true)', :'m1'),
  'not found', 'outsider cannot delete a message');
select tests.fails(format('select public.respond_to_request(%L, false)', :'ab'),
  'not a member', 'outsider cannot reject the request');
select tests.fails(format('insert into public.message_receipts (message_id, user_id, read_at) values (%L, auth.uid(), now())', :'m1'),
  'permission denied', 'outsider cannot write read receipts');
select tests.fails(format('insert into public.attachments (message_id, conversation_id, storage_path, encrypted_metadata, byte_size) values (%L, %L, %L, %L, 10)',
    :'m1', :'ab', :'carol' || '/x/evil.pdf', '{}'),
  'row-level security', 'outsider cannot hang a file on someone else''s message');

select tests.fails($$select public.push_targets(gen_random_uuid())$$,
  'permission denied', 'browser cannot call push_targets');
select tests.fails($$select public.push_config_get()$$,
  'permission denied', 'browser cannot read the push keys');
select tests.fails($$select * from public.push_config$$,
  'permission denied', 'browser cannot read the push_config table');
select tests.fails($$select * from public.push_subscriptions$$,
  'permission denied', 'browser cannot read device subscriptions');
select tests.fails($$select * from moderation.reports_overview$$,
  'permission denied', 'browser cannot reach the moderation schema');
select tests.fails(format('select moderation.suspend_user(%L)', :'alice'),
  'permission denied', 'browser cannot suspend anyone');

-- ---------------------------------------------------------------------------
-- 4. Ο Bob δέχεται το αίτημα
-- ---------------------------------------------------------------------------
select tests.act_as(:'bob');

select tests.ok(
  (select c->'others'->0->>'email' from public.list_conversations() c where c->>'id' = :'ab') is null,
  'before accepting, the recipient does not see the sender''s email');

select public.respond_to_request(:'ab', true);

select tests.ok(
  (select c->'others'->0->>'email' from public.list_conversations() c where c->>'id' = :'ab') = 'alice@example.com',
  'after accepting, contacts see each other''s email');

select tests.fails(format('select public.delete_message(%L, true)', :'m1'),
  'only the sender', 'the recipient cannot delete a message for everyone');

select public.delete_message(:'m1', false);
select tests.ok(not exists (select 1 from public.list_messages(:'ab')),
  '"delete for me" hides it from me');

select tests.act_as(:'alice');
select tests.ok((select count(*) from public.list_messages(:'ab')) = 1,
  '"delete for me" leaves it for the other person');
select tests.fails(format('select public.respond_to_request(%L, true)', :'ab'),
  'own request', 'the sender cannot accept her own request');

-- ---------------------------------------------------------------------------
-- 5. Συνημμένα
-- ---------------------------------------------------------------------------
reset role;
select tests.act_as(null);
insert into storage.objects (bucket_id, name, owner, metadata) values
  ('message-media', :'alice' || '/' || :'ab' || '/photo.png', :'alice',
   '{"size": 2048, "mimetype": "image/png"}'),
  ('message-media', :'carol' || '/x/report.pdf', :'carol',
   '{"size": 4096, "mimetype": "application/pdf"}');

set role authenticated;
select tests.act_as(:'carol');

select public.start_direct_conversation(:'alice') as ca \gset

select tests.ok(not exists (
    select 1 from storage.objects where name = :'alice' || '/' || :'ab' || '/photo.png'),
  'outsider cannot see someone else''s files');
select tests.fails(format(
    'insert into storage.objects (bucket_id, name) values (%L, %L)',
    'message-media', :'alice' || '/planted.png'),
  'row-level security', 'outsider cannot upload into someone else''s folder');

select tests.fails(format('select public.send_message(%L, %L, gen_random_uuid(), null, %L::jsonb)',
    :'ca', '', jsonb_build_object('path', :'alice' || '/' || :'ab' || '/photo.png')),
  'does not belong', 'nobody can send someone else''s file');
select tests.fails(format('select public.send_message(%L, %L, gen_random_uuid(), null, %L::jsonb)',
    :'ca', '', jsonb_build_object('path', :'carol' || '/x/missing.png', 'size', 10)),
  'attachment not found', 'an attachment must exist in storage');

select public.send_message(:'ca', '', gen_random_uuid(), null,
  jsonb_build_object('path', :'carol' || '/x/report.pdf', 'name', 'report.pdf',
                     'size', 1, 'mime', 'text/html')) -> 'attachment' as att \gset

select tests.ok(
  (:'att'::jsonb ->> 'size')::int = 4096 and :'att'::jsonb ->> 'mime' = 'application/pdf',
  'size and type of an attachment come from storage, not from the browser');

-- ---------------------------------------------------------------------------
-- 6. Αίτημα που δεν έχει γίνει δεκτό: μέχρι 10 μηνύματα
-- ---------------------------------------------------------------------------
do $$
declare
  conversation uuid := (
    select (c->>'id')::uuid from public.list_conversations() c where c->>'requestStatus' = 'pending'
  );
begin
  for i in 1..9 loop
    perform public.send_message(conversation, 'hi ' || i, gen_random_uuid());
  end loop;
end
$$;

select tests.fails(format('select public.send_message(%L, %L, gen_random_uuid())', :'ca', 'one more'),
  'wait until your request is accepted', 'a stranger can send at most 10 messages before the request is accepted');

-- ---------------------------------------------------------------------------
-- 7. Μπλοκάρισμα
-- ---------------------------------------------------------------------------
select tests.act_as(:'bob');
insert into public.blocks (blocker_id, blocked_id) values (auth.uid(), :'alice');
select tests.fails(format('insert into public.blocks (blocker_id, blocked_id) values (%L, %L)', :'alice', :'carol'),
  'row-level security', 'nobody can block on someone else''s behalf');

select tests.act_as(:'alice');
select tests.fails(format('select public.send_message(%L, %L, gen_random_uuid())', :'ab', 'are you there'),
  'cannot send messages', 'a blocked person cannot send');
select tests.ok(not exists (select 1 from public.search_profiles('bob jones')),
  'a blocked person cannot find the blocker');

select tests.act_as(:'bob');
delete from public.blocks where blocker_id = auth.uid() and blocked_id = :'alice';

-- ---------------------------------------------------------------------------
-- 8. Ομάδες
-- ---------------------------------------------------------------------------
select tests.act_as(:'alice');
select public.create_group('Friends', array[:'bob']::uuid[]) as grp \gset

select tests.fails(format('select public.add_group_members(%L, array[%L]::uuid[])', :'grp', :'carol'),
  'only add people you already chat with', 'only accepted contacts can be added to a group');

select tests.act_as(:'bob');
select tests.fails(format('select public.rename_group(%L, %L)', :'grp', 'Hijacked'),
  'only a group admin', 'a member cannot rename the group');
select tests.fails(format('select public.add_group_members(%L, array[%L]::uuid[])', :'grp', :'frank'),
  'only a group admin', 'a member cannot add people');

select tests.act_as(:'carol');
select tests.fails(format('select public.remove_group_member(%L, %L)', :'grp', :'bob'),
  'group not found', 'an outsider cannot remove group members');
select tests.ok(not exists (select 1 from public.list_messages(:'grp')),
  'an outsider cannot read the group');

-- ---------------------------------------------------------------------------
-- 9. Αναφορές
-- ---------------------------------------------------------------------------
insert into public.reports (reporter_id, reported_id, reason, resolved_at)
values (auth.uid(), :'alice', 'spam', now());

reset role;
select tests.ok(
  (select resolved_at from public.reports where reporter_id = :'carol') is null,
  'a reporter cannot mark their own report as handled');
set role authenticated;

select tests.ok((select count(*) from public.reports) = 0,
  'reports are not readable from the app, not even your own');
select tests.fails($$update public.reports set reason = 'changed'$$,
  'permission denied', 'reports cannot be edited after sending');
select tests.fails(format('insert into public.reports (reporter_id, reported_id, reason) values (auth.uid(), auth.uid(), %L)', 'me'),
  'cannot report yourself', 'nobody can report themselves');
select tests.fails(format('insert into public.reports (reporter_id, reported_id, reason) values (%L, %L, %L)', :'alice', :'bob', 'framed'),
  'row-level security', 'nobody can file a report in someone else''s name');

do $$
begin
  for i in 1..19 loop
    insert into public.reports (reporter_id, reported_id, reason)
    values (auth.uid(), 'a1111111-1111-4111-8111-111111111111', 'again ' || i);
  end loop;
end
$$;
select tests.fails(format('insert into public.reports (reporter_id, reported_id, reason) values (auth.uid(), %L, %L)', :'alice', 'too many'),
  'too many reports', 'at most 20 reports a day');

-- ---------------------------------------------------------------------------
-- 10. Αναστολή από τον διαχειριστή
-- ---------------------------------------------------------------------------
reset role;
select tests.act_as(null);
select moderation.suspend_user(:'carol', 'spam reports');

select tests.ok(
  (select banned_until from auth.users where id = :'carol') > now() + interval '50 years',
  'suspension bans the login as well');
select tests.ok((select count(*) from moderation.reports_overview where reported_id = :'alice') = 20,
  'the moderation view lists the reports');

set role authenticated;
select tests.act_as(:'carol');
select tests.ok(public.is_active_user() = false, 'a suspended account is not active');
select tests.fails(format('select public.send_message(%L, %L, gen_random_uuid())', :'ca', 'still here?'),
  'cannot send messages', 'a suspended account cannot send, even with a token that has not expired');
select tests.fails(format('select public.start_direct_conversation(%L)', :'frank'),
  'not authenticated', 'a suspended account cannot start conversations');
select tests.fails(format('insert into storage.objects (bucket_id, name) values (%L, %L)',
    'message-media', :'carol' || '/x/after-ban.png'),
  'row-level security', 'a suspended account cannot upload');

select tests.act_as(:'frank');
select tests.ok(not exists (select 1 from public.search_profiles('carol')),
  'a suspended account does not show up in search');
select tests.fails(format('select public.start_direct_conversation(%L)', :'carol'),
  'user not found', 'nobody can start a conversation with a suspended account');

reset role;
select moderation.unsuspend_user(:'carol');
set role authenticated;
select tests.act_as(:'carol');
select tests.ok(public.is_active_user(), 'lifting the suspension restores the account');

-- ---------------------------------------------------------------------------
-- 11. Διαγραφή λογαριασμού
-- ---------------------------------------------------------------------------
select tests.act_as(:'dave');
select public.start_direct_conversation(:'alice') as da \gset
select public.send_message(:'da', 'goodbye', gen_random_uuid()) ->> 'id' as dm \gset
select public.delete_my_account();

select tests.fails(format('select public.send_message(%L, %L, gen_random_uuid())', :'da', 'ghost'),
  'cannot send messages', 'a deleted account cannot keep sending with its old token');

reset role;
select tests.ok(not exists (select 1 from auth.users where id = :'dave'),
  'account deletion removes the login');
select tests.ok(
  (select display_name = 'Deleted user' and deleted_at is not null and email like '%@deleted.invalid'
   from public.profiles where id = :'dave'),
  'account deletion leaves only an anonymous tombstone');

set role authenticated;
select tests.act_as(:'alice');
select tests.ok(
  (select (c->'others'->0->>'deleted')::boolean from public.list_conversations() c where c->>'id' = :'da'),
  'the other person sees a deleted user');

-- ---------------------------------------------------------------------------
-- 12. Όριο ανεβασμάτων
-- ---------------------------------------------------------------------------
reset role;
insert into storage.objects (bucket_id, name, owner, metadata)
select 'message-media', :'bob' || '/bulk/' || g || '.png', :'bob', '{"size": 1}'
from generate_series(1, 200) g;
set role authenticated;

select tests.act_as(:'bob');
select tests.fails(format('insert into storage.objects (bucket_id, name) values (%L, %L)',
    'message-media', :'bob' || '/bulk/201.png'),
  'row-level security', 'at most 200 uploads a day');

-- ---------------------------------------------------------------------------
-- 13. Όριο νέων συνομιλιών
-- ---------------------------------------------------------------------------
reset role;
insert into public.conversations (kind, created_by, request_from, request_status)
select 'direct', :'carol', :'carol', 'pending' from generate_series(1, 29);
set role authenticated;

select tests.act_as(:'carol');
select tests.fails(format('select public.start_direct_conversation(%L)', :'frank'),
  'too many new conversations', 'at most 30 new conversations a day');

-- ---------------------------------------------------------------------------
-- 14. Όριο μηνυμάτων ανά λεπτό
-- ---------------------------------------------------------------------------
select tests.act_as(:'alice');
do $$
declare
  conversation uuid := (
    select (c->>'id')::uuid from public.list_conversations() c where c->>'name' = 'Friends'
  );
  sent integer := 0;
  stopped_by text;
begin
  for i in 1..40 loop
    begin
      perform public.send_message(conversation, 'flood ' || i, gen_random_uuid());
      sent := sent + 1;
    exception when others then
      stopped_by := sqlerrm;
      exit;
    end;
  end loop;
  perform tests.ok(stopped_by ~* 'too many messages' and sent < 30,
    format('message flood is stopped at 30 a minute (stopped after %s more)', sent));
end
$$;

-- ---------------------------------------------------------------------------
-- 15. Ρυθμίσεις storage
-- ---------------------------------------------------------------------------
reset role;
select tests.ok(
  (select file_size_limit = 15728640
      and 'image/jpeg' = any(allowed_mime_types)
      and not ('text/html' = any(allowed_mime_types))
      and not ('image/svg+xml' = any(allowed_mime_types))
   from storage.buckets where id = 'message-media'),
  'storage accepts at most 15 MB and no HTML or SVG');

\echo
\echo 'Every security check passed.'
