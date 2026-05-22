/**
 * AssessmentResults — scoring report at #/assessment/results/:id
 *
 * Loads the completed attempt + responses + AI log entries from Supabase.
 * Renders:
 *   - Overall score + pass/fail banner
 *   - Diagnosis reveal (from AssessmentData.getCaseDiagnosis)
 *   - Per-assessment breakdown
 *   - Per-prompt cards: question, response, AI sample if any, score, rubric breakdown
 *   - AI usage analysis (call count, avg context size, sections touched, retry diversity)
 */

const AssessmentResults = {

    async render(attemptId) {
        const root = document.getElementById('main-content');
        if (!root) return;
        if (!attemptId) {
            root.innerHTML = '<div class="empty-state">No attempt id provided.</div>';
            return;
        }

        root.innerHTML = `<div class="assessment-results-page"><div class="loading">Loading results…</div></div>`;

        try {
            const data = await this._fetchAll(attemptId);
            this._renderReport(root, data);
        } catch (err) {
            console.error('render results failed', err);
            root.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-text">Could not load results: ${this._escape(err.message)}</div>
                    <div style="margin-top:12px;"><a href="#/assessment/start">Back to assessment landing</a></div>
                </div>
            `;
        }
    },

    async _fetchAll(attemptId) {
        const sb = (typeof SupabaseSync !== 'undefined') ? SupabaseSync.getClient() : null;
        if (!sb) throw new Error('Supabase client unavailable. Sign in to view results.');

        const [attemptRes, respRes, logRes] = await Promise.all([
            sb.from('test_attempts').select('*').eq('id', attemptId).maybeSingle(),
            sb.from('assessment_responses').select('*').eq('attempt_id', attemptId),
            sb.from('assessment_ai_log').select('*').eq('attempt_id', attemptId).order('timestamp', { ascending: true }),
        ]);

        if (attemptRes.error) throw attemptRes.error;
        if (!attemptRes.data) throw new Error('Attempt not found or not accessible.');
        if (respRes.error) throw respRes.error;
        if (logRes.error) throw logRes.error;

        const attempt = attemptRes.data;
        const responses = respRes.data || [];
        const aiLog = logRes.data || [];

        const caseDef = await AssessmentData.loadCase(attempt.case_id);
        const diagnosis = AssessmentData.getCaseDiagnosis(attempt.case_id);

        return { attempt, responses, aiLog, caseDef, diagnosis };
    },

    _renderReport(root, { attempt, responses, aiLog, caseDef, diagnosis }) {
        const overallPct = Math.round(((attempt.total_score || 0) * 100));
        const passingPct = caseDef.meta.passingOverallScorePct || 70;
        const passed = overallPct >= passingPct;
        const statusBadge = attempt.status === 'completed'
            ? (passed ? '<span class="badge pass">PASS</span>' : '<span class="badge fail">FAIL</span>')
            : `<span class="badge incomplete">${this._escape(attempt.status.toUpperCase())}</span>`;

        const aiStats = this._computeAIStats(aiLog);

        root.innerHTML = `
            <div class="assessment-results-page">
                <div class="assessment-results-header">
                    <div class="assessment-results-title">
                        <h1>Results — ${this._escape(caseDef.meta.caseTitle || caseDef.meta.caseId)}</h1>
                        ${statusBadge}
                    </div>
                    <div class="assessment-results-meta">
                        <span>Started ${this._escape(this._fmtDate(attempt.started_at))}</span>
                        ${attempt.completed_at ? `<span>&middot; Completed ${this._escape(this._fmtDate(attempt.completed_at))}</span>` : ''}
                        <span>&middot; Time used ${this._fmtTime(attempt.time_used_seconds || 0)}</span>
                    </div>
                </div>

                <div class="assessment-results-score-card">
                    <div class="assessment-score-circle ${passed ? 'pass' : 'fail'}">
                        <div class="assessment-score-pct">${overallPct}%</div>
                        <div class="assessment-score-label">Overall</div>
                    </div>
                    <div class="assessment-results-score-detail">
                        <div>Passing threshold: <strong>${passingPct}%</strong></div>
                        <div>Status: <strong>${this._escape(attempt.status)}</strong></div>
                    </div>
                </div>

                ${diagnosis ? this._renderDiagnosisBox(diagnosis) : ''}

                <div class="assessment-results-ai-stats">
                    <h2>AI usage</h2>
                    <div class="assessment-ai-stats-grid">
                        <div class="assessment-ai-stat-card">
                            <div class="assessment-ai-stat-value">${aiStats.callCount}</div>
                            <div class="assessment-ai-stat-label">AI calls</div>
                        </div>
                        <div class="assessment-ai-stat-card">
                            <div class="assessment-ai-stat-value">${aiStats.avgContextChars}</div>
                            <div class="assessment-ai-stat-label">Avg context chars</div>
                        </div>
                        <div class="assessment-ai-stat-card">
                            <div class="assessment-ai-stat-value">${aiStats.uniqueSections}</div>
                            <div class="assessment-ai-stat-label">Chart sections touched</div>
                        </div>
                        <div class="assessment-ai-stat-card">
                            <div class="assessment-ai-stat-value">${aiStats.repeatedQueries}</div>
                            <div class="assessment-ai-stat-label">Near-duplicate prompts</div>
                        </div>
                    </div>
                </div>

                <div class="assessment-results-prompts">
                    <h2>Per-prompt breakdown</h2>
                    ${caseDef.assessments.map((ap) => this._renderAssessmentBlock(ap, responses)).join('')}
                </div>

                <div class="assessment-results-footer">
                    <button class="btn" onclick="router.navigate('/assessment/start')">Back to assessments</button>
                    <button class="btn" onclick="router.navigate('/chart-review')">Go to chart</button>
                </div>
            </div>
        `;
        App.refreshIcons();
    },

    _renderDiagnosisBox(d) {
        return `
            <details class="assessment-diagnosis-reveal" open>
                <summary><i data-lucide="lightbulb" class="lucide-inline"></i> Case diagnosis (reveal)</summary>
                <div class="assessment-diagnosis-body">
                    <div><strong>Primary:</strong> ${this._escape(d.primary)}</div>
                    ${d.secondary ? `<div><strong>Secondary:</strong> ${this._escape(d.secondary)}</div>` : ''}
                    ${d.causalChain ? `
                        <div class="assessment-diagnosis-chain">
                            <strong>Causal chain:</strong>
                            <ol>
                                ${d.causalChain.map((step) => `<li>${this._escape(step)}</li>`).join('')}
                            </ol>
                        </div>
                    ` : ''}
                    ${d.source ? `<div class="assessment-diagnosis-source">${this._escape(d.source)}</div>` : ''}
                </div>
            </details>
        `;
    },

    _renderAssessmentBlock(ap, responses) {
        const apScore = this._computeAssessmentScore(ap, responses);
        const apScorePct = apScore === null ? '—' : Math.round(apScore * 100) + '%';

        return `
            <div class="assessment-results-ap">
                <div class="assessment-results-ap-header">
                    <h3>${this._escape(ap.id)} — ${this._escape(ap.title || '')}</h3>
                    <div class="assessment-results-ap-score">${apScorePct}</div>
                </div>
                ${(ap.prompts || []).map((p) => this._renderPromptCard(p, responses)).join('')}
            </div>
        `;
    },

    _computeAssessmentScore(ap, responses) {
        let total = 0;
        let weighted = 0;
        let hasScore = false;
        for (const p of (ap.prompts || [])) {
            const w = p.weight || 1;
            total += w;
            const r = responses.find((rr) => rr.prompt_id === p.id);
            if (r && typeof r.score === 'number') {
                weighted += w * r.score;
                hasScore = true;
            }
        }
        if (!hasScore || total === 0) return null;
        return weighted / total;
    },

    _renderPromptCard(prompt, responses) {
        const r = responses.find((rr) => rr.prompt_id === prompt.id);
        const scoreStr = (r && typeof r.score === 'number') ? Math.round(r.score * 100) + '%' : '—';
        const breakdown = (r && r.score_breakdown) || {};

        return `
            <div class="assessment-prompt-result">
                <div class="assessment-prompt-result-header">
                    <span class="assessment-prompt-result-id">${this._escape(prompt.id)}</span>
                    <span class="assessment-prompt-result-type">${this._escape(this._labelForType(prompt.type))}</span>
                    <span class="assessment-prompt-result-score">${scoreStr}</span>
                </div>
                <div class="assessment-prompt-result-question">${this._escape(prompt.question || '')}</div>

                ${r && r.ai_sample_output ? `
                    <details class="assessment-prompt-result-aisample">
                        <summary>AI sample evaluated</summary>
                        <pre>${this._escape(r.ai_sample_output)}</pre>
                    </details>
                ` : ''}

                <details class="assessment-prompt-result-response">
                    <summary>Your response</summary>
                    <pre>${this._escape((r && r.response_text) || '(no response)')}</pre>
                </details>

                ${this._renderBreakdown(breakdown)}

                ${r && r.grader_notes ? `
                    <div class="assessment-prompt-result-notes">
                        <strong>Grader notes:</strong> ${this._escape(r.grader_notes)}
                    </div>
                ` : ''}

                ${this._renderRubric(prompt.rubric)}
            </div>
        `;
    },

    _renderBreakdown(b) {
        if (!b || Object.keys(b).length === 0) return '';
        const block = (label, arr, kind) => {
            if (!Array.isArray(arr) || arr.length === 0) return '';
            return `
                <div class="assessment-breakdown-block ${kind}">
                    <div class="assessment-breakdown-label">${label}</div>
                    <ul>${arr.map((i) => `<li>${this._escape(i)}</li>`).join('')}</ul>
                </div>
            `;
        };
        return `
            <div class="assessment-breakdown">
                ${block('Essential — hit', b.essential_hit, 'hit')}
                ${block('Essential — missed', b.essential_missed, 'missed')}
                ${block('Bonus — hit', b.bonus_hit, 'bonus')}
                ${block('Red flags', b.red_flags_triggered, 'redflag')}
            </div>
        `;
    },

    _renderRubric(rubric) {
        if (!rubric) return '';
        const lines = [];
        if (Array.isArray(rubric.essential) && rubric.essential.length) lines.push(`<strong>Essential:</strong> ${rubric.essential.map((x) => this._escape(x)).join('; ')}`);
        if (Array.isArray(rubric.bonus) && rubric.bonus.length) lines.push(`<strong>Bonus:</strong> ${rubric.bonus.map((x) => this._escape(x)).join('; ')}`);
        if (Array.isArray(rubric.redFlags) && rubric.redFlags.length) lines.push(`<strong>Red flags:</strong> ${rubric.redFlags.map((x) => this._escape(x)).join('; ')}`);
        if (Array.isArray(rubric.shouldIdentify) && rubric.shouldIdentify.length) lines.push(`<strong>Should identify:</strong> ${rubric.shouldIdentify.map((x) => this._escape(x)).join('; ')}`);
        if (!lines.length) return '';
        return `<details class="assessment-prompt-result-rubric"><summary>Full rubric</summary><div>${lines.join('<br/>')}</div></details>`;
    },

    _computeAIStats(log) {
        const calls = log.filter((row) => row.interaction_type === 'ask');
        const callCount = calls.length;
        const contextSizes = calls.map((c) => c.context_size_chars || 0);
        const avgContextChars = contextSizes.length
            ? Math.round(contextSizes.reduce((a, b) => a + b, 0) / contextSizes.length)
            : 0;

        const sections = new Set();
        for (const c of log) {
            if (Array.isArray(c.chart_sections)) {
                for (const s of c.chart_sections) sections.add(s);
            }
        }

        // Near-duplicate detection: count queries whose first 80 chars match a prior call
        const seen = new Set();
        let repeatedQueries = 0;
        for (const c of calls) {
            const key = (c.query_text || '').slice(0, 80).toLowerCase().replace(/\s+/g, ' ').trim();
            if (!key) continue;
            if (seen.has(key)) repeatedQueries++;
            seen.add(key);
        }

        return {
            callCount,
            avgContextChars,
            uniqueSections: sections.size,
            repeatedQueries,
        };
    },

    _labelForType(t) {
        return {
            'differential': 'Differential',
            'context-curation': 'Context curation',
            'ai-output-evaluation': 'AI evaluation',
            'management': 'Management',
        }[t] || (t || 'Response');
    },

    _fmtDate(iso) {
        if (!iso) return '';
        try {
            return new Date(iso).toLocaleString();
        } catch (e) { return iso; }
    },

    _fmtTime(secs) {
        secs = Math.max(0, Math.floor(secs));
        const h = Math.floor(secs / 3600);
        const m = Math.floor((secs % 3600) / 60);
        const s = secs % 60;
        if (h > 0) return `${h}h ${m}m`;
        if (m > 0) return `${m}m ${s}s`;
        return `${s}s`;
    },

    _escape(s) {
        const el = document.createElement('span');
        el.textContent = s == null ? '' : String(s);
        return el.innerHTML;
    },
};

window.AssessmentResults = AssessmentResults;
