create extension if not exists pgcrypto;

create type public.conversation_kind as enum ('direct', 'group');
create type public.request_status as enum ('pending', 'accepted', 'rejected');
create type public.member_role as enum ('member', 'admin');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  display_name text not null check (char_length(display_name) between 2 and 60),
  username text unique check (username ~ '^[a-z0-9_.]{3,24}$'),
  avatar_path text,
  bio text not null default '' check (char_length(bio) <= 160),
  discover_by_email text not null default 'everyone' check (discover_by_email in ('everyone','contacts','nobody')),
  show_email text not null default 'chat' check (show_email in ('chat','contacts','nobody')),
  read_receipts boolean not null default true,
  show_online boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  kind public.conversation_kind not null default 'direct',
  name text,
  avatar_path text,
  request_from uuid references public.profiles(id),
  request_status public.request_status not null default 'pending',
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.member_role not null default 'member',
  last_read_at timestamptz,
  joined_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id),
  ciphertext text not null,
  encryption_version smallint not null default 0,
  client_message_id uuid not null,
  reply_to uuid references public.messages(id),
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  unique (sender_id, client_message_id)
);
create index messages_conversation_created_idx on public.messages(conversation_id, created_at desc);

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  storage_path text not null unique,
  encrypted_metadata text not null,
  byte_size bigint not null check (byte_size between 1 and 52428800),
  created_at timestamptz not null default now()
);

create table public.message_receipts (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  delivered_at timestamptz,
  read_at timestamptz,
  primary key (message_id, user_id)
);

create table public.blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id),
  reported_id uuid not null references public.profiles(id),
  reason text not null check (char_length(reason) between 1 and 500),
  created_at timestamptz not null default now()
);

create or replace function public.is_conversation_member(target uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from conversation_members where conversation_id = target and user_id = auth.uid()) $$;

alter table public.profiles enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
alter table public.attachments enable row level security;
alter table public.message_receipts enable row level security;
alter table public.blocks enable row level security;
alter table public.reports enable row level security;

create policy profiles_read_authenticated on public.profiles for select to authenticated using (true);
create policy profiles_update_self on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy conversations_read_members on public.conversations for select to authenticated using (public.is_conversation_member(id));
create policy members_read_members on public.conversation_members for select to authenticated using (public.is_conversation_member(conversation_id));
create policy messages_read_members on public.messages for select to authenticated using (public.is_conversation_member(conversation_id));
create policy messages_insert_members on public.messages for insert to authenticated with check (sender_id = auth.uid() and public.is_conversation_member(conversation_id));
create policy attachments_read_members on public.attachments for select to authenticated using (public.is_conversation_member(conversation_id));
create policy attachments_insert_members on public.attachments for insert to authenticated with check (public.is_conversation_member(conversation_id));
create policy receipts_members on public.message_receipts for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy blocks_self on public.blocks for all to authenticated using (blocker_id = auth.uid()) with check (blocker_id = auth.uid());
create policy reports_insert_self on public.reports for insert to authenticated with check (reporter_id = auth.uid());

insert into storage.buckets (id, name, public, file_size_limit)
values ('message-media', 'message-media', false, 52428800)
on conflict (id) do nothing;

create policy media_insert_authenticated on storage.objects for insert to authenticated
with check (bucket_id = 'message-media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy media_read_conversation_members on storage.objects for select to authenticated
using (
  bucket_id = 'message-media'
  and exists (
    select 1 from public.attachments a
    where a.storage_path = storage.objects.name
      and public.is_conversation_member(a.conversation_id)
  )
);
