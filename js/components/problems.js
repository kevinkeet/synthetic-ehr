/**
 * Problems Component
 * Displays active and resolved problem list
 */

const Problems = {
    /**
     * Render problems view
     */
    async render() {
        const content = document.getElementById('main-content');
        content.innerHTML = '<div class="loading">Loading problem list...</div>';

        try {
            const { active, resolved } = await dataLoader.loadProblems();

            content.innerHTML = `
                <div class="section-header">
                    <h1 class="section-title">Problem List</h1>
                    <div class="section-actions">
                        <button class="btn btn-small" onclick="App.exportSectionCSV('problems')">Export CSV</button>
                    </div>
                </div>

                <div class="tabs">
                    <div class="tab active" data-tab="active" onclick="Problems.switchTab('active')">
                        Active Problems (${active.problems?.length || 0})
                    </div>
                    <div class="tab" data-tab="resolved" onclick="Problems.switchTab('resolved')">
                        Resolved (${resolved.problems?.length || 0})
                    </div>
                </div>

                <div id="problems-active-content" class="tab-content active">
                    ${this.renderProblemsList(active.problems || [], 'active')}
                </div>

                <div id="problems-resolved-content" class="tab-content">
                    ${this.renderProblemsList(resolved.problems || [], 'resolved')}
                </div>
            `;
        } catch (error) {
            console.error('Error loading problems:', error);
            content.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">&#9888;</div>
                    <div class="empty-state-text">Error loading problem list</div>
                </div>
            `;
        }
    },

    /**
     * Render problems list
     */
    renderProblemsList(problems, status) {
        if (!problems || problems.length === 0) {
            return `
                <div class="empty-state">
                    <div class="empty-state-icon">&#9733;</div>
                    <div class="empty-state-text">No ${status} problems</div>
                </div>
            `;
        }

        // Sort by onset date (most recent first)
        const sorted = DateUtils.sortByDate([...problems], 'onsetDate');

        return `
            <div class="card">
                <div class="card-body" style="padding: 0;">
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>Problem</th>
                                <th>ICD-10</th>
                                <th>Onset Date</th>
                                ${status === 'resolved' ? '<th>Resolved Date</th>' : ''}
                                <th>Priority</th>
                                <th>Diagnosed By</th>
                                <th>Notes</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${sorted.map(problem => `
                                <tr>
                                    <td>
                                        <div style="font-weight: 600;">${problem.name}</div>
                                        ${problem.snomed ? `<div style="font-size: 10px; color: #999;">SNOMED: ${problem.snomed}</div>` : ''}
                                    </td>
                                    <td>
                                        <span class="problem-icd">${problem.icd10 || '-'}</span>
                                    </td>
                                    <td>${DateUtils.formatDate(problem.onsetDate)}</td>
                                    ${status === 'resolved' ? `<td>${DateUtils.formatDate(problem.resolvedDate)}</td>` : ''}
                                    <td>
                                        ${problem.priority ? `
                                            <span class="problem-status ${problem.priority.toLowerCase()}">
                                                ${problem.priority}
                                            </span>
                                        ` : '-'}
                                    </td>
                                    <td style="font-size: 12px;">${problem.diagnosedBy || '-'}</td>
                                    <td style="font-size: 11px; color: #666; max-width: 200px;">
                                        ${problem.notes || '-'}
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
     * Switch tabs
     */
    switchTab(tabName) {
        document.querySelectorAll('.tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.tab === tabName);
        });
        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.toggle('active', content.id === `problems-${tabName}-content`);
        });

        // Track resolved problems view for simulation scoring
        if (tabName === 'resolved' && typeof SimulationScoreTracker !== 'undefined') {
            SimulationScoreTracker.trackResolvedProblemsViewed();
        }
    }
};

window.Problems = Problems;
