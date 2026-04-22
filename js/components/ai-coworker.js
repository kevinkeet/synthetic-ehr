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

    // Per-mode analysis cache — stores LLM results keyed by mode ID
    // so switching modes can restore previous analysis without re-calling the API
    _modeAnalysisCache: {},

    // Timestamp of last successful LLM analysis — used to skip redundant
    // auto-analysis when the panel is expanded shortly after a background run
    _lastAnalysisTimestamp: 0,

    // API Configuration
    apiKey: null,
    apiEndpoint: '/api/claude',
    backendAvailable: false,
    model: 'claude-opus-4-7',
    analysisModel: 'claude-opus-4-7', // Opus 4.7 for highest-quality analysis
    dictationModel: 'claude-opus-4-7', // Opus 4.7 for dictation synthesis

    // Current mode config (synced from AIModeConfig)
    get mode_config() {
        return typeof AIModeConfig !== 'undefined' ? AIModeConfig.getMode() : null;
    },

    // Available models for the settings picker
    availableModels: [
        { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', description: 'Fastest, good for structured tasks' },
        { id: 'claude-sonnet-4-5-20250929', label: 'Sonnet 4.5', description: 'Balanced quality and speed' },
        { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', description: 'Latest balanced Sonnet' },
        { id: 'claude-opus-4-6', label: 'Opus 4.6', description: 'Previous flagship' },
        { id: 'claude-opus-4-7', label: 'Opus 4.7', description: 'Highest quality — latest flagship (default)' }
    ],

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

    // Deep Learn state — multi-pass chart analysis
    _deepLearn: {
        phase: 'idle',          // 'idle'|'mapping'|'level1'|'level2+'|'complete'
        chartMap: null,          // { notes: [], labs: [], imaging: [] }
        queue: [],               // prioritized list of { type, id, meta }
        processed: new Set(),    // IDs already analyzed
        totalItems: 0,
        processedCount: 0,
        currentLevel: 0,
        totalLevels: 0,
        levelBatches: [],        // pre-computed batch groupings
        extractedFacts: [],      // accumulated Haiku extractions
        levelFindings: [],       // findings from the last completed level
        aborted: false
    },

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

        this._backendReady = this.detectBackend(); // Detect backend or fall back to direct API
        this.loadModelPreferences(); // Load saved model choices
        this.setupEventListeners();

        // Listen for cloud settings sync (Supabase)
        window.addEventListener('settings:synced-from-cloud', () => {
            console.log('🔐 Cloud settings synced — reloading preferences');
            this.loadApiKeyFallback();
            this.loadModelPreferences();
            if (typeof AIPanel !== 'undefined' && AIPanel.loadSettings) AIPanel.loadSettings();
        });

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

        // Auto-analysis disabled — user clicks Learn/Analyze manually.
        // Memory is restored from localStorage via hydrateFromMemory().
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
            teachingPoints: [], // Heavy mode: clinical pearls from attending
            ddxChallenge: '', // Heavy mode: differential challenge from attending
            executedActions: [], // Persisted: actions/orders executed this session (survives reload via longitudinal doc)
            suggestionOutcomes: [], // Outcome tracking: connects suggestions → orders → results
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

            // Restore deep learn state if available
            this._loadDeepLearnState();

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

        // Hydrate executed actions from longitudinal doc (survives reloads)
        if (mem.executedActions && mem.executedActions.length > 0) {
            this.state.executedActions = mem.executedActions;
            // Also rebuild the _completedActions set for UI dedup
            this._completedActions = this._completedActions || new Set();
            for (const a of mem.executedActions) {
                this._completedActions.add(a.text);
            }
            console.log(`🧠 Restored ${mem.executedActions.length} executed actions from memory`);
        }

        // Hydrate suggestion outcomes
        if (mem.suggestionOutcomes && mem.suggestionOutcomes.length > 0) {
            this.state.suggestionOutcomes = mem.suggestionOutcomes;
        }

        // Hydrate full panel state from memoryDocument (Learn/Analyze output)
        const memDoc = mem.memoryDocument;
        if (memDoc) {
            // Restore one-liner
            if (memDoc.clinicalGestalt && !this.state.aiOneLiner) {
                this.state.aiOneLiner = memDoc.clinicalGestalt;
            }
            // Restore summary
            if (memDoc.patientOverview && !this.state.summary) {
                this.state.summary = memDoc.patientOverview;
            }
            // Restore problem list (same mapping as incremental refresh)
            if (memDoc.problemAnalysis && Array.isArray(memDoc.problemAnalysis) && this.state.problemList.length === 0) {
                this.state.problemList = memDoc.problemAnalysis.map(p => ({
                    name: p.problem,
                    urgency: p.status === 'acute' ? 'urgent' : (p.status === 'active' ? 'active' : 'monitoring'),
                    ddx: null,
                    plan: p.plan || ''
                }));
                console.log(`🧠 Restored ${this.state.problemList.length} problems from memoryDocument`);
            }
            // Restore suggested actions from pending items
            if (memDoc.pendingItems && Array.isArray(memDoc.pendingItems) && this.state.suggestedActions.length === 0) {
                this.state.suggestedActions = memDoc.pendingItems.map((item, idx) => ({
                    id: 'hydrated_pending_' + idx,
                    text: item
                }));
                console.log(`🧠 Restored ${this.state.suggestedActions.length} suggested actions from memoryDocument`);
            }
        }

        if (mem.patientSummary || narrative.trajectoryAssessment || memDoc) {
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

        // Snapshot old memory for diff highlighting in viewer
        const oldSnapshot = this._snapshotMemory(mem);

        // 1. Update patient summary with DEGRADATION PROTECTION
        if (memUpdates.patientSummaryUpdate) {
            const oldSummary = mem.patientSummary || '';
            const newSummary = memUpdates.patientSummaryUpdate;
            const oldLen = oldSummary.length;
            const newLen = newSummary.length;

            // Degradation protection: if new summary is >30% shorter than old one
            // AND the old one was substantial (>200 chars), keep the old one as backup
            // and flag for a merge on next full refresh
            if (oldLen > 200 && newLen < oldLen * 0.7) {
                console.log(`⚠️ Summary degradation detected: ${oldLen} → ${newLen} chars (${Math.round((1 - newLen/oldLen) * 100)}% shorter)`);
                // Save both — the old one as previousSummary for merge reference
                mem.previousSummary = oldSummary;
                mem.patientSummary = newSummary;
                mem._summaryDegraded = true;
            } else {
                // Normal update — keep previous for reference but proceed
                if (oldSummary) mem.previousSummary = oldSummary;
                mem.patientSummary = newSummary;
                mem._summaryDegraded = false;
            }
            mem.version = (mem.version || 0) + 1;
            console.log('🧠 AI Memory: Patient summary updated (v' + mem.version + ', ' + newLen + ' chars)');
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

        // 8. Update confidence-scored findings
        if (memUpdates.keyFindings || (memUpdates.memoryClassification && memUpdates.memoryClassification.backgroundFacts)) {
            this._updateScoredFindings(memUpdates);
        }

        // 9. Track consolidation counter — trigger cleanup every 5 interactions
        mem.consolidationCount = (mem.consolidationCount || 0) + 1;
        if (mem.consolidationCount >= 5) {
            this._consolidateMemory();
            mem.consolidationCount = 0;
        }

        // 10. Check for pending memory gating items (findings needing doctor confirmation)
        this._checkMemoryGating();

        // Persist
        this.saveLongitudinalDoc();

        console.log('🧠 AI Memory write-back complete:', {
            hasSummary: !!mem.patientSummary,
            problemInsights: mem.problemInsights.size,
            interactionLog: mem.interactionLog.length,
            scoredFindings: (this.longitudinalDoc.scoredFindings || []).length,
            version: mem.version
        });

        // Update memory viewer with diff highlighting
        this._updateMemoryViewer(oldSnapshot);
    },

    // =====================================================
    // MEMORY VIEWER: Live document popup with diff highlighting
    // =====================================================

    _memoryViewerOpen: false,

    /**
     * Toggle the memory viewer popup
     */
    toggleMemoryViewer() {
        if (this._memoryViewerOpen) {
            this.closeMemoryViewer();
        } else {
            this.openMemoryViewer();
        }
    },

    /**
     * Open the memory viewer popup
     */
    openMemoryViewer() {
        this._memoryViewerOpen = true;
        let popup = document.getElementById('memory-viewer-popup');
        if (!popup) {
            popup = document.createElement('div');
            popup.id = 'memory-viewer-popup';
            popup.className = 'memory-viewer-popup';
            document.body.appendChild(popup);
        }
        popup.style.display = 'flex';
        requestAnimationFrame(() => popup.classList.add('visible'));
        this.renderMemoryViewer();
    },

    /**
     * Close the memory viewer popup
     */
    closeMemoryViewer() {
        this._memoryViewerOpen = false;
        const popup = document.getElementById('memory-viewer-popup');
        if (popup) {
            popup.classList.remove('visible');
            setTimeout(() => { popup.style.display = 'none'; }, 200);
        }
    },

    /**
     * Snapshot current memory state for diff comparison
     */
    _snapshotMemory(mem) {
        if (!mem) return {};
        return {
            patientSummary: mem.patientSummary || '',
            problemInsights: mem.problemInsights ? new Map(mem.problemInsights) : new Map(),
            interactionLogLen: (mem.interactionLog || []).length,
            version: mem.version || 0
        };
    },

    /**
     * Render the memory viewer — shows the ACTUAL knowledge base the AI uses.
     * Color-codes content by learning level so users can see understanding deepen.
     */
    renderMemoryViewer(diffFields) {
        const popup = document.getElementById('memory-viewer-popup');
        if (!popup) return;

        const mem = this.longitudinalDoc?.aiMemory;
        if (!mem) {
            popup.innerHTML = '<div class="memory-viewer-header"><span>🧠 AI Knowledge Base</span><button onclick="AICoworker.closeMemoryViewer()">✕</button></div><div class="memory-viewer-body"><div class="memory-empty">No memory yet. Run "Learn Patient" or "Analyze Case" first.</div></div>';
            return;
        }

        const doc = mem.memoryDocument;
        const levelHistory = mem._levelHistory || [];
        // Build a map: for each level, what's new/changed
        const latestDiff = levelHistory.length > 0 ? levelHistory[levelHistory.length - 1].diff : null;
        const maxLevel = doc?._levelMeta?.lastLevel || 1;

        // Level color palette
        const levelColors = [
            '', // unused (0)
            '#6366f1', // Level 1 — indigo
            '#3b82f6', // Level 2 — blue
            '#06b6d4', // Level 3 — cyan
            '#10b981', // Level 4 — emerald
            '#f59e0b', // Level 5 — amber
            '#ef4444', // Level 6 — red
            '#8b5cf6', // Level 7 — violet
            '#ec4899', // Level 8 — pink
        ];
        const getLevelColor = (lvl) => levelColors[Math.min(lvl, levelColors.length - 1)] || '#94a3b8';
        const levelTag = (lvl) => `<span class="memory-level-tag" style="background: ${getLevelColor(lvl)}20; color: ${getLevelColor(lvl)}; border: 1px solid ${getLevelColor(lvl)}40;">L${lvl}</span>`;

        const showRaw = this._memoryViewerRawMode || false;

        let html = '<div class="memory-viewer-header">';
        html += '<span>🧠 AI Knowledge Base</span>';
        html += '<div class="memory-header-actions">';
        html += `<button class="memory-raw-toggle${showRaw ? ' active' : ''}" onclick="AICoworker._memoryViewerRawMode = !AICoworker._memoryViewerRawMode; AICoworker.renderMemoryViewer();" title="Toggle raw JSON view">&lt;/&gt;</button>`;
        html += `<span class="memory-meta">v${mem.version || 0}</span>`;
        html += '<button onclick="AICoworker.closeMemoryViewer()">✕</button>';
        html += '</div>';
        html += '</div>';

        // Level legend
        if (levelHistory.length > 0) {
            html += '<div class="memory-level-legend">';
            for (let i = 1; i <= maxLevel; i++) {
                const entry = levelHistory.find(h => h.level === i);
                const time = entry ? new Date(entry.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '';
                html += `<span class="memory-level-chip" style="background: ${getLevelColor(i)}18; color: ${getLevelColor(i)}; border: 1px solid ${getLevelColor(i)}35;">`;
                html += `Level ${i}`;
                if (time) html += ` <span class="memory-level-time">${time}</span>`;
                html += '</span>';
            }
            html += '</div>';
        }

        html += '<div class="memory-viewer-body">';

        // RAW JSON VIEW — show the actual document structure
        if (showRaw && doc) {
            html += '<div class="memory-raw-view">';
            // Strip internal metadata for display
            const displayDoc = Object.assign({}, doc);
            delete displayDoc._levelMeta;
            const jsonStr = JSON.stringify(displayDoc, null, 2);
            // Syntax highlight: keys, strings, numbers, booleans
            const highlighted = this.escapeHtml(jsonStr)
                .replace(/"([^"]+)":/g, '<span class="json-key">"$1"</span>:')
                .replace(/: "([^"]*?)"/g, ': <span class="json-string">"$1"</span>')
                .replace(/: (\d+\.?\d*)/g, ': <span class="json-number">$1</span>')
                .replace(/: (true|false|null)/g, ': <span class="json-bool">$1</span>');
            html += `<pre class="memory-raw-json">${highlighted}</pre>`;
            html += '</div>';
        } else if (doc) {
            // Helper: check if an item index is new at a specific level
            const isNewAtLatestLevel = (section, idx) => {
                if (!latestDiff) return false;
                if (section === 'problems') return latestDiff.newProblems?.includes(idx);
                if (section === 'changedProblems') return latestDiff.changedProblems?.includes(idx);
                if (section === 'meds') return latestDiff.newMeds?.includes(idx);
                if (section === 'labs') return latestDiff.newLabTrends?.includes(idx);
                if (section === 'pending') return latestDiff.newPendingItems?.includes(idx);
                return false;
            };
            const latestLevelColor = getLevelColor(maxLevel);
            const itemLevelStyle = (isNew) => isNew ? ` style="border-left: 3px solid ${latestLevelColor}; padding-left: 8px;"` : '';

            // === PATIENT OVERVIEW ===
            if (doc.patientOverview) {
                const changed = latestDiff?.overviewChanged && maxLevel > 1;
                html += '<div class="memory-section">';
                html += `<div class="memory-section-title">Patient Overview ${changed ? levelTag(maxLevel) + ' <span class="memory-updated-label">updated</span>' : ''}</div>`;
                html += `<div class="memory-section-content"${changed ? ` style="border-left: 3px solid ${latestLevelColor}; padding-left: 10px;"` : ''}>`;
                doc.patientOverview.split('\n').forEach(line => {
                    html += `<div>${this.escapeHtml(line) || '&nbsp;'}</div>`;
                });
                html += '</div></div>';
            }

            // === PROBLEM ANALYSIS ===
            if (doc.problemAnalysis && doc.problemAnalysis.length > 0) {
                html += '<div class="memory-section">';
                html += `<div class="memory-section-title">Problem Analysis (${doc.problemAnalysis.length})</div>`;
                html += '<div class="memory-section-content">';
                doc.problemAnalysis.forEach((p, i) => {
                    const isNew = isNewAtLatestLevel('problems', i);
                    const isChanged = isNewAtLatestLevel('changedProblems', i);
                    const tag = isNew ? ' ' + levelTag(maxLevel) + ' <span class="memory-new-badge">new</span>' :
                                isChanged ? ' ' + levelTag(maxLevel) + ' <span class="memory-updated-label">updated</span>' : '';
                    html += `<div class="memory-problem-item"${itemLevelStyle(isNew || isChanged)}>`;
                    const statusBadge = p.status ? `<span class="memory-status-badge memory-status-${p.status}">${p.status}</span>` : '';
                    const trendArrow = p.trajectory === 'improving' ? ' ↗' : p.trajectory === 'worsening' ? ' ↘' : p.trajectory === 'stable' ? ' →' : '';
                    html += `<div class="memory-problem-name">${this.escapeHtml(p.problem || '')} ${statusBadge}${trendArrow}${tag}</div>`;
                    if (p.plan) html += `<div class="memory-problem-plan"><strong>Plan:</strong> ${this.escapeHtml(p.plan)}</div>`;
                    if (p.keyData && p.keyData.length) {
                        html += '<div class="memory-problem-data">';
                        p.keyData.forEach(d => { html += `<div>• ${this.escapeHtml(d)}</div>`; });
                        html += '</div>';
                    }
                    if (p.timeline) html += `<div class="memory-problem-timeline"><strong>Timeline:</strong> ${this.escapeHtml(p.timeline)}</div>`;
                    if (p.medRationale) html += `<div class="memory-problem-meds"><strong>Meds:</strong> ${this.escapeHtml(p.medRationale)}</div>`;
                    html += '</div>';
                });
                html += '</div></div>';
            }

            // === SAFETY PROFILE ===
            if (doc.safetyProfile) {
                const sp = doc.safetyProfile;
                html += '<div class="memory-section memory-section-safety">';
                html += '<div class="memory-section-title">⚠️ Safety Profile</div>';
                html += '<div class="memory-section-content">';
                if (sp.allergies && sp.allergies.length) {
                    html += '<div class="memory-safety-group"><strong>Allergies:</strong>';
                    sp.allergies.forEach(a => {
                        const sev = a.severity ? ` [${a.severity}]` : '';
                        html += `<div>• ${this.escapeHtml(a.substance || '')}${sev} — ${this.escapeHtml(a.reaction || '')}`;
                        if (a.implications) html += ` <em>(${this.escapeHtml(a.implications)})</em>`;
                        html += '</div>';
                    });
                    html += '</div>';
                }
                if (sp.contraindications && sp.contraindications.length) {
                    html += '<div class="memory-safety-group"><strong>Contraindications:</strong>';
                    sp.contraindications.forEach(c => { html += `<div>• ${this.escapeHtml(c)}</div>`; });
                    html += '</div>';
                }
                if (sp.criticalValues && sp.criticalValues.length) {
                    html += '<div class="memory-safety-group"><strong>Critical Values:</strong>';
                    sp.criticalValues.forEach(v => { html += `<div>• ${this.escapeHtml(v)}</div>`; });
                    html += '</div>';
                }
                if (sp.renalDosing && sp.renalDosing.length) {
                    html += '<div class="memory-safety-group"><strong>Renal Dosing:</strong>';
                    sp.renalDosing.forEach(r => { html += `<div>• ${this.escapeHtml(r)}</div>`; });
                    html += '</div>';
                }
                html += '</div></div>';
            }

            // === MEDICATION RATIONALE ===
            if (doc.medicationRationale && doc.medicationRationale.length) {
                html += '<div class="memory-section">';
                html += `<div class="memory-section-title">💊 Medication Rationale (${doc.medicationRationale.length})</div>`;
                html += '<div class="memory-section-content">';
                doc.medicationRationale.forEach((m, i) => {
                    const isNew = isNewAtLatestLevel('meds', i);
                    html += `<div class="memory-med-item"${itemLevelStyle(isNew)}>`;
                    html += `<div class="memory-med-name">${this.escapeHtml(m.name || '')}${isNew ? ' ' + levelTag(maxLevel) : ''}</div>`;
                    if (m.indication) html += `<div class="memory-med-detail"><strong>For:</strong> ${this.escapeHtml(m.indication)}</div>`;
                    if (m.rationale) html += `<div class="memory-med-detail"><strong>Why:</strong> ${this.escapeHtml(m.rationale)}</div>`;
                    if (m.monitoring) html += `<div class="memory-med-detail"><strong>Monitor:</strong> ${this.escapeHtml(m.monitoring)}</div>`;
                    html += '</div>';
                });
                html += '</div></div>';
            }

            // === LAB TRENDS ===
            if (doc.labTrends && doc.labTrends.key_values && doc.labTrends.key_values.length) {
                html += '<div class="memory-section">';
                html += `<div class="memory-section-title">🔬 Lab Trends (${doc.labTrends.key_values.length})</div>`;
                html += '<div class="memory-section-content">';
                doc.labTrends.key_values.forEach((lab, i) => {
                    const isNew = isNewAtLatestLevel('labs', i);
                    const trendArrow = lab.trend === 'rising' ? '↑' : lab.trend === 'falling' ? '↓' : lab.trend === 'stable' ? '→' : '~';
                    html += `<div class="memory-lab-item"${itemLevelStyle(isNew)}>`;
                    html += `<strong>${this.escapeHtml(lab.test || '')}</strong> ${trendArrow} `;
                    if (isNew) html += levelTag(maxLevel) + ' ';
                    if (lab.values && lab.values.length) {
                        const recent = lab.values.slice(-3).map(v => v.value + (v.flag && v.flag !== 'normal' ? ` [${v.flag}]` : '')).join(' → ');
                        html += `<span class="memory-lab-values">${this.escapeHtml(recent)}</span>`;
                    }
                    if (lab.significance) html += `<div class="memory-muted">${this.escapeHtml(lab.significance)}</div>`;
                    html += '</div>';
                });
                html += '</div></div>';
            }

            // === PENDING ITEMS ===
            if (doc.pendingItems && doc.pendingItems.length) {
                html += '<div class="memory-section">';
                html += `<div class="memory-section-title">📋 Pending Items (${doc.pendingItems.length})</div>`;
                html += '<div class="memory-section-content">';
                doc.pendingItems.forEach((item, i) => {
                    const isNew = isNewAtLatestLevel('pending', i);
                    html += `<div${itemLevelStyle(isNew)}>• ${this.escapeHtml(item)}${isNew ? ' ' + levelTag(maxLevel) : ''}</div>`;
                });
                html += '</div></div>';
            }

            // === CLINICAL GESTALT ===
            if (doc.clinicalGestalt) {
                const changed = latestDiff?.gestaltChanged && maxLevel > 1;
                html += '<div class="memory-section">';
                html += `<div class="memory-section-title">Clinical Gestalt ${changed ? levelTag(maxLevel) + ' <span class="memory-updated-label">updated</span>' : ''}</div>`;
                html += `<div class="memory-section-content"><em>${this.escapeHtml(doc.clinicalGestalt)}</em></div>`;
                html += '</div>';
            }
        } else if (mem.patientSummary) {
            html += '<div class="memory-section">';
            html += '<div class="memory-section-title">Patient Summary (from analysis)</div>';
            html += '<div class="memory-section-content">';
            mem.patientSummary.split('\n').forEach(line => {
                html += `<div>${this.escapeHtml(line) || '&nbsp;'}</div>`;
            });
            html += '</div></div>';
        } else {
            html += '<div class="memory-empty">No knowledge base yet. Run "Learn Patient" to build one.</div>';
        }

        // === METADATA ===
        html += '<div class="memory-section memory-section-meta">';
        html += '<div class="memory-section-title">Metadata</div>';
        html += '<div class="memory-section-content">';
        if (mem.lastLearnedAt) html += `<div>Learned: ${new Date(mem.lastLearnedAt).toLocaleString()}</div>`;
        if (mem.lastRefreshedAt) html += `<div>Refreshed: ${new Date(mem.lastRefreshedAt).toLocaleString()}</div>`;
        if (mem.lastDigestedAt) html += `<div>Last dictation: ${new Date(mem.lastDigestedAt).toLocaleString()}</div>`;
        html += `<div>Version: ${mem.version || 0} | Interactions: ${(mem.interactionLog || []).length}</div>`;
        if (levelHistory.length > 0) html += `<div>Levels learned: ${levelHistory.length} (latest: Level ${maxLevel})</div>`;
        html += '</div></div>';

        html += '</div>';
        popup.innerHTML = html;
    },

    /**
     * Update memory viewer with diff highlighting after a write-back
     */
    _updateMemoryViewer(oldSnapshot) {
        if (!this._memoryViewerOpen) return;

        const mem = this.longitudinalDoc?.aiMemory;
        if (!mem || !oldSnapshot) {
            this.renderMemoryViewer();
            return;
        }

        // Compute diffs
        const diffLines = { summaryLines: new Set(), newInsights: new Set(), newInteraction: false };

        // Summary line-by-line diff
        const oldLines = (oldSnapshot.patientSummary || '').split('\n');
        const newLines = (mem.patientSummary || '').split('\n');
        newLines.forEach((line, i) => {
            if (i >= oldLines.length || line !== oldLines[i]) {
                diffLines.summaryLines.add(i);
            }
        });

        // New or changed problem insights
        if (mem.problemInsights) {
            mem.problemInsights.forEach((insight, id) => {
                const oldInsight = oldSnapshot.problemInsights ? oldSnapshot.problemInsights.get(id) : undefined;
                if (oldInsight === undefined || oldInsight !== insight) {
                    diffLines.newInsights.add(id);
                }
            });
        }

        // New interaction log entry
        if ((mem.interactionLog || []).length > (oldSnapshot.interactionLogLen || 0)) {
            diffLines.newInteraction = true;
        }

        this.renderMemoryViewer(diffLines);
    },

    // =====================================================
    // OUTCOME TRACKING: Connect suggestions → orders → results
    // =====================================================

    /**
     * Track which AI suggestion led to an executed action.
     * Called from executeAction() to build the suggestion → order link.
     * Later, when new lab/vital data arrives, we'll connect order → result.
     */
    _trackSuggestionOutcome(executedAction) {
        if (!this.longitudinalDoc) return;

        // Find the most recent AI suggestion that matches this action
        const recentSuggestions = this.state.suggestedActions || [];
        const categorizedActions = this.state.categorizedActions || {};
        const allSuggestions = [
            ...recentSuggestions.map(s => typeof s === 'string' ? s : s.text),
            ...Object.values(categorizedActions).flat().map(a => typeof a === 'string' ? a : a.text)
        ].filter(Boolean);

        // Fuzzy match: find the suggestion most similar to what was executed
        const actionText = executedAction.text.toLowerCase();
        let bestMatch = null;
        let bestScore = 0;
        for (const suggestion of allSuggestions) {
            const suggText = suggestion.toLowerCase();
            // Simple overlap scoring
            const words = actionText.split(/\s+/);
            const matchedWords = words.filter(w => w.length > 2 && suggText.includes(w));
            const score = matchedWords.length / words.length;
            if (score > bestScore && score > 0.4) {
                bestScore = score;
                bestMatch = suggestion;
            }
        }

        const outcome = {
            id: 'outcome_' + Date.now(),
            suggestion: bestMatch || executedAction.text,
            action: executedAction.text,
            actionTimestamp: executedAction.timestamp,
            orderType: executedAction.orderType,
            orderData: executedAction.orderData,
            // These will be filled in later when results arrive:
            resultText: null,
            resultTimestamp: null,
            wasHelpful: null, // null = pending, true = confirmed helpful, false = not helpful
            status: 'awaiting_result' // awaiting_result → result_available → assessed
        };

        if (!this.longitudinalDoc.aiMemory.suggestionOutcomes) {
            this.longitudinalDoc.aiMemory.suggestionOutcomes = [];
        }
        this.longitudinalDoc.aiMemory.suggestionOutcomes.push(outcome);
        if (this.longitudinalDoc.aiMemory.suggestionOutcomes.length > 20) {
            this.longitudinalDoc.aiMemory.suggestionOutcomes =
                this.longitudinalDoc.aiMemory.suggestionOutcomes.slice(-20);
        }

        // Also sync to state
        this.state.suggestionOutcomes = this.longitudinalDoc.aiMemory.suggestionOutcomes;

        console.log('📊 Outcome tracked:', {
            suggestion: bestMatch ? bestMatch.substring(0, 50) : '(direct)',
            action: executedAction.text.substring(0, 50),
            matchScore: bestScore.toFixed(2)
        });
    },

    /**
     * Check for new results that match pending suggestion outcomes.
     * Called during data refresh or when new labs/vitals arrive.
     * Connects the order → result link in the outcome chain.
     */
    _checkOutcomeResults() {
        if (!this.longitudinalDoc) return;
        const outcomes = this.longitudinalDoc.aiMemory.suggestionOutcomes || [];
        const pendingOutcomes = outcomes.filter(o => o.status === 'awaiting_result');
        if (pendingOutcomes.length === 0) return;

        // Look at recent labs and vitals for potential matches
        const recentLabs = [];
        for (const [name, trend] of this.longitudinalDoc.longitudinalData.labs) {
            if (trend.latestValue) {
                recentLabs.push({
                    name: name,
                    value: trend.latestValue.value,
                    unit: trend.latestValue.unit,
                    flag: trend.latestValue.flag,
                    date: trend.latestValue.date
                });
            }
        }

        for (const outcome of pendingOutcomes) {
            if (!outcome.orderType) continue;

            // For lab orders, check if a matching lab result has arrived since the order
            if (outcome.orderType === 'lab' && outcome.orderData) {
                const labName = (outcome.orderData.name || '').toLowerCase();
                const matchingLab = recentLabs.find(l => {
                    const matchesName = l.name.toLowerCase().includes(labName) ||
                        labName.includes(l.name.toLowerCase());
                    const afterOrder = new Date(l.date) > new Date(outcome.actionTimestamp);
                    return matchesName && afterOrder;
                });

                if (matchingLab) {
                    outcome.resultText = `${matchingLab.name}: ${matchingLab.value} ${matchingLab.unit || ''}${matchingLab.flag ? ' [' + matchingLab.flag + ']' : ''}`;
                    outcome.resultTimestamp = matchingLab.date;
                    outcome.status = 'result_available';
                    console.log('📊 Outcome result linked:', outcome.action, '→', outcome.resultText);
                }
            }
        }
    },

    // =====================================================
    // CONFIDENCE-SCORED FINDINGS
    // =====================================================

    /**
     * Update confidence-scored findings from LLM response.
     * New findings start at confidence 0.6, existing ones get reinforced.
     * Findings decay over time if not reinforced.
     */
    _updateScoredFindings(memUpdates) {
        if (!this.longitudinalDoc) return;
        const scored = this.longitudinalDoc.scoredFindings || [];
        const now = new Date().toISOString();

        // Apply temporal decay to all existing findings first
        for (const f of scored) {
            const hoursSinceReinforced = (Date.now() - new Date(f.lastReinforced || f.firstSeen).getTime()) / (1000 * 60 * 60);
            // Decay rate: lose 0.02 confidence per hour (halving in ~25 hours)
            f.confidence = Math.max(0.1, f.confidence - (hoursSinceReinforced * 0.02 * (f.decayRate || 1)));
        }

        // Process new findings from LLM
        const newFindings = [];
        if (memUpdates.keyFindings && Array.isArray(memUpdates.keyFindings)) {
            newFindings.push(...memUpdates.keyFindings);
        }

        for (const findingText of newFindings) {
            if (!findingText || typeof findingText !== 'string') continue;
            const normalized = findingText.toLowerCase().trim();

            // Check if this finding already exists (fuzzy match)
            const existing = scored.find(f => {
                const existingNorm = f.text.toLowerCase().trim();
                // Exact match or high word overlap
                if (existingNorm === normalized) return true;
                const words = normalized.split(/\s+/).filter(w => w.length > 3);
                const matchedWords = words.filter(w => existingNorm.includes(w));
                return matchedWords.length / words.length > 0.6;
            });

            if (existing) {
                // Reinforce: boost confidence, update text if newer is more specific
                existing.confidence = Math.min(1.0, existing.confidence + 0.15);
                existing.lastReinforced = now;
                existing.reinforcementCount = (existing.reinforcementCount || 0) + 1;
                // If new text is longer (more detailed), update
                if (findingText.length > existing.text.length) {
                    existing.text = findingText;
                }
            } else {
                // New finding — starts at moderate confidence
                scored.push({
                    text: findingText,
                    confidence: 0.6,
                    firstSeen: now,
                    lastReinforced: now,
                    reinforcementCount: 0,
                    source: 'llm',
                    decayRate: 1.0, // Normal decay; doctor-confirmed findings get 0.2 (slower decay)
                    confirmed: false // Not yet confirmed by doctor
                });
            }
        }

        // Prune findings below confidence threshold
        this.longitudinalDoc.scoredFindings = scored
            .filter(f => f.confidence > 0.15 || f.confirmed)
            .sort((a, b) => b.confidence - a.confidence)
            .slice(0, 30);
    },

    // =====================================================
    // MEMORY CONSOLIDATION
    // =====================================================

    /**
     * Periodic memory cleanup. Runs every 5 LLM interactions.
     * - Prunes stale problem insights for resolved problems
     * - Resolves old pending decisions (auto-expire after 24h)
     * - Removes superseded observations
     * - Cleans up old conflicts
     * - Deduplicates background facts
     */
    _consolidateMemory() {
        if (!this.longitudinalDoc) return;
        console.log('🧹 Running memory consolidation...');

        const doc = this.longitudinalDoc;
        const mem = doc.aiMemory;
        const ctx = doc.sessionContext;
        const now = Date.now();
        let cleaned = 0;

        // 1. Prune problem insights for resolved problems
        const activeProblems = new Set();
        for (const [id, timeline] of doc.problemMatrix) {
            if (timeline.problem.status === 'active') {
                activeProblems.add(id);
            }
        }
        for (const [id] of mem.problemInsights) {
            if (!activeProblems.has(id) && !doc.problemMatrix.has(id)) {
                mem.problemInsights.delete(id);
                cleaned++;
            }
        }

        // 2. Auto-expire old pending decisions (>24h without resolution)
        if (ctx?.activeClinicalState?.pendingDecisions) {
            const decisions = ctx.activeClinicalState.pendingDecisions;
            for (const d of decisions) {
                if (!d.resolvedAt && d.raisedAt) {
                    const age = now - new Date(d.raisedAt).getTime();
                    if (age > 24 * 60 * 60 * 1000) {
                        d.resolvedAt = new Date().toISOString();
                        d.resolution = 'auto-expired (>24h)';
                        cleaned++;
                    }
                }
            }
            // Remove resolved decisions older than 48h
            ctx.activeClinicalState.pendingDecisions = decisions.filter(d => {
                if (!d.resolvedAt) return true;
                return now - new Date(d.resolvedAt).getTime() < 48 * 60 * 60 * 1000;
            });
        }

        // 3. Remove old superseded observations
        if (ctx?.aiObservations) {
            const before = ctx.aiObservations.length;
            ctx.aiObservations = ctx.aiObservations.filter(o => {
                if (typeof o === 'object' && o.status === 'superseded') {
                    const age = now - new Date(o.timestamp || 0).getTime();
                    return age < 12 * 60 * 60 * 1000; // Keep for 12h for reference
                }
                return true;
            });
            cleaned += before - ctx.aiObservations.length;
        }

        // 4. Resolve old conflicts (>48h)
        if (ctx?.conflicts) {
            for (const c of ctx.conflicts) {
                if (!c.resolvedAt && c.detectedAt) {
                    const age = now - new Date(c.detectedAt).getTime();
                    if (age > 48 * 60 * 60 * 1000) {
                        c.resolvedAt = new Date().toISOString();
                        c.resolution = 'auto-expired';
                        cleaned++;
                    }
                }
            }
        }

        // 5. Deduplicate background facts
        if (ctx?.activeClinicalState?.backgroundFacts) {
            const seen = new Set();
            ctx.activeClinicalState.backgroundFacts = ctx.activeClinicalState.backgroundFacts.filter(f => {
                const key = (typeof f === 'string' ? f : f.text).toLowerCase().trim();
                if (seen.has(key)) { cleaned++; return false; }
                seen.add(key);
                return true;
            });
        }

        // 6. Clean up old executed actions (>72h)
        if (mem.executedActions) {
            const before = mem.executedActions.length;
            mem.executedActions = mem.executedActions.filter(a => {
                return now - new Date(a.timestamp).getTime() < 72 * 60 * 60 * 1000;
            });
            cleaned += before - mem.executedActions.length;
        }

        console.log(`🧹 Memory consolidation complete: ${cleaned} items cleaned`);
    },

    // =====================================================
    // HUMAN-IN-THE-LOOP MEMORY GATING
    // =====================================================

    /**
     * Check for new high-confidence findings or conflicts that should be
     * surfaced to the doctor for confirmation/dismissal.
     * Shows a subtle notification bar that doesn't interrupt workflow.
     */
    _checkMemoryGating() {
        if (!this.longitudinalDoc) return;

        const scored = this.longitudinalDoc.scoredFindings || [];
        const ungated = scored.filter(f =>
            !f.confirmed &&
            f.confidence > 0.75 &&
            f.reinforcementCount >= 2 // Mentioned at least 3 times
        );

        if (ungated.length === 0) return;

        // Show the memory gating bar with the most confident unconfirmed finding
        const topFinding = ungated[0];
        this._showMemoryGatingBar(topFinding);
    },

    /**
     * Show a subtle notification bar asking the doctor to confirm or dismiss
     * a finding the AI has been tracking.
     */
    _showMemoryGatingBar(finding) {
        // Don't show if one is already visible
        if (document.querySelector('.memory-gating-bar')) return;

        const bar = document.createElement('div');
        bar.className = 'memory-gating-bar';
        bar.innerHTML = `
            <div class="memory-gating-content">
                <span class="memory-gating-icon">🧠</span>
                <span class="memory-gating-text">AI finding: <strong>${finding.text}</strong></span>
                <span class="memory-gating-confidence">${Math.round(finding.confidence * 100)}% confident</span>
            </div>
            <div class="memory-gating-actions">
                <button class="memory-gate-btn confirm" onclick="AICoworker._confirmFinding('${finding.text.replace(/'/g, "\\'")}')">✓ Confirm</button>
                <button class="memory-gate-btn dismiss" onclick="AICoworker._dismissFinding('${finding.text.replace(/'/g, "\\'")}')">✗ Dismiss</button>
                <button class="memory-gate-btn later" onclick="this.closest('.memory-gating-bar').remove()">Later</button>
            </div>
        `;

        // Insert after the AI panel header
        const aiPanel = document.querySelector('.ai-panel-content') || document.querySelector('#ai-panel');
        if (aiPanel) {
            aiPanel.insertBefore(bar, aiPanel.firstChild);
        }
    },

    /**
     * Doctor confirms a finding — boost confidence and slow decay rate
     */
    _confirmFinding(findingText) {
        if (!this.longitudinalDoc) return;
        const scored = this.longitudinalDoc.scoredFindings || [];
        const finding = scored.find(f => f.text === findingText);
        if (finding) {
            finding.confirmed = true;
            finding.confidence = Math.min(1.0, finding.confidence + 0.2);
            finding.decayRate = 0.2; // 5x slower decay for confirmed findings
            finding.confirmedAt = new Date().toISOString();
            this.saveLongitudinalDoc();
            console.log('✅ Finding confirmed by doctor:', findingText.substring(0, 60));
        }
        const bar = document.querySelector('.memory-gating-bar');
        if (bar) bar.remove();
        App.showToast('Finding confirmed — will persist in memory', 'success');
    },

    /**
     * Doctor dismisses a finding — remove it from memory
     */
    _dismissFinding(findingText) {
        if (!this.longitudinalDoc) return;
        const scored = this.longitudinalDoc.scoredFindings || [];
        this.longitudinalDoc.scoredFindings = scored.filter(f => f.text !== findingText);
        this.saveLongitudinalDoc();
        console.log('❌ Finding dismissed by doctor:', findingText.substring(0, 60));
        const bar = document.querySelector('.memory-gating-bar');
        if (bar) bar.remove();
        App.showToast('Finding dismissed', 'info');
    },

    /**
     * Create modals (no longer creates a floating panel - renders into AI panel tab)
     */
    createPanel() {
        // Create note writing modal
        this.createNoteModal();
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
                        <label class="note-type-option">
                            <input type="radio" name="note-type" value="patient-instructions">
                            <span class="note-type-card">
                                <span class="note-type-icon">📄</span>
                                <span class="note-type-name">Instructions</span>
                                <span class="note-type-desc">Patient / AVS Instructions</span>
                            </span>
                        </label>
                        <label class="note-type-option">
                            <input type="radio" name="note-type" value="patient-letter">
                            <span class="note-type-card">
                                <span class="note-type-icon">✉️</span>
                                <span class="note-type-name">Letter</span>
                                <span class="note-type-desc">Letter to Patient</span>
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
                            <label><input type="checkbox" id="include-ambient" checked> Ambient Conversation</label>
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
                    <button class="btn btn-primary" onclick="AICoworker.generateNoteFromModal()">✨ Generate Draft</button>
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
     * Handle AI mode change (Reactive / Responsive / Anticipatory)
     */
    onModeChanged(modeId) {
        // Show toast indicating mode change
        if (typeof AIModeConfig !== 'undefined') {
            var mode = AIModeConfig.getMode();
            if (typeof App !== 'undefined') {
                App.showToast('AI Mode: ' + mode.label, 'info');
            }
        }

        // Try to restore cached analysis for this mode
        if (this._modeAnalysisCache[modeId]) {
            this._restoreModeCache(modeId);
            this.render();
            return;
        }

        // Re-render first (shows current state while we load)
        this.render();

        // Auto-analysis disabled — user clicks Learn/Analyze manually.
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
        var isThinking = this.state.status === 'thinking';
        var isLearning = this.state.status === 'learning';
        var sections = this.mode_config ? this.mode_config.sections : { alertBar: true, clinicalSummary: true, problemList: true, suggestedActions: true, conversationThread: true, teachingPoints: false, ddxChallenge: false };

        // ===== LEARNING BANNER (shown when AI is reading the chart) =====
        if (isLearning) {
            html += '<div class="copilot-thinking-banner learning-banner">';
            html += '<div class="thinking-banner-content">';
            html += '<span class="thinking-sparkle"><i data-lucide="brain" class="lucide-inline"></i></span>';
            html += '<span class="thinking-label">Learning patient chart</span>';
            html += '<span class="thinking-dots"><span>.</span><span>.</span><span>.</span></span>';
            html += '</div>';
            html += '<div class="learning-stages">';
            html += '<span class="learning-stage active">Reading chart</span>';
            html += '<span class="learning-stage-arrow">→</span>';
            html += '<span class="learning-stage">Building memory</span>';
            html += '<span class="learning-stage-arrow">→</span>';
            html += '<span class="learning-stage">Safety profile</span>';
            html += '</div>';
            html += '<div class="thinking-progress-bar"><div class="thinking-progress-fill learning-fill"></div></div>';
            html += '</div>';
        }

        // ===== THINKING BANNER (shown when AI is processing) =====
        if (isThinking) {
            // Dynamic label based on streaming phase
            const phaseLabels = {
                'summary': 'Updating clinical summary',
                'problems': 'Generating problem list',
                'actions': 'Planning suggested actions'
            };
            const thinkingLabel = phaseLabels[this._streamingPhase] || 'Analyzing clinical context';

            html += '<div class="copilot-thinking-banner">';
            html += '<div class="thinking-banner-content">';
            html += '<span class="thinking-sparkle"><i data-lucide="sparkles" class="lucide-inline"></i></span>';
            html += `<span class="thinking-label">${thinkingLabel}</span>`;
            html += '<span class="thinking-dots"><span>.</span><span>.</span><span>.</span></span>';
            html += '</div>';
            html += '<div class="thinking-progress-bar"><div class="thinking-progress-fill"></div></div>';
            html += '</div>';
        }

        // ===== LEARN PATIENT BAR =====
        html += this.renderLearnBar();

        // ===== SECTION 1: SAFETY BAR (sticky top, only when alerts exist) =====
        if (sections.alertBar) html += this.renderAlertBar();

        // ===== SECTION 1.5: CONTEXT LINE (Reactive mode — minimal 1-line summary) =====
        if (sections.contextLine) html += this.renderContextLine();

        // ===== SECTION 1.7: ONE-LINER (AI gestalt) =====
        if (sections.clinicalSummary) html += this.renderStatusLine();

        // ===== SECTION 2: CLINICAL SUMMARY (3 sentences) =====
        if (sections.clinicalSummary) html += this.renderClinicalSummary(isThinking);

        // ===== SECTION 3: PROBLEM LIST =====
        if (sections.problemList) html += this.renderProblemList();

        // ===== SECTION 4: SUGGESTED ACTIONS =====
        if (sections.suggestedActions) html += this.renderSuggestedActions(isThinking);

        // ===== SECTION 5: TEACHING POINTS (Heavy mode only) =====
        if (sections.teachingPoints) html += this.renderTeachingPoints();

        // ===== SECTION 6: DDx CHALLENGE (Heavy mode only) =====
        if (sections.ddxChallenge) html += this.renderDDxChallenge();

        // ===== SECTION 7: CONVERSATION THREAD =====
        if (sections.conversationThread) html += this.renderConversationThread();

        // ===== SECTION 8: INLINE INPUT (always shown) =====
        html += this.renderInlineInput();

        body.innerHTML = html;

        // Refresh Lucide icons in the newly rendered content
        if (typeof App !== 'undefined' && App.refreshIcons) App.refreshIcons();

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
     * Render Learn Patient bar — shows Learn button, deep learn progress, or Learned badge
     */
    renderLearnBar() {
        const status = this.getMemoryStatus();
        const isLearning = this.state.status === 'learning';
        const isThinking = this.state.status === 'thinking';
        const progress = this._getDeepLearnProgress();

        // During active learning, show progress UI instead of hiding
        if (progress.isActive) {
            return this._renderDeepLearnProgress(progress);
        }

        // Between levels — show progress + next level button
        if (progress.canAdvance) {
            return this._renderDeepLearnBetweenLevels(progress);
        }

        if (isThinking) return ''; // Thinking banner handles this

        const hasAnalysis = !!(this.state.aiOneLiner || this.state.problemList?.length > 0);

        // === EMPTY STATE: No memory, no analysis — first-time user welcome ===
        if (!status.hasMemory && !hasAnalysis) {
            let html = '<div class="learn-welcome">';
            html += '<div class="learn-welcome-header">';
            html += '<span class="learn-welcome-icon">&#10024;</span>';
            html += '<span class="learn-welcome-title">Welcome to Acting Intern</span>';
            html += '</div>';
            html += '<div class="learn-welcome-text">';
            html += 'The AI hasn\'t reviewed this patient yet. Start by having it learn the chart, then analyze the case.';
            html += '</div>';
            html += '<div class="learn-welcome-steps">';
            html += '<button class="learn-welcome-cta primary" onclick="AICoworker.learnPatient()">';
            html += '<span class="cta-step">1</span>';
            html += '<span class="cta-label">';
            html += '<span class="cta-label-main">Learn Patient</span>';
            html += '<span class="cta-label-sub">Scan chart for key findings (~20s)</span>';
            html += '</span>';
            html += '<span class="cta-arrow">&#9654;</span>';
            html += '</button>';
            html += '<button class="learn-welcome-cta secondary" onclick="AICoworker.refreshThinking()" title="Skip learning and analyze directly">';
            html += '<span class="cta-step">2</span>';
            html += '<span class="cta-label">';
            html += '<span class="cta-label-main">Analyze Case</span>';
            html += '<span class="cta-label-sub">Summary, problems, next steps</span>';
            html += '</span>';
            html += '</button>';
            html += '</div>';
            html += '</div>';
            return html;
        }

        // === LEARNED BUT NOT ANALYZED — prompt the next step ===
        if (status.hasMemory && !hasAnalysis) {
            let html = '<div class="learn-nextstep">';
            html += '<div class="learn-nextstep-status">';
            html += '<span class="learn-nextstep-check">&#10003;</span>';
            html += '<span class="learn-nextstep-text">Chart learned. Ready to analyze.</span>';
            html += '</div>';
            html += '<button class="learn-action-btn analyze-primary analyze-prompt-cta" onclick="AICoworker.refreshThinking()">';
            html += '<span class="learn-action-icon">&#128269;</span>';
            html += '<span class="learn-action-label">Analyze Case</span>';
            html += '<span class="cta-arrow">&#9654;</span>';
            html += '</button>';
            html += '</div>';
            return html;
        }

        // === LEARNED + ANALYZED — normal bar with subtle controls ===
        let html = '<div class="learn-bar">';

        // Learn Patient button (shown compact)
        if (progress.isComplete) {
            const learnedAt = status.lastLearnedAt ? new Date(status.lastLearnedAt) : null;
            const learnTime = learnedAt ? this._formatTimeAgo(learnedAt) : '';
            html += '<button class="learn-action-btn learn-complete" onclick="AICoworker.learnPatient()" title="Chart fully analyzed — click to re-learn">';
            html += '<span class="learn-action-icon">&#9989;</span>';
            html += '<span class="learn-action-label">Chart Learned (100%)</span>';
            if (learnTime) html += `<span class="learn-action-time">${learnTime}</span>`;
            html += '</button>';
        } else if (progress.phase === 'between_levels' && progress.remainingLevels <= 0) {
            const learnedAt = status.lastLearnedAt ? new Date(status.lastLearnedAt) : null;
            const learnTime = learnedAt ? this._formatTimeAgo(learnedAt) : '';
            html += '<button class="learn-action-btn learn-done" onclick="AICoworker.learnPatient()" title="Re-read full chart">';
            html += '<span class="learn-action-icon">&#9989;</span>';
            html += '<span class="learn-action-label">Learned</span>';
            if (learnTime) html += `<span class="learn-action-time">${learnTime}</span>`;
            html += '</button>';
        } else {
            const pct = progress.percentComplete || 0;
            html += '<button class="learn-action-btn learn-partial" onclick="AICoworker.learnPatient()" title="Continue deep chart analysis">';
            html += '<span class="learn-action-icon">&#129504;</span>';
            html += `<span class="learn-action-label">Learned ${pct}%</span>`;
            html += '</button>';
        }

        // Update Analysis button — more prominent than before
        const analyzedAt = this.state.lastUpdated ? new Date(this.state.lastUpdated) : null;
        const analyzeTime = analyzedAt ? this._formatTimeAgo(analyzedAt) : '';
        html += '<button class="learn-action-btn analyze-refresh" onclick="AICoworker.refreshThinking()" title="Update analysis with any new info">';
        html += '<span class="learn-action-icon">&#8635;</span>';
        html += '<span class="learn-action-label">Update Analysis</span>';
        if (analyzeTime) html += `<span class="learn-action-time">${analyzeTime}</span>`;
        html += '</button>';

        // Memory Viewer + Clear Memory Buttons
        html += '<button class="memory-viewer-btn" onclick="AICoworker.toggleMemoryViewer()" title="View AI Knowledge Base">';
        html += '&#129504;';
        html += '</button>';
        html += '<button class="clear-memory-btn" onclick="AICoworker.clearMemory()" title="Clear AI memory and start fresh">';
        html += '&#128465;';
        html += '</button>';

        html += '</div>';
        return html;
    },

    /**
     * Render deep learn progress during active analysis
     */
    _renderDeepLearnProgress(progress) {
        let html = '<div class="deep-learn-progress">';

        // Header
        const levelLabel = progress.phase === 'mapping' ? 'Mapping Chart...' :
                          progress.phase === 'level1' ? 'Level 1 — Critical Foundation' :
                          `Level ${progress.currentLevel} — Deep Review`;

        html += `<div class="dl-progress-header">`;
        html += `<span class="dl-progress-icon dl-spin">&#129504;</span>`;
        html += `<span class="dl-progress-title">Learning Patient</span>`;
        html += `<span class="dl-progress-level">${levelLabel}</span>`;
        html += `</div>`;

        // Active stage indicator
        const stage = this._deepLearn._stage || 'loading';
        const stages = [
            { key: 'loading', label: 'Loading chart data' },
            { key: 'analyzing', label: progress.phase === 'level1' ? 'Analyzing chart' : 'Extracting details' },
            { key: 'synthesizing', label: 'Building memory document' }
        ];
        html += `<div class="dl-stages">`;
        for (const s of stages) {
            const isCurrent = s.key === stage;
            const isDone = stages.indexOf(s) < stages.findIndex(x => x.key === stage);
            const cls = isCurrent ? 'dl-stage-active' : isDone ? 'dl-stage-done' : 'dl-stage-pending';
            html += `<span class="dl-stage ${cls}">`;
            html += isDone ? '&#10003; ' : isCurrent ? '&#9679; ' : '&#9675; ';
            html += `${s.label}</span>`;
        }
        html += `</div>`;

        // Segmented progress bar with pulse on active level
        html += this._renderSegmentedProgressBar(progress, stage);

        // Stats
        html += `<div class="dl-progress-stats">`;
        html += `<span>${progress.processedCount}/${progress.totalItems} items</span>`;
        if (progress.noteCount || progress.labCount || progress.imagingCount) {
            html += `<span class="dl-progress-breakdown">${progress.noteCount} notes · ${progress.labCount} labs · ${progress.imagingCount} imaging</span>`;
        }
        html += `</div>`;

        html += '</div>';
        return html;
    },

    /**
     * Render a segmented progress bar divided by learning levels.
     * Completed levels are filled with their level color. The active level pulses.
     * @param {object} progress — from _getDeepLearnProgress()
     * @param {string} activeStage — 'loading'|'analyzing'|'synthesizing' or null
     */
    _renderSegmentedProgressBar(progress, activeStage) {
        const levelColors = ['', '#6366f1', '#3b82f6', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];
        const getColor = (lvl) => levelColors[Math.min(lvl, levelColors.length - 1)] || '#94a3b8';

        const totalLevels = progress.totalLevels || 1;
        const currentLevel = progress.currentLevel || 0;
        const batchSizes = progress.batchSizes || [];
        const totalItems = progress.totalItems || 1;

        // Compute segment widths proportional to batch sizes
        let segments = [];
        if (batchSizes.length > 0) {
            segments = batchSizes.map((size, i) => ({
                level: i + 1,
                widthPct: (size / totalItems) * 100,
                size
            }));
        } else {
            // Fallback: equal segments
            for (let i = 1; i <= totalLevels; i++) {
                segments.push({ level: i, widthPct: 100 / totalLevels, size: Math.round(totalItems / totalLevels) });
            }
        }

        let html = '<div class="dl-segmented-bar">';

        segments.forEach(seg => {
            const isCompleted = seg.level < currentLevel;
            const isActive = seg.level === currentLevel;
            const isFuture = seg.level > currentLevel;
            const color = getColor(seg.level);

            let cls = 'dl-seg';
            if (isCompleted) cls += ' dl-seg-done';
            else if (isActive) cls += ' dl-seg-active';
            else cls += ' dl-seg-future';

            const isPulsing = isActive && (activeStage === 'analyzing' || activeStage === 'synthesizing');

            html += `<div class="${cls}${isPulsing ? ' dl-seg-pulse' : ''}" style="width: ${seg.widthPct}%; --seg-color: ${color};" title="Level ${seg.level}: ${seg.size} items">`;
            html += `<div class="dl-seg-fill"></div>`;
            html += `<span class="dl-seg-label">L${seg.level}</span>`;
            html += `</div>`;
        });

        html += '</div>';
        return html;
    },

    /**
     * Toggle the learn bar expanded/collapsed state
     */
    toggleLearnBarCollapse() {
        this._learnBarCollapsed = !this._learnBarCollapsed;
        this.render();
    },

    /**
     * Render deep learn between-levels state — collapsible design
     */
    _renderDeepLearnBetweenLevels(progress) {
        const pct = progress.percentComplete;
        const hasAnalysis = !!(this.state.aiOneLiner || this.state.problemList?.length > 0);
        const memDoc = this.longitudinalDoc?.aiMemory?.memoryDocument;
        const collapsed = this._learnBarCollapsed || false;

        // ── Collapsed: single compact strip ──
        if (collapsed) {
            const problemCount = memDoc?.problemAnalysis?.length || 0;
            let html = '<div class="dl-collapsed" onclick="AICoworker.toggleLearnBarCollapse()">';
            html += `<span class="dl-collapsed-badge">L${progress.currentLevel}</span>`;
            html += `<span class="dl-collapsed-bar-wrap"><span class="dl-collapsed-bar" style="width:${pct}%"></span></span>`;
            html += `<span class="dl-collapsed-info">${pct}%`;
            if (problemCount > 0) html += ` · ${problemCount} problems`;
            html += `</span>`;
            html += `<span class="dl-collapsed-expand" title="Expand">&#9660;</span>`;
            html += '</div>';
            return html;
        }

        // ── Expanded ──
        let html = '<div class="deep-learn-between">';

        // Collapse button
        html += '<div class="dl-status-row">';
        html += `<span class="dl-status-badge">Level ${progress.currentLevel}</span>`;
        html += '<div class="dl-status-bar-wrap">';
        html += `<div class="dl-status-bar" style="width: ${pct}%"></div>`;
        html += '</div>';
        html += `<span class="dl-status-pct">${pct}%</span>`;
        html += `<button class="dl-collapse-btn" onclick="event.stopPropagation();AICoworker.toggleLearnBarCollapse()" title="Minimize">&#9650;</button>`;
        html += '</div>';

        // Knowledge stats
        if (memDoc) {
            const stats = [
                { n: memDoc.problemAnalysis?.length || 0, label: 'problems' },
                { n: memDoc.medicationRationale?.length || 0, label: 'meds' },
                { n: memDoc.labTrends?.key_values?.length || 0, label: 'labs' },
            ].filter(s => s.n > 0);

            if (stats.length > 0) {
                html += '<div class="dl-knowledge-row">';
                stats.forEach((s, i) => {
                    if (i > 0) html += '<span class="dl-k-dot">·</span>';
                    html += `<span class="dl-k-stat"><strong>${s.n}</strong> ${s.label}</span>`;
                });
                html += `<button class="dl-kb-btn" onclick="AICoworker.toggleMemoryViewer()" title="View Knowledge Base">View KB</button>`;
                html += '</div>';
            }
        }

        // Action buttons
        html += '<div class="dl-action-row">';

        if (progress.remainingLevels > 0) {
            html += `<button class="dl-btn dl-btn-primary" onclick="AICoworker.learnPatient()">Continue Learning</button>`;
        }

        if (!hasAnalysis) {
            html += `<button class="dl-btn dl-btn-analyze" onclick="AICoworker.refreshThinking()">Analyze</button>`;
        } else {
            html += `<button class="dl-btn dl-btn-secondary" onclick="AICoworker.refreshThinking()">Re-Analyze</button>`;
        }

        html += `<div class="dl-overflow">`;
        html += `<button class="dl-btn-icon" onclick="this.parentElement.classList.toggle('open')">⋯</button>`;
        html += `<div class="dl-overflow-menu">`;
        html += `<button onclick="AICoworker.redoCurrentLevel();this.closest('.dl-overflow').classList.remove('open')">Redo Level ${progress.currentLevel}</button>`;
        html += `<button onclick="AICoworker.resetLearnProgress();this.closest('.dl-overflow').classList.remove('open')">Reset Progress</button>`;
        html += `<button onclick="AICoworker.clearMemory();this.closest('.dl-overflow').classList.remove('open')" class="dl-overflow-danger">Clear Memory</button>`;
        html += `</div></div>`;

        html += '</div>';
        html += '</div>';
        return html;
    },

    /**
     * Format a date as "Xm ago", "Xh ago", etc.
     */
    _formatTimeAgo(date) {
        const now = new Date();
        const diffMs = now - date;
        const diffMin = Math.floor(diffMs / 60000);
        if (diffMin < 1) return 'just now';
        if (diffMin < 60) return `${diffMin}m ago`;
        const diffHr = Math.floor(diffMin / 60);
        if (diffHr < 24) return `${diffHr}h ago`;
        return `${Math.floor(diffHr / 24)}d ago`;
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

    /**
     * Render Reactive mode's minimal context line.
     * Shows a 1-2 line patient identifier like "73M w/ HFrEF, CKD3b, T2DM | fatigue, Temp 98.6"
     * Built from local data (no LLM call needed). Falls back to aiOneLiner from previous analyses.
     */
    renderContextLine() {
        // Try aiOneLiner first (if an LLM analysis has been done, possibly from another mode)
        var contextText = this.state.aiOneLiner || '';

        if (!contextText) {
            // Build from local longitudinal doc data
            var summary = this._buildLocalSummary();
            if (summary) {
                contextText = summary.demographics || '';
                // Append chief complaint from presentation sentence
                if (summary.presentation) {
                    var ccPart = summary.presentation;
                    // Truncate to keep it short — take first clause
                    var dotIdx = ccPart.indexOf('.');
                    if (dotIdx > 0 && dotIdx < 80) ccPart = ccPart.substring(0, dotIdx);
                    if (ccPart.length > 80) ccPart = ccPart.substring(0, 77) + '...';
                    if (contextText && ccPart) contextText += ' | ' + ccPart;
                    else if (ccPart) contextText = ccPart;
                }
            }
        }

        if (!contextText) {
            // Fallback: just show patient name if we have it
            var doc = this.longitudinalDoc;
            if (doc && doc.patientKnowledgeBase && doc.patientKnowledgeBase.demographics) {
                var d = doc.patientKnowledgeBase.demographics;
                contextText = (d.name || 'Patient') + (d.age ? ', ' + d.age : '');
            }
        }

        if (!contextText) return '';

        return '<div class="reactive-context-line">' +
            '<span class="context-pulse"></span>' +
            '<span class="context-line-text">' + this.escapeHtml(contextText) + '</span>' +
        '</div>';
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
    renderClinicalSummary(isThinking) {
        try {
            const collapsed = this.isSectionCollapsed('summary');
            const chevron = collapsed ? '&#9654;' : '&#9660;';

            // Use LLM summary if available, else local
            const summary = this.state.clinicalSummary || this._buildLocalSummary();

            let html = '<div class="clinical-summary' + (isThinking && !collapsed ? ' copilot-section shimmer-loading' : '') + '">';
            html += `<div class="copilot-section-header collapsible-header" onclick="AICoworker.toggleSection('summary')">`;
            html += `<span class="collapse-chevron">${chevron}</span>`;
            html += '<i data-lucide="clipboard-list" class="lucide-inline"></i> Clinical Summary';
            html += '</div>';

            if (!collapsed) {
                html += '<div class="copilot-section-body">';
                if (summary) {
                    // Use AIPreferences for dynamic section labels, fall back to defaults
                    const sections = (typeof AIPreferences !== 'undefined')
                        ? AIPreferences.getSummarySections()
                        : [
                            { key: 'demographics', label: 'ID' },
                            { key: 'functional', label: 'USOH' },
                            { key: 'presentation', label: 'Now' }
                        ];
                    sections.forEach(section => {
                        const value = summary[section.key];
                        if (value) {
                            html += `<div class="summary-sentence"><span class="sentence-label">${this.escapeHtml(section.label)}</span>${this.formatText(value)}</div>`;
                        }
                    });
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
        html += '<i data-lucide="list-checks" class="lucide-inline"></i> Problem List';
        html += '<div class="section-actions">';
        html += '<button class="section-action-btn" onclick="event.stopPropagation(); AICoworker.refreshThinking()" title="Refresh analysis"><i data-lucide="refresh-cw" class="lucide-inline-sm"></i></button>';
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

                // Refresh is available via the toolbar icon and More menu
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
            var recentMsgs = this.state.conversationThread.slice(-10);
            recentMsgs.forEach(msg => {
                const cls = msg.role === 'user' ? 'thread-msg-user' : 'thread-msg-ai';
                let label;
                if (msg.role === 'user') {
                    label = msg.type === 'think' ? '&#127897; You' : '&#128100; You';
                } else if (msg.type === 'note-clarify') {
                    label = '&#128221; AI (Pre-draft)';
                } else {
                    label = '&#10024; AI';
                }
                html += `<div class="thread-msg ${cls}${msg.type === 'note-clarify' ? ' thread-msg-clarify' : ''}">`;
                html += `<div class="thread-msg-label">${label}</div>`;
                html += `<div class="thread-msg-text">${msg.role === 'ai' ? this.formatText(msg.text) : this.escapeHtml(msg.text)}</div>`;
                // "Just write it" quick-action after AI clarification question
                if (msg.role === 'ai' && msg.type === 'note-clarify' && this.state.awaitingNoteClarification) {
                    html += `<button class="clarify-skip-btn" onclick="AICoworker._handleClarificationResponse('just write it')">Just write it &#8594;</button>`;
                }
                html += '</div>';
            });
            // Show typing indicator when AI is thinking and last message was from user
            if (this.state.status === 'thinking' && recentMsgs.length > 0 && recentMsgs[recentMsgs.length - 1].role === 'user') {
                html += '<div class="thread-msg thread-msg-ai thread-msg-typing">';
                html += '<div class="thread-msg-label"><i data-lucide="sparkles" class="lucide-inline-sm"></i> AI</div>';
                html += '<div class="thread-msg-text"><span class="typing-indicator"><span></span><span></span><span></span></span></div>';
                html += '</div>';
            }
            html += '</div>';
        }

        html += '</div>';
        return html;
    },

    /**
     * Render Teaching Points section (Heavy mode only).
     * Shows clinical pearls and evidence-based insights from the attending.
     */
    renderTeachingPoints() {
        var points = this.state.teachingPoints;
        if (!points || points.length === 0) return '';

        var collapsed = this.isSectionCollapsed('teaching');
        var chevron = collapsed ? '&#9654;' : '&#9660;';

        var html = '<div class="copilot-section copilot-teaching-points">';
        html += '<div class="copilot-section-header collapsible-header" onclick="AICoworker.toggleSection(\'teaching\')">';
        html += '<span class="collapse-chevron">' + chevron + '</span>';
        html += '<span>&#127891;</span> Teaching Points';
        html += '</div>';

        if (!collapsed) {
            html += '<div class="copilot-section-body">';
            for (var i = 0; i < points.length; i++) {
                html += '<div class="teaching-point-item">' + this.formatText(points[i]) + '</div>';
            }
            html += '</div>';
        }
        html += '</div>';
        return html;
    },

    /**
     * Render DDx Challenge section (Heavy mode only).
     * Shows a differential diagnosis challenge from the attending.
     */
    renderDDxChallenge() {
        var challenge = this.state.ddxChallenge;
        if (!challenge) return '';

        return '<div class="copilot-ddx-challenge">' +
            '<div class="ddx-challenge-label">&#129300; DDx Challenge</div>' +
            '<div class="ddx-challenge-text">' + this.formatText(challenge) + '</div>' +
            '</div>';
    },

    /**
     * Render suggested actions — 6 always-visible categories with specific LLM items.
     */
    renderSuggestedActions(isThinking) {
        const actions = this.state.categorizedActions;
        const collapsed = this.isSectionCollapsed('actions');
        const chevron = collapsed ? '&#9654;' : '&#9660;';

        // Clear pending actions map on each render to prevent stale references
        this._pendingActions = {};
        this._pendingActionCategories = {};

        const categories = [
            { key: 'communication', icon: '<i data-lucide="message-square" class="lucide-inline"></i>', label: 'Talk to patient/nurse', items: actions?.communication || [] },
            { key: 'labs', icon: '<i data-lucide="test-tubes" class="lucide-inline"></i>', label: 'Order labs', items: actions?.labs || [] },
            { key: 'imaging', icon: '<i data-lucide="scan" class="lucide-inline"></i>', label: 'Order imaging', items: actions?.imaging || [] },
            { key: 'medications', icon: '<i data-lucide="pill" class="lucide-inline"></i>', label: 'Medication orders', items: actions?.medications || [] },
            { key: 'other', icon: '<i data-lucide="clipboard-list" class="lucide-inline"></i>', label: 'Other orders', items: actions?.other || [] },
            { key: 'documentation', icon: '<i data-lucide="file-edit" class="lucide-inline"></i>', label: 'Documentation', items: [], _static: true }
        ];

        let html = '<div class="copilot-section actions-section' + (isThinking && !collapsed ? ' shimmer-loading' : '') + '">';
        html += `<div class="copilot-section-header collapsible-header" onclick="AICoworker.toggleSection('actions')">`;
        html += `<span class="collapse-chevron">${chevron}</span>`;
        html += '<i data-lucide="check-circle" class="lucide-inline"></i> Suggested Actions';
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

            // Static documentation category with built-in items
            if (cat._static && cat.key === 'documentation') {
                html += '<div class="action-items">';
                html += '<div class="action-item action-executable" onclick="AICoworker.draftContextualNote()">';
                html += '<span class="action-text">Draft Note (auto-detect type)</span>';
                html += '<span class="action-execute-icon" title="Draft note">&#9654;</span>';
                html += '</div>';
                html += '<div class="action-item action-executable" onclick="AICoworker.openNoteModal()">';
                html += '<span class="action-text">Write Note (choose type)</span>';
                html += '<span class="action-execute-icon" title="Choose note type">&#9654;</span>';
                html += '</div>';
                html += '</div>';
            }

            if (cat.items.length > 0) {
                html += '<div class="action-items">';
                cat.items.forEach((item, idx) => {
                    const text = typeof item === 'string' ? item : item.text || String(item);

                    // Skip actions that have already been executed
                    if (this._completedActions && this._completedActions.has(text)) {
                        return;
                    }

                    const hasOrder = typeof item === 'object' && item.orderType && item.orderData;
                    const isMedChange = this._isMedChangeAction(text);
                    const isComm = cat.key === 'communication';
                    const actionId = `action_${cat.key}_${idx}`;
                    const evidence = typeof item === 'object' ? item.evidence || '' : '';

                    // Store action data + category for retrieval on click
                    this._pendingActions[actionId] = item;
                    this._pendingActionCategories[actionId] = cat.key;

                    // Evidence icon HTML (shown on hover, triggers popover)
                    const evidenceHtml = evidence
                        ? `<span class="evidence-trigger" onmouseenter="AICoworker._showEvidencePopover(this, '${this.escapeHtml(evidence).replace(/'/g, '&#39;')}')" onmouseleave="AICoworker._hideEvidencePopover()">&#9432;</span>`
                        : '';

                    if (hasOrder && !isMedChange) {
                        // New order → opens OrderEntry
                        html += `<div class="action-item action-executable" onclick="AICoworker.executeAction('${actionId}')">`;
                        html += `<span class="action-text">${this.escapeHtml(text)}</span>`;
                        html += evidenceHtml;
                        html += `<span class="action-execute-icon" title="Open order form">&#9654;</span>`;
                        html += `</div>`;
                    } else if (isComm) {
                        // Communication → opens patient/nurse chat
                        html += `<div class="action-item action-chat" onclick="AICoworker.executeAction('${actionId}')">`;
                        html += `<span class="action-text">${this.escapeHtml(text)}</span>`;
                        html += evidenceHtml;
                        html += `<span class="action-chat-icon" title="Open chat">&#128172;</span>`;
                        html += `</div>`;
                    } else if (isMedChange) {
                        // Med change (hold/stop/increase) → nurse chat
                        html += `<div class="action-item action-chat" onclick="AICoworker.executeAction('${actionId}')">`;
                        html += `<span class="action-text">${this.escapeHtml(text)}</span>`;
                        html += evidenceHtml;
                        html += `<span class="action-chat-icon" title="Tell nurse">&#128105;&#8205;&#9877;</span>`;
                        html += `</div>`;
                    } else {
                        // Fallback
                        html += `<div class="action-item" onclick="AICoworker.executeAction('${actionId}')">`;
                        html += `<span class="action-text">${this.escapeHtml(text)}</span>`;
                        html += evidenceHtml;
                        html += `</div>`;
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
     * Show evidence popover near the trigger element
     */
    _showEvidencePopover(triggerEl, evidenceText) {
        this._hideEvidencePopover();
        const popover = document.createElement('div');
        popover.className = 'evidence-popover';
        popover.innerHTML = '<span class="evidence-popover-icon">&#128214;</span> ' + evidenceText;
        document.body.appendChild(popover);

        // Position relative to trigger
        const rect = triggerEl.getBoundingClientRect();
        popover.style.left = Math.max(8, Math.min(rect.left - 40, window.innerWidth - 370)) + 'px';
        popover.style.top = (rect.bottom + 6) + 'px';

        // If popover goes below viewport, show above instead
        requestAnimationFrame(() => {
            const popRect = popover.getBoundingClientRect();
            if (popRect.bottom > window.innerHeight - 10) {
                popover.style.top = (rect.top - popRect.height - 6) + 'px';
                popover.classList.add('evidence-popover-above');
            }
        });
    },

    /**
     * Hide evidence popover
     */
    _hideEvidencePopover() {
        const existing = document.querySelector('.evidence-popover');
        if (existing) existing.remove();
    },

    /**
     * Render the inline input section — persistent textarea at the bottom of the panel.
     * Replaces both Ask Modal and Quick Actions bar.
     */
    renderInlineInput() {
        var mode = this.mode_config;
        let html = '<div class="copilot-inline-input">';

        // Inline prompt editor (shown/hidden by toggle)
        html += this.renderInlinePromptEditor();

        // Input row: textarea for quick typed questions + dictate button for voice
        var placeholder = 'Ask a question or share your thinking...';
        if (mode) {
            if (mode.id === 'reactive') placeholder = 'Give an order or ask a question...';
            else if (mode.id === 'proactive') placeholder = 'Share your thinking or challenge me...';
        }
        html += '<div class="inline-input-row">';
        html += '<button class="inline-dictate-btn" onclick="if(typeof DictationWidget!==\'undefined\') DictationWidget.toggle()" title="Open Dictation (voice + orders)">&#127908;</button>';
        html += '<textarea id="copilot-inline-input" class="inline-textarea" rows="1" placeholder="' + placeholder + '" onkeydown="AICoworker.handleInputKeydown(event)"></textarea>';
        html += '<button class="inline-send-btn" onclick="AICoworker.handleInlineSubmit()" title="Send">&#9654;</button>';
        html += '</div>';

        html += '</div>';
        return html;
    },

    /**
     * Render the inline prompt editor panel — 3 editable textareas for the current mode's
     * summary, problem list, and actions prompt sections.
     */
    renderInlinePromptEditor() {
        if (!this._inlinePromptEditorOpen) return '';

        var modeId = typeof AIModeConfig !== 'undefined' ? AIModeConfig.currentMode : 'medium';
        var modeLabel = typeof AIModeConfig !== 'undefined' ? AIModeConfig.MODES[modeId].label : 'Medium';

        var sections = [
            { key: 'summary', label: 'Summary Instructions' },
            { key: 'problemList', label: 'Problem List Instructions' },
            { key: 'actions', label: 'Actions Instructions' }
        ];

        var html = '<div class="inline-prompt-editor" id="inline-prompt-editor">';
        html += '<div class="prompt-editor-header">';
        html += '<span class="prompt-editor-mode-label">&#9999; ' + modeLabel + ' Mode Prompts</span>';
        html += '<div class="prompt-editor-header-actions">';
        html += '<button class="prompt-editor-reset-btn" onclick="AICoworker.resetModePrompts()" title="Reset all to defaults">Reset</button>';
        html += '<button class="prompt-editor-close-btn" onclick="AICoworker.toggleInlinePromptEditor()" title="Close">&#10005;</button>';
        html += '</div>';
        html += '</div>';

        sections.forEach(function(section) {
            var text = typeof AIModeConfig !== 'undefined'
                ? AIModeConfig.getModePromptSection(modeId, section.key)
                : '';
            var isCustom = typeof AIModeConfig !== 'undefined'
                ? AIModeConfig.hasCustomModePrompt(modeId, section.key)
                : false;

            html += '<div class="prompt-section">';
            html += '<label class="prompt-section-label">' + section.label;
            if (isCustom) {
                html += ' <span class="prompt-custom-badge">customized</span>';
            }
            html += '</label>';
            html += '<textarea class="prompt-section-textarea' + (isCustom ? ' customized' : '') + '" ';
            html += 'data-section="' + section.key + '" ';
            html += 'rows="3" ';
            html += 'onblur="AICoworker.savePromptSection(this)" ';
            html += 'oninput="AICoworker.autoResizePromptTextarea(this)">';
            html += text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
            html += '</textarea>';
            html += '</div>';
        });

        html += '</div>';
        return html;
    },

    /**
     * Toggle the inline prompt editor panel visibility
     */
    toggleInlinePromptEditor() {
        this._inlinePromptEditorOpen = !this._inlinePromptEditorOpen;
        this.render();
        // After render, auto-resize textareas to fit content
        if (this._inlinePromptEditorOpen) {
            var textareas = document.querySelectorAll('.prompt-section-textarea');
            textareas.forEach(function(ta) {
                ta.style.height = 'auto';
                ta.style.height = ta.scrollHeight + 'px';
            });
        }
    },

    /**
     * Save a prompt section textarea on blur
     */
    savePromptSection(textarea) {
        if (typeof AIModeConfig === 'undefined') return;
        var section = textarea.dataset.section;
        var modeId = AIModeConfig.currentMode;
        var text = textarea.value;

        // Check if it matches the default — if so, remove the custom override
        var defaultText = AIModeConfig.MODES[modeId].promptSections[section] || '';
        if (text === defaultText) {
            AIModeConfig.resetModePromptSection(modeId, section);
        } else {
            AIModeConfig.saveModePromptSection(modeId, section, text);
        }

        // Re-render to update custom badges
        this.render();
        // Re-open and re-size textareas
        if (this._inlinePromptEditorOpen) {
            var textareas = document.querySelectorAll('.prompt-section-textarea');
            textareas.forEach(function(ta) {
                ta.style.height = 'auto';
                ta.style.height = ta.scrollHeight + 'px';
            });
        }
    },

    /**
     * Auto-resize a prompt editor textarea to fit content
     */
    autoResizePromptTextarea(textarea) {
        textarea.style.height = 'auto';
        textarea.style.height = textarea.scrollHeight + 'px';
    },

    /**
     * Reset all prompt sections for the current mode to defaults
     */
    resetModePrompts() {
        if (typeof AIModeConfig === 'undefined') return;
        var modeId = AIModeConfig.currentMode;
        AIModeConfig.resetAllModePromptSections(modeId);
        if (typeof App !== 'undefined') App.showToast('Prompts reset to defaults', 'success');
        this.render();
        if (this._inlinePromptEditorOpen) {
            var textareas = document.querySelectorAll('.prompt-section-textarea');
            textareas.forEach(function(ta) {
                ta.style.height = 'auto';
                ta.style.height = ta.scrollHeight + 'px';
            });
        }
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

        // Intercept: if awaiting note clarification response, route there
        if (this.state.awaitingNoteClarification) {
            this._handleClarificationResponse(text);
            return;
        }

        // Smart routing: detect question vs. clinical thinking
        // In hands-free mode, ALWAYS route as clinical thinking (doctors think out loud,
        // they don't ask the AI questions while wearing glasses). This lets them say things
        // like "I think this could be CHF exacerbation, should start diuresis" without
        // the "should" keyword misrouting it as a question.
        let isQuestion = false;
        if (!this._handsFreeActive) {
            // Typed input: only detect as question if it ends with '?' OR
            // starts with a question word followed by a space (standalone question).
            // Exclude clinical statements like "Can hear crackles" or "Should start diuresis"
            // by requiring the question word to be at the very start AND the sentence structure
            // to look like a genuine question (not a clinical action/observation).
            isQuestion = /\?\s*$/.test(text) ||
                /^(what|why|how|where|who|which)\s/i.test(text) ||
                /^(tell me|explain|describe|summarize|list|compare)\s/i.test(text) ||
                /^(is there|are there|is it|is this|do we|does the|does this|can you|could you|should we|should I)\s/i.test(text);
        }

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

        // 8. Reset deep learn state
        this._resetDeepLearn();
        if (this.longitudinalDoc) {
            const dlKey = `deepLearn_${this.longitudinalDoc.metadata.patientId}`;
            localStorage.removeItem(dlKey);
        }

        // 9. Reset in-memory session state
        this.resetSessionState();

        // 10. Null out the longitudinal doc so it gets rebuilt
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

        // Invalidate per-mode analysis cache — clinical context has changed
        this._clearModeCache();

        // Check mode — Reactive mode does NOT auto-synthesize
        var mode = this.mode_config;
        if (mode && !mode.proactive.autoSynthesizeOnDictation) {
            // Reactive mode: acknowledge dictation but skip full LLM synthesis
            this.state.status = 'ready';
            this.saveState();
            this.render();
            return;
        }

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
            if (data.glassesDisplay) this.state.glassesDisplay = data.glassesDisplay;

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

    // ==================== Hands-Free Voice Mode ====================

    /**
     * Toggle hands-free voice mode.
     * When active, continuously listens and auto-submits after silence.
     */
    toggleHandsFree() {
        if (this._handsFreeActive) {
            this.stopHandsFree();
        } else {
            this.startHandsFree();
        }
    },

    /**
     * Start hands-free voice mode.
     * Uses Web Speech API with continuous listening + silence detection.
     */
    startHandsFree() {
        var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            if (typeof App !== 'undefined') App.showToast('Speech recognition not supported in this browser', 'error');
            return;
        }

        // Mutual exclusion: stop ambient scribe and dictation if active
        if (typeof AmbientScribe !== 'undefined' && AmbientScribe.isListening) {
            AmbientScribe.stopListening();
        }
        if (typeof DictationWidget !== 'undefined' && DictationWidget.isListening) {
            DictationWidget.stopListening();
        }

        this._handsFreeActive = true;
        this._handsFreeTimeout = 3000; // 3 seconds of silence to auto-submit
        this._hfSilenceTimer = null;
        this._hfFinalTranscript = '';
        this._hfInterimTranscript = '';

        this._hfRecognition = new SpeechRecognition();
        this._hfRecognition.continuous = true;
        this._hfRecognition.interimResults = true;
        this._hfRecognition.lang = 'en-US';
        this._hfRecognition.maxAlternatives = 1;

        var self = this;

        this._hfRecognition.onresult = function(event) {
            self._hfInterimTranscript = '';
            for (var i = event.resultIndex; i < event.results.length; i++) {
                var transcript = event.results[i][0].transcript;
                if (event.results[i].isFinal) {
                    self._hfFinalTranscript += transcript;

                    // Check for voice commands in each final chunk
                    var command = self._detectVoiceCommand(transcript);
                    if (command) {
                        // Strip the command phrase from the accumulated transcript
                        self._hfFinalTranscript = self._hfFinalTranscript.replace(command.regex, '').trim();

                        // PRESERVE BUFFER: If there's accumulated speech before the command,
                        // submit it as clinical thinking first (e.g., "I think this patient
                        // needs lasix, submit order" → submit "I think this patient needs
                        // lasix" as dictation, THEN execute the "submit order" command)
                        var bufferedSpeech = self._hfFinalTranscript.trim();
                        if (bufferedSpeech.length > 0) {
                            var textarea = document.getElementById('copilot-inline-input');
                            if (textarea) {
                                textarea.value = bufferedSpeech;
                            }
                            // Submit the buffered speech as clinical thinking
                            self._hfFinalTranscript = '';
                            self._hfInterimTranscript = '';
                            self.handleInlineSubmit();
                        }

                        // Clear remaining buffer and execute the voice command
                        self._hfFinalTranscript = '';
                        self._hfInterimTranscript = '';
                        self._executeVoiceCommand(command);
                        return;
                    }
                } else {
                    self._hfInterimTranscript += transcript;
                }
            }

            // Update the inline textarea with live transcription
            var textarea = document.getElementById('copilot-inline-input');
            if (textarea) {
                textarea.value = self._hfFinalTranscript + self._hfInterimTranscript;
                textarea.style.height = 'auto';
                textarea.style.height = textarea.scrollHeight + 'px';
            }

            // Reset silence timer — speech was detected
            self._resetSilenceTimer();
        };

        this._hfRecognition.onerror = function(event) {
            console.error('Hands-free recognition error:', event.error);
            if (event.error === 'not-allowed') {
                if (typeof App !== 'undefined') App.showToast('Microphone access denied', 'error');
                self.stopHandsFree();
            } else if (event.error === 'no-speech') {
                // No speech detected — browser timed out, restart if still active
                // Don't stop, let onend handler restart
            } else if (event.error === 'aborted') {
                // Intentional stop, do nothing
            } else {
                if (typeof App !== 'undefined') App.showToast('Voice error: ' + event.error, 'warning');
            }
        };

        this._hfRecognition.onend = function() {
            // Auto-restart if still in hands-free mode (browser may stop on its own)
            if (self._handsFreeActive) {
                try {
                    self._hfRecognition.start();
                } catch (e) {
                    // May fail if already started, ignore
                }
            }
        };

        try {
            this._hfRecognition.start();
            this.render();
            if (typeof App !== 'undefined') App.showToast('Hands-free mode active', 'success');
        } catch (e) {
            console.error('Failed to start hands-free:', e);
            this._handsFreeActive = false;
            this.render();
        }
    },

    /**
     * Reset the silence timer — called each time speech is detected.
     * When the timer fires, auto-submit the accumulated text.
     */
    _resetSilenceTimer() {
        var self = this;
        if (this._hfSilenceTimer) {
            clearTimeout(this._hfSilenceTimer);
        }
        this._hfSilenceTimer = setTimeout(function() {
            self._onSilenceDetected();
        }, this._handsFreeTimeout || 3000);
    },

    /**
     * Called when silence is detected for the configured duration.
     * Auto-submits accumulated text and resets for next utterance.
     */
    _onSilenceDetected() {
        var text = (this._hfFinalTranscript || '').trim();
        if (!text) return; // Nothing to submit

        // Put the text in the textarea and submit
        var textarea = document.getElementById('copilot-inline-input');
        if (textarea) {
            textarea.value = text;
        }

        // Reset transcript for next utterance
        this._hfFinalTranscript = '';
        this._hfInterimTranscript = '';

        // Auto-submit through the standard handler
        this.handleInlineSubmit();

        // Flash the status indicator
        var status = document.getElementById('hands-free-status');
        if (status) {
            status.classList.add('submitted');
            setTimeout(function() {
                if (status) status.classList.remove('submitted');
            }, 1500);
        }
    },

    /**
     * Stop hands-free voice mode.
     */
    stopHandsFree() {
        this._handsFreeActive = false;
        if (this._hfSilenceTimer) {
            clearTimeout(this._hfSilenceTimer);
            this._hfSilenceTimer = null;
        }
        if (this._hfRecognition) {
            try {
                this._hfRecognition.onend = null; // Prevent auto-restart
                this._hfRecognition.stop();
            } catch (e) { /* ignore */ }
            this._hfRecognition = null;
        }
        this._hfFinalTranscript = '';
        this._hfInterimTranscript = '';
        this.render();
        if (typeof App !== 'undefined') App.showToast('Hands-free mode stopped', 'info');
    },

    // ==================== Ambient AI Scribe ====================

    /**
     * Toggle the ambient AI scribe on/off.
     * Mutual exclusion: stops hands-free if active.
     */
    toggleAmbientScribe() {
        if (typeof AmbientScribe === 'undefined') {
            if (typeof App !== 'undefined') App.showToast('Ambient scribe not available', 'error');
            return;
        }

        if (AmbientScribe.isListening) {
            this.stopAmbientScribe();
        } else {
            this.startAmbientScribe();
        }
    },

    /**
     * Start the ambient AI scribe.
     * Sets up callbacks for live UI updates and extraction notifications.
     */
    startAmbientScribe() {
        if (typeof AmbientScribe === 'undefined') return;

        // Mutual exclusion: stop hands-free if active
        if (this._handsFreeActive) {
            this.stopHandsFree();
        }

        var self = this;

        // Set up UI update callback
        AmbientScribe.onTranscriptUpdate = function() {
            self._updateAmbientScribePanel();
        };

        // Set up extraction complete callback
        AmbientScribe.onExtractionComplete = function() {
            self._updateAmbientScribePanel();
            // Trigger AI panel refresh if significant new findings
            if (AmbientScribe.extractedFindings.length > 0 && AmbientScribe.extractionCount % 2 === 0) {
                // Every other extraction, refresh the AI synthesis
                self._persistAmbientToSession();
            }
        };

        var started = AmbientScribe.startListening();
        if (started) {
            this.render();
        }
    },

    /**
     * Stop the ambient AI scribe.
     * Offers to use findings for note writing.
     */
    async stopAmbientScribe() {
        if (typeof AmbientScribe === 'undefined') return;

        await AmbientScribe.stopListening();

        // Persist findings to session
        this._persistAmbientToSession();

        this.render();

        // Notify about available findings
        var counts = AmbientScribe.getFindingsCounts();
        var totalFindings = Object.values(counts).reduce(function(a, b) { return a + b; }, 0);
        if (totalFindings > 0) {
            if (typeof App !== 'undefined') {
                App.showToast('Scribe captured ' + totalFindings + ' findings. Use Write Note to include them.', 'success');
            }
        }
    },

    /**
     * Persist ambient scribe findings into session context for AI panel integration.
     */
    _persistAmbientToSession() {
        if (typeof AmbientScribe === 'undefined' || !AmbientScribe.hasData()) return;

        // Store in longitudinal doc sessionContext
        if (this.longitudinalDoc) {
            this.longitudinalDoc.sessionContext.ambientTranscript = AmbientScribe.getTranscript().map(function(e) {
                return { speaker: e.speaker, text: e.text, timestamp: e.timestamp };
            });
            this.longitudinalDoc.sessionContext.ambientFindings = AmbientScribe.getExtractedFindings().map(function(f) {
                return { type: f.type, text: f.text, speaker: f.speaker, confidence: f.confidence, timestamp: f.timestamp };
            });
            if (AmbientScribe.hpiComponents) {
                this.longitudinalDoc.sessionContext.ambientHpiComponents = AmbientScribe.hpiComponents;
            }
            this.saveLongitudinalDoc();
        }
    },

    /**
     * Render the ambient scribe panel — collapsible panel showing live transcript.
     * Returns HTML string.
     */
    renderAmbientScribePanel() {
        if (typeof AmbientScribe === 'undefined') return '';

        var isActive = AmbientScribe.isListening;
        var hasData = AmbientScribe.hasData();

        if (!isActive && !hasData) return '';

        var html = '<div class="ambient-scribe-panel' + (isActive ? ' recording' : '') + '">';

        // Header
        html += '<div class="ambient-scribe-header" onclick="AICoworker._toggleAmbientPanelCollapse()">';
        html += '<div class="ambient-scribe-header-left">';
        if (isActive) {
            html += '<span class="scribe-recording-dot"></span>';
            html += '<span class="ambient-scribe-title">Ambient Scribe \u2014 Recording (' + AmbientScribe.getFormattedDuration() + ')</span>';
        } else {
            html += '<span class="ambient-scribe-title">Ambient Scribe \u2014 ' + AmbientScribe.conversationLog.length + ' utterances</span>';
        }
        html += '</div>';
        html += '<div class="ambient-scribe-header-right">';
        if (isActive) {
            html += '<button class="scribe-stop-btn" onclick="event.stopPropagation(); AICoworker.stopAmbientScribe();" title="Stop scribe">\u25A0 Stop</button>';
        }
        html += '<button class="scribe-extract-btn" onclick="event.stopPropagation(); AICoworker._manualExtract();" title="Extract findings now"' +
                (AmbientScribe.extractionInProgress ? ' disabled' : '') + '>' +
                (AmbientScribe.extractionInProgress ? '\u23F3' : '\u2699') + ' Extract</button>';
        html += '<span class="ambient-collapse-icon">' + (this._ambientPanelCollapsed ? '\u25B6' : '\u25BC') + '</span>';
        html += '</div>';
        html += '</div>';

        // Body (collapsible)
        if (!this._ambientPanelCollapsed) {
            html += '<div class="ambient-scribe-body">';

            // Transcript area
            html += '<div class="ambient-scribe-transcript" id="ambient-scribe-transcript">';
            var log = AmbientScribe.getTranscript();
            if (log.length === 0 && isActive) {
                html += '<div class="scribe-placeholder">Listening... speak and the conversation will appear here.</div>';
            } else {
                // Show last 20 utterances
                var displayed = log.slice(-20);
                displayed.forEach(function(entry) {
                    var speakerClass = entry.speaker === 'doctor' ? 'doctor' :
                                      entry.speaker === 'patient' ? 'patient' :
                                      entry.speaker === 'nurse' ? 'nurse' : 'unknown';
                    var speakerIcon = entry.speaker === 'doctor' ? '\uD83D\uDC68\u200D\u2695\uFE0F' :
                                     entry.speaker === 'patient' ? '\uD83E\uDDD1' :
                                     entry.speaker === 'nurse' ? '\uD83D\uDC69\u200D\u2695\uFE0F' : '\uD83D\uDDE3\uFE0F';
                    html += '<div class="scribe-utterance ' + speakerClass + '">';
                    html += '<span class="scribe-speaker-icon">' + speakerIcon + '</span>';
                    html += '<span class="scribe-speaker-label">' + (entry.speaker || 'Unknown') + ':</span> ';
                    html += '<span class="scribe-text">' + entry.text + '</span>';
                    html += '</div>';
                });

                // Show interim text if actively listening
                if (isActive && AmbientScribe._interimTranscript) {
                    html += '<div class="scribe-utterance interim">';
                    html += '<span class="scribe-speaker-icon">\uD83D\uDDE3\uFE0F</span>';
                    html += '<span class="scribe-text interim-text">' + AmbientScribe._interimTranscript + '</span>';
                    html += '</div>';
                }
            }
            html += '</div>';

            html += '</div>';
        }

        // Extraction summary footer
        var counts = AmbientScribe.getFindingsCounts();
        var totalFindings = Object.values(counts).reduce(function(a, b) { return a + b; }, 0);
        if (totalFindings > 0) {
            html += '<div class="scribe-extraction-summary">';
            html += '<span class="scribe-extraction-label">Extracted: </span>';
            var parts = [];
            if (counts.symptom > 0) parts.push(counts.symptom + ' symptom' + (counts.symptom > 1 ? 's' : ''));
            if (counts.finding > 0) parts.push(counts.finding + ' finding' + (counts.finding > 1 ? 's' : ''));
            if (counts.assessment > 0) parts.push(counts.assessment + ' assessment' + (counts.assessment > 1 ? 's' : ''));
            if (counts.concern > 0) parts.push(counts.concern + ' concern' + (counts.concern > 1 ? 's' : ''));
            if (counts.quote > 0) parts.push(counts.quote + ' quote' + (counts.quote > 1 ? 's' : ''));
            html += '<span class="scribe-extraction-counts">' + parts.join(', ') + '</span>';
            html += '</div>';
        }

        html += '</div>';
        return html;
    },

    /**
     * Update just the ambient scribe panel DOM without re-rendering the entire AI panel.
     * Called frequently during recording for live transcript updates.
     */
    _updateAmbientScribePanel() {
        // Update the transcript area
        var transcriptEl = document.getElementById('ambient-scribe-transcript');
        if (transcriptEl) {
            var log = AmbientScribe.getTranscript();
            var html = '';
            var displayed = log.slice(-20);
            displayed.forEach(function(entry) {
                var speakerClass = entry.speaker === 'doctor' ? 'doctor' :
                                  entry.speaker === 'patient' ? 'patient' :
                                  entry.speaker === 'nurse' ? 'nurse' : 'unknown';
                var speakerIcon = entry.speaker === 'doctor' ? '\uD83D\uDC68\u200D\u2695\uFE0F' :
                                 entry.speaker === 'patient' ? '\uD83E\uDDD1' :
                                 entry.speaker === 'nurse' ? '\uD83D\uDC69\u200D\u2695\uFE0F' : '\uD83D\uDDE3\uFE0F';
                html += '<div class="scribe-utterance ' + speakerClass + '">';
                html += '<span class="scribe-speaker-icon">' + speakerIcon + '</span>';
                html += '<span class="scribe-speaker-label">' + (entry.speaker || 'Unknown') + ':</span> ';
                html += '<span class="scribe-text">' + entry.text + '</span>';
                html += '</div>';
            });

            // Interim text
            if (AmbientScribe.isListening && AmbientScribe._interimTranscript) {
                html += '<div class="scribe-utterance interim">';
                html += '<span class="scribe-speaker-icon">\uD83D\uDDE3\uFE0F</span>';
                html += '<span class="scribe-text interim-text">' + AmbientScribe._interimTranscript + '</span>';
                html += '</div>';
            }

            transcriptEl.innerHTML = html;
            // Auto-scroll to bottom
            transcriptEl.scrollTop = transcriptEl.scrollHeight;
        }

        // Update the header timer
        var headerEl = document.querySelector('.ambient-scribe-header .ambient-scribe-title');
        if (headerEl && AmbientScribe.isListening) {
            headerEl.textContent = 'Ambient Scribe \u2014 Recording (' + AmbientScribe.getFormattedDuration() + ')';
        }

        // Update extraction summary
        var summaryEl = document.querySelector('.scribe-extraction-summary .scribe-extraction-counts');
        if (summaryEl) {
            var counts = AmbientScribe.getFindingsCounts();
            var parts = [];
            if (counts.symptom > 0) parts.push(counts.symptom + ' symptom' + (counts.symptom > 1 ? 's' : ''));
            if (counts.finding > 0) parts.push(counts.finding + ' finding' + (counts.finding > 1 ? 's' : ''));
            if (counts.assessment > 0) parts.push(counts.assessment + ' assessment' + (counts.assessment > 1 ? 's' : ''));
            if (counts.concern > 0) parts.push(counts.concern + ' concern' + (counts.concern > 1 ? 's' : ''));
            if (counts.quote > 0) parts.push(counts.quote + ' quote' + (counts.quote > 1 ? 's' : ''));
            summaryEl.textContent = parts.join(', ');
        }
    },

    /**
     * Toggle collapse state of the ambient scribe panel.
     */
    _toggleAmbientPanelCollapse() {
        this._ambientPanelCollapsed = !this._ambientPanelCollapsed;
        this.render();
    },

    /**
     * Manually trigger extraction (user clicks Extract button).
     */
    async _manualExtract() {
        if (typeof AmbientScribe === 'undefined') return;
        if (AmbientScribe.extractionInProgress) return;

        // Flush current buffer
        if (AmbientScribe._chunkBuffer.trim()) {
            AmbientScribe.rawChunks.push({
                text: AmbientScribe._chunkBuffer.trim(),
                timestamp: new Date().toISOString(),
                isFinal: true
            });
            AmbientScribe._chunkBuffer = '';
        }

        await AmbientScribe.extractClinicalContent();
        this.render();
    },

    // ==================== Voice Commands ====================

    /**
     * Voice command registry.
     * Each command has: trigger phrases (regex), action function, and display label.
     */
    _getVoiceCommands() {
        return [
            {
                id: 'submit',
                regex: /\b(submit|send it|send that)\b/i,
                label: 'Submit',
                action: function() {
                    // Force submit whatever is in the buffer right now
                    this._onSilenceDetected();
                }.bind(this)
            },
            {
                id: 'message_nurse',
                regex: /\b(message nurse|message the nurse|text nurse|tell the nurse|talk to nurse|nurse chat)\b/i,
                label: 'Message Nurse',
                action: function() {
                    if (typeof NurseChat !== 'undefined') {
                        NurseChat.openChat();
                        // If there's buffered text, put it in nurse chat
                        var text = (this._hfFinalTranscript || '').trim();
                        if (text) {
                            setTimeout(function() {
                                var input = document.getElementById('nurse-chat-input');
                                if (input) input.value = text;
                            }, 300);
                        }
                    }
                    this._hfFinalTranscript = '';
                    this._hfInterimTranscript = '';
                }.bind(this)
            },
            {
                id: 'message_patient',
                regex: /\b(message patient|talk to patient|patient chat|ask the patient|ask patient)\b/i,
                label: 'Talk to Patient',
                action: function() {
                    if (typeof PatientChat !== 'undefined') {
                        PatientChat.openChat();
                        var text = (this._hfFinalTranscript || '').trim();
                        if (text) {
                            setTimeout(function() {
                                var input = document.getElementById('patient-chat-input');
                                if (input) input.value = text;
                            }, 300);
                        }
                    }
                    this._hfFinalTranscript = '';
                    this._hfInterimTranscript = '';
                }.bind(this)
            },
            {
                id: 'place_order',
                regex: /\b(place order|submit order|new order|open orders|order entry)\b/i,
                label: 'Place Order',
                action: function() {
                    if (typeof OrderEntry !== 'undefined') {
                        OrderEntry.openOrderEntry();
                    }
                    this._hfFinalTranscript = '';
                    this._hfInterimTranscript = '';
                }.bind(this)
            },
            {
                id: 'write_note',
                regex: /\b(write note|write a note|clinical note|progress note|open note)\b/i,
                label: 'Write Note',
                action: function() {
                    this.openNoteModal();
                    this._hfFinalTranscript = '';
                    this._hfInterimTranscript = '';
                }.bind(this)
            },
            {
                id: 'refresh',
                regex: /\b(refresh analysis|refresh thinking|update analysis|re-analyze|reanalyze)\b/i,
                label: 'Refresh Analysis',
                action: function() {
                    this.refreshThinking();
                    this._hfFinalTranscript = '';
                    this._hfInterimTranscript = '';
                }.bind(this)
            },
            {
                id: 'stop_listening',
                regex: /\b(stop listening|hands free off|stop hands free|mic off|stop recording)\b/i,
                label: 'Stop Listening',
                action: function() {
                    this.stopHandsFree();
                }.bind(this)
            },
            {
                id: 'switch_reactive',
                regex: /\b(switch to reactive|reactive mode|go reactive)\b/i,
                label: 'Reactive Mode',
                action: function() {
                    if (typeof AIPanel !== 'undefined') AIPanel.setMode('reactive');
                    this._hfFinalTranscript = '';
                    this._hfInterimTranscript = '';
                }.bind(this)
            },
            {
                id: 'switch_active',
                regex: /\b(switch to active|active mode|go active)\b/i,
                label: 'Active Mode',
                action: function() {
                    if (typeof AIPanel !== 'undefined') AIPanel.setMode('active');
                    this._hfFinalTranscript = '';
                    this._hfInterimTranscript = '';
                }.bind(this)
            },
            {
                id: 'switch_proactive',
                regex: /\b(switch to proactive|proactive mode|go proactive)\b/i,
                label: 'Proactive Mode',
                action: function() {
                    if (typeof AIPanel !== 'undefined') AIPanel.setMode('proactive');
                    this._hfFinalTranscript = '';
                    this._hfInterimTranscript = '';
                }.bind(this)
            }
        ];
    },

    /**
     * Detect a voice command in a transcript chunk.
     * Returns the matching command object or null.
     */
    _detectVoiceCommand(transcript) {
        var commands = this._getVoiceCommands();
        for (var i = 0; i < commands.length; i++) {
            if (commands[i].regex.test(transcript)) {
                return commands[i];
            }
        }
        return null;
    },

    /**
     * Execute a detected voice command with visual feedback.
     */
    _executeVoiceCommand(command) {
        // Show big centered toast with command name
        this._showVoiceCommandToast(command.label);

        // Clear the silence timer so we don't double-submit
        if (this._hfSilenceTimer) {
            clearTimeout(this._hfSilenceTimer);
            this._hfSilenceTimer = null;
        }

        // Update the textarea to remove command text
        var textarea = document.getElementById('copilot-inline-input');
        if (textarea) {
            textarea.value = (this._hfFinalTranscript || '').trim();
        }

        // Execute the command action
        command.action();
    },

    /**
     * Show a big centered toast for voice command feedback.
     */
    _showVoiceCommandToast(label) {
        var existing = document.querySelector('.voice-command-toast');
        if (existing) existing.remove();

        var toast = document.createElement('div');
        toast.className = 'voice-command-toast';
        toast.textContent = '🎤 ' + label;
        document.body.appendChild(toast);

        setTimeout(function() {
            if (toast.parentNode) toast.remove();
        }, 1600);
    },

    // ==================== Note Writing ====================

    /**
     * Draft a clinical note with auto-detected note type based on context.
     * H&P if first encounter (no memory doc), Progress Note if subsequent.
     * Skips the note type modal — one click to draft.
     */
    draftContextualNote() {
        // Auto-detect note type based on memory presence
        const hasMemory = this.longitudinalDoc?.aiMemory?.memoryDocument;
        const noteType = hasMemory ? 'progress' : 'hp';
        this._initiateNoteDraft(noteType);
    },

    /**
     * Draft a specific note type (called from voice commands with explicit type)
     */
    draftSpecificNote(noteType) {
        this._initiateNoteDraft(noteType);
    },

    /**
     * Common entry point for note drafting — gathers config and routes through clarification
     */
    _initiateNoteDraft(noteType) {
        const noteTypeName = this.getNoteTypeName(noteType);
        App.showToast(`Preparing ${noteTypeName}...`, 'info');
        this.gatherChartData();

        const includeSources = {
            vitals: true, labs: true, meds: true, imaging: true,
            nursing: true, dictation: true, ambient: true, previous: true
        };

        if (this.sessionContext) {
            this.sessionContext.trackNote(noteType);
        }

        this.requestNoteClarification(noteType, noteTypeName, includeSources, '');
    },

    /**
     * Called from modal "Generate Draft" button — gathers modal config, routes through clarification
     */
    generateNoteFromModal() {
        const selectedType = document.querySelector('input[name="note-type"]:checked');
        const noteType = selectedType ? selectedType.value : 'progress';
        const noteTypeName = this.getNoteTypeName(noteType);

        const includeSources = {
            vitals: document.getElementById('include-vitals')?.checked ?? true,
            labs: document.getElementById('include-labs')?.checked ?? true,
            meds: document.getElementById('include-meds')?.checked ?? true,
            imaging: document.getElementById('include-imaging')?.checked ?? true,
            nursing: document.getElementById('include-nursing')?.checked ?? true,
            dictation: document.getElementById('include-dictation')?.checked ?? true,
            ambient: document.getElementById('include-ambient')?.checked ?? true,
            previous: document.getElementById('include-previous')?.checked ?? true
        };

        const instructions = document.getElementById('note-instructions')?.value?.trim() || '';

        this.closeNoteModal();
        this.gatherChartData();

        if (this.sessionContext) {
            this.sessionContext.trackNote(noteType);
        }

        this.requestNoteClarification(noteType, noteTypeName, includeSources, instructions);
    },

    /**
     * Pre-generation clarification — asks AI to review context and ask 1-3 questions before writing
     */
    async requestNoteClarification(noteType, noteTypeName, includeSources, instructions) {
        // Store pending config for after clarification
        this.state.pendingNoteConfig = { noteType, noteTypeName, includeSources, instructions };
        this.state.awaitingNoteClarification = true;

        // Build a short context summary for the clarification call
        let contextSummary = '';
        if (this.contextAssembler) {
            try {
                contextSummary = this.contextAssembler.workingMemory.assemble('writeNote');
                // Truncate for the fast clarification call
                if (contextSummary.length > 2500) {
                    contextSummary = contextSummary.substring(0, 2500) + '\n[...truncated...]';
                }
            } catch (e) {
                contextSummary = this.state.summary || 'No context available';
            }
        } else {
            contextSummary = this.state.summary || 'No context available';
        }

        const systemPrompt = `You are an AI clinical assistant about to write a ${noteTypeName} for a patient. Before writing, review the clinical context and ask 1-3 brief, targeted clarification questions to ensure the note meets the physician's needs.

Good clarification questions:
- Which problems to focus on vs. address briefly
- Whether to include specific consult recommendations or pending results
- Tone/detail level preferences (brief vs. comprehensive)
- Any specific clinical decisions to emphasize or document

If the clinical context is straightforward and you have everything you need, respond with exactly: READY_TO_WRITE

Keep questions concise (1 sentence each). Number them.`;

        const userMessage = `Note type: ${noteTypeName}
${instructions ? `Additional instructions: "${instructions}"\n` : ''}
Clinical context:
${contextSummary}

What clarifying questions do you have before writing this ${noteTypeName}?`;

        try {
            // Fast LLM call with small token budget
            const response = await this.callLLM(systemPrompt, userMessage, 512, { model: this.analysisModel });

            if (!response || response.trim() === 'READY_TO_WRITE') {
                // No clarification needed — proceed directly
                this.proceedWithNoteGeneration();
                return;
            }

            // Show clarification questions in conversation thread
            this._pushToThread('ai', 'note-clarify', `📝 Before I draft this ${noteTypeName}:\n\n${response.trim()}`);
            this.render();

        } catch (err) {
            console.warn('Clarification call failed, proceeding directly:', err);
            // Fall back to generating without clarification
            this.proceedWithNoteGeneration();
        }
    },

    /**
     * Handle user's response to note clarification questions
     */
    _handleClarificationResponse(text) {
        this._pushToThread('user', 'note-clarify', text);
        this.state.awaitingNoteClarification = false;

        // Check for skip phrases
        if (/^(just write it|skip|go ahead|write it|no questions|looks good|no|nope)/i.test(text.trim())) {
            this.proceedWithNoteGeneration();
        } else {
            // Append user's answer to instructions so it's included in the note prompt
            const config = this.state.pendingNoteConfig;
            if (config) {
                config.instructions = (config.instructions ? config.instructions + '\n' : '') +
                    'Physician clarification: ' + text;
            }
            this.proceedWithNoteGeneration();
        }
    },

    /**
     * Proceed with note generation using stored pendingNoteConfig
     */
    proceedWithNoteGeneration() {
        const config = this.state.pendingNoteConfig;
        if (!config) {
            console.warn('No pending note config');
            return;
        }

        this.state.awaitingNoteClarification = false;
        const { noteType, noteTypeName, includeSources, instructions } = config;

        App.showToast(`Drafting ${noteTypeName}...`, 'info');

        // Create temp DOM so generateNote() can read from it
        const tempDiv = document.createElement('div');
        tempDiv.style.display = 'none';
        tempDiv.innerHTML = `
            <input type="radio" name="note-type" value="${noteType}" checked>
            <input type="checkbox" id="include-vitals" ${includeSources.vitals ? 'checked' : ''}>
            <input type="checkbox" id="include-labs" ${includeSources.labs ? 'checked' : ''}>
            <input type="checkbox" id="include-meds" ${includeSources.meds ? 'checked' : ''}>
            <input type="checkbox" id="include-imaging" ${includeSources.imaging ? 'checked' : ''}>
            <input type="checkbox" id="include-nursing" ${includeSources.nursing ? 'checked' : ''}>
            <input type="checkbox" id="include-dictation" ${includeSources.dictation ? 'checked' : ''}>
            <input type="checkbox" id="include-ambient" ${includeSources.ambient ? 'checked' : ''}>
            <input type="checkbox" id="include-previous" ${includeSources.previous ? 'checked' : ''}>
            <textarea id="note-instructions">${this.escapeHtml(instructions || '')}</textarea>
        `;
        document.body.appendChild(tempDiv);

        // Clean up pending state
        this.state.pendingNoteConfig = null;

        this.generateNote().finally(() => {
            document.body.removeChild(tempDiv);
        });
    },

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
        const includeAmbientEl = document.getElementById('include-ambient');
        const includeSources = {
            vitals: document.getElementById('include-vitals').checked,
            labs: document.getElementById('include-labs').checked,
            meds: document.getElementById('include-meds').checked,
            imaging: document.getElementById('include-imaging').checked,
            nursing: document.getElementById('include-nursing').checked,
            dictation: document.getElementById('include-dictation').checked,
            ambientConversation: includeAmbientEl ? includeAmbientEl.checked : false,
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
            const simTimeLegacy = typeof SimulationEngine !== 'undefined' && SimulationEngine.getSimulatedTime
                ? SimulationEngine.getSimulatedTime() : null;
            const legacyDate = simTimeLegacy ? new Date(simTimeLegacy) : new Date();
            const legacyDateStr = legacyDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
            const legacyTimeStr = legacyDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
            const legacyPatientName = window.PatientHeader?.currentPatient?.name || 'Robert Morrison';

            systemPrompt = `You are a physician writing a clinical note in an EHR system. Write a professional, thorough clinical note based on the patient data provided. Use standard medical documentation conventions.

Write the note in plain text with clear section headers. Do NOT use markdown formatting like ** or #. Use UPPERCASE for section headers followed by a colon.

IMPORTANT:
- Be thorough but concise - include clinically relevant details
- Use the patient's actual data from the clinical context
- Include the patient and nurse conversation data if relevant to the clinical picture
- Structure the note according to the requested format
- Write as if you are the attending physician documenting the encounter
- The current date is ${legacyDateStr} and the time is ${legacyTimeStr}
- The attending physician is Dr. Sarah Chen
- The patient's name is ${legacyPatientName}
- Do NOT use placeholder brackets like [Current Date], [Physician Name], etc. — use the actual values above`;
            userMessage = `## Full Clinical Context\n${clinicalContext}\n\n## Note Request\n${notePrompt}`;
        }

        try {
            const response = await this.callLLM(systemPrompt, userMessage, 4096);
            const processedNote = this._postProcessNote(response);
            this.openNoteEditor(noteTypeName, processedNote);
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

    /**
     * Post-process a generated note to replace any remaining bracket placeholders
     * with actual values. This is a safety net — the LLM prompt also instructs
     * it to use real values, but sometimes it still produces placeholders.
     */
    _postProcessNote(noteText) {
        if (!noteText) return noteText;

        // Use simulated time if available, else real time
        const simTime = typeof SimulationEngine !== 'undefined' && SimulationEngine.getSimulatedTime
            ? SimulationEngine.getSimulatedTime() : null;
        const noteDate = simTime ? new Date(simTime) : new Date();
        const dateStr = noteDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
        const timeStr = noteDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
        const patientName = window.PatientHeader?.currentPatient?.name || 'Robert Morrison';

        return noteText
            .replace(/\[Current Date\]/gi, dateStr)
            .replace(/\[Date\]/gi, dateStr)
            .replace(/\[Time\]/gi, timeStr)
            .replace(/\[Current Time\]/gi, timeStr)
            .replace(/\[Date and Time\]/gi, `${dateStr} at ${timeStr}`)
            .replace(/\[Date\/Time\]/gi, `${dateStr} at ${timeStr}`)
            .replace(/\[Physician Name\]/gi, 'Dr. Sarah Chen')
            .replace(/\[Doctor Name\]/gi, 'Dr. Sarah Chen')
            .replace(/\[Attending\]/gi, 'Dr. Sarah Chen')
            .replace(/\[Attending Physician\]/gi, 'Dr. Sarah Chen')
            .replace(/\[Provider Name\]/gi, 'Dr. Sarah Chen')
            .replace(/\[Provider\]/gi, 'Dr. Sarah Chen')
            .replace(/\[Patient Name\]/gi, patientName)
            .replace(/\[Pt Name\]/gi, patientName);
    },

    getNoteTypeName(type) {
        const names = {
            'hp': 'H&P',
            'progress': 'Progress Note',
            'discharge': 'Discharge Summary',
            'consult': 'Consult Note',
            'patient-instructions': 'Patient Instructions',
            'patient-letter': 'Letter to Patient'
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

        // Include encounter narrative from memory document (built from dictation digests)
        const narrative = this.longitudinalDoc?.aiMemory?.memoryDocument?.encounterNarrative;
        if (narrative) {
            const hasContent = narrative.clinicalReasoning?.length || narrative.examFindings?.length ||
                narrative.hpiComponents?.length || narrative.patientReported?.length || narrative.assessmentPlan;
            if (hasContent) {
                prompt += '## Encounter Narrative (from dictation)\n';
                if (narrative.hpiComponents?.length) {
                    prompt += '### HPI Components\n';
                    narrative.hpiComponents.forEach(h => {
                        prompt += `- **${h.component}**: ${h.text}\n`;
                    });
                    prompt += '\n';
                }
                if (narrative.examFindings?.length) {
                    prompt += '### Exam Findings\n';
                    narrative.examFindings.forEach(e => {
                        prompt += `- [${e.system}] ${e.finding}\n`;
                    });
                    prompt += '\n';
                }
                if (narrative.clinicalReasoning?.length) {
                    prompt += '### Physician\'s Clinical Reasoning\n';
                    narrative.clinicalReasoning.forEach(r => {
                        prompt += `- ${r}\n`;
                    });
                    prompt += '\n';
                }
                if (narrative.patientReported?.length) {
                    prompt += '### Patient-Reported Information\n';
                    narrative.patientReported.forEach(p => {
                        prompt += `- ${p}\n`;
                    });
                    prompt += '\n';
                }
                if (narrative.assessmentPlan) {
                    prompt += '### Running Assessment & Plan\n';
                    prompt += narrative.assessmentPlan + '\n\n';
                }
            }
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

        // Score the note for simulation debrief
        if (typeof SimulationScoreTracker !== 'undefined' && typeof SimulationScoreTracker.trackNoteSubmission === 'function') {
            SimulationScoreTracker.trackNoteSubmission(textarea.value.trim(), noteTypeName);
        }

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
        // Clear completed actions — a fresh analysis means fresh recommendations
        this._completedActions = new Set();

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
            // Add fade-in animation to content sections
            this._animateContentArrival();
            App.showToast('AI analysis updated', 'success');
        } catch (e) {
            console.error('Error parsing refresh response:', e);
            this.state.status = 'ready';
            this.render();
        }
    },

    /**
     * Apply a brief fade-in animation to copilot sections when new content arrives
     */
    _animateContentArrival() {
        const sections = document.querySelectorAll('.copilot-section, .clinical-summary');
        sections.forEach(function(section) {
            section.classList.add('content-arrived');
            setTimeout(function() {
                section.classList.remove('content-arrived');
            }, 350);
        });
    },

    // localRefreshAnalysis removed — LLM-only refresh

    // ==================== LLM API Integration ====================

    /**
     * Detect if backend is available; fall back to direct Anthropic mode
     */
    async detectBackend() {
        try {
            const r = await fetch('/api/health');
            if (r.ok) {
                const data = await r.json();
                if (data.apiConfigured) {
                    this.backendAvailable = true;
                    this.apiEndpoint = '/api/claude';
                    if (typeof ClaudeAPI !== 'undefined') {
                        ClaudeAPI.useProxy = true;
                    }
                    console.log('✅ Backend detected — API key on server');
                    return;
                }
            }
        } catch (e) {
            // No backend available
        }
        // Fallback: direct browser access (GitHub Pages mode)
        this.backendAvailable = false;
        this.apiEndpoint = 'https://api.anthropic.com/v1/messages';
        if (typeof ClaudeAPI !== 'undefined') {
            ClaudeAPI.useProxy = false;
        }
        this.loadApiKeyFallback();
        console.log('⚠️ No backend — using direct Anthropic access');
    },

    /**
     * Load API key — alias for backward compatibility
     */
    loadApiKey() {
        return this.loadApiKeyFallback();
    },

    /**
     * Load API key from localStorage (fallback mode only, no backend)
     */
    loadApiKeyFallback() {
        let key = localStorage.getItem('anthropic-api-key');
        if (!key) key = localStorage.getItem('anthropicApiKey');
        if (!key) key = localStorage.getItem('claude-api-key');
        if (key) {
            this.apiKey = key;
            localStorage.setItem('anthropic-api-key', key);
            localStorage.removeItem('anthropicApiKey');
            localStorage.removeItem('claude-api-key');
            if (typeof ClaudeAPI !== 'undefined') ClaudeAPI.setApiKey(key);
        }
        return this.apiKey;
    },

    /**
     * Save API key to localStorage (fallback mode only)
     */
    saveApiKey(key) {
        this.apiKey = key;
        localStorage.setItem('anthropic-api-key', key);
        if (typeof ClaudeAPI !== 'undefined') ClaudeAPI.setApiKey(key);
        localStorage.removeItem('anthropicApiKey');
        localStorage.removeItem('claude-api-key');
    },

    /**
     * Check if API is configured
     */
    isApiConfigured() {
        if (this.backendAvailable) return true;
        return !!(this.apiKey || this.loadApiKeyFallback());
    },

    /**
     * Load model preferences from localStorage
     */
    loadModelPreferences() {
        // Map deprecated model IDs to current equivalents
        const modelMigrations = {
            'claude-sonnet-4-20250514': 'claude-sonnet-4-6',
            'claude-sonnet-4-5-20250514': 'claude-sonnet-4-6',
            'claude-sonnet-4-6-20250627': 'claude-sonnet-4-6',
            'claude-haiku-3-5-20241022': 'claude-sonnet-4-6',
            'claude-opus-4-20250514': 'claude-opus-4-6',
            'claude-opus-4-6-20250627': 'claude-opus-4-6'
        };

        let savedChat = localStorage.getItem('ai-model-chat');
        let savedAnalysis = localStorage.getItem('ai-model-analysis');

        // Migrate old model IDs
        if (savedChat && modelMigrations[savedChat]) savedChat = modelMigrations[savedChat];
        if (savedAnalysis && modelMigrations[savedAnalysis]) savedAnalysis = modelMigrations[savedAnalysis];

        // Only apply if the model ID is in our available list
        const validIds = this.availableModels.map(m => m.id);
        if (savedChat && validIds.includes(savedChat)) this.model = savedChat;
        if (savedAnalysis && validIds.includes(savedAnalysis)) this.analysisModel = savedAnalysis;

        // Persist migrated values
        this.saveModelPreferences();
    },

    /**
     * Save model preferences to localStorage
     */
    saveModelPreferences() {
        localStorage.setItem('ai-model-chat', this.model);
        localStorage.setItem('ai-model-analysis', this.analysisModel);
    },

    /**
     * Set the chat/notes model
     */
    setChatModel(modelId) {
        this.model = modelId;
        this.saveModelPreferences();
    },

    /**
     * Set the analysis model
     */
    setAnalysisModel(modelId) {
        this.analysisModel = modelId;
        this.saveModelPreferences();
    },

    /**
     * Open API key configuration modal
     * Shows server status when backend is available, or key input for fallback mode
     */
    openApiKeyModal() {
        let modal = document.getElementById('ai-apikey-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'ai-apikey-modal';
            modal.className = 'ai-modal';
            document.body.appendChild(modal);
        }

        if (this.backendAvailable) {
            modal.innerHTML = `
                <div class="ai-modal-content">
                    <div class="ai-modal-header">
                        <h3>🔑 API Configuration</h3>
                        <button onclick="AICoworker.closeApiKeyModal()">×</button>
                    </div>
                    <div class="ai-modal-body">
                        <p style="color: #4caf50; font-weight: 600;">✓ API key configured on server</p>
                        <p class="ai-modal-hint">The Anthropic API key is securely stored on the backend server. No browser-side key needed.</p>
                    </div>
                    <div class="ai-modal-footer">
                        <button class="btn btn-primary" onclick="AICoworker.closeApiKeyModal()">OK</button>
                    </div>
                </div>
            `;
        } else {
            modal.innerHTML = `
                <div class="ai-modal-content">
                    <div class="ai-modal-header">
                        <h3>🔑 Configure API Key</h3>
                        <button onclick="AICoworker.closeApiKeyModal()">×</button>
                    </div>
                    <div class="ai-modal-body">
                        <p class="ai-modal-hint">No backend server detected. Enter your Anthropic API key to enable AI features. Your key is stored locally in your browser.</p>
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
            const input = document.getElementById('api-key-input');
            if (input) input.value = this.apiKey || '';
        }
        modal.classList.add('visible');
    },

    closeApiKeyModal() {
        const modal = document.getElementById('ai-apikey-modal');
        if (modal) modal.classList.remove('visible');
    },

    submitApiKey() {
        const input = document.getElementById('api-key-input');
        const key = input ? input.value.trim() : '';
        if (key) {
            this.saveApiKey(key);
            this.closeApiKeyModal();
            App.showToast('API key saved', 'success');
        }
    },

    /**
     * Trigger AI analysis in the background after API key is set.
     * If the context assembler is ready, runs immediately.
     * If not (still loading patient data), sets a flag so onPatientLoaded
     * picks it up and runs analysis as soon as it's ready.
     */
    _triggerBackgroundAnalysis() {
        if (this.contextAssembler) {
            // Context is ready — analyze now
            setTimeout(() => this.refreshThinking(), 300);
        } else {
            // Context isn't ready yet — queue for when onPatientLoaded finishes
            this._pendingAutoAnalysis = true;
            console.log('⏳ AI analysis queued — waiting for patient data to finish loading');
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
     * @param {string} systemPrompt
     * @param {string} userMessage
     * @param {number} maxTokens
     * @param {object} options - Optional: { model: 'override-model-id' }
     */
    async callLLM(systemPrompt, userMessage, maxTokens, options) {
        const useModel = (options && options.model) || this.model;

        // Store debug info BEFORE the call
        this.lastApiCall = {
            timestamp: Date.now(),
            systemPrompt: systemPrompt,
            userMessage: userMessage,
            clinicalContext: '', // Will be set by caller if needed
            response: '',
            error: null,
            model: useModel
        };

        console.log('🤖 LLM API CALL:', {
            timestamp: new Date().toISOString(),
            model: useModel,
            systemPromptLength: systemPrompt.length,
            userMessageLength: userMessage.length
        });
        console.log('📝 System Prompt:', systemPrompt.substring(0, 500) + '...');
        console.log('📝 User Message:', userMessage.substring(0, 500) + '...');

        // Ensure backend detection has completed before checking API config
        if (this._backendReady) await this._backendReady;

        if (!this.isApiConfigured()) {
            this.lastApiCall.error = 'API key not configured';
            if (!this.backendAvailable) this.openApiKeyModal();
            throw new Error('API key not configured');
        }

        // Build headers: proxy mode only needs Content-Type; fallback needs Anthropic headers
        const headers = { 'Content-Type': 'application/json' };
        if (!this.backendAvailable) {
            headers['x-api-key'] = this.apiKey;
            headers['anthropic-version'] = '2023-06-01';
            headers['anthropic-dangerous-direct-browser-access'] = 'true';
        }

        try {
            const response = await fetch(this.apiEndpoint, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    model: useModel,
                    max_tokens: maxTokens || 1024,
                    system: systemPrompt,
                    messages: [
                        { role: 'user', content: userMessage }
                    ]
                })
            });

            if (!response.ok) {
                let errorMsg = `API request failed (HTTP ${response.status})`;
                try {
                    const error = await response.json();
                    errorMsg = error.error?.message || errorMsg;
                } catch (parseErr) {
                    // Response wasn't JSON (HTML error page, etc.)
                    const text = await response.text().catch(() => '');
                    errorMsg = `HTTP ${response.status}: ${text.substring(0, 200) || response.statusText}`;
                }
                this.lastApiCall.error = errorMsg;
                console.error('❌ LLM API Error:', errorMsg);
                throw new Error(errorMsg);
            }

            // Parse response — guard against HTML error pages returned with 200 status
            let data;
            try {
                data = await response.json();
            } catch (jsonErr) {
                const text = await response.text().catch(() => '');
                const preview = text.substring(0, 200);
                this.lastApiCall.error = `Response was not JSON: ${preview}`;
                throw new Error(`API returned non-JSON response (possible CORS or proxy error). Preview: ${preview}`);
            }
            const responseText = data.content?.[0]?.text;
            if (!responseText) {
                this.lastApiCall.error = 'Empty response from API';
                throw new Error('API returned empty or malformed response');
            }

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
     * Call LLM with streaming enabled — reads SSE events and calls onChunk with accumulated text.
     * Falls back to non-streaming callLLM if streaming fails or backend is proxy.
     */
    async callLLMStreaming(systemPrompt, userMessage, maxTokens, options, onChunk) {
        const useModel = (options && options.model) || this.model;

        // Store debug info
        this.lastApiCall = {
            timestamp: Date.now(),
            systemPrompt, userMessage,
            clinicalContext: '',
            response: '', error: null,
            model: useModel
        };

        if (this._backendReady) await this._backendReady;

        if (!this.isApiConfigured()) {
            this.lastApiCall.error = 'API key not configured';
            if (!this.backendAvailable) this.openApiKeyModal();
            throw new Error('API key not configured');
        }

        // Streaming only works with direct Anthropic access (not proxy)
        if (this.backendAvailable) {
            // Proxy doesn't support streaming — fall back to non-streaming
            const text = await this.callLLM(systemPrompt, userMessage, maxTokens, options);
            if (onChunk) onChunk(text);
            return text;
        }

        const headers = {
            'Content-Type': 'application/json',
            'x-api-key': this.apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true'
        };

        try {
            const response = await fetch(this.apiEndpoint, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    model: useModel,
                    max_tokens: maxTokens || 1024,
                    stream: true,
                    system: systemPrompt,
                    messages: [{ role: 'user', content: userMessage }]
                })
            });

            if (!response.ok) {
                const error = await response.json().catch(() => ({}));
                throw new Error(error.error?.message || 'Streaming API request failed');
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let accumulated = '';
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || ''; // Keep incomplete line in buffer

                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
                    const data = line.slice(6).trim();
                    if (data === '[DONE]') continue;

                    try {
                        const event = JSON.parse(data);
                        if (event.type === 'content_block_delta' && event.delta?.text) {
                            accumulated += event.delta.text;
                            if (onChunk) onChunk(accumulated);
                        }
                    } catch (e) {
                        // Skip unparseable SSE events
                    }
                }
            }

            this.lastApiCall.response = accumulated;
            return accumulated;
        } catch (error) {
            this.lastApiCall.error = error.message;
            console.error('❌ Streaming LLM Error:', error);
            throw error;
        }
    },

    /**
     * Use LLM to synthesize doctor's thoughts with clinical context
     */
    async synthesizeWithLLM(doctorThoughts) {
        this.state.status = 'thinking';
        this._streamingPhase = null; // Reset streaming phase
        this.render();

        // Track dictation in session context
        if (this.sessionContext) {
            this.sessionContext.trackDictation(doctorThoughts);
        }

        // Use context assembler for focused context, fall back to legacy
        let systemPrompt, userMessage, clinicalContext;
        if (this.contextAssembler) {
            this.syncSessionStateToDocument();

            // Check for new results matching pending suggestion outcomes
            this._checkOutcomeResults();

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

            // Inject mode personality prefix (fallback path)
            var fbMode = typeof AIModeConfig !== 'undefined' ? AIModeConfig.getMode() : null;
            if (fbMode && fbMode.responseStyle.personalityPrefix) {
                systemPrompt = fbMode.responseStyle.personalityPrefix + '\n\n' + systemPrompt;
            }

            clinicalContext = this.buildFullClinicalContext();
            userMessage = `## Current Clinical Context\n${clinicalContext}\n\n## Doctor's Current Assessment/Thoughts\n"${doctorThoughts}"\n\nBased on the doctor's thoughts and the clinical context above, provide an updated synthesis. Update the trajectory assessment, key findings, and open questions based on this new information.`;
        }

        // Store clinical context for debug panel
        this.lastApiCall.clinicalContext = clinicalContext;

        try {
            // Progressive streaming: update UI every 400ms with whatever's ready
            let progressiveThrottleTimer = null;
            let lastProgressiveHash = '';
            const PROGRESSIVE_INTERVAL = 400;

            const onChunk = (accumulatedText) => {
                // Throttle progressive updates
                if (progressiveThrottleTimer) return;
                progressiveThrottleTimer = setTimeout(() => {
                    progressiveThrottleTimer = null;
                }, PROGRESSIVE_INTERVAL);

                // Attempt partial JSON parse
                const partial = this._parseJSONResponse(accumulatedText);
                if (!partial) return;

                // Build a simple hash of what's populated to detect real changes
                const hash = [
                    partial.oneLiner ? 'O' : '',
                    partial.clinicalSummary ? 'S' : '',
                    partial.problemList?.length || 0,
                    partial.categorizedActions ? 'A' : '',
                    partial.thinking ? 'T' : '',
                    partial.summary ? 'U' : ''
                ].join(',');

                if (hash !== lastProgressiveHash) {
                    lastProgressiveHash = hash;
                    this._progressiveUpdate(partial);
                }
            };

            // Use streaming for real-time progressive updates (dictation stays on Sonnet for quality)
            const response = await this.callLLMStreaming(
                systemPrompt, userMessage, 4096,
                { model: this.dictationModel }, onChunk
            );

            // Clear any pending progressive timer
            if (progressiveThrottleTimer) {
                clearTimeout(progressiveThrottleTimer);
                progressiveThrottleTimer = null;
            }

            // Parse the final complete JSON response
            const result = this._parseJSONResponse(response);
            if (!result) {
                throw new Error('Could not parse AI response');
            }

            // Update AI panel state with final result
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
            if (result.glassesDisplay) {
                this.state.glassesDisplay = result.glassesDisplay;
            }

            // Heavy mode: extract teaching points and DDx challenge
            if (result.teachingPoints && Array.isArray(result.teachingPoints)) {
                this.state.teachingPoints = result.teachingPoints;
            }
            if (result.ddxChallenge) {
                this.state.ddxChallenge = result.ddxChallenge;
            }

            // Push synthesis summary to conversation thread
            if (result.summary) {
                this._pushToThread('ai', 'think', result.summary);
            }

            this.state.status = 'ready';
            this.saveState();
            this.render();
            App.showToast('AI synthesis updated', 'success');

            // Push updated state to glasses
            if (typeof SmartGlasses !== 'undefined' && SmartGlasses._pushToG2Companion) {
                SmartGlasses._pushToG2Companion(this.state, null);
            }

        } catch (error) {
            console.error('LLM synthesis error:', error);
            this.state.status = 'ready';
            this.render();
            if (error.message === 'API key not configured') {
                App.showToast('Configure API key in settings to enable AI synthesis', 'warning');
            } else if (error.message === 'Could not parse AI response') {
                App.showToast('AI response could not be parsed. Try again.', 'warning');
            } else {
                App.showToast(`API error: ${error.message}`, 'error');
            }
        }
    },

    /**
     * Progressive UI update during streaming — updates state with partial results
     * and triggers a render so sections appear as the LLM generates them.
     */
    _progressiveUpdate(partial) {
        let updated = false;

        // Update thinking banner label based on what section is being generated
        if (partial.categorizedActions && !this.state.categorizedActions) {
            this._streamingPhase = 'actions';
        } else if (partial.problemList && partial.problemList.length && !this.state.problemList?.length) {
            this._streamingPhase = 'problems';
        } else if (partial.clinicalSummary && !this.state.clinicalSummary?.demographics) {
            this._streamingPhase = 'summary';
        }

        if (partial.oneLiner && partial.oneLiner !== this.state.aiOneLiner) {
            this.state.aiOneLiner = partial.oneLiner;
            updated = true;
        }
        if (partial.clinicalSummary && JSON.stringify(partial.clinicalSummary) !== JSON.stringify(this.state.clinicalSummary)) {
            this.state.clinicalSummary = partial.clinicalSummary;
            updated = true;
        }
        if (partial.problemList && partial.problemList.length && JSON.stringify(partial.problemList) !== JSON.stringify(this.state.problemList)) {
            this.state.problemList = partial.problemList;
            updated = true;
        }
        if (partial.categorizedActions && JSON.stringify(partial.categorizedActions) !== JSON.stringify(this.state.categorizedActions)) {
            this.state.categorizedActions = partial.categorizedActions;
            updated = true;
        }
        if (partial.summary && partial.summary !== this.state.summary) {
            this.state.summary = partial.summary;
            updated = true;
        }

        if (updated) {
            this.render();
            // Add brief highlight animation to updated sections
            requestAnimationFrame(() => {
                document.querySelectorAll('.copilot-section').forEach(el => {
                    el.classList.remove('section-just-updated');
                });
                // Highlight sections that just got data
                if (partial.clinicalSummary) {
                    const el = document.querySelector('.summary-section');
                    if (el) el.classList.add('section-just-updated');
                }
                if (partial.problemList?.length) {
                    const el = document.querySelector('.problem-section');
                    if (el) el.classList.add('section-just-updated');
                }
                if (partial.categorizedActions) {
                    const el = document.querySelector('.actions-section');
                    if (el) el.classList.add('section-just-updated');
                }
            });
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

        // === INCREMENTAL REFRESH PATH ===
        // If we have a memoryDocument, use the cheap incremental refresh instead of full chart
        if (this.contextAssembler && this.longitudinalDoc?.aiMemory?.memoryDocument) {
            try {
                this.syncSessionStateToDocument();
                this._checkOutcomeResults();

                const prompt = this.contextAssembler.buildRefreshMemoryPrompt();
                console.log(`🔄 Incremental refresh: ${prompt.userMessage.length} chars (vs full chart)`);

                // Progressive streaming — extract completed fields via regex
                // This works even before the full JSON is parseable
                let lastRenderedFields = {};
                const extractField = (text, field) => {
                    // Match "field": "value" or "field": "multi\nline\nvalue"
                    const re = new RegExp('"' + field + '"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"');
                    const m = text.match(re);
                    return m ? m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"') : null;
                };

                const onIncChunk = (accText) => {
                    // 1. One-liner (clinicalGestalt) — appears first in JSON
                    const gestalt = extractField(accText, 'clinicalGestalt');
                    if (gestalt && gestalt !== lastRenderedFields.gestalt) {
                        lastRenderedFields.gestalt = gestalt;
                        this.state.aiOneLiner = gestalt;
                        this._streamingPhase = 'summary';
                        // Targeted DOM update — just the one-liner
                        const lineEl = document.querySelector('.status-line-text');
                        if (lineEl) {
                            lineEl.textContent = gestalt;
                        } else {
                            // First appearance — need full render to create the element
                            this.render();
                            return;
                        }
                    }

                    // 2. Patient overview — appears second
                    const overview = extractField(accText, 'patientOverview');
                    if (overview && overview !== lastRenderedFields.overview) {
                        lastRenderedFields.overview = overview;
                        this.state.summary = overview;
                        // Targeted DOM update — just the summary section
                        const summaryEl = document.querySelector('.summary-section .copilot-section-body');
                        if (summaryEl) {
                            summaryEl.innerHTML = this.renderClinicalSummary(true).replace(/<div class="copilot-section[^>]*>.*?<div class="copilot-section-body">/, '').replace(/<\/div>\s*<\/div>\s*$/, '');
                        } else {
                            this.render();
                            return;
                        }
                    }

                    // 3. Try full JSON parse for structured fields (problems, etc.)
                    const partial = this._parseJSONResponse(accText);
                    if (partial) {
                        if (partial.problemAnalysis?.length && partial.problemAnalysis.length !== lastRenderedFields.problemCount) {
                            lastRenderedFields.problemCount = partial.problemAnalysis.length;
                            this.state.problemList = partial.problemAnalysis.map(p => ({
                                name: p.problem,
                                urgency: p.status === 'acute' ? 'urgent' : (p.status === 'active' ? 'active' : 'monitoring'),
                                ddx: null,
                                plan: p.plan || ''
                            }));
                            this._streamingPhase = 'problems';
                            this.render(); // Full render for problems (complex HTML)
                            return;
                        }
                        if (partial.categorizedActions && !lastRenderedFields.hasActions) {
                            lastRenderedFields.hasActions = true;
                            this.state.categorizedActions = partial.categorizedActions;
                            this._streamingPhase = 'actions';
                            this.render();
                            return;
                        }
                    }
                };

                const response = await this.callLLMStreaming(
                    prompt.systemPrompt,
                    prompt.userMessage,
                    prompt.maxTokens,
                    { model: this.analysisModel },
                    onIncChunk
                );
                // Streaming complete — clean up

                const memoryDoc = this._parseJSONResponse(response);
                if (memoryDoc && memoryDoc.patientOverview) {
                    // Update memory document
                    this.longitudinalDoc.aiMemory.memoryDocument = memoryDoc;
                    this.longitudinalDoc.aiMemory.lastRefreshedAt = new Date().toISOString();
                    this.longitudinalDoc.aiMemory.patientSummary = memoryDoc.patientOverview;

                    // Update panel state (final)
                    if (memoryDoc.clinicalGestalt) this.state.aiOneLiner = memoryDoc.clinicalGestalt;
                    if (memoryDoc.patientOverview) this.state.summary = memoryDoc.patientOverview;
                    if (memoryDoc.problemAnalysis) {
                        this.state.problemList = memoryDoc.problemAnalysis.map(p => ({
                            name: p.problem,
                            urgency: p.status === 'acute' ? 'urgent' : (p.status === 'active' ? 'active' : 'monitoring'),
                            ddx: null,
                            plan: p.plan || ''
                        }));
                    }
                    if (memoryDoc.pendingItems) {
                        this.state.suggestedActions = memoryDoc.pendingItems.map((item, idx) => ({
                            id: 'refresh_pending_' + idx,
                            text: item
                        }));
                    }
                    if (memoryDoc.safetyProfile?.criticalValues) {
                        const flags = memoryDoc.safetyProfile.criticalValues.map(cv => ({
                            text: cv, severity: 'critical'
                        }));
                        if (flags.length > 0) this.state.keyConsiderations = flags;
                    }

                    this.saveLongitudinalDoc();
                    this.state.status = 'ready';
                    this.state.lastUpdated = new Date().toISOString();
                    this.saveState();
                    this._saveModeCache();
                    this.render();
                    App.showToast('Analysis complete', 'success');

                    // Push updated state to glasses
                    if (typeof SmartGlasses !== 'undefined' && SmartGlasses._pushToG2Companion) {
                        SmartGlasses._pushToG2Companion(this.state, null);
                    }

                    if (btn) btn.classList.remove('spinning');
                    return;
                }
                // If parse failed, fall through to full refresh
                console.warn('Incremental refresh parse failed, falling back to full refresh');
            } catch (incErr) {
                console.warn('Incremental refresh failed, falling back:', incErr);
            }
        }

        // === FULL REFRESH PATH (legacy or no memoryDocument) ===
        // Use context assembler for comprehensive context, fall back to legacy
        let systemPrompt, userMessage, clinicalContext;
        if (this.contextAssembler) {
            this.syncSessionStateToDocument();

            // Check for new results matching pending suggestion outcomes
            this._checkOutcomeResults();

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
            systemPrompt = `You are an AI clinical assistant embedded in an EHR. Analyze this patient and provide a synthesis.

Be CONCISE. Write like an efficient attending at handoff. Clinical shorthand and abbreviations encouraged. Every word should earn its place.

Respond in this exact JSON format:
{
    "oneLiner": "~10 word gestalt for signout",
    "clinicalSummary": {
        "demographics": "HPI opener: age, sex, key PMH w/ qualifiers (e.g. 72M w/ HFrEF (EF 35%), T2DM, AFib, CKD3b)",
        "functional": "One short sentence: functional status + living situation",
        "presentation": "CC + timeline, key exam findings, pertinent negatives, abnormal labs w/ values"
    },
    "problemList": [
        {"name": "Most urgent problem", "urgency": "urgent|active|monitoring", "ddx": "Differential if relevant, or null", "plan": "One sentence plan"}
    ],
    "categorizedActions": {
        "communication": ["Ask patient/nurse actions"],
        "labs": ["Lab orders"],
        "imaging": ["Imaging orders, or empty array"],
        "medications": ["Medication orders"],
        "other": ["Other orders"]
    },
    "summary": "One sentence with **bold** for key diagnoses",
    "keyConsiderations": [
        {"text": "Safety concern", "severity": "critical|important|info"}
    ],
    "thinking": "1-2 sentences on trajectory.",
    "suggestedActions": ["top 3 next steps only"],
    "observations": ["key observations"],
    "trajectoryAssessment": "2-3 sentences MAX on disease trajectories.",
    "keyFindings": ["durable findings"],
    "openQuestions": ["unresolved questions"]
}

Prioritize: 1) Safety/critical values 2) Doctor's assessment 3) Actionable next steps 4) Unaddressed items

RULES:
- problemList: 3-5 problems MAX, most urgent first. Plans = one sentence each
- categorizedActions: Specific, actionable, 1-3 per category. Empty arrays fine
- keyConsiderations: allergies, contraindications, drug interactions. "critical" = life-threatening only
- Keep ALL text fields brief and clinical`;

            // Inject mode personality prefix (fallback path)
            var fbMode2 = typeof AIModeConfig !== 'undefined' ? AIModeConfig.getMode() : null;
            if (fbMode2 && fbMode2.responseStyle.personalityPrefix) {
                systemPrompt = fbMode2.responseStyle.personalityPrefix + '\n\n' + systemPrompt;
            }

            clinicalContext = this.buildFullClinicalContext();
            userMessage = `## Clinical Context\n${clinicalContext}\n\n${this.state.dictation ? `## Doctor's Current Assessment\n"${this.state.dictation}"` : '## No doctor assessment recorded yet'}\n\nProvide a comprehensive case synthesis. Build a trajectory assessment covering all active problems.`;
        }

        // Store clinical context for debug panel
        this.lastApiCall.clinicalContext = clinicalContext;

        try {
            // Progressive streaming for refresh — same approach as synthesizeWithLLM
            let refreshThrottleTimer = null;
            let lastRefreshHash = '';

            const onRefreshChunk = (accumulatedText) => {
                if (refreshThrottleTimer) return;
                refreshThrottleTimer = setTimeout(() => { refreshThrottleTimer = null; }, 400);
                const partial = this._parseJSONResponse(accumulatedText);
                if (!partial) return;
                const hash = [
                    partial.oneLiner ? 'O' : '',
                    partial.clinicalSummary ? 'S' : '',
                    partial.problemList?.length || 0,
                    partial.categorizedActions ? 'A' : '',
                    partial.summary ? 'U' : ''
                ].join(',');
                if (hash !== lastRefreshHash) {
                    lastRefreshHash = hash;
                    this._progressiveUpdate(partial);
                }
            };

            // Use streaming for progressive display
            const response = await this.callLLMStreaming(
                systemPrompt, userMessage, 4096,
                { model: this.analysisModel }, onRefreshChunk
            );
            if (refreshThrottleTimer) { clearTimeout(refreshThrottleTimer); refreshThrottleTimer = null; }

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
            if (result.glassesDisplay) {
                this.state.glassesDisplay = result.glassesDisplay;
            }

            // Heavy mode: extract teaching points and DDx challenge
            if (result.teachingPoints && Array.isArray(result.teachingPoints)) {
                this.state.teachingPoints = result.teachingPoints;
            }
            if (result.ddxChallenge) {
                this.state.ddxChallenge = result.ddxChallenge;
            }

            this.state.status = 'ready';
            this.state.lastUpdated = new Date().toISOString();
            this.saveState();

            // Cache results for this mode so switching back doesn't re-call API
            this._saveModeCache();

            this.render();
            App.showToast('AI analysis refreshed', 'success');

            // Push updated state to glasses
            if (typeof SmartGlasses !== 'undefined' && SmartGlasses._pushToG2Companion) {
                SmartGlasses._pushToG2Companion(this.state, null);
            }

        } catch (error) {
            console.error('LLM refresh error:', error);
            this.state.status = 'ready';
            this.render();
            if (error.message === 'API key not configured') {
                App.showToast('Configure API key in settings to enable AI analysis', 'warning');
            } else if (error.message === 'Could not parse AI response') {
                App.showToast('AI response could not be parsed. Try again.', 'warning');
            } else {
                App.showToast(`API error: ${error.message}`, 'error');
            }
        } finally {
            if (btn) {
                btn.classList.remove('spinning');
            }
        }
    },

    // ==================== Per-Mode Analysis Cache ====================

    /**
     * Save current analysis state to the per-mode cache.
     * Called after a successful refreshWithLLM so mode switches can restore results.
     */
    _saveModeCache() {
        var modeId = typeof AIModeConfig !== 'undefined' ? AIModeConfig.currentMode : 'active';
        this._modeAnalysisCache[modeId] = {
            summary: this.state.summary,
            thinking: this.state.thinking,
            aiOneLiner: this.state.aiOneLiner,
            clinicalSummary: this.state.clinicalSummary ? Object.assign({}, this.state.clinicalSummary) : null,
            problemList: this.state.problemList ? this.state.problemList.slice() : [],
            categorizedActions: this.state.categorizedActions ? Object.assign({}, this.state.categorizedActions) : null,
            suggestedActions: this.state.suggestedActions ? this.state.suggestedActions.slice() : [],
            keyConsiderations: this.state.keyConsiderations ? this.state.keyConsiderations.slice() : [],
            observations: this.state.observations ? this.state.observations.slice() : [],
            teachingPoints: this.state.teachingPoints ? this.state.teachingPoints.slice() : [],
            ddxChallenge: this.state.ddxChallenge || null,
            glassesDisplay: this.state.glassesDisplay || null,
            lastUpdated: this.state.lastUpdated,
            timestamp: Date.now()
        };
        // Record when this analysis finished — used to skip redundant auto-analysis
        this._lastAnalysisTimestamp = Date.now();
    },

    /**
     * Check if analysis was performed recently (within the last 2 minutes).
     * Used by _autoAnalyzeIfNeeded to skip redundant re-analysis when the
     * panel is expanded shortly after a background analysis (e.g. API key entry).
     * Manual refresh always bypasses this check.
     */
    wasRecentlyAnalyzed() {
        if (!this._lastAnalysisTimestamp) return false;
        var elapsed = Date.now() - this._lastAnalysisTimestamp;
        return elapsed < 120000; // 2 minutes
    },

    /**
     * Restore cached analysis for a given mode into the live state.
     */
    _restoreModeCache(modeId) {
        var cache = this._modeAnalysisCache[modeId];
        if (!cache) return;
        this.state.summary = cache.summary;
        this.state.thinking = cache.thinking;
        this.state.aiOneLiner = cache.aiOneLiner;
        this.state.clinicalSummary = cache.clinicalSummary;
        this.state.problemList = cache.problemList;
        this.state.categorizedActions = cache.categorizedActions;
        this.state.suggestedActions = cache.suggestedActions;
        this.state.keyConsiderations = cache.keyConsiderations;
        this.state.observations = cache.observations;
        this.state.teachingPoints = cache.teachingPoints;
        this.state.ddxChallenge = cache.ddxChallenge;
        this.state.glassesDisplay = cache.glassesDisplay;
        this.state.lastUpdated = cache.lastUpdated;
        this.state.status = 'ready';
        this.saveState();
    },

    /**
     * Invalidate all cached mode analyses (e.g., when chart data changes significantly).
     */
    _clearModeCache() {
        this._modeAnalysisCache = {};
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

        // Track completed action so it doesn't reappear
        this._completedActions = this._completedActions || new Set();
        this._completedActions.add(text);

        // Feed back to AI context — store with metadata so the AI knows what's been done
        const executedAction = {
            text: text,
            category: category || 'unknown',
            orderType: action.orderType || null,
            orderData: action.orderData || null,
            timestamp: new Date().toISOString()
        };
        if (!this.state.executedActions) this.state.executedActions = [];
        this.state.executedActions.push(executedAction);
        if (this.state.executedActions.length > 30) {
            this.state.executedActions = this.state.executedActions.slice(-30);
        }
        this.saveState();

        // PERSIST to longitudinal doc so it survives page reloads
        if (this.longitudinalDoc) {
            if (!this.longitudinalDoc.aiMemory.executedActions) {
                this.longitudinalDoc.aiMemory.executedActions = [];
            }
            this.longitudinalDoc.aiMemory.executedActions.push(executedAction);
            if (this.longitudinalDoc.aiMemory.executedActions.length > 30) {
                this.longitudinalDoc.aiMemory.executedActions =
                    this.longitudinalDoc.aiMemory.executedActions.slice(-30);
            }

            // OUTCOME TRACKING: Record which AI suggestion led to this action
            this._trackSuggestionOutcome(executedAction);

            this.saveLongitudinalDoc();
        }

        this._removeActionFromUI(actionId);

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
     * Remove an action item from the UI immediately with a fade-out animation.
     * Also tracked in _completedActions so it won't reappear on next render.
     */
    _removeActionFromUI(actionId) {
        const allItems = document.querySelectorAll('.action-item');
        allItems.forEach(el => {
            const onclick = el.getAttribute('onclick') || '';
            if (onclick.includes(actionId)) {
                el.style.transition = 'opacity 0.3s, max-height 0.3s, padding 0.3s';
                el.style.opacity = '0';
                el.style.maxHeight = '0';
                el.style.paddingTop = '0';
                el.style.paddingBottom = '0';
                el.style.overflow = 'hidden';
                setTimeout(() => el.remove(), 350);
            }
        });
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
     * Open the patient chat window and pre-fill a patient-friendly message.
     * Converts clinical shorthand to natural conversational language.
     */
    _sendToPatientChat(text) {
        // Convert clinical action text to patient-friendly language
        const friendlyText = this._toPatientFriendlyText(text);

        // Open the chat window
        if (typeof FloatingChat !== 'undefined') {
            FloatingChat.openChat('patient');
        }

        // Wait for the chat to initialize, then set the input
        setTimeout(() => {
            const input = document.getElementById('patient-input');
            if (input) {
                input.value = friendlyText;
                input.focus();
                App.showToast('Message ready in Patient Chat — press Send', 'info');
            }
        }, 300);
    },

    /**
     * Convert a clinical action like "Ask patient about dietary potassium intake"
     * into a warm, conversational patient-facing question.
     */
    _toPatientFriendlyText(text) {
        // Strip the "Ask patient" / "Ask pt" / "Tell patient" prefix
        let core = text
            .replace(/^ask\s+(the\s+)?patient\s+(about\s+|if\s+|whether\s+|how\s+|what\s+|when\s+|regarding\s+)?/i, '')
            .replace(/^ask\s+(the\s+)?pt\s+(about\s+|if\s+|whether\s+|how\s+|what\s+|when\s+|regarding\s+)?/i, '')
            .replace(/^tell\s+(the\s+)?patient\s+(about\s+|that\s+|to\s+)?/i, '')
            .replace(/^inform\s+(the\s+)?patient\s+(about\s+|that\s+|of\s+)?/i, '')
            .replace(/^confirm\s+with\s+(the\s+)?patient\s+(whether\s+|if\s+|that\s+)?/i, '')
            .replace(/^clarify\s+with\s+(the\s+)?patient\s+(whether\s+|if\s+|about\s+)?/i, '')
            .trim();

        if (!core) return text; // safety: return original if stripping empties it

        // If core already starts like a question word, capitalize, fix pronouns, ensure ?
        if (/^(how|what|when|where|who|which|do you|are you|have you|can you|did you|is there)/i.test(core)) {
            core = core.charAt(0).toUpperCase() + core.slice(1);
            // Fix third-person → second-person pronouns
            core = core.replace(/\bthey sleep\b/gi, 'do you sleep');
            core = core.replace(/\bthey take\b/gi, 'do you take');
            core = core.replace(/\bthey eat\b/gi, 'do you eat');
            core = core.replace(/\bthey feel\b/gi, 'do you feel');
            core = core.replace(/\bthey have\b/gi, 'do you have');
            core = core.replace(/\bthey use\b/gi, 'do you use');
            core = core.replace(/\bthey experience\b/gi, 'do you experience');
            core = core.replace(/\bthey\b/gi, 'you').replace(/\btheir\b/gi, 'your').replace(/\bthem\b/gi, 'you');
            if (!core.endsWith('?')) core += '?';
            return core;
        }

        // Otherwise, rephrase as a friendly question
        // "dietary potassium intake" → "Can you tell me about your dietary potassium intake?"
        // "medication compliance" → "Can you tell me about your medication compliance?"
        // "they are taking furosemide at home" → "Are you taking your furosemide at home?"
        if (/^(they|he|she|the patient)\s+(is|are|was|were|has|have|had)\b/i.test(core)) {
            // Third person → convert to "you" form
            core = core
                .replace(/^(they|he|she|the patient)\s+are\b/i, 'Are you')
                .replace(/^(they|he|she|the patient)\s+is\b/i, 'Are you')
                .replace(/^(they|he|she|the patient)\s+were\b/i, 'Were you')
                .replace(/^(they|he|she|the patient)\s+was\b/i, 'Were you')
                .replace(/^(they|he|she|the patient)\s+have\b/i, 'Have you')
                .replace(/^(they|he|she|the patient)\s+has\b/i, 'Have you')
                .replace(/^(they|he|she|the patient)\s+had\b/i, 'Did you have');
            if (!core.endsWith('?')) core += '?';
            return core;
        }

        // "taking medications as prescribed" → "Have you been taking your medications as prescribed?"
        if (/^(taking|using|eating|drinking|sleeping|feeling|having|experiencing)\b/i.test(core)) {
            core = 'Have you been ' + core.charAt(0).toLowerCase() + core.slice(1);
            // Replace "their" → "your"
            core = core.replace(/\btheir\b/gi, 'your').replace(/\bthem\b/gi, 'you');
            if (!core.endsWith('?')) core += '?';
            return core;
        }

        // Check if original was "Tell patient" — these are things TO say, not questions
        if (/^(tell|inform)\b/i.test(text)) {
            core = core.charAt(0).toUpperCase() + core.slice(1);
            core = core.replace(/\btheir\b/gi, 'your').replace(/\bthem\b/gi, 'you').replace(/\bthey\b/gi, 'you');
            core = core.replace(/\.\s*$/, '');
            return core;
        }

        // Default: "Can you tell me about [core]?"
        core = core.charAt(0).toLowerCase() + core.slice(1);
        // Replace clinical pronouns
        core = core.replace(/\btheir\b/gi, 'your').replace(/\bthem\b/gi, 'you').replace(/\bthey\b/gi, 'you');
        // Remove trailing period if present
        core = core.replace(/\.\s*$/, '');
        return `Can you tell me about ${core}?`;
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

    // ==================== Deep Learn — Multi-Pass Chart Analysis ====================

    /**
     * Reset deep learn state to initial values
     */
    _resetDeepLearn() {
        this._deepLearn = {
            phase: 'idle',
            chartMap: null,
            queue: [],
            processed: new Set(),
            totalItems: 0,
            processedCount: 0,
            currentLevel: 0,
            totalLevels: 0,
            levelBatches: [],
            extractedFacts: [],
            levelFindings: [],
            aborted: false
        };
    },

    /**
     * Reset learn progress back to Level 0 (idle) without clearing the memory document.
     * The AI keeps whatever knowledge it has, but the level tracker resets so you can re-learn.
     */
    resetLearnProgress() {
        if (!confirm('Reset learning progress back to Level 0?\n\nThe AI keeps its current knowledge base, but you can start learning from scratch again.')) return;
        this._resetDeepLearn();
        this._saveDeepLearnState();
        this.state.status = 'ready';
        this.render();
        App.showToast('Learning progress reset to Level 0', 'info');
    },

    /**
     * Learn about the patient — multi-pass deep chart analysis.
     * Phase 0: Map chart (instant, no LLM)
     * Level 1: Critical foundation (Sonnet, full text of recent/critical items)
     * Level 2+: User-triggered deep review (Haiku extraction + Sonnet synthesis)
     */
    async learnPatient() {
        if (!this.contextAssembler) {
            App.showToast('Initialize patient chart first', 'warning');
            return;
        }

        // If we're between levels, advance to next level
        if (this._deepLearn.phase === 'between_levels') {
            // Rebuild chart map if needed (e.g., after page reload)
            if (!this._deepLearn.levelBatches || this._deepLearn.levelBatches.length === 0) {
                this.state.status = 'learning';
                this.render();
                await this._mapChart();
                // Remove already-processed items from batches
                this._deepLearn.levelBatches = this._deepLearn.levelBatches.map(batch =>
                    batch.filter(item => !this._deepLearn.processed.has(item.id))
                ).filter(batch => batch.length > 0);
                this._deepLearn.phase = 'between_levels';
                this.state.status = 'ready';
            }
            return this._runNextLevel();
        }

        // If already complete, re-learn from scratch
        if (this._deepLearn.phase === 'complete') {
            this._resetDeepLearn();
        }

        // Fresh learn: start with chart mapping
        this._resetDeepLearn();
        this.state.status = 'learning';
        this.render();

        try {
            // Ensure longitudinal document is up to date
            if (!this.longitudinalDoc) {
                await this.initializeLongitudinalDocument();
            }
            this.syncSessionStateToDocument();

            // Phase 0: Map the chart
            await this._mapChart();

            // Auto-start Level 1
            await this._runLevel1();

        } catch (error) {
            console.error('Deep learn error:', error);
            this._deepLearn.phase = 'idle';
            this.state.status = 'ready';
            this.render();
            if (error.message === 'API key not configured') {
                App.showToast('Configure API key in settings to enable AI', 'warning');
            } else {
                App.showToast(`Learn failed: ${error.message}`, 'error');
            }
        }
    },

    /**
     * Redo the current (or last completed) level of deep learn.
     * Un-marks items from that level's batch and re-runs the analysis.
     */
    async redoCurrentLevel() {
        const dl = this._deepLearn;
        const levelToRedo = dl.currentLevel;

        if (!levelToRedo || levelToRedo < 1) {
            App.showToast('No level to redo — start a fresh Learn', 'warning');
            return;
        }

        console.log(`🧠 Deep Learn: Redoing Level ${levelToRedo}`);
        App.showToast(`Redoing Level ${levelToRedo}...`, 'info');

        // Rebuild chart map if needed (e.g., after page reload)
        if (!dl.levelBatches || dl.levelBatches.length === 0) {
            this.state.status = 'learning';
            this.render();
            await this._mapChart();
            // Remove already-processed items from batches, except the level we're redoing
            const batchIdx = levelToRedo - 1;
            dl.levelBatches = dl.levelBatches.map((batch, idx) => {
                if (idx === batchIdx) return batch; // Keep the redo batch intact
                return batch.filter(item => !dl.processed.has(item.id));
            }).filter(batch => batch.length > 0);
        }

        // Find the batch for this level
        const batchIdx = levelToRedo - 1;
        const batch = dl.levelBatches[batchIdx];

        if (!batch || batch.length === 0) {
            App.showToast('Could not find items for this level — try a fresh Learn', 'warning');
            return;
        }

        // Un-mark items from this batch as processed
        batch.forEach(item => dl.processed.delete(item.id));
        dl.processedCount = dl.processed.size;

        // Re-run the appropriate level
        this.state.status = 'learning';
        this.render();

        try {
            if (levelToRedo === 1) {
                await this._runLevel1();
            } else {
                // For Level 2+, set state so _runNextLevel processes the right batch
                dl.currentLevel = levelToRedo - 1; // Will be incremented by _runNextLevel
                dl.phase = 'between_levels';
                await this._runNextLevel();
            }
        } catch (error) {
            console.error(`Redo Level ${levelToRedo} failed:`, error);
            dl.phase = 'between_levels';
            this.state.status = 'ready';
            this.render();
            App.showToast(`Redo failed: ${error.message}`, 'error');
        }
    },

    /**
     * Phase 0: Map the chart — count and categorize all data, build priority queue.
     * No LLM call, instant.
     */
    async _mapChart() {
        this._deepLearn.phase = 'mapping';
        this.render();
        console.log('🧠 Deep Learn: Mapping chart...');

        const dl = window.dataLoader;
        const pid = dl?.currentPatientId || 'PAT001';

        // Load all indexes in parallel
        const [notesIndex, labsIndex, imagingIndex] = await Promise.all([
            dl.loadNotesIndex(pid).catch(() => ({ notes: [] })),
            dl.loadLabsIndex(pid).catch(() => ({ panels: [] })),
            dl.loadImaging(pid).catch(() => ({ studies: [] }))
        ]);

        const notes = (notesIndex.notes || []).map(n => ({
            type: 'note',
            id: n.id,
            meta: { noteType: n.type, date: n.date, author: n.author, department: n.department, title: n.title }
        }));

        const labs = (labsIndex.panels || []).map(p => ({
            type: 'lab',
            id: p.id,
            meta: { name: p.name, date: p.date }
        }));

        const imaging = (imagingIndex.studies || []).map(s => ({
            type: 'imaging',
            id: s.id,
            meta: { modality: s.modality, description: s.description, date: s.date }
        }));

        this._deepLearn.chartMap = { notes, labs, imaging };
        this._deepLearn.totalItems = notes.length + labs.length + imaging.length;

        // Build prioritized queue
        const queue = this._buildPriorityQueue(notes, labs, imaging);
        this._deepLearn.queue = queue;

        // Compute level batches
        // Level 1: first batch (critical/recent items)
        // Level 2+: remaining items in batches of ~30 notes or ~50 labs
        const level1Items = [];
        const remainingItems = [];
        const now = new Date();
        const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);

        // Critical note types that go into Level 1
        const criticalTypes = ['H&P', 'Discharge Summary', 'Operative Note', 'ED Note', 'Consult Note'];

        for (const item of queue) {
            const itemDate = new Date(item.meta.date);
            const isRecent = itemDate > sevenDaysAgo;
            const isCriticalType = item.type === 'note' && criticalTypes.includes(item.meta.noteType);
            const isImaging = item.type === 'imaging';

            if (level1Items.length < 15 && (isRecent || isCriticalType || isImaging)) {
                level1Items.push(item);
            } else {
                remainingItems.push(item);
            }
        }

        // If Level 1 is too small, add a few more
        if (level1Items.length < 8) {
            while (level1Items.length < 12 && remainingItems.length > 0) {
                level1Items.push(remainingItems.shift());
            }
        }

        // Build batches for Level 2+
        const BATCH_SIZE = 30;
        const batches = [level1Items];
        for (let i = 0; i < remainingItems.length; i += BATCH_SIZE) {
            batches.push(remainingItems.slice(i, i + BATCH_SIZE));
        }

        this._deepLearn.levelBatches = batches;
        this._deepLearn.totalLevels = batches.length;

        console.log('🧠 Deep Learn: Chart mapped', {
            notes: notes.length,
            labs: labs.length,
            imaging: imaging.length,
            total: this._deepLearn.totalItems,
            levels: batches.length,
            level1Items: level1Items.length
        });
    },

    /**
     * Build a prioritized queue of chart items for processing.
     * Order: recent > critical types > abnormal labs > progress notes > historical
     */
    _buildPriorityQueue(notes, labs, imaging) {
        const now = new Date();
        const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
        const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);

        const criticalTypes = ['H&P', 'Discharge Summary', 'Operative Note', 'ED Note'];
        const importantTypes = ['Consult Note', 'Procedure Note'];

        // Score each item for priority sorting (higher = process first)
        const scored = [...notes, ...labs, ...imaging].map(item => {
            let score = 0;
            const itemDate = new Date(item.meta.date);

            // Recency boost
            if (itemDate > sevenDaysAgo) score += 100;
            else if (itemDate > thirtyDaysAgo) score += 50;
            else score += Math.max(0, 25 - Math.floor((now - itemDate) / (30 * 24 * 60 * 60 * 1000)));

            // Type boost
            if (item.type === 'note') {
                if (criticalTypes.includes(item.meta.noteType)) score += 80;
                else if (importantTypes.includes(item.meta.noteType)) score += 60;
                else if (item.meta.noteType === 'Progress Note') score += 40;
            } else if (item.type === 'imaging') {
                score += 70; // Imaging always important
            } else if (item.type === 'lab') {
                score += 30; // Labs moderate priority
            }

            return { ...item, _score: score };
        });

        // Sort by score descending, then by date descending
        scored.sort((a, b) => {
            if (b._score !== a._score) return b._score - a._score;
            return new Date(b.meta.date) - new Date(a.meta.date);
        });

        return scored;
    },

    /**
     * Level 1: Critical Foundation — read full text of critical/recent items with Sonnet.
     */
    async _runLevel1() {
        this._deepLearn.phase = 'level1';
        this._deepLearn.currentLevel = 1;
        this.render();

        const batch = this._deepLearn.levelBatches[0];
        if (!batch || batch.length === 0) {
            console.warn('🧠 Deep Learn: No items for Level 1');
            this._deepLearn.phase = 'complete';
            this.state.status = 'ready';
            this.render();
            return;
        }

        console.log(`🧠 Deep Learn Level 1: Loading ${batch.length} critical items...`);
        App.showToast(`Learning chart — Level 1 (${batch.length} items)...`, 'info');

        // Stage tracking for progress UI
        this._deepLearn._stage = 'loading';
        this.render();

        // Load full content for all Level 1 items in parallel
        const dl = window.dataLoader;
        const pid = dl?.currentPatientId || 'PAT001';

        const loadPromises = batch.map(async (item) => {
            try {
                if (item.type === 'note') {
                    item.data = await dl.loadNote(item.id, pid);
                } else if (item.type === 'lab') {
                    item.data = await dl.loadLabPanel(item.id, pid);
                } else if (item.type === 'imaging') {
                    item.data = await dl.loadImagingReport(item.id, pid);
                }
            } catch (e) {
                console.warn(`Could not load ${item.type} ${item.id}:`, e.message);
            }
            return item;
        });

        const loadedItems = await Promise.all(loadPromises);
        const itemsWithData = loadedItems.filter(i => i.data);

        // Update progress (show loading progress)
        this._deepLearn.processedCount = itemsWithData.length;
        this.render();

        // Assemble full text context via working memory, cap to prevent API overload
        let chartContext = this.workingMemory.assembleForDeepLearnLevel1(itemsWithData);
        const MAX_CONTEXT = 15000; // ~4K tokens — keeps Level 1 fast (~10-15 sec) and avoids 502s
        if (chartContext.length > MAX_CONTEXT) {
            console.warn(`🧠 Deep Learn: Context too large (${chartContext.length} chars), truncating to ${MAX_CONTEXT}`);
            chartContext = chartContext.substring(0, MAX_CONTEXT) + '\n\n[... Chart data truncated due to size. Focus on the data above.]';
        }

        // Level 1 uses the user's analysis model setting
        const level1Model = this.analysisModel || 'claude-sonnet-4-6';
        console.log(`🧠 Deep Learn Level 1: Sending ${chartContext.length} chars to ${level1Model}`);

        // Stage: Analyzing
        this._deepLearn._stage = 'analyzing';
        this.render();

        // Call LLM with the comprehensive Level 1 prompt
        const prompt = this.contextAssembler.buildDeepLearnLevel1Prompt(chartContext);
        let response;
        try {
            response = await this.callLLM(
                prompt.systemPrompt,
                prompt.userMessage,
                prompt.maxTokens,
                { model: level1Model }
            );
        } catch (apiErr) {
            console.error('Level 1 API call failed:', apiErr.message, 'Context size:', chartContext.length, 'chars');
            App.showToast(`Level 1 failed: ${apiErr.message}`, 'error');
            this._deepLearn.phase = 'between_levels';
            this._deepLearn._stage = null;
            this.state.status = 'ready';
            this.render();
            throw apiErr;
        }

        // Stage: Building memory document
        this._deepLearn._stage = 'synthesizing';
        this.render();

        // Parse and store the memory document
        let memoryDoc = this._parseJSONResponse(response);
        if (!memoryDoc) {
            console.error('Level 1: Could not parse JSON from response. First 500 chars:', response?.substring(0, 500));
            // Fallback: create a minimal memory doc from the raw text
            memoryDoc = {
                clinicalGestalt: 'Analysis completed — memory document may be incomplete. Try Redo Level 1.',
                patientOverview: response?.substring(0, 2000) || 'Level 1 analysis completed but response was not structured JSON.',
                safetyProfile: { allergies: [], contraindications: [], criticalValues: [], renalDosing: [] },
                problemAnalysis: [],
                medicationRationale: [],
                labTrends: { key_values: [] },
                pendingItems: []
            };
            App.showToast('Memory document partially parsed — try Redo Level 1 for better results', 'warning');
        }

        // Validate and fill missing fields — ensure all 7 top-level fields exist
        if (!memoryDoc.clinicalGestalt) {
            memoryDoc.clinicalGestalt = memoryDoc.summary || memoryDoc.patientSummary || '';
        }
        if (!memoryDoc.patientOverview) {
            memoryDoc.patientOverview = memoryDoc.clinicalGestalt || memoryDoc.summary || memoryDoc.patientSummary || 'Patient overview not generated';
        }
        if (!memoryDoc.safetyProfile || typeof memoryDoc.safetyProfile !== 'object') {
            memoryDoc.safetyProfile = { allergies: [], contraindications: [], criticalValues: [], renalDosing: [] };
        }
        if (!Array.isArray(memoryDoc.problemAnalysis)) memoryDoc.problemAnalysis = [];
        if (!Array.isArray(memoryDoc.medicationRationale)) memoryDoc.medicationRationale = [];
        if (!memoryDoc.labTrends || !memoryDoc.labTrends.key_values) memoryDoc.labTrends = { key_values: [] };
        if (!Array.isArray(memoryDoc.pendingItems)) memoryDoc.pendingItems = [];

        // Log completeness
        const fieldCount = [
            memoryDoc.clinicalGestalt ? 1 : 0,
            memoryDoc.patientOverview ? 1 : 0,
            memoryDoc.problemAnalysis.length > 0 ? 1 : 0,
            memoryDoc.safetyProfile.allergies?.length > 0 || memoryDoc.safetyProfile.contraindications?.length > 0 ? 1 : 0,
            memoryDoc.medicationRationale.length > 0 ? 1 : 0,
            memoryDoc.labTrends.key_values.length > 0 ? 1 : 0,
            memoryDoc.pendingItems.length > 0 ? 1 : 0
        ].reduce((a, b) => a + b, 0);
        console.log(`🧠 Level 1 completeness: ${fieldCount}/7 fields populated (${memoryDoc.problemAnalysis.length} problems, ${memoryDoc.medicationRationale.length} meds, ${memoryDoc.labTrends.key_values.length} lab trends)`);

        // Mark items as processed and sync count
        batch.forEach(item => this._deepLearn.processed.add(item.id));
        this._deepLearn.processedCount = this._deepLearn.processed.size;

        // Store memory
        this._applyMemoryDocument(memoryDoc);

        // Auto-open memory viewer to show what was learned (unless suppressed during onboarding)
        if (!this._memoryViewerOpen && !this._suppressMemoryViewer) {
            this.openMemoryViewer();
        }

        // Transition to between-levels state
        this._deepLearn.phase = 'between_levels';
        this.state.status = 'ready';
        this.render();

        const remaining = this._deepLearn.totalItems - this._deepLearn.processedCount;
        const remainingLevels = this._deepLearn.totalLevels - 1;

        console.log(`🧠 Deep Learn Level 1 complete: ${this._deepLearn.processedCount}/${this._deepLearn.totalItems} items, ${remainingLevels} levels remaining`);

        if (remainingLevels <= 0) {
            this._deepLearn.phase = 'complete';
            App.showToast('Chart fully learned!', 'success');
        } else {
            App.showToast(`Level 1 complete — ${remaining} items remaining`, 'success');
        }

        this.saveLongitudinalDoc();
        this._saveDeepLearnState();
        this.saveState();
        this._saveModeCache();
        this.render();
    },

    /**
     * Run the next level of deep chart analysis (Level 2+).
     * Haiku extracts facts from batch, Sonnet synthesizes into memory.
     */
    async _runNextLevel() {
        const dl = this._deepLearn;
        const nextLevelIdx = dl.currentLevel; // 0-indexed into levelBatches (level 1 = index 0)

        if (nextLevelIdx >= dl.levelBatches.length) {
            dl.phase = 'complete';
            this.state.status = 'ready';
            App.showToast('Chart fully learned!', 'success');
            this.render();
            return;
        }

        dl.phase = 'level2+';
        dl.currentLevel = nextLevelIdx + 1;
        dl.levelFindings = [];
        this.state.status = 'learning';
        this.render();

        const batch = dl.levelBatches[nextLevelIdx];
        console.log(`🧠 Deep Learn Level ${dl.currentLevel}: Processing ${batch.length} items...`);
        App.showToast(`Deep review — Level ${dl.currentLevel} (${batch.length} items)...`, 'info');

        try {
            // Step 1: Load full content
            dl._stage = 'loading';
            this.render();
            const loader = window.dataLoader;
            const pid = loader?.currentPatientId || 'PAT001';

            const loadPromises = batch.map(async (item) => {
                try {
                    if (item.type === 'note') {
                        item.data = await loader.loadNote(item.id, pid);
                    } else if (item.type === 'lab') {
                        item.data = await loader.loadLabPanel(item.id, pid);
                    } else if (item.type === 'imaging') {
                        item.data = await loader.loadImagingReport(item.id, pid);
                    }
                } catch (e) {
                    console.warn(`Could not load ${item.type} ${item.id}:`, e.message);
                }
                return item;
            });

            const loadedItems = (await Promise.all(loadPromises)).filter(i => i.data);

            // Step 2: Haiku extraction (parallel)
            dl._stage = 'analyzing';
            this.render();
            const extractions = await this._batchExtract(loadedItems);

            // Step 3: Sonnet synthesis
            dl._stage = 'synthesizing';
            this.render();
            let currentMemory = this.longitudinalDoc.aiMemory.memoryDocument;
            if (!currentMemory) {
                // No memory document — auto-run Level 1 first
                console.log('🧠 No memory document found — auto-running Level 1 before continuing');
                App.showToast('Building foundation first (Level 1)...', 'info');
                await this._runLevel1();
                currentMemory = this.longitudinalDoc.aiMemory.memoryDocument;
                if (!currentMemory) {
                    throw new Error('Level 1 failed to produce a memory document');
                }
                // Reset state for continuing with the current level
                dl.phase = 'level2+';
                dl.currentLevel = nextLevelIdx + 1;
                this.state.status = 'learning';
                this.render();
            }

            const updatedMemory = await this._synthesizeBatch(currentMemory, extractions);

            // Mark processed and sync count
            batch.forEach(item => dl.processed.add(item.id));
            dl.processedCount = dl.processed.size;

            // Apply updated memory
            this._applyMemoryDocument(updatedMemory);

            // Auto-open memory viewer to show new data from this level
            if (!this._memoryViewerOpen) {
                this.openMemoryViewer();
            }

            // Check if complete
            const remainingLevels = dl.totalLevels - dl.currentLevel;
            if (remainingLevels <= 0) {
                dl.phase = 'complete';
                App.showToast('Chart fully learned!', 'success');
            } else {
                dl.phase = 'between_levels';
                const remaining = dl.totalItems - dl.processedCount;
                App.showToast(`Level ${dl.currentLevel} complete — ${remaining} items remaining`, 'success');
            }

            this.state.status = 'ready';
            this.saveLongitudinalDoc();
            this._saveDeepLearnState();
            this.saveState();
            this._saveModeCache();
            this.render();

            console.log(`🧠 Deep Learn Level ${dl.currentLevel} complete: ${dl.processedCount}/${dl.totalItems} items`);

        } catch (error) {
            console.error(`Deep Learn Level ${dl.currentLevel} error:`, error);
            dl.phase = 'between_levels'; // Allow retry
            this.state.status = 'ready';
            this.render();
            App.showToast(`Level ${dl.currentLevel} failed: ${error.message}`, 'error');
        }
    },

    /**
     * Haiku extraction: send items in parallel small groups for fast fact extraction.
     * Returns array of extraction objects.
     */
    async _batchExtract(items) {
        // Group items into small batches for Haiku (5-8 items each to stay within context)
        const HAIKU_BATCH = 5;
        const requests = [];

        for (let i = 0; i < items.length; i += HAIKU_BATCH) {
            const group = items.slice(i, i + HAIKU_BATCH);

            // Build text for this group
            let docText = '';
            let docMeta = '';

            group.forEach((item, idx) => {
                const d = item.data;
                if (item.type === 'note') {
                    let content = '';
                    // Format 1: sections field (dict or array)
                    if (d.sections && typeof d.sections === 'object') {
                        if (Array.isArray(d.sections)) {
                            content = d.sections.map(sec => `${sec.title || 'Section'}: ${sec.content || sec.text || ''}`).join('\n');
                        } else {
                            content = Object.entries(d.sections).map(([key, val]) => {
                                const label = key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()).trim();
                                if (typeof val === 'string') return `${label}: ${val}`;
                                if (Array.isArray(val)) return `${label}: ${val.map(v => typeof v === 'string' ? v : JSON.stringify(v)).join('; ')}`;
                                if (typeof val === 'object' && val !== null) {
                                    return `${label}: ${Object.entries(val).map(([k,v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join('; ')}`;
                                }
                                return '';
                            }).filter(Boolean).join('\n');
                        }
                    }
                    // Format 2: clinical fields directly on the note object
                    if (!content) {
                        const clinicalFields = ['chiefComplaint', 'hpi', 'historyOfPresentIllness', 'reviewOfSystems',
                            'vitals', 'physicalExam', 'assessment', 'plan', 'impression', 'recommendations',
                            'hospitalCourse', 'dischargeMedications', 'dischargeInstructions', 'followUp'];
                        const found = clinicalFields.filter(f => d[f]).map(f => {
                            const label = f.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()).trim();
                            const val = d[f];
                            if (typeof val === 'string') return `${label}: ${val}`;
                            if (Array.isArray(val)) return `${label}: ${val.map(v => typeof v === 'string' ? v : JSON.stringify(v)).join('; ')}`;
                            if (typeof val === 'object') return `${label}: ${Object.entries(val).map(([k,v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join('; ')}`;
                            return '';
                        });
                        if (found.length > 0) content = found.join('\n');
                    }
                    // Format 3: flat content string
                    if (!content) content = d.content || d.text || d.body || d.preview || '';
                    const truncated = content.length > 6000 ? content.substring(0, 6000) + '\n...[truncated]' : content;
                    docMeta += `Doc ${idx + 1}: ${item.meta.noteType || 'Note'} | ${item.meta.date || ''} | ${item.meta.author || ''}\n`;
                    docText += `\n--- DOCUMENT: ${item.id} (${item.meta.noteType}) ---\n${truncated}\n`;
                } else if (item.type === 'lab') {
                    const results = (d.results || []).map(r => {
                        const flag = r.flag ? ` [${r.flag}]` : '';
                        return `${r.name || r.test}: ${r.value} ${r.unit || ''}${flag}`;
                    }).join('; ');
                    docMeta += `Doc ${idx + 1}: Lab Panel "${d.name || item.meta.name}" | ${d.collectedDate || item.meta.date || ''}\n`;
                    docText += `\n--- LAB PANEL: ${item.id} (${d.name || item.meta.name}) ---\n${results}\n`;
                } else if (item.type === 'imaging') {
                    let report = '';
                    if (d.findings && typeof d.findings === 'object') {
                        report += 'Findings: ' + Object.entries(d.findings).map(([k,v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join('; ') + '\n';
                    } else if (d.findings) {
                        report += 'Findings: ' + d.findings + '\n';
                    }
                    if (Array.isArray(d.impression)) {
                        report += 'Impression: ' + d.impression.join('; ');
                    } else if (d.impression) {
                        report += 'Impression: ' + d.impression;
                    }
                    if (!report) report = d.report || d.text || '';
                    docMeta += `Doc ${idx + 1}: ${item.meta.modality || 'Imaging'} "${item.meta.description || ''}" | ${item.meta.date || ''}\n`;
                    docText += `\n--- IMAGING: ${item.id} (${item.meta.description}) ---\n${report}\n`;
                }
            });

            const prompt = this.contextAssembler.buildHaikuExtractionPrompt(docText, docMeta);
            requests.push({
                systemPrompt: prompt.systemPrompt,
                userMessage: prompt.userMessage,
                model: this.analysisModel,
                maxTokens: prompt.maxTokens
            });
        }

        console.log(`🧠 Haiku extraction: ${requests.length} parallel requests for ${items.length} items`);

        // Run all Haiku calls in parallel (max 5 concurrent)
        const results = await ClaudeAPI.parallelChat(requests, 5, (done, total) => {
            // Update progress during extraction
            const pct = Math.round((done / total) * 100);
            console.log(`🧠 Haiku extraction: ${done}/${total} batches (${pct}%)`);
        });

        // Parse extraction results
        const allExtractions = [];
        results.forEach((r, idx) => {
            if (r.success) {
                try {
                    const parsed = this._parseJSONResponse(r.result);
                    if (parsed && parsed.documents) {
                        allExtractions.push(...parsed.documents);
                    } else if (parsed) {
                        allExtractions.push(parsed);
                    }
                } catch (e) {
                    console.warn(`Haiku extraction batch ${idx} parse failed`);
                }
            }
        });

        console.log(`🧠 Haiku extraction complete: ${allExtractions.length} document extractions`);
        this._deepLearn.extractedFacts.push(...allExtractions);
        return allExtractions;
    },

    /**
     * Sonnet synthesis: merge Haiku extractions into existing memory document.
     * Returns the updated memory document.
     */
    async _synthesizeBatch(currentMemory, extractions) {
        console.log(`🧠 Sonnet synthesis: Merging ${extractions.length} extractions into memory...`);

        const prompt = this.contextAssembler.buildSynthesisPrompt(
            currentMemory,
            extractions,
            this._deepLearn.processedCount,
            this._deepLearn.totalItems
        );

        const response = await this.callLLM(
            prompt.systemPrompt,
            prompt.userMessage,
            prompt.maxTokens,
            { model: this.dictationModel }
        );

        const updatedMemory = this._parseJSONResponse(response);
        if (!updatedMemory) {
            throw new Error('Could not parse updated memory from synthesis response');
        }

        // Ensure all required fields exist — carry forward from current if missing
        if (!updatedMemory.clinicalGestalt) updatedMemory.clinicalGestalt = currentMemory.clinicalGestalt || '';
        if (!updatedMemory.patientOverview) updatedMemory.patientOverview = currentMemory.patientOverview || updatedMemory.clinicalGestalt || '';
        if (!updatedMemory.safetyProfile || typeof updatedMemory.safetyProfile !== 'object') updatedMemory.safetyProfile = currentMemory.safetyProfile || { allergies: [], contraindications: [], criticalValues: [], renalDosing: [] };
        if (!Array.isArray(updatedMemory.problemAnalysis)) updatedMemory.problemAnalysis = currentMemory.problemAnalysis || [];
        if (!Array.isArray(updatedMemory.medicationRationale)) updatedMemory.medicationRationale = currentMemory.medicationRationale || [];
        if (!updatedMemory.labTrends || !updatedMemory.labTrends.key_values) updatedMemory.labTrends = currentMemory.labTrends || { key_values: [] };
        if (!Array.isArray(updatedMemory.pendingItems)) updatedMemory.pendingItems = currentMemory.pendingItems || [];

        const fieldCount = [
            updatedMemory.problemAnalysis.length > 0 ? 1 : 0,
            updatedMemory.medicationRationale.length > 0 ? 1 : 0,
            updatedMemory.labTrends.key_values.length > 0 ? 1 : 0,
        ].reduce((a, b) => a + b, 0);
        console.log(`🧠 Synthesis result: ${updatedMemory.problemAnalysis.length} problems, ${updatedMemory.medicationRationale.length} meds, ${updatedMemory.labTrends.key_values.length} lab trends (${fieldCount}/3 data fields populated)`);

        return updatedMemory;
    },

    /**
     * Apply a memory document to the longitudinal doc and panel state.
     * Shared by Level 1 and Level 2+ synthesis.
     */
    /**
     * Compute what changed between two memory documents for level-diff visualization.
     * Returns sets of new/changed items keyed by section.
     */
    _computeMemoryLevelDiff(prevDoc, newDoc, level) {
        const diff = {
            level,
            overviewChanged: false,
            newProblems: [],      // indices of new problems
            changedProblems: [],  // indices of problems with changed content
            newMeds: [],          // indices of new medications
            newLabTrends: [],     // indices of new lab trends
            newSafetyItems: [],   // new safety items (allergies, contraindications, etc.)
            newPendingItems: [],  // new pending items
            gestaltChanged: false
        };

        if (!prevDoc) {
            // Everything is new (Level 1)
            diff.overviewChanged = true;
            diff.gestaltChanged = true;
            if (newDoc.problemAnalysis) diff.newProblems = newDoc.problemAnalysis.map((_, i) => i);
            if (newDoc.medicationRationale) diff.newMeds = newDoc.medicationRationale.map((_, i) => i);
            if (newDoc.labTrends?.key_values) diff.newLabTrends = newDoc.labTrends.key_values.map((_, i) => i);
            if (newDoc.pendingItems) diff.newPendingItems = newDoc.pendingItems.map((_, i) => i);
            return diff;
        }

        // Overview changed?
        if ((newDoc.patientOverview || '') !== (prevDoc.patientOverview || '')) {
            diff.overviewChanged = true;
        }
        // Gestalt changed?
        if ((newDoc.clinicalGestalt || '') !== (prevDoc.clinicalGestalt || '')) {
            diff.gestaltChanged = true;
        }

        // Problem analysis diff
        const prevProblems = (prevDoc.problemAnalysis || []).map(p => p.problem);
        (newDoc.problemAnalysis || []).forEach((p, i) => {
            const prevIdx = prevProblems.indexOf(p.problem);
            if (prevIdx === -1) {
                diff.newProblems.push(i);
            } else {
                const prev = prevDoc.problemAnalysis[prevIdx];
                if (JSON.stringify(prev) !== JSON.stringify(p)) {
                    diff.changedProblems.push(i);
                }
            }
        });

        // Medication diff
        const prevMeds = (prevDoc.medicationRationale || []).map(m => m.name);
        (newDoc.medicationRationale || []).forEach((m, i) => {
            if (!prevMeds.includes(m.name)) diff.newMeds.push(i);
        });

        // Lab trends diff
        const prevLabs = (prevDoc.labTrends?.key_values || []).map(l => l.test);
        (newDoc.labTrends?.key_values || []).forEach((l, i) => {
            if (!prevLabs.includes(l.test)) diff.newLabTrends.push(i);
        });

        // Pending items diff
        const prevPending = new Set(prevDoc.pendingItems || []);
        (newDoc.pendingItems || []).forEach((item, i) => {
            if (!prevPending.has(item)) diff.newPendingItems.push(i);
        });

        return diff;
    },

    _applyMemoryDocument(memoryDoc) {
        const currentLevel = this._deepLearn.currentLevel || 1;
        const prevDoc = this.longitudinalDoc.aiMemory.memoryDocument;

        // Compute diff: what's new or changed at this level
        const levelDiff = this._computeMemoryLevelDiff(prevDoc, memoryDoc, currentLevel);

        // Store level history for the viewer
        if (!this.longitudinalDoc.aiMemory._levelHistory) {
            this.longitudinalDoc.aiMemory._levelHistory = [];
        }
        this.longitudinalDoc.aiMemory._levelHistory.push({
            level: currentLevel,
            timestamp: new Date().toISOString(),
            diff: levelDiff
        });

        // Tag the memory doc with level source info
        memoryDoc._levelMeta = memoryDoc._levelMeta || {};
        memoryDoc._levelMeta.lastLevel = currentLevel;
        memoryDoc._levelMeta.levelDiffs = this.longitudinalDoc.aiMemory._levelHistory;

        // Store in longitudinal doc's aiMemory
        this.longitudinalDoc.aiMemory.memoryDocument = memoryDoc;
        this.longitudinalDoc.aiMemory.lastLearnedAt = new Date().toISOString();
        this.longitudinalDoc.aiMemory.lastRefreshedAt = new Date().toISOString();

        // Backward compat
        this.longitudinalDoc.aiMemory.patientSummary = memoryDoc.patientOverview;

        // Update panel state from memory
        if (memoryDoc.clinicalGestalt) {
            this.state.aiOneLiner = memoryDoc.clinicalGestalt;
        }
        if (memoryDoc.patientOverview) {
            this.state.summary = memoryDoc.patientOverview;
        }

        // Extract safety flags
        if (memoryDoc.safetyProfile) {
            const flags = [];
            if (memoryDoc.safetyProfile.criticalValues) {
                memoryDoc.safetyProfile.criticalValues.forEach(cv => {
                    flags.push({ text: cv, severity: 'critical' });
                });
            }
            if (memoryDoc.safetyProfile.contraindications) {
                memoryDoc.safetyProfile.contraindications.forEach(ci => {
                    flags.push({ text: ci, severity: 'important' });
                });
            }
            if (flags.length > 0) {
                this.state.keyConsiderations = flags;
            }
        }

        // Build problem list
        if (memoryDoc.problemAnalysis && Array.isArray(memoryDoc.problemAnalysis)) {
            this.state.problemList = memoryDoc.problemAnalysis.map(p => ({
                name: p.problem,
                urgency: p.status === 'acute' ? 'urgent' : (p.status === 'active' ? 'active' : 'monitoring'),
                ddx: null,
                plan: p.plan || ''
            }));
        }

        // Build pending items as suggested actions
        if (memoryDoc.pendingItems && Array.isArray(memoryDoc.pendingItems)) {
            this.state.suggestedActions = memoryDoc.pendingItems.map((item, idx) => ({
                id: 'learn_pending_' + idx,
                text: item
            }));
        }

        this.state.lastUpdated = new Date().toISOString();

        // Auto-refresh the memory viewer if it's open
        if (this._memoryViewerOpen) {
            this.renderMemoryViewer();
        }
    },

    /**
     * Save deep learn state to localStorage for resume on reload.
     */
    _saveDeepLearnState() {
        try {
            const pid = this.longitudinalDoc?.metadata?.patientId || 'PAT001';
            const state = {
                phase: this._deepLearn.phase,
                processedCount: this._deepLearn.processedCount,
                totalItems: this._deepLearn.totalItems,
                currentLevel: this._deepLearn.currentLevel,
                totalLevels: this._deepLearn.totalLevels,
                processedIds: Array.from(this._deepLearn.processed),
                levelBatchSizes: (this._deepLearn.levelBatches || []).map(b => b.length),
            };
            localStorage.setItem(`deepLearn_${pid}`, JSON.stringify(state));
        } catch (e) {
            console.warn('Failed to save deep learn state:', e.message);
        }
    },

    /**
     * Load deep learn state from localStorage.
     */
    _loadDeepLearnState() {
        try {
            const pid = this.longitudinalDoc?.metadata?.patientId || 'PAT001';
            const saved = localStorage.getItem(`deepLearn_${pid}`);
            if (!saved) return false;

            const state = JSON.parse(saved);
            if (state.phase === 'idle') return false;

            this._deepLearn.phase = state.phase;
            this._deepLearn.processedCount = state.processedCount || 0;
            this._deepLearn.totalItems = state.totalItems || 0;
            this._deepLearn.currentLevel = state.currentLevel || 0;
            this._deepLearn.totalLevels = state.totalLevels || 0;
            this._deepLearn.processed = new Set(state.processedIds || []);
            this._deepLearn._savedBatchSizes = state.levelBatchSizes || [];

            console.log(`🧠 Restored deep learn state: Level ${state.currentLevel}, ${state.processedCount}/${state.totalItems} items, phase: ${state.phase}`);
            return true;
        } catch (e) {
            console.warn('Failed to load deep learn state:', e);
            return false;
        }
    },

    /**
     * Get deep learn progress info for UI rendering.
     */
    _getDeepLearnProgress() {
        const dl = this._deepLearn;
        const pct = dl.totalItems > 0 ? Math.round((dl.processedCount / dl.totalItems) * 100) : 0;
        const remaining = dl.totalItems - dl.processedCount;
        const remainingLevels = Math.max(0, dl.totalLevels - dl.currentLevel);
        const map = dl.chartMap || { notes: [], labs: [], imaging: [] };

        // Compute per-level batch sizes for segmented progress bar
        const batchSizes = (dl.levelBatches && dl.levelBatches.length > 0)
            ? dl.levelBatches.map(b => b.length)
            : (dl._savedBatchSizes || []);

        return {
            phase: dl.phase,
            currentLevel: dl.currentLevel,
            totalLevels: dl.totalLevels,
            processedCount: dl.processedCount,
            totalItems: dl.totalItems,
            percentComplete: pct,
            remaining,
            remainingLevels,
            batchSizes,
            noteCount: map.notes.length,
            labCount: map.labs.length,
            imagingCount: map.imaging.length,
            isActive: dl.phase === 'level1' || dl.phase === 'level2+' || dl.phase === 'mapping',
            isComplete: dl.phase === 'complete',
            canAdvance: dl.phase === 'between_levels' && remainingLevels > 0
        };
    },

    // ==================== Learn / Refresh / Interact / Order Pipeline ====================

    /**
     * Digest accumulated dictation into the memory document.
     * Gathers undigested dictation since lastDigestedAt, sends to Haiku
     * to parse into encounterNarrative and update problems/gestalt.
     * Triggered by voice command "update thinking".
     */
    async digestDictation() {
        if (!this.contextAssembler || !this.longitudinalDoc) {
            App.showToast('Load a patient first', 'warning');
            return;
        }
        if (this._backendReady) await this._backendReady;
        if (!this.isApiConfigured()) {
            App.showToast('Configure API key first', 'warning');
            return;
        }

        const mem = this.longitudinalDoc.aiMemory;
        const session = this.longitudinalDoc.sessionContext;
        const lastDigested = mem.lastDigestedAt ? new Date(mem.lastDigestedAt) : null;

        // Gather undigested dictation from both doctor and patient
        const filterSince = (arr) => (arr || []).filter(d => {
            if (!lastDigested) return true;
            return new Date(d.timestamp) > lastDigested;
        });

        const undigestedDoctor = filterSince(session.doctorDictation);
        const undigestedPatient = filterSince(session.patientDictation);

        if (undigestedDoctor.length === 0 && undigestedPatient.length === 0) {
            App.showToast('No new dictation to digest', 'info');
            return;
        }

        // Build combined dictation text with speaker labels
        // Merge and sort by timestamp, then format with speaker tags
        const allEntries = [
            ...undigestedDoctor.map(d => ({ ...d, speaker: 'Doctor' })),
            ...undigestedPatient.map(d => ({ ...d, speaker: 'Patient' }))
        ].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

        const dictationText = allEntries.map(d => `[${d.speaker}]: ${d.text}`).join('\n');
        console.log(`🧠 Digesting ${allEntries.length} entries (${undigestedDoctor.length} doctor, ${undigestedPatient.length} patient, ${dictationText.length} chars)`);

        // Ensure memoryDocument exists (even if Learn hasn't been run)
        if (!mem.memoryDocument) {
            mem.memoryDocument = {
                patientOverview: mem.patientSummary || '',
                problemAnalysis: [],
                safetyProfile: {},
                medicationRationale: [],
                pendingItems: [],
                clinicalGestalt: this.state.aiOneLiner || '',
                encounterNarrative: {
                    hpiComponents: [],
                    examFindings: [],
                    clinicalReasoning: [],
                    patientReported: [],
                    assessmentPlan: ''
                }
            };
        }

        // Ensure encounterNarrative exists on existing memoryDocument
        if (!mem.memoryDocument.encounterNarrative) {
            mem.memoryDocument.encounterNarrative = {
                hpiComponents: [],
                examFindings: [],
                clinicalReasoning: [],
                patientReported: [],
                assessmentPlan: ''
            };
        }

        this.state.status = 'thinking';
        this.render();
        App.showToast('🧠 Digesting dictation...', 'info');

        try {
            const prompt = this.contextAssembler.buildDigestPrompt(dictationText, mem.memoryDocument);

            const response = await ClaudeAPI.sendMessage(
                [{ role: 'user', content: prompt.userMessage }],
                {
                    systemPrompt: prompt.systemPrompt,
                    maxTokens: prompt.maxTokens,
                    model: this.analysisModel
                }
            );

            const text = response.content[0].text.trim();
            const result = JSON.parse(text);

            // Merge encounterNarrative
            if (result.encounterNarrative) {
                const en = mem.memoryDocument.encounterNarrative;
                const rn = result.encounterNarrative;

                // Append arrays (deduplicate by text content)
                const appendUnique = (existing, incoming, key) => {
                    if (!incoming || !Array.isArray(incoming)) return;
                    for (const item of incoming) {
                        const itemText = typeof item === 'string' ? item : (item[key] || item.text || JSON.stringify(item));
                        const exists = existing.some(e => {
                            const eText = typeof e === 'string' ? e : (e[key] || e.text || JSON.stringify(e));
                            return eText === itemText;
                        });
                        if (!exists) existing.push(item);
                    }
                };

                appendUnique(en.hpiComponents, rn.hpiComponents, 'text');
                appendUnique(en.examFindings, rn.examFindings, 'finding');
                appendUnique(en.clinicalReasoning, rn.clinicalReasoning, null);
                appendUnique(en.patientReported, rn.patientReported, null);

                if (rn.assessmentPlan) en.assessmentPlan = rn.assessmentPlan;
            }

            // Apply problem updates
            if (result.problemUpdates && Array.isArray(result.problemUpdates)) {
                for (const update of result.problemUpdates) {
                    const existing = mem.memoryDocument.problemAnalysis.find(
                        p => p.problem.toLowerCase() === update.problem.toLowerCase()
                    );
                    if (existing) {
                        if (update.status) existing.status = update.status;
                        if (update.plan) existing.plan = update.plan;
                        if (update.newInfo) existing.newInfo = update.newInfo;
                    } else {
                        // New problem discovered from dictation
                        mem.memoryDocument.problemAnalysis.push({
                            problem: update.problem,
                            status: update.status || 'active',
                            plan: update.plan || '',
                            newInfo: update.newInfo || ''
                        });
                    }
                }
            }

            // Update gestalt
            if (result.updatedGestalt) {
                mem.memoryDocument.clinicalGestalt = result.updatedGestalt;
                this.state.aiOneLiner = result.updatedGestalt;
            }

            // === NEW: Full panel state update from digest ===

            // Updated problem list (complete replacement if provided)
            if (result.updatedProblemList && Array.isArray(result.updatedProblemList) && result.updatedProblemList.length > 0) {
                this.state.problemList = result.updatedProblemList;
                // Write back to memoryDocument for persistence
                mem.memoryDocument.problemAnalysis = result.updatedProblemList.map(p => ({
                    problem: p.name,
                    status: p.urgency === 'urgent' ? 'acute' : p.urgency,
                    plan: p.plan || '',
                    ddx: p.ddx || ''
                }));
            } else if (mem.memoryDocument.problemAnalysis.length > 0) {
                // Fallback: update panel from existing problemAnalysis
                this.state.problemList = mem.memoryDocument.problemAnalysis.map(p => ({
                    name: p.problem,
                    urgency: p.status === 'acute' ? 'urgent' : (p.status === 'active' ? 'active' : 'monitoring'),
                    ddx: p.ddx || null,
                    plan: p.plan || ''
                }));
            }

            // Suggested actions
            if (result.suggestedActions && Array.isArray(result.suggestedActions) && result.suggestedActions.length > 0) {
                this.state.suggestedActions = result.suggestedActions.map((a, i) =>
                    typeof a === 'string' ? { id: 'digest_' + Date.now() + '_' + i, text: a } : a
                );
                // Write back to memoryDocument
                mem.memoryDocument.pendingItems = result.suggestedActions.map(a =>
                    typeof a === 'string' ? a : a.text
                );
            }

            // Categorized actions (orderable items)
            if (result.categorizedActions && typeof result.categorizedActions === 'object') {
                this.state.categorizedActions = result.categorizedActions;
            }

            // Clinical summary
            if (result.updatedSummary && typeof result.updatedSummary === 'object') {
                this.state.clinicalSummary = result.updatedSummary;
            }

            // Key considerations / safety alerts
            if (result.keyConsiderations && Array.isArray(result.keyConsiderations) && result.keyConsiderations.length > 0) {
                this.state.keyConsiderations = result.keyConsiderations;
            }

            // === END new panel state update ===

            // Set timestamp
            mem.lastDigestedAt = new Date().toISOString();

            // Save and render
            this.saveLongitudinalDoc();
            this.state.status = 'ready';
            this.state.lastUpdated = new Date().toISOString();
            this.saveState();
            this.render();

            const narrative = mem.memoryDocument.encounterNarrative;
            console.log('🧠 Digest complete:', {
                hpiComponents: narrative.hpiComponents?.length || 0,
                examFindings: narrative.examFindings?.length || 0,
                reasoning: narrative.clinicalReasoning?.length || 0,
                patientReported: narrative.patientReported?.length || 0,
                problemUpdates: result.problemUpdates?.length || 0
            });

            App.showToast('Thinking updated with dictation', 'success');

            // Update glasses if open
            if (typeof SmartGlasses !== 'undefined' && SmartGlasses.isOpen) {
                SmartGlasses.refreshOrdersView();
            }

        } catch (error) {
            console.error('Digest dictation error:', error);
            this.state.status = 'ready';
            this.render();
            App.showToast(`Digest failed: ${error.message}`, 'error');
        }
    },

    /**
     * Check an order for safety concerns against the AI memory.
     * Uses Haiku for speed. Returns {safe, concerns[], suggestedAlternative?}
     */
    async checkOrderSafety(parsedOrder) {
        if (!this.contextAssembler || !this.longitudinalDoc?.aiMemory?.memoryDocument) {
            // No memory doc — skip safety check, return safe
            return { safe: true, concerns: [], suggestedAlternative: null };
        }

        try {
            const memoryDoc = this.longitudinalDoc.aiMemory.memoryDocument;
            const prompt = this.contextAssembler.buildOrderSafetyPrompt(parsedOrder, memoryDoc);

            console.log(`⚕️ Safety check: ${parsedOrder.name || parsedOrder.text || 'order'}`);

            const response = await this.callLLM(
                prompt.systemPrompt,
                prompt.userMessage,
                prompt.maxTokens,
                { model: this.analysisModel }
            );

            const result = this._parseJSONResponse(response);
            if (!result) {
                console.warn('Could not parse safety check response');
                return { safe: true, concerns: [], suggestedAlternative: null };
            }

            if (result.concerns && result.concerns.length > 0) {
                console.log(`⚠️ Safety concerns found:`, result.concerns);
            } else {
                console.log(`✅ Order safe: ${parsedOrder.name || parsedOrder.text || 'order'}`);
            }

            return {
                safe: result.safe !== false,
                concerns: result.concerns || [],
                suggestedAlternative: result.suggestedAlternative || null
            };

        } catch (error) {
            console.error('Safety check error:', error);
            // On error, don't block the order — return safe with a note
            return { safe: true, concerns: [], suggestedAlternative: null };
        }
    },

    /**
     * Record an executed order in AI memory.
     * Updates memoryDocument in-memory and persists.
     */
    recordExecutedOrder(order) {
        if (!this.longitudinalDoc) return;

        // Add to executedActions
        if (!this.longitudinalDoc.aiMemory.executedActions) {
            this.longitudinalDoc.aiMemory.executedActions = [];
        }
        this.longitudinalDoc.aiMemory.executedActions.push({
            text: order.text || order.name || 'Unknown order',
            timestamp: new Date().toISOString(),
            details: order
        });

        // Update memoryDocument in-memory if it exists
        const memDoc = this.longitudinalDoc.aiMemory.memoryDocument;
        if (memDoc) {
            // Add new medication to medicationRationale if it's a med order
            if (order.orderType === 'medication' && order.orderData) {
                if (!memDoc.medicationRationale) memDoc.medicationRationale = [];
                memDoc.medicationRationale.push({
                    name: `${order.orderData.name} ${order.orderData.dose || ''} ${order.orderData.route || ''} ${order.orderData.frequency || ''}`.trim(),
                    indication: order.orderData.indication || 'As ordered',
                    rationale: 'Ordered during this encounter'
                });
            }

            // Remove from pendingItems if this resolves something
            if (memDoc.pendingItems && Array.isArray(memDoc.pendingItems)) {
                const orderText = (order.text || order.name || '').toLowerCase();
                memDoc.pendingItems = memDoc.pendingItems.filter(item =>
                    !orderText.includes(item.toLowerCase().split(' ')[0])
                );
            }
        }

        this.saveLongitudinalDoc();
        console.log(`📋 Recorded executed order: ${order.text || order.name}`);
    },

    /**
     * Get the current memory document status for UI rendering.
     */
    getMemoryStatus() {
        if (!this.longitudinalDoc) return { hasMemory: false };
        const mem = this.longitudinalDoc.aiMemory;
        return {
            hasMemory: !!mem.memoryDocument,
            lastLearnedAt: mem.lastLearnedAt,
            lastRefreshedAt: mem.lastRefreshedAt,
            problemCount: mem.memoryDocument?.problemAnalysis?.length || 0,
            medCount: mem.memoryDocument?.medicationRationale?.length || 0
        };
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
