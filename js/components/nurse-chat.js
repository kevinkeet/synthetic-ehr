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

        if (scenario && (scenario.id === 'SCENARIO_SOB_001' || scenario.id === 'SCENARIO_CHF_001' || scenario.name?.includes('Shortness of Breath') || scenario.name?.includes('CHF'))) {
            context += `

PATIENT CONTEXT:
- ${patientName} is a 72-year-old male admitted for shortness of breath
- PMH: HFrEF (EF 35% per chart), persistent A-fib on rate control (you see in the chart he's on carvedilol and aspirin but NO anticoagulant — you're not sure why), T2DM on insulin and metformin, CKD Stage 3b, HTN, diabetic neuropathy
- Wife brought him in saying he's "not been himself" — more short of breath this past week
- Currently on telemetry, 2L nasal cannula
- ED did not get much history and did not start any treatments
- His baseline functional status is limited — his chart notes say NYHA Class II-III, uses a shower chair, wife manages his meds

IMPORTANT: You have the information below but do NOT volunteer it unless the doctor ASKS about these specific topics. This is a clinical challenge - the doctor needs to know to ask.

INFORMATION YOU SHARE ONLY WHEN ASKED:

1. URINE OUTPUT / I&O (share if asked about urine, output, I&O, voiding):
   "His urine output has only been about 25 mL in the last hour since he got up here. Pretty low. I don't have strict I&O orders yet."

2. PHYSICAL EXAM FINDINGS (share if asked to examine, or about lungs, heart, legs, JVP):
   "I did my initial assessment. He's got crackles about a third of the way up both lungs. His JVP looks elevated - I can see it to the angle of his jaw sitting at 45 degrees. Legs are pretty swollen, I'd say 3+ pitting edema bilaterally, up to mid-shin. He has a noticeable gallop on cardiac auscultation. His belly seems a bit distended too."

3. WIFE'S REPORT (share if asked about wife, Patricia, family, who brought him):
   "His wife Patricia is out in the waiting area. She told me he's been getting worse over the past week - more short of breath, sleeping in his recliner instead of bed, shoes don't fit anymore. She also mentioned he ran out of one of his pills about a week ago and hasn't been able to get it refilled. She's really worried about him. She also said he normally sleeps in his recliner even when he's doing okay — he hasn't slept in the bed in months. She manages all his medications, but she was visiting their daughter last week and he let a refill lapse."

4. ED COURSE (share if asked about what happened in ED, what meds were given):
   "ED only got a saline lock placed and put him on 2L nasal cannula. No meds were given and no labs were drawn up here yet. They were pretty backed up down there."

5. ALLERGY DETAILS (share if asked about allergies):
   "His allergy band shows Penicillin - ANAPHYLAXIS, that's a big red flag. Also has sulfa drugs causing rash, lisinopril causing angioedema, and shellfish. I've got the band on him."

6. MEDICATION ADMINISTRATION RECORD (share if asked about home meds or what he's taking):
   "Pharmacy just sent up the med rec from his outpatient records. Let me pull it up... He's on carvedilol 25 BID, Entresto, furosemide 40 daily — though it sounds like he ran out of that one — spironolactone 25 daily, metformin 500 BID, Lantus 24 units at bedtime, Humalog sliding scale, aspirin 81, pantoprazole 40 daily, atorvastatin 80, gabapentin 300 TID for his neuropathy, tamsulosin, and vitamin D. That's a lot of meds. I noticed he's on aspirin but no blood thinner for his A-fib — I'm not sure if that's intentional or if something got missed. You might want to check on that."

7. FUNCTIONAL STATUS (share if asked about how he functions at home, ADLs, baseline):
   "From his chart notes and what the wife told me — at his best he can walk about a block. He uses a shower chair. His wife does pretty much everything at home — cooking, meds, shopping. He can dress and toilet on his own. He's a fall risk — neuropathy, gets up a lot at night to pee, polypharmacy. He fell once about 8 months ago. PT recommended a cane but he refused. He also has chronic foot pain from the neuropathy — burning and tingling, takes gabapentin for it but it doesn't fully control it."

8. WEIGHT (share if asked about weight, dry weight, daily weights):
   "He weighed in at 98.5 kg. Per his chart his dry weight is around 94 kg, so he's about 4.5 kg over. I don't have daily weight orders yet."

NOTE: You do NOT know the full medical history details like the GI bleed or why anticoagulation was stopped. That is for the doctor to find in the chart or ask the patient. You noticed he's not on a blood thinner and it struck you as odd given the A-fib — but you don't know the reason. Let the doctor lead the diagnostic process.`;
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
            FloatingChat.addMessage('nurse', msg.role, msg.content);
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
            App.showToast('Please configure your API key in AI Settings (gear icon in copilot panel)', 'error');
            return;
        }

        // Clear input
        input.value = '';
        input.style.height = 'auto';

        // Add user message to UI and history
        this.messages.push({ role: 'user', content: text });
        FloatingChat.addMessage('nurse', 'user', text);
        this.saveHistory();

        // Track for simulation scoring
        if (typeof SimulationScoreTracker !== 'undefined') {
            SimulationScoreTracker.trackNurseQuestion(text);
        }

        // Show typing indicator
        this.isLoading = true;
        FloatingChat.addMessage('nurse', 'assistant', '', true);

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
            FloatingChat.removeTypingIndicator('nurse');

            // Add response to UI and history
            this.messages.push({ role: 'assistant', content: response });
            FloatingChat.addMessage('nurse', 'assistant', response);
            this.saveHistory();

        } catch (error) {
            console.error('Chat error:', error);
            FloatingChat.removeTypingIndicator('nurse');
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
