-- 003_code_based_select.sql
--
-- Fix: anonymous (access-code) participants could insert a test_attempts row,
-- but could NOT insert assessment_responses / assessment_ai_log rows. Those
-- INSERT policies (migration 002) gate on an EXISTS check against the parent
-- test_attempts row — and anon had no SELECT policy on test_attempts, so the
-- EXISTS evaluated false and the insert was rejected by RLS.
--
-- This migration adds SELECT policies for code-based (anonymous) rows on all
-- three tables. That (a) lets the child-insert EXISTS checks pass, and
-- (b) enables cross-session RESUME and read-back of a participant's own data.
--
-- Privacy note: this allows the anon role to read code-based rows (user_id IS
-- NULL). Acceptable here — all patient data is synthetic and rows are keyed by
-- opaque access codes. Authenticated admins/proctors continue to read all rows
-- via the existing is_admin() policies. Idempotent: safe to re-run.

-- ── test_attempts: allow reading code-based rows ──────────────────────────
DROP POLICY IF EXISTS p_test_attempts_select_code ON public.test_attempts;
CREATE POLICY p_test_attempts_select_code
    ON public.test_attempts
    FOR SELECT
    USING (user_id IS NULL);

-- ── assessment_responses: allow reading rows under a code-based attempt ────
DROP POLICY IF EXISTS p_assessment_responses_select_code ON public.assessment_responses;
CREATE POLICY p_assessment_responses_select_code
    ON public.assessment_responses
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.test_attempts t
            WHERE t.id = assessment_responses.attempt_id
              AND t.user_id IS NULL
        )
    );

-- ── assessment_ai_log: allow reading rows under a code-based attempt ───────
DROP POLICY IF EXISTS p_assessment_ai_log_select_code ON public.assessment_ai_log;
CREATE POLICY p_assessment_ai_log_select_code
    ON public.assessment_ai_log
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.test_attempts t
            WHERE t.id = assessment_ai_log.attempt_id
              AND t.user_id IS NULL
        )
    );
