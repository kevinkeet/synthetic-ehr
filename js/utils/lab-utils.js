/**
 * Lab utilities for reference ranges and flagging
 */

const LabUtils = {
    /**
     * Standard reference ranges for common lab tests
     * Ranges are [low, high] for normal values
     * criticalLow and criticalHigh are panic values
     */
    referenceRanges: {
        // Basic Metabolic Panel
        'Sodium': { range: [136, 145], unit: 'mEq/L', criticalLow: 120, criticalHigh: 160 },
        'Potassium': { range: [3.5, 5.0], unit: 'mEq/L', criticalLow: 2.5, criticalHigh: 6.5 },
        'Chloride': { range: [98, 106], unit: 'mEq/L', criticalLow: 80, criticalHigh: 120 },
        'CO2': { range: [23, 29], unit: 'mEq/L', criticalLow: 10, criticalHigh: 40 },
        'BUN': { range: [7, 20], unit: 'mg/dL' },
        'Creatinine': { range: [0.7, 1.3], unit: 'mg/dL', criticalHigh: 10 },
        'Glucose': { range: [70, 100], unit: 'mg/dL', criticalLow: 40, criticalHigh: 500 },
        'Calcium': { range: [8.5, 10.5], unit: 'mg/dL', criticalLow: 6.0, criticalHigh: 13.0 },

        // Complete Blood Count
        'WBC': { range: [4.5, 11.0], unit: 'K/uL', criticalLow: 2.0, criticalHigh: 30.0 },
        'RBC': { range: [4.5, 5.5], unit: 'M/uL' },
        'Hemoglobin': { range: [12.0, 17.5], unit: 'g/dL', criticalLow: 7.0, criticalHigh: 20.0 },
        'Hematocrit': { range: [36, 50], unit: '%', criticalLow: 20, criticalHigh: 60 },
        'MCV': { range: [80, 100], unit: 'fL' },
        'MCH': { range: [27, 33], unit: 'pg' },
        'MCHC': { range: [32, 36], unit: 'g/dL' },
        'RDW': { range: [11.5, 14.5], unit: '%' },
        'Platelets': { range: [150, 400], unit: 'K/uL', criticalLow: 50, criticalHigh: 1000 },

        // Liver Function Tests
        'AST': { range: [10, 40], unit: 'U/L' },
        'ALT': { range: [7, 56], unit: 'U/L' },
        'ALP': { range: [44, 147], unit: 'U/L' },
        'Total Bilirubin': { range: [0.1, 1.2], unit: 'mg/dL' },
        'Direct Bilirubin': { range: [0.0, 0.3], unit: 'mg/dL' },
        'Albumin': { range: [3.5, 5.0], unit: 'g/dL' },
        'Total Protein': { range: [6.0, 8.3], unit: 'g/dL' },

        // Lipid Panel
        'Total Cholesterol': { range: [0, 200], unit: 'mg/dL' },
        'LDL': { range: [0, 100], unit: 'mg/dL' },
        'HDL': { range: [40, 999], unit: 'mg/dL' }, // Higher is better
        'Triglycerides': { range: [0, 150], unit: 'mg/dL' },

        // Cardiac Markers
        'Troponin I': { range: [0, 0.04], unit: 'ng/mL', criticalHigh: 0.5 },
        'BNP': { range: [0, 100], unit: 'pg/mL' },
        'NT-proBNP': { range: [0, 300], unit: 'pg/mL' },

        // Thyroid
        'TSH': { range: [0.4, 4.0], unit: 'mIU/L' },
        'Free T4': { range: [0.8, 1.8], unit: 'ng/dL' },
        'Free T3': { range: [2.3, 4.2], unit: 'pg/mL' },

        // Diabetes
        'HbA1c': { range: [4.0, 5.6], unit: '%' },
        'Fasting Glucose': { range: [70, 100], unit: 'mg/dL', criticalLow: 40, criticalHigh: 500 },

        // Kidney Function
        'eGFR': { range: [90, 999], unit: 'mL/min/1.73m2' },
        'Urine Protein': { range: [0, 150], unit: 'mg/24hr' },
        'Microalbumin': { range: [0, 30], unit: 'mg/L' },

        // Coagulation
        'PT': { range: [11, 13.5], unit: 'seconds' },
        'INR': { range: [0.8, 1.2], unit: '' },
        'PTT': { range: [25, 35], unit: 'seconds' },

        // Iron Studies
        'Iron': { range: [60, 170], unit: 'mcg/dL' },
        'TIBC': { range: [250, 370], unit: 'mcg/dL' },
        'Ferritin': { range: [12, 300], unit: 'ng/mL' },

        // Inflammatory Markers
        'ESR': { range: [0, 20], unit: 'mm/hr' },
        'CRP': { range: [0, 1.0], unit: 'mg/dL' },

        // Electrolytes
        'Magnesium': { range: [1.7, 2.2], unit: 'mg/dL', criticalLow: 1.0, criticalHigh: 4.0 },
        'Phosphorus': { range: [2.5, 4.5], unit: 'mg/dL' },

        // Urinalysis
        'Urine pH': { range: [4.5, 8.0], unit: '' },
        'Specific Gravity': { range: [1.005, 1.030], unit: '' }
    },

    /**
     * Get flag for a lab result
     * Returns: 'critical-high', 'critical-low', 'high', 'low', or null
     */
    getFlag(testName, value) {
        const ref = this.referenceRanges[testName];
        if (!ref || value === null || value === undefined) return null;

        const numValue = parseFloat(value);
        if (isNaN(numValue)) return null;

        // Check critical values first
        if (ref.criticalLow !== undefined && numValue < ref.criticalLow) {
            return 'critical-low';
        }
        if (ref.criticalHigh !== undefined && numValue > ref.criticalHigh) {
            return 'critical-high';
        }

        // Check normal range
        if (numValue < ref.range[0]) {
            return 'low';
        }
        if (numValue > ref.range[1]) {
            return 'high';
        }

        return null;
    },

    /**
     * Get flag display text
     */
    getFlagText(flag) {
        switch (flag) {
            case 'critical-high': return 'H!!';
            case 'critical-low': return 'L!!';
            case 'high': return 'H';
            case 'low': return 'L';
            default: return '';
        }
    },

    /**
     * Get reference range string for display
     */
    getReferenceRange(testName) {
        const ref = this.referenceRanges[testName];
        if (!ref) return '';
        return `${ref.range[0]} - ${ref.range[1]}`;
    },

    /**
     * Get unit for a test
     */
    getUnit(testName) {
        const ref = this.referenceRanges[testName];
        return ref ? ref.unit : '';
    },

    /**
     * Format lab value with appropriate precision
     */
    formatValue(value, testName) {
        if (value === null || value === undefined) return '';
        const numValue = parseFloat(value);
        if (isNaN(numValue)) return value;

        // Determine decimal places based on test
        const ref = this.referenceRanges[testName];
        if (!ref) return numValue.toString();

        // Use 1 decimal place for most tests
        // Use 2 for tests with small values
        if (ref.range[1] < 10) {
            return numValue.toFixed(2);
        } else if (ref.range[1] < 100) {
            return numValue.toFixed(1);
        }
        return Math.round(numValue).toString();
    },

    /**
     * Check if any results in a panel are abnormal
     */
    hasAbnormalResults(results) {
        return results.some(result => {
            const flag = this.getFlag(result.name, result.value);
            return flag !== null;
        });
    },

    /**
     * Check if any results in a panel are critical
     */
    hasCriticalResults(results) {
        return results.some(result => {
            const flag = this.getFlag(result.name, result.value);
            return flag === 'critical-high' || flag === 'critical-low';
        });
    },

    /**
     * Get CSS class for a flag
     */
    getFlagClass(flag) {
        switch (flag) {
            case 'critical-high':
            case 'critical-low':
                return 'critical';
            case 'high':
                return 'high';
            case 'low':
                return 'low';
            default:
                return '';
        }
    },

    /**
     * Get value CSS class based on flag
     */
    getValueClass(flag) {
        switch (flag) {
            case 'critical-high': return 'critical-high';
            case 'critical-low': return 'critical-low';
            case 'high': return 'high';
            case 'low': return 'low';
            default: return '';
        }
    },

    /**
     * Group lab results by panel/category
     */
    groupByPanel(results) {
        const groups = {};
        results.forEach(result => {
            const panel = result.panelName || 'Other';
            if (!groups[panel]) {
                groups[panel] = [];
            }
            groups[panel].push(result);
        });
        return groups;
    },

    /**
     * Get trending data for a specific test
     */
    getTrendingData(allResults, testName, limit = 10) {
        return allResults
            .filter(r => r.name === testName && r.value !== null)
            .sort((a, b) => new Date(a.collectedDate) - new Date(b.collectedDate))
            .slice(-limit)
            .map(r => ({
                date: r.collectedDate,
                value: parseFloat(r.value),
                flag: this.getFlag(testName, r.value)
            }));
    }
};

window.LabUtils = LabUtils;
