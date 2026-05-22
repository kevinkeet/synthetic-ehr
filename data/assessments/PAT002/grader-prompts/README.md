# Grader prompts

One markdown file per assessment prompt (e.g. `ap1-q1.md`, `ap3-q4.md`) containing
the system prompt the live Claude grader uses to score the resident's response
against the rubric in the corresponding `ap*.json`.

These are intentionally empty in the Phase 3 scaffold. They are filled in during
Phase 2 content sessions, once the rubric items in each `ap*.json` are written.

Convention:
- Filename: `<assessmentId-lowercase>-<promptId-suffix-lowercase>.md`
  - e.g. `ap1.json` prompt `AP1-Q2` → `ap1-q2.md`
- The grader prompt should reference the matching rubric arrays by name
  (`essential`, `bonus`, `redFlags`, `shouldIdentify`, `shouldNotEcho`) and
  return JSON with the score breakdown shape declared in
  `supabase/migrations/001_assessment_schema.sql` (see
  `assessment_responses.score_breakdown`).
