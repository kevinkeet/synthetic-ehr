/**
 * Dynamic Labs Service
 * Generates lab results based on current simulation state
 */

const DynamicLabs = {
    // Lab order queue (pending labs)
    pendingLabs: [],

    // Completed labs from simulation
    simulatedLabs: [],

    /**
     * Initialize dynamic labs
     */
    init() {
        SimulationEngine.on('tick', (data) => this.processPendingLabs(data));
        SimulationEngine.on('simulationReset', () => this.reset());
    },

    /**
     * Order a lab (called when lab order is placed)
     */
    orderLab(labOrder) {
        const pending = {
            id: `LAB_SIM_${Date.now()}`,
            orderId: labOrder.orderId,
            name: labOrder.name,
            orderTime: SimulationEngine.getSimulatedTime() || new Date(),
            priority: labOrder.priority || 'Routine',
            status: 'Ordered',
            // Time until results (in sim minutes)
            turnaroundTime: this.getTurnaroundTime(labOrder.name, labOrder.priority)
        };

        this.pendingLabs.push(pending);
        console.log('Lab ordered:', pending.name);

        return pending;
    },

    /**
     * Get turnaround time for lab type
     */
    getTurnaroundTime(labName, priority) {
        const name = labName.toLowerCase();

        // Base times in minutes
        let baseTime = 60; // Default 1 hour

        if (name.includes('bmp') || name.includes('cmp') || name.includes('metabolic')) {
            baseTime = 45;
        } else if (name.includes('cbc') || name.includes('blood count')) {
            baseTime = 30;
        } else if (name.includes('troponin') || name.includes('cardiac')) {
            baseTime = 60;
        } else if (name.includes('bnp') || name.includes('natriuretic')) {
            baseTime = 90;
        } else if (name.includes('pt') || name.includes('inr') || name.includes('ptt')) {
            baseTime = 30;
        } else if (name.includes('ua') || name.includes('urinalysis')) {
            baseTime = 30;
        } else if (name.includes('abg') || name.includes('blood gas')) {
            baseTime = 15;
        } else if (name.includes('lactate')) {
            baseTime = 20;
        } else if (name.includes('culture')) {
            baseTime = 2880; // 48 hours for cultures
        }

        // Adjust for priority
        if (priority === 'STAT') {
            baseTime = Math.max(10, baseTime * 0.3);
        } else if (priority === 'Urgent') {
            baseTime = Math.max(15, baseTime * 0.5);
        }

        return baseTime;
    },

    /**
     * Process pending labs each tick
     */
    processPendingLabs(data) {
        const currentTime = data.time;
        const completed = [];

        for (const lab of this.pendingLabs) {
            const elapsed = (currentTime - lab.orderTime) / (60 * 1000); // minutes

            if (elapsed >= lab.turnaroundTime) {
                // Lab is ready - generate results
                const results = this.generateLabResults(lab, data.state);
                completed.push(lab);

                // Add to simulated labs
                this.simulatedLabs.push({
                    ...lab,
                    status: 'Final',
                    collectedDate: new Date(lab.orderTime.getTime() + 5 * 60 * 1000).toISOString(),
                    resultDate: currentTime.toISOString(),
                    results: results
                });

                // Notify
                App.showToast(`Lab results ready: ${lab.name}`, 'success');
                SimulationEngine.emit('labResult', { lab: lab, results: results });
            } else if (elapsed >= 5 && lab.status === 'Ordered') {
                lab.status = 'Collected';
            } else if (elapsed >= lab.turnaroundTime * 0.8 && lab.status === 'Collected') {
                lab.status = 'In Progress';
            }
        }

        // Remove completed labs from pending
        for (const lab of completed) {
            const index = this.pendingLabs.indexOf(lab);
            if (index > -1) {
                this.pendingLabs.splice(index, 1);
            }
        }
    },

    /**
     * Generate lab results based on current state
     */
    generateLabResults(lab, state) {
        const name = lab.name.toLowerCase();
        const results = [];

        if (name.includes('bmp') || name.includes('metabolic')) {
            results.push(...this.generateBMP(state));
        }

        if (name.includes('cmp') || name.includes('comprehensive')) {
            results.push(...this.generateBMP(state));
            results.push(...this.generateLFT(state));
        }

        if (name.includes('cbc') || name.includes('blood count')) {
            results.push(...this.generateCBC(state));
        }

        if (name.includes('troponin')) {
            results.push(this.generateTroponin(state));
        }

        if (name.includes('bnp') || name.includes('natriuretic')) {
            results.push(this.generateBNP(state));
        }

        if (name.includes('pt') || name.includes('inr')) {
            results.push(...this.generateCoags(state));
        }

        if (name.includes('abg') || name.includes('blood gas')) {
            results.push(...this.generateABG(state));
        }

        if (name.includes('lactate')) {
            results.push(this.generateLactate(state));
        }

        if (name.includes('magnesium') || name.includes('mg')) {
            results.push(this.generateMagnesium(state));
        }

        if (name.includes('phosphorus') || name.includes('phos')) {
            results.push(this.generatePhosphorus(state));
        }

        // If no specific results generated, return generic
        if (results.length === 0) {
            results.push({
                name: lab.name,
                value: 'See report',
                unit: '',
                referenceRange: '',
                status: 'Final'
            });
        }

        return results;
    },

    /**
     * Generate BMP results
     */
    generateBMP(state) {
        const labs = state?.labs || {};
        const noise = (max) => (Math.random() - 0.5) * 2 * max;

        return [
            {
                name: 'Sodium',
                value: (labs.sodium || 134 + noise(2)).toFixed(0),
                unit: 'mEq/L',
                referenceRange: '136-145',
                flag: labs.sodium < 136 ? 'L' : (labs.sodium > 145 ? 'H' : '')
            },
            {
                name: 'Potassium',
                value: (labs.potassium || 4.5 + noise(0.2)).toFixed(1),
                unit: 'mEq/L',
                referenceRange: '3.5-5.0',
                flag: labs.potassium < 3.5 ? 'L' : (labs.potassium > 5.0 ? 'H' : '')
            },
            {
                name: 'Chloride',
                value: (labs.chloride || 100 + noise(2)).toFixed(0),
                unit: 'mEq/L',
                referenceRange: '98-106',
                flag: labs.chloride < 98 ? 'L' : (labs.chloride > 106 ? 'H' : '')
            },
            {
                name: 'CO2',
                value: (labs.bicarbonate || 24 + noise(1)).toFixed(0),
                unit: 'mEq/L',
                referenceRange: '22-29',
                flag: labs.bicarbonate < 22 ? 'L' : (labs.bicarbonate > 29 ? 'H' : '')
            },
            {
                name: 'BUN',
                value: (labs.bun || 20 + noise(2)).toFixed(0),
                unit: 'mg/dL',
                referenceRange: '7-20',
                flag: labs.bun > 20 ? 'H' : ''
            },
            {
                name: 'Creatinine',
                value: (labs.creatinine || 1.0 + noise(0.1)).toFixed(2),
                unit: 'mg/dL',
                referenceRange: '0.7-1.3',
                flag: labs.creatinine > 1.3 ? 'H' : ''
            },
            {
                name: 'Glucose',
                value: (labs.glucose || 100 + noise(10)).toFixed(0),
                unit: 'mg/dL',
                referenceRange: '70-100',
                flag: labs.glucose > 100 ? 'H' : (labs.glucose < 70 ? 'L' : '')
            },
            {
                name: 'Calcium',
                value: (labs.calcium || 9.0 + noise(0.3)).toFixed(1),
                unit: 'mg/dL',
                referenceRange: '8.5-10.5',
                flag: ''
            }
        ];
    },

    /**
     * Generate LFT results
     */
    generateLFT(state) {
        const labs = state?.labs || {};
        const noise = (max) => (Math.random() - 0.5) * 2 * max;

        // In CHF, may see congestive hepatopathy
        const congestionFactor = (state?.physiology?.fluidOverload || 0) > 4 ? 1.5 : 1;

        return [
            {
                name: 'AST',
                value: Math.round((25 + noise(5)) * congestionFactor),
                unit: 'U/L',
                referenceRange: '10-40',
                flag: congestionFactor > 1 ? 'H' : ''
            },
            {
                name: 'ALT',
                value: Math.round((22 + noise(5)) * congestionFactor),
                unit: 'U/L',
                referenceRange: '7-56',
                flag: ''
            },
            {
                name: 'Alk Phos',
                value: Math.round(70 + noise(15)),
                unit: 'U/L',
                referenceRange: '44-147',
                flag: ''
            },
            {
                name: 'Total Bilirubin',
                value: (0.8 + noise(0.2) * congestionFactor).toFixed(1),
                unit: 'mg/dL',
                referenceRange: '0.1-1.2',
                flag: congestionFactor > 1.3 ? 'H' : ''
            },
            {
                name: 'Albumin',
                value: (3.5 + noise(0.3)).toFixed(1),
                unit: 'g/dL',
                referenceRange: '3.5-5.0',
                flag: ''
            },
            {
                name: 'Total Protein',
                value: (6.8 + noise(0.4)).toFixed(1),
                unit: 'g/dL',
                referenceRange: '6.0-8.3',
                flag: ''
            }
        ];
    },

    /**
     * Generate CBC results
     */
    generateCBC(state) {
        const labs = state?.labs || {};
        const noise = (max) => (Math.random() - 0.5) * 2 * max;

        return [
            {
                name: 'WBC',
                value: (labs.wbc || 7.5 + noise(1)).toFixed(1),
                unit: 'K/uL',
                referenceRange: '4.5-11.0',
                flag: labs.wbc > 11 ? 'H' : (labs.wbc < 4.5 ? 'L' : '')
            },
            {
                name: 'Hemoglobin',
                value: (labs.hemoglobin || 12.5 + noise(0.5)).toFixed(1),
                unit: 'g/dL',
                referenceRange: '12.0-16.0',
                flag: labs.hemoglobin < 12 ? 'L' : ''
            },
            {
                name: 'Hematocrit',
                value: ((labs.hemoglobin || 12.5) * 3 + noise(1)).toFixed(1),
                unit: '%',
                referenceRange: '36-46',
                flag: ''
            },
            {
                name: 'Platelets',
                value: (labs.platelets || 200 + noise(20)).toFixed(0),
                unit: 'K/uL',
                referenceRange: '150-400',
                flag: ''
            },
            {
                name: 'MCV',
                value: (88 + noise(3)).toFixed(1),
                unit: 'fL',
                referenceRange: '80-100',
                flag: ''
            },
            {
                name: 'RDW',
                value: (13.5 + noise(1)).toFixed(1),
                unit: '%',
                referenceRange: '11.5-14.5',
                flag: ''
            }
        ];
    },

    /**
     * Generate Troponin
     */
    generateTroponin(state) {
        const labs = state?.labs || {};
        // Troponin may be mildly elevated in CHF (type 2 MI / demand ischemia)
        const value = labs.troponin || 0.04;

        return {
            name: 'Troponin I',
            value: value.toFixed(3),
            unit: 'ng/mL',
            referenceRange: '<0.04',
            flag: value > 0.04 ? 'H' : ''
        };
    },

    /**
     * Generate BNP
     */
    generateBNP(state) {
        const labs = state?.labs || {};
        const fluidOverload = state?.physiology?.fluidOverload || 0;

        // BNP correlates with volume overload and cardiac strain
        let bnp = labs.bnp || 500;
        bnp = bnp * (1 + fluidOverload * 0.1);

        return {
            name: 'BNP',
            value: Math.round(bnp),
            unit: 'pg/mL',
            referenceRange: '<100',
            flag: bnp > 100 ? 'H' : ''
        };
    },

    /**
     * Generate Coagulation studies
     */
    generateCoags(state) {
        const labs = state?.labs || {};
        const noise = (max) => (Math.random() - 0.5) * 2 * max;

        return [
            {
                name: 'PT',
                value: (12.5 * (labs.inr || 1.0) + noise(0.5)).toFixed(1),
                unit: 'sec',
                referenceRange: '11.0-13.5',
                flag: (labs.inr || 1) > 1.1 ? 'H' : ''
            },
            {
                name: 'INR',
                value: (labs.inr || 1.0 + noise(0.1)).toFixed(1),
                unit: '',
                referenceRange: '0.9-1.1',
                flag: (labs.inr || 1) > 1.1 ? 'H' : ''
            },
            {
                name: 'PTT',
                value: (30 + noise(3)).toFixed(1),
                unit: 'sec',
                referenceRange: '25-35',
                flag: ''
            }
        ];
    },

    /**
     * Generate ABG
     */
    generateABG(state) {
        const vitals = state?.vitals || {};
        const physiology = state?.physiology || {};
        const noise = (max) => (Math.random() - 0.5) * 2 * max;

        // pH affected by bicarbonate
        const bicarb = state?.labs?.bicarbonate || 24;
        const ph = 7.4 + (bicarb - 24) * 0.015;

        // pO2 correlates with SpO2
        const spo2 = vitals.oxygenSaturation || 95;
        const po2 = spo2 > 95 ? 90 + noise(10) : 60 + (spo2 - 88) * 3;

        // pCO2 - may be low if hyperventilating
        const rr = vitals.respiratoryRate || 16;
        const pco2 = 40 - (rr - 16) * 1.5;

        return [
            {
                name: 'pH',
                value: (ph + noise(0.02)).toFixed(2),
                unit: '',
                referenceRange: '7.35-7.45',
                flag: ph < 7.35 ? 'L' : (ph > 7.45 ? 'H' : '')
            },
            {
                name: 'pCO2',
                value: (pco2 + noise(2)).toFixed(0),
                unit: 'mmHg',
                referenceRange: '35-45',
                flag: pco2 < 35 ? 'L' : (pco2 > 45 ? 'H' : '')
            },
            {
                name: 'pO2',
                value: (po2 + noise(5)).toFixed(0),
                unit: 'mmHg',
                referenceRange: '80-100',
                flag: po2 < 80 ? 'L' : ''
            },
            {
                name: 'HCO3',
                value: (bicarb + noise(1)).toFixed(0),
                unit: 'mEq/L',
                referenceRange: '22-26',
                flag: bicarb < 22 ? 'L' : (bicarb > 26 ? 'H' : '')
            },
            {
                name: 'O2 Sat',
                value: (spo2 + noise(1)).toFixed(0),
                unit: '%',
                referenceRange: '95-100',
                flag: spo2 < 95 ? 'L' : ''
            }
        ];
    },

    /**
     * Generate Lactate
     */
    generateLactate(state) {
        const physiology = state?.physiology || {};
        const noise = (max) => (Math.random() - 0.5) * 2 * max;

        // Lactate elevated with poor perfusion
        let lactate = 1.0;
        if (physiology.cardiacOutput && physiology.cardiacOutput < 3) {
            lactate = 2.0 + (3 - physiology.cardiacOutput) * 2;
        }

        return {
            name: 'Lactate',
            value: (lactate + noise(0.3)).toFixed(1),
            unit: 'mmol/L',
            referenceRange: '0.5-2.0',
            flag: lactate > 2.0 ? 'H' : ''
        };
    },

    /**
     * Generate Magnesium
     */
    generateMagnesium(state) {
        const noise = (max) => (Math.random() - 0.5) * 2 * max;
        // May be low after diuresis
        let mg = 2.0;
        const interventions = InterventionTracker.getActiveInterventions();
        if (interventions.some(i => i.name?.toLowerCase().includes('furosemide') || i.name?.toLowerCase().includes('lasix'))) {
            mg = 1.7;
        }

        return {
            name: 'Magnesium',
            value: (mg + noise(0.2)).toFixed(1),
            unit: 'mg/dL',
            referenceRange: '1.7-2.2',
            flag: mg < 1.7 ? 'L' : ''
        };
    },

    /**
     * Generate Phosphorus
     */
    generatePhosphorus(state) {
        const noise = (max) => (Math.random() - 0.5) * 2 * max;
        const phos = 3.5 + noise(0.5);

        return {
            name: 'Phosphorus',
            value: phos.toFixed(1),
            unit: 'mg/dL',
            referenceRange: '2.5-4.5',
            flag: ''
        };
    },

    /**
     * Get all simulated lab results
     */
    getSimulatedLabs() {
        return this.simulatedLabs;
    },

    /**
     * Get pending labs
     */
    getPendingLabs() {
        return this.pendingLabs;
    },

    /**
     * Get completed labs (for debrief)
     */
    getCompletedLabs() {
        return this.simulatedLabs.map(lab => ({
            ...lab,
            orderedAt: lab.orderTime ? lab.orderTime.toISOString() : null
        }));
    },

    /**
     * Get all labs (pending + completed)
     */
    getAllLabs() {
        return [
            ...this.pendingLabs.map(l => ({ ...l, status: l.status || 'Pending' })),
            ...this.simulatedLabs
        ];
    },

    /**
     * Reset
     */
    reset() {
        this.pendingLabs = [];
        this.simulatedLabs = [];
    }
};

window.DynamicLabs = DynamicLabs;
