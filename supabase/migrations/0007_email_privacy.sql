-- 0007: Ιδιωτικότητα email, προστασία της ταυτότητας, και διόρθωση της
-- διαγραφής λογαριασμού. Idempotent — μπορεί να ξανατρέξει με ασφάλεια.
--
-- ΤΙ ΔΙΟΡΘΩΝΕΙ (όλα επιβεβαιωμένα στη ζωντανή βάση, 2026-09-21):
--
--  Α. Όποιος είχε λογαριασμό έγραφε «gmail» στην αναζήτηση και έβλεπε τα email
--     των άλλων, 20 τη φορά. Το profile_payload έκρυβε το email μόνο στο
--     show_email = 'nobody', και το search_profiles έψαχνε με κομμάτι email.
--  Β. Το «Find me by email: Contacts» δούλευε σαν «Everyone».
--  Γ. Το policy profiles_read_self_and_contacts άφηνε όποιον σου έστελνε ένα
--     request (χωρίς να το έχεις δεχτεί) να διαβάσει ολόκληρη τη γραμμή σου
--     στο profiles, άρα και το email, παρακάμπτοντας το show_email.
--  Δ. Το policy profiles_update_self άφηνε τον χρήστη να αλλάξει ΚΑΙ τη στήλη
--     email του προφίλ του. Σε messenger όπου η ταυτότητα ΕΙΝΑΙ το email, αυτό
--     σημαίνει ότι μπορούσε να εμφανιστεί ως οποιοδήποτε email δεν είχε ήδη
--     λογαριασμό.
--  Ε. Το delete_my_account (0006) αποτύγχανε ΠΑΝΤΑ: η Supabase έχει trigger
--     (storage.protect_delete, BEFORE DELETE FOR EACH STATEMENT) που απαγορεύει
--     το απευθείας DELETE στο storage.objects. Κανείς δεν μπορούσε να σβήσει
--     τον λογαριασμό του.
--
-- ΣΥΜΒΑΤΟΤΗΤΑ: το παλιό frontend (πριν από αυτό το commit) συνεχίζει να
-- δουλεύει. Το μόνο που παύει είναι το upsert στο profiles που έκανε σε κάθε
-- σύνδεση — το οποίο ήταν bug: μηδένιζε το bio και τις ρυθμίσεις privacy του
-- χρήστη κάθε φορά που έμπαινε. Αποτυγχάνει πλέον σιωπηλά (console.warn).

-- ---------------------------------------------------------------------------
-- 1. Ποιος θεωρείται «επαφή»
-- ---------------------------------------------------------------------------
-- Δεν υπάρχει πίνακας επαφών. Επαφή = κάποιος με τον οποίο έχω ατομική
-- συνομιλία που έχει ΓΙΝΕΙ ΔΕΚΤΗ. Ένα request που εκκρεμεί δεν αρκεί, ούτε το
-- να βρεθούμε στην ίδια ομάδα.
create or replace function public.is_contact(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from conversation_members mine
    join conversation_members theirs
      on theirs.conversation_id = mine.conversation_id
    join conversations c on c.id = mine.conversation_id
    where mine.user_id = auth.uid()
      and theirs.user_id = target
      and target <> auth.uid()
      and c.kind = 'direct'
      and c.request_status = 'accepted'
  )
$$;

-- ---------------------------------------------------------------------------
-- 2. Το email φαίνεται μόνο σε όποιον δικαιούται
-- ---------------------------------------------------------------------------
-- Κανόνας: το βλέπω εγώ, και οι επαφές μου εφόσον δεν έχω διαλέξει 'nobody'.
-- Τα 'chat' και 'contacts' σημαίνουν πλέον το ίδιο πράγμα (βλ. is_contact).
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
    -- Όταν δεν έχει οριστεί username, το παλιό payload το έβγαζε από το κομμάτι
    -- του email πριν το @ — δηλαδή έδινε το μισό email σε όποιον έψαχνε. Τώρα
    -- αυτό γίνεται μόνο για όποιον δικαιούται να δει ΟΛΟ το email· οι υπόλοιποι
    -- παίρνουν null και η οθόνη απλώς δεν δείχνει «@…».
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
    'bio', p.bio,
    'avatar', coalesce(
      p.avatar_path,
      'https://api.dicebear.com/9.x/initials/svg?seed=' || replace(p.display_name, ' ', '%20') || '&backgroundColor=6d5dfc'
    ),
    'deleted', p.deleted_at is not null,
    'privacy', jsonb_build_object(
      'discover', p.discover_by_email,
      'showEmail', p.show_email,
      'receipts', p.read_receipts,
      'online', p.show_online
    )
  )
$$;

-- ---------------------------------------------------------------------------
-- 3. Αναζήτηση που σέβεται τις ρυθμίσεις
-- ---------------------------------------------------------------------------
--  * discover = 'everyone': βρίσκεσαι με όνομα/username, ή με ΟΛΟΚΛΗΡΟ το
--    email σου (όποιος το γράφει ολόκληρο το ξέρει ήδη — δεν μαθαίνει τίποτα).
--  * discover = 'contacts': σε βρίσκουν μόνο όσοι είναι ήδη επαφές σου.
--  * discover = 'nobody': δεν εμφανίζεσαι σε καμία αναζήτηση ξένου.
--  * Οι επαφές σου σε βρίσκουν πάντα (σε έχουν ήδη στη λίστα τους).
-- Ποτέ αναζήτηση με ΚΟΜΜΑΤΙ email από ξένο: αυτό ήταν η διαρροή.
-- Τα % και _ του χρήστη γίνονται escape, αλλιώς το «__» ταίριαζε με όλους.
create or replace function public.search_profiles(search_term text)
returns setof jsonb
language sql
stable
security definer
set search_path = public
as $$
  with input as (
    select
      lower(trim(search_term)) as exact,
      '%' || replace(replace(replace(trim(search_term), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pattern
  )
  select
    case
      -- Έγραψε ολόκληρο το email: το ξέρει ήδη, δεν έχει νόημα να του το κρύψουμε.
      when lower(p.email) = i.exact and p.discover_by_email = 'everyone'
        then public.profile_payload(p) || jsonb_build_object('email', p.email)
      else public.profile_payload(p)
    end
  from public.profiles p
  cross join input i
  where auth.uid() is not null
    and p.id <> auth.uid()
    and p.deleted_at is null
    and length(i.exact) >= 2
    and not exists (
      select 1
      from public.blocks b
      where (b.blocker_id = auth.uid() and b.blocked_id = p.id)
         or (b.blocker_id = p.id and b.blocked_id = auth.uid())
    )
    and (
      (
        public.is_contact(p.id)
        and (
          p.display_name ilike i.pattern
          or coalesce(p.username, '') ilike i.pattern
          or (p.show_email <> 'nobody' and p.email ilike i.pattern)
        )
      )
      or (
        p.discover_by_email = 'everyone'
        and (
          p.display_name ilike i.pattern
          or coalesce(p.username, '') ilike i.pattern
          or lower(p.email) = i.exact
        )
      )
    )
  order by p.display_name
  limit 20
$$;

-- ---------------------------------------------------------------------------
-- 4. Το profiles διαβάζεται απευθείας ΜΟΝΟ από τον ιδιοκτήτη του
-- ---------------------------------------------------------------------------
-- Ό,τι χρειάζεται το app για τους άλλους περνάει από τα RPCs (list_conversations,
-- search_profiles, match_contacts), που εφαρμόζουν τους κανόνες του βήματος 2.
drop policy if exists profiles_read_self_and_contacts on public.profiles;
drop policy if exists profiles_read_authenticated on public.profiles;
drop policy if exists profiles_read_self on public.profiles;

create policy profiles_read_self
on public.profiles
for select
to authenticated
using (id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 5. Ο χρήστης αλλάζει μόνο ό,τι του ανήκει να αλλάζει
-- ---------------------------------------------------------------------------
-- Το RLS δουλεύει ανά γραμμή, όχι ανά στήλη. Οι στήλες κλειδώνουν με grants.
-- ΕΚΤΟΣ μένουν: id, email (ταυτότητα), deleted_at, created_at, και το
-- avatar_path — το τελευταίο γιατί μπαίνει αυτούσιο σε <img src> στους άλλους,
-- άρα ένα ξένο URL εκεί θα κατέγραφε την IP όποιου ανοίγει τη συνομιλία. Όταν
-- μπουν avatars, θα γίνει με RPC που ελέγχει ότι το path είναι στον φάκελό του.
revoke insert, update, delete on public.profiles from anon, authenticated;
grant update (
  display_name,
  username,
  bio,
  discover_by_email,
  show_email,
  read_receipts,
  show_online,
  updated_at
) on public.profiles to authenticated;

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self
on public.profiles
for update
to authenticated
using (id = (select auth.uid()) and deleted_at is null)
with check (id = (select auth.uid()));

-- Το προφίλ το φτιάχνει το trigger handle_new_auth_user στην εγγραφή. Το
-- INSERT από τον browser ήταν μόνο δίχτυ ασφαλείας, και άφηνε να δηλωθεί
-- οποιοδήποτε email. Το δίχτυ γίνεται RPC που διαβάζει το ΠΡΑΓΜΑΤΙΚΟ email
-- από το auth.users.
drop policy if exists profiles_insert_self on public.profiles;

create or replace function public.ensure_my_profile(preferred_name text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  account record;
  chosen text;
begin
  if me is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if exists (select 1 from profiles where id = me) then
    return;
  end if;

  select u.email, u.raw_user_meta_data into account
  from auth.users u where u.id = me;
  if not found or account.email is null then
    return;
  end if;

  chosen := coalesce(
    nullif(trim(preferred_name), ''),
    nullif(account.raw_user_meta_data->>'display_name', ''),
    nullif(account.raw_user_meta_data->>'name', ''),
    split_part(account.email, '@', 1),
    'New user'
  );
  if char_length(chosen) < 2 then
    chosen := 'New user';
  end if;

  insert into profiles (id, email, display_name)
  values (me, lower(account.email), left(chosen, 60))
  on conflict do nothing;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Διαγραφή λογαριασμού που δουλεύει
-- ---------------------------------------------------------------------------
-- Ίδιο με το 0006, ΧΩΡΙΣ το «delete from storage.objects». Εκείνο έσβηνε
-- αρχεία που ανέβηκαν αλλά δεν κατέληξαν σε μήνυμα — σπάνια περίπτωση (upload
-- που πέτυχε ενώ το μήνυμα απέτυχε). Το κόστος του να μείνουν είναι λίγα ΚΒ·
-- το κόστος του να τα σβήνουμε από εδώ ήταν ότι δεν έσβηνε ΚΑΝΕΝΑΣ λογαριασμός.
-- Σωστό καθάρισμα αρχείων γίνεται μόνο μέσω Storage API.
create or replace function public.delete_my_account()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Πρέπει να είσαι συνδεδεμένος για να διαγράψεις τον λογαριασμό σου.'
      using errcode = '28000';
  end if;

  if exists (select 1 from profiles where id = me and deleted_at is not null) then
    raise exception 'Ο λογαριασμός έχει ήδη διαγραφεί.' using errcode = '23505';
  end if;

  delete from public.blocks where blocker_id = me or blocked_id = me;

  update public.profiles set
    email             = 'deleted-' || me::text || '@deleted.invalid',
    display_name      = 'Deleted user',
    username          = null,
    avatar_path       = null,
    bio               = '',
    discover_by_email = 'nobody',
    show_email        = 'nobody',
    read_receipts     = false,
    show_online       = false,
    deleted_at        = now(),
    updated_at        = now()
  where id = me;

  delete from auth.users where id = me;

  return jsonb_build_object('deleted', true, 'files_removed', 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Δικαιώματα εκτέλεσης
-- ---------------------------------------------------------------------------
-- Ο έλεγχος ασφαλείας της Supabase έδειξε ότι αυτές οι functions ήταν
-- εκτελέσιμες και από ΜΗ συνδεδεμένους. Δεν επέστρεφαν τίποτα (όλες ελέγχουν
-- το auth.uid()), αλλά δεν υπάρχει λόγος να είναι ανοιχτές.
revoke all on function public.is_contact(uuid) from public, anon;
revoke all on function public.profile_payload(public.profiles) from public, anon;
revoke all on function public.search_profiles(text) from public, anon;
revoke all on function public.is_conversation_member(uuid) from public, anon;
revoke all on function public.ensure_my_profile(text) from public, anon;
revoke all on function public.delete_my_account() from public, anon;

grant execute on function public.is_contact(uuid) to authenticated;
-- Το profile_payload το καλούν ΜΟΝΟ άλλες security definer functions (τρέχουν
-- ως ιδιοκτήτης, δεν χρειάζονται grant). Ο browser δεν έχει λόγο να το καλεί,
-- και μια function που δέχεται ολόκληρη γραμμή από τον καλούντα δεν πρέπει να
-- είναι ανοιχτή.
revoke all on function public.profile_payload(public.profiles) from authenticated;
grant execute on function public.search_profiles(text) to authenticated;
-- Το is_conversation_member χρησιμοποιείται μέσα στα RLS policies, που τρέχουν
-- με τα δικαιώματα του χρήστη — χωρίς αυτό το grant δεν διαβάζει κανείς τίποτα.
grant execute on function public.is_conversation_member(uuid) to authenticated;
grant execute on function public.ensure_my_profile(text) to authenticated;
grant execute on function public.delete_my_account() to authenticated;

-- Σταθερό search_path και εδώ (σύσταση του ίδιου ελέγχου).
alter function public.safe_jsonb(text) set search_path = '';
