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
        context: ''
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
                <button class="ai-assistant-ask-btn" onclick="AICoworker.openAskModal()" title="Ask AI for help">
                    💬 Ask AI
                </button>
                <button class="ai-assistant-add-btn" onclick="AICoworker.openAddTask()" title="Add a task">
                    + Add Task
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
     * Setup event listeners
     */
    setupEventListeners() {
        // Listen to simulation events
        if (typeof SimulationEngine !== 'undefined') {
            SimulationEngine.on('nurseAlert', (data) => this.onAlert(data));
            SimulationEngine.on('patientAlert', (data) => this.onAlert(data));
        }

        // Listen for keyboard shortcut to add task
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closeAskModal();
                this.closeAddTask();
            }
        });
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
            summary: '72yo male with **DM2, CKD Stage 3, CHF (EF 32%)**, and **A.fib** presenting with acute dyspnea. Recent admission 3 weeks ago for CHF exacerbation. Currently appears volume overloaded.',
            thinking: 'This looks like another CHF exacerbation. Need to determine the trigger - could be dietary indiscretion, medication non-compliance, or new arrhythmia. **Important consideration:** Patient has recent GI bleed history which will affect anticoagulation decisions if A-fib is confirmed.',
            suggestedActions: [
                { id: 'action_1', text: 'Order BNP to assess current heart failure severity' },
                { id: 'action_2', text: 'Check creatinine before adjusting diuretics' },
                { id: 'action_3', text: 'Review the GI consult note about bleeding history' },
                { id: 'action_4', text: 'Start IV furosemide 40mg for acute diuresis' }
            ],
            flags: [
                { text: 'Recent GI bleed (5 months ago) - GI recommends avoiding anticoagulation', severity: 'critical' }
            ],
            reviewed: [
                'Medication list',
                'Recent vitals'
            ],
            observations: [
                'Last BNP was 890 pg/mL (3 weeks ago)',
                'Cr trending up: 1.4 → 1.6 over past week',
                'Patient reports missing doses of furosemide'
            ],
            openItems: [
                'Echocardiogram (last done 6 months ago)',
                'Code status discussion'
            ],
            tasks: []
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
