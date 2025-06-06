#!/bin/bash
set -e

# Script to wait for PostgreSQL and then run Prisma migrations.
# This script is intended to be run on backend container startup.

# Navigate to the root of the backend package.
# This script is expected to be in 'packages/backend/prisma/migrations/'.
# So, two levels up is 'packages/backend/'.
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
BACKEND_ROOT_DIR="$( cd "$SCRIPT_DIR/../.." &> /dev/null && pwd )"

echo "Migration Script: Changing working directory to $BACKEND_ROOT_DIR"
cd "$BACKEND_ROOT_DIR"

# Database connection parameters for pg_isready.
# These can be overridden by environment variables.
# Prisma CLI itself will use DATABASE_URL.
DB_HOST="${PGHOST:-postgres}"
DB_PORT="${PGPORT:-5432}"
DB_USER="${PGUSER:-calaim_user}"
DB_NAME="${PGDATABASE:-calaim}"

# Wait for PostgreSQL to be ready
MAX_RETRIES=30
RETRY_INTERVAL_SECONDS=5
CURRENT_RETRY=0

echo "Migration Script: Waiting for database '$DB_NAME' at '$DB_HOST:$DB_PORT' with user '$DB_USER' to be ready..."

# Loop until pg_isready returns 0 (success) or retries are exhausted
until pg_isready -q -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME"; do
  CURRENT_RETRY=$((CURRENT_RETRY + 1))
  if [ "$CURRENT_RETRY" -ge "$MAX_RETRIES" ]; then
    echo "Migration Script: Database not ready after $MAX_RETRIES attempts. Exiting."
    exit 1
  fi
  echo "Migration Script: Database not ready. Retrying in $RETRY_INTERVAL_SECONDS seconds... (Attempt $CURRENT_RETRY/$MAX_RETRIES)"
  sleep "$RETRY_INTERVAL_SECONDS"
done

echo "Migration Script: Database is ready."

# Run Prisma migrations
echo "Migration Script: Applying Prisma migrations..."
# npx ensures we use the project's version of Prisma CLI
if npx prisma migrate deploy; then
  echo "Migration Script: Prisma migrations applied successfully."
else
  echo "Migration Script: Prisma migrations failed." >&2
  exit 1
fi

echo "Migration Script: Finished."
exit 0
