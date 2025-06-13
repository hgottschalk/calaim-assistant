#!/bin/bash
#
# CalAIM Assistant - Infrastructure Test Script
#
# This script starts only the core infrastructure services (PostgreSQL, Redis, MinIO)
# and verifies their health status using Docker's built-in health checks.
#
# Usage:
#   Run this script from the project root directory:
#   ./scripts/test-infrastructure.sh
#
#   If it's not executable, run:
#   chmod +x scripts/test-infrastructure.sh
#   Then execute it.
#

# Exit immediately if a command exits with a non-zero status,
# unless it's part of a condition in an if, while, or until.
set -e

# --- Configuration ---
PROJECT_NAME="AI-Powered CalAIM Assistant Infrastructure"
COMPOSE_FILE="scripts/infrastructure-compose.yaml" # Specific compose file for infra
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." &>/dev/null && pwd)"

# Health check parameters
MAX_RETRIES=24 # Total retries for each service health check (e.g., 24 * 5s = 120s)
RETRY_INTERVAL_SECONDS=5

# Exact container names as defined in the compose file
POSTGRES_CONTAINER_NAME="calaim-postgres-infra"
REDIS_CONTAINER_NAME="calaim-redis-infra"
MINIO_CONTAINER_NAME="calaim-minio-infra"
MINIO_SETUP_CONTAINER_NAME="calaim-minio-setup-infra"

# --- Helper Functions ---
print_header() {
    echo "========================================================================"
    echo "  $PROJECT_NAME - Test Script"
    echo "========================================================================"
    echo ""
}

print_subheader() {
    echo ""
    echo "--- $1 ---"
}

check_command_installed() {
    if ! command -v "$1" &> /dev/null; then
        echo "Error: Required command '$1' not found."
        echo "Please install '$1' and try again."
        if [ "$1" == "docker" ]; then
            echo "  Please install Docker Desktop or Docker Engine: https://www.docker.com/get-started"
        elif [ "$1" == "jq" ]; then
            echo "  jq (JSON processor) is needed. Install using your OS's package manager."
            echo "  e.g., macOS: brew install jq | Debian/Ubuntu: sudo apt-get install jq"
        fi
        exit 1
    fi
}

# Function to stop infrastructure if something goes wrong
cleanup_and_exit() {
    echo ""
    echo "An error occurred or script was interrupted. Attempting to stop infrastructure services..."
    if $DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" down --remove-orphans &>/dev/null; then
        echo "Infrastructure services defined in $COMPOSE_FILE stopped."
    else
        echo "Failed to stop infrastructure services using $COMPOSE_FILE. You may need to stop them manually."
    fi
    exit 1
}

# Trap errors and interruptions to run cleanup function
trap cleanup_and_exit ERR SIGINT SIGTERM

check_service_health() {
    local container_name="$1" 
    local service_display_name="$2"
    echo -n "Waiting for $service_display_name ($container_name) to become healthy... "
    current_retry=0
    while true; do
        # Check if container is running and healthy using Docker's health status
        if docker ps --filter "name=^${container_name}$" --filter "health=healthy" --format "{{.ID}}" | grep -q "."; then
            echo "OK"
            return 0 # Success
        fi

        # Check if container is running but unhealthy
        if docker ps --filter "name=^${container_name}$" --filter "health=unhealthy" --format "{{.ID}}" | grep -q "."; then
            echo "FAIL (Container $container_name reported as unhealthy by Docker)"
            return 1 # Failure
        fi
        
        # Check if container has exited unexpectedly (long-running services shouldn't exit)
        if docker ps -a --filter "name=^${container_name}$" --format "{{.Status}}" | grep -q -E "^Exited"; then
            local exit_code=$(docker inspect --format='{{.State.ExitCode}}' "$container_name" 2>/dev/null || echo "unknown_exit")
            echo "FAIL (Container $container_name exited with code $exit_code)"
            return 1 # Failure
        fi
        
        # Check if container is in "starting" phase of health check or still initializing
        local health_status_inspect=$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_name" 2>/dev/null || echo "inspect_error")
        if [ "$health_status_inspect" == "starting" ]; then
            : # It's starting its health checks, continue waiting
        elif [ "$health_status_inspect" == "inspect_error" ]; then
             # Could not inspect, maybe it's not created yet by compose
             : # Wait for it to be created
        elif ! docker ps --filter "name=^${container_name}$" --filter "status=running" --format "{{.ID}}" | grep -q "."; then
            # No longer running and not caught by "Exited" check (could be "created" or removed)
             if [ "$current_retry" -gt 3 ]; then # Give a few retries for it to appear
                echo "FAIL (Container $container_name is not running and not healthy after initial retries)"
                return 1
             fi
        fi

        current_retry=$((current_retry + 1))
        if [ "$current_retry" -ge "$MAX_RETRIES" ]; then
            local final_state_raw=$(docker inspect --format='{{json .State}}' "$container_name" 2>/dev/null || echo "{\"Error\":\"Could not inspect container $container_name\"}")
            local final_health_status=$(echo "$final_state_raw" | jq -r '.Health.Status // "N/A (no health check defined or running)"')
            local final_run_status=$(echo "$final_state_raw" | jq -r '.Status // "unknown"')
            local final_exit_code=$(echo "$final_state_raw" | jq -r '.ExitCode // "N/A"')
            echo "FAIL (Not healthy after $MAX_RETRIES attempts.)"
            echo "  Last known run status for $container_name: '$final_run_status'"
            echo "  Last known health status for $container_name: '$final_health_status'"
            if [ "$final_run_status" == "exited" ]; then
                 echo "  Exit code: $final_exit_code"
            fi
            return 1 # Failure
        fi
        echo -n "." # Progress indicator
        sleep "$RETRY_INTERVAL_SECONDS"
    done
}

check_setup_container_completion() {
    local container_name="$1"
    local service_display_name="$2"
    echo -n "Waiting for $service_display_name ($container_name) to complete successfully... "
    current_retry=0
    while true; do
        # Check if the container exists at all
        if ! docker ps -a --filter "name=^${container_name}$" --format "{{.ID}}" | grep -q "."; then
            if [ "$current_retry" -gt 5 ]; then # Give it some time for compose to create it
                echo "FAIL (Container ${container_name} not found after several retries. Did docker-compose start it?)"
                return 1
            fi
        else # Container exists, check its state
            local container_state_raw=$(docker inspect --format='{{json .State}}' "$container_name" 2>/dev/null)
            if [ -z "$container_state_raw" ]; then # Should not happen if previous check passed
                echo "FAIL (Could not inspect container $container_name, though it was found by ps -a)"
                return 1
            fi
            local status=$(echo "$container_state_raw" | jq -r '.Status // "unknown"')
            
            if [ "$status" == "exited" ]; then
                local exit_code=$(echo "$container_state_raw" | jq -r '.ExitCode // -1') # Default to -1 if no exit code
                if [ "$exit_code" -eq 0 ]; then
                    echo "OK (Exited successfully with code 0)"
                    return 0 # Success
                else
                    echo "FAIL (Exited with code $exit_code)"
                    return 1 # Failure
                fi
            elif [ "$status" == "running" ] || [ "$status" == "created" ] || [ "$status" == "restarting" ]; then
                : # Still running or about to run, continue waiting
            else
                echo "FAIL (Container $container_name in unexpected state: '$status')"
                return 1
            fi
        fi

        current_retry=$((current_retry + 1))
        if [ "$current_retry" -ge "$MAX_RETRIES" ]; then
            local final_status_raw=$(docker inspect --format='{{json .State}}' "$container_name" 2>/dev/null || echo "{\"Error\":\"Could not inspect container $container_name\"}")
            local final_status=$(echo "$final_status_raw" | jq -r '.Status // "unknown"')
            local final_exit_code=$(echo "$final_status_raw" | jq -r '.ExitCode // "N/A"')
            echo "FAIL (Did not complete successfully after $MAX_RETRIES attempts.)"
            echo "  Last known status for $container_name: '$final_status'"
            if [ "$final_status" == "exited" ]; then
                 echo "  Exit code: $final_exit_code"
            fi
            return 1 # Failure
        fi
        echo -n "." # Progress indicator
        sleep "$RETRY_INTERVAL_SECONDS"
    done
}
# --- Main Script ---

# Navigate to project root
cd "$PROJECT_ROOT"

print_header

# 1. Check Prerequisites
print_subheader "1. Checking Prerequisites"
check_command_installed "docker"
if ! docker compose version &> /dev/null; then
    if ! docker-compose version &> /dev/null; then
        echo "Error: Docker Compose (either 'docker compose' or 'docker-compose') not found."
        exit 1
    else
        echo "Warning: Using 'docker-compose'. Consider upgrading Docker for 'docker compose' syntax."
        DOCKER_COMPOSE_CMD="docker-compose"
    fi
else
    DOCKER_COMPOSE_CMD="docker compose"
fi
echo "Docker and Docker Compose found."
check_command_installed "jq" # For parsing docker inspect JSON output
echo "All prerequisites met."

# 2. Stop Existing Infrastructure Containers (if any from this specific compose file)
print_subheader "2. Stopping Existing Infrastructure Containers"
echo "Attempting to stop and remove containers defined in $COMPOSE_FILE..."
if [ -n "$($DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" ps -q 2>/dev/null)" ]; then
    if $DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" down --remove-orphans --volumes; then # Remove volumes too for a clean slate
        echo "Existing infrastructure containers and volumes stopped and removed successfully."
    else
        echo "Warning: Failed to cleanly stop all existing infrastructure containers. This might cause issues."
    fi
else
    echo "No active infrastructure containers found from $COMPOSE_FILE. Nothing to stop."
fi

# 3. Start Infrastructure Services
print_subheader "3. Starting Infrastructure Services"
echo "Starting services defined in $COMPOSE_FILE in detached mode..."
echo "This might take a moment..."
if $DOCKER_COMPOSE_CMD -f "$COMPOSE_FILE" up --build -d; then # --build is good practice even for infra
    echo "Infrastructure services started via Docker Compose."
else
    echo "Error: Failed to start services with Docker Compose using $COMPOSE_FILE."
    echo "Please check the output above for error messages."
    # Trap will handle cleanup_and_exit
    exit 1 
fi

# 4. Health Checks
print_subheader "4. Performing Health Checks (using Docker health status)"
all_healthy=true

# PostgreSQL Health Check
if ! check_service_health "$POSTGRES_CONTAINER_NAME" "PostgreSQL"; then
    all_healthy=false
fi

# Redis Health Check
if [ "$all_healthy" = true ]; then
    if ! check_service_health "$REDIS_CONTAINER_NAME" "Redis"; then
        all_healthy=false
    fi
fi

# MinIO Health Check
if [ "$all_healthy" = true ]; then
    if ! check_service_health "$MINIO_CONTAINER_NAME" "MinIO"; then
        all_healthy=false
    fi
fi

# MinIO Setup Container Check (depends on MinIO being healthy)
if [ "$all_healthy" = true ]; then
    if ! check_setup_container_completion "$MINIO_SETUP_CONTAINER_NAME" "MinIO Setup"; then
        all_healthy=false
    fi
fi

# 5. Report Overall Status
print_subheader "5. Overall Infrastructure Status"
if [ "$all_healthy" = true ]; then
    echo "All infrastructure services are healthy and running (or completed successfully)!"
    echo ""
    echo "You can now proceed to start the application services (backend, ai-service) using the main compose file."
    echo ""
    echo "To stop these infrastructure services, run:"
    echo "  $DOCKER_COMPOSE_CMD -f \"$COMPOSE_FILE\" down"
    echo ""
    echo "========================================================================"
    echo "  Infrastructure Test Complete."
    echo "========================================================================"
    # Disable error trap before exiting normally
    trap - ERR SIGINT SIGTERM
    exit 0
else
    echo "One or more infrastructure services failed to start, are unhealthy, or did not complete as expected."
    echo "Please check the logs for details:"
    echo "  $DOCKER_COMPOSE_CMD -f \"$COMPOSE_FILE\" logs"
    echo "Stopping infrastructure due to health check failures..."
    # Trap will handle cleanup_and_exit
    exit 1
fi
