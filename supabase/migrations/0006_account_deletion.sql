-- 0006: Διαγραφή λογαριασμού και εξαγωγή δεδομένων.
--
-- Χωρίς αυτά, το app απορρίπτεται και από τα δύο stores: App Store Review
-- Guideline 5.1.1(v) και η αντίστοιχη πολιτική της Google απαιτούν πραγματική
-- διαγραφή λογαριασμού μέσα από την εφαρμογή, για κάθε app που φτιάχνει
-- λογαριασμούς. Το «Export data» το ζητάει το GDPR (άρθρο 20).
--
-- ΤΙ ΑΚΡΙΒΩΣ ΣΒΗΝΕΤΑΙ
--
-- Οριστικά: η γραμμή στο auth.users — email, password hash, ταυτότητες Google,
-- sessions, refresh tokens. Ο χρήστης δεν ξαναμπαίνει και το email ελευθερώνεται
-- για νέα εγγραφή. Επίσης το avatar και ό,τι ανέβασε χωρίς να το στείλει.
--
-- Μένει, ανωνυμοποιημένο: μία γραμμή-ταφόπλακα στο profiles, με όνομα
-- «Deleted user» και συνθετικό email. Υπάρχει μόνο για να έχουν πού να δείχνουν
-- τα messages.sender_id, τα conversations.created_by και τα reports. Χωρίς αυτήν
-- θα έπρεπε να σβήσουμε και τα μηνύματα, που θα ξήλωνε τις συνομιλίες του άλλου
-- ανθρώπου.
--
-- Αυτή είναι συνειδητή απόφαση με κόστος: ο server κρατάει τα γραπτά κάποιου
-- αφού εκείνος ζήτησε να φύγει. Πρέπει να γράφεται στο privacy policy. Σε
-- επίσημο GDPR αίτημα διαγραφής θα χρειαστεί χειροκίνητο σβήσιμο των μηνυμάτων.

-- ---------------------------------------------------------------------------
-- 1. Αποσύνδεση του profiles από το auth.users
-- ---------------------------------------------------------------------------
-- Το 0001 όρισε profiles.id -> auth.users(id) ON DELETE CASCADE. Με αυτό, κάθε
-- διαγραφή λογαριασμού θα έπαιρνε μαζί της και το προφίλ, άρα και κάθε μήνυμα
-- που δείχνει σε αυτό. Η ακεραιότητα στην εγγραφή εξασφαλίζεται ήδη από το
-- trigger handle_new_auth_user του 0002, οπότε το FK δεν προσφέρει κάτι άλλο.
do $$
declare
  constraint_name text;
begin
  select con.conname into constraint_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'profiles'
    and con.contype = 'f'
    and pg_get_constraintdef(con.oid) ilike '%auth.users%';

  if constraint_name is not null then
    execute format('alter table public.profiles drop constraint %I', constraint_name);
  end if;
end;
$$;

alter table public.profiles
  add column if not exists deleted_at timestamptz;

comment on column public.profiles.deleted_at is
  'Πότε ζήτησε ο χρήστης διαγραφή. Μη κενό = ταφόπλακα, ο λογαριασμός δεν υπάρχει πια.';

create index if not exists profiles_active_idx
  on public.profiles (id) where deleted_at is null;

-- ---------------------------------------------------------------------------
-- 2. Διαγραφή λογαριασμού
-- ---------------------------------------------------------------------------
create or replace function public.delete_my_account()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  removed_files integer := 0;
begin
  if me is null then
    raise exception 'Πρέπει να είσαι συνδεδεμένος για να διαγράψεις τον λογαριασμό σου.'
      using errcode = '28000';
  end if;

  if exists (select 1 from profiles where id = me and deleted_at is not null) then
    raise exception 'Ο λογαριασμός έχει ήδη διαγραφεί.' using errcode = '23505';
  end if;

  -- Αρχεία που ανέβασε αλλά δεν κατέληξαν σε μήνυμα (avatar, μισοτελειωμένα
  -- uploads). Τα συνημμένα σταλμένων μηνυμάτων μένουν, αλλιώς ο παραλήπτης
  -- βλέπει σπασμένα μηνύματα που αποφασίσαμε να κρατήσουμε.
  with gone as (
    delete from storage.objects o
    where o.bucket_id = 'message-media'
      and (storage.foldername(o.name))[1] = me::text
      and not exists (
        select 1 from public.attachments a where a.storage_path = o.name
      )
    returning 1
  )
  select count(*) into removed_files from gone;

  -- Οι αποκλεισμοί του αφορούν μόνο εκείνον και δεν έχουν πια νόημα.
  delete from public.blocks where blocker_id = me or blocked_id = me;

  -- Τα reports ΜΕΝΟΥΝ, δείχνοντας στο ανωνυμοποιημένο προφίλ. Το ιστορικό
  -- καταγγελιών είναι μηχανισμός ασφάλειας· το GDPR επιτρέπει ρητά τη διατήρησή
  -- του για έννομο συμφέρον. Δεν περιέχει πια προσωπικά στοιχεία.

  -- Ταφόπλακα.
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

  -- Και τέλος ο ίδιος ο λογαριασμός. Τα auth.identities, auth.sessions και
  -- auth.refresh_tokens φεύγουν από μόνα τους με cascade.
  delete from auth.users where id = me;

  return jsonb_build_object('deleted', true, 'files_removed', removed_files);
end;
$$;

comment on function public.delete_my_account() is
  'Διαγράφει οριστικά τον λογαριασμό του καλούντος και ανωνυμοποιεί το προφίλ του.';

-- ---------------------------------------------------------------------------
-- 3. Εξαγωγή δεδομένων (GDPR άρθρο 20)
-- ---------------------------------------------------------------------------
create or replace function public.export_my_data()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'exported_at', now(),
    'format_version', 1,
    'note', 'Τα μηνύματα είναι σε απλό κείμενο. Ο λογαριασμός δεν έχει διαγραφεί με αυτή την ενέργεια.',

    'profile', (
      select jsonb_build_object(
        'email', p.email,
        'display_name', p.display_name,
        'username', p.username,
        'bio', p.bio,
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

    -- Μόνο τα δικά του μηνύματα. Το να κατέβαζε και του συνομιλητή του θα ήταν
    -- εξαγωγή δεδομένων τρίτου, που το GDPR δεν καλύπτει.
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object(
        'conversation_id', m.conversation_id,
        'sent_at', m.created_at,
        'edited_at', m.edited_at,
        'deleted_at', m.deleted_at,
        'body', case when m.encryption_version = 0 then m.ciphertext else null end,
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

comment on function public.export_my_data() is
  'Επιστρέφει σε JSON όλα τα δεδομένα του καλούντος. Δεν αλλάζει τίποτα.';

-- ---------------------------------------------------------------------------
-- 4. Οι διαγραμμένοι δεν εμφανίζονται σε αναζήτηση ή σε ταίριασμα επαφών
-- ---------------------------------------------------------------------------
-- Χωρίς αυτό, το ανωνυμοποιημένο προφίλ θα γύριζε στα αποτελέσματα σαν κανονικός
-- χρήστης με τον οποίο μπορείς να ξεκινήσεις συνομιλία που δεν θα διαβάσει ποτέ
-- κανείς. Το discover_by_email = 'nobody' τα κόβει ήδη, αλλά ο ρητός έλεγχος
-- επιβιώνει αν κάποτε αλλάξει η προεπιλογή.

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
    and p.deleted_at is null
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

create or replace function public.match_contacts(email_hashes text[])
returns setof jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  select public.profile_payload(p)
  from profiles p
  where auth.uid() is not null
    and p.id <> auth.uid()
    and p.deleted_at is null
    and p.discover_by_email = 'everyone'
    and array_length(email_hashes, 1) between 1 and 500
    and encode(digest(lower(p.email), 'sha256'), 'hex') = any(email_hashes)
    and not exists (
      select 1 from blocks b
      where (b.blocker_id = auth.uid() and b.blocked_id = p.id)
         or (b.blocker_id = p.id and b.blocked_id = auth.uid())
    )
  limit 200
$$;

-- ---------------------------------------------------------------------------
-- 5. Δικαιώματα
-- ---------------------------------------------------------------------------
revoke all on function public.delete_my_account() from public, anon;
revoke all on function public.export_my_data() from public, anon;

grant execute on function public.delete_my_account() to authenticated;
grant execute on function public.export_my_data() to authenticated;
