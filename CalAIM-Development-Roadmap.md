# CalAIM-Powered Domain & Care Plan Assistant  
## Development Roadmap (v1.0 • June 2025 — GCP Edition)

---

### 1  MVP Phase — 6-Month Timeline  

| Month | Focus Sprint | Major Outcomes & GCP Services |
|-------|--------------|--------------------------------|
| **M1** | Foundations & DevOps | • Terraform (Google provider) bootstraps org project, VPC-SC, CMEK keys  • Cloud Build CI/CD pipeline  • Firebase Authentication stub  • React + Next.js scaffold deployed to Cloud Run Jobs |
| **M2** | Core Data Services | • Cloud SQL (PostgreSQL) schemas (patients, domains, problems)  • Cloud Storage buckets (referrals, PDFs, logs)  • Pub/Sub topic + subscription for AI job queue  • Document AI & Healthcare NL API POC |
| **M3** | Assessment UX Alpha | • Dynamic domain forms  • AI suggestions pane (Pub/Sub → Cloud Run worker)  • SNOMED search in Cloud SQL  • Audit logging via Cloud Logging |
| **M4** | Care-Plan Builder | • Goal/intervention templates  • PDF generation in NestJS on Cloud Run  • Role-based access & validations  • Cloud Endpoints secured APIs |
| **M5** | Hardening & Mobile Polish | • WCAG AA compliance  • Performance tuning (<400 ms p95 API on Cloud Run)  • Security review (VPC-SC, IAM least privilege)  • Cloud Monitoring dashboards & Cloud Trace |
| **M6** | Beta & Launch | • Pilot deployment with Cloud Deploy blue/green  • BAA compliance checklist complete  • Vertex AI pipeline framework for future model retraining  • MVP “Go/No-Go” release decision |

---

### 2  Post-MVP Enhancement Backlog (12 Months)

1. AI self-training loop via **Vertex AI** pipelines using clinician feedback  
2. OCR for scanned/handwritten referrals with **Document AI OCR Specialized**  
3. FHIR R4 read/write APIs behind **Cloud Endpoints** & SMART-on-FHIR launch context  
4. Collaborative care-plan editing & versioning  
5. Reporting dashboards (BigQuery + Looker) for caseload & audit readiness  
6. Offline PWA sync with Cloud Firestore (optional)  
7. Advanced security: anomaly detection with **Cloud Security Command Center**  

---

### 3  Key Milestones & Deliverables  

| Milestone | Target Date | Acceptance Criteria |
|-----------|-------------|---------------------|
| **GCP Architecture Review** | End M1 | Signed ADRs, threat model, Terraform repo ✅ |
| **AI Pipeline v1** | Mid M2 | <10 s p90 extraction on sample set using Healthcare NL API |
| **Assessment Alpha** | End M3 | Complete 7-domain workflow, audit log entries in BigQuery |
| **Care-Plan PDF v1** | Mid M4 | CalAIM format validated by SME, <1 MB file stored in Cloud Storage |
| **Security Gate** | End M5 | 0 Critical/High CVEs; penetration test; VPC-SC enforced |
| **MVP GA** | End M6 | Pilot NPS > 50, bug backlog < 10 P1 issues |

---

### 4  Team Structure & Responsibilities  

| Role | FTE | Key Duties |
|------|-----|-----------|
| Product Owner (Clinical SME) | 0.5 | Scope, requirement clarifications |
| Tech Lead / Architect | 1 | System design, code reviews, Terraform modules |
| Backend Dev (NestJS) | 1 | API, Cloud SQL integrations, PDF service |
| Frontend Dev (React) | 1 | SPA, accessibility, state mgmt |
| AI/NLP Engineer | 1 | Healthcare NL API orchestration, spaCy tuning |
| QA / SDET | 0.5 | Test plans, automation, performance |
| UX Designer | 0.25 | Wireframes, usability studies |
| Project Manager | 0.5 | Schedule, risk log, stakeholder comms |

---

### 5  Technical Dependencies (GCP)  

1. **Google Cloud Run** (serverless containers)  
2. **Cloud SQL** (PostgreSQL 15)  
3. **Google Cloud Storage** (CMEK, Object Versioning)  
4. **Pub/Sub** (job queue)  
5. **Document AI** & **Healthcare Natural Language API**  
6. **Firebase Authentication** (OIDC/JWT)  
7. **Vertex AI** (future model training)  
8. **Cloud Functions** (scheduled code-set refresh)  
9. **Cloud Build** & **Artifact Registry** (CI/CD)  
10. **Cloud Monitoring**, **Cloud Logging**, **Cloud Trace**  

---

### 6  Risk Mitigation Strategies  

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| AI accuracy < required | High | Med | Ensemble with spaCy, manual override UI, active learning via Vertex AI |
| HIPAA breach | Critical | Low | VPC-SC, CMEK, Access Transparency, quarterly pen-test |
| Scope creep | Med | Med | Change-control board, backlog grooming |
| Talent bandwidth | Med | Med | Cross-training, contractor bench |
| Service quota limits | Low | Med | Request quota increases early; monitoring alerts |

---

### 7  Success Metrics & KPIs  

| Category | KPI | MVP Target |
|----------|-----|-----------|
| Efficiency | Avg clinician time to complete assessment | ≤ 15 min (↓ 50 %) |
| AI Quality | Weighted F1 (entity extraction) | ≥ 0.85 |
| Adoption | Weekly Active Users / Total Users | ≥ 60 % |
| Reliability | Uptime (SLA) | ≥ 99.9 % |
| Performance | p95 API latency (Cloud Run) | ≤ 400 ms |
| Security | Critical vulns outstanding | 0 |

---

### 8  Integration Roadmap  

1. **MVP:** Internal REST JSON, CSV exports  
2. **Q3 2025:** Outbound FHIR `CarePlan`, `Condition`, `DocumentReference` via **Cloud Endpoints**  
3. **Q4 2025:** SMART-on-FHIR launch button within partner EHRs (Workload Identity Federation)  
4. **2026:** Bi-directional sync (Bulk Data on FHIR → BigQuery)  

---

### 9  Project Governance  

* **Steering Committee:** CTO, Product Owner, Compliance Officer, External Clinical Advisor — monthly checkpoints  
* **Change Control Board:** Tech Lead, PM, QA — approve scope changes & versioning  
* **Quality Gates:** Defined at end of each sprint (unit ≥ 90 %, static analysis 0 Critical)  
* **Documentation:** Confluence; ADRs in repo; release notes every sprint  
* **Regulatory Compliance:** HIPAA Security/Privacy Officer sign-off before production pushes  

---

### 10  Conclusion & Next Steps  

This roadmap realigns the Assistant to Google Cloud Platform, leveraging Cloud Run, Cloud SQL, Document AI, and Healthcare NL API while preserving the six-month MVP commitment.  

**Immediate Actions:**  
1. Execute Google Cloud BAA and enable Access Transparency.  
2. Provision core GCP infrastructure via Terraform and set up Cloud Build pipelines (Sprint 0).  
3. Onboard pilot providers for iterative feedback during development.  

With disciplined execution, measurable KPIs, and a secure GCP foundation, the Assistant will significantly reduce CalAIM documentation burden and position us for scalable post-MVP growth.
