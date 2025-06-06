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

# 2. Run database migrations
#    The migration script is expected to be located at /app/prisma/migrations/run-migrations.sh
#    and should have been made executable in the Dockerfile.
echo "Entrypoint: Executing database migration script..."
if [ -f "/app/prisma/migrations/run-migrations.sh" ]; then
    /app/prisma/migrations/run-migrations.sh
else
    echo "Entrypoint: Error - Migration script /app/prisma/migrations/run-migrations.sh not found." >&2
    exit 1
fi

# 3. Start the main application
#    Executes the command passed to the docker container (e.g., CMD in Dockerfile or command in docker-compose.yml).
#    'exec' replaces the current shell process with the command, which is good practice.
echo "Entrypoint: Migrations complete. Starting application with command: $@"
exec "$@"
