# MVP Status Report  
AI-Powered CalAIM Domain & Care Plan Assistant  
_Reporting Date: 04 June 2025_

---

## 1. Executive Summary  
The project has moved from documentation to running code.  
• Git repository initialized with monorepo structure (frontend, backend, ai-service).  
• NestJS backend scaffolded with full JWT auth, role-based access control, Prisma schema and health endpoints.  
• Core infrastructure services—Storage (GCS/MinIO), Pub/Sub, AI-Service client, Redis, PostgreSQL—are functional through Docker Compose.  
• A comprehensive README, git-hooks, ESLint/Prettier, and commit-lint enforce quality from day one.  
The codebase now compiles, spins up locally via `docker compose`, and exposes authenticated REST endpoints with Swagger docs.

---

## 2. Project Architecture & Structure  

```
/ (root)
│─ README.md
│─ package.json (pnpm workspaces)
│─ scripts/dev-compose.yaml
├─ packages
│  ├─ frontend/        – Next.js SPA (stub)
│  ├─ backend/         – NestJS API (running)
│  └─ ai-service/      – FastAPI doc-pipeline (stub)
├─ infrastructure/terraform/ (empty – placeholder)
└─ docs/               – ADRs & design docs
```

Container topology for local dev:

| Service          | Port | Image             |
|------------------|------|-------------------|
| Postgres 15      | 5432 | postgres:alpine   |
| MinIO (GCS emu)  | 9000 | minio/minio       |
| Pub/Sub Emulator | 8085 | gcloud SDK        |
| Redis            | 6379 | redis:alpine      |
| Backend API      | 8080 | `packages/backend`|
| AI Service Stub  | 8000 | `packages/ai-service` |
| Frontend (stub)  | 3000 | `packages/frontend` |

---

## 3. Completed Features & Services  

| Domain               | Status | Notes |
|----------------------|--------|-------|
| Git & Monorepo setup | ✅     | pnpm workspaces, commit hooks |
| Docker Compose stack | ✅     | Postgres, MinIO, Pub/Sub, Redis, API, stubs |
| Prisma DB schema     | ✅     | 60+ tables covering Users, Patients, Domains, Problems, CarePlans |
| JWT Auth & RBAC      | ✅     | Passport strategy, guards & decorators |
| Users API            | ✅     | CRUD w/ hashed passwords, validation |
| Patients API         | ✅     | CRUD, search, org-scoped, validation |
| Storage Service      | ✅     | Upload/Download, signed URLs, GCS & MinIO support |
| Pub/Sub Service      | ✅     | Publish/Subscribe, emulator aware |
| AI Service Client    | ✅     | Submit job, poll status, mock mode |
| Health Endpoints     | ✅     | Liveness/readiness, DB/Redis/Storage/PubSub/AI |
| Logging & Error filt | ✅     | Pino, request/response interceptor |
| CI skeleton          | ⚠️     | commit-lint & lint-staged only (full Cloud Build pending) |

---

## 4. Technology Stack Implemented  
• TypeScript 5, NestJS 11 (Fastify)  
• PostgreSQL 15 via Prisma ORM  
• Google Cloud client libraries (Storage, Pub/Sub)  
• MinIO & Pub/Sub emulator for local parity  
• Docker Compose for dev orchestration  
• Pino structured logging, Swagger (OpenAPI 3.1)  
• pnpm workspaces, Husky, Commitlint, ESLint 8, Prettier 3  

---

## 5. Development Environment Setup  

1. _Clone & install_  
   ```
   git clone <repo>
   cd calaim-assistant
   pnpm install
   ```  
2. _Python env (for future ai-service)_  
   ```
   pyenv install 3.12.2
   python -m venv .venv && source .venv/bin/activate
   ```  
3. _Start full stack_  
   ```
   docker compose -f scripts/dev-compose.yaml up --build
   ```  
4. _Access_  
   • API Swagger: http://localhost:8080/api/docs  
   • Next.js (stub): http://localhost:3000  

---

## 6. What’s Working vs What Needs Implementation  

| Area                              | Working | Pending |
|-----------------------------------|---------|---------|
| Backend core framework            | ✅      | — |
| Auth + RBAC                       | ✅      | MFA via Firebase auth |
| Users & Patients CRUD             | ✅      | Pagination, soft-delete UI |
| File upload & storage             | ✅      | Virus scan, content-type sniff |
| Pub/Sub job dispatch              | ✅      | Dead-letter queues, retry config |
| AI Service client (mock)          | ✅ (mock) | Real FastAPI microservice & GCP Document AI calls |
| Seven-Domain Assessments          | ⚠️ stub | Domain models & controllers |
| Problem List & Care Plans         | ⚠️ stub | SNOMED/ICD mapping rules, PDF gen |
| Frontend clinician UI             | stub    | Full UX w/ forms & auth |
| Terraform/IaC                     | —       | VPC-SC, Cloud SQL, Cloud Run, KMS |
| CI/CD (Cloud Build/Deploy)        | —       | Build, scan, blue/green pipelines |
| Automated tests                   | ⚠️ basic | ≥ 85 % coverage goal |

---

## 7. Next Steps & Remaining Work  

1. Finish domain modules: Referrals → Assessments → Problems → Care Plans.  
2. Build AI micro-service (FastAPI) with Document AI OCR + Healthcare NL API orchestration.  
3. Implement React/Next.js clinician interface, integrate auth + API.  
4. Terraform baseline for GCP (VPC-SC, Cloud Run, Cloud SQL, GCS buckets).  
5. CI pipeline: unit tests, docker build, Prisma migrate, tf-plan, deploy.  
6. PDF generation for CalAIM care plans.  
7. Active-learning feedback loop & F1 evaluation dashboards.  
8. Security hardening: mTLS, CMEK rotation, pen-test fixes.  

---

## 8. Timeline to MVP GA (6-month plan)

| Month | Focus | Major Deliverables |
|-------|-------|--------------------|
| M1 (DONE) | Foundations | Repo, DevOps stack, Auth, DB schema |
| M2 | Data Services | Referrals upload, AI job queue, AI micro-service POC |
| M3 | Assessment UX Alpha | Seven-domain forms, AI suggestions, audit logs |
| M4 | Care-Plan Builder | Goals/Interventions, PDF export, secured APIs |
| M5 | Hardening & Mobile | WCAG, perf ≤ 400 ms, VPC-SC, pen-test |
| M6 | Pilot & Launch | Cloud Deploy blue/green, pilot with 3 orgs |

---

## 9. Local Development Cheat-Sheet  

| Action | Command |
|--------|---------|
| Start stack | `docker compose -f scripts/dev-compose.yaml up --build` |
| Stop stack  | `docker compose down` |
| Run backend tests | `pnpm --filter=@calaim/backend run test` |
| Prisma migrate | `pnpm --filter=@calaim/backend run prisma:migrate` |
| Lint all code | `pnpm lint` |
| Format code   | `pnpm format` |

---

## 10. Key Achievements & Technical Decisions  

1. **Serverless-first architecture** – Cloud Run targeted; Fastify for lower p99 latency.  
2. **Full GCP parity in Docker Compose** – MinIO + Pub/Sub emulator enable offline dev.  
3. **Security by Design** – JWT RBAC, helmet, compression, global validation & exception filters.  
4. **Prisma Schema Complete** – Covers entire CalAIM data model (patients → care-plans).  
5. **Extensible Health Framework** – Terminus + custom indicators expose granular readiness checks.  
6. **AI Service Abstraction** – Mockable client enables frontend/UI progress before real NLP is wired.  
7. **Monorepo & Tooling** – pnpm, Husky, ESLint/Prettier, commit-lint enforce consistency.  
8. **Scalable Storage Layer** – Switches seamlessly between local MinIO and GCS CMEK buckets.  

---

Project is on schedule with a solid backend foundation; remaining effort is concentrated on feature depth (assessment logic & AI) and cloud deployment automation.
