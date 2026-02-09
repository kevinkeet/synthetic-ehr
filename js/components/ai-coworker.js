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
        this.createPanel();
        this.loadState();
        this.setupEventListeners();
        this.startPolling();

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

        // Listen for storage changes (cross-tab/external updates)
        window.addEventListener('storage', (event) => {
            if (event.key === 'aiAssistantState') {
                this.loadState();
                this.render();
            }
        });

        console.log('AI Assistant initialized');
    },

    /**
     * Create the panel HTML
     */
    createPanel() {
        const panel = document.createElement('div');
        panel.id = 'ai-assistant-panel';
        panel.className = 'ai-assistant-panel';
        panel.innerHTML = `
            <div class="ai-assistant-header">
                <div class="ai-assistant-title">
                    <span class="ai-assistant-icon">✨</span>
                    <span class="ai-assistant-name">AI Assistant</span>
                    <span class="ai-assistant-status" id="ai-assistant-status">●</span>
                </div>
                <div class="ai-assistant-actions">
                    <button class="ai-assistant-btn" onclick="AICoworker.toggleMinimize()" title="Minimize" id="ai-assistant-minimize">−</button>
                    <button class="ai-assistant-btn" onclick="AICoworker.toggle()" title="Close">×</button>
                </div>
            </div>
            <div class="ai-assistant-body" id="ai-assistant-body">
                <div class="ai-assistant-loading">
                    <div class="ai-assistant-spinner"></div>
                    <span>Ready to assist...</span>
                </div>
            </div>
            <div class="ai-assistant-footer" id="ai-assistant-footer">
                <button class="ai-assistant-refresh-btn" onclick="AICoworker.refreshThinking()" title="Refresh AI thinking">
                    🔄
                </button>
                <button class="ai-assistant-dictate-btn" onclick="AICoworker.openDictationModal()" title="Dictate your thoughts">
                    🎤 Dictate
                </button>
                <button class="ai-assistant-note-btn" onclick="AICoworker.openNoteModal()" title="Write a note">
                    📝 Write Note
                </button>
                <button class="ai-assistant-ask-btn" onclick="AICoworker.openAskModal()" title="Ask AI for help">
                    💬 Ask
                </button>
            </div>
        `;

        document.body.appendChild(panel);

        // Create the toggle button
        const toggleBtn = document.createElement('button');
        toggleBtn.id = 'ai-assistant-toggle';
        toggleBtn.className = 'ai-assistant-toggle';
        toggleBtn.innerHTML = '✨';
        toggleBtn.title = 'AI Assistant';
        toggleBtn.onclick = () => this.toggle();
        document.body.appendChild(toggleBtn);

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
        }

        // Listen for keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closeAskModal();
                this.closeAddTask();
                this.closeDictationModal();
                this.closeNoteModal();
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
     * Start polling for external updates
     */
    startPolling() {
        this.updateInterval = setInterval(() => {
            this.checkForUpdates();
        }, 2000);
    },

    /**
     * Check for updates from external sources
     */
    async checkForUpdates() {
        // Check localStorage for updates
        const stored = localStorage.getItem('aiAssistantState');
        if (stored) {
            try {
                const parsed = JSON.parse(stored);
                if (parsed.lastUpdated !== this.state.lastUpdated) {
                    this.state = { ...this.state, ...parsed };
                    this.render();
                }
            } catch (e) {
                console.warn('Error parsing AI Assistant state:', e);
            }
        }

        // Also try to fetch from JSON file
        try {
            const response = await fetch('data/ai-assistant-state.json?t=' + Date.now(), {
                method: 'GET',
                cache: 'no-store'
            });
            if (response.ok) {
                const data = await response.json();
                if (data.lastUpdated && data.lastUpdated !== this.state.lastUpdated) {
                    this.state = { ...this.state, ...data };
                    this.saveState();
                    this.render();
                }
            }
        } catch (e) {
            // File doesn't exist yet, that's ok
        }
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
     * Load state from localStorage
     */
    loadState() {
        const stored = localStorage.getItem('aiAssistantState');
        if (stored) {
            try {
                this.state = { ...this.state, ...JSON.parse(stored) };
            } catch (e) {
                console.warn('Error loading AI Assistant state:', e);
            }
        }
        this.render();
    },

    /**
     * Save state to localStorage
     */
    saveState() {
        this.state.lastUpdated = new Date().toISOString();
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

        // Flash to indicate update
        const panel = document.getElementById('ai-assistant-panel');
        if (panel) {
            panel.classList.add('updated');
            setTimeout(() => panel.classList.remove('updated'), 1000);
        }
    },

    /**
     * Render the panel content
     */
    render() {
        const body = document.getElementById('ai-assistant-body');
        const statusEl = document.getElementById('ai-assistant-status');

        if (!body) return;

        // Update status indicator
        if (statusEl) {
            statusEl.className = 'ai-assistant-status ' + (this.state.status || 'ready');
        }

        let html = '';

        // Safety Flags (always show first if present) - these are critical
        if (this.state.flags && this.state.flags.length > 0) {
            html += '<div class="ai-section flags-section">';
            html += '<div class="ai-section-header"><span class="icon">⚠️</span> Safety Flags</div>';
            html += '<div class="ai-flags-list">';
            this.state.flags.forEach((flag, index) => {
                html += '<div class="ai-flag ' + (flag.severity || 'warning') + '">';
                html += '<span class="flag-text">' + this.escapeHtml(flag.text) + '</span>';
                html += '<button class="flag-dismiss" onclick="AICoworker.dismissFlag(' + index + ')" title="Acknowledge">✓</button>';
                html += '</div>';
            });
            html += '</div>';
            html += '</div>';
        }

        // Doctor's Dictation (their thoughts - prominent position)
        if (this.state.dictation) {
            html += '<div class="ai-section dictation-section">';
            html += '<div class="ai-section-header">';
            html += '<span class="icon">🎤</span> Your Thoughts';
            html += '<button class="section-edit-btn" onclick="AICoworker.openDictationModal()" title="Edit">✏️</button>';
            html += '</div>';
            html += '<div class="ai-dictation">' + this.formatText(this.state.dictation) + '</div>';
            if (this.state.dictationHistory && this.state.dictationHistory.length > 0) {
                html += '<div class="dictation-meta">' + this.state.dictationHistory.length + ' previous thought(s)</div>';
            }
            html += '</div>';
        }

        // AI Summary (how the AI understands the case)
        if (this.state.summary) {
            html += '<div class="ai-section summary-section">';
            html += '<div class="ai-section-header"><span class="icon">📋</span> Case Summary</div>';
            html += '<div class="ai-summary">' + this.formatText(this.state.summary) + '</div>';
            html += '</div>';
        }

        // AI Thinking (current reasoning)
        if (this.state.thinking) {
            html += '<div class="ai-section thinking-section">';
            html += '<div class="ai-section-header"><span class="icon">💭</span> Current Thinking</div>';
            html += '<div class="ai-thinking">' + this.formatText(this.state.thinking) + '</div>';
            html += '</div>';
        }

        // Suggested Actions (AI recommendations user can execute)
        if (this.state.suggestedActions && this.state.suggestedActions.length > 0) {
            html += '<div class="ai-section actions-section">';
            html += '<div class="ai-section-header"><span class="icon">💡</span> Suggested Actions</div>';
            html += '<div class="ai-actions-list">';
            this.state.suggestedActions.forEach((action, index) => {
                const actionText = typeof action === 'string' ? action : action.text;
                const actionId = typeof action === 'object' && action.id ? action.id : index;
                html += '<div class="ai-suggested-action">';
                html += '<span class="action-text">' + this.escapeHtml(actionText) + '</span>';
                html += '<div class="action-buttons">';
                html += '<button class="action-do-btn" onclick="AICoworker.executeAction(' + index + ')" title="Ask Claude to do this">▶ Do it</button>';
                html += '<button class="action-dismiss-btn" onclick="AICoworker.dismissAction(' + index + ')" title="Dismiss">×</button>';
                html += '</div>';
                html += '</div>';
            });
            html += '</div>';
            html += '</div>';
        }

        // Context / Current Focus (what the AI is tracking)
        if (this.state.context) {
            html += '<div class="ai-section context-section">';
            html += '<div class="ai-section-header"><span class="icon">🎯</span> Tracking</div>';
            html += '<div class="ai-context">' + this.formatText(this.state.context) + '</div>';
            html += '</div>';
        }

        // What You've Reviewed (mirroring back)
        if (this.state.reviewed && this.state.reviewed.length > 0) {
            html += '<div class="ai-section reviewed-section">';
            html += '<div class="ai-section-header"><span class="icon">✓</span> Reviewed</div>';
            html += '<div class="ai-reviewed-list">';
            this.state.reviewed.forEach(item => {
                html += '<div class="ai-reviewed-item">' + this.escapeHtml(item) + '</div>';
            });
            html += '</div>';
            html += '</div>';
        }

        // Observations (neutral facts, not recommendations)
        if (this.state.observations && this.state.observations.length > 0) {
            html += '<div class="ai-section observations-section">';
            html += '<div class="ai-section-header"><span class="icon">👁</span> Observations</div>';
            html += '<div class="ai-observations-list">';
            this.state.observations.forEach((obs, index) => {
                html += '<div class="ai-observation">';
                html += '<span class="obs-text">' + this.escapeHtml(obs) + '</span>';
                html += '<button class="obs-dismiss" onclick="AICoworker.dismissObservation(' + index + ')" title="Dismiss">×</button>';
                html += '</div>';
            });
            html += '</div>';
            html += '</div>';
        }

        // Open Items (what hasn't been addressed - neutral tracking)
        if (this.state.openItems && this.state.openItems.length > 0) {
            html += '<div class="ai-section open-section">';
            html += '<div class="ai-section-header"><span class="icon">○</span> Not Yet Addressed</div>';
            html += '<div class="ai-open-list">';
            this.state.openItems.forEach((item, index) => {
                html += '<div class="ai-open-item">';
                html += '<span class="open-text">' + this.escapeHtml(item) + '</span>';
                html += '<div class="open-actions">';
                html += '<button class="ask-claude-btn" onclick="AICoworker.askClaudeAbout(\'' + this.escapeHtml(item).replace(/'/g, "\\'") + '\')" title="Ask Claude to help">🤖</button>';
                html += '<button class="open-done" onclick="AICoworker.markAddressed(' + index + ')" title="Mark as addressed">✓</button>';
                html += '</div>';
                html += '</div>';
            });
            html += '</div>';
            html += '</div>';
        }

        // Doctor's Task List (their own tasks)
        if (this.state.tasks && this.state.tasks.length > 0) {
            html += '<div class="ai-section tasks-section">';
            html += '<div class="ai-section-header"><span class="icon">☐</span> Your Tasks</div>';
            html += '<div class="ai-tasks-list">';
            this.state.tasks.forEach((task, index) => {
                const isDone = task.done;
                html += '<div class="ai-task ' + (isDone ? 'done' : '') + '">';
                html += '<input type="checkbox" ' + (isDone ? 'checked' : '') + ' onchange="AICoworker.toggleTask(' + index + ')">';
                html += '<span class="task-text">' + this.escapeHtml(task.text) + '</span>';
                html += '<div class="task-actions">';
                if (!isDone) {
                    html += '<button class="ask-claude-btn" onclick="AICoworker.askClaudeAbout(\'' + this.escapeHtml(task.text).replace(/'/g, "\\'") + '\')" title="Ask Claude to help">🤖</button>';
                }
                html += '<button class="task-remove" onclick="AICoworker.removeTask(' + index + ')" title="Remove">×</button>';
                html += '</div>';
                html += '</div>';
            });
            html += '</div>';
            html += '</div>';
        }

        // AI Response (when doctor asks for help)
        if (this.state.aiResponse) {
            html += '<div class="ai-section response-section">';
            html += '<div class="ai-section-header"><span class="icon">💬</span> AI Response</div>';
            html += '<div class="ai-response">' + this.formatText(this.state.aiResponse) + '</div>';
            html += '<button class="ai-clear-response" onclick="AICoworker.clearResponse()">Clear</button>';
            html += '</div>';
        }

        // Empty state
        if (!html) {
            html = '<div class="ai-empty">';
            html += '<div class="empty-icon">✨</div>';
            html += '<div class="empty-text">Ready to assist</div>';
            html += '<div class="empty-hint">I\'ll track what you\'ve reviewed and flag any safety concerns. Click "Ask AI" if you need help.</div>';
            html += '<button class="btn btn-sm" onclick="AICoworker.loadDemo()">Load Demo</button>';
            html += '</div>';
        }

        body.innerHTML = html;
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
                input.value = this.state.dictation || '';
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
        // Show thinking status
        this.state.status = 'thinking';
        this.render();

        // Build prompt for Claude to synthesize thinking
        const synthesisPrompt = this.buildThinkingSynthesisPrompt(text);

        // Try to get Claude to update the thinking
        // Method 1: Use Claude extension if available
        this.requestThinkingUpdate(synthesisPrompt);

        // Method 2: Broadcast for external tools
        window.postMessage({
            type: 'DOCTOR_DICTATION_UPDATED',
            dictation: text,
            synthesisPrompt: synthesisPrompt,
            fullContext: this.buildFullContext()
        }, '*');

        // Method 3: For demo/offline - do a simple local synthesis
        // This provides immediate feedback even without Claude
        this.localThinkingSynthesis(text);
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

Based on the doctor's thoughts, provide UPDATED versions of all three:

1. **Summary** (1-2 sentences): Concise case summary reflecting the doctor's working diagnosis, triggers, and key decisions. Use **bold** for diagnosis and key decisions.

2. **Thinking** (2-4 sentences): Your synthesis of the doctor's clinical reasoning with the case data. Acknowledge their assessment, note supporting data, highlight any safety considerations. Use **bold** for key decisions. Write from AI perspective.

3. **Suggested Actions** (3-5 items): Prioritized next steps that ALIGN with the doctor's stated plan. Don't contradict their decisions - support them. Include follow-through items for plans they mentioned.

Format your response as JSON:
{
  "summary": "...",
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

        // Identify working diagnosis
        if (lowerThoughts.includes('chf') || lowerThoughts.includes('heart failure') || lowerThoughts.includes('volume overload') || lowerThoughts.includes('wet')) {
            workingDiagnosis = 'CHF exacerbation';
            newThinking += 'Doctor has confirmed **CHF exacerbation** as the working diagnosis. ';
        } else if (lowerThoughts.includes('sepsis') || lowerThoughts.includes('infection')) {
            workingDiagnosis = 'Sepsis/Infection';
            newThinking += 'Doctor is considering **infectious etiology**. ';
        } else if (lowerThoughts.includes('acs') || lowerThoughts.includes('mi') || lowerThoughts.includes('stemi') || lowerThoughts.includes('nstemi')) {
            workingDiagnosis = 'ACS';
            newThinking += 'Doctor is evaluating for **acute coronary syndrome**. ';
        } else if (lowerThoughts.includes('copd') || lowerThoughts.includes('asthma') || lowerThoughts.includes('bronch')) {
            workingDiagnosis = 'COPD/Asthma exacerbation';
            newThinking += 'Doctor is treating **respiratory exacerbation**. ';
        } else if (lowerThoughts.includes('pneumonia') || lowerThoughts.includes('pna')) {
            workingDiagnosis = 'Pneumonia';
            newThinking += 'Doctor suspects **pneumonia**. ';
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
        if (lowerThoughts.includes('arrhythmia') || lowerThoughts.includes('afib') || lowerThoughts.includes('a-fib') || lowerThoughts.includes('rvr')) {
            triggers.push('arrhythmia');
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

        // Add suggestions based on diagnosis
        if (workingDiagnosis === 'CHF exacerbation') {
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
        } else if (workingDiagnosis === 'ACS') {
            newSuggestions.push('Serial troponins q6h');
            newSuggestions.push('Cardiology consult for cath consideration');
            newSuggestions.push('Start antiplatelet therapy if not contraindicated');
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
    generateNote() {
        const noteType = document.querySelector('input[name="note-type"]:checked').value;
        const instructions = document.getElementById('note-instructions').value.trim();

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

        // Build the prompt for Claude
        const prompt = this.buildNotePrompt(noteType, includeSources, instructions);

        this.closeNoteModal();

        // Trigger Claude to generate the note
        this.askClaudeAbout(prompt);

        App.showToast('Generating ' + this.getNoteTypeName(noteType) + '...', 'info');
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
        const btn = document.querySelector('.ai-assistant-refresh-btn');
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

        // Local fallback for immediate feedback
        this.localRefreshAnalysis();
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

    // ==================== Claude Extension Integration ====================

    /**
     * Ask Claude browser extension to help with a specific item
     * This triggers the Claude in Chrome extension if installed
     */
    askClaudeAbout(item) {
        // Build context from current patient and state
        const patientContext = this.buildPatientContext();
        const prompt = 'Help me with this task for my patient:\n\nTask: ' + item + '\n\n' + patientContext;

        // Method 1: Try to trigger Claude in Chrome extension via postMessage
        // The extension listens for specific message types
        window.postMessage({
            type: 'CLAUDE_EXTENSION_PROMPT',
            prompt: prompt,
            context: {
                source: 'synthetic-ehr',
                task: item,
                patient: patientContext
            }
        }, '*');

        // Method 2: Try custom event that extensions might listen for
        const event = new CustomEvent('claude-assist-request', {
            detail: {
                prompt: prompt,
                task: item,
                context: patientContext
            }
        });
        document.dispatchEvent(event);

        // Method 3: Check if extension exposed a global function
        if (typeof window.askClaude === 'function') {
            window.askClaude(prompt);
            return;
        }

        // Method 4: Try to open Claude in a sidebar or popup if extension provides that
        if (typeof window.openClaudeSidebar === 'function') {
            window.openClaudeSidebar(prompt);
            return;
        }

        // Method 5: Copy to clipboard and show instructions
        this.copyToClipboardAndNotify(prompt, item);
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

    /**
     * Fallback: Copy prompt to clipboard and notify user
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

    toggle() {
        const panel = document.getElementById('ai-assistant-panel');
        const toggle = document.getElementById('ai-assistant-toggle');

        this.isVisible = !this.isVisible;

        if (panel) {
            panel.classList.toggle('visible', this.isVisible);
        }
        if (toggle) {
            toggle.classList.toggle('active', this.isVisible);
        }
    },

    show() {
        if (!this.isVisible) this.toggle();
    },

    toggleMinimize() {
        const panel = document.getElementById('ai-assistant-panel');
        const btn = document.getElementById('ai-assistant-minimize');

        this.isMinimized = !this.isMinimized;

        if (panel) {
            panel.classList.toggle('minimized', this.isMinimized);
        }
        if (btn) {
            btn.textContent = this.isMinimized ? '+' : '−';
        }
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
        this.state.observations.push(text);
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
