#!/usr/bin/env node
/**
 * Patient Data Generator for Synthetic EHR
 * Generates realistic, comprehensive patient data for testing medical AI agents
 *
 * Usage: node generate-patient-data.js [patientId] [options]
 * Options:
 *   --labs=N      Number of lab panels to generate (default: 200)
 *   --notes=N     Number of notes to generate (default: 50)
 *   --years=N     Years of medical history (default: 8)
 */

const fs = require('fs');
const path = require('path');

// Configuration
const CONFIG = {
    labPanels: 200,
    notes: 50,
    yearsOfHistory: 8,
    vitalsCount: 100,
    imagingStudies: 25,
    encounters: 80
};

// Parse command line arguments
const args = process.argv.slice(2);
const patientId = args[0] || 'PAT001';
args.forEach(arg => {
    if (arg.startsWith('--labs=')) CONFIG.labPanels = parseInt(arg.split('=')[1]);
    if (arg.startsWith('--notes=')) CONFIG.notes = parseInt(arg.split('=')[1]);
    if (arg.startsWith('--years=')) CONFIG.yearsOfHistory = parseInt(arg.split('=')[1]);
});

// Utility functions
function randomBetween(min, max) {
    return Math.random() * (max - min) + min;
}

function randomInt(min, max) {
    return Math.floor(randomBetween(min, max + 1));
}

function randomChoice(array) {
    return array[Math.floor(Math.random() * array.length)];
}

function randomDate(startDate, endDate) {
    const start = new Date(startDate).getTime();
    const end = new Date(endDate).getTime();
    return new Date(start + Math.random() * (end - start));
}

function formatDate(date) {
    return date.toISOString();
}

function generateId(prefix, index) {
    return `${prefix}${String(index).padStart(3, '0')}`;
}

// Medical data constants
const PROVIDERS = [
    { name: 'Dr. Sarah Chen', specialty: 'Primary Care', npi: '1234567890' },
    { name: 'Dr. James Wilson', specialty: 'Cardiology', npi: '1234567891' },
    { name: 'Dr. Michael Torres', specialty: 'Nephrology', npi: '1234567892' },
    { name: 'Dr. Emily Brown', specialty: 'Emergency Medicine', npi: '1234567893' },
    { name: 'Dr. Robert Kim', specialty: 'Urology', npi: '1234567894' },
    { name: 'Dr. Lisa Martinez', specialty: 'Endocrinology', npi: '1234567895' },
    { name: 'Dr. David Park', specialty: 'Pulmonology', npi: '1234567896' },
    { name: 'Dr. Jennifer Adams', specialty: 'Internal Medicine', npi: '1234567897' },
    { name: 'Dr. William Thompson', specialty: 'Gastroenterology', npi: '1234567898' },
    { name: 'Dr. Patricia Lee', specialty: 'Radiology', npi: '1234567899' }
];

const DEPARTMENTS = [
    'Primary Care', 'Cardiology', 'Nephrology', 'Endocrinology',
    'Emergency Department', 'Internal Medicine', 'Pulmonology'
];

const NOTE_TYPES = [
    'Progress Note', 'H&P', 'Consult', 'Discharge Summary',
    'Telephone Encounter', 'Procedure Note', 'Follow-up Note'
];

const ENCOUNTER_TYPES = [
    'Office Visit', 'Telehealth', 'Inpatient', 'Emergency', 'Procedure'
];

const CHIEF_COMPLAINTS = [
    'Diabetes follow-up', 'Heart failure follow-up', 'Medication refills',
    'Shortness of breath', 'Leg swelling', 'Chest discomfort',
    'Fatigue', 'Dizziness', 'Neuropathy symptoms', 'Routine follow-up',
    'CKD management', 'Blood pressure check', 'Lab review',
    'Weight gain', 'Palpitations', 'Annual wellness visit',
    'Cough', 'Urinary symptoms', 'Back pain', 'Joint pain'
];

// Lab panel definitions with realistic ranges for diabetic CKD patient
const LAB_PANELS = {
    'Basic Metabolic Panel': {
        tests: [
            { name: 'Sodium', baseValue: 138, variance: 4, unit: 'mEq/L', refRange: '136-145', critLow: 120, critHigh: 160 },
            { name: 'Potassium', baseValue: 4.5, variance: 0.6, unit: 'mEq/L', refRange: '3.5-5.0', critLow: 2.5, critHigh: 6.5 },
            { name: 'Chloride', baseValue: 102, variance: 4, unit: 'mEq/L', refRange: '98-106' },
            { name: 'CO2', baseValue: 24, variance: 3, unit: 'mEq/L', refRange: '23-29' },
            { name: 'BUN', baseValue: 32, variance: 10, unit: 'mg/dL', refRange: '7-20' },
            { name: 'Creatinine', baseValue: 1.85, variance: 0.3, unit: 'mg/dL', refRange: '0.7-1.3', critHigh: 10 },
            { name: 'Glucose', baseValue: 145, variance: 40, unit: 'mg/dL', refRange: '70-100', critLow: 40, critHigh: 500 },
            { name: 'Calcium', baseValue: 9.2, variance: 0.5, unit: 'mg/dL', refRange: '8.5-10.5' },
            { name: 'eGFR', baseValue: 38, variance: 6, unit: 'mL/min/1.73m2', refRange: '>90' }
        ]
    },
    'Complete Blood Count': {
        tests: [
            { name: 'WBC', baseValue: 7.5, variance: 2, unit: 'K/uL', refRange: '4.5-11.0' },
            { name: 'RBC', baseValue: 4.2, variance: 0.4, unit: 'M/uL', refRange: '4.5-5.5' },
            { name: 'Hemoglobin', baseValue: 12.5, variance: 1.5, unit: 'g/dL', refRange: '12.0-17.5', critLow: 7 },
            { name: 'Hematocrit', baseValue: 38, variance: 4, unit: '%', refRange: '36-50' },
            { name: 'MCV', baseValue: 92, variance: 6, unit: 'fL', refRange: '80-100' },
            { name: 'MCH', baseValue: 30, variance: 2, unit: 'pg', refRange: '27-33' },
            { name: 'MCHC', baseValue: 33.5, variance: 1.5, unit: 'g/dL', refRange: '32-36' },
            { name: 'RDW', baseValue: 14, variance: 1.5, unit: '%', refRange: '11.5-14.5' },
            { name: 'Platelets', baseValue: 210, variance: 50, unit: 'K/uL', refRange: '150-400' }
        ]
    },
    'Comprehensive Metabolic Panel': {
        tests: [
            { name: 'Sodium', baseValue: 138, variance: 4, unit: 'mEq/L', refRange: '136-145' },
            { name: 'Potassium', baseValue: 4.5, variance: 0.6, unit: 'mEq/L', refRange: '3.5-5.0' },
            { name: 'Chloride', baseValue: 102, variance: 4, unit: 'mEq/L', refRange: '98-106' },
            { name: 'CO2', baseValue: 24, variance: 3, unit: 'mEq/L', refRange: '23-29' },
            { name: 'BUN', baseValue: 32, variance: 10, unit: 'mg/dL', refRange: '7-20' },
            { name: 'Creatinine', baseValue: 1.85, variance: 0.3, unit: 'mg/dL', refRange: '0.7-1.3' },
            { name: 'Glucose', baseValue: 145, variance: 40, unit: 'mg/dL', refRange: '70-100' },
            { name: 'Calcium', baseValue: 9.2, variance: 0.5, unit: 'mg/dL', refRange: '8.5-10.5' },
            { name: 'Total Protein', baseValue: 7.0, variance: 0.6, unit: 'g/dL', refRange: '6.0-8.3' },
            { name: 'Albumin', baseValue: 3.8, variance: 0.4, unit: 'g/dL', refRange: '3.5-5.0' },
            { name: 'Total Bilirubin', baseValue: 0.8, variance: 0.4, unit: 'mg/dL', refRange: '0.1-1.2' },
            { name: 'ALP', baseValue: 75, variance: 25, unit: 'U/L', refRange: '44-147' },
            { name: 'AST', baseValue: 28, variance: 12, unit: 'U/L', refRange: '10-40' },
            { name: 'ALT', baseValue: 32, variance: 15, unit: 'U/L', refRange: '7-56' },
            { name: 'eGFR', baseValue: 38, variance: 6, unit: 'mL/min/1.73m2', refRange: '>90' }
        ]
    },
    'Lipid Panel': {
        tests: [
            { name: 'Total Cholesterol', baseValue: 165, variance: 30, unit: 'mg/dL', refRange: '<200' },
            { name: 'LDL', baseValue: 72, variance: 20, unit: 'mg/dL', refRange: '<100' },
            { name: 'HDL', baseValue: 44, variance: 8, unit: 'mg/dL', refRange: '>40' },
            { name: 'Triglycerides', baseValue: 160, variance: 50, unit: 'mg/dL', refRange: '<150' },
            { name: 'VLDL', baseValue: 32, variance: 10, unit: 'mg/dL', refRange: '<30' }
        ]
    },
    'Hemoglobin A1c': {
        tests: [
            { name: 'HbA1c', baseValue: 7.8, variance: 0.8, unit: '%', refRange: '4.0-5.6' }
        ]
    },
    'BNP': {
        tests: [
            { name: 'BNP', baseValue: 450, variance: 200, unit: 'pg/mL', refRange: '0-100' }
        ]
    },
    'Thyroid Panel': {
        tests: [
            { name: 'TSH', baseValue: 2.2, variance: 1.2, unit: 'mIU/L', refRange: '0.4-4.0' },
            { name: 'Free T4', baseValue: 1.2, variance: 0.3, unit: 'ng/dL', refRange: '0.8-1.8' }
        ]
    },
    'Iron Studies': {
        tests: [
            { name: 'Iron', baseValue: 75, variance: 30, unit: 'mcg/dL', refRange: '60-170' },
            { name: 'TIBC', baseValue: 320, variance: 40, unit: 'mcg/dL', refRange: '250-370' },
            { name: 'Ferritin', baseValue: 120, variance: 60, unit: 'ng/mL', refRange: '12-300' },
            { name: 'Transferrin Saturation', baseValue: 25, variance: 10, unit: '%', refRange: '20-50' }
        ]
    },
    'Coagulation Panel': {
        tests: [
            { name: 'PT', baseValue: 12.5, variance: 1.5, unit: 'seconds', refRange: '11-13.5' },
            { name: 'INR', baseValue: 1.1, variance: 0.2, unit: '', refRange: '0.8-1.2' },
            { name: 'PTT', baseValue: 30, variance: 5, unit: 'seconds', refRange: '25-35' }
        ]
    },
    'Urinalysis': {
        tests: [
            { name: 'Urine pH', baseValue: 6.0, variance: 1.0, unit: '', refRange: '4.5-8.0' },
            { name: 'Specific Gravity', baseValue: 1.018, variance: 0.008, unit: '', refRange: '1.005-1.030' },
            { name: 'Urine Protein', baseValue: 30, variance: 30, unit: 'mg/dL', refRange: 'Negative' },
            { name: 'Urine Glucose', baseValue: 50, variance: 50, unit: 'mg/dL', refRange: 'Negative' }
        ]
    },
    'Magnesium': {
        tests: [
            { name: 'Magnesium', baseValue: 1.9, variance: 0.3, unit: 'mg/dL', refRange: '1.7-2.2' }
        ]
    },
    'Phosphorus': {
        tests: [
            { name: 'Phosphorus', baseValue: 4.0, variance: 0.8, unit: 'mg/dL', refRange: '2.5-4.5' }
        ]
    },
    'Uric Acid': {
        tests: [
            { name: 'Uric Acid', baseValue: 7.5, variance: 1.5, unit: 'mg/dL', refRange: '3.5-7.2' }
        ]
    },
    'Vitamin D': {
        tests: [
            { name: 'Vitamin D, 25-Hydroxy', baseValue: 32, variance: 12, unit: 'ng/mL', refRange: '30-100' }
        ]
    },
    'Troponin': {
        tests: [
            { name: 'Troponin I', baseValue: 0.02, variance: 0.02, unit: 'ng/mL', refRange: '<0.04' }
        ]
    },
    'Procalcitonin': {
        tests: [
            { name: 'Procalcitonin', baseValue: 0.08, variance: 0.05, unit: 'ng/mL', refRange: '<0.1' }
        ]
    }
};

// Generate lab value with realistic variation
function generateLabValue(test, dateOffset = 0) {
    // Add some temporal variation (values may trend over time)
    let trendFactor = 1 + (dateOffset / 365) * 0.05 * (Math.random() - 0.5);
    let value = test.baseValue * trendFactor + (Math.random() - 0.5) * 2 * test.variance;

    // Round appropriately
    if (test.baseValue >= 100) {
        value = Math.round(value);
    } else if (test.baseValue >= 10) {
        value = Math.round(value * 10) / 10;
    } else {
        value = Math.round(value * 100) / 100;
    }

    return Math.max(0, value);
}

// Generate a lab panel
function generateLabPanel(panelName, date, index, orderedBy) {
    const panel = LAB_PANELS[panelName];
    if (!panel) return null;

    const daysSinceStart = Math.floor((new Date() - date) / (1000 * 60 * 60 * 24));

    return {
        id: generateId('LAB', index),
        name: panelName,
        collectedDate: formatDate(date),
        receivedDate: formatDate(new Date(date.getTime() + 30 * 60000)),
        reportedDate: formatDate(new Date(date.getTime() + 90 * 60000)),
        orderedBy: orderedBy,
        status: 'Final',
        specimen: panelName.includes('Urin') ? 'Urine' : 'Blood',
        results: panel.tests.map(test => ({
            name: test.name,
            value: generateLabValue(test, daysSinceStart),
            unit: test.unit,
            referenceRange: test.refRange
        }))
    };
}

// Generate all labs
function generateLabs(startDate, endDate) {
    const labs = [];
    const index = { panels: [], totalResults: 0 };

    let labIndex = 1;
    const panelTypes = Object.keys(LAB_PANELS);

    // Generate labs at varying frequencies
    const currentDate = new Date(startDate);
    while (currentDate <= endDate && labs.length < CONFIG.labPanels) {
        // Determine what panels to order based on "visit type"
        const isRoutineVisit = Math.random() > 0.3;
        const isHospitalization = Math.random() > 0.95;

        const orderedBy = randomChoice(PROVIDERS).name;

        if (isHospitalization) {
            // During hospitalization, order many labs
            ['Basic Metabolic Panel', 'Complete Blood Count', 'BNP', 'Troponin', 'Coagulation Panel'].forEach(panelName => {
                if (labs.length < CONFIG.labPanels) {
                    const panel = generateLabPanel(panelName, new Date(currentDate), labIndex++, orderedBy);
                    if (panel) {
                        labs.push(panel);
                        index.panels.push({ id: panel.id, name: panel.name, date: panel.collectedDate.split('T')[0] });
                    }
                }
            });
            currentDate.setDate(currentDate.getDate() + randomInt(1, 3));
        } else if (isRoutineVisit) {
            // Routine visit - BMP, maybe A1c or lipids
            const panelsToOrder = ['Basic Metabolic Panel'];
            if (Math.random() > 0.7) panelsToOrder.push('Hemoglobin A1c');
            if (Math.random() > 0.8) panelsToOrder.push('Lipid Panel');
            if (Math.random() > 0.85) panelsToOrder.push('Complete Blood Count');

            panelsToOrder.forEach(panelName => {
                if (labs.length < CONFIG.labPanels) {
                    const panel = generateLabPanel(panelName, new Date(currentDate), labIndex++, orderedBy);
                    if (panel) {
                        labs.push(panel);
                        index.panels.push({ id: panel.id, name: panel.name, date: panel.collectedDate.split('T')[0] });
                    }
                }
            });
            currentDate.setDate(currentDate.getDate() + randomInt(14, 45));
        } else {
            // Random single panel
            const panelName = randomChoice(panelTypes);
            const panel = generateLabPanel(panelName, new Date(currentDate), labIndex++, orderedBy);
            if (panel) {
                labs.push(panel);
                index.panels.push({ id: panel.id, name: panel.name, date: panel.collectedDate.split('T')[0] });
            }
            currentDate.setDate(currentDate.getDate() + randomInt(7, 30));
        }
    }

    index.totalResults = labs.reduce((sum, panel) => sum + panel.results.length, 0);
    index.lastUpdated = formatDate(new Date());

    return { labs, index };
}

// Generate vitals
function generateVitals(startDate, endDate) {
    const vitals = [];
    const currentDate = new Date(endDate);

    for (let i = 0; i < CONFIG.vitalsCount; i++) {
        // Simulate some variation - CHF patient may have elevated BP, HR
        const isExacerbation = Math.random() > 0.9;

        vitals.push({
            date: formatDate(currentDate),
            systolic: Math.round(isExacerbation ? randomBetween(150, 170) : randomBetween(130, 145)),
            diastolic: Math.round(isExacerbation ? randomBetween(85, 100) : randomBetween(75, 88)),
            heartRate: Math.round(isExacerbation ? randomBetween(85, 105) : randomBetween(65, 80)),
            respiratoryRate: Math.round(isExacerbation ? randomBetween(18, 24) : randomBetween(14, 18)),
            temperature: Math.round(randomBetween(97.8, 99.2) * 10) / 10,
            spO2: Math.round(isExacerbation ? randomBetween(91, 95) : randomBetween(94, 98)),
            weight: Math.round((isExacerbation ? randomBetween(100, 104) : randomBetween(97, 100)) * 10) / 10,
            height: 175,
            painScore: randomInt(0, isExacerbation ? 5 : 3),
            recordedBy: randomChoice(['RN Smith', 'RN Johnson', 'RN Davis', 'RN Williams', 'RN Garcia'])
        });

        currentDate.setDate(currentDate.getDate() - randomInt(3, 14));
        if (currentDate < startDate) break;
    }

    return { vitals };
}

// Generate encounters
function generateEncounters(startDate, endDate) {
    const encounters = [];
    const currentDate = new Date(endDate);

    for (let i = 1; i <= CONFIG.encounters; i++) {
        const type = randomChoice(ENCOUNTER_TYPES);
        const provider = randomChoice(PROVIDERS);

        encounters.push({
            id: generateId('ENC', i),
            date: formatDate(currentDate),
            type: type,
            department: provider.specialty === 'Emergency Medicine' ? 'Emergency Department' : provider.specialty,
            provider: provider.name,
            chiefComplaint: randomChoice(CHIEF_COMPLAINTS),
            diagnoses: generateDiagnoses(),
            status: 'Completed'
        });

        // Variable time between encounters
        const daysToSubtract = type === 'Inpatient' ? randomInt(1, 5) : randomInt(7, 45);
        currentDate.setDate(currentDate.getDate() - daysToSubtract);
        if (currentDate < startDate) break;
    }

    return { encounters };
}

function generateDiagnoses() {
    const allDiagnoses = [
        'Type 2 Diabetes Mellitus', 'Chronic Kidney Disease Stage 3b',
        'Heart Failure with Reduced EF', 'Atrial Fibrillation',
        'Hypertension', 'Hyperlipidemia', 'Diabetic Neuropathy',
        'Volume Overload', 'Acute Kidney Injury', 'Hyperkalemia'
    ];
    const count = randomInt(1, 4);
    const selected = [];
    for (let i = 0; i < count; i++) {
        const diagnosis = randomChoice(allDiagnoses);
        if (!selected.includes(diagnosis)) selected.push(diagnosis);
    }
    return selected;
}

// Note templates
const NOTE_TEMPLATES = {
    'Progress Note': generateProgressNote,
    'H&P': generateHPNote,
    'Discharge Summary': generateDischargeSummary,
    'Consult': generateConsultNote,
    'Telephone Encounter': generatePhoneNote,
    'Follow-up Note': generateFollowUpNote
};

function generateProgressNote(date, provider, encounter) {
    const cc = randomChoice(CHIEF_COMPLAINTS);
    return {
        type: 'Progress Note',
        date: formatDate(date),
        author: provider.name,
        department: provider.specialty,
        encounter: encounter,
        chiefComplaint: cc,
        hpi: `Patient presents for ${cc.toLowerCase()}. ${generateHPIContent()}`,
        reviewOfSystems: generateROS(),
        vitals: generateNoteVitals(),
        physicalExam: generatePhysicalExam(),
        assessment: generateAssessment(),
        plan: generatePlan(),
        attestation: `I personally saw and examined the patient. I agree with the documented findings and plan.\n\nElectronically signed by: ${provider.name}\nDate: ${date.toLocaleDateString()}`
    };
}

function generateHPNote(date, provider, encounter) {
    return {
        type: 'H&P',
        date: formatDate(date),
        author: provider.name,
        department: provider.specialty,
        encounter: encounter,
        chiefComplaint: randomChoice(['Shortness of breath', 'Chest pain', 'Leg swelling', 'Weakness']),
        hpi: generateDetailedHPI(),
        pastMedicalHistory: generatePMH(),
        medications: 'See medication list in chart.',
        allergies: 'Penicillin (anaphylaxis), Sulfa drugs (rash), Lisinopril (angioedema), Shellfish (hives)',
        socialHistory: generateSocialHistory(),
        familyHistory: 'Father: MI at 62, HTN. Mother: T2DM. Brother: HTN.',
        reviewOfSystems: generateROS(),
        vitals: generateNoteVitals(),
        physicalExam: generatePhysicalExam(),
        assessment: generateAssessment(),
        plan: generatePlan(),
        attestation: `I have personally evaluated this patient and agree with the documentation above.\n\nElectronically signed by: ${provider.name}\nDate: ${date.toLocaleDateString()}`
    };
}

function generateDischargeSummary(date, provider, encounter) {
    const admitDate = new Date(date.getTime() - randomInt(2, 7) * 24 * 60 * 60 * 1000);
    return {
        type: 'Discharge Summary',
        date: formatDate(date),
        author: provider.name,
        department: provider.specialty,
        encounter: encounter,
        sections: [
            { title: 'Admission Date', content: admitDate.toLocaleDateString() },
            { title: 'Discharge Date', content: date.toLocaleDateString() },
            { title: 'Attending Physician', content: provider.name },
            { title: 'Principal Diagnosis', content: randomChoice(['Acute heart failure exacerbation', 'Community-acquired pneumonia', 'Acute kidney injury', 'Hyperglycemia']) },
            { title: 'Secondary Diagnoses', content: '1. Type 2 Diabetes Mellitus\n2. Chronic Kidney Disease Stage 3b\n3. Heart Failure with Reduced EF\n4. Atrial Fibrillation\n5. Hypertension' },
            { title: 'Hospital Course', content: generateHospitalCourse() },
            { title: 'Discharge Medications', content: 'See medication reconciliation.' },
            { title: 'Discharge Instructions', content: generateDischargeInstructions() },
            { title: 'Follow-Up Appointments', content: '1. Primary Care: 1 week\n2. Cardiology: 2 weeks\n3. Nephrology: 4 weeks' },
            { title: 'Discharge Condition', content: 'Stable, improved' },
            { title: 'Disposition', content: 'Home with family' }
        ],
        attestation: `Discharge summary reviewed and approved.\n\nElectronically signed by: ${provider.name}\nDate: ${date.toLocaleDateString()}`
    };
}

function generateConsultNote(date, provider, encounter) {
    return {
        type: 'Consult',
        date: formatDate(date),
        author: provider.name,
        department: provider.specialty,
        encounter: encounter,
        sections: [
            { title: 'Reason for Consultation', content: `${provider.specialty} consultation requested for ${randomChoice(['management of', 'evaluation of', 'recommendations regarding'])} ${randomChoice(['heart failure', 'renal function', 'diabetes management', 'anticoagulation'])}` },
            { title: 'History of Present Illness', content: generateHPIContent() },
            { title: 'Assessment', content: generateConsultAssessment(provider.specialty) },
            { title: 'Recommendations', content: generateConsultRecommendations(provider.specialty) }
        ],
        attestation: `${provider.specialty} consultation completed.\n\nElectronically signed by: ${provider.name}\nDate: ${date.toLocaleDateString()}`
    };
}

function generatePhoneNote(date, provider, encounter) {
    return {
        type: 'Telephone Encounter',
        date: formatDate(date),
        author: provider.name,
        department: provider.specialty,
        encounter: encounter,
        content: `Patient called regarding ${randomChoice(['medication question', 'lab results', 'symptom update', 'appointment scheduling', 'prescription refill'])}.\n\n${generatePhoneContent()}\n\nPlan: ${randomChoice(['Continue current management', 'Schedule follow-up appointment', 'Sent prescription to pharmacy', 'Advised to come to office if symptoms worsen'])}.`,
        attestation: `Telephone encounter documented.\n\nElectronically signed by: ${provider.name}\nDate: ${date.toLocaleDateString()}`
    };
}

function generateFollowUpNote(date, provider, encounter) {
    return generateProgressNote(date, provider, encounter);
}

// Helper functions for note content
function generateHPIContent() {
    const templates = [
        'Reports overall stable condition since last visit. Compliant with medications. No new symptoms.',
        'Presents with mild worsening of baseline symptoms. Reports increased fatigue over the past week.',
        'Doing well on current regimen. Blood sugars well-controlled. No hypoglycemic episodes.',
        'Reports some shortness of breath with exertion, at baseline. No chest pain or palpitations.',
        'Weight stable. Following low-sodium diet. Monitoring blood pressure at home.'
    ];
    return randomChoice(templates);
}

function generateDetailedHPI() {
    return `72-year-old male with history of Type 2 Diabetes Mellitus, CKD Stage 3b, HFrEF (EF 35%), and atrial fibrillation who presents with ${randomChoice(['worsening shortness of breath', 'increased leg swelling', 'fatigue', 'chest discomfort'])} over the past ${randomInt(2, 7)} days.

Patient reports ${randomChoice(['gradual', 'sudden'])} onset of symptoms. ${randomChoice(['Associated with mild exertion.', 'Occurs at rest.', 'Worse when lying flat.'])} ${randomChoice(['Denies chest pain.', 'Reports mild chest pressure.'])} ${randomChoice(['No fever or cough.', 'Some dry cough present.'])}

Patient ${randomChoice(['has been', 'has not been'])} compliant with medications. ${randomChoice(['Reports dietary indiscretion.', 'Following low-sodium diet.', 'Admits to increased salt intake recently.'])} Last cardiology visit was ${randomInt(1, 3)} months ago.`;
}

function generatePMH() {
    return `1. Type 2 Diabetes Mellitus with neuropathy (diagnosed 2010)
2. Chronic Kidney Disease Stage 3b (diagnosed 2018)
3. Heart Failure with Reduced Ejection Fraction, EF 35% (diagnosed 2019)
4. Atrial Fibrillation, persistent (diagnosed 2017)
5. Hypertension (diagnosed 2005)
6. Hyperlipidemia (diagnosed 2008)
7. Benign Prostatic Hyperplasia (diagnosed 2016)
8. History of pneumonia (2021)`;
}

function generateSocialHistory() {
    return 'Former smoker (quit 1995, 20 pack-year history). Rare alcohol use. Retired accountant. Lives with wife.';
}

function generateROS() {
    return {
        'Constitutional': randomChoice(['No fever, chills, or weight loss', 'Reports fatigue', 'Weight stable']),
        'Cardiovascular': randomChoice(['No chest pain or palpitations', 'Dyspnea on exertion at baseline', 'No orthopnea']),
        'Respiratory': randomChoice(['No cough or wheezing', 'Mild dyspnea', 'No hemoptysis']),
        'GI': randomChoice(['No nausea or vomiting', 'Appetite fair', 'Regular bowel movements']),
        'GU': randomChoice(['No dysuria', 'Nocturia x2', 'No hematuria']),
        'Neurologic': randomChoice(['No dizziness', 'Baseline neuropathy', 'No new weakness'])
    };
}

function generateNoteVitals() {
    return {
        bp: `${randomInt(130, 150)}/${randomInt(75, 90)} mmHg`,
        hr: `${randomInt(65, 85)} bpm`,
        rr: `${randomInt(14, 20)}/min`,
        temp: `${(97.5 + Math.random() * 1.5).toFixed(1)}°F`,
        spo2: `${randomInt(94, 98)}% RA`,
        weight: `${(97 + Math.random() * 4).toFixed(1)} kg`
    };
}

function generatePhysicalExam() {
    return {
        'General': randomChoice(['Alert, oriented, no acute distress', 'Comfortable, well-appearing', 'Mildly fatigued-appearing']),
        'HEENT': 'Normocephalic, PERRL, oropharynx clear',
        'Cardiovascular': randomChoice(['Regular rate and rhythm, no murmurs', 'Irregularly irregular, no murmurs, JVP not elevated', 'S1/S2 normal, mild peripheral edema']),
        'Respiratory': randomChoice(['Clear to auscultation bilaterally', 'Mild crackles at bases', 'No wheezes or rhonchi']),
        'Abdomen': 'Soft, non-tender, non-distended',
        'Extremities': randomChoice(['No edema, warm and well-perfused', 'Trace bilateral ankle edema', '1+ pedal edema bilaterally']),
        'Neurologic': 'Alert and oriented, decreased sensation bilateral feet'
    };
}

function generateAssessment() {
    const assessments = [
        { diagnosis: 'Type 2 Diabetes Mellitus', icd10: 'E11.65', notes: 'HbA1c ' + (7 + Math.random() * 1.5).toFixed(1) + '%. On insulin and metformin.' },
        { diagnosis: 'Chronic Kidney Disease Stage 3b', icd10: 'N18.32', notes: 'eGFR ' + randomInt(32, 42) + '. Stable.' },
        { diagnosis: 'Heart Failure with Reduced EF', icd10: 'I50.22', notes: 'NYHA Class II. On GDMT.' },
        { diagnosis: 'Atrial Fibrillation', icd10: 'I48.1', notes: 'Rate controlled. On anticoagulation.' }
    ];
    return assessments.slice(0, randomInt(2, 4));
}

function generatePlan() {
    return [
        { problem: 'Diabetes', action: 'Continue current regimen. Recheck HbA1c in 3 months.' },
        { problem: 'CKD', action: 'Monitor renal function. Avoid nephrotoxins.' },
        { problem: 'Heart Failure', action: 'Continue GDMT. Daily weights. Low sodium diet.' },
        { problem: 'Atrial Fibrillation', action: 'Continue anticoagulation. Rate control adequate.' },
        { problem: 'Follow-up', action: 'Return in ' + randomInt(4, 12) + ' weeks or sooner if needed.' }
    ];
}

function generateHospitalCourse() {
    return `Patient was admitted for ${randomChoice(['acute heart failure exacerbation', 'volume overload', 'shortness of breath'])} and treated with IV diuretics. Responded well to treatment with ${randomInt(3, 6)} liters of diuresis over ${randomInt(3, 5)} days. Symptoms improved, weight decreased from ${randomInt(100, 104)} kg to ${randomInt(96, 99)} kg. Renal function remained stable. No arrhythmias on telemetry. Patient educated on diet and medication compliance.`;
}

function generateDischargeInstructions() {
    return `1. Take all medications as prescribed
2. Weigh yourself daily
3. Follow low-sodium diet (<2g/day)
4. Limit fluids to 2 liters daily
5. Call if weight increases >3 lbs in a day or symptoms worsen
6. Follow up with appointments as scheduled`;
}

function generateConsultAssessment(specialty) {
    const assessments = {
        'Cardiology': 'Heart failure with reduced ejection fraction, currently compensated. Atrial fibrillation with controlled rate.',
        'Nephrology': 'CKD Stage 3b, likely diabetic nephropathy. Stable renal function.',
        'Endocrinology': 'Type 2 Diabetes with suboptimal control. Diabetic nephropathy and neuropathy present.',
        'Pulmonology': 'Dyspnea likely cardiac in etiology. No primary pulmonary pathology identified.'
    };
    return assessments[specialty] || 'Assessment documented in notes.';
}

function generateConsultRecommendations(specialty) {
    const recs = {
        'Cardiology': '1. Continue GDMT for HFrEF\n2. Consider SGLT2 inhibitor\n3. Repeat echo in 6 months\n4. Continue anticoagulation for AFib',
        'Nephrology': '1. Continue ACEi/ARB (tolerating Entresto)\n2. Avoid nephrotoxins\n3. Renally dose medications\n4. Check urine albumin/creatinine ratio',
        'Endocrinology': '1. Adjust insulin regimen\n2. Target HbA1c <8% given comorbidities\n3. Continue metformin if eGFR >30\n4. Annual eye exam',
        'Pulmonology': '1. Optimize heart failure management\n2. Consider sleep study if symptoms persist\n3. Pulmonary function tests if indicated'
    };
    return recs[specialty] || 'Recommendations documented above.';
}

function generatePhoneContent() {
    return randomChoice([
        'Patient reports feeling well. Blood sugars in target range. No new concerns.',
        'Patient asking about lab results. Reviewed recent values - stable kidney function, A1c improving.',
        'Patient reports mild increase in leg swelling. Advised to elevate legs, monitor weight, call if worsens.',
        'Pharmacy called regarding prior authorization for medication. Completed PA form.',
        'Patient requesting refill of maintenance medications. Verified adherence. Sent to pharmacy.'
    ]);
}

// Generate notes
function generateNotes(encounters, startDate, endDate) {
    const notes = [];
    const index = { notes: [] };

    let noteIndex = 1;

    // Generate notes based on encounters
    encounters.encounters.forEach(encounter => {
        const noteType = encounter.type === 'Inpatient' ?
            randomChoice(['H&P', 'Progress Note', 'Discharge Summary']) :
            encounter.type === 'Emergency' ?
            'H&P' :
            randomChoice(['Progress Note', 'Follow-up Note', 'Telephone Encounter']);

        const provider = PROVIDERS.find(p => p.name === encounter.provider) || PROVIDERS[0];
        const date = new Date(encounter.date);

        const noteGenerator = NOTE_TEMPLATES[noteType] || generateProgressNote;
        const note = {
            id: generateId('NOTE', noteIndex),
            ...noteGenerator(date, provider, encounter.id)
        };

        notes.push(note);
        index.notes.push({
            id: note.id,
            type: note.type,
            date: note.date,
            author: note.author,
            department: note.department || provider.specialty,
            encounter: encounter.id,
            preview: generatePreview(note)
        });

        noteIndex++;

        // For hospitalizations, add additional notes
        if (encounter.type === 'Inpatient' && notes.length < CONFIG.notes) {
            // Add daily progress notes
            for (let day = 1; day <= randomInt(2, 4); day++) {
                const progressDate = new Date(date.getTime() + day * 24 * 60 * 60 * 1000);
                const progressNote = {
                    id: generateId('NOTE', noteIndex),
                    ...generateProgressNote(progressDate, provider, encounter.id)
                };
                notes.push(progressNote);
                index.notes.push({
                    id: progressNote.id,
                    type: progressNote.type,
                    date: progressNote.date,
                    author: progressNote.author,
                    department: progressNote.department || provider.specialty,
                    encounter: encounter.id,
                    preview: generatePreview(progressNote)
                });
                noteIndex++;
            }
        }
    });

    return { notes, index };
}

function generatePreview(note) {
    if (note.hpi) return note.hpi.substring(0, 100) + '...';
    if (note.content) return note.content.substring(0, 100) + '...';
    if (note.sections && note.sections.length > 0) {
        const firstContent = note.sections.find(s => s.content && s.content.length > 20);
        if (firstContent) return firstContent.content.substring(0, 100) + '...';
    }
    return 'Clinical documentation...';
}

// Generate imaging studies
function generateImaging(startDate, endDate) {
    const studies = [];
    const modalities = ['X-Ray', 'CT', 'MRI', 'Echo', 'Ultrasound', 'Nuclear'];
    const descriptions = {
        'X-Ray': ['Chest X-Ray PA and Lateral', 'Chest X-Ray Portable', 'KUB', 'Lumbar Spine X-Ray'],
        'CT': ['CT Chest with Contrast', 'CT Abdomen/Pelvis with Contrast', 'CT Head without Contrast', 'CTA Chest'],
        'MRI': ['MRI Brain with/without Contrast', 'MRI Lumbar Spine', 'MRA Head and Neck'],
        'Echo': ['Transthoracic Echocardiogram', 'Stress Echocardiogram', 'TEE'],
        'Ultrasound': ['Renal Ultrasound', 'Abdominal Ultrasound', 'Lower Extremity Venous Doppler', 'Carotid Ultrasound'],
        'Nuclear': ['Myocardial Perfusion Imaging', 'Renal Scan', 'V/Q Scan']
    };

    for (let i = 1; i <= CONFIG.imagingStudies; i++) {
        const modality = randomChoice(modalities);
        const date = randomDate(startDate, endDate);

        studies.push({
            id: generateId('IMG', i),
            date: formatDate(date),
            modality: modality,
            description: randomChoice(descriptions[modality]),
            facility: 'Springfield Medical Center',
            status: 'Final',
            radiologist: randomChoice(['Dr. Patricia Lee', 'Dr. Robert Chang', 'Dr. Susan Miller'])
        });
    }

    // Sort by date descending
    studies.sort((a, b) => new Date(b.date) - new Date(a.date));

    return { studies };
}

// Main generation function
function generatePatientData() {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setFullYear(startDate.getFullYear() - CONFIG.yearsOfHistory);

    console.log(`Generating patient data for ${patientId}...`);
    console.log(`  Labs: ${CONFIG.labPanels} panels`);
    console.log(`  Notes: ${CONFIG.notes} notes`);
    console.log(`  Years of history: ${CONFIG.yearsOfHistory}`);

    // Generate encounters first (notes will reference them)
    console.log('Generating encounters...');
    const encounters = generateEncounters(startDate, endDate);

    // Generate notes based on encounters
    console.log('Generating notes...');
    const { notes, index: notesIndex } = generateNotes(encounters, startDate, endDate);

    // Generate labs
    console.log('Generating labs...');
    const { labs, index: labsIndex } = generateLabs(startDate, endDate);

    // Generate vitals
    console.log('Generating vitals...');
    const vitals = generateVitals(startDate, endDate);

    // Generate imaging
    console.log('Generating imaging...');
    const imaging = generateImaging(startDate, endDate);

    // Write files
    const basePath = path.join(__dirname, '..', 'data', 'patients', patientId);

    // Ensure directories exist
    const dirs = ['', 'encounters', 'notes', 'labs', 'labs/panels', 'vitals', 'imaging', 'medications', 'problems', 'procedures'];
    dirs.forEach(dir => {
        const fullPath = path.join(basePath, dir);
        if (!fs.existsSync(fullPath)) {
            fs.mkdirSync(fullPath, { recursive: true });
        }
    });

    // Write encounters
    fs.writeFileSync(path.join(basePath, 'encounters', 'index.json'), JSON.stringify(encounters, null, 2));

    // Write notes
    fs.writeFileSync(path.join(basePath, 'notes', 'index.json'), JSON.stringify(notesIndex, null, 2));
    notes.forEach(note => {
        fs.writeFileSync(path.join(basePath, 'notes', `${note.id}.json`), JSON.stringify(note, null, 2));
    });

    // Write labs
    fs.writeFileSync(path.join(basePath, 'labs', 'index.json'), JSON.stringify(labsIndex, null, 2));
    labs.forEach(lab => {
        fs.writeFileSync(path.join(basePath, 'labs', 'panels', `${lab.id}.json`), JSON.stringify(lab, null, 2));
    });

    // Write vitals
    fs.writeFileSync(path.join(basePath, 'vitals', 'index.json'), JSON.stringify(vitals, null, 2));

    // Write imaging
    fs.writeFileSync(path.join(basePath, 'imaging', 'index.json'), JSON.stringify(imaging, null, 2));

    console.log('\nGeneration complete!');
    console.log(`  Encounters: ${encounters.encounters.length}`);
    console.log(`  Notes: ${notes.length}`);
    console.log(`  Lab panels: ${labs.length}`);
    console.log(`  Lab results: ${labsIndex.totalResults}`);
    console.log(`  Vitals: ${vitals.vitals.length}`);
    console.log(`  Imaging: ${imaging.studies.length}`);
    console.log(`\nFiles written to: ${basePath}`);
}

// Run generation
generatePatientData();
