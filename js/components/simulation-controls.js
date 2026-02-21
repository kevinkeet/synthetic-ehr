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
                            <button class="sim-btn sim-start" id="sim-start-btn" onclick="SimulationControls.start()">
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

            // Update UI - both chat panels are always visible
            if (typeof AIPanel !== 'undefined') {
                AIPanel.addMessage('nurse', 'assistant', data.message);
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
    }
};

window.SimulationControls = SimulationControls;
