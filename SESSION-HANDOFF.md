# Acting Intern — Session Handoff / Working Doc

Living status doc so work can resume in a fresh session. Repo:
`/Users/kevinkeet/Documents/Claude applications folder/synthetic-ehr` (actingintern.com, GitHub Pages).

## How the app works (fast facts)
- Vanilla HTML/JS/CSS, **no build system**. `index.html` loads all scripts; `js/router.js` hash routing.
- **Two git remotes — push BOTH after every commit:** `git push origin main && git push shared main`.
- **Cache busting:** every `<script>/<link>` in `index.html` uses `?v=YYYYMMDD[suffix]`. Bump it (search/replace all + `window.__CACHE_V`) whenever you change **JS or CSS**. **Data JSON under `data/` is NOT cache-busted** — edits take effect on reload. Current version: **`20260722c`**.
- **Access gate password:** `0slerian` → PBKDF2 → decrypts the embedded Anthropic key into localStorage. Never log/commit the decrypted key.
- **The shared Anthropic API key repeatedly runs OUT OF CREDITS** (Opus runs burn it fast). When it does, the live assessment (chat + grading) is DOWN. Only the user can top it up.
- **Supabase** project (`piwoinyrlicvndpsmtde`) auto-pauses on free tier; resume from the dashboard before use.
- **Live testing:** the Claude Preview MCP drives a local dev server (`ehr-dev` in `.claude/launch.json`). To reach the assessment runner programmatically: `UserCode.set('X'); ModeManager.set('assessment',{navigate:false}); await AssessmentEngine.start('PAT00N'); location.hash='#/assessment/run'; router.handleRoute();` then hide `#access-gate-overlay` for screenshots.

## The study (why this exists) — ASSESSMENT IS THE ONLY IN-SCOPE FEATURE
**Goal:** measure a resident's ability to use AI to solve clinical tasks. This assessment will be paired with an educational intervention that only some residents receive; we then compare performance across arms to see if their performance improves (an RCT). **Premise:** we use validated cases with validated scoring rubrics (from prior work) and have built a synthetic EHR around them to create a realistic, real-world clinical environment.
**Scope:** the app is dual-purpose today (Assessment / AI Tutor / AI Assistant modes), **but for the study only the ASSESSMENT mode is used — the Tutor and Assistant modes will be HIDDEN in the study deployment.** Focus all work on the assessment component: cases PAT002–PAT007, the context-bounded chatbot, the grader, and Supabase logging. Do not invest in Tutor/Assistant unless asked.
Flow: participants take a timed, chart-gated case, answer each prompt in their own words (informed by the context-bounded chatbot), LLM-graded against the rubric, logged to Supabase.
**Central finding from simulations this session:** on the current rubrics, naive **copy-paste beats skilled prompting** — even Opus-as-a-trained-resident (knowledge-suppressed) did NOT beat copy-paste, and multi-turn "challenge/steelman" often *lowered* scores. Root cause: rubrics reward **coverage/enumeration**, which a strong model supplies for free; they're blind to the judgment the training teaches. This is an instrument problem, not (only) a training-effect problem. (Full analyses delivered as Word docs in `~/Downloads/`.)

## Case ↔ patient ↔ source-rubric map
| Case | Patient | Topic | Source rubric docx (in ~/Downloads) |
|---|---|---|---|
| 1 | PAT003 Nguyen | lung nodule (Delphi) | "Management Cases 1-5.docx" (Case #1 section) |
| 2 | PAT004 Bell | PE + liver mass + IVC | "Case 2 Rubric (Management Case 1 renamed).docx" |
| 3 | PAT005 Whitlock | cirrhosis / FFP / drainage | "Case 3 Rubric.docx" |
| 4 | PAT006 Pierce | post-op AF | "Case 4 Rubric.docx" |
| 5 | PAT007 Brooks | drug fever / TIPS | "Case 5 Rubric draft.docx" |
PAT002 (Sandoval, SLE/NEJM) has NO source docx rubric — graded by the older essential/bonus format; out of scope for "prior-study fidelity."

## Grading mechanism (IMPORTANT)
`js/services/assessment-grader.js`: `grade()` uses the **points path** (`prompt.scoringRubric.rubricText` + `maxPoints`, awards points per the rubric's own rules) whenever `scoringRubric.rubricText` exists; otherwise falls back to an **essential/bonus formula** (`hits/count + 0.08/bonus cap +0.20 − 0.15/redflag`) that CANNOT reproduce docx points.
- **Points-graded (docx-faithful): PAT003, PAT004, PAT005, PAT006, PAT007** (as of the rubric-fidelity fixes below).
- **Essential/bonus only: PAT002.**

## DONE this session (high level)
- **Security/RCT hardening:** grader prompt-injection delimiting; stopped syncing the API key to Supabase; `claude-api.js` logs `error.message` only; **Supabase migration `004_scope_code_based_access.sql` applied LIVE** (scopes anon SELECT/UPDATE to an `x-participant-code` header via a custom fetch wrapper in `supabase-sync.js`) — closed the "any participant reads all rows" hole.
- **RCT data-loss fixes:** offline write-retry queue in `assessment-engine.js`; `complete()` merges in-memory rows so a failed SELECT can't zero the score; draft autosave + `beforeunload` guard + SYNCING indicator in `assessment-panel.js`.
- **Loader robustness:** `data-loader.js` treats `problems/resolved.json` & `medications/historical.json` as OPTIONAL (404 → empty); added the two missing PAT003 files (that bug broke the Problem List / Meds tabs during assessment).
- **Assessment runner UI rebuilt:** chart is full-height on the left (`#main-content`); a persistent right-rail **dock** (attached to `<body>`) holds the timer/progress bar + **tabbed panel: "Your Answer" / "AI Assistant"** (the chatbot `<aside>` is relocated into the rail). Single reservation: `body.assessment-dock-open .main-container { margin-right: var(--arail) }` (do NOT also pad `#main-content` — that double-squeezes the chart, which broke the Notes viewer). Compact 2-row bar. Removed the collapse toggle.
- **Removed the minimum-character-count** on answers (all questions): dropped the `_submitCurrent` gate + UI, zeroed 32 `minLength` fields.
- **PAT003 (Nguyen) content audit:** fixed smoking contradiction (NOTE_HX_001 current-smoker → quit-2004), brother lung-cancer death year (family_history 2018 → 2026), and the screening-history note. Nodule on problem list (PRB013) is INTENTIONAL — left as-is.
- **RUBRIC-FIDELITY RECONCILIATION (validity-critical), just committed:**
  - **PAT003:** added points `scoringRubric` to all 5 Qs encoding the **Delphi 6/9/11/7/3 = 36** (with the two-of-three / one-of-two / two-of-four partial-credit groups). Now points-graded.
  - **PAT004 AP2-Q5:** un-merged the IVC-in-this-case question back into the docx's THREE prompts — `AP2-Q5a` (decision 5, Yes-keyed), `AP2-Q5b` (arguments FOR 3), `AP2-Q5c` (arguments AGAINST 3), + `AP2-Q6` (8). Both reasoning sides now scored regardless of stance (fixes the "No answer capped at 3/8" problem the user hit).
  - **PAT005 AP2-Q4:** split fused PleurX+TIPS into `AP2-Q4` (PleurX 4) + `AP2-Q4b` (TIPS 4).
  - **PAT005 AP3-Q5:** realigned to the docx PRE-transplant framing — anchor moved to `2027-07-05`, scenario/stem rewritten, **added NOTE010** (pre-transplant improvement note) so the chart supports it, removed the stale transplant-physiology `rubric` block. Kept the docx 5-item `scoringRubric`.
  - Left faithful as-is: PAT006 monitor sub-parts and PAT004 1a/1b (sub-parts of a single docx question).
  - Verified point totals: PAT003=36, PAT004=71, PAT005=27, PAT006=23, PAT007=78.5; all Qs points-graded.

## DONE 2026-07-22
- **Chart Review "Latest Vitals" widget fix:** it only read the legacy `{systolic, diastolic, spO2}` vitals shape, but ALL study cases (PAT003–007) use `{bloodPressure: "112/70", oxygenSaturation}` — so every assessment case's chart landing page showed "undefined/undefined mmHg" / "undefined%". `chart-review.js renderVitalsWidget` now normalizes both shapes (mirrors `vitals.js`). Verified live on PAT005 (116/72 mmHg, 99%). Cache bumped to `20260722`.
- Note: two abandoned test attempts under participant code `CLAUDEVERIFY` may exist in Supabase (or died in the offline queue) from the live verification — ignore/delete.

## PENDING / NEXT
1. **Cleanup pass — DONE.** `assessment-results.js._renderRubric` now prefers `scoringRubric.rubricText` (falls back to essential/bonus only when there's no scoringRubric). Deleted the stale `rubric` block from all 22 points-graded prompts (PAT003–007). PAT002 keeps its 5 essential/bonus rubrics (they ARE its grader). `admin-dashboard.js` does not render rubrics. Final: PAT003=5, PAT004=8, PAT005=7, PAT006=4, PAT007=6 scoringRubrics, 0 legacy blocks; PAT002=5 legacy.
2. **Live-verify the rubric-fidelity fixes — DONE (2026-07-22)** except one piece: verified live that the PAT004 3-part IVC split (Q5a 5 / Q5b 3 / Q5c 3 / Q6 8) renders and flows end-to-end; PAT005 AP2-Q4→Q4b→AP3 flows; **PAT005 AP3 at anchor 7/05 shows NOTE010 (6/25) and hides NOTE008 (7/19 transplant) + NOTE009**; AP3 stem shows the pre-transplant rewrite. Point totals re-verified from data: 36/71/27/23/78.5, 0 legacy rubric blocks on PAT003–007. PAT003 points-path grading confirmed statically (grader branches on `scoringRubric.rubricText`, present on all 5 Qs) — **an actual end-to-end grade call still needs the access gate unlocked + API credits** (tooling can't enter the password).
3. **Bell (PAT004) content audit — Q2–Q6 + chart consistency DONE (2026-07-22).** Fixed: (a) **pain/infarct laterality** — chart said pleuritic LEFT pain + LEFT wedge opacity but the PE is RIGHT lower lobe; moved both to the right (NOTE001, IMG001, PRB001, ENC001, vitals context); (b) **note timestamps** — NOTE001 (10:00) cited the 16:30 TTE → moved to 17:30; NOTE008 (11:00) cited the 11:45 CTA/12:30 TTE → moved to 14:00 (+ notes index synced); (c) **LAB004 aPTT 68 "therapeutic on heparin"** drawn at 11:00, before the 11:15 heparin order → now baseline 31 pre-heparin; (d) ED-arrival vitals row moved 14:00→08:15; (e) AP2 scenarioBrief no longer implies apixaban started a month post-discharge. **App-wide fixes found via this audit:** header/dropdown patient AGE was computed from the wall clock (Bell showed 42y vs the notes' 43) → `DateUtils.calculateAge` now uses the chart-gate anchor, the switcher uses each case's default anchor, and `_applyDefaultGate` runs before the header renders; date-only strings (DOBs) were parsed as UTC and displayed one day early → `DateUtils.parseLocal`. Verified all 6 cases' anchor ages match the ages written in their notes. **FLAGGED, not changed (Kevin to decide):** (i) NOTE001 exam says "no hepatomegaly, no palpable mass" despite the 17 cm right-lobe mass — consider hedging the exam line; (ii) AP2-Q5b rubric item d says "large, hemodynamically significant PE" while the chart consistently says hemodynamically stable/submassive — left for source-docx fidelity; (iii) the IR 3-day apixaban hold vs Q3's 48-h key looks INTENTIONAL (the trap explaining the recurrence; IR note hidden at TP1) — left as-is; (iv) ap-level `totalWeight`/`passingScorePct` JSON fields are dead (engine weights by per-prompt maxPoints) — harmless, left.
4. **Human-synthesizer re-test** (needs credits): the "does skilled multi-turn help" question is confounded because the simulated resident was an LLM. Real answer needs a human (or the recorded transcripts) writing the final answer — especially on PAT007 (the drug-fever trap case, the missing data point).
5. **Hide the non-assessment modes for study deployment — DONE (2026-07-22).** `mode-manager.js` now boots in a **study lock** by default: no landing chooser (straight into Assessment), no top-bar switcher, `set('tutor'/'assistant')` and the `#/tutor` deep link forced back to assessment, stored tutor/assistant choices overwritten on boot. Tutor/Assistant code is untouched — **to restore all three modes in a browser, load the site once with `?allmodes` in the URL** (persists via localStorage key `all-modes-unlocked`); **`?studymode` locks it back**. Verified live both directions. Cache `20260722a`.
6. **Instrument redesign discussion** (deferred by validity choice): user wants grading identical to prior studies, so the "reward judgment over coverage" changes are OFF the table for now. Any future scoring changes must preserve comparability.

## Answered clinical question (for the record)
"Is there evidence for waiting ~a month to biopsy in a patient with suspected cancer + new VTE?" — Yes; the highest VTE-recurrence risk is the first ~month, so elective procedures are generally deferred ≥1 month (ideally 3) after acute VTE; the docx keys "4–6 weeks." (Case 2 / PAT004 Q1.)

## Deliverable docs produced (in ~/Downloads)
- "Management Cases 1-5 — Origin, Questions & Rubrics.docx"
- "Patient Memory Learn Prompts.docx"
- "Acting Intern — Prompting-Skill Discrimination Analysis.docx" (single-turn)
- "Acting Intern — Prompting-Skill Analysis (multi-turn).docx"

## Key files
- `js/services/assessment-grader.js` — grading (points vs essential/bonus).
- `js/services/assessment-engine.js` — attempt lifecycle, offline queue, scoring.
- `js/components/assessment-panel.js` — the runner (dock + tabs).
- `js/components/assessment-chatbot.js` — the context-bounded AI panel.
- `js/services/assessment-chart-gate.js` — date-filters the chart by timepoint anchor.
- `js/data-loader.js` — chart data fetch.
- `css/epic-theme.css` — all styles (assessment dock CSS near the `.assessment-dock` block).
- `data/assessments/PAT00N/{index,ap*}.json` — questions + rubrics.
- `supabase/migrations/004_scope_code_based_access.sql` — the applied RLS fix.
