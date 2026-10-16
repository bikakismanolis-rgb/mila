#!/usr/bin/env bash
# Τοπικά tests της βάσης: φτιάχνει καθαρή βάση, εφαρμόζει ΟΛΑ τα migrations με
# τη σειρά πάνω σε μια μίμηση της Supabase, και τρέχει τα tests.
#
#   PGHOST=/var/run/postgresql PGPORT=5432 supabase/tests/run.sh
#
# Θέλει έναν PostgreSQL 15+ server στον οποίο ο χρήστης σου μπορεί να φτιάξει βάσεις.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
db="mila_test_$$"
psql_db() { psql -v ON_ERROR_STOP=1 -q -X -d "$db" "$@"; }

createdb "$db"
trap 'dropdb --if-exists "$db" >/dev/null 2>&1 || true' EXIT

apply() {
  # Το pg_net δεν υπάρχει σε σκέτη PostgreSQL· το shim έχει ήδη ένα stub.
  sed 's/^create extension if not exists pg_net;//' "$1" \
    | PGOPTIONS='--client-min-messages=warning' psql_db -o /dev/null
}

PGOPTIONS='--client-min-messages=error' psql_db -f "$here/supabase_shim.sql" >/dev/null
for f in "$here"/../migrations/*.sql; do
  apply "$f"
  echo "applied $(basename "$f")"
done
# Δεύτερη εφαρμογή του τελευταίου: τα migrations πρέπει να ξανατρέχουν χωρίς ζημιά.
last="$(ls "$here"/../migrations/*.sql | tail -1)"
apply "$last"
echo "re-applied $(basename "$last")"

for t in "$here"/test_*.sql; do
  [ -e "$t" ] || continue
  echo "== $(basename "$t")"
  PGOPTIONS='--client-min-messages=warning' psql_db -o /dev/null -f "$t"
done
echo "ALL TESTS PASSED"
