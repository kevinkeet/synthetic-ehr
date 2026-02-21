/**
 * Dynamic Imaging Service
 * Generates imaging results/reports based on simulation state
 */

const DynamicImaging = {
    // Pending imaging studies
    pendingStudies: [],

    // Completed studies from simulation
    completedStudies: [],

    /**
     * Initialize dynamic imaging
     */
    init() {
        SimulationEngine.on('tick', (data) => this.processPendingStudies(data));
        SimulationEngine.on('simulationReset', () => this.reset());
    },

    /**
     * Order an imaging study
     */
    orderStudy(studyOrder) {
        const pending = {
            id: `IMG_SIM_${Date.now()}`,
            orderId: studyOrder.orderId,
            modality: studyOrder.modality,
            bodyPart: studyOrder.bodyPart,
            name: `${studyOrder.modality} ${studyOrder.bodyPart}`,
            contrast: studyOrder.contrast,
            orderTime: SimulationEngine.getSimulatedTime() || new Date(),
            priority: studyOrder.priority || 'Routine',
            indication: studyOrder.indication,
            status: 'Ordered',
            // Time until results (in sim minutes)
            turnaroundTime: this.getTurnaroundTime(studyOrder.modality, studyOrder.priority)
        };

        this.pendingStudies.push(pending);
        console.log('Imaging ordered:', pending.name);

        return pending;
    },

    /**
     * Get turnaround time for study type
     */
    getTurnaroundTime(modality, priority) {
        // Base times in minutes
        const baseTimes = {
            'X-Ray': 30,
            'CT': 60,
            'MRI': 120,
            'Ultrasound': 45,
            'Echo': 60,
            'Nuclear Medicine': 180,
            'Fluoroscopy': 45
        };

        let baseTime = baseTimes[modality] || 60;

        // Adjust for priority
        if (priority === 'STAT') {
            baseTime = Math.max(15, baseTime * 0.3);
        } else if (priority === 'Urgent') {
            baseTime = Math.max(20, baseTime * 0.5);
        }

        return baseTime;
    },

    /**
     * Process pending studies each tick
     */
    processPendingStudies(data) {
        const currentTime = data.time;
        const completed = [];

        for (const study of this.pendingStudies) {
            const elapsed = (currentTime - study.orderTime) / (60 * 1000); // minutes

            if (elapsed >= study.turnaroundTime) {
                // Study is ready - generate report
                const report = this.generateReport(study, data.state);
                completed.push(study);

                // Add to completed studies
                this.completedStudies.push({
                    ...study,
                    status: 'Final',
                    studyDate: new Date(study.orderTime.getTime() + 10 * 60 * 1000).toISOString(),
                    reportDate: currentTime.toISOString(),
                    report: report
                });

                // Notify
                App.showToast(`Imaging results ready: ${study.name}`, 'success');
                SimulationEngine.emit('imagingResult', { study: study, report: report });

                // Add to nurse chat for notification
                if (typeof NurseChat !== 'undefined') {
                    const nurseMessage = `Doctor, the ${study.name} results are back. ${this.getSummaryForNurse(study, report)}`;
                    NurseChat.messages.push({ role: 'assistant', content: nurseMessage });
                    NurseChat.saveHistory();
                    if (typeof AIPanel !== 'undefined') {
                        AIPanel.addMessage('nurse', 'assistant', nurseMessage);
                    }
                }
            } else if (elapsed >= 5 && study.status === 'Ordered') {
                study.status = 'In Progress';
            } else if (elapsed >= study.turnaroundTime * 0.7 && study.status === 'In Progress') {
                study.status = 'Pending Read';
            }
        }

        // Remove completed studies from pending
        for (const study of completed) {
            const index = this.pendingStudies.indexOf(study);
            if (index > -1) {
                this.pendingStudies.splice(index, 1);
            }
        }
    },

    /**
     * Generate imaging report based on study type and patient state
     */
    generateReport(study, state) {
        const modality = study.modality;
        const bodyPart = study.bodyPart?.toLowerCase() || '';

        // Get patient state for relevant findings
        const fluidOverload = state?.physiology?.fluidOverload || 0;
        const dyspnea = state?.symptoms?.dyspnea || 0;

        // Generate report based on study type
        if (modality === 'X-Ray' && bodyPart.includes('chest')) {
            return this.generateChestXRayReport(state, study);
        } else if (modality === 'Echo') {
            return this.generateEchoReport(state, study);
        } else if (modality === 'CT' && bodyPart.includes('chest')) {
            return this.generateChestCTReport(state, study);
        } else if (modality === 'Ultrasound') {
            return this.generateUltrasoundReport(state, study);
        }

        // Default generic report
        return this.generateGenericReport(study);
    },

    /**
     * Generate Chest X-Ray report
     */
    generateChestXRayReport(state, study) {
        const fluidOverload = state?.physiology?.fluidOverload || 0;
        const isPortable = study.priority === 'STAT';

        let findings = [];
        let impression = [];

        // Heart size
        if (fluidOverload > 2) {
            findings.push('Cardiomegaly with cardiothoracic ratio approximately 0.6');
            impression.push('Cardiomegaly');
        } else {
            findings.push('Heart size at upper limits of normal');
        }

        // Pulmonary findings based on fluid status
        if (fluidOverload > 4) {
            findings.push('Bilateral interstitial edema with Kerley B lines');
            findings.push('Bilateral pleural effusions, small to moderate');
            findings.push('Cephalization of pulmonary vasculature');
            impression.push('Moderate pulmonary edema consistent with congestive heart failure');
        } else if (fluidOverload > 2) {
            findings.push('Mild interstitial edema');
            findings.push('Small bilateral pleural effusions');
            findings.push('Mild pulmonary vascular congestion');
            impression.push('Mild pulmonary edema');
        } else if (fluidOverload > 0) {
            findings.push('Mild pulmonary vascular congestion, improved from prior');
            findings.push('Trace pleural effusions bilaterally');
            impression.push('Resolving pulmonary edema');
        } else {
            findings.push('Lungs are clear bilaterally');
            findings.push('No pleural effusion');
            impression.push('No acute cardiopulmonary abnormality');
        }

        // Standard findings
        findings.push('No pneumothorax');
        findings.push('Osseous structures are unremarkable for age');
        findings.push('Support devices in satisfactory position' + (isPortable ? ' (limited evaluation on portable exam)' : ''));

        return {
            examType: isPortable ? 'PORTABLE CHEST X-RAY (AP)' : 'CHEST X-RAY (PA AND LATERAL)',
            clinicalIndication: study.indication || 'Shortness of breath',
            comparison: 'No prior studies available for comparison',
            technique: isPortable ? 'Single AP portable view of the chest' : 'PA and lateral views of the chest',
            findings: findings.join('. ') + '.',
            impression: impression.join('. ') + '.',
            radiologist: 'James Thompson, MD',
            dictatedDate: new Date().toLocaleString(),
            attestation: 'I have reviewed the images and agree with the above findings.'
        };
    },

    /**
     * Generate Echo report
     */
    generateEchoReport(state, study) {
        // Use patient's known EF or simulate based on scenario
        const ef = state?.cardiacFunction?.ef || 32; // CHF patient baseline

        return {
            examType: 'TRANSTHORACIC ECHOCARDIOGRAM',
            clinicalIndication: study.indication || 'Heart failure',
            comparison: 'Prior echo available for comparison',
            technique: 'Complete 2D, M-mode, color flow, and spectral Doppler examination',
            findings: `
LEFT VENTRICLE: The left ventricle is moderately dilated. There is global hypokinesis with severely reduced systolic function. Estimated ejection fraction is ${ef}% (Simpson's biplane method). No left ventricular thrombus identified.

RIGHT VENTRICLE: The right ventricle is mildly dilated with mildly reduced systolic function (TAPSE 14mm).

LEFT ATRIUM: Moderately dilated.

RIGHT ATRIUM: Mildly dilated.

AORTIC VALVE: Trileaflet with mild sclerosis. No significant stenosis or regurgitation.

MITRAL VALVE: Moderate mitral regurgitation (central jet).

TRICUSPID VALVE: Mild to moderate tricuspid regurgitation. Estimated RVSP 45 mmHg.

PERICARDIUM: Trace pericardial effusion without echocardiographic evidence of tamponade.

IVC: Dilated with <50% respiratory variation, consistent with elevated right atrial pressure.`,
            impression: `1. Severely reduced left ventricular systolic function with EF ${ef}%
2. Global hypokinesis suggesting non-ischemic cardiomyopathy
3. Moderate mitral regurgitation
4. Elevated right-sided filling pressures
5. Findings consistent with decompensated heart failure`,
            radiologist: 'Maria Garcia, MD, FASE',
            dictatedDate: new Date().toLocaleString(),
            attestation: 'I have reviewed the images and agree with the above findings.'
        };
    },

    /**
     * Generate Chest CT report
     */
    generateChestCTReport(state, study) {
        const fluidOverload = state?.physiology?.fluidOverload || 0;

        let findings = [];
        if (fluidOverload > 3) {
            findings.push('Bilateral dependent consolidation and ground glass opacities, consistent with pulmonary edema');
            findings.push('Moderate bilateral pleural effusions');
        } else {
            findings.push('No significant pulmonary parenchymal abnormality');
            findings.push('Small bilateral pleural effusions');
        }
        findings.push('Cardiomegaly');
        findings.push('No pulmonary embolism (if contrast given)');
        findings.push('No mediastinal or hilar lymphadenopathy');

        return {
            examType: study.contrast?.includes('With') ? 'CT CHEST WITH IV CONTRAST' : 'CT CHEST WITHOUT CONTRAST',
            clinicalIndication: study.indication || 'Shortness of breath',
            comparison: 'No prior CT available for comparison',
            technique: study.contrast?.includes('With') ? 'Axial images obtained after IV contrast administration' : 'Axial images obtained without IV contrast',
            findings: findings.join('. ') + '.',
            impression: fluidOverload > 3 ?
                'Findings consistent with pulmonary edema. No evidence of pulmonary embolism.' :
                'Cardiomegaly with small pleural effusions. No acute pulmonary parenchymal abnormality.',
            radiologist: 'Robert Kim, MD',
            dictatedDate: new Date().toLocaleString(),
            attestation: 'I have reviewed the images and agree with the above findings.'
        };
    },

    /**
     * Generate Ultrasound report
     */
    generateUltrasoundReport(state, study) {
        const bodyPart = study.bodyPart?.toLowerCase() || '';

        if (bodyPart.includes('renal') || bodyPart.includes('kidney')) {
            return {
                examType: 'RENAL ULTRASOUND',
                clinicalIndication: study.indication || 'Renal function assessment',
                comparison: 'No prior studies available',
                technique: 'Real-time grayscale and color Doppler imaging of both kidneys',
                findings: `
RIGHT KIDNEY: Measures 10.2 cm in length. Normal cortical echogenicity and corticomedullary differentiation. No hydronephrosis. No renal masses or calculi.

LEFT KIDNEY: Measures 10.5 cm in length. Normal cortical echogenicity and corticomedullary differentiation. No hydronephrosis. No renal masses or calculi.

BLADDER: Incompletely distended. No focal abnormality seen.`,
                impression: 'Normal renal ultrasound. No hydronephrosis or renal masses bilaterally.',
                radiologist: 'Susan Lee, MD',
                dictatedDate: new Date().toLocaleString(),
                attestation: 'I have reviewed the images and agree with the above findings.'
            };
        }

        return this.generateGenericReport(study);
    },

    /**
     * Generate generic report for other study types
     */
    generateGenericReport(study) {
        return {
            examType: `${study.modality} ${study.bodyPart}`.toUpperCase(),
            clinicalIndication: study.indication || 'Clinical evaluation',
            comparison: 'No prior studies available for comparison',
            technique: 'Standard imaging protocol',
            findings: 'Study performed and reviewed. No acute abnormality identified. Please correlate clinically.',
            impression: 'No acute findings. Please correlate with clinical presentation.',
            radiologist: 'Staff Radiologist, MD',
            dictatedDate: new Date().toLocaleString(),
            attestation: 'I have reviewed the images and agree with the above findings.'
        };
    },

    /**
     * Get brief summary for nurse notification
     */
    getSummaryForNurse(study, report) {
        if (typeof report.impression === 'string') {
            // Truncate to first sentence
            const firstSentence = report.impression.split('.')[0];
            return `The radiologist's impression: "${firstSentence}."`;
        }
        return 'The report is available for your review.';
    },

    /**
     * Get all completed studies
     */
    getCompletedStudies() {
        return this.completedStudies;
    },

    /**
     * Get pending studies
     */
    getPendingStudies() {
        return this.pendingStudies;
    },

    /**
     * Reset
     */
    reset() {
        this.pendingStudies = [];
        this.completedStudies = [];
    }
};

window.DynamicImaging = DynamicImaging;
