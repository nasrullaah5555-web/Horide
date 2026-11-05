#!/usr/bin/env bash
# Encrypted logical backup of the Musride database (DEPLOYMENT_GUIDE "Backups").
#
#   DATABASE_URL=postgres://... AGE_RECIPIENT=age1... infra/backup/backup.sh [output-dir]
#
# Writes musride-YYYYMMDD-HHMMSS.dump.age: a pg_dump custom-format archive encrypted with `age`
# to a PUBLIC key. Only the holder of the matching private key (kept offline by the owner, never
# on the server) can decrypt it, so a stolen backup file is useless on its own.
set -euo pipefail

: "${DATABASE_URL:?set DATABASE_URL}"
: "${AGE_RECIPIENT:?set AGE_RECIPIENT to the backup public key (age1...)}"
OUT_DIR="${1:-.}"
mkdir -p "$OUT_DIR"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
FILE="$OUT_DIR/musride-$STAMP.dump.age"

# --no-owner/--no-privileges: restorable into a database with different role names.
pg_dump --format=custom --no-owner --no-privileges "$DATABASE_URL" \
  | age --encrypt --recipient "$AGE_RECIPIENT" --output "$FILE"

# This script can't check the file decrypts (the private key is deliberately not here):
# the monthly restore drill (DEPLOYMENT_GUIDE) is that check.
echo "Wrote $FILE ($(du -h "$FILE" | cut -f1))"
