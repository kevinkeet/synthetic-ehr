# PAT002 — Maria Sandoval — Assessment Walkthrough

> **Purpose.** A single reference for: (1) what the resident sees at each timepoint, (2) the questions, (3) what a rubric-passing answer looks like, and (4) what a "weak-prompt, dump-all-context" AI-only workflow produces — so you can judge whether the assessment actually rewards skilled AI use.
>
> **Caveat on the simulation.** I did not invoke the live Haiku chatbot. The "lazy-prompt simulation" answers below are what a competent LLM with full-context-dump would credibly produce given the gated chart at each timepoint. They are deliberately AI-generated-looking (bulleted, generic, no specific-patient anchoring). Real Haiku output may be terser. Scores below are my best-faith estimates against the actual rubric weights.

> **Chart-difficulty iteration (this version).** Compared with the first build, the chart now: (a) does **not** start hydroxychloroquine at the 1/12/2026 urgent care visit — disease-modifying therapy is explicitly deferred until rheumatology can evaluate; (b) softens the family history from "maternal aunt with SLE" to "maternal aunt with chronic autoimmune illness"; (c) drops the "(Hashimoto's confirmed)" parenthetical when the TPO antibody returns positive; (d) rephrases the 3/15 admission H&P impression from "Known active SLE; medication adherence has been intermittent" to "Background of established autoimmune disease (SLE) with recent gaps in immunosuppression; etiology of current decompensation to be defined inpatient." The intent: stop spoon-feeding the SLE label so a lazy "dump and ask" prompt has to **derive** the autoimmune framing instead of parroting it. Lazy baseline drops a few points; skilled isn't affected.

---

## At-a-glance

| Stage | Anchor | Weight | Time | What's new in chart |
|---|---|---|---|---|
| **TP1** | 2026-01-12 | 1.0 | 5 min | Historical (2018–2023) + today's urgent care visit |
| **TP2** | 2027-03-15 | 0.8 + 1.2 | 12 min | + 14 months of intercurrent visits, ED bounce, Feb 2027 AMA admission, today's admission H&P |
| **TP3** | 2027-03-25 | 1.5 + 2.0 | 13 min | + HD3–HD11 inpatient (MBSS, EMG, muscle bx, skin bx, MSA panel, consults, daily progress) |

Total: 30 min, 5 questions, 6.5 total weight, 70% overall pass. (TP2 splits into a separate diagnostic question and a separate management question.)

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

### Question 1 (AP2-Q1, weight 0.8, ~5 min) — Diagnostic

> "What is your working diagnosis or unifying explanation for Maria's current presentation? Lay out your reasoning."

### What a rubric-passing answer looks like (Q1)

A strong answer **explicitly unifies** the picture as a triad with a causal chain:
- **Active SLE flare** (dsDNA up, complements down, anti-Sm newly positive, oral ulcers, cytopenia, proteinuria) **with inflammatory myositis** (CK 2360 / aldolase 28 / proximal symmetric weakness with bulbar involvement).
- **Myositis is driving the oropharyngeal dysphagia** → which drove the protein-calorie starvation.
- **Severe protein-calorie malnutrition / kwashiorkor as a co-defining diagnosis** — not "just" a complication. Anasarca + albumin 1.6 + scaling "flaky-paint" dermatosis + brittle banded hair + Beau's lines + zinc/copper/vit D deficiencies + low BUN all point here.

Bonus credit for the explicit causal chain `SLE → myositis → dysphagia → starvation → kwashiorkor`, considering DM/SLE overlap, noting the rash may be a mixed (nutritional + CTD) picture, and naming the missed-opportunity timeline (HCQ gap → AMA → missed EMG → MMF gap) as a contributor.

**Red flags:** splitting findings into unrelated buckets; missing kwashiorkor entirely; "SLE flare alone" without explaining the dysphagia/dermatosis/weight loss.

### Lazy-prompt simulation (Q1)

> Maria has multi-system worsening on a background of active SLE. Working diagnosis: SLE flare with inflammatory myositis (rising CK, dsDNA, low complements). Severe malnutrition and pancytopenia complicate the picture. Early lupus nephritis.

**Score ~55% (0.44 / 0.8).** Hits SLE flare with myositis. Misses kwashiorkor as a co-defining diagnosis, the explicit causal chain, the dysphagia-from-myositis mechanism stated explicitly, and the mixed-dermatosis interpretation.

### Question 2 (AP2-Q2, weight 1.2, ~7 min) — Management

> "Write your first 24-hour management plan for Maria. What do you start, what do you hold, and in what order? Be explicit about safety."

### What a rubric-passing answer looks like (Q2)

A strong 24-hour plan:
- **NPO + aspiration precautions + HOB up + suction at bedside + formal MBSS before any PO intake**
- **Pre-immunosuppression infection screen** (TB-IGRA, HBV/HCV/HIV, CMV/EBV PCR, beta-glucan, galactomannan, strongyloides, blood cx) **before any steroid escalation**
- **Hold further immunosuppression** until biopsy direction and infection screen return; **continue HCQ and current prednisone**
- **Nutrition consult** with **explicit refeeding precautions**: thiamine 200 mg IV **before any glucose-containing fluid or feed**, **slow caloric initiation 10–20 kcal/kg/d with daily ramp**, **daily phos/Mg/K** (q6h for first 72 h), repletion to safe targets before each advance
- **Muscle workup:** trend CK / aldolase, neurology consult for EMG, plan muscle biopsy (vastus lateralis); send myositis-specific antibody panel
- **Skin biopsy** of an active abdominal lesion
- **Cautious IVF** (50 mL/hr NS, no dextrose until thiamine in) — patient is anasarcic but intravascularly dry
- DVT prophylaxis mechanical only (Plt 122)
- Echo (trace pericardial)
- **Pregnancy test on admission** (reproductive-age woman on teratogenic MMF; sets up TP3 contraception counseling)

**Red flags:** pulsing steroids before infection screen; aggressive feeding without refeeding plan; oral intake before swallow study; omitting thiamine before any glucose load.

### Lazy-prompt simulation (Q2)

> 24-hour plan: NPO; aspiration precautions; speech therapy / MBSS evaluation; nutrition consult; rheumatology consult; neurology consult for EMG and muscle biopsy; infectious workup (TB, hepatitis, HIV, CMV); continue prednisone and HCQ; hold MMF; IV fluids cautiously given edema; electrolyte repletion (K, Mg, Phos); daily CBC, CMP, CK trend; DVT prophylaxis with SCDs (low platelets).

**Score ~58% (0.70 / 1.2).** Hits: orders the right consults, holds MMF, screens infection, monitors electrolytes. **Misses:** thiamine-before-glucose specifically; specific kcal/kg ramp; explicit "hold steroids until biopsy + infection screen + 72h stable electrolytes" logic; skin biopsy; micronutrient repletion; pregnancy test for MMF.

### TP2 combined lazy score

| Question | Weight | Earned |
|---|---|---|
| AP2-Q1 (diagnostic) | 0.8 | 0.44 (55%) |
| AP2-Q2 (management) | 1.2 | 0.70 (58%) |
| **TP2 total** | **2.0** | **1.14 (57%)** |

This is still the **discriminating timepoint.** A skilled resident with targeted prompts ("what kind of malnutrition pattern is this?", "give me a specific refeeding ramp with thiamine timing") clears the rubric easily; a lazy "dump and ask" doesn't.

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

## Total weak-prompt simulation score (post-iteration chart)

| Stage | Question | Weight | Estimated | Earned |
|---|---|---|---|---|
| TP1 | Differential + next steps | 1.0 | 75% | 0.75 |
| TP2-Q1 | Working diagnosis | 0.8 | 55% | 0.44 |
| TP2-Q2 | 24-hr management plan | 1.2 | 58% | 0.70 |
| TP3-Q1 | Unifying diagnosis | 1.5 | 65% | 0.98 |
| TP3-Q2 | Discharge plan | 2.0 | 50% | 1.00 |
| **Total** | | **6.5** | | **~3.87 (60%)** |

**Solidly below the 70% pass threshold.** Lazy "dump-and-ask" with Haiku now scrapes ~60%; skilled iterative use clears 85–92%. The TP1 drop comes from the removed HCQ and softer family-hx wording — the lazy AI can no longer anchor on "they started SLE treatment" or "aunt has SLE." The TP2 drop is smaller because Maria's established SLE diagnosis is still in the chart (it would be unrealistic to remove it 14 months in).

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

---

# Part 2 — Skilled iterative prompting

Same paper-simulation caveat. This pass uses targeted multi-turn prompts that
force synthesis, force specificity, and probe for patient-specific safety
items. Compare the per-question deltas with the lazy-prompt pass above.

## TP1 — skilled (weight 1.0)

**Prompt chain:**

1. *"Differential for 22F with 6 months of symmetric polyarthritis, fatigue, diffuse hair thinning, mildly elevated TSH 5.32, low-titer ANA 1:80. Be explicit about how specific each finding is."*
2. *"How specific is a 1:80 homogeneous ANA in a young woman? What's the LR+ for SLE at that titer?"*
3. *"Could her thyroid finding alone explain the whole picture? Walk me through hypothyroid arthropathy + telogen effluvium as a unifying mechanism."*
4. *"She's a Guatemalan immigrant, last clinician visit 2019, father had treated TB, IGRA was indeterminate in 2018. What infectious considerations should be on this differential?"*
5. *"Empiric HCQ was already started. What are the trade-offs of that vs holding until specialist eval?"*
6. *"Give me a next-step workup ordered by yield. Distinguish what to send today from what needs rheum eval."*

**Synthesized answer (what would go in the box):** UCTD / probable early SLE weighted appropriately (1:80 ANA non-specific), Hashimoto's with hypothyroid arthropathy + telogen effluvium as a single-mechanism explanation, viral arthropathy, seronegative inflammatory arthropathy, extrapulmonary TB / occult infection given immigration + family history, low-pretest heavy-metal screen. Today: specific autoantibodies, complements, viral serologies, free T4, TPO Ab, UPC, repeat IGRA. HCQ trade-off acknowledged.

**Score ~95% (0.95 / 1.0).** Hits all essentials + hypothyroid-arthropathy bonus + TB bonus + environmental bonus + HCQ trade-off bonus. Minor miss: didn't explicitly invoke reactive/post-infectious arthritis.

## TP2-Q1 — skilled diagnostic (weight 0.8)

**Prompt chain:**

1. *"Look specifically at albumin 1.6, prealbumin 6, anasarca, the scaling dermatosis, hair shafts with bands of lighter color, Beau's lines, low zinc/copper/vit D, low BUN. What pattern of malnutrition is this and what's the textbook term?"*
2. *"She has profound dysphagia + proximal weakness + rising CK. What's the mechanism? Connect it backward to the SLE and forward to her nutritional state. Commit to a unifying diagnosis."*
3. *"Is the scaling rash purely SLE skin, purely nutritional, or both? Briefly."*

**Synthesized answer:** Triad — active SLE flare + SLE-associated inflammatory myositis + severe protein-calorie malnutrition/kwashiorkor. Causal chain: SLE → bulbar myositis → dysphagia → starvation → kwashiorkor. Mixed dermatosis.

**Score ~90% (0.72 / 0.8).** All essentials + chain + mixed-dermatosis bonus.

## TP2-Q2 — skilled management (weight 1.2)

**Prompt chain:**

1. *"Write a 24-hour order set with explicit refeeding-syndrome safety (thiamine before any glucose, kcal/kg/d initiation, q6h phos/Mg/K monitoring, repletion thresholds before each feed advance) and immunosuppression hold logic."*
2. *"Why should I NOT pulse steroids today? List the conditions that need to be met before I escalate immunosuppression."*
3. *"What patient-specific safety items am I missing — sex/reproductive, language, missed-care history?"*

**Synthesized answer:** NPO + aspiration precautions + MBSS today; thiamine 200 mg IV before any glucose; 0.9% NaCl 50 mL/hr no dextrose; K/Mg/Phos/iCa repletion to thresholds before any feed advance; NG feeds start 10 kcal/kg/d with daily +5 kcal/kg ramp; q6h phos/Mg/K × 72h; pre-immunosuppression infection screen; hold pulse steroids until infection screen + biopsy + 72h stable refeeding electrolytes; EMG + muscle biopsy + skin biopsy + MSA panel; mechanical DVT only (Plt 122); pregnancy test on admission; document missed-care timeline.

**Score ~92% (1.10 / 1.2).** All essentials + thiamine-before-glucose + specific kcal/kg ramp + monitoring schedule + hold logic + pregnancy test + missed-opportunity flag.

## TP3-Q1 — skilled (weight 1.5)

**Prompt chain:**

1. *"Summarize what the muscle biopsy, MSA panel, skin biopsy, and EMG show. Where do they agree and where do they leave ambiguity?"*
2. *"Commit to a unifying diagnosis as a dyad or triad. Explicitly say whether this is SLE alone with a downstream nutritional complication, or whether kwashiorkor is a CO-defining diagnosis."*
3. *"Is the scaling dermatosis purely SLE/DM, purely kwashiorkor, or mixed? Cite the biopsy features that point either way."*
4. *"Lay out the causal chain explicitly. Which links broke earliest (Dec 2026, Feb 2027 AMA, MMF gap)?"*
5. *"What's the prognosis driver — SLE control, nutritional recovery, or both?"*

**Synthesized answer:** **Triad** with explicit causal chain. (1) Active SLE meeting multiple ACR/EULAR domains. (2) SLE-associated inflammatory myositis with overlap PM/DM features (biopsy mixed pattern + MSA negative). (3) Severe protein-calorie malnutrition / kwashiorkor from bulbar-myositis-driven dysphagia → starvation. Causal chain stated. Skin findings **mixed** (interface dermatitis + weakly positive lupus band, but absent dermal mucin and epidermal vacuolation more consistent with nutritional dermatosis — layered process). Missed opportunities at Dec 2026 PCP, Feb 2027 AMA, missed outpatient EMG, MMF supply lapse — insurance/language/food-insecurity amplifiers each break. Prognosis driven as much by nutritional recovery + sustained access as by SLE control.

**Score ~95% (1.43 / 1.5).** All essentials + all bonuses except thyroid-involvement framing.

## TP3-Q2 — skilled (weight 2.0)

**Prompt chain:**

1. *"Draft a discharge plan covering immunosuppression with specific doses + taper, refeeding monitoring, dysphagia plan, outpatient transition."*
2. *"She's 23F. What sex-specific safety items must I address?"* → forces contraception + MMF teratogenicity
3. *"Chronic + pulse steroid safety items?"* → forces PCP prophylaxis, bone health, vaccinations, ophtho
4. *"She's Spanish-speaking, just got Medicaid 3 weeks ago after 3 years uninsured, lives in a 3rd-floor walkup. What does my plan need that a generic plan doesn't?"*
5. *"Specific medication-access risks next 4 weeks — bridge them."*
6. *"Continuation plan for moderate depression?"*
7. *"Spanish return precautions tied to her actual risks?"*

**Synthesized answer:** Prednisone 1 mg/kg/d (~40 mg) with explicit taper schedule (40 × 2 wk → 30 × 2 wk → 25 × 2 wk → -5 mg q2wk to 10 mg → -2.5 mg q month). MMF advance to 1.5 g BID. HCQ continued + annual ophtho. TMP/SMX MWF. Vit D + calcium + DEXA at 3 mo with bisphosphonate threshold. **Contraception counseling with specific LARC options (Mirena/Nexplanon both lupus-compatible); negative pregnancy test confirmed.** NG feeds continued; specific kcal target 25–30 kcal/kg/d; PEG conversion at 4 wk if no swallow recovery; micronutrients itemized; refeeding monitoring schedule. Outpatient SLP weekly × 4, repeat MBSS at 4 wk. **Language-concordant follow-up explicitly named at every level** (Spanish-speaking PCP, rheum interpreter pre-booked, Spanish dietitian, Spanish therapy). **Medication-access bridge** with PAP for MMF, $4 generics or 340B for HCQ/pred/levo, Lupus Foundation grant pre-funded 5 rheum visits, social worker direct cell. PHQ-9 at every visit with escalation criteria. Spanish return precautions tied to specific risks (choking → aspiration; fever → immunosuppression infection; rash/ulcers/swelling → flare). Warm handoffs to Maryland Food Bank, FQHC produce-Rx, Lupus Foundation community navigator.

**Score ~90% (1.80 / 2.0).** All essentials + nearly all bonuses (specific dose rationale, LARC contraception, eye-exam plan, bone health with DEXA threshold, calorie ramp, micronutrients, PCP prophylaxis duration, warm handoffs, mental health, Spanish materials, return precautions tied to risks). Minor miss: didn't itemize Spanish reading-level for materials (low-literacy bonus).

---

## Lazy vs skilled — total

| Stage | Weight | Lazy | Skilled | Δ |
|---|---|---|---|---|
| TP1 | 1.0 | 0.75 (75%) | **0.95 (95%)** | +0.20 |
| TP2-Q1 (dx) | 0.8 | 0.44 (55%) | **0.72 (90%)** | +0.28 |
| TP2-Q2 (mgmt) | 1.2 | 0.70 (58%) | **1.10 (92%)** | +0.40 |
| TP3-Q1 | 1.5 | 0.98 (65%) | **1.43 (95%)** | +0.45 |
| TP3-Q2 | 2.0 | 1.00 (50%) | **1.80 (90%)** | +0.80 |
| **Total** | **6.5** | **3.87 (60%)** | **6.00 (92%)** | **+2.13** |

**~30-point gap between lazy and skilled prompting.** This is what you want — the assessment is measuring "can you use AI well," not "did you remember to dump the chart in."

## Where the discriminating skill lives

- **TP1 (+20 pts):** small — most of TP1's value can be hit lazily because the question is appropriately broad.
- **TP2-Q1 (+35 pts):** biggest diagnostic swing. Lazy says "SLE flare with myositis"; skilled commits to the triad with the explicit causal chain ending in kwashiorkor.
- **TP2-Q2 (+34 pts):** management swing. Lazy orders the right consults but misses the *specifics* — thiamine-before-glucose, exact kcal/kg ramp, "hold pulse steroids until X+Y+Z" logic, MMF-teratogenicity pregnancy test.
- **TP3-Q1 (+30 pts):** synthesis question — chain pulls out the triad + mixed-dermatosis interpretation.
- **TP3-Q2 (+40 pts):** largest swing. Discharge planning is where social-determinant prompting matters most. Lazy → generic; targeted → specific bridges.

## The iterative pattern, distilled

1. Open broadly to get the AI's frame.
2. Push it to commit on the specific synthesis (kwashiorkor, the causal chain).
3. Force specificity (kcal/kg/day, q6h electrolytes, exact taper schedule).
4. Probe for patient-specific safety items (sex, language, insurance, literacy).
5. Verify against the actual chart data (cite biopsy features, lab values, dates).

---

# Part 3 — Compact skilled prompting (2–3 prompts per question)

Part 2 used 6–7 prompts per question for didactic clarity. In practice the same
score is achievable with 2–3 prompts if each is well-designed. This section
shows a minimal viable chain that still clears the rubric.

## TP1 compact (weight 1.0) — 3 prompts

1. *"Broad differential for 22F with new symmetric polyarthritis + fatigue + hair loss + low-titer ANA 1:80 + mildly elevated TSH + family hx of autoimmune disease + Guatemalan immigrant with prior indeterminate IGRA. Weight each finding's specificity."*
2. *"Could her thyroid finding alone unify the picture? What infection / exposure considerations from her immigration history?"*
3. *"Next-step workup ordered by yield — what to send today vs at rheum eval."*

Hits: low-titer ANA appropriately weighted, hypothyroid arthropathy as a unifying mechanism, TB / infection on differential, autoantibody + viral serology + thyroid workup, rheum referral.

**Score ~92% (0.92 / 1.0).** Tiny loss vs the 6-prompt verbose chain (95%) — barely meaningful.

## TP2-Q1 compact (weight 0.8) — 1 prompt

> *"Look at the physical findings (scaling dermatosis, banded hair, anasarca despite cachexia) and labs (albumin 1.6, prealbumin 6, zinc 32, low BUN, CK 2360, dsDNA 48, low complements). What's the unifying diagnosis? Is the malnutrition a complication or co-defining? Trace the causal chain."*

Hits: triad named (SLE + myositis + kwashiorkor), causal chain articulated, mixed-dermatosis noted.

**Score ~88% (0.70 / 0.8).**

## TP2-Q2 compact (weight 1.2) — 2 prompts

1. *"Write a 24-hour management plan with explicit refeeding safety (thiamine before any glucose, specific kcal/kg/d initiation, q6h phos/Mg/K monitoring) and immunosuppression hold logic."*
2. *"What patient-specific safety items am I missing — sex/reproductive, language, missed-care history?"*

Hits: NPO + MBSS, infection screen, hold-until-biopsy logic, specific refeeding ramp + thiamine + monitoring, pregnancy test for MMF, missed-opportunity flag.

**Score ~88% (1.05 / 1.2).**

## TP3-Q1 compact (weight 1.5) — 2 prompts

1. *"Given the muscle biopsy + MSA panel + skin biopsy + EMG + lab trajectories, commit to a unifying diagnosis as a triad. Explicitly state the causal chain."*
2. *"Is the skin finding pure SLE, pure kwashiorkor, or mixed? Cite the biopsy features that point either way. Also: what's the prognosis driver — autoimmune control or nutritional recovery?"*

Hits: triad with causal chain, mixed skin findings interpretation, prognosis driven by both. Minor miss: thyroid involvement bonus.

**Score ~90% (1.35 / 1.5).**

## TP3-Q2 compact (weight 2.0) — 2 prompts

1. *"Draft a discharge plan covering immunosuppression doses + taper, refeeding monitoring, dysphagia plan, and outpatient transition."*
2. *"What patient-specific items must I add given she's a 23-year-old Spanish-speaking woman with insurance gaps, food insecurity, recent depression, and a 3rd-floor walkup?"*

Hits: specific taper + MMF + HCQ + PCP prophylaxis, NG / swallow plan, contraception counseling (MMF), language-concordant follow-up, medication-access bridge, warm handoffs, mental-health continuation. Minor misses: specific bone-health DEXA threshold, Spanish-reading-level callout.

**Score ~85% (1.70 / 2.0).**

---

## Lazy vs verbose-skilled vs compact-skilled

| Stage | Weight | Lazy | Verbose skilled (6–7 prompts) | Compact skilled (1–2 prompts) |
|---|---|---|---|---|
| TP1 | 1.0 | 0.75 (75%) | 0.95 (95%) | **0.92 (92%)** |
| TP2-Q1 (dx) | 0.8 | 0.44 (55%) | 0.72 (90%) | **0.70 (88%)** |
| TP2-Q2 (mgmt) | 1.2 | 0.70 (58%) | 1.10 (92%) | **1.05 (88%)** |
| TP3-Q1 | 1.5 | 0.98 (65%) | 1.43 (95%) | **1.35 (90%)** |
| TP3-Q2 | 2.0 | 1.00 (50%) | 1.80 (90%) | **1.70 (85%)** |
| **Total** | **6.5** | **3.87 (60%)** | **6.00 (92%)** | **5.72 (88%)** |

**Read:**
- Lazy total: ~60% (down from ~62% pre-iteration). Solidly under the 70% pass.
- Verbose skilled: ~92%. Hits nearly every essential and bonus, but costs ~7 turns per question.
- **Compact skilled: ~87%.** Still well above pass, with **less than half the prompt count**. This is the realistic skilled-resident workflow.

**Bottom line for test design.** The gap between the lazy floor (~60%) and the compact-skilled ceiling (~87%) is the **actually-measurable AI-literacy delta**. The verbose chain is for teaching; nobody types 7 prompts per question in a 12-minute timepoint.
