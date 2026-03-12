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
    _leftMode: 'context',     // 'context' | 'notes' | 'data'

    LINES_PER_SCREEN: 5,
    MAX_LINE_CHARS: 45,

    toggle() {
        if (this.isOpen) this.close();
        else this.open();
    },

    open() {
        if (this.isOpen) return;
        this.isOpen = true;
        this.leftScreen = 0;
        this.rightScreen = 0;
        this._orderConfirmation = null;
        this._savedRightScreens = null;
        this._leftMode = 'context';

        const state = (typeof AICoworker !== 'undefined') ? AICoworker.state : null;
        const glassesData = state ? state.glassesDisplay : null;

        // Left lens: paged screens (patient context)
        if (glassesData && glassesData.leftLens) {
            this.leftScreens = this._parseLLMScreens(glassesData.leftLens, 'PATIENT');
        } else {
            const data = this._getGlassesData();
            this.leftScreens = this._buildLeftScreensFallback(data);
        }
        // Right lens: unified scrollable orders view (built in _createOverlay via _buildOrdersViewHTML)

        this._createOverlay();

        this._keyHandler = (e) => {
            if (e.key === 'Escape') {
                if (this._orderConfirmation) { this.cancelOrderConfirmation(); return; }
                this.close(); return;
            }
            if (e.key === 'ArrowLeft') { e.preventDefault(); this.prevScreen('left'); }
            if (e.key === 'ArrowRight') { e.preventDefault(); this.nextScreen('left'); }
            if (e.key === 'ArrowUp') { e.preventDefault(); this._scrollRightLens(-60); }
            if (e.key === 'ArrowDown') { e.preventDefault(); this._scrollRightLens(60); }
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
     * Loads recent notes and displays them as paged screens.
     */
    async showNotesReview() {
        if (!this.isOpen) return;
        this._leftMode = 'notes';
        this.leftScreen = 0;

        const titleEl = document.getElementById('lens-title-left');
        const contentEl = document.getElementById('lens-content-left');
        const navEl = document.getElementById('lens-nav-left');

        if (titleEl) titleEl.textContent = 'RECENT NOTES';
        if (contentEl) contentEl.innerHTML = this._renderLines(['', 'Loading notes...', '', '', '']);
        if (navEl) navEl.textContent = '...';

        try {
            // Load notes from data loader
            let notes = [];
            if (typeof dataLoader !== 'undefined' && dataLoader.loadNotesIndex) {
                const index = await dataLoader.loadNotesIndex();
                notes = Array.isArray(index) ? index : (index?.notes || []);
            }

            if (notes.length === 0) {
                this.leftScreens = [{ title: 'RECENT NOTES', lines: ['', 'No notes found.', '', '', ''] }];
            } else {
                // Sort by date descending, take recent 10
                const sorted = notes.sort((a, b) => new Date(b.date || b.noteDate || 0) - new Date(a.date || a.noteDate || 0)).slice(0, 10);

                this.leftScreens = [];
                for (const note of sorted) {
                    const lines = [];
                    const date = this._formatDate(note.date || note.noteDate);
                    const type = note.type || note.noteType || 'Note';
                    const author = note.author || note.provider || '';

                    lines.push(this._truncate(`${type}`, this.MAX_LINE_CHARS));
                    lines.push(this._truncate(date, this.MAX_LINE_CHARS));
                    lines.push(this._truncate(author, this.MAX_LINE_CHARS));

                    // Try to get a snippet
                    const snippet = note.chiefComplaint || note.assessment || note.summary || note.title || '';
                    if (snippet) {
                        this._wordWrap(this._truncate(snippet, this.MAX_LINE_CHARS * 2), lines);
                    }

                    while (lines.length < this.LINES_PER_SCREEN) lines.push('');
                    this.leftScreens.push({ title: type.toUpperCase(), lines: lines.slice(0, this.LINES_PER_SCREEN) });
                }
            }
        } catch (err) {
            console.error('Failed to load notes for glasses:', err);
            this.leftScreens = [{ title: 'NOTES', lines: ['', 'Error loading notes.', '', '', ''] }];
        }

        this.leftScreen = 0;
        this._updateLens('left');
        this._updateLeftNav();
        this._updateLeftModeButtons();
    },

    /**
     * Switch left lens to data review mode.
     * Loads recent labs, imaging, and EKGs.
     */
    async showDataReview() {
        if (!this.isOpen) return;
        this._leftMode = 'data';
        this.leftScreen = 0;

        const titleEl = document.getElementById('lens-title-left');
        const contentEl = document.getElementById('lens-content-left');
        const navEl = document.getElementById('lens-nav-left');

        if (titleEl) titleEl.textContent = 'REVIEW DATA';
        if (contentEl) contentEl.innerHTML = this._renderLines(['', 'Loading data...', '', '', '']);
        if (navEl) navEl.textContent = '...';

        try {
            this.leftScreens = [];

            // === LABS ===
            if (typeof dataLoader !== 'undefined' && dataLoader.loadLabsIndex) {
                const labIndex = await dataLoader.loadLabsIndex();
                const panels = Array.isArray(labIndex) ? labIndex : (labIndex?.panels || labIndex?.labs || []);

                // Sort by date, take 5 most recent
                const recent = panels
                    .sort((a, b) => new Date(b.collectedDate || b.date || 0) - new Date(a.collectedDate || a.date || 0))
                    .slice(0, 5);

                for (const panel of recent) {
                    const lines = [];
                    const name = panel.name || panel.panelName || 'Lab Panel';
                    const date = this._formatDate(panel.collectedDate || panel.date);

                    lines.push(this._truncate(`LAB: ${name}`, this.MAX_LINE_CHARS));
                    lines.push(this._truncate(date, this.MAX_LINE_CHARS));

                    // Show abnormal results if available
                    const results = panel.results || panel.tests || [];
                    const abnormals = results.filter(r => r.flag || r.abnormal || (r.status && r.status !== 'Normal'));
                    if (abnormals.length > 0) {
                        for (const r of abnormals.slice(0, 3)) {
                            const val = r.value || r.result || '';
                            const name = r.name || r.testName || '';
                            lines.push(this._truncate(`\u26A0 ${name}: ${val}`, this.MAX_LINE_CHARS));
                        }
                    } else {
                        lines.push('All within normal limits');
                    }

                    while (lines.length < this.LINES_PER_SCREEN) lines.push('');
                    this.leftScreens.push({ title: 'LABS', lines: lines.slice(0, this.LINES_PER_SCREEN) });
                }
            }

            // === IMAGING ===
            if (typeof dataLoader !== 'undefined' && dataLoader.loadImaging) {
                const imaging = await dataLoader.loadImaging();
                const studies = Array.isArray(imaging) ? imaging : (imaging?.studies || imaging?.imaging || []);

                const recent = studies
                    .sort((a, b) => new Date(b.date || b.orderDate || 0) - new Date(a.date || a.orderDate || 0))
                    .slice(0, 3);

                for (const study of recent) {
                    const lines = [];
                    const type = study.type || study.modality || 'Imaging';
                    const bodyPart = study.bodyPart || study.description || '';
                    const date = this._formatDate(study.date || study.orderDate);
                    const impression = study.impression || study.finding || study.result || '';

                    lines.push(this._truncate(`${type}: ${bodyPart}`, this.MAX_LINE_CHARS));
                    lines.push(this._truncate(date, this.MAX_LINE_CHARS));
                    if (impression) {
                        this._wordWrap(this._truncate(impression, this.MAX_LINE_CHARS * 3), lines);
                    }

                    while (lines.length < this.LINES_PER_SCREEN) lines.push('');
                    this.leftScreens.push({ title: 'IMAGING', lines: lines.slice(0, this.LINES_PER_SCREEN) });
                }
            }

            if (this.leftScreens.length === 0) {
                this.leftScreens = [{ title: 'DATA', lines: ['', 'No data available.', '', '', ''] }];
            }
        } catch (err) {
            console.error('Failed to load data for glasses:', err);
            this.leftScreens = [{ title: 'DATA', lines: ['', 'Error loading data.', '', '', ''] }];
        }

        this.leftScreen = 0;
        this._updateLens('left');
        this._updateLeftNav();
        this._updateLeftModeButtons();
    },

    /**
     * Return left lens to default context mode.
     */
    showContextMode() {
        this._leftMode = 'context';
        this.leftScreen = 0;

        const state = (typeof AICoworker !== 'undefined') ? AICoworker.state : null;
        const glassesData = state ? state.glassesDisplay : null;

        if (glassesData && glassesData.leftLens) {
            this.leftScreens = this._parseLLMScreens(glassesData.leftLens, 'PATIENT');
        } else {
            const data = this._getGlassesData();
            this.leftScreens = this._buildLeftScreensFallback(data);
        }

        this._updateLens('left');
        this._updateLeftNav();
        this._updateLeftModeButtons();
    },

    _updateLeftNav() {
        const navEl = document.getElementById('lens-nav-left');
        if (navEl) navEl.textContent = `${this.leftScreen + 1}/${this.leftScreens.length}`;
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

        // === RECOMMENDED ORDERS ===
        lines.push('<div class="lens-section-title">RECOMMENDED</div>');

        const recs = this._getRecommendedOrders();
        if (recs.length > 0) {
            for (const rec of recs) {
                const isOrdered = this._sessionOrders.some(o =>
                    o.toLowerCase().includes(rec.text.toLowerCase().slice(0, 15)));
                const cls = isOrdered ? 'lens-line lens-order-done' : 'lens-line lens-order-rec';
                const prefix = isOrdered ? '\u2713' : '\u25CB';
                lines.push(`<div class="${cls}">${prefix} ${this._esc(this._truncate(rec.text, this.MAX_LINE_CHARS - 2))}</div>`);
            }
        } else {
            lines.push('<div class="lens-line lens-order-empty">Run analysis for recommendations</div>');
        }

        return lines.join('');
    },

    _getRecommendedOrders() {
        if (typeof AICoworker === 'undefined' || !AICoworker.state) return [];

        const recs = [];

        const actions = AICoworker.state.suggestedActions || [];
        for (const a of actions) {
            const text = typeof a === 'string' ? a : (a.text || '');
            if (text) recs.push({ text });
        }

        if (recs.length === 0) {
            const cats = AICoworker.state.categorizedActions || {};
            for (const key of ['labs', 'imaging', 'medications', 'communication', 'other']) {
                const items = cats[key];
                if (!items) continue;
                for (const item of items) {
                    const text = typeof item === 'string' ? item : (item.text || '');
                    if (text) recs.push({ text });
                }
            }
        }

        return recs;
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

        const totalLeft = this.leftScreens.length;
        const isLLM = (typeof AICoworker !== 'undefined') && AICoworker.state.glassesDisplay;
        const sourceLabel = isLLM ? 'AI-optimized' : 'fallback';

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
                        <div class="lens-title" id="lens-title-left">${this._esc(this.leftScreens[0]?.title || 'PATIENT')}</div>
                        <div class="lens-separator">\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500</div>
                        <div class="lens-content" id="lens-content-left">
                            ${this._renderLines(this.leftScreens[0]?.lines || [])}
                        </div>
                        <div class="lens-mode-bar">
                            <button class="lens-mode-btn active" data-mode="context" onclick="SmartGlasses.showContextMode()" title="Patient context">\uD83D\uDC64 Context</button>
                            <button class="lens-mode-btn" data-mode="notes" onclick="SmartGlasses.showNotesReview()" title="Review recent notes">\uD83D\uDCDD Notes</button>
                            <button class="lens-mode-btn" data-mode="data" onclick="SmartGlasses.showDataReview()" title="Review labs & imaging">\uD83D\uDCCA Data</button>
                        </div>
                        <div class="lens-nav">
                            <button class="lens-nav-btn" onclick="SmartGlasses.prevScreen('left')" title="Previous (Left arrow)">\u25C0</button>
                            <span class="lens-nav-indicator" id="lens-nav-left">1/${totalLeft}</span>
                            <button class="lens-nav-btn" onclick="SmartGlasses.nextScreen('left')" title="Next (Right arrow)">\u25B6</button>
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
                    PROTOTYPE \u00B7 Even Realities G1 \u00B7 \u2190\u2192 Patient \u00B7 \u2191\u2193 Scroll Orders
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

    _scrollRightLens(delta) {
        const contentEl = document.getElementById('lens-content-right');
        if (contentEl) contentEl.scrollBy({ top: delta, behavior: 'smooth' });
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
    }
};

window.SmartGlasses = SmartGlasses;
