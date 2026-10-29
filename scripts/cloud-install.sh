#!/usr/bin/env bash
set -euo pipefail
cd /workspace/ligeirinho
# Each cloud task is isolated: reuse this checkout, do not create a worktree.
export PATH="$PWD/.local/bin:$PATH"
export NEXT_TELEMETRY_DISABLED=1 TURBO_TELEMETRY_DISABLED=1
# Verified independent setup; never declares API or Android artifacts ready.
node scripts/manage.mjs assemble --prepare-only
set -a
. ./.env
set +a
# These steps require binaries.prisma.sh in the applied network policy.
corepack pnpm db:generate
corepack pnpm db:migrate
