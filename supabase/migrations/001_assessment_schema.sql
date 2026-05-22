-- =========================================================================
-- Assessment Framework Schema
-- Run this in the Supabase SQL editor BEFORE deploying Phase 3 code.
--
-- Creates:
--   admin_roles            — who can see all attempts
--   test_attempts          — one row per resident's run through a case
--   assessment_responses   — one row per submitted answer
--   assessment_ai_log      — every AI interaction during a test
--
-- All tables use Row Level Security so residents only see their own data
-- and admins see everything.
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. Admin roles
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admin_roles (
    user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    role       TEXT NOT NULL CHECK (role IN ('admin','proctor','resident')),
    granted_by UUID REFERENCES auth.users(id),
    granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    notes      TEXT
);

COMMENT ON TABLE public.admin_roles IS
    'Maps users to elevated roles. Default for an unrowed user is implicit resident.';

-- Helper function: is the given user an admin?
CREATE OR REPLACE FUNCTION public.is_admin(uid UUID)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.admin_roles
        WHERE user_id = uid AND role IN ('admin','proctor')
    );
$$;

-- -------------------------------------------------------------------------
-- 2. Test attempts
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.test_attempts (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    case_id             TEXT NOT NULL,
    started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at        TIMESTAMPTZ,
    status              TEXT NOT NULL DEFAULT 'in_progress'
                            CHECK (status IN ('in_progress','completed','abandoned','expired')),
    total_score         NUMERIC(4,3) CHECK (total_score >= 0 AND total_score <= 1),
    current_assessment  TEXT,
    current_prompt      TEXT,
    time_used_seconds   INTEGER NOT NULL DEFAULT 0,
    metadata            JSONB DEFAULT '{}'::jsonb,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_test_attempts_user
    ON public.test_attempts(user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_test_attempts_status
    ON public.test_attempts(status, started_at DESC);

COMMENT ON COLUMN public.test_attempts.total_score IS
    '0.0-1.0, set when status moves to completed';
COMMENT ON COLUMN public.test_attempts.time_used_seconds IS
    'Accumulated active time; pauses do not count';

-- -------------------------------------------------------------------------
-- 3. Assessment responses
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.assessment_responses (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    attempt_id          UUID NOT NULL REFERENCES public.test_attempts(id) ON DELETE CASCADE,
    assessment_id       TEXT NOT NULL,
    prompt_id           TEXT NOT NULL,
    response_text       TEXT,
    score               NUMERIC(4,3) CHECK (score >= 0 AND score <= 1),
    score_breakdown     JSONB,
    grader_notes        TEXT,
    ai_sample_output    TEXT,
    time_spent_seconds  INTEGER NOT NULL DEFAULT 0,
    submitted_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (attempt_id, prompt_id)
);

CREATE INDEX IF NOT EXISTS idx_assessment_responses_attempt
    ON public.assessment_responses(attempt_id, submitted_at);

COMMENT ON COLUMN public.assessment_responses.score_breakdown IS
    'JSON: { essential_hit: [...], essential_missed: [...], bonus_hit: [...], red_flags_triggered: [...] }';
COMMENT ON COLUMN public.assessment_responses.ai_sample_output IS
    'For ai-output-evaluation prompts: the AI text the resident was critiquing';

-- -------------------------------------------------------------------------
-- 4. Assessment AI log
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.assessment_ai_log (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    attempt_id          UUID NOT NULL REFERENCES public.test_attempts(id) ON DELETE CASCADE,
    assessment_id       TEXT,
    prompt_id           TEXT,
    interaction_type    TEXT,         -- 'ask' | 'tool_use' | 'analysis' | 'chart_view'
    query_text          TEXT,
    response_text       TEXT,
    tool_name           TEXT,         -- for tool_use entries
    context_size_chars  INTEGER,
    chart_sections      TEXT[],       -- ['notes', 'labs', 'imaging'] etc.
    metadata            JSONB DEFAULT '{}'::jsonb,
    timestamp           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_assessment_ai_log_attempt
    ON public.assessment_ai_log(attempt_id, timestamp);

COMMENT ON TABLE public.assessment_ai_log IS
    'Every AI interaction during a test, used for post-hoc analysis of resident-AI collaboration patterns';

-- -------------------------------------------------------------------------
-- 5. Updated_at trigger for test_attempts
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_test_attempts_updated_at ON public.test_attempts;
CREATE TRIGGER trg_test_attempts_updated_at
    BEFORE UPDATE ON public.test_attempts
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================================================
-- Row Level Security
-- =========================================================================
ALTER TABLE public.admin_roles           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.test_attempts         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assessment_responses  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assessment_ai_log     ENABLE ROW LEVEL SECURITY;

-- admin_roles: only admins read/write; users can read their own role row
DROP POLICY IF EXISTS p_admin_roles_self_read ON public.admin_roles;
CREATE POLICY p_admin_roles_self_read ON public.admin_roles
    FOR SELECT USING (user_id = auth.uid() OR public.is_admin(auth.uid()));

DROP POLICY IF EXISTS p_admin_roles_admin_write ON public.admin_roles;
CREATE POLICY p_admin_roles_admin_write ON public.admin_roles
    FOR ALL USING (public.is_admin(auth.uid()));

-- test_attempts: user can read/write their own; admins read all
DROP POLICY IF EXISTS p_test_attempts_owner ON public.test_attempts;
CREATE POLICY p_test_attempts_owner ON public.test_attempts
    FOR ALL USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS p_test_attempts_admin_read ON public.test_attempts;
CREATE POLICY p_test_attempts_admin_read ON public.test_attempts
    FOR SELECT USING (public.is_admin(auth.uid()));

-- assessment_responses: owner of the linked attempt; admins read all
DROP POLICY IF EXISTS p_assessment_responses_owner ON public.assessment_responses;
CREATE POLICY p_assessment_responses_owner ON public.assessment_responses
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.test_attempts a
            WHERE a.id = assessment_responses.attempt_id
            AND a.user_id = auth.uid()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.test_attempts a
            WHERE a.id = assessment_responses.attempt_id
            AND a.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS p_assessment_responses_admin_read ON public.assessment_responses;
CREATE POLICY p_assessment_responses_admin_read ON public.assessment_responses
    FOR SELECT USING (public.is_admin(auth.uid()));

-- assessment_ai_log: same pattern
DROP POLICY IF EXISTS p_assessment_ai_log_owner ON public.assessment_ai_log;
CREATE POLICY p_assessment_ai_log_owner ON public.assessment_ai_log
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.test_attempts a
            WHERE a.id = assessment_ai_log.attempt_id
            AND a.user_id = auth.uid()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.test_attempts a
            WHERE a.id = assessment_ai_log.attempt_id
            AND a.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS p_assessment_ai_log_admin_read ON public.assessment_ai_log;
CREATE POLICY p_assessment_ai_log_admin_read ON public.assessment_ai_log
    FOR SELECT USING (public.is_admin(auth.uid()));

-- =========================================================================
-- Bootstrap: optionally grant admin to a specific user
-- (Replace the UUID below with your auth.users.id, then uncomment)
-- =========================================================================
-- INSERT INTO public.admin_roles (user_id, role, notes)
-- VALUES ('YOUR-AUTH-UUID-HERE', 'admin', 'Initial admin bootstrap')
-- ON CONFLICT (user_id) DO UPDATE SET role = 'admin';

-- =========================================================================
-- Done. Verify with:
--   SELECT * FROM public.admin_roles;
--   SELECT count(*) FROM public.test_attempts;
-- =========================================================================
