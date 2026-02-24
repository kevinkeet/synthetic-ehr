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

    // Section collapse state (persisted to localStorage)
    sectionCollapsed: {},

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
        // Load section collapse state from localStorage
        try {
            const saved = localStorage.getItem('copilot-section-collapsed');
            this.sectionCollapsed = saved ? JSON.parse(saved) : {};
        } catch (e) {
            this.sectionCollapsed = {};
        }

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
            aiOneLiner: '', // AI's one-sentence gestalt of the patient
            clinicalSummary: null, // LLM-refined 3-sentence summary {demographics, functional, presentation}
            problemList: [], // Prioritized problem list [{name, urgency, ddx, plan}]
            categorizedActions: null, // Actions by category {communication, labs, imaging, medications, other}
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

        // Sync patient and nurse chat messages into the longitudinal doc
        if (typeof PatientChat !== 'undefined' && PatientChat.messages.length > 0) {
            this.longitudinalDocUpdater.syncPatientConversation(PatientChat.messages);
        }
        if (typeof NurseChat !== 'undefined' && NurseChat.messages.length > 0) {
            this.longitudinalDocUpdater.syncNurseConversation(NurseChat.messages);
        }

        // Detect nurse questions that should become pending decisions
        if (this.longitudinalDoc?.sessionContext?.nurseConversation) {
            const nurseMsgs = this.longitudinalDoc.sessionContext.nurseConversation
                .filter(m => m.role === 'nurse');
            for (const msg of nurseMsgs) {
                if (this._looksLikeQuestion(msg.content)) {
                    this.longitudinalDocUpdater.addPendingDecision(
                        msg.content.substring(0, 200),
                        'From nurse communication',
                        'nurse'
                    );
                }
            }
        }
    },

    /**
     * Check if text looks like a question or request for a decision
     */
    _looksLikeQuestion(text) {
        return /\?|should we|shall I|do you want|can we|what about|requesting|asking about|waiting for|would you like/i.test(text);
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

        // Hydrate one-liner from first sentence of patient summary
        if (mem.patientSummary && !this.state.aiOneLiner) {
            const firstSentence = mem.patientSummary.split(/\.\s/)[0];
            this.state.aiOneLiner = firstSentence + (firstSentence.endsWith('.') ? '' : '.');
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
            // Smart pruning instead of FIFO eviction
            if (narrative.keyFindings.length > 20 && this.longitudinalDocUpdater) {
                this.longitudinalDocUpdater.pruneKeyFindings(20);
            } else if (narrative.keyFindings.length > 20) {
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

        // 6. Process memory classification (active/passive/background tiers)
        if (memUpdates.memoryClassification && this.longitudinalDocUpdater) {
            const mc = memUpdates.memoryClassification;

            // Add pending decisions
            if (mc.pendingDecisions && Array.isArray(mc.pendingDecisions)) {
                for (const pd of mc.pendingDecisions) {
                    this.longitudinalDocUpdater.addPendingDecision(
                        typeof pd === 'string' ? pd : (pd.text || pd),
                        typeof pd === 'object' ? (pd.context || '') : '',
                        typeof pd === 'object' ? (pd.raisedBy || 'ai') : 'ai'
                    );
                }
            }

            // Add active conditions
            if (mc.activeConditions && Array.isArray(mc.activeConditions)) {
                for (const ac of mc.activeConditions) {
                    this.longitudinalDocUpdater.addActiveCondition(
                        typeof ac === 'string' ? ac : ac.text,
                        typeof ac === 'object' ? (ac.trend || 'stable') : 'stable'
                    );
                }
            }

            // Add background facts
            if (mc.backgroundFacts && Array.isArray(mc.backgroundFacts)) {
                for (const bf of mc.backgroundFacts) {
                    this.longitudinalDocUpdater.addBackgroundFact(
                        typeof bf === 'string' ? bf : (bf.text || bf),
                        'ai'
                    );
                }
            }

            // Supersede observations marked as outdated by LLM
            if (mc.supersededObservations && Array.isArray(mc.supersededObservations)) {
                const obsArray = this.longitudinalDoc.sessionContext.aiObservations;
                for (const supersededText of mc.supersededObservations) {
                    const trimmed = supersededText.toLowerCase().trim();
                    const match = obsArray.find(o =>
                        typeof o === 'object' &&
                        o.status === 'active' &&
                        o.text.toLowerCase().trim() === trimmed
                    );
                    if (match) {
                        match.status = 'superseded';
                        console.log('🧹 Superseded observation:', match.text.substring(0, 80));
                    }
                }
            }

            console.log('🧠 Memory classification processed:', {
                pending: mc.pendingDecisions?.length || 0,
                active: mc.activeConditions?.length || 0,
                background: mc.backgroundFacts?.length || 0,
                superseded: mc.supersededObservations?.length || 0
            });
        }

        // 7. Process detected conflicts
        if (memUpdates.conflictsDetected && memUpdates.conflictsDetected.length > 0 && this.longitudinalDocUpdater) {
            for (const conflict of memUpdates.conflictsDetected) {
                this.longitudinalDocUpdater.addConflict({
                    itemA: { text: conflict.description || '', source: 'llm_detected', timestamp: new Date().toISOString() },
                    itemB: { text: '', source: 'llm_detected', timestamp: '' },
                    severity: conflict.severity || 'warning'
                });
            }
            console.log('⚠️ LLM detected', memUpdates.conflictsDetected.length, 'conflict(s)');
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
        // Strip any stale keys that no longer exist in the state schema
        delete this.state.agents;
        delete this.state.agentsCollapsed;
        // We still save to localStorage for within-session persistence
        // but resetSessionState() clears it on next page load
        localStorage.setItem('aiAssistantState', JSON.stringify(this.state));
    },

    /**
     * Update the AI Assistant state
     */
    update(newState) {
        // Strip any stale agent keys that may arrive from old cached callers or localStorage
        if (newState) {
            delete newState.agents;
            delete newState.agentsCollapsed;
        }
        this.state = { ...this.state, ...newState };
        this.state.lastUpdated = new Date().toISOString();
        this.saveState();
        this.render();
    },

    /**
     * Toggle a section's collapsed state and re-render
     */
    toggleSection(sectionId) {
        this.sectionCollapsed[sectionId] = !this.sectionCollapsed[sectionId];
        localStorage.setItem('copilot-section-collapsed', JSON.stringify(this.sectionCollapsed));
        this.render();
    },

    /**
     * Check if a section is collapsed
     */
    isSectionCollapsed(sectionId) {
        return !!this.sectionCollapsed[sectionId];
    },

    /**
     * Render the panel content into the AI panel assistant tab
     */
    render() {
        const body = document.getElementById('assistant-tab-body');
        if (!body) return;

        try {
        let html = '';

        // ===== SECTION 1: SAFETY BAR (sticky top, only when alerts exist) =====
        html += this.renderAlertBar();

        // ===== SECTION 2: CLINICAL SUMMARY (3 sentences) =====
        html += this.renderClinicalSummary();

        // ===== SECTION 4: PROBLEM LIST =====
        html += this.renderProblemList();

        // ===== SECTION 5: SUGGESTED ACTIONS =====
        html += this.renderSuggestedActions();

        // ===== SECTION 6: CONVERSATION THREAD =====
        html += this.renderConversationThread();

        // ===== SECTION 7: INLINE INPUT (sticky bottom) =====
        html += this.renderInlineInput();

        body.innerHTML = html;

        // Auto-resize inline textarea
        const textarea = document.getElementById('copilot-inline-input');
        if (textarea) {
            textarea.addEventListener('input', () => this._autoResizeTextarea(textarea));
        }
        } catch (err) {
            console.error('Error rendering AI copilot panel:', err);
            body.innerHTML = '<div class="ai-empty"><div class="empty-icon">&#10024;</div><div class="empty-text"><span class="logo-ai">A</span>cting <span class="logo-ai">I</span>ntern</div><div class="empty-hint">Loading patient data...</div></div>';
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

    /**
     * Render the AI live status line — a continuously updated one-sentence gestalt
     */
    renderStatusLine() {
        if (!this.state.aiOneLiner) return '';

        const isThinking = this.state.status === 'thinking';
        const pulseClass = isThinking ? 'status-pulse thinking' : 'status-pulse live';

        return `<div class="copilot-status-line">
            <span class="${pulseClass}"></span>
            <span class="status-line-text">${this.escapeHtml(this.state.aiOneLiner)}</span>
        </div>`;
    },

    // ==================== Local Data Builders ====================

    /**
     * Build a 3-sentence clinical summary from local patient data (no LLM needed).
     * Returns {demographics, functional, presentation} or null if insufficient data.
     *
     * Sentence 1 (HPI): Uses clinical abbreviations (HFrEF, T2DM, AFib, CKD3b, HTN, etc.)
     * Sentence 2 (Social): Functional status, living situation, mobility
     * Sentence 3 (Presentation): Chief complaint + significant positives + pertinent negatives
     */
    _buildLocalSummary() {
        try {
            const doc = this.longitudinalDoc;
            if (!doc) return null;

            // ---- Clinical abbreviation map ----
            const ABBREVIATIONS = {
                'type 2 diabetes mellitus': 'T2DM',
                'type 2 diabetes': 'T2DM',
                'type 1 diabetes mellitus': 'T1DM',
                'type 1 diabetes': 'T1DM',
                'diabetes mellitus': 'DM',
                'heart failure with reduced ejection fraction': 'HFrEF',
                'heart failure with preserved ejection fraction': 'HFpEF',
                'heart failure': 'HF',
                'congestive heart failure': 'CHF',
                'atrial fibrillation, persistent': 'persistent AFib',
                'atrial fibrillation': 'AFib',
                'chronic kidney disease, stage 3b': 'CKD 3b',
                'chronic kidney disease, stage 3a': 'CKD 3a',
                'chronic kidney disease, stage 4': 'CKD 4',
                'chronic kidney disease, stage 5': 'CKD 5',
                'chronic kidney disease stage 3b': 'CKD 3b',
                'chronic kidney disease stage 3a': 'CKD 3a',
                'chronic kidney disease': 'CKD',
                'essential hypertension': 'HTN',
                'hypertension': 'HTN',
                'hyperlipidemia': 'HLD',
                'coronary artery disease': 'CAD',
                'chronic obstructive pulmonary disease': 'COPD',
                'gastroesophageal reflux disease': 'GERD',
                'benign prostatic hyperplasia': 'BPH',
                'diabetic peripheral neuropathy': 'diabetic neuropathy',
                'peripheral arterial disease': 'PAD',
                'deep vein thrombosis': 'DVT',
                'pulmonary embolism': 'PE',
                'obstructive sleep apnea': 'OSA',
                'end stage renal disease': 'ESRD',
                'acute kidney injury': 'AKI',
                'vitamin d deficiency': 'Vit D deficiency',
                'obesity': 'obesity'
            };

            function abbreviate(name) {
                const lower = name.toLowerCase().trim();
                // Try exact match first, then partial matches (longest first)
                if (ABBREVIATIONS[lower]) return ABBREVIATIONS[lower];
                const keys = Object.keys(ABBREVIATIONS).sort((a, b) => b.length - a.length);
                for (const key of keys) {
                    if (lower.includes(key)) return ABBREVIATIONS[key];
                }
                return name; // No abbreviation found
            }

            // ---- Sentence 1: Age, sex, PMH (with abbreviations) ----
            let demographics = '';
            let patientAge = '';
            let sex = '';
            if (typeof PatientHeader !== 'undefined' && PatientHeader.currentPatient) {
                const p = PatientHeader.currentPatient;
                let age = p.age;
                if (!age && p.dateOfBirth) {
                    const dob = new Date(p.dateOfBirth);
                    const today = new Date();
                    age = today.getFullYear() - dob.getFullYear();
                    const m = today.getMonth() - dob.getMonth();
                    if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
                }
                patientAge = age ? `${age}` : '';
                sex = (p.sex || p.gender || '').toLowerCase();
                if (sex === 'male' || sex === 'm') sex = 'M';
                else if (sex === 'female' || sex === 'f') sex = 'F';
                else sex = '';
            }

            // Get active problems sorted by priority
            const problems = [];
            if (doc.problemMatrix && doc.problemMatrix.size > 0) {
                for (const [id, timeline] of doc.problemMatrix) {
                    const prob = timeline.problem || timeline;
                    if (prob.status === 'active' || !prob.status) {
                        problems.push({
                            name: prob.name || id,
                            priority: prob.priority || 'Medium'
                        });
                    }
                }
            }
            // Sort: High first, then Medium, then Low
            const priorityOrder = { 'High': 0, 'Medium': 1, 'Low': 2 };
            problems.sort((a, b) => (priorityOrder[a.priority] ?? 1) - (priorityOrder[b.priority] ?? 1));
            const topProblems = problems.slice(0, 5).map(p => abbreviate(p.name));

            if (patientAge && topProblems.length > 0) {
                demographics = `${patientAge}${sex} w/ ${topProblems.join(', ')}`;
            } else if (patientAge) {
                demographics = `${patientAge}-year-old ${sex === 'M' ? 'male' : sex === 'F' ? 'female' : ''}`.trim();
            }

            // ---- Sentence 2: Functional status + living situation ----
            let functional = '';
            const social = doc.patientSnapshot?.socialHistory;
            if (social) {
                const parts = [];
                // Occupation/retirement
                if (social.occupation) {
                    const occ = typeof social.occupation === 'string' ? social.occupation :
                        (social.occupation.status === 'Retired' ? `Retired ${social.occupation.previous || ''}`.trim() :
                        social.occupation.current || social.occupation.status || '');
                    if (occ) parts.push(occ);
                }
                // Living situation
                if (social.livingSituation) {
                    const living = typeof social.livingSituation === 'string' ? social.livingSituation : '';
                    if (living) {
                        const firstPart = living.split('.')[0].trim();
                        parts.push(firstPart.charAt(0).toLowerCase() + firstPart.slice(1));
                    }
                }
                // Exercise/mobility
                if (social.exercise) {
                    const exercise = typeof social.exercise === 'string' ? social.exercise : '';
                    if (exercise) {
                        const firstPart = exercise.split('.')[0].trim();
                        if (firstPart.length < 60) {
                            parts.push(firstPart.charAt(0).toLowerCase() + firstPart.slice(1));
                        }
                    }
                }
                if (parts.length > 0) {
                    functional = parts.join('; ');
                    functional = functional.charAt(0).toUpperCase() + functional.slice(1);
                }
            }
            if (!functional) {
                functional = 'Functional status and living situation not yet documented';
            }

            // ---- Sentence 3: Chief complaint + significant positives + pertinent negatives ----
            let presentation = '';
            const parts3 = [];

            // Chief complaint from encounters (longitudinalData has encounters, not notes)
            let chiefComplaint = '';
            const encounters = doc.longitudinalData?.encounters || [];
            if (encounters.length > 0) {
                chiefComplaint = encounters[0].chiefComplaint || '';
            }
            if (chiefComplaint) {
                parts3.push(`CC: ${chiefComplaint.charAt(0).toLowerCase() + chiefComplaint.slice(1)}`);
            }

            // Physical exam findings — significant positives and pertinent negatives
            // Look in the problem matrix for notes with physical exam data
            const examFindings = this._extractPhysicalExamFindings(doc);
            if (examFindings.positives.length > 0 || examFindings.negatives.length > 0) {
                const examParts = [];
                if (examFindings.positives.length > 0) {
                    examParts.push(examFindings.positives.slice(0, 3).join(', '));
                }
                if (examFindings.negatives.length > 0) {
                    examParts.push(examFindings.negatives.slice(0, 2).join(', '));
                }
                if (examParts.length > 0) {
                    parts3.push('exam: ' + examParts.join('; '));
                }
            }

            // Flagged labs
            const flaggedLabs = [];
            if (doc.longitudinalData?.labs) {
                for (const [name, trend] of doc.longitudinalData.labs) {
                    if (trend.latestValue && (trend.latestValue.flag === 'CRITICAL' || trend.latestValue.flag === 'HIGH' || trend.latestValue.flag === 'LOW' || trend.latestValue.flag === 'HH' || trend.latestValue.flag === 'LL')) {
                        const arrow = (trend.latestValue.flag === 'HIGH' || trend.latestValue.flag === 'HH') ? '\u2191' : '\u2193';
                        flaggedLabs.push(`${name} ${trend.latestValue.value}${arrow}`);
                    }
                }
            }
            if (flaggedLabs.length > 0) {
                parts3.push(flaggedLabs.slice(0, 4).join(', ') + (flaggedLabs.length > 4 ? ` (+${flaggedLabs.length - 4} more)` : ''));
            }

            // Recent vital concerns
            const vitals = doc.longitudinalData?.vitals;
            if (vitals && vitals.length > 0) {
                const v = vitals[0];
                const concerns = [];
                if (v.heartRate && (v.heartRate > 100 || v.heartRate < 60)) concerns.push(`HR ${v.heartRate}`);
                if (v.systolic && v.systolic < 90) concerns.push(`SBP ${v.systolic}`);
                if (v.spO2 && v.spO2 < 94) concerns.push(`SpO2 ${v.spO2}%`);
                if (v.temperature && v.temperature > 38.3) concerns.push(`Temp ${v.temperature}`);
                if (concerns.length > 0) {
                    parts3.push('vitals: ' + concerns.join(', '));
                }
            }

            presentation = parts3.length > 0 ? parts3.join('; ') : 'No chief complaint documented yet';

            return { demographics, functional, presentation };
        } catch (err) {
            console.warn('Error building local summary:', err);
            return null;
        }
    },

    /**
     * Extract physical exam findings from available clinical data.
     * Returns { positives: string[], negatives: string[] }
     * Positives = abnormal findings; Negatives = pertinent normals
     */
    _extractPhysicalExamFindings(doc) {
        const positives = [];
        const negatives = [];

        try {
            // Look through problem matrix for notes with physicalExam data
            if (doc.problemMatrix) {
                for (const [id, timeline] of doc.problemMatrix) {
                    if (timeline.timeline) {
                        for (const [period, data] of timeline.timeline) {
                            if (data.notes) {
                                for (const note of data.notes) {
                                    if (note.physicalExam && typeof note.physicalExam === 'object') {
                                        this._classifyExamFindings(note.physicalExam, positives, negatives);
                                        return { positives, negatives }; // Use the first note with exam data
                                    }
                                }
                            }
                        }
                    }
                }
            }
        } catch (err) {
            console.warn('Error extracting physical exam findings:', err);
        }

        return { positives, negatives };
    },

    /**
     * Classify physical exam findings into positives (abnormal) and negatives (pertinent normals).
     */
    _classifyExamFindings(physicalExam, positives, negatives) {
        // Keywords that indicate abnormal (positive) findings
        const abnormalKeywords = ['edema', 'irregular', 'murmur', 'rales', 'crackles', 'rhonchi',
            'wheeze', 'distended', 'tender', 'decreased', 'elevated', 'jugular',
            'jvd', 'ascites', 'cyanosis', 'diaphoresis', 'tachycardic', 'gallop',
            's3', 's4', 'bruit', 'guarding', 'rebound', 'hepatomegaly', 'splenomegaly'];
        // Keywords that indicate pertinent negatives
        const normalKeywords = ['no acute distress', 'clear to auscultation', 'no murmur',
            'non-tender', 'non-distended', 'no edema', 'no wheezes', 'no rhonchi',
            'no rales', 'regular rate', 'soft', 'normal', 'unremarkable',
            'no jugular', 'jvp not elevated', 'no gallop', 'no rebound', 'no guarding'];

        for (const [system, finding] of Object.entries(physicalExam)) {
            if (!finding || typeof finding !== 'string') continue;
            const lower = finding.toLowerCase();

            // Check for abnormal findings
            const hasAbnormal = abnormalKeywords.some(kw => lower.includes(kw));
            const hasNormal = normalKeywords.some(kw => lower.includes(kw));

            if (hasAbnormal) {
                // Extract the specific abnormal finding
                // e.g., "Irregularly irregular, no murmurs, JVP not elevated" → "irregularly irregular rhythm"
                const shortFinding = this._extractKeyFinding(system, finding, true);
                if (shortFinding && positives.length < 4) positives.push(shortFinding);
            } else if (hasNormal && negatives.length < 3) {
                // Only include pertinent negatives for key systems (Cardiovascular, Respiratory, Extremities)
                const keyNegSystems = ['cardiovascular', 'respiratory', 'extremities', 'abdomen', 'lungs'];
                if (keyNegSystems.some(s => system.toLowerCase().includes(s))) {
                    const shortFinding = this._extractKeyFinding(system, finding, false);
                    if (shortFinding) negatives.push(shortFinding);
                }
            }
        }
    },

    /**
     * Extract a concise key finding from a physical exam line.
     */
    _extractKeyFinding(system, finding, isPositive) {
        const lower = finding.toLowerCase();

        if (isPositive) {
            // Extract the abnormal portion
            if (lower.includes('edema')) {
                const match = finding.match(/(trace|mild|moderate|severe|bilateral|pitting)?\s*(bilateral\s+)?(ankle\s+|lower\s+extremity\s+|pedal\s+)?edema/i);
                return match ? match[0].trim() : 'edema';
            }
            if (lower.includes('irregularly irregular') || lower.includes('irregular')) {
                return 'irregularly irregular rhythm';
            }
            if (lower.includes('crackles') || lower.includes('rales')) {
                return 'crackles on auscultation';
            }
            if (lower.includes('decreased sensation')) {
                return 'decreased sensation bilat feet';
            }
            if (lower.includes('murmur')) {
                const match = finding.match(/\d\/\d\s*(systolic|diastolic)?\s*murmur/i);
                return match ? match[0] : 'murmur present';
            }
            if (lower.includes('jvd') || lower.includes('jugular venous distension')) {
                return 'JVD present';
            }
            // Generic: return first clause
            return finding.split(',')[0].trim().substring(0, 40);
        } else {
            // Pertinent negatives — brief format
            if (system.toLowerCase().includes('cardiovasc')) {
                if (lower.includes('no murmur')) return 'no murmurs';
                if (lower.includes('jvp not elevated')) return 'JVP not elevated';
            }
            if (system.toLowerCase().includes('resp')) {
                if (lower.includes('no wheeze') && lower.includes('no rhonchi')) return 'lungs clear';
                if (lower.includes('clear to auscultation')) return 'lungs CTA bilaterally';
            }
            if (system.toLowerCase().includes('abd')) {
                if (lower.includes('non-tender') && lower.includes('non-distended')) return 'abd soft, NT/ND';
            }
            return null; // Don't include non-key negatives
        }
    },

    /**
     * Build a local problem list from problemMatrix (no LLM).
     * Problem #1 is always the chief complaint with placeholder DDx.
     * Returns [{name, urgency, ddx, plan}] sorted by priority.
     */
    _buildLocalProblemList() {
        try {
            const doc = this.longitudinalDoc;
            if (!doc || !doc.problemMatrix || doc.problemMatrix.size === 0) return [];

            // Try to get the chief complaint from scenario data or symptoms
            let chiefComplaint = '';
            if (typeof SimulationEngine !== 'undefined' && SimulationEngine.scenarioData?.clinicalContext?.hpiDetails?.chiefComplaint) {
                chiefComplaint = SimulationEngine.scenarioData.clinicalContext.hpiDetails.chiefComplaint;
            } else if (this.state.symptoms) {
                // Infer from symptoms
                if (this.state.symptoms.dyspnea && this.state.symptoms.dyspnea >= 5) chiefComplaint = 'Acute dyspnea';
                else if (this.state.symptoms.chestPain) chiefComplaint = 'Chest pain';
                else if (this.state.symptoms.alteredMentalStatus) chiefComplaint = 'Altered mental status';
            }

            const problems = [];

            // Problem #1: Chief complaint with DDx placeholder
            if (chiefComplaint) {
                problems.push({
                    name: chiefComplaint,
                    urgency: 'urgent',
                    ddx: 'Analyze for differential diagnosis',
                    plan: null
                });
            }

            // Remaining problems from problem matrix
            for (const [id, timeline] of doc.problemMatrix) {
                const prob = timeline.problem || timeline;
                if (prob.status === 'active' || !prob.status) {
                    let urgency = 'active';
                    if (prob.priority === 'High') urgency = 'urgent';
                    else if (prob.priority === 'Low') urgency = 'monitoring';

                    problems.push({
                        name: prob.name || id,
                        urgency,
                        ddx: null,
                        plan: null,
                        _priority: prob.priority || 'Medium'
                    });
                }
            }

            // Sort problems #2+ by urgency (keep #1 as chief complaint)
            if (chiefComplaint && problems.length > 1) {
                const rest = problems.slice(1);
                const order = { 'urgent': 0, 'active': 1, 'monitoring': 2 };
                rest.sort((a, b) => (order[a.urgency] ?? 1) - (order[b.urgency] ?? 1));
                return [problems[0], ...rest.slice(0, 4)];
            }

            // Fallback sort if no chief complaint
            const order = { 'urgent': 0, 'active': 1, 'monitoring': 2 };
            problems.sort((a, b) => (order[a.urgency] ?? 1) - (order[b.urgency] ?? 1));
            return problems.slice(0, 5);
        } catch (err) {
            console.warn('Error building local problem list:', err);
            return [];
        }
    },

    // Agent system removed — clinical data analysis now surfaces directly through
    // the Problem List (DDx, plans) and Suggested Actions sections.

    /**
     * Render a structured 3-sentence clinical summary.
     * Uses LLM-refined data if available, falls back to locally-built sentences.
     */
    renderClinicalSummary() {
        try {
            const collapsed = this.isSectionCollapsed('summary');
            const chevron = collapsed ? '&#9654;' : '&#9660;';

            // Use LLM summary if available, else local
            const summary = this.state.clinicalSummary || this._buildLocalSummary();

            let html = '<div class="clinical-summary">';
            html += `<div class="copilot-section-header collapsible-header" onclick="AICoworker.toggleSection('summary')">`;
            html += `<span class="collapse-chevron">${chevron}</span>`;
            html += '<span>&#128203;</span> Clinical Summary';
            html += '</div>';

            if (!collapsed) {
                html += '<div class="copilot-section-body">';
                if (summary) {
                    if (summary.demographics) {
                        html += `<div class="summary-sentence"><span class="sentence-label">ID</span>${this.formatText(summary.demographics)}</div>`;
                    }
                    if (summary.functional) {
                        html += `<div class="summary-sentence"><span class="sentence-label">USOH</span>${this.formatText(summary.functional)}</div>`;
                    }
                    if (summary.presentation) {
                        html += `<div class="summary-sentence"><span class="sentence-label">Now</span>${this.formatText(summary.presentation)}</div>`;
                    }
                } else {
                    html += '<div class="summary-sentence summary-placeholder">Loading patient data...</div>';
                }
                html += '</div>';
            }

            html += '</div>';
            return html;
        } catch (err) {
            console.warn('Error rendering clinical summary:', err);
            return '<div class="clinical-summary"><div class="summary-sentence summary-placeholder">Loading patient data...</div></div>';
        }
    },

    /**
     * Render the problem list section.
     * Shows 3-5 prioritized problems with DDx and plan (from LLM) or just names (local).
     */
    renderProblemList() {
        const isThinking = this.state.status === 'thinking';
        const hasLLMData = this.state.problemList && this.state.problemList.length > 0 &&
            this.state.problemList.some(p => p.plan);
        const collapsed = this.isSectionCollapsed('problems');
        const chevron = collapsed ? '&#9654;' : '&#9660;';

        let html = '<div class="copilot-section problem-list-section">';
        html += `<div class="copilot-section-header collapsible-header" onclick="AICoworker.toggleSection('problems')">`;
        html += `<span class="collapse-chevron">${chevron}</span>`;
        html += '<span>&#127973;</span> Problem List';
        html += '<div class="section-actions">';
        html += '<button class="section-action-btn" onclick="event.stopPropagation(); AICoworker.refreshThinking()" title="Refresh analysis">&#128260;</button>';
        html += '</div></div>';

        if (collapsed) {
            html += '</div>';
            return html;
        }

        html += '<div class="copilot-section-body">';

        if (isThinking) {
            html += '<div class="insight-loading"><div class="typing-indicator"><span></span><span></span><span></span></div> Analyzing...</div>';
        } else {
            // Use LLM problem list if available with plans, else local
            const problems = hasLLMData ? this.state.problemList : this._buildLocalProblemList();

            if (problems.length === 0) {
                html += '<div class="problem-empty">No active problems on file</div>';
            } else {
                problems.forEach((prob, idx) => {
                    const urgencyClass = prob.urgency === 'urgent' ? 'urgency-urgent' :
                        prob.urgency === 'monitoring' ? 'urgency-monitoring' : 'urgency-active';
                    const urgencyLabel = prob.urgency === 'urgent' ? 'URGENT' :
                        prob.urgency === 'monitoring' ? 'MONITOR' : 'ACTIVE';

                    html += `<div class="problem-item">`;
                    html += `<div class="problem-name-row">`;
                    html += `<span class="problem-number">${idx + 1}.</span>`;
                    html += `<span class="problem-name">${this.escapeHtml(prob.name)}</span>`;
                    html += `<span class="problem-urgency ${urgencyClass}">${urgencyLabel}</span>`;
                    html += `</div>`;

                    if (prob.ddx) {
                        html += `<div class="problem-ddx">DDx: ${this.escapeHtml(prob.ddx)}</div>`;
                    }
                    if (prob.plan) {
                        html += `<div class="problem-plan">Plan: ${this.escapeHtml(prob.plan)}</div>`;
                    }

                    html += `</div>`;
                });

                // Show "Analyze" prompt if no LLM data yet
                if (!hasLLMData) {
                    html += '<div class="problem-analyze-hint">';
                    html += '<button class="analyze-btn-sm" onclick="AICoworker.refreshThinking()">&#10024; Analyze for DDx &amp; Plans</button>';
                    html += '</div>';
                }
            }
        }

        html += '</div></div>';
        return html;
    },

    /**
     * Render the conversation thread as a standalone section.
     */
    renderConversationThread() {
        if (!this.state.conversationThread || this.state.conversationThread.length === 0) return '';

        const collapsed = this.isSectionCollapsed('conversation');
        const chevron = collapsed ? '&#9654;' : '&#9660;';
        const msgCount = this.state.conversationThread.length;

        let html = '<div class="copilot-section conversation-section">';
        html += `<div class="copilot-section-header collapsible-header" onclick="AICoworker.toggleSection('conversation')">`;
        html += `<span class="collapse-chevron">${chevron}</span>`;
        html += `<span>&#128172;</span> Conversation (${msgCount})`;
        html += '</div>';

        if (!collapsed) {
            html += '<div class="conversation-thread">';
            this.state.conversationThread.slice(-10).forEach(msg => {
                const cls = msg.role === 'user' ? 'thread-msg-user' : 'thread-msg-ai';
                const label = msg.role === 'user' ? (msg.type === 'think' ? '&#127897; You' : '&#128100; You') : '&#10024; AI';
                html += `<div class="thread-msg ${cls}">`;
                html += `<div class="thread-msg-label">${label}</div>`;
                html += `<div class="thread-msg-text">${msg.role === 'ai' ? this.formatText(msg.text) : this.escapeHtml(msg.text)}</div>`;
                html += '</div>';
            });
            html += '</div>';
        }

        html += '</div>';
        return html;
    },

    /**
     * Render suggested actions — 6 always-visible categories with specific LLM items.
     */
    renderSuggestedActions() {
        const actions = this.state.categorizedActions;
        const collapsed = this.isSectionCollapsed('actions');
        const chevron = collapsed ? '&#9654;' : '&#9660;';

        // Clear pending actions map on each render to prevent stale references
        this._pendingActions = {};
        this._pendingActionCategories = {};

        const categories = [
            { key: 'communication', icon: '&#128172;', label: 'Talk to patient/nurse', items: actions?.communication || [] },
            { key: 'labs', icon: '&#128300;', label: 'Order labs', items: actions?.labs || [] },
            { key: 'imaging', icon: '&#128247;', label: 'Order imaging', items: actions?.imaging || [] },
            { key: 'medications', icon: '&#128138;', label: 'Medication orders', items: actions?.medications || [] },
            { key: 'other', icon: '&#128203;', label: 'Other orders', items: actions?.other || [] }
        ];

        let html = '<div class="copilot-section actions-section">';
        html += `<div class="copilot-section-header collapsible-header" onclick="AICoworker.toggleSection('actions')">`;
        html += `<span class="collapse-chevron">${chevron}</span>`;
        html += '<span>&#9989;</span> Suggested Actions';
        html += '</div>';

        if (collapsed) {
            html += '</div>';
            return html;
        }

        html += '<div class="copilot-section-body">';

        categories.forEach(cat => {
            html += `<div class="action-category" data-category="${cat.key}">`;
            html += `<div class="action-category-header">`;
            html += `<span class="action-cat-icon">${cat.icon}</span>`;
            html += `<span class="action-cat-label">${cat.label}</span>`;
            html += `</div>`;

            if (cat.items.length > 0) {
                html += '<div class="action-items">';
                cat.items.forEach((item, idx) => {
                    const text = typeof item === 'string' ? item : item.text || String(item);
                    const hasOrder = typeof item === 'object' && item.orderType && item.orderData;
                    const isMedChange = this._isMedChangeAction(text);
                    const isComm = cat.key === 'communication';
                    const actionId = `action_${cat.key}_${idx}`;

                    // Store action data + category for retrieval on click
                    this._pendingActions[actionId] = item;
                    this._pendingActionCategories[actionId] = cat.key;

                    if (hasOrder && !isMedChange) {
                        // New order → opens OrderEntry
                        html += `<div class="action-item action-executable" onclick="AICoworker.executeAction('${actionId}')">`;
                        html += `<span class="action-text">${this.escapeHtml(text)}</span>`;
                        html += `<span class="action-execute-icon" title="Open order form">&#9654;</span>`;
                        html += `</div>`;
                    } else if (isComm) {
                        // Communication → opens patient/nurse chat
                        html += `<div class="action-item action-chat" onclick="AICoworker.executeAction('${actionId}')">`;
                        html += `<span class="action-text">${this.escapeHtml(text)}</span>`;
                        html += `<span class="action-chat-icon" title="Open chat">&#128172;</span>`;
                        html += `</div>`;
                    } else if (isMedChange) {
                        // Med change (hold/stop/increase) → nurse chat
                        html += `<div class="action-item action-chat" onclick="AICoworker.executeAction('${actionId}')">`;
                        html += `<span class="action-text">${this.escapeHtml(text)}</span>`;
                        html += `<span class="action-chat-icon" title="Tell nurse">&#128105;&#8205;&#9877;</span>`;
                        html += `</div>`;
                    } else {
                        // Fallback
                        html += `<div class="action-item" onclick="AICoworker.executeAction('${actionId}')">${this.escapeHtml(text)}</div>`;
                    }
                });
                html += '</div>';
            }

            html += `</div>`;
        });

        html += '</div></div>';
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
        html += '<button onclick="AICoworker.openPromptEditor()">&#9999; Edit Prompts</button>';
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
     * Clear AI memory for this patient — full reset.
     * Wipes the longitudinal document, session context, active clinical state,
     * conflicts, observations, and localStorage. The AI starts completely fresh.
     */
    clearMemory() {
        if (!confirm('Clear ALL AI memory for this patient?\n\nThis will erase:\n• Clinical narrative & trajectory\n• AI observations & insights\n• Pending decisions & conflicts\n• Session context & conversation history\n• Patient/nurse chat history\n\nThe AI will rebuild its understanding from scratch.')) return;

        if (this.longitudinalDoc) {
            const patientId = this.longitudinalDoc.metadata.patientId;

            // 1. Clear AI Memory layer
            this.longitudinalDoc.aiMemory.patientSummary = '';
            this.longitudinalDoc.aiMemory.problemInsights = new Map();
            this.longitudinalDoc.aiMemory.interactionLog = [];
            this.longitudinalDoc.aiMemory.version = 0;

            // 2. Clear Clinical Narrative
            this.longitudinalDoc.clinicalNarrative.trajectoryAssessment = '';
            this.longitudinalDoc.clinicalNarrative.keyFindings = [];
            this.longitudinalDoc.clinicalNarrative.openQuestions = [];

            // 3. Clear Session Context — all layers
            const sc = this.longitudinalDoc.sessionContext;
            sc.doctorDictation = [];
            sc.aiObservations = [];
            sc.safetyFlags = [];
            sc.reviewedItems = [];
            sc.pendingItems = [];
            sc.patientConversation = [];
            sc.nurseConversation = [];

            // 4. Clear Active Clinical State (new v2 layer)
            if (sc.activeClinicalState) {
                sc.activeClinicalState.pendingDecisions = [];
                sc.activeClinicalState.activeConditions = [];
                sc.activeClinicalState.backgroundFacts = [];
            }

            // 5. Clear Conflicts
            if (sc.conflicts) {
                sc.conflicts.length = 0;
            }

            // 6. Remove from localStorage entirely so it's rebuilt fresh
            const key = `longitudinalDoc_${patientId}`;
            localStorage.removeItem(key);
            console.log(`Removed longitudinal doc from localStorage: ${key}`);
        }

        // 7. Clear patient and nurse chat histories
        localStorage.removeItem('patient-chat-history');
        localStorage.removeItem('nurse-chat-history');
        if (typeof PatientChat !== 'undefined') {
            PatientChat.messages = [];
        }
        if (typeof NurseChat !== 'undefined') {
            NurseChat.messages = [];
        }

        // 8. Reset in-memory session state
        this.resetSessionState();

        // 9. Null out the longitudinal doc so it gets rebuilt
        this.longitudinalDoc = null;
        this.longitudinalDocUpdater = null;
        this.longitudinalDocRenderer = null;
        this.longitudinalDocBuilder = null;

        // 10. Re-initialize with current patient
        const patient = PatientHeader.getPatient();
        if (patient) {
            this.onPatientLoaded(patient.id || patient.patientId || 'default');
        }

        this.render();
        App.showToast('AI memory cleared — starting fresh', 'success');
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
  "oneLiner": "Single-sentence clinical gestalt (~15 words)",
  "clinicalSummary": {
    "demographics": "Age, sex, key PMH with abbreviations (e.g. 72M w/ HFrEF, T2DM, AFib, CKD3b, HTN)",
    "functional": "Functional status, living situation",
    "presentation": "CC, significant exam positives, pertinent negatives, key abnormal labs"
  },
  "problemList": [
    {"name": "Problem", "urgency": "urgent|active|monitoring", "ddx": "Differential or null", "plan": "Brief plan"}
  ],
  "categorizedActions": {
    "communication": [], "labs": [], "imaging": [], "medications": [], "other": []
  },
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
                data = this._parseJSONResponse(response);
                if (!data) {
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
            // Parse new clinical fields
            if (data.oneLiner) this.state.aiOneLiner = data.oneLiner;
            if (data.clinicalSummary) this.state.clinicalSummary = data.clinicalSummary;
            if (data.problemList && Array.isArray(data.problemList)) this.state.problemList = data.problemList;
            if (data.categorizedActions) this.state.categorizedActions = data.categorizedActions;

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
            // Apply custom prompt override if user has edited it
            const customNote = localStorage.getItem('customPrompt_note_system');
            if (customNote !== null) {
                systemPrompt = customNote;
                console.log('📝 Using CUSTOM note system prompt');
            }
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
  "oneLiner": "Single-sentence clinical gestalt (~15 words)",
  "clinicalSummary": {
    "demographics": "Age, sex, key PMH with abbreviations (e.g. 72M w/ HFrEF, T2DM, AFib, CKD3b, HTN)",
    "functional": "Functional status, living situation",
    "presentation": "CC, significant exam positives, pertinent negatives, key abnormal labs"
  },
  "problemList": [
    {"name": "Problem", "urgency": "urgent|active|monitoring", "ddx": "Differential or null", "plan": "Brief plan"}
  ],
  "categorizedActions": {
    "communication": [], "labs": [], "imaging": [], "medications": [], "other": []
  },
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
                data = this._parseJSONResponse(response) || {};
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
            // Parse new clinical fields
            if (data.oneLiner) this.state.aiOneLiner = data.oneLiner;
            if (data.clinicalSummary) this.state.clinicalSummary = data.clinicalSummary;
            if (data.problemList && Array.isArray(data.problemList)) this.state.problemList = data.problemList;
            if (data.categorizedActions) this.state.categorizedActions = data.categorizedActions;

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
     * Load API key from localStorage (unified — checks all legacy keys)
     */
    loadApiKey() {
        // Canonical key
        let key = localStorage.getItem('anthropic-api-key');
        // Migration: check legacy keys
        if (!key) key = localStorage.getItem('anthropicApiKey');
        if (!key) key = localStorage.getItem('claude-api-key');
        if (key) {
            this.apiKey = key;
            // Migrate to canonical key and sync to ClaudeAPI
            localStorage.setItem('anthropic-api-key', key);
            localStorage.removeItem('anthropicApiKey');
            localStorage.removeItem('claude-api-key');
            if (typeof ClaudeAPI !== 'undefined') ClaudeAPI.setApiKey(key);
        }
        return this.apiKey;
    },

    /**
     * Save API key to localStorage (single source of truth)
     */
    saveApiKey(key) {
        this.apiKey = key;
        localStorage.setItem('anthropic-api-key', key);
        // Sync to ClaudeAPI so patient/nurse chat also work
        if (typeof ClaudeAPI !== 'undefined') ClaudeAPI.setApiKey(key);
        // Clean up any legacy keys
        localStorage.removeItem('anthropicApiKey');
        localStorage.removeItem('claude-api-key');
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

    // ==================== Prompt Editor ====================

    /**
     * Registry of all editable prompts.
     * Each entry has: id, label, category, getDefault (function returning the default text),
     * and description of what the prompt controls.
     */
    getPromptRegistry() {
        return [
            {
                id: 'dictation_system',
                label: 'Dictation — System Prompt',
                category: 'AI Copilot',
                description: 'Controls how the AI processes doctor dictation/thinking. Includes the JSON response format, clinical summary rules, problem list format, and memory classification instructions.',
                getDefault: () => {
                    if (this.contextAssembler) {
                        const p = this.contextAssembler.buildDictationPrompt('(placeholder)');
                        return p.systemPrompt;
                    }
                    return '(Context assembler not initialized)';
                }
            },
            {
                id: 'refresh_system',
                label: 'Refresh — System Prompt',
                category: 'AI Copilot',
                description: 'Controls the full case analysis/refresh. Used when "Refresh Analysis" is clicked. Includes comprehensive synthesis instructions and memory update format.',
                getDefault: () => {
                    if (this.contextAssembler) {
                        const p = this.contextAssembler.buildRefreshPrompt('');
                        return p.systemPrompt;
                    }
                    return '(Context assembler not initialized)';
                }
            },
            {
                id: 'ask_system',
                label: 'Ask AI — System Prompt',
                category: 'AI Copilot',
                description: 'Controls how the AI answers direct questions from the physician. Includes memory update instructions.',
                getDefault: () => {
                    if (this.contextAssembler) {
                        const p = this.contextAssembler.buildAskPrompt('(placeholder question)');
                        return p.systemPrompt;
                    }
                    return '(Context assembler not initialized)';
                }
            },
            {
                id: 'note_system',
                label: 'Note Writing — System Prompt',
                category: 'AI Copilot',
                description: 'Controls how clinical notes are generated. Includes documentation conventions and note structure.',
                getDefault: () => {
                    if (this.contextAssembler) {
                        const p = this.contextAssembler.buildNotePrompt('progress', 'Progress Note', {}, {}, '');
                        return p.systemPrompt;
                    }
                    return '(Context assembler not initialized)';
                }
            },
            {
                id: 'patient_chat',
                label: 'Patient Chat — System Prompt',
                category: 'Simulation Chats',
                description: 'Controls the simulated patient behavior: personality, symptom disclosure rules, graduated reveal, communication style, and what the patient knows.',
                getDefault: () => {
                    if (typeof PatientChat !== 'undefined') {
                        return PatientChat.buildScenarioContext();
                    }
                    return '(PatientChat not initialized)';
                }
            },
            {
                id: 'nurse_chat',
                label: 'Nurse Chat — System Prompt',
                category: 'Simulation Chats',
                description: 'Controls the simulated nurse behavior: SBAR communication, what clinical information the nurse shares, current patient status reporting, and medication awareness.',
                getDefault: () => {
                    if (typeof NurseChat !== 'undefined') {
                        return NurseChat.buildNurseContext();
                    }
                    return '(NurseChat not initialized)';
                }
            }
        ];
    },

    /**
     * Load a prompt — returns custom version from localStorage if edited, otherwise default
     */
    loadPrompt(promptId) {
        const custom = localStorage.getItem(`customPrompt_${promptId}`);
        if (custom !== null) return { text: custom, isCustom: true };
        const registry = this.getPromptRegistry();
        const entry = registry.find(p => p.id === promptId);
        if (entry) return { text: entry.getDefault(), isCustom: false };
        return { text: '', isCustom: false };
    },

    /**
     * Save a custom prompt override
     */
    savePrompt(promptId, text) {
        localStorage.setItem(`customPrompt_${promptId}`, text);
    },

    /**
     * Reset a prompt to its default
     */
    resetPrompt(promptId) {
        localStorage.removeItem(`customPrompt_${promptId}`);
    },

    /**
     * Check if a custom prompt exists
     */
    hasCustomPrompt(promptId) {
        return localStorage.getItem(`customPrompt_${promptId}`) !== null;
    },

    /**
     * Open the prompt editor modal
     */
    openPromptEditor() {
        // Close the More menu
        const moreMenu = document.getElementById('inline-more-menu');
        if (moreMenu) moreMenu.classList.remove('visible');

        let modal = document.getElementById('prompt-editor-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'prompt-editor-modal';
            modal.className = 'ai-modal prompt-editor-modal';
            modal.innerHTML = `
                <div class="ai-modal-content prompt-editor-content">
                    <div class="ai-modal-header">
                        <h3>&#9999; Prompt Editor</h3>
                        <button onclick="AICoworker.closePromptEditor()">&#10005;</button>
                    </div>
                    <div class="ai-modal-body prompt-editor-body">
                        <div class="prompt-editor-sidebar" id="prompt-editor-sidebar"></div>
                        <div class="prompt-editor-main">
                            <div class="prompt-editor-header" id="prompt-editor-header">
                                <div class="prompt-header-title">
                                    <h4 id="prompt-editor-title">Select a prompt</h4>
                                    <p id="prompt-editor-desc" class="prompt-editor-description">Choose a prompt from the left to view and edit it.</p>
                                </div>
                                <div class="prompt-header-badges" id="prompt-header-badges"></div>
                            </div>
                            <textarea id="prompt-editor-textarea" class="prompt-editor-textarea" placeholder="Select a prompt to edit..."></textarea>
                            <div class="prompt-editor-actions">
                                <div class="prompt-editor-actions-left">
                                    <button class="btn btn-secondary" id="prompt-reset-btn" onclick="AICoworker.resetCurrentPrompt()" disabled>&#128260; Reset to Default</button>
                                    <span id="prompt-char-count" class="prompt-char-count"></span>
                                </div>
                                <div class="prompt-editor-actions-right">
                                    <button class="btn btn-secondary" id="prompt-copy-btn" onclick="AICoworker.copyCurrentPrompt()">&#128203; Copy</button>
                                    <button class="btn btn-primary" id="prompt-save-btn" onclick="AICoworker.saveCurrentPrompt()" disabled>&#128190; Save Changes</button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
        }

        this.populatePromptSidebar();
        modal.classList.add('visible');
    },

    closePromptEditor() {
        const modal = document.getElementById('prompt-editor-modal');
        if (modal) modal.classList.remove('visible');
    },

    populatePromptSidebar() {
        const sidebar = document.getElementById('prompt-editor-sidebar');
        if (!sidebar) return;

        const registry = this.getPromptRegistry();
        const categories = {};
        for (const p of registry) {
            if (!categories[p.category]) categories[p.category] = [];
            categories[p.category].push(p);
        }

        let html = '';
        for (const [cat, prompts] of Object.entries(categories)) {
            html += `<div class="prompt-sidebar-category">${cat}</div>`;
            for (const p of prompts) {
                const isCustom = this.hasCustomPrompt(p.id);
                html += `<button class="prompt-sidebar-item" data-prompt-id="${p.id}" onclick="AICoworker.selectPrompt('${p.id}')">
                    <span class="prompt-sidebar-label">${p.label}</span>
                    ${isCustom ? '<span class="prompt-custom-badge">edited</span>' : ''}
                </button>`;
            }
        }

        sidebar.innerHTML = html;
    },

    _currentPromptId: null,

    selectPrompt(promptId) {
        this._currentPromptId = promptId;

        // Update sidebar active state
        document.querySelectorAll('.prompt-sidebar-item').forEach(btn => btn.classList.remove('active'));
        const activeBtn = document.querySelector(`[data-prompt-id="${promptId}"]`);
        if (activeBtn) activeBtn.classList.add('active');

        // Load prompt text
        const registry = this.getPromptRegistry();
        const entry = registry.find(p => p.id === promptId);
        if (!entry) return;

        const { text, isCustom } = this.loadPrompt(promptId);

        // Update header
        document.getElementById('prompt-editor-title').textContent = entry.label;
        document.getElementById('prompt-editor-desc').textContent = entry.description;

        const badges = document.getElementById('prompt-header-badges');
        badges.innerHTML = isCustom
            ? '<span class="prompt-badge prompt-badge-custom">Custom</span>'
            : '<span class="prompt-badge prompt-badge-default">Default</span>';

        // Update textarea
        const textarea = document.getElementById('prompt-editor-textarea');
        textarea.value = text;
        textarea.disabled = false;

        // Update char count
        this.updatePromptCharCount();

        // Wire up char count on input
        textarea.oninput = () => this.updatePromptCharCount();

        // Enable buttons
        document.getElementById('prompt-reset-btn').disabled = !isCustom;
        document.getElementById('prompt-save-btn').disabled = false;
    },

    updatePromptCharCount() {
        const textarea = document.getElementById('prompt-editor-textarea');
        const counter = document.getElementById('prompt-char-count');
        if (textarea && counter) {
            const len = textarea.value.length;
            counter.textContent = `${len.toLocaleString()} chars (~${Math.round(len / 4).toLocaleString()} tokens)`;
        }
    },

    saveCurrentPrompt() {
        if (!this._currentPromptId) return;
        const textarea = document.getElementById('prompt-editor-textarea');
        if (!textarea) return;

        this.savePrompt(this._currentPromptId, textarea.value);

        // Update badges
        const badges = document.getElementById('prompt-header-badges');
        badges.innerHTML = '<span class="prompt-badge prompt-badge-custom">Custom</span>';

        // Enable reset button
        document.getElementById('prompt-reset-btn').disabled = false;

        // Refresh sidebar to show edited badge
        this.populatePromptSidebar();
        const activeBtn = document.querySelector(`[data-prompt-id="${this._currentPromptId}"]`);
        if (activeBtn) activeBtn.classList.add('active');

        App.showToast('Prompt saved. Changes take effect on next LLM call.', 'success');
    },

    resetCurrentPrompt() {
        if (!this._currentPromptId) return;
        if (!confirm('Reset this prompt to its default? Your customizations will be lost.')) return;

        this.resetPrompt(this._currentPromptId);

        // Re-select to reload the default
        this.selectPrompt(this._currentPromptId);

        // Refresh sidebar
        this.populatePromptSidebar();
        const activeBtn = document.querySelector(`[data-prompt-id="${this._currentPromptId}"]`);
        if (activeBtn) activeBtn.classList.add('active');

        App.showToast('Prompt reset to default', 'success');
    },

    copyCurrentPrompt() {
        const textarea = document.getElementById('prompt-editor-textarea');
        if (!textarea) return;
        navigator.clipboard.writeText(textarea.value).then(() => {
            App.showToast('Prompt copied to clipboard', 'success');
        });
    },

    // ==================== End Prompt Editor ====================

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
            // Apply custom prompt override if user has edited it
            const customDictation = localStorage.getItem('customPrompt_dictation_system');
            if (customDictation !== null) {
                systemPrompt = customDictation;
                console.log('📝 Using CUSTOM dictation system prompt');
            }
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
            const response = await this.callLLM(systemPrompt, userMessage, 4096);

            // Parse the JSON response with robust extraction
            const result = this._parseJSONResponse(response);
            if (!result) {
                throw new Error('Could not parse AI response');
            }

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
                try {
                    const memUpdates = this.contextAssembler.parseMemoryUpdates(JSON.stringify(result));
                    this.writeBackMemoryUpdates(memUpdates, 'dictate', doctorThoughts);
                } catch (memErr) {
                    console.warn('Memory write-back failed (non-fatal):', memErr);
                }
            }

            // Update one-liner
            if (result.oneLiner) {
                this.state.aiOneLiner = result.oneLiner;
            }

            // Update clinical summary, problem list, categorized actions
            if (result.clinicalSummary) {
                this.state.clinicalSummary = result.clinicalSummary;
            }
            if (result.problemList && Array.isArray(result.problemList)) {
                this.state.problemList = result.problemList;
            }
            if (result.categorizedActions) {
                this.state.categorizedActions = result.categorizedActions;
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
            } else if (error.message === 'Could not parse AI response') {
                App.showToast('AI response could not be parsed. Try again.', 'warning');
            } else {
                App.showToast('AI synthesis error. Try again.', 'warning');
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
            // Apply custom prompt override if user has edited it
            const customRefresh = localStorage.getItem('customPrompt_refresh_system');
            if (customRefresh !== null) {
                systemPrompt = customRefresh;
                console.log('📝 Using CUSTOM refresh system prompt');
            }
            clinicalContext = userMessage;
            console.log(`📊 Refresh context: ${userMessage.length} chars (full)`);
        } else {
            systemPrompt = `You are an AI clinical assistant embedded in an EHR system. Analyze this patient case and provide a comprehensive synthesis.

You maintain a LONGITUDINAL CLINICAL DOCUMENT that persists across sessions. Your insights are written back into this document so they accumulate over time. Think of yourself as building a living understanding of this patient.

Respond in this exact JSON format:
{
    "oneLiner": "A single clinical sentence (~15 words) capturing the current gestalt",
    "clinicalSummary": {
        "demographics": "Age, sex, key PMH with clinical abbreviations (e.g. 72M w/ HFrEF, T2DM, AFib, CKD3b, HTN)",
        "functional": "Baseline functional status, living situation, social support, occupation",
        "presentation": "Chief complaint, significant positive exam findings, pertinent negatives, key abnormal labs"
    },
    "problemList": [
        {"name": "Most urgent problem", "urgency": "urgent|active|monitoring", "ddx": "Differential if relevant, or null", "plan": "1-2 sentence plan"}
    ],
    "categorizedActions": {
        "communication": ["Talk to patient/nurse actions"],
        "labs": ["Lab orders"],
        "imaging": ["Imaging orders, or empty array"],
        "medications": ["Medication orders"],
        "other": ["Other orders"]
    },
    "summary": "1-2 sentence case summary with **bold** for key diagnoses",
    "keyConsiderations": [
        {"text": "Safety concern or important clinical factor", "severity": "critical|important|info"}
    ],
    "thinking": "2-4 sentences about patient trajectory.",
    "suggestedActions": ["action 1", "action 2"],
    "observations": ["key observations"],
    "trajectoryAssessment": "Disease trajectory synthesis paragraph.",
    "keyFindings": ["finding 1", "finding 2"],
    "openQuestions": ["question 1", "question 2"]
}

Prioritize:
1. Safety concerns and critical values (put these in keyConsiderations with severity "critical")
2. Alignment with doctor's stated assessment (if any)
3. Actionable next steps
4. Things that haven't been addressed yet

RULES:
- clinicalSummary.demographics: Use format "72M w/ HFrEF, T2DM, AFib, CKD3b, HTN". Standard clinical abbreviations
- clinicalSummary.presentation: Include significant POSITIVE exam findings, pertinent NEGATIVES, and key abnormal labs
- problemList: 3-5 problems MAX, most urgent first. DDx only when clinically meaningful
- categorizedActions: Specific and actionable. Empty array fine for categories with nothing needed
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
            const response = await this.callLLM(systemPrompt, userMessage, 4096);

            const result = this._parseJSONResponse(response);
            if (!result) {
                throw new Error('Could not parse AI response');
            }

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
                try {
                    const memUpdates = this.contextAssembler.parseMemoryUpdates(JSON.stringify(result));
                    this.writeBackMemoryUpdates(memUpdates, 'refresh', 'Full case refresh');
                } catch (memErr) {
                    console.warn('Memory write-back failed (non-fatal):', memErr);
                }
            }

            // Update one-liner
            if (result.oneLiner) {
                this.state.aiOneLiner = result.oneLiner;
            }

            // Update clinical summary, problem list, categorized actions
            if (result.clinicalSummary) {
                this.state.clinicalSummary = result.clinicalSummary;
            }
            if (result.problemList && Array.isArray(result.problemList)) {
                this.state.problemList = result.problemList;
            }
            if (result.categorizedActions) {
                this.state.categorizedActions = result.categorizedActions;
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
            } else if (error.message === 'Could not parse AI response') {
                App.showToast('AI response could not be parsed. Try again.', 'warning');
            } else {
                App.showToast('AI analysis error. Try again.', 'warning');
            }
        } finally {
            if (btn) {
                btn.classList.remove('spinning');
            }
        }
    },

    // ==================== Agentic Action Execution ====================

    /**
     * Execute a suggested action. Routes based on action type:
     * - Communication → opens patient/nurse chat and sends the message
     * - New orders (labs/meds/imaging/consults) → opens prefilled OrderEntry
     * - Med changes (hold/stop/increase/decrease) → chat with nurse
     * - Fallback → AI copilot chat
     * @param {string} actionId - Key into this._pendingActions map
     */
    executeAction(actionId) {
        const action = (this._pendingActions || {})[actionId];
        if (!action) {
            console.warn('Action not found:', actionId);
            return;
        }

        const text = typeof action === 'string' ? action : action.text || String(action);
        const category = (this._pendingActionCategories || {})[actionId] || '';

        // 1. Communication actions → route to patient or nurse chat
        if (category === 'communication' || (!action.orderType && this._isCommunicationAction(text))) {
            this._routeToChatWindow(text);
            return;
        }

        // 2. Med changes (hold, stop, discontinue, increase, decrease) → nurse chat
        //    These are NOT new orders — they modify existing ones
        if (this._isMedChangeAction(text)) {
            this._sendToNurseChat(text);
            return;
        }

        // 3. New orders with orderType + orderData → open OrderEntry prefilled
        if (action.orderType && action.orderData && typeof OrderEntry !== 'undefined') {
            console.log('Executing agentic action:', text, '→', action.orderType, action.orderData);
            OrderEntry.openWithPrefill(action.orderType, action.orderData);
            App.showToast(`Opening ${action.orderType} order: ${text}`, 'info');
            return;
        }

        // 4. Fallback → AI copilot chat
        this.askClaudeAbout('Help me: ' + text);
    },

    /**
     * Detect if an action text is a medication change (not a new order).
     * Hold, stop, discontinue, increase dose, decrease dose, titrate, wean.
     */
    _isMedChangeAction(text) {
        return /^(hold|stop|discontinue|d\/c|wean|titrate)\b/i.test(text) ||
               /^(increase|decrease|reduce|uptitrate|downtitrate)\b.*\b(dose|to|from)\b/i.test(text);
    },

    /**
     * Detect if an action text is a communication action.
     */
    _isCommunicationAction(text) {
        return /^(ask|tell|inform|notify|discuss|clarify|confirm|call|page|update)\b/i.test(text);
    },

    /**
     * Route a communication action to the appropriate chat window.
     * "Ask patient..." → patient chat, "Ask nurse..." → nurse chat.
     */
    _routeToChatWindow(text) {
        const isPatientAction = /\b(patient|pt)\b/i.test(text);
        const isNurseAction = /\b(nurse|rn|nursing)\b/i.test(text);

        if (isPatientAction && typeof PatientChat !== 'undefined') {
            this._sendToPatientChat(text);
        } else if (isNurseAction && typeof NurseChat !== 'undefined') {
            this._sendToNurseChat(text);
        } else {
            // Default to patient chat for ambiguous communication
            if (typeof PatientChat !== 'undefined') {
                this._sendToPatientChat(text);
            } else {
                this.askClaudeAbout('Help me: ' + text);
            }
        }
    },

    /**
     * Open the patient chat window and send a message.
     */
    _sendToPatientChat(text) {
        // Open the chat window
        if (typeof FloatingChat !== 'undefined') {
            FloatingChat.openChat('patient');
        }

        // Wait for the chat to initialize, then set the input
        setTimeout(() => {
            const input = document.getElementById('patient-input');
            if (input) {
                input.value = text;
                input.focus();
                App.showToast('Message ready in Patient Chat — press Send', 'info');
            }
        }, 300);
    },

    /**
     * Open the nurse chat window and send a message.
     */
    _sendToNurseChat(text) {
        if (typeof FloatingChat !== 'undefined') {
            FloatingChat.openChat('nurse');
        }

        setTimeout(() => {
            const input = document.getElementById('nurse-input');
            if (input) {
                input.value = text;
                input.focus();
                App.showToast('Message ready in Nurse Chat — press Send', 'info');
            }
        }, 300);
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
            // Apply custom prompt override if user has edited it
            const customAsk = localStorage.getItem('customPrompt_ask_system');
            if (customAsk !== null) {
                systemPrompt = customAsk;
                console.log('📝 Using CUSTOM ask system prompt');
            }
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
                // Check for oneLiner in memory update block
                const memBlockMatch = response.match(/<memory_update>\s*([\s\S]*?)\s*<\/memory_update>/);
                if (memBlockMatch) {
                    try {
                        const memBlock = JSON.parse(memBlockMatch[1]);
                        if (memBlock.oneLiner) {
                            this.state.aiOneLiner = memBlock.oneLiner;
                        }
                    } catch (e) { /* ignore parse errors */ }
                }
            }

            this.state.status = 'ready';
            this.saveState();
            this.render();
        } catch (error) {
            this.state.status = 'ready';
            if (error.message === 'API key not configured') {
                this._pushToThread('ai', 'ask', 'Configure your API key in settings to enable AI responses.');
            } else {
                this._pushToThread('ai', 'ask', 'Sorry, something went wrong. Please try again.');
                App.showToast('AI error. Try again.', 'warning');
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

    /**
     * Robustly parse a JSON response from the LLM.
     * Handles common issues: markdown code fences, extra text before/after, nested braces.
     * Returns parsed object or null on failure.
     */
    _parseJSONResponse(response) {
        if (!response || typeof response !== 'string') return null;

        // 1. Strip markdown code fences if present
        let cleaned = response.replace(/```json\s*/gi, '').replace(/```\s*/g, '');

        // 2. Try direct parse first (ideal case: response IS the JSON)
        try {
            const trimmed = cleaned.trim();
            if (trimmed.startsWith('{')) {
                return JSON.parse(trimmed);
            }
        } catch (e) { /* fall through */ }

        // 3. Extract JSON using balanced brace matching (handles nested objects)
        let jsonStr = null;
        const startIdx = cleaned.indexOf('{');
        if (startIdx === -1) return null;

        let depth = 0;
        let endIdx = -1;
        let inString = false;
        let escape = false;

        for (let i = startIdx; i < cleaned.length; i++) {
            const ch = cleaned[i];
            if (escape) { escape = false; continue; }
            if (ch === '\\') { escape = true; continue; }
            if (ch === '"') { inString = !inString; continue; }
            if (inString) continue;
            if (ch === '{') depth++;
            if (ch === '}') { depth--; if (depth === 0) { endIdx = i; break; } }
        }

        if (endIdx > startIdx) {
            jsonStr = cleaned.substring(startIdx, endIdx + 1);
            try {
                return JSON.parse(jsonStr);
            } catch (e) {
                console.warn('JSON balanced-brace parse failed:', e.message);
                // Try to repair common LLM JSON issues
                try {
                    let repaired = jsonStr.replace(/,\s*([\}\]])/g, '$1');
                    repaired = repaired.replace(/(?<=":[ ]*"[^"]*)\n/g, '\\n');
                    return JSON.parse(repaired);
                } catch (e2) {
                    console.warn('JSON repair attempt also failed:', e2.message);
                }
            }
        }

        // 4. Handle TRUNCATED JSON (response cut off mid-way — no closing brace found)
        // This happens when max_tokens is reached. Try to salvage partial JSON.
        if (endIdx === -1 && startIdx >= 0) {
            console.warn('JSON appears truncated (no closing brace). Attempting truncation repair...');
            let partial = cleaned.substring(startIdx);

            // Strategy: remove the last incomplete value, then close all open braces/brackets
            // First, strip any trailing incomplete string (no closing quote)
            partial = partial.replace(/,\s*"[^"]*":\s*"[^"]*$/, '');   // incomplete "key": "val...
            partial = partial.replace(/,\s*"[^"]*":\s*\[[^\]]*$/, ''); // incomplete "key": [val...
            partial = partial.replace(/,\s*"[^"]*":\s*$/, '');         // "key": <nothing>
            partial = partial.replace(/,\s*"[^"]*$/, '');              // trailing "key with no colon
            partial = partial.replace(/,\s*$/, '');                     // trailing comma

            // Count open braces/brackets and close them
            let openBraces = 0, openBrackets = 0;
            let inStr = false, esc = false;
            for (let i = 0; i < partial.length; i++) {
                const c = partial[i];
                if (esc) { esc = false; continue; }
                if (c === '\\') { esc = true; continue; }
                if (c === '"') { inStr = !inStr; continue; }
                if (inStr) continue;
                if (c === '{') openBraces++;
                if (c === '}') openBraces--;
                if (c === '[') openBrackets++;
                if (c === ']') openBrackets--;
            }

            // If we're inside a string, close it
            if (inStr) partial += '"';

            // Close remaining brackets then braces
            for (let i = 0; i < openBrackets; i++) partial += ']';
            for (let i = 0; i < openBraces; i++) partial += '}';

            try {
                // Fix trailing commas before closing
                let repaired = partial.replace(/,\s*([\}\]])/g, '$1');
                const result = JSON.parse(repaired);
                console.log('✅ Successfully repaired truncated JSON response');
                return result;
            } catch (e) {
                console.warn('Truncated JSON repair failed:', e.message);
            }
        }

        // 5. Fallback: greedy regex (last resort)
        try {
            const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }
        } catch (e) {
            console.warn('JSON regex parse failed:', e.message);
            try {
                const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    let repaired = jsonMatch[0].replace(/,\s*([\}\]])/g, '$1');
                    return JSON.parse(repaired);
                }
            } catch (e2) { /* give up */ }
        }

        console.error('All JSON parse attempts failed. Response preview:', response.substring(0, 300));
        return null;
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
