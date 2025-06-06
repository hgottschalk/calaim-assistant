# CalAIM Seven Assessment Domains – Data Model Reference  
*For the AI-Powered CalAIM Domain & Care Plan Assistant*

---

## Legend  

| Symbol | Meaning |
|--------|---------|
| 🔑 | Primary/required field |
| 🆔 | Foreign-key reference |
| 🗂️ | Array/collection |
| ⚖️ | Enumerated value |
| 📏 | Constraint / validation rule |

Data types use PostgreSQL + JSONB hybrid:  
`STR` (varchar), `TEXT`, `INT`, `DATE`, `BOOL`, `JSONB`, `ENUM`, `UUID`.

---

## 1. Presenting Problem(s)  

| Field | Type | Constraints / Notes |
|-------|------|---------------------|
| 🔑 `presenting_problem_id` | UUID | PK |
| 🆔 `patient_id` | UUID | FK → `patients` |
| `description` | TEXT | Required, 10–4096 chars |
| `onset_date` | DATE | optional |
| `severity` | ENUM(`mild`,`moderate`,`severe`) | ⚖️ |
| `cultural_context` | TEXT | nullable |
| `impact_on_functioning` | TEXT | nullable |
| `source` | ENUM(`patient`,`family`,`provider`) | default `patient` |
| `created_at` | TIMESTAMP | default now() |

**Relationships**  
• Links to `problems` (0..*) via `presenting_problem_id`.  

**Example**  
```json
{
  "presenting_problem_id": "6dc…",
  "patient_id": "e12…",
  "description": "Persistent sadness and loss of interest for 6 months.",
  "onset_date": "2025-01-10",
  "severity": "moderate",
  "impact_on_functioning": "Missed work 3 days/week"
}
```

**AI Extraction Targets**  
| Target | Technique | Confidence Boosters |
|--------|-----------|---------------------|
| Symptom phrases | NER: `Symptom` | +0.1 if duration expression present |
| Onset date | Regex/temporal parse | +0.15 if explicit date |
| Severity | Keyword map (`mild`, `severe`) | — |

---

## 2. Trauma  

| Field | Type | Constraints |
|-------|------|------------|
| 🔑 `trauma_id` | UUID |
| 🆔 `patient_id` | UUID |
| `event_description` | TEXT | Required |
| `event_date` | DATE | nullable |
| `reaction` | TEXT | nullable |
| `screening_tool` | STR | e.g., `PCL-5` |
| `score` | INT | 0-100 |
| `systems_involved` | 🗂️ JSONB | array of strings |
| `created_at` | TIMESTAMP |

**Relationships**  
• May generate `problems` with SNOMED PTSD codes.  

**Example**  
```json
{
  "event_description": "Motor vehicle accident",
  "reaction": "Nightmares, hypervigilance",
  "screening_tool": "PCL-5",
  "score": 38
}
```

**AI Extraction Targets**  

| Target | Method | Confidence |
|--------|--------|-----------|
| Trauma keyword + pattern (`accident`, `abuse`) | Rule | 0.75 base |
| PTSD screening results | Regex table | +0.2 |

---

## 3. Behavioral Health History  

| Field | Type | Constraint |
|-------|------|-----------|
| 🔑 `bh_history_id` | UUID |
| 🆔 `patient_id` | UUID |
| `prior_diagnoses` | 🗂️ JSONB | ICD-10 list |
| `treatment_history` | TEXT | — |
| `hospitalizations` | INT | ≥0 |
| `substance_use_history` | TEXT | — |
| `family_history` | TEXT | — |
| `created_at` | TIMESTAMP |

**Relationships**  
• Enriches differential Dx mapping.  

**Example**  
```json
{
  "prior_diagnoses": ["F33.1"],
  "hospitalizations": 2,
  "substance_use_history": "Cannabis daily use in college"
}
```

**AI Targets**  
| Entity | Source | Notes |
|--------|--------|-------|
| Historic Dx codes | Comprehend Medical ICD link | high (≥0.85) |
| Substance terms | spaCy matcher | medium |

---

## 4. Medical History & Medications  

| Field | Type | Constraint |
|-------|------|-----------|
| 🔑 `medical_history_id` | UUID |
| 🆔 `patient_id` | UUID |
| `conditions` | 🗂️ JSONB | SNOMED codes + plain text |
| `allergies` | 🗂️ JSONB | structured list |
| `current_medications` | 🗂️ JSONB | RxNorm where possible |
| `surgical_history` | TEXT | — |
| `lts_conditions` | BOOL | chronic |
| `created_at` | TIMESTAMP |

**Relationships**  
• Medication list cross-checks care plan contraindications.  

**Example**  
```json
{
  "conditions": [
    {"code":"44054006","display":"Diabetes mellitus"}
  ],
  "allergies":[{"substance":"Penicillin","reaction":"Rash"}],
  "current_medications":[{"name":"Sertraline","dose":"50 mg qd"}]
}
```

**AI Targets**  
| Target | Confidence Logic |
|--------|------------------|
| Med names (RxNorm) | +0.2 if dosage present |
| Allergies | PHI filter then allergen dictionary |

---

## 5. Social & Life Circumstances  

| Field | Type | Constraints |
|-------|------|------------|
| 🔑 `social_id` | UUID |
| 🆔 `patient_id` | UUID |
| `economic_stability` | ENUM(`stable`,`unstable`) |
| `housing_status` | ENUM(`housed`,`homeless`,`at_risk`) |
| `employment_status` | STR | — |
| `education_level` | STR | — |
| `sdoh_notes` | TEXT | — |
| `created_at` | TIMESTAMP |

**Relationships**  
• Drives Community Supports referrals.  

**Example**  
```json
{
  "housing_status":"homeless",
  "employment_status":"unemployed",
  "sdoh_notes":"Staying at shelter, lacks transportation"
}
```

**AI Targets**  
| Indicator | Extraction | Notes |
|-----------|------------|-------|
| Homelessness keywords | Pattern list | high precision |
| Unemployment | proximity of “unemployed” + pronoun | medium |

---

## 6. Strengths  

| Field | Type | Constraint |
|-------|------|-----------|
| 🔑 `strength_id` | UUID |
| 🆔 `patient_id` | UUID |
| `personal_strengths` | 🗂️ JSONB | list |
| `support_system` | TEXT | — |
| `protective_factors` | TEXT | — |
| `created_at` | TIMESTAMP |

**Relationships**  
• Informs goal setting in care plan.  

**Example**  
```json
{
  "personal_strengths":["Strong family support","Motivated for recovery"]
}
```

**AI Targets**  
Free text positives (`resilient`, `supportive family`) flagged; default low confidence (≤0.6) → clinician verify.

---

## 7. Risk Behaviors & Safety Factors  

| Field | Type | Constraint |
|-------|------|-----------|
| 🔑 `risk_id` | UUID |
| 🆔 `patient_id` | UUID |
| `suicidal_ideation` | BOOL | 📏 if true then `last_assessment_date` required |
| `homicidal_ideation` | BOOL | — |
| `self_harm_history` | TEXT | — |
| `violence_history` | TEXT | — |
| `access_to_weapons` | BOOL | — |
| `safety_plan` | TEXT | nullable |
| `created_at` | TIMESTAMP |

**Relationships**  
• Triggers alerts in Care Plan; audit trail.  

**Example**  
```json
{
  "suicidal_ideation": true,
  "safety_plan": "24/7 crisis line, remove firearms from home"
}
```

**AI Targets & Scoring**  

| Phrase Pattern | Base Confidence |
|----------------|-----------------|
| “wants to die”, “suicidal thoughts” | 0.9 |
| “no SI/HI” negation | flips to 0 |
| Weapon access keywords | 0.7 |

Negation handling via spaCy `negex`; output includes `is_negated`.

---

## Cross-Domain Relationships Diagram (simplified)

`patients 1─* presenting_problems`  
`patients 1─* trauma`  
`patients 1─* bh_history`  
`patients 1─* medical_history`  
`patients 1─* social`  
`patients 1─* strengths`  
`patients 1─* risk`  
`problems` reference any domain entry via polymorphic `source_id`.

---

## AI Confidence Tier Definition  

| Tier | Score Range | UI Badge |
|------|-------------|----------|
| High | ≥0.80 | green |
| Medium | 0.60-0.79 | yellow |
| Low | <0.60 | red |

Clinician must review **Medium** & **Low** before finalizing assessments.

---

*End of Document*
