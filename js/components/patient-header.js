/**
 * Patient Header Component
 * Displays patient info in the header banner and allergy banner
 */

const PatientHeader = {
    currentPatient: null,

    /**
     * Initialize the patient header with patient data
     */
    async init(patientId) {
        try {
            const patient = await dataLoader.loadPatient(patientId);
            this.currentPatient = patient;
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
                <span class="patient-name">${patient.lastName}, ${patient.firstName} ${patient.middleName || ''}</span>
                <div class="patient-details">
                    <span class="patient-detail-item">
                        <span class="patient-detail-label">MRN:</span>
                        <span>${patient.mrn}</span>
                    </span>
                    <span class="patient-detail-item">
                        <span class="patient-detail-label">DOB:</span>
                        <span>${dob} (${age}y)</span>
                    </span>
                    <span class="patient-detail-item">
                        <span class="patient-detail-label">Sex:</span>
                        <span>${patient.sex}</span>
                    </span>
                    ${patient.preferredLanguage ? `
                    <span class="patient-detail-item">
                        <span class="patient-detail-label">Lang:</span>
                        <span>${patient.preferredLanguage}</span>
                    </span>
                    ` : ''}
                </div>
            </div>
        `;
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
