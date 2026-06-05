/**
 * EduTutor — Medical-education chatbot (standalone, route: #/tutor)
 *
 * Two-lane "answer + teaching" tutor:
 *   1. ANSWER lane   — answers the question like an excellent clinician (SOTA model).
 *   2. TEACHING lane — fires AFTER the answer (hybrid timing), reads the answer +
 *                      question + learner level, and returns structured teaching points.
 *
 * Deliberately ISOLATED from the assessment framework. It shares ONLY the
 * window.ClaudeAPI HTTP client. It does not touch AssessmentEngine, the grader,
 * the chart gate, the logger, or any patient data. Nothing here can read or
 * write assessment state.
 *
 * Global: window.EduTutor   Render entry: EduTutor.render()
 */

const EduTutor = (function () {
    'use strict';

    // ── Config ─────────────────────────────────────────────────────────
    const ANSWER_MODEL = 'claude-opus-4-8';
    const TEACHING_MODEL = 'claude-opus-4-8';
    const ANSWER_MAX_TOKENS = 1400;
    const TEACHING_MAX_TOKENS = 1200;

    const LEVELS = {
        student: {
            id: 'student',
            label: 'Med student',
            // How the teaching voice should calibrate for this learner.
            calibration:
                'The learner is a MEDICAL STUDENT. Define key terms, build the foundational framework explicitly, ' +
                'and keep one clear teaching thread. Favor first-principles over edge cases. Avoid overwhelming detail.',
        },
        resident: {
            id: 'resident',
            label: 'Resident',
            calibration:
                'The learner is a RESIDENT. Assume solid fundamentals. Emphasize clinical decision-making, the ' +
                'common real-world pitfalls, and the discriminating features that change management. Be efficient and high-yield.',
        },
        attending: {
            id: 'attending',
            label: 'Attending',
            calibration:
                'The learner is an ATTENDING / fellow. Skip the basics entirely. Focus on nuance, controversy, ' +
                'edge cases, evolving evidence, and the subtle reasoning errors even experienced clinicians make.',
        },
    };

    // ── Prompts ────────────────────────────────────────────────────────

    const ANSWER_SYSTEM =
        'You are an excellent attending physician answering a clinical question for a colleague. ' +
        'Give a direct, accurate, well-organized answer. Use clinical judgment and name the key reasoning. ' +
        'Do NOT add meta-commentary about teaching, learning objectives, or "teaching points" — another system ' +
        'handles the educational layer. Just give the best clinical answer. ' +
        'If the question is ambiguous or safety-critical, say what you would clarify and flag red flags. ' +
        'This is for clinician education, not a substitute for bedside judgment on a real patient. ' +
        'Format with short paragraphs, markdown headers (##), and bullet lists. Do NOT use markdown tables.';

    function teachingSystem(level) {
        const cal = (LEVELS[level] || LEVELS.resident).calibration;
        return (
            'You are a master clinician-educator. A colleague asked a clinical question and received an answer ' +
            '(both are given to you). Your job is NOT to re-answer it — it is to turn this exchange into a high-yield ' +
            'teaching moment. Teach AROUND the answer that was actually given: reinforce what is right, surface the ' +
            'principle behind it, and warn about what learners get wrong.\n\n' +
            cal +
            '\n\nRespond in EXACTLY these five sections, using these headers verbatim as markdown bold, in this order. ' +
            'Keep each section tight (1–3 sentences or a few bullets). Do not add other sections or preamble.\n\n' +
            '**Principle** — the framework, rule, or mechanism this answer is an instance of (e.g., the illness script, ' +
            'the Bayesian step, the guideline logic). Name it so it transfers to other cases.\n' +
            '**The trap** — the single most common mistake learners make here, and *why* they make it.\n' +
            '**What would change the answer** — the discriminating feature, next test, or "it depends on…" that flips ' +
            'the management.\n' +
            '**Pearl** — one memorable, high-yield takeaway worth retaining.\n' +
            '**Check yourself** — one probing question back to the learner (one-minute-preceptor style). Ask it; do not answer it.\n\n' +
            'Be specific to THIS question and answer. Never fabricate citations, trial names, or numbers — if you are ' +
            'not sure of a figure, speak qualitatively. Use prose and bullet lists only; do NOT use markdown tables.'
        );
    }

    // ── State ──────────────────────────────────────────────────────────
    // turns: [{ q, level, answer, teaching, answerErr, teachingErr }]
    let _turns = [];
    let _level = 'resident';
    let _busy = false;
    let _root = null;

    // ── Helpers ────────────────────────────────────────────────────────
    function _escape(s) {
        const el = document.createElement('div');
        el.textContent = s == null ? '' : String(s);
        return el.innerHTML;
    }

    // Light markdown: escape, **bold**, `code`, bullet lines, paragraphs.
    function _md(text) {
        let s = _escape(text || '');
        s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
        // Line-by-line: markdown headers, bullet lists, numbered lists, paragraphs.
        const lines = s.split('\n');
        let out = [];
        let inList = false;
        const closeList = () => { if (inList) { out.push('</ul>'); inList = false; } };
        for (let line of lines) {
            const hdr = line.match(/^\s*(#{1,6})\s+(.*)$/);
            const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
            const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
            if (hdr) {
                closeList();
                const lvl = Math.min(hdr[1].length + 2, 6); // # -> h3, ## -> h4 …
                out.push('<h' + lvl + ' class="tutor-h">' + hdr[2] + '</h' + lvl + '>');
            } else if (bullet) {
                if (!inList) { out.push('<ul>'); inList = true; }
                out.push('<li>' + bullet[1] + '</li>');
            } else if (numbered) {
                if (!inList) { out.push('<ul>'); inList = true; }
                out.push('<li>' + numbered[1] + '</li>');
            } else {
                closeList();
                if (line.trim() === '') out.push('');
                else out.push('<p>' + line + '</p>');
            }
        }
        closeList();
        return out.join('\n');
    }

    // ── Route isolation ────────────────────────────────────────────────
    // Toggle a body class on #/tutor so the global sim chrome (AI panel,
    // Patient/Nurse chat launchers, live-vitals banner) is hidden here.
    // CSS in epic-theme.css (body.route-tutor …) does the hiding.
    function _syncBodyClass() {
        const onTutor = (location.hash || '').indexOf('/tutor') >= 0;
        document.body.classList.toggle('route-tutor', onTutor);
    }
    window.addEventListener('hashchange', _syncBodyClass);

    // ── Render ─────────────────────────────────────────────────────────
    function render() {
        const content = document.getElementById('main-content');
        if (!content) return;
        _syncBodyClass();

        const levelBtns = Object.values(LEVELS)
            .map(
                (l) =>
                    `<button class="tutor-level-btn ${l.id === _level ? 'active' : ''}" data-level="${l.id}">${_escape(
                        l.label
                    )}</button>`
            )
            .join('');

        content.innerHTML = `
            <div class="tutor-page">
                <div class="tutor-header">
                    <div class="tutor-header-titles">
                        <h1 class="tutor-title"><i data-lucide="graduation-cap"></i> Teaching Tutor</h1>
                        <p class="tutor-subtitle">Ask a clinical question. Get the answer <em>and</em> the teaching.</p>
                    </div>
                    <div class="tutor-level-group" role="group" aria-label="Learner level">
                        <span class="tutor-level-label">Teach me as a:</span>
                        ${levelBtns}
                    </div>
                </div>

                <div class="tutor-thread" id="tutor-thread"></div>

                <div class="tutor-composer">
                    <textarea id="tutor-input" class="tutor-input" rows="2"
                        placeholder="Ask a clinical question — e.g. &quot;When do you anticoagulate a subsegmental PE?&quot;"></textarea>
                    <button id="tutor-send" class="tutor-send-btn" title="Ask">
                        <i data-lucide="send"></i>
                    </button>
                </div>
                <p class="tutor-disclaimer">For clinician education only — not medical advice for a specific patient. Verify any figures or citations before relying on them.</p>
            </div>
        `;

        _root = content.querySelector('.tutor-page');
        _bind();
        _renderThread();
        if (typeof App !== 'undefined' && App.refreshIcons) App.refreshIcons();

        const input = _root.querySelector('#tutor-input');
        if (input) input.focus();
    }

    function _bind() {
        _root.querySelectorAll('.tutor-level-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                _level = btn.getAttribute('data-level');
                _root.querySelectorAll('.tutor-level-btn').forEach((b) =>
                    b.classList.toggle('active', b === btn)
                );
            });
        });

        const send = _root.querySelector('#tutor-send');
        const input = _root.querySelector('#tutor-input');
        if (send) send.addEventListener('click', _submit);
        if (input) {
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    _submit();
                }
            });
        }
    }

    function _renderThread() {
        const thread = _root && _root.querySelector('#tutor-thread');
        if (!thread) return;

        if (_turns.length === 0) {
            thread.innerHTML = `
                <div class="tutor-empty">
                    <div class="tutor-empty-icon"><i data-lucide="stethoscope"></i></div>
                    <div class="tutor-empty-text">Ask a clinical question to get started.</div>
                    <div class="tutor-empty-examples">
                        <button class="tutor-example">What's the workup for new-onset unilateral leg swelling?</button>
                        <button class="tutor-example">How do I dose vancomycin in AKI?</button>
                        <button class="tutor-example">When is an IVC filter indicated in VTE?</button>
                    </div>
                </div>
            `;
            thread.querySelectorAll('.tutor-example').forEach((b) =>
                b.addEventListener('click', () => {
                    const input = _root.querySelector('#tutor-input');
                    if (input) { input.value = b.textContent; input.focus(); }
                })
            );
            if (typeof App !== 'undefined' && App.refreshIcons) App.refreshIcons();
            return;
        }

        thread.innerHTML = _turns.map(_renderTurn).join('');
        if (typeof App !== 'undefined' && App.refreshIcons) App.refreshIcons();
        thread.scrollTop = thread.scrollHeight;
    }

    function _renderTurn(turn, i) {
        const lvl = (LEVELS[turn.level] || LEVELS.resident).label;

        // Answer pane
        let answerHtml;
        if (turn.answerErr) {
            answerHtml = `<div class="tutor-error">Answer failed: ${_escape(turn.answerErr)}</div>`;
        } else if (turn.answer == null) {
            answerHtml = `<div class="tutor-loading"><span class="tutor-dot"></span><span class="tutor-dot"></span><span class="tutor-dot"></span> Thinking…</div>`;
        } else {
            answerHtml = `<div class="tutor-md">${_md(turn.answer)}</div>`;
        }

        // Teaching pane
        let teachHtml;
        if (turn.teachingErr) {
            teachHtml = `<div class="tutor-error">Teaching failed: ${_escape(turn.teachingErr)}</div>`;
        } else if (turn.answer == null) {
            teachHtml = `<div class="tutor-teach-waiting">Teaching points appear once the answer is ready…</div>`;
        } else if (turn.teaching == null) {
            teachHtml = `<div class="tutor-loading"><span class="tutor-dot"></span><span class="tutor-dot"></span><span class="tutor-dot"></span> Preparing teaching points…</div>`;
        } else {
            teachHtml = `<div class="tutor-md tutor-teach-md">${_md(turn.teaching)}</div>`;
        }

        return `
            <div class="tutor-turn">
                <div class="tutor-question"><span class="tutor-q-badge">Q</span><span class="tutor-q-text">${_escape(
                    turn.q
                )}</span><span class="tutor-q-level">${_escape(lvl)}</span></div>
                <div class="tutor-panes">
                    <section class="tutor-pane tutor-pane-answer">
                        <div class="tutor-pane-head"><i data-lucide="message-square"></i> Answer</div>
                        ${answerHtml}
                    </section>
                    <section class="tutor-pane tutor-pane-teach">
                        <div class="tutor-pane-head"><i data-lucide="lightbulb"></i> Teaching points</div>
                        ${teachHtml}
                    </section>
                </div>
            </div>
        `;
    }

    // ── Submit / lanes ─────────────────────────────────────────────────
    async function _submit() {
        if (_busy) return;
        const input = _root && _root.querySelector('#tutor-input');
        if (!input) return;
        const q = (input.value || '').trim();
        if (!q) return;

        if (!ClaudeAPI || !ClaudeAPI.isConfigured()) {
            alert('Add your Anthropic API key first (AI panel settings).');
            return;
        }

        _busy = true;
        const sendBtn = _root.querySelector('#tutor-send');
        if (sendBtn) sendBtn.disabled = true;
        input.value = '';

        const turn = { q, level: _level, answer: null, teaching: null, answerErr: null, teachingErr: null };
        _turns.push(turn);
        _renderThread();

        // LANE 1 — Answer (fires immediately).
        try {
            turn.answer = await ClaudeAPI._singleChat({
                systemPrompt: ANSWER_SYSTEM,
                userMessage: q,
                model: ANSWER_MODEL,
                maxTokens: ANSWER_MAX_TOKENS,
            });
        } catch (e) {
            turn.answerErr = (e && e.message) || String(e);
        }
        _renderThread();

        // LANE 2 — Teaching (hybrid: fires after the answer, reads the answer).
        if (!turn.answerErr) {
            try {
                const userMessage =
                    'CLINICAL QUESTION:\n' +
                    q +
                    '\n\nANSWER GIVEN TO THE LEARNER:\n' +
                    turn.answer +
                    '\n\nNow produce the teaching points as instructed.';
                turn.teaching = await ClaudeAPI._singleChat({
                    systemPrompt: teachingSystem(turn.level),
                    userMessage,
                    model: TEACHING_MODEL,
                    maxTokens: TEACHING_MAX_TOKENS,
                });
            } catch (e) {
                turn.teachingErr = (e && e.message) || String(e);
            }
            _renderThread();
        }

        _busy = false;
        if (sendBtn) sendBtn.disabled = false;
        const inp = _root.querySelector('#tutor-input');
        if (inp) inp.focus();
    }

    // ── Public API ─────────────────────────────────────────────────────
    return {
        render,
        // exposed for debugging / future reuse
        _state: () => ({ turns: _turns, level: _level, busy: _busy }),
    };
})();

window.EduTutor = EduTutor;
