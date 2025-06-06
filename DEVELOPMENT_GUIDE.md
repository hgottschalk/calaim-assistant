# CalAIM Assistant - Development Guide

This guide provides instructions for setting up the development environment, running the application, implementing new features, and troubleshooting common issues for the AI-Powered CalAIM Domain & Care Plan Assistant.

## 1. Set Up the Development Environment

### Prerequisites
Ensure you have the following installed on your system:
*   **Node.js:** Version 18 or higher (LTS recommended).
*   **pnpm:** As the package manager for the monorepo. Install via `npm install -g pnpm`.
*   **Docker & Docker Compose:** For running containerized services.
*   **Git:** For version control.
*   **jq:** Command-line JSON processor. (e.g., `brew install jq` on macOS, `sudo apt-get install jq` on Debian/Ubuntu).

### Initial Setup
1.  **Clone the Repository:**
    ```bash
    git clone <repository_url>
    cd calaim-assistant 
    ```
    *(Replace `<repository_url>` with the actual URL of your Git repository, e.g., from `https://github.com/hgottschalk/calaim-assistant?local=true`)*

2.  **Install Dependencies:**
    Navigate to the project root and install all dependencies for the monorepo workspaces:
    ```bash
    pnpm install
    ```

3.  **Configure Environment Variables:**
    The application uses environment variables for configuration. A `dev-compose.yaml` file defines variables for Docker services, and the backend service also loads variables from `.env` files.
    *   For local development outside Docker (less common now that services run in Docker), you would copy `.env.example` to `.env` in `packages/backend` and `packages/ai-service`.
    *   For Dockerized development, most environment variables are set directly in `scripts/dev-compose.yaml`. However, some local scripts or tools might still benefit from a root `.env` file if they need to interact with services directly (e.g., database clients, AI service testing scripts).

    Key variables used by the services (primarily configured in `scripts/dev-compose.yaml`):
    *   `DATABASE_URL`: PostgreSQL connection string.
    *   `REDIS_URL`: Redis connection string.
    *   `STORAGE_ENDPOINT`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY`: MinIO connection details.
    *   `JWT_SECRET`, `JWT_EXPIRES_IN`: For backend authentication.
    *   `AI_SERVICE_URL`: URL for the backend to reach the AI service.
    *   `PUBSUB_PROJECT_ID`: For Pub/Sub integration (even for local mock).
    *   For AI Service (`packages/ai-service`):
        *   `ENABLE_MOCK_API`, `MOCK_HEALTHCARE_NL_API`, `MOCK_DOCUMENT_AI`: To toggle real GCP services.
        *   `DOCUMENT_AI_PROJECT_ID`, `DOCUMENT_AI_LOCATION`, `DOCUMENT_AI_PROCESSOR_ID`: For real Document AI.
        *   `HEALTHCARE_NL_PROJECT_ID`, `HEALTHCARE_NL_LOCATION`: For real Healthcare NL API.
        *   `GOOGLE_APPLICATION_CREDENTIALS`: (If using real GCP services) Path to your GCP service account key file. This variable needs to be set in your environment or passed to the AI service container.

## 2. Fix the Docker Credential Issue

A common issue on some systems is Docker Desktop expecting credential helpers that are missing, leading to errors like `error getting credentials - exec: "docker-credential-desktop": executable file not found`.

To resolve this:
1.  **Run the `fix-docker-credentials.sh` script:**
    This script is located in the `scripts/` directory. It will:
    *   Back up your current Docker `config.json`.
    *   Remove the problematic `credsStore` and `credHelpers` entries from the configuration.

    Execute it from the project root:
    ```bash
    bash scripts/fix-docker-credentials.sh 
    ```
    If you haven't already, make it executable:
    ```bash
    chmod +x scripts/fix-docker-credentials.sh
    ```
    Then run:
    ```bash
    ./scripts/fix-docker-credentials.sh
    ```

2.  **Restart Docker Desktop:**
    After the script runs successfully, restart Docker Desktop for the changes to take full effect.

## 3. Run Database Migrations

Database migrations using Prisma are now handled automatically when the backend service container starts.
*   The `packages/backend/Dockerfile.dev` specifies an `entrypoint.sh` script.
*   This `packages/backend/entrypoint.sh` script, in turn, calls `packages/backend/prisma/migrations/run-migrations.sh`.
*   The `run-migrations.sh` script waits for PostgreSQL to be ready and then executes `npx prisma migrate deploy`. This command applies any pending migrations defined in the `packages/backend/prisma/migrations` directory.

You typically do not need to run migrations manually when using `docker compose`. If you are developing a new migration, you would use `npx prisma migrate dev --name <migration_name>` locally (ensure your `DATABASE_URL` in `.env` points to the Dockerized Postgres instance if you want to generate it against the running dev DB).

## 4. Start the Application using Docker Compose

Once the Docker credential issue is resolved and environment variables are set (if needed outside compose), you can start all services using Docker Compose:

1.  **Start Services:**
    From the project root, run:
    ```bash
    docker compose -f scripts/dev-compose.yaml up --build
    ```
    This command will:
    *   Build the Docker images for `backend` and `ai-service` if they don't exist or if their Dockerfiles/contexts have changed.
    *   Start all defined services: `postgres`, `redis`, `minio`, `minio-setup`, `backend`, `ai-service`. (Frontend is commented out in the current `dev-compose.yaml`).

2.  **Accessing Services:**
    *   **Backend API (NestJS):**
        *   Swagger/OpenAPI Docs: `http://localhost:8080/api/docs`
        *   Health Check: `http://localhost:8080/api/health`
    *   **AI Service (FastAPI):**
        *   Health Check: `http://localhost:8000/health`
        *   Swagger/OpenAPI Docs: `http://localhost:8000/docs`
    *   **MinIO (S3-compatible storage):**
        *   Console UI: `http://localhost:9001`
        *   Credentials: User `minio_admin`, Password `minio_password`
        *   API Endpoint: `http://localhost:9000`
    *   **PostgreSQL Database:**
        *   Connect via psql: `psql -h localhost -p 5432 -U calaim_user -d calaim`
        *   Password: `dev_password_only`
    *   **Redis Cache:**
        *   Test connection: `redis-cli -h localhost -p 6379 ping` (should return `PONG`)

## 5. Implement Additional Backend Features

The backend is a NestJS application located in `packages/backend`. Key areas for new features include:

*   **Pending Features (from MVP Status Report):**
    *   Full implementation of Referrals → Assessments → Problem List → Care Plan endpoints.
    *   PDF generation (e.g., for care plans).
    *   Enhanced file upload flow (e.g., virus scanning, more robust error handling).

*   **Project Structure:**
    *   Modules for each resource (e.g., `assessments`, `patients`, `referrals`) are in `packages/backend/src/`.
    *   Each module typically contains a `*.controller.ts`, `*.service.ts`, and `*.module.ts`.
    *   Database schema is defined in `packages/backend/prisma/schema.prisma`. Use `npx prisma format` after changes.
    *   Data models for CalAIM domains are detailed in `CalAIM-Seven-Domains-Data-Model.md`.

*   **Development Workflow Example (e.g., adding an endpoint to `AssessmentsController`):**
    1.  **Define DTOs:** Create Data Transfer Objects for request/response bodies if needed.
    2.  **Update Controller (`assessments.controller.ts`):**
        *   Add a new method for the endpoint (e.g., `@Get(':id/summary')`).
        *   Decorate with `@ApiOperation`, `@ApiResponse`, `@Roles`, etc.
        *   Inject and call the `AssessmentsService`.
    3.  **Update Service (`assessments.service.ts`):**
        *   Implement the business logic for the new endpoint.
        *   Interact with `PrismaService` for database operations.
    4.  **Update Module (`assessments.module.ts`):** Ensure all dependencies are correctly imported/exported if new providers are added.
    5.  **Write Tests:** Add unit tests for the service logic and integration/e2e tests for the controller endpoint.

## 6. Implement Additional AI Service Features

The AI service is a FastAPI application located in `packages/ai-service`.

*   **Pending Features (from MVP Status Report):**
    *   Full integration with Google Cloud Document AI (for OCR) and Healthcare Natural Language API (for entity extraction).
    *   Implement robust confidence aggregation logic.
    *   Ensure Pub/Sub listener is fully functional for asynchronous document processing.

*   **Current State & Configuration:**
    *   The `packages/ai-service/main.py` has been updated with:
        *   Functions to interact with GCP services (`process_document_with_document_ai`, `extract_entities_with_healthcare_nl`).
        *   A Pub/Sub listener (`start_pubsub_listener` and `process_document_job`).
        *   Confidence aggregation placeholders (`aggregate_entity_confidence`, `calculate_domain_confidence`).
    *   **Mock Mode:** By default, the service might run in mock mode. To use real GCP services:
        *   Set `ENABLE_MOCK_API=false`, `MOCK_HEALTHCARE_NL_API=false`, `MOCK_DOCUMENT_AI=false` in your environment variables (e.g., by modifying `scripts/dev-compose.yaml` for the `ai-service` or setting them in your shell if running locally outside Docker).
        *   Ensure your GCP project has Document AI, Healthcare NL API, and Pub/Sub APIs enabled.
        *   Configure GCP authentication: Set the `GOOGLE_APPLICATION_CREDENTIALS` environment variable to the path of your service account key JSON file. This needs to be accessible by the AI service container (e.g., by mounting the key file as a volume and setting the env var in `dev-compose.yaml`).
        *   Configure `DOCUMENT_AI_PROJECT_ID`, `DOCUMENT_AI_LOCATION`, `DOCUMENT_AI_PROCESSOR_ID`, `HEALTHCARE_NL_PROJECT_ID`, `HEALTHCARE_NL_LOCATION` environment variables.

*   **Development Workflow:**
    1.  **Implement GCP Client Logic:** Enhance the existing functions in `main.py` to fully utilize the GCP client libraries.
    2.  **Refine Entity Mapping:** Improve `map_entities_to_domains` and `map_healthcare_nl_entity_type` for accuracy.
    3.  **Confidence Scoring:** Implement more sophisticated confidence aggregation in `aggregate_entity_confidence` and `calculate_domain_confidence`, potentially using the `ENTITY_CONFIDENCE_WEIGHTS` from settings.
    4.  **Pub/Sub Integration:**
        *   Ensure the `process_document_job` function correctly updates job status in the database (this might require the AI service to have DB access or to call back to the backend API).
        *   Test the asynchronous flow by publishing messages to the `doc.jobs` topic.
    5.  **Error Handling:** Add robust error handling and logging for GCP API calls and Pub/Sub message processing.

## 7. Test the Application

Thorough testing is crucial.

*   **Unit & Integration Tests:**
    *   **Backend (NestJS):** Tests are typically co-located with source files (`*.spec.ts`). Run using:
        ```bash
        pnpm --filter=@calaim/backend test
        # For watch mode:
        pnpm --filter=@calaim/backend test:watch
        # For coverage:
        pnpm --filter=@calaim/backend test:cov
        ```
    *   **AI Service (FastAPI):** Python tests can be written using `pytest`. If not already set up:
        1.  Add `pytest` to `packages/ai-service/requirements.txt`.
        2.  Create a `tests/` directory in `packages/ai-service`.
        3.  Write test files (e.g., `test_main.py`).
        4.  Run tests (from `packages/ai-service` directory): `pytest`
        Or from root: `cd packages/ai-service && pytest`

*   **End-to-End (E2E) Testing (Manual & Automated):**
    *   **Manual:**
        *   Use an API client like Postman or Insomnia to send requests to the backend API endpoints (e.g., creating a patient, uploading a referral, creating an assessment).
        *   Verify data in PostgreSQL.
        *   Check MinIO console for uploaded files.
        *   Observe logs from `docker compose logs -f backend ai-service`.
    *   **Automated E2E (Backend):** NestJS has built-in support for E2E tests, typically in a `test/` directory at the root of `packages/backend`. Run using:
        ```bash
        pnpm --filter=@calaim/backend test:e2e
        ```

*   **Health Checks:**
    Regularly check the health endpoints of running services:
    *   Backend: `curl http://localhost:8080/api/health`
    *   AI Service: `curl http://localhost:8000/health`
    *   Postgres: `pg_isready -h localhost -p 5432 -U calaim_user -d calaim`
    *   Redis: `redis-cli -h localhost -p 6379 ping`
    *   MinIO: Visit `http://localhost:9001`

## 8. Troubleshoot Common Issues

*   **Docker Compose Fails to Start Services:**
    *   **Credential Issue:** Ensure you've run `scripts/fix-docker-credentials.sh` and restarted Docker (see Section 2).
    *   **Port Conflicts:** Check if ports (8080, 8000, 5432, 6379, 9000, 9001) are already in use by other applications. Use `docker ps` to see running containers and their ports. Modify `scripts/dev-compose.yaml` if necessary.
    *   **Insufficient Resources:** Docker might need more RAM/CPU. Adjust settings in Docker Desktop.
    *   **Build Failures:** Check the output of `docker compose up --build` for errors during image building (e.g., `pnpm install` failures, Dockerfile syntax errors).

*   **Backend or AI Service Not Healthy / Crashing:**
    *   **Check Logs:** The first step is always to check container logs:
        ```bash
        docker logs calaim-backend
        docker logs calaim-ai-service
        # For continuous logs:
        docker compose logs -f backend ai-service
        ```
    *   **Environment Variables:** Ensure all required environment variables are correctly set in `scripts/dev-compose.yaml` and accessible to the services. Compare with `ConfigModule` validation in `packages/backend/src/app.module.ts` and `Settings` in `packages/ai-service/main.py`.
    *   **Database/Redis Connection:**
        *   Verify `postgres` and `redis` containers are running and healthy.
        *   Check `DATABASE_URL` and `REDIS_URL` in service configurations.
    *   **Prisma Client Generation:** If you see errors related to Prisma Client in the backend, ensure it's generated correctly. Usually `pnpm install` handles this, but you might need to run `pnpm --filter=@calaim/backend exec prisma generate` if issues persist.

*   **Migrations Not Running / Failing:**
    *   Check `calaim-backend` container logs for output from `run-migrations.sh`.
    *   Ensure `DATABASE_URL` in `scripts/dev-compose.yaml` for the backend service is correct and points to the `postgres` service.
    *   `pg_isready` might be failing if Postgres is slow to start or misconfigured. The script has retries, but persistent failure indicates a deeper issue.

*   **AI Processing Issues (Non-Mock Mode):**
    *   **GCP Credentials:** Ensure `GOOGLE_APPLICATION_CREDENTIALS` environment variable is correctly set for the `ai-service` container and the key file is valid and accessible.
    *   **GCP APIs Not Enabled:** Verify that Document AI API, Healthcare Natural Language API, and Pub/Sub API are enabled in your Google Cloud Project.
    *   **IAM Permissions:** The service account used must have appropriate permissions (e.g., "Document AI User", "Cloud Natural Language AI User", "Pub/Sub Publisher/Subscriber").
    *   **Processor/Location Mismatch:** Double-check `DOCUMENT_AI_PROCESSOR_ID`, `DOCUMENT_AI_LOCATION`, `HEALTHCARE_NL_LOCATION` values.
    *   **Pub/Sub Configuration:** Ensure `PUBSUB_PROJECT_ID`, `PUBSUB_TOPIC`, `PUBSUB_SUBSCRIPTION` are correct. The topic and subscription should exist in your GCP project.

*   **`jq` Command Not Found:**
    *   The `scripts/fix-docker-credentials.sh` script requires `jq`. Install it using your system's package manager (e.g., `brew install jq` on macOS, `sudo apt-get install jq` on Debian/Ubuntu).

This guide should help you get started and navigate common development tasks. Refer to individual service READMEs (if they exist) and specific technology documentation (NestJS, FastAPI, Prisma, Docker) for more detailed information.
