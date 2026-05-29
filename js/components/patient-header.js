/**
 * Patient Header Component
 * Displays patient info in the header banner and allergy banner
 */

const PatientHeader = {
    currentPatient: null,
    patientList: null,        // cached list from data/patients/index.json
    _switcherOpen: false,

    /**
     * Initialize the patient header with patient data
     */
    async init(patientId) {
        try {
            const patient = await dataLoader.loadPatient(patientId);
            this.currentPatient = patient;
            // Pre-load patient roster for the switcher (best-effort)
            if (!this.patientList) {
                try {
                    this.patientList = await dataLoader.loadPatientIndex();
                } catch (e) {
                    console.warn('Could not preload patient roster:', e);
                    this.patientList = null;
                }
            }
            this.render(patient);
            await this.renderAllergyBanner(patientId);
        } catch (error) {
            console.error('Error loading patient header:', error);
            this.renderError();
        }
    },

    /**
     * Render patient info in the header
     */
    render(patient) {
        const banner = document.getElementById('patient-banner');
        if (!banner) return;

        const age = DateUtils.calculateAge(patient.dateOfBirth);
        const dob = DateUtils.formatDate(patient.dateOfBirth);

        banner.innerHTML = `
            <div class="patient-info-banner">
                <div class="patient-primary-row">
                    <span class="patient-name">${patient.lastName}, ${patient.firstName} ${patient.middleName || ''}</span>
                    <button class="patient-switcher-btn"
                            onclick="PatientHeader.toggleSwitcher(event)"
                            title="Switch patient"
                            aria-haspopup="true"
                            aria-expanded="${this._switcherOpen ? 'true' : 'false'}">
                        <span class="patient-switcher-chevron">&#9662;</span>
                    </button>
                    <span class="patient-mrn">MRN: ${patient.mrn}</span>
                </div>
                <div class="patient-secondary-row">
                    <span>${dob} (${age}y)</span>
                    <span class="dot-sep">&middot;</span>
                    <span>${patient.sex}</span>
                    ${patient.preferredLanguage ? `
                    <span class="dot-sep">&middot;</span>
                    <span>${patient.preferredLanguage}</span>
                    ` : ''}
                </div>
                ${this._switcherOpen ? this._renderSwitcherMenu() : ''}
            </div>
        `;
    },

    /**
     * Render the dropdown of patients
     */
    _renderSwitcherMenu() {
        const patients = (this.patientList && this.patientList.patients) || [];
        if (patients.length === 0) {
            return `<div class="patient-switcher-menu"><div class="patient-switcher-empty">No patients available</div></div>`;
        }
        const currentId = this.currentPatient && this.currentPatient.id;
        const items = patients.map(p => {
            const isCurrent = p.id === currentId;
            const ageYrs = p.dob ? DateUtils.calculateAge(p.dob) : '';
            const ageBit = ageYrs ? `${ageYrs}y ` : '';
            const sexBit = p.sex ? `${p.sex.charAt(0)} ` : '';
            const summary = p.summary || '';
            const tag = p.caseType === 'assessment' ? '<span class="patient-switcher-tag">ASSESSMENT</span>' : '';
            return `
                <button class="patient-switcher-item${isCurrent ? ' is-current' : ''}"
                        onclick="PatientHeader.handleSwitch('${p.id}')"
                        ${isCurrent ? 'disabled' : ''}>
                    <div class="patient-switcher-item-name">
                        ${p.name} ${tag}
                        ${isCurrent ? '<span class="patient-switcher-current">&#10003;</span>' : ''}
                    </div>
                    <div class="patient-switcher-item-meta">
                        <span class="patient-switcher-mrn">${p.mrn || ''}</span>
                        <span class="patient-switcher-demo">${ageBit}${sexBit}</span>
                    </div>
                    ${summary ? `<div class="patient-switcher-item-summary">${summary}</div>` : ''}
                    ${p.source ? `<div class="patient-switcher-item-source">${p.caseType === 'assessment' ? 'Test case &middot; ' : ''}${p.source}</div>` : ''}
                </button>
            `;
        }).join('');
        return `<div class="patient-switcher-menu" role="menu">${items}</div>`;
    },

    /**
     * Toggle the switcher menu open/closed
     */
    toggleSwitcher(event) {
        if (event && event.stopPropagation) event.stopPropagation();
        this._switcherOpen = !this._switcherOpen;
        if (this.currentPatient) this.render(this.currentPatient);
        if (this._switcherOpen) {
            // Close on outside click
            setTimeout(() => {
                document.addEventListener('click', this._outsideClickHandler, { once: true });
            }, 0);
        }
    },

    _outsideClickHandler() {
        if (PatientHeader._switcherOpen) {
            PatientHeader._switcherOpen = false;
            if (PatientHeader.currentPatient) PatientHeader.render(PatientHeader.currentPatient);
        }
    },

    /**
     * Switch to a different patient
     */
    async handleSwitch(patientId) {
        if (!patientId || (this.currentPatient && patientId === this.currentPatient.id)) return;
        this._switcherOpen = false;
        if (typeof App !== 'undefined' && typeof App.switchPatient === 'function') {
            await App.switchPatient(patientId);
        } else {
            console.warn('App.switchPatient not available — falling back to reload');
            window.location.reload();
        }
    },

    /**
     * Render allergy banner
     */
    async renderAllergyBanner(patientId) {
        const banner = document.getElementById('allergy-banner');
        if (!banner) return;

        try {
            const allergies = await dataLoader.loadAllergies(patientId);

            if (!allergies.allergies || allergies.allergies.length === 0) {
                banner.className = 'allergy-banner no-allergies';
                banner.innerHTML = `
                    <span class="allergy-label">Allergies:</span>
                    <span>No Known Drug Allergies (NKDA)</span>
                `;
                return;
            }

            banner.className = 'allergy-banner';
            const allergyItems = allergies.allergies
                .map(a => `
                    <span class="allergy-item">
                        <strong>${a.substance}</strong>
                        ${a.reaction ? `<span class="allergy-reaction">(${a.reaction})</span>` : ''}
                    </span>
                `)
                .join('');

            banner.innerHTML = `
                <span class="allergy-label">Allergies:</span>
                <div class="allergy-list">${allergyItems}</div>
            `;
        } catch (error) {
            console.error('Error loading allergies:', error);
            banner.className = 'allergy-banner';
            banner.innerHTML = `
                <span class="allergy-label">Allergies:</span>
                <span>Unable to load allergies</span>
            `;
        }
    },

    /**
     * Render error state
     */
    renderError() {
        const banner = document.getElementById('patient-banner');
        if (banner) {
            banner.innerHTML = `
                <div class="patient-info-banner">
                    <span class="patient-name">No patient selected</span>
                </div>
            `;
        }
    },

    /**
     * Get current patient data
     */
    getPatient() {
        return this.currentPatient;
    }
};

window.PatientHeader = PatientHeader;
