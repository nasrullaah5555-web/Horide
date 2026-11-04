#!/usr/bin/env bash
# Sets up PostgreSQL + PostGIS for Horide WITHOUT Docker (Debian/Ubuntu Linux).
# Creates role "horide" and databases "horide" (development) and "horide_test" (tests).
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
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'horide') THEN
    CREATE ROLE horide LOGIN PASSWORD 'horide_local_dev' CREATEDB;
  END IF;
END
$$;
SQL

for db in horide horide_test; do
  if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${db}'" | grep -q 1; then
    sudo -u postgres createdb -O horide "${db}"
  fi
  # PostGIS must be created by a superuser the first time.
  sudo -u postgres psql -d "${db}" -c "CREATE EXTENSION IF NOT EXISTS postgis; CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE EXTENSION IF NOT EXISTS citext;"
done

echo "Done. Connection string: postgres://horide:horide_local_dev@localhost:5432/horide"
