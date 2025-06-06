# AI-Powered CalAIM Domain & Care Plan Assistant

This repository implements an AI-powered assistant designed to streamline and automate documentation processes related to California's CalAIM (California Advancing and Innovating Medi-Cal) initiative, specifically for Specialty Mental Health Services (SMHS). This application aims to reduce the administrative burden on clinicians by leveraging AI and NLP technologies, pre-populating required assessment domains, managing problem lists, and generating CalAIM-compliant care plans.

## Getting Started

For detailed instructions on setting up your development environment, running the application, and contributing, please refer to the **[DEVELOPMENT_GUIDE.md](DEVELOPMENT_GUIDE.md)**.

This guide covers:
*   Prerequisites and initial setup.
*   Fixing common Docker credential issues.
*   Running the application using Docker Compose.
*   Implementing new features in the backend and AI service.
*   Testing and troubleshooting.

## Architectural Overview

The codebase employs a microservices architecture, with separate components for the frontend, backend API, and AI/NLP processing. It leverages a monorepo structure managed by `pnpm` for streamlined development and dependency management across these components. Key architectural decisions include:

-   **Serverless Deployment Target:** The application targets deployment on Google Cloud Platform (GCP) using serverless technologies like Cloud Run, minimizing operational overhead and enabling auto-scaling.
-   **Event-Driven Architecture:** Asynchronous tasks, such as AI processing of documents, are handled using Cloud Pub/Sub (or a local mock), decoupling the backend API from long-running processes and improving responsiveness.
-   **Microservices Pattern:** A modular microservices architecture is used with a separate AI pipeline for independent scaling and rapid iteration.
-   **Infrastructure as Code (IaC):** Terraform is used to define and manage the infrastructure on GCP, ensuring repeatability, auditability, and version control.
-   **API Gateway:** The backend utilizes NestJS for API functionality, potentially integrating Cloud Endpoints for API management and security.

The core infrastructure services (PostgreSQL, Redis, MinIO) are containerized and managed via Docker Compose for local development.

## Key Implemented Features (MVP)

As of the latest MVP update, the following key features and components have been implemented:

*   **Backend API (NestJS - `packages/backend`):**
    *   Scaffolded NestJS project with JWT authentication and Role-Based Access Control (RBAC) guards.
    *   Prisma schema defined (≈60 tables) for core data models (Users, Patients, Referrals, Assessments, Problems, Care Plans, etc.).
    *   **Assessments Module:** Implemented `AssessmentsController` and `AssessmentsService` providing CRUD operations for assessments and their associated CalAIM domains.
    *   Health check endpoints.
    *   Initial setup for Pub/Sub integration.
*   **AI Service (FastAPI - `packages/ai-service`):**
    *   FastAPI microservice skeleton with health checks.
    *   **Google Cloud Integration:**
        *   Integration with Google Cloud Document AI for OCR from uploaded documents.
        *   Integration with Google Cloud Healthcare Natural Language API for extracting clinical entities.
        *   Asynchronous document processing pipeline triggered by a Pub/Sub listener.
    *   Configurable mock/real GCP service usage for development.
    *   Initial logic for mapping extracted entities to CalAIM domains and calculating confidence scores.
*   **Infrastructure & Dockerization:**
    *   PostgreSQL, Redis, and MinIO (S3-compatible) containers running and networked via `calaim-network`.
    *   `Dockerfile.dev` for both backend and AI services.
    *   **Docker Compose Stack (`scripts/dev-compose.yaml`):** Full application stack (excluding frontend initially) can be run locally.
    *   **Automatic Database Migrations:** Prisma migrations are automatically applied when the backend container starts.
    *   **Docker Credential Fix:** A script (`scripts/fix-docker-credentials.sh`) is provided to resolve common Docker credential helper issues on local machines.
*   **Development Tooling & Documentation:**
    *   ESLint/Prettier for code linting and formatting, Husky and commit-lint for Git hooks.
    *   Pino for structured logging in the backend.
    *   Swagger/OpenAPI documentation for backend and AI service APIs.
    *   Comprehensive **[DEVELOPMENT_GUIDE.md](DEVELOPMENT_GUIDE.md)**.
    *   Architectural design documents and status reports.

## Components and Modules

The repository is structured as a monorepo, with the following key components located in the `packages/` directory:

-   **`ai-service`:** This component houses the AI/NLP microservice, responsible for processing referral documents and extracting relevant information. It is implemented in Python using FastAPI and leverages Google Cloud Healthcare Natural Language API, Cloud Document AI, and potentially spaCy for clinical entity extraction and domain mapping.
-   **`backend`:** This component implements the backend API using NestJS (TypeScript). It provides endpoints for user authentication, patient management, referral handling, assessment creation, and care plan generation. It interacts with the AI service via Pub/Sub and manages data persistence using Prisma ORM with a PostgreSQL database.
-   **`frontend`:** (Stub only currently) This component will contain the clinician-facing user interface built with React (Next.js). It will allow users to upload referral documents, review AI-generated suggestions, manage problem lists, and create care plans.

Other key directories and files include:

-   **`scripts/`**: Contains scripts for development environment setup (e.g., `dev-compose.yaml`, `fix-docker-credentials.sh`), and database initialization/migration helpers.
-   **`infrastructure/terraform/`**: Holds Terraform configuration files for deploying the application on GCP.
-   **`docs/`**: Intended for Architectural Decision Records (ADRs) and other design documents.
-   **`DEVELOPMENT_GUIDE.md`**: Comprehensive guide for developers.

## High-Level Functionality

The CalAIM Assistant aims to automate several key clinical workflows:

1.  **Document Intake and Processing:** Clinicians upload referral documents. The backend API stores the document (MinIO locally, GCS in production) and publishes a message to a Pub/Sub topic.
2.  **AI-Powered Extraction:** The AI service listens to the Pub/Sub topic, retrieves the document, and processes it using Document AI (for OCR) and Healthcare NL API (for entity extraction).
3.  **Assessment Domain Population:** The AI service maps extracted entities to the seven required CalAIM assessment domains and suggests content with confidence scores. This data is then made available via the backend.
4.  **Clinician Review & Finalization:** Clinicians review AI-generated suggestions in the frontend, make adjustments, and finalize assessments.
5.  **Problem List Management:** The system manages a coded problem list using SNOMED CT and ICD-10 terminologies.
6.  **Care Plan Generation:** The system facilitates the creation of CalAIM-compliant care plans.
7.  **User Authentication and Authorization:** Secure user authentication and RBAC are implemented.

## Data Flow and Interactions (Updated)

1.  A clinician uploads a referral document through the frontend, which sends it to the backend API.
2.  The backend API stores the document in MinIO (local dev) or Google Cloud Storage (production) and publishes a message to a Pub/Sub topic (e.g., `doc.jobs`).
3.  The AI service, subscribed to the `doc.jobs` topic, receives the message.
4.  The AI service retrieves the document from storage.
5.  It processes the document using Google Document AI for text extraction (OCR).
6.  The extracted text is then sent to Google Healthcare Natural Language API for clinical entity recognition (diagnoses, symptoms, medications, etc.).
7.  The AI service maps these extracted entities to the seven CalAIM assessment domains, calculating confidence scores for each piece of information.
8.  The structured data (assessment domain suggestions) is stored or sent back to the backend API (e.g., via a callback or by updating the database directly, TBD).
9.  The clinician reviews the AI-generated suggestions in the frontend, makes any necessary adjustments, and finalizes the assessment and care plan.

Key data models include:

-   **Users:** Stores clinician information.
-   **Patients:** Stores patient demographics and medical history.
-   **Referrals:** Represents referral documents and their processing status.
-   **Assessments:** Stores the structured data for the seven CalAIM assessment domains.
-   **Problems:** Represents the coded problem list.
-   **CarePlans:** Stores care plan details.

The database schema is defined using Prisma ORM (`packages/backend/prisma/schema.prisma`).

## Engineering Practices

The codebase adheres to several key engineering practices:

-   **TypeScript:** The backend and frontend are written in TypeScript.
-   **Python:** The AI service is written in Python using FastAPI.
-   **Linting and Formatting:** ESLint and Prettier (for TS/JS), and appropriate Python linters/formatters. Husky and commitlint for Git hooks.
-   **Docker-Centric Development:** Core services are containerized for consistent local development and easier deployment.
    *   `docker compose -f scripts/dev-compose.yaml up --build` starts the entire local stack.
    *   Automatic database migrations via Prisma `migrate deploy` on backend container startup.
    *   A utility script (`scripts/fix-docker-credentials.sh`) is provided to address common Docker credential helper issues.
-   **Testing:** Unit and integration tests are used. Target coverage is 85%.
-   **CI/CD:** Cloud Build and Cloud Deploy are targeted for automated building, testing, and deployment to GCP.
-   **Logging:** Pino is used for structured logging in the backend; standard Python logging (e.g., Loguru) in the AI service.
-   **Development Guidance:** A comprehensive `DEVELOPMENT_GUIDE.md` is maintained.

## Dependencies and Integrations

The project relies on several key dependencies and integrations:

-   **Google Cloud Platform (GCP):** Cloud Run, Cloud SQL, Cloud Storage, Cloud Pub/Sub, Document AI, Healthcare Natural Language API.
-   **Docker & Docker Compose:** For local development and containerization.
-   **Prisma ORM:** For database access and schema management with PostgreSQL.
-   **NestJS:** Node.js framework for the backend API.
-   **FastAPI:** Python framework for the AI/NLP microservice.
-   **Next.js:** React framework targeted for the frontend UI.
-   **(Potentially) spaCy:** Python library for additional NLP tasks if needed.

## How to Run and Test

Please refer to the **[DEVELOPMENT_GUIDE.md](DEVELOPMENT_GUIDE.md)** for detailed instructions on:
*   Setting up your environment.
*   Running the application using Docker Compose.
*   Accessing service endpoints (Swagger, health checks).
*   Connecting to the database and other services.
*   Troubleshooting common issues.

---

This README provides a high-level overview. For more specific details, consult the documentation within individual packages and the `DEVELOPMENT_GUIDE.md`.
