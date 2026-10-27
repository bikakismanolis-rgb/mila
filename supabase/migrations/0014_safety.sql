-- 0014: Ασφάλεια λογαριασμών και αναφορές. Idempotent, χωρίς drop: τρέχει και
-- από τον SQL editor και από εργαλεία. Προϋποθέτει το 0013. Συμβατό με το
-- προηγούμενο site: η παλιά «Αναφορά» (απευθείας INSERT) δουλεύει όπως πριν.
--
-- Μεταφέρει ό,τι χρήσιμο είχε το PR #1 (που γράφτηκε πριν από την
-- κρυπτογράφηση από άκρη σε άκρη), ξαναγραμμένο για το σημερινό σχήμα:
--
--  1. Indexes που έλειπαν.
--  2. Ονόματα: καθαρίζονται στη βάση (αόρατοι χαρακτήρες, αντιστροφή φοράς,
--     κενά), και κάποια ονόματα («Mila», «Admin», «Υποστήριξη»…) δεσμεύονται.
--  3. Αναστολή λογαριασμού: ένας λογαριασμός σε αναστολή δεν γράφει τίποτα,
--     δεν διαβάζει συνομιλίες, και βλέπει μια καθαρή οθόνη «σε αναστολή».
--  4. Αναφορές: για μήνυμα, ομάδα ή άνθρωπο, με κατάσταση (ανοιχτή, ελέγχθηκε,
--     έγινε ενέργεια, απορρίφθηκε) και προαιρετικό απόσπασμα. Τα μηνύματα είναι
--     κρυπτογραφημένα, άρα ο server δεν τα διαβάζει: το κείμενο το στέλνει η
--     συσκευή αυτού που κάνει την αναφορά, ΜΟΝΟ αν το επιλέξει ρητά.
--  5. Συντονιστές (πίνακας moderators): με κάθε νέα αναφορά παίρνουν
--     ειδοποίηση «Νέα αναφορά», χωρίς ονόματα και χωρίς κείμενο.
--  6. Εργαλεία για τον ιδιοκτήτη, ΜΟΝΟ από τον SQL editor: moderation_reports,
--     moderation_set_report_status, moderation_suspend, moderation_unsuspend,
--     moderation_remove_message. Οδηγίες: docs/MODERATION.md.
--  7. Εξαγωγή δεδομένων με κλήσεις και ρυθμίσεις συνομιλιών, και διαγραφή
--     λογαριασμού που καθαρίζει και ό,τι πρόσθεσε το 0013.
--
-- ΤΙ ΔΕΝ ΠΗΡΑΜΕ ΑΠΟ ΤΟ PR #1: το send_message σε απλό κείμενο (καταργήθηκε
-- σκόπιμα στο 0010) και το «μπλοκάρισμα» στο auth.users. Ένας λογαριασμός σε
-- αναστολή μπορεί ακόμα να συνδεθεί, ώστε να δει ΓΙΑΤΙ ανεστάλη, να κατεβάσει
-- τα δεδομένα του ή να διαγράψει τον λογαριασμό του. Όλα τα υπόλοιπα τα
-- αρνείται η βάση.

-- ---------------------------------------------------------------------------
-- 1. Indexes
-- ---------------------------------------------------------------------------
-- Το message_payload ψάχνει το συνημμένο κάθε μηνύματος· χωρίς αυτό σάρωνε
-- όλο τον πίνακα attachments για κάθε μήνυμα που φορτώνει.
create index if not exists attachments_message_idx
  on public.attachments (message_id);
-- Το κλειδί είναι (conversation_id, user_id)· οι «συνομιλίες μου» ψάχνουν με user_id.
create index if not exists conversation_members_user_idx
  on public.conversation_members (user_id);
-- Το κλειδί είναι (blocker_id, blocked_id)· η διαγραφή λογαριασμού ψάχνει και ανάποδα.
create index if not exists blocks_blocked_idx
  on public.blocks (blocked_id);
create index if not exists reports_reporter_created_idx
  on public.reports (reporter_id, created_at desc);
create index if not exists reports_reported_idx
  on public.reports (reported_id);
-- Δεν μπήκαν, γιατί δεν τα χρειάζεται κανένα ερώτημα: messages(sender_id,
-- created_at) (το unique (sender_id, client_message_id) καλύπτει ήδη τις
-- αναζητήσεις ανά αποστολέα) και conversations(created_by).

-- ---------------------------------------------------------------------------
-- 2. Ονόματα
-- ---------------------------------------------------------------------------
-- Αόρατοι χαρακτήρες (zero-width, soft hyphen, «γεμίσματα» Hangul) και
-- χαρακτήρες που αντιστρέφουν τη φορά του κειμένου επιτρέπουν σε κάποιον να
-- φτιάξει όνομα που ΜΟΙΑΖΕΙ με άλλο, ή που «σπρώχνει» ό,τι ακολουθεί. Δεν έχουν
-- θέση σε όνομα. Κάθε είδος κενού γίνεται απλό κενό, και τα πολλά κενά ένα.
-- Πάνω από δύο τονικά σημάδια στη σειρά (το «z̷̢a̵l̶g̴o» κείμενο) κόβονται.
create or replace function public.clean_display_name(raw text)
returns text
language sql
immutable
set search_path = ''
as $$
  select btrim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
    normalize(coalesce(raw, ''), NFC),
    '[\t\n\v\f\r\u0085   -     　]', ' ', 'g'),
    '[\u0001-\u001F\u007F-\u009F­͏؜ᅟᅠ឴឵᠋-᠏​-‏‪-‮⁠-⁯ㅤ﻿ﾠ￰-￻\U0001D173-\U0001D17A\U000E0000-\U000E007F]', '', 'g'),
    '([̀-ͯ]{2})[̀-ͯ]+', '\1', 'g'),
    ' {2,}', ' ', 'g'), ' ')
$$;

-- Ο «σκελετός» ενός ονόματος, μόνο για σύγκριση: πεζά, χωρίς τόνους, χωρίς
-- κενά και σημεία στίξης, και κάθε γράμμα που μοιάζει με λατινικό (ελληνικό
-- Α, Μ, Ι, Ο, κυριλλικό а, о, р…) γίνεται εκείνο. Έτσι «ΜΙΛΑ», «M i l a»,
-- «Μila» (με ελληνικό Μ) και «Mila!» δίνουν τον ίδιο σκελετό.
-- Ίδια γράμματα σε κεφαλαία και πεζά πάνε πάντα στο ίδιο (Η και η -> h,
-- Υ, υ και u -> y), αλλιώς το «ΥΠΟΣΤΗΡΙΞΗ» δεν θα ταίριαζε με το «Υποστήριξη».
create or replace function public.name_skeleton(raw text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(
    translate(
      lower(translate(
        public.clean_display_name(raw),
        'ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩΆΈΉΊΌΎΏΪΫАВЕКМНОРСТУХІЈЅ',
        'abyδezhθikλmnξoπpσtyφxψωaehioyωiyabekmhopctyxijs'
      )),
      'αβγδεζηθικλμνξοπρσςτυφχψωάέήίόύώϊϋΐΰавекмнорстухіјѕԁӏul10',
      'abyδezhθikλmnξoπpσσtyφxψωaehioyωiyiyabekmhopctyxijsdiyiio'
    ),
    '[^a-z0-9α-ω]', '', 'g')
$$;

-- Ονόματα που μοιάζουν με την ίδια την υπηρεσία ή με διαχειριστή. Ταιριάζουν
-- ΟΛΟΚΛΗΡΑ (σκελετός με σκελετό): το «Mila» δεσμεύεται, το «Mila Kunis» όχι.
-- Επίσης ο συνδυασμός «Mila» + ρόλος, με όποια σειρά: «Mila Support»,
-- «Ομάδα Mila», «Μίλα Υποστήριξη».
create or replace function public.is_reserved_name(raw text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  with s as (select public.name_skeleton(raw) as k),
  brands(b) as (values ('mila'), ('μίλα')),
  roles(r) as (values
    ('team'), ('support'), ('admin'), ('administrator'), ('moderator'), ('official'),
    ('app'), ('help'), ('helpdesk'), ('security'), ('safety'), ('staff'), ('system'),
    ('ομάδα'), ('υποστήριξη'), ('διαχείριση'), ('διαχειριστής'), ('συντονιστής'),
    ('βοήθεια'), ('ασφάλεια')
  ),
  words(w) as (
    select b from brands
    union all select r from roles where r not in ('team', 'app', 'ομάδα')
    union all values
      ('mod'), ('root'), ('διαχειρίστρια'), ('συντονίστρια'), ('σύστημα'),
      ('deleted user'), ('διαγραμμένος χρήστης')
    union all select b || r from brands, roles
    union all select r || b from brands, roles
  )
  select s.k <> '' and exists (
    select 1 from words where public.name_skeleton(words.w) = s.k
  )
  from s
$$;

-- Σε κάθε εγγραφή του profiles: το trigger της εγγραφής (handle_new_auth_user),
-- το ensure_my_profile, και η αλλαγή ονόματος από τις Ρυθμίσεις.
create or replace function public.profiles_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  fallback text;
begin
  -- Η ταφόπλακα του delete_my_account έχει σταθερό όνομα («Deleted user»).
  if new.deleted_at is not null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- Στην εγγραφή ποτέ σφάλμα: θα έριχνε ολόκληρη τη δημιουργία λογαριασμού.
    -- Ένα όνομα που δεν περνάει γίνεται το κομμάτι του email πριν το @, και
    -- αν ούτε αυτό περνάει, «New user» (το αλλάζει μετά από τις Ρυθμίσεις).
    new.display_name := left(public.clean_display_name(new.display_name), 60);
    if char_length(new.display_name) < 2 or public.is_reserved_name(new.display_name) then
      fallback := left(public.clean_display_name(split_part(new.email, '@', 1)), 60);
      new.display_name := case
        when char_length(fallback) >= 2 and not public.is_reserved_name(fallback) then fallback
        else 'New user'
      end;
    end if;
    if new.username is not null and public.is_reserved_name(new.username) then
      new.username := null;
    end if;
    return new;
  end if;

  -- Αλλαγή. Το «update of display_name» πυροδοτείται και όταν το όνομα απλώς
  -- ξαναστέλνεται ίδιο (οι Ρυθμίσεις στέλνουν όνομα και bio μαζί): τότε δεν
  -- ελέγχεται τίποτα, ώστε όποιος είχε ήδη όνομα πριν από αυτούς τους κανόνες
  -- να αλλάζει ελεύθερα τα υπόλοιπα.
  if new.display_name is distinct from old.display_name then
    new.display_name := public.clean_display_name(new.display_name);
    if char_length(new.display_name) not between 2 and 60 then
      raise exception 'Display name must be 2 to 60 characters' using errcode = '22023';
    end if;
    if public.name_skeleton(new.display_name) is distinct from public.name_skeleton(old.display_name)
       and public.is_reserved_name(new.display_name) then
      raise exception 'This name is reserved' using errcode = '23514';
    end if;
  end if;
  if new.username is distinct from old.username
     and new.username is not null
     and public.is_reserved_name(new.username) then
    raise exception 'This name is reserved' using errcode = '23514';
  end if;
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'profiles_before_write' and tgrelid = 'public.profiles'::regclass
  ) then
    create trigger profiles_before_write
    before insert or update of display_name, username on public.profiles
    for each row execute function public.profiles_before_write();
  end if;
end
$$;

-- Ονόματα που υπάρχουν ήδη: φεύγουν ΜΟΝΟ οι αόρατοι χαρακτήρες και τα
-- περιττά κενά. Ό,τι θα έβγαινε πολύ μικρό μένει όπως είναι.
update public.profiles
set display_name = public.clean_display_name(display_name)
where deleted_at is null
  and display_name <> public.clean_display_name(display_name)
  and char_length(public.clean_display_name(display_name)) between 2 and 60;

-- ---------------------------------------------------------------------------
-- 3. Αναστολή λογαριασμού
-- ---------------------------------------------------------------------------
-- Οι στήλες ΔΕΝ μπαίνουν στο grant update του 0007, άρα ο χρήστης δεν τις
-- αλλάζει. Τις βλέπει μόνο ο ίδιος (profiles_read_self): έτσι το app μαθαίνει
-- ότι είναι σε αναστολή, και γιατί.
alter table public.profiles add column if not exists suspended_at timestamptz;
alter table public.profiles add column if not exists suspended_reason text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_suspended_reason_length' and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles add constraint profiles_suspended_reason_length
      check (suspended_reason is null or char_length(suspended_reason) <= 500);
  end if;
end
$$;

-- Ενεργός = ούτε διαγραμμένος ούτε σε αναστολή. Το ελέγχουν όλα τα RPC που
-- γράφουν (μέσω αυτού ή του can_post_to_conversation): αποστολή, κλήσεις,
-- αναζήτηση, νέες συνομιλίες και ομάδες, συσκευές, uploads. Ισχύει ΑΜΕΣΩΣ,
-- χωρίς να περιμένουμε να λήξει το token του.
create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and deleted_at is null and suspended_at is null
  )
$$;

-- Πετάει «Account suspended» αν ο καλών είναι σε αναστολή. Ο browser το
-- αναγνωρίζει και δείχνει την οθόνη αναστολής αντί για ένα app που «χαλάει».
create or replace function public.refuse_if_suspended()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and exists (
    select 1 from profiles where id = auth.uid() and suspended_at is not null
  ) then
    raise exception 'Account suspended' using errcode = '42501';
  end if;
end;
$$;

-- Ό,τι διαβάζεται με RLS (μηνύματα, συνομιλίες, μέλη, συνημμένα, αντιδράσεις,
-- κλήσεις, αρχεία στο storage, και ό,τι φτάνει ζωντανά μέσω Realtime) περνάει
-- από εδώ. Ένας λογαριασμός σε αναστολή (ή διαγραμμένος, με token που δεν έχει
-- λήξει ακόμα) δεν είναι πια «μέλος» για καμία ανάγνωση.
create or replace function public.is_conversation_member(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from conversation_members cm
    join profiles p on p.id = cm.user_id
    where cm.conversation_id = target
      and cm.user_id = auth.uid()
      and p.deleted_at is null
      and p.suspended_at is null
  )
$$;

-- Δίχτυ για ΚΑΘΕ εγγραφή, όχι μόνο για τα RPC που ελέγχουν το is_active_user:
-- αποδοχή αιτήματος, «διαγραφή για όλους» (σβήσιμο αποδεικτικών), αλλαγή
-- ονόματος ομάδας, προσθήκη μελών, αλλαγή ονόματος, αναφορές, κλήσεις,
-- «σε σύνδεση», και ό,τι RPC προστεθεί αργότερα. Ένα trigger ανά εντολή (όχι
-- ανά γραμμή), άρα ένας έλεγχος ανά εντολή. Ελέγχει ΤΟΝ ΚΑΛΟΥΝΤΑ: όταν ένας
-- ενεργός χρήστης γράφει σε κάποιον σε αναστολή, όλα δουλεύουν κανονικά. Ο
-- SQL editor, το service role και το Auth (χωρίς auth.uid()) δεν επηρεάζονται.
--
-- Εξαίρεση: η διαγραφή λογαριασμού. Τη ζητάει ο ίδιος (GDPR άρθρο 17), και
-- το delete_my_account το δηλώνει με το mila.erasing_account μέσα στη δική του
-- συναλλαγή. Από τον browser αυτή η ρύθμιση δεν ορίζεται.
create or replace function public.refuse_suspended_writes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('mila.erasing_account', true) is distinct from 'on' then
    perform public.refuse_if_suspended();
  end if;
  return null;
end;
$$;

do $$
declare
  guarded record;
begin
  for guarded in
    select * from (values
      ('profiles', 'insert or update or delete'),
      ('conversations', 'insert or update or delete'),
      ('conversation_members', 'insert or update or delete'),
      ('conversation_prefs', 'insert or update or delete'),
      ('messages', 'insert or update or delete'),
      ('attachments', 'insert or update or delete'),
      ('message_receipts', 'insert or update or delete'),
      ('message_reactions', 'insert or update or delete'),
      ('message_hidden', 'insert or update or delete'),
      ('message_keys', 'insert or update or delete'),
      ('calls', 'insert or update or delete'),
      ('call_participants', 'insert or update or delete'),
      ('call_heartbeats', 'insert or update or delete'),
      ('user_devices', 'insert or update or delete'),
      ('reports', 'insert'),
      -- Η ΑΦΑΙΡΕΣΗ συνδρομής (αποσύνδεση) επιτρέπεται πάντα.
      ('push_subscriptions', 'insert or update')
    ) as t(tbl, events)
  loop
    if not exists (
      select 1 from pg_trigger
      where tgname = 'refuse_suspended'
        and tgrelid = format('public.%I', guarded.tbl)::regclass
    ) then
      execute format(
        'create trigger refuse_suspended before %s on public.%I
         for each statement execute function public.refuse_suspended_writes()',
        guarded.events, guarded.tbl);
    end if;
  end loop;
end
$$;

-- Τα RPC που ΔΙΑΒΑΖΟΥΝ συνομιλίες δεν περνούν από RLS (τρέχουν ως ιδιοκτήτης
-- της βάσης), οπότε ελέγχουν μόνα τους. Ίδια με πριν, με τον έλεγχο στην αρχή:
-- έγιναν plpgsql μόνο για να μπορούν να πετάξουν το σφάλμα.

-- Ίδιο με το 0013.
create or replace function public.list_conversations()
returns setof jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.refuse_if_suspended();
  return query
  select jsonb_build_object(
    'id', c.id::text,
    'type', c.kind::text,
    'name', c.name,
    'myRole', cm.role::text,
    'createdAt', c.created_at,
    'requestFrom', c.request_from::text,
    'requestStatus', c.request_status::text,
    'blockedByMe', c.kind = 'direct' and exists (
      select 1
      from conversation_members o
      join blocks b on b.blocker_id = auth.uid() and b.blocked_id = o.user_id
      where o.conversation_id = c.id and o.user_id <> auth.uid()
    ),
    'mutedUntil', case when cp.muted_until > now() then cp.muted_until end,
    'archived', coalesce(cp.archived, false),
    'pinnedAt', cp.pinned_at,
    'others', coalesce((
      select jsonb_agg(
        public.profile_payload(p) || jsonb_build_object('role', cm2.role::text)
        order by p.display_name
      )
      from conversation_members cm2
      join profiles p on p.id = cm2.user_id
      where cm2.conversation_id = c.id
        and cm2.user_id <> auth.uid()
    ), '[]'::jsonb),
    'last', (
      select public.message_payload(m)
      from messages m
      where m.conversation_id = c.id
        and not exists (
          select 1 from message_hidden h
          where h.message_id = m.id and h.user_id = auth.uid()
        )
      order by m.created_at desc, m.id desc
      limit 1
    ),
    'lastCall', (
      select public.call_payload(k)
      from calls k
      where k.conversation_id = c.id
        and k.created_at >= cm.joined_at - interval '1 minute'
      order by k.created_at desc
      limit 1
    ),
    'unread', (
      select count(*)
      from messages m
      where m.conversation_id = c.id
        and m.sender_id <> auth.uid()
        and m.deleted_at is null
        and not exists (
          select 1 from message_hidden h
          where h.message_id = m.id and h.user_id = auth.uid()
        )
        and not exists (
          select 1 from message_receipts r
          where r.message_id = m.id
            and r.user_id = auth.uid()
            and r.read_at is not null
        )
    )
  )
  from conversations c
  join conversation_members cm
    on cm.conversation_id = c.id and cm.user_id = auth.uid()
  left join conversation_prefs cp
    on cp.conversation_id = c.id and cp.user_id = auth.uid()
  where auth.uid() is not null
    and c.request_status <> 'rejected'
  order by greatest(
    coalesce((select max(m.created_at) from messages m where m.conversation_id = c.id), c.created_at),
    coalesce((select max(k.created_at) from calls k where k.conversation_id = c.id), c.created_at)
  ) desc;
end;
$$;

-- Ίδιο με το 0008.
create or replace function public.list_messages(
  conversation uuid,
  before_message uuid default null,
  page_size integer default 50
)
returns setof jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.refuse_if_suspended();
  return query
  select public.message_payload(m)
  from (
    select mm.*
    from messages mm
    where mm.conversation_id = list_messages.conversation
      and exists (
        select 1 from conversation_members cm
        where cm.conversation_id = list_messages.conversation
          and cm.user_id = auth.uid()
      )
      and not exists (
        select 1 from message_hidden h
        where h.message_id = mm.id and h.user_id = auth.uid()
      )
      and (
        list_messages.before_message is null
        or (mm.created_at, mm.id) < (
          select b.created_at, b.id from messages b
          where b.id = list_messages.before_message
            and b.conversation_id = list_messages.conversation
        )
      )
    order by mm.created_at desc, mm.id desc
    limit least(greatest(coalesce(list_messages.page_size, 50), 1), 200)
  ) m
  order by m.created_at, m.id;
end;
$$;

-- Ίδιο με το 0008.
create or replace function public.get_message(message uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.refuse_if_suspended();
  return (
    select public.message_payload(m)
    from messages m
    where m.id = get_message.message
      and exists (
        select 1 from conversation_members cm
        where cm.conversation_id = m.conversation_id and cm.user_id = auth.uid()
      )
      and not exists (
        select 1 from message_hidden h
        where h.message_id = m.id and h.user_id = auth.uid()
      )
  );
end;
$$;

-- Ίδιο με το 0008.
create or replace function public.search_messages(search_term text, conversation uuid default null)
returns setof jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.refuse_if_suspended();
  return query
  with input as (
    select
      length(trim(search_messages.search_term)) as len,
      '%' || replace(replace(replace(trim(search_messages.search_term), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pattern
  )
  select public.message_payload(m)
  from messages m
  cross join input i
  join conversation_members cm
    on cm.conversation_id = m.conversation_id and cm.user_id = auth.uid()
  join conversations c on c.id = m.conversation_id
  where auth.uid() is not null
    and i.len >= 2
    and (search_messages.conversation is null or m.conversation_id = search_messages.conversation)
    and c.request_status <> 'rejected'
    and m.deleted_at is null
    and m.encryption_version = 0
    and not exists (
      select 1 from message_hidden h
      where h.message_id = m.id and h.user_id = auth.uid()
    )
    and (
      m.ciphertext ilike i.pattern
      or exists (
        select 1 from attachments a
        where a.message_id = m.id
          and public.safe_jsonb(a.encrypted_metadata)->>'name' ilike i.pattern
      )
    )
  order by m.created_at desc, m.id desc
  limit 50;
end;
$$;

-- Ίδιο με το 0013.
create or replace function public.list_calls(
  p_conversation uuid default null,
  p_since timestamptz default null,
  p_limit integer default 100
)
returns setof jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.refuse_if_suspended();
  return query
  select public.call_payload(c)
  from calls c
  join conversation_members cm
    on cm.conversation_id = c.conversation_id and cm.user_id = auth.uid()
  join conversations cv on cv.id = c.conversation_id and cv.request_status <> 'rejected'
  where (p_conversation is null or c.conversation_id = p_conversation)
    and (p_since is null or c.created_at >= p_since)
    and c.created_at >= cm.joined_at - interval '1 minute'
  order by c.created_at desc
  limit least(greatest(coalesce(p_limit, 100), 1), 300);
end;
$$;

-- Ίδιο με το 0013. Όποιος είναι σε αναστολή (π.χ. επειδή παρενοχλούσε
-- κάποιον) δεν παρακολουθεί πότε είναι εκείνος online.
create or replace function public.get_presence(target uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.refuse_if_suspended();
  return (select public.presence_payload(p) from profiles p where p.id = get_presence.target);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Αναφορές
-- ---------------------------------------------------------------------------
-- Μέχρι τώρα: ποιος, για ποιον, γιατί. Τώρα και:
--   status       open → reviewed (το είδες) / actioned (έκανες κάτι) / dismissed
--   reviewed_at  πότε άλλαξε για τελευταία φορά η κατάσταση
--   conversation_id, message_id  για ποια συνομιλία / ποιο μήνυμα (αν χαθούν,
--                γίνονται null· η αναφορά μένει)
--   excerpt      το κείμενο που έστειλε η συσκευή του χρήστη, ΜΟΝΟ αν το
--                επέλεξε. Ο server δεν μπορεί να το επιβεβαιώσει: είναι ό,τι
--                λέει ο χρήστης ότι έγραφε το μήνυμα.
-- Αναφορά για ΟΜΑΔΑ: reported_id = null, conversation_id = η ομάδα.
alter table public.reports add column if not exists status text not null default 'open';
alter table public.reports add column if not exists reviewed_at timestamptz;
alter table public.reports add column if not exists conversation_id uuid
  references public.conversations(id) on delete set null;
alter table public.reports add column if not exists message_id uuid
  references public.messages(id) on delete set null;
alter table public.reports add column if not exists excerpt text;
alter table public.reports alter column reported_id drop not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'reports_status_check' and conrelid = 'public.reports'::regclass
  ) then
    alter table public.reports add constraint reports_status_check
      check (status in ('open', 'reviewed', 'actioned', 'dismissed'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'reports_excerpt_length' and conrelid = 'public.reports'::regclass
  ) then
    alter table public.reports add constraint reports_excerpt_length
      check (excerpt is null or char_length(excerpt) between 1 and 4000);
  end if;
end
$$;

-- Χωρίς αυτά, κάθε σβήσιμο μηνύματος ή ομάδας θα σάρωνε όλο τον πίνακα για
-- να βρει τι να κάνει null.
create index if not exists reports_message_idx
  on public.reports (message_id) where message_id is not null;
create index if not exists reports_conversation_idx
  on public.reports (conversation_id) where conversation_id is not null;
create index if not exists reports_status_created_idx
  on public.reports (status, created_at desc);

-- Ο browser ΔΕΝ διαβάζει αναφορές, ούτε τις δικές του: τις βλέπουν μόνο τα
-- εργαλεία του βήματος 6. Γράφει μόνο τις τρεις στήλες που έγραφε πάντα το
-- παλιό site· όλα τα καινούργια (μήνυμα, ομάδα, απόσπασμα) περνούν από το
-- submit_report, που τα ελέγχει.
revoke all on public.reports from anon, authenticated;
grant insert (reporter_id, reported_id, reason) on public.reports to authenticated;

-- Ό,τι κι αν στείλει κανείς, η αναφορά ξεκινάει «ανοιχτή» και με την ώρα της
-- βάσης. Το «στο όνομά μου» το ελέγχει το policy reports_insert_self (0001).
create or replace function public.reports_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.status := 'open';
  new.reviewed_at := null;
  new.created_at := now();
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'reports_before_insert' and tgrelid = 'public.reports'::regclass
  ) then
    create trigger reports_before_insert
    before insert on public.reports
    for each row execute function public.reports_before_insert();
  end if;
end
$$;

-- Αναφορά από το app. Ένα από τα τρία:
--   p_message       ένα μήνυμα (αναφέρεται ο αποστολέας του),
--   p_conversation  μια ομάδα, ή μια ατομική συνομιλία (αναφέρεται ο άλλος),
--   p_user          ένας άνθρωπος με τον οποίο μοιράζομαι συνομιλία.
-- Μόνο για ό,τι βλέπω ήδη: μέλος της συνομιλίας, όχι ξένα ids. Το όριο
-- «report» (10 την ημέρα, 0010) ισχύει όπως πριν, από το trigger count_reports.
create or replace function public.submit_report(
  p_reason text,
  p_user uuid default null,
  p_conversation uuid default null,
  p_message uuid default null,
  p_excerpt text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  clean_reason text := trim(coalesce(p_reason, ''));
  clean_excerpt text := nullif(trim(coalesce(p_excerpt, '')), '');
  target_user uuid := p_user;
  target_conversation uuid := p_conversation;
  msg messages%rowtype;
  convo conversations%rowtype;
  new_id uuid;
begin
  if me is null or not public.is_active_user() then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if char_length(clean_reason) not between 1 and 500 then
    raise exception 'Report reason must be 1 to 500 characters' using errcode = '22023';
  end if;
  if char_length(clean_excerpt) > 4000 then
    raise exception 'Report excerpt is too long' using errcode = '22001';
  end if;

  if p_message is not null then
    select m.* into msg from messages m where m.id = p_message;
    if not found
       or (p_conversation is not null and p_conversation <> msg.conversation_id)
       or (p_user is not null and p_user <> msg.sender_id) then
      raise exception 'Nothing to report' using errcode = 'P0002';
    end if;
    target_conversation := msg.conversation_id;
    target_user := msg.sender_id;
  end if;

  if target_conversation is not null then
    select c.* into convo
    from conversations c
    join conversation_members cm on cm.conversation_id = c.id and cm.user_id = me
    where c.id = target_conversation;
    if not found then
      raise exception 'Nothing to report' using errcode = 'P0002';
    end if;
    if target_user is null and convo.kind = 'direct' then
      select cm.user_id into target_user
      from conversation_members cm
      where cm.conversation_id = convo.id and cm.user_id <> me
      limit 1;
    end if;
    -- Ο άνθρωπος πρέπει να είναι σε αυτή τη συνομιλία. Ο αποστολέας ενός
    -- μηνύματος μπορεί να έχει φύγει στο μεταξύ από την ομάδα: μετράει κι αυτός.
    if p_message is null and target_user is not null and not exists (
      select 1 from conversation_members cm
      where cm.conversation_id = convo.id and cm.user_id = target_user
    ) then
      raise exception 'Nothing to report' using errcode = 'P0002';
    end if;
  elsif target_user is not null then
    if not exists (
      select 1
      from conversation_members mine
      join conversation_members theirs on theirs.conversation_id = mine.conversation_id
      where mine.user_id = me and theirs.user_id = target_user
    ) then
      raise exception 'Nothing to report' using errcode = 'P0002';
    end if;
  else
    raise exception 'Nothing to report' using errcode = '22023';
  end if;

  if target_user = me then
    raise exception 'You cannot report yourself' using errcode = '22023';
  end if;
  -- Το απόσπασμα έχει νόημα μόνο μαζί με τη συνομιλία από την οποία βγήκε.
  if clean_excerpt is not null and target_conversation is null then
    raise exception 'Nothing to report' using errcode = '22023';
  end if;

  insert into reports (reporter_id, reported_id, reason, conversation_id, message_id, excerpt)
  values (me, target_user, clean_reason, target_conversation, p_message, clean_excerpt)
  returning id into new_id;
  return new_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Συντονιστές και ειδοποίηση για κάθε νέα αναφορά
-- ---------------------------------------------------------------------------
-- Ποιοι παίρνουν «Νέα αναφορά» στις συσκευές τους. Κανένα policy: ούτε
-- διαβάζεται ούτε αλλάζει από τον browser. Μόνο από τον SQL editor (ή με
-- το service role). Οδηγίες: docs/MODERATION.md.
create table if not exists public.moderators (
  user_id uuid primary key references auth.users(id) on delete cascade,
  added_at timestamptz not null default now()
);
alter table public.moderators enable row level security;
revoke all on public.moderators from anon, authenticated;

-- Για την Edge Function (ΜΟΝΟ service_role). Η ειδοποίηση δεν λέει τίποτα
-- άλλο από «υπάρχει νέα αναφορά»: ούτε ποιος, ούτε για ποιον, ούτε κείμενο.
-- Ό,τι περνάει από την υπηρεσία push (Google, Apple, Mozilla) δεν το βλέπουν
-- άλλοι, αλλά ο κανόνας είναι: τίποτα που δεν χρειάζεται.
create or replace function public.push_report_targets(p_report uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'payload', jsonb_build_object('type', 'report'),
    'subscriptions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id::text,
        'endpoint', s.endpoint,
        'p256dh', s.p256dh,
        'auth', s.auth
      ))
      from moderators mo
      join profiles p on p.id = mo.user_id and p.deleted_at is null and p.suspended_at is null
      join push_subscriptions s on s.user_id = mo.user_id
      where mo.user_id is distinct from r.reporter_id
    ), '[]'::jsonb)
  )
  from reports r
  where r.id = p_report
$$;

-- Ίδιος δρόμος με τα μηνύματα (0009) και τις κλήσεις (0013): trigger ->
-- pg_net -> Edge Function «push». Κανένας συντονιστής με συσκευή = καμία κλήση.
create or replace function public.notify_new_report()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  config push_config%rowtype;
begin
  if not exists (
    select 1
    from moderators mo
    join push_subscriptions s on s.user_id = mo.user_id
    where mo.user_id is distinct from new.reporter_id
  ) then
    return null;
  end if;

  select * into config from push_config;
  if not found then
    return null;
  end if;

  perform net.http_post(
    url := config.function_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || config.anon_key,
      'x-mila-secret', config.webhook_secret
    ),
    body := jsonb_build_object('action', 'report', 'report_id', new.id),
    timeout_milliseconds := 8000
  );
  return null;
exception when others then
  -- Ποτέ δεν αφήνουμε μια ειδοποίηση να χαλάσει μια αναφορά.
  raise warning 'notify_new_report skipped: %', sqlerrm;
  return null;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'reports_notify' and tgrelid = 'public.reports'::regclass
  ) then
    create trigger reports_notify
    after insert on public.reports
    for each row execute function public.notify_new_report();
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 6. Εργαλεία για τον ιδιοκτήτη (ΜΟΝΟ από τον SQL editor)
-- ---------------------------------------------------------------------------
-- Κανένας ρόλος του browser δεν τα εκτελεί (δες τα δικαιώματα στο τέλος). Και
-- αν κάποτε ξεφύγει ένα grant, αρνούνται ό,τι έρχεται με token χρήστη: στον
-- SQL editor δεν υπάρχει auth.uid().

-- Οι αναφορές, με ονόματα και email. p_status: 'open' (προεπιλογή),
-- 'reviewed', 'actioned', 'dismissed', ή 'all' για όλες.
create or replace function public.moderation_reports(p_status text default 'open')
returns table (
  id uuid,
  created_at timestamptz,
  status text,
  reviewed_at timestamptz,
  about text,
  reason text,
  excerpt text,
  reported_id uuid,
  reported_name text,
  reported_email text,
  reported_suspended_at timestamptz,
  reports_against_them bigint,
  reporter_id uuid,
  reporter_name text,
  reporter_email text,
  conversation_id uuid,
  group_name text,
  message_id uuid,
  message_sent_at timestamptz,
  message_deleted_at timestamptz,
  message_has_attachment boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    r.id,
    r.created_at,
    r.status,
    r.reviewed_at,
    case
      when r.message_id is not null then 'message'
      when r.reported_id is null then 'group'
      else 'person'
    end,
    r.reason,
    r.excerpt,
    r.reported_id,
    reported.display_name,
    reported.email,
    reported.suspended_at,
    (select count(*) from reports x where x.reported_id = r.reported_id),
    r.reporter_id,
    reporter.display_name,
    reporter.email,
    r.conversation_id,
    case when c.kind = 'group' then c.name end,
    r.message_id,
    m.created_at,
    m.deleted_at,
    exists (select 1 from attachments a where a.message_id = r.message_id)
  from reports r
  join profiles reporter on reporter.id = r.reporter_id
  left join profiles reported on reported.id = r.reported_id
  left join conversations c on c.id = r.conversation_id
  left join messages m on m.id = r.message_id
  where auth.uid() is null
    and (coalesce(p_status, 'all') = 'all' or r.status = p_status)
  order by r.created_at desc
$$;

create or replace function public.moderation_set_report_status(p_report uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  changed reports%rowtype;
begin
  if auth.uid() is not null then
    raise exception 'Only from the SQL editor' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('open', 'reviewed', 'actioned', 'dismissed') then
    raise exception 'Status must be open, reviewed, actioned or dismissed' using errcode = '22023';
  end if;
  update reports
  set status = p_status,
      reviewed_at = case when p_status = 'open' then null else now() end
  where id = p_report
  returning * into changed;
  if not found then
    raise exception 'No report with id %', p_report using errcode = 'P0002';
  end if;
  return jsonb_build_object('id', changed.id, 'status', changed.status, 'reviewed_at', changed.reviewed_at);
end;
$$;

-- Αναστολή: από εκείνη τη στιγμή ο λογαριασμός δεν στέλνει, δεν καλεί, δεν
-- ψάχνει, δεν διαβάζει συνομιλίες και δεν παίρνει ειδοποιήσεις. Βλέπει την
-- οθόνη «σε αναστολή» με την αιτία (p_reason), που τη διαβάζει ο ίδιος:
-- γράψ' την όπως θα την έλεγες σε εκείνον. Τα μηνύματά του μένουν.
create or replace function public.moderation_suspend(p_user uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target profiles%rowtype;
begin
  if auth.uid() is not null then
    raise exception 'Only from the SQL editor' using errcode = '42501';
  end if;
  update profiles
  set suspended_at = coalesce(suspended_at, now()),
      suspended_reason = coalesce(left(nullif(trim(p_reason), ''), 500), suspended_reason)
  where id = p_user and deleted_at is null
  returning * into target;
  if not found then
    raise exception 'No active account with id %', p_user using errcode = 'P0002';
  end if;
  -- Καμία ειδοποίηση πια στις συσκευές του, και όποια κλήση ήταν μέσα κλείνει
  -- μόνη της (χωρίς σημεία ζωής, σε λιγότερο από ένα λεπτό).
  delete from push_subscriptions where user_id = p_user;
  delete from call_heartbeats where user_id = p_user;
  return jsonb_build_object(
    'id', target.id,
    'name', target.display_name,
    'email', target.email,
    'suspended_at', target.suspended_at,
    'reason', target.suspended_reason
  );
end;
$$;

create or replace function public.moderation_unsuspend(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target profiles%rowtype;
begin
  if auth.uid() is not null then
    raise exception 'Only from the SQL editor' using errcode = '42501';
  end if;
  update profiles
  set suspended_at = null, suspended_reason = null
  where id = p_user
  returning * into target;
  if not found then
    raise exception 'No account with id %', p_user using errcode = 'P0002';
  end if;
  return jsonb_build_object('id', target.id, 'name', target.display_name, 'email', target.email);
end;
$$;

-- Κατέβασμα ενός μηνύματος που παραβιάζει τους όρους ή τον νόμο, για όλους:
-- ίδιο αποτέλεσμα με το «Διαγραφή για όλους» του αποστολέα. Η αναφορά μένει
-- και δείχνει ότι σβήστηκε. Επιστρέφει τα αρχεία του, που σβήνονται με το χέρι
-- από το Storage (η βάση δεν επιτρέπεται να σβήνει αρχεία η ίδια).
create or replace function public.moderation_remove_message(p_message uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  paths jsonb := '[]'::jsonb;
begin
  if auth.uid() is not null then
    raise exception 'Only from the SQL editor' using errcode = '42501';
  end if;
  if not exists (select 1 from messages where id = p_message) then
    raise exception 'No message with id %', p_message using errcode = 'P0002';
  end if;
  select coalesce(jsonb_agg(a.storage_path), '[]'::jsonb) into paths
  from attachments a where a.message_id = p_message;

  delete from attachments where message_id = p_message;
  delete from message_keys where message_id = p_message;
  update message_reactions set emoji = null, updated_at = now()
  where message_id = p_message and emoji is not null;
  update messages
  set ciphertext = '', sender_key = null, deleted_at = coalesce(deleted_at, now()), edited_at = null
  where id = p_message;
  return jsonb_build_object('removed', p_message, 'files_to_delete', paths);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Εξαγωγή δεδομένων: + κλήσεις, ρυθμίσεις συνομιλιών, «σε σύνδεση»
-- ---------------------------------------------------------------------------
-- Ίδιο με το 0010, με αυτές τις προσθήκες, την αναστολή (αν υπάρχει) και τις
-- συσκευές ειδοποιήσεων. Δουλεύει και σε αναστολή: τα δεδομένα είναι δικά του.
-- Οι κλήσεις: όσες με αφορούν (ήμουν μέσα, με κάλεσαν, κάλεσα), με τους
-- άλλους με το όνομά τους, όπως οι συνομιλίες.
create or replace function public.export_my_data()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'exported_at', now(),
    'format_version', 3,
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
        ),
        'presence', jsonb_build_object(
          'show_online', p.show_online,
          'last_seen_at', p.last_seen_at,
          'online_until', p.online_until
        ),
        'suspension', case when p.suspended_at is not null then jsonb_build_object(
          'suspended_at', p.suspended_at,
          'reason', p.suspended_reason
        ) end
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
    'push_devices', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_agent', s.user_agent, 'created_at', s.created_at, 'updated_at', s.updated_at
      ) order by s.created_at)
      from push_subscriptions s where s.user_id = auth.uid()
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
    'conversation_prefs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'conversation_id', cp.conversation_id,
        'muted_until', cp.muted_until,
        'archived', cp.archived,
        'pinned_at', cp.pinned_at
      ) order by cp.conversation_id)
      from conversation_prefs cp where cp.user_id = auth.uid()
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
    'calls', coalesce((
      select jsonb_agg(jsonb_build_object(
        'conversation_id', c.conversation_id,
        'video', c.video,
        'started_at', c.created_at,
        'answered_at', c.answered_at,
        'ended_at', c.ended_at,
        'end_reason', c.end_reason,
        'i_called', c.caller_id = auth.uid(),
        'my_state', mine.state,
        'i_joined_at', mine.joined_at,
        'i_left_at', mine.left_at,
        'participants', (
          select jsonb_agg(jsonb_build_object('name', other.display_name, 'state', x.state))
          from call_participants x
          join profiles other on other.id = x.user_id
          where x.call_id = c.id and x.user_id <> auth.uid()
        )
      ) order by c.created_at)
      from call_participants mine
      join calls c on c.id = mine.call_id
      where mine.user_id = auth.uid()
    ), '[]'::jsonb),
    'blocked_users', coalesce((
      select jsonb_agg(b.blocked_id)
      from blocks b where b.blocker_id = auth.uid()
    ), '[]'::jsonb),
    'reports_filed', coalesce((
      select jsonb_agg(jsonb_build_object(
        'reason', r.reason,
        'created_at', r.created_at,
        'status', r.status,
        'conversation_id', r.conversation_id,
        'message_id', r.message_id,
        'excerpt', r.excerpt
      ) order by r.created_at)
      from reports r where r.reporter_id = auth.uid()
    ), '[]'::jsonb)
  )
  where auth.uid() is not null
$$;

-- ---------------------------------------------------------------------------
-- 8. Διαγραφή λογαριασμού: + ό,τι πρόσθεσε το 0013
-- ---------------------------------------------------------------------------
-- Ίδιο με το 0008, με: «τελευταία φορά εδώ» σβήνεται, φεύγουν οι ρυθμίσεις
-- συνομιλιών, τα σημεία ζωής κλήσεων, οι συνδρομές ειδοποιήσεων και η θέση
-- συντονιστή. Το ιστορικό των ΑΛΛΩΝ μένει όπως ήταν: μηνύματα και κλήσεις
-- δείχνουν στην ταφόπλακα «Deleted user», όπως πριν. Επιτρέπεται και σε
-- αναστολή (δες refuse_suspended_writes).
create or replace function public.delete_my_account()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  g uuid;
begin
  if me is null then
    raise exception 'Πρέπει να είσαι συνδεδεμένος για να διαγράψεις τον λογαριασμό σου.'
      using errcode = '28000';
  end if;

  if exists (select 1 from profiles where id = me and deleted_at is not null) then
    raise exception 'Ο λογαριασμός έχει ήδη διαγραφεί.' using errcode = '23505';
  end if;

  -- Μόνο για αυτή τη συναλλαγή (true = local).
  perform set_config('mila.erasing_account', 'on', true);

  -- Από τις ομάδες φεύγει κανονικά. Στις ατομικές μένει ως «Deleted user»,
  -- ώστε ο άλλος να κρατήσει τη συνομιλία του.
  for g in
    select c.id from conversations c
    join conversation_members cm on cm.conversation_id = c.id
    where c.kind = 'group' and cm.user_id = me
  loop
    perform public.leave_group_internal(g, me);
  end loop;

  delete from public.blocks where blocker_id = me or blocked_id = me;
  delete from public.message_hidden where user_id = me;
  update public.message_reactions set emoji = null, updated_at = now()
  where user_id = me and emoji is not null;
  delete from public.conversation_prefs where user_id = me;
  delete from public.call_heartbeats where user_id = me;
  delete from public.push_subscriptions where user_id = me;
  delete from public.moderators where user_id = me;

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
    last_seen_at      = null,
    online_until      = null,
    deleted_at        = now(),
    updated_at        = now()
  where id = me;

  delete from auth.users where id = me;

  return jsonb_build_object('deleted', true, 'files_removed', 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Δικαιώματα
-- ---------------------------------------------------------------------------
-- Triggers και εσωτερικά: κανένας από τον browser.
revoke all on function public.profiles_before_write() from public, anon, authenticated;
revoke all on function public.refuse_suspended_writes() from public, anon, authenticated;
revoke all on function public.reports_before_insert() from public, anon, authenticated;
revoke all on function public.notify_new_report() from public, anon, authenticated;
revoke all on function public.clean_display_name(text) from public, anon, authenticated;
revoke all on function public.name_skeleton(text) from public, anon, authenticated;
revoke all on function public.is_reserved_name(text) from public, anon, authenticated;

-- Μόνο η Edge Function.
revoke all on function public.push_report_targets(uuid) from public, anon, authenticated;
grant execute on function public.push_report_targets(uuid) to service_role;

-- Μόνο ο SQL editor (ο ιδιοκτήτης της βάσης). Ούτε το service role.
revoke all on function public.moderation_reports(text) from public, anon, authenticated, service_role;
revoke all on function public.moderation_set_report_status(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.moderation_suspend(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.moderation_unsuspend(uuid) from public, anon, authenticated, service_role;
revoke all on function public.moderation_remove_message(uuid) from public, anon, authenticated, service_role;

-- Το refuse_if_suspended το καλούν μόνο functions που τρέχουν ως ιδιοκτήτης.
-- Για τους συνδεδεμένους: το is_active_user και το is_conversation_member
-- τρέχουν και μέσα σε policies (ως ο χρήστης).
revoke all on function public.is_active_user() from public, anon;
revoke all on function public.refuse_if_suspended() from public, anon, authenticated;
revoke all on function public.is_conversation_member(uuid) from public, anon;
revoke all on function public.list_conversations() from public, anon;
revoke all on function public.list_messages(uuid, uuid, integer) from public, anon;
revoke all on function public.get_message(uuid) from public, anon;
revoke all on function public.search_messages(text, uuid) from public, anon;
revoke all on function public.list_calls(uuid, timestamptz, integer) from public, anon;
revoke all on function public.get_presence(uuid) from public, anon;
revoke all on function public.submit_report(text, uuid, uuid, uuid, text) from public, anon;
revoke all on function public.export_my_data() from public, anon;
revoke all on function public.delete_my_account() from public, anon;

grant execute on function public.is_active_user() to authenticated;
grant execute on function public.is_conversation_member(uuid) to authenticated;
grant execute on function public.list_conversations() to authenticated;
grant execute on function public.list_messages(uuid, uuid, integer) to authenticated;
grant execute on function public.get_message(uuid) to authenticated;
grant execute on function public.search_messages(text, uuid) to authenticated;
grant execute on function public.list_calls(uuid, timestamptz, integer) to authenticated;
grant execute on function public.get_presence(uuid) to authenticated;
grant execute on function public.submit_report(text, uuid, uuid, uuid, text) to authenticated;
grant execute on function public.export_my_data() to authenticated;
grant execute on function public.delete_my_account() to authenticated;

notify pgrst, 'reload schema';
