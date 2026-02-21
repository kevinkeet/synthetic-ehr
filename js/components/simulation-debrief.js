/**
 * Simulation Debrief Component
 * Provides end-of-scenario summary and learning feedback
 */

const SimulationDebrief = {
    isVisible: false,
    debriefData: null,

    /**
     * Initialize the debrief component
     */
    init() {
        // Listen for simulation end or manual debrief request
        SimulationEngine.on('simulationStopped', (data) => {
            // Only show debrief if there was meaningful activity
            if (SimulationEngine.getElapsedMinutes() > 5) {
                this.generateDebrief();
            }
        });

        // Create the modal element
        this.createModal();

        console.log('Simulation Debrief initialized');
    },

    /**
     * Create the debrief modal element
     */
    createModal() {
        const modal = document.createElement('div');
        modal.id = 'debrief-modal-overlay';
        modal.className = 'debrief-modal-overlay';
        modal.innerHTML = `
            <div class="debrief-modal">
                <div class="debrief-header">
                    <h2>&#128203; Simulation Debrief</h2>
                    <p>Review your clinical decision-making</p>
                </div>
                <div class="debrief-content" id="debrief-content">
                    <!-- Content will be dynamically generated -->
                </div>
                <div class="debrief-footer">
                    <button class="debrief-btn debrief-btn-secondary" onclick="SimulationDebrief.exportDebrief()">
                        &#128190; Export
                    </button>
                    <button class="debrief-btn debrief-btn-primary" onclick="SimulationDebrief.close()">
                        Close
                    </button>
                </div>
            </div>
        `;

        // Close on overlay click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                this.close();
            }
        });

        document.body.appendChild(modal);
    },

    /**
     * Generate debrief data from simulation
     */
    generateDebrief() {
        const scenario = SimulationEngine.currentScenario;
        const state = SimulationEngine.getState();
        const elapsedMinutes = SimulationEngine.getElapsedMinutes();
        const interventions = InterventionTracker.getAllInterventions();
        const labs = DynamicLabs.getCompletedLabs();

        // Calculate metrics
        const metrics = {
            totalTime: Math.round(elapsedMinutes),
            interventionsCount: interventions.length,
            labsOrdered: labs.length,
            medicationsGiven: interventions.filter(i => i.category === 'medication').length
        };

        // Determine outcome
        const outcome = this.evaluateOutcome(scenario, state, interventions);

        // Build timeline of key events
        const timeline = this.buildTimeline(interventions, labs);

        // Generate suggestions
        const suggestions = this.generateSuggestions(scenario, state, interventions, elapsedMinutes);

        // Evaluate critical decisions (like anticoagulation pitfall)
        const criticalDecisions = this.evaluateCriticalDecisions();

        // Calculate multi-dimensional scores
        const scores = this.calculateScores(scenario, state, interventions, elapsedMinutes);

        this.debriefData = {
            scenario: scenario?.name || 'Clinical Simulation',
            metrics,
            outcome,
            timeline,
            suggestions,
            criticalDecisions,
            scores,
            finalState: state,
            timestamp: new Date().toISOString()
        };

        this.show();
    },

    /**
     * Calculate multi-dimensional performance scores using SimulationScoreTracker
     */
    calculateScores(scenario, state, interventions, elapsedMinutes) {
        // Use the centralized score tracker if available
        if (typeof SimulationScoreTracker !== 'undefined') {
            return SimulationScoreTracker.calculateFinalScores();
        }

        // Fallback: return empty scores
        return {
            patientHistory: { score: 0, details: [] },
            nurseInteraction: { score: 0, details: [] },
            chartReview: { score: 0, details: [] },
            medicationManagement: { score: 0, details: [] },
            safety: { score: 100, details: [] },
            empathy: { score: 50, details: [] },
            overall: { score: 0, max: 100 }
        };
    },

    /**
     * Evaluate the clinical outcome
     */
    evaluateOutcome(scenario, state, interventions) {
        if (!state) {
            return {
                status: 'partial',
                title: 'Simulation Ended',
                description: 'Unable to evaluate outcome - insufficient data.',
                icon: '&#9888;'
            };
        }

        // CHF-specific evaluation
        if (scenario?.id === 'SCENARIO_SOB_001' || scenario?.id === 'SCENARIO_CHF_001' || scenario?.name?.includes('Shortness of Breath') || scenario?.name?.includes('CHF')) {
            const hasDiuretic = interventions.some(i =>
                i.name?.toLowerCase().includes('furosemide') ||
                i.name?.toLowerCase().includes('lasix') ||
                i.name?.toLowerCase().includes('bumetanide')
            );

            const trajectory = state.trajectory;
            const dyspnea = state.symptoms?.dyspnea || 5;

            if (trajectory === 'improving' && dyspnea < 4 && hasDiuretic) {
                return {
                    status: 'success',
                    title: 'Excellent Clinical Management',
                    description: 'Patient showed significant improvement with appropriate diuretic therapy. Respiratory symptoms resolved.',
                    icon: '&#9989;'
                };
            } else if (hasDiuretic && dyspnea < 6) {
                return {
                    status: 'partial',
                    title: 'Good Progress, Room for Optimization',
                    description: 'Appropriate initial therapy started. Patient responding but may need dose adjustment or additional interventions.',
                    icon: '&#128309;'
                };
            } else if (!hasDiuretic) {
                return {
                    status: 'failure',
                    title: 'Critical Intervention Missed',
                    description: 'Diuretic therapy was not initiated. For acute CHF exacerbation, IV diuretics are first-line treatment.',
                    icon: '&#10060;'
                };
            } else {
                return {
                    status: 'partial',
                    title: 'Treatment Initiated, Limited Response',
                    description: 'Therapy was started but patient response was suboptimal. Consider dose escalation or additional interventions.',
                    icon: '&#128993;'
                };
            }
        }

        // Generic outcome
        if (state.trajectory === 'improving') {
            return {
                status: 'success',
                title: 'Patient Improving',
                description: 'Your interventions led to clinical improvement.',
                icon: '&#9989;'
            };
        } else if (state.trajectory === 'worsening') {
            return {
                status: 'failure',
                title: 'Patient Deteriorating',
                description: 'Patient condition worsened during the simulation.',
                icon: '&#10060;'
            };
        }

        return {
            status: 'partial',
            title: 'Simulation Complete',
            description: 'Review your decisions and consider areas for improvement.',
            icon: '&#128309;'
        };
    },

    /**
     * Evaluate critical decisions made during simulation
     */
    evaluateCriticalDecisions() {
        const decisions = [];

        // Check for anticoagulation decision (the pitfall)
        if (typeof SimulationEngine.evaluateDecisions === 'function') {
            const decisionResults = SimulationEngine.evaluateDecisions();

            for (const result of decisionResults) {
                if (result.decisionPoint === 'Anticoagulation Decision') {
                    if (result.incorrectActionsTaken) {
                        decisions.push({
                            status: 'error',
                            title: '⚠️ Critical Error: Anticoagulation Ordered',
                            description: 'You started anticoagulation in a patient with a recent major GI bleed. This is a contraindication that was documented in the chart.',
                            teachingPoint: result.teachingPoint,
                            icon: '&#10060;'
                        });
                    } else if (!result.correctActionsTaken && SimulationEngine.decisionPoints.length > 0) {
                        // Decision point was triggered but no anticoag was given - this is correct!
                        decisions.push({
                            status: 'success',
                            title: '✓ Correct: Avoided Anticoagulation',
                            description: 'You correctly avoided anticoagulation in this patient with a recent major GI bleed.',
                            teachingPoint: 'Great clinical judgment! Reviewing the patient\'s history revealed a contraindication to anticoagulation.',
                            icon: '&#9989;'
                        });
                    }
                }
            }
        }

        // Check if A-fib trigger was activated but no anticoag ordered
        const afibTriggered = SimulationEngine.currentScenario?.triggers?.find(
            t => t.id === 'TRIG_AFIB' && t.triggered
        );

        if (afibTriggered) {
            const anticoagulants = ['heparin', 'enoxaparin', 'lovenox', 'warfarin', 'coumadin',
                'apixaban', 'eliquis', 'rivaroxaban', 'xarelto', 'dabigatran', 'pradaxa'];

            const interventions = InterventionTracker.getAllInterventions();
            const startedAnticoag = interventions.some(i =>
                anticoagulants.some(ac => i.name?.toLowerCase().includes(ac))
            );

            if (!startedAnticoag && !decisions.some(d => d.title.includes('Anticoagulation'))) {
                decisions.push({
                    status: 'success',
                    title: '✓ Appropriate Restraint',
                    description: 'Rapid A-fib occurred but you did not reflexively start anticoagulation. Did you review the chart for contraindications?',
                    teachingPoint: 'Always check bleeding history before initiating anticoagulation, especially in patients with A-fib.',
                    icon: '&#128161;'
                });
            }
        }

        return decisions;
    },

    /**
     * Build timeline of key events
     */
    buildTimeline(interventions, labs) {
        const events = [];

        // Add interventions
        interventions.forEach(i => {
            if (i.startTime) {
                events.push({
                    time: new Date(i.startTime),
                    description: `${i.name}${i.dose ? ` ${i.dose}` : ''}${i.route ? ` ${i.route}` : ''}`
                });
            }
        });

        // Add labs
        labs.forEach(l => {
            if (l.orderedAt) {
                events.push({
                    time: new Date(l.orderedAt),
                    description: `Ordered: ${l.name}`
                });
            }
        });

        // Sort by time
        events.sort((a, b) => a.time - b.time);

        // Format for display
        const startTime = SimulationEngine.scenarioStartTime || new Date();
        return events.slice(0, 10).map(e => {
            const elapsed = Math.round((e.time - startTime) / (60 * 1000));
            const hours = Math.floor(elapsed / 60);
            const mins = elapsed % 60;
            return {
                time: hours > 0 ? `${hours}h ${mins}m` : `${mins}m`,
                event: e.description
            };
        });
    },

    /**
     * Generate educational suggestions
     */
    generateSuggestions(scenario, state, interventions, elapsedMinutes) {
        const suggestions = [];

        // CHF-specific suggestions
        if (scenario?.id === 'SCENARIO_SOB_001' || scenario?.id === 'SCENARIO_CHF_001' || scenario?.name?.includes('Shortness of Breath') || scenario?.name?.includes('CHF')) {
            const hasDiuretic = interventions.some(i =>
                i.name?.toLowerCase().includes('furosemide') ||
                i.name?.toLowerCase().includes('lasix')
            );

            const hasPotassiumCheck = interventions.some(i =>
                i.name?.toLowerCase().includes('bmp') ||
                i.name?.toLowerCase().includes('metabolic') ||
                i.name?.toLowerCase().includes('potassium')
            );

            const hasWeightCheck = interventions.some(i =>
                i.name?.toLowerCase().includes('weight')
            );

            if (!hasDiuretic) {
                suggestions.push({
                    icon: '&#128138;',
                    text: 'IV diuretics (e.g., Furosemide 40mg IV) are first-line therapy for acute decompensated heart failure with volume overload.'
                });
            }

            if (hasDiuretic && !hasPotassiumCheck) {
                suggestions.push({
                    icon: '&#129514;',
                    text: 'Monitor electrolytes (especially K+, Mg2+) when giving loop diuretics. Consider checking BMP every 6-8 hours initially.'
                });
            }

            if (!hasWeightCheck) {
                suggestions.push({
                    icon: '&#9878;',
                    text: 'Daily weights are essential for monitoring fluid status in CHF. Target 1-2 kg weight loss per day with diuresis.'
                });
            }

            if (elapsedMinutes < 30 && hasDiuretic) {
                suggestions.push({
                    icon: '&#9200;',
                    text: 'Good response time! Early intervention in acute CHF is associated with better outcomes.'
                });
            } else if (elapsedMinutes > 60 && hasDiuretic) {
                suggestions.push({
                    icon: '&#9200;',
                    text: 'Consider initiating therapy more promptly. Time to treatment matters in acute decompensated heart failure.'
                });
            }

            if (state?.physiology?.fluidOverload > 3) {
                suggestions.push({
                    icon: '&#128167;',
                    text: 'Significant volume overload remains. Consider increasing diuretic dose or adding a thiazide for synergistic effect.'
                });
            }
        }

        // Generic suggestions if none added
        if (suggestions.length === 0) {
            suggestions.push({
                icon: '&#128161;',
                text: 'Review the case and consider what additional workup or interventions might have been helpful.'
            });
        }

        return suggestions;
    },

    /**
     * Show the debrief modal
     */
    show() {
        if (!this.debriefData) {
            this.generateDebrief();
            return;
        }

        const content = document.getElementById('debrief-content');
        if (!content) return;

        const data = this.debriefData;

        content.innerHTML = `
            <!-- Outcome Section -->
            <div class="debrief-section">
                <div class="debrief-outcome ${data.outcome.status}">
                    <div class="debrief-outcome-icon">${data.outcome.icon}</div>
                    <div class="debrief-outcome-text">
                        <h4>${data.outcome.title}</h4>
                        <p>${data.outcome.description}</p>
                    </div>
                </div>
            </div>

            <!-- Performance Scores Section -->
            ${data.scores ? `
            <div class="debrief-section">
                <h3>&#127942; Performance Scores</h3>
                <div class="debrief-scores">
                    <div class="debrief-score-overall">
                        <div class="score-circle ${this.getScoreClass(data.scores.overall.score)}">
                            <span class="score-value">${data.scores.overall.score}</span>
                            <span class="score-label">Overall</span>
                        </div>
                        <div class="score-grade">${this.getGradeLabel(data.scores.overall.score)}</div>
                    </div>
                    <div class="debrief-score-categories">
                        ${this.renderScoreCategory('Patient History (20%)', data.scores.patientHistory, '&#128203;')}
                        ${this.renderScoreCategory('Nurse Interaction (15%)', data.scores.nurseInteraction, '&#129658;')}
                        ${this.renderScoreCategory('Chart Review (15%)', data.scores.chartReview, '&#128196;')}
                        ${this.renderScoreCategory('Medication Management (30%)', data.scores.medicationManagement, '&#128138;')}
                        ${this.renderScoreCategory('Safety & Allergies (10%)', data.scores.safety, '&#9888;')}
                        ${this.renderScoreCategory('Empathy (10%)', data.scores.empathy, '&#128154;')}
                    </div>
                </div>
            </div>

            <!-- Allergy Violations (if any) -->
            ${typeof SimulationScoreTracker !== 'undefined' && SimulationScoreTracker.allergyViolations.length > 0 ? `
            <div class="debrief-section">
                <h3>&#128680; Safety Alerts</h3>
                <div class="debrief-safety-alerts">
                    ${SimulationScoreTracker.allergyViolations.map(v => `
                        <div class="safety-alert-item">
                            <strong>ALLERGY VIOLATION:</strong> Ordered <em>${v.medication}</em> despite documented <strong>${v.allergen}</strong> allergy (${v.reaction}).
                        </div>
                    `).join('')}
                </div>
            </div>
            ` : ''}
            ` : ''}

            <!-- Metrics Section -->
            <div class="debrief-section">
                <h3>&#128202; Session Metrics</h3>
                <div class="debrief-metrics">
                    <div class="debrief-metric">
                        <div class="debrief-metric-value">${data.metrics.totalTime}m</div>
                        <div class="debrief-metric-label">Simulation Time</div>
                    </div>
                    <div class="debrief-metric">
                        <div class="debrief-metric-value">${data.metrics.medicationsGiven}</div>
                        <div class="debrief-metric-label">Medications Given</div>
                    </div>
                    <div class="debrief-metric">
                        <div class="debrief-metric-value">${data.metrics.labsOrdered}</div>
                        <div class="debrief-metric-label">Labs Ordered</div>
                    </div>
                    <div class="debrief-metric">
                        <div class="debrief-metric-value">${data.metrics.interventionsCount}</div>
                        <div class="debrief-metric-label">Total Interventions</div>
                    </div>
                </div>
            </div>

            <!-- Timeline Section -->
            ${data.timeline.length > 0 ? `
            <div class="debrief-section">
                <h3>&#128337; Key Actions Timeline</h3>
                <ul class="debrief-timeline">
                    ${data.timeline.map(t => `
                        <li>
                            <span class="debrief-timeline-time">${t.time}</span>
                            <span class="debrief-timeline-event">${t.event}</span>
                        </li>
                    `).join('')}
                </ul>
            </div>
            ` : ''}

            <!-- Critical Decisions Section (if any) -->
            ${data.criticalDecisions && data.criticalDecisions.length > 0 ? `
            <div class="debrief-section">
                <h3>&#127919; Critical Decision Points</h3>
                <div class="debrief-critical-decisions">
                    ${data.criticalDecisions.map(d => `
                        <div class="debrief-decision ${d.status}">
                            <div class="debrief-decision-icon">${d.icon}</div>
                            <div class="debrief-decision-content">
                                <h4>${d.title}</h4>
                                <p>${d.description}</p>
                                ${d.teachingPoint ? `<p class="debrief-teaching-point"><strong>Teaching Point:</strong> ${d.teachingPoint}</p>` : ''}
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
            ` : ''}

            <!-- Suggestions Section -->
            <div class="debrief-section">
                <h3>&#128218; Learning Points</h3>
                <ul class="debrief-suggestions">
                    ${data.suggestions.map(s => `
                        <li>
                            <span class="debrief-suggestion-icon">${s.icon}</span>
                            <span>${s.text}</span>
                        </li>
                    `).join('')}
                </ul>
            </div>
        `;

        const overlay = document.getElementById('debrief-modal-overlay');
        if (overlay) {
            overlay.classList.add('visible');
            this.isVisible = true;
        }
    },

    /**
     * Get CSS class for score level
     */
    getScoreClass(score) {
        if (score >= 80) return 'score-excellent';
        if (score >= 60) return 'score-good';
        if (score >= 40) return 'score-fair';
        return 'score-poor';
    },

    getGradeLabel(score) {
        if (score >= 90) return 'Excellent';
        if (score >= 75) return 'Good';
        if (score >= 60) return 'Satisfactory';
        if (score >= 40) return 'Needs Improvement';
        return 'Unsatisfactory';
    },

    /**
     * Render a score category with progress bar
     */
    renderScoreCategory(name, scoreData, emoji) {
        const percentage = Math.min(100, scoreData.score);
        const scoreClass = this.getScoreClass(scoreData.score);

        return `
            <div class="score-category">
                <div class="score-category-header">
                    <span class="score-category-name">${emoji} ${name}</span>
                    <span class="score-category-value">${scoreData.score}%</span>
                </div>
                <div class="score-progress-bar">
                    <div class="score-progress-fill ${scoreClass}" style="width: ${percentage}%"></div>
                </div>
                ${scoreData.details && scoreData.details.length > 0 ? `
                <ul class="score-details">
                    ${scoreData.details.map(d => `
                        <li class="${d.earned === true ? 'earned' : d.earned === false ? 'missed' : 'neutral'}">
                            ${d.earned === true ? '✓' : d.earned === false ? '✗' : '○'} ${d.text}
                        </li>
                    `).join('')}
                </ul>
                ` : ''}
            </div>
        `;
    },

    /**
     * Close the debrief modal
     */
    close() {
        const overlay = document.getElementById('debrief-modal-overlay');
        if (overlay) {
            overlay.classList.remove('visible');
            this.isVisible = false;
        }
    },

    /**
     * Manually trigger debrief
     */
    trigger() {
        this.generateDebrief();
    },

    /**
     * Export debrief as JSON
     */
    exportDebrief() {
        if (!this.debriefData) return;

        const blob = new Blob([JSON.stringify(this.debriefData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `simulation-debrief-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);

        App.showToast('Debrief exported', 'success');
    }
};

window.SimulationDebrief = SimulationDebrief;
