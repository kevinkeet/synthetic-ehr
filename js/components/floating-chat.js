/**
 * Floating Chat Component
 * Provides pop-up chat windows for Patient and Nurse simulations,
 * completely independent from the Clinical Copilot panel.
 */

const FloatingChat = {
    // Track which chats are open
    openChats: {}, // { 'patient': true, 'nurse': false }

    // Chat window positions
    positions: {
        patient: { bottom: 80 },
        nurse: { bottom: 80 }
    },

    /**
     * Initialize floating chat system
     */
    init() {
        // Create the floating chat container if it doesn't exist
        if (!document.getElementById('floating-chat-container')) {
            const container = document.createElement('div');
            container.id = 'floating-chat-container';
            document.body.appendChild(container);
        }

        // Create trigger buttons
        this.renderTriggerButtons();

        console.log('Floating Chat initialized');
    },

    /**
     * Render the trigger buttons on the left side
     */
    renderTriggerButtons() {
        let btnContainer = document.getElementById('chat-trigger-buttons');
        if (!btnContainer) {
            btnContainer = document.createElement('div');
            btnContainer.id = 'chat-trigger-buttons';
            btnContainer.className = 'chat-trigger-buttons';
            document.body.appendChild(btnContainer);
        }

        btnContainer.innerHTML = `
            <button class="chat-trigger-btn patient-trigger" onclick="FloatingChat.toggleChat('patient')" title="Chat with Patient">
                <span class="trigger-icon">&#128100;</span>
                <span class="trigger-label">Chat with Patient</span>
            </button>
            <button class="chat-trigger-btn nurse-trigger" onclick="FloatingChat.toggleChat('nurse')" title="Chat with Nurse">
                <span class="trigger-icon">&#128105;&#8205;&#9877;</span>
                <span class="trigger-label">Chat with Nurse</span>
            </button>
        `;
    },

    /**
     * Toggle a chat window open/closed
     */
    toggleChat(chatType) {
        if (this.openChats[chatType]) {
            this.closeChat(chatType);
        } else {
            this.openChat(chatType);
        }
    },

    /**
     * Open a chat window
     */
    openChat(chatType) {
        this.openChats[chatType] = true;

        // Update trigger button state
        const triggers = document.querySelectorAll(`.${chatType}-trigger`);
        triggers.forEach(t => t.classList.add('active'));

        // Create or show the chat window
        let chatWindow = document.getElementById(`floating-chat-${chatType}`);
        if (!chatWindow) {
            chatWindow = this.createChatWindow(chatType);
        }
        chatWindow.classList.add('open');

        // Initialize the appropriate chat component if needed
        if (chatType === 'patient' && typeof PatientChat !== 'undefined') {
            PatientChat.init();
        } else if (chatType === 'nurse' && typeof NurseChat !== 'undefined') {
            NurseChat.init();
        }
    },

    /**
     * Close a chat window
     */
    closeChat(chatType) {
        this.openChats[chatType] = false;

        // Update trigger button state
        const triggers = document.querySelectorAll(`.${chatType}-trigger`);
        triggers.forEach(t => t.classList.remove('active'));

        const chatWindow = document.getElementById(`floating-chat-${chatType}`);
        if (chatWindow) {
            chatWindow.classList.remove('open');
        }
    },

    /**
     * Create a chat window element
     */
    createChatWindow(chatType) {
        const container = document.getElementById('floating-chat-container');
        const chatWindow = document.createElement('div');
        chatWindow.id = `floating-chat-${chatType}`;
        chatWindow.className = `floating-chat-window ${chatType}-chat-window`;

        const isPatient = chatType === 'patient';
        const title = isPatient ? 'Patient Chat' : 'Nurse Chat';
        const icon = isPatient ? '&#128100;' : '&#128105;&#8205;&#9877;';
        const subtitle = isPatient
            ? 'Simulated patient interview'
            : 'Nurse communication';
        const inputId = isPatient ? 'patient-input' : 'nurse-input';
        const messagesId = isPatient ? 'patient-messages' : 'nurse-messages';
        const sendFn = isPatient ? 'PatientChat.sendMessage()' : 'NurseChat.sendMessage()';
        const keydownFn = isPatient ? 'PatientChat.handleKeyDown(event)' : 'NurseChat.handleKeyDown(event)';
        const clearFn = isPatient ? 'PatientChat.clearChat()' : 'NurseChat.clearChat()';

        chatWindow.innerHTML = `
            <div class="floating-chat-header ${chatType}-chat-header">
                <div class="floating-chat-header-left">
                    <span class="floating-chat-icon">${icon}</span>
                    <div class="floating-chat-title-group">
                        <span class="floating-chat-title">${title}</span>
                        <span class="floating-chat-subtitle">${subtitle}</span>
                    </div>
                </div>
                <div class="floating-chat-header-actions">
                    <button class="floating-chat-action-btn" onclick="${clearFn}" title="Clear chat">
                        <span>&#128465;</span>
                    </button>
                    ${isPatient ? `
                    <button class="floating-chat-action-btn" id="patient-voice-btn" onclick="PatientChat.toggleVoiceInput()" title="Voice input">
                        <span>&#127908;</span>
                    </button>
                    <button class="floating-chat-action-btn" id="patient-voice-output-btn" onclick="PatientChat.toggleVoiceOutput()" title="Toggle voice output">
                        <span class="speaker-icon">&#128266;</span>
                    </button>
                    ` : ''}
                    <button class="floating-chat-close-btn" onclick="FloatingChat.closeChat('${chatType}')" title="Close">
                        <span>&#10005;</span>
                    </button>
                </div>
            </div>
            <div class="floating-chat-body" id="${messagesId}">
                <div class="chat-welcome">
                    <div class="welcome-avatar">${icon}</div>
                    <h3>${title}</h3>
                    <p>${isPatient
                        ? 'Chat with a simulated patient. Use voice or text to practice clinical communication.'
                        : 'Practice communication with nursing staff for handoffs, clarifications, and coordination.'}</p>
                </div>
            </div>
            <div class="floating-chat-input-area">
                <div class="floating-chat-input-row">
                    <textarea
                        id="${inputId}"
                        class="floating-chat-input"
                        placeholder="Type a message..."
                        rows="1"
                        onkeydown="${keydownFn}"
                    ></textarea>
                    <button class="floating-chat-send-btn" onclick="${sendFn}" title="Send">
                        <span>&#9654;</span>
                    </button>
                </div>
            </div>
        `;

        container.appendChild(chatWindow);
        return chatWindow;
    },

    /**
     * Add a message to a chat window (called by PatientChat / NurseChat)
     */
    addMessage(chatType, role, content, isTyping = false) {
        const messagesId = chatType === 'patient' ? 'patient-messages' : 'nurse-messages';
        const container = document.getElementById(messagesId);
        if (!container) return;

        // Remove welcome message if it exists
        const welcome = container.querySelector('.chat-welcome');
        if (welcome && (content || isTyping)) {
            welcome.remove();
        }

        const messageDiv = document.createElement('div');
        messageDiv.className = `chat-message ${role}`;

        if (isTyping) {
            messageDiv.classList.add('typing-indicator');
            messageDiv.innerHTML = `
                <div class="chat-avatar">${chatType === 'patient' ? '&#128100;' : '&#128105;&#8205;&#9877;'}</div>
                <div class="chat-bubble">
                    <div class="chat-typing">
                        <div class="chat-typing-dot"></div>
                        <div class="chat-typing-dot"></div>
                        <div class="chat-typing-dot"></div>
                    </div>
                </div>
            `;
        } else {
            const avatarContent = role === 'user'
                ? '&#128104;&#8205;&#9877;'
                : (chatType === 'patient' ? '&#128100;' : '&#128105;&#8205;&#9877;');

            messageDiv.innerHTML = `
                <div class="chat-avatar">${avatarContent}</div>
                <div class="chat-bubble">${this.escapeHtml(content)}</div>
            `;
        }

        container.appendChild(messageDiv);

        // Scroll to bottom
        container.scrollTop = container.scrollHeight;
    },

    /**
     * Remove typing indicator from a chat
     */
    removeTypingIndicator(chatType) {
        const messagesId = chatType === 'patient' ? 'patient-messages' : 'nurse-messages';
        const container = document.getElementById(messagesId);
        if (!container) return;

        const typingIndicator = container.querySelector('.typing-indicator');
        if (typingIndicator) {
            typingIndicator.remove();
        }
    },

    /**
     * Escape HTML to prevent XSS
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
};

window.FloatingChat = FloatingChat;
