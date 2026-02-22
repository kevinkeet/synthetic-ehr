/**
 * Longitudinal Document Updater
 *
 * Handles real-time incremental updates to the longitudinal document
 * as new data arrives (vitals, labs, notes, doctor dictation, etc.)
 */

class LongitudinalDocumentUpdater {
    constructor(document) {
        this.document = document;
    }

    // ============================================================
    // VITALS UPDATES
    // ============================================================

    /**
     * Add new vital signs to the document
     * @param {Object} vitals - Vital signs object with fields like heartRate, systolic, etc.
     */
    addVitals(vitals) {
        const vitalEntry = {
            ...vitals,
            date: vitals.date || new Date().toISOString()
        };

        // Add to main vitals array (maintain sort - most recent first)
        this.document.longitudinalData.vitals.unshift(vitalEntry);
        this.document.longitudinalData.vitals.sort((a, b) =>
            new Date(b.date) - new Date(a.date)
        );

        // Add to appropriate time period
        const periodLabel = this.document.getTimePeriodForDate(vitalEntry.date);
        if (!this.document.longitudinalData.vitalsByPeriod.has(periodLabel)) {
            this.document.longitudinalData.vitalsByPeriod.set(periodLabel, []);
        }
        this.document.longitudinalData.vitalsByPeriod.get(periodLabel).unshift(vitalEntry);

        // Update relevant problem timelines
        this.updateProblemTimelinesForVitals(vitalEntry);

        // Check for concerning vitals and add safety flags
        this.checkVitalAlerts(vitalEntry);

        // Update timestamp
        this.document.metadata.lastUpdated = new Date().toISOString();

        console.log('Added vitals:', vitalEntry);
    }

    updateProblemTimelinesForVitals(vitals) {
        const periodLabel = this.document.getTimePeriodForDate(vitals.date);

        for (const [problemId, timeline] of this.document.problemMatrix) {
            const relatedVitals = timeline.getRelatedVitals();
            if (relatedVitals.length === 0) continue;

            const periodData = timeline.getPeriodData(periodLabel);
            if (!periodData) continue;

            const relevantVital = { date: vitals.date };
            let hasRelevant = false;

            for (const field of relatedVitals) {
                if (vitals[field] !== undefined) {
                    relevantVital[field] = vitals[field];
                    hasRelevant = true;
                }
            }

            if (hasRelevant) {
                periodData.vitals.unshift(relevantVital);
            }
        }
    }

    checkVitalAlerts(vitals) {
        const alerts = [];

        // Check for critical vital values
        if (vitals.systolic && (vitals.systolic > 180 || vitals.systolic < 90)) {
            const level = vitals.systolic > 180 ? 'HYPERTENSIVE URGENCY' : 'HYPOTENSION';
            alerts.push({
                text: `${level}: BP ${vitals.systolic}/${vitals.diastolic || '?'}`,
                severity: 'critical'
            });
        }

        if (vitals.heartRate && (vitals.heartRate > 120 || vitals.heartRate < 50)) {
            const level = vitals.heartRate > 120 ? 'TACHYCARDIA' : 'BRADYCARDIA';
            alerts.push({
                text: `${level}: HR ${vitals.heartRate}`,
                severity: vitals.heartRate > 150 || vitals.heartRate < 40 ? 'critical' : 'warning'
            });
        }

        if (vitals.spO2 && vitals.spO2 < 92) {
            alerts.push({
                text: `HYPOXIA: SpO2 ${vitals.spO2}%`,
                severity: vitals.spO2 < 88 ? 'critical' : 'warning'
            });
        }

        if (vitals.respiratoryRate && (vitals.respiratoryRate > 24 || vitals.respiratoryRate < 10)) {
            const level = vitals.respiratoryRate > 24 ? 'TACHYPNEA' : 'BRADYPNEA';
            alerts.push({
                text: `${level}: RR ${vitals.respiratoryRate}`,
                severity: vitals.respiratoryRate > 30 || vitals.respiratoryRate < 8 ? 'critical' : 'warning'
            });
        }

        if (vitals.temperature && (vitals.temperature > 101.3 || vitals.temperature < 96)) {
            const level = vitals.temperature > 101.3 ? 'FEVER' : 'HYPOTHERMIA';
            alerts.push({
                text: `${level}: Temp ${vitals.temperature}°F`,
                severity: vitals.temperature > 103 || vitals.temperature < 95 ? 'critical' : 'warning'
            });
        }

        // Add alerts as safety flags
        for (const alert of alerts) {
            this.addSafetyFlag(alert.text, alert.severity);
        }
    }

    // ============================================================
    // LAB UPDATES
    // ============================================================

    /**
     * Add new lab results to the document
     * @param {Object} panel - Lab panel with results array
     */
    addLabResults(panel) {
        if (!panel || !panel.results) return;

        const collectedDate = panel.collectedDate || new Date().toISOString();
        const periodLabel = this.document.getTimePeriodForDate(collectedDate);

        for (const result of panel.results) {
            // Update or create lab trend
            let labTrend = this.document.longitudinalData.labs.get(result.name);
            if (!labTrend) {
                labTrend = new LabTrend(result.name, result.referenceRange);
                this.document.longitudinalData.labs.set(result.name, labTrend);
            }

            labTrend.addValue(
                collectedDate,
                result.value,
                result.unit,
                result.flag
            );

            // Update relevant problem timelines
            this.updateProblemTimelinesForLab(result, collectedDate, periodLabel);

            // Check for critical values
            this.checkLabAlerts(result, panel);

            // Run conflict detection on new lab data
            this.detectConflicts({
                text: `Lab result: ${result.name} = ${result.value} ${result.unit || ''}`,
                source: 'lab'
            });
        }

        // Update timestamp
        this.document.metadata.lastUpdated = new Date().toISOString();

        console.log('Added lab panel:', panel.name || 'Unknown', 'with', panel.results.length, 'results');
    }

    updateProblemTimelinesForLab(result, collectedDate, periodLabel) {
        for (const [problemId, timeline] of this.document.problemMatrix) {
            const relatedLabs = timeline.getRelatedLabs();
            const isRelated = relatedLabs.some(rl =>
                result.name.toLowerCase().includes(rl.toLowerCase())
            );

            if (isRelated) {
                const periodData = timeline.getPeriodData(periodLabel);
                if (periodData) {
                    periodData.labs.push({
                        name: result.name,
                        value: result.value,
                        unit: result.unit,
                        flag: result.flag,
                        date: collectedDate
                    });
                }
            }
        }
    }

    checkLabAlerts(result, panel) {
        // Check for critical lab values
        if (result.flag === 'critical' || result.flag === 'HH' || result.flag === 'LL') {
            this.addSafetyFlag(
                `CRITICAL LAB: ${result.name} = ${result.value} ${result.unit || ''}`,
                'critical'
            );
        }

        // Specific critical thresholds
        const criticalThresholds = {
            'Potassium': { low: 2.5, high: 6.5, unit: 'mEq/L' },
            'Sodium': { low: 120, high: 160, unit: 'mEq/L' },
            'Glucose': { low: 50, high: 400, unit: 'mg/dL' },
            'Hemoglobin': { low: 7, high: 20, unit: 'g/dL' },
            'Troponin': { high: 0.04, unit: 'ng/mL' },
            'Creatinine': { high: 10, unit: 'mg/dL' }
        };

        const threshold = criticalThresholds[result.name];
        if (threshold) {
            const value = parseFloat(result.value);
            if (!isNaN(value)) {
                if (threshold.low && value < threshold.low) {
                    this.addSafetyFlag(
                        `CRITICAL LOW ${result.name}: ${value} ${threshold.unit}`,
                        'critical'
                    );
                }
                if (threshold.high && value > threshold.high) {
                    this.addSafetyFlag(
                        `CRITICAL HIGH ${result.name}: ${value} ${threshold.unit}`,
                        'critical'
                    );
                }
            }
        }
    }

    // ============================================================
    // NURSING NOTES
    // ============================================================

    /**
     * Add a nursing note/observation
     * @param {Object|string} note - Note object or string
     */
    addNursingNote(note) {
        const noteText = typeof note === 'string' ? note : note.text || note.content;
        const timestamp = note.timestamp || note.date || new Date().toISOString();

        // Update clinical narrative with nursing assessment
        this.document.clinicalNarrative.nursingAssessment = noteText;

        // Extract patient-reported information if present
        const patientQuotes = this.extractPatientStatements(noteText);
        if (patientQuotes.length > 0) {
            this.document.clinicalNarrative.patientVoice = patientQuotes.join(' ');
        }

        // Add to observations if it contains key findings
        const keyFindings = this.extractKeyFindings(noteText);
        for (const finding of keyFindings) {
            if (!this.document.clinicalNarrative.keyFindings.includes(finding)) {
                this.document.clinicalNarrative.keyFindings.push(finding);
            }
        }

        // Update timestamp
        this.document.metadata.lastUpdated = new Date().toISOString();

        console.log('Added nursing note');
    }

    extractPatientStatements(text) {
        const quotes = [];
        // Look for quoted statements
        const quoteRegex = /"([^"]+)"/g;
        let match;
        while ((match = quoteRegex.exec(text)) !== null) {
            quotes.push(match[1]);
        }

        // Look for "patient reports/states/says" patterns
        const reportRegex = /patient (?:reports?|states?|says?|denies?|complains? of)\s+([^.]+)/gi;
        while ((match = reportRegex.exec(text)) !== null) {
            quotes.push(match[1].trim());
        }

        return quotes;
    }

    extractKeyFindings(text) {
        const findings = [];
        const lowerText = text.toLowerCase();

        // Look for concerning patterns
        const concerningPatterns = [
            { pattern: /new onset/i, prefix: 'New onset: ' },
            { pattern: /worsening/i, prefix: 'Worsening: ' },
            { pattern: /acute/i, prefix: 'Acute: ' },
            { pattern: /critical/i, prefix: 'Critical: ' },
            { pattern: /unstable/i, prefix: 'Unstable: ' },
            { pattern: /deteriorat/i, prefix: 'Deteriorating: ' }
        ];

        for (const { pattern, prefix } of concerningPatterns) {
            if (pattern.test(text)) {
                // Extract the sentence containing the pattern
                const sentences = text.split(/[.!?]+/);
                for (const sentence of sentences) {
                    if (pattern.test(sentence)) {
                        findings.push(sentence.trim());
                        break;
                    }
                }
            }
        }

        return findings;
    }

    // ============================================================
    // DOCTOR DICTATION
    // ============================================================

    /**
     * Add doctor's dictated thoughts/assessment
     * @param {string} text - Dictated text
     */
    addDoctorDictation(text) {
        if (!text || !text.trim()) return;

        this.document.sessionContext.doctorDictation.push({
            timestamp: new Date().toISOString(),
            text: text.trim()
        });

        // Also add to clinical narrative as key finding if it contains assessment
        if (text.toLowerCase().includes('assessment') ||
            text.toLowerCase().includes('diagnosis') ||
            text.toLowerCase().includes('plan')) {
            if (!this.document.clinicalNarrative.keyFindings.includes(text)) {
                this.document.clinicalNarrative.keyFindings.push(`MD Assessment: ${text.substring(0, 200)}`);
            }
        }

        // Update timestamp
        this.document.metadata.lastUpdated = new Date().toISOString();

        console.log('Added doctor dictation');
    }

    // ============================================================
    // SAFETY FLAGS
    // ============================================================

    /**
     * Add a safety flag
     * @param {string} text - Flag text
     * @param {string} severity - 'critical', 'warning', or 'info'
     */
    addSafetyFlag(text, severity = 'warning') {
        // Check for duplicates
        const exists = this.document.sessionContext.safetyFlags.some(f =>
            f.text === text
        );

        if (!exists) {
            this.document.sessionContext.safetyFlags.push({
                text,
                severity,
                timestamp: new Date().toISOString()
            });
            console.log('Added safety flag:', text, `(${severity})`);
        }
    }

    /**
     * Remove a safety flag
     * @param {string} text - Flag text to remove
     */
    removeSafetyFlag(text) {
        const idx = this.document.sessionContext.safetyFlags.findIndex(f =>
            f.text === text
        );
        if (idx !== -1) {
            this.document.sessionContext.safetyFlags.splice(idx, 1);
        }
    }

    // ============================================================
    // SESSION STATE
    // ============================================================

    /**
     * Mark an item as reviewed
     * @param {string} item - Item description
     */
    markReviewed(item) {
        if (!this.document.sessionContext.reviewedItems.includes(item)) {
            this.document.sessionContext.reviewedItems.push(item);
        }

        // Remove from pending if present
        const pendingIdx = this.document.sessionContext.pendingItems.indexOf(item);
        if (pendingIdx !== -1) {
            this.document.sessionContext.pendingItems.splice(pendingIdx, 1);
        }
    }

    /**
     * Add a pending item
     * @param {string} item - Item description
     */
    addPendingItem(item) {
        if (!this.document.sessionContext.pendingItems.includes(item)) {
            this.document.sessionContext.pendingItems.push(item);
        }
    }

    /**
     * Remove a pending item
     * @param {string} item - Item description
     */
    removePendingItem(item) {
        const idx = this.document.sessionContext.pendingItems.indexOf(item);
        if (idx !== -1) {
            this.document.sessionContext.pendingItems.splice(idx, 1);
        }
    }

    /**
     * Add a structured AI observation with metadata
     * @param {string} observation - Observation text
     * @param {string} category - 'clinical' | 'data_quality' | 'safety' | 'assessment'
     * @returns {string|null} - ID of the created observation, or null if duplicate
     */
    addAIObservation(observation, category = 'clinical') {
        if (!observation || !observation.trim()) return null;

        const obsArray = this.document.sessionContext.aiObservations;
        const trimmed = observation.trim().toLowerCase();

        // Dedup against active observations
        const isDuplicate = obsArray.some(o => {
            const text = (typeof o === 'string' ? o : o.text || '').toLowerCase().trim();
            return text === trimmed && (typeof o === 'string' || o.status === 'active');
        });
        if (isDuplicate) return null;

        const id = `obs_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
        const entry = {
            id,
            text: observation.trim(),
            timestamp: new Date().toISOString(),
            status: 'active',
            supersededBy: null,
            category,
            version: 1
        };

        obsArray.push(entry);

        // Run pruning after adding
        this.pruneObservations();

        return id;
    }

    /**
     * Mark an observation as superseded and optionally create a replacement
     * @param {string} oldId - ID of the observation to supersede
     * @param {string} newObservation - Replacement text (optional)
     * @param {string} category - Category for the new observation
     * @returns {string|null} - ID of the new observation, or null
     */
    supersedeObservation(oldId, newObservation, category = 'clinical') {
        const oldObs = this.document.sessionContext.aiObservations.find(o =>
            typeof o === 'object' && o.id === oldId
        );
        if (oldObs) {
            oldObs.status = 'superseded';
        }

        let newId = null;
        if (newObservation) {
            newId = this.addAIObservation(newObservation, category);
            if (oldObs && newId) {
                oldObs.supersededBy = newId;
            }
        }
        return newId;
    }

    // ============================================================
    // ACTIVE CLINICAL STATE
    // ============================================================

    /**
     * Add a pending decision requiring physician action
     * @param {string} text - Decision/question text
     * @param {string} context - Additional context
     * @param {string} raisedBy - 'nurse' | 'ai' | 'system' | 'doctor'
     * @param {string[]} relatedProblemIds - Related problem IDs
     * @returns {string|null} - ID of the pending decision, or null if duplicate
     */
    addPendingDecision(text, context = '', raisedBy = 'ai', relatedProblemIds = []) {
        if (!text || !text.trim()) return null;

        // Ensure activeClinicalState exists
        if (!this.document.sessionContext.activeClinicalState) {
            this.document.sessionContext.activeClinicalState = {
                pendingDecisions: [], activeConditions: [], backgroundFacts: []
            };
        }

        const decisions = this.document.sessionContext.activeClinicalState.pendingDecisions;
        const trimmed = text.trim().toLowerCase();

        // Check for duplicate unresolved decisions
        const isDuplicate = decisions.some(d =>
            !d.resolvedAt && d.text.toLowerCase().trim() === trimmed
        );
        if (isDuplicate) return null;

        const id = `pd_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
        decisions.push({
            id,
            text: text.trim(),
            context,
            raisedBy,
            raisedAt: new Date().toISOString(),
            resolvedAt: null,
            resolution: null,
            relatedProblemIds
        });

        return id;
    }

    /**
     * Resolve a pending decision
     * @param {string} id - Decision ID
     * @param {string} resolution - How it was resolved
     */
    resolvePendingDecision(id, resolution) {
        if (!this.document.sessionContext.activeClinicalState) return;

        const decision = this.document.sessionContext.activeClinicalState.pendingDecisions
            .find(d => d.id === id);
        if (decision) {
            decision.resolvedAt = new Date().toISOString();
            decision.resolution = resolution;
        }
    }

    /**
     * Add an active clinical condition (what's evolving right now)
     * @param {string} text - Condition description
     * @param {string} trend - 'improving' | 'worsening' | 'stable' | 'new'
     * @param {string[]} relatedProblemIds - Related problem IDs
     */
    addActiveCondition(text, trend = 'stable', relatedProblemIds = []) {
        if (!text || !text.trim()) return;

        if (!this.document.sessionContext.activeClinicalState) {
            this.document.sessionContext.activeClinicalState = {
                pendingDecisions: [], activeConditions: [], backgroundFacts: []
            };
        }

        const conditions = this.document.sessionContext.activeClinicalState.activeConditions;
        const trimmed = text.trim().toLowerCase();

        // Update existing or add new
        const existing = conditions.find(c => c.text.toLowerCase().trim() === trimmed);
        if (existing) {
            existing.trend = trend;
            existing.lastUpdated = new Date().toISOString();
            return;
        }

        conditions.push({
            text: text.trim(),
            since: new Date().toISOString(),
            trend,
            relatedProblemIds,
            lastUpdated: new Date().toISOString()
        });
    }

    /**
     * Add a background fact (stable historical information)
     * @param {string} text - Fact description
     * @param {string} source - 'chart' | 'ai' | 'doctor' | 'nurse'
     * @param {string} category - 'clinical' | 'social' | 'historical'
     */
    addBackgroundFact(text, source = 'chart', category = 'clinical') {
        if (!text || !text.trim()) return;

        if (!this.document.sessionContext.activeClinicalState) {
            this.document.sessionContext.activeClinicalState = {
                pendingDecisions: [], activeConditions: [], backgroundFacts: []
            };
        }

        const facts = this.document.sessionContext.activeClinicalState.backgroundFacts;
        const trimmed = text.trim().toLowerCase();

        const isDuplicate = facts.some(f => f.text.toLowerCase().trim() === trimmed);
        if (isDuplicate) return;

        facts.push({
            text: text.trim(),
            source,
            addedAt: new Date().toISOString(),
            category
        });
    }

    // ============================================================
    // CONFLICT DETECTION
    // ============================================================

    /**
     * Detect conflicts between new information and existing state
     * @param {Object} newItem - {text, source} of the new information
     * @returns {Object[]} - Array of detected conflicts
     */
    detectConflicts(newItem) {
        const conflicts = [];

        // Rule 1: "No data" vs actual data present
        conflicts.push(...this._checkNoDataConflicts(newItem));

        // Rule 2: Medication contraindication conflicts
        conflicts.push(...this._checkMedicationContraindictions(newItem));

        // Rule 3: Contradicting clinical assessments
        conflicts.push(...this._checkAssessmentContradictions(newItem));

        // Store detected conflicts
        for (const conflict of conflicts) {
            this.addConflict(conflict);
        }

        return conflicts;
    }

    _checkNoDataConflicts(newItem) {
        const conflicts = [];
        const noDataPattern = /no data|no results|not available|no .* found|no .* on file|no .* recorded|no .* populated/i;
        const hasDataPattern = /values|results|trending?|level|mg\/dl|meq\/l|g\/dl|mmol|pg\/ml/i;

        const text = newItem.text || newItem;
        const activeObs = this.document.sessionContext.aiObservations
            .filter(o => typeof o === 'object' ? o.status === 'active' : true);

        for (const obs of activeObs) {
            const obsText = typeof obs === 'string' ? obs : obs.text;
            const newIsNoData = noDataPattern.test(text);
            const existingIsNoData = noDataPattern.test(obsText);
            const newHasData = hasDataPattern.test(text);
            const existingHasData = hasDataPattern.test(obsText);

            if ((newIsNoData && existingHasData) || (newHasData && existingIsNoData)) {
                conflicts.push({
                    itemA: { text: obsText, source: 'aiObservation', timestamp: typeof obs === 'object' ? obs.timestamp : '' },
                    itemB: { text, source: newItem.source || 'new', timestamp: new Date().toISOString() },
                    severity: 'warning'
                });

                // Auto-resolve: invalidate the "no data" observation
                if (existingIsNoData && newHasData && typeof obs === 'object') {
                    obs.status = 'invalidated';
                }
            }
        }

        return conflicts;
    }

    _checkMedicationContraindictions(newItem) {
        const conflicts = [];
        const text = (newItem.text || newItem || '').toLowerCase();

        const contraindicationRules = [
            {
                medications: ['heparin', 'enoxaparin', 'lovenox', 'warfarin', 'coumadin', 'eliquis', 'apixaban', 'xarelto', 'rivaroxaban', 'anticoagul'],
                contraindications: ['gi bleed', 'gastrointestinal bleed', 'active bleeding', 'hemorrhage',
                                   'anticoagulation contraindicated', 'no anticoagulation', 'hold anticoag', 'bleed risk'],
                severity: 'critical'
            },
            {
                medications: ['nsaid', 'ibuprofen', 'naproxen', 'ketorolac', 'toradol', 'aspirin', 'indomethacin'],
                contraindications: ['gi bleed', 'renal failure', 'ckd stage 4', 'ckd stage 5', 'aki', 'acute kidney',
                                   'gfr < 30', 'egfr < 30', 'creatinine > 4'],
                severity: 'critical'
            },
            {
                medications: ['metformin'],
                contraindications: ['egfr < 30', 'gfr < 30', 'severe renal', 'lactic acidosis', 'contrast dye'],
                severity: 'warning'
            }
        ];

        for (const rule of contraindicationRules) {
            const mentionsMed = rule.medications.some(m => text.includes(m));
            if (!mentionsMed) continue;

            // Search all clinical sources for contraindication
            const allSources = [
                ...this._getActiveObservationTexts(),
                ...this._getDoctorDictationTexts(),
                ...this._getProblemListTexts(),
                ...this._getNurseConversationTexts()
            ];

            for (const source of allSources) {
                const hasContraindication = rule.contraindications.some(c =>
                    source.text.toLowerCase().includes(c)
                );
                if (hasContraindication) {
                    conflicts.push({
                        itemA: { text: `Medication discussed: ${text.substring(0, 150)}`, source: 'new', timestamp: new Date().toISOString() },
                        itemB: { text: `Contraindication: ${source.text.substring(0, 150)}`, source: source.source, timestamp: source.timestamp || '' },
                        severity: rule.severity
                    });
                    break; // One conflict per rule is enough
                }
            }
        }

        return conflicts;
    }

    _checkAssessmentContradictions(newItem) {
        const conflicts = [];
        const text = (newItem.text || newItem || '').toLowerCase();

        const opposites = [
            ['improving', 'worsening'],
            ['stable', 'deteriorating'],
            ['resolved', 'active'],
            ['no evidence', 'confirmed'],
            ['controlled', 'uncontrolled']
        ];

        const activeObs = this.document.sessionContext.aiObservations
            .filter(o => typeof o === 'object' ? o.status === 'active' : true);

        for (const obs of activeObs) {
            const obsText = (typeof obs === 'string' ? obs : obs.text).toLowerCase();

            for (const [termA, termB] of opposites) {
                if ((text.includes(termA) && obsText.includes(termB)) ||
                    (text.includes(termB) && obsText.includes(termA))) {
                    // Verify they're about the same clinical topic
                    if (this._sharesClinicalTopic(text, obsText)) {
                        conflicts.push({
                            itemA: { text: typeof obs === 'string' ? obs : obs.text, source: 'aiObservation', timestamp: typeof obs === 'object' ? obs.timestamp : '' },
                            itemB: { text: newItem.text || newItem, source: newItem.source || 'new', timestamp: new Date().toISOString() },
                            severity: 'warning'
                        });
                    }
                }
            }
        }

        return conflicts;
    }

    /**
     * Check if two texts share a clinical topic (same disease category)
     */
    _sharesClinicalTopic(textA, textB) {
        if (typeof PROBLEM_CATEGORIES === 'undefined') return false;

        for (const [category, config] of Object.entries(PROBLEM_CATEGORIES)) {
            const keywords = config.keywords || [];
            const aMatches = keywords.some(kw => textA.includes(kw));
            const bMatches = keywords.some(kw => textB.includes(kw));
            if (aMatches && bMatches) return true;
        }
        return false;
    }

    /**
     * Add a conflict to the conflict log
     * @param {Object} conflict - {itemA, itemB, severity}
     */
    addConflict(conflict) {
        if (!this.document.sessionContext.conflicts) {
            this.document.sessionContext.conflicts = [];
        }

        // Dedup check
        const isDuplicate = this.document.sessionContext.conflicts.some(c =>
            !c.resolvedAt &&
            c.itemA.text === conflict.itemA.text &&
            c.itemB.text === conflict.itemB.text
        );
        if (isDuplicate) return;

        const id = `conflict_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
        this.document.sessionContext.conflicts.push({
            id,
            ...conflict,
            detectedAt: new Date().toISOString(),
            resolvedAt: null,
            resolution: null
        });

        // Critical conflicts also become safety flags
        if (conflict.severity === 'critical') {
            this.addSafetyFlag(
                `CONFLICT: ${conflict.itemA.text.substring(0, 80)} vs ${conflict.itemB.text.substring(0, 80)}`,
                'critical'
            );
        }

        console.log(`Conflict detected (${conflict.severity}):`, conflict.itemA.text, 'vs', conflict.itemB.text);
    }

    // Helper: get text sources for conflict detection
    _getActiveObservationTexts() {
        return this.document.sessionContext.aiObservations
            .filter(o => typeof o === 'object' ? o.status === 'active' : true)
            .map(o => ({
                text: typeof o === 'string' ? o : o.text,
                source: 'aiObservation',
                timestamp: typeof o === 'object' ? o.timestamp : ''
            }));
    }

    _getDoctorDictationTexts() {
        return (this.document.sessionContext.doctorDictation || [])
            .map(d => ({ text: d.text, source: 'doctorDictation', timestamp: d.timestamp }));
    }

    _getProblemListTexts() {
        const texts = [];
        for (const [id, timeline] of this.document.problemMatrix) {
            texts.push({
                text: `${timeline.problem.name} [${timeline.problem.status}] ${timeline.problem.notes || ''}`,
                source: 'problemList',
                timestamp: ''
            });
        }
        return texts;
    }

    _getNurseConversationTexts() {
        return (this.document.sessionContext.nurseConversation || [])
            .map(m => ({ text: m.content, source: 'nurseConversation', timestamp: '' }));
    }

    // ============================================================
    // MEMORY PRUNING
    // ============================================================

    /**
     * Prune observations that are outdated, superseded, or invalidated.
     * Called after addAIObservation and periodically.
     */
    pruneObservations() {
        const obs = this.document.sessionContext.aiObservations;
        if (!obs || obs.length === 0) return;

        const now = new Date();

        for (const o of obs) {
            // Skip non-structured (old string format) and already-inactive entries
            if (typeof o !== 'object' || o.status !== 'active') continue;

            // Rule 1: "No data" observations invalidated when data now exists
            if (this._isNoDataObservation(o) && this._hasDataNow(o)) {
                o.status = 'invalidated';
                continue;
            }

            // Rule 2: Observations >4 hours old superseded by newer on same topic
            const ageMs = now - new Date(o.timestamp);
            if (ageMs > 4 * 60 * 60 * 1000) {
                const newerOnSameTopic = obs.some(other =>
                    typeof other === 'object' &&
                    other.id !== o.id &&
                    other.status === 'active' &&
                    new Date(other.timestamp) > new Date(o.timestamp) &&
                    this._sharesClinicalTopic(o.text.toLowerCase(), other.text.toLowerCase())
                );
                if (newerOnSameTopic) {
                    o.status = 'superseded';
                }
            }
        }

        // Cap active observations at 30
        const active = obs.filter(o => typeof o === 'object' && o.status === 'active');
        if (active.length > 30) {
            active.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
            const toSupersede = active.slice(0, active.length - 30);
            toSupersede.forEach(o => { o.status = 'superseded'; });
        }

        // Remove very old inactive entries (keep last 20 for audit trail)
        const inactive = obs.filter(o => typeof o === 'object' && o.status !== 'active');
        if (inactive.length > 20) {
            inactive.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
            const toRemove = inactive.slice(0, inactive.length - 20);
            for (const r of toRemove) {
                const idx = obs.indexOf(r);
                if (idx !== -1) obs.splice(idx, 1);
            }
        }
    }

    _isNoDataObservation(obs) {
        return /no data|no results|not available|not yet|no .* found|no .* populated|no .* recorded/i.test(obs.text);
    }

    _hasDataNow(obs) {
        const text = obs.text.toLowerCase();

        // Check if labs referenced in the observation now have data
        for (const [name, trend] of this.document.longitudinalData.labs) {
            if (text.includes(name.toLowerCase()) && trend.values.length > 0) {
                return true;
            }
        }

        // Check vitals
        if (text.includes('vital') && this.document.longitudinalData.vitals.length > 0) {
            return true;
        }

        // Generic "no data" about the document
        if (/no data populated|no data available|no chart data/i.test(obs.text)) {
            // If we have ANY data now, it's stale
            const hasAnyData = this.document.longitudinalData.vitals.length > 0 ||
                this.document.longitudinalData.labs.size > 0 ||
                this.document.problemMatrix.size > 0;
            if (hasAnyData) return true;
        }

        return false;
    }

    /**
     * Smart pruning of keyFindings — relevance-based instead of FIFO
     * @param {number} maxFindings - Maximum findings to keep
     */
    pruneKeyFindings(maxFindings = 20) {
        const findings = this.document.clinicalNarrative.keyFindings;
        if (!findings || findings.length <= maxFindings) return;

        // Score each finding by relevance
        const scored = findings.map((f, idx) => {
            let score = 0;

            // Recency bonus: later entries are more recent
            score += idx * 0.5;

            // Clinical severity keywords
            if (/critical|urgent|emergent|acute|unstable|deteriorat/i.test(f)) score += 10;
            if (/safety|contraindic|allerg|interaction/i.test(f)) score += 10;
            if (/worsening|declining|concerning|abnormal/i.test(f)) score += 5;
            if (/baseline|historical|chronic|stable/i.test(f)) score += 1;

            // Penalize "no data" findings
            if (/no data|no results|not available|not yet populated/i.test(f)) score -= 5;

            // Penalize findings that duplicate problem list info
            for (const [pid, timeline] of this.document.problemMatrix) {
                if (f.toLowerCase().includes(timeline.problem.name.toLowerCase())) {
                    score -= 2;
                    break;
                }
            }

            return { text: f, score };
        });

        // Keep top N by score
        scored.sort((a, b) => b.score - a.score);
        this.document.clinicalNarrative.keyFindings = scored.slice(0, maxFindings).map(s => s.text);
    }

    // ============================================================
    // CLINICAL NARRATIVE UPDATES
    // ============================================================

    /**
     * Update the trajectory assessment
     * @param {string} assessment - Trajectory assessment text
     */
    setTrajectoryAssessment(assessment) {
        this.document.clinicalNarrative.trajectoryAssessment = assessment;
    }

    /**
     * Add an open clinical question
     * @param {string} question - Question text
     */
    addOpenQuestion(question) {
        if (!this.document.clinicalNarrative.openQuestions.includes(question)) {
            this.document.clinicalNarrative.openQuestions.push(question);
        }
    }

    /**
     * Remove an open clinical question
     * @param {string} question - Question text to remove
     */
    removeOpenQuestion(question) {
        const idx = this.document.clinicalNarrative.openQuestions.indexOf(question);
        if (idx !== -1) {
            this.document.clinicalNarrative.openQuestions.splice(idx, 1);
        }
    }

    // ============================================================
    // MEDICATION UPDATES
    // ============================================================

    /**
     * Add a medication change event
     * @param {Object} change - Medication change object
     */
    addMedicationChange(change) {
        const changeEntry = {
            type: change.type || 'adjusted', // 'started', 'stopped', 'adjusted'
            date: change.date || new Date().toISOString(),
            name: change.name,
            dose: change.dose,
            reason: change.reason
        };

        this.document.longitudinalData.medications.recentChanges.unshift(changeEntry);

        // Sort by date
        this.document.longitudinalData.medications.recentChanges.sort((a, b) =>
            new Date(b.date) - new Date(a.date)
        );

        // Update timestamp
        this.document.metadata.lastUpdated = new Date().toISOString();

        console.log('Added medication change:', changeEntry);
    }

    // ============================================================
    // BULK SYNC FROM AI COWORKER STATE
    // ============================================================

    /**
     * Sync state from AICoworker to longitudinal document
     * @param {Object} aiState - AICoworker state object
     */
    syncFromAIState(aiState) {
        // Sync dictation history
        if (aiState.dictationHistory) {
            for (const d of aiState.dictationHistory) {
                const exists = this.document.sessionContext.doctorDictation.some(
                    existing => existing.text === d.text
                );
                if (!exists) {
                    this.document.sessionContext.doctorDictation.push({
                        timestamp: d.timestamp || new Date().toISOString(),
                        text: d.text
                    });
                }
            }
        }

        // Current dictation
        if (aiState.dictation) {
            const exists = this.document.sessionContext.doctorDictation.some(
                existing => existing.text === aiState.dictation
            );
            if (!exists) {
                this.document.sessionContext.doctorDictation.push({
                    timestamp: new Date().toISOString(),
                    text: aiState.dictation
                });
            }
        }

        // Sync safety flags
        if (aiState.flags) {
            for (const f of aiState.flags) {
                this.addSafetyFlag(f.text, f.severity);
            }
        }

        // Sync reviewed items
        if (aiState.reviewed) {
            for (const r of aiState.reviewed) {
                this.markReviewed(r);
            }
        }

        // Sync open items
        if (aiState.openItems) {
            this.document.sessionContext.pendingItems = [...aiState.openItems];
        }

        // Sync observations
        if (aiState.observations) {
            for (const obs of aiState.observations) {
                this.addAIObservation(obs);
                // Run conflict detection on new observations
                this.detectConflicts({ text: obs, source: 'aiObservation' });
            }
        }

        // Update timestamp
        this.document.metadata.lastUpdated = new Date().toISOString();
    }

    /**
     * Sync patient conversation history into the document
     * @param {Array} messages - Array of {role, content} from PatientChat
     */
    syncPatientConversation(messages) {
        if (!messages || messages.length === 0) return;

        // Take the most recent messages (last 20) to keep context manageable
        const recent = messages.slice(-20);
        this.document.sessionContext.patientConversation = recent.map(m => ({
            role: m.role === 'user' ? 'doctor' : 'patient',
            content: m.content
        }));
    }

    /**
     * Sync nurse conversation history into the document
     * @param {Array} messages - Array of {role, content} from NurseChat
     */
    syncNurseConversation(messages) {
        if (!messages || messages.length === 0) return;

        // Take the most recent messages (last 20) to keep context manageable
        const recent = messages.slice(-20);
        this.document.sessionContext.nurseConversation = recent.map(m => ({
            role: m.role === 'user' ? 'doctor' : 'nurse',
            content: m.content
        }));

        // Run conflict detection on the latest nurse message
        const latest = recent[recent.length - 1];
        if (latest && (latest.role !== 'user')) {
            this.detectConflicts({ text: latest.content, source: 'nurseConversation' });
        }
    }
}

// ============================================================
// EXPORTS
// ============================================================

window.LongitudinalDocumentUpdater = LongitudinalDocumentUpdater;

console.log('Longitudinal Document Updater loaded');
