/**
 * Dictation Widget — Persistent floating dual-pane dictation window
 *
 * Two buckets displayed side-by-side:
 *   LEFT  — Context: clinical reasoning, observations, thinking out loud
 *           → feeds AI analysis and documentation
 *   RIGHT — Orders: verbal order commands, tasks, communications
 *           → parsed by Claude and entered into chart on confirmation
 *
 * Usage:
 *   DictationWidget.toggle()  — open/close
 *   DictationWidget.open()    — open and start listening
 *   DictationWidget.close()   — stop listening and close
 *
 * Order flow:
 *   Say "order a BMP stat" → detected as Order → Claude parses →
 *   confirmation card appears → say "confirm" or click → OrderEntry.openWithPrefill()
 */
const DictationWidget = {
    isOpen: false,
    isListening: false,
    isMinimized: false,
    recognition: null,

    // Dual-pane transcript data
    contextLines: [],   // [{text, timestamp}]
    orderLines: [],     // [{text, timestamp, orderPhrase, parsed, confirmed, cancelled, error}]
    _interimText: '',
    _interimBucket: null, // 'context' or 'order' — real-time classification hint

    // Order parsing
    _pendingOrderParse: false,
    _orderQueue: [],
    _activeConfirmation: null,

    // Classification patterns
    _orderRegex: /\b(?:order|put in|i need|let's get|let's order|can we get|i(?:'d| would) like to order|go ahead and order|start|hold|discontinue|dc |d\/c )\s+(.+)/i,
    _taskRegex: /\b(?:call|page|notify|tell the nurse|tell nursing|ask the nurse|ask nursing|consult|get (?:a )?consult)\b/i,
    _confirmRegex: /\b(?:confirm|yes confirm|confirm that|go ahead|approve|submit that)\b/i,
    _cancelRegex: /\b(?:cancel|nevermind|never mind|cancel that|scratch that)\b/i,
    _refreshRegex: /\b(?:refresh analysis|refresh thinking|update analysis|re-analyze|reanalyze|analyze case)\b/i,
    // Interim classification hint — does it LOOK like an order so far?
    _orderHintRegex: /\b(?:order|put in|i need|let's get|let's order|can we get|start|hold|discontinue|call|page|notify|tell the|ask the)\b/i,

    PARSE_MODEL: 'claude-haiku-4-5-20251001',

    // ==================== Lifecycle ====================

    toggle() {
        if (this.isOpen) this.close();
        else this.open();
    },

    open() {
        if (this.isOpen) {
            if (this.isMinimized) this._expand();
            return;
        }
        this.isOpen = true;
        this.isMinimized = false;
        this._activeConfirmation = null;
        this._orderQueue = [];
        this._createWidget();
        this.startListening();
    },

    close() {
        this.stopListening();
        const el = document.getElementById('dictation-widget');
        if (el) el.remove();
        this.isOpen = false;
        this.isMinimized = false;
        this._activeConfirmation = null;
        this._orderQueue = [];
    },

    minimize() {
        this.isMinimized = true;
        const el = document.getElementById('dictation-widget');
        if (el) el.classList.add('minimized');
    },

    _expand() {
        this.isMinimized = false;
        const el = document.getElementById('dictation-widget');
        if (el) el.classList.remove('minimized');
        this._scrollPanes();
    },

    clearTranscript() {
        this.contextLines = [];
        this.orderLines = [];
        this._renderContextPane();
        this._renderOrderPane();
    },

    // ==================== Speech Recognition ====================

    startListening() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            if (typeof App !== 'undefined') App.showToast('Speech recognition not supported', 'error');
            return;
        }

        // Mutual exclusion: stop other speech features
        if (typeof AmbientScribe !== 'undefined' && AmbientScribe.isListening) {
            AmbientScribe.stopListening();
        }
        if (typeof AICoworker !== 'undefined' && AICoworker._handsFreeActive) {
            AICoworker.stopHandsFree();
        }

        this.isListening = true;
        this._interimText = '';
        this._interimBucket = null;

        this.recognition = new SpeechRecognition();
        this.recognition.continuous = true;
        this.recognition.interimResults = true;
        this.recognition.lang = 'en-US';
        this.recognition.maxAlternatives = 1;

        const self = this;

        this.recognition.onresult = function(event) {
            self._onSpeechResult(event);
        };

        this.recognition.onerror = function(event) {
            if (event.error === 'not-allowed') {
                if (typeof App !== 'undefined') App.showToast('Microphone access denied', 'error');
                self.stopListening();
            } else if (event.error !== 'no-speech' && event.error !== 'aborted') {
                console.warn('Dictation error:', event.error);
            }
        };

        this.recognition.onend = function() {
            // Auto-restart if still listening
            if (self.isListening) {
                try { self.recognition.start(); } catch (e) { /* already started */ }
            }
        };

        try {
            this.recognition.start();
        } catch (e) {
            console.error('Failed to start dictation:', e);
        }

        this._updateMicIndicator();
    },

    stopListening() {
        this.isListening = false;
        if (this.recognition) {
            try { this.recognition.stop(); } catch (e) { /* ok */ }
            this.recognition = null;
        }
        this._updateMicIndicator();
    },

    _onSpeechResult(event) {
        let interim = '';
        let finalText = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript.trim();
            if (event.results[i].isFinal) {
                finalText += transcript + ' ';
            } else {
                interim += transcript;
            }
        }

        // Update interim display with real-time bucket hint
        this._interimText = interim;
        if (interim) {
            this._interimBucket = this._classifyText(interim);
        }
        this._renderInterim();

        // Process final text
        if (finalText.trim()) {
            this._processFinalText(finalText.trim());
        }
    },

    _classifyText(text) {
        if (this._orderRegex.test(text) || this._taskRegex.test(text)) return 'order';
        return 'context';
    },

    _processFinalText(text) {
        const now = new Date();
        const timestamp = now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });

        // Clear interim
        this._interimText = '';
        this._interimBucket = null;
        this._renderInterim();

        // Check for voice commands first
        if (this._activeConfirmation && this._confirmRegex.test(text)) {
            this._confirmCurrentOrder();
            return;
        }
        if (this._activeConfirmation && this._cancelRegex.test(text)) {
            this._cancelCurrentOrder();
            return;
        }
        if (this._refreshRegex.test(text)) {
            this._triggerRefreshAnalysis();
            return;
        }

        // Classify into bucket
        const bucket = this._classifyText(text);

        if (bucket === 'order') {
            const orderMatch = text.match(this._orderRegex);
            const orderPhrase = orderMatch ? orderMatch[1].trim() : text;
            this.orderLines.push({ text, timestamp, orderPhrase, isParsing: true });
            this._renderOrderPane();
            this._parseOrderWithClaude(orderPhrase);

            // Live update glasses right lens with order being parsed
            if (typeof SmartGlasses !== 'undefined' && SmartGlasses.isOpen) {
                SmartGlasses.pushOrderToRightLens(orderPhrase, 'parsing');
            }
        } else {
            this.contextLines.push({ text, timestamp });
            this._renderContextPane();

            // Forward context to AI system
            this._forwardContextToAI(text);

            // Live update glasses left lens with context
            if (typeof SmartGlasses !== 'undefined' && SmartGlasses.isOpen) {
                SmartGlasses.pushContextToLeftLens(text);
            }
        }

        this._scrollPanes();
    },

    _forwardContextToAI(text) {
        // Feed thinking-out-loud content into the AI's context
        if (typeof AICoworker !== 'undefined' && AICoworker.state) {
            if (!AICoworker.state._dictationContext) {
                AICoworker.state._dictationContext = [];
            }
            AICoworker.state._dictationContext.push({
                text: text,
                timestamp: Date.now()
            });
        }
    },

    // ==================== Voice Commands ====================

    _triggerRefreshAnalysis() {
        console.log('🎤 Voice command: refresh analysis');
        if (typeof App !== 'undefined' && App.showToast) {
            App.showToast('🔄 Refreshing analysis...', 'info');
        }

        // Update glasses if open
        if (typeof SmartGlasses !== 'undefined' && SmartGlasses.isOpen) {
            SmartGlasses.pushContextToLeftLens('⟳ Refreshing analysis...');
        }

        // Trigger incremental refresh which incorporates dictation context
        if (typeof AICoworker !== 'undefined' && AICoworker.refreshThinking) {
            AICoworker.refreshThinking();
        }
    },

    // ==================== Order Parsing ====================

    async _parseOrderWithClaude(orderPhrase) {
        if (typeof AICoworker === 'undefined' || !AICoworker.apiKey) {
            this._markOrderError('No API key configured');
            return;
        }

        this._pendingOrderParse = true;

        const systemPrompt = `You are a clinical order parser for an EHR system. Parse the spoken order phrase into structured order data.

Determine the order type: medication, lab, imaging, procedure, consult, nursing

MEDICATION — use these EXACT values:
- route: PO, IV, IV Push, IV Piggyback, IM, SC, SL, PR, Topical, Inhaled, Intranasal
- frequency: Once, Daily, BID, TID, QID, Q2H, Q4H, Q6H, Q8H, Q12H, Q24H, Q4H PRN, Q6H PRN, Q8H PRN, PRN, At bedtime, Before meals, After meals, With meals, Continuous
- fields: name, dose, route, frequency, indication

LAB — map to EXACT test names:
Complete Blood Count, Basic Metabolic Panel, Comprehensive Metabolic Panel, Lipid Panel, Liver Function Tests, Coagulation Panel (PT/INR/PTT), Thyroid Panel, Troponin, BNP, Pro-BNP, Magnesium, Phosphorus, Lactate, Ammonia, Uric Acid, Iron Studies, Ferritin, Vitamin B12, Folate, Vitamin D, Hemoglobin A1c, C-Reactive Protein, ESR, Procalcitonin, Arterial Blood Gas, Venous Blood Gas, Urinalysis, Urine Culture, Urine Electrolytes, Blood Culture, Sputum Culture
- specimen: Blood, Urine, Stool, CSF, Sputum, Arterial Blood, Venous Blood
- priority: Routine, Urgent, STAT

IMAGING:
- modality: X-Ray, CT, MRI, Ultrasound, Echo, Nuclear Medicine, Fluoroscopy
- bodyPart: e.g. Chest, Abdomen, Head, Renal/Kidneys
- contrast: Without contrast, With contrast, With and without contrast, N/A
- priority: Routine, Urgent, STAT

CONSULT:
- specialty: Cardiology, Nephrology, Endocrinology, Pulmonology, Gastroenterology, Neurology, Infectious Disease, Oncology, Rheumatology, Psychiatry, Surgery
- priority: Routine, Urgent, STAT
- reason: brief clinical reason

NURSING:
- orderType: Vital Signs, Activity, Diet, I&O Monitoring, Fall Precautions, Isolation, Wound Care, Foley Care
- details: e.g. Q4H vitals, Bed rest, NPO
- priority: Routine, Urgent

Abbreviations: BMP=Basic Metabolic Panel, CBC=Complete Blood Count, CMP=Comprehensive Metabolic Panel, CXR=X-Ray Chest, ABG=Arterial Blood Gas, VBG=Venous Blood Gas, LFTs=Liver Function Tests, TSH=Thyroid Panel, PT/INR=Coagulation Panel (PT/INR/PTT), UA=Urinalysis, lytes=Basic Metabolic Panel, trop=Troponin, mag=Magnesium, phos=Phosphorus, procal=Procalcitonin, BCx=Blood Culture, echo=Echo, lasix=Furosemide, heparin=Heparin, kayexalate=Sodium Polystyrene Sulfonate (Kayexalate), levophed=Norepinephrine, zosyn=Piperacillin-Tazobactam, vanco=Vancomycin, ancef=Cefazolin

If the phrase contains MULTIPLE orders (e.g. "a BMP and a CBC stat"), return an array.
For task/communication items (call, page, notify), use type "nursing" with appropriate orderType.

Respond with ONLY valid JSON, no markdown fences:
{"orders": [{"type": "...", "summary": "human-readable one-liner", "details": {...fields...}, "confidence": 0.0-1.0}]}`;

        try {
            const response = await fetch(AICoworker.apiEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': AICoworker.apiKey,
                    'anthropic-version': '2023-06-01',
                    'anthropic-dangerous-direct-browser-access': 'true'
                },
                body: JSON.stringify({
                    model: this.PARSE_MODEL,
                    max_tokens: 1024,
                    system: systemPrompt,
                    messages: [{ role: 'user', content: 'Parse this spoken order: "' + orderPhrase + '"' }]
                })
            });

            const data = await response.json();
            if (data.content && data.content[0] && data.content[0].text) {
                let text = data.content[0].text.trim();
                text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
                const parsed = JSON.parse(text);
                const orders = parsed.orders || [parsed];
                this._pendingOrderParse = false;
                this._handleParsedOrders(orders);
            } else if (data.error) {
                throw new Error(data.error.message || 'API error');
            }
        } catch (e) {
            console.error('Order parse failed:', e);
            this._pendingOrderParse = false;
            this._markOrderError('Parse failed: ' + e.message);
        }
    },

    async _handleParsedOrders(orders) {
        // Update the last order line with parsed data
        const lastOrder = this.orderLines[this.orderLines.length - 1];
        if (lastOrder) {
            lastOrder.isParsing = false;
            lastOrder.parsed = orders[0];
        }

        // Queue remaining orders
        this._orderQueue = orders.slice(1);

        // Run safety check on first order, then show for confirmation
        if (orders.length > 0) {
            await this._safetyCheckAndShow(orders[0]);
        }
    },

    async _safetyCheckAndShow(order) {
        // Run AI safety check if available
        if (typeof AICoworker !== 'undefined' && AICoworker.checkOrderSafety) {
            try {
                const parsedOrder = {
                    name: order.summary || order.type,
                    text: order.summary || '',
                    orderType: order.type,
                    orderData: order.details || {}
                };
                const safety = await AICoworker.checkOrderSafety(parsedOrder);
                order._safety = safety;

                if (!safety.safe && safety.concerns.length > 0) {
                    console.log('⚠️ Order safety concerns:', safety.concerns);
                }
            } catch (err) {
                console.warn('Safety check failed (non-blocking):', err);
            }
        }

        this._showOrderConfirmation(order);
    },

    _showOrderConfirmation(order) {
        this._activeConfirmation = order;

        // If Smart Glasses are open, show there too
        if (typeof SmartGlasses !== 'undefined' && SmartGlasses.isOpen) {
            SmartGlasses.showOrderConfirmation(order);
        }

        this._renderOrderPane();
    },

    _confirmCurrentOrder() {
        if (!this._activeConfirmation) return;
        const order = this._activeConfirmation;
        this._activeConfirmation = null;

        // Open OrderEntry with prefilled data
        if (typeof OrderEntry !== 'undefined' && order.details) {
            OrderEntry.openWithPrefill(order.type, order.details);
        }

        // Record in AI memory
        if (typeof AICoworker !== 'undefined' && AICoworker.recordExecutedOrder) {
            AICoworker.recordExecutedOrder({
                text: order.summary || order.type,
                orderType: order.type,
                orderData: order.details || {}
            });
        }

        // Mark in order lines
        const now = new Date();
        const timestamp = now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
        this.orderLines.push({ text: '\u2713 ' + (order.summary || order.type), timestamp, confirmed: true });

        // Live update glasses right lens with confirmed order
        if (typeof SmartGlasses !== 'undefined' && SmartGlasses.isOpen) {
            SmartGlasses.pushOrderToRightLens(order.summary || order.type, 'confirmed');
        }

        this._renderOrderPane();

        // Show next queued order
        if (this._orderQueue.length > 0) {
            setTimeout(() => this._safetyCheckAndShow(this._orderQueue.shift()), 500);
        }
    },

    _cancelCurrentOrder() {
        if (!this._activeConfirmation) return;
        const order = this._activeConfirmation;
        this._activeConfirmation = null;

        const now = new Date();
        const timestamp = now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
        this.orderLines.push({ text: '\u2717 Cancelled: ' + (order.summary || order.type), timestamp, cancelled: true });

        this._renderOrderPane();

        if (this._orderQueue.length > 0) {
            setTimeout(() => this._showOrderConfirmation(this._orderQueue.shift()), 500);
        }
    },

    _editCurrentOrder() {
        if (!this._activeConfirmation) return;
        const order = this._activeConfirmation;
        this._activeConfirmation = null;

        if (typeof OrderEntry !== 'undefined' && order.details) {
            OrderEntry.openWithPrefill(order.type, order.details);
        }

        this._renderOrderPane();
    },

    _markOrderError(msg) {
        const lastOrder = this.orderLines[this.orderLines.length - 1];
        if (lastOrder) {
            lastOrder.isParsing = false;
            lastOrder.error = msg;
        }
        this._renderOrderPane();
    },

    // ==================== Widget DOM ====================

    _createWidget() {
        const el = document.createElement('div');
        el.id = 'dictation-widget';
        el.className = 'dictation-widget';

        el.innerHTML = `
            <div class="dictation-header" onclick="if(DictationWidget.isMinimized) DictationWidget._expand()">
                <div class="dictation-mic-indicator" id="dictation-mic">
                    <span class="mic-dot"></span>
                </div>
                <span class="dictation-title">Dictation</span>
                <div class="dictation-header-actions">
                    <button class="dictation-header-btn" onclick="event.stopPropagation(); DictationWidget.clearTranscript()" title="Clear transcript">\u21BA</button>
                    <button class="dictation-header-btn" onclick="event.stopPropagation(); DictationWidget.minimize()" title="Minimize">\u2014</button>
                    <button class="dictation-header-btn" onclick="event.stopPropagation(); DictationWidget.close()" title="Close">\u00D7</button>
                </div>
            </div>
            <div class="dictation-body">
                <div class="dictation-panes">
                    <div class="dictation-pane context-pane">
                        <div class="pane-label">CONTEXT</div>
                        <div class="pane-content" id="dictation-context-pane">
                            <div class="pane-placeholder">Clinical reasoning &amp; observations will appear here...</div>
                        </div>
                        <div class="pane-interim context-interim" id="dictation-context-interim"></div>
                    </div>
                    <div class="dictation-pane-divider"></div>
                    <div class="dictation-pane order-pane">
                        <div class="pane-label">ORDERS</div>
                        <div class="pane-content" id="dictation-order-pane">
                            <div class="pane-placeholder">Say "order [something]" to enter an order...</div>
                        </div>
                        <div class="pane-interim order-interim" id="dictation-order-interim"></div>
                    </div>
                </div>
                <div id="dictation-order-card"></div>
            </div>
        `;

        document.body.appendChild(el);
        requestAnimationFrame(() => el.classList.add('visible'));
    },

    _renderContextPane() {
        const container = document.getElementById('dictation-context-pane');
        if (!container) return;

        if (this.contextLines.length === 0) {
            container.innerHTML = '<div class="pane-placeholder">Clinical reasoning &amp; observations will appear here...</div>';
            return;
        }

        container.innerHTML = this.contextLines.map(line =>
            `<div class="dictation-line context-line"><span class="dictation-timestamp">${line.timestamp}</span>${this._esc(line.text)}</div>`
        ).join('');
    },

    _renderOrderPane() {
        const container = document.getElementById('dictation-order-pane');
        if (!container) return;

        if (this.orderLines.length === 0 && !this._activeConfirmation) {
            container.innerHTML = '<div class="pane-placeholder">Say "order [something]" to enter an order...</div>';
            this._renderConfirmationCard();
            return;
        }

        container.innerHTML = this.orderLines.map(line => {
            let cls = 'dictation-line order-line';
            if (line.confirmed) cls += ' confirmed';
            if (line.cancelled) cls += ' cancelled';
            if (line.error) cls += ' error';
            if (line.isParsing) cls += ' parsing';

            let suffix = '';
            if (line.isParsing) suffix = '<span class="parsing-tag">\u23F3 Parsing...</span>';
            if (line.error) suffix = `<span class="error-tag">\u26A0 ${this._esc(line.error)}</span>`;
            if (line.parsed && !line.confirmed && !line.cancelled) {
                suffix = `<span class="parsed-tag">\u2713 ${this._esc(line.parsed.summary || '')}</span>`;
            }

            return `<div class="${cls}"><span class="dictation-timestamp">${line.timestamp}</span>${this._esc(line.text)}${suffix}</div>`;
        }).join('');

        this._renderConfirmationCard();
    },

    _renderConfirmationCard() {
        const cardContainer = document.getElementById('dictation-order-card');
        if (!cardContainer) return;

        if (!this._activeConfirmation) {
            cardContainer.innerHTML = '';
            return;
        }

        const order = this._activeConfirmation;
        let detailLines = '';

        if (order.type === 'medication') {
            const d = order.details || {};
            detailLines = `<div class="order-detail">\uD83D\uDC8A ${this._esc(d.name || order.summary)}</div>
                <div class="order-detail">Dose: ${this._esc(d.dose || '?')} &middot; ${this._esc(d.route || '')} &middot; ${this._esc(d.frequency || '')}</div>`;
        } else if (order.type === 'lab') {
            const d = order.details || {};
            detailLines = `<div class="order-detail">\uD83D\uDD2C ${this._esc(d.name || order.summary)}</div>
                <div class="order-detail">${this._esc(d.priority || 'Routine')} &middot; ${this._esc(d.specimen || 'Blood')}</div>`;
        } else if (order.type === 'imaging') {
            const d = order.details || {};
            detailLines = `<div class="order-detail">\uD83D\uDDBC ${this._esc(d.modality || '?')} ${this._esc(d.bodyPart || '')}</div>
                <div class="order-detail">${this._esc(d.contrast || 'N/A')} &middot; ${this._esc(d.priority || 'Routine')}</div>`;
        } else if (order.type === 'consult') {
            const d = order.details || {};
            detailLines = `<div class="order-detail">\uD83D\uDC65 Consult: ${this._esc(d.specialty || order.summary)}</div>
                <div class="order-detail">${this._esc(d.priority || 'Routine')} &middot; ${this._esc(d.reason || '')}</div>`;
        } else {
            detailLines = `<div class="order-detail">${this._esc(order.summary || 'Order')}</div>`;
        }

        const lowConf = order.confidence < 0.6;
        const safety = order._safety;
        const hasConcerns = safety && !safety.safe && safety.concerns && safety.concerns.length > 0;

        let safetyHtml = '';
        if (hasConcerns) {
            safetyHtml = '<div class="order-safety-warning">';
            safetyHtml += '<div class="safety-warning-header">\u26A0\uFE0F Safety Concerns</div>';
            safety.concerns.forEach(c => {
                const sevClass = c.severity === 'critical' ? 'critical' : (c.severity === 'high' ? 'high' : 'moderate');
                safetyHtml += `<div class="safety-concern ${sevClass}"><span class="concern-type">${this._esc(c.type || 'Warning')}</span> ${this._esc(c.description || c.text || '')}</div>`;
            });
            if (safety.suggestedAlternative) {
                safetyHtml += `<div class="safety-alternative">Suggested: ${this._esc(safety.suggestedAlternative)}</div>`;
            }
            safetyHtml += '</div>';
        }

        cardContainer.innerHTML = `
            <div class="dictation-confirm-card${lowConf ? ' low-confidence' : ''}${hasConcerns ? ' has-safety-concerns' : ''}">
                <div class="confirm-card-header">${this._esc(order.summary || 'Confirm Order')}${lowConf ? '<span class="low-conf-badge">Low confidence</span>' : ''}</div>
                <div class="confirm-card-details">${detailLines}</div>
                ${safetyHtml}
                <div class="confirm-card-actions">
                    <button class="confirm-btn confirm" onclick="DictationWidget._confirmCurrentOrder()">\u2713 ${hasConcerns ? 'Proceed Anyway' : 'Confirm'}</button>
                    <button class="confirm-btn edit" onclick="DictationWidget._editCurrentOrder()">\u270E Edit</button>
                    <button class="confirm-btn cancel" onclick="DictationWidget._cancelCurrentOrder()">\u2717</button>
                </div>
                <div class="confirm-card-hint">Say "confirm" or "cancel"</div>
            </div>
        `;
    },

    _renderInterim() {
        const contextInterim = document.getElementById('dictation-context-interim');
        const orderInterim = document.getElementById('dictation-order-interim');

        if (!contextInterim || !orderInterim) return;

        if (this._interimText) {
            if (this._interimBucket === 'order') {
                contextInterim.textContent = '';
                orderInterim.textContent = this._interimText;
            } else {
                contextInterim.textContent = this._interimText;
                orderInterim.textContent = '';
            }
        } else {
            contextInterim.textContent = '';
            orderInterim.textContent = '';
        }
    },

    _scrollPanes() {
        const ctx = document.getElementById('dictation-context-pane');
        const ord = document.getElementById('dictation-order-pane');
        if (ctx) ctx.scrollTop = ctx.scrollHeight;
        if (ord) ord.scrollTop = ord.scrollHeight;
    },

    _updateMicIndicator() {
        const mic = document.getElementById('dictation-mic');
        if (!mic) return;
        mic.classList.toggle('active', this.isListening);
    },

    // ==================== Utilities ====================

    _esc(str) {
        if (!str) return '';
        const el = document.createElement('span');
        el.textContent = str;
        return el.innerHTML;
    }
};

window.DictationWidget = DictationWidget;
