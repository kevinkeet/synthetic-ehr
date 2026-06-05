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
    // turns: [{ q, level, answer, teaching, answerErr, teachingErr, _flipped, _open:Set }]
    let _turns = [];
    let _level = 'resident';
    let _busy = false;
    let _root = null;
    let _displayMode = 'rail'; // rail | margin | flip | chips

    // The four teaching-pane treatments being compared.
    const DISPLAY_MODES = [
        { id: 'rail', label: 'Side rail' },
        { id: 'margin', label: 'Margin notes' },
        { id: 'flip', label: 'Flip card' },
        { id: 'chips', label: 'Inline chips' },
    ];

    // Canonical teaching sections (parsed out of the teaching text) + their
    // short chip labels and icons. Order is the display order.
    const SECTION_META = [
        { key: 'Principle', short: 'Principle', icon: 'compass' },
        { key: 'The trap', short: 'The trap', icon: 'triangle-alert' },
        { key: 'What would change the answer', short: 'What changes it', icon: 'git-branch' },
        { key: 'Pearl', short: 'Pearl', icon: 'gem' },
        { key: 'Check yourself', short: 'Check yourself', icon: 'circle-help' },
    ];

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

    // Parse the teaching text into its five canonical sections.
    // Returns [{ key, body }] in SECTION_META order, or null if the text
    // doesn't match the expected structure (caller falls back to raw md).
    function _parseTeaching(text) {
        if (!text) return null;
        const re = /\*\*\s*(Principle|The trap|What would change the answer|Pearl|Check yourself)\s*\*\*\s*[—\-:]*\s*/g;
        const hits = [];
        let m;
        while ((m = re.exec(text))) {
            hits.push({ key: m[1], bodyStart: re.lastIndex, headStart: m.index });
        }
        if (hits.length < 2) return null;
        const found = {};
        for (let i = 0; i < hits.length; i++) {
            const end = i + 1 < hits.length ? hits[i + 1].headStart : text.length;
            found[hits[i].key] = text.slice(hits[i].bodyStart, end).trim();
        }
        return SECTION_META.filter((s) => found[s.key] != null).map((s) => ({
            key: s.key,
            short: s.short,
            icon: s.icon,
            body: found[s.key],
        }));
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
                    <div class="tutor-controls">
                        <div class="tutor-level-group" role="group" aria-label="Learner level">
                            <span class="tutor-level-label">Teach me as a:</span>
                            ${levelBtns}
                        </div>
                        <div class="tutor-mode-group" role="group" aria-label="Teaching layout">
                            <span class="tutor-level-label">Layout:</span>
                            ${DISPLAY_MODES.map(
                                (mo) =>
                                    `<button class="tutor-mode-btn ${mo.id === _displayMode ? 'active' : ''}" data-mode="${mo.id}">${_escape(
                                        mo.label
                                    )}</button>`
                            ).join('')}
                        </div>
                    </div>
                </div>

                <div class="tutor-thread tutor-thread-${_displayMode}" id="tutor-thread"></div>

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

        // Display-mode switcher — re-renders the same turns in a new layout.
        _root.querySelectorAll('.tutor-mode-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                _displayMode = btn.getAttribute('data-mode');
                _root.querySelectorAll('.tutor-mode-btn').forEach((b) =>
                    b.classList.toggle('active', b === btn)
                );
                const thread = _root.querySelector('#tutor-thread');
                if (thread) thread.className = 'tutor-thread tutor-thread-' + _displayMode;
                _renderThread();
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

        // Delegated interactions inside the thread (flip, chips, rail collapse).
        const thread = _root.querySelector('#tutor-thread');
        if (thread) {
            thread.addEventListener('click', (e) => {
                const flipBtn = e.target.closest('[data-flip]');
                const chip = e.target.closest('[data-chip]');
                const railToggle = e.target.closest('[data-rail-toggle]');
                if (flipBtn) {
                    const turn = _turnFromEl(flipBtn);
                    if (turn) { turn._flipped = !turn._flipped; _renderThread(); }
                } else if (chip) {
                    const turn = _turnFromEl(chip);
                    if (turn) {
                        const key = chip.getAttribute('data-chip');
                        turn._open = turn._open || new Set();
                        if (turn._open.has(key)) turn._open.delete(key);
                        else turn._open.add(key);
                        _renderThread();
                    }
                } else if (railToggle) {
                    const turn = _turnFromEl(railToggle);
                    if (turn) { turn._railCollapsed = !turn._railCollapsed; _renderThread(); }
                }
            });
        }
    }

    function _turnFromEl(el) {
        const wrap = el.closest('.tutor-turn');
        if (!wrap) return null;
        const idx = parseInt(wrap.getAttribute('data-turn'), 10);
        return _turns[idx] || null;
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
        _afterRenderThread();
        thread.scrollTop = thread.scrollHeight;
    }

    // After DOM insertion: size flip cards to their visible face (faces are
    // absolutely positioned) and trigger the rail slide-in transition.
    function _afterRenderThread() {
        if (!_root) return;
        _root.querySelectorAll('.tutor-flip').forEach((flip) => {
            const showingBack = flip.classList.contains('is-flipped');
            const face = flip.querySelector(showingBack ? '.tutor-flip-back' : '.tutor-flip-front');
            if (face) flip.style.height = face.offsetHeight + 'px';
        });
        requestAnimationFrame(() => {
            if (!_root) return;
            _root.querySelectorAll('.tutor-rail[data-animate-in]').forEach((r) => {
                r.removeAttribute('data-animate-in');
                r.classList.add('tutor-rail-in');
            });
        });
    }

    // ── Shared fragments ───────────────────────────────────────────────
    function _dots(label) {
        return `<div class="tutor-loading"><span class="tutor-dot"></span><span class="tutor-dot"></span><span class="tutor-dot"></span> ${_escape(label)}</div>`;
    }
    function _answerBodyHtml(turn) {
        if (turn.answerErr) return `<div class="tutor-error">Answer failed: ${_escape(turn.answerErr)}</div>`;
        if (turn.answer == null) return _dots('Thinking…');
        return `<div class="tutor-md">${_md(turn.answer)}</div>`;
    }
    // Returns { status: 'err'|'waiting'|'loading'|'ready', html?, sections?, raw? }
    function _teachState(turn) {
        if (turn.teachingErr) return { status: 'err', html: `<div class="tutor-error">Teaching failed: ${_escape(turn.teachingErr)}</div>` };
        if (turn.answer == null) return { status: 'waiting' };
        if (turn.teaching == null) return { status: 'loading' };
        return { status: 'ready', sections: _parseTeaching(turn.teaching), raw: turn.teaching };
    }
    function _questionHtml(turn) {
        const lvl = (LEVELS[turn.level] || LEVELS.resident).label;
        return `<div class="tutor-question"><span class="tutor-q-badge">Q</span><span class="tutor-q-text">${_escape(turn.q)}</span><span class="tutor-q-level">${_escape(lvl)}</span></div>`;
    }
    function _sectionsHtml(sections, raw) {
        if (!sections) return `<div class="tutor-md tutor-teach-md">${_md(raw)}</div>`;
        return sections.map((s) =>
            `<div class="tutor-section">
                <div class="tutor-section-head"><i data-lucide="${s.icon}"></i> ${_escape(s.short)}</div>
                <div class="tutor-md tutor-teach-md">${_md(s.body)}</div>
            </div>`
        ).join('');
    }

    // ── Turn dispatcher ────────────────────────────────────────────────
    function _renderTurn(turn, i) {
        const inner =
            _displayMode === 'margin' ? _turnMargin(turn) :
            _displayMode === 'flip' ? _turnFlip(turn) :
            _displayMode === 'chips' ? _turnChips(turn) :
            _turnRail(turn);
        return `<div class="tutor-turn" data-turn="${i}">${_questionHtml(turn)}${inner}</div>`;
    }

    // Mode: SIDE RAIL — answer + a teaching rail that slides in from the right.
    function _turnRail(turn) {
        const t = _teachState(turn);
        let rail;
        if (t.status === 'err') rail = t.html;
        else if (t.status === 'waiting') rail = `<div class="tutor-teach-waiting">Teaching appears once the answer is ready…</div>`;
        else if (t.status === 'loading') rail = _dots('Preparing teaching…');
        else rail = _sectionsHtml(t.sections, t.raw);

        const collapsed = !!turn._railCollapsed;
        const animate = t.status === 'ready' && !collapsed ? ' data-animate-in' : '';
        return `
            <div class="tutor-rail-layout ${collapsed ? 'rail-collapsed' : ''}">
                <section class="tutor-pane tutor-pane-answer">
                    <div class="tutor-pane-head"><i data-lucide="message-square"></i> Answer</div>
                    ${_answerBodyHtml(turn)}
                </section>
                <aside class="tutor-rail"${animate}>
                    <button class="tutor-rail-toggle" data-rail-toggle title="${collapsed ? 'Expand' : 'Collapse'} teaching">
                        <i data-lucide="${collapsed ? 'chevron-left' : 'chevron-right'}"></i>
                    </button>
                    <div class="tutor-rail-head"><i data-lucide="lightbulb"></i> <span>Teaching</span></div>
                    <div class="tutor-rail-body">${rail}</div>
                    <div class="tutor-rail-spine">Teaching</div>
                </aside>
            </div>`;
    }

    // Mode: MARGIN NOTES — answer in a column, teaching sections in the gutter.
    function _turnMargin(turn) {
        const t = _teachState(turn);
        let notes;
        if (t.status === 'err') notes = t.html;
        else if (t.status === 'waiting') notes = `<div class="tutor-teach-waiting">Notes appear once the answer is ready…</div>`;
        else if (t.status === 'loading') notes = _dots('Annotating…');
        else if (t.sections) notes = t.sections.map((s, idx) =>
            `<div class="tutor-note" style="--note-i:${idx}">
                <span class="tutor-note-dot"></span>
                <div class="tutor-note-head"><i data-lucide="${s.icon}"></i> ${_escape(s.short)}</div>
                <div class="tutor-md tutor-teach-md">${_md(s.body)}</div>
            </div>`
        ).join('');
        else notes = `<div class="tutor-md tutor-teach-md">${_md(t.raw)}</div>`;
        return `
            <div class="tutor-margin-layout">
                <section class="tutor-margin-answer">
                    <div class="tutor-pane-head"><i data-lucide="message-square"></i> Answer</div>
                    ${_answerBodyHtml(turn)}
                </section>
                <aside class="tutor-margin-notes">${notes}</aside>
            </div>`;
    }

    // Mode: FLIP CARD — answer front, "Teach me this" flips to teaching back.
    function _turnFlip(turn) {
        const t = _teachState(turn);
        const flipped = !!turn._flipped;
        let backBody;
        if (t.status === 'err') backBody = t.html;
        else if (t.status === 'waiting') backBody = `<div class="tutor-teach-waiting">Teaching appears once the answer is ready…</div>`;
        else if (t.status === 'loading') backBody = _dots('Preparing teaching…');
        else backBody = _sectionsHtml(t.sections, t.raw);

        const canFlip = t.status === 'ready' || t.status === 'err';
        return `
            <div class="tutor-flip ${flipped ? 'is-flipped' : ''}">
                <div class="tutor-flip-inner">
                    <section class="tutor-flip-face tutor-flip-front tutor-pane">
                        <div class="tutor-pane-head"><i data-lucide="message-square"></i> Answer</div>
                        ${_answerBodyHtml(turn)}
                        <div class="tutor-flip-actions">
                            <button class="tutor-flip-btn" data-flip ${canFlip ? '' : 'disabled'}>
                                <i data-lucide="rotate-cw"></i> Teach me this
                            </button>
                        </div>
                    </section>
                    <section class="tutor-flip-face tutor-flip-back tutor-pane tutor-pane-teach">
                        <div class="tutor-pane-head"><i data-lucide="lightbulb"></i> Teaching points</div>
                        ${backBody}
                        <div class="tutor-flip-actions">
                            <button class="tutor-flip-btn ghost" data-flip>
                                <i data-lucide="rotate-ccw"></i> Back to answer
                            </button>
                        </div>
                    </section>
                </div>
            </div>`;
    }

    // Mode: INLINE CHIPS — answer, then expandable teaching pills.
    function _turnChips(turn) {
        const t = _teachState(turn);
        let strip;
        if (t.status === 'err') strip = t.html;
        else if (t.status === 'waiting') strip = `<div class="tutor-teach-waiting">Teaching appears once the answer is ready…</div>`;
        else if (t.status === 'loading') strip = _dots('Preparing teaching…');
        else if (t.sections) {
            const open = turn._open || new Set();
            const chips = t.sections.map((s) =>
                `<button class="tutor-chip ${open.has(s.key) ? 'active' : ''}" data-chip="${_escape(s.key)}">
                    <i data-lucide="${s.icon}"></i> ${_escape(s.short)}
                </button>`
            ).join('');
            const panels = t.sections.filter((s) => open.has(s.key)).map((s) =>
                `<div class="tutor-chip-panel">
                    <div class="tutor-section-head"><i data-lucide="${s.icon}"></i> ${_escape(s.short)}</div>
                    <div class="tutor-md tutor-teach-md">${_md(s.body)}</div>
                </div>`
            ).join('');
            strip = `<div class="tutor-chip-row">${chips}</div><div class="tutor-chip-panels">${panels}</div>`;
        } else {
            strip = `<div class="tutor-md tutor-teach-md">${_md(t.raw)}</div>`;
        }
        return `
            <section class="tutor-pane tutor-pane-answer tutor-chips-answer">
                <div class="tutor-pane-head"><i data-lucide="message-square"></i> Answer</div>
                ${_answerBodyHtml(turn)}
                <div class="tutor-chips-teach">${strip}</div>
            </section>`;
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
