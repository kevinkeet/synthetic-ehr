/**
 * Allergies Component
 * Displays allergy list with details
 */

const Allergies = {
    /**
     * Render allergies view
     */
    async render() {
        const content = document.getElementById('main-content');
        content.innerHTML = '<div class="loading">Loading allergies...</div>';

        try {
            const data = await dataLoader.loadAllergies();
            const allergies = data.allergies || [];

            content.innerHTML = `
                <div class="section-header">
                    <h1 class="section-title">Allergies</h1>
                </div>

                ${allergies.length === 0 ? `
                    <div class="card">
                        <div class="card-body" style="text-align: center; padding: 40px;">
                            <div style="font-size: 48px; margin-bottom: 16px; opacity: 0.5;">&#9989;</div>
                            <div style="font-size: 18px; font-weight: 600; color: #38a169;">
                                No Known Drug Allergies (NKDA)
                            </div>
                            <div style="font-size: 13px; color: #666; margin-top: 8px;">
                                Patient has no documented allergies
                            </div>
                        </div>
                    </div>
                ` : `
                    <div class="card">
                        <div class="card-body" style="padding: 0;">
                            <table class="data-table">
                                <thead>
                                    <tr>
                                        <th>Substance</th>
                                        <th>Type</th>
                                        <th>Reaction</th>
                                        <th>Severity</th>
                                        <th>Onset Date</th>
                                        <th>Source</th>
                                        <th>Notes</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${allergies.map(allergy => `
                                        <tr>
                                            <td>
                                                <div style="font-weight: 600; color: #c53030;">
                                                    ${allergy.substance}
                                                </div>
                                                ${allergy.category ? `
                                                    <div style="font-size: 11px; color: #666;">
                                                        ${allergy.category}
                                                    </div>
                                                ` : ''}
                                            </td>
                                            <td>${allergy.type || 'Drug'}</td>
                                            <td>${allergy.reaction || '-'}</td>
                                            <td>
                                                ${allergy.severity ? `
                                                    <span class="problem-status ${this.getSeverityClass(allergy.severity)}">
                                                        ${allergy.severity}
                                                    </span>
                                                ` : '-'}
                                            </td>
                                            <td>${DateUtils.formatDate(allergy.onsetDate) || '-'}</td>
                                            <td style="font-size: 12px;">${allergy.source || 'Patient reported'}</td>
                                            <td style="font-size: 11px; color: #666; max-width: 200px;">
                                                ${allergy.notes || '-'}
                                            </td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                    </div>
                `}
            `;
        } catch (error) {
            console.error('Error loading allergies:', error);
            content.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">&#9888;</div>
                    <div class="empty-state-text">Error loading allergies</div>
                </div>
            `;
        }
    },

    /**
     * Get severity CSS class
     */
    getSeverityClass(severity) {
        const severityLower = (severity || '').toLowerCase();
        if (severityLower.includes('severe') || severityLower.includes('high')) {
            return 'active';
        }
        if (severityLower.includes('moderate') || severityLower.includes('medium')) {
            return 'active';
        }
        return '';
    }
};

window.Allergies = Allergies;
