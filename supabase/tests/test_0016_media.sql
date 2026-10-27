-- Tests για το 0016: όριο του bucket στα 50 MB, όριο uploads σε MB.
-- Δικοί του χρήστες, ώστε να μην εξαρτάται από τα υπόλοιπα tests. Κάθε
-- upload γίνεται ΩΣ ο χρήστης, όπως από τον browser (το policy του storage).

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

-- ---------------------------------------------------------------------------
-- 1. Bucket
-- ---------------------------------------------------------------------------
select test.ok((select file_size_limit from storage.buckets where id = 'message-media') = 52428800,
  'message-media takes files up to 50 MB (sealed)');
select test.ok((select allowed_mime_types from storage.buckets where id = 'message-media')
  = array['application/octet-stream'], 'still only encrypted files');
select test.ok((select file_size_limit from storage.buckets where id = 'avatars') = 1048576,
  'avatars bucket unchanged');
-- Ένα συνημμένο 50 MB (κρυπτογραφημένο) περνάει και τον έλεγχο του πίνακα.
select test.ok(exists (
  select 1 from pg_constraint
  where conrelid = 'public.attachments'::regclass
    and pg_get_constraintdef(oid) like '%52428800%'), 'attachments accept the sealed size');

select test.ok((select max_count from rate_limit_rules
  where action = 'upload_media_mb' and window_seconds = 3600) = 300, 'hourly MB rule');
select test.ok((select max_count from rate_limit_rules
  where action = 'upload_media_mb' and window_seconds = 86400) = 1000, 'daily MB rule');

-- ---------------------------------------------------------------------------
-- 2. Όριο σε MB
-- ---------------------------------------------------------------------------
-- Πίσω στις αρχικές τιμές (άλλα tests τις χαμηλώνουν).
update rate_limit_rules set max_count = 60 where action = 'upload_media' and window_seconds = 3600;
update rate_limit_rules set max_count = 300 where action = 'upload_media' and window_seconds = 86400;

\set eve  '''e1600000-0000-4000-8000-000000000001'''
\set fay  '''f1600000-0000-4000-8000-000000000002'''

insert into auth.users (id, email, raw_user_meta_data) values
  (:eve, 'eve16@example.org', '{"display_name":"Eve Evans"}'),
  (:fay, 'fay16@example.org', '{"display_name":"Fay Fisher"}');

select set_config('request.jwt.claim.sub', :eve, false);
set role authenticated;
select test.ok(public.upload_allowed('message-media'), 'fresh account can upload');
insert into storage.objects (bucket_id, name, owner, metadata)
values ('message-media', 'e1600000-0000-4000-8000-000000000001/c/one', :eve, '{"size": 52428800}');
reset role;

-- Όσα ανέβηκαν (εδώ τα γράφουμε κατευθείαν, με μέγεθος όπως το γράφει το
-- storage μετά το ανέβασμα): 5 x 50 MB + 49 MB = 299 MB την τελευταία ώρα.
insert into storage.objects (bucket_id, name, owner, metadata)
select 'message-media', 'e1600000-0000-4000-8000-000000000001/c/' || n, :eve::uuid,
       jsonb_build_object('size', case when n = 5 then 49 * 1048576 else 52428800 end)
from generate_series(1, 5) n;
-- Παλιό (πριν από 2 ώρες): δεν μετράει στο ωριαίο.
insert into storage.objects (bucket_id, name, owner, metadata, created_at)
values ('message-media', 'e1600000-0000-4000-8000-000000000001/c/old', :eve, '{"size": 52428800}',
        now() - interval '2 hours');
-- Χωρίς αριθμό στο μέγεθος (π.χ. upload που δεν ολοκληρώθηκε): δεν σπάει τίποτα.
insert into storage.objects (bucket_id, name, owner, metadata)
values ('message-media', 'e1600000-0000-4000-8000-000000000001/c/odd', :eve, '{"size": "?"}');

select set_config('request.jwt.claim.sub', :eve, false);
set role authenticated;
select test.ok(public.upload_allowed('message-media'), '299 MB in the last hour: still allowed');
insert into storage.objects (bucket_id, name, owner, metadata)
values ('message-media', 'e1600000-0000-4000-8000-000000000001/c/last', :eve, '{"size": 2097152}');
select test.ok(not public.upload_allowed('message-media'), '301 MB in the last hour: refused');
select test.fails(format($$insert into storage.objects (bucket_id, name) values ('message-media', %L)$$,
  'e1600000-0000-4000-8000-000000000001/c/more'),
  'row-level security', 'storage policy refuses the next upload');
-- Η φωτογραφία προφίλ έχει δικά της όρια.
select test.ok(public.upload_allowed('avatars'), 'avatars do not count the media MB');
reset role;

-- Μία ώρα μετά: το ωριαίο ξαναγεμίζει, το ημερήσιο (1000 MB) όχι ακόμα.
update storage.objects set created_at = now() - interval '61 minutes'
where name like 'e1600000-0000-4000-8000-000000000001/%' and name <> 'e1600000-0000-4000-8000-000000000001/c/old';
select set_config('request.jwt.claim.sub', :eve, false);
set role authenticated;
select test.ok(public.upload_allowed('message-media'), 'next hour: allowed again');
reset role;

-- Το ημερήσιο: 1000 MB μέσα στη μέρα.
insert into storage.objects (bucket_id, name, owner, metadata, created_at)
select 'message-media', 'e1600000-0000-4000-8000-000000000001/d/' || n, :eve::uuid,
       '{"size": 52428800}'::jsonb, now() - interval '5 hours'
from generate_series(1, 14) n;
select set_config('request.jwt.claim.sub', :eve, false);
set role authenticated;
select test.ok(not public.upload_allowed('message-media'), 'over 1000 MB today: refused');
reset role;

-- Ο καθένας μετράει μόνο τα δικά του.
select set_config('request.jwt.claim.sub', :fay, false);
set role authenticated;
select test.ok(public.upload_allowed('message-media'), 'another account is not affected');
insert into storage.objects (bucket_id, name, owner, metadata)
values ('message-media', 'f1600000-0000-4000-8000-000000000002/c/one', :fay, '{"size": 1048576}');
reset role;

-- Το όριο σε αρχεία ισχύει ακόμα.
update rate_limit_rules set max_count = 1 where action = 'upload_media' and window_seconds = 3600;
select set_config('request.jwt.claim.sub', :fay, false);
set role authenticated;
select test.ok(not public.upload_allowed('message-media'), 'file-count limit still applies');
reset role;
update rate_limit_rules set max_count = 60 where action = 'upload_media' and window_seconds = 3600;

-- Ο ιδιοκτήτης αλλάζει το όριο με ένα update, όπως λέει το migration.
update rate_limit_rules set max_count = 5000 where action = 'upload_media_mb' and window_seconds = 86400;
select set_config('request.jwt.claim.sub', :eve, false);
set role authenticated;
select test.ok(public.upload_allowed('message-media'), 'raised daily MB limit takes effect');
reset role;
update rate_limit_rules set max_count = 1000 where action = 'upload_media_mb' and window_seconds = 86400;

-- Χωρίς σύνδεση: ποτέ.
select test.ok(not has_function_privilege('anon', 'public.upload_allowed(text)', 'execute'),
  'anon cannot call it');
select test.ok(has_function_privilege('authenticated', 'public.upload_allowed(text)', 'execute'),
  'signed-in users can (the storage policy runs as them)');
