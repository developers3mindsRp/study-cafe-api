#!/usr/bin/env bash
# Re-runnable sync: copy source DB (e.g. sc_* on 3306) → microservices studycafe_db.
# Requires MySQL on the target (default 127.0.0.1:3306) and Redis is not used by this script.
#
# Usage:
#   ./scripts/run-full-migration.sh
#   npm run sync
#
# Env: MIGRATION_SRC_* and MIGRATION_TGT_* (see .env.example). Loaded by migrate-wp-to-ms.js.
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$ROOT_DIR"

echo "=== StudyCafe sync: source → microservices target DB ==="
echo ""
echo "Running full sync (migrate-wp-to-ms.js)..."
node scripts/migrate-wp-to-ms.js

echo ""
echo "Done. Re-run anytime to sync again. See docs/MIGRATION_GUIDE.md for verification."
