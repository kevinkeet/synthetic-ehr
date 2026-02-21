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

        // Initialize longitudinal document for current patient
        this.initializeLongitudinalDocument();
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

            // Save the initialized document
            this.saveLongitudinalDoc();

            console.log('Longitudinal document initialized successfully');
            console.log(`  - Problems: ${this.longitudinalDoc.problemMatrix.size}`);
            console.log(`  - Lab trends: ${this.longitudinalDoc.longitudinalData.labs.size}`);
            console.log(`  - Vitals: ${this.longitudinalDoc.longitudinalData.vitals.length}`);
            console.log(`  - Narrative trajectory: ${this.longitudinalDoc.clinicalNarrative.trajectoryAssessment ? 'YES' : 'empty'}`);
            console.log(`  - Key findings: ${this.longitudinalDoc.clinicalNarrative.keyFindings.length}`);

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

        // Sync patient conversation if available
        if (window.PatientChat && window.PatientChat.messages && window.PatientChat.messages.length > 0) {
            this.longitudinalDocUpdater.syncPatientConversation(window.PatientChat.messages);
        }

        // Sync nurse conversation if available
        if (window.NurseChat && window.NurseChat.messages && window.NurseChat.messages.length > 0) {
            this.longitudinalDocUpdater.syncNurseConversation(window.NurseChat.messages);
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
     * Create modals (no longer creates a floating panel - renders into AI panel tab)
     */
    createPanel() {
        // Create ask modal
        this.createAskModal();

        // Create add task modal
        this.createAddTaskModal();

        // Create dictation modal
        this.createDictationModal();

        // Create note writing modal
        this.createNoteModal();
    },

    /**
     * Create the "Ask AI" modal
     */
    createAskModal() {
        const modal = document.createElement('div');
        modal.id = 'ai-ask-modal';
        modal.className = 'ai-modal';
        modal.innerHTML = `
            <div class="ai-modal-content">
                <div class="ai-modal-header">
                    <h3>💬 Ask AI</h3>
                    <button onclick="AICoworker.closeAskModal()">×</button>
                </div>
                <div class="ai-modal-body">
                    <p class="ai-modal-hint">Ask the AI to help with your clinical reasoning. The AI will provide information to support your decision-making.</p>
                    <textarea id="ai-ask-input" rows="3" placeholder="e.g., What's this patient's bleeding history? or Help me think through the differential..."></textarea>
                    <div class="ai-quick-asks">
                        <button onclick="AICoworker.quickAsk('summarize')">Summarize what I've found</button>
                        <button onclick="AICoworker.quickAsk('missing')">What haven't I checked?</button>
                        <button onclick="AICoworker.quickAsk('history')">Relevant history</button>
                    </div>
                </div>
                <div class="ai-modal-footer">
                    <button class="btn btn-secondary" onclick="AICoworker.closeAskModal()">Cancel</button>
                    <button class="btn btn-primary" onclick="AICoworker.submitAsk()">Ask</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    },

    /**
     * Create the "Add Task" modal
     */
    createAddTaskModal() {
        const modal = document.createElement('div');
        modal.id = 'ai-task-modal';
        modal.className = 'ai-modal';
        modal.innerHTML = `
            <div class="ai-modal-content small">
                <div class="ai-modal-header">
                    <h3>+ Add Task</h3>
                    <button onclick="AICoworker.closeAddTask()">×</button>
                </div>
                <div class="ai-modal-body">
                    <input type="text" id="ai-task-input" placeholder="e.g., Check renal function before diuretics">
                </div>
                <div class="ai-modal-footer">
                    <button class="btn btn-secondary" onclick="AICoworker.closeAddTask()">Cancel</button>
                    <button class="btn btn-primary" onclick="AICoworker.submitTask()">Add</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
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
        // Listen to simulation events for dynamic AI updates
        if (typeof SimulationEngine !== 'undefined') {
            SimulationEngine.on('nurseAlert', (data) => this.onAlert(data));
            SimulationEngine.on('patientAlert', (data) => this.onAlert(data));
            SimulationEngine.on('vitalsUpdate', (data) => this.onVitalsUpdate(data));
            SimulationEngine.on('labsReady', (data) => this.onLabsReady(data));
            SimulationEngine.on('medicationGiven', (data) => this.onMedicationGiven(data));
            SimulationEngine.on('orderPlaced', (data) => this.onOrderPlaced(data));
            SimulationEngine.on('consultResponse', (data) => this.onConsultResponse(data));
            SimulationEngine.on('timeUpdate', (data) => this.onTimeUpdate(data));

            // Lightweight tick listener for real-time snapshot + progress updates
            // Throttled to update every 3 ticks (~3 seconds real time)
            let tickCount = 0;
            SimulationEngine.on('tick', () => {
                tickCount++;
                if (tickCount % 3 !== 0) return;
                this.updateLiveSections();
            });
        }

        // Listen for keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closeAskModal();
                this.closeAddTask();
                this.closeDictationModal();
                this.closeNoteModal();
                this.closeNoteEditor();
                this.closeResponseModal();
            }
        });

        // Listen for page navigation to gather context
        window.addEventListener('hashchange', () => this.onPageChange());
        window.addEventListener('popstate', () => this.onPageChange());
    },

    /**
     * Handle vitals updates - AI should notice significant changes
     */
    onVitalsUpdate(data) {
        // Check for concerning vital changes
        if (data.hr > 120 || data.hr < 50) {
            this.addObservation('Heart rate ' + (data.hr > 120 ? 'elevated' : 'low') + ' at ' + data.hr + ' bpm');
        }
        if (data.sbp < 90) {
            this.addFlag('Hypotension: SBP ' + data.sbp + ' mmHg', 'critical');
        }
        if (data.spo2 < 92) {
            this.addFlag('Hypoxia: SpO2 ' + data.spo2 + '%', 'critical');
        }

        // Update chart data
        if (!this.state.chartData.vitals) this.state.chartData.vitals = [];
        this.state.chartData.vitals.push({
            ...data,
            timestamp: new Date().toISOString()
        });
        // Keep last 20 entries
        if (this.state.chartData.vitals.length > 20) {
            this.state.chartData.vitals = this.state.chartData.vitals.slice(-20);
        }
        this.saveState();
    },

    /**
     * Handle labs becoming ready
     */
    onLabsReady(data) {
        this.addObservation('New lab results available: ' + (data.panel || data.name || 'Labs'));

        // Check for critical values
        if (data.results) {
            data.results.forEach(lab => {
                if (lab.critical) {
                    this.addFlag('Critical lab: ' + lab.name + ' = ' + lab.value + ' ' + (lab.unit || ''), 'critical');
                }
            });
        }

        // Store labs
        if (data.results) {
            if (!this.state.chartData.labs) this.state.chartData.labs = [];
            this.state.chartData.labs = [...this.state.chartData.labs, ...data.results];
        }
        this.saveState();
    },

    /**
     * Handle medication administered
     */
    onMedicationGiven(data) {
        const medName = data.medication || data.name || 'medication';
        this.markReviewed('Administered: ' + medName);

        // Update thinking if relevant to case
        if (medName.toLowerCase().includes('furosemide') || medName.toLowerCase().includes('lasix')) {
            this.addObservation('Diuretic given - monitor urine output and electrolytes');
        }
    },

    /**
     * Handle orders being placed
     */
    onOrderPlaced(data) {
        const orderName = data.order || data.name || 'order';

        // Move from open items to reviewed if it was pending
        if (this.state.openItems) {
            const idx = this.state.openItems.findIndex(item =>
                item.toLowerCase().includes(orderName.toLowerCase())
            );
            if (idx !== -1) {
                this.markAddressed(idx);
            }
        }

        this.markReviewed('Ordered: ' + orderName);
    },

    /**
     * Handle consult responses
     */
    onConsultResponse(data) {
        const specialty = data.specialty || data.service || 'Consult';
        this.addObservation(specialty + ' consult note available');

        // Store consult note
        if (!this.state.chartData.previousNotes) this.state.chartData.previousNotes = [];
        this.state.chartData.previousNotes.push({
            type: 'consult',
            specialty: specialty,
            content: data.note || data.content,
            timestamp: new Date().toISOString()
        });
        this.saveState();
    },

    /**
     * Handle simulation time updates - for time-based triggers
     */
    onTimeUpdate(data) {
        const minutes = data.minutes || data.elapsed || 0;

        // Example: At 45 minutes, prompt about A-fib anticoagulation decision
        if (minutes >= 45 && minutes < 47 && !this.state._afibPromptShown) {
            this.state._afibPromptShown = true;
            if (this.state.flags && this.state.flags.some(f => f.text.toLowerCase().includes('gi bleed'))) {
                // Patient has GI bleed history - this is the anticoagulation dilemma
                this.addObservation('A-fib confirmed on telemetry - anticoagulation decision needed');
                if (!this.state.suggestedActions) this.state.suggestedActions = [];
                this.state.suggestedActions.push({
                    id: 'afib_decision',
                    text: 'Review anticoagulation options given GI bleed history'
                });
                this.saveState();
                this.render();
            }
        }
    },

    /**
     * Handle page navigation - update context
     */
    onPageChange() {
        const page = window.location.hash || window.location.pathname;
        const pageName = this.getPageName(page);
        if (pageName) {
            this.markReviewed('Viewed: ' + pageName);
        }
    },

    getPageName(page) {
        const pageNames = {
            'chart': 'Chart Overview',
            'labs': 'Lab Results',
            'vitals': 'Vital Signs',
            'meds': 'Medications',
            'orders': 'Orders',
            'notes': 'Clinical Notes',
            'imaging': 'Imaging',
            'results': 'Results'
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

        // ===== SECTION 1: ALERT BAR (sticky, only when alerts exist) =====
        html += this.renderAlertBar();

        // ===== SECTION 2: PATIENT SNAPSHOT =====
        html += this.renderPatientSnapshot();

        // ===== SECTION 3: PROGRESS TRACKER =====
        html += this.renderProgressTracker();

        // ===== SECTION 4: CLINICAL REASONING =====
        html += this.renderClinicalReasoning();

        // ===== SECTION 5: SUGGESTED NEXT STEPS =====
        html += this.renderNextSteps();

        // ===== AI RESPONSE (from Ask) =====
        if (this.state.aiResponse) {
            html += '<div class="copilot-section response-section">';
            html += '<div class="copilot-section-header"><span>&#128172;</span> AI Response <button class="section-action-btn" onclick="AICoworker.clearResponse()">Clear</button></div>';
            html += '<div class="copilot-section-body"><div class="ai-response-text">' + this.formatText(this.state.aiResponse) + '</div></div>';
            html += '</div>';
        }

        // ===== SECTION 6: QUICK ACTIONS BAR (sticky bottom) =====
        html += this.renderQuickActions();

        body.innerHTML = html;
    },

    /**
     * Lightweight update of live-data sections only (snapshot + alert bar + progress)
     * Called on sim ticks without re-rendering the entire panel
     */
    updateLiveSections() {
        const body = document.getElementById('assistant-tab-body');
        if (!body) return;

        // Update snapshot in-place
        const snapshot = body.querySelector('.copilot-snapshot');
        if (snapshot) {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = this.renderPatientSnapshot();
            const newSnapshot = tempDiv.firstElementChild;
            if (newSnapshot) {
                snapshot.innerHTML = newSnapshot.innerHTML;
            }
        }

        // Update alert bar in-place
        const alertBar = body.querySelector('.copilot-alert-bar');
        const newAlertHtml = this.renderAlertBar();
        if (newAlertHtml && !alertBar) {
            // Alert appeared — need to add it at top
            body.insertAdjacentHTML('afterbegin', newAlertHtml);
        } else if (!newAlertHtml && alertBar) {
            // Alerts cleared
            alertBar.remove();
        } else if (newAlertHtml && alertBar) {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = newAlertHtml;
            const newBar = tempDiv.firstElementChild;
            if (newBar) {
                alertBar.innerHTML = newBar.innerHTML;
            }
        }

        // Update progress tracker in-place
        const progressSection = body.querySelector('.progress-section');
        if (progressSection) {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = this.renderProgressTracker();
            const newProgress = tempDiv.firstElementChild;
            if (newProgress) {
                progressSection.innerHTML = newProgress.innerHTML;
            }
        }
    },

    // ==================== Copilot Section Renderers ====================

    renderAlertBar() {
        const alerts = [];

        // Allergy violations
        if (typeof SimulationScoreTracker !== 'undefined' && SimulationScoreTracker.allergyViolations.length > 0) {
            SimulationScoreTracker.allergyViolations.forEach(v => {
                alerts.push({ text: `ALLERGY VIOLATION: ${v.medication} — patient has ${v.allergen} (${v.reaction})`, severity: 'critical' });
            });
        }

        // Safety flags from state
        if (this.state.flags && this.state.flags.length > 0) {
            this.state.flags.slice(0, 3).forEach(f => {
                alerts.push({ text: f.text, severity: f.severity || 'warning' });
            });
        }

        // Critical vitals
        if (typeof SimulationEngine !== 'undefined' && SimulationEngine.isRunning) {
            const vitals = SimulationEngine.patientState?.vitals;
            if (vitals) {
                if (vitals.spO2 < 88) alerts.push({ text: `Critical: SpO2 ${vitals.spO2}% — consider urgent intervention`, severity: 'critical' });
                if (vitals.systolic < 85) alerts.push({ text: `Critical: SBP ${vitals.systolic} — hypotension`, severity: 'critical' });
                if (vitals.heartRate > 150) alerts.push({ text: `Critical: HR ${vitals.heartRate} — tachycardia`, severity: 'critical' });
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

    renderPatientSnapshot() {
        const simRunning = typeof SimulationEngine !== 'undefined' && SimulationEngine.isRunning;

        // Get patient info
        let patientName = 'Patient';
        let patientAge = '';
        let room = '412';
        if (typeof PatientHeader !== 'undefined' && PatientHeader.patient) {
            const p = PatientHeader.patient;
            patientName = `${p.firstName || ''} ${p.lastName || ''}`.trim() || 'Patient';
            patientAge = p.age ? `${p.age}${p.gender === 'Male' ? 'M' : 'F'}` : '';
        }

        // Get vitals
        let vitalsHtml = '<span class="snapshot-placeholder">Vitals pending...</span>';
        let trendHtml = '';
        let uopHtml = '';

        if (simRunning && SimulationEngine.patientState) {
            const v = SimulationEngine.patientState.vitals;
            const phys = SimulationEngine.patientState.physiology;
            const trajectory = SimulationEngine.patientState.trajectory || 'stable';

            if (v) {
                vitalsHtml = '';
                vitalsHtml += this._vitalBadge('BP', `${Math.round(v.systolic)}/${Math.round(v.diastolic)}`, v.systolic > 160 || v.systolic < 90 ? 'critical' : v.systolic > 140 ? 'warning' : 'normal');
                vitalsHtml += this._vitalBadge('HR', Math.round(v.heartRate), v.heartRate > 120 ? 'critical' : v.heartRate > 100 ? 'warning' : 'normal');
                vitalsHtml += this._vitalBadge('RR', Math.round(v.respiratoryRate), v.respiratoryRate > 24 ? 'critical' : v.respiratoryRate > 20 ? 'warning' : 'normal');
                vitalsHtml += this._vitalBadge('SpO2', `${Math.round(v.spO2)}%`, v.spO2 < 90 ? 'critical' : v.spO2 < 94 ? 'warning' : 'normal');
                vitalsHtml += this._vitalBadge('Wt', `${(v.weight || 0).toFixed(1)}kg`, '', true);
            }

            // Trend
            const trendArrow = trajectory === 'worsening' ? '&#9660;' : trajectory === 'improving' ? '&#9650;' : '&#9644;';
            const trendClass = trajectory === 'worsening' ? 'trend-bad' : trajectory === 'improving' ? 'trend-good' : 'trend-stable';
            trendHtml = `<span class="snapshot-trend ${trendClass}">${trendArrow} ${trajectory.charAt(0).toUpperCase() + trajectory.slice(1)}</span>`;

            // UOP
            if (phys && phys.urineOutput !== undefined) {
                uopHtml = this._vitalBadge('UOP', `${Math.round(phys.urineOutput)} mL/hr`, phys.urineOutput < 30 ? 'warning' : 'normal');
            }
        }

        // Sim time
        let simTime = '';
        if (simRunning) {
            const elapsed = SimulationEngine.getElapsedMinutes();
            simTime = `${Math.round(elapsed)} min elapsed`;
        }

        // Working diagnosis
        let dx = this.state.summary
            ? this.formatText(this.state.summary)
            : '<span class="snapshot-placeholder-dx">Dictate your assessment to set diagnosis...</span>';

        // Allergies
        let allergyHtml = '';
        if (typeof PatientHeader !== 'undefined' && PatientHeader.patient?.allergies) {
            const allergies = PatientHeader.patient.allergies;
            if (allergies.length > 0) {
                allergyHtml = '<div class="snapshot-allergies">';
                allergyHtml += '<span class="allergy-label">&#9888; Allergies:</span> ';
                allergyHtml += allergies.map(a => {
                    const name = typeof a === 'string' ? a : (a.allergen || a.name || 'Unknown');
                    const reaction = typeof a === 'object' ? (a.reaction || '') : '';
                    return `<span class="allergy-chip">${this.escapeHtml(name)}${reaction ? ` (${reaction})` : ''}</span>`;
                }).join(' ');
                allergyHtml += '</div>';
            }
        }

        let html = '<div class="copilot-snapshot">';
        html += '<div class="snapshot-header">';
        html += `<span class="snapshot-patient">${this.escapeHtml(patientName)}${patientAge ? ', ' + patientAge : ''}</span>`;
        html += `<span class="snapshot-meta">Room ${room}${simTime ? ' &middot; ' + simTime : ''}</span>`;
        html += '</div>';
        html += `<div class="snapshot-dx">${dx}</div>`;
        html += `<div class="snapshot-vitals">${vitalsHtml}${uopHtml}</div>`;
        if (trendHtml) html += `<div class="snapshot-trend-row">${trendHtml}</div>`;
        if (allergyHtml) html += allergyHtml;
        html += '</div>';
        return html;
    },

    _vitalBadge(label, value, status, muted) {
        const cls = status === 'critical' ? 'vital-critical' : status === 'warning' ? 'vital-warning' : (muted ? 'vital-muted' : 'vital-normal');
        return `<span class="vital-badge ${cls}"><span class="vital-label">${label}</span> <span class="vital-value">${value}</span></span>`;
    },

    renderProgressTracker() {
        if (typeof SimulationScoreTracker === 'undefined') return '';

        const progress = SimulationScoreTracker.getProgressSummary();
        const nudges = SimulationScoreTracker.getTopNudges(3);
        const temporalNudges = SimulationScoreTracker.getTemporalNudges();

        let html = '<div class="copilot-section progress-section">';
        html += `<div class="copilot-section-header"><span>&#128200;</span> Your Progress <span class="progress-overall">${progress.overall}%</span></div>`;
        html += '<div class="copilot-section-body">';

        // Progress bars
        html += '<div class="progress-bars">';
        const domains = ['patientHistory', 'nurseInteraction', 'chartReview', 'orders', 'safety', 'empathy'];
        domains.forEach(key => {
            const d = progress[key];
            const pct = d.percentage === -1 ? 0 : d.percentage;
            const barClass = d.percentage === -1 ? 'bar-na' : pct >= 66 ? 'bar-good' : pct >= 33 ? 'bar-mid' : 'bar-low';
            const displayText = d.percentage === -1 ? '--' :
                (key === 'safety' ? (d.isSafe ? '&#10003;' : '&#10007;') : `${d.count}/${d.countTotal}`);
            html += '<div class="progress-item">';
            html += `<div class="progress-bar-track"><div class="progress-bar-fill ${barClass}" style="width:${pct}%"></div></div>`;
            html += `<div class="progress-label">${d.label}</div>`;
            html += `<div class="progress-count">${displayText}</div>`;
            html += '</div>';
        });
        html += '</div>';

        // Temporal nudges (time warnings)
        if (temporalNudges.length > 0) {
            html += '<div class="temporal-nudges">';
            temporalNudges.forEach(n => {
                html += `<div class="temporal-nudge ${n.severity}">&#9200; ${this.escapeHtml(n.text)}</div>`;
            });
            html += '</div>';
        }

        // Priority nudges
        if (nudges.length > 0) {
            html += '<div class="priority-nudges">';
            html += '<div class="nudges-label">Next steps:</div>';
            nudges.forEach(n => {
                const clickable = n.action ? ` onclick="window.location.hash='${n.action}'" style="cursor:pointer"` : '';
                html += `<div class="priority-nudge"${clickable}>`;
                html += `<span class="nudge-domain" style="background:${n.domainColor}">${n.domain}</span>`;
                html += `<span class="nudge-text">${this.escapeHtml(n.text)}</span>`;
                html += `<span class="nudge-pts">${n.points}pts</span>`;
                html += '</div>';
            });
            html += '</div>';
        }

        html += '</div></div>';
        return html;
    },

    renderClinicalReasoning() {
        const hasDictation = !!this.state.dictation;
        const hasSummary = !!this.state.summary;
        const hasThinking = !!this.state.thinking;
        const isThinking = this.state.status === 'thinking';

        let html = '<div class="copilot-section reasoning-section">';
        html += '<div class="copilot-section-header">';
        html += '<span>&#129504;</span> Clinical Reasoning';
        html += '<div class="section-actions">';
        if (hasDictation) {
            html += '<button class="section-action-btn" onclick="AICoworker.openDictationModal()" title="Edit thoughts">&#9998;</button>';
        }
        html += '<button class="section-action-btn" onclick="AICoworker.refreshThinking()" title="Refresh">&#128260;</button>';
        html += '</div></div>';
        html += '<div class="copilot-section-body">';

        if (isThinking) {
            html += '<div class="reasoning-loading"><div class="typing-indicator"><span></span><span></span><span></span></div> Synthesizing...</div>';
        } else if (!hasDictation && !hasSummary) {
            html += '<div class="reasoning-placeholder">';
            html += '<p>&#128173; <strong>Assessment pending</strong></p>';
            html += '<p>Dictate your clinical reasoning to activate the AI copilot.</p>';
            html += '</div>';
        } else {
            // Assessment
            if (hasSummary) {
                html += '<div class="reasoning-block">';
                html += '<div class="reasoning-label">ASSESSMENT</div>';
                html += '<div class="reasoning-text">' + this.formatText(this.state.summary) + '</div>';
                html += '</div>';
            }

            // Key Considerations
            if (this.state.keyConsiderations && this.state.keyConsiderations.length > 0) {
                html += '<div class="reasoning-block">';
                html += '<div class="reasoning-label">KEY CONSIDERATIONS</div>';
                html += '<div class="reasoning-considerations">';
                this.state.keyConsiderations.forEach(c => {
                    const icon = c.severity === 'critical' ? '&#9888;' : c.severity === 'important' ? '&#10071;' : '&#8226;';
                    const cls = c.severity === 'critical' ? 'consideration-critical' : c.severity === 'important' ? 'consideration-important' : '';
                    html += `<div class="consideration ${cls}">${icon} ${this.escapeHtml(c.text)}</div>`;
                });
                html += '</div></div>';
            }

            // Trajectory / Thinking
            if (hasThinking) {
                html += '<div class="reasoning-block">';
                html += '<div class="reasoning-label">TRAJECTORY</div>';
                html += '<div class="reasoning-text">' + this.formatText(this.state.thinking) + '</div>';
                html += '</div>';
            }

            // Doctor's dictation (collapsed summary)
            if (hasDictation) {
                html += '<div class="reasoning-block dictation-block">';
                html += '<div class="reasoning-label">&#127897; YOUR THOUGHTS</div>';
                html += '<div class="reasoning-text dictation-text">' + this.formatText(this.state.dictation) + '</div>';
                html += '</div>';
            }
        }

        html += '</div></div>';
        return html;
    },

    renderNextSteps() {
        // Combine LLM suggested actions with score-tracker-driven suggestions
        const suggestions = [];

        // LLM-generated suggestions
        if (this.state.suggestedActions && this.state.suggestedActions.length > 0) {
            this.state.suggestedActions.slice(0, 5).forEach((action, index) => {
                const text = typeof action === 'string' ? action : action.text;
                suggestions.push({ text, source: 'ai', index, domain: this._inferDomain(text) });
            });
        }

        // If no LLM suggestions, use score tracker nudges as fallback
        if (suggestions.length === 0 && typeof SimulationScoreTracker !== 'undefined') {
            const nudges = SimulationScoreTracker.getTopNudges(5);
            nudges.forEach(n => {
                suggestions.push({ text: n.text, source: 'tracker', domain: n.domain, action: n.action, domainColor: n.domainColor });
            });
        }

        if (suggestions.length === 0) return '';

        let html = '<div class="copilot-section nextsteps-section">';
        html += '<div class="copilot-section-header"><span>&#128161;</span> Next Steps</div>';
        html += '<div class="copilot-section-body"><div class="nextsteps-list">';

        suggestions.forEach((s, i) => {
            const domainColor = s.domainColor || this._domainColor(s.domain);
            html += '<div class="nextstep-item">';
            html += `<span class="nextstep-domain" style="background:${domainColor}">${s.domain}</span>`;
            html += `<span class="nextstep-text">${this.escapeHtml(s.text)}</span>`;
            if (s.source === 'ai') {
                html += `<button class="nextstep-do" onclick="AICoworker.executeAction(${s.index})" title="Do this">&#9654;</button>`;
                html += `<button class="nextstep-dismiss" onclick="AICoworker.dismissAction(${s.index})" title="Dismiss">&times;</button>`;
            } else if (s.action) {
                html += `<button class="nextstep-go" onclick="window.location.hash='${s.action}'" title="Go">&#10132;</button>`;
            }
            html += '</div>';
        });

        html += '</div></div></div>';
        return html;
    },

    _inferDomain(text) {
        const t = text.toLowerCase();
        if (t.includes('order') || t.includes('furosemide') || t.includes('diure') || t.includes('oxygen') || t.includes('telemetry')) return 'Orders';
        if (t.includes('ask patient') || t.includes('history')) return 'Patient';
        if (t.includes('nurse') || t.includes('urine')) return 'Nurse';
        if (t.includes('review') || t.includes('check') || t.includes('chart') || t.includes('allergy') || t.includes('note')) return 'Chart';
        return 'Clinical';
    },

    _domainColor(domain) {
        const colors = { Orders: '#f59e0b', Patient: '#3b82f6', Nurse: '#8b5cf6', Chart: '#10b981', Clinical: '#6b7280' };
        return colors[domain] || '#6b7280';
    },

    renderQuickActions() {
        let html = '<div class="copilot-quick-actions">';
        html += '<button class="quick-action-btn" onclick="AICoworker.openDictationModal()"><span>&#127897;</span> Dictate</button>';
        html += '<button class="quick-action-btn" onclick="AICoworker.openAskModal()"><span>&#128172;</span> Ask AI</button>';
        html += '<button class="quick-action-btn" onclick="AICoworker.openNoteModal()"><span>&#128221;</span> Write Note</button>';
        html += '<button class="quick-action-btn" onclick="AICoworker.showScoreSummary()"><span>&#128202;</span> Score</button>';
        html += '</div>';
        return html;
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

    /**
     * Show score summary in-panel (mini debrief)
     */
    showScoreSummary() {
        if (typeof SimulationScoreTracker === 'undefined') {
            App.showToast('Score tracker not available', 'error');
            return;
        }
        const progress = SimulationScoreTracker.getProgressSummary();
        const domains = ['patientHistory', 'nurseInteraction', 'chartReview', 'orders', 'safety', 'empathy'];

        let html = '<div class="score-summary-modal">';
        html += '<div class="score-summary-header">';
        html += '<h3>Performance Score</h3>';
        html += '<button class="score-close-btn" onclick="document.getElementById(\'score-summary-overlay\').remove()">&#10005;</button>';
        html += '</div>';
        html += `<div class="score-overall"><span class="score-number">${progress.overall}%</span><span class="score-label">Overall</span></div>`;
        html += '<div class="score-domains">';
        domains.forEach(key => {
            const d = progress[key];
            const pct = d.percentage === -1 ? 0 : d.percentage;
            const barClass = d.percentage === -1 ? 'bar-na' : pct >= 66 ? 'bar-good' : pct >= 33 ? 'bar-mid' : 'bar-low';
            html += '<div class="score-domain-row">';
            html += `<span class="score-domain-label">${d.fullLabel}</span>`;
            html += `<div class="score-bar-track"><div class="score-bar-fill ${barClass}" style="width:${pct}%"></div></div>`;
            html += `<span class="score-domain-pct">${d.percentage === -1 ? '--' : d.percentage + '%'}</span>`;
            html += '</div>';
        });
        html += '</div>';
        html += '<div class="score-actions">';
        if (typeof SimulationDebrief !== 'undefined') {
            html += '<button class="btn btn-sm" onclick="document.getElementById(\'score-summary-overlay\').remove(); SimulationDebrief.show();">Full Debrief</button>';
        }
        html += '</div></div>';

        // Create overlay
        const overlay = document.createElement('div');
        overlay.id = 'score-summary-overlay';
        overlay.className = 'score-summary-overlay';
        overlay.innerHTML = html;
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.remove();
        });
        document.body.appendChild(overlay);
    },

    // ==================== Modals ====================

    openAskModal() {
        const modal = document.getElementById('ai-ask-modal');
        if (modal) {
            modal.classList.add('visible');
            document.getElementById('ai-ask-input').focus();
        }
    },

    closeAskModal() {
        const modal = document.getElementById('ai-ask-modal');
        if (modal) {
            modal.classList.remove('visible');
            document.getElementById('ai-ask-input').value = '';
        }
    },

    openAddTask() {
        const modal = document.getElementById('ai-task-modal');
        if (modal) {
            modal.classList.add('visible');
            document.getElementById('ai-task-input').focus();
        }
    },

    closeAddTask() {
        const modal = document.getElementById('ai-task-modal');
        if (modal) {
            modal.classList.remove('visible');
            document.getElementById('ai-task-input').value = '';
        }
    },

    submitAsk() {
        const input = document.getElementById('ai-ask-input');
        const question = input.value.trim();
        if (!question) return;

        // Close the ask modal first
        this.closeAskModal();

        // Use the Claude extension integration
        this.askClaudeAbout(question);
    },

    quickAsk(type) {
        const questions = {
            'summarize': 'Please summarize what I\'ve found so far in this case.',
            'missing': 'What aspects of this case haven\'t I reviewed yet?',
            'history': 'What relevant history should I be aware of for this patient?'
        };
        document.getElementById('ai-ask-input').value = questions[type] || '';
    },

    submitTask() {
        const input = document.getElementById('ai-task-input');
        const taskText = input.value.trim();
        if (!taskText) return;

        if (!this.state.tasks) this.state.tasks = [];
        this.state.tasks.push({ text: taskText, done: false });
        this.saveState();
        this.render();
        this.closeAddTask();
        App.showToast('Task added', 'success');
    },

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

    /**
     * Local synthesis when Claude is not available
     * Provides immediate feedback by combining doctor's thoughts with existing AI state
     * Updates Summary, Thinking, AND Suggested Actions based on dictation
     */
    localThinkingSynthesis(doctorThoughts) {
        // Extract key phrases from doctor's input
        const lowerThoughts = doctorThoughts.toLowerCase();

        // ===== BUILD UPDATED THINKING =====
        let newThinking = '';
        let workingDiagnosis = '';
        let triggers = [];
        let keyDecisions = [];
        let planItems = [];

        // Detect key symptoms/findings that modify differential
        const hasChestPain = lowerThoughts.includes('chest pain') || lowerThoughts.includes(' cp ') || lowerThoughts.includes('angina') || lowerThoughts.includes('chest pressure') || lowerThoughts.includes('substernal');
        const hasDyspnea = lowerThoughts.includes('dyspnea') || lowerThoughts.includes('sob') || lowerThoughts.includes('short of breath') || lowerThoughts.includes('breathing');
        const hasEdema = lowerThoughts.includes('edema') || lowerThoughts.includes('swelling') || lowerThoughts.includes('wet') || lowerThoughts.includes('jvd');
        const hasFever = lowerThoughts.includes('fever') || lowerThoughts.includes('febrile') || lowerThoughts.includes('temp');
        const hasIschemia = lowerThoughts.includes('ischemi') || lowerThoughts.includes('st change') || lowerThoughts.includes('ekg change') || lowerThoughts.includes('troponin');
        const hasCHF = lowerThoughts.includes('chf') || lowerThoughts.includes('heart failure');
        const hasACS = lowerThoughts.includes('acs') || lowerThoughts.includes(' mi ') || lowerThoughts.includes('stemi') || lowerThoughts.includes('nstemi') || lowerThoughts.includes('infarct');

        // Debug log to help diagnose
        console.log('AI Synthesis - Detected:', { hasChestPain, hasIschemia, hasCHF, hasACS, hasEdema, text: lowerThoughts.substring(0, 100) });

        // Track if we need ischemic workup
        let needsIschemicWorkup = false;

        // Identify working diagnosis with nuanced differentials
        if (hasCHF) {
            // CHF - check for ischemic trigger
            if (hasChestPain || hasIschemia || hasACS) {
                workingDiagnosis = 'CHF exacerbation, possibly triggered by ischemia';
                newThinking += 'Doctor suspects **CHF exacerbation, possibly triggered by new ischemic event**. ';
                triggers.push('possible ischemia');
                needsIschemicWorkup = true;
                console.log('AI Synthesis - CHF with ischemic trigger detected');
            } else if (lowerThoughts.includes('arrhythmia') || lowerThoughts.includes('afib') || lowerThoughts.includes('rvr')) {
                workingDiagnosis = 'CHF exacerbation, triggered by arrhythmia';
                newThinking += 'Doctor suspects **CHF exacerbation triggered by arrhythmia**. ';
                triggers.push('arrhythmia');
            } else {
                workingDiagnosis = 'CHF exacerbation';
                newThinking += 'Doctor has confirmed **CHF exacerbation** as the working diagnosis. ';
            }
        } else if (hasEdema) {
            // Volume overload without explicit CHF
            if (hasChestPain || hasIschemia) {
                workingDiagnosis = 'Volume overload with possible ischemic trigger';
                newThinking += 'Doctor notes **volume overload with concern for ischemia**. ';
                needsIschemicWorkup = true;
            } else {
                workingDiagnosis = 'Volume overload';
                newThinking += 'Doctor notes **volume overload**. ';
            }
        } else if (hasChestPain && !lowerThoughts.includes('non-cardiac') && !lowerThoughts.includes('msk') && !lowerThoughts.includes('musculoskeletal')) {
            // Chest pain without explicit CHF - consider cardiac causes
            if (hasACS || hasIschemia) {
                workingDiagnosis = 'ACS';
                newThinking += 'Doctor is evaluating for **acute coronary syndrome**. ';
                needsIschemicWorkup = true;
            } else {
                workingDiagnosis = 'Chest pain - cardiac workup indicated';
                newThinking += 'Doctor is working up **chest pain** - ruling out cardiac etiology. ';
                needsIschemicWorkup = true;
            }
        } else if (hasACS) {
            workingDiagnosis = 'ACS';
            newThinking += 'Doctor is evaluating for **acute coronary syndrome**. ';
            needsIschemicWorkup = true;
        } else if (lowerThoughts.includes('sepsis') || lowerThoughts.includes('infection')) {
            workingDiagnosis = 'Sepsis/Infection';
            newThinking += 'Doctor is considering **infectious etiology**. ';
        } else if (lowerThoughts.includes('copd') || lowerThoughts.includes('asthma') || lowerThoughts.includes('bronch')) {
            workingDiagnosis = 'COPD/Asthma exacerbation';
            newThinking += 'Doctor is treating **respiratory exacerbation**. ';
        } else if (lowerThoughts.includes('pneumonia') || lowerThoughts.includes('pna')) {
            workingDiagnosis = 'Pneumonia';
            newThinking += 'Doctor suspects **pneumonia**. ';
        } else if (lowerThoughts.includes('pe') || lowerThoughts.includes('pulmonary embolism') || lowerThoughts.includes('embolus')) {
            workingDiagnosis = 'Pulmonary embolism';
            newThinking += 'Doctor is evaluating for **pulmonary embolism**. ';
        }

        // Identify triggers/causes
        if (lowerThoughts.includes('diet') || lowerThoughts.includes('salt') || lowerThoughts.includes('sodium') || lowerThoughts.includes('salty')) {
            triggers.push('dietary indiscretion');
            newThinking += 'Dietary indiscretion identified as trigger. ';
        }
        if (lowerThoughts.includes('missed') || lowerThoughts.includes('non-compliance') || lowerThoughts.includes('noncompliance') || lowerThoughts.includes('not taking')) {
            triggers.push('medication non-adherence');
            newThinking += 'Medication non-adherence contributing. ';
        }
        if ((lowerThoughts.includes('arrhythmia') || lowerThoughts.includes('afib') || lowerThoughts.includes('a-fib') || lowerThoughts.includes('rvr')) && !triggers.includes('arrhythmia')) {
            triggers.push('arrhythmia');
        }
        if (hasChestPain && !triggers.includes('possible ischemia')) {
            triggers.push('chest pain - needs cardiac workup');
            needsIschemicWorkup = true;
        }

        // Handle anticoagulation decision (key scenario)
        if (lowerThoughts.includes('anticoagulat') || lowerThoughts.includes('blood thinner') || lowerThoughts.includes('coumadin') || lowerThoughts.includes('eliquis') || lowerThoughts.includes('xarelto')) {
            if (lowerThoughts.includes('not') || lowerThoughts.includes("won't") || lowerThoughts.includes('hold') || lowerThoughts.includes('avoid') || lowerThoughts.includes("don't")) {
                keyDecisions.push('No anticoagulation');
                newThinking += '**Key decision: Doctor has decided against anticoagulation** - ';
                if (this.state.flags && this.state.flags.some(f => f.text.toLowerCase().includes('gi bleed') || f.text.toLowerCase().includes('bleeding'))) {
                    newThinking += 'this aligns with GI recommendations given recent bleed history. ';
                } else {
                    newThinking += 'will monitor for bleeding risk factors. ';
                }
            } else if (lowerThoughts.includes('start') || lowerThoughts.includes('begin') || lowerThoughts.includes('initiate')) {
                keyDecisions.push('Starting anticoagulation');
                newThinking += '**Note: Doctor planning to start anticoagulation** - ';
                if (this.state.flags && this.state.flags.some(f => f.text.toLowerCase().includes('gi bleed') || f.text.toLowerCase().includes('bleeding'))) {
                    newThinking += '⚠️ please review GI bleed history before proceeding. ';
                }
            }
        }

        // Identify plan items from dictation
        if (lowerThoughts.includes('diure') || lowerThoughts.includes('lasix') || lowerThoughts.includes('furosemide') || lowerThoughts.includes('bumex')) {
            planItems.push('Diuresis');
            newThinking += 'Plan includes diuresis. ';
        }
        if (lowerThoughts.includes('consult') || lowerThoughts.includes('cards') || lowerThoughts.includes('cardiology')) {
            planItems.push('Cardiology consult');
            newThinking += 'Cardiology involvement planned. ';
        }
        if (lowerThoughts.includes('echo') || lowerThoughts.includes('echocardiogram')) {
            planItems.push('Echocardiogram');
        }
        if (lowerThoughts.includes('cath') || lowerThoughts.includes('angiogram')) {
            planItems.push('Cardiac catheterization');
        }
        if (lowerThoughts.includes('ekg') || lowerThoughts.includes('ecg') || lowerThoughts.includes('12 lead') || lowerThoughts.includes('12-lead')) {
            planItems.push('EKG');
        }
        if (lowerThoughts.includes('troponin') || lowerThoughts.includes('cardiac enzyme') || lowerThoughts.includes('cardiac marker')) {
            planItems.push('Troponins');
        }
        if (lowerThoughts.includes('stress') || lowerThoughts.includes('perfusion') || lowerThoughts.includes('nuclear') || lowerThoughts.includes('mibi')) {
            planItems.push('Stress/perfusion testing');
        }
        if (lowerThoughts.includes('antibiotic') || lowerThoughts.includes('abx')) {
            planItems.push('Antibiotics');
        }
        if (lowerThoughts.includes('steroid') || lowerThoughts.includes('prednisone') || lowerThoughts.includes('solumedrol')) {
            planItems.push('Steroids');
        }
        if (lowerThoughts.includes('bipap') || lowerThoughts.includes('cpap') || lowerThoughts.includes('niv') || lowerThoughts.includes('high flow')) {
            planItems.push('Respiratory support');
        }
        if (lowerThoughts.includes('admit') || lowerThoughts.includes('admission')) {
            planItems.push('Hospital admission');
        }
        if (lowerThoughts.includes('icu') || lowerThoughts.includes('intensive care')) {
            planItems.push('ICU admission');
        }

        // Detect "ischemic workup" explicitly mentioned
        if (lowerThoughts.includes('ischemic workup') || lowerThoughts.includes('cardiac workup') || lowerThoughts.includes('rule out acs') || lowerThoughts.includes('r/o acs')) {
            needsIschemicWorkup = true;
            if (!planItems.includes('Ischemic workup')) {
                planItems.push('Ischemic workup');
            }
        }

        // If ischemic workup needed, add to plan thinking
        if (needsIschemicWorkup) {
            newThinking += 'Ischemic workup indicated given presentation. ';
            // Add ischemic workup to plan if not already there
            if (!planItems.some(p => p.toLowerCase().includes('ischemic') || p.toLowerCase().includes('ekg') || p.toLowerCase().includes('troponin'))) {
                planItems.push('Ischemic workup');
            }
        }

        // Add supporting observations if relevant
        if (this.state.observations && this.state.observations.length > 0) {
            const relevantObs = this.state.observations.find(o =>
                o.toLowerCase().includes('bnp') ||
                o.toLowerCase().includes('creatinine') ||
                o.toLowerCase().includes('missed')
            );
            if (relevantObs) {
                newThinking += 'Supporting data: ' + relevantObs.split(':')[0] + '. ';
            }
        }

        // ===== BUILD UPDATED SUMMARY =====
        let newSummary = this.state.summary || '';
        if (workingDiagnosis) {
            // Update summary to reflect doctor's diagnosis
            const patientInfo = this.state.chartData?.patientInfo;
            const age = patientInfo?.age || '72';
            const name = patientInfo?.name || 'Patient';

            newSummary = `${age}yo presenting with **${workingDiagnosis}**`;
            if (triggers.length > 0) {
                newSummary += ` triggered by ${triggers.join(' and ')}`;
            }
            newSummary += '. ';
            if (keyDecisions.length > 0) {
                newSummary += `Key decision: **${keyDecisions.join(', ')}**. `;
            }
            if (planItems.length > 0) {
                newSummary += `Plan: ${planItems.slice(0, 3).join(', ')}.`;
            }
        }

        // ===== BUILD UPDATED SUGGESTED ACTIONS =====
        let newSuggestions = [];

        // Add ischemic workup suggestions if needed
        if (needsIschemicWorkup) {
            if (!planItems.includes('EKG') && !this.state.reviewed?.some(r => r.toLowerCase().includes('ekg') || r.toLowerCase().includes('ecg'))) {
                newSuggestions.push('Stat EKG to evaluate for ischemia');
            }
            if (!planItems.includes('Troponins')) {
                newSuggestions.push('Serial troponins (q6h x3)');
            }
            if (!planItems.includes('Stress/perfusion testing') && !planItems.includes('Cardiac catheterization')) {
                newSuggestions.push('Consider stress test or perfusion imaging if troponins negative');
            }
        }

        // Add suggestions based on diagnosis
        if (workingDiagnosis.includes('CHF')) {
            if (!planItems.includes('Diuresis')) {
                newSuggestions.push('Start IV diuresis (furosemide 40mg IV)');
            }
            newSuggestions.push('Check BMP in AM for electrolytes and renal function');
            newSuggestions.push('Order daily weights and strict I/Os');
            if (!planItems.includes('Echocardiogram') && !this.state.reviewed?.some(r => r.toLowerCase().includes('echo'))) {
                newSuggestions.push('Consider TTE to assess current EF');
            }
        } else if (workingDiagnosis === 'Sepsis/Infection') {
            newSuggestions.push('Obtain blood cultures x2');
            newSuggestions.push('Start empiric antibiotics');
            newSuggestions.push('IV fluid resuscitation');
            newSuggestions.push('Lactate level');
        } else if (workingDiagnosis === 'ACS' || workingDiagnosis.includes('Chest pain')) {
            if (!newSuggestions.some(s => s.includes('troponin'))) {
                newSuggestions.push('Serial troponins q6h');
            }
            if (!planItems.includes('Cardiology consult')) {
                newSuggestions.push('Cardiology consult for cath consideration');
            }
            newSuggestions.push('Continuous telemetry monitoring');
            // Check for bleeding risk before antiplatelet
            if (this.state.flags && this.state.flags.some(f => f.text.toLowerCase().includes('bleed'))) {
                newSuggestions.push('Review bleeding history before antiplatelet therapy');
            } else {
                newSuggestions.push('Start antiplatelet therapy if not contraindicated');
            }
        } else if (workingDiagnosis === 'Pulmonary embolism') {
            newSuggestions.push('CT angiogram chest');
            newSuggestions.push('D-dimer if low pretest probability');
            newSuggestions.push('Start anticoagulation if confirmed (check bleeding risk)');
        }

        // Add suggestions based on open items
        if (this.state.openItems && this.state.openItems.length > 0) {
            this.state.openItems.forEach(item => {
                if (item.toLowerCase().includes('code status') && !newSuggestions.some(s => s.toLowerCase().includes('code'))) {
                    newSuggestions.push('Discuss code status with patient/family');
                }
            });
        }

        // Add safety-related suggestions based on flags
        if (this.state.flags && this.state.flags.length > 0) {
            this.state.flags.forEach(flag => {
                if (flag.text.toLowerCase().includes('gi bleed') && !keyDecisions.includes('No anticoagulation')) {
                    if (!newSuggestions.some(s => s.includes('bleed'))) {
                        newSuggestions.push('Document bleeding history before any anticoagulation');
                    }
                }
                if (flag.text.toLowerCase().includes('ckd') || flag.text.toLowerCase().includes('renal')) {
                    if (!newSuggestions.some(s => s.includes('renal'))) {
                        newSuggestions.push('Adjust medications for renal function');
                    }
                }
            });
        }

        // Add follow-through items from plan mentioned in dictation
        if (planItems.includes('Cardiology consult') && !this.state.reviewed?.some(r => r.toLowerCase().includes('cardiology'))) {
            if (!newSuggestions.some(s => s.toLowerCase().includes('cardiology'))) {
                newSuggestions.push('Place cardiology consult order');
            }
        }

        // ===== BUILD KEY CONSIDERATIONS =====
        let newKeyConsiderations = [];

        // Pull from safety flags
        if (this.state.flags && this.state.flags.length > 0) {
            this.state.flags.forEach(f => {
                newKeyConsiderations.push({
                    text: f.text,
                    severity: f.severity || 'critical'
                });
            });
        }

        // Add allergy-related considerations
        if (typeof PatientHeader !== 'undefined' && PatientHeader.patient?.allergies) {
            const allergies = PatientHeader.patient.allergies;
            allergies.forEach(a => {
                const name = typeof a === 'string' ? a : (a.allergen || a.name || '');
                const reaction = typeof a === 'object' ? (a.reaction || '') : '';
                if (name && reaction && (reaction.toLowerCase().includes('anaphylaxis') || reaction.toLowerCase().includes('angioedema'))) {
                    newKeyConsiderations.push({
                        text: `${name} allergy (${reaction}) — avoid related medications`,
                        severity: 'critical'
                    });
                }
            });
        }

        // Add considerations based on detected patterns
        if (needsIschemicWorkup) {
            newKeyConsiderations.push({
                text: 'Ischemic workup indicated — serial troponins and EKG monitoring',
                severity: 'important'
            });
        }

        if (keyDecisions.includes('No anticoagulation')) {
            newKeyConsiderations.push({
                text: 'Anticoagulation held per doctor decision — monitor closely',
                severity: 'important'
            });
        }

        // Deduplicate by text
        const seen = new Set();
        newKeyConsiderations = newKeyConsiderations.filter(c => {
            const key = c.text.toLowerCase().substring(0, 40);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });

        // ===== UPDATE STATE =====
        // Update thinking
        if (newThinking.length > 50) {
            this.state.thinking = newThinking.trim();
        } else {
            this.state.thinking = `Doctor's assessment: "${doctorThoughts.substring(0, 150)}${doctorThoughts.length > 150 ? '...' : ''}"`;
        }

        // Update summary if we built a meaningful one
        if (newSummary && newSummary.length > 30 && workingDiagnosis) {
            this.state.summary = newSummary.trim();
        }

        // Update key considerations
        if (newKeyConsiderations.length > 0) {
            this.state.keyConsiderations = newKeyConsiderations.slice(0, 6);
        }

        // Update suggested actions
        if (newSuggestions.length > 0) {
            const uniqueSuggestions = [...new Set(newSuggestions)].slice(0, 5);
            this.state.suggestedActions = uniqueSuggestions.map((text, idx) => ({
                id: 'dictation_action_' + idx,
                text: text
            }));
        }

        this.state.status = 'ready';
        this.saveState();
        this.render();
    },

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
        if (typeof PatientHeader !== 'undefined' && PatientHeader.patient) {
            chartData.patientInfo = PatientHeader.patient;
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

        // Get nursing notes from SimulationEngine if available
        if (typeof SimulationEngine !== 'undefined') {
            chartData.nursingNotes = SimulationEngine.nursingNotes || [];
        }

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

        // Build context - use full longitudinal context + specific note prompt
        const clinicalContext = this.buildFullClinicalContext();
        const notePrompt = this.buildNotePrompt(noteType, includeSources, instructions);

        const systemPrompt = `You are a physician writing a clinical note in an EHR system. Write a professional, thorough clinical note based on the patient data provided. Use standard medical documentation conventions.

Write the note in plain text with clear section headers. Do NOT use markdown formatting like ** or #. Use UPPERCASE for section headers followed by a colon.

IMPORTANT:
- Be thorough but concise - include clinically relevant details
- Use the patient's actual data from the clinical context
- Include the patient and nurse conversation data if relevant to the clinical picture
- Structure the note according to the requested format
- Write as if you are the attending physician documenting the encounter`;

        const userMessage = `## Full Clinical Context
${clinicalContext}

## Note Request
${notePrompt}`;

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
        const patientName = window.PatientHeader?.patient?.name || 'Unknown Patient';

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

    /**
     * Local refresh analysis when Claude is not available
     */
    localRefreshAnalysis() {
        const lowerDictation = (this.state.dictation || '').toLowerCase();

        // Build updated thinking based on current state
        let newThinking = '';
        let newSuggestions = [];

        // Analyze based on dictation content
        if (lowerDictation.includes('chf') || lowerDictation.includes('heart failure') || lowerDictation.includes('volume overload')) {
            newThinking += 'Working diagnosis: **CHF exacerbation**. ';

            // Check for triggers mentioned
            if (lowerDictation.includes('diet') || lowerDictation.includes('salt')) {
                newThinking += 'Dietary indiscretion identified as trigger. ';
            }
            if (lowerDictation.includes('missed') || lowerDictation.includes('compliance')) {
                newThinking += 'Medication non-adherence contributing. ';
            }

            // Suggest diuresis if not already mentioned
            if (!this.state.reviewed?.some(r => r.toLowerCase().includes('diure') || r.toLowerCase().includes('lasix'))) {
                newSuggestions.push('Consider IV diuresis with furosemide');
            }
            newSuggestions.push('Monitor daily weights and I/Os');
            newSuggestions.push('Recheck BMP in AM for electrolytes');
        }

        // Check for anticoagulation decision
        if (lowerDictation.includes('anticoagulat') || lowerDictation.includes('a-fib') || lowerDictation.includes('afib')) {
            if (lowerDictation.includes('not') || lowerDictation.includes("won't") || lowerDictation.includes('hold')) {
                newThinking += '**Doctor has decided against anticoagulation**';
                if (this.state.flags?.some(f => f.text.toLowerCase().includes('bleed'))) {
                    newThinking += ' - aligns with bleeding history. ';
                } else {
                    newThinking += '. ';
                }
            }
        }

        // Add suggestions based on open items
        if (this.state.openItems && this.state.openItems.length > 0) {
            this.state.openItems.forEach(item => {
                if (item.toLowerCase().includes('echo')) {
                    newSuggestions.push('Order echocardiogram to assess current EF');
                }
                if (item.toLowerCase().includes('code status')) {
                    newSuggestions.push('Discuss code status with patient/family');
                }
            });
        }

        // Add suggestions based on flags
        if (this.state.flags && this.state.flags.length > 0) {
            this.state.flags.forEach(flag => {
                if (flag.text.toLowerCase().includes('gi bleed') && !newSuggestions.some(s => s.includes('GI'))) {
                    newSuggestions.push('Document GI bleed history in anticoagulation decision');
                }
            });
        }

        // Check labs for actionable items
        if (this.state.chartData.labs) {
            const cr = this.state.chartData.labs.find(l => l.name.toLowerCase().includes('creatinine'));
            if (cr && parseFloat(cr.value) > 1.5) {
                newThinking += 'Noting elevated creatinine - monitor renal function with diuresis. ';
                if (!newSuggestions.some(s => s.includes('renal'))) {
                    newSuggestions.push('Monitor creatinine closely with diuresis');
                }
            }
        }

        // Add cardiology consult if heart failure and not already done
        if ((lowerDictation.includes('chf') || lowerDictation.includes('heart failure')) &&
            !this.state.reviewed?.some(r => r.toLowerCase().includes('cardiology'))) {
            if (!newSuggestions.some(s => s.includes('cardiology'))) {
                newSuggestions.push('Consider cardiology consult');
            }
        }

        // Update state if we generated meaningful content
        if (newThinking.length > 30) {
            this.state.thinking = newThinking.trim();
        }

        if (newSuggestions.length > 0) {
            // Deduplicate and limit to 5
            const uniqueSuggestions = [...new Set(newSuggestions)].slice(0, 5);
            this.state.suggestedActions = uniqueSuggestions.map((text, idx) => ({
                id: 'local_refresh_' + idx,
                text: text
            }));
        }

        this.state.status = 'ready';
        this.state.lastUpdated = new Date().toISOString();
        this.saveState();
        this.render();
    },

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
        // Build current clinical context
        const clinicalContext = this.buildFullClinicalContext();

        // Add header showing which context type is being used
        const contextType = (this.useLongitudinalContext && this.longitudinalDoc)
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
            dictationHistory: this.state.dictationHistory?.slice(-3) || [],
            patientConversation: (window.PatientChat?.messages || []).slice(-20).map(m => ({
                role: m.role === 'user' ? 'doctor' : 'patient',
                content: m.content
            })),
            nurseConversation: (window.NurseChat?.messages || []).slice(-20).map(m => ({
                role: m.role === 'user' ? 'doctor' : 'nurse',
                content: m.content
            }))
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
    : 'None'}

## Patient Interview (Recent)
${ctx.patientConversation.length > 0
    ? ctx.patientConversation.map(m => `${m.role === 'doctor' ? 'Doctor' : 'Patient'}: ${m.content}`).join('\n')
    : 'No patient conversation yet'}

## Nurse Communication (Recent)
${ctx.nurseConversation.length > 0
    ? ctx.nurseConversation.map(m => `${m.role === 'doctor' ? 'Doctor' : 'Nurse'}: ${m.content}`).join('\n')
    : 'No nurse conversation yet'}`;

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

        const systemPrompt = `You are an AI clinical assistant helping a physician manage a patient case. You maintain a durable "living memory" of this patient that persists across interactions.

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

        const clinicalContext = this.buildFullClinicalContext();

        const userMessage = `## Current Clinical Context
${clinicalContext}

## Doctor's Current Assessment/Thoughts
"${doctorThoughts}"

Based on the doctor's thoughts and the clinical context above, provide an updated synthesis. Update the trajectory assessment, key findings, and open questions based on this new information.`;

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

            this.state.status = 'ready';
            this.saveState();
            this.render();
            App.showToast('AI synthesis updated', 'success');

        } catch (error) {
            console.error('LLM synthesis error:', error);

            if (error.message === 'API key not configured') {
                console.warn('⚠️ API key not configured - falling back to LOCAL/RULES-BASED synthesis');
                this.localThinkingSynthesis(doctorThoughts);
            } else {
                this.state.status = 'ready';
                this.render();
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

        const systemPrompt = `You are an AI clinical assistant embedded in an EHR system. Analyze this patient case and provide a comprehensive synthesis.

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

        const clinicalContext = this.buildFullClinicalContext();

        const userMessage = `## Clinical Context
${clinicalContext}

${this.state.dictation ? `## Doctor's Current Assessment\n"${this.state.dictation}"` : '## No doctor assessment recorded yet'}

Provide a comprehensive case synthesis. Build a trajectory assessment covering all active problems.`;

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

            this.state.status = 'ready';
            this.state.lastUpdated = new Date().toISOString();
            this.saveState();
            this.render();
            App.showToast('AI analysis refreshed', 'success');

        } catch (error) {
            console.error('LLM refresh error:', error);

            if (error.message === 'API key not configured') {
                // Modal already shown, fall back to local refresh
                console.warn('⚠️ API key not configured - falling back to LOCAL/RULES-BASED refresh');
                this.localRefreshAnalysis();
            } else {
                this.state.status = 'ready';
                this.render();
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

        // Show response modal in loading state
        this.openResponseModal(item, null);

        const clinicalContext = this.buildFullClinicalContext();

        const systemPrompt = `You are an AI clinical assistant helping a physician. Answer their question or help with their task using the clinical context provided. Be concise, clinically relevant, and actionable. Use plain text, not markdown.`;

        const userMessage = `## Clinical Context
${clinicalContext}

## Physician's Request
${item}`;

        try {
            const response = await this.callLLM(systemPrompt, userMessage, 2048);
            this.openResponseModal(item, response);
        } catch (error) {
            if (error.message === 'API key not configured') {
                this.closeResponseModal();
            } else {
                this.openResponseModal(item, 'Error: ' + error.message);
                App.showToast('Error: ' + error.message, 'error');
            }
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

    // ==================== AI Response Modal ====================

    openResponseModal(question, content) {
        let modal = document.getElementById('ai-response-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'ai-response-modal';
            modal.className = 'ai-modal';
            document.body.appendChild(modal);
        }

        const isLoading = content === null;

        modal.innerHTML = `
            <div class="ai-modal-content note-editor-modal">
                <div class="ai-modal-header">
                    <h3>AI Response</h3>
                    <button onclick="AICoworker.closeResponseModal()">×</button>
                </div>
                <div class="ai-modal-body note-editor-body">
                    <div class="response-question">${this.escapeHtml(question)}</div>
                    ${isLoading
                        ? '<div class="note-generating"><div class="ai-assistant-spinner"></div><span>Thinking...</span></div>'
                        : '<div class="ai-response-content" id="ai-response-text"></div>'
                    }
                </div>
                <div class="ai-modal-footer">
                    <button class="btn btn-secondary" onclick="AICoworker.closeResponseModal()">Close</button>
                    <button class="btn btn-secondary" onclick="AICoworker.copyResponseToClipboard()" ${isLoading ? 'disabled' : ''}>Copy</button>
                </div>
            </div>
        `;

        modal.classList.add('visible');

        if (!isLoading && content) {
            const el = document.getElementById('ai-response-text');
            if (el) el.textContent = content;
        }
    },

    closeResponseModal() {
        const modal = document.getElementById('ai-response-modal');
        if (modal) modal.classList.remove('visible');
    },

    copyResponseToClipboard() {
        const el = document.getElementById('ai-response-text');
        if (!el) return;
        navigator.clipboard.writeText(el.textContent).then(() => {
            App.showToast('Response copied to clipboard', 'success');
        });
    },

    /**
     * Fallback: Copy prompt to clipboard and notify user (legacy)
     */
    copyToClipboardAndNotify(prompt, item) {
        navigator.clipboard.writeText(prompt).then(() => {
            App.showToast('📋 Copied to clipboard - paste into Claude', 'info', 4000);

            // Also show a more detailed modal
            this.showClaudeHelperModal(item, prompt);
        }).catch(() => {
            // If clipboard fails, just show the modal
            this.showClaudeHelperModal(item, prompt);
        });
    },

    /**
     * Show modal with instructions for using Claude
     */
    showClaudeHelperModal(item, prompt) {
        // Check if modal already exists
        let modal = document.getElementById('claude-helper-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'claude-helper-modal';
            modal.className = 'ai-modal';
            modal.innerHTML = `
                <div class="ai-modal-content">
                    <div class="ai-modal-header">
                        <h3>🤖 Ask Claude</h3>
                        <button onclick="AICoworker.closeClaudeHelperModal()">×</button>
                    </div>
                    <div class="ai-modal-body">
                        <p class="ai-modal-hint">The prompt has been copied to your clipboard. You can:</p>
                        <div class="claude-helper-options">
                            <a href="https://claude.ai/new" target="_blank" class="claude-option-btn">
                                <span class="option-icon">💬</span>
                                <span class="option-text">Open Claude.ai</span>
                            </a>
                            <button onclick="AICoworker.openClaudeSidepanel()" class="claude-option-btn">
                                <span class="option-icon">📌</span>
                                <span class="option-text">Open Extension Sidepanel</span>
                            </button>
                        </div>
                        <div class="claude-prompt-preview">
                            <label>Prompt (already copied):</label>
                            <textarea id="claude-prompt-text" readonly rows="6"></textarea>
                        </div>
                    </div>
                    <div class="ai-modal-footer">
                        <button class="btn btn-secondary" onclick="AICoworker.closeClaudeHelperModal()">Close</button>
                        <button class="btn btn-primary" onclick="AICoworker.copyPromptAgain()">📋 Copy Again</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
        }

        // Update prompt text
        document.getElementById('claude-prompt-text').value = prompt;
        modal.classList.add('visible');
    },

    closeClaudeHelperModal() {
        const modal = document.getElementById('claude-helper-modal');
        if (modal) modal.classList.remove('visible');
    },

    copyPromptAgain() {
        const prompt = document.getElementById('claude-prompt-text').value;
        navigator.clipboard.writeText(prompt).then(() => {
            App.showToast('📋 Copied!', 'success');
        });
    },

    /**
     * Try to open Claude extension sidepanel
     */
    openClaudeSidepanel() {
        // Try keyboard shortcut simulation (Cmd+Shift+P or Ctrl+Shift+P often opens sidepanel)
        // This won't work programmatically, but we can guide the user

        // Try extension-specific APIs
        if (chrome && chrome.runtime && chrome.runtime.sendMessage) {
            // Try to message the extension
            try {
                chrome.runtime.sendMessage('claude-extension-id', { action: 'openSidepanel' });
            } catch (e) {
                // Extension not available
            }
        }

        App.showToast('Press Cmd+Shift+. to open Claude sidepanel', 'info', 5000);
    },

    // ==================== Panel Controls ====================

    /**
     * Ensure the AI panel is visible and switch to copilot tab
     */
    toggle() {
        if (typeof AIPanel !== 'undefined') {
            if (AIPanel.isCollapsed) {
                AIPanel.expand();
            }
            AIPanel.switchTab('copilot');
        }
    },

    show() {
        this.toggle();
    },

    toggleMinimize() {
        // No-op - panel is now integrated into sidebar
    },

    // ==================== Event Handlers ====================

    onAlert(data) {
        // Add safety-critical alerts as flags
        if (data.priority === 'urgent' || data.priority === 'critical') {
            if (!this.state.flags) this.state.flags = [];
            this.state.flags.unshift({
                text: data.message,
                severity: data.priority,
                timestamp: new Date().toISOString()
            });
            this.state.flags = this.state.flags.slice(0, 5);
            this.saveState();
            this.render();
        }
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
