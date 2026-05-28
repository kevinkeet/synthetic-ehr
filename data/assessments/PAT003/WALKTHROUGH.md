# PAT003 — Lan Nguyen — Assessment Walkthrough

> **Purpose.** Shows what the resident sees, the five questions, what a
> rubric-passing answer looks like, and how a *novice* (AI-naïve) vs an
> *educated* (AI-literate) resident perform on the same case with the same
> clinical knowledge but opposite AI habits.
>
> **Caveat on the simulation.** I did not drive the live Haiku chatbot (its
> API key is encrypted under the site access password). These are
> high-fidelity simulated runs against the actual chart and the real
> `ap1.json` rubric. Scores are best-faith estimates against the documented
> essential / bonus / red-flag lists.

---

## The case in one paragraph

Lan Thi Nguyen, 72, Vietnamese-speaking, is being discharged on hospital
day 57 after a brutal admission for severe gallstone pancreatitis (ERCP,
septic shock, ARDS + 10 days on the ventilator, a new DVT now on apixaban,
severe deconditioning). During the sepsis workup on HD3, a chest X-ray
incidentally caught a **2.5 cm right upper lobe lung nodule**, confirmed on a
dedicated CT (HD~29) that the radiologist flagged for **biopsy or 3-month
repeat imaging**. The nodule was mentioned in notes through HD8 — then
**dropped off every progress note for 49 days** and is missing from the
discharge summary's 14 diagnoses. The resident catches it on a final imaging
review at discharge. The case is *not* about diagnosing the nodule; it's
about safely operationalizing the workup in a socially complex patient.

## At-a-glance

| | |
|---|---|
| Timepoint | 1 (discharge day, 2027-04-12) |
| Questions | 5 |
| Total weight | 3.6 (source rubric = 36 points, ÷10) |
| Time budget | 25 min |
| Pass | 70% (= 2.52 / 3.6) |
| Source | Management Case Bank, Case 1 (discussants Vachani, Rhodes, Ouchida; finalized by Parsons) |

## The two personas

**Novice (AI-naïve):** pastes the question verbatim, toggles all context on,
takes the first answer, never opens the imaging tab, never asks a follow-up,
copies the AI output nearly verbatim.

**Educated (AI-literate):** curates which context to include, asks targeted
sub-questions, cross-checks the AI against the primary chart (opens the
actual CT report), iterates, synthesizes in their own words.

---

## Q1 — Differential for the nodule (weight 0.6)

> "Based on the information you have at this time, what is your differential
> diagnosis for this incidental lung nodule?"

**Rubric-passing answer** names all six categories: primary lung malignancy,
metastasis, tuberculosis, non-TB infection (bacterial / fungal / endemic
mycoses), rheumatologic / autoimmune nodule, benign granuloma / calcified
scar. Bonus for risk-stratifying by her specifics (smoking, PPD, family
lung cancer, BCG) and noting the radiologist's recommendation implies an
intermediate pretest probability.

**Novice** pastes the bare question → chatbot returns malignancy, metastasis,
TB/granuloma, fungal, benign hamartoma. Solid but generic, no weighting.
**Hits ~5/6** (drops the rheumatologic category). **~0.50 / 0.60 (83%).**

**Educated** asks for the differential *weighted by this patient's pretest
probability*, then feeds in her smoking / PPD / family-cancer specifics.
**6/6 + bonuses.** **~0.60 / 0.60 (100%).**

*Discrimination: low.* A broad differential is the one thing AI does well
unprompted.

---

## Q2 — Additional non-invasive info (weight 0.9)

> "What additional information could you obtain that would help further hone
> the differential?"

**Rubric-passing answer** covers: detailed smoking history (pack-years),
environmental / occupational exposure, personal & family cancer history,
prior lung infections, prior TB testing / treatment / BCG, the nodule's
imaging features (≥2 of spiculation / solid-vs-subsolid / upper-lobe),
one of (autoimmune history OR geography), one of (hemoptysis OR
lymphadenopathy).

**Novice** asks the open question → gets smoking, exposures, cancer history,
prior infections, TB testing. But **never opened the imaging tab**, so the
nodule's actual features never enter the answer, and the "one-of" pairs are
missed. **~5/9. ~0.50 / 0.90 (56%).**

**Educated** asks what *imaging features and history items* change pretest
probability, **opens IMG004** and cites the radiologist's spiculation / solid
density / upper-lobe / 40-HU enhancement, and works through the BCG-vs-PPD
interpretation (IGRA over PPD). **8/9 + bonuses. ~0.80 / 0.90 (89%).**

*Discrimination: high.* The key behavior is **reading the primary source**
(the CT report) instead of trusting the chatbot's summary.

---

## Q3 — Keep inpatient vs defer to outpatient (weight 1.1) — the discriminator

> "What factors would influence your decision about keeping her in the
> hospital for additional workup vs. deferring to the outpatient setting?"

**Rubric-passing answer** (11 source points) covers: patient understanding of
the condition and of follow-up importance; ability to navigate the system
(language, insurance, transport); family / caregiver support; whether the
health system can reliably track an outpatient nodule; risk + cost of more
inpatient days; the anticoagulation conflict around biopsy (she's on
apixaban); whether a biopsy plan is in place; patient/clinician risk
tolerance; rehab-communication logistics.

**Novice** asks the generic question → generic list: patient understanding,
family support, cost of staying, biopsy plan, anticoagulation. **Misses** the
Vietnamese-language navigation barrier, health-system tracking reliability,
risk tolerance, and rehab logistics — i.e., the things that make *this*
patient's outpatient follow-up unreliable. **~6/11. ~0.60 / 1.10 (55%).**

**Educated** prompts with her actual situation (Vietnamese-speaking,
dual-eligible, fragmented care, new apixaban) and asks specifically about the
risk of loss-to-follow-up given her history (repeatedly declined LDCT on
cost, missed prior appointments). **10/11 + bonuses. ~1.00 / 1.10 (91%).**

---

## Q4 — Outpatient process (weight 0.7)

> "If you were to defer the workup to the outpatient setting, what would be
> your process?"

**Rubric-passing answer** (7 source points): ensure patient/family
understanding via Vietnamese interpretation; emphasize follow-up importance
given malignancy concern; **schedule the biopsy / nodule-clinic referral
before discharge** (not a task left to the patient); assess family needs;
communicate the recommendation to the outpatient care team; clear
anticipatory guidance in the right language; anticoagulation plan around the
biopsy.

**Novice:** "educate the patient, follow up with PCP, communicate the plan."
Vague — misses pre-discharge booking, Vietnamese-specific teaching, the
anticoagulation bridge, and closed-loop tracking. **~4/7. ~0.40 / 0.70 (57%).**

**Educated** forces a concrete checklist: biopsy booked before she leaves,
Vietnamese interpreter + teach-back, apixaban hold/resume plan, who updates
the problem list so it doesn't drop off again, closed-loop result pathway.
**7/7 + bonuses. ~0.70 / 0.70 (100%).**

---

## Q5 — Inpatient discharge endpoint (weight 0.3)

> "If you were to keep her in the hospital for additional investigations, at
> what point would you discharge her?"

**Rubric-passing answer** (3 source points): after the biopsy is done; after
oral anticoagulation is safely resumed; after the outpatient care plan is
clearly delineated. Bonus for noting a *pending result* alone is not a reason
to stay.

**Novice:** "after the biopsy and once a plan is in place." Misses
re-establishing anticoagulation as a gate. **~2/3. ~0.20 / 0.30 (67%).**

**Educated:** biopsy done **+ apixaban resumed + outpatient loop closed**, and
explicitly says a pending biopsy result isn't a reason to keep her.
**3/3. ~0.30 / 0.30 (100%).**

---

## Result

| Question | Weight | Novice | Educated |
|---|---|---|---|
| Q1 Differential | 0.6 | 0.50 (83%) | 0.60 (100%) |
| Q2 Additional info | 0.9 | 0.50 (56%) | 0.80 (89%) |
| Q3 Keep vs discharge | 1.1 | 0.60 (55%) | 1.00 (91%) |
| Q4 Outpatient process | 0.7 | 0.40 (57%) | 0.70 (100%) |
| Q5 Inpatient endpoint | 0.3 | 0.20 (67%) | 0.30 (100%) |
| **Total** | **3.6** | **2.20 (61%)** | **3.40 (94%)** |

**Pass = 70%.** Novice **fails at 61%**; educated **passes at 94%** — a
~33-point gap.

## Where the gap actually opens

- **Two behaviors drive most of it:**
  1. *Opening the primary source.* The educated resident reads the actual CT
     report for nodule features instead of trusting the chatbot's summary (Q2).
  2. *Prompting with the patient's specifics* — language, insurance,
     anticoagulation, fragmented-care history — rather than the generic
     question (Q3, Q4).
- **Q3 + Q4 together (1.8 of 3.6 weight)** are where the case lives. They are
  social-determinant + operationalization questions, and generic prompting
  produces generic, non-passing answers. This mirrors PAT002, where the
  discharge / social-determinant questions were the biggest discriminators.
- **Q1 barely discriminates** — appropriate, because a broad differential is
  the one thing AI does well unprompted.

## Tuning notes

- If novices routinely clear 70%, the highest-yield change is to weight Q3/Q4
  social-determinant essentials more heavily, or to gate on the "biopsy booked
  before discharge" and "Vietnamese-language plan" essentials.
- If educated users can't clear ~85%, re-audit whether the chart actually
  supports each essential (e.g., is the anticoagulation conflict findable,
  is the cost-barrier history visible). During the build these were verified
  present across NOTE006, NOTE012, medications/active.json, NOTE_HX_005/007.
