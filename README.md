# AI-Powered CalAIM Domain & Care Plan Assistant  
*Minimum-Viable Product (MVP) – Google Cloud Platform Edition*

---

## 1  Project Overview  
California Advancing and Innovating Medi-Cal (CalAIM) requires clinicians to complete a seven-domain assessment, maintain a coded problem list, and produce a compliant care plan.  
This repository contains the MVP implementation of the **AI-Powered CalAIM Domain & Care Plan Assistant** (“the Assistant”). The Assistant:

* Ingests clinician-supplied referral documents (PDF/DOCX)  
* Uses Google Cloud Document AI + Healthcare Natural Language API with a custom spaCy pipeline to extract clinical entities  
* Pre-populates the seven CalAIM SMHS assessment domains  
* Manages a SNOMED-coded problem list and auto-maps to ICD-10  
* Generates CalAIM-compliant care plans (PDF)  
* Runs entirely on Google Cloud Platform (HIPAA-eligible, serverless)

---

## 2  High-Level Architecture  

| Layer | Service | Package |
|-------|---------|---------|
| Front-end SPA | React 19 + Next.js 15 on Cloud Run Jobs | `packages/frontend` |
| Back-end API | NestJS 11 container on Cloud Run | `packages/backend` |
| AI/NLP Micro-service | FastAPI 3.12 on Cloud Run | `packages/ai-service` |
| Database | Cloud SQL (PostgreSQL 15) | managed |
| Object Storage | Cloud Storage (CMEK, Object Versioning) | managed |
| Messaging | Cloud Pub/Sub (`doc.jobs` topic) | managed |
| IaC & CI/CD | Terraform, Cloud Build, Cloud Deploy | `infrastructure/terraform` |

---

## 3  Prerequisites  

| Tool | Minimum Version |
|------|-----------------|
| Node.js | 18 LTS |
| npm / pnpm / yarn | latest compatible |
| Python | 3.12 |
| Docker | 24+ (with Buildx enabled) |
| Google Cloud CLI | 470+ (`gcloud components update`) |
| Terraform | 1.7+ |
| Make (optional) | 4.3+ |

A GCP project with billing enabled and a signed Google Cloud HIPAA BAA is required for production deployments.

---

## 4  Quick Start (Local Development)  

```bash
# 1. Clone & bootstrap monorepo
git clone git@github.com:<your-org>/calaim-assistant.git
cd calaim-assistant
git submodule update --init --recursive  # if applicable

# 2. Install JS & Python deps
pnpm install  # or yarn / npm
pyenv install 3.12.2 && pyenv local 3.12.2
python -m venv .venv && source .venv/bin/activate
pip install -r packages/ai-service/requirements.dev.txt

# 3. Spin up services with Docker Compose
docker compose -f scripts/dev-compose.yaml up --build

# 4. Visit the app
open http://localhost:3000        # Next.js SPA
open http://localhost:8080/docs   # FastAPI swagger
```

Local compose includes:
* Postgres 15  
* MinIO (S3-compatible) to emulate Cloud Storage  
* Pub/Sub Lite emulator  
* Dummy OAuth issuer for local auth

---

## 5  Project Structure  

```
.
├── packages/
│   ├── frontend/          # Next.js clinician UI
│   ├── backend/           # NestJS API & business logic
│   └── ai-service/        # FastAPI doc-processing pipeline
├── infrastructure/
│   └── terraform/         # GCP resources (Cloud Run, SQL, GCS…)
├── docs/                  # ADRs, design docs
├── scripts/               # Dev & CI helpers (Makefile, compose)
└── README.md
```

Monorepo managed via **pnpm workspaces** + **Poetry** (Python). Each package is independently containerised.

---

## 6  Technology Stack  

* **React 19 / Next.js 15** – SPA with Tailwind v4 & shadcn/ui  
* **NestJS 11 (TypeScript)** – REST/GraphQL API, class-validator DTOs  
* **FastAPI (Python 3.12)** – Async doc ingestion, Document AI / Healthcare NL orchestration  
* **spaCy v3 + RoBERTa-clinical** – Custom clinical NER pipeline  
* **PostgreSQL 15** – Cloud SQL, accessed via Prisma (TS) & SQLAlchemy (Py)  
* **Google Cloud** – Cloud Run, Pub/Sub, Cloud Storage, Cloud Monitoring/Logging/Trace  
* **Terraform** – Declarative IaC, Google provider  
* **Cloud Build / Cloud Deploy** – CI/CD, blue-green rollout  
* **Docker / Buildx** – Multi-stage, multi-arch images

---

## 7  Development Guidelines  

1. **Branching:** Conventional *git-flow lite* – `main` (prod), `dev` (integration), feature branches `feat/<ticket>`  
2. **Commits:** Conventional Commits (`feat:`, `fix:`, `docs:`…) enforced via commit-lint  
3. **Code Style:**  
   * TS – ESLint + Prettier, strict mode, `noUncheckedIndexedAccess`  
   * Python – ruff, black, mypy (strict)  
4. **Testing:**  
   * Front-end – Vitest + React-Testing-Library  
   * Back-end – Jest + Supertest  
   * AI – Pytest, spaCy scorer (≥ 85 % cov target)  
5. **Secrets:** Never commit; use `docker-compose.override.yaml` or `secrets.dev.env`. For GCP, enable **Workload Identity Federation**.  
6. **ADR:** Architectural decisions belong in `docs/adr-NNNN-*.md` (template provided).  
7. **CI:** All PRs run unit & integration tests + docker build + tf-lint. Merge requires green pipeline.

---

## 8  Deployment  

1. **Bootstrap GCP**  
   ```bash
   cd infrastructure/terraform
   terraform init
   terraform apply
   ```
   Creates VPC-SC perimeter, Cloud Run services, Cloud SQL, GCS buckets, Pub/Sub topics, CMEK.

2. **CI/CD**  
   Cloud Build triggers on `main` and tags:
   * Build & scan container images → Artifact Registry  
   * Terraform plan + apply (guarded)  
   * Cloud Deploy blue/green to `staging` → `prod`  

3. **Configuration**  
   Runtime config via **Cloud Run Service Variables** and Secret Manager; non-secret config in `config/*.yaml`.

---

## 9  Contributing  

1. Fork & clone the repo  
2. Create a feature branch (`feat/<topic>`).  
3. Follow code style & testing guidelines; run `make test`.  
4. Submit a pull request referencing an open issue.  
5. One approval + passing CI required to merge.  
6. All contributors must sign the **Contributor License Agreement (CLA)**.

Need help? Open a discussion or join the `#calaim-assistant` Slack channel.

---

## 10  Security & Compliance (HIPAA)  

| Control Area | Implementation |
|--------------|----------------|
| **Data at Rest** | CMEK encryption for Cloud SQL & Cloud Storage |
| **Data in Transit** | TLS 1.3; mTLS between Cloud Run services |
| **Network Isolation** | VPC Service Controls, Serverless VPC Access |
| **Identity & Access** | Firebase Authentication (users); IAM Workload Identity (services) |
| **Audit Logging** | Cloud Audit Logs exported to immutable BigQuery |
| **PHI in Logs** | Log Router sink + Cloud DLP masking |
| **Pen-Testing** | Quarterly; zero Critical/High CVEs gate |
| **BAA** | Google Cloud HIPAA Business Associate Agreement executed |

Clinical data never leaves the GCP perimeter. Contributors must not use production PHI in local environments—use de-identified samples.

---

## License  
Copyright © 2025 **FactoryAI**  
Released under the Apache 2.0 license. See `LICENSE` for details.

---

*Made with 💙 by the CalAIM Assistant team*
