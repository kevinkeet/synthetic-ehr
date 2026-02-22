/**
 * AI Panel Component
 * Manages the AI side panel — single panel with collapse/expand + settings.
 * No tabs, no chat — just the Clinical Copilot.
 */

const AIPanel = {
    isCollapsed: false,
    isSettingsOpen: false,

    /**
     * Initialize the AI panel
     */
    init() {
        // Load collapsed state from localStorage
        this.isCollapsed = localStorage.getItem('ai-panel-collapsed') === 'true';

        // Apply initial state
        if (this.isCollapsed) {
            this.collapse();
        } else {
            const floatingBtn = document.getElementById('ai-panel-floating-btn');
            if (floatingBtn) {
                floatingBtn.classList.remove('visible');
            }
        }

        // Load saved settings
        this.loadSettings();

        console.log('AI Panel initialized');
    },

    /**
     * Toggle panel collapse state
     */
    toggle() {
        if (this.isCollapsed) {
            this.expand();
        } else {
            this.collapse();
        }
    },

    /**
     * Collapse the panel
     */
    collapse() {
        const panel = document.getElementById('ai-panel');
        const floatingBtn = document.getElementById('ai-panel-floating-btn');
        if (panel) {
            panel.classList.add('collapsed');
            const toggleIcon = panel.querySelector('.toggle-icon');
            if (toggleIcon) {
                toggleIcon.innerHTML = '&#10094;';
            }
        }
        if (floatingBtn) {
            floatingBtn.classList.add('visible');
        }
        this.isCollapsed = true;
        localStorage.setItem('ai-panel-collapsed', 'true');
    },

    /**
     * Expand the panel
     */
    expand() {
        const panel = document.getElementById('ai-panel');
        const floatingBtn = document.getElementById('ai-panel-floating-btn');
        if (panel) {
            panel.classList.remove('collapsed');
            const toggleIcon = panel.querySelector('.toggle-icon');
            if (toggleIcon) {
                toggleIcon.innerHTML = '&#10095;';
            }
        }
        if (floatingBtn) {
            floatingBtn.classList.remove('visible');
        }
        this.isCollapsed = false;
        localStorage.setItem('ai-panel-collapsed', 'false');
    },

    /**
     * Open settings panel
     */
    openSettings() {
        const settingsPanel = document.getElementById('ai-settings-panel');
        if (settingsPanel) {
            settingsPanel.classList.add('open');
            this.isSettingsOpen = true;
        }
    },

    /**
     * Close settings panel
     */
    closeSettings() {
        const settingsPanel = document.getElementById('ai-settings-panel');
        if (settingsPanel) {
            settingsPanel.classList.remove('open');
            this.isSettingsOpen = false;
        }
    },

    /**
     * Load saved settings from localStorage
     */
    loadSettings() {
        const apiKey = localStorage.getItem('claude-api-key');

        const apiKeyInput = document.getElementById('claude-api-key');
        if (apiKeyInput && apiKey) apiKeyInput.value = apiKey;

        if (apiKey && typeof ClaudeAPI !== 'undefined') {
            ClaudeAPI.setApiKey(apiKey);
        }
    },

    /**
     * Save API key
     */
    saveApiKey() {
        const input = document.getElementById('claude-api-key');
        if (input) {
            const key = input.value.trim();
            localStorage.setItem('claude-api-key', key);
            if (typeof ClaudeAPI !== 'undefined') {
                ClaudeAPI.setApiKey(key);
            }
            App.showToast('API key saved', 'success');
        }
    },

    /**
     * Test API connection
     */
    async testConnection() {
        const apiKey = localStorage.getItem('claude-api-key');
        if (!apiKey) {
            App.showToast('Please enter an API key first', 'error');
            return;
        }

        App.showToast('Testing connection...', 'info');

        try {
            if (typeof ClaudeAPI !== 'undefined') {
                const response = await ClaudeAPI.sendMessage(
                    'You are a test assistant. Respond with "Connection successful!" and nothing else.',
                    [{ role: 'user', content: 'Test' }]
                );

                if (response && response.content) {
                    App.showToast('API connection successful!', 'success');
                } else {
                    App.showToast('Connection failed: Invalid response', 'error');
                }
            } else {
                App.showToast('Claude API service not loaded', 'error');
            }
        } catch (error) {
            console.error('API test failed:', error);
            App.showToast(`Connection failed: ${error.message}`, 'error');
        }
    }
};

window.AIPanel = AIPanel;
