/**
 * AssessmentPanel — the active test-taking UI at #/assessment/run
 *
 * Layout: a sticky "test bar" overlay that lives at the top of main-content
 * (the rest of main-content keeps the normal chart navigation so the resident
 * can browse the chart freely while answering). The current scenario brief
 * and prompt sit in a dedicated panel above the chart.
 *
 * Controls:
 *   - Timer (per-assessment limit, auto-locks on expiry)
 *   - Pause/resume
 *   - Response textarea + Submit & Continue button
 *   - Progress dots (which prompt of which assessment)
 */

const AssessmentPanel = {
    _tickInterval: null,
    _expiredHandled: false,
    _gradingPromptIds: new Set(),

    renderActive() {
        if (!AssessmentEngine.isActive()) {
            // No active attempt — bounce back to start
            router.navigate('/assessment/start');
            return;
        }
        this._renderShell();
        this._renderPromptArea();
        this._renderChartArea();
        this._startTicker();
        this._attachEngineListener();
    },

    _renderShell() {
        const root = document.getElementById('main-content');
        if (!root) return;
        root.innerHTML = `
            <div class="assessment-runner">
                <div class="assessment-bar" id="assessment-bar"></div>
                <div class="assessment-prompt-area" id="assessment-prompt-area"></div>
                <div class="assessment-chart-area" id="assessment-chart-area">
                    <div class="assessment-chart-note">
                        <i data-lucide="info" class="lucide-inline"></i>
                        The chart is available on the left. You may navigate freely; only
                        information present in the chart up to the current point in the
                        case timeline is visible.
                    </div>
                </div>
            </div>
        `;
        App.refreshIcons();
        this._renderBar();
    },

    _renderBar() {
        const cur = AssessmentEngine.getCurrent();
        if (!cur) return;
        const apIndex1 = cur.indexes.apIdx + 1;
        const total = cur.totalAssessments;
        const ap = cur.assessment;
        const promptIdx1 = cur.indexes.pIdx + 1;
        const promptCount = (ap.prompts || []).length;
        const timeUsed = AssessmentEngine.getTimeUsedSeconds();
        const apLimit = AssessmentEngine.getAssessmentTimeLimitSeconds();
        const timeRemaining = Math.max(0, apLimit - timeUsed);
        const isPaused = AssessmentEngine.isPaused();

        const bar = document.getElementById('assessment-bar');
        if (!bar) return;
        bar.innerHTML = `
            <div class="assessment-bar-row">
                <div class="assessment-bar-left">
                    <div class="assessment-bar-title">
                        Assessment ${apIndex1} of ${total}: <strong>${this._escape(ap.title || ap.id)}</strong>
                    </div>
                    <div class="assessment-bar-subtitle">
                        Prompt ${promptIdx1} of ${promptCount}
                    </div>
                </div>
                <div class="assessment-bar-right">
                    <div class="assessment-timer ${timeRemaining < 60 ? 'low' : ''} ${isPaused ? 'paused' : ''}">
                        <i data-lucide="clock" class="lucide-inline"></i>
                        <span id="assessment-timer-text">${this._fmtTime(timeRemaining)}</span>
                        ${isPaused ? '<span class="assessment-paused-pill">PAUSED</span>' : ''}
                    </div>
                    <button class="btn btn-sm" id="assessment-pause-btn">
                        ${isPaused ? '<i data-lucide="play" class="lucide-inline"></i> Resume' : '<i data-lucide="pause" class="lucide-inline"></i> Pause'}
                    </button>
                    <button class="btn btn-sm" id="assessment-abandon-btn" title="Abandon attempt">
                        <i data-lucide="x-octagon" class="lucide-inline"></i>
                        Abandon
                    </button>
                </div>
            </div>
            <div class="assessment-progress-dots">
                ${this._renderProgressDots(cur)}
            </div>
        `;
        App.refreshIcons();
        document.getElementById('assessment-pause-btn').addEventListener('click', () => this._togglePause());
        document.getElementById('assessment-abandon-btn').addEventListener('click', () => this._confirmAbandon());
    },

    _renderProgressDots(cur) {
        const html = [];
        for (let i = 0; i < cur.caseDef.assessments.length; i++) {
            const ap = cur.caseDef.assessments[i];
            const isCurrent = i === cur.indexes.apIdx;
            const isDone = i < cur.indexes.apIdx;
            html.push(`
                <div class="assessment-progress-group ${isCurrent ? 'current' : ''} ${isDone ? 'done' : ''}"
                     title="${this._escape(ap.title || ap.id)}">
                    <span class="assessment-progress-label">${this._escape(ap.id)}</span>
                    <div class="assessment-progress-prompts">
                        ${(ap.prompts || []).map((p, pi) => {
                            const promptDone = isDone || (isCurrent && pi < cur.indexes.pIdx);
                            const promptCurrent = isCurrent && pi === cur.indexes.pIdx;
                            return `<span class="assessment-progress-prompt-dot ${promptDone ? 'done' : ''} ${promptCurrent ? 'current' : ''}"
                                       title="${this._escape(p.id)} — ${this._escape(p.type || '')}"></span>`;
                        }).join('')}
                    </div>
                </div>
            `);
        }
        return html.join('');
    },

    async _renderPromptArea() {
        const cur = AssessmentEngine.getCurrent();
        const area = document.getElementById('assessment-prompt-area');
        if (!cur || !area) return;

        const ap = cur.assessment;
        const prompt = cur.prompt;
        const existing = AssessmentEngine.getResponseFor(prompt.id);

        // Scenario brief shows on the first prompt of each AP
        const showBrief = (cur.indexes.pIdx === 0);

        const isAIEval = prompt.type === 'ai-output-evaluation';
        let aiSampleHtml = '';
        let aiSampleSlotId = `ai-sample-${prompt.id}`;
        if (isAIEval) {
            aiSampleHtml = `
                <div class="assessment-ai-sample" id="${aiSampleSlotId}">
                    <div class="assessment-ai-sample-header">
                        <i data-lucide="sparkles" class="lucide-inline"></i>
                        AI response to evaluate
                    </div>
                    <div class="assessment-ai-sample-body" id="${aiSampleSlotId}-body">
                        <div class="loading">Generating AI sample…</div>
                    </div>
                </div>
            `;
        }

        const minLength = prompt.minLength || 0;
        const typeLabel = this._labelForType(prompt.type);
        const existingText = existing && existing.response_text ? existing.response_text : '';

        area.innerHTML = `
            ${showBrief ? `
                <div class="assessment-scenario">
                    <div class="assessment-scenario-label">SCENARIO</div>
                    <div class="assessment-scenario-body">${this._escape(ap.scenarioBrief || '')}</div>
                </div>
            ` : ''}
            <div class="assessment-prompt-card">
                <div class="assessment-prompt-meta">
                    <span class="assessment-prompt-type">${this._escape(typeLabel)}</span>
                    <span class="assessment-prompt-id">${this._escape(prompt.id)}</span>
                </div>
                <div class="assessment-prompt-question">${this._escape(prompt.question || '(no question)')}</div>
                ${aiSampleHtml}
                <textarea class="assessment-response-input" id="assessment-response-input"
                          placeholder="Type your response here…"
                          minlength="${minLength}"
                          rows="8">${this._escape(existingText)}</textarea>
                <div class="assessment-response-controls">
                    <div class="assessment-response-meta">
                        <span id="assessment-char-count">0</span> chars
                        ${minLength ? `<span class="assessment-minlength">(min ${minLength})</span>` : ''}
                    </div>
                    <div class="assessment-response-actions">
                        <button class="btn" id="assessment-save-draft-btn">Save Draft</button>
                        <button class="btn btn-primary" id="assessment-submit-btn">Submit & Continue</button>
                    </div>
                </div>
                <div class="assessment-response-status" id="assessment-response-status"></div>
            </div>
        `;
        App.refreshIcons();
        this._wirePromptControls();
        this._updateCharCount();
        if (isAIEval) this._loadAISample(prompt.id, aiSampleSlotId);
    },

    _labelForType(t) {
        return {
            'differential': 'Differential diagnosis',
            'context-curation': 'Context curation',
            'ai-output-evaluation': 'Evaluate AI output',
            'management': 'Management plan',
        }[t] || (t || 'Response');
    },

    _wirePromptControls() {
        const input = document.getElementById('assessment-response-input');
        if (input) {
            input.addEventListener('input', () => this._updateCharCount());
        }
        const submit = document.getElementById('assessment-submit-btn');
        if (submit) submit.addEventListener('click', () => this._submitCurrent());
        const draft = document.getElementById('assessment-save-draft-btn');
        if (draft) draft.addEventListener('click', () => this._saveDraft());
    },

    _updateCharCount() {
        const input = document.getElementById('assessment-response-input');
        const counter = document.getElementById('assessment-char-count');
        if (!input || !counter) return;
        counter.textContent = (input.value || '').length;
    },

    _renderChartArea() {
        // Intentionally minimal — the actual chart UI is the rest of the
        // standard EHR pages via the sidebar. We just leave a small marker
        // here so the resident knows they can navigate.
    },

    async _loadAISample(promptId, slotId) {
        const bodyEl = document.getElementById(slotId + '-body');
        if (!bodyEl) return;
        try {
            const sample = await AssessmentEngine.getAISampleFor(promptId);
            if (sample) {
                bodyEl.innerHTML = `<pre class="assessment-ai-sample-pre">${this._escape(sample)}</pre>`;
            } else {
                bodyEl.innerHTML = '<em>No sample generated.</em>';
            }
        } catch (err) {
            console.warn('AI sample load failed', err);
            bodyEl.innerHTML = `<em>Could not generate AI sample: ${this._escape(err.message || 'unknown error')}</em>`;
        }
    },

    async _saveDraft() {
        const input = document.getElementById('assessment-response-input');
        if (!input) return;
        const text = input.value || '';
        if (!text.trim()) {
            App.showToast('Nothing to save', 'info');
            return;
        }
        try {
            const cur = AssessmentEngine.getCurrent();
            // Saving a draft uses the same upsert as submit but does NOT grade.
            // We piggyback on submitResponse but without advancing.
            // Simplest approach: directly write via the engine's private helper
            // is not exposed — so for now, we just call submitResponse + don't
            // advance, but skip grading. We'll add a dedicated saveDraft in
            // engine if needed. For Phase 3 MVP, treat draft = submit and the
            // grader will run; the resident can edit before advancing.
            await AssessmentEngine.submitResponse(text);
            App.showToast('Draft saved.', 'success');
        } catch (err) {
            App.showToast('Save failed: ' + err.message, 'error');
        }
    },

    async _submitCurrent() {
        const input = document.getElementById('assessment-response-input');
        const status = document.getElementById('assessment-response-status');
        const submitBtn = document.getElementById('assessment-submit-btn');
        if (!input) return;
        const text = (input.value || '').trim();
        const cur = AssessmentEngine.getCurrent();
        if (!cur) return;
        const min = cur.prompt.minLength || 0;
        if (text.length < min) {
            App.showToast(`Response must be at least ${min} characters.`, 'error');
            return;
        }
        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Submitting…'; }
        if (status) status.innerHTML = '<span class="assessment-status-info">Submitting…</span>';

        try {
            await AssessmentEngine.submitResponse(text);
            this._gradingPromptIds.add(cur.prompt.id);

            // Advance cursor
            const result = await AssessmentEngine.advance();
            if (result.atEnd) {
                // Show finish-screen panel
                this._renderFinishConfirm();
            } else {
                this._renderBar();
                this._renderPromptArea();
            }
        } catch (err) {
            console.error('submit failed', err);
            App.showToast('Submit failed: ' + err.message, 'error');
            if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Submit & Continue'; }
            if (status) status.innerHTML = `<span class="assessment-status-error">${this._escape(err.message)}</span>`;
        }
    },

    _renderFinishConfirm() {
        const area = document.getElementById('assessment-prompt-area');
        if (!area) return;
        const pending = this._gradingPromptIds.size;
        area.innerHTML = `
            <div class="assessment-finish-card">
                <h2>You've finished all prompts.</h2>
                <p>${pending > 0 ? `${pending} response${pending === 1 ? '' : 's'} ${pending === 1 ? 'is' : 'are'} still being graded.` : 'All responses have been graded.'}</p>
                <p>When you click <strong>Finish &amp; See Results</strong> below, your final score will be calculated and you'll be taken to your scoring report. The case diagnosis will be revealed there.</p>
                <button class="btn btn-primary" id="assessment-finish-btn">Finish &amp; See Results</button>
            </div>
        `;
        document.getElementById('assessment-finish-btn').addEventListener('click', async () => {
            try {
                App.showLoading('Finalizing scores…');
                const { attemptId } = await AssessmentEngine.complete();
                router.navigate('/assessment/results/' + attemptId);
            } catch (err) {
                App.showToast('Could not finalize: ' + err.message, 'error');
            } finally {
                App.hideLoading();
            }
        });
    },

    _togglePause() {
        if (AssessmentEngine.isPaused()) {
            AssessmentEngine.resumeTimer();
        } else {
            AssessmentEngine.pause();
        }
        this._renderBar();
    },

    async _confirmAbandon() {
        if (!confirm('Abandon this attempt? You can start fresh from the assessment landing page.')) return;
        try {
            await AssessmentEngine.abandon();
            this._stopTicker();
            App.showToast('Attempt abandoned.', 'info');
            router.navigate('/assessment/start');
        } catch (err) {
            App.showToast('Could not abandon: ' + err.message, 'error');
        }
    },

    _startTicker() {
        this._stopTicker();
        this._expiredHandled = false;
        this._tickInterval = setInterval(() => {
            const t = document.getElementById('assessment-timer-text');
            if (!t) return;
            const used = AssessmentEngine.getTimeUsedSeconds();
            const limit = AssessmentEngine.getAssessmentTimeLimitSeconds();
            const rem = Math.max(0, limit - used);
            t.textContent = this._fmtTime(rem);
            if (rem === 0 && !this._expiredHandled) {
                this._expiredHandled = true;
                this._handleExpired();
            }
        }, 1000);
    },

    _stopTicker() {
        if (this._tickInterval) {
            clearInterval(this._tickInterval);
            this._tickInterval = null;
        }
    },

    async _handleExpired() {
        App.showToast('Time expired for this assessment — your current response will be submitted automatically.', 'info', 5000);
        const input = document.getElementById('assessment-response-input');
        const text = input ? (input.value || '').trim() : '';
        try {
            if (text) {
                await AssessmentEngine.submitResponse(text);
            }
            const result = await AssessmentEngine.advance();
            if (result.atEnd) this._renderFinishConfirm();
            else {
                this._renderBar();
                this._renderPromptArea();
            }
            this._startTicker();
            this._expiredHandled = false;
        } catch (err) {
            console.warn('auto-advance on expire failed', err);
        }
    },

    _attachEngineListener() {
        if (this._engineUnsub) this._engineUnsub();
        this._engineUnsub = AssessmentEngine.on((event, payload) => {
            if (event === 'response-graded') {
                this._gradingPromptIds.delete(payload.promptId);
            }
        });
    },

    _fmtTime(secs) {
        secs = Math.max(0, Math.floor(secs));
        const m = Math.floor(secs / 60);
        const s = secs % 60;
        return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    },

    _escape(s) {
        const el = document.createElement('span');
        el.textContent = s == null ? '' : String(s);
        return el.innerHTML;
    },
};

window.AssessmentPanel = AssessmentPanel;
