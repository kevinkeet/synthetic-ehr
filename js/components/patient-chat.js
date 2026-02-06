/**
 * Patient Chat Component
 * Handles the patient simulation chat interface with voice support
 */

const PatientChat = {
    messages: [],
    systemPrompt: null,
    isLoading: false,
    voiceInputEnabled: false,
    voiceOutputEnabled: true,
    contextLoaded: false,

    /**
     * Initialize the patient chat
     */
    async init() {
        // Load chat history from localStorage
        this.loadHistory();

        // Load context from Google Doc or use default
        await this.refreshContext();

        // Render existing messages
        this.renderMessages();

        console.log('Patient Chat initialized');
    },

    /**
     * Refresh context from Google Doc
     */
    async refreshContext() {
        const contextUrl = localStorage.getItem('patient-context-url');

        if (contextUrl) {
            try {
                const context = await GoogleDocContext.fetchContext(contextUrl);
                if (context) {
                    this.systemPrompt = context;
                    this.contextLoaded = true;
                    return;
                }
            } catch (error) {
                console.warn('Failed to load patient context:', error);
            }
        }

        // Build context from current scenario
        this.systemPrompt = this.buildScenarioContext();
        this.contextLoaded = true;
    },

    /**
     * Build patient context from current scenario and simulation state
     */
    buildScenarioContext() {
        const scenario = SimulationEngine.currentScenario;
        const state = SimulationEngine.getState();
        const patient = PatientHeader.getPatient();

        // Basic patient info
        const patientName = patient ? `${patient.firstName} ${patient.lastName}` : 'Robert Morrison';
        const patientAge = patient ? DateUtils.calculateAge(patient.dateOfBirth) : '72';

        // Build scenario-specific context
        let context = `You are simulating a patient named ${patientName}, a ${patientAge}-year-old`;

        if (scenario) {
            // Add scenario-specific info
            if (scenario.id === 'SCENARIO_CHF_001' || scenario.name?.includes('CHF')) {
                context += ` male with a history of heart failure who was admitted to the hospital because of worsening shortness of breath and leg swelling.

BACKGROUND (know this but only share when asked):
- You have had "heart problems" for a few years - your heart doesn't pump as well as it should
- You take several medications including "water pills" (furosemide), blood pressure medicine, and diabetes pills
- You stopped taking your water pills about 5 days ago because you ran out and didn't get a refill
- You have diabetes that's controlled with pills
- You have high blood pressure
- Your kidneys don't work perfectly
- You're allergic to Penicillin - it gave you a bad rash
- You take a blood thinner (warfarin) because of an irregular heartbeat

CURRENT SYMPTOMS (adjust based on how you're feeling):`;
            } else {
                context += ` patient who has been admitted to the hospital.

BACKGROUND:
- Share your medical history when asked
- You have multiple medical conditions being managed

CURRENT SYMPTOMS:`;
            }
        } else {
            context += ` male patient admitted to the hospital.

CURRENT SYMPTOMS:`;
        }

        // Add current symptom state
        if (state && state.symptoms) {
            const symptoms = state.symptoms;
            const trajectory = state.trajectory;

            context += `\n`;

            // Dyspnea
            if (symptoms.dyspnea >= 7) {
                context += `- You are having SEVERE shortness of breath, even when lying still. It's hard to talk in full sentences.\n`;
            } else if (symptoms.dyspnea >= 5) {
                context += `- You get short of breath with any movement. Walking to the bathroom is exhausting.\n`;
            } else if (symptoms.dyspnea >= 3) {
                context += `- You're a bit short of breath but it's better than before. You can talk normally.\n`;
            } else if (symptoms.dyspnea >= 1) {
                context += `- Your breathing feels almost normal now. Much better than when you came in.\n`;
            }

            // Orthopnea
            if (symptoms.orthopnea) {
                context += `- You can't lie flat - need to sleep on ${symptoms.orthopneaPillows || 3} pillows or you can't breathe.\n`;
            }

            // Edema
            if (symptoms.edema >= 3) {
                context += `- Your legs are very swollen, especially the ankles. Your shoes don't fit.\n`;
            } else if (symptoms.edema >= 2) {
                context += `- Your ankles are a bit puffy but not as bad as before.\n`;
            } else if (symptoms.edema <= 1) {
                context += `- The swelling in your legs has gone down a lot.\n`;
            }

            // Fatigue
            if (symptoms.fatigue >= 6) {
                context += `- You feel exhausted and just want to sleep.\n`;
            } else if (symptoms.fatigue >= 3) {
                context += `- You're tired but have more energy than before.\n`;
            }

            // Trajectory-based mood
            if (trajectory === 'improving') {
                context += `\nOVERALL: You're starting to feel better. The treatments seem to be helping. You're more hopeful.\n`;
            } else if (trajectory === 'worsening') {
                context += `\nOVERALL: You're feeling worse and getting scared. Something doesn't feel right.\n`;
            } else {
                context += `\nOVERALL: You're not sure if you're getting better or not. Some things feel the same.\n`;
            }
        }

        context += `
PERSONALITY AND COMMUNICATION STYLE:
- You're a retired factory worker, practical and straightforward
- You don't use medical terms - describe symptoms in your own words
- You're cooperative but might be a bit grumpy if you're not feeling well
- You trust doctors but want to understand what's happening to you
- If you don't know something, just say "I'm not sure" or "You'd have to ask my wife"
- Answer questions directly, don't volunteer too much extra information
- If asked about medications, you know the names of some but might say things like "the little white pill" or "the water pill"

IMPORTANT INSTRUCTIONS:
- Stay in character as the patient at all times
- Respond naturally as a patient would in a hospital bed
- Your responses should be 1-3 sentences typically, like a real conversation
- Express appropriate emotions (worry, relief, frustration) based on how you're feeling
- If the doctor does something that helps (like giving you medicine that makes you feel better), acknowledge it`;

        return context;
    },

    /**
     * Load chat history from localStorage
     */
    loadHistory() {
        try {
            const saved = localStorage.getItem('patient-chat-history');
            if (saved) {
                this.messages = JSON.parse(saved);
            }
        } catch (error) {
            console.error('Error loading chat history:', error);
            this.messages = [];
        }
    },

    /**
     * Save chat history to localStorage
     */
    saveHistory() {
        try {
            // Keep only last 50 messages to avoid storage limits
            const toSave = this.messages.slice(-50);
            localStorage.setItem('patient-chat-history', JSON.stringify(toSave));
        } catch (error) {
            console.error('Error saving chat history:', error);
        }
    },

    /**
     * Render all messages to the UI
     */
    renderMessages() {
        const container = document.getElementById('patient-messages');
        if (!container) return;

        // Clear container but keep welcome message if no messages
        if (this.messages.length === 0) {
            container.innerHTML = `
                <div class="chat-welcome">
                    <div class="welcome-avatar">&#128100;</div>
                    <h3>Patient Simulation</h3>
                    <p>Chat with a simulated patient. Use voice or text to practice clinical communication.</p>
                </div>
            `;
            return;
        }

        container.innerHTML = '';
        this.messages.forEach(msg => {
            AIPanel.addMessage('patient', msg.role, msg.content);
        });
    },

    /**
     * Send a message
     */
    async sendMessage() {
        const input = document.getElementById('patient-input');
        if (!input) return;

        const text = input.value.trim();
        if (!text) return;

        // Check if API is configured
        if (!ClaudeAPI.isConfigured()) {
            App.showToast('Please configure your API key in settings', 'error');
            AIPanel.openSettings();
            return;
        }

        // Clear input
        input.value = '';
        input.style.height = 'auto';

        // Add user message to UI and history
        this.messages.push({ role: 'user', content: text });
        AIPanel.addMessage('patient', 'user', text);
        this.saveHistory();

        // Show typing indicator
        this.isLoading = true;
        AIPanel.addMessage('patient', 'assistant', '', true);

        try {
            // Ensure context is loaded
            if (!this.contextLoaded) {
                await this.refreshContext();
            }

            // Build dynamic system prompt with current simulation state
            let dynamicPrompt = this.systemPrompt;

            // Add current symptoms from simulation if running
            if (SimulationEngine.isRunning || SimulationEngine.getState()) {
                const symptomsDescription = SimulationEngine.getSymptomsDescription();
                const state = SimulationEngine.getState();

                if (symptomsDescription || state) {
                    dynamicPrompt += `\n\n--- CURRENT PATIENT STATE (use this to inform your responses) ---\n`;

                    if (symptomsDescription) {
                        dynamicPrompt += `Current symptoms: ${symptomsDescription}\n`;
                    }

                    if (state?.trajectory) {
                        dynamicPrompt += `Overall trajectory: Patient is ${state.trajectory}\n`;
                    }

                    if (state?.physiology?.urineOutput) {
                        const uop = state.physiology.urineOutput;
                        if (uop > 100) {
                            dynamicPrompt += `Note: Patient has been urinating more frequently (good response to water pills)\n`;
                        }
                    }

                    dynamicPrompt += `\nAdjust your symptom descriptions and energy level based on the current state above.`;
                }
            }

            // Format messages for API
            const apiMessages = this.messages.map(m => ({
                role: m.role,
                content: m.content
            }));

            // Send to Claude
            const response = await ClaudeAPI.chat(dynamicPrompt, apiMessages);

            // Remove typing indicator
            AIPanel.removeTypingIndicator('patient');

            // Add response to UI and history
            this.messages.push({ role: 'assistant', content: response });
            AIPanel.addMessage('patient', 'assistant', response);
            this.saveHistory();

            // Speak response if voice output is enabled
            if (this.voiceOutputEnabled && typeof SpeechService !== 'undefined') {
                SpeechService.speak(response);
            }

        } catch (error) {
            console.error('Chat error:', error);
            AIPanel.removeTypingIndicator('patient');
            App.showToast(`Error: ${error.message}`, 'error');
        } finally {
            this.isLoading = false;
        }
    },

    /**
     * Handle keyboard input
     */
    handleKeyDown(event) {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            this.sendMessage();
        }

        // Auto-resize textarea
        const textarea = event.target;
        setTimeout(() => {
            textarea.style.height = 'auto';
            textarea.style.height = Math.min(textarea.scrollHeight, 100) + 'px';
        }, 0);
    },

    /**
     * Toggle voice input
     */
    toggleVoiceInput() {
        if (!SpeechService.isSupported()) {
            App.showToast('Voice input is not supported in this browser', 'error');
            return;
        }

        const btn = document.getElementById('patient-voice-btn');

        if (this.voiceInputEnabled) {
            // Stop listening
            SpeechService.stopListening();
            this.voiceInputEnabled = false;
            if (btn) btn.classList.remove('active');
        } else {
            // Start listening
            this.voiceInputEnabled = true;
            if (btn) btn.classList.add('active');

            SpeechService.startListening(
                // On result
                (transcript, isFinal) => {
                    const input = document.getElementById('patient-input');
                    if (input) {
                        input.value = transcript;
                        if (isFinal && transcript.trim()) {
                            this.sendMessage();
                            this.toggleVoiceInput(); // Stop after sending
                        }
                    }
                },
                // On error
                (error) => {
                    console.error('Speech recognition error:', error);
                    this.voiceInputEnabled = false;
                    if (btn) btn.classList.remove('active');
                    App.showToast('Voice input error. Please try again.', 'error');
                },
                // On end
                () => {
                    this.voiceInputEnabled = false;
                    if (btn) btn.classList.remove('active');
                }
            );
        }
    },

    /**
     * Toggle voice output
     */
    toggleVoiceOutput() {
        this.voiceOutputEnabled = !this.voiceOutputEnabled;

        const btn = document.getElementById('patient-voice-output-btn');
        if (btn) {
            btn.classList.toggle('muted', !this.voiceOutputEnabled);
            const icon = btn.querySelector('.speaker-icon');
            if (icon) {
                icon.innerHTML = this.voiceOutputEnabled ? '&#128266;' : '&#128263;';
            }
        }

        // Stop any current speech if muting
        if (!this.voiceOutputEnabled && typeof SpeechService !== 'undefined') {
            SpeechService.stop();
        }

        App.showToast(this.voiceOutputEnabled ? 'Voice output enabled' : 'Voice output muted', 'info');
    },

    /**
     * Clear the chat
     */
    clearChat() {
        this.messages = [];
        localStorage.removeItem('patient-chat-history');
        this.renderMessages();
    }
};

window.PatientChat = PatientChat;
