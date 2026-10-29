#!/usr/bin/env bash
# Validates repository-owned SQL without Prisma binaries or changes to public tables.
set -euo pipefail
project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd -- "$project_dir"
local_docker() {
  env -u DOCKER_HOST -u DOCKER_CONTEXT -u DOCKER_TLS \
    -u DOCKER_TLS_VERIFY -u DOCKER_CERT_PATH \
    docker --host=unix:///var/run/docker.sock "$@"
}
local_docker info >/dev/null
check_schema="ligeirinho_sqltest_$(node -e "process.stdout.write(require('node:crypto').randomUUID().replaceAll('-', ''))")"
check_sql="$(mktemp /tmp/ligeirinho-migration.XXXXXX.sql)"
trap 'rm -f -- "$check_sql"' EXIT
cat > "$check_sql" <<'SQL'
BEGIN;
CREATE SCHEMA :"test_schema";
SET LOCAL search_path TO :"test_schema";
SQL
for migration in services/api/prisma/migrations/[0-9]*/migration.sql; do
  cat "$migration" >> "$check_sql"
  printf "\n" >> "$check_sql"
done
cat tests/sql/invariants.sql >> "$check_sql"
cat >> "$check_sql" <<'SQL'
ROLLBACK;
SELECT NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = :'test_schema') AS rollback_verified \gset
\if :rollback_verified
  \echo Rollback verified: disposable schema and fixtures removed.
\else
  \echo ERROR: disposable schema unexpectedly remains.
  \quit 1
\endif
SQL
local_docker compose --project-directory "$project_dir" -f docker-compose.yml \
  exec -T postgres psql -U ligeirinho -d ligeirinho -X -q -v ON_ERROR_STOP=1 \
  -v test_schema="$check_schema" < "$check_sql"
