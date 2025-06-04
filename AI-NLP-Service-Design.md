# AI/NLP Service Design  
*Component of the AI-Powered CalAIM Domain & Care Plan Assistant – GCP Edition*  

---

## 1  Introduction & Overview  
The AI/NLP Service is a stateless micro-service that ingests clinician-uploaded referral documents and returns structured, domain-aligned suggestions for the seven CalAIM SMHS assessment domains. Objectives:  
1. Reduce manual data-entry time ≥ 60 %.  
2. Achieve ≥ 0.85 weighted F1 across required entity types.  
3. Deliver results in < 10 s for a five-page PDF (p90).  

---

## 2  Service Architecture  

| Layer | GCP Technology | Notes |
|-------|----------------|-------|
| API Gateway | Cloud Endpoints + Cloud Load Balancer | OpenAPI 3.1 contract |
| Orchestration / Queue | Cloud Pub/Sub | Decouples long-running jobs |
| Workers | Cloud Run (auto-scaled containers) | CPU-optimised; min-instances = 0 |
| NLP Engines | • Google Cloud Healthcare Natural Language API<br>• spaCy v3 custom pipeline | Ensemble strategy |
| OCR | Google Cloud Document AI | Structured text + bounding boxes |
| Storage | Cloud Storage (raw docs, JSON extractions, PDFs) | CMEK encryption, Object Versioning |
| Relational Store | Cloud SQL for PostgreSQL | Private IP; IAM auth |
| Config Cache | Memorystore for Redis | Hot-reload dictionaries |
| Observability | Cloud Monitoring, Cloud Logging, Cloud Trace | Centralised metrics & traces |

All containers run on Cloud Run with VPC serverless access; no public IPs.

---

## 3  Document-Processing Pipeline  

```
          ┌───Upload Event (GCS)───┐
          │                        │
Backend API│   1. JOB_PUBLISH     ▼
          │  (Pub/Sub)      ┌────────────┐
          │                 │ Ingestion  │
          │                 └────────────┘
          │                        │
          │                 ┌────────────┐
          │                 │ Pre-proc   │
          │                 └────────────┘
          │                        │
          │                 ┌────────────┐
          │                 │  NER/RE    │
          │                 └────────────┘
          │                        │
          │                 ┌────────────┐
          │                 │ Mapping    │
          │                 └────────────┘
          │                        │
          │                 ┌────────────┐
          │                 │ Scoring    │
          │                 └────────────┘
          │                        │
          └──RESULT_PUT────────────►Cloud SQL
```

### Stage Details  
1. **Ingestion** – Fetch file from Cloud Storage; if PDF, send to Document AI for OCR → plaintext.  
2. **Pre-Processing** – De-ID pass (regex + spaCy `medspacy`), sentence split, UMLS normalisation.  
3. **Entity Extraction** – Dual-engine ensemble (Healthcare NL API + custom spaCy).  
4. **Domain Mapping** – Rule engine assigns entities to CalAIM domains (see §5).  
5. **Confidence Scoring** – Aggregate engine + rule confidences (see §6).  
6. **Persistence** – Store JSON suggestions keyed to patient & referral document in Cloud SQL.  

---

## 4  Entity-Extraction Approaches  

| Engine | Purpose | Strengths | Drawbacks |
|--------|---------|-----------|-----------|
| Healthcare NL API | General clinical entities, ICD-10 links | Managed, high recall, HIPAA-eligible | Usage-based cost |
| spaCy custom model | Fine-tuned on CalAIM corpus (≈ 500 docs) | High precision for psychosocial terms | Requires retraining |

Hybrid merge rules: overlap resolution → highest confidence wins; complementary entities appended.

Key entity types: `Symptom`, `Diagnosis`, `Medication`, `Allergy`, `Trauma_Event`, `Social_Context`, `Strength`, `Risk_Behavior`.

---

## 5  Domain-Mapping Layer  

Implemented with Drools-lite (PyRules). Example:

```
rule "Flag Trauma domain for assault keywords"
when
    e: Entity(type=="Trauma_Event", text ~= /assault|abuse|violence/i)
then
    add_to_domain("Trauma", field="event_description", e)
    boost_confidence(0.1)
end
```

Precedence order if multiple matches: Presenting → Trauma → Risk → Behavioral History → Medical History → Social Circumstances → Strengths.

---

## 6  Confidence Scoring  

```
final_score = 0.4*healthcare_prob + 0.4*spacy_prob + 0.2*rule_score
```

Tiering shown in UI:

| Score | Tier | Badge |
|-------|------|-------|
| ≥ 0.80 | High | Green |
| 0.60–0.79 | Medium | Yellow |
| < 0.60 | Low | Red |

Medium & Low require clinician review before acceptance.

---

## 7  Security & Privacy Controls  

| Control Area | GCP Implementation |
|--------------|--------------------|
| Encryption at rest | Cloud KMS CMEK for Cloud SQL & GCS |
| Encryption in transit | TLS 1.3 everywhere; mTLS between Cloud Run services |
| Network isolation | VPC-SC perimeter; Serverless VPC Access; no public SQL |
| Identity & Access | Firebase Authentication (end-user); IAM Workload Identity for services |
| Audit logging | Cloud Audit Logs exported to BigQuery (immutable) |
| Access Transparency | Enabled for all covered services |
| PHI Redaction in Logs | Log-router sink with Cloud DLP masking |

---

## 8  Performance Targets  

| Metric | Target | Strategy |
|--------|--------|----------|
| Latency p90 | < 10 s / 5-page PDF | Parallel Document AI OCR + async Cloud Run worker |
| Throughput | 50 docs/min (autoscale) | Cloud Run max-instances + Pub/Sub flow control |
| Memory | < 1 GiB per container | Lazy-load models, chunked doc processing |
| Cost | ≤ $0.03 per avg doc | Pre-emptible Cloud Run and budget alerts |

---

## 9  Continuous-Improvement Loop  

1. **Feedback Capture** – UI records clinician actions (`accept`/`edit`/`reject`) with original suggestion.  
2. **Data Lake** – Anonymised corrections written to Cloud Storage “gold” bucket (versioned).  
3. **Retraining** – Monthly Vertex AI Pipeline:  
   * Data prep & auto-label validation  
   * Hyperparameter sweep for spaCy transformer  
   * Model registry & A/B evaluation.  
4. **Deployment** – Vertex AI Model Registry → Cloud Run rollout if ΔF1 ≥ +1 pp (canary 10 %).  

Active learning: uncertain (low-confidence) entities queued for human review to enrich dataset.

---

## 10  Observability & Ops  

| Aspect | Tooling |
|--------|---------|
| Metrics | Cloud Monitoring: custom latency/failure metrics, CPU/Memory |
| Logs | Cloud Logging with structured JSON; Log-based alerts |
| Tracing | Cloud Trace auto-instrumentation (OpenTelemetry) |
| Alerting | PagerDuty via Cloud Monitoring alert policies |
| Deployment | Cloud Build triggers; Cloud Deploy blue/green pipelines |
| IaC | Terraform (google, google-beta providers) manages all resources |

---

## 11  Integration Points  

| From / To | Protocol | Payload |
|-----------|----------|---------|
| Backend API ↔ AI Service | Pub/Sub topic `doc.jobs` | `{docId, gcsUri, patientId}` |
| AI Service → Cloud SQL | SQLAlchemy ORM | `ai_suggestions` rows |
| AI Service → Backend (callback) | REST PATCH `/referral/{id}` | `{status:"COMPLETE"}` |
| Code Set Loader → Cloud SQL | Cloud Scheduler + Cloud Functions | Weekly SNOMED/ICD refresh |
| Monitoring Export → BigQuery | Logging sink | Long-term analytics |

---

## 12  Implementation Considerations  

* Language/Framework: Python 3.12, FastAPI, Uvicorn.  
* Packaging: Poetry; multi-stage Docker images pushed to Artifact Registry.  
* Concurrency: Async endpoints; CPU-bound tasks in ThreadPoolExecutor.  
* Testing: Pytest; spaCy scorer; 85 % coverage goal.  
* Limits: 25 MB file size; 50 page cap (configurable).  
* Fallback: On service error mark job `MANUAL_REVIEW` and notify UI.  

---

## 13  Appendix: Key Algorithms & Models  

| Component | Details |
|-----------|---------|
| spaCy NER | Base **en_core_sci_md** → fine-tuned (`roberta-clinical`) with 12 entity labels. |
| Rule-based Normaliser | Damerau-Levenshtein + Jaro-Winkler for fuzzy SDOH terms. |
| ICD-10 Projection | SNOMED→ICD map table; rule filters (age, sex) via referral metadata. |
| Confidence Calibration | Platt scaling on validation set stored in Redis for fast lookup. |
| De-Identification | Cloud DLP + Presidio hybrid pipeline to mask PII in logs. |

---

*End of AI/NLP Service Design (GCP Edition)*
