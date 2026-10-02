-- Ένα ελάχιστο «Supabase» πάνω σε σκέτη Postgres, μόνο για τα tests.
--
-- Τα migrations περιμένουν όσα στήνει η Supabase πριν από εμάς: τους ρόλους
-- anon / authenticated / service_role, τα schemas auth και storage, τη
-- συνάρτηση auth.uid(), το pg_net και το publication του Realtime. Εδώ φτιάχνουμε
-- τα ελάχιστα, με τα ίδια ονόματα και την ίδια συμπεριφορά, ώστε τα αρχεία του
-- supabase/migrations να τρέχουν ΑΥΤΟΥΣΙΑ.
--
-- ΔΕΝ πάει ποτέ σε πραγματικό project.

-- Ρόλοι ------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

-- Extensions ---------------------------------------------------------------------
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;

-- auth ---------------------------------------------------------------------------
create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  banned_until timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists auth.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade
);

-- Η Supabase βγάζει το uid από το JWT του αιτήματος. Στα tests το βάζουμε με
-- set_config('request.jwt.claim.sub', ...).
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.role', true), '')
$$;

grant execute on function auth.uid() to anon, authenticated, service_role;
grant execute on function auth.role() to anon, authenticated, service_role;

-- storage --------------------------------------------------------------------------
create schema if not exists storage;
grant usage on schema storage to anon, authenticated, service_role;

create table if not exists storage.buckets (
  id text primary key,
  name text not null unique,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz default now()
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text,
  owner uuid,
  metadata jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (bucket_id, name)
);

alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to anon, authenticated, service_role;
grant select on storage.buckets to anon, authenticated, service_role;

-- Ίδια υλοποίηση με της Supabase: όλα τα κομμάτια του path εκτός από το όνομα αρχείου.
create or replace function storage.foldername(name text)
returns text[]
language plpgsql
as $$
declare
  _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1:array_length(_parts, 1) - 1];
end
$$;

grant execute on function storage.foldername(text) to anon, authenticated, service_role;

-- pg_net ---------------------------------------------------------------------------
-- Το test runner αφαιρεί το «create extension pg_net» από το 0009. Στη θέση του,
-- μια net.http_post που απλώς γράφει τι θα έστελνε.
create schema if not exists net;

create table if not exists net.requests (
  id bigserial primary key,
  url text,
  headers jsonb,
  body jsonb,
  created_at timestamptz default now()
);

create or replace function net.http_post(
  url text,
  body jsonb default '{}'::jsonb,
  params jsonb default '{}'::jsonb,
  headers jsonb default '{}'::jsonb,
  timeout_milliseconds integer default 5000
)
returns bigint
language sql
as $$
  insert into net.requests (url, headers, body) values (url, headers, body) returning id
$$;

-- Realtime -------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end
$$;
