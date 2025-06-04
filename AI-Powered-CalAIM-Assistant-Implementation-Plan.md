# AI-Powered CalAIM Domain & Care Plan Assistant  
### Comprehensive Technical Implementation Plan (GCP Edition)  

---

## 1. Executive Summary  
This plan details how to deliver the Minimum Viable Product (MVP) of the AI-Powered CalAIM Domain & Care Plan Assistant on Google Cloud Platform (GCP). The goal remains: reduce provider burden in CalAIM documentation through AI-assisted domain population and care-plan generation—now leveraging HIPAA-eligible, fully managed GCP services.

---

## 2. System Architecture  

```
┌───────────────────────────┐
│      Web / Mobile SPA     │  React 19 + RSC
└────────────┬──────────────┘
             │ HTTPS / JWT
┌────────────▼──────────────┐
│   Backend API  (NestJS)   │
│  Auth • Business Logic    │
├────────────┬──────────────┤
│  AI/NLP Micro-service      │  (Python FastAPI)
│  (Doc ingestion pipeline)  │
├────────────┼──────────────┤
│ Cloud SQL (PostgreSQL)     │
│ Cloud Storage (docs/PDFs)  │
│ CodeSets DB (read-only)    │
└────────────┴──────────────┘
             │ FHIR-compatible REST (future)
     External EHR / HIE (post-MVP)
```

Key GCP services  
• Cloud Run (container hosting for API & AI services)  
• Cloud SQL for PostgreSQL (regional HA)  
• Google Cloud Storage (GCS) with CMEK encryption  
• Cloud Pub/Sub for asynchronous job queues (replaces RabbitMQ if desired)  
• Cloud Document AI (OCR) + Healthcare Natural Language API  
• Firebase Authentication for user auth (email/MFA/SSO)  
• Cloud Build + Artifact Registry for CI/CD  
• Cloud Monitoring, Logging & Trace for observability  
• Terraform with Google Provider for IaC

---

## 3. Technology Stack Selection  

| Layer | Chosen Tech | GCP Integration |
|-------|-------------|-----------------|
| Frontend | React 19 + Next.js 15, TypeScript, Tailwind v4, Shadcn/ui | Deployed to Cloud Run via Next.js container or Cloud Run Jobs |
| Backend API | NestJS 11 (Node 18, TS) | Container image → Cloud Run, Cloud Endpoints for API management |
| AI/NLP | Python 3.12 FastAPI, spaCy, Google Cloud Healthcare NL API, custom rules | Container → Cloud Run; calls Healthcare NL via REST |
| DB | PostgreSQL 15 on Cloud SQL | Private VPC connector |
| Code Sets | Read-only schemas in Cloud SQL | Nightly Cloud Scheduler jobs for updates |
| Storage | Google Cloud Storage buckets (referrals, PDFs) | CMEK, uniform bucket-level access |
| Auth | Firebase Authentication (OIDC/JWT) | Identity Platform HIPAA-eligible |
| PDF | pdf-lib (Node) | Runs inside API container |
| DevOps | Docker, Cloud Build triggers, Terraform (GCP) | Cloud Deploy optional |

---

## 4. Core Components Implementation  
_No functional change vs. previous plan—containers now run on Cloud Run and use GCP services referenced above._

---

## 5. AI/NLP Service Implementation  
Pipeline identical; swap services:  
• OCR: **Google Cloud Document AI**  
• Clinical entities: **Google Cloud Healthcare Natural Language API**  
Ensemble with custom spaCy model; latency target unchanged (<10 s/5pp PDF).

---

## 6. Database Schema Design  
_No change—deployed on Cloud SQL with automated backups and point-in-time recovery._

---

## 7. User Interface Design  
_No change._

---

## 8. Integration Strategy  
Phase 1 (MVP): internal REST over Cloud Run base URLs.  
Phase 2: FHIR endpoints secured behind Google Cloud Endpoints; service-to-service auth via Workload Identity Federation.

---

## 9. Security & Compliance  

| Area | GCP Control |
|------|-------------|
| HIPAA Compliance | Covered under Google Cloud BAA; enable Access Transparency & CMEK |
| Data in Transit | HTTPS / TLS 1.3 via Cloud Load Balancing |
| Data at Rest | CMEK encryption for Cloud SQL & GCS; VPC-SC for data perimeter |
| Identity & Access | Firebase Auth (OIDC) + Cloud IAM least privilege |
| Network | Serverless VPC Access connectors; private services access for Cloud SQL |
| Audit Logging | Cloud Audit Logs; immutable export to BigQuery |
| Observability | Cloud Monitoring dashboards; Cloud Logging with PHI redaction; Cloud Trace for distributed tracing |

---

## 10. Implementation Timeline (6-Month MVP)  

| Month | Major Milestones (GCP) |
|-------|------------------------|
| 1 | Terraform GCP foundation, VPC-SC, Cloud SQL instance, Firebase project, Cloud Build pipeline |
| 2 | Patient & Auth modules, GCS upload flow, Document AI & Healthcare NL API POC |
| 3 | Assessment domain forms, Problem List service on Cloud Run |
| 4 | Care Plan builder, PDF generation, Cloud Endpoints secured APIs |
| 5 | Performance & security hardening, Cloud Monitoring/Trace integrated |
| 6 | Pilot release via Cloud Deploy; finalize BAA compliance checklist |

---

## 11. Testing Strategy  
Identical, with additional load test via **Cloud Load Test (k6 + Cloud Build)** and security scanning through **Cloud Build Entrypoint** containers.

---

## 12. Deployment Strategy  
• Build: Cloud Build → Artifact Registry  
• Deploy: Cloud Deploy pipelines push new revisions to Cloud Run (blue/green).  
• IaC: Terraform (google, google-beta providers) manages Cloud SQL, GCS, IAM, VPC-SC, Scheduler jobs.  
• Back-ups: Cloud SQL automated backups + PITR; GCS bucket replication multi-region.  
• DR: Multi-region storage; Cloud Run services redeployable in < 1 h (RTO).  

---

## 13. Conclusion  
By shifting to GCP’s HIPAA-eligible, fully managed services, the Assistant maintains its rapid-development ethos while benefiting from Cloud Run’s serverless model, Cloud SQL’s managed PostgreSQL, and best-in-class healthcare NLP APIs. The roadmap, security posture, and ROI remain unchanged—only the cloud substrate differs.
