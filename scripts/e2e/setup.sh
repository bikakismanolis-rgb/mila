#!/usr/bin/env bash
# Ετοιμάζει την ΤΟΠΙΚΗ Supabase (supabase start) για τα e2e tests: τρεις
# λογαριασμούς (ann, ben, cat @test.local, κωδικός secret123) και άδεια
# δεδομένα. Ποτέ σε βάση με πραγματικούς χρήστες: σβήνει συνομιλίες και κλήσεις.
set -euo pipefail
API="${E2E_API:-http://127.0.0.1:54321}"
DB="${E2E_DB:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
# Το δημόσιο «demo» service key κάθε τοπικής Supabase. Όχι της παραγωγής.
SERVICE="${E2E_SERVICE:-eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU}"

case "$DB" in
  *127.0.0.1*|*localhost*) ;;
  *) echo "Αρνούμαι: το E2E_DB δεν είναι τοπικό ($DB)"; exit 1 ;;
esac

for who in "ann:Ann Archer" "ben:Ben Baker" "cat:Cat Cooper"; do
  email="${who%%:*}@test.local"; name="${who#*:}"
  curl -s -o /dev/null -X POST "$API/auth/v1/admin/users" \
    -H "apikey: $SERVICE" -H "Authorization: Bearer $SERVICE" -H "Content-Type: application/json" \
    -d "{\"email\":\"$email\",\"password\":\"secret123\",\"email_confirm\":true,\"user_metadata\":{\"display_name\":\"$name\"}}"
done

psql "$DB" -q -v ON_ERROR_STOP=1 -c "
delete from public.calls;
delete from public.conversations;
delete from public.user_devices;
delete from public.rate_limit_events;
update public.rate_limit_rules set max_count = 100000
  where action in ('upload_media', 'upload_media_mb', 'device_register', 'call', 'contact_request', 'message');
update public.profiles set show_online = true, read_receipts = true;
"
echo "έτοιμο"
