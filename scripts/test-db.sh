#!/usr/bin/env bash
# Τρέχει ΟΛΑ τα migrations σε μια καθαρή βάση και μετά τα tests ασφαλείας.
#
#   PGHOST=localhost PGPORT=5432 PGUSER=postgres PGPASSWORD=postgres npm run test:db
#
# Φτιάχνει (και σβήνει πρώτα) μια βάση με όνομα mila_test. Δεν αγγίζει τίποτα
# άλλο. ΜΗΝ το τρέξεις με στοιχεία του πραγματικού project της Supabase: η
# Supabase έχει ήδη όλα όσα στήνει το shim, και το DROP DATABASE δεν γυρίζει πίσω.

set -euo pipefail

cd "$(dirname "$0")/.."

DB="${MILA_TEST_DB:-mila_test}"

case "${PGHOST:-localhost}" in
  *supabase.co*|*supabase.com*)
    echo "Refusing to run against a Supabase host. Use a local Postgres." >&2
    exit 1
    ;;
esac

psql_admin() { psql -X -q -v ON_ERROR_STOP=1 -d postgres "$@"; }
psql_test() { psql -X -q -v ON_ERROR_STOP=1 -d "$DB" "$@"; }

psql_admin -c "drop database if exists $DB" -c "create database $DB"

echo "== shim"
psql_test -f supabase/tests/supabase_shim.sql 2>&1 | { grep -vE 'wal_level|^HINT|skipping$' || true; }

for file in supabase/migrations/*.sql; do
  echo "== $(basename "$file")"
  # Δύο προσαρμογές, μόνο για εδώ:
  #  * κάποια αρχεία ξεκινούν με BOM (σώθηκαν από Windows) και το psql σκοντάφτει,
  #  * το pg_net δεν υπάρχει σε σκέτη Postgres· το shim έχει έτοιμη τη net.http_post.
  sed -e '1s/^\xEF\xBB\xBF//' \
      -e 's/^create extension if not exists pg_net;//' \
      "$file" | psql_test 2>&1 | { grep -vE 'skipping$|^NOTICE:  extension|wal_level|^HINT' || true; }
  test "${PIPESTATUS[1]}" -eq 0
done

echo "== tests"
# Τα αποτελέσματα των SELECT δεν λένε τίποτα· τα «ok - …» έρχονται ως NOTICE.
psql_test -f supabase/tests/security_test.sql 2>&1 >/dev/null \
  | sed -E -e '/skipping$/d' -e 's/^psql:[^ ]+ NOTICE:  /  /'
test "${PIPESTATUS[0]}" -eq 0

echo "All database tests passed."
