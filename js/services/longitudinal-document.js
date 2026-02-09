/**
 * Longitudinal Clinical Document - Core Data Structures
 *
 * A problem-oriented, time-aware clinical context structure for LLM consumption.
 * Organizes patient data along two axes:
 * - Rows: Clinical problems/domains (e.g., Heart Failure, Diabetes, CKD)
 * - Columns: Time periods (Current Encounter, Past 24h, Past 7d, Past 30d, Past 90d, Historical)
 */

// ============================================================
// TIME PERIOD DEFINITIONS
// ============================================================

const DEFAULT_TIME_PERIODS = [
    { label: 'Current Encounter', range: 'current', priority: 1 },
    { label: 'Past 24 Hours', range: { hours: 24 }, priority: 2 },
    { label: 'Past 7 Days', range: { days: 7 }, priority: 3 },
    { label: 'Past 30 Days', range: { days: 30 }, priority: 4 },
    { label: 'Past 90 Days', range: { days: 90 }, priority: 5 },
    { label: 'Past Year', range: { days: 365 }, priority: 6 },
    { label: 'Historical', range: { days: Infinity }, priority: 7 }
];

// ============================================================
// PROBLEM CATEGORY MAPPINGS
// ============================================================

const PROBLEM_CATEGORIES = {
    cardiovascular: {
        keywords: ['heart failure', 'hf', 'chf', 'atrial fibrillation', 'afib', 'a-fib',
                   'hypertension', 'htn', 'cad', 'coronary', 'mi', 'myocardial',
                   'cardiomyopathy', 'valve', 'arrhythmia', 'angina', 'pericarditis'],
        relatedLabs: ['BNP', 'NT-proBNP', 'Troponin', 'Troponin I', 'Troponin T', 'CK-MB'],
        relatedVitals: ['systolic', 'diastolic', 'heartRate', 'weight']
    },
    renal: {
        keywords: ['kidney', 'ckd', 'chronic kidney', 'aki', 'acute kidney', 'nephro',
                   'renal', 'esrd', 'dialysis', 'proteinuria'],
        relatedLabs: ['BUN', 'Creatinine', 'eGFR', 'Potassium', 'Phosphorus', 'Calcium',
                      'Uric Acid', 'Cystatin C', 'Albumin/Creatinine Ratio'],
        relatedVitals: ['weight', 'systolic', 'diastolic']
    },
    endocrine: {
        keywords: ['diabetes', 'dm', 'dm2', 'dm1', 'type 2', 'type 1', 'a1c', 'thyroid',
                   'hypothyroid', 'hyperthyroid', 'adrenal', 'pituitary', 'insulin'],
        relatedLabs: ['Glucose', 'Hemoglobin A1c', 'HbA1c', 'TSH', 'Free T4', 'T3',
                      'Fructosamine', 'C-Peptide', 'Insulin'],
        relatedVitals: ['weight']
    },
    pulmonary: {
        keywords: ['copd', 'asthma', 'pneumonia', 'respiratory', 'lung', 'pulmonary',
                   'bronchitis', 'emphysema', 'fibrosis', 'sleep apnea', 'osa'],
        relatedLabs: ['pO2', 'pCO2', 'pH', 'Bicarbonate'],
        relatedVitals: ['spO2', 'respiratoryRate']
    },
    gi: {
        keywords: ['gi', 'gastrointestinal', 'bleed', 'bleeding', 'liver', 'hepatic',
                   'cirrhosis', 'gastro', 'peptic', 'ulcer', 'gerd', 'pancreatitis',
                   'colitis', 'crohn', 'ibd'],
        relatedLabs: ['AST', 'ALT', 'Alkaline Phosphatase', 'Bilirubin', 'Albumin',
                      'INR', 'PT', 'Ammonia', 'Lipase', 'Amylase'],
        relatedVitals: []
    },
    hematologic: {
        keywords: ['anemia', 'coagulation', 'bleeding', 'thrombocytopenia', 'leukemia',
                   'lymphoma', 'dvt', 'pe', 'pulmonary embolism', 'clot', 'anticoagulation'],
        relatedLabs: ['Hemoglobin', 'Hematocrit', 'WBC', 'Platelets', 'MCV', 'MCH',
                      'MCHC', 'RDW', 'Iron', 'Ferritin', 'TIBC', 'Reticulocyte',
                      'INR', 'PT', 'PTT', 'D-Dimer', 'Fibrinogen'],
        relatedVitals: []
    },
    neurologic: {
        keywords: ['neuropathy', 'stroke', 'cva', 'tia', 'seizure', 'epilepsy',
                   'dementia', 'alzheimer', 'parkinson', 'ms', 'multiple sclerosis'],
        relatedLabs: [],
        relatedVitals: []
    },
    infectious: {
        keywords: ['infection', 'sepsis', 'cellulitis', 'uti', 'pneumonia', 'abscess',
                   'osteomyelitis', 'endocarditis', 'meningitis', 'hiv', 'hepatitis'],
        relatedLabs: ['WBC', 'Procalcitonin', 'CRP', 'ESR', 'Lactate', 'Blood Culture'],
        relatedVitals: ['temperature', 'heartRate', 'respiratoryRate']
    },
    psychiatric: {
        keywords: ['depression', 'anxiety', 'bipolar', 'schizophrenia', 'ptsd',
                   'substance', 'alcohol', 'opioid', 'psychiatric'],
        relatedLabs: [],
        relatedVitals: []
    },
    musculoskeletal: {
        keywords: ['arthritis', 'osteoarthritis', 'rheumatoid', 'gout', 'fracture',
                   'osteoporosis', 'back pain', 'joint'],
        relatedLabs: ['Uric Acid', 'ESR', 'CRP', 'RF', 'Anti-CCP', 'ANA'],
        relatedVitals: []
    }
};

// ============================================================
// LAB TREND CLASS
// ============================================================

class LabTrend {
    constructor(labName, referenceRange = null) {
        this.name = labName;
        this.referenceRange = referenceRange;
        this.values = []; // Array of { date, value, unit, flag, context }

        // Computed properties
        this.trend = null;           // rising, falling, stable, fluctuating
        this.latestValue = null;
        this.baseline = null;        // Established baseline value
        this.criticalEvents = [];    // Times when critical values occurred
    }

    addValue(date, value, unit, flag = null, context = null) {
        const numValue = parseFloat(value);
        if (isNaN(numValue)) return;

        const entry = {
            date: new Date(date),
            value: numValue,
            unit: unit || '',
            flag: flag,  // 'H', 'L', 'HH', 'LL', 'critical'
            context: context // e.g., "during CHF exacerbation"
        };

        this.values.push(entry);
        this.values.sort((a, b) => b.date - a.date); // Most recent first

        // Track critical events
        if (flag === 'critical' || flag === 'HH' || flag === 'LL') {
            this.criticalEvents.push(entry);
        }

        this.computeTrend();
        this.latestValue = this.values[0];
    }

    computeTrend() {
        if (this.values.length < 2) {
            this.trend = 'insufficient data';
            return;
        }

        // Use up to 5 most recent values for trend
        const recentValues = this.values.slice(0, Math.min(5, this.values.length));
        const firstVal = recentValues[recentValues.length - 1].value;
        const lastVal = recentValues[0].value;

        if (firstVal === 0) {
            this.trend = 'stable';
            return;
        }

        const percentChange = ((lastVal - firstVal) / Math.abs(firstVal)) * 100;

        // Check for fluctuation (high variance)
        if (recentValues.length >= 3) {
            const values = recentValues.map(v => v.value);
            const mean = values.reduce((a, b) => a + b, 0) / values.length;
            const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
            const cv = (Math.sqrt(variance) / mean) * 100; // Coefficient of variation

            if (cv > 20) {
                this.trend = 'fluctuating';
                return;
            }
        }

        if (Math.abs(percentChange) < 5) {
            this.trend = 'stable';
        } else if (percentChange > 20) {
            this.trend = 'rising significantly';
        } else if (percentChange > 5) {
            this.trend = 'rising';
        } else if (percentChange < -20) {
            this.trend = 'falling significantly';
        } else {
            this.trend = 'falling';
        }
    }

    computeBaseline() {
        // Baseline is the median of values older than 30 days
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const olderValues = this.values.filter(v => v.date < thirtyDaysAgo);
        if (olderValues.length === 0) {
            this.baseline = null;
            return;
        }

        const sorted = olderValues.map(v => v.value).sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        this.baseline = sorted.length % 2 !== 0
            ? sorted[mid]
            : (sorted[mid - 1] + sorted[mid]) / 2;
    }

    getValuesByPeriod(startDate, endDate) {
        return this.values.filter(v =>
            v.date >= startDate && v.date <= endDate
        );
    }

    toSummaryString() {
        if (!this.latestValue) return `${this.name}: No data`;

        const flag = this.latestValue.flag ? ` (${this.latestValue.flag})` : '';
        const trendArrow = this.trend === 'rising' || this.trend === 'rising significantly' ? '↑' :
                          this.trend === 'falling' || this.trend === 'falling significantly' ? '↓' :
                          this.trend === 'fluctuating' ? '↕' : '→';

        return `${this.name}: ${this.latestValue.value}${this.latestValue.unit}${flag} ${trendArrow}`;
    }

    toDetailedString(maxEntries = 10) {
        if (this.values.length === 0) return `${this.name}: No data\n`;

        let str = `${this.name} (${this.trend}):\n`;
        const entries = this.values.slice(0, maxEntries);

        for (const v of entries) {
            const dateStr = v.date.toLocaleDateString();
            const flag = v.flag ? ` (${v.flag})` : '';
            str += `  ${dateStr}: ${v.value}${v.unit}${flag}\n`;
        }

        if (this.baseline) {
            str += `  Baseline: ${this.baseline}${entries[0]?.unit || ''}\n`;
        }

        return str;
    }
}

// ============================================================
// PROBLEM PERIOD DATA CLASS
// ============================================================

class ProblemPeriodData {
    constructor() {
        this.encounters = [];       // Encounters where this problem was addressed
        this.notes = [];            // Note excerpts relevant to this problem
        this.labs = [];             // Labs relevant to this problem
        this.medications = {
            started: [],            // Meds started in this period
            stopped: [],            // Meds stopped in this period
            adjusted: [],           // Meds adjusted (dose changes)
            current: []             // Currently active meds for this problem
        };
        this.vitals = [];           // Vitals relevant to problem (e.g., BP for HTN)
        this.imaging = [];          // Imaging relevant to problem
        this.procedures = [];       // Procedures, consults
        this.status = {
            trend: null,            // improving, worsening, stable, unknown
            controlLevel: null,     // well-controlled, poorly-controlled, etc.
            notes: ''               // Brief status note
        };
    }

    isEmpty() {
        return this.encounters.length === 0 &&
               this.notes.length === 0 &&
               this.labs.length === 0 &&
               this.vitals.length === 0 &&
               this.medications.started.length === 0 &&
               this.medications.stopped.length === 0 &&
               this.medications.adjusted.length === 0;
    }
}

// ============================================================
// PROBLEM TIMELINE CLASS
// ============================================================

class ProblemTimeline {
    constructor(problem) {
        this.problem = {
            id: problem.id,
            name: problem.name,
            icd10: problem.icd10 || null,
            snomed: problem.snomed || null,
            onsetDate: problem.onsetDate || null,
            resolvedDate: problem.resolvedDate || null,
            status: problem.status || 'active', // active, resolved, chronic
            priority: problem.priority || 'medium',
            category: this.categorize(problem.name),
            notes: problem.notes || ''
        };

        // Timeline entries organized by time period
        this.timeline = new Map(); // Map<timePeriodLabel, ProblemPeriodData>

        // Initialize all time periods
        for (const period of DEFAULT_TIME_PERIODS) {
            this.timeline.set(period.label, new ProblemPeriodData());
        }
    }

    categorize(problemName) {
        const lowerName = problemName.toLowerCase();

        for (const [category, config] of Object.entries(PROBLEM_CATEGORIES)) {
            if (config.keywords.some(kw => lowerName.includes(kw))) {
                return category;
            }
        }
        return 'other';
    }

    getRelatedLabs() {
        const config = PROBLEM_CATEGORIES[this.problem.category];
        return config ? config.relatedLabs : [];
    }

    getRelatedVitals() {
        const config = PROBLEM_CATEGORIES[this.problem.category];
        return config ? config.relatedVitals : [];
    }

    getPeriodData(periodLabel) {
        return this.timeline.get(periodLabel) || new ProblemPeriodData();
    }

    hasAnyData() {
        for (const [label, data] of this.timeline) {
            if (!data.isEmpty()) return true;
        }
        return false;
    }
}

// ============================================================
// LONGITUDINAL CLINICAL DOCUMENT CLASS
// ============================================================

class LongitudinalClinicalDocument {
    constructor(options = {}) {
        this.options = {
            timePeriods: options.timePeriods || DEFAULT_TIME_PERIODS,
            maxVitalsPerPeriod: options.maxVitalsPerPeriod || 20,
            maxLabsPerPeriod: options.maxLabsPerPeriod || 50,
            maxNotesPerPeriod: options.maxNotesPerPeriod || 10,
            includeResolvedProblems: options.includeResolvedProblems !== false,
            ...options
        };

        // Metadata
        this.metadata = {
            generatedAt: null,
            lastUpdated: null,
            lastLoadedTimestamp: null,  // For incremental updates
            patientId: null,
            currentEncounter: null,
            documentVersion: '1.0'
        };

        // Patient snapshot - always present at top
        this.patientSnapshot = {
            demographics: null,
            allergies: [],
            codeStatus: null,
            advanceDirectives: null,
            primaryProvider: null,
            insurance: null,
            emergencyContact: null,
            socialHistory: null,
            familyHistory: null
        };

        // The longitudinal matrix - problem rows x time columns
        this.problemMatrix = new Map(); // Map<problemId, ProblemTimeline>

        // Cross-cutting longitudinal data (not problem-specific)
        this.longitudinalData = {
            vitals: [],                 // All vitals, sorted by date desc
            vitalsByPeriod: new Map(),  // Map<timePeriod, VitalEntry[]>
            medications: {
                current: [],
                historical: [],
                recentChanges: []       // Last 90 days of changes
            },
            labs: new Map(),            // Map<labName, LabTrend>
            imaging: [],
            procedures: [],
            encounters: []
        };

        // Narrative synthesis
        this.clinicalNarrative = {
            trajectoryAssessment: '',   // AI-synthesized disease trajectory
            keyFindings: [],            // Critical observations
            openQuestions: [],          // Unresolved clinical questions
            patientVoice: '',           // What patient reported
            nursingAssessment: ''       // Nursing observations
        };

        // Context from current session
        this.sessionContext = {
            doctorDictation: [],
            aiObservations: [],
            safetyFlags: [],
            reviewedItems: [],
            pendingItems: []
        };
    }

    // Get a problem timeline by ID
    getProblem(problemId) {
        return this.problemMatrix.get(problemId);
    }

    // Get all problems in a category
    getProblemsByCategory(category) {
        const problems = [];
        for (const [id, timeline] of this.problemMatrix) {
            if (timeline.problem.category === category) {
                problems.push(timeline);
            }
        }
        return problems;
    }

    // Get all active problems
    getActiveProblems() {
        const problems = [];
        for (const [id, timeline] of this.problemMatrix) {
            if (timeline.problem.status === 'active') {
                problems.push(timeline);
            }
        }
        return problems;
    }

    // Get a lab trend by name
    getLabTrend(labName) {
        return this.longitudinalData.labs.get(labName);
    }

    // Get all lab trends for a problem
    getLabsForProblem(problemId) {
        const timeline = this.problemMatrix.get(problemId);
        if (!timeline) return [];

        const relatedLabNames = timeline.getRelatedLabs();
        const labs = [];

        for (const name of relatedLabNames) {
            const trend = this.longitudinalData.labs.get(name);
            if (trend) labs.push(trend);
        }

        return labs;
    }

    // Get vitals for a specific time period
    getVitalsForPeriod(periodLabel) {
        return this.longitudinalData.vitalsByPeriod.get(periodLabel) || [];
    }

    // Get the date bounds for a time period
    getPeriodBounds(period) {
        const now = new Date();
        let startDate, endDate = now;

        if (period.range === 'current') {
            // Current encounter - use encounter start or today
            const encounterStart = this.metadata.currentEncounter?.startDate;
            startDate = encounterStart ? new Date(encounterStart) : new Date(now.setHours(0, 0, 0, 0));
        } else if (period.range.hours) {
            startDate = new Date(now.getTime() - period.range.hours * 60 * 60 * 1000);
        } else if (period.range.days === Infinity) {
            startDate = new Date(0); // Beginning of time
        } else if (period.range.days) {
            startDate = new Date(now.getTime() - period.range.days * 24 * 60 * 60 * 1000);
        }

        return { startDate, endDate };
    }

    // Check if a date falls within a time period
    isInPeriod(date, period) {
        const { startDate, endDate } = this.getPeriodBounds(period);
        const checkDate = new Date(date);
        return checkDate >= startDate && checkDate <= endDate;
    }

    // Determine which time period a date belongs to
    getTimePeriodForDate(date) {
        const checkDate = new Date(date);

        for (const period of this.options.timePeriods) {
            if (this.isInPeriod(checkDate, period)) {
                return period.label;
            }
        }

        return 'Historical';
    }
}

// ============================================================
// EXPORTS
// ============================================================

// Make classes available globally
window.LongitudinalClinicalDocument = LongitudinalClinicalDocument;
window.ProblemTimeline = ProblemTimeline;
window.ProblemPeriodData = ProblemPeriodData;
window.LabTrend = LabTrend;
window.PROBLEM_CATEGORIES = PROBLEM_CATEGORIES;
window.DEFAULT_TIME_PERIODS = DEFAULT_TIME_PERIODS;

console.log('Longitudinal Document classes loaded');
