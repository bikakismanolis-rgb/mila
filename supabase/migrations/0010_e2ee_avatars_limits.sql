-- 0010: Κρυπτογράφηση από άκρη σε άκρη, φωτογραφία προφίλ, όρια χρήσης, και
-- αναζήτηση που δεν δείχνει ξένους. Idempotent — μπορεί να ξανατρέξει με
-- ασφάλεια. Προϋποθέτει το 0009.
--
-- ΣΥΜΒΑΤΟΤΗΤΑ: ΔΕΝ είναι συμβατό με το προηγούμενο site. Μετά από αυτό η βάση
-- δεν δέχεται πια μηνύματα σε απλό κείμενο, οπότε το παλιό site δεν μπορεί να
-- στείλει. Τρέξε το και ανέβασε το καινούργιο site αμέσως μετά.
--
-- ΤΙ ΚΑΝΕΙ
--
--  1. Όρια χρήσης (rate limits). Ένας πίνακας κανόνων που αλλάζει χωρίς κώδικα,
--     και μία function που τους εφαρμόζει μέσα σε κάθε RPC.
--  2. Όριο στις εγγραφές, για όλο το app (trigger στο auth.users).
--  3. Ποιος βλέπει τι από ένα προφίλ. Ο άγνωστος βλέπει μόνο όνομα.
--  4. Αναζήτηση: ο άγνωστος σε βρίσκει ΜΟΝΟ αν γράψει ολόκληρο το email σου.
--     Με κομμάτι ονόματος βγαίνουν μόνο οι επαφές σου.
--  5. Αιτήματα συνομιλίας: όριο ανά ώρα/ημέρα, όριο εκκρεμών, και μέχρι 3
--     μηνύματα πριν σε δεχτεί ο άλλος.
--  6. Φωτογραφία προφίλ σε private bucket, ορατή μόνο σε επαφές.
--  7. Συσκευές και δημόσια κλειδιά τους.
--  8. Μηνύματα κρυπτογραφημένα στη συσκευή του αποστολέα. Η βάση κρατάει μόνο
--     ciphertext και ένα «τυλιγμένο» κλειδί ανά συσκευή παραλήπτη.
--  9. Όρια σε αντιδράσεις, ομάδες, αναφορές και uploads.
--
-- ΤΙ ΔΕΝ ΚΡΥΠΤΟΓΡΑΦΕΙΤΑΙ (το ξέρει ο server): ποιος μιλάει με ποιον και πότε,
-- ονόματα ομάδων, αντιδράσεις (emoji), μέγεθος συνημμένων, ονόματα και
-- φωτογραφίες προφίλ. Τα παλιά μηνύματα (encryption_version = 0) μένουν όπως
-- ήταν, σε απλό κείμενο, μέχρι να τα σβήσει ο αποστολέας τους.

-- ---------------------------------------------------------------------------
-- 1. Όρια χρήσης
-- ---------------------------------------------------------------------------
-- Κάθε κανόνας: «όχι πάνω από max_count για αυτή την ενέργεια μέσα σε
-- window_seconds». Πολλοί κανόνες για την ίδια ενέργεια = ισχύουν όλοι.
-- per_user = false σημαίνει ένα κοινό όριο για όλο το app (π.χ. εγγραφές).
-- Για να αλλάξεις ένα όριο: update public.rate_limit_rules set max_count = ...
create table if not exists public.rate_limit_rules (
  action text not null,
  window_seconds integer not null check (window_seconds between 1 and 2592000),
  max_count integer not null check (max_count >= 0),
  per_user boolean not null default true,
  primary key (action, window_seconds)
);

create table if not exists public.rate_limit_events (
  id bigint generated always as identity primary key,
  action text not null,
  subject uuid,
  weight integer not null default 1 check (weight > 0),
  created_at timestamptz not null default now()
);
create index if not exists rate_limit_events_lookup
  on public.rate_limit_events (action, subject, created_at);
create index if not exists rate_limit_events_created
  on public.rate_limit_events (created_at);

alter table public.rate_limit_rules enable row level security;
alter table public.rate_limit_events enable row level security;
revoke all on public.rate_limit_rules from anon, authenticated;
revoke all on public.rate_limit_events from anon, authenticated;

-- Οι αρχικές τιμές. «on conflict do nothing»: αν τις έχεις αλλάξει με το χέρι,
-- ένα δεύτερο τρέξιμο του migration δεν τις γυρίζει πίσω.
insert into public.rate_limit_rules (action, window_seconds, max_count, per_user) values
  -- Μηνύματα: φτάνει για κανονική κουβέντα, κόβει τα bots.
  ('message',          60,     30, true),
  ('message',        3600,    600, true),
  ('message',       86400,   3000, true),
  -- Νέα αιτήματα συνομιλίας σε αγνώστους.
  ('contact_request', 3600,    10, true),
  ('contact_request',86400,    30, true),
  -- Αναζήτηση με ολόκληρο email: κάθε απάντηση λέει «αυτό το email έχει
  -- λογαριασμό». Χωρίς όριο, κάποιος δοκιμάζει λίστες με email.
  ('user_lookup',     3600,    30, true),
  ('user_lookup',    86400,   100, true),
  -- Εισαγωγή επαφών: πόσα αρχεία, και πόσα email συνολικά.
  ('contact_import', 86400,     5, true),
  ('contact_match',  86400,  1000, true),
  ('reaction',          60,    60, true),
  ('report',         86400,    10, true),
  ('group_create',   86400,    10, true),
  ('group_add',      86400,   200, true),
  ('device_register',86400,    10, true),
  ('avatar_change',  86400,    10, true),
  -- Uploads: μετριούνται από τα ίδια τα αρχεία στο storage, όχι από events.
  ('upload_media',    3600,    60, true),
  ('upload_media',   86400,   300, true),
  ('upload_avatar',  86400,    20, true),
  -- Εγγραφές σε ΟΛΟ το app. Η Supabase έχει επιπλέον δικό της όριο ανά IP.
  ('signup',          3600,    60, false),
  ('signup',         86400,   500, false)
on conflict (action, window_seconds) do nothing;

-- Πετάει σφάλμα αν η ενέργεια ξεπερνάει κάποιο όριο, αλλιώς την καταγράφει.
-- Τρέχει μέσα στη συναλλαγή του RPC: αν το RPC αποτύχει για άλλο λόγο, η
-- καταγραφή ακυρώνεται κι αυτή, άρα μετράνε μόνο ενέργειες που έγιναν.
create or replace function public.hit_rate_limit(p_action text, p_weight integer default 1)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  rule record;
  used bigint;
begin
  for rule in
    select * from rate_limit_rules where action = p_action order by window_seconds
  loop
    -- Δύο ταυτόχρονα αιτήματα του ίδιου χρήστη μπαίνουν στη σειρά, αλλιώς θα
    -- μετρούσαν και τα δύο «29» και θα περνούσαν και τα δύο το 30.
    perform pg_advisory_xact_lock(hashtextextended(
      p_action || ':' || case when rule.per_user then coalesce(me::text, '-') else '*' end, 0));

    select coalesce(sum(e.weight), 0) into used
    from rate_limit_events e
    where e.action = p_action
      and (not rule.per_user or e.subject is not distinct from me)
      and e.created_at > now() - make_interval(secs => rule.window_seconds);

    if used + greatest(p_weight, 1) > rule.max_count then
      raise exception 'Rate limit exceeded: %', p_action
        using errcode = 'P0001',
              hint = 'Try again in ' || rule.window_seconds || ' seconds';
    end if;
  end loop;

  insert into rate_limit_events (action, subject, weight)
  values (p_action, me, greatest(p_weight, 1));

  -- Καθάρισμα στην τύχη, περίπου μία φορά στις 200. Κανένας κανόνας δεν
  -- κοιτάζει πιο πίσω από 30 ημέρες.
  if random() < 0.005 then
    delete from rate_limit_events where created_at < now() - interval '31 days';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Όριο εγγραφών
-- ---------------------------------------------------------------------------
-- Πριν από κάθε νέο λογαριασμό (και με Google). Αν το όριο έχει γεμίσει, η
-- Supabase απαντάει «Database error saving new user» και το app το μεταφράζει.
create or replace function public.throttle_signups()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.hit_rate_limit('signup', 1);
  return new;
end;
$$;

drop trigger if exists throttle_signups on auth.users;
create trigger throttle_signups
before insert on auth.users
for each row execute function public.throttle_signups();

-- ---------------------------------------------------------------------------
-- 3. Ποιος βλέπει τι από ένα προφίλ
-- ---------------------------------------------------------------------------
-- Φωτογραφία και bio βλέπουν: ο ίδιος, όσοι μοιράζονται μαζί του αποδεκτή
-- συνομιλία (ατομική ή ομάδα), και όποιος έλαβε αίτημα ΑΠΟ αυτόν (για να
-- αποφασίσει αν θα το δεχτεί). Όποιος ΣΤΕΙΛΕ αίτημα δεν βλέπει τίποτα από τον
-- παραλήπτη μέχρι να γίνει δεκτό. Ο άγνωστος από την αναζήτηση βλέπει μόνο όνομα.
create or replace function public.can_see_profile(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select target = auth.uid() or exists (
    select 1
    from conversation_members mine
    join conversation_members theirs
      on theirs.conversation_id = mine.conversation_id
    join conversations c on c.id = mine.conversation_id
    where mine.user_id = auth.uid()
      and theirs.user_id = target
      and (
        c.request_status = 'accepted'
        or (c.request_status = 'pending' and c.request_from = target)
      )
  )
$$;

-- Ίδιο σχήμα με πριν, με τρεις αλλαγές:
--  * 'avatar' (URL της dicebear.com) -> 'avatarPath'. Η παλιά εικόνα ερχόταν
--    από τρίτο server, που μάθαινε το όνομα του χρήστη και την IP όποιου
--    άνοιγε τη συνομιλία. Τα αρχικά τα ζωγραφίζει πλέον το ίδιο το app.
--  * bio και φωτογραφία μόνο σε όποιον το δικαιούται (βήμα 3).
--  * 'hasKeys': έχει ενεργή συσκευή, άρα μπορεί να λάβει κρυπτογραφημένο μήνυμα.
create or replace function public.profile_payload(p public.profiles)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', p.id::text,
    'email', case
      when p.id = auth.uid() then p.email
      when p.deleted_at is not null then null
      when p.show_email <> 'nobody' and public.is_contact(p.id) then p.email
      else null
    end,
    'name', p.display_name,
    'username', coalesce(
      p.username,
      case
        when p.deleted_at is not null then null
        when p.id = auth.uid()
          or (p.show_email <> 'nobody' and public.is_contact(p.id))
        then coalesce(
          nullif(regexp_replace(lower(split_part(p.email, '@', 1)), '[^a-z0-9_.]', '', 'g'), ''),
          'user'
        )
      end
    ),
    'bio', case when p.deleted_at is null and public.can_see_profile(p.id) then p.bio else '' end,
    'avatarPath', case
      when p.deleted_at is null and public.can_see_profile(p.id) then p.avatar_path
    end,
    'deleted', p.deleted_at is not null,
    'privacy', case when p.id = auth.uid() then jsonb_build_object(
      'discover', p.discover_by_email,
      'showEmail', p.show_email,
      'receipts', p.read_receipts,
      'online', p.show_online
    ) end
  )
$$;

-- ---------------------------------------------------------------------------
-- 4. Αναζήτηση ανθρώπων
-- ---------------------------------------------------------------------------
--  * Επαφές σου (αποδεκτή ατομική συνομιλία): με κομμάτι ονόματος, username,
--    ή email (αν δεν το κρύβουν).
--  * Οποιοσδήποτε άλλος: ΜΟΝΟ με ολόκληρο το email του, και μόνο αν έχει
--    «Ποιος με βρίσκει: Όλοι». Το «gi» δεν βγάζει πια κάθε Γιώργο του app.
--  * Κάθε αναζήτηση με ολόκληρο email μετράει στο όριο user_lookup.
-- Γίνεται plpgsql (όχι stable sql) γιατί γράφει στο rate_limit_events.
drop function if exists public.search_profiles(text);
create or replace function public.search_profiles(search_term text)
returns setof jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  exact text := lower(trim(coalesce(search_term, '')));
  pattern text;
begin
  if auth.uid() is null or not public.is_active_user() or length(exact) < 2 then
    return;
  end if;

  pattern := '%' || replace(replace(replace(exact, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  -- Μοιάζει με ολόκληρο email: αυτό είναι το «ρωτάω αν υπάρχει» και μετράει.
  if exact ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    perform public.hit_rate_limit('user_lookup', 1);
  end if;

  return query
  select
    case
      -- Έγραψε ολόκληρο το email: το ξέρει ήδη, δεν έχει νόημα να το κρύψουμε.
      when lower(p.email) = exact then public.profile_payload(p) || jsonb_build_object('email', p.email)
      else public.profile_payload(p)
    end
  from public.profiles p
  where p.id <> auth.uid()
    and p.deleted_at is null
    and not exists (
      select 1 from public.blocks b
      where (b.blocker_id = auth.uid() and b.blocked_id = p.id)
         or (b.blocker_id = p.id and b.blocked_id = auth.uid())
    )
    and (
      (
        public.is_contact(p.id)
        and (
          p.display_name ilike pattern
          or coalesce(p.username, '') ilike pattern
          or (p.show_email <> 'nobody' and p.email ilike pattern)
          or lower(p.email) = exact
        )
      )
      or (p.discover_by_email = 'everyone' and lower(p.email) = exact)
    )
  order by p.display_name
  limit 20;
end;
$$;

-- Ταίριασμα επαφών από αρχείο: ίδιο με πριν, με όριο. Κάθε hash μετράει σαν
-- μία αναζήτηση, αλλιώς το αρχείο θα ήταν παράκαμψη του user_lookup.
drop function if exists public.match_contacts(text[]);
create or replace function public.match_contacts(email_hashes text[])
returns setof jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  wanted text[];
begin
  if auth.uid() is null or not public.is_active_user() then
    return;
  end if;

  select coalesce(array_agg(distinct h), '{}') into wanted
  from unnest(coalesce(email_hashes, '{}')) h
  where h ~ '^[0-9a-f]{64}$';

  if coalesce(array_length(wanted, 1), 0) = 0 then
    return;
  end if;
  if array_length(wanted, 1) > 500 then
    raise exception 'Too many contacts in one file' using errcode = '22023';
  end if;

  perform public.hit_rate_limit('contact_import', 1);
  perform public.hit_rate_limit('contact_match', array_length(wanted, 1));

  return query
  select public.profile_payload(p) || jsonb_build_object('email', p.email)
  from profiles p
  where p.id <> auth.uid()
    and p.deleted_at is null
    and p.discover_by_email = 'everyone'
    and encode(digest(lower(p.email), 'sha256'), 'hex') = any(wanted)
    and not exists (
      select 1 from blocks b
      where (b.blocker_id = auth.uid() and b.blocked_id = p.id)
         or (b.blocker_id = p.id and b.blocked_id = auth.uid())
    )
  limit 200;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Αιτήματα συνομιλίας με όριο
-- ---------------------------------------------------------------------------
-- Ίδιο με το 0008, με δύο προσθήκες στο σημείο που φτιάχνεται ΝΕΟ αίτημα:
--  * όριο contact_request ανά ώρα και ημέρα,
--  * όχι πάνω από 30 αιτήματα που περιμένουν απάντηση ταυτόχρονα.
-- Το άνοιγμα υπάρχουσας συνομιλίας δεν μετράει.
create or replace function public.start_direct_conversation(target_user uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  existing uuid;
  new_id uuid;
  waiting integer;
begin
  if me is null or not public.is_active_user() then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if target_user = me then
    raise exception 'Cannot start a conversation with yourself' using errcode = '22023';
  end if;

  if not exists (select 1 from profiles where id = target_user and deleted_at is null) then
    raise exception 'User not found' using errcode = 'P0002';
  end if;

  if exists (
    select 1 from blocks
    where (blocker_id = me and blocked_id = target_user)
       or (blocker_id = target_user and blocked_id = me)
  ) then
    raise exception 'Conversation not allowed' using errcode = '42501';
  end if;

  select c.id into existing
  from conversations c
  join conversation_members a on a.conversation_id = c.id and a.user_id = me
  join conversation_members b on b.conversation_id = c.id and b.user_id = target_user
  where c.kind = 'direct'
  limit 1;

  if existing is not null then
    return existing;
  end if;

  if not exists (
    select 1 from profiles p
    where p.id = target_user and p.discover_by_email = 'everyone'
  ) and not exists (
    select 1
    from conversation_members mine
    join conversation_members theirs on theirs.conversation_id = mine.conversation_id
    where mine.user_id = me and theirs.user_id = target_user
  ) then
    raise exception 'Conversation not allowed' using errcode = '42501';
  end if;

  select count(*) into waiting
  from conversations c
  where c.kind = 'direct' and c.request_from = me and c.request_status = 'pending';
  if waiting >= 30 then
    raise exception 'Too many pending requests' using errcode = 'P0001';
  end if;

  perform public.hit_rate_limit('contact_request', 1);

  insert into conversations (kind, created_by, request_from, request_status)
  values ('direct', me, me, 'pending')
  returning id into new_id;

  insert into conversation_members (conversation_id, user_id)
  values (new_id, me), (new_id, target_user);

  return new_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Φωτογραφία προφίλ
-- ---------------------------------------------------------------------------
-- Private bucket. Το app στέλνει ΜΟΝΟ μια μικρή εικόνα (256x256) που ξαναζωγράφισε
-- το ίδιο, άρα χωρίς EXIF (τοποθεσία, μοντέλο κινητού). Τη διαβάζει μόνο όποιος
-- δικαιούται να δει το προφίλ (βήμα 3), με βραχύβιο signed URL.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 1048576, array['image/jpeg', 'image/webp', 'image/png'])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Επιτρέπεται κι άλλο upload σε αυτόν τον bucket; Μετράει τα αρχεία του χρήστη
-- στο storage. (Σε policy δεν γίνεται INSERT σε πίνακα, οπότε εδώ δεν
-- χρησιμοποιείται το hit_rate_limit· οι κανόνες όμως είναι οι ίδιοι.)
create or replace function public.upload_allowed(bucket text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  rule record;
  used bigint;
  action_name text := case bucket
    when 'message-media' then 'upload_media'
    when 'avatars' then 'upload_avatar'
  end;
begin
  if auth.uid() is null or action_name is null then
    return false;
  end if;
  for rule in select * from rate_limit_rules where action = action_name loop
    select count(*) into used
    from storage.objects o
    where o.bucket_id = bucket
      and o.name like auth.uid()::text || '/%'
      and o.created_at > now() - make_interval(secs => rule.window_seconds);
    if used >= rule.max_count then
      return false;
    end if;
  end loop;
  return public.is_active_user();
end;
$$;

-- Το όνομα αρχείου είναι η τρέχουσα φωτογραφία κάποιου που επιτρέπεται να δω;
-- Οι παλιές φωτογραφίες (που αντικαταστάθηκαν) δεν διαβάζονται από κανέναν άλλον.
create or replace function public.avatar_visible(object_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles p
    where p.avatar_path = object_name
      and p.deleted_at is null
      and public.can_see_profile(p.id)
  )
$$;

drop policy if exists avatars_insert_own on storage.objects;
create policy avatars_insert_own on storage.objects for insert to authenticated
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and public.upload_allowed('avatars')
);

drop policy if exists avatars_read on storage.objects;
create policy avatars_read on storage.objects for select to authenticated
using (
  bucket_id = 'avatars'
  and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or public.avatar_visible(name)
  )
);

drop policy if exists avatars_delete_own on storage.objects;
create policy avatars_delete_own on storage.objects for delete to authenticated
using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Ορίζει τη φωτογραφία. Επιστρέφει την ΠΡΟΗΓΟΥΜΕΝΗ, για να τη σβήσει ο browser
-- μέσω Storage API (η βάση δεν επιτρέπεται να σβήνει αρχεία η ίδια).
create or replace function public.set_my_avatar(path text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  previous text;
begin
  if me is null or not public.is_active_user() then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if path is null or path !~ ('^' || me::text || '/[A-Za-z0-9-]{8,64}\.(jpg|webp|png)$') then
    raise exception 'Invalid avatar path' using errcode = '22023';
  end if;
  if not exists (
    select 1 from storage.objects o where o.bucket_id = 'avatars' and o.name = path
  ) then
    raise exception 'Avatar file not found' using errcode = 'P0002';
  end if;

  perform public.hit_rate_limit('avatar_change', 1);

  select avatar_path into previous from profiles where id = me;
  update profiles set avatar_path = path, updated_at = now() where id = me;
  return jsonb_build_object('previous', previous);
end;
$$;

create or replace function public.clear_my_avatar()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  previous text;
begin
  if me is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  select avatar_path into previous from profiles where id = me;
  update profiles set avatar_path = null, updated_at = now() where id = me;
  return jsonb_build_object('previous', previous);
end;
$$;

-- Το παλιό avatar_path (αν υπήρχε) ήταν ελεύθερο κείμενο από το 0001, π.χ. URL
-- τρίτου. Ό,τι δεν είναι αρχείο του bucket μας φεύγει.
update public.profiles
set avatar_path = null
where avatar_path is not null
  and avatar_path !~ '^[0-9a-f-]{36}/[A-Za-z0-9-]{8,64}\.(jpg|webp|png)$';

-- ---------------------------------------------------------------------------
-- 7. Συσκευές και κλειδιά
-- ---------------------------------------------------------------------------
-- Κάθε browser/κινητό φτιάχνει ΜΟΝΟ ΤΟΥ ένα ζεύγος κλειδιών (ECDH P-256). Το
-- ιδιωτικό δεν φεύγει ποτέ από τη συσκευή (και ο browser δεν επιτρέπει καν να
-- εξαχθεί). Εδώ έρχεται μόνο το δημόσιο, σε base64url (65 bytes -> 87 χαρακτήρες).
create table if not exists public.user_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  public_key text not null unique check (public_key ~ '^[A-Za-z0-9_-]{87}$'),
  label text not null default '' check (char_length(label) <= 80),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index if not exists user_devices_user_idx on public.user_devices(user_id);

alter table public.user_devices enable row level security;
revoke all on public.user_devices from anon, authenticated;
grant select on public.user_devices to authenticated;
drop policy if exists user_devices_read_own on public.user_devices;
create policy user_devices_read_own on public.user_devices for select to authenticated
using (user_id = (select auth.uid()));

-- Ενεργή = όχι ανακλημένη και χρησιμοποιήθηκε τις τελευταίες 90 ημέρες. Μια
-- συσκευή που χάθηκε (σβήστηκαν τα δεδομένα του browser) παύει να παίρνει
-- κλειδιά μόνη της μετά από 90 ημέρες, χωρίς να χρειαστεί να την ανακαλέσει κανείς.
create or replace function public.device_is_active(d public.user_devices)
returns boolean
language sql
stable
as $$
  select d.revoked_at is null and d.last_seen_at > now() - interval '90 days'
$$;

-- Δήλωση συσκευής. Ίδιο κλειδί ξανά = «είμαι ακόμα εδώ» (ενημερώνει το
-- last_seen_at). Επιστρέφει revoked = true αν την έχει ανακαλέσει ο χρήστης·
-- τότε ο browser φτιάχνει καινούργιο ζεύγος.
create or replace function public.register_device(p_public_key text, p_label text default '')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  found_device user_devices%rowtype;
begin
  if me is null or not public.is_active_user() then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select * into found_device from user_devices where public_key = p_public_key;
  if found then
    if found_device.user_id <> me then
      raise exception 'Key belongs to another account' using errcode = '42501';
    end if;
    if found_device.revoked_at is not null then
      return jsonb_build_object('id', found_device.id, 'revoked', true);
    end if;
    update user_devices
    set last_seen_at = now(), label = left(coalesce(nullif(p_label, ''), label), 80)
    where id = found_device.id;
    return jsonb_build_object('id', found_device.id, 'revoked', false);
  end if;

  perform public.hit_rate_limit('device_register', 1);

  insert into user_devices (user_id, public_key, label)
  values (me, p_public_key, left(coalesce(p_label, ''), 80))
  returning * into found_device;

  -- Μέχρι 10 ενεργές συσκευές· η πιο ξεχασμένη ανακαλείται.
  update user_devices set revoked_at = now()
  where user_id = me
    and revoked_at is null
    and id not in (
      select id from user_devices
      where user_id = me and revoked_at is null
      order by last_seen_at desc
      limit 10
    );

  return jsonb_build_object('id', found_device.id, 'revoked', false);
end;
$$;

create or replace function public.list_my_devices()
returns setof jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', d.id::text,
    'label', d.label,
    'publicKey', d.public_key,
    'createdAt', d.created_at,
    'lastSeenAt', d.last_seen_at,
    'active', public.device_is_active(d)
  )
  from user_devices d
  where d.user_id = auth.uid() and d.revoked_at is null
  order by d.last_seen_at desc
$$;

create or replace function public.revoke_device(device uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  update user_devices set revoked_at = now()
  where id = device and user_id = auth.uid() and revoked_at is null;
end;
$$;

-- Τα δημόσια κλειδιά όλων των ενεργών συσκευών όλων των μελών (και των δικών
-- μου άλλων συσκευών), για να κρυπτογραφήσει ο browser ένα μήνυμα. Μόνο για μέλη.
create or replace function public.conversation_device_keys(conversation uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'userId', d.user_id::text,
    'deviceId', d.id::text,
    'publicKey', d.public_key
  ) order by d.user_id, d.created_at), '[]'::jsonb)
  from conversation_members cm
  join profiles p on p.id = cm.user_id and p.deleted_at is null
  join user_devices d on d.user_id = cm.user_id
  where cm.conversation_id = conversation
    and public.device_is_active(d)
    and exists (
      select 1 from conversation_members me
      where me.conversation_id = conversation and me.user_id = auth.uid()
    )
$$;

-- Οι συσκευές ενός ανθρώπου, για τον «κωδικό ασφαλείας» που συγκρίνετε από
-- κοντά. Μόνο για όποιον μοιράζεται μαζί του συνομιλία.
create or replace function public.user_device_keys(target uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(d.public_key order by d.public_key), '[]'::jsonb)
  from user_devices d
  where d.user_id = target
    and public.device_is_active(d)
    and (
      target = auth.uid()
      or exists (
        select 1
        from conversation_members mine
        join conversation_members theirs on theirs.conversation_id = mine.conversation_id
        where mine.user_id = auth.uid() and theirs.user_id = target
      )
    )
$$;

-- ---------------------------------------------------------------------------
-- 8. Κρυπτογραφημένα μηνύματα
-- ---------------------------------------------------------------------------
-- messages.ciphertext (encryption_version = 1): JSON {"iv","ct"} σε base64url.
-- Το ct είναι AES-256-GCM με κλειδί που φτιάχτηκε τυχαία για ΑΥΤΟ το μήνυμα.
-- Το κλειδί αυτό, «τυλιγμένο» για κάθε συσκευή παραλήπτη χωριστά, μπαίνει στο
-- message_keys. Ο server δεν έχει κανένα από τα κλειδιά που ξετυλίγουν.
alter table public.messages add column if not exists sender_device_id uuid;
alter table public.messages add column if not exists sender_key text;

comment on column public.messages.sender_key is
  'Δημόσιο κλειδί της συσκευής που έστειλε. Μένει στο μήνυμα για να διαβάζεται και αφού διαγραφεί η συσκευή ή ο λογαριασμός.';

create table if not exists public.message_keys (
  message_id uuid not null references public.messages(id) on delete cascade,
  device_id uuid not null references public.user_devices(id) on delete cascade,
  recipient_id uuid not null,
  wrapped text not null check (wrapped ~ '^[A-Za-z0-9_-]{40,200}$'),
  primary key (message_id, device_id)
);
create index if not exists message_keys_recipient_idx on public.message_keys(recipient_id);

alter table public.message_keys enable row level security;
revoke all on public.message_keys from anon, authenticated;
grant select on public.message_keys to authenticated;
drop policy if exists message_keys_read_own on public.message_keys;
create policy message_keys_read_own on public.message_keys for select to authenticated
using (recipient_id = (select auth.uid()));

-- Ό,τι χρειάζεται ο browser για να αποκρυπτογραφήσει ένα μήνυμα: το ciphertext
-- και ΜΟΝΟ τα κλειδιά για τις δικές μου συσκευές.
create or replace function public.message_crypto(m public.messages)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when m.encryption_version > 0 and m.deleted_at is null then jsonb_build_object(
    'v', m.encryption_version,
    'envelope', m.ciphertext,
    'clientId', m.client_message_id::text,
    'senderKey', m.sender_key,
    'keys', coalesce((
      select jsonb_object_agg(k.device_id::text, k.wrapped)
      from message_keys k
      where k.message_id = m.id and k.recipient_id = auth.uid()
    ), '{}'::jsonb)
  ) end
$$;

-- Ίδιο με το 0008, με: 'e2ee' (στο μήνυμα και στην παράθεση), και 'body' = ''
-- όταν το μήνυμα είναι κρυπτογραφημένο (το κείμενο το βγάζει ο browser).
create or replace function public.message_payload(m public.messages)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', m.id::text,
    'conversationId', m.conversation_id::text,
    'senderId', m.sender_id::text,
    'senderName', (select p.display_name from profiles p where p.id = m.sender_id),
    'body', case when m.deleted_at is not null or m.encryption_version > 0 then '' else m.ciphertext end,
    'deleted', m.deleted_at is not null,
    'encrypted', m.encryption_version > 0,
    'e2ee', public.message_crypto(m),
    'kind', 'text',
    'createdAt', m.created_at,
    'readBy', coalesce((
      select jsonb_agg(r.user_id::text)
      from message_receipts r
      join profiles rp on rp.id = r.user_id and rp.read_receipts
      where r.message_id = m.id and r.read_at is not null
    ), '[]'::jsonb),
    'deliveredTo', coalesce((
      select jsonb_agg(r.user_id::text)
      from message_receipts r
      join profiles rp on rp.id = r.user_id and rp.read_receipts
      where r.message_id = m.id and r.delivered_at is not null
    ), '[]'::jsonb),
    'reactions', coalesce((
      select jsonb_agg(
        jsonb_build_object('userId', x.user_id::text, 'emoji', x.emoji)
        order by x.updated_at
      )
      from message_reactions x
      where x.message_id = m.id and x.emoji is not null
    ), '[]'::jsonb),
    'replyTo', (
      select jsonb_build_object(
        'id', r.id::text,
        'senderId', r.sender_id::text,
        'senderName', (select p.display_name from profiles p where p.id = r.sender_id),
        'body', case when r.deleted_at is not null or r.encryption_version > 0 then '' else left(r.ciphertext, 140) end,
        'deleted', r.deleted_at is not null,
        'encrypted', r.encryption_version > 0,
        'e2ee', public.message_crypto(r),
        'attachmentName', case when r.encryption_version = 0 then (
          select public.safe_jsonb(a.encrypted_metadata)->>'name'
          from attachments a where a.message_id = r.id limit 1
        ) end
      )
      from messages r
      where r.id = m.reply_to
        and r.conversation_id = m.conversation_id
    ),
    'attachment', (
      select jsonb_build_object(
        'id', a.id::text,
        'path', a.storage_path,
        'size', a.byte_size,
        'name', coalesce(public.safe_jsonb(a.encrypted_metadata)->>'name', 'file'),
        'mime', coalesce(public.safe_jsonb(a.encrypted_metadata)->>'mime', 'application/octet-stream')
      )
      from attachments a
      where a.message_id = m.id
      limit 1
    )
  )
$$;

-- Ο browser δεν γράφει πια ΠΟΤΕ απευθείας στα messages / attachments. Μόνο
-- μέσω send_message, που ελέγχει όρια, κρυπτογράφηση και κλειδιά.
drop policy if exists messages_insert_members on public.messages;
drop policy if exists attachments_insert_members on public.attachments;
revoke insert, update, delete on public.messages from anon, authenticated;
revoke insert, update, delete on public.attachments from anon, authenticated;

-- Ίδιο με το 0008, με: απλό κείμενο δεν γίνεται πια δεκτό, και μεγαλύτερο όριο
-- μήκους για το ciphertext (8000 χαρακτήρες ελληνικά -> ~21000 σε base64).
create or replace function public.messages_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.created_at := now();
  new.edited_at := null;
  new.deleted_at := null;

  if new.encryption_version = 0 then
    raise exception 'Unencrypted messages are not accepted' using errcode = '22023';
  end if;

  if char_length(new.ciphertext) > 65536 then
    raise exception 'Message is too long' using errcode = '22001';
  end if;

  if new.reply_to is not null and not exists (
    select 1 from messages r
    where r.id = new.reply_to and r.conversation_id = new.conversation_id
  ) then
    raise exception 'Reply target is not in this conversation' using errcode = '23514';
  end if;

  return new;
end;
$$;

-- Αποστολή. Η παλιά μορφή (κείμενο χωρίς κλειδιά) καταργείται.
drop function if exists public.send_message(uuid, text, uuid, uuid, jsonb);

create or replace function public.send_message(
  conversation uuid,
  body text,
  client_id uuid,
  sender_device uuid,
  keys jsonb,
  reply_to_message uuid default null,
  attachment jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  convo conversations%rowtype;
  device user_devices%rowtype;
  envelope jsonb := public.safe_jsonb(body);
  msg messages%rowtype;
  file_path text;
  file_size bigint;
  bad text;
  sent_while_pending integer;
begin
  if me is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if not public.can_post_to_conversation(conversation) then
    raise exception 'You cannot send messages to this conversation' using errcode = '42501';
  end if;

  -- Ίδιο client_id = ίδιο μήνυμα (διπλό πάτημα, επανάληψη μετά από timeout).
  -- Πριν από τα όρια: η επανάληψη δεν είναι νέο μήνυμα.
  select * into msg from messages
  where sender_id = me and client_message_id = client_id;
  if found then
    return public.message_payload(msg);
  end if;

  select * into convo from conversations where id = conversation;

  -- Σε αίτημα που δεν έχει απαντηθεί ακόμα: μέχρι 3 μηνύματα. Αρκεί για να
  -- συστηθείς, δεν αρκεί για να πλημμυρίσεις κάποιον που δεν σε ξέρει.
  if convo.request_status = 'pending' and convo.request_from = me then
    select count(*) into sent_while_pending
    from messages where conversation_id = conversation and sender_id = me;
    if sent_while_pending >= 3 then
      raise exception 'Wait until your request is accepted' using errcode = 'P0001';
    end if;
  end if;

  perform public.hit_rate_limit('message', 1);

  -- Η συσκευή που στέλνει: δική μου και ενεργή.
  select * into device from user_devices
  where id = sender_device and user_id = me and revoked_at is null;
  if not found then
    raise exception 'Unknown sending device' using errcode = '42501';
  end if;
  update user_devices set last_seen_at = now() where id = device.id;

  -- coalesce: για κάτι που δεν είναι JSON, το jsonb_typeof δίνει NULL, και ένα
  -- σκέτο «NULL <> 'string'» δεν είναι true — θα περνούσε απλό κείμενο.
  if coalesce(jsonb_typeof(envelope->'iv'), '') <> 'string'
     or coalesce(jsonb_typeof(envelope->'ct'), '') <> 'string'
     or (envelope->>'iv') !~ '^[A-Za-z0-9_-]{16}$'
     or (envelope->>'ct') !~ '^[A-Za-z0-9_-]{22,}$' then
    raise exception 'Messages must be encrypted' using errcode = '22023';
  end if;

  if coalesce(jsonb_typeof(keys), '') <> 'array'
     or jsonb_array_length(keys) not between 1 and 1000
     or exists (
       select 1 from jsonb_array_elements(keys) k
       where coalesce(k->>'key', '') !~ '^[A-Za-z0-9_-]{40,200}$'
     ) then
    raise exception 'Encryption keys are missing' using errcode = '22023';
  end if;

  -- Κάθε κλειδί πάει σε ενεργή συσκευή ΜΕΛΟΥΣ αυτής της συνομιλίας.
  select k->>'device' into bad
  from jsonb_array_elements(keys) k
  where not exists (
    select 1
    from user_devices d
    join conversation_members cm
      on cm.user_id = d.user_id and cm.conversation_id = conversation
    where d.id::text = k->>'device' and public.device_is_active(d)
  )
  limit 1;
  if found then
    raise exception 'Encryption keys are out of date' using errcode = 'P0001';
  end if;

  -- Και κάθε μέλος που έχει έστω μία ενεργή συσκευή παίρνει κλειδί. Αλλιώς ο
  -- browser κρυπτογράφησε με παλιά λίστα (π.χ. μπήκε νέο μέλος στην ομάδα)
  -- και πρέπει να ξαναπροσπαθήσει με φρέσκια.
  if exists (
    select 1
    from conversation_members cm
    join profiles p on p.id = cm.user_id and p.deleted_at is null
    where cm.conversation_id = conversation
      and exists (
        select 1 from user_devices d
        where d.user_id = cm.user_id and public.device_is_active(d)
      )
      and not exists (
        select 1
        from jsonb_array_elements(keys) k
        join user_devices d on d.id::text = k->>'device'
        where d.user_id = cm.user_id
      )
  ) then
    raise exception 'Encryption keys are out of date' using errcode = 'P0001';
  end if;

  -- Σε ατομική: ο άλλος πρέπει να έχει ανοίξει το Mila έστω μία φορά μετά την
  -- αλλαγή, αλλιώς δεν υπάρχει κλειδί για να του γράψει κανείς.
  if convo.kind = 'direct' and exists (
    select 1
    from conversation_members cm
    join profiles p on p.id = cm.user_id and p.deleted_at is null
    where cm.conversation_id = conversation
      and cm.user_id <> me
      and not exists (
        select 1 from user_devices d
        where d.user_id = cm.user_id and public.device_is_active(d)
      )
  ) then
    raise exception 'Recipient has not set up encryption yet' using errcode = 'P0001';
  end if;

  insert into messages (
    conversation_id, sender_id, ciphertext, encryption_version,
    client_message_id, reply_to, sender_device_id, sender_key
  )
  values (
    conversation, me, body, 1,
    client_id, reply_to_message, device.id, device.public_key
  )
  returning * into msg;

  insert into message_keys (message_id, device_id, recipient_id, wrapped)
  select msg.id, d.id, d.user_id, k->>'key'
  from jsonb_array_elements(keys) k
  join user_devices d on d.id::text = k->>'device'
  on conflict do nothing;

  if attachment is not null then
    file_path := attachment->>'path';
    file_size := (attachment->>'size')::bigint;
    if file_path is null or split_part(file_path, '/', 1) <> me::text then
      raise exception 'Attachment does not belong to you' using errcode = '42501';
    end if;
    -- Όνομα και τύπος αρχείου είναι ΜΕΣΑ στο κρυπτογραφημένο μήνυμα. Εδώ
    -- μένει μόνο ότι υπάρχει αρχείο και πόσο μεγάλο είναι.
    insert into attachments (message_id, conversation_id, storage_path, encrypted_metadata, byte_size)
    values (msg.id, conversation, file_path, '{"e2ee":1}', file_size);
  end if;

  return public.message_payload(msg);
end;
$$;

-- Διαγραφή για όλους: φεύγουν και τα τυλιγμένα κλειδιά. Κατά τα άλλα ίδιο.
create or replace function public.delete_message(message uuid, for_everyone boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  target messages%rowtype;
  paths jsonb := '[]'::jsonb;
begin
  if me is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select m.* into target
  from messages m
  join conversation_members cm
    on cm.conversation_id = m.conversation_id and cm.user_id = me
  where m.id = message;
  if not found then
    raise exception 'Message not found' using errcode = 'P0002';
  end if;

  if not for_everyone then
    insert into message_hidden (message_id, user_id)
    values (message, me)
    on conflict do nothing;
    return jsonb_build_object('scope', 'me', 'paths', paths);
  end if;

  if target.sender_id <> me then
    raise exception 'Only the sender can delete a message for everyone' using errcode = '42501';
  end if;

  if target.deleted_at is not null then
    return jsonb_build_object('scope', 'everyone', 'paths', paths);
  end if;

  select coalesce(jsonb_agg(a.storage_path), '[]'::jsonb) into paths
  from attachments a where a.message_id = message;

  delete from attachments where message_id = message;
  delete from message_keys where message_id = message;
  update message_reactions set emoji = null, updated_at = now()
  where message_id = message and emoji is not null;
  update messages set ciphertext = '', sender_key = null, deleted_at = now(), edited_at = null
  where id = message;

  return jsonb_build_object('scope', 'everyone', 'paths', paths);
end;
$$;

-- Σβήνει για όλους τα ΠΑΛΙΑ μηνύματα του χρήστη που είναι σε απλό κείμενο
-- (πριν από αυτό το migration). Επιστρέφει τα αρχεία τους για να τα σβήσει ο
-- browser. Τα κρυπτογραφημένα δεν τα αγγίζει.
create or replace function public.delete_my_unencrypted_messages()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  paths jsonb;
  affected integer;
begin
  if me is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(a.storage_path), '[]'::jsonb) into paths
  from attachments a
  join messages m on m.id = a.message_id
  where m.sender_id = me and m.encryption_version = 0 and m.deleted_at is null;

  delete from attachments a
  using messages m
  where m.id = a.message_id
    and m.sender_id = me and m.encryption_version = 0 and m.deleted_at is null;

  update message_reactions x set emoji = null, updated_at = now()
  from messages m
  where m.id = x.message_id
    and m.sender_id = me and m.encryption_version = 0 and m.deleted_at is null
    and x.emoji is not null;

  update messages set ciphertext = '', deleted_at = now(), edited_at = null
  where sender_id = me and encryption_version = 0 and deleted_at is null;
  get diagnostics affected = row_count;

  return jsonb_build_object('deleted', affected, 'paths', paths);
end;
$$;

-- Πόσα παλιά, μη κρυπτογραφημένα μηνύματά μου υπάρχουν ακόμα.
create or replace function public.count_my_unencrypted_messages()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer from messages
  where sender_id = auth.uid() and encryption_version = 0 and deleted_at is null
$$;

-- Συνημμένα: ο bucket δέχεται μόνο κρυπτογραφημένα αρχεία (ο browser τα
-- ανεβάζει ως application/octet-stream), έως 16 MB (15 MB + τα λίγα bytes της
-- κρυπτογράφησης), και με όριο uploads ανά ώρα/ημέρα.
update storage.buckets
set file_size_limit = 16777216,
    allowed_mime_types = array['application/octet-stream']
where id = 'message-media';

drop policy if exists media_insert_authenticated on storage.objects;
create policy media_insert_authenticated on storage.objects for insert to authenticated
with check (
  bucket_id = 'message-media'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and public.upload_allowed('message-media')
);

-- ---------------------------------------------------------------------------
-- 9. Όρια σε αντιδράσεις, ομάδες, αναφορές
-- ---------------------------------------------------------------------------
-- Ίδιο με το 0008 + όριο (μόνο όταν ΒΑΖΕΙΣ αντίδραση, όχι όταν τη βγάζεις).
create or replace function public.react_to_message(message uuid, reaction text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  target messages%rowtype;
  chosen text := nullif(trim(coalesce(reaction, '')), '');
begin
  if me is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select m.* into target
  from messages m
  join conversation_members cm
    on cm.conversation_id = m.conversation_id and cm.user_id = me
  where m.id = message;
  if not found then
    raise exception 'Message not found' using errcode = 'P0002';
  end if;
  if target.deleted_at is not null then
    raise exception 'Message was deleted' using errcode = '22023';
  end if;
  if chosen is not null and not public.can_post_to_conversation(target.conversation_id) then
    raise exception 'You cannot send messages to this conversation' using errcode = '42501';
  end if;
  if chosen is not null and chosen <> all (array[
    chr(128077),
    chr(10084) || chr(65039),
    chr(128514),
    chr(128558),
    chr(128546),
    chr(128591)
  ]) then
    raise exception 'Invalid reaction' using errcode = '22023';
  end if;

  if chosen is not null then
    perform public.hit_rate_limit('reaction', 1);
  end if;

  insert into message_reactions (message_id, conversation_id, user_id, emoji)
  values (message, target.conversation_id, me, chosen)
  on conflict (message_id, user_id) do update
  set emoji = case
        when message_reactions.emoji is not distinct from excluded.emoji then null
        else excluded.emoji
      end,
      updated_at = now();

  return public.message_payload(target);
end;
$$;

-- Ομάδες: δεν αλλάζει τίποτα στη λογική, μόνο μετράνε. Το «τύλιγμα» γύρω από
-- τις functions του 0008 θα ήταν πιο μικρό, αλλά δύο functions με το ίδιο όνομα
-- μπερδεύουν· γι' αυτό μπαίνει ο έλεγχος σε trigger στο conversation_members.
create or replace function public.count_group_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  kind public.conversation_kind;
begin
  -- Μόνο όταν το κάνει χρήστης από τον browser (όχι το service role, όχι
  -- εσωτερικές λειτουργίες χωρίς auth.uid()).
  if auth.uid() is null or new.user_id = auth.uid() then
    return new;
  end if;
  select c.kind into kind from conversations c where c.id = new.conversation_id;
  if kind = 'group' then
    perform public.hit_rate_limit('group_add', 1);
  end if;
  return new;
end;
$$;

drop trigger if exists count_group_changes on public.conversation_members;
create trigger count_group_changes
before insert on public.conversation_members
for each row execute function public.count_group_changes();

create or replace function public.count_group_creation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and new.kind = 'group' then
    perform public.hit_rate_limit('group_create', 1);
  end if;
  return new;
end;
$$;

drop trigger if exists count_group_creation on public.conversations;
create trigger count_group_creation
before insert on public.conversations
for each row execute function public.count_group_creation();

create or replace function public.count_reports()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.hit_rate_limit('report', 1);
  return new;
end;
$$;

drop trigger if exists count_reports on public.reports;
create trigger count_reports
before insert on public.reports
for each row execute function public.count_reports();

-- ---------------------------------------------------------------------------
-- 10. Ειδοποιήσεις: τίποτα από το περιεχόμενο
-- ---------------------------------------------------------------------------
-- Ο server δεν ξέρει πια τι γράφει το μήνυμα, άρα δεν το βάζει στην
-- ειδοποίηση. Στέλνει όνομα αποστολέα και αν είναι ομάδα· το «Νέο μήνυμα» το
-- γράφει ο service worker στη γλώσσα της συσκευής.
create or replace function public.push_targets(message uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'payload', jsonb_build_object(
      'conversationId', m.conversation_id::text,
      'messageId', m.id::text,
      'title', case when c.kind = 'group' then coalesce(c.name, sender.display_name) else sender.display_name end,
      'body', '',
      'senderName', split_part(sender.display_name, ' ', 1),
      'isGroup', c.kind = 'group',
      'hasAttachment', exists (select 1 from attachments a where a.message_id = m.id),
      'isRequest', c.request_status = 'pending'
    ),
    'subscriptions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id::text,
        'endpoint', s.endpoint,
        'p256dh', s.p256dh,
        'auth', s.auth
      ))
      from conversation_members cm
      join push_subscriptions s on s.user_id = cm.user_id
      where cm.conversation_id = m.conversation_id
        and cm.user_id <> m.sender_id
        and not exists (
          select 1 from blocks b
          where b.blocker_id = cm.user_id and b.blocked_id = m.sender_id
        )
    ), '[]'::jsonb)
  )
  from messages m
  join conversations c on c.id = m.conversation_id
  join profiles sender on sender.id = m.sender_id
  where m.id = message
    and m.deleted_at is null
    and c.request_status <> 'rejected'
$$;

-- ---------------------------------------------------------------------------
-- 11. Εξαγωγή δεδομένων: και τα κρυπτογραφημένα
-- ---------------------------------------------------------------------------
-- Ο server δεν μπορεί να τα διαβάσει, οπότε τα δίνει όπως είναι (με τα κλειδιά
-- για τις συσκευές του χρήστη) και ο browser τα αποκρυπτογραφεί πριν γράψει
-- το αρχείο.
create or replace function public.export_my_data()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'exported_at', now(),
    'format_version', 2,
    'profile', (
      select jsonb_build_object(
        'email', p.email,
        'display_name', p.display_name,
        'username', p.username,
        'bio', p.bio,
        'avatar_path', p.avatar_path,
        'created_at', p.created_at,
        'privacy', jsonb_build_object(
          'discover_by_email', p.discover_by_email,
          'show_email', p.show_email,
          'read_receipts', p.read_receipts,
          'show_online', p.show_online
        )
      )
      from profiles p where p.id = auth.uid()
    ),
    'devices', coalesce((
      select jsonb_agg(jsonb_build_object(
        'label', d.label, 'created_at', d.created_at,
        'last_seen_at', d.last_seen_at, 'revoked_at', d.revoked_at
      ) order by d.created_at)
      from user_devices d where d.user_id = auth.uid()
    ), '[]'::jsonb),
    'conversations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'kind', c.kind,
        'name', c.name,
        'created_at', c.created_at,
        'joined_at', cm.joined_at,
        'participants', (
          select jsonb_agg(other.display_name)
          from conversation_members om
          join profiles other on other.id = om.user_id
          where om.conversation_id = c.id and om.user_id <> auth.uid()
        )
      ) order by c.created_at)
      from conversation_members cm
      join conversations c on c.id = cm.conversation_id
      where cm.user_id = auth.uid()
    ), '[]'::jsonb),
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object(
        'conversation_id', m.conversation_id,
        'sent_at', m.created_at,
        'deleted_at', m.deleted_at,
        'encrypted', m.encryption_version > 0,
        'body', case when m.encryption_version = 0 then m.ciphertext else null end,
        'e2ee', public.message_crypto(m),
        'attachments', (
          select jsonb_agg(jsonb_build_object(
            'path', a.storage_path,
            'bytes', a.byte_size,
            'metadata', public.safe_jsonb(a.encrypted_metadata)
          ))
          from attachments a where a.message_id = m.id
        )
      ) order by m.created_at)
      from messages m
      where m.sender_id = auth.uid()
    ), '[]'::jsonb),
    'blocked_users', coalesce((
      select jsonb_agg(b.blocked_id)
      from blocks b where b.blocker_id = auth.uid()
    ), '[]'::jsonb),
    'reports_filed', coalesce((
      select jsonb_agg(jsonb_build_object('reason', r.reason, 'created_at', r.created_at))
      from reports r where r.reporter_id = auth.uid()
    ), '[]'::jsonb)
  )
  where auth.uid() is not null
$$;

-- ---------------------------------------------------------------------------
-- 12. Δικαιώματα
-- ---------------------------------------------------------------------------
revoke all on function public.hit_rate_limit(text, integer) from public, anon, authenticated;
revoke all on function public.throttle_signups() from public, anon, authenticated;
revoke all on function public.count_group_changes() from public, anon, authenticated;
revoke all on function public.count_group_creation() from public, anon, authenticated;
revoke all on function public.count_reports() from public, anon, authenticated;
revoke all on function public.message_crypto(public.messages) from public, anon, authenticated;
revoke all on function public.profile_payload(public.profiles) from public, anon, authenticated;
revoke all on function public.message_payload(public.messages) from public, anon, authenticated;
revoke all on function public.device_is_active(public.user_devices) from public, anon;

revoke all on function public.can_see_profile(uuid) from public, anon;
revoke all on function public.search_profiles(text) from public, anon;
revoke all on function public.match_contacts(text[]) from public, anon;
revoke all on function public.start_direct_conversation(uuid) from public, anon;
revoke all on function public.upload_allowed(text) from public, anon;
revoke all on function public.avatar_visible(text) from public, anon;
revoke all on function public.set_my_avatar(text) from public, anon;
revoke all on function public.clear_my_avatar() from public, anon;
revoke all on function public.register_device(text, text) from public, anon;
revoke all on function public.list_my_devices() from public, anon;
revoke all on function public.revoke_device(uuid) from public, anon;
revoke all on function public.conversation_device_keys(uuid) from public, anon;
revoke all on function public.user_device_keys(uuid) from public, anon;
revoke all on function public.send_message(uuid, text, uuid, uuid, jsonb, uuid, jsonb) from public, anon;
revoke all on function public.delete_message(uuid, boolean) from public, anon;
revoke all on function public.delete_my_unencrypted_messages() from public, anon;
revoke all on function public.count_my_unencrypted_messages() from public, anon;
revoke all on function public.react_to_message(uuid, text) from public, anon;
revoke all on function public.export_my_data() from public, anon;
revoke all on function public.push_targets(uuid) from public, anon, authenticated;

-- Τα can_see_profile, upload_allowed, avatar_visible καλούνται μέσα σε storage
-- policies, που τρέχουν ως ο χρήστης.
grant execute on function public.can_see_profile(uuid) to authenticated;
grant execute on function public.upload_allowed(text) to authenticated;
grant execute on function public.avatar_visible(text) to authenticated;
grant execute on function public.device_is_active(public.user_devices) to authenticated;
grant execute on function public.search_profiles(text) to authenticated;
grant execute on function public.match_contacts(text[]) to authenticated;
grant execute on function public.start_direct_conversation(uuid) to authenticated;
grant execute on function public.set_my_avatar(text) to authenticated;
grant execute on function public.clear_my_avatar() to authenticated;
grant execute on function public.register_device(text, text) to authenticated;
grant execute on function public.list_my_devices() to authenticated;
grant execute on function public.revoke_device(uuid) to authenticated;
grant execute on function public.conversation_device_keys(uuid) to authenticated;
grant execute on function public.user_device_keys(uuid) to authenticated;
grant execute on function public.send_message(uuid, text, uuid, uuid, jsonb, uuid, jsonb) to authenticated;
grant execute on function public.delete_message(uuid, boolean) to authenticated;
grant execute on function public.delete_my_unencrypted_messages() to authenticated;
grant execute on function public.count_my_unencrypted_messages() to authenticated;
grant execute on function public.react_to_message(uuid, text) to authenticated;
grant execute on function public.export_my_data() to authenticated;
grant execute on function public.push_targets(uuid) to service_role;

notify pgrst, 'reload schema';
