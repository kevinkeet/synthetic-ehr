/**
 * Simulation Engine
 * Core service for managing evolving patient state over simulated time
 */

const SimulationEngine = {
    // Simulation state
    isRunning: false,
    isPaused: false,

    // Time management
    simulationStartTime: null,      // Real time when simulation started
    simulatedTime: null,            // Current simulated datetime
    timeScale: 15,                  // 1 real minute = 15 simulated minutes (default)
    tickInterval: null,
    tickRate: 1000,                 // Update every 1 second real time

    // Scenario
    currentScenario: null,
    scenarioStartTime: null,        // Simulated time when scenario began

    // Patient state
    patientState: null,
    stateHistory: [],               // Track state changes for trending

    // Active interventions
    activeInterventions: [],

    // Listeners
    listeners: new Map(),

    /**
     * Initialize the simulation engine
     */
    init() {
        console.log('Simulation Engine initialized');
    },

    /**
     * Load a scenario and prepare simulation
     * @param {Object} scenario - The scenario definition
     */
    async loadScenario(scenario) {
        this.currentScenario = scenario;

        // Initialize patient state from scenario
        this.patientState = JSON.parse(JSON.stringify(scenario.initialState));
        this.patientState.timestamp = new Date().toISOString();

        // Set scenario start time to TODAY at 2:00 PM (more realistic for a new admission)
        // This ensures simulation labs appear as "today" and sort above historical data
        const today = new Date();
        today.setHours(14, 0, 0, 0); // 2:00 PM
        this.scenarioStartTime = today;
        this.simulatedTime = new Date(this.scenarioStartTime);

        // Clear history and interventions
        this.stateHistory = [{ ...this.patientState, timestamp: this.simulatedTime.toISOString() }];
        this.activeInterventions = [];

        // Reset labs and interventions
        if (typeof DynamicLabs !== 'undefined') {
            DynamicLabs.reset();
        }
        if (typeof InterventionTracker !== 'undefined') {
            InterventionTracker.clear();
        }

        // Emit event
        this.emit('scenarioLoaded', { scenario, state: this.patientState });

        console.log('Scenario loaded:', scenario.name);
    },

    /**
     * Start the simulation
     */
    start() {
        if (!this.currentScenario) {
            console.error('No scenario loaded');
            return;
        }

        if (this.isRunning && !this.isPaused) {
            return; // Already running
        }

        const isNewStart = !this.isRunning;

        this.isRunning = true;
        this.isPaused = false;
        this.simulationStartTime = Date.now();

        // Start the tick loop
        this.tickInterval = setInterval(() => this.tick(), this.tickRate);

        this.emit('simulationStarted', { time: this.simulatedTime, isNewStart });

        // Generate opening message for new scenarios
        if (isNewStart) {
            this.generateOpeningMessage();
        }

        console.log('Simulation started');
    },

    /**
     * Generate scenario opening message (nurse call or patient interaction)
     */
    generateOpeningMessage() {
        const scenario = this.currentScenario;
        if (!scenario) return;

        // Initialize score tracker
        if (typeof SimulationScoreTracker !== 'undefined') {
            SimulationScoreTracker.init();
        }

        // Clear previous chat history for a fresh start
        if (typeof PatientChat !== 'undefined') {
            PatientChat.clearChat();
        }
        if (typeof NurseChat !== 'undefined') {
            NurseChat.clearChat();
        }

        // Generate opening messages based on scenario
        let nurseOpening = '';
        let patientOpening = '';

        if (scenario.id === 'SCENARIO_SOB_001' || scenario.name?.includes('Shortness of Breath')) {
            nurseOpening = `Doctor, you have a new admission in room 412 - Mr. Robert Morrison, 72-year-old male. His wife brought him to the ED saying he's "not been himself." The ED was slammed and barely got any history. Vitals: BP 158/92, HR 102 irregular, RR 24, SpO2 92% on 2L NC. He's on telemetry but no admission orders have been placed. He's asking to see his doctor.`;

            patientOpening = `Doc... are you my doctor? Nobody's told me what's going on. My wife dragged me here and they've been poking me with needles and sticking things on my chest but nobody will tell me what they think is wrong. Can you at least tell me what's happening?`;
        } else {
            nurseOpening = `Doctor, I'm calling about your new admission. The patient just arrived on the floor and is getting settled. Initial vitals have been obtained. Let me know if you have any orders or would like to come evaluate.`;
            patientOpening = '';
        }

        // Use setTimeout to ensure this runs after the chat clear is complete
        setTimeout(() => {
            if (typeof NurseChat !== 'undefined' && typeof FloatingChat !== 'undefined') {
                // Add nurse opening message
                NurseChat.messages.push({ role: 'assistant', content: nurseOpening });
                NurseChat.saveHistory();

                const container = document.getElementById('nurse-messages');
                if (container) {
                    const welcome = container.querySelector('.chat-welcome');
                    if (welcome) welcome.remove();
                    FloatingChat.addMessage('nurse', 'assistant', nurseOpening);
                }
            }

            // Show challenge banner
            this.showChallengeBanner();

            // Show toast notification
            if (typeof App !== 'undefined') {
                App.showToast('New admission - patient is waiting for you', 'info');
            }
        }, 100);

        // Patient speaks after a short delay (feels like arriving at bedside)
        if (patientOpening) {
            setTimeout(() => {
                if (typeof PatientChat !== 'undefined' && typeof FloatingChat !== 'undefined') {
                    PatientChat.messages.push({ role: 'assistant', content: patientOpening });
                    PatientChat.saveHistory();

                    const container = document.getElementById('patient-messages');
                    if (container) {
                        const welcome = container.querySelector('.chat-welcome');
                        if (welcome) welcome.remove();
                        FloatingChat.addMessage('patient', 'assistant', patientOpening);
                    }

                    // Ensure patient chat is visible
                    FloatingChat.openChat('patient');

                    if (typeof SpeechService !== 'undefined' && PatientChat.voiceOutputEnabled) {
                        SpeechService.speak(patientOpening);
                    }
                }
            }, 3000);
        }
    },

    // Store challenge text for debrief reference
    _challengeText: 'New admission. Gather history from the patient, ask the nurse key questions, review the chart for critical information, and place all necessary orders.',

    /**
     * Show the clinical challenge banner at the top of the main content area
     */
    showChallengeBanner() {
        // Remove existing banner if present
        const existing = document.getElementById('simulation-challenge-banner');
        if (existing) existing.remove();

        const banner = document.createElement('div');
        banner.id = 'simulation-challenge-banner';
        banner.className = 'simulation-challenge-banner';
        banner.innerHTML = `
            <div class="challenge-banner-content">
                <div class="challenge-banner-icon">&#127919;</div>
                <div class="challenge-banner-text">
                    <strong>CLINICAL CHALLENGE</strong>: ${this._challengeText}
                </div>
                <button class="challenge-banner-dismiss" onclick="SimulationEngine.minimizeChallengeBanner()" title="Minimize">&#8722;</button>
            </div>
        `;

        const mainContent = document.getElementById('main-content');
        if (mainContent) {
            mainContent.parentElement.insertBefore(banner, mainContent);
        }
    },

    /**
     * Minimize the challenge banner to a compact strip
     */
    minimizeChallengeBanner() {
        const banner = document.getElementById('simulation-challenge-banner');
        if (banner) {
            banner.classList.add('minimized');
            banner.innerHTML = `
                <div class="challenge-banner-minimized" onclick="SimulationEngine.restoreChallengeBanner()">
                    <span class="challenge-minimized-icon">&#127919;</span>
                    <span class="challenge-minimized-text">Clinical Challenge</span>
                    <span class="challenge-expand-icon">&#9650;</span>
                </div>
            `;
        }
    },

    /**
     * Restore the challenge banner from minimized state
     */
    restoreChallengeBanner() {
        this.showChallengeBanner();
    },

    /**
     * Get a random doctor name for more realistic messages
     */
    getRandomDoctorName() {
        const names = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis'];
        return names[Math.floor(Math.random() * names.length)];
    },

    /**
     * Pause the simulation
     */
    pause() {
        if (!this.isRunning || this.isPaused) return;

        this.isPaused = true;
        if (this.tickInterval) {
            clearInterval(this.tickInterval);
            this.tickInterval = null;
        }

        this.emit('simulationPaused', { time: this.simulatedTime });
        console.log('Simulation paused');
    },

    /**
     * Resume the simulation
     */
    resume() {
        if (!this.isRunning || !this.isPaused) return;

        this.isPaused = false;
        this.tickInterval = setInterval(() => this.tick(), this.tickRate);

        this.emit('simulationResumed', { time: this.simulatedTime });
        console.log('Simulation resumed');
    },

    /**
     * Stop the simulation
     */
    stop() {
        this.isRunning = false;
        this.isPaused = false;

        if (this.tickInterval) {
            clearInterval(this.tickInterval);
            this.tickInterval = null;
        }

        this.emit('simulationStopped', { time: this.simulatedTime });
        console.log('Simulation stopped');
    },

    /**
     * Reset simulation to initial state — clears ALL session artifacts
     * so the user gets a completely fresh start.
     */
    reset() {
        this.stop();

        // ---- Clear all persisted simulation state ----

        // 1. Clear user-submitted orders
        sessionStorage.removeItem('pendingOrders');

        // 2. Clear AI-generated clinical notes
        localStorage.removeItem('ehr-generated-notes');

        // 3. Clear AI assistant state and memory
        if (typeof AICoworker !== 'undefined') {
            // Clear completed actions tracker
            AICoworker._completedActions = new Set();
            AICoworker._pendingActions = {};
            AICoworker._pendingActionCategories = {};

            // Clear the longitudinal document (AI memory)
            if (AICoworker.longitudinalDoc) {
                const patientId = AICoworker.longitudinalDoc.metadata?.patientId;
                if (patientId) {
                    localStorage.removeItem(`longitudinalDoc_${patientId}`);
                }
                AICoworker.longitudinalDoc = null;
                AICoworker.longitudinalDocUpdater = null;
                AICoworker.longitudinalDocRenderer = null;
                AICoworker.longitudinalDocBuilder = null;
            }

            // Reset in-memory session state (clears aiAssistantState from localStorage too)
            AICoworker.resetSessionState();

            // Re-initialize with current patient so it rebuilds fresh
            const patient = typeof PatientHeader !== 'undefined' ? PatientHeader.getPatient() : null;
            if (patient) {
                AICoworker.onPatientLoaded(patient.id || patient.patientId || 'default');
            }
        }

        // 4. Clear chat histories (chats will also be cleared by loadScenario → generateOpeningMessage)
        localStorage.removeItem('patient-chat-history');
        localStorage.removeItem('nurse-chat-history');
        if (typeof PatientChat !== 'undefined') {
            PatientChat.messages = [];
        }
        if (typeof NurseChat !== 'undefined') {
            NurseChat.messages = [];
        }

        // ---- Reload scenario ----

        if (this.currentScenario) {
            this.loadScenario(this.currentScenario);
        }

        this.emit('simulationReset', {});

        // Re-render AI panel to show fresh state
        if (typeof AICoworker !== 'undefined') {
            AICoworker.render();
        }

        console.log('Simulation fully reset — all session state cleared');
    },

    /**
     * Set time scale (how fast simulation runs)
     * @param {number} scale - Minutes of sim time per real minute
     */
    setTimeScale(scale) {
        this.timeScale = scale;
        this.emit('timeScaleChanged', { scale });
    },

    /**
     * Main simulation tick - called every tickRate ms
     */
    tick() {
        // Advance simulated time
        const realElapsed = this.tickRate / 1000 / 60; // Real minutes elapsed
        const simMinutes = realElapsed * this.timeScale;

        this.simulatedTime = new Date(this.simulatedTime.getTime() + simMinutes * 60 * 1000);

        // Process natural disease progression
        PhysiologyEngine.processNaturalProgression(this.patientState, simMinutes, this.currentScenario);

        // Process active interventions
        InterventionTracker.processInterventions(this.patientState, simMinutes, this.simulatedTime);

        // Check for scenario events/triggers
        this.checkScenarioTriggers();

        // Update timestamp
        this.patientState.timestamp = this.simulatedTime.toISOString();

        // Record state periodically (every 15 sim minutes)
        const lastRecord = this.stateHistory[this.stateHistory.length - 1];
        const lastTime = new Date(lastRecord.timestamp);
        if ((this.simulatedTime - lastTime) >= 15 * 60 * 1000) {
            this.stateHistory.push({ ...this.patientState, timestamp: this.simulatedTime.toISOString() });

            // Keep only last 24 hours of history
            const cutoff = new Date(this.simulatedTime.getTime() - 24 * 60 * 60 * 1000);
            this.stateHistory = this.stateHistory.filter(s => new Date(s.timestamp) >= cutoff);
        }

        // Emit tick event
        this.emit('tick', {
            time: this.simulatedTime,
            state: this.patientState,
            simMinutesElapsed: simMinutes
        });
    },

    /**
     * Check and trigger scenario events based on current state/time
     */
    checkScenarioTriggers() {
        if (!this.currentScenario || !this.currentScenario.triggers) return;

        for (const trigger of this.currentScenario.triggers) {
            if (trigger.triggered) continue; // Already triggered

            let shouldTrigger = false;

            // Time-based trigger
            if (trigger.type === 'time') {
                const elapsed = (this.simulatedTime - this.scenarioStartTime) / (60 * 1000); // minutes
                shouldTrigger = elapsed >= trigger.atMinutes;
            }

            // State-based trigger
            if (trigger.type === 'state') {
                shouldTrigger = this.evaluateCondition(trigger.condition);
            }

            // Intervention-based trigger
            if (trigger.type === 'intervention') {
                shouldTrigger = InterventionTracker.hasIntervention(trigger.interventionType);
            }

            if (shouldTrigger) {
                trigger.triggered = true;
                this.executeTriggerAction(trigger);
            }
        }
    },

    /**
     * Evaluate a condition against current state
     */
    evaluateCondition(condition) {
        const value = this.getStateValue(condition.parameter);

        switch (condition.operator) {
            case '<': return value < condition.value;
            case '<=': return value <= condition.value;
            case '>': return value > condition.value;
            case '>=': return value >= condition.value;
            case '==': return value === condition.value;
            default: return false;
        }
    },

    /**
     * Get a value from patient state by path (e.g., "vitals.heartRate")
     */
    getStateValue(path) {
        return path.split('.').reduce((obj, key) => obj?.[key], this.patientState);
    },

    /**
     * Execute a trigger action
     */
    executeTriggerAction(trigger) {
        console.log('Trigger activated:', trigger.name);

        // Apply state changes if specified
        if (trigger.stateChanges) {
            this.applyStateChanges(trigger.stateChanges);
        }

        if (trigger.action === 'modifyState') {
            Object.assign(this.patientState, trigger.stateChanges);
        }

        if (trigger.action === 'nurseAlert') {
            this.emit('nurseAlert', { message: trigger.message, priority: trigger.priority });

            // Add to nurse chat
            if (typeof NurseChat !== 'undefined') {
                NurseChat.messages.push({ role: 'assistant', content: trigger.message });
                NurseChat.saveHistory();
                if (typeof FloatingChat !== 'undefined') {
                    // Ensure AI panel is visible
                    FloatingChat.openChat('nurse');
                    FloatingChat.addMessage('nurse', 'assistant', trigger.message);
                }
            }

            // Show toast notification
            if (typeof App !== 'undefined') {
                const icon = trigger.priority === 'urgent' ? '🚨' : '📞';
                App.showToast(`${icon} Urgent call from the nurse!`, trigger.priority === 'urgent' ? 'error' : 'warning');
            }

            // If this is the A-fib trigger, make EKG available and show a prompt
            if (trigger.id === 'TRIG_AFIB' && typeof ClinicalImages !== 'undefined') {
                // Show EKG availability toast after a short delay
                setTimeout(function() {
                    if (typeof App !== 'undefined') {
                        App.showToast('📊 EKG ready for review - click to view', 'info', 8000);
                    }
                }, 2000);
            }
        }

        if (trigger.action === 'labResult') {
            this.emit('labResult', { labs: trigger.labs });
        }

        if (trigger.action === 'patientAlert') {
            this.emit('patientAlert', { message: trigger.message, priority: trigger.priority });

            // Mark emotional trigger for score tracking
            if (trigger.id === 'TRIG_EMOTIONAL' && typeof SimulationScoreTracker !== 'undefined') {
                SimulationScoreTracker.markEmotionalTrigger();
            }

            // Add to patient chat - patient speaks directly
            if (typeof PatientChat !== 'undefined') {
                PatientChat.messages.push({ role: 'assistant', content: trigger.message });
                PatientChat.saveHistory();
                if (typeof FloatingChat !== 'undefined') {
                    // Ensure patient chat is visible
                    FloatingChat.openChat('patient');
                    FloatingChat.addMessage('patient', 'assistant', trigger.message);
                }
            }

            // Show toast notification
            if (typeof App !== 'undefined') {
                App.showToast('😰 Patient needs your attention...', 'warning');
            }
        }

        // Track decision points
        if (trigger.decisionPoint) {
            this.trackDecisionPoint(trigger.decisionPoint);
        }

        this.emit('triggerActivated', { trigger });
    },

    /**
     * Apply nested state changes
     */
    applyStateChanges(changes) {
        for (const [key, value] of Object.entries(changes)) {
            if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                if (!this.patientState[key]) {
                    this.patientState[key] = {};
                }
                Object.assign(this.patientState[key], value);
            } else {
                this.patientState[key] = value;
            }
        }
    },

    // Decision point tracking
    decisionPoints: [],
    userDecisions: [],

    /**
     * Track a decision point for later evaluation
     */
    trackDecisionPoint(decisionPoint) {
        decisionPoint.triggeredAt = this.simulatedTime;
        this.decisionPoints.push(decisionPoint);
        console.log('Decision point active:', decisionPoint.name);
    },

    /**
     * Record a user decision
     */
    recordDecision(decisionId, action, details) {
        this.userDecisions.push({
            decisionId,
            action,
            details,
            timestamp: this.simulatedTime
        });
        console.log('Decision recorded:', decisionId, action);
    },

    /**
     * Get evaluation of user decisions
     */
    evaluateDecisions() {
        const results = [];

        for (const dp of this.decisionPoints) {
            const relatedDecisions = this.userDecisions.filter(d =>
                d.timestamp >= dp.triggeredAt
            );

            // Check for incorrect actions
            const incorrectActions = relatedDecisions.filter(d =>
                dp.incorrectActions?.some(ia =>
                    d.action.toLowerCase().includes(ia.toLowerCase())
                )
            );

            // Check for correct actions
            const correctActions = relatedDecisions.filter(d =>
                dp.correctActions?.some(ca =>
                    d.action.toLowerCase().includes(ca.toLowerCase())
                )
            );

            results.push({
                decisionPoint: dp.name,
                description: dp.description,
                teachingPoint: dp.teachingPoint,
                incorrectActionsTaken: incorrectActions.length > 0,
                correctActionsTaken: correctActions.length > 0,
                details: {
                    incorrect: incorrectActions,
                    correct: correctActions
                }
            });
        }

        return results;
    },

    /**
     * Apply an intervention (when order is placed)
     */
    applyIntervention(intervention) {
        InterventionTracker.addIntervention(intervention, this.simulatedTime);
        this.emit('interventionApplied', { intervention, time: this.simulatedTime });
    },

    /**
     * Get current patient state
     */
    getState() {
        return this.patientState;
    },

    /**
     * Get state history for trending
     */
    getStateHistory() {
        return this.stateHistory;
    },

    /**
     * Get current simulated time
     */
    getSimulatedTime() {
        return this.simulatedTime;
    },

    /**
     * Get elapsed simulation time in minutes
     */
    getElapsedMinutes() {
        if (!this.scenarioStartTime || !this.simulatedTime) return 0;
        return (this.simulatedTime - this.scenarioStartTime) / (60 * 1000);
    },

    /**
     * Subscribe to simulation events
     */
    on(event, callback) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, []);
        }
        this.listeners.get(event).push(callback);
    },

    /**
     * Unsubscribe from simulation events
     */
    off(event, callback) {
        if (!this.listeners.has(event)) return;
        const callbacks = this.listeners.get(event);
        const index = callbacks.indexOf(callback);
        if (index > -1) {
            callbacks.splice(index, 1);
        }
    },

    /**
     * Emit an event to all listeners
     */
    emit(event, data) {
        if (!this.listeners.has(event)) return;
        for (const callback of this.listeners.get(event)) {
            try {
                callback(data);
            } catch (error) {
                console.error(`Error in simulation event handler for ${event}:`, error);
            }
        }
    },

    /**
     * Generate current vitals for display
     */
    getCurrentVitals() {
        if (!this.patientState || !this.patientState.vitals) return null;

        const v = this.patientState.vitals;
        return {
            date: this.simulatedTime?.toISOString() || new Date().toISOString(),
            bloodPressure: `${Math.round(v.systolic)}/${Math.round(v.diastolic)}`,
            heartRate: Math.round(v.heartRate),
            respiratoryRate: Math.round(v.respiratoryRate),
            temperature: v.temperature?.toFixed(1),
            oxygenSaturation: Math.round(v.oxygenSaturation),
            weight: v.weight?.toFixed(1)
        };
    },

    /**
     * Get patient symptoms description for AI chat context
     */
    getSymptomsDescription() {
        if (!this.patientState) return '';

        const symptoms = [];
        const state = this.patientState;

        // Respiratory symptoms
        if (state.symptoms?.dyspnea) {
            const severity = state.symptoms.dyspnea;
            if (severity >= 7) symptoms.push('severe shortness of breath, even at rest');
            else if (severity >= 5) symptoms.push('moderate shortness of breath with minimal activity');
            else if (severity >= 3) symptoms.push('mild shortness of breath with exertion');
        }

        // Edema
        if (state.physiology?.fluidOverload > 2) {
            symptoms.push('noticeable leg swelling');
        }

        // Fatigue
        if (state.symptoms?.fatigue >= 5) {
            symptoms.push('feeling very tired');
        }

        // Orthopnea
        if (state.symptoms?.orthopnea) {
            symptoms.push(`need to sleep on ${state.symptoms.orthopneaPillows || 3} pillows`);
        }

        // Chest discomfort
        if (state.symptoms?.chestDiscomfort) {
            symptoms.push('some chest tightness');
        }

        // Improvement indicators
        if (state.trajectory === 'improving') {
            symptoms.push('feeling somewhat better than before');
        } else if (state.trajectory === 'worsening') {
            symptoms.push('feeling worse than before');
        }

        return symptoms.join(', ');
    }
};

window.SimulationEngine = SimulationEngine;
