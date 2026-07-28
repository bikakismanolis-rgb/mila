create or replace function public.profile_payload(p public.profiles)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', p.id::text,
    'email', case when p.show_email = 'nobody' then null else p.email end,
    'name', p.display_name,
    'username', coalesce(
      p.username,
      nullif(regexp_replace(lower(split_part(p.email, '@', 1)), '[^a-z0-9_.]', '', 'g'), ''),
      'user'
    ),
    'bio', p.bio,
    'avatar', coalesce(
      p.avatar_path,
      'https://api.dicebear.com/9.x/initials/svg?seed=' || replace(p.display_name, ' ', '%20') || '&backgroundColor=6d5dfc'
    ),
    'privacy', jsonb_build_object(
      'discover', p.discover_by_email,
      'showEmail', p.show_email,
      'receipts', p.read_receipts,
      'online', p.show_online
    )
  )
$$;

create or replace function public.search_profiles(search_term text)
returns setof jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public.profile_payload(p)
  from public.profiles p
  where auth.uid() is not null
    and p.id <> auth.uid()
    and p.discover_by_email <> 'nobody'
    and length(trim(search_term)) >= 2
    and not exists (
      select 1
      from public.blocks b
      where (b.blocker_id = auth.uid() and b.blocked_id = p.id)
         or (b.blocker_id = p.id and b.blocked_id = auth.uid())
    )
    and (
      p.email ilike '%' || trim(search_term) || '%'
      or p.display_name ilike '%' || trim(search_term) || '%'
      or coalesce(p.username, '') ilike '%' || trim(search_term) || '%'
    )
  order by p.display_name
  limit 20
$$;
