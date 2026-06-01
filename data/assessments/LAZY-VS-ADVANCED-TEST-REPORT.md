# Acting Intern — Lazy vs. Advanced AI‑Use Test Report

**Date:** 2026‑05‑29
**Build:** actingintern.com (cache `20260522y`), all 6 assessment cases
**Run by:** automated end‑to‑end simulation against the live Anthropic API

---

## 1. Purpose

Measure whether the assessment discriminates between two ways of using the
embedded clinical chatbot, holding clinical content constant:

- **Lazy user** — loads *all* available chart context into the chatbot, pastes
  the question verbatim, and submits the chatbot's first answer.
- **Advanced user** — thoughtfully frames a prompt, reasons about the specific
  patient, and synthesizes a considered answer before submitting.

This is the discrimination question that underlies the planned RCT: if a
training intervention moves residents from "lazy" to "advanced" AI use, how much
does the graded score actually change?

## 2. Method

- Both scenarios used the **same tool the residents use** — the Haiku chatbot
  (`claude-haiku-4-5`) — so only *user behavior* differs, mirroring the RCT
  (tool held constant across arms).
  - *Lazy* = full gated chart context + verbatim question + the live "be
    concise" chatbot system prompt → first answer submitted.
  - *Advanced* = same tool, but a crafted prompt asking the model to reason
    about this patient's specifics, weigh commonly‑missed points, and produce a
    thorough, synthesized answer.
- Every answer was graded by the **live rubric grader** (`claude‑sonnet‑4‑6`,
  temperature 0), which is effectively deterministic on these rubrics (verified
  spread of 0 across repeated gradings).
- **N = 3 runs per scenario per case.** Answer generation used temperature 0.7,
  so run‑to‑run spread reflects genuine answer variability (what different
  residents/sessions would produce), not grader noise.
- Passing threshold: **70%** overall (weighted across each case's questions).

## 3. Headline results

Overall weighted score per case (mean of 3 runs; individual runs in parentheses):

| Case | Source | Lazy mean (runs) | Advanced mean (runs) | Gap (adv − lazy) | Lazy pass? | Adv pass? |
|---|---|---|---|---|---|---|
| PAT002 — SLE / kwashiorkor | NEJM Clinical Problem‑Solving | 79.4 (81 / 78 / 80) | 83.2 (85 / 84 / 80) | +3.8 | ✅ | ✅ |
| PAT003 — lung nodule | Mgmt Reasoning Case 1 | 56.5 (56 / 51 / 63) | 69.6 (75 / 64 / 70) | **+13.1** | ❌ | ❌ (borderline) |
| PAT004 — PE + liver mass | Mgmt Reasoning Case 2 | 56.4 (54 / 55 / 61) | 67.8 (67 / 69 / 68) | **+11.4** | ❌ | ❌ |
| PAT005 — prophylactic FFP | Mgmt Reasoning Case 3 | 94.9 (96 / 93 / 96) | 99.8 (99 / 100 / 100) | +4.9 | ✅ | ✅ (ceiling) |
| PAT006 — post‑op AF | Mgmt Reasoning Case 4 | 84.1 (85 / 80 / 87) | 82.0 (84 / 91 / 72) | −2.1 | ✅ | ✅ |
| PAT007 — drug fever | Mgmt Reasoning Case 5 | 82.0 (78 / 93 / 75) | 91.2 (86 / 93 / 95) | +9.2 | ✅ | ✅ |
| **Average** | | **75.6** | **82.3** | **+6.7** | 4/6 | 4/6 |

## 4. Key findings

**1. The advanced edge is real but modest — about +6.7 points on average.**
Advanced beat lazy in 5 of 6 cases (PAT006 was a statistical wash). This is far
smaller than the ~30‑point gaps the earlier hand‑written walkthroughs assumed;
those estimates were over‑optimistic. The real, empirically measured effect of
skilled AI use on these cases is single digits to low‑teens.

**2. Strong ceiling effect — a capable chatbot carries the lazy user.**
On PAT002, PAT005, PAT006, and PAT007 the lazy approach already *passes*
(79–95%): given the whole chart, Haiku answers the pasted question well on its
own. PAT005 is the extreme — lazy scores **95%** — because the model already
"knows" the teaching point (don't give prophylactic FFP for an elevated INR in
cirrhosis), so the case's "resist the bad practice" design never trips it.
When the AI knows the answer, lazy ≈ advanced and a training intervention has
little room to move the score.

**3. The discriminating cases are the *hard* ones, not the "anti‑anchoring"
ones.** The only cases where the lazy user *fails* — and where the lazy→advanced
gap is largest — are **PAT003 (+13)** and **PAT004 (+11)**: cases where the
answer depends on reading a primary source the AI summary glosses over
(PAT003's imaging and social‑determinant work) or where the question is hard
enough that the AI alone fumbles (PAT004's anticoagulation‑timing questions).
These are where user skill actually changes the outcome.

**4. PAT004 appears mis‑calibrated or genuinely too hard.** Even the advanced
user tops out at ~68% (a fail), and *both* scenarios score very low on two
questions — Q1 "how long to anticoagulate before biopsy" (lazy ~0.13 / adv
~0.30) and Q3 "DOAC hold duration" (lazy ~0.36 / adv ~0.22). When a strong,
AI‑assisted answer cannot clear ~0.3 on a question, the rubric's "essential"
items are likely stricter or worded differently than what a correct answer
actually says. This case's rubric should be audited.

**5. At the pass/fail level, lazy and advanced are nearly identical.** Both pass
4 of 6 and fail the same two (PAT003, PAT004). The discriminating signal lives
in the *continuous* score, not the binary pass/fail — which argues for analyzing
the RCT on the continuous endpoint, not a pass rate.

## 5. Implications for the RCT

- **Effect size:** plan around a **~5–10 point** intervention effect, not 30.
  Within‑person run‑to‑run SD is also ~5–10 points (the answer‑variability
  spread). A formal power calculation on these numbers will likely require a
  meaningfully larger sample than a large‑effect assumption would suggest.
- **Case selection drives power.** The discriminating cases are **PAT003,
  PAT004, and PAT007**; the ceiling cases (**PAT005, PAT006**, and largely
  PAT002) add variance without signal and dilute the average effect. Consider
  fielding the discriminating subset, or pre‑specifying an "AI‑sensitive"
  subscore built from the items that actually move.
- **Endpoint analysis:** use the continuous weighted score (and ideally a
  pre‑registered subscore of discriminating items) rather than pass/fail.
- **Construct caveat (confirmed empirically):** "final‑answer quality with a
  good AI available" is, on knowledge‑heavy questions, dominated by the AI's
  competence rather than the user's skill. The endpoint is most sensitive on
  cases that require verifying against a primary source or making genuinely hard
  judgments. Randomization still gives a valid causal estimate of the
  intervention — it just needs adequate power for a modest effect.

## 6. Recommended next steps

1. **Audit the PAT004 rubric** (Q1 anticoagulation duration, Q3 DOAC hold) — the
   essentials look stricter than a correct answer; recalibrate or reword.
2. **Re‑examine PAT005** — it is at the ceiling for a modern model and cannot
   discriminate as built; either raise its difficulty or treat it as a low‑signal
   item.
3. **Tighten the discriminating cases** (PAT003, PAT004, PAT007) and consider an
   AI‑sensitive subscore for the primary endpoint.
4. **Run a power calculation** using the effect (~6.7) and within‑scenario SD
   observed here, then decide final case set and N.
5. Optionally, **re‑run the discriminating cases at higher N** for tighter
   per‑case estimates before locking the protocol.

## 7. Methodology notes & caveats

- The advanced scenario used a single crafted prompt with synthesis but **did
  not model multi‑turn iteration**; real advanced users who iterate further
  might score somewhat higher, so the advanced numbers are a conservative lower
  bound on that dimension.
- The grader is deterministic at temperature 0 (measured spread = 0), so all
  score variability reported here is from the *answers*, not the grading.
- An infrastructure bug was found and fixed mid‑run: imaging report bodies were
  not loading into the chatbot (files were stored at `imaging/{id}.json` but the
  loader reads `imaging/reports/{id}.json`). All numbers above reflect the
  corrected, full‑context cases.
- Both scenarios used the production direct‑browser path with the embedded key,
  matching what residents experience on actingintern.com.

## Appendix — per‑question means (lazy / advanced, 3‑run mean)

**PAT002 (NEJM CPS):** AP1‑Q1 .80/.76 · AP2‑Q1 .96/.97 · AP2‑Q2 .87/.84 · AP3‑Q1 .74/.74 · AP3‑Q2 .72/.88

**PAT003 (Mgmt 1):** Q1 differential .84/.94 · Q2 add'l info .74/.76 · Q3 keep‑vs‑discharge .44/.63 · Q4 outpatient process .42/.55 · Q5 inpatient endpoint .30/.59  *(skill gap concentrated in Q3–Q5, the social‑determinant/operationalization items)*

**PAT004 (Mgmt 2):** Q1 anticoag duration .13/.30 · Q2 biopsy‑timing factors .85/.98 · Q3 DOAC hold .36/.22 · Q4 bridging .20/.75 · Q5 IVC filter (this pt) .99/.97 · Q6 IVC pros/cons .83/.97  *(Q1 & Q3 are floor outliers — rubric audit)*

**PAT005 (Mgmt 3):** all items ≈ .87–1.00 for both scenarios *(ceiling)*

**PAT006 (Mgmt 4):** Q1 monitoring .74/.77 · Q2 anticoag decision .95/.87 · Q3 anticoag choice .84/.64 · Q4 ambulatory monitor .79/.98

**PAT007 (Mgmt 5):** Q1 weight‑loss eval .96/.93 · Q2 fever approach .87/.98 · Q3 antibiotics/de‑escalate .66/.83 · Q4 CMO factors .82/.99 · Q5 explain to family .90/.82
