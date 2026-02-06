/**
 * Nurse Chat Component
 * Handles the nurse communication simulation chat interface
 */

const NurseChat = {
    messages: [],
    systemPrompt: null,
    isLoading: false,
    contextLoaded: false,

    /**
     * Initialize the nurse chat
     */
    async init() {
        // Load chat history from localStorage
        this.loadHistory();

        // Load context from Google Doc or use default
        await this.refreshContext();

        // Render existing messages
        this.renderMessages();

        console.log('Nurse Chat initialized');
    },

    /**
     * Refresh context from Google Doc
     */
    async refreshContext() {
        const contextUrl = localStorage.getItem('nurse-context-url');

        if (contextUrl) {
            try {
                const context = await GoogleDocContext.fetchContext(contextUrl);
                if (context) {
                    this.systemPrompt = context;
                    this.contextLoaded = true;
                    return;
                }
            } catch (error) {
                console.warn('Failed to load nurse context:', error);
            }
        }

        // Build context from current scenario
        this.systemPrompt = this.buildNurseContext();
        this.contextLoaded = true;
    },

    /**
     * Build nurse context from current scenario and simulation state
     */
    buildNurseContext() {
        const scenario = SimulationEngine.currentScenario;
        const state = SimulationEngine.getState();
        const patient = PatientHeader.getPatient();

        const patientName = patient ? `${patient.firstName} ${patient.lastName}` : 'Mr. Morrison';

        let context = `You are simulating Sarah, an experienced RN (8 years experience) caring for ${patientName} on a medical floor.

YOUR ROLE:
- You are the patient's bedside nurse on day shift
- You report to the physician/resident (the user) about the patient's status
- You carry out orders and report back on patient responses
- You advocate for patient safety and ask clarifying questions when needed

COMMUNICATION STYLE:
- Professional and efficient
- Use SBAR format when reporting concerns (Situation, Background, Assessment, Recommendation)
- Ask for clarification on orders that seem incomplete or potentially problematic
- Confirm back verbal orders appropriately
- Don't be afraid to push back if something seems wrong (wrong dose, contraindicated, etc.)`;

        if (scenario && (scenario.id === 'SCENARIO_CHF_001' || scenario.name?.includes('CHF'))) {
            context += `

PATIENT CONTEXT:
- ${patientName} is a 72-year-old male admitted for acute CHF exacerbation
- History: Heart failure (EF 32%), diabetes, CKD, A.fib on warfarin
- Allergies: Penicillin (rash)
- He ran out of his Lasix about 5 days ago and got progressively more short of breath
- Currently on telemetry, 2L nasal cannula, strict I&Os`;
        }

        // Add current patient status
        if (state) {
            context += `

CURRENT PATIENT STATUS (use this to inform your reports):`;

            if (state.vitals) {
                const v = state.vitals;
                context += `
- Vitals: BP ${Math.round(v.systolic)}/${Math.round(v.diastolic)}, HR ${Math.round(v.heartRate)}, RR ${Math.round(v.respiratoryRate)}, SpO2 ${Math.round(v.oxygenSaturation)}% on 2L NC, Temp ${v.temperature?.toFixed(1) || '98.4'}°F`;
            }

            if (state.physiology) {
                const p = state.physiology;
                if (p.urineOutput) {
                    context += `
- Urine output: ${Math.round(p.urineOutput)} mL/hr`;
                }
                if (p.fluidOverload !== undefined) {
                    const overload = p.fluidOverload;
                    if (overload > 4) {
                        context += `
- Still appears significantly volume overloaded, +${overload.toFixed(1)} kg from dry weight`;
                    } else if (overload > 2) {
                        context += `
- Moderate volume overload, +${overload.toFixed(1)} kg from dry weight`;
                    } else {
                        context += `
- Getting closer to dry weight, only +${overload.toFixed(1)} kg`;
                    }
                }
            }

            if (state.symptoms) {
                const s = state.symptoms;
                if (s.dyspnea >= 6) {
                    context += `
- Patient appears in respiratory distress, having difficulty speaking`;
                } else if (s.dyspnea >= 4) {
                    context += `
- Patient is short of breath but able to speak in sentences`;
                } else if (s.dyspnea >= 2) {
                    context += `
- Patient reports breathing is improved`;
                }
            }

            if (state.trajectory) {
                if (state.trajectory === 'improving') {
                    context += `
- Overall trending in right direction, patient feeling better`;
                } else if (state.trajectory === 'worsening') {
                    context += `
- Concerned patient may be getting worse, not responding as expected`;
                }
            }
        }

        // Add info about active interventions
        const interventions = InterventionTracker.getActiveInterventions();
        if (interventions.length > 0) {
            context += `

CURRENT TREATMENTS:`;
            interventions.forEach(i => {
                context += `
- ${i.name}${i.dose ? ` ${i.dose}` : ''}${i.route ? ` ${i.route}` : ''} - given ${Math.round(i.elapsedMinutes || 0)} minutes ago`;
            });
        }

        // Add pending labs
        const pendingLabs = DynamicLabs.getPendingLabs();
        if (pendingLabs.length > 0) {
            context += `

PENDING LABS:`;
            pendingLabs.forEach(l => {
                context += `
- ${l.name}: ${l.status}`;
            });
        }

        // Add pending imaging
        if (typeof DynamicImaging !== 'undefined') {
            const pendingImaging = DynamicImaging.getPendingStudies();
            if (pendingImaging.length > 0) {
                context += `

PENDING IMAGING:`;
                pendingImaging.forEach(s => {
                    context += `
- ${s.name}: ${s.status}`;
                });
            }
        }

        context += `

THINGS YOU MIGHT DO:
- Call to report a change in patient status
- Ask for clarification on an order
- Report that you gave a medication and what the response was
- Ask if the doctor wants to adjust treatment based on labs/vitals
- Report concerns about potential side effects
- Request orders you think the patient needs (pain meds, labs, etc.)
- Do nursing assessments and report findings

Keep responses concise and professional, like a real nurse-physician interaction.`;

        return context;
    },

    /**
     * Load chat history from localStorage
     */
    loadHistory() {
        try {
            const saved = localStorage.getItem('nurse-chat-history');
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
            localStorage.setItem('nurse-chat-history', JSON.stringify(toSave));
        } catch (error) {
            console.error('Error saving chat history:', error);
        }
    },

    /**
     * Render all messages to the UI
     */
    renderMessages() {
        const container = document.getElementById('nurse-messages');
        if (!container) return;

        // Clear container but keep welcome message if no messages
        if (this.messages.length === 0) {
            container.innerHTML = `
                <div class="chat-welcome">
                    <div class="welcome-avatar">&#128105;&#8205;&#9877;</div>
                    <h3>Nurse Communication</h3>
                    <p>Practice communication with nursing staff for handoffs, clarifications, and coordination.</p>
                </div>
            `;
            return;
        }

        container.innerHTML = '';
        this.messages.forEach(msg => {
            AIPanel.addMessage('nurse', msg.role, msg.content);
        });
    },

    /**
     * Send a message
     */
    async sendMessage() {
        const input = document.getElementById('nurse-input');
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
        AIPanel.addMessage('nurse', 'user', text);
        this.saveHistory();

        // Show typing indicator
        this.isLoading = true;
        AIPanel.addMessage('nurse', 'assistant', '', true);

        try {
            // Ensure context is loaded
            if (!this.contextLoaded) {
                await this.refreshContext();
            }

            // Format messages for API
            const apiMessages = this.messages.map(m => ({
                role: m.role,
                content: m.content
            }));

            // Send to Claude
            const response = await ClaudeAPI.chat(this.systemPrompt, apiMessages);

            // Remove typing indicator
            AIPanel.removeTypingIndicator('nurse');

            // Add response to UI and history
            this.messages.push({ role: 'assistant', content: response });
            AIPanel.addMessage('nurse', 'assistant', response);
            this.saveHistory();

        } catch (error) {
            console.error('Chat error:', error);
            AIPanel.removeTypingIndicator('nurse');
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
     * Clear the chat
     */
    clearChat() {
        this.messages = [];
        localStorage.removeItem('nurse-chat-history');
        this.renderMessages();
    }
};

window.NurseChat = NurseChat;
