# PAT002 Phase 3 — Assessment Framework Architecture

This document is the spec for the build session(s) that follow Phase 2 (chart content). The goal is a working assessment framework where residents log in, run through 5 scored assessments on Maria Sandoval's case, and admins can see the results.

**Design baseline** (from locked-in decisions in CASE-PLAN.md):
- Admin/proctor view: yes
- Per-user login required (Supabase Auth)
- Persistent attempts (pause/resume allowed; timer pauses too)
- AI sample outputs generated live
- Full chart access at all times (time-gating is via chart content itself)
- Per-assessment time limits

---

## 1. Data Model

### 1a. Supabase tables (new — see `supabase/migrations/001_assessment_schema.sql`)

```
test_attempts
├── id                  uuid PRIMARY KEY
├── user_id             uuid REFERENCES auth.users
├── case_id             text NOT NULL          -- e.g. "PAT002"
├── started_at          timestamptz NOT NULL DEFAULT now()
├── completed_at        timestamptz
├── status              text CHECK IN ('in_progress','completed','abandoned','expired')
├── total_score         numeric                -- 0.0-1.0, set on completion
├── current_assessment  text                   -- "AP1" | "AP2" | ... so we know where to resume
├── time_used_seconds   integer DEFAULT 0      -- accumulated; ticked while running
├── created_at          timestamptz DEFAULT now()
└── updated_at          timestamptz DEFAULT now()

assessment_responses
├── id                  uuid PRIMARY KEY
├── attempt_id          uuid REFERENCES test_attempts(id) ON DELETE CASCADE
├── assessment_id       text NOT NULL          -- "AP1" | "AP2" ...
├── prompt_id           text NOT NULL          -- "AP1-Q1" | "AP1-Q2" ...
├── response_text       text
├── score               numeric                -- 0.0-1.0, set after grading
├── score_breakdown     jsonb                  -- {essential: [...], bonus: [...], redFlags: [...]}
├── grader_notes        text                   -- Claude's grading rationale
├── time_spent_seconds  integer
├── submitted_at        timestamptz DEFAULT now()
└── UNIQUE (attempt_id, prompt_id)

assessment_ai_log
├── id                  uuid PRIMARY KEY
├── attempt_id          uuid REFERENCES test_attempts(id) ON DELETE CASCADE
├── assessment_id       text                   -- which AP was active
├── prompt_id           text                   -- which question (nullable)
├── query_text          text NOT NULL
├── response_text       text
├── context_size_chars  integer                -- how much chart they fed in
├── chart_sections      text[]                 -- which sections were visible/loaded
├── timestamp           timestamptz DEFAULT now()
└── INDEX (attempt_id, timestamp)

admin_roles
├── user_id             uuid PRIMARY KEY REFERENCES auth.users
├── role                text CHECK IN ('admin','proctor','resident')
├── granted_by          uuid REFERENCES auth.users
├── granted_at          timestamptz DEFAULT now()
└── notes               text
```

**RLS policies:**
- `test_attempts`: a user can read/write only their own rows. Admins can read all.
- `assessment_responses`: same — only owner can write; admins read.
- `assessment_ai_log`: same.
- `admin_roles`: only admins can read/write.

A small helper SQL function `is_admin(uid)` checks `admin_roles` and is reused across policies.

### 1b. Static case definition files (under `data/assessments/PAT002/`)

```
data/assessments/PAT002/
├── index.json          — case metadata, list of assessment ids in order, total time, version
├── ap1.json            — Assessment Point 1 definition
├── ap2.json
├── ap3.json
├── ap4.json
├── ap5.json
└── grader-prompts/     — system prompts used to score each prompt type
    ├── differential.md
    ├── context-curation.md
    ├── ai-output-evaluation.md
    └── management.md
```

#### Assessment file schema (`apN.json`)

```jsonc
{
  "id": "AP1",
  "order": 1,
  "title": "Initial urgent care presentation",
  "anchorDate": "2026-01-12",      // chart state cutoff
  "timeLimitMinutes": 15,
  "scenarioBrief": "Maria Sandoval just left the urgent care visit you see in NOTE001. You are her hypothetical PCP who reviewed her chart afterward. The hospital is sending you the urgent care records. Begin your evaluation.",
  "chartGate": {
    "_explanation": "Specifies which chart content is visible at this assessment. Future content (later notes, labs, etc.) is hidden from the chart navigation UI and from the AI's context.",
    "includeBeforeOrEqualDate": "2026-01-12T23:59:59Z"
  },
  "prompts": [
    {
      "id": "AP1-Q1",
      "order": 1,
      "type": "differential",
      "question": "What is your top differential diagnosis for Maria? List 3-6 conditions and briefly justify each. You may use the AI assistant to help you reason through this.",
      "expectedResponseFormat": "free_text",
      "minLength": 100,
      "rubric": {
        "essential": [...],
        "bonus": [...],
        "redFlags": [...]
      },
      "weight": 1.0
    },
    {
      "id": "AP1-Q2",
      "type": "context-curation",
      "question": "Take a screenshot or describe: what specific chart sections did you give the AI when generating your differential, and why those?",
      "expectedResponseFormat": "free_text",
      "rubric": {...},
      "weight": 0.7
    },
    {
      "id": "AP1-Q3",
      "type": "ai-output-evaluation",
      "_aiPromptToGenerate": "Generate a confident, well-written differential for this case that anchors heavily on SLE based on the 1:80 ANA, mentions a couple of other CTDs in passing, and DOES NOT mention parvovirus, viral arthropathy, or disseminated TB. Tone: authoritative attending.",
      "question": "Here is an AI response to a question about this patient's diagnosis. Evaluate it: what is good, what is missing, what (if anything) is wrong?",
      "expectedResponseFormat": "free_text",
      "rubric": {
        "shouldIdentify": [
          "Missing viral arthropathy (parvovirus, hep B/C)",
          "Over-confident in SLE despite low-titer ANA",
          "Does not address the subclinical hypothyroidism finding",
          "Does not consider disseminated TB given patient's background"
        ]
      },
      "weight": 1.0
    }
  ],
  "totalWeight": 2.7,
  "passingScorePct": 70
}
```

#### Index file (`index.json`)

```jsonc
{
  "caseId": "PAT002",
  "caseTitle": "Maria Sandoval — Polyarthritis with hair loss",
  "patientId": "PAT002",
  "version": "1.0.0",
  "totalTimeLimitMinutes": 85,
  "assessments": ["AP1", "AP2", "AP3", "AP4", "AP5"],
  "passingOverallScorePct": 70,
  "description": "5-assessment diagnostic and management simulation testing resident-AI collaboration on a complex multisystem case.",
  "warning": "Do not begin unless you can dedicate at least 90 minutes uninterrupted."
}
```

---

## 2. Code Architecture

### 2a. New service modules

`js/services/assessment-engine.js` — central state machine for an active test attempt.
- `start(caseId)` → creates a `test_attempts` row, returns attemptId
- `getCurrent()` → returns active attempt + current assessment + current prompt
- `submitResponse(promptId, text)` → saves to `assessment_responses`, triggers grading
- `advanceToNext()` → moves cursor to next prompt or next assessment
- `pause()` / `resume()` → toggles timer
- `abandon()` → marks attempt as abandoned
- `complete()` → finalizes scoring, marks completed

`js/services/assessment-data.js` — loads case + assessment definitions from `data/assessments/`.
- `loadCase(caseId)` → returns `{caseMeta, assessments: [ap1, ap2, ...]}`
- `getAssessment(caseId, apId)` → single assessment
- `getPrompt(caseId, apId, promptId)` → single prompt

`js/services/assessment-grader.js` — uses Claude to score free-text responses against rubrics.
- `grade(prompt, responseText)` → returns `{score: 0.0-1.0, breakdown: {essential: [hit, missed], bonus: [...], redFlags: [...]}, notes: "..."}`
- Sends a structured grader prompt to Claude with the rubric + resident's response
- For `ai-output-evaluation` prompts: also generates the AI sample to evaluate first, then grades the resident's evaluation against the rubric of what they should identify

`js/services/assessment-logger.js` — intercepts AICoworker calls during an active test and logs them to `assessment_ai_log`.
- Hooks into `AICoworker.callLLM`, `callLLMStreaming`, `callLLMWithTools`
- Records: query text, model, response, timestamp, current AP/prompt, approximate context size
- Also records chart-navigation events (which sections were viewed, which notes opened) — feeds into the post-test analysis

`js/services/assessment-chart-gate.js` — filters chart data based on the current AP's `anchorDate`.
- Wraps `dataLoader` to hide future notes/labs/etc.
- When the resident advances assessments, the gate moves forward
- For the AI's working memory: the `assembleForInteraction` etc. methods need to respect the gate too

### 2b. New UI components

`js/components/assessment-panel.js` — the test-taking UI.
- Replaces the AI panel during active test mode (or coexists?)
- Shows current assessment title, scenario brief, prompts one at a time
- Free-text response box with min-length validation
- Visible timer
- "Submit & Continue" button advances
- "Pause" button (stops timer, blurs questions)
- Indicator at top showing assessment progress (1/5, 2/5, etc.)

`js/components/admin-dashboard.js` — admin view at `#/admin/attempts`.
- Lists all attempts with filters (user, case, status, date range, score)
- Click row to drill into details
- Detail view shows: per-prompt response + score + AI usage log + chart navigation log
- Aggregate view: distributions of scores, common mistakes, AI usage patterns

`js/components/assessment-start.js` — landing page at `#/assessment/start`.
- Lists available cases (read from `data/assessments/index.json`)
- Shows resumed attempts (if any in_progress)
- "Begin" button creates a new attempt

`js/components/assessment-results.js` — post-test report at `#/assessment/results/:attemptId`.
- Total score
- Per-assessment breakdown
- Per-prompt details: response, score, what was missed
- The diagnosis is revealed here (Maria's full story + the dual diagnosis)
- AI usage analysis ("you asked the AI 'what's the diagnosis' 4 times — try framing as 'what unifies these findings?'")
- Sharable via permalink (subject to admin policy)

### 2c. Routes (add to `js/app.js` setupRoutes)

```javascript
.on('/assessment/start', () => AssessmentStart.render())
.on('/assessment/run', () => AssessmentPanel.renderActive())
.on('/assessment/results/:id', (params) => AssessmentResults.render(params.id))
.on('/admin/attempts', () => AdminDashboard.renderList())
.on('/admin/attempts/:id', (params) => AdminDashboard.renderDetail(params.id))
```

All `/admin/*` routes guard-check `await isAdmin(currentUser)` first.

### 2d. Index.html script tags

Add (in order):
```html
<script src="js/services/assessment-data.js"></script>
<script src="js/services/assessment-chart-gate.js"></script>
<script src="js/services/assessment-logger.js"></script>
<script src="js/services/assessment-grader.js"></script>
<script src="js/services/assessment-engine.js"></script>
<script src="js/components/assessment-start.js"></script>
<script src="js/components/assessment-panel.js"></script>
<script src="js/components/assessment-results.js"></script>
<script src="js/components/admin-dashboard.js"></script>
```

### 2e. Entry point

A new sidebar nav entry or top-bar link "Take Assessment" (visible only when logged in). Clicking it routes to `#/assessment/start`.

For admins, an additional link "Admin" appears.

---

## 3. Scoring approach

### 3a. Live grading via Claude

For each `differential`, `context-curation`, and `management` prompt:

```
System prompt to grader (e.g., grader-prompts/differential.md):
  You are an expert clinical educator grading a resident's response.
  Score against the rubric provided. Return JSON:
  { score: 0.0-1.0,
    breakdown: { essential_hit: [...], essential_missed: [...],
                 bonus_hit: [...], red_flags_triggered: [...] },
    notes: "1-2 sentence grading rationale, no diagnosis spoilers."
  }
  Do NOT reveal the final case diagnosis in your feedback.

User message:
  PROMPT: <the question>
  RUBRIC: <the rubric JSON>
  RESIDENT RESPONSE: <free text>
```

Score formula:
- Each essential item: 1.0 / (essential count)
- Each bonus item: 0.25 bonus weight, capped at +0.2 total
- Each red flag triggered: -0.15

This is encoded in the grader's system prompt so Claude returns a final number consistently.

### 3b. For `ai-output-evaluation` prompts

Two-step:
1. **Generate** the sample AI output to evaluate, using a system prompt that produces a deliberately mediocre/anchoring response.
2. **Grade** the resident's critique against the rubric of `shouldIdentify` items they were supposed to notice.

The generated AI output is stored in `assessment_responses` alongside the resident's response so admins can see exactly what they were critiquing.

### 3c. Final score

```
overallScore = sum(prompt_score * prompt_weight) / sum(prompt_weight)
```

Per-assessment scores roll up similarly. Pass/fail is at the overall level, not per-assessment.

---

## 4. AI usage logging — central to the value

This is the most important part of the framework, since the whole point is to assess **how** residents use AI, not just whether they get the right answer.

`assessment-logger.js` monkey-patches `AICoworker.callLLM` (and friends) at test start. Every call captures:
- `query_text`: the system prompt + user message Claude saw
- `response_text`: Claude's response
- `context_size_chars`: size of the user message (proxy for context dump)
- `chart_sections`: list of sections the resident had visible in the chart UI at the time
- `timestamp` and `prompt_id` (the active assessment prompt at the time)

The post-test report uses these to compute:
- **Context discipline**: did the resident curate context, or repeatedly dump the entire chart?
- **Prompt framing diversity**: did they iterate on framing or repeat the same question verbatim?
- **Hallucination catches**: did they ask follow-up questions when the AI's answer didn't fit the data?
- **Tool use**: did they use search_notes / get_note / search_labs etc., or rely only on memory document?

These factor into qualitative feedback but not the numeric score — the numeric score is purely on response correctness vs rubric.

---

## 5. UX flow (resident perspective)

1. Resident lands on actingintern.com
2. Clicks "Take Assessment" → routed to `#/assessment/start`
3. Prompted to log in via Supabase Auth (existing modal). Account creation supported.
4. Sees the available case (Maria Sandoval) with description, warning, total time
5. Clicks "Begin Assessment"
6. Patient auto-switches to PAT002. Chart gate active at AP1 anchor date. Timer starts at 15 minutes.
7. Right-side AI panel works normally (AI usage is silently logged)
8. Assessment panel shows prompt 1: "What is your top differential?"
9. Resident reads chart, uses AI as desired, writes response
10. Click "Submit & Continue" → response sent to grader (Claude scores it in background), advances to prompt 2
11. Continues through all prompts in AP1 → click "Finish AP1, advance to AP2" → chart gate moves to next anchor date (new notes, labs become visible), new timer starts
12. Repeats through AP1-AP5
13. After AP5: scoring report renders at `#/assessment/results/:id` with full diagnosis revealed
14. Resident can share permalink with their training director

If resident closes the browser mid-test:
- Attempt is preserved in `in_progress` status
- On next login, they see "Resume in-progress attempt" option
- Timer resumes from where it paused (we save `time_used_seconds` on every prompt submit)

---

## 6. UX flow (admin perspective)

1. Admin logs in via Supabase Auth
2. Sees "Admin" link in top bar (only visible if `is_admin(user) = true`)
3. Clicks → routed to `#/admin/attempts`
4. Sees table of all attempts with filters
5. Clicks an attempt → drill-in view shows the full transcript: each prompt, the resident's response, the score, the rubric breakdown, the AI conversation log (every query they made), the chart sections they visited
6. Optional aggregate analytics view shows distributions: average score per AP, most-missed essentials, common AI usage anti-patterns

---

## 7. Open implementation decisions (to confirm before building)

- **Should the AI panel itself remain available during assessments?** Default: yes. This is the whole point.
- **Should we display the resident's score after each prompt, or only at the end?** Default: only at the end (less anxiety-inducing, more realistic).
- **Should the resident see the rubric after the test or just their score?** Default: yes — the resident sees the full rubric in the results view, since they've already completed the test.
- **Should re-attempts be allowed?** Default: yes, but new attempt = new row. Admin can see all attempts per resident.
- **Should we offer "practice mode" with no scoring and hints?** Default: out of scope for v1.

---

## 8. Build order for the next session

1. Run the SQL migration on Supabase to create the 4 tables + RLS policies
2. Bootstrap one admin (probably your own user_id)
3. Build `assessment-data.js` (loads JSON, no DB calls — easiest first)
4. Build `assessment-chart-gate.js` (wraps dataLoader, filters by date)
5. Build `assessment-logger.js` (monkey-patches AICoworker)
6. Build `assessment-grader.js` (calls Claude, returns scores)
7. Build `assessment-engine.js` (coordinates everything; talks to Supabase)
8. Build `assessment-start.js` + `assessment-panel.js` (the resident UX)
9. Build `assessment-results.js` (the report)
10. Build `admin-dashboard.js`
11. Wire routes + nav links

Roughly 2-3 sessions of focused work depending on how much chart content from Phase 2 is in place.

---

## 9. What we still need from Phase 2 before Phase 3 is usable

Phase 3 framework can be **scaffolded** without Phase 2 content (using placeholder data), but to actually run a meaningful assessment we need at least:

- AP1 chart state: NOTE001 (done) + LAB001-006 (done) — ✅ ready
- AP2 chart state: notes + labs through Nov 2026 — needs Era 6-7 content
- AP3 chart state: admission day 1 — needs Era 8 content
- AP4 chart state: admission day 7 — needs Era 9 content
- AP5 chart state: discharge + follow-ups — needs Era 10-11 content

Realistic order: build Phase 3 framework with AP1 fully usable for demos/testing, then incrementally fill in Phase 2 content to unlock APs 2-5.
