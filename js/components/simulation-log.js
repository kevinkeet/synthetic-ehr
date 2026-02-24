/**
 * Simulation Log Component
 * Displays a log of simulation events and a panel for active interventions
 */

const SimulationLog = {
    events: [],
    maxEvents: 100,
    isVisible: false,
    unreadAlertCount: 0,

    /**
     * Initialize the simulation log
     */
    init() {
        this.createLogPanel();
        this.setupEventListeners();
    },

    /**
     * Create the log panel
     */
    createLogPanel() {
        const panel = document.createElement('div');
        panel.id = 'simulation-log-panel';
        panel.className = 'sim-log-panel';
        panel.innerHTML = `
            <div class="sim-log-header">
                <div class="sim-log-tabs">
                    <button class="log-tab active" data-tab="activity" onclick="SimulationLog.switchTab('activity')">
                        Activity Log
                    </button>
                    <button class="log-tab" data-tab="interventions" onclick="SimulationLog.switchTab('interventions')">
                        Active Treatments
                    </button>
                    <button class="log-tab" data-tab="labs" onclick="SimulationLog.switchTab('labs')">
                        Lab Status
                    </button>
                </div>
                <button class="sim-log-toggle" onclick="SimulationLog.toggle()">
                    <span id="log-toggle-icon">&#9660;</span>
                </button>
            </div>
            <div class="sim-log-body">
                <div class="log-tab-content active" id="log-activity">
                    <div class="log-entries" id="log-entries">
                        <div class="log-empty">Simulation not started. Events will appear here.</div>
                    </div>
                </div>
                <div class="log-tab-content" id="log-interventions">
                    <div class="interventions-list" id="interventions-list">
                        <div class="log-empty">No active treatments</div>
                    </div>
                </div>
                <div class="log-tab-content" id="log-labs">
                    <div class="labs-status-list" id="labs-status-list">
                        <div class="log-empty">No pending labs</div>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(panel);
    },

    /**
     * Setup event listeners
     */
    setupEventListeners() {
        // Listen for simulation events
        SimulationEngine.on('simulationStarted', () => {
            this.addEvent('system', 'Simulation started');
            this.show();
        });

        SimulationEngine.on('simulationPaused', () => {
            this.addEvent('system', 'Simulation paused');
        });

        SimulationEngine.on('simulationResumed', () => {
            this.addEvent('system', 'Simulation resumed');
        });

        SimulationEngine.on('simulationStopped', () => {
            this.addEvent('system', 'Simulation stopped');
        });

        SimulationEngine.on('simulationReset', () => {
            this.events = [];
            this.addEvent('system', 'Simulation reset');
            this.renderEvents();
        });

        SimulationEngine.on('interventionApplied', (data) => {
            this.addEvent('intervention', `Order placed: ${data.intervention.name}`, data.intervention);
            this.renderInterventions();
        });

        SimulationEngine.on('nurseAlert', (data) => {
            this.addEvent('alert', data.message, { priority: data.priority });

            // Auto-expand log for urgent alerts so they're not missed
            if (data.priority === 'urgent') {
                this.show();
                const panel = document.getElementById('simulation-log-panel');
                if (panel && panel.classList.contains('collapsed')) {
                    this.toggle(); // Expand it
                }
                // Flash the activity tab to draw attention
                const activityTab = document.querySelector('.log-tab[data-tab="activity"]');
                if (activityTab) {
                    activityTab.classList.add('tab-flash');
                    setTimeout(() => activityTab.classList.remove('tab-flash'), 3000);
                }
            }
        });

        SimulationEngine.on('labResult', (data) => {
            this.addEvent('lab', `Lab results: ${data.lab?.name || 'Unknown'}`, data);
            this.renderLabStatus();
        });

        SimulationEngine.on('triggerActivated', (data) => {
            this.addEvent('trigger', `Event: ${data.trigger.name}`);
        });

        // Update interventions on tick
        SimulationEngine.on('tick', () => {
            this.renderInterventions();
            this.renderLabStatus();
        });
    },

    /**
     * Show the log panel
     */
    show() {
        const panel = document.getElementById('simulation-log-panel');
        if (panel) {
            panel.classList.add('visible');
            this.isVisible = true;
        }
    },

    /**
     * Hide the log panel
     */
    hide() {
        const panel = document.getElementById('simulation-log-panel');
        if (panel) {
            panel.classList.remove('visible');
            this.isVisible = false;
        }
    },

    /**
     * Toggle visibility
     */
    toggle() {
        const panel = document.getElementById('simulation-log-panel');
        const icon = document.getElementById('log-toggle-icon');

        if (panel) {
            panel.classList.toggle('collapsed');
            if (icon) {
                icon.innerHTML = panel.classList.contains('collapsed') ? '&#9650;' : '&#9660;';
            }
            // Clear unread badge when expanding
            if (!panel.classList.contains('collapsed')) {
                this.unreadAlertCount = 0;
                this.updateBadge();
            }
        }
    },

    /**
     * Update alert badge on the toggle button
     */
    updateBadge() {
        let badge = document.getElementById('log-alert-badge');
        const toggle = document.querySelector('.sim-log-toggle');
        if (!toggle) return;

        if (this.unreadAlertCount > 0) {
            if (!badge) {
                badge = document.createElement('span');
                badge.id = 'log-alert-badge';
                badge.className = 'log-alert-badge';
                toggle.appendChild(badge);
            }
            badge.textContent = this.unreadAlertCount;
            badge.style.display = '';
        } else if (badge) {
            badge.style.display = 'none';
        }
    },

    /**
     * Switch tabs
     */
    switchTab(tabName) {
        document.querySelectorAll('.log-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.tab === tabName);
        });

        document.querySelectorAll('.log-tab-content').forEach(content => {
            content.classList.toggle('active', content.id === `log-${tabName}`);
        });
    },

    /**
     * Add an event to the log
     */
    addEvent(type, message, data = null) {
        const event = {
            id: Date.now(),
            type,
            message,
            data,
            time: SimulationEngine.getSimulatedTime() || new Date(),
            realTime: new Date()
        };

        this.events.unshift(event);

        // Track unread alerts for badge
        if (type === 'alert') {
            this.unreadAlertCount++;
            this.updateBadge();
        }

        // Trim to max events
        if (this.events.length > this.maxEvents) {
            this.events = this.events.slice(0, this.maxEvents);
        }

        this.renderEvents();
    },

    /**
     * Render event log
     */
    renderEvents() {
        const container = document.getElementById('log-entries');
        if (!container) return;

        if (this.events.length === 0) {
            container.innerHTML = '<div class="log-empty">No events yet</div>';
            return;
        }

        container.innerHTML = this.events.map(event => {
            const timeStr = new Date(event.time).toLocaleTimeString('en-US', {
                hour: 'numeric',
                minute: '2-digit',
                hour12: true
            });

            const iconMap = {
                system: '&#9881;',
                intervention: '&#128138;',
                alert: '&#9888;',
                lab: '&#128300;',
                trigger: '&#9889;',
                vital: '&#128147;'
            };

            return `
                <div class="log-entry ${event.type}">
                    <span class="log-icon">${iconMap[event.type] || '&#8226;'}</span>
                    <span class="log-time">${timeStr}</span>
                    <span class="log-message">${event.message}</span>
                </div>
            `;
        }).join('');
    },

    /**
     * Render active interventions
     */
    renderInterventions() {
        const container = document.getElementById('interventions-list');
        if (!container) return;

        const interventions = InterventionTracker.getActiveInterventions();

        if (interventions.length === 0) {
            container.innerHTML = '<div class="log-empty">No active treatments</div>';
            return;
        }

        container.innerHTML = interventions.map(i => {
            const progress = Math.min(100, i.effectApplied || 0);
            const profile = i.profile || {};
            const elapsed = i.elapsedMinutes || 0;
            const duration = profile.duration || 60;
            const remaining = Math.max(0, duration - elapsed);

            // Determine phase
            let phase = 'onset';
            if (elapsed >= (profile.peakTime || 30)) {
                phase = elapsed < duration * 0.8 ? 'peak' : 'wearing off';
            }

            return `
                <div class="intervention-card">
                    <div class="intervention-header">
                        <span class="intervention-name">${i.name || i.type}</span>
                        <span class="intervention-phase ${phase.replace(' ', '-')}">${phase}</span>
                    </div>
                    ${i.dose ? `<div class="intervention-dose">${i.dose} ${i.route || ''}</div>` : ''}
                    <div class="intervention-progress-container">
                        <div class="intervention-progress-bar">
                            <div class="intervention-progress-fill" style="width: ${progress}%"></div>
                        </div>
                        <span class="intervention-time">${Math.round(remaining)}m remaining</span>
                    </div>
                    ${profile.effects && profile.effects.length > 0 ? `
                        <div class="intervention-effects">
                            ${profile.effects.slice(0, 3).map(e => {
                                const param = e.parameter.split('.').pop();
                                const direction = e.changePerHour > 0 ? '↑' : '↓';
                                return `<span class="effect-tag">${direction} ${param}</span>`;
                            }).join('')}
                        </div>
                    ` : ''}
                </div>
            `;
        }).join('');
    },

    /**
     * Render lab status
     */
    renderLabStatus() {
        const container = document.getElementById('labs-status-list');
        if (!container) return;

        const pending = DynamicLabs.getPendingLabs();
        const completed = DynamicLabs.getSimulatedLabs().slice(0, 5);

        if (pending.length === 0 && completed.length === 0) {
            container.innerHTML = '<div class="log-empty">No lab orders</div>';
            return;
        }

        let html = '';

        if (pending.length > 0) {
            html += '<div class="labs-section-title">Pending</div>';
            html += pending.map(lab => {
                const progress = Math.min(100, (lab.elapsedMinutes || 0) / lab.turnaroundTime * 100);
                const statusClass = lab.status.toLowerCase().replace(' ', '-');

                return `
                    <div class="lab-status-card pending">
                        <div class="lab-status-header">
                            <span class="lab-name">${lab.name}</span>
                            <span class="lab-status-badge ${statusClass}">${lab.status}</span>
                        </div>
                        <div class="lab-progress-bar">
                            <div class="lab-progress-fill" style="width: ${progress}%"></div>
                        </div>
                    </div>
                `;
            }).join('');
        }

        if (completed.length > 0) {
            html += '<div class="labs-section-title">Completed</div>';
            html += completed.map(lab => {
                const resultTime = new Date(lab.resultDate).toLocaleTimeString('en-US', {
                    hour: 'numeric',
                    minute: '2-digit',
                    hour12: true
                });

                // Show key abnormal results
                const abnormals = (lab.results || [])
                    .filter(r => r.flag === 'H' || r.flag === 'L')
                    .slice(0, 3);

                return `
                    <div class="lab-status-card completed" onclick="SimulationLog.showLabResults('${lab.id}')">
                        <div class="lab-status-header">
                            <span class="lab-name">${lab.name}</span>
                            <span class="lab-time">${resultTime}</span>
                        </div>
                        ${abnormals.length > 0 ? `
                            <div class="lab-abnormals">
                                ${abnormals.map(r => `
                                    <span class="abnormal-result ${r.flag === 'H' ? 'high' : 'low'}">
                                        ${r.name}: ${r.value} ${r.flag}
                                    </span>
                                `).join('')}
                            </div>
                        ` : '<div class="lab-normal">All results within normal limits</div>'}
                    </div>
                `;
            }).join('');
        }

        container.innerHTML = html;
    },

    /**
     * Show full lab results (modal or expand)
     */
    showLabResults(labId) {
        const lab = DynamicLabs.getSimulatedLabs().find(l => l.id === labId);
        if (!lab || !lab.results) return;

        // Create a simple modal to show results
        let modal = document.getElementById('lab-results-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'lab-results-modal';
            modal.className = 'lab-results-modal';
            document.body.appendChild(modal);
        }

        modal.innerHTML = `
            <div class="lab-results-content">
                <div class="lab-results-header">
                    <h3>${lab.name}</h3>
                    <button onclick="document.getElementById('lab-results-modal').classList.remove('visible')">&times;</button>
                </div>
                <div class="lab-results-meta">
                    <span>Collected: ${new Date(lab.collectedDate).toLocaleString()}</span>
                    <span>Resulted: ${new Date(lab.resultDate).toLocaleString()}</span>
                </div>
                <table class="lab-results-table">
                    <thead>
                        <tr>
                            <th>Test</th>
                            <th>Result</th>
                            <th>Units</th>
                            <th>Reference</th>
                            <th>Flag</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${lab.results.map(r => `
                            <tr class="${r.flag === 'H' ? 'high' : (r.flag === 'L' ? 'low' : '')}">
                                <td>${r.name}</td>
                                <td class="result-value">${r.value}</td>
                                <td>${r.unit}</td>
                                <td>${r.referenceRange}</td>
                                <td class="result-flag">${r.flag || ''}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;

        modal.classList.add('visible');
    }
};

window.SimulationLog = SimulationLog;
