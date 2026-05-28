-- =========================================================================
-- Migration 002: Add user_code identity for resident attempts
--
-- Lets residents take assessments by picking a self-chosen code (no Supabase
-- signup required). Admin still authenticates via Supabase (via admin_roles).
--
-- Run this in the Supabase SQL editor after 001_assessment_schema.sql.
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. Add user_code column + make user_id nullable
-- -------------------------------------------------------------------------
ALTER TABLE public.test_attempts ADD COLUMN IF NOT EXISTS user_code TEXT;
ALTER TABLE public.test_attempts ALTER COLUMN user_id DROP NOT NULL;

-- We require AT LEAST ONE identity on every row: either a real Supabase user
-- (for backwards-compat with old auth-based attempts) OR a user_code.
ALTER TABLE public.test_attempts
    DROP CONSTRAINT IF EXISTS test_attempts_identity_required;
ALTER TABLE public.test_attempts
    ADD CONSTRAINT test_attempts_identity_required
    CHECK (user_id IS NOT NULL OR user_code IS NOT NULL);

-- Normalize stored codes: trim whitespace, convert to upper-snake-like
-- (the JS layer enforces this too, but a constraint here gives us belt+suspenders).
ALTER TABLE public.test_attempts
    DROP CONSTRAINT IF EXISTS test_attempts_user_code_shape;
ALTER TABLE public.test_attempts
    ADD CONSTRAINT test_attempts_user_code_shape
    CHECK (user_code IS NULL OR user_code ~ '^[A-Za-z0-9_-]{3,32}$');

CREATE INDEX IF NOT EXISTS idx_test_attempts_user_code
    ON public.test_attempts(user_code, started_at DESC)
    WHERE user_code IS NOT NULL;

COMMENT ON COLUMN public.test_attempts.user_code IS
    'Self-chosen resident identifier (3-32 chars, alphanumeric + _ -). Used in place of user_id for code-based logins. At least one of user_id, user_code must be set per row.';

-- -------------------------------------------------------------------------
-- 2. Relax INSERT / UPDATE policies on test_attempts to allow anon code-based
--    attempts. Admin SELECT policy unchanged.
-- -------------------------------------------------------------------------
DROP POLICY IF EXISTS p_test_attempts_owner ON public.test_attempts;

-- Insert: allow EITHER (a) authed user inserting their own row, OR
--                       (b) anyone (anon or authed) inserting a code-based row.
CREATE POLICY p_test_attempts_insert ON public.test_attempts
    FOR INSERT
    WITH CHECK (
        (auth.uid() IS NOT NULL AND user_id = auth.uid())
        OR (user_id IS NULL AND user_code IS NOT NULL)
    );

-- Update: same — authed user updating their own, OR anyone updating a
-- code-based row (the worst case here is one trusted user accidentally
-- editing another trusted user's attempt, which is acceptable for a
-- small-group demo).
CREATE POLICY p_test_attempts_update ON public.test_attempts
    FOR UPDATE
    USING (
        (auth.uid() IS NOT NULL AND user_id = auth.uid())
        OR (user_id IS NULL AND user_code IS NOT NULL)
    )
    WITH CHECK (
        (auth.uid() IS NOT NULL AND user_id = auth.uid())
        OR (user_id IS NULL AND user_code IS NOT NULL)
    );

-- Select: authed user reads their own; admin reads all; anon code-based
-- residents read only THEIR OWN attempts (matched by user_code stored in
-- localStorage; not RLS-enforceable since we don't have a session — they get
-- their own results back via the engine's in-memory state after submission).
CREATE POLICY p_test_attempts_select ON public.test_attempts
    FOR SELECT
    USING (
        (auth.uid() IS NOT NULL AND user_id = auth.uid())
        OR public.is_admin(auth.uid())
    );

-- Delete: admin only.
DROP POLICY IF EXISTS p_test_attempts_admin_delete ON public.test_attempts;
CREATE POLICY p_test_attempts_admin_delete ON public.test_attempts
    FOR DELETE USING (public.is_admin(auth.uid()));

-- -------------------------------------------------------------------------
-- 3. Same pattern for assessment_responses + assessment_ai_log: anon code-based
--    inserts allowed when the parent attempt has user_code (no user_id).
-- -------------------------------------------------------------------------
DROP POLICY IF EXISTS p_assessment_responses_owner ON public.assessment_responses;

CREATE POLICY p_assessment_responses_insert ON public.assessment_responses
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.test_attempts a
            WHERE a.id = assessment_responses.attempt_id
              AND (
                  (auth.uid() IS NOT NULL AND a.user_id = auth.uid())
                  OR (a.user_id IS NULL AND a.user_code IS NOT NULL)
              )
        )
    );

CREATE POLICY p_assessment_responses_update ON public.assessment_responses
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.test_attempts a
            WHERE a.id = assessment_responses.attempt_id
              AND (
                  (auth.uid() IS NOT NULL AND a.user_id = auth.uid())
                  OR (a.user_id IS NULL AND a.user_code IS NOT NULL)
              )
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.test_attempts a
            WHERE a.id = assessment_responses.attempt_id
              AND (
                  (auth.uid() IS NOT NULL AND a.user_id = auth.uid())
                  OR (a.user_id IS NULL AND a.user_code IS NOT NULL)
              )
        )
    );

-- SELECT policy already exists for admin; resident SELECT is via parent
-- attempt's existing logic.

DROP POLICY IF EXISTS p_assessment_ai_log_owner ON public.assessment_ai_log;

CREATE POLICY p_assessment_ai_log_insert ON public.assessment_ai_log
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.test_attempts a
            WHERE a.id = assessment_ai_log.attempt_id
              AND (
                  (auth.uid() IS NOT NULL AND a.user_id = auth.uid())
                  OR (a.user_id IS NULL AND a.user_code IS NOT NULL)
              )
        )
    );

-- =========================================================================
-- Done. Verify with:
--   SELECT user_code, count(*) FROM public.test_attempts
--   WHERE user_code IS NOT NULL GROUP BY user_code;
-- =========================================================================
