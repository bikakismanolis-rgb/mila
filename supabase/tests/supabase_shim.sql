-- ΜΟΝΟ ΓΙΑ ΤΟΠΙΚΑ TESTS. Μιμείται τα κομμάτια της Supabase που χρειάζονται τα
-- migrations (ρόλοι, auth.uid(), storage, realtime publication, pg_net), ώστε
-- να τρέχουν σε σκέτη PostgreSQL. Ποτέ στην πραγματική βάση.

-- Οι ρόλοι είναι ανά server, όχι ανά βάση: μπορεί να υπάρχουν από προηγούμενο τρέξιμο.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

create schema extensions;
create extension pgcrypto schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;
do $$ begin execute format('alter database %I set search_path = "$user", public, extensions', current_database()); end $$;
set search_path = "$user", public, extensions;

-- auth -----------------------------------------------------------------------
create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;

-- storage --------------------------------------------------------------------
create schema storage;
grant usage on schema storage to anon, authenticated, service_role;
create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text not null,
  owner uuid,
  metadata jsonb,
  created_at timestamptz not null default now(),
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to authenticated, service_role;
grant select on storage.buckets to authenticated, service_role;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$$;
grant execute on function storage.foldername(text) to anon, authenticated, service_role;

-- realtime / pg_net ----------------------------------------------------------
create publication supabase_realtime;
create schema net;
create table net.calls (id bigserial primary key, url text, body jsonb, at timestamptz default now());
create function net.http_post(url text, headers jsonb default '{}', body jsonb default '{}',
                              timeout_milliseconds integer default 5000)
returns bigint language sql as $$
  insert into net.calls (url, body) values (url, body) returning id
$$;
