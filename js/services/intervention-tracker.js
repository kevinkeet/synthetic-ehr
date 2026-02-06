/**
 * Intervention Tracker
 * Tracks active interventions (medications, procedures) and their effects over time
 */

const InterventionTracker = {
    // Active interventions being processed
    activeInterventions: [],

    // Completed interventions (for history)
    completedInterventions: [],

    /**
     * Add a new intervention
     * @param {Object} intervention - The intervention details
     * @param {Date} startTime - Simulated start time
     */
    addIntervention(intervention, startTime) {
        const activeIntervention = {
            id: `INT_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            ...intervention,
            startTime: new Date(startTime),
            elapsedMinutes: 0,
            effectApplied: 0, // Percentage of total effect applied
            status: 'active'
        };

        // Get effect profile for this intervention type
        const profile = this.getEffectProfile(intervention);
        if (profile) {
            activeIntervention.profile = profile;
        }

        this.activeInterventions.push(activeIntervention);

        console.log('Intervention added:', activeIntervention.name || activeIntervention.type);
        return activeIntervention;
    },

    /**
     * Process all active interventions
     * @param {Object} state - Current patient state
     * @param {number} minutes - Minutes elapsed since last tick
     * @param {Date} currentTime - Current simulated time
     */
    processInterventions(state, minutes, currentTime) {
        const toRemove = [];

        for (const intervention of this.activeInterventions) {
            intervention.elapsedMinutes += minutes;

            // Apply intervention effect
            this.applyInterventionEffect(state, intervention, minutes);

            // Check if intervention is complete
            if (this.isInterventionComplete(intervention)) {
                intervention.status = 'completed';
                intervention.endTime = new Date(currentTime);
                toRemove.push(intervention);
                this.completedInterventions.push(intervention);
            }
        }

        // Remove completed interventions
        for (const intervention of toRemove) {
            const index = this.activeInterventions.indexOf(intervention);
            if (index > -1) {
                this.activeInterventions.splice(index, 1);
            }
        }
    },

    /**
     * Apply the effect of an intervention based on its profile
     */
    applyInterventionEffect(state, intervention, minutes) {
        const profile = intervention.profile;
        if (!profile) return;

        // Calculate effect curve position
        const elapsed = intervention.elapsedMinutes;
        const onsetTime = profile.onsetTime || 0;
        const peakTime = profile.peakTime || 60;
        const duration = profile.duration || 360;

        // No effect before onset
        if (elapsed < onsetTime) return;

        // Calculate effect intensity based on pharmacokinetic curve
        let intensity = 0;
        const activeTime = elapsed - onsetTime;

        if (activeTime < peakTime) {
            // Rising phase - linear ramp to peak
            intensity = activeTime / peakTime;
        } else if (activeTime < duration) {
            // Decay phase - exponential decay from peak
            const decayTime = activeTime - peakTime;
            const decayDuration = duration - peakTime;
            intensity = Math.exp(-2 * decayTime / decayDuration);
        } else {
            intensity = 0;
        }

        // Apply scaled effects to state
        if (profile.effects && intensity > 0) {
            const doseScale = (intervention.dose || profile.standardDose) / profile.standardDose;
            const minuteScale = minutes / 60; // Convert to hourly rate

            for (const effect of profile.effects) {
                this.applyEffect(state, effect, intensity * doseScale * minuteScale);
            }
        }

        // Track how much effect has been applied
        intervention.effectApplied = Math.min(100, (elapsed / duration) * 100);
    },

    /**
     * Apply a single effect to patient state
     */
    applyEffect(state, effect, intensity) {
        const path = effect.parameter.split('.');
        let target = state;

        // Navigate to nested property, creating objects as needed
        for (let i = 0; i < path.length - 1; i++) {
            if (!target[path[i]]) target[path[i]] = {};
            target = target[path[i]];
        }

        const key = path[path.length - 1];
        const currentValue = target[key] ?? effect.baseline ?? 0;

        // Calculate new value with limits
        let newValue = currentValue + (effect.changePerHour * intensity);

        if (effect.min !== undefined) newValue = Math.max(effect.min, newValue);
        if (effect.max !== undefined) newValue = Math.min(effect.max, newValue);

        target[key] = newValue;
    },

    /**
     * Check if an intervention is complete
     */
    isInterventionComplete(intervention) {
        const profile = intervention.profile;
        if (!profile) return intervention.elapsedMinutes >= 60; // Default 1 hour

        // Check if past duration
        if (intervention.elapsedMinutes >= profile.duration) {
            return true;
        }

        // Check for one-time interventions
        if (profile.oneTime && intervention.effectApplied >= 100) {
            return true;
        }

        return false;
    },

    /**
     * Get effect profile for an intervention
     */
    getEffectProfile(intervention) {
        const type = intervention.type?.toLowerCase();
        const name = intervention.name?.toLowerCase() || '';
        const category = intervention.category?.toLowerCase();

        // Medication effects
        if (category === 'medication' || type === 'medication') {
            return this.getMedicationProfile(name, intervention.dose);
        }

        // IV Fluid effects
        if (name.includes('fluid') || name.includes('saline') || name.includes('lactated')) {
            return {
                onsetTime: 0,
                peakTime: 30,
                duration: 120,
                standardDose: 1000,
                effects: [
                    { parameter: 'physiology.fluidOverload', changePerHour: 0.5, max: 10 },
                    { parameter: 'vitals.systolic', changePerHour: 5, max: 160 }
                ]
            };
        }

        // Oxygen therapy
        if (name.includes('oxygen') || name.includes('o2')) {
            return {
                onsetTime: 0,
                peakTime: 5,
                duration: 9999, // Continuous
                standardDose: 2,
                effects: [
                    { parameter: 'vitals.oxygenSaturation', changePerHour: 5, max: 100 }
                ]
            };
        }

        // Lab draw (no physiological effect)
        if (category === 'lab') {
            return {
                onsetTime: 0,
                peakTime: 1,
                duration: 1,
                oneTime: true,
                effects: []
            };
        }

        return null;
    },

    /**
     * Get medication-specific effect profile
     */
    getMedicationProfile(name, dose) {
        const profiles = {
            'furosemide': {
                onsetTime: 5,
                peakTime: 60,
                duration: 360,
                standardDose: 40,
                effects: [
                    { parameter: 'physiology.fluidOverload', changePerHour: -0.8, min: 0 },
                    { parameter: 'physiology.urineOutput', changePerHour: 150, max: 500 },
                    { parameter: 'labs.potassium', changePerHour: -0.15, min: 2.8 },
                    { parameter: 'vitals.weight', changePerHour: -0.3, min: 80 }
                ]
            },
            'lasix': { // Alias for furosemide
                onsetTime: 5,
                peakTime: 60,
                duration: 360,
                standardDose: 40,
                effects: [
                    { parameter: 'physiology.fluidOverload', changePerHour: -0.8, min: 0 },
                    { parameter: 'physiology.urineOutput', changePerHour: 150, max: 500 },
                    { parameter: 'labs.potassium', changePerHour: -0.15, min: 2.8 },
                    { parameter: 'vitals.weight', changePerHour: -0.3, min: 80 }
                ]
            },
            'bumetanide': {
                onsetTime: 5,
                peakTime: 45,
                duration: 240,
                standardDose: 1,
                effects: [
                    { parameter: 'physiology.fluidOverload', changePerHour: -1.0, min: 0 },
                    { parameter: 'physiology.urineOutput', changePerHour: 200, max: 600 },
                    { parameter: 'labs.potassium', changePerHour: -0.2, min: 2.8 }
                ]
            },
            'lisinopril': {
                onsetTime: 60,
                peakTime: 180,
                duration: 1440,
                standardDose: 10,
                effects: [
                    { parameter: 'vitals.systolic', changePerHour: -3, min: 90 },
                    { parameter: 'vitals.diastolic', changePerHour: -2, min: 55 },
                    { parameter: 'labs.potassium', changePerHour: 0.1, max: 6 },
                    { parameter: 'labs.creatinine', changePerHour: 0.05, max: 4 }
                ]
            },
            'carvedilol': {
                onsetTime: 30,
                peakTime: 90,
                duration: 720,
                standardDose: 12.5,
                effects: [
                    { parameter: 'vitals.heartRate', changePerHour: -3, min: 50 },
                    { parameter: 'vitals.systolic', changePerHour: -2, min: 90 }
                ]
            },
            'metoprolol': {
                onsetTime: 15,
                peakTime: 60,
                duration: 360,
                standardDose: 25,
                effects: [
                    { parameter: 'vitals.heartRate', changePerHour: -5, min: 50 },
                    { parameter: 'vitals.systolic', changePerHour: -3, min: 90 }
                ]
            },
            'spironolactone': {
                onsetTime: 120,
                peakTime: 360,
                duration: 1440,
                standardDose: 25,
                effects: [
                    { parameter: 'physiology.fluidOverload', changePerHour: -0.15, min: 0 },
                    { parameter: 'labs.potassium', changePerHour: 0.1, max: 6 }
                ]
            },
            'potassium': {
                onsetTime: 30,
                peakTime: 120,
                duration: 360,
                standardDose: 20,
                effects: [
                    { parameter: 'labs.potassium', changePerHour: 0.2, max: 5.5 }
                ]
            },
            'insulin': {
                onsetTime: 10,
                peakTime: 45,
                duration: 180,
                standardDose: 10,
                effects: [
                    { parameter: 'labs.glucose', changePerHour: -30, min: 70 },
                    { parameter: 'labs.potassium', changePerHour: -0.3, min: 3 }
                ]
            },
            'nitroglycerin': {
                onsetTime: 2,
                peakTime: 10,
                duration: 45,
                standardDose: 0.4,
                effects: [
                    { parameter: 'vitals.systolic', changePerHour: -20, min: 90 },
                    { parameter: 'symptoms.chestDiscomfort', changePerHour: -5, min: 0 }
                ]
            },
            'morphine': {
                onsetTime: 5,
                peakTime: 30,
                duration: 240,
                standardDose: 4,
                effects: [
                    { parameter: 'symptoms.dyspnea', changePerHour: -2, min: 0 },
                    { parameter: 'symptoms.pain', changePerHour: -3, min: 0 },
                    { parameter: 'vitals.respiratoryRate', changePerHour: -2, min: 10 }
                ]
            },
            'heparin': {
                onsetTime: 0,
                peakTime: 30,
                duration: 360,
                standardDose: 5000,
                effects: [] // Anticoagulation effect tracked separately
            },
            'warfarin': {
                onsetTime: 1440, // Takes days to work
                peakTime: 4320,
                duration: 7200,
                standardDose: 5,
                effects: []
            }
        };

        // Find matching profile
        for (const [key, profile] of Object.entries(profiles)) {
            if (name.includes(key)) {
                return { ...profile };
            }
        }

        // Default medication profile
        return {
            onsetTime: 30,
            peakTime: 120,
            duration: 480,
            standardDose: dose || 1,
            effects: []
        };
    },

    /**
     * Check if a specific type of intervention is active
     */
    hasIntervention(type) {
        return this.activeInterventions.some(i =>
            i.type?.toLowerCase() === type.toLowerCase() ||
            i.name?.toLowerCase().includes(type.toLowerCase()) ||
            i.category?.toLowerCase() === type.toLowerCase()
        );
    },

    /**
     * Get all active interventions
     */
    getActiveInterventions() {
        return [...this.activeInterventions];
    },

    /**
     * Get intervention history
     */
    getHistory() {
        return [...this.completedInterventions];
    },

    /**
     * Get all interventions (active and completed)
     */
    getAllInterventions() {
        return [...this.activeInterventions, ...this.completedInterventions];
    },

    /**
     * Clear all interventions (for reset)
     */
    clear() {
        this.activeInterventions = [];
        this.completedInterventions = [];
    }
};

window.InterventionTracker = InterventionTracker;
