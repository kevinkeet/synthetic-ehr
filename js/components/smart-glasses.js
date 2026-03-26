/**
 * Smart Glasses HUD Prototype
 * Simulates Even Realities G1 smart glasses display.
 * Left lens: Patient context (summary, problems, alerts, notes review, data review)
 * Right lens: Orders (suggested orders, order confirmation after dictation)
 *
 * Data source priority:
 * 1. LLM-generated glassesDisplay (pre-formatted, optimized by Claude)
 * 2. Client-side condensation of AICoworker.state (fallback)
 *
 * Order confirmation flow:
 * After dictating an order, call SmartGlasses.showOrderConfirmation(orderData)
 * to display a structured confirmation screen on the right lens.
 * The user confirms with voice ("confirm") or Enter key.
 *
 * Left lens modes:
 * - Default: paged patient context (summary, problems, alerts) via ←→
 * - "review notes": recent notes view
 * - "review data": recent labs/imaging/EKG results
 */
const SmartGlasses = {
    isOpen: false,
    leftScreen: 0,
    rightScreen: 0,
    leftScreens: [],
    rightScreens: [],
    _keyHandler: null,
    _orderConfirmation: null, // Active order confirmation data
    _savedRightScreens: null, // Saved screens during confirmation mode
    _savedRightScreen: 0,
    _sessionOrders: [],       // Orders confirmed this session (for right lens)
    _leftMode: 'context',     // 'context' | 'notes' | 'data' | 'ask'
    _leftDetailView: false,    // true when showing note/lab/imaging detail (scrollable)
    _lastGroupedRecs: null,    // cached grouped recommendations for click handlers
    _noteFilter: null,         // {type?, author?} filter for notes list
    _allNotesCache: [],        // full unfiltered notes list
    _currentNoteIdx: -1,       // current index into _notesCache for next/prev
    _labPanelsCache: [],       // sorted lab panel index for next/prev navigation
    _currentLabIdx: -1,        // current index into _labPanelsCache
    _askHistory: [],           // [{role: 'user'|'assistant', content}]
    _askStreaming: false,      // true while waiting for AI response

    LINES_PER_SCREEN: 5,
    MAX_LINE_CHARS: 45,

    toggle() {
        if (this.isOpen) this.close();
        else this.open();
    },

    open() {
        if (this.isOpen) return;
        this.isOpen = true;

        // Initialize BLE listeners on first open
        if (!this._bleInitialized) {
            this._bleInitialized = true;
            this._initBLEListeners();
        }
        this.leftScreen = 0;
        this.rightScreen = 0;
        this._orderConfirmation = null;
        this._savedRightScreens = null;
        this._leftMode = 'context';
        this._leftDetailView = false;

        // Left lens context now built as scrollable HTML in _createOverlay
        // Right lens: unified scrollable orders view (built in _createOverlay via _buildOrdersViewHTML)

        this._createOverlay();

        // After overlay is created, populate context content
        const contentEl = document.getElementById('lens-content-left');
        if (contentEl) {
            const data = this._getGlassesData();
            contentEl.innerHTML = this._buildContextScrollableHTML(data);
        }

        this._keyHandler = (e) => {
            if (e.key === 'Escape') {
                if (this._orderConfirmation) { this.cancelOrderConfirmation(); return; }
                if (this._leftDetailView) { e.preventDefault(); this._backToList(); return; }
                this.close(); return;
            }
            if (e.key === 'ArrowLeft') {
                e.preventDefault();
                if (this._leftDetailView) { this._backToList(); return; }
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                this._scrollLeftLens(-60);
                this._scrollRightLens(-60);
            }
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                this._scrollLeftLens(60);
                this._scrollRightLens(60);
            }
            if (e.key === 'Enter' && this._orderConfirmation) { e.preventDefault(); this.confirmOrder(); }
        };
        document.addEventListener('keydown', this._keyHandler);
    },

    close() {
        const overlay = document.getElementById('glasses-overlay');
        if (overlay) overlay.remove();
        if (this._keyHandler) {
            document.removeEventListener('keydown', this._keyHandler);
            this._keyHandler = null;
        }
        this._orderConfirmation = null;
        this._savedRightScreens = null;
        this._leftMode = 'context';
        this._leftDetailView = false;
        this.isOpen = false;
    },

    // ==================== Order Confirmation ====================

    /**
     * Show an order confirmation on the right lens.
     */
    showOrderConfirmation(orderData) {
        if (!this.isOpen) this.open();

        this._orderConfirmation = orderData;

        // Build confirmation view in right lens
        const contentEl = document.getElementById('lens-content-right');
        const titleEl = document.getElementById('lens-title-right');

        if (titleEl) titleEl.textContent = 'CONFIRM ORDER';

        if (contentEl) {
            const lines = this._buildConfirmationLines(orderData);
            contentEl.innerHTML = `
                <div class="lens-confirm-card">
                    ${this._renderLines(lines)}
                    <div class="lens-confirm-actions">
                        <button class="lens-confirm-btn confirm" onclick="SmartGlasses.confirmOrder()" title="Confirm (Enter / say 'confirm')">
                            <span class="confirm-icon">\u2713</span> CONFIRM
                        </button>
                        <button class="lens-confirm-btn cancel" onclick="SmartGlasses.cancelOrderConfirmation()" title="Cancel (Esc)">
                            <span class="confirm-icon">\u2717</span> CANCEL
                        </button>
                    </div>
                </div>
            `;
        }

        // Add pulsing border to right lens
        const lens = document.getElementById('glasses-lens-right');
        if (lens) lens.classList.add('lens-confirming');
    },

    _buildConfirmationLines(order) {
        const lines = [];
        const t = (s) => this._truncate(s || '', this.MAX_LINE_CHARS);

        if (order.type === 'medication') {
            const d = order.details || {};
            lines.push(t(`RX: ${d.name || order.summary}`));
            lines.push(t(`Dose: ${d.dose || '?'} ${d.route || ''}`));
            lines.push(t(`Freq: ${d.frequency || '?'}`));
            lines.push(t(`For: ${d.indication || '\u2014'}`));
        } else if (order.type === 'lab') {
            const d = order.details || {};
            lines.push(t(`LAB: ${d.name || order.summary}`));
            lines.push(t(`Priority: ${d.priority || 'Routine'}`));
            lines.push(t(`For: ${d.indication || '\u2014'}`));
        } else if (order.type === 'imaging') {
            const d = order.details || {};
            lines.push(t(`IMG: ${d.modality || '?'} ${d.bodyPart || ''}`));
            lines.push(t(`Contrast: ${d.contrast || 'N/A'}`));
            lines.push(t(`Priority: ${d.priority || 'Routine'}`));
        } else if (order.type === 'consult') {
            const d = order.details || {};
            lines.push(t(`CONSULT: ${d.specialty || order.summary}`));
            lines.push(t(`Reason: ${d.reason || '\u2014'}`));
        } else {
            lines.push(t(order.summary || 'Order pending'));
        }

        while (lines.length < this.LINES_PER_SCREEN) lines.push('');
        return lines.slice(0, this.LINES_PER_SCREEN);
    },

    confirmOrder() {
        if (!this._orderConfirmation) return;

        const order = this._orderConfirmation;
        this._orderConfirmation = null;

        // Track in session orders
        const orderName = order.summary || order.details?.name || 'Order';
        if (!this._sessionOrders.some(o => o === orderName)) {
            this._sessionOrders.push(orderName);
        }

        // Submit directly through OrderEntry (no second form)
        if (typeof OrderEntry !== 'undefined' && order.details) {
            OrderEntry.submitDirectOrder(order.type, order.details);
        }

        // Record in AI memory
        if (typeof AICoworker !== 'undefined' && AICoworker.recordExecutedOrder) {
            AICoworker.recordExecutedOrder({
                text: orderName,
                orderType: order.type,
                orderData: order.details || {}
            });
        }

        // Show brief confirmed state
        const contentEl = document.getElementById('lens-content-right');
        const titleEl = document.getElementById('lens-title-right');
        if (titleEl) titleEl.textContent = 'ORDER PLACED';
        if (contentEl) {
            contentEl.innerHTML = this._renderLines([
                '\u2713 ' + this._truncate(orderName, this.MAX_LINE_CHARS - 2),
                '',
                'Order sent to chart.',
                '',
                ''
            ]);
        }

        // Remove pulsing border
        const lens = document.getElementById('glasses-lens-right');
        if (lens) lens.classList.remove('lens-confirming');

        // Restore orders view after brief delay
        setTimeout(() => this._restoreRightLens(), 1500);
    },

    cancelOrderConfirmation() {
        this._restoreRightLens();
    },

    _restoreRightLens() {
        this._orderConfirmation = null;

        const lens = document.getElementById('glasses-lens-right');
        if (lens) lens.classList.remove('lens-confirming');

        // Restore title
        const titleEl = document.getElementById('lens-title-right');
        if (titleEl) titleEl.textContent = 'ORDERS';

        // Refresh the unified scrollable orders view
        this.refreshOrdersView();
    },

    // ==================== Live Updates from Dictation ====================

    /**
     * Push a new context line to the left lens (patient info).
     */
    pushContextToLeftLens(text) {
        if (!this.isOpen) return;
        if (this._leftMode !== 'context') return; // Don't interrupt review modes

        const truncated = this._truncate(text, this.MAX_LINE_CHARS);

        // Find or create a DICTATION screen
        let dictScreen = this.leftScreens.find(s => s.title === 'DICTATION');
        if (!dictScreen) {
            dictScreen = { title: 'DICTATION', lines: [] };
            this.leftScreens.push(dictScreen);
        }

        // Add line, rolling window
        dictScreen.lines.push(truncated);
        if (dictScreen.lines.length > this.LINES_PER_SCREEN) {
            dictScreen.lines = dictScreen.lines.slice(-this.LINES_PER_SCREEN);
        }
        while (dictScreen.lines.length < this.LINES_PER_SCREEN) {
            dictScreen.lines.push('');
        }

        // Auto-navigate to dictation screen
        const dictIdx = this.leftScreens.indexOf(dictScreen);
        if (dictIdx >= 0) {
            this.leftScreen = dictIdx;
            this._updateLens('left');
        }
    },

    /**
     * Push a parsed order line to the right lens.
     */
    pushOrderToRightLens(orderText, status) {
        if (!this.isOpen || this._orderConfirmation) return;

        if (status === 'confirmed') {
            if (!this._sessionOrders.some(o => o === orderText)) {
                this._sessionOrders.push(orderText);
            }
        }

        this.refreshOrdersView();
    },

    // ==================== Left Lens Modes ====================

    /**
     * Switch left lens to notes review mode.
     * Shows scrollable list of recent notes; click to drill into full note.
     */
    async showNotesReview() {
        if (!this.isOpen) return;
        this._leftMode = 'notes';
        this._leftDetailView = false;

        const titleEl = document.getElementById('lens-title-left');
        const contentEl = document.getElementById('lens-content-left');
        const navEl = document.getElementById('lens-nav-left');

        if (titleEl) titleEl.textContent = 'RECENT NOTES';
        if (navEl) navEl.textContent = '\u2191\u2193 scroll';
        this._setLeftScrollable(true);

        if (contentEl) contentEl.innerHTML = '<div class="lens-line">Loading notes...</div>';

        try {
            // Load notes (or use cached list)
            if (!this._allNotesCache.length) {
                let notes = [];
                if (typeof dataLoader !== 'undefined' && dataLoader.loadNotesIndex) {
                    const index = await dataLoader.loadNotesIndex();
                    notes = Array.isArray(index) ? index : (index?.notes || []);
                }
                this._allNotesCache = notes.sort((a, b) => new Date(b.date || b.noteDate || 0) - new Date(a.date || a.noteDate || 0));
            }

            // Apply filter if set
            let filtered = this._allNotesCache;
            if (this._noteFilter) {
                const f = this._noteFilter;
                filtered = filtered.filter(n => {
                    if (f.type) {
                        const noteType = (n.type || n.noteType || '').toLowerCase();
                        if (!noteType.includes(f.type.toLowerCase())) return false;
                    }
                    if (f.author) {
                        const noteAuthor = (n.author || n.provider || '').toLowerCase();
                        if (!noteAuthor.includes(f.author.toLowerCase())) return false;
                    }
                    return true;
                });
            }

            const display = filtered.slice(0, 20);
            this._notesCache = display;

            let html = '';

            // Filter indicator
            if (this._noteFilter) {
                const desc = this._noteFilter.type
                    ? `Type: ${this._noteFilter.type}`
                    : `Author: ${this._noteFilter.author}`;
                html += `<div class="lens-filter-indicator"><span>Filtered: ${this._esc(desc)}</span><span class="lens-filter-clear" onclick="SmartGlasses.clearNoteFilter()">✕ clear</span></div>`;
            }

            if (display.length === 0) {
                html += '<div class="lens-line" style="opacity:0.6">No matching notes.</div>';
            } else {
                for (const note of display) {
                    const date = this._formatDate(note.date || note.noteDate);
                    const type = note.type || note.noteType || 'Note';
                    const author = note.author || note.provider || '';
                    const preview = note.preview || note.chiefComplaint || note.title || '';
                    const typeIcon = this._noteTypeIcon(type);

                    html += `<div class="lens-note-card" onclick="SmartGlasses._showNoteDetail('${this._esc(note.id)}')" role="button" tabindex="0">`;
                    html += `<div class="lens-note-type">${typeIcon} ${this._esc(type)}</div>`;
                    html += `<div class="lens-note-meta">${this._esc(date)} \u00B7 ${this._esc(author)}</div>`;
                    if (preview) {
                        html += `<div class="lens-note-preview">${this._esc(this._truncate(preview, 80))}</div>`;
                    }
                    html += '</div>';
                }
            }
            if (contentEl) contentEl.innerHTML = html;
        } catch (err) {
            console.error('Failed to load notes for glasses:', err);
            if (contentEl) contentEl.innerHTML = '<div class="lens-line">Error loading notes.</div>';
        }

        this._updateLeftModeButtons();
    },

    filterNotes(filter) {
        this._noteFilter = filter;
        this.showNotesReview();
    },

    clearNoteFilter() {
        this._noteFilter = null;
        this.showNotesReview();
    },

    // ==================== Ask AI Mode ====================

    showAskMode() {
        if (!this.isOpen) return;
        this._leftMode = 'ask';
        this._leftDetailView = false;
        this._setLeftScrollable(true);

        const titleEl = document.getElementById('lens-title-left');
        const contentEl = document.getElementById('lens-content-left');
        const navEl = document.getElementById('lens-nav-left');

        if (titleEl) titleEl.textContent = 'ASK AI';
        if (navEl) navEl.textContent = '';

        this._renderAskView(contentEl);
        this._updateLeftModeButtons();

        setTimeout(() => {
            const input = document.getElementById('lens-ask-input');
            if (input) input.focus();
        }, 100);
    },

    _renderAskView(contentEl) {
        if (!contentEl) contentEl = document.getElementById('lens-content-left');
        if (!contentEl) return;

        let html = '';
        html += '<div class="lens-ask-input-wrap">';
        html += '<input type="text" class="lens-ask-input" id="lens-ask-input" placeholder="Type a question..." onkeydown="if(event.key===\'Enter\')SmartGlasses._submitAskQuestion()">';
        html += '<button class="lens-ask-submit" onclick="SmartGlasses._submitAskQuestion()">ASK</button>';
        html += '</div>';

        html += '<div class="lens-ask-history" id="lens-ask-history">';
        if (this._askHistory.length === 0) {
            html += '<div class="lens-ask-placeholder">Ask about the patient, medical facts, differential diagnosis, treatment options...</div>';
        } else {
            for (const msg of this._askHistory) {
                const cls = msg.role === 'user' ? 'lens-ask-user' : 'lens-ask-ai';
                const label = msg.role === 'user' ? 'You' : 'AI';
                html += `<div class="${cls}"><span class="lens-ask-role">${label}:</span> ${this._esc(msg.content)}</div>`;
            }
        }
        html += '</div>';

        contentEl.innerHTML = html;
    },

    async _submitAskQuestion() {
        const input = document.getElementById('lens-ask-input');
        if (!input || !input.value.trim() || this._askStreaming) return;

        const question = input.value.trim();
        input.value = '';

        this._askHistory.push({ role: 'user', content: question });
        if (this._askHistory.length > 10) {
            this._askHistory = this._askHistory.slice(-10);
        }

        // Show user message + streaming placeholder
        const historyEl = document.getElementById('lens-ask-history');
        if (historyEl) {
            // Clear placeholder
            const placeholder = historyEl.querySelector('.lens-ask-placeholder');
            if (placeholder) placeholder.remove();

            const userDiv = document.createElement('div');
            userDiv.className = 'lens-ask-user';
            userDiv.innerHTML = `<span class="lens-ask-role">You:</span> ${this._esc(question)}`;
            historyEl.appendChild(userDiv);

            const streamDiv = document.createElement('div');
            streamDiv.className = 'lens-ask-ai';
            streamDiv.id = 'lens-ask-stream';
            streamDiv.innerHTML = '<span class="lens-ask-role">AI:</span> <span class="lens-ask-stream-text">thinking...</span>';
            historyEl.appendChild(streamDiv);
            historyEl.scrollTop = historyEl.scrollHeight;
        }

        this._askStreaming = true;

        try {
            // Build prompt with patient context
            let systemPrompt = 'You are a clinical assistant helping a doctor during a patient encounter. Answer concisely and accurately. Use clinical shorthand where appropriate.';
            let messages = [];

            const ca = (typeof AICoworker !== 'undefined' && AICoworker._contextAssembler)
                ? AICoworker._contextAssembler
                : null;

            if (ca && ca.buildAskPrompt) {
                const prompt = ca.buildAskPrompt(question);
                systemPrompt = prompt.systemPrompt || systemPrompt;
                // Include prior conversation context
                const priorMsgs = this._askHistory.slice(0, -1).map(m => ({ role: m.role, content: m.content }));
                messages = [...priorMsgs, { role: 'user', content: prompt.userMessage || question }];
            } else {
                const priorMsgs = this._askHistory.slice(0, -1).map(m => ({ role: m.role, content: m.content }));
                messages = [...priorMsgs, { role: 'user', content: question }];
            }

            // Stream response
            const streamTextEl = document.querySelector('#lens-ask-stream .lens-ask-stream-text');

            if (typeof ClaudeAPI !== 'undefined' && ClaudeAPI.chatStream) {
                const fullResponse = await ClaudeAPI.chatStream(systemPrompt, messages, (accumulated) => {
                    if (streamTextEl) {
                        const clean = accumulated.replace(/<memory_update>[\s\S]*?<\/memory_update>/g, '').trim();
                        streamTextEl.textContent = clean || 'thinking...';
                    }
                    if (historyEl) historyEl.scrollTop = historyEl.scrollHeight;
                });

                const cleanResponse = fullResponse.replace(/<memory_update>[\s\S]*?<\/memory_update>/g, '').trim();
                this._askHistory.push({ role: 'assistant', content: cleanResponse });
            } else if (typeof ClaudeAPI !== 'undefined' && ClaudeAPI.chat) {
                const response = await ClaudeAPI.chat(systemPrompt, messages);
                const cleanResponse = response.replace(/<memory_update>[\s\S]*?<\/memory_update>/g, '').trim();
                this._askHistory.push({ role: 'assistant', content: cleanResponse });
            } else {
                this._askHistory.push({ role: 'assistant', content: 'AI not available — API key required.' });
            }

            // Re-render full history
            this._renderAskView();

        } catch (err) {
            console.error('Ask AI failed:', err);
            this._askHistory.push({ role: 'assistant', content: 'Error: ' + (err.message || 'Unknown error') });
            this._renderAskView();
        }

        this._askStreaming = false;
        // Re-focus input
        setTimeout(() => {
            const input2 = document.getElementById('lens-ask-input');
            if (input2) input2.focus();
        }, 100);
    },

    _noteTypeIcon(type) {
        const t = (type || '').toLowerCase();
        if (t.includes('progress')) return '\uD83D\uDCCB';
        if (t.includes('h&p') || t.includes('admission')) return '\uD83C\uDFE5';
        if (t.includes('discharge')) return '\uD83D\uDEAA';
        if (t.includes('consult')) return '\uD83E\uDE7A';
        if (t.includes('telephone') || t.includes('phone')) return '\uD83D\uDCDE';
        return '\uD83D\uDCDD';
    },

    /**
     * Show full note detail — loads via dataLoader.loadNote().
     */
    async _showNoteDetail(noteId) {
        if (!this.isOpen) return;
        this._leftMode = 'notes';
        this._leftDetailView = true;
        this._setLeftScrollable(true);

        // Track position in notes cache for next/prev
        if (this._notesCache && this._notesCache.length > 0) {
            this._currentNoteIdx = this._notesCache.findIndex(n => n.id === noteId);
        }

        const titleEl = document.getElementById('lens-title-left');
        const contentEl = document.getElementById('lens-content-left');
        const navEl = document.getElementById('lens-nav-left');

        if (titleEl) titleEl.textContent = 'NOTE';
        if (navEl) navEl.textContent = 'Esc back';
        if (contentEl) contentEl.innerHTML = '<div class="lens-line">Loading...</div>';

        try {
            let note = null;
            if (typeof dataLoader !== 'undefined' && dataLoader.loadNote) {
                note = await dataLoader.loadNote(noteId);
            }
            if (!note) {
                if (contentEl) contentEl.innerHTML = '<div class="lens-line">Note not found.</div>';
                return;
            }

            let html = '';

            // Next/Prev navigation bar
            const total = this._notesCache ? this._notesCache.length : 0;
            const idx = this._currentNoteIdx;
            if (total > 1 && idx >= 0) {
                const isFirst = idx <= 0;
                const isLast = idx >= total - 1;
                html += '<div class="lens-lab-nav">';
                html += `<button class="lens-lab-nav-btn" onclick="SmartGlasses._prevNote()" ${isFirst ? 'disabled' : ''}>\u25C0 PREV</button>`;
                html += `<span class="lens-lab-nav-pos">${idx + 1} / ${total}</span>`;
                html += `<button class="lens-lab-nav-btn" onclick="SmartGlasses._nextNote()" ${isLast ? 'disabled' : ''}>NEXT \u25B6</button>`;
                html += '</div>';
            }

            // Header
            html += `<div class="lens-detail-header">`;
            html += `<div class="lens-note-type">${this._noteTypeIcon(note.type)} ${this._esc(note.type || 'Note')}</div>`;
            html += `<div class="lens-note-meta">${this._esc(this._formatDate(note.date))} \u00B7 ${this._esc(note.author || '')}</div>`;
            if (note.department) html += `<div class="lens-note-meta">${this._esc(note.department)}</div>`;
            html += '</div>';

            // Simple content field (telephone encounters, etc.)
            if (note.content && !note.hpi && !note.physicalExam) {
                html += `<div class="lens-detail-section">`;
                html += `<div class="lens-detail-text">${this._esc(note.content)}</div>`;
                html += '</div>';
            }

            // Chief Complaint
            if (note.chiefComplaint) {
                html += `<div class="lens-detail-section">`;
                html += `<div class="lens-detail-label">CC</div>`;
                html += `<div class="lens-detail-text">${this._esc(note.chiefComplaint)}</div>`;
                html += '</div>';
            }

            // HPI
            if (note.hpi) {
                html += `<div class="lens-detail-section">`;
                html += `<div class="lens-detail-label">HPI</div>`;
                html += `<div class="lens-detail-text">${this._esc(note.hpi)}</div>`;
                html += '</div>';
            }

            // Vitals (compact one-liner)
            if (note.vitals) {
                const v = note.vitals;
                const parts = [];
                if (v.bp) parts.push(`BP ${v.bp}`);
                if (v.hr) parts.push(`HR ${v.hr}`);
                if (v.rr) parts.push(`RR ${v.rr}`);
                if (v.temp) parts.push(`T ${v.temp}`);
                if (v.spo2) parts.push(`SpO2 ${v.spo2}`);
                if (v.weight) parts.push(`Wt ${v.weight}`);
                if (parts.length > 0) {
                    html += `<div class="lens-detail-section">`;
                    html += `<div class="lens-detail-label">VITALS</div>`;
                    html += `<div class="lens-detail-text lens-vitals-compact">${this._esc(parts.join(' | '))}</div>`;
                    html += '</div>';
                }
            }

            // Physical Exam
            if (note.physicalExam && typeof note.physicalExam === 'object') {
                html += `<div class="lens-detail-section">`;
                html += `<div class="lens-detail-label">EXAM</div>`;
                for (const [system, finding] of Object.entries(note.physicalExam)) {
                    html += `<div class="lens-detail-text"><strong>${this._esc(system)}:</strong> ${this._esc(finding)}</div>`;
                }
                html += '</div>';
            }

            // Assessment
            if (note.assessment && Array.isArray(note.assessment) && note.assessment.length > 0) {
                html += `<div class="lens-detail-section">`;
                html += `<div class="lens-detail-label">ASSESSMENT</div>`;
                note.assessment.forEach((a, i) => {
                    html += `<div class="lens-detail-text">${i + 1}. <strong>${this._esc(a.diagnosis || '')}</strong>`;
                    if (a.notes) html += ` \u2014 ${this._esc(a.notes)}`;
                    html += '</div>';
                });
                html += '</div>';
            }

            // Plan
            if (note.plan && Array.isArray(note.plan) && note.plan.length > 0) {
                html += `<div class="lens-detail-section">`;
                html += `<div class="lens-detail-label">PLAN</div>`;
                note.plan.forEach(p => {
                    html += `<div class="lens-detail-text"><strong>${this._esc(p.problem || '')}:</strong> ${this._esc(p.action || '')}</div>`;
                });
                html += '</div>';
            }

            if (contentEl) {
                contentEl.innerHTML = html;
                contentEl.scrollTop = 0;
            }
        } catch (err) {
            console.error('Failed to load note detail:', err);
            if (contentEl) contentEl.innerHTML = '<div class="lens-line">Error loading note.</div>';
        }
    },

    /**
     * Switch left lens to data review mode.
     * Shows scrollable list of labs and imaging; click to drill into detail.
     */
    async showDataReview() {
        if (!this.isOpen) return;
        this._leftMode = 'data';
        this._leftDetailView = false;

        const titleEl = document.getElementById('lens-title-left');
        const contentEl = document.getElementById('lens-content-left');
        const navEl = document.getElementById('lens-nav-left');

        if (titleEl) titleEl.textContent = 'REVIEW DATA';
        if (navEl) navEl.textContent = '\u2191\u2193 scroll';
        this._setLeftScrollable(true);

        if (contentEl) contentEl.innerHTML = '<div class="lens-line">Loading data...</div>';

        try {
            let html = '';

            // === LABS ===
            let labPanels = [];
            if (typeof dataLoader !== 'undefined' && dataLoader.loadLabsIndex) {
                const labIndex = await dataLoader.loadLabsIndex();
                labPanels = Array.isArray(labIndex) ? labIndex : (labIndex?.panels || labIndex?.labs || []);
                labPanels = labPanels
                    .sort((a, b) => new Date(b.collectedDate || b.date || 0) - new Date(a.collectedDate || a.date || 0))
                    .slice(0, 10);
            }

            // Cache for next/prev navigation in lab detail
            this._labPanelsCache = labPanels;

            if (labPanels.length > 0) {
                html += '<div class="lens-section-title">\uD83E\uDDEA LABS</div>';
                for (const panel of labPanels) {
                    const name = panel.name || panel.panelName || 'Lab Panel';
                    const date = this._formatDate(panel.collectedDate || panel.date);
                    html += `<div class="lens-data-card" onclick="SmartGlasses._showLabDetail('${this._esc(panel.id)}')" role="button" tabindex="0">`;
                    html += `<div class="lens-data-name">${this._esc(name)}</div>`;
                    html += `<div class="lens-note-meta">${this._esc(date)}</div>`;
                    html += '</div>';
                }
            }

            // === IMAGING ===
            let imagingStudies = [];
            if (typeof dataLoader !== 'undefined' && dataLoader.loadImaging) {
                const imaging = await dataLoader.loadImaging();
                imagingStudies = Array.isArray(imaging) ? imaging : (imaging?.studies || imaging?.imaging || []);
                imagingStudies = imagingStudies
                    .sort((a, b) => new Date(b.date || b.orderDate || 0) - new Date(a.date || a.orderDate || 0))
                    .slice(0, 8);
            }

            if (imagingStudies.length > 0) {
                html += '<div class="lens-section-title">\uD83D\uDCF7 IMAGING</div>';
                for (const study of imagingStudies) {
                    const type = study.type || study.modality || 'Imaging';
                    const desc = study.description || study.bodyPart || '';
                    const date = this._formatDate(study.date || study.orderDate);
                    html += `<div class="lens-data-card" onclick="SmartGlasses._showImagingDetail('${this._esc(study.id)}')" role="button" tabindex="0">`;
                    html += `<div class="lens-data-name">${this._esc(type)}: ${this._esc(desc)}</div>`;
                    html += `<div class="lens-note-meta">${this._esc(date)}</div>`;
                    html += '</div>';
                }
            }

            if (!html) {
                html = '<div class="lens-line">No data available.</div>';
            }

            if (contentEl) contentEl.innerHTML = html;
        } catch (err) {
            console.error('Failed to load data for glasses:', err);
            if (contentEl) contentEl.innerHTML = '<div class="lens-line">Error loading data.</div>';
        }

        this._updateLeftModeButtons();
    },

    /**
     * Show full lab panel detail with table of results.
     */
    async _showLabDetail(panelId) {
        if (!this.isOpen) return;
        this._leftMode = 'data';
        this._leftDetailView = true;
        this._setLeftScrollable(true);

        // Track position in lab panels cache for next/prev
        if (this._labPanelsCache.length > 0) {
            this._currentLabIdx = this._labPanelsCache.findIndex(p => p.id === panelId);
        }

        const titleEl = document.getElementById('lens-title-left');
        const contentEl = document.getElementById('lens-content-left');
        const navEl = document.getElementById('lens-nav-left');

        if (titleEl) titleEl.textContent = 'LAB RESULTS';
        if (navEl) navEl.textContent = 'Esc back';
        if (contentEl) contentEl.innerHTML = '<div class="lens-line">Loading...</div>';

        try {
            let panel = null;
            if (typeof dataLoader !== 'undefined' && dataLoader.loadLabPanel) {
                panel = await dataLoader.loadLabPanel(panelId);
            }
            if (!panel) {
                if (contentEl) contentEl.innerHTML = '<div class="lens-line">Panel not found.</div>';
                return;
            }

            let html = '';

            // Next/Prev navigation bar at top
            const total = this._labPanelsCache.length;
            const idx = this._currentLabIdx;
            if (total > 1 && idx >= 0) {
                const isFirst = idx <= 0;
                const isLast = idx >= total - 1;
                html += '<div class="lens-lab-nav">';
                html += `<button class="lens-lab-nav-btn" onclick="SmartGlasses._prevLab()" ${isFirst ? 'disabled' : ''}>\u25C0 PREV</button>`;
                html += `<span class="lens-lab-nav-pos">${idx + 1} / ${total}</span>`;
                html += `<button class="lens-lab-nav-btn" onclick="SmartGlasses._nextLab()" ${isLast ? 'disabled' : ''}>NEXT \u25B6</button>`;
                html += '</div>';
            }

            html += `<div class="lens-detail-header">`;
            html += `<div class="lens-data-name">${this._esc(panel.name || 'Lab Panel')}</div>`;
            html += `<div class="lens-note-meta">${this._esc(this._formatDate(panel.collectedDate || panel.date))} \u00B7 ${this._esc(panel.orderedBy || '')}</div>`;
            html += `<div class="lens-note-meta">${this._esc(panel.status || '')} \u00B7 ${this._esc(panel.specimen || '')}</div>`;
            html += '</div>';

            // Lab results table
            const results = panel.results || [];
            if (results.length > 0) {
                html += '<div class="lens-lab-table">';
                html += '<div class="lens-lab-row lens-lab-header-row"><span class="lens-lab-name">Test</span><span class="lens-lab-val">Value</span><span class="lens-lab-ref">Ref</span></div>';
                for (const r of results) {
                    const name = r.name || r.testName || '';
                    const val = r.value != null ? String(r.value) : '';
                    const unit = r.unit || '';
                    const ref = r.referenceRange || '';
                    const isAbnormal = this._isLabAbnormal(r);
                    const cls = isAbnormal ? 'lens-lab-row lens-lab-abnormal' : 'lens-lab-row';
                    const flag = isAbnormal ? ' \u26A0' : '';
                    html += `<div class="${cls}"><span class="lens-lab-name">${this._esc(name)}</span><span class="lens-lab-val">${this._esc(val)} ${this._esc(unit)}${flag}</span><span class="lens-lab-ref">${this._esc(ref)}</span></div>`;
                }
                html += '</div>';
            } else {
                html += '<div class="lens-line">No results.</div>';
            }

            if (contentEl) {
                contentEl.innerHTML = html;
                contentEl.scrollTop = 0;
            }
        } catch (err) {
            console.error('Failed to load lab detail:', err);
            if (contentEl) contentEl.innerHTML = '<div class="lens-line">Error loading lab.</div>';
        }
    },

    _prevLab() {
        if (this._currentLabIdx <= 0 || !this._labPanelsCache.length) return;
        this._currentLabIdx--;
        this._showLabDetail(this._labPanelsCache[this._currentLabIdx].id);
    },

    _nextLab() {
        if (this._currentLabIdx >= this._labPanelsCache.length - 1 || !this._labPanelsCache.length) return;
        this._currentLabIdx++;
        this._showLabDetail(this._labPanelsCache[this._currentLabIdx].id);
    },

    _prevNote() {
        if (this._currentNoteIdx <= 0 || !this._notesCache || !this._notesCache.length) return;
        this._currentNoteIdx--;
        this._showNoteDetail(this._notesCache[this._currentNoteIdx].id);
    },

    _nextNote() {
        if (!this._notesCache || this._currentNoteIdx >= this._notesCache.length - 1) return;
        this._currentNoteIdx++;
        this._showNoteDetail(this._notesCache[this._currentNoteIdx].id);
    },

    /**
     * Check if a lab result is abnormal based on reference range.
     */
    _isLabAbnormal(result) {
        if (result.flag || result.abnormal) return true;
        if (result.status && result.status !== 'Normal') return true;
        const val = parseFloat(result.value);
        const ref = result.referenceRange || '';
        if (isNaN(val) || !ref) return false;

        // Parse "X-Y" range
        const rangeMatch = ref.match(/^([\d.]+)\s*[-\u2013]\s*([\d.]+)$/);
        if (rangeMatch) {
            const lo = parseFloat(rangeMatch[1]);
            const hi = parseFloat(rangeMatch[2]);
            return val < lo || val > hi;
        }
        // Parse ">X" range
        const gtMatch = ref.match(/^>\s*([\d.]+)$/);
        if (gtMatch) return val < parseFloat(gtMatch[1]);
        // Parse "<X" range
        const ltMatch = ref.match(/^<\s*([\d.]+)$/);
        if (ltMatch) return val > parseFloat(ltMatch[1]);

        return false;
    },

    /**
     * Show imaging report detail.
     */
    async _showImagingDetail(studyId) {
        if (!this.isOpen) return;
        this._leftMode = 'data';
        this._leftDetailView = true;
        this._setLeftScrollable(true);

        const titleEl = document.getElementById('lens-title-left');
        const contentEl = document.getElementById('lens-content-left');
        const navEl = document.getElementById('lens-nav-left');

        if (titleEl) titleEl.textContent = 'IMAGING';
        if (navEl) navEl.textContent = '\u2190 back';
        if (contentEl) contentEl.innerHTML = '<div class="lens-line">Loading...</div>';

        try {
            let report = null;
            if (typeof dataLoader !== 'undefined' && dataLoader.loadImagingReport) {
                report = await dataLoader.loadImagingReport(studyId);
            }
            if (!report) {
                if (contentEl) contentEl.innerHTML = '<div class="lens-line">Report not found.</div>';
                return;
            }

            let html = '';
            html += `<div class="lens-detail-header">`;
            html += `<div class="lens-data-name">${this._esc(report.modality || '')} \u2014 ${this._esc(report.description || '')}</div>`;
            html += `<div class="lens-note-meta">${this._esc(this._formatDate(report.date))} \u00B7 ${this._esc(report.radiologist || '')}</div>`;
            html += '</div>';

            if (report.indication) {
                html += `<div class="lens-detail-section">`;
                html += `<div class="lens-detail-label">INDICATION</div>`;
                html += `<div class="lens-detail-text">${this._esc(report.indication)}</div>`;
                html += '</div>';
            }

            // Impression (most important)
            if (report.impression) {
                html += `<div class="lens-detail-section">`;
                html += `<div class="lens-detail-label">IMPRESSION</div>`;
                if (Array.isArray(report.impression)) {
                    report.impression.forEach((item, i) => {
                        html += `<div class="lens-detail-text">${i + 1}. ${this._esc(item)}</div>`;
                    });
                } else {
                    html += `<div class="lens-detail-text">${this._esc(report.impression)}</div>`;
                }
                html += '</div>';
            }

            if (report.findings) {
                html += `<div class="lens-detail-section">`;
                html += `<div class="lens-detail-label">FINDINGS</div>`;
                html += `<div class="lens-detail-text">${this._esc(report.findings)}</div>`;
                html += '</div>';
            }

            if (report.recommendations) {
                html += `<div class="lens-detail-section">`;
                html += `<div class="lens-detail-label">RECOMMENDATIONS</div>`;
                html += `<div class="lens-detail-text">${this._esc(report.recommendations)}</div>`;
                html += '</div>';
            }

            if (contentEl) {
                contentEl.innerHTML = html;
                contentEl.scrollTop = 0;
            }
        } catch (err) {
            console.error('Failed to load imaging detail:', err);
            if (contentEl) contentEl.innerHTML = '<div class="lens-line" style="opacity:0.6">Report not available for this study.</div>';
        }
    },

    /**
     * Navigate back from detail view to list view.
     */
    _backToList() {
        if (this._leftMode === 'notes') {
            this.showNotesReview();
        } else if (this._leftMode === 'data') {
            this.showDataReview();
        }
    },

    /**
     * Toggle left lens content between scrollable HTML mode and paged mode.
     */
    _setLeftScrollable(scrollable) {
        const contentEl = document.getElementById('lens-content-left');
        if (!contentEl) return;
        if (scrollable) {
            contentEl.classList.add('lens-content-scrollable');
        } else {
            contentEl.classList.remove('lens-content-scrollable');
        }
    },

    /**
     * Return left lens to default context mode.
     */
    showContextMode() {
        this._leftMode = 'context';
        this._leftDetailView = false;
        this._setLeftScrollable(true);

        const titleEl = document.getElementById('lens-title-left');
        const contentEl = document.getElementById('lens-content-left');
        const navEl = document.getElementById('lens-nav-left');

        if (titleEl) titleEl.textContent = 'PATIENT CONTEXT';
        if (navEl) navEl.textContent = '\u2191\u2193 scroll';

        const data = this._getGlassesData();
        if (contentEl) {
            contentEl.innerHTML = this._buildContextScrollableHTML(data);
            contentEl.scrollTop = 0;
        }

        this._updateLeftModeButtons();
    },

    _buildContextScrollableHTML(data) {
        if (!data) {
            return '<div class="lens-line" style="opacity:0.6">No AI analysis yet. Run analysis first.</div>';
        }

        let html = '';

        // === PATIENT ONE-LINER ===
        if (data.oneLiner) {
            html += `<div class="lens-ctx-summary">${this._esc(data.oneLiner)}</div>`;
        }

        // === DEMOGRAPHICS / PRESENTATION ===
        const cs = data.clinicalSummary || {};
        if (cs.demographics) {
            html += `<div class="lens-ctx-demo">${this._esc(cs.demographics)}</div>`;
        }
        if (cs.presentation) {
            html += `<div class="lens-detail-section">`;
            html += `<div class="lens-detail-label">PRESENTATION</div>`;
            html += `<div class="lens-detail-text">${this._esc(cs.presentation)}</div>`;
            html += '</div>';
        }
        if (cs.functional) {
            html += `<div class="lens-detail-section">`;
            html += `<div class="lens-detail-label">FUNCTIONAL</div>`;
            html += `<div class="lens-detail-text" style="opacity:0.7">${this._esc(cs.functional)}</div>`;
            html += '</div>';
        }

        // === ACTIVE PROBLEMS ===
        if (data.problemList && data.problemList.length > 0) {
            html += '<div class="lens-section-title">ACTIVE PROBLEMS</div>';
            for (const p of data.problemList) {
                const urgIcon = p.urgency === 'urgent' ? '!' : (p.urgency === 'monitoring' ? '~' : '\u00B7');
                const urgClass = p.urgency === 'urgent' ? ' lens-problem-urgent' : '';
                html += `<div class="lens-problem-item${urgClass}">`;
                html += `<span class="lens-problem-urgency">${urgIcon}</span>`;
                html += `<span class="lens-problem-name">${this._esc(p.name || '')}</span>`;
                if (p.plan) html += `<div class="lens-problem-plan">${this._esc(p.plan)}</div>`;
                if (p.ddx) html += `<div class="lens-problem-ddx">DDx: ${this._esc(p.ddx)}</div>`;
                html += '</div>';
            }
        }

        // === ALERTS & SAFETY FLAGS ===
        const alerts = [];
        if (data.flags && data.flags.length > 0) {
            for (const f of data.flags) {
                const text = typeof f === 'string' ? f : (f.text || '');
                if (text) alerts.push({ text, severity: f.severity || 'info' });
            }
        }
        if (data.keyConsiderations && data.keyConsiderations.length > 0) {
            for (const k of data.keyConsiderations) {
                const text = typeof k === 'string' ? k : (k.text || '');
                if (text) alerts.push({ text, severity: k.severity || 'important' });
            }
        }
        if (alerts.length > 0) {
            html += '<div class="lens-section-title">\u26A0 ALERTS</div>';
            for (const a of alerts) {
                const cls = a.severity === 'critical' ? 'lens-alert-critical' : 'lens-alert-item';
                html += `<div class="${cls}">\u26A0 ${this._esc(a.text)}</div>`;
            }
        }

        // === KEY MEDICATIONS (from AICoworker state) ===
        const state = (typeof AICoworker !== 'undefined') ? AICoworker.state : null;
        const meds = state?.medications || state?.clinicalSummary?.medications || [];
        if (meds.length > 0) {
            html += '<div class="lens-section-title">\uD83D\uDC8A KEY MEDS</div>';
            const medLines = Array.isArray(meds) ? meds.slice(0, 8) : [];
            for (const m of medLines) {
                const name = typeof m === 'string' ? m : (m.name || m.medication || '');
                const dose = typeof m === 'object' ? (m.dose || m.dosage || '') : '';
                html += `<div class="lens-ctx-med">${this._esc(name)}${dose ? ' ' + this._esc(dose) : ''}</div>`;
            }
        }

        return html || '<div class="lens-line" style="opacity:0.6">No context data available.</div>';
    },

    _updateLeftNav() {
        const navEl = document.getElementById('lens-nav-left');
        if (!navEl) return;
        if (this._leftDetailView) {
            navEl.textContent = 'Esc back';
        } else {
            navEl.textContent = '\u2191\u2193 scroll';
        }
    },

    _updateLeftModeButtons() {
        const btns = document.querySelectorAll('.lens-mode-btn');
        btns.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.mode === this._leftMode);
        });
    },

    // ==================== LLM Data Parsing ====================

    _parseLLMScreens(lensData, fallbackTitle) {
        if (!Array.isArray(lensData) || lensData.length === 0) {
            return [{ title: fallbackTitle, lines: ['', 'No data available.', '', '', ''] }];
        }

        return lensData.map(screen => {
            const title = (screen.title || fallbackTitle).toUpperCase();
            let lines = Array.isArray(screen.lines) ? screen.lines.slice() : [];

            lines = lines.map(l => {
                if (typeof l !== 'string') return '';
                if (l.length > this.MAX_LINE_CHARS) {
                    return l.slice(0, this.MAX_LINE_CHARS - 1) + '\u2026';
                }
                return l;
            });

            while (lines.length < this.LINES_PER_SCREEN) lines.push('');
            lines = lines.slice(0, this.LINES_PER_SCREEN);

            return { title, lines };
        }).filter(screen => {
            return screen.lines.some(l => l.trim().length > 0);
        });
    },

    // ==================== Fallback Data Extraction ====================

    _getGlassesData() {
        const state = (typeof AICoworker !== 'undefined') ? AICoworker.state : null;
        if (!state) return null;

        const hasData = !!(state.aiOneLiner || (state.problemList && state.problemList.length > 0)
            || (state.categorizedActions && Object.values(state.categorizedActions).some(a => a && a.length)));

        if (!hasData) return null;

        return {
            oneLiner: state.aiOneLiner || '',
            clinicalSummary: state.clinicalSummary || {},
            problemList: state.problemList || [],
            categorizedActions: state.categorizedActions || {},
            flags: state.flags || [],
            keyConsiderations: state.keyConsiderations || [],
        };
    },

    // ==================== Fallback Screen Builders ====================

    _buildLeftScreensFallback(data) {
        const screens = [];

        if (!data) {
            screens.push({ title: 'PATIENT', lines: ['', 'No AI analysis available.', 'Run analysis first.', '', ''] });
            return screens;
        }

        // Screen 1: Patient summary
        const summaryLines = [];
        if (data.oneLiner) {
            this._wordWrap(data.oneLiner, summaryLines);
        } else if (data.clinicalSummary.demographics) {
            summaryLines.push(this._truncate(data.clinicalSummary.demographics, this.MAX_LINE_CHARS));
        }
        if (data.clinicalSummary.presentation) {
            this._wordWrap(this._truncate(data.clinicalSummary.presentation, this.MAX_LINE_CHARS * 2), summaryLines);
        }
        while (summaryLines.length < this.LINES_PER_SCREEN) summaryLines.push('');
        screens.push({ title: 'PATIENT', lines: summaryLines.slice(0, this.LINES_PER_SCREEN) });

        // Screen 2: Problem list
        if (data.problemList.length > 0) {
            const probLines = data.problemList.slice(0, this.LINES_PER_SCREEN).map(p => {
                const icon = p.urgency === 'urgent' ? '! ' : p.urgency === 'monitoring' ? '~ ' : '  ';
                return icon + this._truncate(p.name || '', this.MAX_LINE_CHARS - 2);
            });
            while (probLines.length < this.LINES_PER_SCREEN) probLines.push('');
            screens.push({ title: 'PROBLEMS', lines: probLines });
        }

        // Screen 3: Alerts
        const alertLines = [];
        if (data.flags && data.flags.length) {
            data.flags.forEach(f => {
                const text = typeof f === 'string' ? f : (f.text || '');
                if (text) alertLines.push('\u26A0 ' + this._truncate(text, this.MAX_LINE_CHARS - 2));
            });
        }
        if (data.keyConsiderations && data.keyConsiderations.length) {
            data.keyConsiderations.forEach(k => {
                if (k.severity === 'critical' || k.severity === 'important') {
                    alertLines.push('\u26A0 ' + this._truncate(k.text || '', this.MAX_LINE_CHARS - 2));
                }
            });
        }
        if (alertLines.length > 0) {
            while (alertLines.length < this.LINES_PER_SCREEN) alertLines.push('');
            screens.push({ title: 'ALERTS', lines: alertLines.slice(0, this.LINES_PER_SCREEN) });
        }

        return screens;
    },

    // Right lens = Orders

    /**
     * Build unified orders view HTML for the right lens.
     */
    _buildOrdersViewHTML() {
        const lines = [];

        // === ORDERED THIS SESSION ===
        lines.push('<div class="lens-section-title">ORDERED THIS SESSION</div>');

        if (this._sessionOrders.length > 0) {
            for (const order of this._sessionOrders) {
                lines.push(`<div class="lens-line lens-order-confirmed">\u2713 ${this._esc(this._truncate(order, this.MAX_LINE_CHARS - 2))}</div>`);
            }
        } else {
            lines.push('<div class="lens-line lens-order-empty">No orders yet</div>');
        }

        // === SEPARATOR ===
        lines.push('<div class="lens-order-separator">\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500</div>');

        // === RECOMMENDED — grouped by category ===
        const grouped = this._getGroupedRecommendations();
        this._lastGroupedRecs = grouped;
        const hasAny = Object.values(grouped).some(arr => arr.length > 0);

        if (hasAny) {
            const categories = [
                { key: 'medications', icon: '\uD83D\uDC8A', label: 'MEDICATIONS' },
                { key: 'labs', icon: '\uD83E\uDDEA', label: 'LABS' },
                { key: 'imaging', icon: '\uD83D\uDCF7', label: 'STUDIES' },
                { key: 'communication', icon: '\uD83D\uDCE2', label: 'COMMUNICATION' },
                { key: 'notes', icon: '\uD83D\uDCDD', label: 'DOCUMENTATION' },
                { key: 'other', icon: '\u2022', label: 'OTHER' }
            ];

            for (const cat of categories) {
                const items = grouped[cat.key];
                if (!items || items.length === 0) continue;

                lines.push(`<div class="lens-section-title">${cat.icon} ${cat.label}</div>`);
                for (let i = 0; i < items.length; i++) {
                    const item = items[i];
                    const isOrdered = this._sessionOrders.some(o =>
                        o.toLowerCase().includes(item.text.toLowerCase().slice(0, 15)));
                    if (isOrdered) {
                        lines.push(`<div class="lens-line lens-order-done">\u2713 ${this._esc(this._truncate(item.text, this.MAX_LINE_CHARS - 2))}</div>`);
                    } else {
                        lines.push(`<div class="lens-line lens-order-rec lens-order-clickable" onclick="SmartGlasses._onOrderClick('${cat.key}', ${i})" role="button" tabindex="0">\u25CB ${this._esc(this._truncate(item.text, this.MAX_LINE_CHARS - 2))}</div>`);
                    }
                }
            }
        } else {
            lines.push('<div class="lens-section-title">RECOMMENDED</div>');
            lines.push('<div class="lens-line lens-order-empty">Run analysis for recommendations</div>');
        }

        return lines.join('');
    },

    /**
     * Get recommended actions grouped by category.
     * Pulls from categorizedActions first, then fills from suggestedActions.
     */
    _getGroupedRecommendations() {
        const groups = { medications: [], labs: [], imaging: [], communication: [], notes: [], other: [] };
        if (typeof AICoworker === 'undefined' || !AICoworker.state) return groups;

        const cats = AICoworker.state.categorizedActions || {};

        // Deduplication set — prevents the same action from appearing in multiple categories
        const seenTexts = new Set();

        // Pull from categorizedActions (already grouped)
        for (const key of ['labs', 'imaging', 'medications', 'communication']) {
            const items = cats[key];
            if (!items || !Array.isArray(items)) continue;
            for (const item of items) {
                const text = typeof item === 'string' ? item : (item.text || '');
                const textKey = text.toLowerCase().trim();
                if (text && !seenTexts.has(textKey)) {
                    seenTexts.add(textKey);
                    groups[key].push({ text, orderType: item.orderType, orderData: item.orderData });
                }
            }
        }

        // Notes/documentation category
        const noteItems = cats['notes'] || cats['documentation'] || [];
        if (Array.isArray(noteItems)) {
            for (const item of noteItems) {
                const text = typeof item === 'string' ? item : (item.text || '');
                const textKey = text.toLowerCase().trim();
                if (text && !seenTexts.has(textKey)) {
                    seenTexts.add(textKey);
                    groups.notes.push({ text });
                }
            }
        }

        // Other category
        const otherItems = cats['other'] || [];
        if (Array.isArray(otherItems)) {
            for (const item of otherItems) {
                const text = typeof item === 'string' ? item : (item.text || '');
                const textKey = text.toLowerCase().trim();
                if (text && !seenTexts.has(textKey)) {
                    seenTexts.add(textKey);
                    groups.other.push({ text });
                }
            }
        }

        // Also pull from suggestedActions and classify them into categories
        // Use fuzzy prefix matching (first 25 chars) since LLM may rephrase slightly
        const actions = AICoworker.state.suggestedActions || [];
        const isSeen = (t) => {
            const prefix = t.toLowerCase().trim().substring(0, 25);
            for (const s of seenTexts) {
                if (s.substring(0, 25) === prefix) return true;
            }
            return false;
        };

        for (const a of actions) {
            const text = typeof a === 'string' ? a : (a.text || '');
            if (!text || isSeen(text)) continue;
            seenTexts.add(text.toLowerCase().trim());

            // Classify by keywords
            const lower = text.toLowerCase();
            if (/\b(order|check|draw|send|bmp|cbc|cmp|bnp|troponin|lactate|abg|culture|panel|level)\b/.test(lower)) {
                groups.labs.push({ text });
            } else if (/\b(xr|x-ray|ct |ct$|mri|echo|ultrasound|imaging|scan|ekg|ecg)\b/.test(lower)) {
                groups.imaging.push({ text });
            } else if (/\b(start|give|administer|bolus|infusion|mg|mcg|units|dose|medication|rx|prescribe)\b/.test(lower)) {
                groups.medications.push({ text });
            } else if (/\b(consult|call|notify|discuss|page|communicate|family|update)\b/.test(lower)) {
                groups.communication.push({ text });
            } else if (/\b(document|note|attestation|write|addendum|discharge summary)\b/.test(lower)) {
                groups.notes.push({ text });
            } else {
                groups.other.push({ text });
            }
        }

        return groups;
    },

    /**
     * Handle click on a recommended order — show confirmation card.
     */
    _onOrderClick(category, index) {
        if (!this._lastGroupedRecs) return;
        const items = this._lastGroupedRecs[category];
        if (!items || !items[index]) return;
        const item = items[index];

        // Synthesize orderType from category if not present
        const typeMap = { labs: 'lab', imaging: 'imaging', medications: 'medication', communication: 'consult' };
        const orderType = item.orderType || typeMap[category] || null;

        if (orderType && item.orderData) {
            // Structured order — use full confirmation flow
            this.showOrderConfirmation({
                type: orderType,
                summary: item.text,
                details: item.orderData
            });
        } else if (orderType) {
            // Has a type but no orderData — synthesize minimal data
            this.showOrderConfirmation({
                type: orderType,
                summary: item.text,
                details: { name: item.text }
            });
        } else {
            // Communication/documentation — no order form, just confirm as task
            this.showOrderConfirmation({
                type: 'task',
                summary: item.text,
                details: { description: item.text }
            });
        }
    },

    refreshOrdersView() {
        if (!this.isOpen || this._orderConfirmation) return;
        const contentEl = document.getElementById('lens-content-right');
        if (contentEl) {
            contentEl.innerHTML = this._buildOrdersViewHTML();
            contentEl.scrollTop = contentEl.scrollHeight;
        }
    },

    // ==================== Overlay Creation ====================

    _createOverlay() {
        const overlay = document.createElement('div');
        overlay.className = 'glasses-overlay';
        overlay.id = 'glasses-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-label', 'Smart Glasses HUD');

        const isLLM = (typeof AICoworker !== 'undefined') && AICoworker.state?.glassesDisplay;
        const sourceLabel = isLLM ? 'AI' : 'FALLBACK';

        overlay.innerHTML = `
            <div class="glasses-backdrop" onclick="SmartGlasses.close()"></div>
            <div class="glasses-frame">
                <div class="glasses-header">
                    <span class="glasses-header-title">SMART GLASSES HUD</span>
                    <span class="glasses-header-source">${sourceLabel}</span>
                    <button class="glasses-close" onclick="SmartGlasses.close()" title="Close">\u00D7</button>
                </div>
                <div class="glasses-viewport">
                    <div class="glasses-lens glasses-lens-left" id="glasses-lens-left">
                        <div class="lens-title" id="lens-title-left">PATIENT CONTEXT</div>
                        <div class="lens-separator">\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500</div>
                        <div class="lens-content lens-content-scrollable" id="lens-content-left">
                        </div>
                        <div class="lens-mode-bar">
                            <button class="lens-mode-btn active" data-mode="context" onclick="SmartGlasses.showContextMode()" title="Patient context">\uD83D\uDC64 Context</button>
                            <button class="lens-mode-btn" data-mode="notes" onclick="SmartGlasses.showNotesReview()" title="Review recent notes">\uD83D\uDCDD Notes</button>
                            <button class="lens-mode-btn" data-mode="data" onclick="SmartGlasses.showDataReview()" title="Review labs & imaging">\uD83D\uDCCA Data</button>
                            <button class="lens-mode-btn" data-mode="ask" onclick="SmartGlasses.showAskMode()" title="Ask AI a question">\u2753 Ask</button>
                        </div>
                        <div class="lens-nav">
                            <span class="lens-nav-indicator" id="lens-nav-left">\u2191\u2193 scroll</span>
                        </div>
                    </div>
                    <div class="glasses-bridge"></div>
                    <div class="glasses-lens glasses-lens-right" id="glasses-lens-right">
                        <div class="lens-title" id="lens-title-right">ORDERS</div>
                        <div class="lens-separator">\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500</div>
                        <div class="lens-content lens-content-scrollable" id="lens-content-right">
                            ${this._buildOrdersViewHTML()}
                        </div>
                        <div class="lens-nav" id="lens-nav-right-container">
                            <span class="lens-nav-indicator" id="lens-nav-right">\u2191\u2193 scroll</span>
                        </div>
                    </div>
                </div>
                <div class="glasses-footer">
                    <span class="glasses-footer-left">
                        <span class="g1-ble-status" id="g1-ble-status">${this._getBLEStatusHTML()}</span>
                    </span>
                    <span class="glasses-footer-center">Even Realities G1 \u00B7 \u2191\u2193 Scroll \u00B7 Esc Close</span>
                    <span class="glasses-footer-right">
                        <button class="g1-dictate-btn" id="g1-dictate-btn" onclick="SmartGlasses.toggleDictation()" title="Toggle dictation">${this._getDictateButtonHTML()}</button>
                        <button class="g1-analyze-btn" onclick="SmartGlasses.refreshAnalysis()" title="Re-analyze case and update display">\uD83D\uDD04 Analyze</button>
                        <button class="g1-connect-btn" id="g1-connect-btn" onclick="SmartGlasses.toggleBLEConnection()" title="${typeof G1Bluetooth !== 'undefined' && G1Bluetooth.isConnected() ? 'Disconnect from glasses' : 'Connect to G1 glasses via Bluetooth'}">${typeof G1Bluetooth !== 'undefined' && G1Bluetooth.isConnected() ? '\uD83D\uDD35 Disconnect' : '\uD83D\uDD17 Connect G1'}</button>
                        <button class="g1-push-btn" onclick="SmartGlasses.pushToGlasses()" title="Push current display to G1 glasses" ${typeof G1Bluetooth !== 'undefined' && G1Bluetooth.isConnected() ? '' : 'disabled'}>\uD83D\uDCE4 Push to G1</button>
                    </span>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);
        requestAnimationFrame(() => overlay.classList.add('visible'));
    },

    _renderLines(lines) {
        return lines.map(l => `<div class="lens-line">${this._esc(l) || '&nbsp;'}</div>`).join('');
    },

    // ==================== Navigation ====================

    nextScreen(lens) {
        if (this._orderConfirmation && lens === 'right') return;
        if (lens === 'left') {
            if (this.leftScreens.length <= 1) return;
            this.leftScreen = (this.leftScreen + 1) % this.leftScreens.length;
        } else {
            if (this.rightScreens.length <= 1) return;
            this.rightScreen = (this.rightScreen + 1) % this.rightScreens.length;
        }
        this._updateLens(lens);
    },

    prevScreen(lens) {
        if (this._orderConfirmation && lens === 'right') return;
        if (lens === 'left') {
            if (this.leftScreens.length <= 1) return;
            this.leftScreen = (this.leftScreen - 1 + this.leftScreens.length) % this.leftScreens.length;
        } else {
            if (this.rightScreens.length <= 1) return;
            this.rightScreen = (this.rightScreen - 1 + this.rightScreens.length) % this.rightScreens.length;
        }
        this._updateLens(lens);
    },

    _updateLens(lens) {
        const idx = lens === 'left' ? this.leftScreen : this.rightScreen;
        const screens = lens === 'left' ? this.leftScreens : this.rightScreens;
        const screen = screens[idx];
        if (!screen) return;

        const titleEl = document.getElementById(`lens-title-${lens}`);
        const contentEl = document.getElementById(`lens-content-${lens}`);
        const navEl = document.getElementById(`lens-nav-${lens}`);

        if (titleEl) titleEl.textContent = screen.title;
        if (contentEl) {
            contentEl.style.opacity = '0';
            setTimeout(() => {
                contentEl.innerHTML = this._renderLines(screen.lines);
                contentEl.style.opacity = '1';
            }, 80);
        }
        if (navEl) navEl.textContent = `${idx + 1}/${screens.length}`;
    },

    _scrollLeftLens(delta) {
        const contentEl = document.getElementById('lens-content-left');
        if (contentEl) contentEl.scrollTop += delta;
    },

    _scrollRightLens(delta) {
        const contentEl = document.getElementById('lens-content-right');
        if (contentEl) contentEl.scrollTop += delta;
    },

    // ==================== Utilities ====================

    _formatDate(dateStr) {
        if (!dateStr) return '';
        try {
            const d = new Date(dateStr);
            return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        } catch {
            return dateStr;
        }
    },

    _wordWrap(text, targetArray) {
        const words = text.split(' ');
        let line = '';
        for (const w of words) {
            if ((line + ' ' + w).trim().length > this.MAX_LINE_CHARS) {
                targetArray.push(line.trim());
                line = w;
            } else {
                line = (line + ' ' + w).trim();
            }
        }
        if (line) targetArray.push(line.trim());
    },

    _truncate(str, max) {
        if (!str) return '';
        str = str.replace(/\n/g, ' ').trim();
        if (str.length <= max) return str;
        return str.slice(0, max - 1) + '\u2026';
    },

    _esc(str) {
        if (!str) return '';
        const el = document.createElement('span');
        el.textContent = str;
        return el.innerHTML;
    },

    // ==================== G1 BLE Integration ====================

    /**
     * Toggle BLE connection to Even Realities G1 glasses
     */
    async toggleBLEConnection() {
        if (typeof G1Bluetooth === 'undefined') {
            App.showToast('G1 Bluetooth driver not loaded', 'warning');
            return;
        }

        if (G1Bluetooth.isConnected()) {
            G1Bluetooth.disconnect();
            App.showToast('Disconnected from G1 glasses', 'info');
        } else {
            App.showToast('Scanning for G1 glasses...', 'info');
            try {
                const connected = await G1Bluetooth.connect();
                if (connected) {
                    App.showToast('Connected to G1 glasses!', 'success');
                    // Auto-push current display after connecting
                    this.pushToGlasses();
                }
            } catch (err) {
                App.showToast(`G1 connection failed: ${err.message}`, 'error');
            }
        }
        this._updateBLEUI();
    },

    /**
     * Push the current glasses display data to the real G1 hardware via BLE.
     */
    async pushToGlasses() {
        if (typeof G1Bluetooth === 'undefined' || !G1Bluetooth.isConnected()) {
            App.showToast('G1 not connected — connect first', 'warning');
            return;
        }

        // Try LLM-generated glassesDisplay first (pre-formatted for G1)
        const state = (typeof AICoworker !== 'undefined') ? AICoworker.state : null;
        if (state?.glassesDisplay) {
            console.log('👓 Pushing LLM-generated HUD to G1...');
            const success = await G1Bluetooth.sendClinicalHUD(state.glassesDisplay);
            if (success) {
                App.showToast('Clinical HUD pushed to G1 glasses', 'success');
                return;
            }
        }

        // Fallback: build screens from current state
        const data = this._getGlassesData();
        if (!data) {
            App.showToast('No clinical data to push — run analysis first', 'warning');
            return;
        }

        const screens = this._buildLeftScreensFallback(data);
        const rightScreens = this._buildRightScreensFallback(data);
        const allScreens = [...screens, ...rightScreens];

        console.log(`👓 Pushing ${allScreens.length} fallback screens to G1...`);
        const success = await G1Bluetooth.sendText(allScreens);
        if (success) {
            App.showToast(`Pushed ${allScreens.length} screens to G1 glasses`, 'success');
        }
    },

    /**
     * Get BLE status HTML for the footer
     */
    _getBLEStatusHTML() {
        if (typeof G1Bluetooth === 'undefined') return '<span class="g1-status-dot g1-unavailable"></span> BLE N/A';
        if (G1Bluetooth.isConnected()) return '<span class="g1-status-dot g1-connected"></span> G1 Connected';
        return '<span class="g1-status-dot g1-disconnected"></span> G1 Not Connected';
    },

    /**
     * Update BLE UI elements after connection state changes
     */
    _updateBLEUI() {
        const statusEl = document.getElementById('g1-ble-status');
        if (statusEl) statusEl.innerHTML = this._getBLEStatusHTML();

        const connectBtn = document.getElementById('g1-connect-btn');
        if (connectBtn) {
            const connected = typeof G1Bluetooth !== 'undefined' && G1Bluetooth.isConnected();
            connectBtn.textContent = connected ? '\uD83D\uDD35 Disconnect' : '\uD83D\uDD17 Connect G1';
            connectBtn.title = connected ? 'Disconnect from glasses' : 'Connect to G1 glasses via Bluetooth';
        }

        const pushBtn = document.querySelector('.g1-push-btn');
        if (pushBtn) {
            pushBtn.disabled = !(typeof G1Bluetooth !== 'undefined' && G1Bluetooth.isConnected());
        }
    },

    /**
     * Trigger AI analysis from the glasses view and refresh both lenses when done.
     */
    refreshAnalysis() {
        if (typeof AICoworker === 'undefined' || !AICoworker.isApiConfigured()) {
            if (typeof App !== 'undefined') App.showToast('API key not configured', 'warning');
            return;
        }

        // Show a loading state on the analyze button
        const btn = document.querySelector('.g1-analyze-btn');
        if (btn) {
            btn.textContent = '\u23F3 Analyzing...';
            btn.disabled = true;
        }

        // Start analysis
        AICoworker.refreshThinking();

        // Poll for completion and refresh glasses content
        const poll = setInterval(() => {
            if (AICoworker.state?.status === 'ready') {
                clearInterval(poll);
                // Refresh both lenses
                this._refreshGlassesContent();
                // Reset button
                if (btn) {
                    btn.textContent = '\uD83D\uDD04 Analyze';
                    btn.disabled = false;
                }
                if (typeof App !== 'undefined') App.showToast('Glasses display updated', 'success');
                // Auto-push to hardware if connected
                if (typeof G1Bluetooth !== 'undefined' && G1Bluetooth.isConnected()) {
                    this.pushToGlasses();
                }
            }
        }, 1000);

        // Safety timeout — stop polling after 60s
        setTimeout(() => {
            clearInterval(poll);
            if (btn) { btn.textContent = '\uD83D\uDD04 Analyze'; btn.disabled = false; }
        }, 60000);
    },

    /**
     * Refresh both lens contents with current AI state
     */
    _refreshGlassesContent() {
        // Refresh left lens
        const leftEl = document.getElementById('lens-content-left');
        if (leftEl) {
            const data = this._getGlassesData();
            leftEl.innerHTML = this._buildContextScrollableHTML(data);
        }
        // Refresh right lens
        const rightEl = document.getElementById('lens-content-right');
        if (rightEl) {
            rightEl.innerHTML = this._buildOrdersViewHTML();
        }
    },

    // ==================== Dictation from Glasses ====================

    /**
     * Toggle dictation on/off from the glasses interface.
     * Opens/closes the DictationWidget and updates the button state.
     */
    toggleDictation() {
        if (typeof DictationWidget === 'undefined') {
            if (typeof App !== 'undefined') App.showToast('Dictation not available', 'warning');
            return;
        }

        if (DictationWidget.isOpen) {
            DictationWidget.close();
            this._dictating = false;
        } else {
            DictationWidget.open();
            this._dictating = true;
        }
        this._updateDictateUI();

        // Poll for dictation completion to update glasses display after synthesis
        if (this._dictating) {
            if (this._dictationPoll) clearInterval(this._dictationPoll);
            this._dictationPoll = setInterval(() => {
                // Check if dictation widget closed or synthesis finished
                const stillOpen = typeof DictationWidget !== 'undefined' && DictationWidget.isOpen;
                if (!stillOpen && this._dictating) {
                    this._dictating = false;
                    clearInterval(this._dictationPoll);
                    this._dictationPoll = null;
                    this._updateDictateUI();

                    // Refresh glasses content after dictation synthesis completes
                    setTimeout(() => {
                        this._refreshGlassesContent();
                        // Push updated display to hardware if connected
                        if (typeof G1Bluetooth !== 'undefined' && G1Bluetooth.isConnected()) {
                            this.pushToGlasses();
                        }
                    }, 2000);
                }
            }, 1000);
        } else {
            if (this._dictationPoll) {
                clearInterval(this._dictationPoll);
                this._dictationPoll = null;
            }
        }
    },

    /**
     * Get the dictate button HTML based on current state
     */
    _getDictateButtonHTML() {
        const isActive = this._dictating || (typeof DictationWidget !== 'undefined' && DictationWidget.isOpen);
        if (isActive) {
            return '\uD83D\uDD34 Stop Dictation';
        }
        return '\uD83C\uDF99 Dictate';
    },

    /**
     * Update dictate button appearance
     */
    _updateDictateUI() {
        const btn = document.getElementById('g1-dictate-btn');
        if (!btn) return;
        const isActive = this._dictating || (typeof DictationWidget !== 'undefined' && DictationWidget.isOpen);
        btn.innerHTML = this._getDictateButtonHTML();
        btn.classList.toggle('g1-dictating', isActive);
        btn.title = isActive ? 'Stop dictation' : 'Start dictation';
    },

    /**
     * Initialize G1 BLE event listeners
     */
    _initBLEListeners() {
        if (typeof G1Bluetooth === 'undefined') return;

        G1Bluetooth.on('connected', () => this._updateBLEUI());
        G1Bluetooth.on('disconnected', () => this._updateBLEUI());

        // TouchBar navigation from glasses
        G1Bluetooth.on('touchbar', ({ action }) => {
            if (action === 'single_tap') {
                // Tap to advance screen — push next page
                this.pushToGlasses();
            } else if (action === 'double_tap') {
                // Double tap to close
                this.close();
            } else if (action === 'ai_start') {
                // Long press — start voice dictation
                if (typeof DictationWidget !== 'undefined') {
                    DictationWidget.open();
                }
            }
        });

        // Auto-push when AI state updates (if connected)
        if (typeof AICoworker !== 'undefined') {
            const origRender = AICoworker.render.bind(AICoworker);
            let pushDebounce = null;
            const autoPush = () => {
                if (G1Bluetooth.isConnected() && AICoworker.state?.glassesDisplay) {
                    if (pushDebounce) clearTimeout(pushDebounce);
                    pushDebounce = setTimeout(() => this.pushToGlasses(), 2000);
                }
            };
            // Hook into state changes
            G1Bluetooth.on('connected', () => {
                // Push immediately on connect
                setTimeout(() => this.pushToGlasses(), 500);
            });
        }
    }
};

window.SmartGlasses = SmartGlasses;
