/**
 * Procedures Component
 * Displays surgical and procedural history
 */

const Procedures = {
    /**
     * Render procedures view
     */
    async render() {
        const content = document.getElementById('main-content');
        content.innerHTML = '<div class="loading">Loading procedures...</div>';

        try {
            const data = await dataLoader.loadProcedures();
            const procedures = DateUtils.sortByDate(data.procedures || [], 'date');

            content.innerHTML = `
                <div class="section-header">
                    <h1 class="section-title">Procedures</h1>
                    <div class="section-actions">
                        <span style="font-size: 12px; color: #666;">
                            ${procedures.length} procedures on record
                        </span>
                    </div>
                </div>

                ${procedures.length === 0 ? `
                    <div class="card">
                        <div class="card-body" style="text-align: center; padding: 40px;">
                            <div style="font-size: 48px; margin-bottom: 16px; opacity: 0.5;">&#128137;</div>
                            <div style="font-size: 16px; color: #666;">No procedures on record</div>
                        </div>
                    </div>
                ` : `
                    <div class="card">
                        <div class="card-body" style="padding: 0;">
                            <table class="data-table">
                                <thead>
                                    <tr>
                                        <th>Date</th>
                                        <th>Procedure</th>
                                        <th>CPT Code</th>
                                        <th>Provider</th>
                                        <th>Facility</th>
                                        <th>Status</th>
                                        <th>Notes</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${procedures.map(proc => `
                                        <tr>
                                            <td>${DateUtils.formatDate(proc.date)}</td>
                                            <td>
                                                <div style="font-weight: 600;">${proc.name}</div>
                                                ${proc.laterality ? `<div style="font-size: 11px; color: #666;">${proc.laterality}</div>` : ''}
                                            </td>
                                            <td>
                                                <span class="problem-icd">${proc.cptCode || '-'}</span>
                                            </td>
                                            <td>${proc.provider || '-'}</td>
                                            <td style="font-size: 12px;">${proc.facility || '-'}</td>
                                            <td>
                                                <span class="problem-status ${proc.status === 'Completed' ? 'resolved' : 'active'}">
                                                    ${proc.status || 'Completed'}
                                                </span>
                                            </td>
                                            <td style="font-size: 11px; color: #666; max-width: 200px;">
                                                ${proc.notes || '-'}
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
            console.error('Error loading procedures:', error);
            content.innerHTML = `
                <div class="card">
                    <div class="card-body" style="text-align: center; padding: 40px;">
                        <div style="font-size: 48px; margin-bottom: 16px; opacity: 0.5;">&#128137;</div>
                        <div style="font-size: 16px; color: #666;">No procedures on record</div>
                    </div>
                </div>
            `;
        }
    }
};

window.Procedures = Procedures;
