/**
 * Main Application
 * Initializes the EHR application and sets up routing
 */

const App = {
    // Default patient ID (can be changed via URL or search)
    defaultPatientId: 'PAT001',
    isInitialized: false,

    /**
     * Initialize the application
     */
    async init() {
        console.log('Initializing SyntheticEHR...');

        // Start clock
        this.startClock();

        // Initialize navigation
        Navigation.init();

        // Setup routes
        this.setupRoutes();

        // Initialize global search
        GlobalSearch.init();

        // Initialize order entry
        OrderEntry.init();

        // Initialize AI panel
        AIPanel.init();

        // Initialize simulation engine and controls
        SimulationEngine.init();
        SimulationControls.init();
        LiveVitalsBanner.init();
        SimulationLog.init();
        DynamicLabs.init();
        DynamicImaging.init();
        SimulationDebrief.init();
        ClinicalImages.init();
        AICoworker.init();

        // Load default patient
        try {
            await this.loadPatient(this.defaultPatientId);
            this.isInitialized = true;
        } catch (error) {
            console.error('Error loading default patient:', error);
            this.showPatientError();
        }

        // Initialize router
        router.init();

        console.log('SyntheticEHR initialized successfully');
    },

    /**
     * Load a patient and their data
     */
    async loadPatient(patientId) {
        await PatientHeader.init(patientId);

        // Build search index in background
        SearchUtils.buildSearchIndex(patientId).then(() => {
            console.log('Search index ready');
        });

        // Now that patient data is loaded, initialize the AI copilot's
        // longitudinal document and re-render with real data
        if (typeof AICoworker !== 'undefined') {
            AICoworker.onPatientLoaded(patientId);
        }
    },

    /**
     * Setup application routes
     */
    setupRoutes() {
        router
            .on('/chart-review', () => ChartReview.render())
            .on('/notes', (params) => NotesList.render(params))
            .on('/labs', () => LabsTable.render())
            .on('/medications', () => Medications.render())
            .on('/problems', () => Problems.render())
            .on('/vitals', () => Vitals.render())
            .on('/encounters', () => Encounters.render())
            .on('/allergies', () => Allergies.render())
            .on('/imaging', () => Imaging.render())
            .on('/social-history', () => SocialHistory.render())
            .on('/family-history', () => FamilyHistory.render())
            .on('/immunizations', () => Immunizations.render())
            .on('/procedures', () => Procedures.render())
            .on('/orders', () => Orders.render());
    },

    /**
     * Start the clock in the header
     */
    startClock() {
        const updateClock = () => {
            const timeEl = document.getElementById('current-time');
            if (timeEl) {
                timeEl.textContent = DateUtils.getCurrentTimeString();
            }
        };

        updateClock();
        setInterval(updateClock, 1000);
    },

    /**
     * Show patient loading error
     */
    showPatientError() {
        const banner = document.getElementById('patient-banner');
        if (banner) {
            banner.innerHTML = `
                <div class="patient-info-banner">
                    <span class="patient-name" style="color: #fc8181;">
                        Error loading patient data
                    </span>
                </div>
            `;
        }

        const content = document.getElementById('main-content');
        if (content) {
            content.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">&#9888;</div>
                    <div class="empty-state-text">
                        Could not load patient data. Please check that the data files exist.
                    </div>
                    <div style="margin-top: 16px; font-size: 12px; color: #666;">
                        Expected location: data/patients/PAT001/demographics.json
                    </div>
                    <div style="margin-top: 24px;">
                        <button class="btn btn-primary" onclick="location.reload()">Retry</button>
                    </div>
                </div>
            `;
        }
    },

    /**
     * Switch to a different patient
     */
    async switchPatient(patientId) {
        this.showLoading('Switching patient...');

        dataLoader.clearCache();
        this.defaultPatientId = patientId;

        try {
            await this.loadPatient(patientId);
            router.navigate('/chart-review');
            this.showToast('Patient loaded successfully', 'success');
        } catch (error) {
            console.error('Error switching patient:', error);
            this.showToast('Error loading patient', 'error');
        }

        this.hideLoading();
    },

    /**
     * Show loading overlay
     */
    showLoading(message = 'Loading...') {
        let overlay = document.getElementById('loading-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'loading-overlay';
            overlay.className = 'loading-overlay';
            overlay.innerHTML = `
                <div style="text-align: center;">
                    <div class="loading-spinner"></div>
                    <div style="margin-top: 12px; color: #666;" id="loading-message">${message}</div>
                </div>
            `;
            document.body.appendChild(overlay);
        } else {
            document.getElementById('loading-message').textContent = message;
            overlay.style.display = 'flex';
        }
    },

    /**
     * Hide loading overlay
     */
    hideLoading() {
        const overlay = document.getElementById('loading-overlay');
        if (overlay) {
            overlay.style.display = 'none';
        }
    },

    /**
     * Show toast notification
     */
    showToast(message, type = 'info', duration = 3000) {
        const container = document.getElementById('toast-container');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `<span>${message}</span>`;

        container.appendChild(toast);

        // Auto remove
        setTimeout(() => {
            toast.style.animation = 'slideIn 0.3s ease reverse';
            setTimeout(() => toast.remove(), 300);
        }, duration);
    },

    /**
     * Export patient data summary
     */
    async exportSummary() {
        const patient = PatientHeader.getPatient();
        if (!patient) {
            this.showToast('No patient loaded', 'error');
            return;
        }

        try {
            const [problems, medications, allergies] = await Promise.all([
                dataLoader.loadActiveProblems(),
                dataLoader.loadActiveMedications(),
                dataLoader.loadAllergies()
            ]);

            const summary = {
                patient: {
                    name: `${patient.firstName} ${patient.lastName}`,
                    mrn: patient.mrn,
                    dob: patient.dateOfBirth,
                    age: DateUtils.calculateAge(patient.dateOfBirth)
                },
                problems: problems.problems || [],
                medications: medications.medications || [],
                allergies: allergies.allergies || [],
                exportDate: new Date().toISOString()
            };

            // Create download
            const blob = new Blob([JSON.stringify(summary, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `patient_summary_${patient.mrn}_${new Date().toISOString().split('T')[0]}.json`;
            a.click();
            URL.revokeObjectURL(url);

            this.showToast('Summary exported successfully', 'success');
        } catch (error) {
            console.error('Error exporting summary:', error);
            this.showToast('Error exporting summary', 'error');
        }
    },

    /**
     * Get data statistics for current patient
     */
    async getStats() {
        try {
            const [notes, labs, encounters, vitals] = await Promise.all([
                dataLoader.loadNotesIndex().catch(() => ({ notes: [] })),
                dataLoader.loadLabsIndex().catch(() => ({ panels: [], totalResults: 0 })),
                dataLoader.loadEncounters().catch(() => ({ encounters: [] })),
                dataLoader.loadVitals().catch(() => ({ vitals: [] }))
            ]);

            return {
                notes: notes.notes?.length || 0,
                labPanels: labs.panels?.length || 0,
                labResults: labs.totalResults || 0,
                encounters: encounters.encounters?.length || 0,
                vitals: vitals.vitals?.length || 0
            };
        } catch (error) {
            console.error('Error getting stats:', error);
            return null;
        }
    },

    /**
     * Print current view
     */
    printCurrentView() {
        window.print();
    },

    /**
     * Export patient chart to comprehensive PDF-ready HTML
     */
    async exportChart() {
        const patient = PatientHeader.getPatient();
        if (!patient) {
            this.showToast('No patient loaded', 'error');
            return;
        }

        this.showLoading('Generating chart export...');

        try {
            const [demographics, problems, medications, allergies, vitals, labs, notes] = await Promise.all([
                Promise.resolve(patient),
                dataLoader.loadProblems().catch(() => ({ active: { problems: [] }, resolved: { problems: [] } })),
                dataLoader.loadMedications().catch(() => ({ active: { medications: [] }, historical: { medications: [] } })),
                dataLoader.loadAllergies().catch(() => ({ allergies: [] })),
                dataLoader.loadVitals().catch(() => ({ vitals: [] })),
                dataLoader.loadLabsIndex().catch(() => ({ panels: [] })),
                dataLoader.loadNotesIndex().catch(() => ({ notes: [] }))
            ]);

            const html = this.generateChartExportHTML(demographics, problems, medications, allergies, vitals, labs, notes);

            // Open in new window for printing
            const printWindow = window.open('', '_blank');
            printWindow.document.write(html);
            printWindow.document.close();

            this.hideLoading();
            this.showToast('Chart exported - use browser print to save as PDF', 'success');
        } catch (error) {
            console.error('Error exporting chart:', error);
            this.hideLoading();
            this.showToast('Error exporting chart', 'error');
        }
    },

    /**
     * Generate HTML for chart export
     */
    generateChartExportHTML(patient, problems, medications, allergies, vitals, labs, notes) {
        const age = DateUtils.calculateAge(patient.dateOfBirth);
        const activeProblems = problems.active?.problems || [];
        const activeMeds = medications.active?.medications || [];
        const allergyList = allergies.allergies || [];
        const vitalsList = (vitals.vitals || []).slice(0, 10);
        const recentLabs = (labs.panels || []).slice(0, 20);
        const recentNotes = (notes.notes || []).slice(0, 10);

        return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Patient Chart - ${patient.firstName} ${patient.lastName}</title>
    <style>
        * { box-sizing: border-box; }
        body {
            font-family: Arial, sans-serif;
            font-size: 11pt;
            line-height: 1.4;
            color: #333;
            max-width: 8.5in;
            margin: 0 auto;
            padding: 0.5in;
        }
        .header {
            border-bottom: 2px solid #1a5276;
            padding-bottom: 12px;
            margin-bottom: 20px;
        }
        .header h1 {
            color: #1a5276;
            margin: 0 0 8px 0;
            font-size: 18pt;
        }
        .patient-info {
            display: flex;
            gap: 24px;
            flex-wrap: wrap;
            font-size: 10pt;
        }
        .patient-info span { white-space: nowrap; }
        .section {
            margin-bottom: 20px;
            page-break-inside: avoid;
        }
        .section-title {
            background: #1a5276;
            color: white;
            padding: 6px 12px;
            font-weight: bold;
            font-size: 11pt;
            margin-bottom: 8px;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            font-size: 10pt;
        }
        th, td {
            border: 1px solid #ddd;
            padding: 6px 8px;
            text-align: left;
        }
        th {
            background: #f5f5f5;
            font-weight: bold;
        }
        .allergy-banner {
            background: #fef2f2;
            border: 1px solid #fca5a5;
            padding: 8px 12px;
            margin-bottom: 16px;
            color: #b91c1c;
            font-weight: bold;
        }
        .flag-high { color: #b91c1c; font-weight: bold; }
        .flag-low { color: #1d4ed8; font-weight: bold; }
        .footer {
            margin-top: 24px;
            padding-top: 12px;
            border-top: 1px solid #ddd;
            font-size: 9pt;
            color: #666;
        }
        @media print {
            body { padding: 0; }
            .section { page-break-inside: avoid; }
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>${patient.firstName} ${patient.lastName}</h1>
        <div class="patient-info">
            <span><strong>MRN:</strong> ${patient.mrn}</span>
            <span><strong>DOB:</strong> ${DateUtils.formatDate(patient.dateOfBirth)} (${age})</span>
            <span><strong>Sex:</strong> ${patient.sex}</span>
            <span><strong>Phone:</strong> ${patient.phone || 'N/A'}</span>
        </div>
    </div>

    ${allergyList.length > 0 ? `
    <div class="allergy-banner">
        ALLERGIES: ${allergyList.map(a => `${a.allergen} (${a.reaction})`).join(', ')}
    </div>
    ` : ''}

    <div class="section">
        <div class="section-title">Active Problems</div>
        <table>
            <thead><tr><th>Problem</th><th>ICD-10</th><th>Onset</th></tr></thead>
            <tbody>
                ${activeProblems.length > 0 ? activeProblems.map(p => `
                    <tr>
                        <td>${p.name}</td>
                        <td>${p.icdCode || '-'}</td>
                        <td>${p.onsetDate ? DateUtils.formatDate(p.onsetDate) : '-'}</td>
                    </tr>
                `).join('') : '<tr><td colspan="3">No active problems</td></tr>'}
            </tbody>
        </table>
    </div>

    <div class="section">
        <div class="section-title">Active Medications</div>
        <table>
            <thead><tr><th>Medication</th><th>Dose</th><th>Frequency</th><th>Route</th></tr></thead>
            <tbody>
                ${activeMeds.length > 0 ? activeMeds.map(m => `
                    <tr>
                        <td>${m.name}</td>
                        <td>${m.dose || '-'}</td>
                        <td>${m.frequency || '-'}</td>
                        <td>${m.route || '-'}</td>
                    </tr>
                `).join('') : '<tr><td colspan="4">No active medications</td></tr>'}
            </tbody>
        </table>
    </div>

    <div class="section">
        <div class="section-title">Recent Vitals</div>
        <table>
            <thead><tr><th>Date</th><th>BP</th><th>HR</th><th>Temp</th><th>SpO2</th><th>Weight</th></tr></thead>
            <tbody>
                ${vitalsList.length > 0 ? vitalsList.map(v => `
                    <tr>
                        <td>${DateUtils.formatDate(v.date)}</td>
                        <td>${v.bloodPressure || '-'}</td>
                        <td>${v.heartRate || '-'}</td>
                        <td>${v.temperature ? v.temperature + ' F' : '-'}</td>
                        <td>${v.oxygenSaturation ? v.oxygenSaturation + '%' : '-'}</td>
                        <td>${v.weight ? v.weight + ' kg' : '-'}</td>
                    </tr>
                `).join('') : '<tr><td colspan="6">No vitals recorded</td></tr>'}
            </tbody>
        </table>
    </div>

    <div class="section">
        <div class="section-title">Recent Lab Panels</div>
        <table>
            <thead><tr><th>Date</th><th>Panel</th><th>Ordered By</th><th>Status</th></tr></thead>
            <tbody>
                ${recentLabs.length > 0 ? recentLabs.map(l => `
                    <tr>
                        <td>${DateUtils.formatDate(l.collectedDate)}</td>
                        <td>${l.name}</td>
                        <td>${l.orderedBy || '-'}</td>
                        <td>${l.status || 'Final'}</td>
                    </tr>
                `).join('') : '<tr><td colspan="4">No labs recorded</td></tr>'}
            </tbody>
        </table>
    </div>

    <div class="section">
        <div class="section-title">Recent Notes</div>
        <table>
            <thead><tr><th>Date</th><th>Type</th><th>Title</th><th>Author</th></tr></thead>
            <tbody>
                ${recentNotes.length > 0 ? recentNotes.map(n => `
                    <tr>
                        <td>${DateUtils.formatDate(n.date)}</td>
                        <td>${n.type || '-'}</td>
                        <td>${n.title || '-'}</td>
                        <td>${n.author || '-'}</td>
                    </tr>
                `).join('') : '<tr><td colspan="4">No notes recorded</td></tr>'}
            </tbody>
        </table>
    </div>

    <div class="footer">
        <p>Generated from SyntheticEHR on ${new Date().toLocaleString()}</p>
        <p>This is synthetic data for testing purposes only.</p>
    </div>
</body>
</html>`;
    },

    /**
     * Export specific section data as CSV
     */
    async exportSectionCSV(section) {
        const patient = PatientHeader.getPatient();
        if (!patient) {
            this.showToast('No patient loaded', 'error');
            return;
        }

        try {
            let data, filename, headers;

            switch (section) {
                case 'labs':
                    const allLabs = await dataLoader.loadAllLabs();
                    headers = ['Date', 'Panel', 'Test', 'Value', 'Unit', 'Reference Range', 'Flag'];
                    data = allLabs.map(lab => [
                        lab.collectedDate,
                        lab.panelName,
                        lab.name,
                        lab.value,
                        lab.unit,
                        lab.referenceRange,
                        LabUtils.getAbnormalFlag(lab.name, lab.value, lab.referenceRange)?.flag || ''
                    ]);
                    filename = `labs_${patient.mrn}`;
                    break;

                case 'medications':
                    const meds = await dataLoader.loadMedications();
                    headers = ['Status', 'Name', 'Dose', 'Route', 'Frequency', 'Start Date', 'End Date', 'Prescriber'];
                    data = [
                        ...(meds.active?.medications || []).map(m => ['Active', m.name, m.dose, m.route, m.frequency, m.startDate, '', m.prescriber]),
                        ...(meds.historical?.medications || []).map(m => ['Historical', m.name, m.dose, m.route, m.frequency, m.startDate, m.endDate, m.prescriber])
                    ];
                    filename = `medications_${patient.mrn}`;
                    break;

                case 'problems':
                    const probs = await dataLoader.loadProblems();
                    headers = ['Status', 'Problem', 'ICD-10', 'Onset Date', 'Resolved Date'];
                    data = [
                        ...(probs.active?.problems || []).map(p => ['Active', p.name, p.icdCode, p.onsetDate, '']),
                        ...(probs.resolved?.problems || []).map(p => ['Resolved', p.name, p.icdCode, p.onsetDate, p.resolvedDate])
                    ];
                    filename = `problems_${patient.mrn}`;
                    break;

                case 'vitals':
                    const vits = await dataLoader.loadVitals();
                    headers = ['Date', 'Blood Pressure', 'Heart Rate', 'Temperature', 'Respiratory Rate', 'SpO2', 'Weight', 'Height', 'BMI'];
                    data = (vits.vitals || []).map(v => [
                        v.date, v.bloodPressure, v.heartRate, v.temperature, v.respiratoryRate,
                        v.oxygenSaturation, v.weight, v.height, v.bmi
                    ]);
                    filename = `vitals_${patient.mrn}`;
                    break;

                default:
                    this.showToast('Unknown section', 'error');
                    return;
            }

            const csv = this.arrayToCSV([headers, ...data]);
            this.downloadFile(csv, `${filename}_${new Date().toISOString().split('T')[0]}.csv`, 'text/csv');
            this.showToast(`${section} exported to CSV`, 'success');
        } catch (error) {
            console.error('Error exporting CSV:', error);
            this.showToast('Error exporting data', 'error');
        }
    },

    /**
     * Convert array to CSV string
     */
    arrayToCSV(data) {
        return data.map(row =>
            row.map(cell => {
                const str = String(cell ?? '');
                if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                    return `"${str.replace(/"/g, '""')}"`;
                }
                return str;
            }).join(',')
        ).join('\n');
    },

    /**
     * Download file helper
     */
    downloadFile(content, filename, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }
};

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    App.init();
});

window.App = App;
