#!/usr/bin/env bash
# Sets up PostgreSQL + PostGIS for Musride WITHOUT Docker (Debian/Ubuntu Linux).
# Creates role "musride" and databases "musride" (development) and "musride_test" (tests).
# Local development only: the password is not a secret and must never be used in production.
set -euo pipefail

PG_VERSION=16

if ! command -v psql >/dev/null 2>&1 || [ ! -d "/usr/share/postgresql/${PG_VERSION}/extension" ]; then
  echo "Installing PostgreSQL ${PG_VERSION} and PostGIS..."
  sudo apt-get update
  sudo apt-get install -y "postgresql-${PG_VERSION}" "postgresql-${PG_VERSION}-postgis-3"
fi

sudo -u postgres psql -v ON_ERROR_STOP=1 <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'musride') THEN
    CREATE ROLE musride LOGIN PASSWORD 'musride_local_dev' CREATEDB;
  END IF;
END
$$;
SQL

for db in musride musride_test; do
  if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${db}'" | grep -q 1; then
    sudo -u postgres createdb -O musride "${db}"
  fi
  # PostGIS must be created by a superuser the first time.
  sudo -u postgres psql -d "${db}" -c "CREATE EXTENSION IF NOT EXISTS postgis; CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE EXTENSION IF NOT EXISTS citext; CREATE EXTENSION IF NOT EXISTS btree_gist;"
done

echo "Done. Connection string: postgres://musride:musride_local_dev@localhost:5432/musride"
