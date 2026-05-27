# Management Cases — 5-Patient Build Plan

Source: `Management Cases 1-5.docx` (5 morning-report-style cases with original
discussant lists from the Stanford/Harvard/Penn cohort).

Each case becomes one new PAT00X with the same structure as PAT002 (Maria):
- Full chart (demographics, problems, meds, allergies, notes, labs, imaging,
  encounters, vitals, social/family hx, immunizations)
- 1–3 assessment timepoints (`AP1`, `AP2`, `AP3`) with date-anchored chart gates
- Default chart gate at the first AP anchor (so first-open shows TP1 view)
- Take-Assessment CTA on chart-review
- AI panel and Sim controls hidden when this patient is loaded
- Smart sidebar "Assessment" link

---

## Case mapping

### Case 1 → PAT003 — "The lung nodule that almost left"
**Patient identity (proposed):** Lan Nguyen, 72F, Vietnamese-speaking, immigrated
from rural Vietnam decades ago, widowed, lives with son and daughter-in-law,
worked managing in a textile factory.

**Teaching theme:** Incidental findings during complex hospitalizations + the
"out of sight, out of mind" problem + social-determinant factors in
keep-vs-discharge decisions.

**Timepoint structure (1 TP, 5 questions, ~25–30 min):**
- **TP1 — Day 57 of admission, discharge day.** Chart shows the entire
  pancreatitis → ICU → ARDS → DVT → 2.5 cm lung nodule → recovery arc.
  Resident is asked to handle the nodule that "long ago dropped off her
  progress notes."

**Source questions (verbatim → rubric basis):**
1. Differential for incidental lung nodule (6 pts).
2. Additional non-invasive info to hone differential (9 pts).
3. Factors influencing keep-in-hospital vs outpatient workup (11 pts).
4. If outpatient, what's your process? (7 pts).
5. If inpatient, at what point do you discharge? (3 pts).

**Total source rubric: 36 pts.**

**Scattering plan (where the resident has to assemble the picture):**
- HPI of the acute presentation → admission H&P note
- PMH (HLD, HTN, CKD II, cholelithiasis, positive PPD, R knee replacement) →
  partly in problems list, partly in prior PCP notes from her FQHC (Vietnamese-
  language clinic), partly in old orthopedic note for the knee, partly in old
  infectious disease note for the PPD workup
- Smoking history (former) + alcohol (1–2/d) → social history but ALSO in
  multiple historical PCP notes that vary slightly in detail
- Lung nodule discovery → buried in CXR report ordered during sepsis workup +
  follow-up CT report; not mentioned in the daily progress notes after HD 5
- Discharge meds list scattered: stat the active meds + discharge summary +
  pharmacy note about transitions
- The "lung nodule dropped off" angle is the test — discharge note must
  re-surface it after the resident finds it in older imaging reports

---

### Case 2 → PAT004 — "The PE and the liver mass"
**Patient identity (proposed):** Marcus Bell, 43M, recent-onset PE/DVT, found
to have a large liver mass concerning for malignancy. Working in construction,
married with two kids, otherwise healthy.

**Teaching theme:** Competing-risk anticoagulation decisions; procedural
planning around DOACs; IVC filter decisions after PE recurrence.

**Timepoint structure (2 TPs, 6 questions, ~25–30 min):**
- **TP1 — Initial admission, hospital day ~5.** PE + DVT diagnosed + liver MRI
  with 17 cm mass + portal vein thrombus + radiologist recommends biopsy.
  - Q1a/b: How long would you anticoagulate before biopsy + rationale.
  - Q2: General factors for biopsy timing in this scenario.
  - Q3a/b: DOAC hold duration before procedure + rationale.
  - Q4: Bridging anticoagulation factors.
- **TP2 — Readmission ~1 month later** with progressed PE bilaterally,
  troponin elevation, RV strain, after apixaban held 3 days for the biopsy.
  - Q5: IVC filter for this patient — yes or no + why.
  - Q6: General pros/cons of IVC filter.

**Scattering plan:**
- ED note from initial presentation + CTPA report (separate)
- Liver MRI report (separate from initial CT)
- TTE result note (separate)
- Outpatient hematology consult note (TP1 → TP2 transition)
- IR biopsy planning note (the source of "hold apixaban for 3 days")
- Re-presentation ED note + new CTA + new TTE + new doppler

---

### Case 3 → PAT005 — "The FFP that drowned her"
**Patient identity (proposed):** Sarah Whitlock, 50F, alcoholic cirrhosis with
hepatic encephalopathy, ascites, and hepatic hydrothorax. Lives in a rural
Maryland county 90 minutes from the academic medical center. Single, gets
rides from her sister to appointments.

**Teaching theme:** Iatrogenic harm from prophylactic blood products;
cross-system communication when a community provider's protocol diverges
from evidence; PleurX vs TIPS decision-making.

**Timepoint structure (3 TPs, 5 questions, ~25–30 min):**
- **TP1 — ED presentation.** Hepatologist-referred for thora + para of
  refractory ascites/hydrothorax that's failing diuretics. Coagulopathic
  (INR 2.0, Plt 55K).
  - Q1: Would you perform a paracentesis and a thoracentesis? Why or why not?
  - Q2: Would you give blood products before or after? Why or why not?
- **TP2 — Several weeks after initial procedures.** She's been getting
  weekly outpatient thora/para with prophylactic 4 units FFP + albumin in
  her rural setting; develops flash pulmonary edema, intubated, ICU.
  - Q3: How would you approach the call to her radiologist about FFP?
  - Q4: PleurX vs TIPS — risks and benefits of each.
- **TP3 — Months later, post-transplant.** Her paracentesis needs dropped.
  - Q5: What are possible reasons for the adjustment in her needs?

**Scattering plan:**
- Hepatology continuity notes documenting the dose escalations of diuretics
  + the resulting electrolyte/kidney injury
- Outpatient radiology procedure notes (multiple weekly entries from her
  community radiologist — each documenting FFP transfusion)
- ICU admission H&P for the flash pulmonary edema episode
- IR consult notes (PleurX vs TIPS discussion)
- Transplant evaluation notes (in the months between)
- Post-transplant clinic note (TP3)

---

### Case 4 → PAT006 — "The post-op a-fib"
**Patient identity (proposed):** Dorothy Pierce, 72F with GERD, T2DM, poorly
controlled hypertension. Recently widowed; daughter visits weekly. Lives
alone in a small house in the suburbs. Drives herself everywhere.

**Teaching theme:** Subclinical / post-op AFib management; CHA2DS2-VASc
weighting in borderline cases; ambulatory monitoring strategy.

**Timepoint structure (2 TPs, 4 questions, ~20 min):**
- **TP1 — POD #1 after open cholecystectomy.** Brief AFib episodes
  (3 × 15–20 sec) on telemetry. Otherwise clinically improving.
  - Q1: Additional monitoring/testing/treatment beyond telemetry?
- **TP2 — POD #4, anticipated discharge day.** 2-hour asymptomatic AFib
  episode confirmed on ECG, rate 70–105, spontaneously converted.
  - Q2a/b: Therapeutic anticoagulation? Factors influencing?
  - Q3: Best choice for anticoagulation if started?
  - Q4a–d: Ambulatory ECG monitor decision + type + factors + plan for data.

**Scattering plan:**
- PCP notes documenting the poorly-controlled hypertension and T2DM trajectory
- Pre-op cardiology clearance note (rules out structural heart disease)
- Pre-op ECG report (NSR baseline)
- Post-op ECG report (NSR currently)
- Telemetry strips referenced in nursing notes — actual episodes documented
  in event notes that the resident has to find vs the daily progress notes
  which only summarize broadly
- Medication reconciliation note (no anticoagulation, no antiplatelet)

---

### Case 5 → PAT007 — "The drug fever that almost killed her"
**Patient identity (proposed):** Janet Brooks, 55F with alcoholic cirrhosis,
~20 lb unintentional weight loss over 3 months. Estranged from kids until
this hospitalization; sister becomes the medical decision-maker. Strong
case for cognitive humility — the team almost anchored their way to CMO.

**Teaching theme:** Drug fever / drug-associated neurotoxicity; anchoring
bias; end-of-life conversations and how to "unwind" them when new information
emerges.

**Timepoint structure (3 TPs, 5 questions, ~25 min):**
- **TP1 — ED admission.** Weight loss, new ascites + pleural effusions, mild
  cytopenia, MELD elevated, paracentesis negative for SBP.
  - Q1: How would you evaluate for involuntary weight loss?
- **TP2 — Hospital day ~5, post-TIPS.** Variceal bleed → emergent TIPS,
  then persistent high fevers + somnolence + pressors. On vanco/meropenem.
  All cultures negative, CSF normal, no abscess on imaging.
  - Q2: Approach to evaluating her fevers?
  - Q3: What do you do with her antibiotics and why?
- **TP3 — Hospital day ~18.** Two weeks in ICU, family raising CMO question.
  - Q4: Factors that go into your CMO decision in this patient?
- **TP4 (optional — could be part of TP3) — After CMO, antibiotics stopped,
  patient improves dramatically.**
  - Q5: How do you explain this to the family?

**Scattering plan:**
- Outpatient hepatology notes documenting the diuretic challenges + weight
  trajectory leading into admission
- ED H&P
- ICU admission note + emergent TIPS procedure note
- Daily ICU progress notes that show the fever trajectory + antibiotic changes
  + lack of source despite extensive workup
- Lumbar puncture report, CT C/A/P report, repeat paracentesis report — each
  separately
- Family meeting note (TP3)
- The "miraculous" recovery: nursing notes + daily progress notes that the
  team initially attributes to the CMO decision, then realizes it was the
  antibiotic cessation

---

## Per-patient build checklist

For each PAT00X, the build produces these files (matching PAT002's structure):

```
data/patients/PAT00X/
├── demographics.json
├── allergies.json
├── encounters/
│   └── index.json
├── notes/
│   ├── index.json
│   └── NOTE001.json, NOTE002.json, ... (10–25 per patient)
├── labs/
│   ├── index.json
│   └── panels/
│       └── LAB001.json, ... (8–15 per patient)
├── imaging/
│   ├── index.json
│   └── IMG001.json, ... (3–8 per patient)
├── medications/
│   ├── active.json
│   └── historical.json
├── problems/
│   ├── active.json
│   └── resolved.json
├── vitals/
│   └── index.json
├── social-history.json
├── family-history.json
├── immunizations.json
└── procedures.json

data/assessments/PAT00X/
├── index.json          (case meta + AP list)
├── ap1.json            (rubric + question)
└── (ap2.json, ap3.json as needed)
```

Plus app-level changes per patient:
- `js/app.js`: add anchor to `_DEFAULT_GATE_ANCHORS`
- `css/epic-theme.css`: add `body.patient-pat00X` hide rule for AI panel + Sim
- `data/patients/index.json`: register the patient

---

## Recommended build order

| # | Patient | Why this order |
|---|---|---|
| 1 | **PAT003 / Case 1** | Most fleshed out in the source. Single timepoint, 5 questions. Good template for the others. |
| 2 | PAT006 / Case 4 | Tightest case (4 Q's). Quick second build to validate the framework. |
| 3 | PAT004 / Case 2 | 2 timepoints with a clean temporal break. |
| 4 | PAT007 / Case 5 | 3+ timepoints; tests how we handle the "drug fever anchoring" reveal. |
| 5 | PAT005 / Case 3 | 3 timepoints spanning months; most complex temporally. |

Total effort estimate: **~3–5 hours per patient** for a robust chart with
realistic scattering. Five patients ≈ 15–25 hours of careful work — best done
across several sessions with review checkpoints between cases.

---

## Open questions for the user

1. **Patient names.** I proposed culturally-plausible names that match the
   case demographics. Want to change any of them?
2. **Timepoint counts.** I split Case 1 into 1 TP and Case 5 into 3 TPs.
   OK to vary? Or prefer a uniform structure (e.g., always 2–3 TPs)?
3. **Build cadence.** I recommend doing one patient end-to-end, getting your
   review, then proceeding. Alternative: build all 5 skeletons first, then
   flesh out together. Which do you prefer?
4. **Rubric fidelity.** The source has explicit point values. Should we
   preserve those point allocations exactly, or rebalance for our weight
   system (e.g., AP weight 1.0–2.0 per question)?
5. **Scattering aggressiveness.** Maria's chart has ~20 notes. For these
   cases, do you want a similar depth, or lighter (fewer notes, faster
   builds)?
