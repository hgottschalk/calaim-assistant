# Project Setup Instructions

This guide provides focused steps to set up the development environment for the AI-Powered CalAIM Domain & Care Plan Assistant, focusing on getting the core infrastructure and application services running.

For a more comprehensive guide, including feature implementation details and advanced troubleshooting, refer to `DEVELOPMENT_GUIDE.md`.

## Prerequisites

Ensure you have the following installed:
*   **Node.js:** Version 18+ (LTS recommended)
*   **pnpm:** `npm install -g pnpm`
*   **Docker & Docker Compose:** Latest stable versions
*   **Git**
*   **jq:** Command-line JSON processor (e.g., `brew install jq` or `sudo apt-get install jq`)

## 1. Initial Project Setup

1.  **Clone the Repository:**
    ```bash
    git clone <your-repository-url>
    cd calaim-assistant
    ```

2.  **Install Root Dependencies:**
    This installs dependencies for all workspaces (backend, ai-service, frontend).
    ```bash
    pnpm install
    ```

## 2. Fix Docker Credential Issues

If you encounter errors related to Docker credential helpers (e.g., `docker-credential-desktop not found`), run the provided script:

```bash
chmod +x scripts/fix-docker-credentials.sh
./scripts/fix-docker-credentials.sh
```
Restart Docker Desktop if prompted or if issues persist after running the script.

## 3. Core Infrastructure Setup & Test

This step ensures your basic database, cache, and storage services are working correctly.

1.  **Start Core Infrastructure:**
    This uses a dedicated compose file to bring up PostgreSQL, Redis, and MinIO.
    ```bash
    docker compose -f scripts/infrastructure-compose.yaml up --build -d
    ```

2.  **Test Infrastructure Health:**
    Run the test script to verify all core services are healthy.
    ```bash
    chmod +x scripts/test-infrastructure.sh
    ./scripts/test-infrastructure.sh
    ```
    If this script passes, your core infrastructure is ready. You can leave these services running or bring them down if you plan to use the full stack script next:
    ```bash
    docker compose -f scripts/infrastructure-compose.yaml down
    ```

## 4. Backend & AI Service Preparation

The application services (`backend` and `ai-service`) have their own Dockerfiles.

*   **Backend (`packages/backend`):**
    *   The `Dockerfile.dev` has been configured to install dependencies using `pnpm install` based on `package.json`. It no longer strictly requires a `pnpm-lock.yaml` file in the Docker build context, which simplifies initial setup if the lockfile isn't committed or generated yet.
    *   Database migrations are handled automatically by the `entrypoint.sh` script when the backend container starts.

*   **AI Service (`packages/ai-service`):**
    *   Dependencies are defined in `requirements.txt` and installed during the Docker build.
    *   Includes Google Cloud libraries for Document AI and Healthcare NL API, but can run in mock mode by default (configurable via environment variables in `scripts/dev-compose.yaml`).

## 5. Running the Full Application Stack

Once Docker credentials are fixed and you've optionally tested the core infrastructure, you can start the entire development environment (including backend and AI service) using the main startup script.

1.  **Ensure `start-dev-environment.sh` is executable:**
    ```bash
    chmod +x scripts/start-dev-environment.sh
    ```

2.  **Run the Startup Script:**
    This script will:
    *   Check prerequisites.
    *   Attempt to run the Docker credential fix script (if you haven't already).
    *   Stop any existing project containers defined in `scripts/dev-compose.yaml`.
    *   Build and start all services (PostgreSQL, Redis, MinIO, Backend, AI Service).
    ```bash
    ./scripts/start-dev-environment.sh
    ```

3.  **Accessing Services:**
    After the script completes, services will be available at:
    *   **Backend API Docs:** `http://localhost:8080/api/docs`
    *   **AI Service Docs:** `http://localhost:8000/docs`
    *   **MinIO Console:** `http://localhost:9001` (User: `minio_admin`, Pass: `minio_password`)
    *   Refer to the script's output for more details and other service access commands.

## Troubleshooting

*   **Docker Build Failures:**
    *   If `docker compose ... up --build` fails for the `backend` or `ai-service`, check the error messages.
    *   For the backend, ensure `package.json` is valid.
    *   For the AI service, ensure `requirements.txt` is valid.
*   **Container Health Issues:**
    *   Use `docker ps` to check container status.
    *   Check logs for specific services:
        ```bash
        docker compose -f scripts/dev-compose.yaml logs -f backend
        docker compose -f scripts/dev-compose.yaml logs -f ai-service
        ```
*   **Database Migrations:** Backend container logs will show migration script output. If migrations fail, check the `DATABASE_URL` and ensure PostgreSQL is healthy.

For more detailed troubleshooting, see `DEVELOPMENT_GUIDE.md`.
