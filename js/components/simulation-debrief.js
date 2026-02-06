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
     * Calculate multi-dimensional performance scores
     */
    calculateScores(scenario, state, interventions, elapsedMinutes) {
        const scores = {
            historyTaking: { score: 0, max: 100, details: [] },
            clinicalDecisionMaking: { score: 0, max: 100, details: [] },
            medicalKnowledge: { score: 0, max: 100, details: [] },
            empathy: { score: 0, max: 100, details: [] },
            overall: { score: 0, max: 100 }
        };

        // ===== HISTORY TAKING =====
        // Check patient chat for evidence of good history taking
        const patientMessages = typeof PatientChat !== 'undefined' ? PatientChat.messages : [];
        const userQuestions = patientMessages.filter(m => m.role === 'user').map(m => m.content.toLowerCase());

        // Points for asking about specific symptoms
        const historyPoints = [
            { keywords: ['breath', 'breathing', 'short of breath', 'dyspnea', 'winded'], points: 15, desc: 'Asked about breathing' },
            { keywords: ['swell', 'ankle', 'leg', 'feet', 'edema'], points: 15, desc: 'Asked about swelling' },
            { keywords: ['sleep', 'lie flat', 'pillow', 'orthopnea', 'bed'], points: 10, desc: 'Asked about orthopnea' },
            { keywords: ['weight', 'gained', 'heavier'], points: 10, desc: 'Asked about weight changes' },
            { keywords: ['medication', 'pill', 'medicine', 'taking', 'compliance'], points: 15, desc: 'Asked about medications' },
            { keywords: ['bleed', 'blood', 'stomach', 'gi', 'ulcer', 'vomit'], points: 20, desc: 'Asked about bleeding history (critical!)' },
            { keywords: ['blood thinner', 'anticoagul', 'warfarin', 'coumadin'], points: 15, desc: 'Asked about blood thinners' }
        ];

        historyPoints.forEach(hp => {
            if (userQuestions.some(q => hp.keywords.some(k => q.includes(k)))) {
                scores.historyTaking.score += hp.points;
                scores.historyTaking.details.push({ text: hp.desc, earned: true });
            } else {
                scores.historyTaking.details.push({ text: hp.desc, earned: false });
            }
        });

        // ===== CLINICAL DECISION MAKING =====
        const hasDiuretic = interventions.some(i =>
            i.name?.toLowerCase().includes('furosemide') ||
            i.name?.toLowerCase().includes('lasix') ||
            i.name?.toLowerCase().includes('bumetanide')
        );

        const anticoagulants = ['heparin', 'enoxaparin', 'lovenox', 'warfarin', 'apixaban', 'rivaroxaban'];
        const startedAnticoag = interventions.some(i =>
            anticoagulants.some(ac => i.name?.toLowerCase().includes(ac))
        );

        if (hasDiuretic) {
            scores.clinicalDecisionMaking.score += 30;
            scores.clinicalDecisionMaking.details.push({ text: 'Initiated appropriate diuretic therapy', earned: true });
        } else {
            scores.clinicalDecisionMaking.details.push({ text: 'Initiated appropriate diuretic therapy', earned: false });
        }

        if (elapsedMinutes <= 30 && hasDiuretic) {
            scores.clinicalDecisionMaking.score += 20;
            scores.clinicalDecisionMaking.details.push({ text: 'Timely intervention (<30 min)', earned: true });
        } else {
            scores.clinicalDecisionMaking.details.push({ text: 'Timely intervention (<30 min)', earned: false });
        }

        // Check if avoided anticoagulation (the pitfall)
        const afibTriggered = scenario?.triggers?.find(t => t.id === 'TRIG_AFIB' && t.triggered);
        if (afibTriggered) {
            if (!startedAnticoag) {
                scores.clinicalDecisionMaking.score += 30;
                scores.clinicalDecisionMaking.details.push({ text: 'Correctly avoided anticoagulation despite A-fib', earned: true });
            } else {
                scores.clinicalDecisionMaking.details.push({ text: 'Correctly avoided anticoagulation despite A-fib', earned: false });
            }
        }

        // Check for appropriate monitoring
        const hasLabMonitoring = interventions.some(i =>
            i.name?.toLowerCase().includes('bmp') ||
            i.name?.toLowerCase().includes('metabolic') ||
            i.name?.toLowerCase().includes('electrolyte')
        );
        if (hasLabMonitoring) {
            scores.clinicalDecisionMaking.score += 20;
            scores.clinicalDecisionMaking.details.push({ text: 'Ordered appropriate lab monitoring', earned: true });
        } else {
            scores.clinicalDecisionMaking.details.push({ text: 'Ordered appropriate lab monitoring', earned: false });
        }

        // ===== MEDICAL KNOWLEDGE =====
        // Based on appropriate orders and dosing
        const hasTelemetry = interventions.some(i =>
            i.name?.toLowerCase().includes('telemetry') ||
            i.formData?.telemetry === 'Yes'
        );
        if (hasTelemetry) {
            scores.medicalKnowledge.score += 20;
            scores.medicalKnowledge.details.push({ text: 'Appropriate cardiac monitoring', earned: true });
        }

        const hasOxygen = interventions.some(i =>
            i.name?.toLowerCase().includes('oxygen') ||
            i.formData?.oxygen?.includes('NC')
        );
        if (hasOxygen || state?.vitals?.oxygenSaturation > 92) {
            scores.medicalKnowledge.score += 20;
            scores.medicalKnowledge.details.push({ text: 'Managed oxygenation appropriately', earned: true });
        }

        // Fluid restriction/low sodium diet
        const hasFluidRestriction = interventions.some(i =>
            i.name?.toLowerCase().includes('fluid') ||
            i.name?.toLowerCase().includes('sodium') ||
            i.formData?.diet?.includes('Sodium')
        );
        if (hasFluidRestriction) {
            scores.medicalKnowledge.score += 20;
            scores.medicalKnowledge.details.push({ text: 'Appropriate dietary orders for CHF', earned: true });
        }

        // I&O monitoring
        const hasIO = interventions.some(i =>
            i.name?.toLowerCase().includes('i&o') ||
            i.name?.toLowerCase().includes('strict') ||
            i.formData?.io?.includes('Strict')
        );
        if (hasIO) {
            scores.medicalKnowledge.score += 20;
            scores.medicalKnowledge.details.push({ text: 'Ordered strict I&O monitoring', earned: true });
        }

        // Daily weights
        const hasWeights = interventions.some(i =>
            i.name?.toLowerCase().includes('weight') ||
            i.formData?.dailyWeight === 'Yes'
        );
        if (hasWeights) {
            scores.medicalKnowledge.score += 20;
            scores.medicalKnowledge.details.push({ text: 'Ordered daily weights', earned: true });
        }

        // ===== EMPATHY =====
        // Check for empathetic responses during emotional trigger
        const emotionalTriggered = scenario?.triggers?.find(t => t.id === 'TRIG_EMOTIONAL' && t.triggered);
        if (emotionalTriggered) {
            // Look for empathetic language in responses after emotional trigger
            const empathyKeywords = ['understand', 'sorry', 'hear', 'feel', 'scared', 'worry', 'concern',
                                     'here for you', 'together', 'explain', 'help', 'okay', 'normal to feel'];
            const postEmotionalMessages = patientMessages.filter(m => m.role === 'user');
            const empathyFound = postEmotionalMessages.some(m =>
                empathyKeywords.some(k => m.content.toLowerCase().includes(k))
            );

            if (empathyFound) {
                scores.empathy.score += 50;
                scores.empathy.details.push({ text: 'Responded empathetically to patient distress', earned: true });
            } else {
                scores.empathy.details.push({ text: 'Responded empathetically to patient distress', earned: false });
            }

            // Check if explained plan to patient
            const explainKeywords = ['plan', 'going to', 'will', 'test', 'treatment', 'medicine', 'help'];
            const explainedPlan = postEmotionalMessages.some(m =>
                explainKeywords.some(k => m.content.toLowerCase().includes(k))
            );
            if (explainedPlan) {
                scores.empathy.score += 30;
                scores.empathy.details.push({ text: 'Explained plan to anxious patient', earned: true });
            } else {
                scores.empathy.details.push({ text: 'Explained plan to anxious patient', earned: false });
            }

            // Check if addressed death/brother concern
            const addressedFear = postEmotionalMessages.some(m =>
                m.content.toLowerCase().includes('brother') ||
                m.content.toLowerCase().includes('die') ||
                m.content.toLowerCase().includes('death') ||
                m.content.toLowerCase().includes('home')
            );
            if (addressedFear) {
                scores.empathy.score += 20;
                scores.empathy.details.push({ text: 'Addressed specific fears (brother\'s death)', earned: true });
            } else {
                scores.empathy.details.push({ text: 'Addressed specific fears (brother\'s death)', earned: false });
            }
        } else {
            // Emotional trigger not yet activated - give neutral score
            scores.empathy.score = 50;
            scores.empathy.details.push({ text: 'Emotional challenge not yet encountered', earned: null });
        }

        // Calculate overall score as weighted average
        scores.overall.score = Math.round(
            (scores.historyTaking.score * 0.25) +
            (scores.clinicalDecisionMaking.score * 0.30) +
            (scores.medicalKnowledge.score * 0.25) +
            (scores.empathy.score * 0.20)
        );

        return scores;
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
                    </div>
                    <div class="debrief-score-categories">
                        ${this.renderScoreCategory('History Taking', data.scores.historyTaking, '📋')}
                        ${this.renderScoreCategory('Clinical Decision Making', data.scores.clinicalDecisionMaking, '🧠')}
                        ${this.renderScoreCategory('Medical Knowledge', data.scores.medicalKnowledge, '📚')}
                        ${this.renderScoreCategory('Empathy', data.scores.empathy, '💚')}
                    </div>
                </div>
            </div>
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
