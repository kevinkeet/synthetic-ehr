# Teaching Tutor — 10-question test run (Opus 4.8, prompt v20260604f)

Captured live from the tutor. RAG "Ground in sources" was ON; our corpus is small
(11 IM docs), so most of these are *off-corpus* — a deliberate stress test of how the
prompt behaves when retrieval has nothing relevant.

Below: for each question, the bracketed retrieved sources, the Answer lane, and the
Teaching lane (verbatim).

---

## Q1 — When should I start antibiotics in suspected sepsis, and which ones?
**Retrieved:** Surviving Sepsis 2021 (x2), Wells/PERC

**ANSWER**
Give broad-spectrum antibiotics within 1 hour when septic shock is present OR the probability of sepsis is high — do not wait for cultures or imaging (SSC 2021). If sepsis is possible but not confirmed and there is no shock, take a brief window (up to ~3 hours) of rapid investigation before committing to broad-spectrum agents. Always: blood cultures before antibiotics (but never delay in shock); lactate, remeasure if >2; 30 mL/kg crystalloid for hypotension or lactate ≥4; norepinephrine first-line to MAP ≥65. Regimen is empiric/source-driven: community no-MDR → antipseudomonal β-lactam; MRSA risk → add vancomycin; Pseudomonas/MDR risk → ensure antipseudomonal ± double gram-negative; source-specific anaerobic/antifungal cover. De-escalate at 48–72h.

**TEACHING**
- **Principle** — Risk-stratified, not reflex: SSC 2021 gates the hour-1 mandate on shock/high probability, grants a brief workup window otherwise.
- **The trap** — Treating "the bundle clock" as universal — either blasting every fever or delaying drugs in true shock to chase cultures.
- **What would change the answer** — Shock/high prob → abx ≤1h; uncertain + no shock → workup window; MDR/MRSA/Pseudomonas risk flips the *regimen*, not the timing.
- **Pearl** — "Shock buys the hour; uncertainty buys the workup" — never let the culture bottle hold the antibiotic hostage in a hypotensive patient.
- **Check yourself** — Nursing-home patient, BP 88/50 after 2L, lactate 5, prior ESBL Klebsiella. What's your antibiotic by what minute, and which detail forces you off plain pip-tazo?

---

## Q2 — How do I work up a patient with new microcytic anemia?
**Retrieved (noise):** OMP/SNAPPS, CPS schemas, Surviving Sepsis, PREPIC2

**ANSWER**
Confirm microcytosis (MCV <80), then check ferritin first — iron deficiency is by far the most common cause. CBC + retic + smear; note RDW (high → iron deficiency, normal → thalassemia). Iron studies: ferritin <30 = iron deficiency (diagnostic); in inflammation ferritin <100 with low TSAT can still mean iron deficiency. Schema first split = iron status: (1) iron deficient → find the source; adult male/postmenopausal female → assume GI loss → endoscopy; check celiac. (2) Not iron deficient → thalassemia (normal/high RBC, normal RDW → electrophoresis), anemia of chronic disease, sideroblastic. Red flag: iron deficiency without an obvious source mandates GI evaluation — don't just replace iron.

**TEACHING**
- **Principle** — Work the schema by its first branch (iron status), don't pattern-match "microcytic = iron deficiency."
- **The trap** — Replacing iron and stopping; iron deficiency in an adult is a *symptom* — the missed source (right colon cancer, celiac) is the diagnosis.
- **What would change the answer** — Inflammation → ferritin <100 + low TSAT still qualifies; normal RDW + high-normal RBC → thalassemia, stop iron; adult male/postmenopausal → GI workup regardless of diet.
- **Pearl** — Ferritin lies high but rarely low: a ferritin <30 is iron deficiency, full stop.
- **Check yourself** — 68M, Hgb 10.5, MCV 72, ferritin 45, CRP up, TSAT 9%. Iron deficient — and does the normal-ish ferritin let you skip the colonoscopy?

---

## Q3 — When do I anticoagulate atrial fibrillation, and with what?
**Retrieved (noise):** CHEST 2021 VTE

**ANSWER**
Decide with CHA₂DS₂-VASc, not rhythm pattern. Men ≥2 / women ≥3 → anticoagulate; men 1 / women 2 → individualize; men 0 / women 1 → none. Aspirin is NOT adequate. DOAC preferred over warfarin for nonvalvular AF: apixaban 5 BID (2.5 if ≥2 of age ≥80/≤60kg/Cr ≥1.5), rivaroxaban 20 with food, dabigatran 150 BID, edoxaban 60 (avoid if CrCl >95). Warfarin (INR 2–3) when DOAC contraindicated: mechanical valve, moderate-severe MS, triple-positive APS, severe renal. HAS-BLED flags modifiable risk — not to withhold therapy.

**TEACHING**
- **Principle** — Stroke risk tracks substrate (CHA₂DS₂-VASc), not rhythm burden; DOACs beat warfarin/aspirin (ARISTOTLE 2011, AVERROES 2011).
- **The trap** — Using HAS-BLED to withhold; it flags *modifiable* risk, and bleeding-risk factors raise stroke risk too.
- **What would change the answer** — Mechanical valve / mod-severe MS → warfarin only (DOACs harmful, RE-ALIGN 2013); CrCl extremes → dose-adjust; triple-positive APS → warfarin.
- **Pearl** — "Valvular" for DOAC means mechanical valve or rheumatic MS, not just any murmur.
- **Check yourself** — 82F, 55 kg, Cr 1.6, CHA₂DS₂-VASc 5, prior resolved GI bleed. Anticoagulate, which agent, what dose?

---

## Q4 — What oxygen saturation target in a COPD exacerbation?
**Retrieved (noise):** Wells/PERC (x2), SPRINT, NICE-SUGAR

**ANSWER**
Target SpO₂ 88–92%, titrating O₂ to stay in the window. Avoid liberal high-flow to ≥94–98% (worsens V/Q mismatch, Haldane effect, reduces drive → CO₂ retention, acidosis, arrest). ABG/VBG soon after starting O₂; recheck after FiO₂ changes. pH <7.35 with rising CO₂ despite controlled O₂ + therapy → BiPAP. If retainer status unknown, still target 88–92% in suspected COPD until ABG. Red flags: falling pH/rising CO₂/declining mentation → escalate; SpO₂ drifting >92% on O₂ → turn it down.

**TEACHING**
- **Principle** — O₂ is a dose-titrated drug with a therapeutic window; controlled O₂ beat high-flow with lower mortality (Austin pre-hospital RCT 2010).
- **The trap** — Maximizing SpO₂; pushing a retainer to 98% harms precisely because they look "better."
- **What would change the answer** — Confirmed non-retainer or alt pathology (PE, pneumonia, ACS, sepsis) → 94–98%; pH <7.35 with rising CO₂ → NIV.
- **Pearl** — In COPD, "the green light at 99%" is the warning light — turn the oxygen down.
- **Check yourself** — Known COPD, confused, SpO₂ 99% on 15L NRB, pH 7.22, PaCO₂ 78. Helping or hurting, and your first two moves?

---

## Q5 — When should I give tPA in acute ischemic stroke?
**Retrieved (noise):** Surviving Sepsis, SPRINT (x2), ARDSNet

**ANSWER**
IV thrombolysis (alteplase 0.9 mg/kg max 90, 10% bolus then 60 min; or tenecteplase 0.25 mg/kg bolus) for disabling deficits within 4.5h of last known well, after CT excludes hemorrhage and BP controlled. 0–3h standard; 3–4.5h with caution (age >80, NIHSS >25, anticoagulant, DM+prior stroke). Unknown onset/wake-up → consider if DWI-FLAIR mismatch. BP must be <185/110 before, <180/105 for 24h after. Contraindications: ICH, recent intracranial surgery/trauma/stroke <3mo, active bleeding, plt <100k, INR >1.7, recent DOAC/heparin. Confirm exact last-known-well; pursue thrombectomy for LVO in parallel.

**TEACHING**
- **Principle** — Time-since-last-known-well, not since-discovered; tissue-window imaging extends it (WAKE-UP 2018, DWI-FLAIR mismatch).
- **The trap** — Anchoring on when the deficit was *found* inflates the clock and disqualifies treatable patients.
- **What would change the answer** — DWI-FLAIR/perfusion mismatch → treat unknown-onset; BP uncontrollable <185/110 → defer; LVO on CTA → thrombectomy to 24h.
- **Pearl** — "Last-known-well, not last-known-sick."
- **Check yourself** — Normal at 10 PM, woke 6 AM with aphasia + right weakness, arrives 7 AM, NIHSS 12, CT no bleed. Outside the window — and what single image decides it?

---

## Q6 — How do I distinguish SIADH from other causes of hyponatremia?
**Retrieved:** CPS schemas

**ANSWER**
SIADH is a diagnosis of exclusion in a euvolemic, hypotonic patient with inappropriately concentrated urine — but work the volume-status branch first. (1) Confirm true hypotonic hyponatremia (serum osm <275; exclude pseudo and hyperglycemia). (2) Volume status: hypovolemic (dry, urine Na <20) / hypervolemic (edema) / euvolemic → SIADH territory. (3) SIADH criteria (all): euvolemia, osm <275, urine osm >100, urine Na >30–40, normal thyroid + cortisol, no diuretics/renal failure. Discriminators: urine osm separates polydipsia/beer potomania (<100) from SIADH (>100); urine Na separates hypovolemia (<20) from SIADH (>30). Always exclude hypothyroid and adrenal insufficiency.

**TEACHING**
- **Principle** — Hyponatremia is a tonicity-and-volume schema, not a sodium number (CPS schemas).
- **The trap** — Calling euvolemia "from across the room"; the exam is insensitive, so "looks euvolemic" quietly becomes "must be SIADH."
- **What would change the answer** — Urine osm <100 → polydipsia/beer potomania; thiazide on the list → stop it first; hypotension/hyperkalemia → cortisol (AI mimics SIADH exactly).
- **Pearl** — SIADH is the diagnosis you *earn* after firing the thyroid, adrenal, diuretic, and kidney — not the one you reach for first.
- **Check yourself** — Na 122, osm 268, urine osm 540, urine Na 45, no edema, orthostatic, K 5.3. Why is "SIADH, restrict fluids" the wrong move?

---

## Q7 — Should I give corticosteroids in septic shock?
**Retrieved:** Surviving Sepsis 2021 (x2)

**ANSWER**
Give IV hydrocortisone 200 mg/day when vasopressors are needed despite adequate fluids (SSC 2021) — practically NE ≥0.25 mcg/kg/min for ≥4h. 50 mg q6h or infusion; no ACTH stim test needed; wean when pressors off. Weak recommendation: speeds shock reversal/vasopressor weaning, inconsistent mortality (ADRENAL faster resolution no mortality change; APROCCHSS + fludrocortisone showed mortality benefit). Don't give for sepsis without shock or quickly-resolving shock. Watch hyperglycemia/hypernatremia.

**TEACHING**
- **Principle** — Steroids target *shock reversal*, not survival; reserve for catecholamine-refractory shock (SSC 2021; ADRENAL 2018 vs APROCCHSS 2018).
- **The trap** — Reflexive steroids for any sepsis/transient hypotension; benefit only in true pressor-dependent shock.
- **What would change the answer** — No shock/weaning → don't; persistent high-dose pressors → give; etomidate or chronic steroid use raises AI suspicion.
- **Pearl** — Steroids buy a faster off-ramp from pressors, not a longer life; APROCCHSS suggests fludrocortisone may be the silent partner.
- **Check yourself** — Fully resuscitated, NE 0.08 trending down at 2h, MAP 70. Steroids now or not, and why?

---

## Q8 — When should I image acute low back pain?
**Retrieved (noise):** Wells/PERC, PIOPED II (x2), SPRINT

**ANSWER**
Do not image in the first 6 weeks unless red flags. Default = no imaging (most resolve; early imaging worsens outcomes via incidental findings/labeling). Image (MRI preferred) for: cauda equina (retention, saddle anesthesia, bilateral weakness → emergent MRI); infection (fever, IVDU, bacteremia, immunosuppression → MRI + ESR/CRP); malignancy (cancer history, weight loss, night pain, age >50 → MRI); fracture (trauma, osteoporosis, steroids → X-ray then escalate); progressive deficit → MRI; suspected axial SpA (young, inflammatory features). No red flags → conservative, reassess; image only if failing 4–6 weeks AND a surgery/injection candidate.

**TEACHING**
- **Principle** — Same Bayesian sequencing as PE: set pretest probability of dangerous pathology before imaging (PIOPED II 2006).
- **The trap** — Imaging "to be safe" in the first 6 weeks; degenerative findings are near-universal false-positive anchors.
- **What would change the answer** — Cauda equina/progressive deficit → emergent MRI; infection/malignancy risk → MRI ± ESR/CRP; trauma/osteoporosis/steroids → plain films.
- **Pearl** — The MRI doesn't find the cause — it finds an excuse; image the red flag, not the back.
- **Check yourself** — 38yo, 3 weeks axial pain, normal strength, new urinary hesitancy + numbness wiping. Does the 6-week rule apply, and what do you order tonight?

---

## Q9 — Hypertensive emergency vs urgency?
**Retrieved (noise):** Surviving Sepsis, CHEST VTE, ARDSNet, RALES

**ANSWER**
Hinges on acute target-organ damage, not the number. Emergency: >180/120 WITH acute end-organ damage (encephalopathy, ICH/stroke, ACS, pulmonary edema, dissection, AKI, retinal hemorrhage, eclampsia) → IV agents, monitored. Lower MAP ≤10–20% in the first hour, then 5–15% over 23h (overcorrection → watershed ischemia). First-line: nicardipine, clevidipine, labetalol. Exceptions: dissection → SBP <120, HR <60 fast, β-blocker first; ischemic stroke → permissive to 220/120 (185/110 if lysing); eclampsia → labetalol/hydralazine/nifedipine + magnesium. Urgency: severe BP without organ damage → oral, outpatient; avoid sublingual nifedipine.

**TEACHING**
- **Principle** — End-organ damage, not the number, defines the emergency and mandates titratable IV therapy (ACC/AHA 2017).
- **The trap** — Treating the manometer; slamming asymptomatic BP down (or sublingual nifedipine) → iatrogenic watershed/coronary ischemia.
- **What would change the answer** — Dissection → SBP <120 + HR <60, β-block before vasodilator; ischemic stroke → permissive; eclampsia → + magnesium, deliver.
- **Pearl** — "Severe BP buys an ECG, troponin, creatinine, UA, and a neuro exam — not a nitroprusside drip."
- **Check yourself** — 58yo, 230/130, tearing chest pain to the back, 20 mm Hg interarm difference. Why is nicardipine alone wrong first, and what do you give first?

---

## Q10 — When is acute dialysis indicated in AKI?
**Retrieved (noise):** SPRINT, ARDSNet, PREPIC2, CHEST VTE

**ANSWER**
For refractory life-threatening complications — AEIOU: Acidosis (pH <7.1–7.15 refractory), Electrolytes (K⁺ >6.5 / refractory with ECG changes), Intoxications (methanol, ethylene glycol, salicylates, lithium, severe metformin lactic acidosis), Overload (refractory pulmonary edema), Uremia (pericarditis, encephalopathy, uremic bleeding). Don't dialyze on a number alone. Timing: for AKI without an emergent indication, AKIKI/IDEAL-ICU/STARRT-AKI show no benefit to early/preemptive start — watchful waiting while treating reversible causes. Modality: CRRT for hemodynamic instability (better tolerated, no mortality difference).

**TEACHING**
- **Principle** — Non-emergent dialysis timing is a competing-risk decision, not a creatinine reflex (STARRT-AKI 2020, AKIKI 2016: accelerated start no mortality benefit, added catheter/dependence harms).
- **The trap** — Dialyzing the number ("BUN 90, K 5.8, start") instead of a refractory complication; trades a recoverable kidney for line sepsis.
- **What would change the answer** — True AEIOU emergency → now; dialyzable poisoning → flips urgency *and* modality to HD; instability → CRRT for tolerance.
- **Pearl** — "You dialyze the patient, not the BUN" — watchful waiting is a treatment, not procrastination.
- **Check yourself** — Oliguric ATN day 3, K⁺ 5.4 (no ECG changes), BUN 85, pH 7.28, lungs clear, asymptomatic. Your move, and which single new finding makes you call renal tonight?
