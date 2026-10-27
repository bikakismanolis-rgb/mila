-- Tests για το 0014: ονόματα, αναφορές, συντονιστές, αναστολή, εξαγωγή και
-- διαγραφή λογαριασμού. Δικοί του χρήστες, ώστε να μην εξαρτάται από τα
-- υπόλοιπα tests. Κάθε έλεγχος τρέχει ΩΣ ο χρήστης, όπως από τον browser· τα
-- εργαλεία του ιδιοκτήτη τρέχουν όπως στον SQL editor (χωρίς auth.uid()).

\set ON_ERROR_STOP 1
set client_min_messages = warning;

create schema if not exists test;
grant usage on schema test to authenticated, service_role, anon;

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

grant execute on all functions in schema test to authenticated, service_role, anon;

-- Τα προηγούμενα tests χαμηλώνουν κάποια όρια για να τα ελέγξουν. Πίσω στις
-- αρχικές τιμές, με άδειο ιστορικό.
update rate_limit_rules set max_count = 30 where action = 'message' and window_seconds = 60;
update rate_limit_rules set max_count = 10 where action = 'contact_request' and window_seconds = 3600;
update rate_limit_rules set max_count = 10 where action = 'report';
delete from rate_limit_events;
-- Όπως ο SQL editor: κανένας συνδεδεμένος χρήστης.
select set_config('request.jwt.claim.sub', '', false);

\set fay '''66666666-0000-4000-8000-000000000006'''
\set gus '''77777777-0000-4000-8000-000000000007'''
\set hal '''88888888-0000-4000-8000-000000000008'''
\set ivy '''99999999-0000-4000-8000-000000000009'''
\set jon '''aaaaaaaa-0000-4000-8000-00000000000a'''
\set lea '''bbbbbbbb-0000-4000-8000-00000000000b'''

insert into auth.users (id, email, raw_user_meta_data) values
  (:fay, 'fay@example.net', '{"display_name":"Fay Fisher"}'),
  (:gus, 'gus@example.net', '{"display_name":"Gus Green"}'),
  (:hal, 'hal@example.net', '{"display_name":"Hal Hart"}'),
  (:ivy, 'ivy@example.net', '{"display_name":"Ivy Irwin"}'),
  (:jon, 'jon@example.net', '{"display_name":"Jon Jones"}'),
  (:lea, 'lea@example.net', '{"display_name":"Lea Lane"}');

\set k_fay '''ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff6'''
\set k_gus '''gggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggg7'''
\set k_hal '''hhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhh8'''
\set k_jon '''jjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjjja'''
\set wrapped '''wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww'''
\set envelope '''{"iv":"aaaaaaaaaaaaaaaa","ct":"bbbbbbbbbbbbbbbbbbbbbbbb"}'''
\set excerpt '''[12:01] Gus Green: you will regret this'''

-- ---------------------------------------------------------------------------
-- 1. Indexes
-- ---------------------------------------------------------------------------
select test.ok((select count(*) from pg_indexes where schemaname = 'public' and indexname in (
  'attachments_message_idx', 'conversation_members_user_idx', 'blocks_blocked_idx',
  'reports_reporter_created_idx', 'reports_reported_idx', 'reports_message_idx',
  'reports_conversation_idx', 'reports_status_created_idx')) = 8, 'missing indexes are there');

-- ---------------------------------------------------------------------------
-- 2. Ονόματα
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('cccccccc-0000-4000-8000-00000000000c', 'kim@example.net', '{"display_name":"Admin"}'),
  ('dddddddd-0000-4000-8000-00000000000d', 'support@example.net', '{"display_name":"Mila Support"}'),
  ('eeeeeeee-0000-4000-8000-00000000000e', 'lee@example.net',
   jsonb_build_object('display_name', 'Ann' || chr(8203) || chr(8238) || '   Lee' || chr(10)));
select test.ok((select display_name from profiles where email = 'kim@example.net') = 'kim',
  'reserved name at sign-up falls back to the email name');
select test.ok((select display_name from profiles where email = 'support@example.net') = 'New user',
  'reserved email name falls back to New user');
select test.ok((select display_name from profiles where email = 'lee@example.net') = 'Ann Lee',
  'invisible and bidi characters are removed at sign-up');

select set_config('request.jwt.claim.sub', 'cccccccc-0000-4000-8000-00000000000c', false);
set role authenticated;
select ensure_my_profile('Mila');
select test.fails($$update profiles set display_name = 'Μίλα' where id = auth.uid()$$,
  'reserved', 'Greek spelling of the app name is reserved');
select test.fails($$update profiles set display_name = 'ΑDMIN' where id = auth.uid()$$,
  'reserved', 'look-alike letters do not get around it');
select test.fails($$update profiles set display_name = 'Διαχειριστής' where id = auth.uid()$$,
  'reserved', 'Greek administrator is reserved');
select test.fails($$update profiles set display_name = 'υποστηριξη' where id = auth.uid()$$,
  'reserved', 'Greek support is reserved, without accents too');
select test.fails($$update profiles set display_name = 'Mila Team' where id = auth.uid()$$,
  'reserved', 'brand plus role is reserved');
select test.fails($$update profiles set display_name = 'M' || chr(8203) || 'oderator' where id = auth.uid()$$,
  'reserved', 'zero-width characters do not get around it');
select test.fails($$update profiles set display_name = chr(8203) || 'x ' where id = auth.uid()$$,
  '2 to 60', 'too short after cleaning');
select test.fails(format('update profiles set display_name = %L where id = auth.uid()', repeat('a', 61)),
  '2 to 60', 'too long');
update profiles set display_name = '  Kim' || chr(8203) || chr(9) || '  Kowalski ' where id = auth.uid();
select test.ok((select display_name from profiles where id = auth.uid()) = 'Kim Kowalski',
  'name is trimmed and whitespace collapsed');
update profiles set display_name = 'Mila Kunis' where id = auth.uid();
select test.ok((select display_name from profiles where id = auth.uid()) = 'Mila Kunis',
  'a real name that only contains Mila is allowed');
select test.fails($$update profiles set username = 'admin' where id = auth.uid()$$,
  'reserved', 'reserved username');
update profiles set username = 'kimk' where id = auth.uid();
reset role;

-- Όποιος λεγόταν ήδη έτσι πριν από τον κανόνα, κρατάει το όνομα και αλλάζει
-- ελεύθερα τα υπόλοιπα (οι Ρυθμίσεις στέλνουν όνομα και bio μαζί).
alter table profiles disable trigger profiles_before_write;
update profiles set display_name = 'Mila' where email = 'kim@example.net';
alter table profiles enable trigger profiles_before_write;
select set_config('request.jwt.claim.sub', 'cccccccc-0000-4000-8000-00000000000c', false);
set role authenticated;
update profiles set display_name = 'Mila', bio = 'still me' where id = auth.uid();
select test.ok((select bio from profiles where id = auth.uid()) = 'still me', 'old reserved name does not block saving');
reset role;

-- ---------------------------------------------------------------------------
-- Συσκευές και συνομιλίες
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', :fay, false);
set role authenticated;
select register_device(:k_fay, 'Phone');
reset role;
select set_config('request.jwt.claim.sub', :gus, false);
set role authenticated;
select register_device(:k_gus, 'Phone');
reset role;
select set_config('request.jwt.claim.sub', :hal, false);
set role authenticated;
select register_device(:k_hal, 'Phone');
reset role;
select set_config('request.jwt.claim.sub', :jon, false);
set role authenticated;
select register_device(:k_jon, 'Phone');
reset role;

select id as d_fay from user_devices where public_key = :k_fay \gset
select id as d_gus from user_devices where public_key = :k_gus \gset
select id as d_hal from user_devices where public_key = :k_hal \gset
select id as d_jon from user_devices where public_key = :k_jon \gset

-- Fay–Gus, Hal–Fay, Hal–Gus, Fay–Jon: όλες αποδεκτές.
select set_config('request.jwt.claim.sub', :fay, false);
set role authenticated;
select start_direct_conversation(:gus) as fg \gset
select start_direct_conversation(:jon) as fj \gset
reset role;
select set_config('request.jwt.claim.sub', :hal, false);
set role authenticated;
select start_direct_conversation(:fay) as hf \gset
select start_direct_conversation(:gus) as hg \gset
reset role;
select set_config('request.jwt.claim.sub', :gus, false);
set role authenticated;
select respond_to_request(:'fg', true);
select respond_to_request(:'hg', true);
reset role;
select set_config('request.jwt.claim.sub', :fay, false);
set role authenticated;
select respond_to_request(:'hf', true);
reset role;
select set_config('request.jwt.claim.sub', :jon, false);
set role authenticated;
select respond_to_request(:'fj', true);
reset role;
select set_config('request.jwt.claim.sub', :hal, false);
set role authenticated;
select create_group('Club', array[:fay, :gus]::uuid[]) as grp \gset
reset role;

-- Ο Gus γράφει στη Fay και στην ομάδα· η Fay στον Gus.
select set_config('request.jwt.claim.sub', :gus, false);
set role authenticated;
select jsonb_agg(jsonb_build_object('device', k->>'deviceId', 'key', :wrapped)) as keys_fg
from jsonb_array_elements(conversation_device_keys(:'fg')) k \gset
select jsonb_agg(jsonb_build_object('device', k->>'deviceId', 'key', :wrapped)) as keys_grp
from jsonb_array_elements(conversation_device_keys(:'grp')) k \gset
select send_message(:'fg', :envelope, gen_random_uuid(), :'d_gus', :'keys_fg'::jsonb)->>'id' as m_gus \gset
select send_message(:'grp', :envelope, gen_random_uuid(), :'d_gus', :'keys_grp'::jsonb)->>'id' as m_gus_grp \gset
reset role;
select set_config('request.jwt.claim.sub', :fay, false);
set role authenticated;
select send_message(:'fg', :envelope, gen_random_uuid(), :'d_fay', :'keys_fg'::jsonb)->>'id' as m_fay \gset
reset role;

-- ---------------------------------------------------------------------------
-- 3. Αναφορές
-- ---------------------------------------------------------------------------
select count(*) as report_pushes_before from net.calls where body->>'action' = 'report' \gset

select set_config('request.jwt.claim.sub', :fay, false);
set role authenticated;
-- Μήνυμα, με απόσπασμα (η Fay τσέκαρε «να σταλεί το κείμενο»).
select submit_report('Threats', null, null, :'m_gus', :excerpt) as r_msg \gset
-- Η αναφορά δεν διαβάζεται από τον browser, ούτε από αυτόν που την έκανε.
select test.fails('select count(*) from public.reports', 'permission denied', 'reporter cannot read reports');
select test.fails('select excerpt from public.reports', 'permission denied', 'nobody reads excerpts directly');
-- Αποτυχίες.
select test.fails(format('select public.submit_report(%L, null, null, %L)', '  ', :'m_gus'),
  'reason must be', 'a reason is required');
select test.fails(format('select public.submit_report(%L, null, null, %L)', 'mine', :'m_fay'),
  'cannot report yourself', 'own message cannot be reported');
select test.fails(format('select public.submit_report(%L, %L)', 'me', :fay),
  'cannot report yourself', 'cannot report myself');
select test.fails(format('select public.submit_report(%L, %L, null, %L)', 'x', :hal, :'m_gus'),
  'nothing to report', 'message and person must match');
select test.fails(format('select public.submit_report(%L, %L, null, null, %L)', 'x', :gus, 'some text'),
  'nothing to report', 'an excerpt needs a conversation');
select test.fails(format('select public.submit_report(%L, null, null, null, %L)', 'x', repeat('a', 4001)),
  'too long', 'excerpt length is limited');
select test.fails($$select public.submit_report('x')$$, 'nothing to report', 'something must be reported');
-- Ομάδα (κανένας συγκεκριμένος άνθρωπος) και άνθρωπος (από τα στοιχεία επαφής).
select submit_report('Spam group', null, :'grp') as r_grp \gset
select submit_report('Fake profile', :gus, :'fg') as r_person \gset
-- Η παλιά «Αναφορά» του προηγούμενου site: σκέτο INSERT με τρεις στήλες.
insert into reports (reporter_id, reported_id, reason) values (:fay, :gus, 'legacy report');
select test.fails(format($$insert into reports (reporter_id, reported_id, reason, excerpt) values (%L, %L, 'x', 'forged')$$, :fay, :gus),
  'permission denied', 'direct insert cannot attach an excerpt');
select test.fails(format($$insert into reports (reporter_id, reported_id, reason, status) values (%L, %L, 'x', 'dismissed')$$, :fay, :gus),
  'permission denied', 'direct insert cannot choose a status');
select test.fails(format($$insert into reports (reporter_id, reported_id, reason) values (%L, %L, 'x')$$, :gus, :fay),
  'row-level security', 'cannot report in someone else''s name');
reset role;

-- Ο Ivy δεν έχει καμία σχέση με αυτούς: δεν αναφέρει ξένα μηνύματα ή ids.
select set_config('request.jwt.claim.sub', :ivy, false);
set role authenticated;
select test.fails(format('select public.submit_report(%L, null, null, %L)', 'x', :'m_gus'),
  'nothing to report', 'outsider cannot report a message they cannot see');
select test.fails(format('select public.submit_report(%L, %L)', 'x', :gus),
  'nothing to report', 'outsider cannot report a random user id');
select test.fails(format('select public.submit_report(%L, null, %L)', 'x', :'grp'),
  'nothing to report', 'outsider cannot report a group they are not in');
reset role;

select test.ok((select reported_id = :gus and conversation_id = :'fg'::uuid and message_id = :'m_gus'::uuid
                  and excerpt = :excerpt and status = 'open' and reviewed_at is null
                from reports where id = :'r_msg'), 'message report: sender, conversation and excerpt');
select test.ok((select reported_id is null and conversation_id = :'grp'::uuid from reports where id = :'r_grp'),
  'group report has no single person');
select test.ok((select reported_id = :gus and excerpt is null from reports where id = :'r_person'),
  'person report without excerpt');
select test.ok((select bool_and(status = 'open') from reports where reporter_id = :fay), 'reports start open');

-- Όριο «report» (10 την ημέρα): ισχύει και για το νέο RPC.
update rate_limit_rules set max_count =
  (select count(*) from rate_limit_events where action = 'report' and subject = :fay) where action = 'report';
select set_config('request.jwt.claim.sub', :fay, false);
set role authenticated;
select test.fails(format('select public.submit_report(%L, %L)', 'again', :gus),
  'rate limit exceeded: report', 'report limit still applies');
reset role;
update rate_limit_rules set max_count = 10 where action = 'report';

-- ---------------------------------------------------------------------------
-- 4. Συντονιστές: ειδοποίηση χωρίς περιεχόμενο
-- ---------------------------------------------------------------------------
select test.ok((select count(*) from net.calls where body->>'action' = 'report') = :report_pushes_before,
  'no moderators = no push request');

insert into moderators (user_id) values (:hal);
insert into push_subscriptions (user_id, endpoint, p256dh, auth)
values (:hal, 'https://fcm.googleapis.com/fcm/send/moderator-hal-0000000000', repeat('p', 87), repeat('a', 22));

select set_config('request.jwt.claim.sub', :fay, false);
set role authenticated;
select submit_report('Insults', null, null, :'m_gus_grp', '[13:00] Gus Green: idiot') as r_grp_msg \gset
select test.fails('select count(*) from public.moderators', 'permission denied', 'users cannot read moderators');
select test.fails(format('insert into public.moderators (user_id) values (%L)', :fay),
  'permission denied', 'users cannot make themselves moderators');
select test.fails(format('select public.push_report_targets(%L)', :'r_grp_msg'),
  'permission denied', 'users cannot read push targets');
reset role;

select test.ok((select count(*) from net.calls where body->>'action' = 'report') = :report_pushes_before + 1,
  'a new report queues one push request');
select test.ok((select body = jsonb_build_object('action', 'report', 'report_id', :'r_grp_msg')
                from net.calls where body->>'action' = 'report' order by id desc limit 1),
  'the request carries only the report id');
set role service_role;
select test.ok((select push_report_targets(:'r_grp_msg')->'payload') = '{"type": "report"}'::jsonb,
  'push payload has no names and no text');
select test.ok((select jsonb_array_length(push_report_targets(:'r_grp_msg')->'subscriptions')) = 1,
  'push goes to the moderator');
reset role;

-- Ο συντονιστής που κάνει ο ίδιος αναφορά δεν ειδοποιείται για αυτήν.
select set_config('request.jwt.claim.sub', :hal, false);
set role authenticated;
select submit_report('Spam', null, :'grp') as r_by_hal \gset
reset role;
select test.ok((select count(*) from net.calls where body->>'action' = 'report') = :report_pushes_before + 1,
  'a moderator is not notified of their own report');
set role service_role;
select test.ok((select jsonb_array_length(push_report_targets(:'r_by_hal')->'subscriptions')) = 0,
  'own report has no push targets');
reset role;

-- ---------------------------------------------------------------------------
-- 5. Τα εργαλεία του ιδιοκτήτη: μόνο από τον SQL editor
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', :hal, false);
set role authenticated;
select test.fails('select * from public.moderation_reports()', 'permission denied', 'moderation_reports is not for users');
select test.fails(format('select public.moderation_set_report_status(%L, %L)', :'r_msg', 'dismissed'),
  'permission denied', 'moderation_set_report_status is not for users');
select test.fails(format('select public.moderation_suspend(%L, %L)', :gus, 'x'),
  'permission denied', 'moderation_suspend is not for users');
select test.fails(format('select public.moderation_unsuspend(%L)', :gus),
  'permission denied', 'moderation_unsuspend is not for users');
reset role;
set role anon;
select test.fails('select * from public.moderation_reports()', 'permission denied', 'not for anon either');
reset role;
set role service_role;
select test.fails(format('select public.moderation_suspend(%L)', :gus), 'permission denied', 'not for the service role');
reset role;
-- Και αν κάποτε ξεφύγει ένα grant: με token χρήστη αρνούνται.
select set_config('request.jwt.claim.sub', :hal, false);
select test.fails(format('select public.moderation_suspend(%L)', :gus), 'only from the sql editor',
  'refuses a call that carries a user token');
select test.ok((select count(*) from moderation_reports('all')) = 0, 'reports list is empty with a user token');

-- Όπως στον SQL editor.
select set_config('request.jwt.claim.sub', '', false);
select test.ok((select count(*) from moderation_reports() where reporter_id = :fay) = 5, 'owner sees the open reports');
select test.ok((select excerpt = :excerpt and about = 'message' and reporter_name = 'Fay Fisher'
                  and reported_name = 'Gus Green' and reported_email = 'gus@example.net'
                  and message_sent_at is not null
                from moderation_reports() where id = :'r_msg'), 'report shows names, email and excerpt');
select test.ok((select about = 'group' and group_name = 'Club' and reported_id is null
                from moderation_reports() where id = :'r_grp'), 'group report shows the group');
select test.ok((select about from moderation_reports() where id = :'r_person') = 'person', 'person report');
select test.ok((select reports_against_them from moderation_reports() where id = :'r_msg') >= 4,
  'shows how many reports there are against them');

select moderation_set_report_status(:'r_grp', 'dismissed');
select test.ok((select status = 'dismissed' and reviewed_at is not null from reports where id = :'r_grp'),
  'status change is recorded');
select test.ok(not exists (select 1 from moderation_reports() where id = :'r_grp'), 'dismissed is no longer open');
select test.ok(exists (select 1 from moderation_reports('dismissed') where id = :'r_grp'), 'filter by status');
select moderation_set_report_status(:'r_grp', 'open');
select test.ok((select status = 'open' and reviewed_at is null from reports where id = :'r_grp'), 'reopened');
select test.fails(format('select public.moderation_set_report_status(%L, %L)', :'r_grp', 'closed'),
  'status must be', 'only known statuses');
select test.fails(format('select public.moderation_set_report_status(%L, %L)', gen_random_uuid(), 'reviewed'),
  'no report', 'unknown report');

-- ---------------------------------------------------------------------------
-- 6. Αναστολή
-- ---------------------------------------------------------------------------
insert into push_subscriptions (user_id, endpoint, p256dh, auth)
values (:gus, 'https://fcm.googleapis.com/fcm/send/suspended-gus-000000000', repeat('p', 87), repeat('a', 22));
select set_config('request.jwt.claim.sub', :gus, false);
set role authenticated;
select start_call(:'fg', false, :'d_gus')->>'id' as gus_call \gset
reset role;

select set_config('request.jwt.claim.sub', '', false);
select test.fails(format('select public.moderation_suspend(%L)', gen_random_uuid()), 'no active account', 'unknown user');
select moderation_suspend(:gus, 'Threats against another user (report of 27/10).') as suspended \gset
select test.ok((:'suspended'::jsonb)->>'name' = 'Gus Green', 'suspend answers with the name');
select test.ok(not exists (select 1 from push_subscriptions where user_id = :gus), 'suspended devices get no pushes');
select test.ok(not exists (select 1 from call_heartbeats where user_id = :gus), 'suspended leaves calls');

select set_config('request.jwt.claim.sub', :gus, false);
set role authenticated;
-- Βλέπει ότι είναι σε αναστολή, και γιατί.
select test.ok((select suspended_at is not null and suspended_reason like 'Threats%'
                from profiles where id = auth.uid()), 'suspended user sees the reason');
select test.ok(not is_active_user(), 'suspended is not active');
select test.ok(not is_conversation_member(:'fg'), 'suspended is no longer a member for reads');
-- Δεν γράφει.
select test.fails(format('select public.send_message(%L, %L, gen_random_uuid(), %L, %L::jsonb)', :'fg', :envelope, :'d_gus', :'keys_fg'),
  'cannot send', 'suspended cannot send');
select test.fails(format('select public.start_call(%L, true, %L)', :'fg', :'d_gus'),
  'not authenticated', 'suspended cannot call');
select test.fails(format('select public.join_call(%L, %L)', :'gus_call', :'d_gus'),
  'not authenticated', 'suspended cannot join a call');
select test.ok((select count(*) from search_profiles('fay@example.net')) = 0, 'suspended cannot search');
select test.fails(format('select public.start_direct_conversation(%L)', :ivy),
  'not authenticated', 'suspended cannot start a conversation');
select test.fails(format('select public.submit_report(%L, %L, %L)', 'revenge', :fay, :'fg'),
  'not authenticated', 'suspended cannot file reports');
select test.fails(format($$insert into reports (reporter_id, reported_id, reason) values (%L, %L, 'revenge')$$, :gus, :fay),
  'account suspended', 'suspended cannot file reports the old way');
select test.fails(format('select public.delete_message(%L, true)', :'m_gus'),
  'account suspended', 'suspended cannot delete evidence for everyone');
select test.fails(format('select public.delete_message(%L, false)', :'m_gus'),
  'account suspended', 'suspended cannot hide messages either');
select test.fails(format('select public.react_to_message(%L, %L)', :'m_fay', chr(128077)),
  'cannot send', 'suspended cannot react');
select test.fails(format('select public.mark_conversation_read(%L)', :'fg'),
  'account suspended', 'suspended cannot mark read');
select test.fails($$update profiles set display_name = 'Fay Fisher' where id = auth.uid()$$,
  'account suspended', 'suspended cannot change their name');
select test.fails($$update profiles set suspended_at = null where id = auth.uid()$$,
  'permission denied|account suspended', 'suspended cannot lift their own suspension');
select test.fails('select public.touch_presence(true)', 'account suspended', 'suspended cannot show as online');
select test.fails(format($$select public.set_conversation_prefs(%L, '{"pinned": true}')$$, :'fg'),
  'not a member', 'suspended cannot change chat settings');
select test.fails(format('select public.register_device(%L)', :k_gus), 'not authenticated', 'suspended cannot register devices');
select test.fails($$select public.save_push_subscription('https://fcm.googleapis.com/fcm/send/again-gus-00000000', repeat('p', 87), repeat('a', 22))$$,
  'account suspended', 'suspended cannot subscribe to pushes again');
reset role;
-- Ως admin ομάδας: δεν μετονομάζει, δεν βγάζει άλλους (ο Gus γίνεται admin για το test).
select set_config('request.jwt.claim.sub', '', false);
update conversation_members set role = 'admin' where conversation_id = :'grp' and user_id = :gus;
select set_config('request.jwt.claim.sub', :gus, false);
set role authenticated;
select test.fails(format('select public.rename_group(%L, %L)', :'grp', 'Hacked'), 'account suspended', 'suspended cannot rename a group');
select test.fails(format('select public.remove_group_member(%L, %L)', :'grp', :fay), 'account suspended', 'suspended cannot remove people');
-- Δεν διαβάζει.
select test.fails('select count(*) from public.list_conversations()', 'account suspended', 'suspended cannot list chats');
select test.fails(format('select count(*) from public.list_messages(%L)', :'fg'), 'account suspended', 'suspended cannot read messages');
select test.fails(format('select public.get_message(%L)', :'m_fay'), 'account suspended', 'suspended cannot fetch a message');
select test.fails(format('select count(*) from public.list_calls(%L)', :'fg'), 'account suspended', 'suspended cannot read calls');
select test.fails(format('select public.get_presence(%L)', :fay), 'account suspended', 'suspended cannot watch presence');
select test.ok((select count(*) from messages) = 0, 'no messages through RLS (or Realtime)');
select test.ok((select count(*) from conversations) = 0, 'no conversations through RLS');
select test.ok((select count(*) from conversation_members) = 0, 'no members through RLS');
select test.ok((select count(*) from calls) = 0, 'no calls through RLS');
select test.ok((select get_call(:'gus_call')) is null, 'no single call either');
-- Μπορεί: να μπλοκάρει, να βγάλει τη συσκευή του από τις ειδοποιήσεις, να
-- κατεβάσει τα δεδομένα του.
insert into blocks (blocker_id, blocked_id) values (:gus, :fay);
delete from blocks where blocker_id = :gus;
select remove_push_subscription('https://fcm.googleapis.com/fcm/send/none');
select test.ok((select export_my_data()->'profile'->'suspension'->>'reason') like 'Threats%',
  'suspended can download their data, with the suspension in it');
reset role;
select set_config('request.jwt.claim.sub', '', false);
update conversation_members set role = 'member' where conversation_id = :'grp' and user_id = :gus;

-- Οι άλλοι συνεχίζουν κανονικά, και του γράφουν.
select set_config('request.jwt.claim.sub', :fay, false);
set role authenticated;
select test.ok((select count(*) from list_messages(:'fg')) >= 2, 'others still read the chat');
select test.ok((select send_message(:'fg', :envelope, gen_random_uuid(), :'d_fay', :'keys_fg'::jsonb)) is not null,
  'others can still write to a suspended person');
reset role;

-- Άρση.
select set_config('request.jwt.claim.sub', '', false);
select test.ok((select moderation_unsuspend(:gus)->>'email') = 'gus@example.net', 'unsuspend');
select set_config('request.jwt.claim.sub', :gus, false);
set role authenticated;
select test.ok(is_active_user(), 'active again');
select test.ok((select count(*) from list_conversations()) >= 3, 'chats are back');
select test.ok((select send_message(:'fg', :envelope, gen_random_uuid(), :'d_gus', :'keys_fg'::jsonb)) is not null,
  'can send again');
select test.ok((select suspended_at is null and suspended_reason is null from profiles where id = auth.uid()),
  'suspension is cleared');
reset role;

-- ---------------------------------------------------------------------------
-- 7. Εξαγωγή: κλήσεις, ρυθμίσεις συνομιλιών, «σε σύνδεση»
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', :jon, false);
set role authenticated;
select start_call(:'fj', true, :'d_jon')->>'id' as jon_call \gset
select set_conversation_prefs(:'fj', jsonb_build_object('mutedUntil', now() + interval '1 hour'));
select touch_presence(true);
reset role;
insert into push_subscriptions (user_id, endpoint, p256dh, auth)
values (:jon, 'https://fcm.googleapis.com/fcm/send/jon-device-000000000000', repeat('p', 87), repeat('a', 22));
insert into moderators (user_id) values (:jon);

select set_config('request.jwt.claim.sub', :fay, false);
set role authenticated;
select set_conversation_prefs(:'fg', '{"archived": true}');
select export_my_data() as fay_export \gset
reset role;
select test.ok((:'fay_export'::jsonb)->>'format_version' = '3', 'new export format');
select test.ok(exists (
  select 1 from jsonb_array_elements((:'fay_export'::jsonb)->'calls') c
  where c->>'conversation_id' = :'fj' and not (c->>'i_called')::boolean
    and c->'participants' @> '[{"name": "Jon Jones"}]'
), 'export has calls I was in, with the others by name');
select test.ok(exists (
  select 1 from jsonb_array_elements((:'fay_export'::jsonb)->'conversation_prefs') p
  where p->>'conversation_id' = :'fg' and (p->>'archived')::boolean
), 'export has my chat settings');
select test.ok((:'fay_export'::jsonb)->'profile'->'presence' ? 'show_online', 'export has presence settings');
select test.ok(jsonb_array_length((:'fay_export'::jsonb)->'reports_filed') >= 5, 'export has my reports');
select test.ok(exists (
  select 1 from jsonb_array_elements((:'fay_export'::jsonb)->'reports_filed') r where r->>'excerpt' = :excerpt
), 'with what I sent in them');

-- Ο Gus δεν βλέπει στην εξαγωγή του τις αναφορές ΕΝΑΝΤΙΟΝ του.
select set_config('request.jwt.claim.sub', :gus, false);
set role authenticated;
select test.ok((select export_my_data()::text not like '%' || :excerpt || '%'), 'reports against me are not in my export');
reset role;

-- ---------------------------------------------------------------------------
-- 8. Διαγραφή λογαριασμού
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', :jon, false);
set role authenticated;
select jsonb_agg(jsonb_build_object('device', k->>'deviceId', 'key', :wrapped)) as keys_fj
from jsonb_array_elements(conversation_device_keys(:'fj')) k \gset
select send_message(:'fj', :envelope, gen_random_uuid(), :'d_jon', :'keys_fj'::jsonb)->>'id' as m_jon \gset
select delete_my_account();
reset role;

select test.ok((select display_name = 'Deleted user' and last_seen_at is null and online_until is null
                  and deleted_at is not null from profiles where id = :jon), 'presence is cleared');
select test.ok(not exists (select 1 from conversation_prefs where user_id = :jon), 'chat settings are gone');
select test.ok(not exists (select 1 from call_heartbeats where user_id = :jon), 'call heartbeats are gone');
select test.ok(not exists (select 1 from push_subscriptions where user_id = :jon), 'push subscriptions are gone');
select test.ok(not exists (select 1 from moderators where user_id = :jon), 'no longer a moderator');

-- Το ιστορικό της Fay μένει όπως ήταν.
select set_config('request.jwt.claim.sub', :fay, false);
set role authenticated;
select test.ok((select get_message(:'m_jon')->>'senderName') = 'Deleted user', 'his messages stay, from Deleted user');
select test.ok(exists (select 1 from list_calls(:'fj') c where c->>'id' = :'jon_call'
                         and c->>'callerId' = :jon), 'his calls stay in my history');
select test.ok((select count(*) from list_conversations() c where c->>'id' = :'fj') = 1, 'the chat stays');
reset role;

-- Και σε αναστολή, ο ίδιος μπορεί να διαγράψει τον λογαριασμό του (GDPR).
select set_config('request.jwt.claim.sub', :lea, false);
set role authenticated;
select touch_presence(true);
reset role;
select set_config('request.jwt.claim.sub', '', false);
select moderation_suspend(:lea, 'Spam');
select set_config('request.jwt.claim.sub', :lea, false);
set role authenticated;
select test.ok((select (delete_my_account()->>'deleted')::boolean), 'suspended can still delete their account');
reset role;
select test.ok((select deleted_at is not null and display_name = 'Deleted user' from profiles where id = :lea),
  'suspended account is erased');
select test.ok(not exists (select 1 from auth.users where id = :lea), 'login is gone');
select test.ok(current_setting('mila.erasing_account', true) is distinct from 'on',
  'the deletion switch does not outlive its transaction');

select set_config('request.jwt.claim.sub', '', false);
