# PAT007 — Janet Brooks — Assessment Walkthrough

> **Purpose.** Shows what the resident sees, the five questions across three
> timepoints, what a rubric-passing answer looks like, and how a *novice*
> (AI-naïve) vs an *educated* (AI-literate) resident perform on the same case.
>
> **Caveat on the simulation.** I did not drive the live Haiku chatbot (its API
> key is encrypted under the site access password). These are high-fidelity
> simulated runs against the actual chart and the real ap1/ap2/ap3 rubrics.
> Scores are best-faith estimates against the documented essential / bonus /
> red-flag lists.

---

## The case in one paragraph

Janet Brooks, 55, has alcohol-related cirrhosis and 3 months of involuntary
weight loss. She is admitted, suffers a **variceal hemorrhage** (banding fails →
**emergent TIPS**, hemostasis achieved), and is started on antibiotics. Post-TIPS
she develops **persistent high fevers and refractory shock** and stays
unresponsive. An exhaustive infectious workup is **negative** (serial cultures
NGTD, no abscess on CT, normal CSF, negative repeat paracentesis, normal
procalcitonin, no rising WBC; a mild **eosinophilia** is noted) — yet the team,
**anchored on occult infection**, keeps escalating antibiotics as she
deteriorates toward a comfort-measures decision at MELD ~40. After antibiotics
are stopped (as part of comfort care) she **unexpectedly recovers**: the cause
was a **drug fever and drug-associated neurotoxicity** never fully considered.
The case tests cognitive humility and anti-anchoring.

## At-a-glance

| | |
|---|---|
| Timepoints | 3 (TP1 admission/TIPS/fevers 2027-05-06; TP2 negative workup + CMO 2027-05-18; TP3 recovery 2027-05-28) |
| Questions | 5 (Q1/Q2 at TP1; Q3/Q4 at TP2; Q5 at TP3) |
| Total weight | 3.8 |
| Time budget | ~26 min |
| Pass | 70% (= 2.66 / 3.8) |
| Source | Management Case Bank, Case 5 (finalized by Jason Hom) |

## The built-in anchoring "trap"

The chart deliberately embodies the team's infection anchoring: the daily ICU
notes and the ID consult keep escalating broad-spectrum antibiotics and hunting
for an occult source, and **drug fever is never named** until the gated TP3
recovery note. The discriminating behavior is to read the *negative* workup, the
*worsening-on-antibiotics* timeline, and the *eosinophilia*, and break from the
chart's (and the AI's likely) infection frame. The recovery/reveal is hidden at
TP1 and TP2, so Q3 and Q4 are answered without knowing the outcome.

## The two personas

**Novice (AI-naïve):** pastes the question, accepts the first answer, follows the
chart's infection framing, doesn't surface the negative-workup/eosinophilia/
timeline clues.

**Educated (AI-literate):** curates the negative workup into the prompt, asks the
AI for a *broad* differential (including iatrogenic/drug causes), recognizes the
anchoring, and is willing to stop a presumed-necessary therapy.

---

## TP1 — Admission, TIPS, post-procedure fevers

### Q1 — Evaluate the involuntary weight loss (weight 0.6)

**Rubric-passing answer:** structured history/exam; in cirrhosis, evaluate for
**HCC** (multiphase liver imaging + AFP); broader/age-appropriate cancer screen;
nutritional and reversible-contributor assessment.

**Novice:** generic weight-loss workup; may under-emphasize the cirrhosis-specific
HCC imaging/nutrition. **~3/4. ~0.42 / 0.60 (70%).**
**Educated:** adds HCC imaging + the already-elevated AFP, nutrition, builds on
the outpatient workup. **~0.55 / 0.60 (92%).**
*Discrimination: low–moderate.*

### Q2 — Approach to the fevers (weight 0.8)

**Rubric-passing answer:** systematic infectious workup (cultures, **diagnostic
paracentesis**, urine, imaging, lines) with empiric coverage **coupled to a
re-evaluate/de-escalate plan**, and a **broad differential that includes
non-infectious causes** (drug fever, VTE, the procedure, transfusion) from the
start.

**Novice:** infectious workup + empiric antibiotics, but infection-only and no
de-escalation plan. **~2.5/4. ~0.45 / 0.80 (56%).**
**Educated:** explicit non-infectious differential + de-escalation criteria.
**~0.70 / 0.80 (88%).**
*Discrimination: moderate–high.*

---

## TP2 — Negative workup, worsening, family raises comfort measures

### Q3 — What do you do with the antibiotics, and why? (weight 1.0) — the discriminator

**Rubric-passing answer:** recognize the workup is comprehensively negative and
she is **worsening despite escalating antibiotics** → the infection hypothesis
isn't supported; **stop/de-escalate** the antibiotics; broaden the differential
to **drug fever** (note the eosinophilia); frame it explicitly as breaking
anchoring.

**Novice:** follows the chart's frame — continue/broaden coverage, add
antifungals, hunt for an occult source (echoing the ID consult). **~2/4 + a red
flag. ~0.40 / 1.00 (40%).**
**Educated:** reads the negatives + timeline, asks the AI for a differential
*including* iatrogenic causes, identifies drug fever, and stops the antibiotics.
**~0.92 / 1.00 (92%).**
*Discrimination: high — the core anti-anchoring test.*

### Q4 — Factors in the comfort-measures decision (weight 0.9)

**Rubric-passing answer:** the usual goals-of-care factors (prognosis, values,
surrogate/family, QOL, burden/benefit) **plus** the critical point — don't make
an **irreversible** decision while a **reversible, unconsidered** cause (the
unexplained fever / possible drug fever) remains; consider a time-limited trial
or stopping the drugs first.

**Novice:** solid generic CMO framework (AI does this well) but **misses the
reversibility/diagnostic-uncertainty caveat** specific to this case. **~2.5/4.
~0.50 / 0.90 (56%).**
**Educated:** includes the reversibility caveat and proposes stopping the drugs
before an irreversible decision. **~0.80 / 0.90 (89%).**
*Discrimination: high.*

---

## TP3 — Unexpected recovery

### Q5 — Explain the diagnosis to the family (weight 0.5)

**Rubric-passing answer:** clear, jargon-free explanation that her syndrome was
a reaction to the antibiotics (drug fever / drug effect on the brain), not an
infection, and stopping them is why she recovered; **honest, transparent**
acknowledgement of the missed diagnosis; empathy and an invitation for questions.

**Novice:** reasonable empathic explanation, lighter on transparency about the
miss. **~0.35 / 0.50 (70%).**
**Educated:** clear + transparent disclosure + re-address goals. **~0.48 / 0.50
(96%).**
*Discrimination: low–moderate.*

---

## Result

| Question | Weight | Novice | Educated |
|---|---|---|---|
| Q1 Evaluate weight loss | 0.6 | 0.42 (70%) | 0.55 (92%) |
| Q2 Approach to fevers | 0.8 | 0.45 (56%) | 0.70 (88%) |
| Q3 Antibiotics — what & why | 1.0 | 0.40 (40%) | 0.92 (92%) |
| Q4 CMO factors | 0.9 | 0.50 (56%) | 0.80 (89%) |
| Q5 Explain to family | 0.5 | 0.35 (70%) | 0.48 (96%) |
| **Total** | **3.8** | **2.12 (56%)** | **3.45 (91%)** |

**Pass = 70%.** Novice **fails at 56%**; educated **passes at 91%** — a
~35-point gap.

## Where the gap opens

- **Q3 + Q4 (1.9 of 3.8) are the case.** Both turn on *cognitive humility*:
  resisting the chart's confident infection narrative (Q3) and refusing to make
  an irreversible decision while a reversible, unconsidered diagnosis remains
  (Q4). This is the AI-use behavior the workshop targets — using the AI to
  *broaden* the differential rather than confirm the prevailing frame — so these
  items should be sensitive to the intervention.
- **The discriminating behavior is verification + de-anchoring:** reading the
  negative workup, the worsening-on-antibiotics timeline, and the eosinophilia,
  and being willing to stop a presumed-necessary therapy.
- **Q1 and Q5 barely discriminate** — appropriately, since a weight-loss workup
  and an empathic family explanation are things AI does well unprompted.

## Tuning notes

- If novices clear 70%, weight Q3 (and its red flag for continuing/broadening
  antibiotics) more heavily, and/or gate Q4 on the reversibility/diagnostic-
  uncertainty essential.
- If educated users can't clear ~85%, re-audit chart support — verified present:
  the negative workup (LAB002, IMG003, PROC005/PROC006, serial cultures), the
  eosinophilia (LAB002), the infection-anchored ICU/ID notes (NOTE004/NOTE005),
  the CMO deliberation (NOTE006), and the gated recovery/drug-fever reveal
  (NOTE008/NOTE009, PRB011, LAB003) at TP3.
