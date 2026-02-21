/**
 * Simulation Score Tracker
 * Central scoring service that passively tracks all user actions during a simulation.
 * Scores across 6 domains: Patient History, Nurse Interaction, Chart Review,
 * Medication Management, Safety/Allergy Awareness, and Empathy/Communication.
 */

const SimulationScoreTracker = {

    // ========== PATIENT HISTORY ITEMS ==========
    patientHistoryItems: {
        breathing:          { asked: false, keywords: ['breath', 'breathing', 'short of breath', 'dyspnea', 'winded', 'air', 'sob'], points: 8, label: 'Asked about breathing/dyspnea' },
        swelling:           { asked: false, keywords: ['swell', 'ankle', 'leg', 'feet', 'edema', 'puffy', 'fluid'], points: 8, label: 'Asked about swelling/edema' },
        orthopnea:          { asked: false, keywords: ['sleep', 'lie flat', 'pillow', 'bed', 'recline', 'propped up', 'lying down'], points: 6, label: 'Asked about orthopnea/sleep position' },
        weight:             { asked: false, keywords: ['weight', 'gained', 'heavier', 'pounds', 'kilo'], points: 5, label: 'Asked about weight changes' },
        medications:        { asked: false, keywords: ['medication', 'pill', 'medicine', 'taking', 'compliance', 'prescri'], points: 8, label: 'Asked about medication compliance' },
        diureticCompliance: { asked: false, keywords: ['water pill', 'furosemide', 'lasix', 'diuretic', 'pee pill', 'ran out', 'run out'], points: 8, label: 'Asked about diuretic specifically' },
        bleedingHistory:    { asked: false, keywords: ['bleed', 'blood', 'stomach', 'gi', 'ulcer', 'vomit blood', 'black stool', 'melena', 'hematemesis'], points: 10, label: 'Asked about bleeding history' },
        bloodThinnerHx:     { asked: false, keywords: ['blood thinner', 'anticoagul', 'warfarin', 'coumadin', 'thin the blood', 'clot'], points: 8, label: 'Asked about blood thinner history' },
        dietSalt:           { asked: false, keywords: ['diet', 'salt', 'sodium', 'eating', 'food', 'fluid intake', 'drinking'], points: 5, label: 'Asked about diet/salt/fluid intake' },
        chestPain:          { asked: false, keywords: ['chest', 'pain', 'pressure', 'squeeze', 'angina', 'tightness'], points: 4, label: 'Asked about chest pain' },
        palpitations:       { asked: false, keywords: ['heart racing', 'palpitation', 'flutter', 'irregular', 'skip', 'pounding'], points: 4, label: 'Asked about palpitations' }
    },

    // ========== NURSE INTERACTION ITEMS ==========
    nurseHistoryItems: {
        vitalsAssessment: { asked: false, keywords: ['vitals', 'blood pressure', 'heart rate', 'oxygen', 'spo2', 'status', 'how is he', 'how\'s he'], points: 8, label: 'Asked about current vitals/assessment' },
        urineOutput:      { asked: false, keywords: ['urine', 'output', 'foley', 'uop', 'peeing', 'voiding', 'i&o', 'intake and output', 'intake output'], points: 10, label: 'Asked about urine output/I&O' },
        physicalExam:     { asked: false, keywords: ['exam', 'lung', 'crackle', 'jvp', 'jugular', 'edema', 'heart sound', 'auscult', 'listen'], points: 8, label: 'Asked about physical exam findings' },
        wifeReport:       { asked: false, keywords: ['wife', 'patricia', 'family', 'spouse', 'brought him', 'what did she', 'what she said'], points: 8, label: 'Asked what wife reported' },
        recentChanges:    { asked: false, keywords: ['change', 'different', 'worse', 'better', 'trend', 'overnight', 'since admission', 'getting'], points: 6, label: 'Asked about recent changes/trends' },
        holdMeds:         { asked: false, keywords: ['hold metformin', 'stop metformin', 'discontinue metformin', 'no metformin', 'hold the metformin', 'hold his metformin'], points: 6, label: 'Communicated holding metformin' }
    },

    // ========== CHART REVIEW ITEMS ==========
    chartReviewItems: {
        problemList:       { viewed: false, points: 8, label: 'Viewed Problem List' },
        resolvedProblems:  { viewed: false, points: 10, label: 'Viewed Resolved Problems (GI bleed)' },
        medicationList:    { viewed: false, points: 8, label: 'Viewed Medication List' },
        allergyList:       { viewed: false, points: 10, label: 'Viewed Allergy List' },
        labResults:        { viewed: false, points: 8, label: 'Viewed Lab Results' },
        notes:             { viewed: false, points: 5, label: 'Viewed Clinical Notes' },
        giConsultNote:     { viewed: false, points: 12, label: 'Read GI Consult Note (anticoag recommendation)' }
    },

    // ========== MEDICATION ORDER ITEMS ==========
    medicationOrders: {
        // Critical
        ivFurosemide:       { ordered: false, timely: false, correctDose: false, points: 15, category: 'critical', label: 'IV Furosemide ordered' },

        // Important
        potassiumMonitor:   { ordered: false, points: 6, category: 'important', label: 'Potassium monitoring/replacement' },
        holdMetformin:      { ordered: false, points: 6, category: 'important', label: 'Communicated holding metformin' },
        rateControlAfib:    { ordered: false, points: 8, category: 'important', label: 'Rate control for A-fib (when triggered)' },
        oxygenTherapy:      { ordered: false, points: 5, category: 'important', label: 'Oxygen therapy ordered' },
        fluidRestriction:   { ordered: false, points: 5, category: 'important', label: 'Fluid restriction ordered' },
        dailyWeightsIO:     { ordered: false, points: 5, category: 'important', label: 'Daily weights + strict I&O' },

        // Safety (negative scoring if violated)
        noAnticoagulation:  { safe: true, points: 15, category: 'safety', label: 'Avoided anticoagulation (GI bleed contraindication)' },
        noACEInhibitor:     { safe: true, points: 10, category: 'safety', label: 'Avoided ACE inhibitor (angioedema allergy)' },
        noPenicillin:       { safe: true, points: 10, category: 'safety', label: 'Avoided penicillin (anaphylaxis allergy)' },

        // Bonus
        telemetry:          { ordered: false, points: 3, category: 'bonus', label: 'Telemetry monitoring' },
        bmpMonitoring:      { ordered: false, points: 3, category: 'bonus', label: 'BMP/metabolic panel monitoring' },
        magnesiumCheck:     { ordered: false, points: 3, category: 'bonus', label: 'Magnesium level check' },
        cardiologyConsult:  { ordered: false, points: 3, category: 'bonus', label: 'Cardiology consult' },
        vteProphylaxis:     { ordered: false, points: 3, category: 'bonus', label: 'VTE prophylaxis (SCDs)' }
    },

    // ========== ALLERGY VIOLATIONS ==========
    allergyViolations: [],

    // ========== EMPATHY ITEMS ==========
    empathyItems: {
        empathyResponse:    { earned: false, points: 40, label: 'Responded empathetically to patient distress' },
        explainedPlan:      { earned: false, points: 30, label: 'Explained treatment plan to anxious patient' },
        addressedFears:     { earned: false, points: 20, label: 'Addressed specific fears (brother\'s death)' },
        rapport:            { earned: false, points: 10, label: 'Maintained rapport (meaningful conversation)' }
    },

    // Track whether emotional trigger has fired
    emotionalTriggerFired: false,
    patientMessageCount: 0,

    // ========== INITIALIZATION ==========
    init() {
        this.reset();
        console.log('SimulationScoreTracker initialized');
    },

    reset() {
        // Reset all patient history items
        for (const item of Object.values(this.patientHistoryItems)) {
            item.asked = false;
        }
        // Reset all nurse history items
        for (const item of Object.values(this.nurseHistoryItems)) {
            item.asked = false;
        }
        // Reset all chart review items
        for (const item of Object.values(this.chartReviewItems)) {
            item.viewed = false;
        }
        // Reset medication orders
        for (const item of Object.values(this.medicationOrders)) {
            if ('ordered' in item) item.ordered = false;
            if ('safe' in item) item.safe = true;
            if ('timely' in item) item.timely = false;
            if ('correctDose' in item) item.correctDose = false;
        }
        // Reset empathy
        for (const item of Object.values(this.empathyItems)) {
            item.earned = false;
        }
        this.allergyViolations = [];
        this.emotionalTriggerFired = false;
        this.patientMessageCount = 0;
    },

    // ========== TRACKING METHODS ==========

    /**
     * Track a user message sent to the patient
     */
    trackPatientQuestion(text) {
        const lower = text.toLowerCase();
        this.patientMessageCount++;

        for (const [key, item] of Object.entries(this.patientHistoryItems)) {
            if (!item.asked && item.keywords.some(k => lower.includes(k))) {
                item.asked = true;
                console.log(`[Score] Patient history: "${item.label}" - EARNED`);
            }
        }

        // Track empathy keywords (after emotional trigger)
        if (this.emotionalTriggerFired) {
            const empathyKeywords = ['understand', 'sorry', 'hear', 'feel', 'scared', 'worry', 'concern',
                'here for you', 'together', 'help', 'okay', 'normal to feel', 'reassure', 'safe'];
            if (empathyKeywords.some(k => lower.includes(k))) {
                this.empathyItems.empathyResponse.earned = true;
            }

            const planKeywords = ['plan', 'going to', 'we will', 'test', 'treatment', 'medicine', 'help you', 'give you'];
            if (planKeywords.some(k => lower.includes(k))) {
                this.empathyItems.explainedPlan.earned = true;
            }

            const fearKeywords = ['brother', 'die', 'death', 'home', 'not going to', 'won\'t'];
            if (fearKeywords.some(k => lower.includes(k))) {
                this.empathyItems.addressedFears.earned = true;
            }
        }

        // Rapport: at least 5 meaningful exchanges
        if (this.patientMessageCount >= 5) {
            this.empathyItems.rapport.earned = true;
        }
    },

    /**
     * Track a user message sent to the nurse
     */
    trackNurseQuestion(text) {
        const lower = text.toLowerCase();

        for (const [key, item] of Object.entries(this.nurseHistoryItems)) {
            if (!item.asked && item.keywords.some(k => lower.includes(k))) {
                item.asked = true;
                console.log(`[Score] Nurse interaction: "${item.label}" - EARNED`);
            }
        }

        // Also track if user tells nurse to hold metformin (counts for medication scoring too)
        if (this.nurseHistoryItems.holdMeds.asked) {
            this.medicationOrders.holdMetformin.ordered = true;
        }
    },

    /**
     * Track navigation to chart sections
     */
    trackChartNavigation(route) {
        const routeMap = {
            '/problems': 'problemList',
            '/medications': 'medicationList',
            '/allergies': 'allergyList',
            '/labs': 'labResults',
            '/notes': 'notes'
        };

        const itemKey = routeMap[route];
        if (itemKey && !this.chartReviewItems[itemKey].viewed) {
            this.chartReviewItems[itemKey].viewed = true;
            console.log(`[Score] Chart review: "${this.chartReviewItems[itemKey].label}" - EARNED`);
        }
    },

    /**
     * Track when resolved problems tab is viewed
     */
    trackResolvedProblemsViewed() {
        if (!this.chartReviewItems.resolvedProblems.viewed) {
            this.chartReviewItems.resolvedProblems.viewed = true;
            console.log('[Score] Chart review: "Viewed Resolved Problems" - EARNED');
        }
    },

    /**
     * Track when a specific note is opened
     */
    trackNoteViewed(noteId) {
        if (noteId === 'NOTE100' && !this.chartReviewItems.giConsultNote.viewed) {
            this.chartReviewItems.giConsultNote.viewed = true;
            console.log('[Score] Chart review: "Read GI Consult Note" - EARNED');
        }
    },

    /**
     * Track an order submission
     */
    trackOrder(order) {
        const name = (order.name || '').toLowerCase();
        const formData = order.formData || {};
        const type = order.type;

        // ---- MEDICATION ORDERS ----
        if (type === 'medication') {
            // IV Furosemide / loop diuretic
            if (name.includes('furosemide') || name.includes('lasix') || name.includes('bumetanide') || name.includes('bumex')) {
                this.medicationOrders.ivFurosemide.ordered = true;
                const elapsed = typeof SimulationEngine !== 'undefined' ? SimulationEngine.getElapsedMinutes() : 999;
                if (elapsed <= 30) this.medicationOrders.ivFurosemide.timely = true;
                const dose = this._parseDose(formData.dose);
                if (dose >= 40 && dose <= 200) this.medicationOrders.ivFurosemide.correctDose = true;
                console.log(`[Score] Medication: IV Furosemide ordered (timely: ${elapsed <= 30}, dose: ${dose}mg)`);
            }

            // Potassium replacement
            if (name.includes('potassium') || name.includes('kcl') || name.includes('k-dur') || name.includes('klor')) {
                this.medicationOrders.potassiumMonitor.ordered = true;
                console.log('[Score] Medication: Potassium replacement - EARNED');
            }

            // Rate control for A-fib
            if (name.includes('metoprolol') || name.includes('diltiazem') || name.includes('amiodarone') || name.includes('cardizem')) {
                this.medicationOrders.rateControlAfib.ordered = true;
                console.log('[Score] Medication: Rate control - EARNED');
            }

            // Oxygen
            if (name.includes('oxygen') || name.includes('o2')) {
                this.medicationOrders.oxygenTherapy.ordered = true;
            }

            // SAFETY: Anticoagulation
            const anticoagulants = ['heparin', 'enoxaparin', 'lovenox', 'warfarin', 'coumadin',
                'apixaban', 'eliquis', 'rivaroxaban', 'xarelto', 'dabigatran', 'pradaxa',
                'edoxaban', 'fondaparinux'];
            if (anticoagulants.some(ac => name.includes(ac))) {
                this.medicationOrders.noAnticoagulation.safe = false;
                console.log('[Score] SAFETY VIOLATION: Anticoagulation ordered despite GI bleed history');
            }

            // SAFETY: ACE Inhibitor
            const aceInhibitors = ['lisinopril', 'enalapril', 'ramipril', 'benazepril', 'captopril',
                'quinapril', 'fosinopril', 'perindopril', 'trandolapril', 'moexipril'];
            if (aceInhibitors.some(ace => name.includes(ace))) {
                this.medicationOrders.noACEInhibitor.safe = false;
                this.allergyViolations.push({
                    medication: order.name,
                    allergen: 'ACE Inhibitor (Lisinopril)',
                    reaction: 'Angioedema',
                    severity: 'critical',
                    time: new Date().toISOString()
                });
                console.log('[Score] ALLERGY VIOLATION: ACE Inhibitor ordered - patient has angioedema allergy');
            }

            // SAFETY: Penicillin class
            const penicillins = ['amoxicillin', 'ampicillin', 'penicillin', 'augmentin', 'piperacillin',
                'nafcillin', 'oxacillin', 'dicloxacillin', 'amoxil', 'unasyn', 'zosyn'];
            if (penicillins.some(pen => name.includes(pen))) {
                this.medicationOrders.noPenicillin.safe = false;
                this.allergyViolations.push({
                    medication: order.name,
                    allergen: 'Penicillin',
                    reaction: 'Anaphylaxis',
                    severity: 'critical',
                    time: new Date().toISOString()
                });
                console.log('[Score] ALLERGY VIOLATION: Penicillin ordered - patient has anaphylaxis allergy');
            }
        }

        // ---- NURSING ORDERS ----
        if (type === 'nursing') {
            const details = (formData.details || '').toLowerCase();
            const orderType = (formData.orderType || '').toLowerCase();

            if (details.includes('i&o') || details.includes('strict') || orderType.includes('i&o') || orderType.includes('intake')) {
                this.medicationOrders.dailyWeightsIO.ordered = true;
            }
            if (details.includes('weight') || details.includes('daily weight') || orderType.includes('weight')) {
                this.medicationOrders.dailyWeightsIO.ordered = true;
            }
            if (details.includes('fluid restrict') || details.includes('restrict fluid') || orderType.includes('fluid')) {
                this.medicationOrders.fluidRestriction.ordered = true;
            }
        }

        // ---- ADMISSION ORDER SET ----
        if (type === 'admission') {
            if (formData.oxygen && formData.oxygen !== 'Room Air') {
                this.medicationOrders.oxygenTherapy.ordered = true;
            }
            if (formData.telemetry === 'Yes') {
                this.medicationOrders.telemetry.ordered = true;
            }
            if (formData.io === 'Strict I&O') {
                this.medicationOrders.dailyWeightsIO.ordered = true;
            }
            if (formData.dailyWeight === 'Yes') {
                this.medicationOrders.dailyWeightsIO.ordered = true;
            }
            if (formData.diet && (formData.diet.includes('Sodium') || formData.diet.includes('Fluid'))) {
                this.medicationOrders.fluidRestriction.ordered = true;
            }
            if (formData.vte === 'SCDs Only' || formData.vte === 'Contraindicated - SCDs Only') {
                this.medicationOrders.vteProphylaxis.ordered = true;
            }
        }

        // ---- LAB ORDERS ----
        if (type === 'lab') {
            if (name.includes('basic metabolic') || name.includes('bmp') || name.includes('comprehensive metabolic') || name.includes('cmp')) {
                this.medicationOrders.bmpMonitoring.ordered = true;
                this.medicationOrders.potassiumMonitor.ordered = true;
            }
            if (name.includes('magnesium') || name.includes('mag level')) {
                this.medicationOrders.magnesiumCheck.ordered = true;
            }
        }

        // ---- CONSULT ORDERS ----
        if (type === 'consult') {
            if ((formData.specialty || '').toLowerCase().includes('cardiology')) {
                this.medicationOrders.cardiologyConsult.ordered = true;
            }
        }
    },

    /**
     * Mark that the emotional trigger has fired
     */
    markEmotionalTrigger() {
        this.emotionalTriggerFired = true;
    },

    // ========== ALLERGY CHECK ==========

    /**
     * Check if a medication matches any patient allergy
     * Returns { isMatch, allergen, reaction, severity } or null
     */
    checkAllergyMatch(medicationName) {
        const name = (medicationName || '').toLowerCase();

        // Penicillin class
        const penicillins = ['amoxicillin', 'ampicillin', 'penicillin', 'augmentin', 'piperacillin',
            'nafcillin', 'oxacillin', 'dicloxacillin', 'amoxil', 'unasyn', 'zosyn'];
        if (penicillins.some(p => name.includes(p))) {
            return { isMatch: true, allergen: 'Penicillin', reaction: 'Anaphylaxis', severity: 'SEVERE' };
        }

        // ACE Inhibitor class
        const aceInhibitors = ['lisinopril', 'enalapril', 'ramipril', 'benazepril', 'captopril',
            'quinapril', 'fosinopril', 'perindopril', 'trandolapril', 'moexipril'];
        if (aceInhibitors.some(a => name.includes(a))) {
            return { isMatch: true, allergen: 'ACE Inhibitor (Lisinopril)', reaction: 'Angioedema', severity: 'SEVERE' };
        }

        // Sulfa class
        const sulfas = ['sulfamethoxazole', 'trimethoprim-sulfamethoxazole', 'bactrim', 'septra', 'sulfa'];
        if (sulfas.some(s => name.includes(s))) {
            return { isMatch: true, allergen: 'Sulfa Drugs', reaction: 'Rash/Hives', severity: 'MODERATE' };
        }

        return null;
    },

    // ========== SCORE CALCULATION ==========

    /**
     * Calculate final scores across all 6 categories
     * Returns object with category scores and overall weighted score
     */
    calculateFinalScores() {
        const scores = {};

        // 1. PATIENT HISTORY (20% weight)
        scores.patientHistory = this._calcCategoryScore(this.patientHistoryItems, 'asked');

        // 2. NURSE INTERACTION (15% weight)
        scores.nurseInteraction = this._calcCategoryScore(this.nurseHistoryItems, 'asked');

        // 3. CHART REVIEW (15% weight)
        scores.chartReview = this._calcCategoryScore(this.chartReviewItems, 'viewed');

        // 4. MEDICATION MANAGEMENT (30% weight)
        scores.medicationManagement = this._calcMedicationScore();

        // 5. SAFETY (10% weight)
        scores.safety = this._calcSafetyScore();

        // 6. EMPATHY (10% weight)
        scores.empathy = this._calcEmpathyScore();

        // OVERALL weighted score
        scores.overall = {
            score: Math.round(
                scores.patientHistory.score * 0.20 +
                scores.nurseInteraction.score * 0.15 +
                scores.chartReview.score * 0.15 +
                scores.medicationManagement.score * 0.30 +
                scores.safety.score * 0.10 +
                scores.empathy.score * 0.10
            ),
            max: 100
        };

        return scores;
    },

    // ========== INTERNAL HELPERS ==========

    _calcCategoryScore(items, field) {
        let earned = 0;
        let total = 0;
        const details = [];

        for (const [key, item] of Object.entries(items)) {
            total += item.points;
            const isEarned = item[field] === true;
            if (isEarned) earned += item.points;
            details.push({
                text: item.label,
                earned: isEarned,
                points: item.points,
                critical: item.points >= 10
            });
        }

        return {
            score: total > 0 ? Math.round((earned / total) * 100) : 0,
            earned,
            total,
            details
        };
    },

    _calcMedicationScore() {
        let earned = 0;
        let total = 0;
        const details = [];

        for (const [key, item] of Object.entries(this.medicationOrders)) {
            if (item.category === 'safety') continue; // Safety scored separately

            total += item.points;

            if (key === 'ivFurosemide') {
                // Special handling for furosemide: base + timely bonus + dose bonus
                let furosemideEarned = 0;
                if (item.ordered) {
                    furosemideEarned += 10; // Base points for ordering
                    details.push({ text: 'IV Furosemide ordered', earned: true, points: 10 });
                } else {
                    details.push({ text: 'IV Furosemide ordered', earned: false, points: 10, critical: true });
                }
                if (item.timely) {
                    furosemideEarned += 3;
                    details.push({ text: 'Furosemide within 30 minutes', earned: true, points: 3 });
                } else {
                    details.push({ text: 'Furosemide within 30 minutes', earned: false, points: 3 });
                }
                if (item.correctDose) {
                    furosemideEarned += 2;
                    details.push({ text: 'Appropriate furosemide dose (40-200mg)', earned: true, points: 2 });
                } else if (item.ordered) {
                    details.push({ text: 'Appropriate furosemide dose (40-200mg)', earned: false, points: 2 });
                }
                earned += furosemideEarned;
            } else {
                if (item.ordered) {
                    earned += item.points;
                    details.push({ text: item.label, earned: true, points: item.points });
                } else {
                    details.push({ text: item.label, earned: false, points: item.points });
                }
            }
        }

        return {
            score: total > 0 ? Math.round((earned / total) * 100) : 0,
            earned,
            total,
            details
        };
    },

    _calcSafetyScore() {
        let score = 100;
        const details = [];

        const safetyItems = {
            noAnticoagulation: { deduction: 40, label: 'Avoided anticoagulation (GI bleed contraindication)' },
            noACEInhibitor: { deduction: 30, label: 'Avoided ACE inhibitor (angioedema allergy)' },
            noPenicillin: { deduction: 30, label: 'Avoided penicillin (anaphylaxis allergy)' }
        };

        for (const [key, config] of Object.entries(safetyItems)) {
            const item = this.medicationOrders[key];
            if (item.safe) {
                details.push({ text: config.label, earned: true, points: config.deduction });
            } else {
                score -= config.deduction;
                details.push({ text: config.label, earned: false, points: config.deduction, critical: true });
            }
        }

        // Add allergy violations as extra detail
        for (const violation of this.allergyViolations) {
            details.push({
                text: `ALLERGY VIOLATION: ${violation.medication} (${violation.allergen} - ${violation.reaction})`,
                earned: false,
                critical: true
            });
        }

        return {
            score: Math.max(0, score),
            details
        };
    },

    _calcEmpathyScore() {
        if (!this.emotionalTriggerFired) {
            return {
                score: 50, // Neutral if trigger hasn't fired yet
                details: [{ text: 'Emotional challenge not yet encountered', earned: null }]
            };
        }

        let earned = 0;
        let total = 0;
        const details = [];

        for (const [key, item] of Object.entries(this.empathyItems)) {
            total += item.points;
            if (item.earned) {
                earned += item.points;
                details.push({ text: item.label, earned: true, points: item.points });
            } else {
                details.push({ text: item.label, earned: false, points: item.points });
            }
        }

        return {
            score: total > 0 ? Math.round((earned / total) * 100) : 0,
            earned,
            total,
            details
        };
    },

    _parseDose(doseStr) {
        if (!doseStr) return 0;
        const match = String(doseStr).match(/(\d+\.?\d*)/);
        return match ? parseFloat(match[1]) : 0;
    },

    /**
     * Get a summary of current tracking state (for debug)
     */
    getDebugSummary() {
        const patientAsked = Object.values(this.patientHistoryItems).filter(i => i.asked).length;
        const nurseAsked = Object.values(this.nurseHistoryItems).filter(i => i.asked).length;
        const chartViewed = Object.values(this.chartReviewItems).filter(i => i.viewed).length;
        const medsOrdered = Object.values(this.medicationOrders).filter(i => i.ordered).length;
        const safetyViolations = Object.values(this.medicationOrders).filter(i => 'safe' in i && !i.safe).length;

        return {
            patientHistory: `${patientAsked}/${Object.keys(this.patientHistoryItems).length}`,
            nurseInteraction: `${nurseAsked}/${Object.keys(this.nurseHistoryItems).length}`,
            chartReview: `${chartViewed}/${Object.keys(this.chartReviewItems).length}`,
            medicationsOrdered: medsOrdered,
            safetyViolations,
            allergyViolations: this.allergyViolations.length,
            emotionalTriggerFired: this.emotionalTriggerFired
        };
    }
};

window.SimulationScoreTracker = SimulationScoreTracker;
