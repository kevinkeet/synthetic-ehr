/**
 * Main Application
 * Initializes the EHR application and sets up routing
 */

const App = {
    // Default patient ID (can be changed via URL or search)
    defaultPatientId: 'PAT002',
    isInitialized: false,

    // Per-case default chart-gate anchors. Keeps the chart restricted to the
    // initial timepoint when first opened so the resident isn't spoiled by
    // future encounters. The assessment engine advances the gate as the
    // resident moves through timepoints; on engine teardown we re-apply this
    // default so casual browsing stays gated.
    _DEFAULT_GATE_ANCHORS: {
        PAT002: '2026-01-12T23:59:59Z',
        PAT003: '2027-04-12T23:59:59Z',
    },

    /**
     * Refresh Lucide icons — call after dynamic content is rendered.
     * Debounced to avoid excessive calls during rapid re-renders.
     */
    _lucideTimer: null,
    refreshIcons() {
        if (this._lucideTimer) return;
        this._lucideTimer = setTimeout(() => {
            this._lucideTimer = null;
            if (typeof lucide !== 'undefined') {
                try { lucide.createIcons(); } catch (e) { /* ignore */ }
            }
        }, 50);
    },

    /**
     * Initialize the application
     */
    async init() {
        console.log('Initializing Acting Intern...');

        // One-time cleanup: clear stale simulation data from previous sessions
        this._clearStaleSessionData();

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

        // Initialize Supabase auth + settings sync (before AI so settings are loaded)
        if (typeof SupabaseSync !== 'undefined') {
            try {
                await SupabaseSync.init();
            } catch (e) {
                console.warn('Supabase init failed (non-fatal):', e.message);
            }
        }

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
        FloatingChat.init();
        FeedbackWidget.init();
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

        // Show About popup on first visit
        About.checkFirstVisit();

        // Start the logo AI reveal animation
        this.startLogoAnimation();

        console.log('Acting Intern initialized successfully');
    },

    /**
     * Load a patient and their data
     */
    async loadPatient(patientId) {
        await PatientHeader.init(patientId);

        // Apply the default chart gate for this patient (if any). Done early
        // so the first chart render is already filtered. The assessment
        // engine will override the anchor if an assessment is in progress.
        this._applyDefaultGate(patientId);

        // Tag the body with the current patient id so CSS can hide
        // distractions (AI panel, Sim controls) on case patients where we
        // want the resident focused on the chart + assessment chatbot only.
        document.body.classList.forEach((c) => {
            if (c.startsWith('patient-')) document.body.classList.remove(c);
        });
        if (patientId) document.body.classList.add('patient-' + patientId.toLowerCase());

        // Broadcast for listeners (e.g. the patient picker dropdown keeps
        // its selected option in sync if the patient changes via another path).
        window.dispatchEvent(new CustomEvent('patient:loaded', { detail: { patientId } }));

        // Build search index in background (non-blocking)
        SearchUtils.buildSearchIndex(patientId).then(() => {
            console.log('Search index ready');
        });

        // Initialize AI longitudinal document in background (non-blocking).
        // This used to block the entire page render — now the chart loads
        // immediately while the AI context builds in the background.
        if (typeof AICoworker !== 'undefined') {
            AICoworker.onPatientLoaded(patientId).then(() => {
                console.log('AI longitudinal document ready');
            }).catch(err => {
                console.warn('AI longitudinal doc init failed (non-fatal):', err);
            });
        }
    },

    /**
     * Smart navigation for the sidebar "Assessment" link.
     * - If the engine has an active attempt loaded in memory → go straight to
     *   the run view so the resident resumes exactly where they left off.
     * - Otherwise → land on /assessment/start which itself surfaces any
     *   resumable in-progress attempt from the DB or lets them begin a new one.
     * Returns false to prevent the default href navigation when we hijack it.
     */
    _navigateToAssessment(e) {
        if (e) e.preventDefault();
        const active = (typeof AssessmentEngine !== 'undefined' &&
                        AssessmentEngine.isActive && AssessmentEngine.isActive());
        location.hash = active ? '#/assessment/run' : '#/assessment/start';
        return false;
    },

    /**
     * Activate the default chart gate for a patient, if one is configured.
     * Idempotent — safe to call repeatedly. If no default exists for the
     * patient, deactivates any existing gate.
     */
    _applyDefaultGate(patientId) {
        if (typeof AssessmentChartGate === 'undefined') return;
        const anchor = this._DEFAULT_GATE_ANCHORS[patientId];
        if (anchor) {
            AssessmentChartGate.activate({ caseId: patientId, anchorDateIso: anchor });
        } else if (AssessmentChartGate.isActive && AssessmentChartGate.isActive()) {
            AssessmentChartGate.deactivate();
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
            .on('/orders', () => Orders.render())
            .on('/about', () => About.render())
            // Assessment Framework (Phase 3)
            .on('/assessment/start', () => AssessmentStart.render())
            .on('/assessment/run', () => AssessmentPanel.renderActive())
            .on('/assessment/results/:id', (params) => AssessmentResults.render(params.id))
            .on('/admin/attempts', () => AdminDashboard.renderList())
            .on('/admin/attempts/:id', (params) => AdminDashboard.renderDetail(params.id));

        // Refresh sidebar entries when auth state changes (Assessment + Admin links).
        window.addEventListener('supabase:auth-state-change', () => this._refreshAssessmentNav());
        window.addEventListener('supabase:auth-ready', () => this._refreshAssessmentNav());
        // Initial render once nav exists.
        setTimeout(() => this._refreshAssessmentNav(), 100);

        // When an assessment ends, re-apply the patient's default gate so
        // the chart goes back to timepoint-zero instead of opening fully.
        if (typeof AssessmentEngine !== 'undefined' && AssessmentEngine.on) {
            AssessmentEngine.on((event) => {
                if (event === 'stopped' || event === 'completed' || event === 'abandoned') {
                    this._applyDefaultGate(this.defaultPatientId);
                }
            });
        }
    },

    /**
     * Inject (or refresh) the "Take Assessment" and "Admin" links in the sidebar.
     * - Assessment link is always visible (auth gate handled in the page).
     * - Admin link only appears for users with admin/proctor role.
     */
    async _refreshAssessmentNav() {
        const sidebar = document.getElementById('sidebar');
        if (!sidebar) return;

        // Remove any prior assessment section so we can rebuild deterministically.
        const prior = sidebar.querySelector('.nav-section.assessment-nav-section');
        if (prior) prior.remove();

        const section = document.createElement('div');
        section.className = 'nav-section assessment-nav-section';
        section.innerHTML = `
            <div class="nav-section-title">Assessment</div>
            <a href="#/assessment/start" class="nav-item assessment-mode-link" data-section="assessment-start"
               onclick="return App._navigateToAssessment(event)">
                <span class="nav-icon"><i data-lucide="graduation-cap"></i></span>
                Assessment
            </a>
            <a href="#/admin/attempts" class="nav-item assessment-admin-link" data-section="admin"
               id="assessment-admin-link" style="display:none;">
                <span class="nav-icon"><i data-lucide="shield"></i></span>
                Admin
            </a>
        `;
        sidebar.appendChild(section);
        this.refreshIcons();

        // Show the admin link if user is an admin / proctor.
        if (typeof SupabaseSync !== 'undefined' && SupabaseSync.isAuthenticated()) {
            try {
                const sb = SupabaseSync.getClient();
                const user = SupabaseSync.getUser();
                if (sb && user) {
                    const { data, error } = await sb
                        .from('admin_roles')
                        .select('role')
                        .eq('user_id', user.id)
                        .maybeSingle();
                    if (!error && data && (data.role === 'admin' || data.role === 'proctor')) {
                        const link = document.getElementById('assessment-admin-link');
                        if (link) link.style.display = '';
                    }
                }
            } catch (e) {
                /* non-fatal */
            }
        }
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
     * Animate the AI panel title: periodically collapse to just "AI" and back.
     */
    startLogoAnimation() {
        const logo = document.querySelector('.ai-panel-topbar-title .logo-animated');
        if (!logo) return;

        // Initial delay before first animation
        setTimeout(() => {
            this._runLogoReveal(logo);
            // Then repeat every 10 seconds
            setInterval(() => this._runLogoReveal(logo), 10000);
        }, 3000);
    },

    _runLogoReveal(logo) {
        // Collapse to "AI"
        logo.classList.add('ai-reveal');
        // Hold for 1.5s, then expand back
        setTimeout(() => {
            logo.classList.remove('ai-reveal');
        }, 1500);
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
                        Expected location: data/patients/${this.defaultPatientId}/demographics.json
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
     * Clears per-patient AI state so the new chart starts clean.
     */
    async switchPatient(patientId) {
        if (!patientId) return;

        this.showLoading('Switching patient...');

        // Reset chart data caches
        dataLoader.clearCache();
        this.defaultPatientId = patientId;

        // Drop any active gate from the previous patient — loadPatient() will
        // re-apply this patient's default gate (if any) after data loads.
        if (typeof AssessmentChartGate !== 'undefined' && AssessmentChartGate.isActive && AssessmentChartGate.isActive()) {
            AssessmentChartGate.deactivate();
        }

        // Reset AI session state so we don't bleed Robert's memory/conversation
        // into Maria's chart (or vice versa). The longitudinal document is
        // keyed per-patient inside AICoworker.initializeLongitudinalDocument,
        // so it will reload fresh in onPatientLoaded.
        try {
            if (typeof AICoworker !== 'undefined') {
                // Drop in-memory references that point at the old patient
                AICoworker.longitudinalDoc = null;
                AICoworker.contextAssembler = null;
                AICoworker.workingMemory = null;
                AICoworker.sessionContext = null;
                if (typeof AICoworker.resetSessionState === 'function') {
                    AICoworker.resetSessionState();
                }
                if (AICoworker._deepLearn) {
                    AICoworker._deepLearn = {
                        phase: 'idle',
                        currentLevel: 0,
                        totalLevels: 0,
                        levelBatches: [],
                        processed: new Set(),
                        processedCount: 0,
                        totalItems: 0,
                    };
                }
                if (typeof AICoworker.render === 'function') AICoworker.render();
            }
        } catch (err) {
            console.warn('Could not fully reset AI state on patient switch:', err);
        }

        try {
            await this.loadPatient(patientId);
            router.navigate('/chart-review');
            this.showToast('Patient loaded', 'success');
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
    _recentToasts: new Map(),  // Deduplication: message → timestamp

    showToast(message, type = 'info', duration = 3000) {
        const container = document.getElementById('toast-container');
        if (!container) return;

        // Deduplicate: skip if same message shown within last 5 seconds
        const now = Date.now();
        const key = type + ':' + message;
        if (this._recentToasts.has(key) && now - this._recentToasts.get(key) < 5000) {
            return; // Skip duplicate
        }
        this._recentToasts.set(key, now);

        // Clean old entries periodically
        if (this._recentToasts.size > 50) {
            for (const [k, t] of this._recentToasts) {
                if (now - t > 10000) this._recentToasts.delete(k);
            }
        }

        // Cap visible toasts at 3 to prevent stack overflow
        const existing = container.querySelectorAll('.toast');
        if (existing.length >= 3) {
            existing[0].remove();
        }

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
        <p>Generated from Acting Intern on ${new Date().toLocaleString()}</p>
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
    },

    /**
     * Clear stale simulation data from previous sessions.
     * Runs once on page load to ensure a fresh start.
     */
    _clearStaleSessionData() {
        // Clear user-submitted orders from previous sessions
        sessionStorage.removeItem('pendingOrders');

        // Clear AI-generated notes
        localStorage.removeItem('ehr-generated-notes');

        // Clear AI assistant state
        localStorage.removeItem('aiAssistantState');

        // Clear longitudinal doc (AI memory) — find and remove any patient keys
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('longitudinalDoc_')) {
                keysToRemove.push(key);
            }
        }
        keysToRemove.forEach(key => localStorage.removeItem(key));

        // Clear chat histories
        localStorage.removeItem('patient-chat-history');
        localStorage.removeItem('nurse-chat-history');

        console.log('Cleared stale session data from previous runs');
    }
};

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    // Initialize Lucide icons (converts <i data-lucide="..."> to SVG)
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
    App.init();
});

window.App = App;
