# PAT002 — Maria Sandoval — Assessment Walkthrough

> **Purpose.** A single reference for: (1) what the resident sees at each timepoint, (2) the questions, (3) what a rubric-passing answer looks like, and (4) what a "weak-prompt, dump-all-context" AI-only workflow produces — so you can judge whether the assessment actually rewards skilled AI use.
>
> **Caveat on the simulation.** I did not invoke the live Haiku chatbot. The "lazy-prompt simulation" answers below are what a competent LLM with full-context-dump would credibly produce given the gated chart at each timepoint. They are deliberately AI-generated-looking (bulleted, generic, no specific-patient anchoring). Real Haiku output may be terser. Scores below are my best-faith estimates against the actual rubric weights.

---

## At-a-glance

| Stage | Anchor | Weight | Time | What's new in chart |
|---|---|---|---|---|
| **TP1** | 2026-01-12 | 1.0 | 5 min | Historical (2018–2023) + today's urgent care visit |
| **TP2** | 2027-03-15 | 2.0 | 12 min | + 14 months of intercurrent visits, ED bounce, Feb 2027 AMA admission, today's admission H&P |
| **TP3** | 2027-03-25 | 1.5 + 2.0 | 13 min | + HD3–HD11 inpatient (MBSS, EMG, muscle bx, skin bx, MSA panel, consults, daily progress) |

Total: 30 min, 6.5 total weight, 70% overall pass.

---

## Timepoint 1 — Initial presentation (2026-01-12)

### Clinical picture (what the resident sees)

22-year-old Spanish-speaking woman, immigrant from rural Guatemala (2017), uninsured since 2020. **Chief complaint:** 6 months of progressive bilateral joint pain + diffuse hair thinning + fatigue + night sweats + a few pounds unintentional weight loss. No fever, rash, oral ulcers, photosensitivity, Raynaud, or dysphagia. Last seen by a clinician in 2019.

**Exam:** Symmetric synovitis of bilateral MCPs/PIPs/wrists/ankles; diffuse scalp thinning, no patchy alopecia; no rash; no organomegaly. Vitals normal, weight 50.8 kg (BMI 22.6 — well-nourished).

**Labs from today:** CBC normal, BMP normal, UA normal, **TSH 5.32** (slightly elevated), **ANA 1:80 homogeneous** (low-titer), RF negative. ESR/CRP pending. dsDNA / anti-Sm / anti-Ro/La / anti-CCP / Hep B/C/HIV / free T4 / TPO Ab / parvovirus / UPC ordered as send-outs.

**Family hx:** Maternal aunt with SLE (Guatemala, disabled). Mother with hypothyroidism. Father deceased age 39 (MVA, had treated TB).

**What Dr. Reyes did:** Started empiric HCQ 200 BID + levothyroxine 25 mcg + continue ibuprofen. Referrals to rheum, ophthalmology, PCP.

**Historical chart (also visible):** Pediatric immigration intake 2018 (iron-deficiency anemia, latent TB ruled out), strep visit 2019, anemia f/u 2019, UTI 2021, ankle sprain 2023. Nothing autoimmune.

### Question (AP1-Q1, weight 1.0)

> "What is your prioritized differential diagnosis for Maria's current symptoms, and what would you do next?"

### What a rubric-passing answer looks like

A strong answer **weights SLE as one possibility** (low-titer ANA, no specific criteria yet) and broadens to:
- **Undifferentiated CTD / probable early SLE** (best fits the data she has)
- **Viral arthropathy** — parvovirus B19, hep B/C — appropriate in a young woman with new symmetric polyarthritis
- **RA or other seronegative inflammatory arthropathy** despite negative RF
- **Hashimoto's thyroiditis** explicitly addresses the TSH 5.32 (not "incidental")
- **Hypothyroid arthropathy** as a *single* mechanism for arthralgia + fatigue + hair loss (bonus — many residents miss this)
- **TB / extrapulmonary TB** considered given Guatemala origin + family history + 2018 IGRA indeterminate (bonus)

Next steps the rubric wants:
- Send specific autoantibodies (dsDNA, anti-Sm, anti-Ro/La, anti-CCP), complements, viral serologies, free T4, TPO Ab, UPC
- Rheumatology referral with explicit acknowledgment of access barriers (uninsured, sliding-scale)
- Counsel on diagnostic uncertainty + return precautions
- Comment that empiric HCQ before specialist eval has trade-offs

**Red flags to avoid:** anchoring confidently on SLE from the 1:80 ANA alone; ignoring infection given immigration; treating the TSH as incidental.

### Lazy-prompt simulation

Prompt: *"What is your prioritized differential diagnosis for Maria's current symptoms, and what would you do next?"* with "include all context" toggled on.

A capable LLM output would likely produce:

> Maria is a 22-year-old woman with subacute symmetric polyarthritis, fatigue, hair loss, and a positive 1:80 ANA.
> **Differential, prioritized:**
> 1. Systemic lupus erythematosus — family history, positive ANA, polyarthritis
> 2. Undifferentiated connective tissue disease
> 3. Rheumatoid arthritis (despite negative RF)
> 4. Viral arthropathy (parvovirus B19, hepatitis B/C)
> 5. Hashimoto's thyroiditis — explains TSH and possibly hair thinning
>
> **Next steps:**
> - Send anti-dsDNA, anti-Smith, anti-Ro/La, complements
> - Hepatitis B/C and HIV serologies, parvovirus B19 IgM
> - Free T4, TPO Ab
> - Urine protein/creatinine ratio
> - Refer to rheumatology
> - Counsel on diagnostic uncertainty and return precautions

**Score estimate: ~85% (0.85 / 1.0)**

Hits most essentials. Likely misses: hypothyroid-arthropathy as a unifying mechanism (bonus); explicit weighting of the low-titer ANA; explicit infection / TB framing for an immigrant patient. Generally a strong AI response *because* the case at TP1 is appropriately broad and a thorough chart-context dump genuinely informs a good differential.

**Discriminator at TP1:** Low. The data is thin and the right answer is "be appropriately broad," which AI does well. A weak resident with AI scores nearly as well as a strong one.

---

## Timepoint 2 — Severe re-presentation (2027-03-15)

### Clinical picture (what the resident sees — 14 months later)

Maria is admitted from clinic today. **Chief complaint (verbatim):** *"No me puedo mover, no me puedo comer"* — I can't move, I can't eat. Mother and aunt at bedside. Brought from home in extremis.

**Interval (visible in the chart):**
- **Era 6–7 (2026):** Rheumatology workup confirmed SLE (Dr. Tanaka, 4/2026). HCQ continued. MMF started 11/2026 after an ED visit with fatigue/cytopenia/proteinuria. **HCQ lapsed Aug–Sep 2026 due to PAP denial.** Worked nights at a hotel; lost the job November 2026.
- **Era 8 (Dec 2026):** PCP follow-up — SLE responding to MMF + HCQ + prednisone. Weight back to 47.2 kg. **NEW symptom that visit:** occasional bolus dysphagia with dry foods x 2–3 weeks. Bedside swallow screen equivocal. Baseline labs ordered.
- **Era 9 (Feb 8, 2027):** ED — dramatic deterioration: proximal weakness, dysphagia, voice change, **CK 1840, aldolase 22, dsDNA 38, low complements, albumin 2.3, weight 41.2 kg (down 18.9%).** Admitted. **Discharged AMA on hospital day 4** before EMG / muscle biopsy / skin biopsy results — patient afraid of the leg biopsy, family worried about bills.
- **Outpatient EMG / biopsy missed twice** (couldn't get out of the 3rd-floor walkup, couldn't afford Lyft).
- **MMF supply ran out 3/9/2027.** Late February–early March: progressive bedbound state, intake dropped to ~400–600 kcal/d of Ensure and broth, last solid food 3/3/2027.

**Admission today (3/15/2027) — vitals:** BP 86/52, HR 124, RR 26, T 97.2 F (mildly hypothermic), SpO2 94% RA. **Weight 35.4 kg, BMI 15.7 (WHO Class III thinness).** Total 30.3% loss from 50.8 kg baseline.

**Exam highlights:** Severely cachectic AND anasarcic. Temporal wasting + sunken cheeks + pale conjunctivae. Soft palate elevation reduced and asymmetric, gag sluggish, voice nasal/weak. Hip flexion 2/5, shoulder abduction 2/5, neck flexion 2/5 with head lag — proximal-predominant pattern, distal preserved. Diffuse scaling pinkish-brown dermatosis over trunk, extensors, dorsum of hands. Hair brittle with **bands of lighter color along the shafts**. Beau's lines on multiple fingernails. Oral ulcers (palate x3, tongue x1).

**Admission labs:** Hgb 7.8, WBC 2.30, Plt 122, ANC 1.0. **Albumin 1.6, prealbumin 6, total protein 4.8.** Na 130, K 3.0, Mg 1.4, Phos 1.8, Ca 7.8 — **all low before any caloric intake.** CK 2360, aldolase 28, LDH 684. AST 142 > ALT 86. Anti-dsDNA 48, C3 58, C4 5, CH50 <15. Anti-Smith newly weakly positive. **Zinc 32, copper 62, 25-OH vitamin D 12, selenium pending.** TSH 6.84, free T4 0.6, T3 62. UPC 0.58 with 2+ proteinuria.

**Imaging:** CT C/A/P shows severe generalized muscle wasting (paraspinal, iliopsoas, gluteal, pectoralis), small bilateral effusions + small-volume ascites, trace pericardial effusion, no malignancy, no anatomic dysphagia etiology.

### Question (AP2-Q1, weight 2.0)

> "Build your working differential for Maria's current presentation, then write your first 24-hour workup and management plan. What do you order, what do you hold, and in what order? Be explicit about safety."

### What a rubric-passing answer looks like

A strong answer **explicitly unifies** the picture:
- **Active SLE flare** (dsDNA up, complements down, anti-Sm newly positive, oral ulcers, cytopenia, proteinuria) **with inflammatory myositis** (CK 2360 / aldolase 28 / proximal symmetric weakness with bulbar involvement)
- **Myositis is driving the oropharyngeal dysphagia** → which drove the protein-calorie starvation
- **Severe protein-calorie malnutrition / kwashiorkor as a co-defining diagnosis** — not "just" a complication. Anasarca + albumin 1.6 + scaling "flaky-paint" dermatosis + brittle banded hair + Beau's lines + zinc/copper/vit D deficiencies + low BUN all point here.

24-hour plan:
- **NPO + aspiration precautions + HOB up + suction at bedside + formal MBSS before any PO intake**
- **Pre-immunosuppression infection screen** (TB-IGRA, HBV/HCV/HIV, CMV/EBV PCR, beta-glucan, galactomannan, strongyloides, blood cx) **before any steroid escalation**
- **Hold further immunosuppression** until biopsy direction and infection screen return; **continue HCQ and current prednisone**
- **Nutrition consult** with **explicit refeeding precautions**: thiamine 200 mg IV **before any glucose-containing fluid or feed**, **slow caloric initiation 10–20 kcal/kg/d with daily ramp**, **daily phos/Mg/K** (q6h for first 72 h), repletion to safe targets before each advance
- **Muscle workup:** trend CK / aldolase, neurology consult for EMG, plan muscle biopsy (vastus lateralis); send myositis-specific antibody panel
- **Skin biopsy** of an active "flaky paint" abdominal lesion (interface dermatitis vs nutritional dermatosis vs DM-overlap)
- **Cautious IVF** (50 mL/hr NS, no dextrose until thiamine in) — pt is anasarcic but intravascularly dry
- DVT prophylaxis mechanical only (Plt 122 trending down)
- Echo (small effusions, trace pericardial)
- Document the missed-care timeline (HCQ gap, AMA, missed EMG x 2, MMF out) as a contributor

**Red flags:** treating SLE and malnutrition as unrelated buckets; pulsing steroids before infection screen; aggressive feeding without refeeding plan; oral intake before swallow study; missing kwashiorkor entirely.

### Lazy-prompt simulation

Prompt: *"Build your working differential for Maria's current presentation, then write your first 24-hour workup and management plan. What do you order, what do you hold, and in what order? Be explicit about safety."* + all-context dump.

Likely AI output:

> Maria has a severe multi-system presentation: BMI 15.7, anasarca, proximal weakness, dysphagia, scaling rash, cytopenia, electrolyte derangements, and active SLE serologies.
>
> **Differential:**
> 1. SLE flare with new inflammatory myositis (rising CK, dsDNA, low complements)
> 2. Severe malnutrition / hypoalbuminemia
> 3. Oropharyngeal dysphagia — etiology to clarify
> 4. Pancytopenia — multifactorial
> 5. Early lupus nephritis
>
> **24-hour plan:**
> - NPO; aspiration precautions
> - Speech therapy / MBSS evaluation
> - Nutrition consult
> - Rheumatology consult
> - Neurology consult for EMG and muscle biopsy
> - Infectious workup (TB, hepatitis, HIV, CMV)
> - Continue prednisone and HCQ; hold MMF
> - IV fluids cautiously given edema
> - Electrolyte repletion (K, Mg, Phos)
> - Daily CBC, CMP, CK trend
> - DVT prophylaxis with SCDs (low platelets)

**Score estimate: ~60% (1.20 / 2.0)**

Hits: SLE+myositis, dysphagia workup, holds MMF, infection screen, consults, electrolyte repletion, SCDs.

**Misses:**
- **Kwashiorkor / protein-calorie malnutrition as a co-defining diagnosis** — not named.
- **Explicit refeeding precautions**: thiamine before glucose; specific cautious caloric ramp (10–20 kcal/kg/d); q6h phos/Mg/K monitoring schedule — vague at best.
- **"Hold further immunosuppression escalation until biopsy direction + infection screen"** — said "hold MMF" but did not articulate why or under what condition to escalate.
- **Bonus chain** SLE → myositis → dysphagia → starvation → kwashiorkor — absent.
- Missed-opportunity timeline (HCQ gap, AMA, refill failures) — absent.

This is the **discriminating timepoint.** A skilled resident framing targeted prompts ("what's the unifying diagnosis given the dermatosis + albumin 1.6 + flag-sign hair?", "give me specific refeeding precautions") would pull these out of the AI; a lazy resident will not.

---

## Timepoint 3 — Synthesis and management (2027-03-25)

### Clinical picture (what the resident sees — hospital day 11, discharge today)

The inpatient workup is back. The resident is the team intern responsible for committing to a unifying diagnosis and writing the discharge plan.

**Diagnostic results from this admission:**
- **MBSS (HD3):** Severe oropharyngeal dysphagia with silent aspiration of thin liquids. NPO with NG tube.
- **EMG (HD4):** Active myopathic process with prominent spontaneous activity (fibrillations + positive sharp waves), small short polyphasic MUPs with early recruitment, proximal-predominant with paraspinal involvement. NCS normal. RNS rules out MG. Right vastus lateralis identified as biopsy target.
- **Muscle biopsy (HD5, finalized HD8):** CD8+ T-cell endomysial infiltrate invading non-necrotic fibers, perifascicular atrophy in ~30% of fascicles, diffuse MHC class I upregulation, C5b-9 sarcolemmal deposition perifascicular. No rimmed vacuoles. Normal sarcoglycan.
- **MSA panel:** All negative (Jo-1, MDA5, TIF1γ, Mi-2, NXP2, SAE, PM-Scl, Ku, Ro, La, U1-RNP).
- **Skin biopsy (HD6):** Interface/vacuolar dermatitis with epidermal cytoplasmic vacuolation, weakly positive lupus band test, **absent dermal mucin**, no fungal organisms, no amyloid.
- **Echo:** LVEF 60%, mild diastolic dysfunction, trace pericardial effusion, no vegetations.
- **Infection screen:** All negative — clean for steroid escalation.

**Course:**
- HD3–5: NPO, NG placed, cautious feeding started, MMF restarted via NG, refeeding electrolyte repletion completed.
- HD8: With biopsy back + MSA neg + clean infection screen, **pulse methylprednisolone 1 g IV daily × 3 (HD8–10).**
- HD10: Repeat MBSS showed improvement (penetration without aspiration). Pureed/nectar-thick diet started as supplement to NG feeds.
- HD11 (today): Hip flexion 4–/5 (from 2/5). Walking 5–6 steps with walker. Albumin 1.9 (from 1.6). Pancytopenia rebounding. Trace ankle edema only.

**Discharge labs (3/25 AM):** Hgb 8.8, WBC 3.40, Plt 168. Alb 2.3, prealbumin 13. CK 1240 (down from peak 2580). Anti-dsDNA 28 (from 52). C3 78 / C4 8. UPC 0.32. TSH 3.85, free T4 1.0.

**Social:** Emergency Medicaid active for admission. Permanent Medicaid pending. Family Spanish-speaking, low health literacy, lives 3rd-floor walkup with no working elevator.

### Question 1 (AP3-Q1, weight 1.5)

> "Commit to a unifying diagnosis (or dyad/triad) for Maria. Lay out your reasoning."

### What a rubric-passing answer looks like

**The unifying diagnosis is a triad with an explicit causal chain:**

1. **Active systemic lupus erythematosus** — meeting multiple immunologic criteria (dsDNA, anti-Sm, low C3/C4/CH50), mucocutaneous (oral ulcers + scaling rash), hematologic (pancytopenia), renal (UPC 0.58 peak), serositis (trace pericardial + small pleural).
2. **SLE-associated inflammatory myositis with overlap PM/DM features** — biopsy shows mixed CD8+ endomysial infiltrate (PM-pattern) plus perifascicular atrophy + C5b-9 (DM-pattern); MSA negative argues against primary DM/anti-synthetase syndrome and supports SLE-associated.
3. **Severe protein-calorie malnutrition / kwashiorkor** from **oropharyngeal dysphagia driven by the bulbar myositis** → progressive starvation → albumin 1.6, prealbumin 6, anasarca, scaling "flaky-paint" dermatosis, banded hair, Beau's lines, micronutrient deficits.

**Causal chain (the synthesis the rubric wants):**
> SLE → inflammatory myositis → pharyngeal involvement → oropharyngeal dysphagia → reduced oral intake → severe protein-calorie malnutrition / kwashiorkor

A passing answer **explicitly states this chain**. Bonus credit for:
- Recognizing the scaling rash as **mixed**: kwashiorkor dermatosis layered on SLE-associated cutaneous disease
- Acknowledging social-determinant amplifiers (insurance lapses, AMA, missed EMG x2, MMF supply failures, food insecurity, language barriers) as accelerators
- Recognizing **prognosis is driven as much by nutritional recovery as by SLE control**
- Earlier presentations (TP1, Dec 2026, Feb 2027 ED, AMA) were missed opportunities to break the chain

**Red flags:** treating SLE and malnutrition as unrelated; attributing skin findings purely to SLE; missing the kwashiorkor link entirely.

### Question 2 (AP3-Q2, weight 2.0)

> "Write Maria's discharge management plan. Address immunosuppression, nutrition, and the outpatient transition."

### What a rubric-passing answer looks like

**Immunosuppression:**
- **Prednisone 1 mg/kg/d (~40 mg)** with **stated taper schedule** (e.g., decrease by 5 mg q2 weeks to 10 mg, then 2.5 mg q month) — *or* explicit rationale for pulse vs continued oral
- **Steroid-sparing agent named**: mycophenolate 1.5 g BID (or azathioprine) **with confirmed pre-treatment infection screen** (already done)
- **Continue hydroxychloroquine** 200 mg BID with annual ophthalmology screening
- **PCP prophylaxis (TMP/SMX)** while on combined immunosuppression
- **Bone health:** calcium + vitamin D + bisphosphonate consideration
- **Contraception counseling** (mycophenolate teratogenic — required for a young woman of reproductive age)

**Nutrition:**
- **Continue NG feeds** (or transition to PEG if dysphagia doesn't recover); modified-consistency oral diet explicitly **tied to the swallow study finding**
- **Slow caloric ramp** with refeeding precautions: daily phos/Mg/K monitoring, thiamine continued
- **Micronutrient repletion:** zinc, selenium, vitamin D, B-complex
- **Outpatient dietitian follow-up** (Spanish-speaking)

**Outpatient transition:**
- **Specific follow-up schedule with intervals and providers:** PCP (Esperanza, Spanish-speaking) at 1 week, rheumatology at 2 weeks, dietitian within 1 week, SLP weekly
- **Repeat MBSS** at 3–4 weeks
- **Concrete medication-access plan** addressing the insurance gap: patient-assistance programs, Hopkins financial-aid bridge, Maryland Medicaid appeal status, low-cost alternatives
- **Language-concordant care** explicit at every level (Spanish-speaking PCP/rheum/dietitian or qualified interpreter)
- **Mental-health screen + Esperanza Behavioral Health follow-up**
- **Warm handoff** to community resources (lupus foundation, Maryland Food Bank, FQHC produce-Rx)
- **Specific return precautions** in Spanish tied to symptoms (choking, fever, focal weakness, etc.)

**Red flags:** generic discharge instructions; no electrolyte schedule; oral feeding without addressing dysphagia; omitting thiamine; no medication-access plan despite known insurance issues; no language-concordant follow-up; starting MMF in a reproductive-age woman without contraception counseling; treating malnutrition as "will fix itself."

### Lazy-prompt simulation (both AP3 questions)

For **Q1** ("commit to a unifying diagnosis"):

> Maria has active systemic lupus erythematosus with associated inflammatory myositis. The muscle biopsy shows features of both polymyositis and dermatomyositis (overlap), with a negative myositis-specific antibody panel supporting SLE-associated rather than primary inflammatory myopathy. Her dysphagia is consistent with bulbar muscle involvement from the myositis. She also has lupus nephritis (mild proteinuria, improving) and pancytopenia. Treatment with pulse steroids has resulted in early clinical and laboratory response.

**Score estimate AP3-Q1: ~67% (~1.0 / 1.5)** — hits SLE, myositis, dysphagia-from-myositis. **Misses kwashiorkor as a co-defining diagnosis** and does not articulate the explicit causal chain ending in starvation. Skin findings attributed purely to SLE. No social-determinant amplifier framing.

For **Q2** ("discharge plan"):

> **Immunosuppression:** Continue prednisone 40 mg daily with a slow taper. Mycophenolate mofetil 1.5 g BID. Hydroxychloroquine 200 mg BID. TMP/SMX for PCP prophylaxis.
>
> **Nutrition:** Continue NG feeds with gradual transition to oral diet as swallow improves. Continue thiamine and multivitamin. Monitor electrolytes.
>
> **Follow-up:**
> - Rheumatology in 2 weeks
> - PCP in 1 week
> - Dietitian
> - Speech therapy
> - Repeat labs in 2 weeks
>
> **Return precautions:** Fever, worsening weakness, choking, shortness of breath.

**Score estimate AP3-Q2: ~50% (~1.0 / 2.0)** — hits steroid+MMF+HCQ+prophylaxis, NG plan, named follow-ups. **Misses:** explicit taper schedule with dose rationale; refeeding electrolyte monitoring schedule; specific calorie ramp; **medication-access plan despite known insurance crisis**; **language-concordant follow-up**; **contraception counseling** (MMF teratogenicity) in a young woman; bone health beyond calcium; Spanish-language patient materials; mental-health continuation. These omissions stem entirely from the lazy prompt not asking about social determinants or sex-specific safety.

---

## Total weak-prompt simulation score

| Stage | Question | Weight | Estimated | Earned |
|---|---|---|---|---|
| TP1 | Differential + next steps | 1.0 | 85% | 0.85 |
| TP2 | Differential + 24-hr plan | 2.0 | 60% | 1.20 |
| TP3-Q1 | Unifying diagnosis | 1.5 | 67% | 1.00 |
| TP3-Q2 | Discharge plan | 2.0 | 50% | 1.00 |
| **Total** | | **6.5** | | **~4.05 (62%)** |

**Just below the 70% overall passing threshold.** The assessment is correctly tuned: lazy AI use scrapes the floor, and skilled use is required to clear it.

---

## Where the assessment discriminates

| Skill | Where it matters | What separates a passing resident |
|---|---|---|
| **Asking the right targeted question** | TP2 (kwashiorkor synthesis), TP3-Q1 (causal chain) | "What unifies anasarca + scaling rash + banded hair + albumin 1.6 in this context?" instead of "what's wrong with this patient?" |
| **Recognizing social determinants matter clinically** | TP2 (missed-opportunity timeline), TP3-Q2 (medication access, language, contraception) | Prompts the AI explicitly about insurance, language, and reproductive-age-specific safety |
| **Specific safety articulation** | TP2 (refeeding precautions), TP3-Q2 (taper schedule, electrolyte monitoring) | "Give me a specific 5-day refeeding ramp with thiamine timing and monitoring schedule" |
| **Verifying AI synthesis** | TP3-Q1 | Notices when AI says "SLE with myositis" and pushes back "what about the rash and the weight loss?" |

The places where AI alone scores well are exactly the places where the data is broad and the right answer is broad (TP1). The places where AI alone underperforms are where synthesis, social-determinant integration, and specific safety articulation are required — which is what the assessment is actually measuring.

---

## If the score is too easy or too hard

If a real resident with lazy prompting routinely scores **above 70%**: the rubric's essentials at TP2 and TP3 are too forgiving — consider weighting kwashiorkor recognition more heavily, or marking it as required-to-pass.

If skilled prompting can't clear **80%**: a rubric essential is poorly stated or the chart doesn't support it — re-audit the visible-at-anchor data for the timepoint.
