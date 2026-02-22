/**
 * AI Panel Component
 * Manages the AI side panel — single panel with collapse/expand + settings + resize.
 */

const AIPanel = {
    isCollapsed: false,
    isSettingsOpen: false,
    isResizing: false,
    minWidth: 320,
    maxWidth: 900,

    /**
     * Initialize the AI panel
     */
    init() {
        // Load collapsed state from localStorage
        this.isCollapsed = localStorage.getItem('ai-panel-collapsed') === 'true';

        // Load saved panel width
        const savedWidth = localStorage.getItem('ai-panel-width');
        if (savedWidth) {
            document.documentElement.style.setProperty('--ai-panel-width', savedWidth + 'px');
        }

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

        // Initialize resize handle
        this.initResize();

        console.log('AI Panel initialized');
    },

    /**
     * Initialize drag-to-resize on the left edge of the panel
     */
    initResize() {
        const handle = document.getElementById('ai-panel-resize-handle');
        const panel = document.getElementById('ai-panel');
        if (!handle || !panel) return;

        handle.addEventListener('mousedown', (e) => {
            e.preventDefault();
            this.isResizing = true;
            panel.classList.add('resizing');
            handle.classList.add('active');
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
        });

        document.addEventListener('mousemove', (e) => {
            if (!this.isResizing) return;
            const newWidth = window.innerWidth - e.clientX;
            const clamped = Math.max(this.minWidth, Math.min(this.maxWidth, newWidth));
            document.documentElement.style.setProperty('--ai-panel-width', clamped + 'px');
        });

        document.addEventListener('mouseup', () => {
            if (!this.isResizing) return;
            this.isResizing = false;
            panel.classList.remove('resizing');
            const handle = document.getElementById('ai-panel-resize-handle');
            if (handle) handle.classList.remove('active');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            // Save width
            const width = parseInt(getComputedStyle(panel).width);
            if (width > 0) localStorage.setItem('ai-panel-width', width);
        });
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
     * Load saved settings from localStorage — delegates to AICoworker for unified API key
     */
    loadSettings() {
        // AICoworker.loadApiKey() handles migration and syncing to ClaudeAPI
        if (typeof AICoworker !== 'undefined') {
            AICoworker.loadApiKey();
        }
    },

    /**
     * Open API key configuration — delegates to AICoworker's unified modal
     */
    configureApiKey() {
        if (typeof AICoworker !== 'undefined') {
            AICoworker.openApiKeyModal();
        }
    },

    /**
     * Test API connection
     */
    async testConnection() {
        if (typeof AICoworker !== 'undefined' && !AICoworker.isApiConfigured()) {
            App.showToast('Please configure an API key first', 'error');
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
