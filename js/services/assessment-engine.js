/**
 * AssessmentEngine — orchestrates an active assessment attempt.
 *
 * Coordinates:
 *   - Supabase persistence (test_attempts, assessment_responses)
 *   - Chart gate activation/advance/teardown
 *   - AI logger start/stop
 *   - Live AI sample generation + grading via AssessmentGrader
 *   - Pause/resume timer accumulation
 *
 * State machine:
 *   idle → in_progress → completed | abandoned | expired
 *
 * In-memory state mirrors the DB row; we flush to DB on every transition
 * (submit, advance, pause, resume, complete, abandon).
 *
 * Public API used by UI components:
 *   getAttemptIdForResume()          — id of the user's most recent in_progress attempt, if any
 *   start(caseId)                    — creates a new attempt
 *   resume(attemptId)                — picks up an existing attempt
 *   stop()                           — tear down without changing status (e.g., user navigated away)
 *   abandon()                        — mark abandoned in DB
 *   complete()                       — finalize scoring + mark completed
 *   getCurrent()                     — { attempt, caseDef, assessment, prompt, indexes }
 *   submitResponse(text)             — saves + grades current prompt
 *   advance()                        — moves cursor to next prompt or next AP
 *   pause() / resume()               — timer
 *   tickSeconds(n)                   — called by the UI clock
 *   getAISampleFor(promptId)         — lazy-generates the AI sample for an
 *                                       ai-output-evaluation prompt and caches it
 */

const AssessmentEngine = (() => {

    const LOG = (...a) => console.log('🎓 AssessEngine', ...a);
    const WARN = (...a) => console.warn('🎓 AssessEngine', ...a);

    // ── state ──────────────────────────────────────────────────────────
    let _attempt = null;          // DB row (mutated locally between flushes)
    let _caseDef = null;          // { meta, assessments: [ap1..apN] }
    let _aiSamples = new Map();   // promptId → sampleText
    let _responses = new Map();   // promptId → DB row
    let _lastAdvanceAt = null;    // for time accounting
    let _isPaused = false;
    let _listeners = new Set();

    // ── helpers ────────────────────────────────────────────────────────

    function _sb() {
        if (typeof SupabaseSync === 'undefined') return null;
        if (typeof SupabaseSync.getClient === 'function') return SupabaseSync.getClient();
        return SupabaseSync.client || null;
    }

    function _userId() {
        if (typeof SupabaseSync === 'undefined') return null;
        const u = SupabaseSync.getUser ? SupabaseSync.getUser() : SupabaseSync._user;
        return u ? u.id : null;
    }

    function _emit(event, payload) {
        for (const fn of _listeners) {
            try { fn(event, payload); } catch (e) { /* ignore */ }
        }
    }

    function on(fn) {
        _listeners.add(fn);
        return () => _listeners.delete(fn);
    }

    function _findAssessmentIdx(apId) {
        return _caseDef.assessments.findIndex((a) => a.id === apId);
    }

    function _findPromptIdx(ap, promptId) {
        return (ap.prompts || []).findIndex((p) => p.id === promptId);
    }

    function _currentIndexes() {
        if (!_attempt || !_caseDef) return null;
        const apIdx = _findAssessmentIdx(_attempt.current_assessment);
        if (apIdx < 0) return null;
        const ap = _caseDef.assessments[apIdx];
        const pIdx = _findPromptIdx(ap, _attempt.current_prompt);
        return { apIdx, pIdx, ap };
    }

    function _activeContextForLogger() {
        return {
            assessmentId: _attempt ? _attempt.current_assessment : null,
            promptId: _attempt ? _attempt.current_prompt : null,
        };
    }

    // ── DB I/O ─────────────────────────────────────────────────────────

    async function _insertAttempt(caseId) {
        const sb = _sb();
        const userId = _userId();
        if (!sb || !userId) throw new Error('Not signed in — cannot start an assessment.');

        // Pick first assessment + first prompt as the starting cursor.
        const apMeta = await AssessmentData.loadCaseMeta(caseId);
        const firstApId = (apMeta.assessments || [])[0];
        if (!firstApId) throw new Error('Case has no assessments configured.');
        const firstAp = await AssessmentData.loadAssessment(caseId, firstApId);
        const firstPrompt = (firstAp.prompts || [])[0];

        const row = {
            user_id: userId,
            case_id: caseId,
            status: 'in_progress',
            current_assessment: firstApId,
            current_prompt: firstPrompt ? firstPrompt.id : null,
            time_used_seconds: 0,
            metadata: { version: apMeta.version || null },
        };

        const { data, error } = await sb
            .from('test_attempts')
            .insert(row)
            .select()
            .single();
        if (error) throw error;
        return data;
    }

    async function _flushAttempt(patch) {
        if (!_attempt) return;
        Object.assign(_attempt, patch);
        const sb = _sb();
        if (!sb) return;
        const { error } = await sb
            .from('test_attempts')
            .update({
                status: _attempt.status,
                current_assessment: _attempt.current_assessment,
                current_prompt: _attempt.current_prompt,
                time_used_seconds: _attempt.time_used_seconds,
                total_score: _attempt.total_score,
                completed_at: _attempt.completed_at,
            })
            .eq('id', _attempt.id);
        if (error) WARN('flushAttempt error:', error.message);
    }

    async function _insertOrUpdateResponse(payload) {
        const sb = _sb();
        if (!sb) return null;
        const { data, error } = await sb
            .from('assessment_responses')
            .upsert(payload, { onConflict: 'attempt_id,prompt_id' })
            .select()
            .single();
        if (error) {
            WARN('upsert response error:', error.message);
            return null;
        }
        return data;
    }

    async function _loadResponses(attemptId) {
        const sb = _sb();
        if (!sb) return [];
        const { data, error } = await sb
            .from('assessment_responses')
            .select('*')
            .eq('attempt_id', attemptId);
        if (error) {
            WARN('loadResponses error:', error.message);
            return [];
        }
        return data || [];
    }

    // ── lifecycle ──────────────────────────────────────────────────────

    async function getAttemptIdForResume() {
        const sb = _sb();
        const userId = _userId();
        if (!sb || !userId) return null;
        const { data, error } = await sb
            .from('test_attempts')
            .select('id, case_id, started_at, current_assessment')
            .eq('user_id', userId)
            .eq('status', 'in_progress')
            .order('started_at', { ascending: false })
            .limit(1);
        if (error) { WARN('getAttemptIdForResume error:', error.message); return null; }
        return (data && data[0]) || null;
    }

    async function start(caseId) {
        const userId = _userId();
        if (!userId) throw new Error('You must sign in to start an assessment.');

        // Load case definition first so any error happens before we touch the DB.
        _caseDef = await AssessmentData.loadCase(caseId);

        // Create DB row.
        _attempt = await _insertAttempt(caseId);
        _responses = new Map();
        _aiSamples = new Map();
        _lastAdvanceAt = Date.now();
        _isPaused = false;

        await _activatePerCase(caseId, _attempt.current_assessment);

        LOG('Started attempt', _attempt.id, 'on case', caseId);
        _emit('started', { attempt: _attempt, caseDef: _caseDef });
        return _attempt;
    }

    async function resume(attemptId) {
        const sb = _sb();
        if (!sb) throw new Error('Supabase unavailable.');
        const { data, error } = await sb
            .from('test_attempts')
            .select('*')
            .eq('id', attemptId)
            .single();
        if (error) throw error;
        _attempt = data;
        if (_attempt.status !== 'in_progress') {
            throw new Error(`Attempt is ${_attempt.status}, cannot resume.`);
        }
        _caseDef = await AssessmentData.loadCase(_attempt.case_id);
        const responseRows = await _loadResponses(attemptId);
        _responses = new Map(responseRows.map((r) => [r.prompt_id, r]));
        // Re-load AI samples from response rows
        _aiSamples = new Map();
        for (const r of responseRows) {
            if (r.ai_sample_output) _aiSamples.set(r.prompt_id, r.ai_sample_output);
        }
        _lastAdvanceAt = Date.now();
        _isPaused = false;
        await _activatePerCase(_attempt.case_id, _attempt.current_assessment);
        LOG('Resumed attempt', _attempt.id);
        _emit('resumed', { attempt: _attempt, caseDef: _caseDef });
        return _attempt;
    }

    async function _activatePerCase(caseId, currentApId) {
        const ap = _caseDef.assessments.find((a) => a.id === currentApId);
        if (!ap) {
            WARN('_activatePerCase: assessment not found:', currentApId);
            return;
        }
        // Switch the chart to the case's patient
        const patientId = _caseDef.meta.patientId || caseId;
        try {
            if (typeof App !== 'undefined' && App.defaultPatientId !== patientId) {
                window.dispatchEvent(new CustomEvent('assessment:patient-switch-detected'));
                await App.switchPatient(patientId);
            }
        } catch (e) {
            WARN('patient switch during start failed (non-fatal):', e.message);
        }

        // Activate chart gate at this AP's anchor date
        const anchor = (ap.chartGate && ap.chartGate.includeBeforeOrEqualDate) || ap.anchorDate;
        if (anchor) {
            AssessmentChartGate.activate({ caseId, anchorDateIso: anchor });
        }
        AssessmentChartGate.resetVisibleSections();

        // Start logger
        AssessmentLogger.start({
            attemptId: _attempt.id,
            getActiveContext: _activeContextForLogger,
        });
    }

    function stop() {
        // Best-effort teardown without changing DB status.
        AssessmentLogger.stop();
        AssessmentChartGate.deactivate();
        _attempt = null;
        _caseDef = null;
        _responses = new Map();
        _aiSamples = new Map();
        _isPaused = false;
        _emit('stopped', null);
    }

    async function abandon() {
        if (!_attempt) return;
        await _flushAttempt({ status: 'abandoned' });
        stop();
        _emit('abandoned', null);
    }

    async function complete() {
        if (!_attempt) return;
        // Pull all responses fresh to compute final score (in case background
        // grading is still finishing for the last prompt).
        const rows = await _loadResponses(_attempt.id);
        const score = _computeOverallScore(rows);
        await _flushAttempt({
            status: 'completed',
            total_score: score,
            completed_at: new Date().toISOString(),
        });
        const finalId = _attempt.id;
        AssessmentLogger.stop();
        AssessmentChartGate.deactivate();
        _emit('completed', { attemptId: finalId, score });
        return { attemptId: finalId, score };
    }

    function _computeOverallScore(responseRows) {
        if (!_caseDef) return 0;
        let totalWeight = 0;
        let weightedSum = 0;
        for (const ap of _caseDef.assessments) {
            for (const prompt of (ap.prompts || [])) {
                const w = prompt.weight || 1;
                totalWeight += w;
                const row = responseRows.find((r) => r.prompt_id === prompt.id);
                if (row && typeof row.score === 'number') {
                    weightedSum += w * row.score;
                }
            }
        }
        return totalWeight > 0 ? Number((weightedSum / totalWeight).toFixed(3)) : 0;
    }

    // ── cursor reads ───────────────────────────────────────────────────

    function getCurrent() {
        if (!_attempt || !_caseDef) return null;
        const idx = _currentIndexes();
        if (!idx) return null;
        const ap = idx.ap;
        const prompt = (ap.prompts || [])[idx.pIdx] || null;
        const promptIds = (ap.prompts || []).map((p) => p.id);
        return {
            attempt: { ..._attempt },
            caseDef: _caseDef,
            assessment: ap,
            prompt,
            indexes: idx,
            totalAssessments: _caseDef.assessments.length,
            promptIds,
            isPaused: _isPaused,
            responses: Array.from(_responses.values()),
        };
    }

    function getResponseFor(promptId) {
        return _responses.get(promptId) || null;
    }

    // ── timing ─────────────────────────────────────────────────────────

    function _accrueTime() {
        if (!_attempt || _isPaused) return;
        if (!_lastAdvanceAt) { _lastAdvanceAt = Date.now(); return; }
        const now = Date.now();
        const secs = Math.floor((now - _lastAdvanceAt) / 1000);
        if (secs > 0) {
            _attempt.time_used_seconds += secs;
            _lastAdvanceAt = now;
        }
    }

    function pause() {
        if (_isPaused) return;
        _accrueTime();
        _isPaused = true;
        _emit('paused', null);
        _flushAttempt({}).catch(() => {});
    }

    function resumeTimer() {
        if (!_isPaused) return;
        _isPaused = false;
        _lastAdvanceAt = Date.now();
        _emit('resumed-timer', null);
    }

    function isPaused() { return _isPaused; }

    function getTimeUsedSeconds() {
        // Compute on demand including currently-in-flight delta
        if (!_attempt) return 0;
        if (_isPaused) return _attempt.time_used_seconds;
        const delta = _lastAdvanceAt ? Math.floor((Date.now() - _lastAdvanceAt) / 1000) : 0;
        return _attempt.time_used_seconds + Math.max(0, delta);
    }

    function getAssessmentTimeLimitSeconds() {
        const cur = getCurrent();
        if (!cur) return 0;
        return (cur.assessment.timeLimitMinutes || 0) * 60;
    }

    function getCaseTimeLimitSeconds() {
        if (!_caseDef) return 0;
        return (_caseDef.meta.totalTimeLimitMinutes || 0) * 60;
    }

    // ── AI sample for ai-output-evaluation prompts ─────────────────────

    async function getAISampleFor(promptId) {
        if (_aiSamples.has(promptId)) return _aiSamples.get(promptId);
        const cur = getCurrent();
        if (!cur) return null;
        const prompt = (cur.assessment.prompts || []).find((p) => p.id === promptId);
        if (!prompt) return null;
        if (prompt.type !== 'ai-output-evaluation') return null;

        // Stash any previously-saved sample (resume scenario)
        const existingRow = _responses.get(promptId);
        if (existingRow && existingRow.ai_sample_output) {
            _aiSamples.set(promptId, existingRow.ai_sample_output);
            return existingRow.ai_sample_output;
        }

        const { sampleText } = await AssessmentGrader.generateAISample(prompt);
        _aiSamples.set(promptId, sampleText);
        // Persist eagerly so a resume sees the same sample
        const sb = _sb();
        if (sb && _attempt) {
            await _insertOrUpdateResponse({
                attempt_id: _attempt.id,
                assessment_id: cur.assessment.id,
                prompt_id: promptId,
                response_text: null,
                ai_sample_output: sampleText,
            });
        }
        return sampleText;
    }

    // ── submit / advance ───────────────────────────────────────────────

    async function submitResponse(text) {
        const cur = getCurrent();
        if (!cur || !cur.prompt) throw new Error('No active prompt.');
        if (!text || !text.trim()) throw new Error('Response is empty.');

        _accrueTime();

        const prompt = cur.prompt;
        const aiSample = (prompt.type === 'ai-output-evaluation')
            ? _aiSamples.get(prompt.id)
            : null;

        // Save the response immediately (un-scored), so progress is preserved
        // even if grading fails.
        const draft = await _insertOrUpdateResponse({
            attempt_id: _attempt.id,
            assessment_id: cur.assessment.id,
            prompt_id: prompt.id,
            response_text: text,
            time_spent_seconds: 0,    // (could compute per-prompt later)
            ai_sample_output: aiSample || null,
        });
        if (draft) _responses.set(prompt.id, draft);

        _emit('response-saved', { promptId: prompt.id });

        // Kick off grading async; do not block the resident.
        _gradeInBackground(prompt, text, aiSample);

        return draft;
    }

    async function _gradeInBackground(prompt, text, aiSample) {
        try {
            const result = await AssessmentGrader.grade(prompt, text, { aiSample });
            const updated = await _insertOrUpdateResponse({
                attempt_id: _attempt ? _attempt.id : null,
                assessment_id: _currentApFor(prompt.id),
                prompt_id: prompt.id,
                response_text: text,
                ai_sample_output: aiSample || null,
                score: result.score,
                score_breakdown: result.breakdown,
                grader_notes: result.notes,
            });
            if (updated) _responses.set(prompt.id, updated);
            _emit('response-graded', { promptId: prompt.id, score: result.score });
        } catch (err) {
            WARN('Background grading failed for', prompt.id, err.message);
            _emit('grading-failed', { promptId: prompt.id, error: err.message });
        }
    }

    function _currentApFor(promptId) {
        for (const ap of (_caseDef ? _caseDef.assessments : [])) {
            if ((ap.prompts || []).some((p) => p.id === promptId)) return ap.id;
        }
        return null;
    }

    /**
     * Move cursor to the next prompt. If at the end of an AP, advance to the
     * next AP (which may move the chart gate forward). If at the end of the
     * last AP, return { atEnd: true } and DO NOT auto-complete (the UI calls
     * complete() explicitly).
     */
    async function advance() {
        if (!_attempt || !_caseDef) return { atEnd: false };
        _accrueTime();

        const idx = _currentIndexes();
        if (!idx) return { atEnd: false };
        const ap = idx.ap;

        const nextPromptIdx = idx.pIdx + 1;
        if (nextPromptIdx < (ap.prompts || []).length) {
            const nextPrompt = ap.prompts[nextPromptIdx];
            await _flushAttempt({ current_prompt: nextPrompt.id });
            _emit('cursor-moved', { promptId: nextPrompt.id });
            return { atEnd: false, nextPromptId: nextPrompt.id, sameAssessment: true };
        }

        // Move to next assessment
        const nextApIdx = idx.apIdx + 1;
        if (nextApIdx < _caseDef.assessments.length) {
            const nextAp = _caseDef.assessments[nextApIdx];
            const nextPrompt = (nextAp.prompts || [])[0];
            await _flushAttempt({
                current_assessment: nextAp.id,
                current_prompt: nextPrompt ? nextPrompt.id : null,
            });
            // Move chart gate forward
            const anchor = (nextAp.chartGate && nextAp.chartGate.includeBeforeOrEqualDate) || nextAp.anchorDate;
            if (anchor) AssessmentChartGate.advance(anchor);
            AssessmentChartGate.resetVisibleSections();
            _lastAdvanceAt = Date.now();
            _emit('assessment-advanced', { newAssessmentId: nextAp.id });
            return { atEnd: false, nextAssessmentId: nextAp.id, nextPromptId: nextPrompt ? nextPrompt.id : null };
        }

        // End of last AP
        _emit('reached-end', null);
        return { atEnd: true };
    }

    return {
        // Lifecycle
        getAttemptIdForResume,
        start,
        resume,
        stop,
        abandon,
        complete,

        // Reads
        getCurrent,
        getResponseFor,
        getCaseDef: () => _caseDef,
        getAttempt: () => _attempt && { ..._attempt },
        isActive: () => !!_attempt,

        // Submit / advance
        submitResponse,
        advance,
        getAISampleFor,

        // Timing
        pause,
        resumeTimer,
        isPaused,
        getTimeUsedSeconds,
        getAssessmentTimeLimitSeconds,
        getCaseTimeLimitSeconds,

        // Events
        on,
    };
})();

window.AssessmentEngine = AssessmentEngine;
