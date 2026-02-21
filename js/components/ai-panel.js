/**
 * AI Panel Component
 * Manages the AI simulation panel with patient and nurse chat tabs
 */

const AIPanel = {
    isCollapsed: false,
    currentTab: 'patient',
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
            // Ensure floating button is hidden if panel is expanded
            const floatingBtn = document.getElementById('ai-panel-floating-btn');
            if (floatingBtn) {
                floatingBtn.classList.remove('visible');
            }
        }

        // Load saved settings
        this.loadSettings();

        // Initialize voice options
        this.initVoiceOptions();

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
     * Switch between patient and nurse tabs
     */
    switchTab(tabName) {
        this.currentTab = tabName;

        // Update tab buttons
        document.querySelectorAll('.ai-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.tab === tabName);
        });

        // Update tab content
        document.querySelectorAll('.ai-tab-content').forEach(content => {
            const contentId = content.id;
            const isActive = (tabName === 'patient' && contentId === 'patient-chat-tab') ||
                           (tabName === 'nurse' && contentId === 'nurse-chat-tab') ||
                           (tabName === 'assistant' && contentId === 'assistant-chat-tab');
            content.classList.toggle('active', isActive);
        });

        // Scroll to bottom of active chat
        if (tabName !== 'assistant') {
            this.scrollToBottom(tabName);
        }
    },

    /**
     * Scroll chat to bottom
     */
    scrollToBottom(tabName) {
        const messagesId = tabName === 'patient' ? 'patient-messages' : 'nurse-messages';
        const messagesContainer = document.getElementById(messagesId);
        if (messagesContainer) {
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
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
        const patientUrl = localStorage.getItem('patient-context-url');
        const nurseUrl = localStorage.getItem('nurse-context-url');
        const voiceId = localStorage.getItem('patient-voice-id');

        // Populate input fields
        const apiKeyInput = document.getElementById('claude-api-key');
        if (apiKeyInput && apiKey) {
            apiKeyInput.value = apiKey;
        }

        const patientUrlInput = document.getElementById('patient-context-url');
        if (patientUrlInput && patientUrl) {
            patientUrlInput.value = patientUrl;
        }

        const nurseUrlInput = document.getElementById('nurse-context-url');
        if (nurseUrlInput && nurseUrl) {
            nurseUrlInput.value = nurseUrl;
        }

        // Set the API key in the service
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
     * Save context URL
     */
    saveContextUrl(type) {
        const inputId = type === 'patient' ? 'patient-context-url' : 'nurse-context-url';
        const input = document.getElementById(inputId);
        if (input) {
            const url = input.value.trim();
            localStorage.setItem(`${type}-context-url`, url);
            App.showToast(`${type.charAt(0).toUpperCase() + type.slice(1)} context URL saved`, 'success');

            // Refresh context if available
            if (type === 'patient' && typeof PatientChat !== 'undefined') {
                PatientChat.refreshContext();
            } else if (type === 'nurse' && typeof NurseChat !== 'undefined') {
                NurseChat.refreshContext();
            }
        }
    },

    /**
     * Initialize voice options dropdown
     */
    initVoiceOptions() {
        const voiceSelect = document.getElementById('voice-select');
        if (!voiceSelect) return;

        const populateVoices = () => {
            const voices = speechSynthesis.getVoices();
            voiceSelect.innerHTML = '';

            if (voices.length === 0) {
                voiceSelect.innerHTML = '<option value="">No voices available</option>';
                return;
            }

            // Filter for English voices and sort
            const englishVoices = voices.filter(v => v.lang.startsWith('en'));
            const sortedVoices = englishVoices.sort((a, b) => {
                // Prioritize local voices
                if (a.localService && !b.localService) return -1;
                if (!a.localService && b.localService) return 1;
                return a.name.localeCompare(b.name);
            });

            sortedVoices.forEach((voice, index) => {
                const option = document.createElement('option');
                option.value = voice.name;
                option.textContent = `${voice.name} (${voice.lang})`;
                voiceSelect.appendChild(option);
            });

            // Load saved voice preference
            const savedVoice = localStorage.getItem('patient-voice-id');
            if (savedVoice) {
                voiceSelect.value = savedVoice;
            }
        };

        // Voices may load asynchronously
        if (speechSynthesis.onvoiceschanged !== undefined) {
            speechSynthesis.onvoiceschanged = populateVoices;
        }
        populateVoices();
    },

    /**
     * Save selected voice
     */
    saveVoice() {
        const voiceSelect = document.getElementById('voice-select');
        if (voiceSelect) {
            localStorage.setItem('patient-voice-id', voiceSelect.value);
            if (typeof SpeechService !== 'undefined') {
                SpeechService.setVoice(voiceSelect.value);
            }
            App.showToast('Voice preference saved', 'success');
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
    },

    /**
     * Clear all chat history
     */
    clearChatHistory() {
        if (confirm('Are you sure you want to clear all chat history?')) {
            localStorage.removeItem('patient-chat-history');
            localStorage.removeItem('nurse-chat-history');

            // Clear UI
            if (typeof PatientChat !== 'undefined') {
                PatientChat.clearChat();
            }
            if (typeof NurseChat !== 'undefined') {
                NurseChat.clearChat();
            }

            App.showToast('Chat history cleared', 'success');
        }
    },

    /**
     * Add a message to chat UI
     */
    addMessage(tabName, role, content, isTyping = false) {
        const messagesId = tabName === 'patient' ? 'patient-messages' : 'nurse-messages';
        const messagesContainer = document.getElementById(messagesId);
        if (!messagesContainer) return;

        // Remove welcome message if exists
        const welcomeMsg = messagesContainer.querySelector('.chat-welcome');
        if (welcomeMsg) {
            welcomeMsg.remove();
        }

        const messageDiv = document.createElement('div');
        messageDiv.className = `chat-message ${role}`;

        if (isTyping) {
            messageDiv.classList.add('typing');
            messageDiv.innerHTML = `
                <div class="message-content">
                    <div class="typing-indicator">
                        <span></span><span></span><span></span>
                    </div>
                </div>
            `;
        } else {
            const avatarIcon = role === 'user' ? '&#128100;' :
                             (tabName === 'patient' ? '&#129489;' : '&#128105;&#8205;&#9877;');
            messageDiv.innerHTML = `
                <div class="message-avatar">${avatarIcon}</div>
                <div class="message-content">${this.formatMessage(content)}</div>
            `;
        }

        messagesContainer.appendChild(messageDiv);
        this.scrollToBottom(tabName);

        return messageDiv;
    },

    /**
     * Remove typing indicator
     */
    removeTypingIndicator(tabName) {
        const messagesId = tabName === 'patient' ? 'patient-messages' : 'nurse-messages';
        const messagesContainer = document.getElementById(messagesId);
        if (messagesContainer) {
            const typingMsg = messagesContainer.querySelector('.chat-message.typing');
            if (typingMsg) {
                typingMsg.remove();
            }
        }
    },

    /**
     * Format message content (basic markdown support)
     */
    formatMessage(content) {
        if (!content) return '';

        // Escape HTML
        let formatted = content
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

        // Basic markdown
        formatted = formatted
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/\n/g, '<br>');

        return formatted;
    }
};

window.AIPanel = AIPanel;
