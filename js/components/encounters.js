/**
 * Encounters Component
 * Displays visit/encounter history
 */

const Encounters = {
    /**
     * Render encounters view
     */
    async render() {
        const content = document.getElementById('main-content');
        content.innerHTML = '<div class="loading">Loading encounters...</div>';

        try {
            const data = await dataLoader.loadEncounters();
            const encounters = data.encounters || [];

            // Sort by date (most recent first)
            const sorted = DateUtils.sortByDate([...encounters], 'date');

            content.innerHTML = `
                <div class="section-header">
                    <h1 class="section-title">Encounters</h1>
                    <div class="section-actions">
                        <span style="font-size: 12px; color: #666;">
                            ${encounters.length} total encounters
                        </span>
                    </div>
                </div>

                <div class="filters-bar">
                    <div class="filter-group">
                        <label class="filter-label">Type</label>
                        <select class="filter-select" id="enc-type-filter" onchange="Encounters.applyFilters()">
                            <option value="all">All Types</option>
                            <option value="Office Visit">Office Visit</option>
                            <option value="Inpatient">Inpatient</option>
                            <option value="Emergency">Emergency</option>
                            <option value="Telehealth">Telehealth</option>
                            <option value="Procedure">Procedure</option>
                        </select>
                    </div>
                    <div class="filter-group">
                        <label class="filter-label">Date Range</label>
                        <select class="filter-select" id="enc-date-filter" onchange="Encounters.applyFilters()">
                            <option value="all">All Time</option>
                            <option value="last30days">Last 30 Days</option>
                            <option value="last90days">Last 90 Days</option>
                            <option value="last1year">Last Year</option>
                            <option value="last2years">Last 2 Years</option>
                        </select>
                    </div>
                </div>

                <div id="encounters-list">
                    ${this.renderEncountersList(sorted)}
                </div>
            `;

            this.allEncounters = sorted;
        } catch (error) {
            console.error('Error loading encounters:', error);
            content.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">&#9888;</div>
                    <div class="empty-state-text">Error loading encounters</div>
                </div>
            `;
        }
    },

    allEncounters: [],

    /**
     * Render encounters list
     */
    renderEncountersList(encounters) {
        if (!encounters || encounters.length === 0) {
            return `
                <div class="empty-state">
                    <div class="empty-state-icon">&#128197;</div>
                    <div class="empty-state-text">No encounters found</div>
                </div>
            `;
        }

        return `
            <div class="card">
                <div class="card-body" style="padding: 0;">
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>Date</th>
                                <th>Type</th>
                                <th>Department</th>
                                <th>Provider</th>
                                <th>Chief Complaint / Reason</th>
                                <th>Status</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${encounters.map(enc => `
                                <tr class="clickable" onclick="Encounters.viewEncounter('${enc.id}')">
                                    <td>
                                        <div>${DateUtils.formatDate(enc.date)}</div>
                                        <div style="font-size: 11px; color: #666;">${DateUtils.formatTime(enc.date)}</div>
                                    </td>
                                    <td>
                                        <span class="${this.getTypeClass(enc.type)}">${enc.type}</span>
                                    </td>
                                    <td>${enc.department || '-'}</td>
                                    <td>${enc.provider || '-'}</td>
                                    <td style="max-width: 250px;">
                                        <div style="font-weight: 500;">${enc.chiefComplaint || enc.reason || '-'}</div>
                                        ${enc.diagnoses ? `
                                            <div style="font-size: 11px; color: #666; margin-top: 4px;">
                                                ${Array.isArray(enc.diagnoses) ? enc.diagnoses.slice(0, 2).join(', ') : enc.diagnoses}
                                            </div>
                                        ` : ''}
                                    </td>
                                    <td>
                                        <span class="problem-status ${enc.status === 'Completed' ? 'resolved' : 'active'}">
                                            ${enc.status || 'Completed'}
                                        </span>
                                    </td>
                                    <td>
                                        <button class="btn btn-small" onclick="event.stopPropagation(); Encounters.viewEncounter('${enc.id}')">
                                            View
                                        </button>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    },

    /**
     * Get CSS class for encounter type
     */
    getTypeClass(type) {
        const typeClasses = {
            'Inpatient': 'color: #c53030; font-weight: 600;',
            'Emergency': 'color: #dd6b20; font-weight: 600;',
            'Office Visit': '',
            'Telehealth': 'color: #3182ce;',
            'Procedure': 'color: #805ad5;'
        };
        return typeClasses[type] ? `style="${typeClasses[type]}"` : '';
    },

    /**
     * Apply filters
     */
    applyFilters() {
        const typeFilter = document.getElementById('enc-type-filter')?.value || 'all';
        const dateFilter = document.getElementById('enc-date-filter')?.value || 'all';

        let filtered = [...this.allEncounters];

        if (typeFilter !== 'all') {
            filtered = filtered.filter(e => e.type === typeFilter);
        }

        if (dateFilter !== 'all') {
            const { startDate } = DateUtils.getDateRange(dateFilter);
            filtered = filtered.filter(e => new Date(e.date) >= startDate);
        }

        document.getElementById('encounters-list').innerHTML = this.renderEncountersList(filtered);
    },

    /**
     * View encounter details
     */
    async viewEncounter(encounterId) {
        // For now, navigate to notes filtered by this encounter
        // In future, could show encounter detail modal
        router.navigate('/notes', { encounter: encounterId });
    }
};

window.Encounters = Encounters;
