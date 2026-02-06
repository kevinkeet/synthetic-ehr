/**
 * Medications Component
 * Displays active and historical medications
 */

const Medications = {
    /**
     * Render medications view
     */
    async render() {
        const content = document.getElementById('main-content');
        content.innerHTML = '<div class="loading">Loading medications...</div>';

        try {
            const { active, historical } = await dataLoader.loadMedications();

            content.innerHTML = `
                <div class="section-header">
                    <h1 class="section-title">Medications</h1>
                    <div class="section-actions">
                        <button class="btn btn-small" onclick="App.exportSectionCSV('medications')">Export CSV</button>
                    </div>
                </div>

                <div class="tabs">
                    <div class="tab active" data-tab="active" onclick="Medications.switchTab('active')">
                        Active (${active.medications?.length || 0})
                    </div>
                    <div class="tab" data-tab="historical" onclick="Medications.switchTab('historical')">
                        Historical (${historical.medications?.length || 0})
                    </div>
                </div>

                <div id="meds-active-content" class="tab-content active">
                    ${this.renderMedsList(active.medications || [], 'active')}
                </div>

                <div id="meds-historical-content" class="tab-content">
                    ${this.renderMedsList(historical.medications || [], 'historical')}
                </div>
            `;
        } catch (error) {
            console.error('Error loading medications:', error);
            content.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">&#9888;</div>
                    <div class="empty-state-text">Error loading medications</div>
                </div>
            `;
        }
    },

    /**
     * Render medications list
     */
    renderMedsList(medications, type) {
        if (!medications || medications.length === 0) {
            return `
                <div class="empty-state">
                    <div class="empty-state-icon">&#128138;</div>
                    <div class="empty-state-text">No ${type} medications</div>
                </div>
            `;
        }

        return `
            <div class="card">
                <div class="card-body" style="padding: 0;">
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>Medication</th>
                                <th>Dose</th>
                                <th>Route</th>
                                <th>Frequency</th>
                                <th>Start Date</th>
                                ${type === 'historical' ? '<th>End Date</th>' : ''}
                                <th>Prescriber</th>
                                <th>Indication</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${medications.map(med => `
                                <tr>
                                    <td>
                                        <div class="med-name">${med.name}</div>
                                        ${med.genericName ? `<div style="font-size: 11px; color: #666;">(${med.genericName})</div>` : ''}
                                    </td>
                                    <td>${med.dose || '-'}</td>
                                    <td>${med.route || '-'}</td>
                                    <td>${med.frequency || '-'}</td>
                                    <td>${DateUtils.formatDate(med.startDate)}</td>
                                    ${type === 'historical' ? `<td>${DateUtils.formatDate(med.endDate)}</td>` : ''}
                                    <td>${med.prescriber || '-'}</td>
                                    <td style="font-size: 11px; color: #666;">${med.indication || '-'}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    },

    /**
     * Switch tabs
     */
    switchTab(tabName) {
        document.querySelectorAll('.tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.tab === tabName);
        });
        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.toggle('active', content.id === `meds-${tabName}-content`);
        });
    }
};

window.Medications = Medications;
