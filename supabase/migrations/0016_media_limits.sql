-- 0016: Μεγαλύτερα συνημμένα (έως 50 MB), με όριο και στον ΟΓΚΟ των uploads.
-- Idempotent, χωρίς drop: τρέχει και από τον SQL editor και από εργαλεία.
-- Προϋποθέτει το 0010 (rate_limit_rules, upload_allowed, bucket message-media).
--
-- ΤΙ ΑΛΛΑΖΕΙ
--
--   Μέχρι τώρα ένα αρχείο έφτανε τα 15 MB (bucket 16 MB). Ένα βίντεο λίγων
--   δευτερολέπτων από κινητό το ξεπερνάει. Η Supabase στο δωρεάν πλάνο δέχεται
--   έως 50 MB ανά αρχείο, άρα αυτό γίνεται και το όριο του bucket.
--
--   Το αρχείο ανεβαίνει κρυπτογραφημένο: όσο το αρχικό + 16 bytes (το tag του
--   AES-GCM, δες apps/web/src/limits.ts). Το app δέχεται αρχικό έως 50 MB μείον
--   16 bytes, ώστε το κρυπτογραφημένο να χωράει ακριβώς στα 50 MB. Μεγαλύτερο
--   όριο εδώ δεν θα βοηθούσε: το όριο ολόκληρου του project (Storage → Settings)
--   είναι κι αυτό 50 MB στο δωρεάν πλάνο, και ισχύει το μικρότερο από τα δύο.
--
--   Οι τύποι αρχείων (allowed_mime_types) δεν αλλάζουν: μόνο
--   application/octet-stream, δηλαδή μόνο κρυπτογραφημένα.
--
-- ΓΙΑΤΙ ΚΑΙ ΟΡΙΟ ΣΕ MB
--
--   Το όριο ως τώρα μετρούσε ΑΡΧΕΙΑ (60 την ώρα, 300 τη μέρα). Με αρχεία των
--   50 MB αυτό σημαίνει έως 15 GB τη μέρα από έναν λογαριασμό, ενώ ο δωρεάν
--   χώρος όλου του project είναι 1 GB. Προστίθεται όριο στα MB που ανέβασε
--   κάποιος: 300 MB την ώρα, 1000 MB τη μέρα. Φτάνει άνετα για κανονική χρήση
--   (ένα συμπιεσμένο βίντεο ενός λεπτού είναι ~15 MB).
--
--   Για να το αλλάξεις:
--     update public.rate_limit_rules set max_count = 2000
--     where action = 'upload_media_mb' and window_seconds = 86400;

-- ---------------------------------------------------------------------------
-- 1. Το όριο του bucket
-- ---------------------------------------------------------------------------
update storage.buckets
set file_size_limit = 52428800
where id = 'message-media';

-- ---------------------------------------------------------------------------
-- 2. Όριο στον όγκο των uploads
-- ---------------------------------------------------------------------------
-- max_count σε MB. «on conflict do nothing»: αν τις έχεις αλλάξει με το χέρι,
-- ένα δεύτερο τρέξιμο του migration δεν τις γυρίζει πίσω.
insert into public.rate_limit_rules (action, window_seconds, max_count, per_user) values
  ('upload_media_mb',  3600,  300, true),
  ('upload_media_mb', 86400, 1000, true)
on conflict (action, window_seconds) do nothing;

-- Ίδιο με το 0010 + τα όρια σε MB (κανόνες «<ενέργεια>_mb»). Μετράει όσα
-- ανέβηκαν ήδη: το αρχείο που ανεβαίνει τώρα δεν έχει ακόμα μέγεθος στη βάση,
-- άρα το όριο μπορεί να ξεπεραστεί το πολύ κατά ένα αρχείο.
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
  for rule in select * from rate_limit_rules where action = action_name || '_mb' loop
    select coalesce(sum((o.metadata->>'size')::bigint), 0) into used
    from storage.objects o
    where o.bucket_id = bucket
      and o.name like auth.uid()::text || '/%'
      and o.created_at > now() - make_interval(secs => rule.window_seconds)
      and coalesce(o.metadata->>'size', '') ~ '^[0-9]{1,18}$';
    if used >= rule.max_count::bigint * 1048576 then
      return false;
    end if;
  end loop;
  return public.is_active_user();
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Δικαιώματα
-- ---------------------------------------------------------------------------
-- Καλείται μέσα σε storage policies, που τρέχουν ως ο χρήστης.
revoke all on function public.upload_allowed(text) from public, anon;
grant execute on function public.upload_allowed(text) to authenticated;

notify pgrst, 'reload schema';
