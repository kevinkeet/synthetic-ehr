# Teaching Tutor — Gold-Standard Example Answers

Hand-authored exemplars that define the quality bar for the tutor: what a *very cool*
educational answer should look like. Each example pairs a crisp clinician **Answer** with
structured **Teaching points** (Principle / The trap / What would change the answer /
Pearl / Check yourself), names the landmark study or framework, and links it.

These are a north star — usable as the spec for prompt tuning, and later as few-shot
exemplars or as seeded "featured" answers in the app. They are deliberately chosen to span
*different kinds of thinking*, not just different topics.

---

## Example 1 — Competing-risk management
**Question (resident):** "My patient has an unprovoked PE and was just found to have a liver mass that needs a biopsy. How long do I anticoagulate, and does the mass change my plan?"

### Answer
Treat the VTE on its own clock first: a minimum of three months of therapeutic anticoagulation for an acute PE, with a direct oral anticoagulant for most patients. The liver mass does not shorten that; if anything it pushes toward *longer*, because an unprovoked PE plus a possible malignancy is a high-recurrence, possibly persistent-risk picture.

The mass changes *logistics*, not the duration: the biopsy is a planned bleeding-risk procedure, so the real decision is how to bridge the clot through a short, supervised anticoagulation hold for the procedure, not whether to stop anticoagulating. Coordinate the hold with whoever does the biopsy, keep it as short as possible, and resume promptly afterward. If the recurrence risk during the hold feels unacceptable, that is an IVC-filter conversation, not a "stop anticoagulation" conversation.

### Teaching points
**Principle** — This is competing-risk reasoning: two clocks (clot recurrence vs procedural bleeding) running at once. The frame from the [CHEST 2021 VTE guideline](https://journal.chestnet.org/article/S0012-3692(21)01506-3/fulltext) is that *duration* is driven by provoked-vs-unprovoked, while the procedure only dictates a brief, reversible interruption.

**The trap** — Conflating "hold for the biopsy" with "the VTE is treated, so we can stop." The recurrence risk of an unprovoked, possibly cancer-associated PE does not go away during the hold; treating the hold as a stopping point is how people get a recurrent PE on the way to the procedure.

**What would change the answer** — Tissue diagnosis. If the mass is malignant, this becomes cancer-associated VTE: extended anticoagulation and a preference for an oral Xa inhibitor in most patients. A genuine contraindication to anticoagulation during the hold (not just discomfort with risk) is what would move you toward an IVC filter.

**Pearl** — "Hold" is not "stop." Write the resume date and the resume dose at the same moment you write the hold order.

**Check yourself** — Your patient's biopsy is in three days and the interventional radiologist asks you to hold the apixaban now. What is the shortest defensible hold, and what is your plan if he develops chest pain during it?

---

## Example 2 — Bayesian diagnosis (test interpretation)
**Question (med student):** "My patient has a positive D-dimer but I thought she was low risk for a PE. Do I have to CT scan her now?"

### Answer
A test result only means something against the pretest probability, so start there, not with the D-dimer. If she is genuinely low risk, the first move is a clinical decision rule: in a low-risk patient who meets all of the [PERC criteria](https://pubmed.ncbi.nlm.nih.gov/?term=Kline+clinical+criteria+pulmonary+embolism+rule-out), you should not have sent a D-dimer at all, because the post-test probability is already below the testing threshold.

If she is low (but not PERC-negative), a D-dimer is the right test, and you are now living with the result. A *negative* D-dimer in a low-probability patient rules out PE. A *positive* D-dimer in a low-probability patient is expected and largely uninformative (D-dimer is sensitive, not specific), and it is what commits you to CT pulmonary angiography. So yes, a positive D-dimer in a low-risk patient generally earns a CTPA, but the lesson is that the cascade was set in motion by ordering the D-dimer before settling the pretest probability.

### Teaching points
**Principle** — Bayes. The same result updates you differently depending on the prior, which is exactly the [PIOPED II](https://pubmed.ncbi.nlm.nih.gov/?term=PIOPED+II+computed+tomographic+pulmonary+angiography) lesson for imaging and the [Wells/PERC](https://pubmed.ncbi.nlm.nih.gov/?term=Kline+clinical+criteria+pulmonary+embolism+rule-out) lesson for D-dimer. Set the pretest probability *first*; it determines whether to test and how to read the result.

**The trap** — Reflex D-dimer before assessing pretest probability. A sensitive, non-specific test ordered in a low-probability patient mostly generates false positives, each of which drags a low-risk patient into a contrast CT she likely did not need.

**What would change the answer** — A higher pretest probability changes the whole pathway: in high-probability patients you skip the D-dimer and go straight to imaging, and a *negative* CT no longer fully reassures you (the discordant-result danger zone).

**Pearl** — Don't order a test whose result you can't act on, before you know how you'd act on each result. D-dimer rules out; it does not rule in.

**Check yourself** — Her D-dimer is back at 620 ng/mL. Before you book the CT: what was her Wells category, and would a negative CT have actually reassured you if she had been high risk?

---

## Example 3 — A counterintuitive landmark trial
**Question (resident):** "Should I tightly control my ICU patient's glucose to normal?"

### Answer
No. Target a moderate range of roughly 140 to 180 mg/dL, not normoglycemia. Tight control sounds physiologic, but the large [NICE-SUGAR trial](https://pubmed.ncbi.nlm.nih.gov/19318384/) randomized critically ill adults to tight control (81 to 108) versus conventional (≤180) and found *higher* 90-day mortality with tight control, driven by severe hypoglycemia and glycemic variability.

So treat hyperglycemia, avoid hypoglycemia even more, and don't chase a normal number. Use a protocolized insulin infusion with frequent glucose checks in patients who need it, and accept "good enough" over "perfect."

### Teaching points
**Principle** — A physiologically appealing *target* is not the same as a better *outcome*. The endpoint that matters is patient-centered (mortality, harm), not the surrogate (a normal lab value).

**The trap** — Surrogate-outcome seduction, compounded by trusting a striking single-center result. Tight control was popularized by one center's trial and then reversed by a large multicenter one; chasing the normal number caused net harm via hypoglycemia.

**What would change the answer** — Context still matters: the specific population and protocol. NICE-SUGAR is the ICU answer; it does not dictate, say, outpatient diabetes targets. Match the evidence to the setting it was generated in.

**Pearl** — In the ICU, the dangerous glucose is the *low* one. "140 to 180 and stable" beats "normal and brittle."

**Check yourself** — Your patient's glucose is 110 on an insulin drip and you feel good about it. Given NICE-SUGAR, what are you actually more worried about at 110 than at 160, and what would you change?

---

## Example 4 — The trial-vs-reality gap
**Question (resident):** "When do I add spironolactone in heart failure, and what do I have to watch?"

### Answer
Add a mineralocorticoid-receptor antagonist (spironolactone or eplerenone) to an ACE inhibitor/ARB/ARNI plus beta-blocker in symptomatic HFrEF with an ejection fraction at or below ~35%. The mortality benefit is large and old: [RALES](https://www.nejm.org/doi/full/10.1056/NEJM199909023411001) showed roughly a 30% reduction in all-cause mortality in NYHA III to IV HFrEF.

But the benefit is inseparable from the safety scaffolding. Start only if potassium is below ~5.0 and renal function is adequate (e.g., eGFR above ~30), use a low dose, and recheck potassium and creatinine within about a week and again after dose changes. If you can't monitor it, you shouldn't start it.

### Teaching points
**Principle** — Guideline-directed therapy is a *package*: the right patient, the right dose, and the monitoring that made the trial safe. The drug's benefit and its safety came from the same protocol.

**The trap** — Implementation drift. After RALES, real-world prescribing without its potassium/renal selection and monitoring drove a measurable rise in hyperkalemia hospitalizations and deaths. The pill alone is not the intervention; the pill *plus the monitoring* is.

**What would change the answer** — Baseline potassium and renal function. A patient with K+ of 5.3 or an eGFR of 22 is a different decision, as is a patient you cannot reliably get follow-up labs on. CKD, other potassium-raising drugs, and adherence all move the risk/benefit.

**Pearl** — Before you start the spironolactone, book the potassium recheck. The order set isn't done until the follow-up lab is scheduled.

**Check yourself** — Your HFrEF patient has a K+ of 4.9 and an eGFR of 38 and takes lisinopril. Do you start spironolactone today, and exactly when is the next potassium?

---

## Example 5 — A diagnostic schema (framework-forward)
**Question (med student):** "How should I think about hyponatremia? I always get lost."

### Answer
Don't memorize a list, run a schema. First confirm it's true hypotonic hyponatremia (check serum osmolality to exclude pseudo- and hyperosmolar causes like hyperglycemia). Then the master branch point is **volume status**: hypovolemic, euvolemic, or hypervolemic.

- Hypovolemic: losses (GI, diuretics, salt-wasting); urine sodium helps localize renal vs extrarenal.
- Euvolemic: think SIADH (a diagnosis of exclusion after thyroid and cortisol are normal), plus water intoxication and low-solute states.
- Hypervolemic: the edematous states (heart failure, cirrhosis, nephrotic/kidney disease) where total-body water is up.

Urine osmolality and urine sodium are the two labs that move you through the branches. Correct at a safe rate to avoid osmotic demyelination.

### Teaching points
**Principle** — Use a [diagnostic schema](https://clinicalproblemsolving.com): a branching framework with one strong first split (here, volume status) rather than a flat differential. Schemas make reasoning reproducible and teachable, the core idea behind the Clinical Problem Solvers approach.

**The trap** — Premature closure on "SIADH" before establishing euvolemia and excluding hypothyroidism and adrenal insufficiency. SIADH is the euvolemic *leftover*, not the reflex answer; calling it early skips the branch work.

**What would change the answer** — The first two labs: serum osmolality (is it truly hypotonic?) and assessed volume status, then urine osmolality and urine sodium. Each reading reroutes you down a different branch, which is the whole point of a schema.

**Pearl** — Two numbers do most of the work in hyponatremia: urine osmolality (is ADH on?) and urine sodium (is the kidney holding or wasting salt?).

**Check yourself** — Serum is hypotonic, the patient looks euvolemic, urine osm is 600 and urine Na is 50. What's your leading diagnosis, and what two tests must be normal before you commit to it?

---

## What makes these "the bar"

- **The answer is genuinely good and concise** — a strong clinician answer, not a textbook dump.
- **The teaching teaches around the answer**, it doesn't restate it: it names the *principle*, the *specific trap*, and the *feature that flips the decision*.
- **It transfers** — every example names a reusable frame (competing risk, Bayes, surrogate-vs-outcome, trial-vs-reality, diagnostic schema) so the learner takes away more than one fact.
- **Citations are real and linked**, anchored to landmark trials/guidelines/frameworks rather than vibes.
- **"Check yourself" is a real probe** — a specific micro-case the learner must actually reason through, in the One-Minute-Preceptor "get a commitment" spirit.
