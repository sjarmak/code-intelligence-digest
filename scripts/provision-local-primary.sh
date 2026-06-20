#!/usr/bin/env bash
#
# Provision the local PRIMARY Postgres (system PG16) for the local-primary
# migration — bead code-intel-digest-w7c (P1.1).
#
# Idempotent: safe to re-run. Creates the role + database + pgvector extension
# if absent, and (re)sets a known local-dev password so the app's TCP driver can
# connect. This is a LOCAL-ONLY dev database on 127.0.0.1 — the default password
# matches the docker-compose convention; override via env if you prefer:
#
#   sudo -u postgres PRIMARY_DB_PASSWORD='...' bash scripts/provision-local-primary.sh
#
# Run as the postgres superuser (peer auth, no password):
#
#   sudo -u postgres bash scripts/provision-local-primary.sh
#
set -euo pipefail

DB_NAME="${PRIMARY_DB_NAME:-code_intel}"
DB_USER="${PRIMARY_DB_USER:-code_intel_user}"
DB_PASS="${PRIMARY_DB_PASSWORD:-local_dev_password}"
PORT="${PRIMARY_DB_PORT:-5432}"

# Role: create if missing, else ensure LOGIN + known password. ALTER resets the
# password deliberately so the printed LOCAL_DATABASE_URL is guaranteed to work.
psql -p "$PORT" -v ON_ERROR_STOP=1 <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${DB_USER}') THEN
    CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASS}';
  ELSE
    ALTER ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASS}';
  END IF;
END \$\$;
SQL

# CREATE DATABASE cannot run inside a transaction/DO block — guard in shell.
if ! psql -p "$PORT" -tAc "SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}'" | grep -q 1; then
  createdb -p "$PORT" -O "${DB_USER}" "${DB_NAME}"
fi

psql -p "$PORT" -d "${DB_NAME}" -v ON_ERROR_STOP=1 -c "ALTER DATABASE ${DB_NAME} OWNER TO ${DB_USER};"
psql -p "$PORT" -d "${DB_NAME}" -v ON_ERROR_STOP=1 -c "CREATE EXTENSION IF NOT EXISTS vector;"
psql -p "$PORT" -d "${DB_NAME}" -v ON_ERROR_STOP=1 -c "GRANT ALL ON SCHEMA public TO ${DB_USER};"

VEC_VER="$(psql -p "$PORT" -d "${DB_NAME}" -tAc "SELECT extversion FROM pg_extension WHERE extname = 'vector';" | tr -d '[:space:]')"
PG_VER="$(psql -p "$PORT" -tAc "SHOW server_version;" | tr -d '[:space:]')"

echo ""
echo "PROVISIONED ${DB_NAME} on PG ${PG_VER}, pgvector ${VEC_VER}, owner ${DB_USER}."
echo "LOCAL_DATABASE_URL=postgresql://${DB_USER}:${DB_PASS}@localhost:${PORT}/${DB_NAME}"
