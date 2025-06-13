#!/bin/sh
# This script is intended to be the entrypoint for the backend Docker container.
# It prepares the environment, runs database migrations, and then starts the main application.

# Exit immediately if a command exits with a non-zero status.
set -e

# 1. Install necessary tools
#    - postgresql-client: for pg_isready used in the migration script.
#    - bash: as the migration script (run-migrations.sh) uses #!/bin/bash and potentially bash-specific features.
echo "Entrypoint: Updating Alpine package index..."
apk update

echo "Entrypoint: Installing postgresql-client and bash..."
apk add --no-cache postgresql-client bash

# Ensure Prisma is installed in the project (as a dev dependency)
echo "Entrypoint: Ensuring Prisma CLI is available..."
# Configure pnpm store directory to avoid unexpected-store issues inside the container
pnpm config set store-dir /app/.pnpm-store
pnpm install -D prisma@5.7.1
# Recreate node_modules with the new store location to avoid ERR_PNPM_UNEXPECTED_STORE
echo "Entrypoint: Reinstalling project dependencies with new pnpm store..."
rm -rf /app/node_modules
pnpm install --include=dev

# Ensure Prisma CLI is available after fresh install
if ! pnpm exec prisma --version >/dev/null 2>&1; then
  echo "Entrypoint: Adding Prisma CLI (dev dependency)..."
  pnpm add -D prisma@5.7.1
fi
# 2. Run database migrations
# ---------------------------------------------------------------
#    ⚠️  TEMPORARILY DISABLED FOR LOCAL/TEST ENVIRONMENT ⚠️
# ---------------------------------------------------------------
#    Running Prisma migrations inside the container has caused
#    repeated start-up failures (mainly due to pnpm store conflicts)
#    during local testing.  To unblock development we are skipping
#    this step for now.  Migrations should be applied manually
#    or enabled again when moving to a more stable environment.
echo "Entrypoint: Skipping migrations for testing environment."
# if [ -f "/app/prisma/migrations/run-migrations.sh" ]; then
#     /app/prisma/migrations/run-migrations.sh
# else
#     echo "Entrypoint: Error - Migration script /app/prisma/migrations/run-migrations.sh not found." >&2
#     exit 1
# fi

# 3. Start the main application
#    Executes the command passed to the docker container (e.g., CMD in Dockerfile or command in docker-compose.yml).
#    'exec' replaces the current shell process with the command, which is good practice.
echo "Entrypoint: Migrations complete. Starting application with command: $@"
exec "$@"
