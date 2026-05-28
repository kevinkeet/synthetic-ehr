/**
 * Navigation Component
 * Handles sidebar navigation and patient search
 */

const Navigation = {
    /**
     * Initialize navigation
     */
    init() {
        this.setupNavClickHandlers();
        this.setupPatientSearch();
    },

    /**
     * Setup click handlers for nav items
     */
    setupNavClickHandlers() {
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                // Update active state
                document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
                item.classList.add('active');
            });
        });
    },

    /**
     * Setup patient picker (dropdown of all patients).
     * Populates a <select id="patient-select"> from the patient index and
     * wires its change event to App.switchPatient(). Replaces the older
     * type-to-search input that lived here.
     */
    setupPatientSearch() {
        this.populatePatientSelect();
    },

    async populatePatientSelect() {
        const select = document.getElementById('patient-select');
        if (!select) return;
        try {
            const index = await dataLoader.loadPatientIndex();
            const patients = (index && index.patients) || [];

            // Build options sorted alphabetically by display label, with a
            // case-marker prefix so the assessment cases visually group at the
            // top.
            const rows = patients.map((p) => {
                const ageStr = p.dob ? this._ageFromDob(p.dob) : '?';
                const isCase = p.caseType === 'assessment';
                return {
                    id: p.id,
                    label: `${isCase ? 'CASE — ' : ''}${p.name} · ${ageStr}y · MRN ${p.mrn}`,
                    isCase,
                };
            });
            rows.sort((a, b) => {
                if (a.isCase !== b.isCase) return a.isCase ? -1 : 1;
                return a.label.localeCompare(b.label);
            });

            const currentId = (typeof App !== 'undefined') ? App.defaultPatientId : null;
            select.innerHTML = rows.map((r) => `
                <option value="${r.id}"${r.id === currentId ? ' selected' : ''}>${r.label}</option>
            `).join('');

            // Wire change → switchPatient
            select.addEventListener('change', (e) => {
                const newId = e.target.value;
                if (newId && typeof App !== 'undefined' && newId !== App.defaultPatientId) {
                    App.switchPatient(newId);
                }
            });

            // Keep dropdown in sync when patient changes via other paths
            window.addEventListener('patient:loaded', (e) => {
                const id = e.detail && e.detail.patientId;
                if (id && select.value !== id) select.value = id;
            });
        } catch (err) {
            console.error('Failed to populate patient picker:', err);
        }
    },

    _ageFromDob(dob) {
        try {
            const d = new Date(dob);
            const now = new Date();
            let age = now.getFullYear() - d.getFullYear();
            const m = now.getMonth() - d.getMonth();
            if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
            return age;
        } catch (e) { return '?'; }
    },

    /**
     * Update active nav item
     */
    setActiveNav(section) {
        document.querySelectorAll('.nav-item').forEach(item => {
            const itemSection = item.dataset.section;
            item.classList.toggle('active', itemSection === section);
        });
    }
};

window.Navigation = Navigation;
