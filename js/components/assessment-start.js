/**
 * AssessmentStart — landing page at #/assessment/start
 *
 * Lists available cases. If user is not signed in, prompts login first.
 * If there is an in_progress attempt, offers Resume.
 */

const AssessmentStart = {

    async render() {
        const root = document.getElementById('main-content');
        if (!root) return;

        // Auth gate
        const authed = (typeof SupabaseSync !== 'undefined' && SupabaseSync.isAuthenticated());
        if (!authed) {
            this._renderAuthGate(root);
            return;
        }

        // Logged in — render landing
        root.innerHTML = `
            <div class="assessment-start-page">
                <div class="assessment-start-hero">
                    <h1>Assessment Mode</h1>
                    <p class="assessment-start-tagline">
                        Test how you work with AI on a real-feeling clinical case.
                        Your responses are graded; your AI usage is recorded for review.
                    </p>
                </div>

                <div id="assessment-resume-slot"></div>

                <div class="assessment-start-cases">
                    <h2>Available cases</h2>
                    <div id="assessment-case-list" class="assessment-case-list">
                        <div class="loading">Loading cases…</div>
                    </div>
                </div>

                <div class="assessment-start-policy">
                    <h3>Before you begin</h3>
                    <ul>
                        <li>Plan to dedicate at least 90 minutes uninterrupted. Pausing is permitted, but it stops the timer.</li>
                        <li>You may use the AI assistant freely. Every AI interaction during the test is logged.</li>
                        <li>Each assessment in the case has its own time limit. When the case ends, you'll see your scoring report and the case's true diagnosis.</li>
                        <li>The chart updates as the case progresses — content from future visits will not be visible until you advance.</li>
                    </ul>
                </div>
            </div>
        `;
        App.refreshIcons();

        // In parallel: check resume + load case list
        const [resume, cases] = await Promise.all([
            AssessmentEngine.getAttemptIdForResume(),
            this._loadCaseList(),
        ]);
        this._renderResume(resume);
        this._renderCaseList(cases);
    },

    _renderAuthGate(root) {
        root.innerHTML = `
            <div class="assessment-start-page">
                <div class="assessment-start-hero">
                    <h1>Assessment Mode</h1>
                    <p class="assessment-start-tagline">Sign in to take an assessment. Your attempt will be linked to your account.</p>
                </div>
                <div class="assessment-auth-block" id="assessment-auth-block"></div>
            </div>
        `;
        if (typeof SupabaseSync !== 'undefined' && SupabaseSync.renderAuthUI) {
            SupabaseSync.renderAuthUI('assessment-auth-block');
        }
        // Re-render when auth state changes
        const onAuth = (e) => {
            const { user } = e.detail || {};
            if (user) {
                window.removeEventListener('supabase:auth-state-change', onAuth);
                this.render();
            }
        };
        window.addEventListener('supabase:auth-state-change', onAuth);
    },

    async _loadCaseList() {
        const ids = AssessmentData.listCases().map((c) => c.caseId);
        const metas = await Promise.all(
            ids.map((id) =>
                AssessmentData.loadCaseMeta(id)
                    .then((m) => ({ ok: true, m, id }))
                    .catch((err) => ({ ok: false, id, err: err.message }))
            )
        );
        return metas;
    },

    _renderCaseList(cases) {
        const container = document.getElementById('assessment-case-list');
        if (!container) return;
        if (!cases.length) {
            container.innerHTML = '<div class="empty-state-text">No assessment cases are configured.</div>';
            return;
        }
        container.innerHTML = cases.map((entry) => {
            if (!entry.ok) {
                return `
                    <div class="assessment-case-card error">
                        <strong>${entry.id}</strong> — failed to load: ${this._escape(entry.err)}
                    </div>
                `;
            }
            const m = entry.m;
            const isScaffold = (m.status === 'scaffold');
            return `
                <div class="assessment-case-card">
                    <div class="assessment-case-card-header">
                        <h3>${this._escape(m.caseTitle || m.caseId)}</h3>
                        ${isScaffold ? '<span class="assessment-case-tag scaffold">SCAFFOLD</span>' : ''}
                    </div>
                    <p class="assessment-case-card-desc">${this._escape(m.description || '')}</p>
                    <div class="assessment-case-card-meta">
                        <span>${(m.assessments || []).length} assessment points</span>
                        <span>&middot;</span>
                        <span>~${m.totalTimeLimitMinutes || '?'} min total</span>
                        <span>&middot;</span>
                        <span>Pass at ${m.passingOverallScorePct || 70}%</span>
                    </div>
                    ${m.warning ? `<div class="assessment-case-card-warning">${this._escape(m.warning)}</div>` : ''}
                    <button class="btn btn-primary" onclick="AssessmentStart.beginCase('${m.caseId}')">
                        Begin Assessment
                    </button>
                </div>
            `;
        }).join('');
    },

    _renderResume(resume) {
        const slot = document.getElementById('assessment-resume-slot');
        if (!slot) return;
        if (!resume) { slot.innerHTML = ''; return; }
        slot.innerHTML = `
            <div class="assessment-resume-card">
                <div>
                    <strong>You have an in-progress attempt.</strong>
                    <div class="assessment-resume-meta">
                        Case ${this._escape(resume.case_id)} &middot;
                        Started ${this._escape(new Date(resume.started_at).toLocaleString())} &middot;
                        Currently at ${this._escape(resume.current_assessment || '—')}
                    </div>
                </div>
                <div class="assessment-resume-actions">
                    <button class="btn btn-primary" onclick="AssessmentStart.resumeAttempt('${resume.id}')">Resume</button>
                    <button class="btn" onclick="AssessmentStart.confirmAbandon('${resume.id}')">Abandon</button>
                </div>
            </div>
        `;
    },

    async beginCase(caseId) {
        try {
            App.showLoading('Starting assessment…');
            await AssessmentEngine.start(caseId);
            router.navigate('/assessment/run');
        } catch (err) {
            console.error('beginCase failed', err);
            App.showToast('Could not start assessment: ' + err.message, 'error', 5000);
        } finally {
            App.hideLoading();
        }
    },

    async resumeAttempt(attemptId) {
        try {
            App.showLoading('Resuming attempt…');
            await AssessmentEngine.resume(attemptId);
            router.navigate('/assessment/run');
        } catch (err) {
            console.error('resumeAttempt failed', err);
            App.showToast('Could not resume: ' + err.message, 'error', 5000);
        } finally {
            App.hideLoading();
        }
    },

    async confirmAbandon(attemptId) {
        if (!confirm('Abandon this attempt? It will be marked as abandoned and you can start fresh.')) return;
        try {
            // Need to resume first so engine knows the attempt, then abandon.
            await AssessmentEngine.resume(attemptId);
            await AssessmentEngine.abandon();
            App.showToast('Attempt abandoned.', 'info');
            this.render();
        } catch (err) {
            App.showToast('Could not abandon: ' + err.message, 'error');
        }
    },

    _escape(s) {
        const el = document.createElement('span');
        el.textContent = s == null ? '' : String(s);
        return el.innerHTML;
    },
};

window.AssessmentStart = AssessmentStart;
