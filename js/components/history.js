/**
 * History Components
 * Social history, family history, and immunizations
 */

const SocialHistory = {
    /**
     * Render social history view
     */
    async render() {
        const content = document.getElementById('main-content');
        content.innerHTML = '<div class="loading">Loading social history...</div>';

        try {
            const data = await dataLoader.loadSocialHistory();

            content.innerHTML = `
                <div class="section-header">
                    <h1 class="section-title">Social History</h1>
                </div>

                <div class="card">
                    <div class="card-body">
                        ${this.renderSocialHistory(data)}
                    </div>
                </div>
            `;
        } catch (error) {
            console.error('Error loading social history:', error);
            content.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">&#9888;</div>
                    <div class="empty-state-text">Error loading social history</div>
                </div>
            `;
        }
    },

    renderSocialHistory(data) {
        const sections = [];

        if (data.tobacco) {
            sections.push(`
                <div class="widget-item" style="flex-direction: column; align-items: flex-start; padding: 12px 0;">
                    <span style="font-weight: 600; color: #2c5282;">Tobacco Use</span>
                    <div style="margin-top: 4px;">
                        <div><strong>Status:</strong> ${data.tobacco.status || 'Unknown'}</div>
                        ${data.tobacco.type ? `<div><strong>Type:</strong> ${data.tobacco.type}</div>` : ''}
                        ${data.tobacco.amount ? `<div><strong>Amount:</strong> ${data.tobacco.amount}</div>` : ''}
                        ${data.tobacco.packYears ? `<div><strong>Pack Years:</strong> ${data.tobacco.packYears}</div>` : ''}
                        ${data.tobacco.quitDate ? `<div><strong>Quit Date:</strong> ${DateUtils.formatDate(data.tobacco.quitDate)}</div>` : ''}
                    </div>
                </div>
            `);
        }

        if (data.alcohol) {
            sections.push(`
                <div class="widget-item" style="flex-direction: column; align-items: flex-start; padding: 12px 0;">
                    <span style="font-weight: 600; color: #2c5282;">Alcohol Use</span>
                    <div style="margin-top: 4px;">
                        <div><strong>Status:</strong> ${data.alcohol.status || 'Unknown'}</div>
                        ${data.alcohol.frequency ? `<div><strong>Frequency:</strong> ${data.alcohol.frequency}</div>` : ''}
                        ${data.alcohol.amount ? `<div><strong>Amount:</strong> ${data.alcohol.amount}</div>` : ''}
                    </div>
                </div>
            `);
        }

        if (data.drugs) {
            sections.push(`
                <div class="widget-item" style="flex-direction: column; align-items: flex-start; padding: 12px 0;">
                    <span style="font-weight: 600; color: #2c5282;">Substance Use</span>
                    <div style="margin-top: 4px;">
                        <div><strong>Status:</strong> ${data.drugs.status || 'Denies'}</div>
                        ${data.drugs.details ? `<div>${data.drugs.details}</div>` : ''}
                    </div>
                </div>
            `);
        }

        if (data.occupation) {
            sections.push(`
                <div class="widget-item" style="flex-direction: column; align-items: flex-start; padding: 12px 0;">
                    <span style="font-weight: 600; color: #2c5282;">Occupation</span>
                    <div style="margin-top: 4px;">
                        ${data.occupation.current ? `<div><strong>Current:</strong> ${data.occupation.current}</div>` : ''}
                        ${data.occupation.previous ? `<div><strong>Previous:</strong> ${data.occupation.previous}</div>` : ''}
                        ${data.occupation.status ? `<div><strong>Status:</strong> ${data.occupation.status}</div>` : ''}
                    </div>
                </div>
            `);
        }

        if (data.maritalStatus) {
            sections.push(`
                <div class="widget-item" style="padding: 12px 0;">
                    <span style="font-weight: 600; color: #2c5282;">Marital Status</span>
                    <span>${data.maritalStatus}</span>
                </div>
            `);
        }

        if (data.livingSituation) {
            sections.push(`
                <div class="widget-item" style="flex-direction: column; align-items: flex-start; padding: 12px 0;">
                    <span style="font-weight: 600; color: #2c5282;">Living Situation</span>
                    <div style="margin-top: 4px;">${data.livingSituation}</div>
                </div>
            `);
        }

        if (data.exercise) {
            sections.push(`
                <div class="widget-item" style="padding: 12px 0;">
                    <span style="font-weight: 600; color: #2c5282;">Exercise</span>
                    <span>${data.exercise}</span>
                </div>
            `);
        }

        if (data.diet) {
            sections.push(`
                <div class="widget-item" style="padding: 12px 0;">
                    <span style="font-weight: 600; color: #2c5282;">Diet</span>
                    <span>${data.diet}</span>
                </div>
            `);
        }

        if (data.notes) {
            sections.push(`
                <div class="widget-item" style="flex-direction: column; align-items: flex-start; padding: 12px 0;">
                    <span style="font-weight: 600; color: #2c5282;">Additional Notes</span>
                    <div style="margin-top: 4px;">${data.notes}</div>
                </div>
            `);
        }

        return sections.length > 0 ? sections.join('') : '<div class="empty-state-text">No social history documented</div>';
    }
};

const FamilyHistory = {
    /**
     * Render family history view
     */
    async render() {
        const content = document.getElementById('main-content');
        content.innerHTML = '<div class="loading">Loading family history...</div>';

        try {
            const data = await dataLoader.loadFamilyHistory();
            const history = data.familyHistory || [];

            content.innerHTML = `
                <div class="section-header">
                    <h1 class="section-title">Family History</h1>
                </div>

                ${history.length === 0 ? `
                    <div class="card">
                        <div class="card-body">
                            <div class="empty-state-text">No family history documented</div>
                        </div>
                    </div>
                ` : `
                    <div class="card">
                        <div class="card-body" style="padding: 0;">
                            <table class="data-table">
                                <thead>
                                    <tr>
                                        <th>Relationship</th>
                                        <th>Condition</th>
                                        <th>Age at Onset</th>
                                        <th>Status</th>
                                        <th>Notes</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${history.map(item => `
                                        <tr>
                                            <td style="font-weight: 500;">${item.relationship}</td>
                                            <td>${item.condition}</td>
                                            <td>${item.ageAtOnset || '-'}</td>
                                            <td>
                                                ${item.deceased ?
                                                    `<span style="color: #666;">Deceased${item.ageAtDeath ? ` (${item.ageAtDeath})` : ''}</span>` :
                                                    '<span style="color: #38a169;">Living</span>'
                                                }
                                            </td>
                                            <td style="font-size: 11px; color: #666;">${item.notes || '-'}</td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                    </div>
                `}
            `;
        } catch (error) {
            console.error('Error loading family history:', error);
            content.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">&#9888;</div>
                    <div class="empty-state-text">Error loading family history</div>
                </div>
            `;
        }
    }
};

const Immunizations = {
    /**
     * Render immunizations view
     */
    async render() {
        const content = document.getElementById('main-content');
        content.innerHTML = '<div class="loading">Loading immunizations...</div>';

        try {
            const data = await dataLoader.loadImmunizations();
            const immunizations = DateUtils.sortByDate(data.immunizations || [], 'date');

            content.innerHTML = `
                <div class="section-header">
                    <h1 class="section-title">Immunizations</h1>
                </div>

                ${immunizations.length === 0 ? `
                    <div class="card">
                        <div class="card-body">
                            <div class="empty-state-text">No immunizations documented</div>
                        </div>
                    </div>
                ` : `
                    <div class="card">
                        <div class="card-body" style="padding: 0;">
                            <table class="data-table">
                                <thead>
                                    <tr>
                                        <th>Date</th>
                                        <th>Vaccine</th>
                                        <th>Dose</th>
                                        <th>Route</th>
                                        <th>Site</th>
                                        <th>Lot Number</th>
                                        <th>Administered By</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${immunizations.map(imm => `
                                        <tr>
                                            <td>${DateUtils.formatDate(imm.date)}</td>
                                            <td style="font-weight: 500;">${imm.vaccine}</td>
                                            <td>${imm.dose || '-'}</td>
                                            <td>${imm.route || '-'}</td>
                                            <td>${imm.site || '-'}</td>
                                            <td style="font-family: var(--font-mono); font-size: 11px;">
                                                ${imm.lotNumber || '-'}
                                            </td>
                                            <td style="font-size: 12px;">${imm.administeredBy || '-'}</td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                    </div>
                `}
            `;
        } catch (error) {
            console.error('Error loading immunizations:', error);
            content.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">&#9888;</div>
                    <div class="empty-state-text">Error loading immunizations</div>
                </div>
            `;
        }
    }
};

window.SocialHistory = SocialHistory;
window.FamilyHistory = FamilyHistory;
window.Immunizations = Immunizations;
