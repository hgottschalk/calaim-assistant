# MVP Status Report  
AI-Powered CalAIM Domain & Care Plan Assistant  
Reporting Date:  04 June 2025  

---

## 1  Accomplishments to Date  
| Area | Outcome |
|------|---------|
| Repo & Monorepo | Git repo initialised, pushed to GitHub; pnpm workspaces (`backend`, `ai-service`, `frontend`)|
| Infrastructure | PostgreSQL, Redis, MinIO containers running and networked via `calaim-network` |
| Backend API | NestJS project scaffolded; JWT auth, RBAC guards, Prisma schema (≈60 tables); health endpoints |
| AI Service | FastAPI micro-service skeleton with health check, mock entity extraction & domain mapping; Dockerfile |
| Dev Tooling | ESLint/Prettier, Husky, commit-lint, Pino logging, Swagger/OpenAPI docs |
| Dockerfiles | Backend & AI service `Dockerfile.dev` created; compose stack defined |
| Docs | README, architecture design docs, development roadmap, and this status report |

---

## 2  Current Running Services  
| Container | Image / Tag | Ports | Status |
|-----------|-------------|-------|--------|
| `calaim-postgres` | `postgres:15-alpine` | 5432 | Running (pg_isready ✅) |
| `calaim-redis` | `redis:7-alpine` | 6379 | Running (PING PONG ✅) |
| `calaim-minio` | `minio/minio:latest` | 9000 (API), 9001 (UI) | Running (`/minio/health/live` ✅) |
| _Application services_ | backend / ai-service | 8080 / 8000 | Docker images buildable; not yet running in compose due to credential issue (see §3) |

---

## 3  Docker Credential Issue & Work-Around  
**Root cause**  
Docker Desktop expected credential helpers (`docker-credential-desktop`, `docker-credential-gcloud`) that were **missing** from `/Applications/Docker.app/Contents/Resources/bin/`.  
**Symptoms** – `error getting credentials - exec: "docker-credential-desktop": executable file not found`.  

**Work-around implemented**  
1. Switched to **Docker Hub-only images** (avoided `gcr.io` & `ghcr.io`).  
2. Started core infrastructure containers with `docker run …` (manual) instead of `docker compose`.  
3. Plan to disable credential helpers in `~/.docker/config.json` or install missing binaries before re-enabling full compose stack (see Next Steps).  

---

## 4  Architecture Overview (Implemented Components)  
```
┌───────────┐     ┌──────────────┐
│  Next.js  │◄──►│  NestJS API   │◄──► PostgreSQL
│  (stub)   │    │   (backend)   │
└───────────┘     │  Prisma ORM  │
                  │  Redis Cache │
                  │  Pub/Sub API │
                  └────▲───▲─────┘
                       │   │
                       │   │REST / gRPC
               ┌───────┘   └────────┐
               │   FastAPI AI svc   │
               │  (mock NLP/OCR)    │
               └─────────▲──────────┘
                         │
                 MinIO (S3-compatible)
```
_All services isolated on `calaim-network`; production target is Cloud Run + managed GCP services._

---

## 5  What’s Working vs Pending  
| Area | Working | Pending |
|------|---------|---------|
|Infrastructure containers | ✅ | Auto-create via compose once creds fixed |
|Backend API skeleton (auth, health) | ✅ | Domain endpoints, PDF generation |
|AI service mock pipeline | ✅ | Real Document AI + Healthcare NL API |
|Prisma schema | ✅ | Migrations executed in container |
|Storage uploads (SDK level) | ✅ | Virus-scan, signed-URL middleware |
|Dockerfiles | ✅ | CI build in Cloud Build |
|Frontend | Stub only | Full clinician UX |
|Credential helpers | ⚠️ manual bypass | Permanent fix / disabled config |
|CI/CD | Lint hooks | Cloud Build + Cloud Deploy pipeline |
|IaC | Placeholder Terraform dir | VPC-SC, Cloud SQL, Cloud Run resources |

---

## 6  Next Steps to Complete MVP  
1. **Credential Helper Fix**  
   • Remove `"credsStore": "desktop"` & `"credHelpers"` from `~/.docker/config.json` _or_ install helpers.  
2. **Enable Full `docker compose up`**  
   • Build backend & AI images; verify health checks.  
3. **Backend Features**  
   • Implement Referrals → Assessments → Problem List → Care Plan endpoints.  
   • Add PDF generation & file upload flow.  
4. **AI Service Integration**  
   • Wire Document AI OCR & Healthcare NL API; confidence aggregation; Pub/Sub listener.  
5. **Frontend SPA**  
   • Next.js pages for login, domain review, care-plan builder; connect to API.  
6. **Prisma Migrations in Container**  
   • Run `prisma migrate deploy` on backend container start.  
7. **CI/CD & IaC**  
   • Cloud Build: test → build → deploy.  
   • Terraform: Cloud Run, Cloud SQL, GCS buckets, KMS.  
8. **Security Hardening**  
   • mTLS between services, CMEK rotation, pen-test fixes.  

---

## 7  How to Access & Test the Current System  

| Action | Command / URL |
|--------|---------------|
|Start infrastructure (manual) | See §2 containers; or run helper script `scripts/local-infra.sh` |
|MinIO Console | http://localhost:9001 (user `minio_admin`, pass `minio_password`) |
|PostgreSQL | `psql -h localhost -U calaim_user -d calaim` |
|Redis test | `redis-cli -h localhost ping` → `PONG` |
|Run backend locally | `pnpm --filter=@calaim/backend dev` (requires Node 18+) |
|Run AI service locally | From `packages/ai-service`: `uvicorn main:app --reload` (set env vars as in compose) |
|API docs | Once backend running: http://localhost:8080/api/docs |
|AI health check | `curl http://localhost:8000/health` |

_When credential helpers are fixed, simply:_  
```bash
docker compose -f scripts/dev-compose.yaml up --build
```  
and visit the same URLs above (ports 8080 / 8000 / 9001).

---

**Project remains on schedule once credential helper hurdle is cleared.**  
With containers fully orchestrated, focus shifts to feature depth (assessment logic, AI integration) and deployment automation.  
