# Project Report  
## AI-Powered CalAIM Domain & Care Plan Assistant  
*(“the Assistant” – MVP Scope on Google Cloud Platform)*  
June 2025  

---

### 1  Introduction to CalAIM & the Problem Space  
California Advancing and Innovating Medi-Cal (CalAIM) mandates a standardized seven-domain assessment, a maintained problem list, and linked care-plan documentation.  
Small and mid-sized behavioral-health providers still rely on manual paperwork and fragmented EHR workflows, leading to:

* Excessive clinician time on data entry  
* Frequent compliance errors during audits  
* Slow billing and reimbursement cycles  

---

### 2  Opportunity Analysis (Summary)  

| Insight | Implication |
|---------|-------------|
| Existing EHRs are costly, EHR-centric, and not mobile-friendly | Niche for lightweight SaaS |
| CalAIM documentation complexity is rising through 2026 | Urgent demand for automation |
| AI in healthcare is maturing (entity extraction, SDOH capture) | Competitive differentiator |
| PATH funding supports CBO tech adoption | Lowers market barriers |

---

### 3  Proposed Solution Overview  
The Assistant is a HIPAA-eligible, GCP-native SaaS that:

1. Accepts referral documents (PDF/DOCX) into **Google Cloud Storage (GCS)**.  
2. Runs OCR via **Google Cloud Document AI** and clinical entity extraction with **Cloud Healthcare Natural Language API**.  
3. Pre-populates the seven assessment domains; clinicians review on a responsive web UI.  
4. Manages a SNOMED-coded problem list and auto-maps to ICD-10.  
5. Builds CalAIM-compliant care plans (PDF) and, post-MVP, publishes FHIR resources.

---

### 4  Key Technical Components (GCP)  

| Layer | Service | Role |
|-------|---------|------|
| Front-end SPA | React 19 / Next.js 15 deployed to **Cloud Run Jobs** | Mobile-friendly clinician interface |
| API & Business Logic | NestJS containers on **Google Cloud Run** | Auth, domain CRUD, PDF renderer |
| AI/NLP Micro-service | FastAPI on Cloud Run + **Healthcare NL API** + **Document AI** | Text extraction, entity detection, domain mapping |
| Database | **Cloud SQL for PostgreSQL** | Structured storage for patients, domains, problems, plans, audit |
| Object Storage | **Google Cloud Storage** (CMEK, Object Versioning) | Referral docs & generated PDFs |
| Messaging / Jobs | **Cloud Pub/Sub** | Queue long-running AI and PDF tasks |
| Authentication | **Firebase Authentication / Identity Platform** | Email, MFA, SSO, OIDC tokens |
| Observability | **Cloud Logging / Monitoring / Trace** | Central metrics, logs, distributed tracing |
| CI/CD & IaC | **Cloud Build + Cloud Deploy**, Terraform | Automated build, blue/green rollout, reproducible infra |

---

### 5  Implementation Strategy & Roadmap  

| Month | Highlights |
|-------|------------|
| M1 – Foundations | Terraform baseline, VPC-SC, CMEK keys, Firebase project, Cloud SQL & GCS buckets |
| M2 – Data & AI POC | File intake, Document AI OCR, Healthcare NL API integration, Pub/Sub queue |
| M3 – Assessment Alpha | Seven-domain forms, AI suggestions UI, audit log to BigQuery |
| M4 – Care Plan Builder | Goal/intervention templates, PDF gen, Cloud Endpoints secured APIs |
| M5 – Hardening | WCAG AA, VPC-SC policies, p95 API ≤ 400 ms, penetration test |
| M6 – Pilot Launch | Cloud Deploy blue/green, BAA review, pilot with 3 provider orgs |

Post-MVP backlog: Vertex AI model retraining, FHIR R4 APIs, Looker dashboards, offline PWA sync via Firestore.

---

### 6  Security & Compliance  

* **HIPAA:** Google Cloud BAA, Access Transparency, CMEK encryption.  
* **Zero Trust:** Firebase JWT for user auth; Workload-Identity Federation for service-to-service auth.  
* **Data Perimeter:** VPC Service Controls restrict Cloud SQL & GCS.  
* **Audit:** Cloud Audit Logs exported to immutable BigQuery table.  
* **Disaster Recovery:** Multi-region GCS replication; automated Cloud SQL PITR; Cloud Run redeploy < 1 h RTO.

---

### 7  Expected Outcomes & Business Value  

| KPI | Target | Impact |
|-----|--------|--------|
| Clinician assessment time | ≤ 15 min (-50 %) | 3 000 hrs annual savings / 12 k assessments |
| AI extraction F1 | ≥ 0.85 | Reliable auto-population |
| Audit exception rate | < 2 % | Fewer corrective actions |
| p95 API latency | ≤ 400 ms | Responsive UX |
| Payback period | < 9 months | Subscription cost offset by labor savings |

Qualitative: reduced burnout, faster CBO onboarding, richer data for value-based contracts.

---

### 8  Risk & Mitigation  

| Risk | Mitigation |
|------|------------|
| AI accuracy shortfall | Ensemble with spaCy; clinician override UI; Vertex AI active learning |
| GCP service quota limits | Early quota requests; Pub/Sub flow control; budget alerts |
| Regulatory changes | Config-driven domain schema; quick redeploy via Cloud Run |
| Talent bandwidth | Cross-training; contractor bench |

---

### 9  Next Steps  

1. Execute Google Cloud BAA and enable CMEK + Access Transparency.  
2. Kick off Sprint 0: Terraform stack, Cloud Build pipelines.  
3. Finalize SNOMED/ICD licensing and import into Cloud SQL.  
4. Recruit pilot providers and schedule feedback checkpoints.  
5. Plan FHIR API schema and Cloud Endpoint design for post-MVP integration.

---

### 10  Conclusion  
By leveraging Google Cloud’s serverless compute, managed databases, and healthcare-focused AI services, the Assistant provides a secure, scalable, and cost-efficient pathway to simplifying CalAIM documentation statewide—positioning providers for improved compliance, faster reimbursement, and better patient outcomes.  
