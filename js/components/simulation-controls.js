/**
 * Simulation Controls Component
 * UI for controlling the patient simulation
 */

const SimulationControls = {
    isExpanded: false,
    updateInterval: null,

    /**
     * Initialize the simulation controls
     */
    init() {
        this.createControlsUI();
        this.setupEventListeners();
        this.loadDefaultScenario();
    },

    /**
     * Create the controls UI in the header
     */
    createControlsUI() {
        // Add simulation controls to header
        const headerRight = document.querySelector('.header-right');
        if (!headerRight) return;

        const controlsHTML = `
            <div class="sim-controls" id="sim-controls">
                <div class="sim-status" id="sim-status" onclick="SimulationControls.toggleExpanded()">
                    <span class="sim-indicator stopped"></span>
                    <span class="sim-time" id="sim-time">--:--</span>
                    <span class="sim-label">Simulation</span>
                </div>
                <div class="sim-panel" id="sim-panel">
                    <div class="sim-panel-header">
                        <h4>Patient Simulation</h4>
                        <button class="sim-close" onclick="SimulationControls.toggleExpanded()">&times;</button>
                    </div>
                    <div class="sim-panel-body">
                        <div class="sim-scenario">
                            <label>Scenario</label>
                            <select id="sim-scenario-select" onchange="SimulationControls.onScenarioChange()">
                                <option value="chf-exacerbation">Shortness of Breath</option>
                            </select>
                        </div>
                        <div class="sim-time-display">
                            <div class="sim-clock" id="sim-clock-display">
                                <span class="clock-date">Aug 15, 2022</span>
                                <span class="clock-time">2:00 PM</span>
                            </div>
                            <div class="sim-elapsed" id="sim-elapsed">
                                Elapsed: 0h 0m
                            </div>
                        </div>
                        <div class="sim-speed">
                            <label>Speed</label>
                            <div class="speed-buttons">
                                <button class="speed-btn" data-speed="1" onclick="SimulationControls.setSpeed(1)">1x</button>
                                <button class="speed-btn active" data-speed="15" onclick="SimulationControls.setSpeed(15)">15x</button>
                                <button class="speed-btn" data-speed="60" onclick="SimulationControls.setSpeed(60)">60x</button>
                                <button class="speed-btn" data-speed="180" onclick="SimulationControls.setSpeed(180)">3h/m</button>
                            </div>
                        </div>
                        <div class="sim-buttons">
                            <button class="sim-btn sim-start" id="sim-start-btn" onclick="SimulationControls.showBriefing()">
                                <span>&#9658;</span> Start
                            </button>
                            <button class="sim-btn sim-pause" id="sim-pause-btn" onclick="SimulationControls.pause()" style="display:none;">
                                <span>&#10074;&#10074;</span> Pause
                            </button>
                            <button class="sim-btn sim-resume" id="sim-resume-btn" onclick="SimulationControls.resume()" style="display:none;">
                                <span>&#9658;</span> Resume
                            </button>
                            <button class="sim-btn sim-reset" onclick="SimulationControls.reset()">
                                <span>&#8635;</span> Reset
                            </button>
                            <button class="sim-btn sim-debrief" id="sim-debrief-btn" onclick="SimulationControls.showDebrief()" title="View simulation debrief">
                                <span>&#128203;</span> Debrief
                            </button>
                        </div>
                        <div class="sim-vitals-preview" id="sim-vitals-preview">
                            <h5>Current Vitals</h5>
                            <div class="vitals-grid">
                                <div class="vital-item">
                                    <span class="vital-label">BP</span>
                                    <span class="vital-value" id="sim-bp">--/--</span>
                                </div>
                                <div class="vital-item">
                                    <span class="vital-label">HR</span>
                                    <span class="vital-value" id="sim-hr">--</span>
                                </div>
                                <div class="vital-item">
                                    <span class="vital-label">RR</span>
                                    <span class="vital-value" id="sim-rr">--</span>
                                </div>
                                <div class="vital-item">
                                    <span class="vital-label">SpO2</span>
                                    <span class="vital-value" id="sim-spo2">--%</span>
                                </div>
                                <div class="vital-item">
                                    <span class="vital-label">Wt</span>
                                    <span class="vital-value" id="sim-weight">-- kg</span>
                                </div>
                                <div class="vital-item">
                                    <span class="vital-label">UOP</span>
                                    <span class="vital-value" id="sim-uop">-- mL/hr</span>
                                </div>
                            </div>
                        </div>
                        <div class="sim-status-text" id="sim-status-text">
                            Ready to start simulation
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Insert before current time
        const currentTime = headerRight.querySelector('.current-time');
        if (currentTime) {
            currentTime.insertAdjacentHTML('beforebegin', controlsHTML);
        } else {
            headerRight.insertAdjacentHTML('afterbegin', controlsHTML);
        }
    },

    /**
     * Setup event listeners for simulation events
     */
    setupEventListeners() {
        // Listen for simulation events
        SimulationEngine.on('tick', (data) => this.onTick(data));
        SimulationEngine.on('simulationStarted', () => this.onStart());
        SimulationEngine.on('simulationPaused', () => this.onPause());
        SimulationEngine.on('simulationResumed', () => this.onResume());
        SimulationEngine.on('simulationStopped', () => this.onStop());
        SimulationEngine.on('simulationReset', () => this.onReset());
        SimulationEngine.on('scenarioLoaded', (data) => this.onScenarioLoaded(data));
        SimulationEngine.on('nurseAlert', (data) => this.onNurseAlert(data));
        SimulationEngine.on('interventionApplied', (data) => this.onInterventionApplied(data));
    },

    /**
     * Load the default scenario
     */
    async loadDefaultScenario() {
        try {
            const response = await fetch('data/scenarios/chf-exacerbation.json');
            const scenario = await response.json();
            await SimulationEngine.loadScenario(scenario);
        } catch (error) {
            console.error('Error loading scenario:', error);
        }
    },

    /**
     * Toggle expanded panel
     */
    toggleExpanded() {
        this.isExpanded = !this.isExpanded;
        const panel = document.getElementById('sim-panel');
        if (panel) {
            panel.classList.toggle('expanded', this.isExpanded);
        }
    },

    /**
     * Start simulation
     */
    start() {
        SimulationEngine.start();
    },

    /**
     * Pause simulation
     */
    pause() {
        SimulationEngine.pause();
    },

    /**
     * Resume simulation
     */
    resume() {
        SimulationEngine.resume();
    },

    /**
     * Reset simulation
     */
    reset() {
        SimulationEngine.reset();
    },

    /**
     * Set simulation speed
     */
    setSpeed(speed) {
        SimulationEngine.setTimeScale(speed);

        // Update button states
        document.querySelectorAll('.speed-btn').forEach(btn => {
            btn.classList.toggle('active', parseInt(btn.dataset.speed) === speed);
        });
    },

    /**
     * Handle scenario change
     */
    async onScenarioChange() {
        const select = document.getElementById('sim-scenario-select');
        const scenarioId = select.value;

        try {
            const response = await fetch(`data/scenarios/${scenarioId}.json`);
            const scenario = await response.json();
            await SimulationEngine.loadScenario(scenario);
        } catch (error) {
            console.error('Error loading scenario:', error);
            App.showToast('Error loading scenario', 'error');
        }
    },

    /**
     * Handle simulation tick
     */
    onTick(data) {
        this.updateTimeDisplay(data.time);
        this.updateVitalsPreview(data.state);
        this.updateStatusIndicator('running');
    },

    /**
     * Handle simulation start
     */
    onStart() {
        document.getElementById('sim-start-btn').style.display = 'none';
        document.getElementById('sim-pause-btn').style.display = '';
        document.getElementById('sim-resume-btn').style.display = 'none';
        this.updateStatusIndicator('running');
        this.updateStatusText('Simulation running...');

        // Auto-expand sim panel so user sees controls
        if (!this.isExpanded) {
            this.toggleExpanded();
        }
    },

    /**
     * Handle simulation pause
     */
    onPause() {
        document.getElementById('sim-start-btn').style.display = 'none';
        document.getElementById('sim-pause-btn').style.display = 'none';
        document.getElementById('sim-resume-btn').style.display = '';
        this.updateStatusIndicator('paused');
        this.updateStatusText('Simulation paused');
    },

    /**
     * Handle simulation resume
     */
    onResume() {
        document.getElementById('sim-start-btn').style.display = 'none';
        document.getElementById('sim-pause-btn').style.display = '';
        document.getElementById('sim-resume-btn').style.display = 'none';
        this.updateStatusIndicator('running');
        this.updateStatusText('Simulation running...');
    },

    /**
     * Handle simulation stop
     */
    onStop() {
        document.getElementById('sim-start-btn').style.display = '';
        document.getElementById('sim-pause-btn').style.display = 'none';
        document.getElementById('sim-resume-btn').style.display = 'none';
        this.updateStatusIndicator('stopped');
        this.updateStatusText('Simulation stopped');
    },

    /**
     * Handle simulation reset
     */
    onReset() {
        document.getElementById('sim-start-btn').style.display = '';
        document.getElementById('sim-pause-btn').style.display = 'none';
        document.getElementById('sim-resume-btn').style.display = 'none';
        this.updateStatusIndicator('stopped');
        this.updateStatusText('Ready to start simulation');

        // Reset displays
        const time = SimulationEngine.getSimulatedTime();
        if (time) {
            this.updateTimeDisplay(time);
        }
        const state = SimulationEngine.getState();
        if (state) {
            this.updateVitalsPreview(state);
        }
    },

    /**
     * Handle scenario loaded
     */
    onScenarioLoaded(data) {
        this.updateStatusText(`Loaded: ${data.scenario.name}`);
        this.updateTimeDisplay(SimulationEngine.getSimulatedTime());
        this.updateVitalsPreview(data.state);
    },

    /**
     * Handle nurse alert
     */
    onNurseAlert(data) {
        // Show toast notification
        const toastType = data.priority === 'urgent' ? 'warning' : 'info';
        App.showToast(`Nurse: ${data.message}`, toastType, 8000);

        // Add to nurse chat if available
        if (typeof NurseChat !== 'undefined') {
            NurseChat.messages.push({
                role: 'assistant',
                content: data.message
            });
            NurseChat.saveHistory();

            // Update UI - use FloatingChat to add messages
            if (typeof FloatingChat !== 'undefined') {
                FloatingChat.addMessage('nurse', 'assistant', data.message);
            }
        }
    },

    /**
     * Handle intervention applied
     */
    onInterventionApplied(data) {
        this.updateStatusText(`Intervention: ${data.intervention.name}`);
    },

    /**
     * Update time display
     */
    updateTimeDisplay(time) {
        if (!time) return;

        const date = new Date(time);

        // Update header time
        const simTime = document.getElementById('sim-time');
        if (simTime) {
            simTime.textContent = date.toLocaleTimeString('en-US', {
                hour: 'numeric',
                minute: '2-digit',
                hour12: true
            });
        }

        // Update panel clock
        const clockDate = document.querySelector('.clock-date');
        const clockTime = document.querySelector('.clock-time');
        if (clockDate) {
            clockDate.textContent = date.toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric'
            });
        }
        if (clockTime) {
            clockTime.textContent = date.toLocaleTimeString('en-US', {
                hour: 'numeric',
                minute: '2-digit',
                hour12: true
            });
        }

        // Update elapsed time
        const elapsed = document.getElementById('sim-elapsed');
        if (elapsed) {
            const minutes = SimulationEngine.getElapsedMinutes();
            const hours = Math.floor(minutes / 60);
            const mins = Math.floor(minutes % 60);
            elapsed.textContent = `Elapsed: ${hours}h ${mins}m`;
        }
    },

    /**
     * Update vitals preview
     */
    updateVitalsPreview(state) {
        if (!state || !state.vitals) return;

        const v = state.vitals;
        const p = state.physiology || {};

        this.setVitalValue('sim-bp', `${Math.round(v.systolic || 0)}/${Math.round(v.diastolic || 0)}`);
        this.setVitalValue('sim-hr', Math.round(v.heartRate || 0));
        this.setVitalValue('sim-rr', Math.round(v.respiratoryRate || 0));
        this.setVitalValue('sim-spo2', `${Math.round(v.oxygenSaturation || 0)}%`);
        this.setVitalValue('sim-weight', `${(v.weight || 0).toFixed(1)} kg`);
        this.setVitalValue('sim-uop', `${Math.round(p.urineOutput || 0)} mL/hr`);
    },

    /**
     * Set a vital value with color coding
     */
    setVitalValue(id, value) {
        const el = document.getElementById(id);
        if (el) {
            el.textContent = value;
        }
    },

    /**
     * Update status indicator
     */
    updateStatusIndicator(status) {
        const indicator = document.querySelector('.sim-indicator');
        if (indicator) {
            indicator.className = 'sim-indicator ' + status;
        }
    },

    /**
     * Update status text
     */
    updateStatusText(text) {
        const statusText = document.getElementById('sim-status-text');
        if (statusText) {
            statusText.textContent = text;
        }
    },

    /**
     * Show simulation debrief
     */
    showDebrief() {
        if (typeof SimulationDebrief !== 'undefined') {
            SimulationDebrief.trigger();
        }
    },

    /**
     * Show scenario briefing modal before starting simulation
     */
    showBriefing() {
        const scenario = SimulationEngine.currentScenario;
        if (!scenario) {
            this.start();
            return;
        }

        // If simulation is already running (e.g. after reset), just start directly
        if (SimulationEngine.isRunning) {
            this.start();
            return;
        }

        let modal = document.getElementById('scenario-briefing-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'scenario-briefing-modal';
            modal.className = 'scenario-briefing-modal';
            document.body.appendChild(modal);
        }

        const objectives = (scenario.learningObjectives || [])
            .map(function(obj) { return '<li>' + obj + '</li>'; }).join('');

        const patient = scenario.patient || {};
        const context = scenario.clinicalContext || {};
        const patientInfo = patient.name
            ? patient.age + '-year-old ' + (patient.sex || '').toLowerCase() + ' (' + patient.name + ')'
            : scenario.description || '';

        modal.innerHTML = `
            <div class="briefing-backdrop" onclick="SimulationControls.closeBriefing()"></div>
            <div class="briefing-content">
                <div class="briefing-header">
                    <span class="briefing-icon">&#127919;</span>
                    <h2>Scenario Briefing</h2>
                </div>
                <div class="briefing-body">
                    <div class="briefing-scenario-name">${scenario.name}</div>
                    <p class="briefing-description">${patientInfo}</p>
                    ${context.oneLiner ? '<p class="briefing-one-liner">' + context.hpiDetails?.chiefComplaint + '</p>' : ''}
                    <div class="briefing-details">
                        <span class="briefing-badge">${scenario.difficulty || 'Standard'}</span>
                        <span class="briefing-badge">${scenario.estimatedDuration || '~30 min'}</span>
                    </div>
                    ${objectives ? `
                        <div class="briefing-objectives">
                            <h4>Learning Objectives</h4>
                            <ol>${objectives}</ol>
                        </div>
                    ` : ''}
                    <div class="briefing-instructions">
                        <p>You are the admitting physician. Gather history from the patient, communicate with the nurse, review the chart, and place all necessary orders.</p>
                    </div>
                </div>
                <div class="briefing-footer">
                    <button class="btn" onclick="SimulationControls.closeBriefing()">Cancel</button>
                    <button class="btn btn-primary briefing-start-btn" onclick="SimulationControls.closeBriefingAndStart()">
                        Begin Simulation &#9658;
                    </button>
                </div>
            </div>
        `;
        modal.classList.add('visible');
    },

    /**
     * Close briefing modal without starting
     */
    closeBriefing() {
        const modal = document.getElementById('scenario-briefing-modal');
        if (modal) {
            modal.classList.remove('visible');
        }
    },

    /**
     * Close briefing and start the simulation
     */
    closeBriefingAndStart() {
        this.closeBriefing();
        this.start();
    }
};

window.SimulationControls = SimulationControls;
