/**
 * Physiology Engine
 * Models realistic physiological changes based on underlying parameters
 */

const PhysiologyEngine = {
    /**
     * Process natural disease progression over time
     * @param {Object} state - Current patient state
     * @param {number} minutes - Simulation minutes elapsed
     * @param {Object} scenario - Current scenario definition
     */
    processNaturalProgression(state, minutes, scenario) {
        if (!state || !scenario) return;

        // Get progression rate from scenario
        const progression = scenario.naturalProgression || {};

        // Process each physiological system
        this.processCardiovascular(state, minutes, progression);
        this.processFluidBalance(state, minutes, progression);
        this.processRenal(state, minutes, progression);
        this.processRespiratory(state, minutes, progression);
        this.processSymptoms(state, minutes, progression);

        // Update trajectory based on overall trend
        this.updateTrajectory(state);
    },

    /**
     * Process cardiovascular parameters
     */
    processCardiovascular(state, minutes, progression) {
        if (!state.vitals) state.vitals = {};
        if (!state.physiology) state.physiology = {};

        const hours = minutes / 60;
        const cardiacRate = progression.cardiac?.ratePerHour || 0;

        // Heart rate responds to volume status and sympathetic activation
        const baseHR = state.physiology.baseHeartRate || 80;
        const volumeEffect = (state.physiology.fluidOverload || 0) * 2; // HR increases with overload
        const stressEffect = (state.physiology.sympatheticTone || 0) * 5;

        state.vitals.heartRate = Math.max(50, Math.min(150,
            baseHR + volumeEffect + stressEffect + (cardiacRate * hours) + this.noise(3)
        ));

        // Blood pressure
        const baseSystolic = state.physiology.baseSystolic || 130;
        const baseDiastolic = state.physiology.baseDiastolic || 80;

        // BP affected by volume status and cardiac output
        const volumeBPEffect = (state.physiology.fluidOverload || 0) * 3;
        const cardiacOutputEffect = ((state.physiology.cardiacOutput || 3.5) - 3.5) * 10;

        state.vitals.systolic = Math.max(80, Math.min(200,
            baseSystolic + volumeBPEffect + cardiacOutputEffect + this.noise(5)
        ));
        state.vitals.diastolic = Math.max(50, Math.min(120,
            baseDiastolic + (volumeBPEffect * 0.5) + this.noise(3)
        ));

        // Cardiac output trends with disease progression
        if (progression.cardiac?.outputChangePerHour) {
            state.physiology.cardiacOutput = Math.max(1.5, Math.min(6,
                (state.physiology.cardiacOutput || 3.5) + (progression.cardiac.outputChangePerHour * hours)
            ));
        }
    },

    /**
     * Process fluid balance
     */
    processFluidBalance(state, minutes, progression) {
        if (!state.physiology) state.physiology = {};

        const hours = minutes / 60;

        // Fluid overload increases without diuresis
        const fluidRate = progression.fluid?.overloadRatePerHour || 0;
        state.physiology.fluidOverload = Math.max(0, Math.min(10,
            (state.physiology.fluidOverload || 0) + (fluidRate * hours)
        ));

        // Weight correlates with fluid status (1L fluid ≈ 1kg)
        if (!state.physiology.dryWeight) {
            state.physiology.dryWeight = (state.vitals?.weight || 95) - (state.physiology.fluidOverload || 0);
        }
        state.vitals.weight = state.physiology.dryWeight + state.physiology.fluidOverload;

        // Urine output inversely related to fluid overload and renal function
        const baseUrine = 50; // mL/hr baseline
        const renalFactor = (state.physiology.gfr || 40) / 60; // Reduced with low GFR
        const overloadFactor = 1 + (state.physiology.fluidOverload || 0) * 0.05; // Slight increase with overload

        state.physiology.urineOutput = Math.max(5, Math.min(200,
            baseUrine * renalFactor * overloadFactor
        ));
    },

    /**
     * Process renal function
     */
    processRenal(state, minutes, progression) {
        if (!state.physiology) state.physiology = {};
        if (!state.labs) state.labs = {};

        const hours = minutes / 60;
        const renalRate = progression.renal?.creatinineChangePerHour || 0;

        // Creatinine trends
        state.labs.creatinine = Math.max(0.6, Math.min(8,
            (state.labs.creatinine || 2.0) + (renalRate * hours)
        ));

        // BUN trends with creatinine
        state.labs.bun = Math.max(10, Math.min(150,
            (state.labs.bun || 40) + (renalRate * 10 * hours)
        ));

        // Calculate eGFR from creatinine (simplified CKD-EPI)
        const age = state.demographics?.age || 72;
        const isMale = state.demographics?.sex !== 'Female';
        const cr = state.labs.creatinine;

        // Simplified eGFR calculation
        let eGFR = 142 * Math.pow(Math.min(cr / (isMale ? 0.9 : 0.7), 1), isMale ? -0.302 : -0.241) *
                   Math.pow(Math.max(cr / (isMale ? 0.9 : 0.7), 1), -1.200) *
                   Math.pow(0.9938, age) * (isMale ? 1 : 1.012);

        state.physiology.gfr = Math.max(5, Math.min(120, eGFR));

        // Potassium affected by renal function and medications
        const baseK = 4.5;
        const renalEffect = Math.max(0, (2.0 - state.labs.creatinine) * 0.3); // High Cr = high K
        state.labs.potassium = Math.max(3.0, Math.min(6.5,
            baseK - renalEffect + (progression.renal?.potassiumChangePerHour || 0) * hours + this.noise(0.1)
        ));
    },

    /**
     * Process respiratory parameters
     */
    processRespiratory(state, minutes, progression) {
        if (!state.vitals) state.vitals = {};
        if (!state.physiology) state.physiology = {};

        const hours = minutes / 60;

        // Respiratory rate increases with fluid overload (pulmonary congestion)
        const baseRR = 16;
        const congestionEffect = (state.physiology.fluidOverload || 0) * 1.5;
        const hypoxiaEffect = Math.max(0, (92 - (state.vitals.oxygenSaturation || 95)) * 0.5);

        state.vitals.respiratoryRate = Math.max(12, Math.min(35,
            baseRR + congestionEffect + hypoxiaEffect + this.noise(2)
        ));

        // Oxygen saturation decreases with pulmonary congestion
        const baseSat = 98;
        const congestionSatEffect = (state.physiology.fluidOverload || 0) * 1.5;

        state.vitals.oxygenSaturation = Math.max(75, Math.min(100,
            baseSat - congestionSatEffect + this.noise(1)
        ));

        // Temperature (usually stable unless infection)
        if (!state.vitals.temperature) {
            state.vitals.temperature = 98.4;
        }
    },

    /**
     * Process symptom severity
     */
    processSymptoms(state, minutes, progression) {
        if (!state.symptoms) state.symptoms = {};

        // Dyspnea correlates with fluid overload
        const fluidOverload = state.physiology?.fluidOverload || 0;
        state.symptoms.dyspnea = Math.max(0, Math.min(10,
            fluidOverload * 1.2 + (state.vitals?.respiratoryRate > 24 ? 2 : 0)
        ));

        // Orthopnea
        state.symptoms.orthopnea = fluidOverload > 2;
        state.symptoms.orthopneaPillows = fluidOverload > 4 ? 4 : (fluidOverload > 2 ? 3 : 2);

        // Fatigue correlates with cardiac output
        const cardiacOutput = state.physiology?.cardiacOutput || 3.5;
        state.symptoms.fatigue = Math.max(0, Math.min(10,
            (5 - cardiacOutput) * 2
        ));

        // Edema correlates with fluid overload
        state.symptoms.edema = Math.min(4, Math.floor(fluidOverload / 2));
        state.symptoms.edemaDescription = this.getEdemaDescription(state.symptoms.edema);
    },

    /**
     * Get edema description based on severity
     */
    getEdemaDescription(grade) {
        const descriptions = {
            0: 'No edema',
            1: 'Trace edema at ankles',
            2: '1+ pitting edema to ankles',
            3: '2+ pitting edema to mid-shin',
            4: '3+ pitting edema to knees'
        };
        return descriptions[grade] || descriptions[0];
    },

    /**
     * Update overall trajectory based on recent changes
     */
    updateTrajectory(state) {
        // Simple heuristic based on key parameters
        const fluidTrend = state.physiology?.fluidOverload || 0;
        const crTrend = state.labs?.creatinine || 2.0;

        if (fluidTrend < 2 && crTrend < 2.2) {
            state.trajectory = 'improving';
        } else if (fluidTrend > 4 || crTrend > 3.0) {
            state.trajectory = 'worsening';
        } else {
            state.trajectory = 'stable';
        }
    },

    /**
     * Apply medication effect to physiology
     */
    applyMedicationEffect(state, medication, dose, duration) {
        const effects = this.getMedicationEffects(medication.toLowerCase());
        if (!effects) return;

        // Scale effect by dose and duration
        const effectStrength = (dose / effects.standardDose) * Math.min(duration / effects.peakTime, 1);

        for (const [param, effect] of Object.entries(effects.parameters)) {
            const path = param.split('.');
            let target = state;

            // Navigate to nested property
            for (let i = 0; i < path.length - 1; i++) {
                if (!target[path[i]]) target[path[i]] = {};
                target = target[path[i]];
            }

            const key = path[path.length - 1];
            const currentValue = target[key] || 0;

            // Apply effect with limits
            target[key] = Math.max(
                effect.min || -Infinity,
                Math.min(effect.max || Infinity, currentValue + effect.change * effectStrength)
            );
        }
    },

    /**
     * Get medication effect definitions
     */
    getMedicationEffects(medication) {
        const effects = {
            'furosemide': {
                standardDose: 40,
                peakTime: 60, // minutes
                duration: 360, // minutes
                parameters: {
                    'physiology.fluidOverload': { change: -0.5, min: 0 },
                    'physiology.urineOutput': { change: 100, max: 400 },
                    'labs.potassium': { change: -0.2, min: 2.5 },
                    'labs.creatinine': { change: 0.1, max: 4 } // Can bump creatinine
                }
            },
            'lisinopril': {
                standardDose: 10,
                peakTime: 120,
                duration: 1440,
                parameters: {
                    'vitals.systolic': { change: -10, min: 90 },
                    'vitals.diastolic': { change: -5, min: 60 },
                    'labs.potassium': { change: 0.2, max: 6 }
                }
            },
            'carvedilol': {
                standardDose: 12.5,
                peakTime: 90,
                duration: 720,
                parameters: {
                    'vitals.heartRate': { change: -10, min: 50 },
                    'vitals.systolic': { change: -8, min: 90 },
                    'physiology.cardiacOutput': { change: 0.1, max: 5 }
                }
            },
            'metoprolol': {
                standardDose: 25,
                peakTime: 60,
                duration: 360,
                parameters: {
                    'vitals.heartRate': { change: -15, min: 50 },
                    'vitals.systolic': { change: -5, min: 90 }
                }
            },
            'spironolactone': {
                standardDose: 25,
                peakTime: 240,
                duration: 1440,
                parameters: {
                    'physiology.fluidOverload': { change: -0.2, min: 0 },
                    'labs.potassium': { change: 0.3, max: 6 }
                }
            },
            'potassium chloride': {
                standardDose: 20,
                peakTime: 60,
                duration: 240,
                parameters: {
                    'labs.potassium': { change: 0.3, max: 6 }
                }
            },
            'insulin': {
                standardDose: 10,
                peakTime: 30,
                duration: 120,
                parameters: {
                    'labs.glucose': { change: -50, min: 70 },
                    'labs.potassium': { change: -0.5, min: 3 }
                }
            },
            'nitroglycerin': {
                standardDose: 0.4,
                peakTime: 5,
                duration: 30,
                parameters: {
                    'vitals.systolic': { change: -15, min: 90 },
                    'symptoms.chestDiscomfort': { change: -3, min: 0 }
                }
            },
            'morphine': {
                standardDose: 4,
                peakTime: 20,
                duration: 240,
                parameters: {
                    'symptoms.dyspnea': { change: -2, min: 0 },
                    'vitals.respiratoryRate': { change: -3, min: 8 }
                }
            },
            'oxygen': {
                standardDose: 2,
                peakTime: 5,
                duration: 9999, // Continuous while on
                parameters: {
                    'vitals.oxygenSaturation': { change: 3, max: 100 }
                }
            }
        };

        return effects[medication] || null;
    },

    /**
     * Generate random noise for realistic variation
     */
    noise(maxVariation) {
        return (Math.random() - 0.5) * 2 * maxVariation;
    }
};

window.PhysiologyEngine = PhysiologyEngine;
