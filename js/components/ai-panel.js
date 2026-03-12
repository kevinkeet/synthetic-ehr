/**
 * AI Panel Component
 * Manages the AI side panel — single panel with collapse/expand + settings + resize + mode toggle.
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
        // Initialize mode config
        if (typeof AIModeConfig !== 'undefined') {
            AIModeConfig.init();
        }

        // Default to collapsed unless the user has explicitly expanded before
        const savedState = localStorage.getItem('ai-panel-collapsed');
        this.isCollapsed = savedState === null ? true : savedState === 'true';

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

        // Sync mode toggle UI to saved mode
        if (typeof AIModeConfig !== 'undefined') {
            this.syncModeUI(AIModeConfig.currentMode);
        }

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

        // Auto-analysis disabled — Learn/Analyze are manual-only now.
        // Memory is restored from localStorage via hydrateFromMemory().
        // this._autoAnalyzeIfNeeded();
    },

    /**
     * Trigger AI analysis automatically if no LLM data is present yet.
     * Called when the panel is expanded AND after patient data finishes loading.
     * Runs for ALL modes (including Reactive) so the user never has to click refresh.
     *
     * Skips if analysis was recently performed (e.g. background run on API key entry).
     * Manual refresh (clicking the refresh button) always bypasses this check.
     */
    _autoAnalyzeIfNeeded() {
        if (typeof AICoworker === 'undefined') return;

        // Wait until the context assembler is ready (patient data loaded)
        if (!AICoworker.contextAssembler) return;

        // Check if we already have a cached analysis for the current mode
        if (typeof AIModeConfig !== 'undefined') {
            var currentModeId = AIModeConfig.currentMode;
            if (AICoworker._modeAnalysisCache && AICoworker._modeAnalysisCache[currentModeId]) {
                // Restore from cache — instant, no API call needed
                AICoworker._restoreModeCache(currentModeId);
                AICoworker.render();
                return;
            }
        }

        // Check if we already have LLM-enriched problem data
        const hasLLMData = AICoworker.state &&
            AICoworker.state.problemList &&
            AICoworker.state.problemList.length > 0 &&
            AICoworker.state.problemList.some(p => p.plan);

        // Don't re-run if already thinking or already has data
        if (hasLLMData) return;
        if (AICoworker.state && AICoworker.state.status === 'thinking') return;

        // Skip if analysis was performed recently (e.g. background analysis
        // triggered by API key entry). User can always click Refresh manually.
        if (AICoworker.wasRecentlyAnalyzed()) {
            console.log('⏭️ Skipping auto-analysis — was recently analyzed');
            return;
        }

        // Check that API is configured before attempting
        if (!AICoworker.isApiConfigured()) return;

        // Short delay to let the panel expand animation finish
        setTimeout(() => {
            // Double-check context assembler is still ready (guard async race)
            if (!AICoworker.contextAssembler) return;
            AICoworker.refreshThinking();
        }, 500);
    },

    /**
     * Handle mode button click.
     * - Clicking a non-active mode: switches to that mode.
     * - Clicking the already-active mode: toggles the prompt editor.
     */
    handleModeClick(modeId) {
        if (typeof AIModeConfig === 'undefined') return;
        if (AIModeConfig.currentMode === modeId) {
            // Already active — toggle prompt editor
            if (typeof AICoworker !== 'undefined') {
                AICoworker.toggleInlinePromptEditor();
            }
        } else {
            // Switch to this mode
            this.setMode(modeId);
        }
    },

    /**
     * Set AI assistant mode (Reactive / Active / Proactive)
     */
    setMode(modeId) {
        if (typeof AIModeConfig === 'undefined') return;
        AIModeConfig.setMode(modeId);
        this.syncModeUI(modeId);
        // Trigger re-render of AI content with new mode
        if (typeof AICoworker !== 'undefined') {
            AICoworker.onModeChanged(modeId);
        }
    },

    /**
     * Sync mode toggle UI to reflect current mode
     */
    syncModeUI(modeId) {
        // Update toggle button active states
        var toggle = document.getElementById('ai-mode-toggle');
        if (toggle) {
            var buttons = toggle.querySelectorAll('.mode-btn');
            buttons.forEach(function(btn) {
                btn.classList.toggle('active', btn.dataset.mode === modeId);
            });
        }
        // Set data attribute on panel for CSS mode-specific styling
        var panel = document.getElementById('ai-panel');
        if (panel) {
            panel.dataset.mode = modeId;
        }
        // Toggle "Acting Intern" ↔ "AI" logo animation
        // Middle mode (Active) shows full "Acting Intern"; other modes collapse to "AI"
        var logo = document.querySelector('.ai-panel-topbar-title .logo-animated');
        if (logo) {
            logo.classList.toggle('ai-reveal', modeId !== 'active');
        }
    },

    /**
     * Open settings panel
     */
    openSettings() {
        const settingsPanel = document.getElementById('ai-settings-panel');
        if (settingsPanel) {
            settingsPanel.classList.add('open');
            this.isSettingsOpen = true;

            // Sync model dropdowns with current values
            if (typeof AICoworker !== 'undefined') {
                const chatSelect = document.getElementById('settings-chat-model');
                const analysisSelect = document.getElementById('settings-analysis-model');
                if (chatSelect) chatSelect.value = AICoworker.model;
                if (analysisSelect) analysisSelect.value = AICoworker.analysisModel;
            }
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
        // Load API key from localStorage (fallback for no-backend mode)
        // Safe to call early — backend detection will override if server is available
        if (typeof AICoworker !== 'undefined' && typeof AICoworker.loadApiKeyFallback === 'function') {
            AICoworker.loadApiKeyFallback();
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
