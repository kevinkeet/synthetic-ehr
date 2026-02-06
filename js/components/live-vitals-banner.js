/**
 * Live Vitals Banner
 * Shows real-time patient vitals during simulation
 */

const LiveVitalsBanner = {
    isVisible: false,
    lastState: null,

    /**
     * Initialize the live vitals banner
     */
    init() {
        this.createBanner();
        this.setupEventListeners();
    },

    /**
     * Create the banner HTML
     */
    createBanner() {
        const banner = document.createElement('div');
        banner.id = 'live-vitals-banner';
        banner.className = 'live-vitals-banner';
        banner.innerHTML = `
            <div class="live-vitals-container">
                <div class="live-vitals-status">
                    <span class="live-indicator"></span>
                    <span class="live-label">SIMULATION</span>
                    <span class="live-time" id="live-sim-time">--:--</span>
                </div>
                <div class="live-vitals-grid">
                    <div class="live-vital" id="live-bp">
                        <span class="vital-icon">&#128147;</span>
                        <span class="vital-name">BP</span>
                        <span class="vital-val" id="live-bp-val">--/--</span>
                    </div>
                    <div class="live-vital" id="live-hr">
                        <span class="vital-icon">&#128151;</span>
                        <span class="vital-name">HR</span>
                        <span class="vital-val" id="live-hr-val">--</span>
                    </div>
                    <div class="live-vital" id="live-rr">
                        <span class="vital-icon">&#127788;</span>
                        <span class="vital-name">RR</span>
                        <span class="vital-val" id="live-rr-val">--</span>
                    </div>
                    <div class="live-vital" id="live-spo2">
                        <span class="vital-icon">&#128168;</span>
                        <span class="vital-name">SpO2</span>
                        <span class="vital-val" id="live-spo2-val">--%</span>
                    </div>
                    <div class="live-vital" id="live-temp">
                        <span class="vital-icon">&#127777;</span>
                        <span class="vital-name">Temp</span>
                        <span class="vital-val" id="live-temp-val">--°F</span>
                    </div>
                    <div class="live-vital" id="live-weight">
                        <span class="vital-icon">&#9878;</span>
                        <span class="vital-name">Wt</span>
                        <span class="vital-val" id="live-weight-val">-- kg</span>
                    </div>
                    <div class="live-vital" id="live-uop">
                        <span class="vital-icon">&#128167;</span>
                        <span class="vital-name">UOP</span>
                        <span class="vital-val" id="live-uop-val">-- mL/hr</span>
                    </div>
                </div>
                <div class="live-vitals-interventions" id="live-interventions">
                    <!-- Active interventions shown here -->
                </div>
                <div class="live-vitals-trajectory" id="live-trajectory">
                    <span class="trajectory-label">Status:</span>
                    <span class="trajectory-value" id="trajectory-value">--</span>
                </div>
            </div>
        `;

        // Insert after allergy banner
        const allergyBanner = document.getElementById('allergy-banner');
        if (allergyBanner) {
            allergyBanner.after(banner);
        } else {
            const mainContainer = document.querySelector('.main-container');
            if (mainContainer) {
                mainContainer.before(banner);
            }
        }
    },

    /**
     * Setup event listeners
     */
    setupEventListeners() {
        SimulationEngine.on('tick', (data) => this.onTick(data));
        SimulationEngine.on('simulationStarted', () => this.show());
        SimulationEngine.on('simulationStopped', () => this.hide());
        SimulationEngine.on('simulationReset', () => this.hide());
        SimulationEngine.on('interventionApplied', (data) => this.onIntervention(data));
    },

    /**
     * Show the banner
     */
    show() {
        const banner = document.getElementById('live-vitals-banner');
        if (banner) {
            banner.classList.add('visible');
            this.isVisible = true;
        }
    },

    /**
     * Hide the banner
     */
    hide() {
        const banner = document.getElementById('live-vitals-banner');
        if (banner) {
            banner.classList.remove('visible');
            this.isVisible = false;
        }
    },

    /**
     * Handle simulation tick
     */
    onTick(data) {
        if (!this.isVisible) this.show();

        this.updateTime(data.time);
        this.updateVitals(data.state);
        this.updateTrajectory(data.state);
        this.updateInterventions();

        this.lastState = data.state;
    },

    /**
     * Update time display
     */
    updateTime(time) {
        const el = document.getElementById('live-sim-time');
        if (el && time) {
            el.textContent = new Date(time).toLocaleTimeString('en-US', {
                hour: 'numeric',
                minute: '2-digit',
                hour12: true
            });
        }
    },

    /**
     * Update vitals display
     */
    updateVitals(state) {
        if (!state || !state.vitals) return;

        const v = state.vitals;
        const p = state.physiology || {};

        // Update each vital with change indicators
        this.updateVital('live-bp-val', `${Math.round(v.systolic)}/${Math.round(v.diastolic)}`,
            this.getVitalStatus('bp', v.systolic));

        this.updateVital('live-hr-val', Math.round(v.heartRate),
            this.getVitalStatus('hr', v.heartRate));

        this.updateVital('live-rr-val', Math.round(v.respiratoryRate),
            this.getVitalStatus('rr', v.respiratoryRate));

        this.updateVital('live-spo2-val', `${Math.round(v.oxygenSaturation)}%`,
            this.getVitalStatus('spo2', v.oxygenSaturation));

        this.updateVital('live-temp-val', `${(v.temperature || 98.6).toFixed(1)}°F`,
            this.getVitalStatus('temp', v.temperature));

        this.updateVital('live-weight-val', `${(v.weight || 0).toFixed(1)} kg`,
            this.getVitalStatus('weight', v.weight, this.lastState?.vitals?.weight));

        this.updateVital('live-uop-val', `${Math.round(p.urineOutput || 0)} mL/hr`,
            this.getVitalStatus('uop', p.urineOutput));
    },

    /**
     * Update a single vital value with status class
     */
    updateVital(id, value, status) {
        const el = document.getElementById(id);
        if (el) {
            el.textContent = value;
            el.className = 'vital-val ' + (status || '');
        }
    },

    /**
     * Get status class for a vital
     */
    getVitalStatus(type, value, prevValue) {
        const ranges = {
            bp: { low: 90, normal: [100, 140], high: 160 },
            hr: { low: 55, normal: [60, 100], high: 120 },
            rr: { low: 10, normal: [12, 20], high: 24 },
            spo2: { critical: 88, low: 92, normal: [95, 100] },
            temp: { low: 96, normal: [97, 99], high: 100.4 },
            uop: { critical: 10, low: 30, normal: [50, 150] }
        };

        const r = ranges[type];
        if (!r) {
            // For weight, show trend
            if (type === 'weight' && prevValue) {
                if (value < prevValue - 0.2) return 'improving';
                if (value > prevValue + 0.2) return 'worsening';
            }
            return '';
        }

        if (r.critical !== undefined && value <= r.critical) return 'critical';
        if (r.low !== undefined && value < r.low) return 'low';
        if (r.high !== undefined && value > r.high) return 'high';
        if (r.normal && value >= r.normal[0] && value <= r.normal[1]) return 'normal';

        return '';
    },

    /**
     * Update trajectory display
     */
    updateTrajectory(state) {
        const el = document.getElementById('trajectory-value');
        if (el && state?.trajectory) {
            el.textContent = state.trajectory.charAt(0).toUpperCase() + state.trajectory.slice(1);
            el.className = 'trajectory-value ' + state.trajectory;
        }
    },

    /**
     * Update active interventions display
     */
    updateInterventions() {
        const el = document.getElementById('live-interventions');
        if (!el) return;

        const interventions = InterventionTracker.getActiveInterventions();

        if (interventions.length === 0) {
            el.innerHTML = '';
            return;
        }

        el.innerHTML = interventions.map(i => {
            const progress = Math.min(100, i.effectApplied || 0);
            return `
                <div class="active-intervention">
                    <span class="intervention-name">${i.name || i.type}</span>
                    <div class="intervention-progress">
                        <div class="progress-bar" style="width: ${progress}%"></div>
                    </div>
                    <span class="intervention-status">${progress < 100 ? 'Active' : 'Complete'}</span>
                </div>
            `;
        }).join('');
    },

    /**
     * Handle new intervention
     */
    onIntervention(data) {
        // Flash the banner to indicate new intervention
        const banner = document.getElementById('live-vitals-banner');
        if (banner) {
            banner.classList.add('intervention-flash');
            setTimeout(() => banner.classList.remove('intervention-flash'), 1000);
        }

        // Show toast
        App.showToast(`Treatment started: ${data.intervention.name}`, 'info');
    }
};

window.LiveVitalsBanner = LiveVitalsBanner;
