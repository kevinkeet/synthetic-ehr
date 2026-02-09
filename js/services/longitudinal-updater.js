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
     * Add an AI observation
     * @param {string} observation - Observation text
     */
    addAIObservation(observation) {
        if (!this.document.sessionContext.aiObservations.includes(observation)) {
            this.document.sessionContext.aiObservations.push(observation);
        }
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
            }
        }

        // Update timestamp
        this.document.metadata.lastUpdated = new Date().toISOString();
    }
}

// ============================================================
// EXPORTS
// ============================================================

window.LongitudinalDocumentUpdater = LongitudinalDocumentUpdater;

console.log('Longitudinal Document Updater loaded');
