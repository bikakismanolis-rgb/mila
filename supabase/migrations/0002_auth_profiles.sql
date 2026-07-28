drop policy if exists profiles_insert_self on public.profiles;

create policy profiles_insert_self
on public.profiles
for insert
to authenticated
with check (id = auth.uid());

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  chosen_name text;
begin
  chosen_name := coalesce(
    nullif(new.raw_user_meta_data->>'display_name', ''),
    nullif(new.raw_user_meta_data->>'name', ''),
    split_part(new.email, '@', 1),
    'New user'
  );

  if char_length(chosen_name) < 2 then
    chosen_name := 'New user';
  end if;

  insert into public.profiles (
    id,
    email,
    display_name,
    bio,
    discover_by_email,
    show_email,
    read_receipts,
    show_online
  )
  values (
    new.id,
    lower(new.email),
    left(chosen_name, 60),
    '',
    'everyone',
    'chat',
    true,
    true
  )
  on conflict (id) do update
  set
    email = excluded.email,
    display_name = excluded.display_name,
    updated_at = now();

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

insert into public.profiles (
  id,
  email,
  display_name,
  bio,
  discover_by_email,
  show_email,
  read_receipts,
  show_online
)
select
  u.id,
  lower(u.email),
  left(
    coalesce(
      nullif(u.raw_user_meta_data->>'display_name', ''),
      nullif(u.raw_user_meta_data->>'name', ''),
      split_part(u.email, '@', 1),
      'New user'
    ),
    60
  ),
  '',
  'everyone',
  'chat',
  true,
  true
from auth.users u
where u.email is not null
on conflict (id) do nothing;



