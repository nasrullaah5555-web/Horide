#!/usr/bin/env bash
# Restore an encrypted Musride backup into an EMPTY database (restore drill or disaster recovery).
#
#   TARGET_DATABASE_URL=postgres://.../musride_restore AGE_IDENTITY=~/musride-backup.key \
#     infra/backup/restore.sh musride-YYYYMMDD-HHMMSS.dump.age
#
# The target database needs the extensions created first by a superuser:
#   CREATE EXTENSION postgis; CREATE EXTENSION pgcrypto; CREATE EXTENSION citext; CREATE EXTENSION btree_gist;
set -euo pipefail

FILE="${1:?usage: restore.sh <backup.dump.age>}"
: "${TARGET_DATABASE_URL:?set TARGET_DATABASE_URL (an empty database)}"
: "${AGE_IDENTITY:?set AGE_IDENTITY to the backup private key file}"

TABLES=$(psql "$TARGET_DATABASE_URL" -tAc "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename <> 'spatial_ref_sys'")
if [ "$TABLES" != "0" ]; then
  echo "Refusing: the target database already has $TABLES tables. Restore into an empty database." >&2
  exit 1
fi

# Decrypted only into a private temporary folder, removed on exit (even on error).
WORK="$(mktemp -d)"
chmod 700 "$WORK"
trap 'rm -rf "$WORK"' EXIT
age --decrypt --identity "$AGE_IDENTITY" --output "$WORK/backup.dump" "$FILE"

# Skip the extension entries: the extensions already exist (created by a superuser, see above),
# and a normal database owner may not replace them, their comments or PostGIS's own
# spatial_ref_sys data (which the extension already provides).
pg_restore --list "$WORK/backup.dump" | grep -v -E ' EXTENSION | COMMENT - EXTENSION | TABLE DATA public spatial_ref_sys ' > "$WORK/restore.list"
pg_restore --no-owner --no-privileges --exit-on-error --use-list "$WORK/restore.list" \
  --dbname "$TARGET_DATABASE_URL" "$WORK/backup.dump"

echo "Restored. Rows in key tables (compare with the source):"
for t in users trips payments subscriptions driver_documents audit_logs kysely_migration; do
  printf '  %-18s %s\n' "$t" "$(psql "$TARGET_DATABASE_URL" -tAc "SELECT count(*) FROM $t")"
done
