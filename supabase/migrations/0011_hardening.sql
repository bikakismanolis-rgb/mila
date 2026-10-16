-- 0011: Δύο μικρά από τον έλεγχο ασφαλείας της Supabase μετά το 0010.
-- Idempotent. Χωρίς drop: τρέχει και από τον SQL editor και από εργαλεία.
--
-- 1. device_is_active: σταθερό search_path, όπως όλες οι υπόλοιπες functions.
--    Δεν διαβάζει πίνακες, οπότε αρκεί το κενό.
-- 2. handle_new_auth_user: είναι trigger function, την καλεί μόνο το trigger
--    στο auth.users. Ήταν εκτελέσιμη και από μη συνδεδεμένους μέσω του API
--    (/rest/v1/rpc/handle_new_auth_user). Δεν έκανε τίποτα έτσι, αλλά δεν
--    υπάρχει λόγος να είναι ανοιχτή. Τα triggers δεν χρειάζονται EXECUTE για να
--    τρέξουν, οπότε η εγγραφή χρηστών δεν επηρεάζεται.

alter function public.device_is_active(public.user_devices) set search_path = '';

revoke all on function public.handle_new_auth_user() from public, anon, authenticated;
revoke all on function public.throttle_signups() from public, anon, authenticated;
