/**
 * AI Coworker Panel
 * A persistent panel showing Claude's thinking about the case
 * Can be updated externally via localStorage, postMessage, or file polling
 */

const AICoworker = {
    isVisible: false,
    isMinimized: false,
    updateInterval: null,
    lastUpdateTime: null,

    // Default state
    state: {
        status: 'thinking', // thinking, watching, ready, alert
        lastUpdated: null,
        caseSummary: '',
        currentThinking: '',
        nextSteps: [],
        todos: [],
        alerts: [],
        confidence: null,
        focusArea: ''
    },

    /**
     * Initialize the AI Coworker panel
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
            if (event.key === 'aiCoworkerState') {
                this.loadState();
                this.render();
            }
        });

        console.log('AI Coworker initialized');
    },

    /**
     * Create the panel HTML
     */
    createPanel() {
        const panel = document.createElement('div');
        panel.id = 'ai-coworker-panel';
        panel.className = 'ai-coworker-panel';
        panel.innerHTML = `
            <div class="ai-coworker-header">
                <div class="ai-coworker-title">
                    <span class="ai-coworker-icon">🤖</span>
                    <span class="ai-coworker-name">Claude Coworker</span>
                    <span class="ai-coworker-status" id="ai-coworker-status">●</span>
                </div>
                <div class="ai-coworker-actions">
                    <button class="ai-coworker-btn" onclick="AICoworker.refresh()" title="Refresh">↻</button>
                    <button class="ai-coworker-btn" onclick="AICoworker.toggleMinimize()" title="Minimize" id="ai-coworker-minimize">−</button>
                    <button class="ai-coworker-btn" onclick="AICoworker.toggle()" title="Close">×</button>
                </div>
            </div>
            <div class="ai-coworker-body" id="ai-coworker-body">
                <div class="ai-coworker-loading">
                    <div class="ai-coworker-spinner"></div>
                    <span>Connecting to Claude...</span>
                </div>
            </div>
            <div class="ai-coworker-footer" id="ai-coworker-footer">
                <span class="ai-coworker-update-time" id="ai-coworker-update-time">--</span>
                <button class="ai-coworker-edit-btn" onclick="AICoworker.openEditor()" title="Edit manually">✏️ Edit</button>
            </div>
        `;

        document.body.appendChild(panel);

        // Create the toggle button
        const toggleBtn = document.createElement('button');
        toggleBtn.id = 'ai-coworker-toggle';
        toggleBtn.className = 'ai-coworker-toggle';
        toggleBtn.innerHTML = '🤖';
        toggleBtn.title = 'AI Coworker';
        toggleBtn.onclick = () => this.toggle();
        document.body.appendChild(toggleBtn);

        // Create editor modal
        this.createEditorModal();
    },

    /**
     * Create the editor modal for manual updates
     */
    createEditorModal() {
        const modal = document.createElement('div');
        modal.id = 'ai-coworker-editor';
        modal.className = 'ai-coworker-editor-modal';
        modal.innerHTML = `
            <div class="ai-coworker-editor-content">
                <div class="ai-coworker-editor-header">
                    <h3>Edit AI Coworker State</h3>
                    <button onclick="AICoworker.closeEditor()">×</button>
                </div>
                <div class="ai-coworker-editor-body">
                    <div class="editor-section">
                        <label>Case Summary</label>
                        <textarea id="edit-case-summary" rows="3" placeholder="Brief summary of the case..."></textarea>
                    </div>
                    <div class="editor-section">
                        <label>Current Thinking</label>
                        <textarea id="edit-current-thinking" rows="4" placeholder="What Claude is currently considering..."></textarea>
                    </div>
                    <div class="editor-section">
                        <label>Next Steps (one per line)</label>
                        <textarea id="edit-next-steps" rows="3" placeholder="Review labs&#10;Check vitals trend&#10;Consider imaging"></textarea>
                    </div>
                    <div class="editor-section">
                        <label>To-Do Items (one per line, prefix with [x] if done)</label>
                        <textarea id="edit-todos" rows="4" placeholder="Order BNP&#10;[x] Review medications&#10;Call cardiology"></textarea>
                    </div>
                    <div class="editor-section">
                        <label>Focus Area</label>
                        <input type="text" id="edit-focus-area" placeholder="e.g., Fluid management">
                    </div>
                </div>
                <div class="ai-coworker-editor-footer">
                    <button class="btn btn-secondary" onclick="AICoworker.closeEditor()">Cancel</button>
                    <button class="btn btn-primary" onclick="AICoworker.saveFromEditor()">Save Changes</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    },

    /**
     * Setup event listeners
     */
    setupEventListeners() {
        // Listen to simulation events to provide context
        if (typeof SimulationEngine !== 'undefined') {
            SimulationEngine.on('tick', (data) => this.onSimulationTick(data));
            SimulationEngine.on('nurseAlert', (data) => this.onAlert('nurse', data));
            SimulationEngine.on('patientAlert', (data) => this.onAlert('patient', data));
        }
    },

    /**
     * Start polling for external updates
     */
    startPolling() {
        // Poll for file-based updates every 2 seconds
        this.updateInterval = setInterval(() => {
            this.checkForUpdates();
        }, 2000);
    },

    /**
     * Check for updates from external sources
     */
    async checkForUpdates() {
        // Check localStorage for updates
        const stored = localStorage.getItem('aiCoworkerState');
        if (stored) {
            try {
                const parsed = JSON.parse(stored);
                if (parsed.lastUpdated !== this.state.lastUpdated) {
                    this.state = { ...this.state, ...parsed };
                    this.render();
                }
            } catch (e) {
                console.warn('Error parsing AI Coworker state:', e);
            }
        }

        // Also try to fetch from a local JSON file (for wiki plugin integration)
        try {
            const response = await fetch('data/ai-coworker-state.json?t=' + Date.now(), {
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

        // Also try to fetch from a markdown wiki file
        try {
            const mdResponse = await fetch('data/ai-coworker-wiki.md?t=' + Date.now(), {
                method: 'GET',
                cache: 'no-store'
            });
            if (mdResponse.ok) {
                const mdContent = await mdResponse.text();
                const parsedState = this.parseMarkdownWiki(mdContent);
                if (parsedState && parsedState._hash !== this._lastMdHash) {
                    this._lastMdHash = parsedState._hash;
                    delete parsedState._hash;
                    this.state = { ...this.state, ...parsedState };
                    this.saveState();
                    this.render();
                }
            }
        } catch (e) {
            // File doesn't exist yet, that's ok
        }
    },

    /**
     * Parse markdown wiki format into state object
     */
    parseMarkdownWiki(content) {
        const state = {};
        let currentSection = null;
        let sectionContent = [];

        // Simple hash for change detection
        state._hash = this.simpleHash(content);

        const lines = content.split('\n');

        for (const line of lines) {
            // Check for section headers
            if (line.startsWith('## ')) {
                // Save previous section
                if (currentSection) {
                    this.processMdSection(state, currentSection, sectionContent.join('\n').trim());
                }
                currentSection = line.substring(3).trim().toLowerCase();
                sectionContent = [];
            } else if (currentSection && !line.startsWith('#') && !line.startsWith('---') && !line.startsWith('*Last updated')) {
                // Skip HTML comments
                if (!line.includes('<!--') && !line.includes('-->')) {
                    sectionContent.push(line);
                }
            }
        }

        // Process last section
        if (currentSection) {
            this.processMdSection(state, currentSection, sectionContent.join('\n').trim());
        }

        return state;
    },

    /**
     * Process a markdown section into state
     */
    processMdSection(state, section, content) {
        if (!content) return;

        switch (section) {
            case 'status':
                state.status = content.trim();
                break;
            case 'focus area':
                state.focusArea = content.trim();
                break;
            case 'case summary':
                state.caseSummary = content.trim();
                break;
            case 'current thinking':
                state.currentThinking = content.trim();
                break;
            case 'next steps':
                state.nextSteps = content.split('\n')
                    .map(line => line.replace(/^[-*]\s*/, '').trim())
                    .filter(line => line.length > 0);
                break;
            case 'to-do list':
                state.todos = content.split('\n')
                    .map(line => {
                        const trimmed = line.replace(/^[-*]\s*/, '').trim();
                        if (!trimmed) return null;
                        const isDone = trimmed.startsWith('[x]') || trimmed.startsWith('[X]');
                        const text = trimmed.replace(/^\[[ xX]\]\s*/, '').trim();
                        return text ? { text, done: isDone } : null;
                    })
                    .filter(item => item !== null);
                break;
            case 'confidence':
                const num = parseInt(content.trim(), 10);
                if (!isNaN(num)) {
                    state.confidence = Math.min(100, Math.max(0, num));
                }
                break;
        }
    },

    /**
     * Simple hash function for change detection
     */
    simpleHash(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return hash.toString(16);
    },

    /**
     * Handle external messages (postMessage API)
     */
    handleExternalMessage(event) {
        // Accept messages from any origin for flexibility with external tools
        if (event.data && event.data.type === 'aiCoworkerUpdate') {
            this.update(event.data.payload);
        }
    },

    /**
     * Load state from localStorage
     */
    loadState() {
        const stored = localStorage.getItem('aiCoworkerState');
        if (stored) {
            try {
                this.state = { ...this.state, ...JSON.parse(stored) };
            } catch (e) {
                console.warn('Error loading AI Coworker state:', e);
            }
        }
        this.render();
    },

    /**
     * Save state to localStorage
     */
    saveState() {
        this.state.lastUpdated = new Date().toISOString();
        localStorage.setItem('aiCoworkerState', JSON.stringify(this.state));
    },

    /**
     * Update the AI Coworker state
     */
    update(newState) {
        this.state = { ...this.state, ...newState };
        this.state.lastUpdated = new Date().toISOString();
        this.saveState();
        this.render();

        // Flash to indicate update
        const panel = document.getElementById('ai-coworker-panel');
        if (panel) {
            panel.classList.add('updated');
            setTimeout(() => panel.classList.remove('updated'), 1000);
        }
    },

    /**
     * Render the panel content
     */
    render() {
        const body = document.getElementById('ai-coworker-body');
        const statusEl = document.getElementById('ai-coworker-status');
        const timeEl = document.getElementById('ai-coworker-update-time');

        if (!body) return;

        // Update status indicator
        if (statusEl) {
            statusEl.className = 'ai-coworker-status ' + (this.state.status || 'thinking');
            statusEl.title = this.state.status || 'thinking';
        }

        // Update time
        if (timeEl && this.state.lastUpdated) {
            const updated = new Date(this.state.lastUpdated);
            timeEl.textContent = 'Updated ' + this.formatTimeAgo(updated);
        }

        // Build content
        let html = '';

        // Alerts (if any)
        if (this.state.alerts && this.state.alerts.length > 0) {
            html += '<div class="ai-coworker-alerts">';
            this.state.alerts.forEach(alert => {
                html += '<div class="ai-coworker-alert ' + (alert.priority || '') + '">';
                html += '<span class="alert-icon">⚠️</span>';
                html += '<span class="alert-text">' + this.escapeHtml(alert.message) + '</span>';
                html += '</div>';
            });
            html += '</div>';
        }

        // Focus Area
        if (this.state.focusArea) {
            html += '<div class="ai-coworker-focus">';
            html += '<span class="focus-label">Currently focusing on:</span>';
            html += '<span class="focus-value">' + this.escapeHtml(this.state.focusArea) + '</span>';
            html += '</div>';
        }

        // Case Summary
        if (this.state.caseSummary) {
            html += '<div class="ai-coworker-section">';
            html += '<div class="section-header">📋 Case Summary</div>';
            html += '<div class="section-content">' + this.formatMarkdown(this.state.caseSummary) + '</div>';
            html += '</div>';
        }

        // Current Thinking
        if (this.state.currentThinking) {
            html += '<div class="ai-coworker-section thinking">';
            html += '<div class="section-header">💭 Current Thinking</div>';
            html += '<div class="section-content">' + this.formatMarkdown(this.state.currentThinking) + '</div>';
            html += '</div>';
        }

        // Next Steps
        if (this.state.nextSteps && this.state.nextSteps.length > 0) {
            html += '<div class="ai-coworker-section">';
            html += '<div class="section-header">➡️ Next Steps</div>';
            html += '<ol class="next-steps-list">';
            this.state.nextSteps.forEach(step => {
                html += '<li>' + this.escapeHtml(step) + '</li>';
            });
            html += '</ol>';
            html += '</div>';
        }

        // To-Do List
        if (this.state.todos && this.state.todos.length > 0) {
            html += '<div class="ai-coworker-section">';
            html += '<div class="section-header">☑️ To-Do List</div>';
            html += '<ul class="todo-list">';
            this.state.todos.forEach((todo, index) => {
                const isComplete = todo.done || todo.completed;
                html += '<li class="todo-item ' + (isComplete ? 'completed' : '') + '">';
                html += '<input type="checkbox" ' + (isComplete ? 'checked' : '') + ' onchange="AICoworker.toggleTodo(' + index + ')">';
                html += '<span class="todo-text">' + this.escapeHtml(todo.text || todo) + '</span>';
                html += '</li>';
            });
            html += '</ul>';
            html += '</div>';
        }

        // Confidence indicator
        if (this.state.confidence !== null && this.state.confidence !== undefined) {
            html += '<div class="ai-coworker-confidence">';
            html += '<span class="confidence-label">Confidence:</span>';
            html += '<div class="confidence-bar">';
            html += '<div class="confidence-fill" style="width: ' + this.state.confidence + '%"></div>';
            html += '</div>';
            html += '<span class="confidence-value">' + this.state.confidence + '%</span>';
            html += '</div>';
        }

        // Empty state
        if (!html) {
            html = '<div class="ai-coworker-empty">';
            html += '<div class="empty-icon">🤖</div>';
            html += '<div class="empty-text">No data from Claude yet</div>';
            html += '<div class="empty-hint">Claude Cowork will update this panel as it analyzes the case.</div>';
            html += '<button class="btn btn-sm" onclick="AICoworker.loadSampleData()">Load Sample Data</button>';
            html += '</div>';
        }

        body.innerHTML = html;
    },

    /**
     * Toggle a todo item
     */
    toggleTodo(index) {
        if (this.state.todos && this.state.todos[index]) {
            const todo = this.state.todos[index];
            if (typeof todo === 'object') {
                todo.done = !todo.done;
                todo.completed = todo.done;
            } else {
                this.state.todos[index] = { text: todo, done: true };
            }
            this.saveState();
            this.render();
        }
    },

    /**
     * Load sample data for demonstration
     */
    loadSampleData() {
        this.update({
            status: 'thinking',
            caseSummary: '72yo male with **DM2, CKD Stage 3, CHF (EF 32%)**, and **A.fib** presenting with acute dyspnea. Recent admission 3 weeks ago for CHF exacerbation. Currently volume overloaded with bilateral crackles and lower extremity edema.',
            currentThinking: 'This appears to be another CHF exacerbation, likely triggered by dietary indiscretion or medication non-compliance. Need to rule out acute coronary syndrome and arrhythmia as precipitants. **Important:** Patient has history of recent GI bleed - anticoagulation decisions need careful consideration.',
            nextSteps: [
                'Review recent medication list for compliance',
                'Check BNP trend compared to baseline',
                'Assess volume status with I/O and daily weights',
                'Consider echocardiogram if significantly changed from baseline'
            ],
            todos: [
                { text: 'Order BMP and BNP', done: false },
                { text: 'Review prior echo report', done: false },
                { text: 'Check GI bleed history before anticoagulation', done: false },
                { text: 'Assess diuretic response', done: false },
                { text: 'Review home medication list', done: true }
            ],
            focusArea: 'Volume status and diuretic management',
            confidence: 75,
            alerts: []
        });
    },

    /**
     * Show/hide the panel
     */
    toggle() {
        const panel = document.getElementById('ai-coworker-panel');
        const toggle = document.getElementById('ai-coworker-toggle');

        this.isVisible = !this.isVisible;

        if (panel) {
            panel.classList.toggle('visible', this.isVisible);
        }
        if (toggle) {
            toggle.classList.toggle('active', this.isVisible);
        }
    },

    /**
     * Show the panel
     */
    show() {
        if (!this.isVisible) this.toggle();
    },

    /**
     * Minimize/expand the panel body
     */
    toggleMinimize() {
        const panel = document.getElementById('ai-coworker-panel');
        const btn = document.getElementById('ai-coworker-minimize');

        this.isMinimized = !this.isMinimized;

        if (panel) {
            panel.classList.toggle('minimized', this.isMinimized);
        }
        if (btn) {
            btn.textContent = this.isMinimized ? '+' : '−';
        }
    },

    /**
     * Refresh data
     */
    refresh() {
        this.checkForUpdates();
        App.showToast('AI Coworker refreshed', 'info');
    },

    /**
     * Open the editor modal
     */
    openEditor() {
        const modal = document.getElementById('ai-coworker-editor');
        if (!modal) return;

        // Populate fields
        document.getElementById('edit-case-summary').value = this.state.caseSummary || '';
        document.getElementById('edit-current-thinking').value = this.state.currentThinking || '';
        document.getElementById('edit-next-steps').value = (this.state.nextSteps || []).join('\n');
        document.getElementById('edit-focus-area').value = this.state.focusArea || '';

        // Format todos
        const todosText = (this.state.todos || []).map(todo => {
            if (typeof todo === 'object') {
                return (todo.done ? '[x] ' : '') + (todo.text || '');
            }
            return todo;
        }).join('\n');
        document.getElementById('edit-todos').value = todosText;

        modal.classList.add('visible');
    },

    /**
     * Close the editor modal
     */
    closeEditor() {
        const modal = document.getElementById('ai-coworker-editor');
        if (modal) modal.classList.remove('visible');
    },

    /**
     * Save from editor
     */
    saveFromEditor() {
        const caseSummary = document.getElementById('edit-case-summary').value.trim();
        const currentThinking = document.getElementById('edit-current-thinking').value.trim();
        const nextStepsRaw = document.getElementById('edit-next-steps').value.trim();
        const todosRaw = document.getElementById('edit-todos').value.trim();
        const focusArea = document.getElementById('edit-focus-area').value.trim();

        // Parse next steps
        const nextSteps = nextStepsRaw.split('\n').filter(s => s.trim());

        // Parse todos
        const todos = todosRaw.split('\n').filter(s => s.trim()).map(line => {
            const isDone = line.startsWith('[x]') || line.startsWith('[X]');
            const text = line.replace(/^\[x\]\s*/i, '').trim();
            return { text, done: isDone };
        });

        this.update({
            caseSummary,
            currentThinking,
            nextSteps,
            todos,
            focusArea
        });

        this.closeEditor();
        App.showToast('AI Coworker updated', 'success');
    },

    /**
     * Handle simulation tick - can auto-update based on state
     */
    onSimulationTick(data) {
        // Could auto-generate insights here based on simulation state
        // For now, just track that simulation is running
    },

    /**
     * Handle alerts from simulation
     */
    onAlert(type, data) {
        // Add alert to state
        if (!this.state.alerts) this.state.alerts = [];

        this.state.alerts.unshift({
            type: type,
            message: data.message,
            priority: data.priority,
            timestamp: new Date().toISOString()
        });

        // Keep only last 5 alerts
        this.state.alerts = this.state.alerts.slice(0, 5);

        this.saveState();
        this.render();
    },

    /**
     * Format time ago
     */
    formatTimeAgo(date) {
        const seconds = Math.floor((new Date() - date) / 1000);
        if (seconds < 60) return 'just now';
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return minutes + 'm ago';
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return hours + 'h ago';
        return date.toLocaleDateString();
    },

    /**
     * Simple markdown formatting
     */
    formatMarkdown(text) {
        if (!text) return '';
        return this.escapeHtml(text)
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/\n/g, '<br>');
    },

    /**
     * Escape HTML
     */
    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    /**
     * External API for Claude Cowork to update
     * Call via: window.AICoworker.updateFromExternal({...})
     */
    updateFromExternal(data) {
        this.update(data);
        this.show();
    },

    /**
     * Get current state (for external tools)
     */
    getState() {
        return { ...this.state };
    }
};

// Expose globally for external access
window.AICoworker = AICoworker;

// Also expose a simple update function
window.updateAICoworker = function(data) {
    AICoworker.updateFromExternal(data);
};
