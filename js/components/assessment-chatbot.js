/**
 * AssessmentChatbot — chatbot shown during assessment runs.
 *
 * Replaces the full AI Coworker panel during an assessment. The resident
 * picks a time window and a set of data types, then chats. The selections
 * become the chart context for the model.
 *
 * All chat calls go through ClaudeAPI.sendMessage, so the existing
 * AssessmentLogger automatically records each interaction with the
 * structured chatbot_setup metadata for backend analysis.
 *
 * Lifecycle:
 *   AssessmentChatbot.activate({ attemptId })   — called by engine on start/resume
 *   AssessmentChatbot.deactivate()              — called by engine on stop/complete/abandon
 */

const AssessmentChatbot = (() => {
    const LOG = (...a) => console.log('💬 Chatbot', ...a);
    const WARN = (...a) => console.warn('💬 Chatbot', ...a);

    // ── State ──────────────────────────────────────────────────────────
    let _active = false;
    let _attemptId = null;
    let _root = null;          // root DOM node for the chatbot panel

    let _phase = 'setup';       // 'setup' | 'chat'
    let _config = null;         // { windowKey, dataTypes: [] } once configured
    let _messages = [];         // [{role:'user'|'assistant'|'divider', content, promptId?}]
    let _isWaiting = false;
    let _currentPromptId = null;  // tracks the prompt the resident is on
    let _engineUnsub = null;

    // ── Constants ──────────────────────────────────────────────────────

    const TIME_WINDOWS = [
        { key: 'today',     label: 'Today only',          days: 0   },
        { key: '7d',        label: 'Last 7 days',         days: 7   },
        { key: '30d',       label: 'Last 30 days',        days: 30  },
        { key: '90d',       label: 'Last 90 days',        days: 90  },
        { key: '6mo',       label: 'Last 6 months',       days: 180 },
        { key: '1y',        label: 'Last 1 year',         days: 365 },
        { key: 'all',       label: 'All available history',days: 99999 },
    ];

    const DATA_TYPES = [
        // Time-windowed
        { key: 'notes',         label: 'Clinical notes',     windowed: true,  group: 'time' },
        { key: 'labs',          label: 'Lab results',        windowed: true,  group: 'time' },
        { key: 'vitals',        label: 'Vital signs',        windowed: true,  group: 'time' },
        { key: 'imaging',       label: 'Imaging reports',    windowed: true,  group: 'time' },
        { key: 'encounters',    label: 'Encounters',         windowed: true,  group: 'time' },
        { key: 'procedures',    label: 'Procedures',         windowed: true,  group: 'time' },
        { key: 'orders',        label: 'Orders',             windowed: true,  group: 'time' },
        // Static (current-state)
        { key: 'problems',      label: 'Problem list',       windowed: false, group: 'static' },
        { key: 'medications',   label: 'Medication list',    windowed: false, group: 'static' },
        { key: 'allergies',     label: 'Allergies',          windowed: false, group: 'static' },
        { key: 'social',        label: 'Social history',     windowed: false, group: 'static' },
        { key: 'family',        label: 'Family history',     windowed: false, group: 'static' },
        { key: 'immunizations', label: 'Immunizations',      windowed: false, group: 'static' },
    ];

    const MAX_CONTEXT_CHARS = 60000;     // soft cap before truncation
    const MAX_RESPONSE_TOKENS = 1024;    // soft ceiling on length (a concise reply fits easily)
    const CHATBOT_MODEL = 'claude-haiku-4-5-20251001';  // fast + cheap; matches the chatbot's "answer concisely" UX
    // BLANK system prompt by design. The assessment AI must be maximally
    // construct-neutral: no framing, no verbosity nudge, no reasoning/ethics
    // rules — nothing that could substitute for the participant's own
    // prompting skill (the construct being measured) or vary across RCT arms.
    // The chart context is prefixed onto the first user message (see below);
    // everything else is exactly what the participant types.
    const SYSTEM_PROMPT = '';

    // ── Activate / deactivate ──────────────────────────────────────────

    function activate({ attemptId }) {
        if (_active) deactivate();
        _attemptId = attemptId;
        _phase = 'setup';
        _config = null;
        _messages = [];
        _isWaiting = false;

        // Hide AI Coworker panel + assistant FAB via body class
        document.body.classList.add('in-assessment');

        // Track which prompt the resident is on; inject a divider into the
        // chat history every time the cursor moves so the conversation has
        // visible per-prompt boundaries.
        if (typeof AssessmentEngine !== 'undefined' && AssessmentEngine.getCurrent) {
            const cur = AssessmentEngine.getCurrent();
            _currentPromptId = cur?.prompt?.id || null;
        }
        if (typeof AssessmentEngine !== 'undefined' && AssessmentEngine.on) {
            _engineUnsub = AssessmentEngine.on((event /*, payload */) => {
                if (event === 'cursor-moved' || event === 'assessment-advanced') {
                    _handlePromptCursorMove();
                }
            });
        }

        _mountRoot();
        _renderSetup();
        _active = true;
        LOG('Activated for attempt', attemptId);
    }

    function deactivate() {
        if (!_active && !_root) return;
        if (_root) {
            _root.remove();
            _root = null;
        }
        document.body.classList.remove('in-assessment');
        if (_engineUnsub) { try { _engineUnsub(); } catch (e) {} }
        _engineUnsub = null;
        _active = false;
        _attemptId = null;
        _phase = 'setup';
        _config = null;
        _messages = [];
        _currentPromptId = null;
        LOG('Deactivated');
    }

    function _handlePromptCursorMove() {
        if (!AssessmentEngine.getCurrent) return;
        const cur = AssessmentEngine.getCurrent();
        const newPromptId = cur?.prompt?.id || null;
        if (newPromptId === _currentPromptId) return;
        _currentPromptId = newPromptId;
        // Only inject divider if there's an existing conversation worth marking
        if (_messages.length === 0) return;
        const apId = cur?.assessment?.id || '';
        const title = cur?.assessment?.title || '';
        _messages.push({
            role: 'divider',
            content: `Now on ${newPromptId}` + (title ? ` — ${apId}: ${title}` : ''),
        });
        if (_phase === 'chat') _renderMessages();
    }

    function isActive() { return _active; }

    function _mountRoot() {
        if (_root) return;
        _root = document.createElement('aside');
        _root.id = 'assessment-chatbot-panel';
        _root.className = 'assessment-chatbot-panel';
        document.body.appendChild(_root);
    }

    // ── Setup phase render ─────────────────────────────────────────────

    function _renderSetup() {
        if (!_root) return;
        _phase = 'setup';

        const checkedWindow = _config?.windowKey || '30d';
        const checkedTypes  = new Set(_config?.dataTypes || ['notes', 'labs']);

        _root.innerHTML = `
            <div class="acb-header">
                <div class="acb-header-title">
                    <i data-lucide="message-square" class="lucide-inline"></i>
                    Chatbot
                </div>
                <div class="acb-header-sub">Pick what to include, then chat.</div>
            </div>
            <div class="acb-setup">
                <div class="acb-setup-section">
                    <h4>Time window (relative to today's case timeline)</h4>
                    <div class="acb-window-options">
                        ${TIME_WINDOWS.map((w) => `
                            <label class="acb-radio">
                                <input type="radio" name="acb-window" value="${w.key}" ${w.key === checkedWindow ? 'checked' : ''}>
                                <span>${_escape(w.label)}</span>
                            </label>
                        `).join('')}
                    </div>
                </div>

                <div class="acb-setup-section">
                    <h4>Data to include</h4>
                    <div class="acb-types-group-label">Time-windowed</div>
                    <div class="acb-types-grid">
                        ${DATA_TYPES.filter((d) => d.group === 'time').map((d) => `
                            <label class="acb-check">
                                <input type="checkbox" name="acb-type" value="${d.key}" ${checkedTypes.has(d.key) ? 'checked' : ''}>
                                <span>${_escape(d.label)}</span>
                            </label>
                        `).join('')}
                    </div>
                    <div class="acb-types-group-label">Current-state (no time filter)</div>
                    <div class="acb-types-grid">
                        ${DATA_TYPES.filter((d) => d.group === 'static').map((d) => `
                            <label class="acb-check">
                                <input type="checkbox" name="acb-type" value="${d.key}" ${checkedTypes.has(d.key) ? 'checked' : ''}>
                                <span>${_escape(d.label)}</span>
                            </label>
                        `).join('')}
                    </div>
                </div>

                <div class="acb-setup-actions">
                    <button class="btn btn-primary acb-start-btn">Start chatting</button>
                    ${_messages.length > 0 ? '<button class="btn acb-cancel-btn">Cancel — keep current chat</button>' : ''}
                </div>

                <div class="acb-setup-hint">
                    <i data-lucide="info" class="lucide-inline"></i>
                    You can change these selections at any time. Your conversation will continue.
                </div>
            </div>
        `;
        App.refreshIcons();

        const startBtn = _root.querySelector('.acb-start-btn');
        startBtn.addEventListener('click', () => {
            const windowKey = _root.querySelector('input[name="acb-window"]:checked')?.value || '30d';
            const types = Array.from(_root.querySelectorAll('input[name="acb-type"]:checked')).map((el) => el.value);
            if (types.length === 0) {
                App.showToast('Pick at least one data type.', 'error');
                return;
            }
            _config = { windowKey, dataTypes: types };
            _renderChat();
        });

        const cancelBtn = _root.querySelector('.acb-cancel-btn');
        if (cancelBtn) cancelBtn.addEventListener('click', () => _renderChat());
    }

    // ── Chat phase render ──────────────────────────────────────────────

    function _renderChat() {
        if (!_root) return;
        _phase = 'chat';

        const windowDef = TIME_WINDOWS.find((w) => w.key === _config.windowKey) || TIME_WINDOWS[2];
        const typeLabels = _config.dataTypes
            .map((k) => DATA_TYPES.find((d) => d.key === k)?.label || k)
            .join(' · ');

        _root.innerHTML = `
            <div class="acb-header">
                <div class="acb-header-title">
                    <i data-lucide="message-square" class="lucide-inline"></i>
                    Assessment Chatbot
                </div>
                <div class="acb-context-summary">
                    <div class="acb-context-line">
                        <strong>Context:</strong> ${_escape(windowDef.label)}
                    </div>
                    <div class="acb-context-line acb-context-types">${_escape(typeLabels)}</div>
                    <button class="acb-change-context-btn">
                        <i data-lucide="sliders-horizontal" class="lucide-inline"></i>
                        Change context
                    </button>
                </div>
            </div>
            <div class="acb-messages" id="acb-messages"></div>
            <div class="acb-composer">
                <textarea class="acb-input"
                          id="acb-input"
                          placeholder="Ask the chatbot something about this patient..."
                          rows="3"></textarea>
                <div class="acb-composer-row">
                    <div class="acb-composer-hint">
                        The chatbot only sees the chart data you selected.
                    </div>
                    <button class="btn btn-primary acb-send-btn" id="acb-send-btn">
                        <i data-lucide="send" class="lucide-inline"></i>
                        Send
                    </button>
                </div>
            </div>
        `;
        App.refreshIcons();

        _renderMessages();

        _root.querySelector('.acb-change-context-btn').addEventListener('click', () => _renderSetup());
        const input = _root.querySelector('#acb-input');
        const sendBtn = _root.querySelector('#acb-send-btn');
        sendBtn.addEventListener('click', () => _sendMessage());
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                _sendMessage();
            }
        });
    }

    function _renderMessages() {
        const container = _root.querySelector('#acb-messages');
        if (!container) return;
        if (_messages.length === 0) {
            container.innerHTML = `
                <div class="acb-empty">
                    <i data-lucide="message-square" class="lucide-inline"></i>
                    <div>Ask anything about the patient using the context you selected.</div>
                </div>
            `;
        } else {
            container.innerHTML = _messages.map((m) => {
                if (m.role === 'divider') {
                    return `
                        <div class="acb-divider">
                            <span class="acb-divider-line"></span>
                            <span class="acb-divider-label">${_escape(m.content)}</span>
                            <span class="acb-divider-line"></span>
                        </div>
                    `;
                }
                return `
                    <div class="acb-msg acb-msg-${m.role}">
                        <div class="acb-msg-role">${m.role === 'user' ? 'You' : 'Chatbot'}</div>
                        <div class="acb-msg-body">${_renderMessageBody(m.content)}</div>
                    </div>
                `;
            }).join('');
        }
        if (_isWaiting) {
            container.insertAdjacentHTML('beforeend', `
                <div class="acb-msg acb-msg-assistant acb-msg-waiting">
                    <div class="acb-msg-role">Chatbot</div>
                    <div class="acb-msg-body"><span class="acb-typing">Thinking...</span></div>
                </div>
            `);
        }
        App.refreshIcons();
        container.scrollTop = container.scrollHeight;
    }

    function _renderMessageBody(text) {
        // Light markdown-ish: preserve newlines, escape HTML, bold **x**.
        let s = _escape(text || '');
        s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        s = s.replace(/\n/g, '<br/>');
        return s;
    }

    // ── Send a message ─────────────────────────────────────────────────

    async function _sendMessage() {
        if (_isWaiting) return;
        const input = _root.querySelector('#acb-input');
        const sendBtn = _root.querySelector('#acb-send-btn');
        if (!input) return;
        const text = (input.value || '').trim();
        if (!text) return;

        _messages.push({ role: 'user', content: text });
        input.value = '';
        _isWaiting = true;
        if (sendBtn) sendBtn.disabled = true;
        _renderMessages();

        try {
            const contextBlock = await _buildContextBlock();

            // The model gets a BLANK system prompt — no framing, no rules,
            // no verbosity nudge, no "help them reason" — that's
            // deliberate. The chart context is provided as a prefix on
            // the FIRST user message; subsequent user messages are sent
            // as-typed. If the resident changes context mid-session,
            // the prefix on the first user message is rebuilt on the next
            // API call so the latest chart is what the model sees.
            //
            // Divider entries are UI-only markers — strip them before
            // sending to the model.
            const realMessages = _messages.filter((m) => m.role === 'user' || m.role === 'assistant');
            const apiMessages = realMessages.map((m, i) => {
                if (i === 0 && m.role === 'user') {
                    return {
                        role: 'user',
                        content:
                            'PATIENT CHART CONTEXT:\n\n' +
                            contextBlock +
                            '\n\n— END OF CHART CONTEXT —\n\n' +
                            m.content,
                    };
                }
                return { role: m.role, content: m.content };
            });

            // Attach structured chatbot setup to the next captured log row
            // so the results report and admin dashboard can analyze context-
            // curation choices.
            if (typeof AssessmentLogger !== 'undefined' && AssessmentLogger.attachMetadata) {
                AssessmentLogger.attachMetadata({
                    source: 'assessment_chatbot',
                    chatbot_setup: {
                        windowKey: _config.windowKey,
                        dataTypes: _config.dataTypes.slice().sort(),
                        contextChars: contextBlock.length,
                        turn: _messages.length,
                    },
                });
            }

            const response = await ClaudeAPI.sendMessage(SYSTEM_PROMPT, apiMessages, {
                model: CHATBOT_MODEL,
                maxTokens: MAX_RESPONSE_TOKENS,
            });
            let replyText = '';
            if (response && response.content && Array.isArray(response.content)) {
                replyText = response.content
                    .filter((c) => c && c.type === 'text')
                    .map((c) => c.text)
                    .join('\n');
            }
            if (!replyText) replyText = '(The chatbot returned an empty response.)';

            _messages.push({ role: 'assistant', content: replyText });
        } catch (err) {
            console.error('chatbot send failed', err);
            _messages.push({
                role: 'assistant',
                content: '⚠️ The chatbot encountered an error: ' + (err.message || String(err)),
            });
        } finally {
            _isWaiting = false;
            if (sendBtn) sendBtn.disabled = false;
            _renderMessages();
            input.focus();
        }
    }

    // _buildSystemPrompt was removed deliberately — the chatbot is sent NO
    // system prompt. The chart context is prefixed onto the first user
    // message in _sendMessage. See the comment there for the rationale.

    // ── Context assembly ───────────────────────────────────────────────

    async function _buildContextBlock() {
        const windowDef = TIME_WINDOWS.find((w) => w.key === _config.windowKey) || TIME_WINDOWS[2];
        const anchorIso = (AssessmentChartGate.getAnchor && AssessmentChartGate.getAnchor()) || new Date().toISOString();
        const anchor = Date.parse(anchorIso);
        const from = anchor - (windowDef.days * 86400000);

        const inWindow = (item) => {
            if (windowDef.key === 'all') return true;
            const d = _itemDate(item);
            if (!d) return false;
            const ms = Date.parse(d);
            if (Number.isNaN(ms)) return false;
            return ms >= from && ms <= anchor;
        };

        const sections = [];
        const selected = new Set(_config.dataTypes);

        // Demographics — always include a one-liner header
        try {
            const dem = await dataLoader.loadPatient(dataLoader.currentPatientId || 'PAT002');
            const age = dem.dateOfBirth
                ? Math.floor((anchor - Date.parse(dem.dateOfBirth)) / (365.25 * 86400000))
                : '?';
            sections.push(`## PATIENT HEADER\n${dem.firstName || ''} ${dem.lastName || ''}, ${age}y, MRN ${dem.mrn || ''}. ${dem.sex || ''}.`);
        } catch (e) { /* non-fatal */ }

        // NOTES (windowed)
        if (selected.has('notes')) {
            try {
                const index = await dataLoader.loadNotesIndex();
                const matching = (index.notes || []).filter(inWindow);
                if (matching.length > 0) {
                    const noteContents = await Promise.all(
                        matching.map((n) => dataLoader.loadNote(n.id).catch(() => null))
                    );
                    const lines = ['## CLINICAL NOTES (within window)'];
                    matching.forEach((n, i) => {
                        const full = noteContents[i];
                        const body = full ? (full.content || full.preview || '') : (n.preview || '');
                        lines.push('', `### ${_fmt(n.date)} — ${n.author || ''} — ${n.type || ''} (${n.id})`);
                        lines.push(body);
                    });
                    sections.push(lines.join('\n'));
                } else {
                    sections.push('## CLINICAL NOTES\n(no notes in selected window)');
                }
            } catch (e) { WARN('notes:', e.message); }
        }

        // LABS (windowed)
        if (selected.has('labs')) {
            try {
                const idx = await dataLoader.loadLabsIndex();
                const panels = (idx.panels || []).filter(inWindow);
                if (panels.length > 0) {
                    const fulls = await Promise.all(
                        panels.map((p) => dataLoader.loadLabPanel(p.id).catch(() => null))
                    );
                    const lines = ['## LAB RESULTS (within window)'];
                    panels.forEach((p, i) => {
                        const full = fulls[i];
                        lines.push('', `### ${_fmt(p.date)} — ${p.name || p.id}`);
                        if (full && Array.isArray(full.results)) {
                            full.results.forEach((r) => {
                                const flag = r.flag && r.flag !== 'normal' ? ` [${r.flag}]` : '';
                                const range = r.referenceRange ? ` (ref ${r.referenceRange})` : '';
                                lines.push(`- ${r.name}: ${r.value} ${r.unit || ''}${range}${flag}`);
                            });
                        }
                        if (full && full.interpretation) {
                            lines.push(`Interpretation: ${full.interpretation}`);
                        }
                    });
                    sections.push(lines.join('\n'));
                } else {
                    sections.push('## LAB RESULTS\n(no labs in selected window)');
                }
            } catch (e) { WARN('labs:', e.message); }
        }

        // VITALS (windowed)
        if (selected.has('vitals')) {
            try {
                const v = await dataLoader.loadVitals();
                const items = (v.vitals || []).filter(inWindow);
                const lines = ['## VITAL SIGNS (within window)'];
                if (items.length === 0) lines.push('(no vitals in selected window)');
                else {
                    items.forEach((vit) => {
                        lines.push(
                            `- ${_fmt(vit.date)}: BP ${vit.systolic || '-'}/${vit.diastolic || '-'}, HR ${vit.heartRate || '-'}, RR ${vit.respiratoryRate || '-'}, T ${vit.temperature || '-'}, SpO2 ${vit.spO2 || '-'}, Wt ${vit.weight || '-'} ${vit.weightUnit || ''}, BMI ${vit.bmi || '-'}, Pain ${vit.painScore ?? '-'}`
                        );
                    });
                }
                sections.push(lines.join('\n'));
            } catch (e) { WARN('vitals:', e.message); }
        }

        // IMAGING (windowed) — include impression
        if (selected.has('imaging')) {
            try {
                const idx = await dataLoader.loadImaging();
                const studies = (idx.studies || []).filter(inWindow);
                const lines = ['## IMAGING (within window)'];
                if (studies.length === 0) lines.push('(no imaging in selected window)');
                for (const s of studies) {
                    const report = await dataLoader.loadImagingReport(s.id).catch(() => null);
                    lines.push('', `### ${_fmt(s.date)} — ${s.modality || ''} — ${s.description || ''}`);
                    if (report) {
                        if (report.indication) lines.push(`Indication: ${report.indication}`);
                        if (report.findings) lines.push(`Findings: ${report.findings}`);
                        if (report.impression) lines.push(`Impression: ${report.impression}`);
                    } else if (s.indication) {
                        lines.push(`Indication: ${s.indication}`);
                    }
                }
                sections.push(lines.join('\n'));
            } catch (e) { WARN('imaging:', e.message); }
        }

        // ENCOUNTERS (windowed)
        if (selected.has('encounters')) {
            try {
                const idx = await dataLoader.loadEncounters();
                const items = (idx.encounters || []).filter(inWindow);
                const lines = ['## ENCOUNTERS (within window)'];
                if (items.length === 0) lines.push('(none in selected window)');
                items.forEach((e) => {
                    lines.push(`- ${_fmt(e.date)}: ${e.type || ''} (${e.department || ''}) — ${e.chiefComplaint || ''}`);
                    if (Array.isArray(e.diagnoses) && e.diagnoses.length) {
                        lines.push(`   Diagnoses: ${e.diagnoses.join('; ')}`);
                    }
                });
                sections.push(lines.join('\n'));
            } catch (e) { WARN('encounters:', e.message); }
        }

        // PROCEDURES (windowed)
        if (selected.has('procedures')) {
            try {
                const p = await dataLoader.loadProcedures();
                const items = (p.procedures || []).filter(inWindow);
                const lines = ['## PROCEDURES (within window)'];
                if (items.length === 0) lines.push('(none in selected window)');
                items.forEach((pr) => {
                    lines.push(`- ${_fmt(pr.date)}: ${pr.name || ''} (${pr.cptCode || ''}) — ${pr.provider || ''}. ${pr.notes || ''}`);
                });
                sections.push(lines.join('\n'));
            } catch (e) { WARN('procedures:', e.message); }
        }

        // ORDERS (windowed)
        if (selected.has('orders')) {
            try {
                const o = await dataLoader.loadOrders();
                const items = ([].concat(o.active || [], o.completed || [], o.discontinued || [])).filter(inWindow);
                const lines = ['## ORDERS (within window)'];
                if (items.length === 0) lines.push('(none in selected window)');
                items.forEach((ord) => {
                    lines.push(`- ${_fmt(ord.orderDate || ord.date)}: ${ord.category || ''} — ${ord.name || ''} (${ord.status || ''}). ${ord.details || ''}`);
                });
                sections.push(lines.join('\n'));
            } catch (e) { WARN('orders:', e.message); }
        }

        // PROBLEMS (static)
        if (selected.has('problems')) {
            try {
                const p = await dataLoader.loadProblems();
                const active = p.active?.problems || [];
                const resolved = p.resolved?.problems || [];
                const lines = ['## PROBLEM LIST'];
                if (active.length) {
                    lines.push('Active:');
                    active.forEach((pr) => lines.push(`- ${pr.name} (${pr.icd10 || ''}). ${pr.notes || ''}`));
                }
                if (resolved.length) {
                    lines.push('Resolved:');
                    resolved.forEach((pr) => lines.push(`- ${pr.name} (${pr.icd10 || ''}). resolved ${pr.resolvedDate || ''}`));
                }
                if (!active.length && !resolved.length) lines.push('(no problems)');
                sections.push(lines.join('\n'));
            } catch (e) { WARN('problems:', e.message); }
        }

        // MEDICATIONS (static)
        if (selected.has('medications')) {
            try {
                const m = await dataLoader.loadMedications();
                const active = m.active?.medications || [];
                const historical = m.historical?.medications || [];
                const lines = ['## MEDICATIONS'];
                if (active.length) {
                    lines.push('Active:');
                    active.forEach((mm) => lines.push(`- ${mm.name} ${mm.dose || ''} ${mm.route || ''} ${mm.frequency || ''}. ${mm.indication ? 'for ' + mm.indication : ''}`));
                }
                if (historical.length) {
                    lines.push('Historical:');
                    historical.forEach((mm) => lines.push(`- ${mm.name} ${mm.dose || ''} (${mm.startDate || ''} -> ${mm.endDate || ''})`));
                }
                if (!active.length && !historical.length) lines.push('(no medications)');
                sections.push(lines.join('\n'));
            } catch (e) { WARN('medications:', e.message); }
        }

        // ALLERGIES (static)
        if (selected.has('allergies')) {
            try {
                const a = await dataLoader.loadAllergies();
                const items = a.allergies || [];
                const lines = ['## ALLERGIES'];
                if (items.length === 0) lines.push('NKDA');
                items.forEach((al) => lines.push(`- ${al.substance || al.allergen}: ${al.reaction || ''}. Severity ${al.severity || ''}`));
                sections.push(lines.join('\n'));
            } catch (e) { WARN('allergies:', e.message); }
        }

        // SOCIAL HISTORY (static)
        if (selected.has('social')) {
            try {
                const sh = await dataLoader.loadSocialHistory();
                sections.push('## SOCIAL HISTORY\n' + _stringifyKV(sh));
            } catch (e) { WARN('social:', e.message); }
        }

        // FAMILY HISTORY (static)
        if (selected.has('family')) {
            try {
                const fh = await dataLoader.loadFamilyHistory();
                sections.push('## FAMILY HISTORY\n' + _stringifyKV(fh));
            } catch (e) { WARN('family:', e.message); }
        }

        // IMMUNIZATIONS (static)
        if (selected.has('immunizations')) {
            try {
                const imm = await dataLoader.loadImmunizations();
                const items = imm.immunizations || imm || [];
                const lines = ['## IMMUNIZATIONS'];
                if (Array.isArray(items)) {
                    items.forEach((i) => lines.push(`- ${i.name || ''} ${i.date ? '(' + _fmt(i.date) + ')' : ''}`));
                } else {
                    lines.push(_stringifyKV(imm));
                }
                sections.push(lines.join('\n'));
            } catch (e) { WARN('immunizations:', e.message); }
        }

        let combined = sections.join('\n\n');
        if (combined.length > MAX_CONTEXT_CHARS) {
            combined = combined.slice(0, MAX_CONTEXT_CHARS) + '\n\n[... CONTEXT TRUNCATED — narrow your selection to see more]';
        }
        return combined;
    }

    function _itemDate(item) {
        if (!item || typeof item !== 'object') return null;
        return item.date || item.collectedDate || item.studyDate || item.orderDate ||
               item.encounterDate || item.performedDate || item.resultedDate || null;
    }

    function _fmt(iso) {
        if (!iso) return '';
        try { return new Date(iso).toISOString().slice(0, 10); }
        catch (e) { return String(iso); }
    }

    function _stringifyKV(obj) {
        if (!obj || typeof obj !== 'object') return String(obj || '');
        const lines = [];
        for (const [k, v] of Object.entries(obj)) {
            if (k.startsWith('_')) continue;
            if (v == null || v === '') continue;
            if (typeof v === 'object') {
                lines.push(`${k}:`);
                for (const [kk, vv] of Object.entries(v)) {
                    if (kk.startsWith('_')) continue;
                    if (vv == null || vv === '') continue;
                    if (typeof vv === 'object') lines.push(`  ${kk}: ${JSON.stringify(vv)}`);
                    else lines.push(`  ${kk}: ${vv}`);
                }
            } else {
                lines.push(`${k}: ${v}`);
            }
        }
        return lines.join('\n');
    }

    function _escape(s) {
        const el = document.createElement('span');
        el.textContent = s == null ? '' : String(s);
        return el.innerHTML;
    }

    return {
        activate,
        deactivate,
        isActive,
    };
})();

window.AssessmentChatbot = AssessmentChatbot;
