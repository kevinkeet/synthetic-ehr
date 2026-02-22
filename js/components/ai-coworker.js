/**
 * AI Assistant Panel
 * A supportive copilot that helps organize the doctor's thinking
 * without leading or getting ahead of their clinical reasoning.
 *
 * Philosophy: The doctor drives decision-making. AI supports by:
 * - Mirroring back what the doctor has found/done
 * - Surfacing relevant data when contextually appropriate
 * - Flagging safety concerns (contraindications, allergies, interactions)
 * - Tracking what's been addressed vs. still open
 * - Providing help only when explicitly asked
 */

const AICoworker = {
    isVisible: false,
    isMinimized: false,
    updateInterval: null,

    // API Configuration
    apiKey: null,
    apiEndpoint: 'https://api.anthropic.com/v1/messages',
    model: 'claude-sonnet-4-20250514',

    // Longitudinal Clinical Document
    longitudinalDoc: null,
    longitudinalDocUpdater: null,
    longitudinalDocRenderer: null,
    longitudinalDocBuilder: null,
    useLongitudinalContext: true, // Toggle between legacy and longitudinal context

    // Memory System (4-layer architecture)
    sessionContext: null,       // SessionContext — ephemeral session tracking
    workingMemory: null,        // WorkingMemoryAssembler — focused context assembly
    contextAssembler: null,     // ContextAssembler — unified prompt building

    // Default state
    state: {
        status: 'ready', // ready, thinking, alert
        lastUpdated: null,

        // Doctor's dictated thoughts - heavily influences AI reasoning
        dictation: '',
        dictationHistory: [], // Previous dictations for context

        // AI's current summary/understanding of the case
        summary: '',

        // AI's current thinking process
        thinking: '',

        // Suggested next actions (user can click to execute via Claude)
        suggestedActions: [],

        // Key considerations (structured safety/clinical concerns)
        keyConsiderations: [],

        // What the doctor has reviewed/found (AI mirrors this back)
        reviewed: [],

        // Neutral observations - facts, not recommendations
        observations: [],

        // Safety flags only - contraindications, allergies, critical values
        flags: [],

        // Doctor's own task list (they add items, AI doesn't suggest)
        tasks: [],

        // Open/unaddressed items (neutral tracking, not recommendations)
        openItems: [],

        // Context the AI is holding for the doctor
        context: '',

        // Data sources for note writing
        chartData: {
            patientInfo: null,
            vitals: [],
            labs: [],
            meds: [],
            imaging: [],
            nursingNotes: [],
            previousNotes: []
        }
    },

    /**
     * Initialize the AI Assistant panel
     */
    init() {
        // Reset session state on startup - keeps longitudinal doc but clears transient session data
        this.resetSessionState();

        // Create modals (ask, dictation, note, etc.)
        this.createPanel();

        this.loadApiKey(); // Load saved API key
        this.setupEventListeners();

        // Listen for external updates via postMessage
        window.addEventListener('message', (event) => this.handleExternalMessage(event));

        // Listen for Claude thinking synthesis responses
        window.addEventListener('message', (event) => {
            if (event.data && event.data.type === 'CLAUDE_THINKING_RESPONSE') {
                this.receiveThinkingUpdate(event.data.thinking);
            }
            if (event.data && event.data.type === 'CLAUDE_REFRESH_RESPONSE') {
                this.receiveRefreshUpdate(event.data.response);
            }
        });

        // Render into the AI panel tab
        this.render();

        console.log('AI Assistant initialized');

        // NOTE: initializeLongitudinalDocument() is NOT called here.
        // It must be called AFTER patient data loads (see App.loadPatient).
    },

    /**
     * Called after patient data has finished loading.
     * Safe to access PatientHeader, dataLoader, and chart data.
     */
    async onPatientLoaded(patientId) {
        console.log('🧠 AI Copilot: patient loaded, initializing longitudinal doc for', patientId);
        this.gatherChartData();
        await this.initializeLongitudinalDocument(patientId);
        // Re-render now that longitudinal data is fully loaded
        this.render();
    },

    /**
     * Reset session state to fresh defaults.
     * Called on init to prevent stale data from previous sessions.
     * The longitudinal doc is preserved separately.
     */
    resetSessionState() {
        this.state = {
            status: 'ready',
            lastUpdated: null,
            dictation: '',
            dictationHistory: [],
            summary: '',
            thinking: '',
            suggestedActions: [],
            keyConsiderations: [],
            reviewed: [],
            observations: [],
            flags: [],
            tasks: [],
            openItems: [],
            context: '',
            aiResponse: null,
            conversationThread: [], // Session-only inline messages
            chartData: {
                patientInfo: null,
                vitals: [],
                labs: [],
                meds: [],
                imaging: [],
                nursingNotes: [],
                previousNotes: []
            }
        };
        // Clear stale localStorage state
        localStorage.removeItem('aiAssistantState');
    },

    /**
     * Initialize the longitudinal clinical document for the current patient
     */
    async initializeLongitudinalDocument(patientId = null) {
        try {
            // Get patient ID from dataLoader or default
            const pid = patientId || window.dataLoader?.currentPatientId || 'PAT001';
            console.log(`Initializing longitudinal document for patient ${pid}...`);

            // Try to load from localStorage first
            const savedDoc = this.loadLongitudinalDoc(pid);
            if (savedDoc) {
                console.log('Loaded longitudinal document from localStorage');
                this.longitudinalDoc = savedDoc;

                // Create builder for incremental updates
                this.longitudinalDocBuilder = new LongitudinalDocumentBuilder(window.dataLoader);

                // Do an incremental update to pick up any new data since last save
                await this.longitudinalDocBuilder.updateSince(
                    this.longitudinalDoc,
                    this.longitudinalDoc.metadata.lastLoadedTimestamp
                );
                console.log('Incremental update complete');
            } else {
                // No saved document - build from scratch
                console.log('No saved document found, building full document...');
                this.longitudinalDocBuilder = new LongitudinalDocumentBuilder(window.dataLoader);
                this.longitudinalDoc = await this.longitudinalDocBuilder.buildFull(pid);
            }

            // Create updater for real-time updates
            this.longitudinalDocUpdater = new LongitudinalDocumentUpdater(this.longitudinalDoc);

            // Create renderer
            this.longitudinalDocRenderer = new LongitudinalDocumentRenderer({
                format: 'detailed',
                includeNarrative: true,
                includeLabTrends: true
            });

            // Sync any existing session state to the document
            this.syncSessionStateToDocument();

            // Initialize Memory System (4-layer architecture)
            this.sessionContext = new SessionContext();
            this.workingMemory = new WorkingMemoryAssembler(
                this.longitudinalDoc,
                this.sessionContext,
                this.longitudinalDocRenderer
            );
            this.contextAssembler = new ContextAssembler(this.workingMemory);
            console.log('Memory system initialized (SessionContext + WorkingMemory + ContextAssembler)');

            // === MEMORY HYDRATION: Populate panel state from persisted AI memory ===
            this.hydrateFromMemory();

            // Save the initialized document
            this.saveLongitudinalDoc();

            console.log('Longitudinal document initialized successfully');
            console.log(`  - Problems: ${this.longitudinalDoc.problemMatrix.size}`);
            console.log(`  - Lab trends: ${this.longitudinalDoc.longitudinalData.labs.size}`);
            console.log(`  - Vitals: ${this.longitudinalDoc.longitudinalData.vitals.length}`);
            console.log(`  - Narrative trajectory: ${this.longitudinalDoc.clinicalNarrative.trajectoryAssessment ? 'YES' : 'empty'}`);
            console.log(`  - Key findings: ${this.longitudinalDoc.clinicalNarrative.keyFindings.length}`);
            console.log(`  - AI Memory: ${this.longitudinalDoc.aiMemory.patientSummary ? 'HAS SUMMARY' : 'empty'}`);
            console.log(`  - Problem Insights: ${this.longitudinalDoc.aiMemory.problemInsights.size}`);

        } catch (error) {
            console.error('Failed to initialize longitudinal document:', error);
            // Fall back to legacy context
            this.useLongitudinalContext = false;
        }
    },

    /**
     * Save longitudinal document to localStorage
     */
    saveLongitudinalDoc() {
        if (!this.longitudinalDoc) return;

        try {
            const patientId = this.longitudinalDoc.metadata.patientId;
            const key = `longitudinalDoc_${patientId}`;
            const serialized = this.longitudinalDoc.serialize();
            const json = JSON.stringify(serialized);
            localStorage.setItem(key, json);
            console.log(`Saved longitudinal document (${(json.length / 1024).toFixed(1)}KB)`);
        } catch (error) {
            console.warn('Failed to save longitudinal document:', error.message);
            // localStorage might be full - try to clear old data
            if (error.name === 'QuotaExceededError') {
                console.warn('localStorage quota exceeded, clearing old longitudinal docs');
                this.clearOldLongitudinalDocs();
            }
        }
    },

    /**
     * Load longitudinal document from localStorage
     */
    loadLongitudinalDoc(patientId) {
        try {
            const key = `longitudinalDoc_${patientId}`;
            const json = localStorage.getItem(key);
            if (!json) return null;

            const data = JSON.parse(json);
            const doc = LongitudinalClinicalDocument.deserialize(data);

            if (doc) {
                console.log(`Loaded longitudinal document from localStorage (${(json.length / 1024).toFixed(1)}KB)`);
                console.log(`  - Last updated: ${doc.metadata.lastUpdated}`);
                console.log(`  - Narrative trajectory: ${doc.clinicalNarrative.trajectoryAssessment ? 'YES' : 'empty'}`);
                console.log(`  - Key findings: ${doc.clinicalNarrative.keyFindings.length}`);
                console.log(`  - Doctor dictations: ${doc.sessionContext.doctorDictation.length}`);
            }

            return doc;
        } catch (error) {
            console.warn('Failed to load longitudinal document:', error.message);
            return null;
        }
    },

    /**
     * Clear old longitudinal docs if localStorage is full
     */
    clearOldLongitudinalDocs() {
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key.startsWith('longitudinalDoc_')) {
                keysToRemove.push(key);
            }
        }
        keysToRemove.forEach(key => localStorage.removeItem(key));
    },

    /**
     * Sync current AI session state to the longitudinal document
     */
    syncSessionStateToDocument() {
        if (!this.longitudinalDocUpdater) return;

        // Sync from current state
        this.longitudinalDocUpdater.syncFromAIState(this.state);
    },

    /**
     * Hydrate panel state from persisted AI memory.
     * Called on init so the panel has content immediately, no LLM call needed.
     */
    hydrateFromMemory() {
        if (!this.longitudinalDoc) return;

        const mem = this.longitudinalDoc.aiMemory;
        const narrative = this.longitudinalDoc.clinicalNarrative;

        // Hydrate summary from AI memory
        if (mem.patientSummary && !this.state.summary) {
            this.state.summary = mem.patientSummary;
        }

        // Hydrate trajectory from clinical narrative
        if (narrative.trajectoryAssessment && !this.state.thinking) {
            this.state.thinking = narrative.trajectoryAssessment;
        }

        // Hydrate open questions as info-level key considerations
        if (narrative.openQuestions && narrative.openQuestions.length > 0 && this.state.keyConsiderations.length === 0) {
            this.state.keyConsiderations = narrative.openQuestions.map(q => ({
                text: q,
                severity: 'info'
            }));
        }

        if (mem.patientSummary || narrative.trajectoryAssessment) {
            console.log('🧠 Panel state hydrated from AI memory');
            this.render();
        }
    },

    /**
     * Write LLM insights back into the longitudinal document
     * This makes the document "learn" from each LLM interaction,
     * building a durable record that persists across sessions.
     */
    writeBackToDocument(llmResult) {
        if (!this.longitudinalDoc) return;

        const narrative = this.longitudinalDoc.clinicalNarrative;

        // Write trajectory assessment (cumulative - LLM refines each time)
        if (llmResult.trajectoryAssessment) {
            narrative.trajectoryAssessment = llmResult.trajectoryAssessment;
        }

        // Write key findings (merge, deduplicate)
        if (llmResult.keyFindings && Array.isArray(llmResult.keyFindings)) {
            const existingSet = new Set(narrative.keyFindings.map(f => f.toLowerCase().trim()));
            for (const finding of llmResult.keyFindings) {
                if (!existingSet.has(finding.toLowerCase().trim())) {
                    narrative.keyFindings.push(finding);
                    existingSet.add(finding.toLowerCase().trim());
                }
            }
            // Cap at 20 to prevent unbounded growth
            if (narrative.keyFindings.length > 20) {
                narrative.keyFindings = narrative.keyFindings.slice(-20);
            }
        }

        // Write open questions (replace - LLM provides current state)
        if (llmResult.openQuestions && Array.isArray(llmResult.openQuestions)) {
            narrative.openQuestions = llmResult.openQuestions;
        }

        // Update metadata timestamp
        this.longitudinalDoc.metadata.lastUpdated = new Date().toISOString();

        // Persist to localStorage
        this.saveLongitudinalDoc();

        console.log('📝 Write-back to longitudinal document:', {
            trajectory: !!llmResult.trajectoryAssessment,
            keyFindings: llmResult.keyFindings?.length || 0,
            openQuestions: llmResult.openQuestions?.length || 0
        });
    },

    /**
     * Write memory updates back to the AI Memory layer of the PKB.
     * Called after every LLM interaction to accumulate understanding.
     *
     * @param {Object} memUpdates - Parsed memory updates from ContextAssembler.parseMemoryUpdates()
     * @param {string} interactionType - 'ask', 'dictate', 'refresh', etc.
     * @param {string} inputSummary - Brief description of what triggered this interaction
     */
    writeBackMemoryUpdates(memUpdates, interactionType, inputSummary) {
        if (!this.longitudinalDoc) return;

        const mem = this.longitudinalDoc.aiMemory;

        // 1. Update patient summary (THE core memory)
        if (memUpdates.patientSummaryUpdate) {
            mem.patientSummary = memUpdates.patientSummaryUpdate;
            mem.version = (mem.version || 0) + 1;
            console.log('🧠 AI Memory: Patient summary updated (v' + mem.version + ')');
        }

        // 2. Update per-problem insights
        if (memUpdates.problemInsightUpdates && memUpdates.problemInsightUpdates.length > 0) {
            for (const update of memUpdates.problemInsightUpdates) {
                if (update.problemId && update.insight) {
                    mem.problemInsights.set(update.problemId, update.insight);
                }
            }
            console.log('🧠 AI Memory: Updated insights for', memUpdates.problemInsightUpdates.length, 'problems');
        }

        // 3. Log the interaction
        const digest = memUpdates.interactionDigest || `${interactionType}: ${(inputSummary || '').substring(0, 100)}`;
        mem.interactionLog.push({
            type: interactionType,
            summary: digest,
            timestamp: new Date().toISOString()
        });
        // Cap at 20 entries
        if (mem.interactionLog.length > 20) {
            mem.interactionLog = mem.interactionLog.slice(-20);
        }

        // 4. Update last full ingestion timestamp if this was a refresh
        if (interactionType === 'refresh') {
            mem.lastFullIngestion = new Date().toISOString();
        }

        // 5. Mark session context interaction
        if (this.sessionContext) {
            this.sessionContext.markAIInteraction();
        }

        // Persist
        this.saveLongitudinalDoc();

        console.log('🧠 AI Memory write-back complete:', {
            hasSummary: !!mem.patientSummary,
            problemInsights: mem.problemInsights.size,
            interactionLog: mem.interactionLog.length,
            version: mem.version
        });
    },

    /**
     * Create modals (no longer creates a floating panel - renders into AI panel tab)
     */
    createPanel() {
        // Create dictation modal
        this.createDictationModal();

        // Create note writing modal
        this.createNoteModal();
    },

    /**
     * Create the "Dictation" modal for doctor's thoughts
     */
    createDictationModal() {
        const modal = document.createElement('div');
        modal.id = 'ai-dictation-modal';
        modal.className = 'ai-modal';
        modal.innerHTML = `
            <div class="ai-modal-content dictation-modal">
                <div class="ai-modal-header">
                    <h3>🎤 Dictate Your Thoughts</h3>
                    <button onclick="AICoworker.closeDictationModal()">×</button>
                </div>
                <div class="ai-modal-body">
                    <p class="ai-modal-hint">Share your clinical reasoning. This will heavily influence the AI's understanding of your approach to this case.</p>
                    <div class="dictation-controls">
                        <button id="voice-record-btn" class="voice-btn" onclick="AICoworker.toggleVoiceRecording()">
                            <span class="voice-icon">🎙️</span>
                            <span class="voice-text">Start Recording</span>
                        </button>
                        <span class="dictation-or">or type below</span>
                    </div>
                    <textarea id="ai-dictation-input" rows="6" placeholder="e.g., I think this is a CHF exacerbation triggered by dietary indiscretion. Given his GI bleed history, I'm going to hold off on anticoagulation even though he has A-fib. Plan is diuresis and cardiology consult..."></textarea>
                    <div class="dictation-history-toggle">
                        <button onclick="AICoworker.toggleDictationHistory()" class="text-btn">
                            📜 View previous thoughts (<span id="dictation-count">0</span>)
                        </button>
                    </div>
                    <div id="dictation-history" class="dictation-history hidden"></div>
                </div>
                <div class="ai-modal-footer">
                    <button class="btn btn-secondary" onclick="AICoworker.closeDictationModal()">Cancel</button>
                    <button class="btn btn-primary" onclick="AICoworker.submitDictation()">💾 Save Thoughts</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    },

    /**
     * Create the "Write Note" modal
     */
    createNoteModal() {
        const modal = document.createElement('div');
        modal.id = 'ai-note-modal';
        modal.className = 'ai-modal';
        modal.innerHTML = `
            <div class="ai-modal-content note-modal">
                <div class="ai-modal-header">
                    <h3>📝 Write Clinical Note</h3>
                    <button onclick="AICoworker.closeNoteModal()">×</button>
                </div>
                <div class="ai-modal-body">
                    <p class="ai-modal-hint">Select a note type. AI will draft it using chart data, your dictated thoughts, and observations.</p>

                    <div class="note-type-selector">
                        <label class="note-type-option">
                            <input type="radio" name="note-type" value="hp" checked>
                            <span class="note-type-card">
                                <span class="note-type-icon">📋</span>
                                <span class="note-type-name">H&P</span>
                                <span class="note-type-desc">History & Physical</span>
                            </span>
                        </label>
                        <label class="note-type-option">
                            <input type="radio" name="note-type" value="progress">
                            <span class="note-type-card">
                                <span class="note-type-icon">📊</span>
                                <span class="note-type-name">Progress</span>
                                <span class="note-type-desc">Daily Progress Note</span>
                            </span>
                        </label>
                        <label class="note-type-option">
                            <input type="radio" name="note-type" value="discharge">
                            <span class="note-type-card">
                                <span class="note-type-icon">🏠</span>
                                <span class="note-type-name">Discharge</span>
                                <span class="note-type-desc">Discharge Summary</span>
                            </span>
                        </label>
                        <label class="note-type-option">
                            <input type="radio" name="note-type" value="consult">
                            <span class="note-type-card">
                                <span class="note-type-icon">🔍</span>
                                <span class="note-type-name">Consult</span>
                                <span class="note-type-desc">Consultation Note</span>
                            </span>
                        </label>
                    </div>

                    <div class="note-data-sources">
                        <div class="data-sources-header">Data sources to include:</div>
                        <div class="data-source-checks">
                            <label><input type="checkbox" id="include-vitals" checked> Recent Vitals</label>
                            <label><input type="checkbox" id="include-labs" checked> Lab Results</label>
                            <label><input type="checkbox" id="include-meds" checked> Medications</label>
                            <label><input type="checkbox" id="include-imaging" checked> Imaging</label>
                            <label><input type="checkbox" id="include-nursing" checked> Nursing Notes</label>
                            <label><input type="checkbox" id="include-dictation" checked> My Dictated Thoughts</label>
                            <label><input type="checkbox" id="include-previous" checked> Previous Notes</label>
                        </div>
                    </div>

                    <div class="note-additional">
                        <label>Additional instructions (optional):</label>
                        <textarea id="note-instructions" rows="2" placeholder="e.g., Focus on the anticoagulation decision, keep it brief..."></textarea>
                    </div>
                </div>
                <div class="ai-modal-footer">
                    <button class="btn btn-secondary" onclick="AICoworker.closeNoteModal()">Cancel</button>
                    <button class="btn btn-primary" onclick="AICoworker.generateNote()">✨ Generate Draft</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    },

    /**
     * Setup event listeners
     */
    setupEventListeners() {
        // Listen for keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closeDictationModal();
                this.closeNoteModal();
                this.closeNoteEditor();
            }
        });

        // Listen for page navigation to gather context and update nudge
        window.addEventListener('hashchange', () => this.onPageChange());
        window.addEventListener('popstate', () => this.onPageChange());
    },

    /**
     * Handle page navigation - update context and nudge
     */
    onPageChange() {
        const page = window.location.hash || window.location.pathname;
        const pageName = this.getPageName(page);
        if (pageName) {
            this.markReviewed('Viewed: ' + pageName);

            // Track in session context for memory system
            if (this.sessionContext) {
                this.sessionContext.trackNavigation(page, pageName);
            }

            // Update contextual nudge in-place
            const nudgeEl = document.querySelector('.nudge-section');
            if (nudgeEl) {
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = this.renderContextualNudge();
                const newNudge = tempDiv.firstElementChild;
                if (newNudge) {
                    nudgeEl.replaceWith(newNudge);
                }
            }
        }
    },

    getPageName(page) {
        const pageNames = {
            'chart-review': 'Chart Review',
            'chart': 'Chart Review',
            'labs': 'Labs',
            'vitals': 'Vitals',
            'medications': 'Medications',
            'meds': 'Medications',
            'orders': 'Orders',
            'notes': 'Notes',
            'imaging': 'Imaging',
            'results': 'Labs',
            'problems': 'Problem List',
            'allergies': 'Allergies',
            'social-history': 'Social History',
            'family-history': 'Family History',
            'immunizations': 'Immunizations',
            'encounters': 'Encounters',
            'procedures': 'Procedures'
        };
        for (const [key, name] of Object.entries(pageNames)) {
            if (page.toLowerCase().includes(key)) return name;
        }
        return null;
    },

    /**
     * Handle external messages (postMessage API)
     */
    handleExternalMessage(event) {
        if (event.data && event.data.type === 'aiAssistantUpdate') {
            this.update(event.data.payload);
        }
    },

    /**
     * Save state to localStorage (session-only persistence)
     */
    saveState() {
        this.state.lastUpdated = new Date().toISOString();
        // We still save to localStorage for within-session persistence
        // but resetSessionState() clears it on next page load
        localStorage.setItem('aiAssistantState', JSON.stringify(this.state));
    },

    /**
     * Update the AI Assistant state
     */
    update(newState) {
        this.state = { ...this.state, ...newState };
        this.state.lastUpdated = new Date().toISOString();
        this.saveState();
        this.render();
    },

    /**
     * Render the panel content into the AI panel assistant tab
     */
    render() {
        const body = document.getElementById('assistant-tab-body');
        if (!body) return;

        let html = '';

        // ===== SECTION 1: SAFETY BAR (sticky top, only when alerts exist) =====
        html += this.renderAlertBar();

        // ===== SECTION 2: PATIENT BRIEF =====
        html += this.renderPatientBrief();

        // ===== SECTION 3: AI INSIGHT (the core section) =====
        html += this.renderAIInsight();

        // ===== SECTION 4: CONTEXTUAL NUDGE =====
        html += this.renderContextualNudge();

        // ===== SECTION 5: INLINE INPUT (sticky bottom) =====
        html += this.renderInlineInput();

        body.innerHTML = html;

        // Auto-resize inline textarea
        const textarea = document.getElementById('copilot-inline-input');
        if (textarea) {
            textarea.addEventListener('input', () => this._autoResizeTextarea(textarea));
        }
    },

    // ==================== Copilot Section Renderers ====================

    renderAlertBar() {
        const alerts = [];
        const seen = new Set();

        // Safety flags from state
        if (this.state.flags && this.state.flags.length > 0) {
            this.state.flags.slice(0, 3).forEach(f => {
                if (!seen.has(f.text)) {
                    alerts.push({ text: f.text, severity: f.severity || 'warning' });
                    seen.add(f.text);
                }
            });
        }

        if (this.longitudinalDoc) {
            // Critical vitals from chart
            const chartVitals = this.longitudinalDoc.longitudinalData.vitals;
            if (chartVitals && chartVitals.length > 0) {
                const v = chartVitals[0];
                if (v.spO2 && v.spO2 < 88) alerts.push({ text: `Critical: SpO2 ${v.spO2}%`, severity: 'critical' });
                if (v.systolic && v.systolic < 85) alerts.push({ text: `Critical: SBP ${v.systolic}`, severity: 'critical' });
                if (v.heartRate && v.heartRate > 150) alerts.push({ text: `Critical: HR ${v.heartRate}`, severity: 'critical' });
            }

            // Critical lab values from PKB
            for (const [name, trend] of this.longitudinalDoc.longitudinalData.labs) {
                if (trend.latestValue && trend.latestValue.flag === 'CRITICAL') {
                    const text = `Critical lab: ${name} ${trend.latestValue.value} ${trend.latestValue.unit || ''}`;
                    if (!seen.has(text)) {
                        alerts.push({ text, severity: 'critical' });
                        seen.add(text);
                    }
                }
            }
        }

        if (alerts.length === 0) return '';

        let html = '<div class="copilot-alert-bar">';
        alerts.forEach((alert, i) => {
            html += `<div class="copilot-alert ${alert.severity}">`;
            html += `<span class="alert-icon">&#9888;</span>`;
            html += `<span class="alert-text">${this.escapeHtml(alert.text)}</span>`;
            html += `<button class="alert-dismiss" onclick="AICoworker.dismissFlag(${i})" title="Acknowledge">&#10003;</button>`;
            html += '</div>';
        });
        html += '</div>';
        return html;
    },

    renderPatientBrief() {
        // Get patient info
        let patientName = 'Patient';
        let patientAge = '';
        if (typeof PatientHeader !== 'undefined' && PatientHeader.currentPatient) {
            const p = PatientHeader.currentPatient;
            patientName = `${p.firstName || ''} ${p.lastName || ''}`.trim() || 'Patient';
            // Compute age from DOB
            let age = p.age;
            if (!age && p.dateOfBirth) {
                const dob = new Date(p.dateOfBirth);
                const today = new Date();
                age = today.getFullYear() - dob.getFullYear();
                const m = today.getMonth() - dob.getMonth();
                if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
            }
            const sex = (p.sex || p.gender || '').charAt(0).toUpperCase(); // M or F
            patientAge = age ? `${age}${sex}` : '';
        }

        // AI's one-line summary
        let summaryLine = '';
        if (this.longitudinalDoc && this.longitudinalDoc.aiMemory.patientSummary) {
            // First sentence of the AI's summary
            const full = this.longitudinalDoc.aiMemory.patientSummary;
            const firstSentence = full.split(/\.\s/)[0];
            summaryLine = `<div class="brief-summary">${this.formatText(firstSentence + (firstSentence.endsWith('.') ? '' : '.'))}</div>`;
        } else if (this.state.summary) {
            summaryLine = `<div class="brief-summary">${this.formatText(this.state.summary)}</div>`;
        } else {
            summaryLine = '<div class="brief-summary brief-placeholder">Analyze chart to build understanding</div>';
        }

        // Active problem chips
        let problemsHtml = '';
        if (this.longitudinalDoc && this.longitudinalDoc.problemMatrix.size > 0) {
            const problems = [];
            for (const [id, timeline] of this.longitudinalDoc.problemMatrix) {
                const prob = timeline.problem || timeline;
                if (prob.status === 'active' || !prob.status) {
                    problems.push(prob.name || id);
                }
            }
            if (problems.length > 0) {
                problemsHtml = '<div class="brief-problems">';
                problems.slice(0, 6).forEach(name => {
                    problemsHtml += `<span class="problem-chip">${this.escapeHtml(name)}</span>`;
                });
                if (problems.length > 6) {
                    problemsHtml += `<span class="problem-chip problem-more">+${problems.length - 6} more</span>`;
                }
                problemsHtml += '</div>';
            }
        }

        // Key allergy (most critical, one-line)
        let allergyLine = '';
        // Try longitudinal doc first, then PatientHeader
        let allergies = this.longitudinalDoc?.patientSnapshot?.allergies || [];
        if (allergies.length === 0 && typeof PatientHeader !== 'undefined' && PatientHeader.currentPatient?.allergies) {
            allergies = PatientHeader.currentPatient.allergies;
        }
        if (allergies.length > 0) {
            const names = allergies.slice(0, 3).map(a => typeof a === 'string' ? a : (a.substance || a.allergen || a.name || '?'));
            allergyLine = `<div class="brief-allergy">&#9888; ${names.join(', ')}${allergies.length > 3 ? ` +${allergies.length - 3}` : ''}</div>`;
        }

        let html = '<div class="copilot-brief">';
        html += '<div class="brief-header">';
        html += `<span class="brief-patient">${this.escapeHtml(patientName)}${patientAge ? ', ' + patientAge : ''}</span>`;
        html += '</div>';
        html += summaryLine;
        html += problemsHtml;
        html += allergyLine;
        html += '</div>';
        return html;
    },

    /**
     * Render the AI Insight section — the core cognitive aid.
     * Shows the AI's accumulated understanding, or a prompt to analyze the chart.
     */
    renderAIInsight() {
        const hasMemory = this.longitudinalDoc &&
            (this.longitudinalDoc.aiMemory.patientSummary || this.state.summary);
        const isThinking = this.state.status === 'thinking';

        let html = '<div class="copilot-section insight-section">';
        html += '<div class="copilot-section-header">';
        html += '<span>&#129504;</span> AI Insight';
        html += '<div class="section-actions">';
        html += '<button class="section-action-btn" onclick="AICoworker.refreshThinking()" title="Refresh analysis">&#128260;</button>';
        html += '</div></div>';
        html += '<div class="copilot-section-body">';

        if (isThinking) {
            html += '<div class="insight-loading"><div class="typing-indicator"><span></span><span></span><span></span></div> Analyzing...</div>';
        } else if (!hasMemory) {
            // Mode B: No memory — prompt to analyze
            html += this._renderAnalyzePrompt();
        } else {
            // Mode A: Memory exists — show understanding
            html += this._renderInsightContent();
        }

        // Conversation thread (always show if messages exist)
        if (this.state.conversationThread && this.state.conversationThread.length > 0) {
            html += this._renderConversationThread();
        }

        html += '</div></div>';
        return html;
    },

    _renderAnalyzePrompt() {
        let stats = '';
        if (this.longitudinalDoc) {
            const problems = this.longitudinalDoc.problemMatrix.size;
            const meds = this.longitudinalDoc.longitudinalData.medications?.current?.length || 0;
            const labs = this.longitudinalDoc.longitudinalData.labs.size;
            stats = `This patient has ${problems} active problem${problems !== 1 ? 's' : ''}, ${meds} medication${meds !== 1 ? 's' : ''}, and ${labs} lab panel${labs !== 1 ? 's' : ''} on file.`;
        } else {
            stats = 'Patient data is loading...';
        }

        let html = '<div class="analyze-prompt">';
        html += `<div class="analyze-stats">${stats}</div>`;
        html += '<button class="analyze-btn" onclick="AICoworker.refreshThinking()">&#10024; Analyze Chart</button>';
        html += '<div class="analyze-hint">or ask a question below</div>';
        html += '</div>';
        return html;
    },

    _renderInsightContent() {
        let html = '';

        // Assessment
        const summary = this.state.summary || (this.longitudinalDoc && this.longitudinalDoc.aiMemory.patientSummary) || '';
        if (summary) {
            html += '<div class="insight-block">';
            html += '<div class="insight-label">ASSESSMENT</div>';
            html += '<div class="insight-text">' + this.formatText(summary) + '</div>';
            html += '</div>';
        }

        // Key Considerations
        if (this.state.keyConsiderations && this.state.keyConsiderations.length > 0) {
            html += '<div class="insight-block">';
            html += '<div class="insight-label">KEY CONSIDERATIONS</div>';
            html += '<div class="insight-considerations">';
            this.state.keyConsiderations.forEach(c => {
                const icon = c.severity === 'critical' ? '&#9888;' : c.severity === 'important' ? '&#10071;' : '&#8226;';
                const cls = c.severity === 'critical' ? 'consideration-critical' : c.severity === 'important' ? 'consideration-important' : '';
                html += `<div class="consideration ${cls}">${icon} ${this.escapeHtml(c.text)}</div>`;
            });
            html += '</div></div>';
        }

        // Trajectory
        const trajectory = this.state.thinking ||
            (this.longitudinalDoc && this.longitudinalDoc.clinicalNarrative.trajectoryAssessment) || '';
        if (trajectory) {
            html += '<div class="insight-block">';
            html += '<div class="insight-label">TRAJECTORY</div>';
            html += '<div class="insight-text">' + this.formatText(trajectory) + '</div>';
            html += '</div>';
        }

        // Open Questions
        const openQs = (this.longitudinalDoc && this.longitudinalDoc.clinicalNarrative.openQuestions) || [];
        if (openQs.length > 0) {
            html += '<div class="insight-block">';
            html += '<div class="insight-label">OPEN QUESTIONS</div>';
            html += '<div class="insight-questions">';
            openQs.forEach(q => {
                html += `<div class="open-question">&#9679; ${this.escapeHtml(q)}</div>`;
            });
            html += '</div></div>';
        }

        // Doctor's dictation (if present)
        if (this.state.dictation) {
            html += '<div class="insight-block dictation-block">';
            html += '<div class="insight-label">&#127897; YOUR THINKING</div>';
            html += '<div class="insight-text dictation-text">' + this.formatText(this.state.dictation) + '</div>';
            html += '</div>';
        }

        return html;
    },

    _renderConversationThread() {
        let html = '<div class="conversation-thread">';
        html += '<div class="thread-divider"><span>Conversation</span></div>';

        this.state.conversationThread.slice(-10).forEach(msg => {
            const cls = msg.role === 'user' ? 'thread-msg-user' : 'thread-msg-ai';
            const label = msg.role === 'user' ? (msg.type === 'think' ? '&#127897; You' : '&#128100; You') : '&#10024; AI';
            html += `<div class="thread-msg ${cls}">`;
            html += `<div class="thread-msg-label">${label}</div>`;
            html += `<div class="thread-msg-text">${msg.role === 'ai' ? this.formatText(msg.text) : this.escapeHtml(msg.text)}</div>`;
            html += '</div>';
        });

        html += '</div>';
        return html;
    },

    // renderClinicalReasoning removed — replaced by renderAIInsight()

    /**
     * Render contextual nudge — navigation-reactive hints from local data (no LLM).
     * Shows relevant data summary for the current chart section.
     */
    renderContextualNudge() {
        const page = window.location.hash || '';
        const section = this.getPageName(page) || 'Chart Review';
        const doc = this.longitudinalDoc;

        let nudgeContent = '';

        if (doc) {
            switch (section) {
                case 'Labs': {
                    let abnormalCount = 0;
                    let criticals = [];
                    for (const [name, trend] of doc.longitudinalData.labs) {
                        if (trend.latestValue) {
                            if (trend.latestValue.flag === 'CRITICAL') {
                                criticals.push(`${name}: ${trend.latestValue.value}`);
                            }
                            if (trend.latestValue.flag === 'HIGH' || trend.latestValue.flag === 'LOW' || trend.latestValue.flag === 'CRITICAL') {
                                abnormalCount++;
                            }
                        }
                    }
                    if (criticals.length > 0) {
                        nudgeContent = `<span class="nudge-icon">&#9888;</span> ${criticals.length} critical value${criticals.length !== 1 ? 's' : ''}: ${criticals.slice(0, 3).join(', ')}`;
                    } else if (abnormalCount > 0) {
                        nudgeContent = `<span class="nudge-icon">&#128300;</span> ${abnormalCount} abnormal lab${abnormalCount !== 1 ? 's' : ''} — review flagged values`;
                    } else {
                        nudgeContent = `<span class="nudge-icon">&#9989;</span> All labs within normal limits`;
                    }
                    break;
                }
                case 'Medications': {
                    const meds = doc.longitudinalData.medications?.current || [];
                    const highAlert = meds.filter(m => {
                        const n = (m.name || '').toLowerCase();
                        return n.includes('warfarin') || n.includes('heparin') || n.includes('insulin') || n.includes('digoxin') || n.includes('amiodarone') || n.includes('opioid') || n.includes('methotrexate');
                    });
                    nudgeContent = `<span class="nudge-icon">&#128138;</span> ${meds.length} active medication${meds.length !== 1 ? 's' : ''}`;
                    if (highAlert.length > 0) {
                        nudgeContent += ` &mdash; ${highAlert.length} high-alert: ${highAlert.map(m => m.name).join(', ')}`;
                    }
                    break;
                }
                case 'Notes': {
                    const notes = doc.longitudinalData.notes || [];
                    if (notes.length > 0) {
                        const latest = notes[0];
                        nudgeContent = `<span class="nudge-icon">&#128196;</span> ${notes.length} note${notes.length !== 1 ? 's' : ''} on file &mdash; latest: ${latest.type || 'Note'} (${latest.date || 'recent'})`;
                    } else {
                        nudgeContent = `<span class="nudge-icon">&#128196;</span> No notes on file`;
                    }
                    break;
                }
                case 'Problem List': {
                    let active = 0, resolved = 0;
                    for (const [, timeline] of doc.problemMatrix) {
                        const prob = timeline.problem || timeline;
                        if (prob.status === 'resolved') resolved++;
                        else active++;
                    }
                    nudgeContent = `<span class="nudge-icon">&#9733;</span> ${active} active, ${resolved} resolved problem${active + resolved !== 1 ? 's' : ''}`;
                    break;
                }
                case 'Vitals': {
                    const vitals = doc.longitudinalData.vitals;
                    if (vitals && vitals.length > 0) {
                        const v = vitals[0];
                        let concerns = [];
                        if (v.heartRate && (v.heartRate > 100 || v.heartRate < 60)) concerns.push(`HR ${v.heartRate}`);
                        if (v.systolic && v.systolic < 90) concerns.push(`SBP ${v.systolic}`);
                        if (v.spO2 && v.spO2 < 94) concerns.push(`SpO2 ${v.spO2}%`);
                        if (concerns.length > 0) {
                            nudgeContent = `<span class="nudge-icon">&#9888;</span> Concerning: ${concerns.join(', ')}`;
                        } else {
                            nudgeContent = `<span class="nudge-icon">&#10084;</span> Latest vitals within normal range`;
                        }
                    } else {
                        nudgeContent = `<span class="nudge-icon">&#10084;</span> No vitals recorded`;
                    }
                    break;
                }
                case 'Allergies': {
                    const allergies = doc.patientSnapshot.allergies || [];
                    const meds = doc.longitudinalData.medications?.current || [];
                    nudgeContent = `<span class="nudge-icon">&#9888;</span> ${allergies.length} known allerg${allergies.length !== 1 ? 'ies' : 'y'}`;
                    if (allergies.length > 0 && meds.length > 0) {
                        nudgeContent += ' &mdash; cross-reference with active medications';
                    }
                    break;
                }
                default: {
                    // Default: show suggested actions if any
                    if (this.state.suggestedActions && this.state.suggestedActions.length > 0) {
                        const actions = this.state.suggestedActions.slice(0, 3);
                        nudgeContent = '<div class="nudge-actions">';
                        actions.forEach((a, i) => {
                            const text = typeof a === 'string' ? a : a.text;
                            nudgeContent += `<div class="nudge-action-item" onclick="AICoworker.executeAction(${i})">&#8226; ${this.escapeHtml(text)}</div>`;
                        });
                        nudgeContent += '</div>';
                    }
                    break;
                }
            }
        }

        if (!nudgeContent) return '';

        let html = '<div class="copilot-section nudge-section">';
        html += `<div class="nudge-content">${nudgeContent}</div>`;
        html += '</div>';
        return html;
    },

    /**
     * Render the inline input section — persistent textarea at the bottom of the panel.
     * Replaces both Ask Modal and Quick Actions bar.
     */
    renderInlineInput() {
        let html = '<div class="copilot-inline-input">';

        // Suggestion chips
        html += '<div class="inline-chips">';
        html += '<button class="suggestion-chip" onclick="AICoworker.handleChip(\'Summarize case\')">Summarize</button>';
        html += '<button class="suggestion-chip" onclick="AICoworker.handleChip(\'What are the key concerns?\')">Concerns?</button>';
        html += '<button class="suggestion-chip" onclick="AICoworker.handleChip(\'What haven\\\'t I checked yet?\')">Missing?</button>';
        html += '</div>';

        // Input row
        html += '<div class="inline-input-row">';
        html += '<textarea id="copilot-inline-input" class="inline-textarea" rows="1" placeholder="Ask a question or share your thinking..." onkeydown="AICoworker.handleInputKeydown(event)"></textarea>';
        html += '<button class="inline-send-btn" onclick="AICoworker.handleInlineSubmit()" title="Send">&#9654;</button>';
        html += '</div>';

        // Action buttons
        html += '<div class="inline-action-bar">';
        html += '<button class="inline-action-btn" onclick="AICoworker.openDictationModal()" title="Voice dictation"><span>&#127897;</span> Voice</button>';
        html += '<button class="inline-action-btn" onclick="AICoworker.openNoteModal()" title="Write clinical note"><span>&#128221;</span> Write Note</button>';
        html += '<button class="inline-action-btn inline-more-btn" onclick="AICoworker.toggleMoreMenu()" title="More actions"><span>&#8943;</span> More</button>';
        html += '<div class="inline-more-menu" id="inline-more-menu">';
        html += '<button onclick="AICoworker.refreshThinking()">&#128260; Refresh Analysis</button>';
        html += '<button onclick="AICoworker.openDebugPanel()">&#128269; Debug Prompts</button>';
        html += '<button onclick="AICoworker.clearMemory()">&#128465; Clear Memory</button>';
        html += '</div>';
        html += '</div>';

        html += '</div>';
        return html;
    },

    /**
     * Handle inline input submission with smart routing.
     * Questions → askClaudeAbout(), clinical thinking → synthesizeWithLLM()
     */
    handleInlineSubmit() {
        const textarea = document.getElementById('copilot-inline-input');
        if (!textarea) return;
        const text = textarea.value.trim();
        if (!text) return;

        textarea.value = '';
        this._autoResizeTextarea(textarea);

        // Smart routing: detect question vs. clinical thinking
        const isQuestion = /\?$/.test(text) ||
            /^(what|why|how|when|where|who|which|is|are|does|do|can|could|should|would|will|tell|explain|describe|summarize|list|compare)/i.test(text);

        if (isQuestion) {
            this._pushToThread('user', 'ask', text);
            this.askClaudeAbout(text);
        } else {
            this._pushToThread('user', 'think', text);
            // Save as dictation and synthesize
            if (this.state.dictation) {
                if (!this.state.dictationHistory) this.state.dictationHistory = [];
                this.state.dictationHistory.push({
                    text: this.state.dictation,
                    timestamp: this.state.lastUpdated || new Date().toISOString()
                });
                if (this.state.dictationHistory.length > 10) {
                    this.state.dictationHistory = this.state.dictationHistory.slice(-10);
                }
            }
            this.state.dictation = text;
            this.saveState();
            this.render();
            this.onDictationUpdated(text);
        }
    },

    /**
     * Handle suggestion chip click
     */
    handleChip(text) {
        this._pushToThread('user', 'ask', text);
        this.askClaudeAbout(text);
    },

    /**
     * Handle keyboard events in inline input
     */
    handleInputKeydown(event) {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            this.handleInlineSubmit();
        }
    },

    /**
     * Push a message to the session conversation thread
     */
    _pushToThread(role, type, text) {
        if (!this.state.conversationThread) this.state.conversationThread = [];
        this.state.conversationThread.push({
            role,
            type,
            text,
            timestamp: new Date().toISOString()
        });
        // Keep last 10 messages
        if (this.state.conversationThread.length > 10) {
            this.state.conversationThread = this.state.conversationThread.slice(-10);
        }
    },

    /**
     * Toggle the "More" dropdown menu
     */
    toggleMoreMenu() {
        const menu = document.getElementById('inline-more-menu');
        if (menu) {
            menu.classList.toggle('visible');
            // Auto-close on click outside
            if (menu.classList.contains('visible')) {
                const closeHandler = (e) => {
                    if (!menu.contains(e.target) && !e.target.classList.contains('inline-more-btn')) {
                        menu.classList.remove('visible');
                        document.removeEventListener('click', closeHandler);
                    }
                };
                setTimeout(() => document.addEventListener('click', closeHandler), 0);
            }
        }
    },

    /**
     * Clear AI memory for this patient
     */
    clearMemory() {
        if (!confirm('Clear AI memory for this patient? The AI will forget its analysis.')) return;
        if (this.longitudinalDoc) {
            this.longitudinalDoc.aiMemory.patientSummary = '';
            this.longitudinalDoc.aiMemory.problemInsights = new Map();
            this.longitudinalDoc.aiMemory.interactionLog = [];
            this.longitudinalDoc.aiMemory.version = 0;
            this.longitudinalDoc.clinicalNarrative.trajectoryAssessment = '';
            this.longitudinalDoc.clinicalNarrative.keyFindings = [];
            this.longitudinalDoc.clinicalNarrative.openQuestions = [];
            this.saveLongitudinalDoc();
        }
        this.resetSessionState();
        this.render();
        App.showToast('AI memory cleared', 'success');
    },

    /**
     * Auto-resize textarea to fit content
     */
    _autoResizeTextarea(textarea) {
        textarea.style.height = 'auto';
        textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
    },

    // ==================== User Actions ====================

    /**
     * Toggle a task
     */
    toggleTask(index) {
        if (this.state.tasks && this.state.tasks[index]) {
            this.state.tasks[index].done = !this.state.tasks[index].done;
            this.saveState();
            this.render();
        }
    },

    /**
     * Remove a task
     */
    removeTask(index) {
        if (this.state.tasks) {
            this.state.tasks.splice(index, 1);
            this.saveState();
            this.render();
        }
    },

    /**
     * Dismiss a safety flag (acknowledge)
     */
    dismissFlag(index) {
        if (this.state.flags) {
            this.state.flags.splice(index, 1);
            this.saveState();
            this.render();
        }
    },

    /**
     * Dismiss an observation
     */
    dismissObservation(index) {
        if (this.state.observations) {
            this.state.observations.splice(index, 1);
            this.saveState();
            this.render();
        }
    },

    /**
     * Execute a suggested action via Claude extension
     */
    executeAction(index) {
        if (this.state.suggestedActions && this.state.suggestedActions[index]) {
            const action = this.state.suggestedActions[index];
            const actionText = typeof action === 'string' ? action : action.text;

            // Trigger Claude to help execute this action
            this.askClaudeAbout('Please help me: ' + actionText);

            // Optionally move to tasks
            if (!this.state.tasks) this.state.tasks = [];
            this.state.tasks.push({ text: actionText, done: false, fromSuggestion: true });

            // Remove from suggestions
            this.state.suggestedActions.splice(index, 1);
            this.saveState();
            this.render();
        }
    },

    /**
     * Dismiss a suggested action
     */
    dismissAction(index) {
        if (this.state.suggestedActions) {
            this.state.suggestedActions.splice(index, 1);
            this.saveState();
            this.render();
        }
    },

    /**
     * Mark an open item as addressed
     */
    markAddressed(index) {
        if (this.state.openItems) {
            const item = this.state.openItems[index];
            this.state.openItems.splice(index, 1);
            // Add to reviewed
            if (!this.state.reviewed) this.state.reviewed = [];
            this.state.reviewed.push(item);
            this.saveState();
            this.render();
        }
    },

    /**
     * Clear AI response
     */
    clearResponse() {
        this.state.aiResponse = null;
        this.saveState();
        this.render();
    },

    // showScoreSummary removed — simulation feature

    // ==================== Dictation ====================

    openDictationModal() {
        const modal = document.getElementById('ai-dictation-modal');
        if (modal) {
            modal.classList.add('visible');
            const input = document.getElementById('ai-dictation-input');
            if (input) {
                // Pre-fill with template on first use
                if (!this.state.dictation && this.state.dictationHistory.length === 0) {
                    input.value = 'Working diagnosis: \nTriggers/Causes: \nKey concerns: \nPlan: ';
                    input.setSelectionRange(20, 20); // Cursor after "Working diagnosis: "
                } else {
                    input.value = this.state.dictation || '';
                }
                input.focus();
            }
            this.updateDictationCount();
        }
    },

    closeDictationModal() {
        const modal = document.getElementById('ai-dictation-modal');
        if (modal) {
            modal.classList.remove('visible');
            this.stopVoiceRecording();
        }
    },

    updateDictationCount() {
        const countEl = document.getElementById('dictation-count');
        if (countEl && this.state.dictationHistory) {
            countEl.textContent = this.state.dictationHistory.length;
        }
    },

    toggleDictationHistory() {
        const historyEl = document.getElementById('dictation-history');
        if (historyEl) {
            historyEl.classList.toggle('hidden');
            if (!historyEl.classList.contains('hidden')) {
                this.renderDictationHistory();
            }
        }
    },

    renderDictationHistory() {
        const historyEl = document.getElementById('dictation-history');
        if (!historyEl || !this.state.dictationHistory) return;

        if (this.state.dictationHistory.length === 0) {
            historyEl.innerHTML = '<div class="no-history">No previous thoughts recorded</div>';
            return;
        }

        let html = '';
        this.state.dictationHistory.slice().reverse().forEach((entry, index) => {
            const time = new Date(entry.timestamp).toLocaleTimeString();
            html += '<div class="history-entry">';
            html += '<div class="history-time">' + time + '</div>';
            html += '<div class="history-text">' + this.escapeHtml(entry.text) + '</div>';
            html += '</div>';
        });
        historyEl.innerHTML = html;
    },

    submitDictation() {
        const input = document.getElementById('ai-dictation-input');
        const text = input.value.trim();
        if (!text) {
            App.showToast('Please enter your thoughts', 'warning');
            return;
        }

        // Save previous dictation to history
        if (this.state.dictation) {
            if (!this.state.dictationHistory) this.state.dictationHistory = [];
            this.state.dictationHistory.push({
                text: this.state.dictation,
                timestamp: this.state.lastUpdated || new Date().toISOString()
            });
            // Keep last 10 entries
            if (this.state.dictationHistory.length > 10) {
                this.state.dictationHistory = this.state.dictationHistory.slice(-10);
            }
        }

        // Update current dictation
        this.state.dictation = text;
        this.saveState();
        this.render();
        this.closeDictationModal();
        App.showToast('Thoughts saved', 'success');

        // Trigger AI to update its thinking based on dictation
        this.onDictationUpdated(text);
    },

    /**
     * Called when doctor updates their dictation - AI should respond
     * This synthesizes the doctor's thoughts with AI's understanding
     */
    onDictationUpdated(text) {
        console.log('🩺 onDictationUpdated called with:', text.substring(0, 100) + '...');

        // Show thinking status
        this.state.status = 'thinking';
        this.render();

        // Build prompt for Claude to synthesize thinking (for external tools)
        const synthesisPrompt = this.buildThinkingSynthesisPrompt(text);

        // Method 1: Use Claude extension if available (broadcast)
        this.requestThinkingUpdate(synthesisPrompt);

        // Method 2: Broadcast for external tools
        window.postMessage({
            type: 'DOCTOR_DICTATION_UPDATED',
            dictation: text,
            synthesisPrompt: synthesisPrompt,
            fullContext: this.buildFullContext()
        }, '*');

        // Method 3: Use LLM API for intelligent synthesis (PRIMARY METHOD)
        // Falls back to local synthesis if API not configured
        console.log('🚀 Calling synthesizeWithLLM...');
        this.synthesizeWithLLM(text);
    },

    /**
     * Build a prompt for Claude to synthesize doctor's thoughts with AI understanding
     * Now updates Summary, Thinking, AND Suggested Actions
     */
    buildThinkingSynthesisPrompt(doctorThoughts) {
        let prompt = `You are an AI clinical assistant. The doctor has just shared their clinical reasoning about this case.
Please update ALL of the following based on their input:
1. Case Summary
2. Current Thinking
3. Suggested Actions

## Doctor's New Thoughts:
"${doctorThoughts}"

## Previous Case Summary:
${this.state.summary || 'No summary available.'}

## Previous AI Thinking:
${this.state.thinking || 'No previous thinking recorded.'}

## Safety Flags:
${this.state.flags && this.state.flags.length > 0
    ? this.state.flags.map(f => '- ⚠️ ' + f.text).join('\n')
    : 'None'}

## Key Observations:
${this.state.observations && this.state.observations.length > 0
    ? this.state.observations.map(o => '- ' + o).join('\n')
    : 'None'}

## Open Items (Not Yet Addressed):
${this.state.openItems && this.state.openItems.length > 0
    ? this.state.openItems.map(o => '○ ' + o).join('\n')
    : 'None'}

---

Based on the doctor's thoughts, provide UPDATED versions of all four:

1. **Summary** (1-2 sentences): Concise case summary reflecting the doctor's working diagnosis, triggers, and key decisions. Use **bold** for diagnosis and key decisions.

2. **Key Considerations** (2-5 items): Safety alerts, clinical concerns, and important context. Each has a severity level (critical for contraindications/allergies, important for significant concerns, info for contextual notes).

3. **Thinking** (2-4 sentences): Patient trajectory and clinical trajectory synthesis. Where is the patient heading? Is the situation improving, worsening, or stable? Include supporting data points.

4. **Suggested Actions** (3-5 items): Prioritized next steps that ALIGN with the doctor's stated plan. Don't contradict their decisions - support them. Include follow-through items for plans they mentioned.

Format your response as JSON:
{
  "summary": "...",
  "keyConsiderations": [
    {"text": "GI bleed history (2023) — anticoagulation contraindicated", "severity": "critical"},
    {"text": "CKD3 (eGFR ~40) — adjust diuretic dosing", "severity": "important"}
  ],
  "thinking": "...",
  "suggestedActions": ["action 1", "action 2", "action 3"]
}

Respond with ONLY the JSON, no preamble.`;

        return prompt;
    },

    /**
     * Request Claude to update the thinking via extension
     */
    requestThinkingUpdate(prompt) {
        // Create a special message type for thinking synthesis
        window.postMessage({
            type: 'CLAUDE_THINKING_SYNTHESIS',
            prompt: prompt,
            callback: 'AICoworker.receiveThinkingUpdate'
        }, '*');

        // Also dispatch custom event
        const event = new CustomEvent('claude-thinking-request', {
            detail: {
                prompt: prompt,
                type: 'synthesis'
            }
        });
        document.dispatchEvent(event);
    },

    /**
     * Receive updated thinking from Claude
     * Now handles full JSON response with summary, thinking, and actions
     */
    receiveThinkingUpdate(response) {
        try {
            let data = response;

            // If it's a string, try to parse as JSON
            if (typeof response === 'string') {
                // Try to extract JSON from the response
                const jsonMatch = response.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    data = JSON.parse(jsonMatch[0]);
                } else {
                    // If no JSON found, treat the whole thing as thinking text
                    this.state.thinking = response;
                    this.state.status = 'ready';
                    this.saveState();
                    this.render();
                    App.showToast('AI thinking updated', 'success');
                    return;
                }
            }

            // Update all fields from parsed response
            if (data.thinking) {
                this.state.thinking = data.thinking;
            }
            if (data.summary) {
                this.state.summary = data.summary;
            }
            if (data.keyConsiderations && Array.isArray(data.keyConsiderations)) {
                this.state.keyConsiderations = data.keyConsiderations.map(c => ({
                    text: typeof c === 'string' ? c : c.text,
                    severity: (typeof c === 'object' && c.severity) || 'info'
                }));
            }
            if (data.suggestedActions && Array.isArray(data.suggestedActions)) {
                this.state.suggestedActions = data.suggestedActions.map((action, idx) => ({
                    id: 'claude_action_' + idx,
                    text: typeof action === 'string' ? action : action.text
                }));
            }

            this.state.status = 'ready';
            this.saveState();
            this.render();
            App.showToast('AI updated based on your thoughts', 'success');
        } catch (e) {
            console.error('Error parsing thinking update:', e);
            // Fallback: if it's a string, just use it as thinking
            if (typeof response === 'string' && response.length > 0) {
                this.state.thinking = response;
                this.state.status = 'ready';
                this.saveState();
                this.render();
            }
        }
    },

    // localThinkingSynthesis removed — LLM-only synthesis

    // Voice recording (Web Speech API)
    isRecording: false,
    recognition: null,

    toggleVoiceRecording() {
        if (this.isRecording) {
            this.stopVoiceRecording();
        } else {
            this.startVoiceRecording();
        }
    },

    startVoiceRecording() {
        if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
            App.showToast('Voice recognition not supported in this browser', 'warning');
            return;
        }

        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        this.recognition = new SpeechRecognition();
        this.recognition.continuous = true;
        this.recognition.interimResults = true;
        this.recognition.lang = 'en-US';

        const input = document.getElementById('ai-dictation-input');
        const btn = document.getElementById('voice-record-btn');
        let finalTranscript = input.value;

        this.recognition.onresult = (event) => {
            let interimTranscript = '';
            for (let i = event.resultIndex; i < event.results.length; i++) {
                if (event.results[i].isFinal) {
                    finalTranscript += event.results[i][0].transcript + ' ';
                } else {
                    interimTranscript += event.results[i][0].transcript;
                }
            }
            input.value = finalTranscript + interimTranscript;
        };

        this.recognition.onerror = (event) => {
            console.error('Speech recognition error:', event.error);
            this.stopVoiceRecording();
            if (event.error === 'not-allowed') {
                App.showToast('Microphone access denied', 'error');
            }
        };

        this.recognition.onend = () => {
            if (this.isRecording) {
                // Auto-restart if still supposed to be recording
                this.recognition.start();
            }
        };

        this.recognition.start();
        this.isRecording = true;

        if (btn) {
            btn.classList.add('recording');
            btn.querySelector('.voice-text').textContent = 'Stop Recording';
            btn.querySelector('.voice-icon').textContent = '⏹️';
        }
    },

    stopVoiceRecording() {
        if (this.recognition) {
            this.isRecording = false;
            this.recognition.stop();
            this.recognition = null;
        }

        const btn = document.getElementById('voice-record-btn');
        if (btn) {
            btn.classList.remove('recording');
            btn.querySelector('.voice-text').textContent = 'Start Recording';
            btn.querySelector('.voice-icon').textContent = '🎙️';
        }
    },

    // ==================== Note Writing ====================

    openNoteModal() {
        const modal = document.getElementById('ai-note-modal');
        if (modal) {
            modal.classList.add('visible');
            // Gather current chart data
            this.gatherChartData();
        }
    },

    closeNoteModal() {
        const modal = document.getElementById('ai-note-modal');
        if (modal) {
            modal.classList.remove('visible');
        }
    },

    /**
     * Gather data from the chart for note writing
     */
    gatherChartData() {
        // Pull from various sources in the EHR
        const chartData = {
            patientInfo: null,
            vitals: [],
            labs: [],
            meds: [],
            imaging: [],
            nursingNotes: [],
            previousNotes: []
        };

        // Get patient info from PatientHeader if available
        if (typeof PatientHeader !== 'undefined' && PatientHeader.currentPatient) {
            chartData.patientInfo = PatientHeader.currentPatient;
        }

        // Get vitals from VitalsDisplay if available
        if (typeof VitalsDisplay !== 'undefined' && VitalsDisplay.currentVitals) {
            chartData.vitals = VitalsDisplay.vitalsHistory || [VitalsDisplay.currentVitals];
        }

        // Get labs from LabsPanel if available
        if (typeof LabsPanel !== 'undefined' && LabsPanel.results) {
            chartData.labs = LabsPanel.results;
        }

        // Get meds from localStorage or global
        const storedMeds = localStorage.getItem('patientMedications');
        if (storedMeds) {
            try {
                chartData.meds = JSON.parse(storedMeds);
            } catch (e) {}
        }

        // Nursing notes from chart data (if any)
        chartData.nursingNotes = this.state.chartData?.nursingNotes || [];

        this.state.chartData = chartData;
    },

    /**
     * Generate a clinical note using Claude
     */
    async generateNote() {
        const noteType = document.querySelector('input[name="note-type"]:checked').value;
        const instructions = document.getElementById('note-instructions').value.trim();
        const noteTypeName = this.getNoteTypeName(noteType);

        // Build data sources based on checkboxes
        const includeSources = {
            vitals: document.getElementById('include-vitals').checked,
            labs: document.getElementById('include-labs').checked,
            meds: document.getElementById('include-meds').checked,
            imaging: document.getElementById('include-imaging').checked,
            nursing: document.getElementById('include-nursing').checked,
            dictation: document.getElementById('include-dictation').checked,
            previous: document.getElementById('include-previous').checked
        };

        this.closeNoteModal();

        // Show generating state
        this.openNoteEditor(noteTypeName, null);

        // Track note writing in session context
        if (this.sessionContext) {
            this.sessionContext.trackNote(noteType);
        }

        // Use context assembler for note context, fall back to legacy
        let systemPrompt, userMessage;
        if (this.contextAssembler) {
            this.syncSessionStateToDocument();
            const prompt = this.contextAssembler.buildNotePrompt(
                noteType, noteTypeName, includeSources, instructions,
                this.state.chartData, this.state.dictation
            );
            systemPrompt = prompt.systemPrompt;
            userMessage = prompt.userMessage;
            console.log(`📊 Note context: ${userMessage.length} chars (full)`);
        } else {
            const clinicalContext = this.buildFullClinicalContext();
            const notePrompt = this.buildNotePrompt(noteType, includeSources, instructions);
            systemPrompt = `You are a physician writing a clinical note in an EHR system. Write a professional, thorough clinical note based on the patient data provided. Use standard medical documentation conventions.

Write the note in plain text with clear section headers. Do NOT use markdown formatting like ** or #. Use UPPERCASE for section headers followed by a colon.

IMPORTANT:
- Be thorough but concise - include clinically relevant details
- Use the patient's actual data from the clinical context
- Include the patient and nurse conversation data if relevant to the clinical picture
- Structure the note according to the requested format
- Write as if you are the attending physician documenting the encounter`;
            userMessage = `## Full Clinical Context\n${clinicalContext}\n\n## Note Request\n${notePrompt}`;
        }

        try {
            const response = await this.callLLM(systemPrompt, userMessage, 4096);
            this.openNoteEditor(noteTypeName, response);
            App.showToast(noteTypeName + ' draft generated', 'success');
        } catch (error) {
            console.error('Note generation error:', error);
            if (error.message === 'API key not configured') {
                this.closeNoteEditor();
            } else {
                this.openNoteEditor(noteTypeName, 'Error generating note: ' + error.message + '\n\nYou can write your note manually here.');
                App.showToast('Error generating note: ' + error.message, 'error');
            }
        }
    },

    getNoteTypeName(type) {
        const names = {
            'hp': 'H&P',
            'progress': 'Progress Note',
            'discharge': 'Discharge Summary',
            'consult': 'Consult Note'
        };
        return names[type] || 'Note';
    },

    buildNotePrompt(noteType, includeSources, instructions) {
        let prompt = 'Please write a clinical ' + this.getNoteTypeName(noteType) + ' for this patient.\n\n';

        // Add chart data based on selected sources
        if (includeSources.vitals && this.state.chartData.vitals.length > 0) {
            prompt += '## Recent Vitals\n';
            const recent = this.state.chartData.vitals.slice(-3);
            recent.forEach(v => {
                prompt += '- HR: ' + (v.hr || v.heartRate || 'N/A') + ', ';
                prompt += 'BP: ' + (v.systolic || v.sbp || '?') + '/' + (v.diastolic || v.dbp || '?') + ', ';
                prompt += 'RR: ' + (v.rr || v.respRate || 'N/A') + ', ';
                prompt += 'SpO2: ' + (v.spo2 || v.o2sat || 'N/A') + '%\n';
            });
            prompt += '\n';
        }

        if (includeSources.labs && this.state.chartData.labs.length > 0) {
            prompt += '## Lab Results\n';
            this.state.chartData.labs.forEach(lab => {
                prompt += '- ' + lab.name + ': ' + lab.value + ' ' + (lab.unit || '') + '\n';
            });
            prompt += '\n';
        }

        if (includeSources.meds && this.state.chartData.meds.length > 0) {
            prompt += '## Current Medications\n';
            this.state.chartData.meds.forEach(med => {
                prompt += '- ' + med.name + ' ' + (med.dose || '') + ' ' + (med.route || '') + ' ' + (med.frequency || '') + '\n';
            });
            prompt += '\n';
        }

        if (includeSources.nursing && this.state.chartData.nursingNotes.length > 0) {
            prompt += '## Nursing Notes\n';
            this.state.chartData.nursingNotes.slice(-5).forEach(note => {
                prompt += '- ' + note.text + '\n';
            });
            prompt += '\n';
        }

        if (includeSources.dictation && this.state.dictation) {
            prompt += '## Doctor\'s Assessment & Thoughts\n';
            prompt += this.state.dictation + '\n\n';
        }

        // Add context from AI state
        if (this.state.summary) {
            prompt += '## Case Summary\n' + this.state.summary + '\n\n';
        }

        if (this.state.flags && this.state.flags.length > 0) {
            prompt += '## Safety Alerts\n';
            this.state.flags.forEach(f => {
                prompt += '⚠️ ' + f.text + '\n';
            });
            prompt += '\n';
        }

        if (this.state.observations && this.state.observations.length > 0) {
            prompt += '## Key Observations\n';
            this.state.observations.forEach(obs => {
                prompt += '- ' + obs + '\n';
            });
            prompt += '\n';
        }

        // Add template structure hint
        prompt += '## Note Format\n';
        if (noteType === 'hp') {
            prompt += 'Please structure as: Chief Complaint, HPI, PMH, Medications, Allergies, Social Hx, Family Hx, ROS, Physical Exam, Assessment, Plan\n';
        } else if (noteType === 'progress') {
            prompt += 'Please structure as: Subjective, Objective (vitals, exam, labs), Assessment, Plan (by problem)\n';
        } else if (noteType === 'discharge') {
            prompt += 'Please structure as: Admission Diagnosis, Hospital Course, Discharge Diagnosis, Discharge Medications, Follow-up, Patient Instructions\n';
        } else if (noteType === 'consult') {
            prompt += 'Please structure as: Reason for Consult, HPI, Relevant History, Exam, Labs/Imaging, Assessment, Recommendations\n';
        }

        if (instructions) {
            prompt += '\n## Additional Instructions\n' + instructions + '\n';
        }

        return prompt;
    },

    // ==================== Note Editor ====================

    openNoteEditor(noteTypeName, content) {
        let modal = document.getElementById('ai-note-editor-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'ai-note-editor-modal';
            modal.className = 'ai-modal';
            document.body.appendChild(modal);
        }

        const isGenerating = content === null;

        modal.innerHTML = `
            <div class="ai-modal-content note-editor-modal">
                <div class="ai-modal-header">
                    <h3>${noteTypeName} Draft</h3>
                    <button onclick="AICoworker.closeNoteEditor()">×</button>
                </div>
                <div class="ai-modal-body note-editor-body">
                    ${isGenerating
                        ? '<div class="note-generating"><div class="ai-assistant-spinner"></div><span>Generating note draft...</span></div>'
                        : '<textarea id="note-editor-content" class="note-editor-textarea" spellcheck="true"></textarea>'
                    }
                </div>
                <div class="ai-modal-footer">
                    <button class="btn btn-secondary" onclick="AICoworker.closeNoteEditor()">Discard</button>
                    <button class="btn btn-secondary" onclick="AICoworker.copyNoteToClipboard()" ${isGenerating ? 'disabled' : ''}>Copy</button>
                    <button class="btn btn-primary" onclick="AICoworker.saveNoteToEHR('${noteTypeName}')" ${isGenerating ? 'disabled' : ''}>Save to Chart</button>
                </div>
            </div>
        `;

        modal.classList.add('visible');

        if (!isGenerating && content) {
            const textarea = document.getElementById('note-editor-content');
            if (textarea) textarea.value = content;
        }
    },

    closeNoteEditor() {
        const modal = document.getElementById('ai-note-editor-modal');
        if (modal) modal.classList.remove('visible');
    },

    copyNoteToClipboard() {
        const textarea = document.getElementById('note-editor-content');
        if (!textarea) return;
        navigator.clipboard.writeText(textarea.value).then(() => {
            App.showToast('Note copied to clipboard', 'success');
        });
    },

    saveNoteToEHR(noteTypeName) {
        const textarea = document.getElementById('note-editor-content');
        if (!textarea || !textarea.value.trim()) {
            App.showToast('Note is empty', 'error');
            return;
        }

        const now = new Date();
        const noteId = 'NOTE_AI_' + now.getTime();
        const patientName = window.PatientHeader?.currentPatient?.name || 'Unknown Patient';

        const newNote = {
            id: noteId,
            type: noteTypeName,
            title: noteTypeName + ' - AI-Assisted Draft',
            date: now.toISOString(),
            author: 'Attending Physician (AI-Assisted)',
            department: 'Hospital Medicine',
            content: textarea.value.trim(),
            signedDate: null,
            aiGenerated: true
        };

        // Store in localStorage so it persists and is accessible to the Notes view
        const storedNotes = JSON.parse(localStorage.getItem('ehr-generated-notes') || '[]');
        storedNotes.push(newNote);
        localStorage.setItem('ehr-generated-notes', JSON.stringify(storedNotes));

        // Notify the notes list component if it exists
        if (window.NotesList && typeof NotesList.addGeneratedNote === 'function') {
            NotesList.addGeneratedNote(newNote);
        }

        this.closeNoteEditor();
        App.showToast(noteTypeName + ' saved to chart', 'success');

        // Navigate to notes view to show the saved note
        if (window.router) {
            window.router.navigate('/notes');
        }
    },

    /**
     * Build full context for external tools
     */
    buildFullContext() {
        return {
            dictation: this.state.dictation,
            dictationHistory: this.state.dictationHistory,
            summary: this.state.summary,
            thinking: this.state.thinking,
            flags: this.state.flags,
            observations: this.state.observations,
            reviewed: this.state.reviewed,
            openItems: this.state.openItems,
            tasks: this.state.tasks,
            chartData: this.state.chartData
        };
    },

    // ==================== Refresh / Re-analyze ====================

    /**
     * Refresh AI thinking - re-analyze the entire case
     */
    refreshThinking() {
        // Show thinking status
        this.state.status = 'thinking';
        this.render();

        // Gather latest chart data
        this.gatherChartData();

        // Build comprehensive refresh prompt
        const refreshPrompt = this.buildRefreshPrompt();

        // Animate the refresh button
        const btn = document.querySelector('.assistant-toolbar-btn');
        if (btn) {
            btn.classList.add('spinning');
            setTimeout(() => btn.classList.remove('spinning'), 2000);
        }

        App.showToast('Refreshing AI analysis...', 'info');

        // Try Claude extension first
        this.requestFullRefresh(refreshPrompt);

        // Broadcast for external tools
        window.postMessage({
            type: 'AI_REFRESH_REQUESTED',
            prompt: refreshPrompt,
            fullContext: this.buildFullContext()
        }, '*');

        // Use LLM for intelligent refresh (falls back to local if not configured)
        this.refreshWithLLM();
    },

    /**
     * Build prompt for full case refresh
     */
    buildRefreshPrompt() {
        let prompt = `You are an AI clinical assistant. Please analyze this case and provide updated thinking and suggested actions.

## Patient Information
${this.state.chartData.patientInfo
    ? `Name: ${this.state.chartData.patientInfo.name}, Age: ${this.state.chartData.patientInfo.age}`
    : 'See case summary below'}

## Doctor's Current Assessment
${this.state.dictation || 'No dictation recorded yet.'}

## Case Summary
${this.state.summary || 'No summary available.'}

## Current Vitals
${this.state.chartData.vitals && this.state.chartData.vitals.length > 0
    ? this.state.chartData.vitals.slice(-1).map(v =>
        `HR: ${v.hr || 'N/A'}, BP: ${v.sbp || '?'}/${v.dbp || '?'}, RR: ${v.rr || 'N/A'}, SpO2: ${v.spo2 || 'N/A'}%`
      ).join('\n')
    : 'No vitals recorded'}

## Recent Labs
${this.state.chartData.labs && this.state.chartData.labs.length > 0
    ? this.state.chartData.labs.map(l => `- ${l.name}: ${l.value} ${l.unit || ''}`).join('\n')
    : 'No labs available'}

## Safety Flags
${this.state.flags && this.state.flags.length > 0
    ? this.state.flags.map(f => `⚠️ ${f.text}`).join('\n')
    : 'None'}

## Key Observations
${this.state.observations && this.state.observations.length > 0
    ? this.state.observations.map(o => `- ${o}`).join('\n')
    : 'None'}

## What Has Been Reviewed
${this.state.reviewed && this.state.reviewed.length > 0
    ? this.state.reviewed.map(r => `✓ ${r}`).join('\n')
    : 'Nothing marked as reviewed'}

## Open Items (Not Yet Addressed)
${this.state.openItems && this.state.openItems.length > 0
    ? this.state.openItems.map(o => `○ ${o}`).join('\n')
    : 'None'}

## Current Medications
${this.state.chartData.meds && this.state.chartData.meds.length > 0
    ? this.state.chartData.meds.map(m => `- ${m.name} ${m.dose || ''} ${m.route || ''} ${m.frequency || ''}`).join('\n')
    : 'No medications listed'}

## Nursing Notes
${this.state.chartData.nursingNotes && this.state.chartData.nursingNotes.length > 0
    ? this.state.chartData.nursingNotes.slice(-3).map(n => `- ${n.text}`).join('\n')
    : 'None'}

---

Please provide:

1. **Updated Thinking** (2-4 sentences): Your current analysis of the case, acknowledging the doctor's assessment, noting key clinical considerations, and highlighting any safety concerns. Use **bold** for key decisions. Write from AI perspective.

2. **Updated Summary** (1-2 sentences): A concise case summary with key diagnoses and current status.

3. **Suggested Actions** (3-5 items): Prioritized next steps the doctor should consider. Focus on actionable items.

Format your response as JSON:
{
  "thinking": "...",
  "summary": "...",
  "suggestedActions": ["action 1", "action 2", "action 3"]
}`;

        return prompt;
    },

    /**
     * Request full refresh from Claude extension
     */
    requestFullRefresh(prompt) {
        window.postMessage({
            type: 'CLAUDE_REFRESH_REQUEST',
            prompt: prompt,
            callback: 'AICoworker.receiveRefreshUpdate'
        }, '*');

        const event = new CustomEvent('claude-refresh-request', {
            detail: { prompt: prompt }
        });
        document.dispatchEvent(event);
    },

    /**
     * Receive refresh update from Claude
     */
    receiveRefreshUpdate(response) {
        try {
            let data = response;
            if (typeof response === 'string') {
                // Try to parse JSON from response
                const jsonMatch = response.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    data = JSON.parse(jsonMatch[0]);
                }
            }

            if (data.thinking) {
                this.state.thinking = data.thinking;
            }
            if (data.summary) {
                this.state.summary = data.summary;
            }
            if (data.suggestedActions && Array.isArray(data.suggestedActions)) {
                this.state.suggestedActions = data.suggestedActions.map((action, idx) => ({
                    id: 'refresh_action_' + idx,
                    text: typeof action === 'string' ? action : action.text
                }));
            }

            this.state.status = 'ready';
            this.saveState();
            this.render();
            App.showToast('AI analysis updated', 'success');
        } catch (e) {
            console.error('Error parsing refresh response:', e);
            this.state.status = 'ready';
            this.render();
        }
    },

    // localRefreshAnalysis removed — LLM-only refresh

    // ==================== LLM API Integration ====================

    /**
     * Load API key from localStorage
     */
    loadApiKey() {
        this.apiKey = localStorage.getItem('anthropicApiKey');
        return this.apiKey;
    },

    /**
     * Save API key to localStorage
     */
    saveApiKey(key) {
        this.apiKey = key;
        localStorage.setItem('anthropicApiKey', key);
    },

    /**
     * Check if API is configured
     */
    isApiConfigured() {
        return !!(this.apiKey || this.loadApiKey());
    },

    /**
     * Open API key configuration modal
     */
    openApiKeyModal() {
        let modal = document.getElementById('ai-apikey-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'ai-apikey-modal';
            modal.className = 'ai-modal';
            modal.innerHTML = `
                <div class="ai-modal-content">
                    <div class="ai-modal-header">
                        <h3>🔑 Configure API Key</h3>
                        <button onclick="AICoworker.closeApiKeyModal()">×</button>
                    </div>
                    <div class="ai-modal-body">
                        <p class="ai-modal-hint">Enter your Anthropic API key to enable AI-powered synthesis. Your key is stored locally in your browser.</p>
                        <input type="password" id="api-key-input" placeholder="sk-ant-..." style="width: 100%; padding: 10px; font-family: monospace;">
                        <p class="ai-modal-hint" style="margin-top: 10px; font-size: 11px;">
                            <a href="https://console.anthropic.com/settings/keys" target="_blank">Get an API key from Anthropic Console →</a>
                        </p>
                    </div>
                    <div class="ai-modal-footer">
                        <button class="btn btn-secondary" onclick="AICoworker.closeApiKeyModal()">Cancel</button>
                        <button class="btn btn-primary" onclick="AICoworker.submitApiKey()">Save Key</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
        }
        document.getElementById('api-key-input').value = this.apiKey || '';
        modal.classList.add('visible');
    },

    closeApiKeyModal() {
        const modal = document.getElementById('ai-apikey-modal');
        if (modal) modal.classList.remove('visible');
    },

    submitApiKey() {
        const input = document.getElementById('api-key-input');
        const key = input.value.trim();
        if (key) {
            this.saveApiKey(key);
            this.closeApiKeyModal();
            App.showToast('API key saved', 'success');
        }
    },

    // ==================== Debug/Prompt Viewer ====================

    /**
     * Store the last API call details for debugging
     */
    lastApiCall: {
        timestamp: null,
        systemPrompt: '',
        userMessage: '',
        clinicalContext: '',
        response: '',
        error: null
    },

    /**
     * Open the debug panel showing prompts and context
     */
    openDebugPanel() {
        let modal = document.getElementById('ai-debug-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'ai-debug-modal';
            modal.className = 'ai-modal ai-debug-modal';
            modal.innerHTML = `
                <div class="ai-modal-content ai-debug-content">
                    <div class="ai-modal-header">
                        <h3>🔍 Debug: LLM Prompts & Context</h3>
                        <button onclick="AICoworker.closeDebugPanel()">×</button>
                    </div>
                    <div class="ai-modal-body ai-debug-body">
                        <div class="debug-tabs">
                            <button class="debug-tab active" onclick="AICoworker.switchDebugTab('context')">Clinical Context</button>
                            <button class="debug-tab" onclick="AICoworker.switchDebugTab('system')">System Prompt</button>
                            <button class="debug-tab" onclick="AICoworker.switchDebugTab('user')">User Message</button>
                            <button class="debug-tab" onclick="AICoworker.switchDebugTab('response')">Last Response</button>
                        </div>
                        <div class="debug-info">
                            <span id="debug-timestamp">No API call yet</span>
                            <span id="debug-status"></span>
                        </div>
                        <div class="debug-panel-content">
                            <textarea id="debug-context-text" class="debug-textarea" placeholder="Clinical context will appear here..."></textarea>
                            <textarea id="debug-system-text" class="debug-textarea" style="display:none;" placeholder="System prompt will appear here..."></textarea>
                            <textarea id="debug-user-text" class="debug-textarea" style="display:none;" placeholder="User message will appear here..."></textarea>
                            <textarea id="debug-response-text" class="debug-textarea" style="display:none;" placeholder="API response will appear here..."></textarea>
                        </div>
                        <div class="debug-actions">
                            <button class="btn btn-secondary" onclick="AICoworker.copyDebugToClipboard()">📋 Copy All</button>
                            <button class="btn btn-secondary" onclick="AICoworker.exportDebugToFile()">💾 Export to File</button>
                            <button class="btn btn-primary" onclick="AICoworker.refreshDebugContext()">🔄 Refresh Context</button>
                        </div>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
        }

        // Populate with current data
        this.refreshDebugContext();
        modal.classList.add('visible');
    },

    closeDebugPanel() {
        const modal = document.getElementById('ai-debug-modal');
        if (modal) modal.classList.remove('visible');
    },

    switchDebugTab(tab) {
        // Update tab buttons
        document.querySelectorAll('.debug-tab').forEach(btn => btn.classList.remove('active'));
        event.target.classList.add('active');

        // Hide all textareas
        document.querySelectorAll('.debug-textarea').forEach(ta => ta.style.display = 'none');

        // Show selected textarea
        const textareaId = `debug-${tab}-text`;
        const textarea = document.getElementById(textareaId);
        if (textarea) textarea.style.display = 'block';
    },

    refreshDebugContext() {
        // Build current clinical context — use memory-aware assembler if available
        let clinicalContext;
        if (this.contextAssembler) {
            this.syncSessionStateToDocument();
            clinicalContext = this.contextAssembler.buildDebugContextPrompt();
        } else {
            clinicalContext = this.buildFullClinicalContext();
        }

        // Add header showing which context type is being used
        const contextType = this.contextAssembler
            ? '=== MEMORY-AWARE CONTEXT (Working Memory Assembler) ===\n\n'
            : (this.useLongitudinalContext && this.longitudinalDoc)
                ? '=== LONGITUDINAL CLINICAL DOCUMENT ===\n\n'
                : '=== LEGACY CLINICAL CONTEXT ===\n\n';

        document.getElementById('debug-context-text').value = contextType + clinicalContext;

        // Show last API call data if available
        if (this.lastApiCall.timestamp) {
            document.getElementById('debug-timestamp').textContent =
                `Last API call: ${new Date(this.lastApiCall.timestamp).toLocaleTimeString()}`;
            document.getElementById('debug-system-text').value = this.lastApiCall.systemPrompt || 'No system prompt recorded';
            document.getElementById('debug-user-text').value = this.lastApiCall.userMessage || 'No user message recorded';
            document.getElementById('debug-response-text').value = this.lastApiCall.response ||
                (this.lastApiCall.error ? `ERROR: ${this.lastApiCall.error}` : 'No response recorded');

            document.getElementById('debug-status').textContent = this.lastApiCall.error ? '❌ Error' : '✅ Success';
            document.getElementById('debug-status').style.color = this.lastApiCall.error ? '#dc2626' : '#16a34a';
        } else {
            document.getElementById('debug-timestamp').textContent = 'No API call yet - dictate some thoughts to trigger an API call';
            document.getElementById('debug-system-text').value = this.getSynthesisSystemPrompt();
            document.getElementById('debug-user-text').value = '(Will be populated when you dictate thoughts)';
            document.getElementById('debug-response-text').value = '(Will be populated after API call)';
        }
    },

    /**
     * Get the system prompt for synthesis (for display)
     */
    getSynthesisSystemPrompt() {
        return `You are an AI clinical assistant helping a physician manage a patient case. Your role is to:
1. Synthesize the doctor's clinical reasoning with the available patient data
2. Update the case summary, your current thinking, and suggested actions
3. ALWAYS respect and incorporate the doctor's stated assessment and plan
4. Flag any safety concerns but don't override the doctor's decisions
5. Be concise and clinically relevant

IMPORTANT: The doctor drives decision-making. You support by organizing information and surfacing relevant data.

Respond in this exact JSON format:
{
    "summary": "1-2 sentence case summary with **bold** for key diagnoses and decisions",
    "thinking": "2-4 sentences synthesizing doctor's assessment with clinical data. Use **bold** for key findings. Acknowledge their reasoning and note supporting/concerning data.",
    "suggestedActions": ["action 1", "action 2", "action 3", "action 4", "action 5"],
    "observations": ["any new observations based on the data that might be relevant"]
}

RULES:
- suggestedActions should ALIGN with the doctor's stated plan, not contradict it
- If doctor says "no anticoagulation", don't suggest anticoagulation
- Always consider safety flags when making suggestions
- Keep suggestions actionable and specific
- Maximum 5 suggested actions, prioritized by importance`;
    },

    copyDebugToClipboard() {
        const allData = `=== AI ASSISTANT DEBUG EXPORT ===
Timestamp: ${this.lastApiCall.timestamp ? new Date(this.lastApiCall.timestamp).toISOString() : 'No API call yet'}

=== CLINICAL CONTEXT ===
${document.getElementById('debug-context-text').value}

=== SYSTEM PROMPT ===
${document.getElementById('debug-system-text').value}

=== USER MESSAGE ===
${document.getElementById('debug-user-text').value}

=== API RESPONSE ===
${document.getElementById('debug-response-text').value}
`;
        navigator.clipboard.writeText(allData).then(() => {
            App.showToast('Debug info copied to clipboard', 'success');
        });
    },

    exportDebugToFile() {
        const allData = `=== AI ASSISTANT DEBUG EXPORT ===
Timestamp: ${this.lastApiCall.timestamp ? new Date(this.lastApiCall.timestamp).toISOString() : 'No API call yet'}

=== CLINICAL CONTEXT ===
${document.getElementById('debug-context-text').value}

=== SYSTEM PROMPT ===
${document.getElementById('debug-system-text').value}

=== USER MESSAGE ===
${document.getElementById('debug-user-text').value}

=== API RESPONSE ===
${document.getElementById('debug-response-text').value}
`;
        const blob = new Blob([allData], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ai-debug-${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.txt`;
        a.click();
        URL.revokeObjectURL(url);
        App.showToast('Debug info exported', 'success');
    },

    /**
     * Build the full clinical context for the LLM
     * Uses longitudinal document if available, falls back to legacy method
     */
    buildFullClinicalContext() {
        // Try to use longitudinal document if available
        if (this.useLongitudinalContext && this.longitudinalDoc && this.longitudinalDocRenderer) {
            try {
                // Sync current session state to document first
                this.syncSessionStateToDocument();

                // Render the longitudinal document
                const context = this.longitudinalDocRenderer.render(this.longitudinalDoc);
                console.log('Using LONGITUDINAL clinical context');
                console.log(`  - Context length: ${context.length} chars`);
                return context;
            } catch (error) {
                console.warn('Failed to render longitudinal context, falling back to legacy:', error);
            }
        }

        console.log('Using LEGACY clinical context');
        return this.buildLegacyClinicalContext();
    },

    /**
     * Legacy method for building clinical context (fallback)
     */
    buildLegacyClinicalContext() {
        const ctx = {
            patient: this.state.chartData?.patientInfo || { name: 'Unknown', age: 'Unknown' },
            vitals: this.state.chartData?.vitals?.slice(-5) || [],
            labs: this.state.chartData?.labs || [],
            medications: this.state.chartData?.meds || [],
            nursingNotes: this.state.chartData?.nursingNotes?.slice(-5) || [],
            safetyFlags: this.state.flags || [],
            observations: this.state.observations || [],
            reviewed: this.state.reviewed || [],
            openItems: this.state.openItems || [],
            previousSummary: this.state.summary || '',
            previousThinking: this.state.thinking || '',
            dictationHistory: this.state.dictationHistory?.slice(-3) || []
        };

        let contextStr = `## Patient Information
Name: ${ctx.patient.name || 'Unknown'}
Age: ${ctx.patient.age || 'Unknown'}
MRN: ${ctx.patient.mrn || 'Unknown'}

## Current Vitals
${ctx.vitals.length > 0
    ? ctx.vitals.map(v => `- HR: ${v.hr || 'N/A'}, BP: ${v.sbp || '?'}/${v.dbp || '?'}, RR: ${v.rr || 'N/A'}, SpO2: ${v.spo2 || 'N/A'}%, Temp: ${v.temp || 'N/A'}`).join('\n')
    : 'No vitals recorded'}

## Lab Results
${ctx.labs.length > 0
    ? ctx.labs.map(l => `- ${l.name}: ${l.value} ${l.unit || ''} ${l.flag ? '(' + l.flag + ')' : ''}`).join('\n')
    : 'No labs available'}

## Current Medications
${ctx.medications.length > 0
    ? ctx.medications.map(m => `- ${m.name} ${m.dose || ''} ${m.route || ''} ${m.frequency || ''}`).join('\n')
    : 'No medications listed'}

## Safety Flags (CRITICAL - always consider these)
${ctx.safetyFlags.length > 0
    ? ctx.safetyFlags.map(f => `⚠️ ${f.text} (${f.severity || 'warning'})`).join('\n')
    : 'None'}

## Key Observations
${ctx.observations.length > 0
    ? ctx.observations.map(o => `- ${o}`).join('\n')
    : 'None'}

## What Has Been Reviewed
${ctx.reviewed.length > 0
    ? ctx.reviewed.map(r => `✓ ${r}`).join('\n')
    : 'Nothing reviewed yet'}

## Open Items (Not Yet Addressed)
${ctx.openItems.length > 0
    ? ctx.openItems.map(o => `○ ${o}`).join('\n')
    : 'None'}

## Nursing Notes
${ctx.nursingNotes.length > 0
    ? ctx.nursingNotes.map(n => `- ${n.text || n}`).join('\n')
    : 'None'}

## Previous AI Summary
${ctx.previousSummary || 'None'}

## Previous AI Thinking
${ctx.previousThinking || 'None'}

## Doctor's Previous Thoughts (for context)
${ctx.dictationHistory.length > 0
    ? ctx.dictationHistory.map(d => `- "${d.text}"`).join('\n')
    : 'None'}`;

        return contextStr;
    },

    /**
     * Call the Anthropic API with the given prompt
     */
    async callLLM(systemPrompt, userMessage, maxTokens) {
        // Store debug info BEFORE the call
        this.lastApiCall = {
            timestamp: Date.now(),
            systemPrompt: systemPrompt,
            userMessage: userMessage,
            clinicalContext: '', // Will be set by caller if needed
            response: '',
            error: null
        };

        console.log('🤖 LLM API CALL:', {
            timestamp: new Date().toISOString(),
            systemPromptLength: systemPrompt.length,
            userMessageLength: userMessage.length
        });
        console.log('📝 System Prompt:', systemPrompt.substring(0, 500) + '...');
        console.log('📝 User Message:', userMessage.substring(0, 500) + '...');

        if (!this.isApiConfigured()) {
            this.lastApiCall.error = 'API key not configured';
            this.openApiKeyModal();
            throw new Error('API key not configured');
        }

        try {
            const response = await fetch(this.apiEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': this.apiKey,
                    'anthropic-version': '2023-06-01',
                    'anthropic-dangerous-direct-browser-access': 'true'
                },
                body: JSON.stringify({
                    model: this.model,
                    max_tokens: maxTokens || 1024,
                    system: systemPrompt,
                    messages: [
                        { role: 'user', content: userMessage }
                    ]
                })
            });

            if (!response.ok) {
                const error = await response.json();
                const errorMsg = error.error?.message || 'API request failed';
                this.lastApiCall.error = errorMsg;
                console.error('❌ LLM API Error:', errorMsg);
                throw new Error(errorMsg);
            }

            const data = await response.json();
            const responseText = data.content[0].text;

            // Store successful response
            this.lastApiCall.response = responseText;
            console.log('✅ LLM Response:', responseText.substring(0, 500) + '...');

            return responseText;
        } catch (error) {
            this.lastApiCall.error = error.message;
            console.error('❌ LLM API Error:', error);
            throw error;
        }
    },

    /**
     * Use LLM to synthesize doctor's thoughts with clinical context
     */
    async synthesizeWithLLM(doctorThoughts) {
        this.state.status = 'thinking';
        this.render();

        // Track dictation in session context
        if (this.sessionContext) {
            this.sessionContext.trackDictation(doctorThoughts);
        }

        // Use context assembler for focused context, fall back to legacy
        let systemPrompt, userMessage, clinicalContext;
        if (this.contextAssembler) {
            this.syncSessionStateToDocument();
            const prompt = this.contextAssembler.buildDictationPrompt(doctorThoughts);
            systemPrompt = prompt.systemPrompt;
            userMessage = prompt.userMessage;
            clinicalContext = userMessage;
            console.log(`📊 Dictation context: ${userMessage.length} chars (focused)`);
        } else {
            systemPrompt = `You are an AI clinical assistant helping a physician manage a patient case. You maintain a durable "living memory" of this patient that persists across interactions.

Your role:
1. Synthesize the doctor's clinical reasoning with the available patient data
2. Update the case summary, your current thinking, and suggested actions
3. ALWAYS respect and incorporate the doctor's stated assessment and plan
4. Flag any safety concerns but don't override the doctor's decisions
5. Update your persistent clinical narrative (trajectory, key findings, open questions)
6. Be concise and clinically relevant

IMPORTANT: The doctor drives decision-making. You support by organizing information and surfacing relevant data.

Respond in this exact JSON format:
{
    "summary": "1-2 sentence case summary with **bold** for key diagnoses and decisions",
    "keyConsiderations": [
        {"text": "Safety concern or important clinical factor", "severity": "critical|important|info"}
    ],
    "thinking": "2-4 sentences about patient trajectory. Where is the patient heading? Is the situation improving, worsening, or stable? Include supporting data points.",
    "suggestedActions": ["action 1", "action 2", "action 3", "action 4", "action 5"],
    "observations": ["any new observations based on the data"],
    "trajectoryAssessment": "Brief assessment of each active problem's trajectory (improving, worsening, stable). Include key data points supporting each assessment. This persists across sessions as your memory of the patient.",
    "keyFindings": ["Critical clinical findings that should be remembered across sessions"],
    "openQuestions": ["Unresolved clinical questions that need follow-up"]
}

RULES:
- suggestedActions should ALIGN with the doctor's stated plan, not contradict it
- If doctor says "no anticoagulation", don't suggest anticoagulation
- Always consider safety flags when making suggestions
- Keep suggestions actionable and specific, maximum 5
- trajectoryAssessment should BUILD ON any existing trajectory (don't lose prior context, refine it)
- keyFindings should be durable insights, not transient observations
- openQuestions are things that still need to be resolved`;

            clinicalContext = this.buildFullClinicalContext();
            userMessage = `## Current Clinical Context\n${clinicalContext}\n\n## Doctor's Current Assessment/Thoughts\n"${doctorThoughts}"\n\nBased on the doctor's thoughts and the clinical context above, provide an updated synthesis. Update the trajectory assessment, key findings, and open questions based on this new information.`;
        }

        // Store clinical context for debug panel
        this.lastApiCall.clinicalContext = clinicalContext;

        try {
            const response = await this.callLLM(systemPrompt, userMessage);

            // Parse the JSON response
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                throw new Error('Invalid response format');
            }

            const result = JSON.parse(jsonMatch[0]);

            // Update AI panel state
            if (result.summary) {
                this.state.summary = result.summary;
            }
            if (result.thinking) {
                this.state.thinking = result.thinking;
            }
            if (result.keyConsiderations && Array.isArray(result.keyConsiderations)) {
                this.state.keyConsiderations = result.keyConsiderations.map(c => ({
                    text: typeof c === 'string' ? c : c.text,
                    severity: (typeof c === 'object' && c.severity) || 'info'
                }));
            }
            if (result.suggestedActions && Array.isArray(result.suggestedActions)) {
                this.state.suggestedActions = result.suggestedActions.map((action, idx) => ({
                    id: 'llm_action_' + Date.now() + '_' + idx,
                    text: typeof action === 'string' ? action : action.text
                }));
            }
            if (result.observations && Array.isArray(result.observations)) {
                result.observations.forEach(obs => {
                    if (!this.state.observations.includes(obs)) {
                        this.state.observations.push(obs);
                    }
                });
            }

            // === LLM WRITE-BACK: Update longitudinal document with AI insights ===
            this.writeBackToDocument(result);

            // === MEMORY WRITE-BACK: Update AI memory with persistent understanding ===
            if (this.contextAssembler) {
                const memUpdates = this.contextAssembler.parseMemoryUpdates(JSON.stringify(result));
                this.writeBackMemoryUpdates(memUpdates, 'dictate', doctorThoughts);
            }

            // Push synthesis summary to conversation thread
            if (result.summary) {
                this._pushToThread('ai', 'think', result.summary);
            }

            this.state.status = 'ready';
            this.saveState();
            this.render();
            App.showToast('AI synthesis updated', 'success');

        } catch (error) {
            console.error('LLM synthesis error:', error);
            this.state.status = 'ready';
            this.render();
            if (error.message === 'API key not configured') {
                App.showToast('Configure API key in settings to enable AI synthesis', 'warning');
            } else {
                App.showToast('Error: ' + error.message, 'error');
            }
        }
    },

    /**
     * Use LLM for full case refresh
     */
    async refreshWithLLM() {
        this.state.status = 'thinking';
        this.render();

        // Animate refresh button
        const btn = document.querySelector('.assistant-toolbar-btn');
        if (btn) {
            btn.classList.add('spinning');
        }

        // Use context assembler for comprehensive context, fall back to legacy
        let systemPrompt, userMessage, clinicalContext;
        if (this.contextAssembler) {
            this.syncSessionStateToDocument();
            const prompt = this.contextAssembler.buildRefreshPrompt(this.state.dictation);
            systemPrompt = prompt.systemPrompt;
            userMessage = prompt.userMessage;
            clinicalContext = userMessage;
            console.log(`📊 Refresh context: ${userMessage.length} chars (full)`);
        } else {
            systemPrompt = `You are an AI clinical assistant embedded in an EHR system. Analyze this patient case and provide a comprehensive synthesis.

You maintain a LONGITUDINAL CLINICAL DOCUMENT that persists across sessions. Your insights are written back into this document so they accumulate over time. Think of yourself as building a living understanding of this patient.

Respond in this exact JSON format:
{
    "summary": "1-2 sentence case summary with **bold** for key diagnoses",
    "keyConsiderations": [
        {"text": "Safety concern or important clinical factor", "severity": "critical|important|info"}
    ],
    "thinking": "2-4 sentences about patient trajectory. Where is the patient heading? Include supporting data points.",
    "suggestedActions": ["action 1", "action 2", "action 3", "action 4", "action 5"],
    "observations": ["key observations from the data"],
    "trajectoryAssessment": "A paragraph synthesizing disease trajectories. For each active problem, describe current status, recent trend, and concerning patterns. This is DURABLE - it persists and gets refined over time.",
    "keyFindings": ["finding 1", "finding 2"],
    "openQuestions": ["question 1", "question 2"]
}

Prioritize:
1. Safety concerns and critical values (put these in keyConsiderations with severity "critical")
2. Alignment with doctor's stated assessment (if any)
3. Actionable next steps
4. Things that haven't been addressed yet

RULES:
- keyConsiderations should include allergies, contraindications, drug interactions, and clinical concerns
- Use severity "critical" for life-threatening concerns, "important" for significant issues, "info" for context
- trajectoryAssessment should be comprehensive - describe how each problem is trending
- keyFindings should be durable insights worth remembering across sessions
- openQuestions are things that still need to be resolved`;

            clinicalContext = this.buildFullClinicalContext();
            userMessage = `## Clinical Context\n${clinicalContext}\n\n${this.state.dictation ? `## Doctor's Current Assessment\n"${this.state.dictation}"` : '## No doctor assessment recorded yet'}\n\nProvide a comprehensive case synthesis. Build a trajectory assessment covering all active problems.`;
        }

        // Store clinical context for debug panel
        this.lastApiCall.clinicalContext = clinicalContext;

        try {
            const response = await this.callLLM(systemPrompt, userMessage);

            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                throw new Error('Invalid response format');
            }

            const result = JSON.parse(jsonMatch[0]);

            if (result.summary) this.state.summary = result.summary;
            if (result.thinking) this.state.thinking = result.thinking;
            if (result.keyConsiderations && Array.isArray(result.keyConsiderations)) {
                this.state.keyConsiderations = result.keyConsiderations.map(c => ({
                    text: typeof c === 'string' ? c : c.text,
                    severity: (typeof c === 'object' && c.severity) || 'info'
                }));
            }
            if (result.suggestedActions && Array.isArray(result.suggestedActions)) {
                this.state.suggestedActions = result.suggestedActions.map((action, idx) => ({
                    id: 'refresh_' + Date.now() + '_' + idx,
                    text: typeof action === 'string' ? action : action.text
                }));
            }
            if (result.observations && Array.isArray(result.observations)) {
                this.state.observations = result.observations;
            }

            // === LLM WRITE-BACK: Update longitudinal document with AI insights ===
            this.writeBackToDocument(result);

            // === MEMORY WRITE-BACK: Update AI memory with persistent understanding ===
            if (this.contextAssembler) {
                const memUpdates = this.contextAssembler.parseMemoryUpdates(JSON.stringify(result));
                this.writeBackMemoryUpdates(memUpdates, 'refresh', 'Full case refresh');
            }

            this.state.status = 'ready';
            this.state.lastUpdated = new Date().toISOString();
            this.saveState();
            this.render();
            App.showToast('AI analysis refreshed', 'success');

        } catch (error) {
            console.error('LLM refresh error:', error);
            this.state.status = 'ready';
            this.render();
            if (error.message === 'API key not configured') {
                App.showToast('Configure API key in settings to enable AI analysis', 'warning');
            } else {
                App.showToast('Error: ' + error.message, 'error');
            }
        } finally {
            if (btn) {
                btn.classList.remove('spinning');
            }
        }
    },

    // ==================== Claude Extension Integration ====================

    /**
     * Ask Claude browser extension to help with a specific item
     * This triggers the Claude in Chrome extension if installed
     */
    async askClaudeAbout(item) {
        // Check if this looks like a note-writing request
        const notePatterns = /\b(write|draft|generate|create)\b.*\b(note|h&p|h\&p|progress note|discharge|consult)\b/i;
        if (notePatterns.test(item)) {
            this.openNoteModal();
            return;
        }

        // Show thinking state
        this.state.status = 'thinking';
        this.render();

        // Track the question in session context
        if (this.sessionContext) {
            this.sessionContext.trackQuestion(item);
        }

        // Use context assembler for focused context, fall back to legacy
        let systemPrompt, userMessage, maxTokens;
        if (this.contextAssembler) {
            this.syncSessionStateToDocument();
            const prompt = this.contextAssembler.buildAskPrompt(item);
            systemPrompt = prompt.systemPrompt;
            userMessage = prompt.userMessage;
            maxTokens = prompt.maxTokens;
            console.log(`📊 Ask AI context: ${userMessage.length} chars (focused)`);
        } else {
            const clinicalContext = this.buildFullClinicalContext();
            systemPrompt = `You are an AI clinical assistant helping a physician. Answer their question or help with their task using the clinical context provided. Be concise, clinically relevant, and actionable. Use plain text, not markdown.`;
            userMessage = `## Clinical Context\n${clinicalContext}\n\n## Physician's Request\n${item}`;
            maxTokens = 2048;
        }

        try {
            const response = await this.callLLM(systemPrompt, userMessage, maxTokens);

            // Strip memory_update block from display text
            const displayText = response.replace(/<memory_update>[\s\S]*?<\/memory_update>/, '').trim();

            // Push AI response to conversation thread
            this._pushToThread('ai', 'ask', displayText);

            // Write back any memory updates from the ask response
            if (this.contextAssembler) {
                const memUpdates = this.contextAssembler.parseMemoryUpdates(response);
                this.writeBackMemoryUpdates(memUpdates, 'ask', item);
            }

            this.state.status = 'ready';
            this.saveState();
            this.render();
        } catch (error) {
            this.state.status = 'ready';
            if (error.message === 'API key not configured') {
                this._pushToThread('ai', 'ask', 'Configure your API key in settings to enable AI responses.');
            } else {
                this._pushToThread('ai', 'ask', 'Error: ' + error.message);
                App.showToast('Error: ' + error.message, 'error');
            }
            this.render();
        }
    },

    /**
     * Build patient context string for Claude
     */
    buildPatientContext() {
        let context = 'Patient Context:\n';

        // Add tracking context if available
        if (this.state.context) {
            context += this.state.context + '\n\n';
        }

        // Add what's been reviewed
        if (this.state.reviewed && this.state.reviewed.length > 0) {
            context += 'Already reviewed: ' + this.state.reviewed.join(', ') + '\n';
        }

        // Add observations
        if (this.state.observations && this.state.observations.length > 0) {
            context += '\nObservations:\n';
            this.state.observations.forEach(obs => {
                context += '- ' + obs + '\n';
            });
        }

        // Add safety flags
        if (this.state.flags && this.state.flags.length > 0) {
            context += '\n⚠️ Safety Flags:\n';
            this.state.flags.forEach(flag => {
                context += '- ' + flag.text + '\n';
            });
        }

        return context;
    },

    // Response modal and Claude helper modal removed — responses render inline

    // ==================== Panel Controls ====================

    /**
     * Ensure the AI panel is visible and switch to copilot tab
     */
    toggle() {
        if (typeof AIPanel !== 'undefined') {
            if (AIPanel.isCollapsed) {
                AIPanel.expand();
            }
        }
    },

    show() {
        this.toggle();
    },

    toggleMinimize() {
        // No-op - panel is now integrated into sidebar
    },

    // ==================== External API ====================

    /**
     * Add an observation (neutral fact)
     */
    addObservation(text) {
        if (!this.state.observations) this.state.observations = [];
        // Deduplicate
        if (this.state.observations.includes(text)) return;
        this.state.observations.push(text);
        // Cap at 15 to prevent clutter
        if (this.state.observations.length > 15) {
            this.state.observations = this.state.observations.slice(-15);
        }
        this.saveState();
        this.render();
    },

    /**
     * Add a safety flag
     */
    addFlag(text, severity = 'warning') {
        if (!this.state.flags) this.state.flags = [];
        this.state.flags.unshift({ text, severity, timestamp: new Date().toISOString() });
        this.saveState();
        this.render();
        this.show();
    },

    /**
     * Mark something as reviewed
     */
    markReviewed(item) {
        if (!this.state.reviewed) this.state.reviewed = [];
        if (!this.state.reviewed.includes(item)) {
            this.state.reviewed.push(item);
            // Cap at 20 to prevent unbounded growth
            if (this.state.reviewed.length > 20) {
                this.state.reviewed = this.state.reviewed.slice(-20);
            }
            this.saveState();
            this.render();
        }
    },

    /**
     * Set context/tracking info
     */
    setContext(text) {
        this.state.context = text;
        this.saveState();
        this.render();
    },

    /**
     * Add open item (something not yet addressed)
     */
    addOpenItem(item) {
        if (!this.state.openItems) this.state.openItems = [];
        this.state.openItems.push(item);
        this.saveState();
        this.render();
    },

    /**
     * Full update from external source
     */
    updateFromExternal(data) {
        this.update(data);
        this.show();
    },

    /**
     * Get current state
     */
    getState() {
        return { ...this.state };
    },

    // ==================== Demo ====================

    loadDemo() {
        this.update({
            status: 'thinking',
            dictation: 'Classic CHF exacerbation picture. He looks wet - JVD, lower extremity edema, crackles. Wife says he\'s been eating a lot of salty foods and missed his Lasix a few times. Given his GI bleed 5 months ago, I\'m NOT going to anticoagulate even if he\'s in A-fib. Will diurese and get cards involved.',
            dictationHistory: [
                {
                    text: 'Initial impression: Dyspneic elderly male, appears uncomfortable. Need to assess volume status and check for arrhythmia.',
                    timestamp: new Date(Date.now() - 30 * 60000).toISOString()
                }
            ],
            summary: '72yo male with **DM2, CKD Stage 3, CHF (EF 32%)**, and **A.fib** presenting with acute dyspnea. Recent admission 3 weeks ago for CHF exacerbation. Currently appears volume overloaded.',
            thinking: 'Doctor has identified this as a CHF exacerbation with clear triggers (dietary indiscretion, missed diuretics). Key decision: **Doctor has decided against anticoagulation** due to GI bleed history - this aligns with GI recommendations. Supporting with diuresis and cardiology consult.',
            suggestedActions: [
                { id: 'action_1', text: 'Order BNP to assess current heart failure severity' },
                { id: 'action_2', text: 'Check creatinine trend before aggressive diuresis' },
                { id: 'action_3', text: 'Place cardiology consult' },
                { id: 'action_4', text: 'Start IV furosemide 40mg' }
            ],
            flags: [
                { text: 'Recent GI bleed (5 months ago) - GI recommends avoiding anticoagulation', severity: 'critical' }
            ],
            reviewed: [
                'Medication list',
                'Recent vitals',
                'GI consult note'
            ],
            observations: [
                'Last BNP was 890 pg/mL (3 weeks ago)',
                'Cr trending up: 1.4 → 1.6 over past week',
                'Patient reports missing doses of furosemide',
                'Physical exam: JVD present, 2+ pitting edema, bibasilar crackles'
            ],
            openItems: [
                'Echocardiogram (last done 6 months ago)',
                'Code status discussion'
            ],
            tasks: [],
            chartData: {
                patientInfo: { name: 'Robert Morrison', age: 72, mrn: '847291' },
                vitals: [
                    { hr: 94, sbp: 142, dbp: 88, rr: 22, spo2: 94, timestamp: new Date().toISOString() }
                ],
                labs: [
                    { name: 'BNP', value: '890', unit: 'pg/mL', timestamp: '3 weeks ago' },
                    { name: 'Creatinine', value: '1.6', unit: 'mg/dL' },
                    { name: 'Potassium', value: '4.2', unit: 'mEq/L' }
                ],
                meds: [
                    { name: 'Furosemide', dose: '40mg', route: 'PO', frequency: 'BID' },
                    { name: 'Lisinopril', dose: '10mg', route: 'PO', frequency: 'daily' },
                    { name: 'Carvedilol', dose: '12.5mg', route: 'PO', frequency: 'BID' },
                    { name: 'Metformin', dose: '500mg', route: 'PO', frequency: 'BID' }
                ],
                nursingNotes: [
                    { text: 'Patient appears short of breath, sitting upright. Requesting to use bathroom frequently.', timestamp: new Date().toISOString() }
                ],
                previousNotes: []
            }
        });
    },

    // ==================== Utilities ====================

    formatText(text) {
        if (!text) return '';
        return this.escapeHtml(text)
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\n/g, '<br>');
    },

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
};

// Expose globally
window.AICoworker = AICoworker;

// Convenience functions for external tools
window.updateAIAssistant = function(data) {
    AICoworker.updateFromExternal(data);
};

window.addAIObservation = function(text) {
    AICoworker.addObservation(text);
};

window.addAIFlag = function(text, severity) {
    AICoworker.addFlag(text, severity);
};

window.setAIContext = function(text) {
    AICoworker.setContext(text);
};

window.updateAIThinking = function(thinking) {
    AICoworker.receiveThinkingUpdate(thinking);
};

window.setAIDictation = function(text) {
    AICoworker.state.dictation = text;
    AICoworker.saveState();
    AICoworker.render();
    AICoworker.onDictationUpdated(text);
};

window.refreshAIAssistant = function() {
    AICoworker.refreshThinking();
};

window.updateAIFromRefresh = function(response) {
    AICoworker.receiveRefreshUpdate(response);
};
