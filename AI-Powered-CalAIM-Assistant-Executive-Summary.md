# AI-Powered CalAIM Domain & Care Plan Assistant  
### Executive Summary — June 2025 (Google Cloud Edition)  

---

## 1  Project Overview  
The AI-Powered CalAIM Domain & Care Plan Assistant (“the Assistant”) is a cloud-native application that automates California’s CalAIM Specialty Mental Health Services (SMHS) documentation. Clinicians upload referral paperwork, and the system leverages healthcare-tuned artificial intelligence to pre-populate the seven required assessment domains, manage a standards-based problem list, and generate CalAIM-compliant care plans—all delivered on Google Cloud Platform (GCP) using HIPAA-eligible managed services.

---

## 2  Key Business Value  
* **Reduce Administrative Burden:** Cut assessment & care-plan drafting time by 50–60 %, freeing clinicians for direct care.  
* **Ensure Compliance:** Enforces seven-domain, problem-list, and CalAIM care-plan rules, lowering audit risk.  
* **Accelerate Reimbursement:** Accurate SNOMED CT ⇄ ICD-10 mapping speeds claim submission and payment cycles.  
* **Level the Playing Field:** Affordable SaaS gives small & mid-sized providers tooling comparable to enterprise EHRs.  
* **Data-Driven Insights (future):** Structured outputs enable quality dashboards and value-based contracting analytics.

---

## 3  Core Technical Components (GCP)  
| Layer | Service | Purpose |
|-------|---------|---------|
| Front-end SPA | Next.js 15 on Cloud Run Jobs | Mobile-responsive clinician UI |
| Back-end API | NestJS containers on **Google Cloud Run** | Business logic, auth, PDF generation |
| AI/NLP Micro-service | FastAPI on Cloud Run + **Google Cloud Healthcare Natural Language API** + Cloud Document AI | Extract entities & populate domains |
| Database | **Cloud SQL for PostgreSQL** | Patients, domains, problems, care plans, audit |
| Object Storage | **Google Cloud Storage** (CMEK, Object Versioning) | Secure referral docs & generated PDFs |
| Authentication | **Firebase Authentication / Identity Platform** | HIPAA-eligible user auth, MFA, SSO roadmap |
| Messaging | **Cloud Pub/Sub** | Asynchronous AI jobs & PDF tasks |
| Infrastructure-as-Code | Terraform (google provider) | Repeatable, auditable environment setup |
| Observability | Cloud Monitoring, Cloud Logging, Cloud Trace | Metrics, logs, distributed tracing |
| CI/CD | **Cloud Build** + **Cloud Deploy** | Container build, security scan, blue/green rollout |

---

## 4  Implementation Approach  
* **MVP First:** Deliver a tightly-scoped, production-ready MVP in six months focusing on AI intake, domain management, and care-plan generation.  
* **Serverless by Default:** Cloud Run and other managed GCP services minimize DevOps overhead and auto-scale with demand.  
* **Modular Micro-service Pattern:** Separate AI pipeline for independent scaling and rapid iteration.  
* **Agile Delivery:** 2-week sprints, continuous Cloud Build / Deploy, stakeholder demos each sprint.  
* **Security-by-Design:** CMEK encryption, VPC Service Controls, Access Transparency, immutable audit logging.

---

## 5  Timeline & Resources  

| Phase | Months | Key Deliverables | Core FTEs |
|-------|--------|------------------|-----------|
| Foundations | 1 | Terraform baseline, Firebase Auth, Cloud SQL, Cloud Storage buckets | 4 |
| Data & AI POC | 2 | File intake → GCS, Document AI + Healthcare NL pipeline | 5 |
| Domain UX Alpha | 3 | Seven-domain forms, AI suggestion UI, audit logs | 5 |
| Care-Plan Builder | 4 | Goal/intervention UI, PDF gen, Cloud Endpoints | 6 |
| Hardening | 5 | WCAG AA, VPC-SC, performance & security tests | 6 |
| Pilot & Launch | 6 | Beta with 3 organisations, go-live via Cloud Deploy | 6 |

Team: architect, backend dev, frontend dev, AI engineer, QA, part-time PM/SME.

---

## 6  Expected Outcomes & ROI  

| Metric | Baseline | Target (12 mo) | Benefit |
|--------|----------|----------------|---------|
| Clinician time per assessment | 30 min | ≤ 15 min | 3 k hrs saved / 12 k assessments |
| AI extraction accuracy (F1) | n/a | ≥ 0.85 | Reliable automation |
| Audit exception rate | 8 % | < 2 % | Fewer corrective actions |
| Subscription payback | — | < 9 months | Labor savings > licence cost |

Qualitative ROI: Higher staff satisfaction, faster onboarding of CBOs, improved data for value-based contracts.

---

## 7  Key Recommendations  
1. **Execute Google Cloud Business Associate Agreement (BAA)** and enable Access Transparency & CMEK from day one.  
2. **Approve MVP budget & six-month runway** to capture early-mover advantage in CalAIM tooling.  
3. **Recruit pilot providers early** to co-design workflows and validate ROI.  
4. **Invest in continuous AI improvement loop**—clinician feedback retrains models on Vertex AI, compounding accuracy.  
5. **Design FHIR APIs with Cloud Endpoints now** to streamline post-MVP EHR integrations and expand market reach.

Leveraging Google Cloud’s serverless compute, managed databases, and healthcare-focused AI services, the Assistant offers a secure, scalable, and cost-efficient pathway to transforming CalAIM documentation across California’s behavioural-health ecosystem.
