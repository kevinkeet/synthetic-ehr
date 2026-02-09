/**
 * Longitudinal Document Builder
 *
 * Populates the LongitudinalClinicalDocument from JSON data sources.
 * Supports:
 * - buildFull(patientId): Initial full history load
 * - updateSince(doc, timestamp): Incremental updates with only new data
 */

class LongitudinalDocumentBuilder {
    constructor(dataLoader = window.dataLoader) {
        this.dataLoader = dataLoader;
    }

    // ============================================================
    // MAIN BUILD METHODS
    // ============================================================

    /**
     * Build a complete longitudinal document with full history
     * @param {string} patientId - Patient ID to load
     * @param {string} currentEncounterId - Optional current encounter ID
     * @returns {LongitudinalClinicalDocument}
     */
    async buildFull(patientId, currentEncounterId = null) {
        console.log(`Building full longitudinal document for patient ${patientId}...`);
        const startTime = Date.now();

        const doc = new LongitudinalClinicalDocument();
        doc.metadata.generatedAt = new Date().toISOString();
        doc.metadata.patientId = patientId;
        doc.metadata.currentEncounter = currentEncounterId;

        // Load all data in parallel for speed
        const [
            demographics,
            allergies,
            problems,
            medications,
            vitals,
            labs,
            notesIndex,
            encounters,
            imaging,
            socialHistory,
            familyHistory,
            procedures
        ] = await Promise.all([
            this.safeLoad(() => this.dataLoader.loadPatient(patientId)),
            this.safeLoad(() => this.dataLoader.loadAllergies(patientId)),
            this.safeLoad(() => this.dataLoader.loadProblems(patientId)),
            this.safeLoad(() => this.dataLoader.loadMedications(patientId)),
            this.safeLoad(() => this.dataLoader.loadVitals(patientId)),
            this.safeLoad(() => this.dataLoader.loadAllLabs(patientId)),
            this.safeLoad(() => this.dataLoader.loadNotesIndex(patientId)),
            this.safeLoad(() => this.dataLoader.loadEncounters(patientId)),
            this.safeLoad(() => this.dataLoader.loadImaging(patientId)),
            this.safeLoad(() => this.dataLoader.loadSocialHistory(patientId)),
            this.safeLoad(() => this.dataLoader.loadFamilyHistory(patientId)),
            this.safeLoad(() => this.dataLoader.loadProcedures(patientId))
        ]);

        // Load full content for recent notes
        const notes = await this.loadNotesWithContent(patientId, notesIndex);

        // Populate patient snapshot
        this.populatePatientSnapshot(doc, demographics, allergies, socialHistory, familyHistory);

        // Build problem matrix
        this.populateProblemMatrix(doc, problems, encounters, notes, labs, medications, vitals);

        // Build longitudinal data streams
        this.populateVitals(doc, vitals);
        this.populateLabTrends(doc, labs);
        this.populateMedications(doc, medications);
        this.populateImaging(doc, imaging);
        this.populateProcedures(doc, procedures);
        this.populateEncounters(doc, encounters);

        // Set last loaded timestamp for incremental updates
        doc.metadata.lastLoadedTimestamp = new Date().toISOString();
        doc.metadata.lastUpdated = doc.metadata.lastLoadedTimestamp;

        const elapsed = Date.now() - startTime;
        console.log(`Longitudinal document built in ${elapsed}ms`);
        console.log(`  - Problems: ${doc.problemMatrix.size}`);
        console.log(`  - Lab trends: ${doc.longitudinalData.labs.size}`);
        console.log(`  - Vitals: ${doc.longitudinalData.vitals.length}`);

        return doc;
    }

    /**
     * Update an existing document with data newer than the last load
     * @param {LongitudinalClinicalDocument} doc - Existing document to update
     * @param {string} sinceTimestamp - Only load data after this timestamp
     */
    async updateSince(doc, sinceTimestamp = null) {
        const timestamp = sinceTimestamp || doc.metadata.lastLoadedTimestamp;
        if (!timestamp) {
            console.warn('No timestamp provided, doing full rebuild');
            return this.buildFull(doc.metadata.patientId);
        }

        console.log(`Updating longitudinal document since ${timestamp}...`);
        const patientId = doc.metadata.patientId;

        // For now, we reload all data but only process items newer than timestamp
        // In a real system, the API would support date filtering
        const [vitals, labs] = await Promise.all([
            this.safeLoad(() => this.dataLoader.loadVitals(patientId)),
            this.safeLoad(() => this.dataLoader.loadAllLabs(patientId))
        ]);

        const sinceDate = new Date(timestamp);

        // Add new vitals
        if (vitals?.vitals) {
            const newVitals = vitals.vitals.filter(v =>
                new Date(v.date) > sinceDate
            );
            for (const v of newVitals) {
                this.addVitalToDoc(doc, v);
            }
        }

        // Add new labs
        if (labs) {
            const newLabs = labs.filter(l =>
                new Date(l.collectedDate) > sinceDate
            );
            for (const lab of newLabs) {
                this.addLabToDoc(doc, lab);
            }
        }

        doc.metadata.lastLoadedTimestamp = new Date().toISOString();
        doc.metadata.lastUpdated = doc.metadata.lastLoadedTimestamp;

        return doc;
    }

    // ============================================================
    // SAFE LOADING HELPERS
    // ============================================================

    async safeLoad(loadFn) {
        try {
            return await loadFn();
        } catch (error) {
            console.warn('Data load failed:', error.message);
            return null;
        }
    }

    async loadNotesWithContent(patientId, notesIndex) {
        if (!notesIndex?.notes) return [];

        const notes = [];
        const ninetyDaysAgo = new Date();
        ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

        for (const noteRef of notesIndex.notes) {
            const noteDate = new Date(noteRef.date);
            if (noteDate >= ninetyDaysAgo) {
                // Load full note content for recent notes
                try {
                    const fullNote = await this.dataLoader.loadNote(noteRef.id, patientId);
                    notes.push(fullNote);
                } catch (e) {
                    notes.push(noteRef); // Fall back to metadata only
                }
            } else {
                // Keep just metadata for older notes
                notes.push(noteRef);
            }
        }
        return notes;
    }

    // ============================================================
    // PATIENT SNAPSHOT
    // ============================================================

    populatePatientSnapshot(doc, demographics, allergies, socialHistory, familyHistory) {
        doc.patientSnapshot.demographics = demographics;
        doc.patientSnapshot.allergies = allergies?.allergies || [];
        doc.patientSnapshot.socialHistory = socialHistory;
        doc.patientSnapshot.familyHistory = familyHistory;

        if (demographics) {
            doc.patientSnapshot.codeStatus = demographics.codeStatus || 'Full Code';
            doc.patientSnapshot.advanceDirectives = demographics.advanceDirectives;
            doc.patientSnapshot.primaryProvider = demographics.primaryCareProvider;
            doc.patientSnapshot.insurance = demographics.insurance;
            doc.patientSnapshot.emergencyContact = demographics.emergencyContact;
        }
    }

    // ============================================================
    // PROBLEM MATRIX POPULATION
    // ============================================================

    populateProblemMatrix(doc, problems, encounters, notes, labs, medications, vitals) {
        if (!problems) return;

        // Combine active and resolved problems
        const allProblems = [
            ...((problems.active?.problems || []).map(p => ({ ...p, status: 'active' }))),
            ...((problems.resolved?.problems || []).map(p => ({ ...p, status: 'resolved' })))
        ];

        for (const problem of allProblems) {
            const timeline = new ProblemTimeline(problem);

            // Populate each time period
            for (const period of doc.options.timePeriods) {
                const { startDate, endDate } = doc.getPeriodBounds(period);
                const periodData = timeline.getPeriodData(period.label);

                // Filter encounters for this problem and period
                if (encounters?.encounters) {
                    periodData.encounters = encounters.encounters.filter(enc =>
                        this.isInDateRange(enc.date, startDate, endDate) &&
                        this.encounterAddressesProblem(enc, problem)
                    );
                }

                // Filter notes mentioning this problem
                if (notes) {
                    periodData.notes = this.filterNotesForProblem(notes, problem, startDate, endDate);
                }

                // Filter labs relevant to this problem
                if (labs) {
                    periodData.labs = this.filterLabsForProblem(labs, timeline, startDate, endDate);
                }

                // Filter vitals relevant to this problem
                if (vitals?.vitals) {
                    periodData.vitals = this.filterVitalsForProblem(vitals.vitals, timeline, startDate, endDate);
                }

                // Filter medication changes for this problem
                if (medications) {
                    this.filterMedsForProblem(periodData, medications, problem, startDate, endDate);
                }

                // Assess status/trend for this period
                this.assessPeriodStatus(periodData, timeline);
            }

            doc.problemMatrix.set(problem.id, timeline);
        }
    }

    isInDateRange(dateStr, startDate, endDate) {
        if (!dateStr) return false;
        const date = new Date(dateStr);
        return date >= startDate && date <= endDate;
    }

    encounterAddressesProblem(encounter, problem) {
        if (!encounter.diagnoses) return false;

        // Check if any diagnosis matches the problem
        const problemLower = problem.name.toLowerCase();
        return encounter.diagnoses.some(d =>
            d.name?.toLowerCase().includes(problemLower) ||
            d.icd10 === problem.icd10
        );
    }

    filterNotesForProblem(notes, problem, startDate, endDate) {
        const problemKeywords = this.getProblemKeywords(problem);
        const results = [];

        for (const note of notes) {
            if (!this.isInDateRange(note.date, startDate, endDate)) continue;

            // Check if note mentions the problem
            const content = (note.content || note.title || '').toLowerCase();
            const mentionsProblem = problemKeywords.some(kw => content.includes(kw));

            if (mentionsProblem) {
                results.push({
                    date: note.date,
                    type: note.type,
                    author: note.author,
                    excerpt: this.extractRelevantExcerpt(note.content, problemKeywords)
                });
            }
        }

        return results;
    }

    getProblemKeywords(problem) {
        const keywords = [problem.name.toLowerCase()];

        // Add category-specific keywords
        const lowerName = problem.name.toLowerCase();
        for (const [category, config] of Object.entries(PROBLEM_CATEGORIES)) {
            if (config.keywords.some(kw => lowerName.includes(kw))) {
                keywords.push(...config.keywords);
                break;
            }
        }

        return [...new Set(keywords)]; // Deduplicate
    }

    extractRelevantExcerpt(content, keywords, maxLength = 200) {
        if (!content) return '';

        // Find the first mention of a keyword and extract surrounding context
        const lowerContent = content.toLowerCase();
        for (const kw of keywords) {
            const idx = lowerContent.indexOf(kw);
            if (idx !== -1) {
                const start = Math.max(0, idx - 50);
                const end = Math.min(content.length, idx + kw.length + 150);
                let excerpt = content.substring(start, end);
                if (start > 0) excerpt = '...' + excerpt;
                if (end < content.length) excerpt = excerpt + '...';
                return excerpt;
            }
        }

        // If no keyword found, return beginning of content
        return content.substring(0, maxLength) + (content.length > maxLength ? '...' : '');
    }

    filterLabsForProblem(labs, timeline, startDate, endDate) {
        const relatedLabNames = timeline.getRelatedLabs();
        if (relatedLabNames.length === 0) return [];

        return labs.filter(lab =>
            this.isInDateRange(lab.collectedDate, startDate, endDate) &&
            relatedLabNames.some(name =>
                lab.name?.toLowerCase().includes(name.toLowerCase())
            )
        ).map(lab => ({
            name: lab.name,
            value: lab.value,
            unit: lab.unit,
            flag: lab.flag,
            date: lab.collectedDate
        }));
    }

    filterVitalsForProblem(vitals, timeline, startDate, endDate) {
        const relatedVitals = timeline.getRelatedVitals();
        if (relatedVitals.length === 0) return [];

        return vitals.filter(v =>
            this.isInDateRange(v.date, startDate, endDate)
        ).map(v => {
            const relevant = { date: v.date };
            for (const field of relatedVitals) {
                if (v[field] !== undefined) {
                    relevant[field] = v[field];
                }
                // Handle alternative names
                if (field === 'systolic' && v.systolic !== undefined) relevant.systolic = v.systolic;
                if (field === 'diastolic' && v.diastolic !== undefined) relevant.diastolic = v.diastolic;
                if (field === 'heartRate' && v.heartRate !== undefined) relevant.heartRate = v.heartRate;
                if (field === 'weight' && v.weight !== undefined) relevant.weight = v.weight;
                if (field === 'spO2' && v.spO2 !== undefined) relevant.spO2 = v.spO2;
                if (field === 'respiratoryRate' && v.respiratoryRate !== undefined) relevant.respiratoryRate = v.respiratoryRate;
                if (field === 'temperature' && v.temperature !== undefined) relevant.temperature = v.temperature;
            }
            return relevant;
        }).filter(v => Object.keys(v).length > 1); // Must have at least date + one vital
    }

    filterMedsForProblem(periodData, medications, problem, startDate, endDate) {
        const problemLower = problem.name.toLowerCase();

        // Check active medications for this problem
        if (medications.active?.medications) {
            periodData.medications.current = medications.active.medications.filter(med =>
                med.indication?.toLowerCase().includes(problemLower) ||
                this.medRelatedToProblem(med, problem)
            );
        }

        // Check historical medications for changes in this period
        if (medications.historical?.medications) {
            for (const med of medications.historical.medications) {
                if (!this.medRelatedToProblem(med, problem)) continue;

                // Check if started in this period
                if (med.startDate && this.isInDateRange(med.startDate, startDate, endDate)) {
                    periodData.medications.started.push(med);
                }

                // Check if stopped in this period
                if (med.endDate && this.isInDateRange(med.endDate, startDate, endDate)) {
                    periodData.medications.stopped.push({
                        ...med,
                        reason: med.discontinuedReason || med.reason
                    });
                }
            }
        }
    }

    medRelatedToProblem(med, problem) {
        const problemLower = problem.name.toLowerCase();
        const medName = (med.name || '').toLowerCase();
        const indication = (med.indication || '').toLowerCase();

        // Direct indication match
        if (indication.includes(problemLower)) return true;

        // Medication-problem associations
        const medProblemMap = {
            'heart failure': ['furosemide', 'lasix', 'carvedilol', 'metoprolol', 'lisinopril', 'entresto', 'spironolactone', 'digoxin'],
            'diabetes': ['metformin', 'insulin', 'glipizide', 'januvia', 'jardiance', 'ozempic', 'trulicity'],
            'hypertension': ['lisinopril', 'amlodipine', 'losartan', 'metoprolol', 'hydrochlorothiazide', 'hctz'],
            'atrial fibrillation': ['warfarin', 'eliquis', 'xarelto', 'pradaxa', 'metoprolol', 'diltiazem', 'digoxin'],
            'kidney': ['sodium bicarbonate', 'sevelamer', 'calcitriol', 'epoetin'],
            'anticoagulation': ['warfarin', 'eliquis', 'xarelto', 'pradaxa', 'heparin', 'lovenox', 'aspirin']
        };

        for (const [condition, meds] of Object.entries(medProblemMap)) {
            if (problemLower.includes(condition)) {
                if (meds.some(m => medName.includes(m))) return true;
            }
        }

        return false;
    }

    assessPeriodStatus(periodData, timeline) {
        // Simple heuristic for status assessment
        // In a real system, this would be more sophisticated

        if (periodData.isEmpty()) {
            periodData.status.trend = 'no data';
            return;
        }

        // Check lab trends
        if (periodData.labs.length > 0) {
            const criticalLabs = periodData.labs.filter(l =>
                l.flag === 'HH' || l.flag === 'LL' || l.flag === 'critical'
            );
            if (criticalLabs.length > 0) {
                periodData.status.trend = 'concerning';
                periodData.status.controlLevel = 'poorly-controlled';
                return;
            }
        }

        // Check if there were encounters (suggests active management)
        if (periodData.encounters.length > 0) {
            periodData.status.trend = 'active';
        }

        // Default to stable if no concerning findings
        if (!periodData.status.trend) {
            periodData.status.trend = 'stable';
            periodData.status.controlLevel = 'controlled';
        }
    }

    // ============================================================
    // LONGITUDINAL DATA POPULATION
    // ============================================================

    populateVitals(doc, vitalsData) {
        if (!vitalsData?.vitals) return;

        // Store all vitals sorted by date (most recent first)
        doc.longitudinalData.vitals = [...vitalsData.vitals].sort((a, b) =>
            new Date(b.date) - new Date(a.date)
        );

        // Also organize by time period
        for (const period of doc.options.timePeriods) {
            const { startDate, endDate } = doc.getPeriodBounds(period);
            const periodVitals = doc.longitudinalData.vitals.filter(v =>
                this.isInDateRange(v.date, startDate, endDate)
            );
            doc.longitudinalData.vitalsByPeriod.set(period.label, periodVitals);
        }
    }

    addVitalToDoc(doc, vital) {
        // Add to main array (maintain sort)
        doc.longitudinalData.vitals.unshift(vital);
        doc.longitudinalData.vitals.sort((a, b) =>
            new Date(b.date) - new Date(a.date)
        );

        // Add to appropriate period
        const periodLabel = doc.getTimePeriodForDate(vital.date);
        if (!doc.longitudinalData.vitalsByPeriod.has(periodLabel)) {
            doc.longitudinalData.vitalsByPeriod.set(periodLabel, []);
        }
        doc.longitudinalData.vitalsByPeriod.get(periodLabel).unshift(vital);

        // Update relevant problem timelines
        for (const [problemId, timeline] of doc.problemMatrix) {
            const relatedVitals = timeline.getRelatedVitals();
            if (relatedVitals.length > 0) {
                const periodData = timeline.getPeriodData(periodLabel);
                const relevantVital = { date: vital.date };
                let hasRelevant = false;

                for (const field of relatedVitals) {
                    if (vital[field] !== undefined) {
                        relevantVital[field] = vital[field];
                        hasRelevant = true;
                    }
                }

                if (hasRelevant) {
                    periodData.vitals.unshift(relevantVital);
                }
            }
        }
    }

    populateLabTrends(doc, labs) {
        if (!labs) return;

        // Group labs by name and build trends
        const labsByName = new Map();

        for (const lab of labs) {
            const name = lab.name;
            if (!labsByName.has(name)) {
                labsByName.set(name, new LabTrend(name, lab.referenceRange));
            }
            labsByName.get(name).addValue(
                lab.collectedDate,
                lab.value,
                lab.unit,
                lab.flag
            );
        }

        // Compute baselines
        for (const [name, trend] of labsByName) {
            trend.computeBaseline();
        }

        doc.longitudinalData.labs = labsByName;
    }

    addLabToDoc(doc, lab) {
        const name = lab.name;
        if (!doc.longitudinalData.labs.has(name)) {
            doc.longitudinalData.labs.set(name, new LabTrend(name, lab.referenceRange));
        }
        doc.longitudinalData.labs.get(name).addValue(
            lab.collectedDate,
            lab.value,
            lab.unit,
            lab.flag
        );

        // Update relevant problem timelines
        const periodLabel = doc.getTimePeriodForDate(lab.collectedDate);

        for (const [problemId, timeline] of doc.problemMatrix) {
            const relatedLabs = timeline.getRelatedLabs();
            if (relatedLabs.some(rl => lab.name.toLowerCase().includes(rl.toLowerCase()))) {
                const periodData = timeline.getPeriodData(periodLabel);
                periodData.labs.push({
                    name: lab.name,
                    value: lab.value,
                    unit: lab.unit,
                    flag: lab.flag,
                    date: lab.collectedDate
                });
            }
        }
    }

    populateMedications(doc, medications) {
        if (!medications) return;

        doc.longitudinalData.medications.current = medications.active?.medications || [];
        doc.longitudinalData.medications.historical = medications.historical?.medications || [];

        // Calculate recent changes (last 90 days)
        const ninetyDaysAgo = new Date();
        ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

        const changes = [];

        // Find medications started in last 90 days
        for (const med of doc.longitudinalData.medications.current) {
            if (med.startDate && new Date(med.startDate) >= ninetyDaysAgo) {
                changes.push({
                    type: 'started',
                    date: med.startDate,
                    name: med.name,
                    dose: med.dose,
                    reason: med.indication
                });
            }
        }

        // Find medications stopped in last 90 days
        for (const med of doc.longitudinalData.medications.historical) {
            if (med.endDate && new Date(med.endDate) >= ninetyDaysAgo) {
                changes.push({
                    type: 'stopped',
                    date: med.endDate,
                    name: med.name,
                    dose: med.dose,
                    reason: med.discontinuedReason || med.reason
                });
            }
        }

        // Sort by date (most recent first)
        changes.sort((a, b) => new Date(b.date) - new Date(a.date));
        doc.longitudinalData.medications.recentChanges = changes;
    }

    populateImaging(doc, imaging) {
        if (!imaging?.studies) return;
        doc.longitudinalData.imaging = imaging.studies;
    }

    populateProcedures(doc, procedures) {
        if (!procedures?.procedures) return;
        doc.longitudinalData.procedures = procedures.procedures;
    }

    populateEncounters(doc, encounters) {
        if (!encounters?.encounters) return;
        doc.longitudinalData.encounters = encounters.encounters;
    }
}

// ============================================================
// EXPORTS
// ============================================================

window.LongitudinalDocumentBuilder = LongitudinalDocumentBuilder;

console.log('Longitudinal Document Builder loaded');
