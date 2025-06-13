#!/bin/bash
#
# CalAIM Assistant - Development Environment Startup Script
#
# This script automates the setup and startup of the local development environment
# for the AI-Powered CalAIM Domain & Care Plan Assistant.
#
# It performs the following steps:
# 1. Displays a header.
# 2. Checks for essential prerequisites (Docker, jq).
# 3. Attempts to fix common Docker credential issues.
# 4. Stops any previously running project containers.
# 5. Builds (if necessary) and starts all services using Docker Compose.
# 6. Displays information on how to access the running services.
#
# Usage:
#   Run this script from the project root directory:
#   ./scripts/start-dev-environment.sh
#
#   If it's not executable, run:
#   chmod +x scripts/start-dev-environment.sh
#   Then execute it.
#

# Exit immediately if a command exits with a non-zero status.
set -e

# --- Configuration ---
PROJECT_NAME="AI-Powered CalAIM Domain & Care Plan Assistant"
COMPOSE_FILE="scripts/dev-compose.yaml"
FIX_CREDS_SCRIPT="scripts/fix-docker-credentials.sh"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." &>/dev/null && pwd)"

# --- Helper Functions ---
print_header() {
    echo "========================================================================"
    echo "  $PROJECT_NAME - Development Environment Startup"
    echo "========================================================================"
    echo ""
}

print_subheader() {
    echo ""
    echo "--- $1 ---"
}

check_command() {
    if ! command -v "$1" &> /dev/null; then
        echo "Error: Required command '$1' not found."
        echo "Please install '$1' and try again."
        if [ "$1" == "jq" ]; then
            echo "  On macOS: brew install jq"
            echo "  On Debian/Ubuntu: sudo apt-get install jq"
        elif [ "$1" == "docker" ]; then
            echo "  Please install Docker Desktop or Docker Engine: https://www.docker.com/get-started"
        fi
        exit 1
    fi
}

# --- Main Script ---

# Navigate to project root
cd "$PROJECT_ROOT"

print_header

# 1. Check Prerequisites
print_subheader "1. Checking Prerequisites"
check_command "docker"
if ! docker compose version &> /dev/null; then
    if ! docker-compose version &> /dev/null; then
        echo "Error: Docker Compose (either 'docker compose' or 'docker-compose') not found."
        echo "Please ensure Docker Desktop (which includes Compose) is installed correctly."
        exit 1
    else
        echo "Warning: Using 'docker-compose'. Consider upgrading Docker for 'docker compose' syntax."
        DOCKER_COMPOSE_CMD="docker-compose"
    fi
else
    DOCKER_COMPOSE_CMD="docker compose"
fi
echo "Docker and Docker Compose found."

check_command "jq"
echo "jq (JSON processor) found."
echo "All prerequisites met."

# 2. Fix Docker Credentials
print_subheader "2. Attempting to Fix Docker Credentials"
if [ -f "$FIX_CREDS_SCRIPT" ]; then
    echo "Running $FIX_CREDS_SCRIPT..."
    # Ensure the script is executable before running
    if [ ! -x "$FIX_CREDS_SCRIPT" ]; then
        echo "Making $FIX_CREDS_SCRIPT executable..."
        chmod +x "$FIX_CREDS_SCRIPT"
    fi
    if ./"$FIX_CREDS_SCRIPT"; then
        echo "Docker credential script executed. If it made changes, you might need to restart Docker Desktop."
        echo "The script itself should have prompted you if a restart is recommended."
    else
        echo "Error running $FIX_CREDS_SCRIPT. Please check its output."
        # Decide if this is a fatal error. For now, let's allow continuation with a warning.
        echo "Warning: Continuing despite potential issues with Docker credential script."
    fi
else
    echo "Warning: $FIX_CREDS_SCRIPT not found. Skipping Docker credential fix."
    echo "If you encounter Docker login issues, ensure this script is present and run it manually."
fi

# 3. Stop Existing Project Containers
print_subheader "3. Stopping Existing Project Containers (if any)"
echo "Attempting to stop and remove containers defined in $COMPOSE_FILE..."
if $DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" ps -q &>/dev/null; then # Check if any services are up
    if $DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" down --remove-orphans; then
        echo "Existing project containers stopped and removed successfully."
    else
        echo "Warning: Failed to cleanly stop all existing project containers. This might cause issues."
    fi
else
    echo "No active project containers found from $COMPOSE_FILE. Nothing to stop."
fi

# 4. Build and Start Services
print_subheader "4. Building and Starting Services"
echo "Building images (if necessary) and starting services in detached mode..."
echo "This might take a few minutes on the first run or if dependencies have changed."
if $DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" up --build -d; then
    echo "Services started successfully in detached mode."
else
    echo "Error: Failed to start services with Docker Compose."
    echo "Please check the output above for error messages."
    echo "You can try running '$DOCKER_COMPOSE_CMD -f \"$COMPOSE_FILE\"' up --build' without '-d' to see logs directly."
    exit 1
fi

# 5. Display Access Information
print_subheader "5. Accessing Services"
echo "The development environment should now be running."
echo ""
echo "Key Service Endpoints:"
echo "  - Backend API (NestJS):"
echo "    - Swagger/OpenAPI Docs: http://localhost:8080/api/docs"
echo "    - Health Check:         http://localhost:8080/api/health"
echo "  - AI Service (FastAPI):"
echo "    - Swagger/OpenAPI Docs: http://localhost:8000/docs"
echo "    - Health Check:         http://localhost:8000/health"
echo "  - MinIO (S3-compatible storage):"
echo "    - Console UI:           http://localhost:9001 (User: minio_admin, Pass: minio_password)"
echo "    - API Endpoint:         http://localhost:9000"
echo ""
echo "Database & Cache Access:"
echo "  - PostgreSQL:"
echo "    - Command: psql -h localhost -p 5432 -U calaim_user -d calaim"
echo "    - Password: dev_password_only"
echo "  - Redis Cache:"
echo "    - Command: redis-cli -h localhost -p 6379 ping (should return PONG)"
echo ""
echo "Viewing Logs:"
echo "  - To view logs for all services:"
echo "    $DOCKER_COMPOSE_CMD -f \"$COMPOSE_FILE\" logs -f"
echo "  - To view logs for a specific service (e.g., backend):"
echo "    $DOCKER_COMPOSE_CMD -f \"$COMPOSE_FILE\" logs -f backend"
echo "    (Replace 'backend' with 'ai-service', 'postgres', 'redis', or 'minio')"
echo ""
echo "Stopping the Environment:"
echo "  - To stop all services:"
echo "    $DOCKER_COMPOSE_CMD -f \"$COMPOSE_FILE\" down"
echo ""
echo "========================================================================"
echo "  Development environment startup complete. Happy coding!"
echo "========================================================================"

exit 0
