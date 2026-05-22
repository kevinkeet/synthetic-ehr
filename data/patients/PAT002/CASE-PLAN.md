# PAT002 — Maria Sandoval Case Plan

**Status:** Phase 1 complete (chart skeleton + patient switcher). Phase 2 (chart content) and Phase 3 (assessment framework) to be built over future sessions.

**Source:** "Peeling and Plummeting" — NEJM Clinical Problem-Solving, *N Engl J Med* 2024;390:935-942.

**Final diagnosis (held back from the resident until Assessment 4):**
- Active SLE with inflammatory myositis causing oropharyngeal dysphagia
- Superimposed kwashiorkor (severe protein-calorie malnutrition) driven by dysphagia
- Class V (membranous) lupus nephritis on renal biopsy

**Causal chain:** SLE → myositis → dysphagia → starvation → kwashiorkor → ichthyotic rash + hepatic steatosis + hypoalbuminemia.

---

## What this case is designed to assess

This is not a "did the resident get the diagnosis?" test. It's a test of **how a doctor uses AI under realistic clinical pressure**. The chart is built so that:

1. **Context overwhelm is real.** 2+ years of notes, lab trends, sparse legacy data. The resident must select *which slices* of chart to feed the AI rather than dumping everything.
2. **Framing matters.** A bad framing ("DDx for polyarthritis") gets the AI to anchor on SLE early and confidently. A good framing ("this woman lost insurance, ran out of meds, and is now wasting — what does her current presentation reveal that simple SLE doesn't explain?") gets a different and more useful answer.
3. **AI confidence is misleading.** The AI will produce plausible-sounding SLE narratives that account for ~70% of findings but leave the albumin 0.7, AST 650, and ichthyotic rash unexplained. A well-trained doctor notices the gaps; a poorly-trained one accepts the answer.
4. **Hallucination is a real risk.** "Lupus dermatitis" is a confident-sounding wrong answer for the rash. "Lupus hepatitis" sounds reasonable but is uncommon at this severity. The resident must verify against actual findings (e.g., liver biopsy result).
5. **Social determinants are easy to miss.** The AI may underweight the insurance lapse, the language barrier, and the unverified specialist referral — all of which are central to *why* this patient deteriorated.

---

## Chart Timeline (Phase 2 content to be built)

### Era 1 — Pre-immigration (2003-2017, Guatemala)
*No formal records. Family-reported only. Build as a single "Outside Records Summary" note.*

- Childhood: well, breastfed; rural Huehuetenango department
- 2014 (age 11): father killed in MVA; possible adjustment reaction, no documented care
- Pre-immigration: routine childhood illnesses per family; immunization status unverified
- No documented chronic illness

### Era 2 — Immigration & Establishment (2017-2020)
*Sparse but real records from Johns Hopkins Community Health (FQHC).*

- **2017-12** — Initial entry to US (age 14). No medical visits.
- **2018-08** — Entry health screening at JH Community Health (age 15)
  - Visit note: history, exam, immunization catch-up, TB screening
  - Labs: CBC, CMP, HIV, hepatitis B/C, QuantiFERON-TB (negative), TSH
  - Found: iron deficiency anemia (Hgb 10.4, ferritin 8)
  - CXR (IMG001 — already created)
  - Immunizations: Tdap, HPV #1
- **2018-10** — Follow-up visit
  - Tolerating ferrous sulfate
  - HPV #2
- **2019-04** — Anemia resolution visit
  - Hgb 12.8, ferritin 42 → iron stopped
  - HPV #3, series complete
- **2019-10** — Annual flu shot
- **2019-12** — Brief visit for URI (resolved without intervention)

### Era 3 — COVID gap (2020-2022)
*Insurance lost. No formal records. Build as a single social-work-style note acknowledging the gap.*

- **2020-06** — Medicaid coverage lost during pandemic redetermination
- **2021-09** — Mass-vaccination site for COVID series (already in immunizations.json)
- 2020-2022: no medical encounters

### Era 4 — Subtle prodrome (2025, summer)
*No documented care, but inferred history per intake at urgent care.*

- **2025-08** — patient retrospectively dates joint symptom onset here
- Symptoms attributed to housekeeping work, undocumented at the time
- No notes in this period (which is itself diagnostically relevant)

### Era 5 — Assessment Point 1: Urgent care visit (Jan 2026)
*The starting point of the simulation.*

- **2026-01-12** — Dr. Reyes urgent care visit (NOTE001 — already created)
- Labs from this date: CBC, BMP, UA, TSH, ANA, RF (all created)
- Pending labs ordered: dsDNA, anti-Sm, anti-Ro/La, complements, anti-CCP, viral panel, UA with microscopy, parvovirus
- Started HCQ + levothyroxine
- Referrals placed

### Era 6 — Between-visit interval (Jan-Oct 2026)
*This is the failure-of-care interval. Lots of small fragments that signal a worsening trajectory.*

- **2026-01-19** — Lab results return (call-back note documenting attempt to reach patient with results)
- **2026-01-23** — Hopkins rheumatology no-show note (intake never completed; financial aid app stalled)
- **2026-02-05** — Patient calls urgent care with concerns about hair loss, told to follow up with rheum
- **2026-03-30** — Pharmacy refill record: HCQ refill picked up
- **2026-05-15** — Pharmacy refill record: HCQ refill NOT picked up (last dose was end of April)
- **2026-06-22** — Pharmacy refill record: Levothyroxine refill picked up
- **2026-08-05** — Brief 15-minute telephone outreach by community health worker noting patient is "doing worse, lost weight, still cannot afford specialist"
- **2026-09-10** — Walk-in to FQHC nurse triage: declined visit due to cost; given Spanish-language resource list

### Era 7 — Assessment Point 2: ED bounce (Nov 2026)
*Maria returns to the ED briefly — and is sent home with a missed opportunity.*

- **2026-11-04** — ED visit
  - CC: "weakness, can't work, weight loss"
  - Vitals: T 37.6, HR 110, BP 105/68, weight 44 kg (down from 50.8)
  - Brief workup: CBC (mild anemia), BMP (unremarkable), normal CXR
  - ED disposition: discharged with "needs PCP follow-up", given list of clinics, no specialty consult, no inpatient evaluation
  - The note should reflect ED time pressure: many findings unexplored
  - **Assessment 2 trigger**: the resident should notice the ED missed the weight loss pattern (50.8→44 kg in 10 months), the dropped HCQ adherence, the unverified rheum follow-up, and the rising fatigue/weakness

### Era 8 — Assessment Point 3: Catastrophic presentation (Mar 2027)
*The data dump — multi-system disaster.*

- **2027-03-15** — Brought to ED by mother; profoundly weak, can ambulate only 8 feet
  - Vitals: T 38.4, HR 120, BP 110/70, weight 36 kg, BMI 16.0
  - Striking findings on exam:
    - Diffuse ichthyotic rash (hands, feet, face — clinical photos)
    - Diffuse alopecia worsened
    - Painless proximal muscle weakness (2/5 neck flexors, hip flexors; 4/5 distal)
    - Hepatomegaly 20 cm
    - Joint swelling persistent
  - Initial labs: WBC 6.23 (mild eosinophilia 4%), Hgb 9, ferritin 767, ESR 88, CRP 0.4
  - Striking labs: AST 650, ALT 426, ALP 443, albumin 0.7, total protein 5.2, urinalysis with 2+ protein
  - Cultures pending; broad-spectrum abx started empirically
  - Cardiology, pulm, abdomen on exam unremarkable
  - **Assessment 3 trigger**: the resident should formulate a broader differential than SLE alone, recognize that several findings (low albumin, transaminitis, ichthyosis) need a unifying explanation, and order targeted workup

### Era 9 — Workup expansion (Mar 2027, days 2-7)
- **Day 2** — Infectious workup negative: hep A/B/C, HIV, CMV, EBV
- **Day 3** — More serologies back: dsDNA 1:160, anti-Sm 21, low C3 (71), low C4 (18), Coombs positive (no hemolysis), proteinuria 2+ → urine protein:creatinine 2.27
- **Day 3** — CT abdomen/pelvis: hepatomegaly 25 cm, diffuse hepatic steatosis, no lymphadenopathy or splenomegaly, edema in abdominal wall and paraspinal tissue
- **Day 4** — Aldolase 16.4 (elevated despite normal CK 58), urinary protein/Cr 2.27; tTG IgA/IgG negative; stool fat normal
- **Day 5** — Patient reports 4 months of dysphagia on further questioning (initially missed in admission H&P)
- **Day 5** — Videofluoroscopic swallow: impaired pharyngeal constriction, absent epiglottic inversion, retention, laryngeal penetration
- **Day 6** — MRI thighs: proximal muscle + fascial edema bilaterally
- **Day 6** — EMG: fibrillations + positive sharp waves → inflammatory myopathy
- **Day 7** — Kidney biopsy: Class V (membranous) lupus nephritis
- **Day 7** — Skin biopsy: vacuolar interface dermatitis with IgM/C3 band → lupus-compatible. **However, the ichthyosis and hyperkeratosis distribution is not classic lupus.**
- **Day 7** — Liver biopsy: severe large-droplet macrovesicular steatosis with bands of fibrosis, focal nodule formation; no iron deposition, no PAS-positive globules, no amyloid → **pattern consistent with kwashiorkor**, not autoimmune hepatitis or NAFLD
- **Day 7** — Vitamin A 17 (low), 25-OH vit D 10 (low), zinc 16 (low); B12, C, E, K, selenium normal

### Era 10 — Assessment Point 4: Diagnostic synthesis (Mar 2027, day 8-10)
- **Day 8** — Multidisciplinary team meeting note: rheum + GI + nutrition + speech + derm
  - The note should be deliberately written so the dual diagnosis isn't spelled out — leave it for the resident to recognize
  - Discussion should include: why SLE alone doesn't explain albumin 0.7 and AST 650; why the ichthyosis is unusual; what the liver biopsy is telling us
- **Day 9** — Final diagnostic synthesis note (after multidisciplinary discussion): SLE with myositis + secondary kwashiorkor from myositis-induced dysphagia
- **Day 10** — Treatment plan note begins

### Era 11 — Assessment Point 5: Management (Mar-May 2027)
- **Day 10** — Initiation:
  - Methylprednisolone 1 g IV daily x 3 days, then taper
  - Mycophenolate mofetil 1000 mg BID
  - IVIG (refused initially by patient — Spanish-language consent conversation note)
  - Vitamin repletion: A, D, zinc
  - Speech/swallow therapy: pureed diet, advancement plan
  - PT/OT
  - **Refeeding syndrome monitoring**: daily electrolytes (K, Phos, Mg)
  - HCQ continued
- **Day 12** — Refeeding syndrome alert note: phos drops to 1.8, IVF/electrolyte adjustments
- **Day 18** — Patient able to swallow puree, transitions to nasogastric supplementation removed
- **Day 25** — Discharged with home rehabilitation plan, methylprednisolone taper, MMF, HCQ, levothyroxine, ergocalciferol, multivitamin
  - Social work note: insurance reinstatement application initiated successfully during admission
- **2027-09** — 6-month follow-up: regained 16 kg, albumin 3.8, LFTs normal, proteinuria resolved, dysphagia improved, ichthyosis resolved (clinical photos)
- **2028-03** — 1-year follow-up: full ADL independence, working again, stable on MMF + HCQ + low-dose pred

---

## Files to Build in Phase 2 (estimates)

### Notes (~25 needed)
Spread across timeline. Each note is a `NOTE0XX.json` with `content` field of realistic clinical writing (300-2000 words). Examples:
- `NOTE002` — 2018-08 immigration entry visit (Jennifer Walsh, NP)
- `NOTE003` — 2018-08 well-child / catch-up vaccinations
- `NOTE004` — 2018-10 ferrous sulfate follow-up
- `NOTE005` — 2019-04 anemia resolution
- `NOTE006` — 2019-12 URI visit
- `NOTE007` — 2026-01 lab callback for ANA results
- `NOTE008` — 2026-02 phone call about hair loss
- `NOTE009` — 2026-08 community health worker outreach
- `NOTE010` — 2026-11 ED visit (Assessment 2)
- `NOTE011-022` — Hospital admission (Mar 2027): admission H&P, daily progress notes, consult notes from rheum / GI / derm / nutrition / speech / PT-OT, pathology reports, diagnostic synthesis note
- `NOTE023` — Discharge summary
- `NOTE024` — 6-month follow-up
- `NOTE025` — 1-year follow-up

### Labs (~50-80 panels needed)
Lab trends matter for the assessment. Spread across:
- 2018 immigration screening panel (CBC, CMP, HIV, hep B/C, TSH)
- 2019 anemia recovery labs
- Jan 2026 urgent care (6 done) + send-out follow-ups (~6 more)
- Nov 2026 ED bounce labs (~4-5)
- Mar 2027 admission day 1-7 (very dense — ~30+ panels documenting transaminitis, hypoalbuminemia, electrolytes, vitamin levels, refeeding monitoring)
- 6-month follow-up labs (~5)
- 1-year follow-up labs (~4)

### Imaging
- IMG001 already done (CXR 2018)
- IMG002 — CXR Nov 2026 ED
- IMG003 — CXR admission Mar 2027
- IMG004 — CT abdomen/pelvis with contrast Mar 2027
- IMG005 — MRI thighs Mar 2027
- IMG006 — Videofluoroscopic swallow study Mar 2027

### Procedures
- PROC001 — Renal biopsy
- PROC002 — Liver biopsy (needle core)
- PROC003 — Skin biopsy (punch)
- PROC004 — EMG / nerve conduction
- PROC005 — Bedside swallow eval by SLP

### Encounters
All visits above need an encounter record.

### Vitals
Vitals at every encounter; key weight trajectory: 50.8 kg (Jan 2026) → 44 kg (Nov 2026) → 36 kg (Mar 2027) → 52 kg (9-month follow-up).

### Problems list
Active problems list evolves at each assessment point. Need a way to snapshot the active/resolved problems for each assessment.

---

## Phase 3 — Assessment Framework

Designed but not yet built. Architecture sketch:

### Data model
```
data/assessments/PAT002/
  index.json          — assessment definitions
  ap1.json            — Assessment Point 1
  ap2.json            — Assessment Point 2
  ap3.json            — Assessment Point 3
  ap4.json            — Assessment Point 4
  ap5.json            — Assessment Point 5
```

Each `apN.json`:
```json
{
  "id": "AP1",
  "title": "Initial urgent care presentation",
  "anchorDate": "2026-01-12",
  "chartState": {
    "includeNoteIdsUpTo": ["NOTE001"],
    "includeLabIdsUpTo": ["LAB001", ..., "LAB006"],
    "includeImagingIdsUpTo": ["IMG001"],
    "includeProblemsActive": ["PRB001", "PRB002", "PRB003", "PRB004"],
    "_notes": "When AP1 is active, only chart items up to this point are visible to the resident and AI."
  },
  "prompts": [
    {
      "id": "AP1-Q1",
      "type": "differential",
      "question": "What is your differential diagnosis for this patient and what would you ask the AI to help with?",
      "rubric": {
        "essential": [
          "SLE",
          "Other CTD (UCTD, mixed, MCTD)",
          "Viral arthropathy (parvovirus, hep B/C, HIV)",
          "RA (despite negative RF)",
          "Reactive arthritis"
        ],
        "bonus": [
          "Autoimmune thyroiditis (Hashimoto's)",
          "Disseminated TB (given family hx and Guatemala origin)",
          "Lyme (less likely epidemiologically)",
          "Behcet's, Sjogren's"
        ],
        "redFlags": [
          "Anchoring confidently on SLE based on 1:80 ANA alone",
          "Missing the empiric HCQ before specialist eval as a problem"
        ]
      }
    },
    {
      "id": "AP1-Q2",
      "type": "context-curation",
      "question": "What specific pieces of this chart would you give the AI to help it generate the best differential? Why?",
      "rubric": {
        "essential": [
          "The HPI (timeline, distribution, morning stiffness)",
          "Family history (maternal aunt SLE)",
          "Social history (immigration, country of origin)"
        ],
        "bonus": [
          "ANA + RF results explicitly with reference ranges",
          "Note ANA titer is LOW (1:80) and not specific",
          "Recognize that the medication list (OTC ibuprofen, multivitamin) doesn't bias the AI toward a specific diagnosis"
        ]
      }
    },
    {
      "id": "AP1-Q3",
      "type": "ai-output-evaluation",
      "question": "Below is an AI response to your DDx question. Evaluate it: what's good, what's missing, what (if anything) is wrong?",
      "aiSampleOutput": "...a deliberately mediocre AI response that anchors on SLE...",
      "rubric": {
        "shouldIdentify": [
          "Missing parvovirus / viral arthropathy",
          "Over-weighting the ANA 1:80 without acknowledging its low specificity",
          "Not addressing the thyroid finding"
        ]
      }
    }
  ],
  "passingScore": 0.7
}
```

### UI

A "Test Mode" toggle in the AI panel header. When active:
1. The chart is filtered to only show data up to the current assessment point's anchor date
2. A persistent panel shows the current assessment's prompts
3. Each prompt is answered free-text or by selecting choices
4. AI usage is logged (all prompts the resident types, all queries to the AI, all chart sections they viewed)
5. At the end of all 5 assessments, a scoring report is generated

### Scoring rubrics
Each assessment has 3-5 prompts. Each prompt is scored 0-2 against the rubric. Reports show:
- Per-prompt feedback (without giving the diagnosis away mid-assessment)
- Per-assessment composite
- Final report with strengths, missed elements, and AI-usage analysis (e.g., "you asked the AI 'what's the diagnosis' 4 times — try framing as 'what unifies these findings?'")

### What's NOT in scope
- Educational explainers shown to the resident (per the user's instruction)
- Hints (this is assessment-only)
- The resident never sees the diagnosis or rubric during the test
- The diagnosis is only revealed in the final scoring report

---

## Phase 3 design decisions (locked in)

1. **Admin / proctor view: YES.** A separate dashboard route (`#/admin/...`) shows all attempts, scores, AI usage patterns, and lets a training director drill into individual responses. Requires an `admin_roles` table + Supabase Row Level Security.

2. **Testing login: REQUIRED.** Each resident logs in via the existing Supabase Auth before starting an assessment. Attempts are owned by `user_id`. Persistent across sessions — a resident can pause partway through and resume. `test_attempts.status` tracks `in_progress / completed / abandoned`.

3. **AI sample outputs: LIVE.** For the "evaluate this AI response" prompts, we call Claude at test time with a deliberately mediocre / anchoring prompt so the resident sees a realistic flawed AI response. This is more realistic than pre-curated outputs and exposes residents to the variability they'll see in practice. (Trade-off: scoring needs to be flexible enough to handle different exact AI outputs — the rubric must judge the *resident's critique*, not check for a specific keyword.)

4. **Chart access: FULL.** Resident has unrestricted chart navigation at all times. They can flip back to earlier notes during a later assessment. The "time gating" lives in the patient timeline itself — chart content that doesn't exist yet at the assessment's anchor date simply isn't in the chart yet. This means we build the chart such that Assessment 1's chart state is `≤ 2026-01-12`, Assessment 2's is `≤ 2026-11-04`, etc. The framework reveals each era as the resident advances to the next assessment, but everything already revealed stays visible.

5. **Time limits per assessment: YES.** Each assessment has a `timeLimitMinutes` field (e.g., AP1=15, AP2=10, AP3=25, AP4=15, AP5=20 — to be tuned). Timer is visible. Submission auto-locks when time expires. Pausing is allowed but stops the timer (this is a *test*, not a take-home).

These decisions are now the architectural baseline for Phase 3 implementation — see `PHASE-3-PLAN.md` in this directory for the full build spec.
