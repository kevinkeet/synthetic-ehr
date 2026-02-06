/**
 * Chart Review Component
 * Dashboard view with summary of patient data
 */

const ChartReview = {
    /**
     * Render the chart review dashboard
     */
    async render() {
        const content = document.getElementById('main-content');
        content.innerHTML = '<div class="loading">Loading chart review...</div>';

        try {
            // Load all summary data in parallel
            const [problems, medications, recentLabs, vitals, allergies] = await Promise.all([
                dataLoader.loadActiveProblems().catch(() => ({ problems: [] })),
                dataLoader.loadActiveMedications().catch(() => ({ medications: [] })),
                this.getRecentLabs().catch(() => []),
                dataLoader.loadVitals().catch(() => ({ vitals: [] })),
                dataLoader.loadAllergies().catch(() => ({ allergies: [] }))
            ]);

            content.innerHTML = `
                <div class="section-header">
                    <h1 class="section-title">Chart Review</h1>
                    <div class="section-actions">
                        <button class="btn" onclick="App.exportChart()">Export Chart</button>
                        <button class="btn" onclick="App.exportSummary()">Export JSON</button>
                        <button class="btn" onclick="window.print()">Print</button>
                    </div>
                </div>

                <div class="dashboard-grid">
                    ${this.renderProblemsWidget(problems)}
                    ${this.renderMedicationsWidget(medications)}
                    ${this.renderRecentLabsWidget(recentLabs)}
                    ${this.renderVitalsWidget(vitals)}
                    ${this.renderAllergiesWidget(allergies)}
                    ${this.renderDemographicsWidget()}
                </div>
            `;
        } catch (error) {
            console.error('Error rendering chart review:', error);
            content.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">&#9888;</div>
                    <div class="empty-state-text">Error loading chart review</div>
                </div>
            `;
        }
    },

    /**
     * Get recent abnormal labs
     */
    async getRecentLabs() {
        const labs = await dataLoader.loadAllLabs();
        // Get most recent results, prioritizing abnormal
        const sorted = DateUtils.sortByDate(labs, 'collectedDate');
        const recent = sorted.slice(0, 50);

        // Separate abnormal and normal
        const abnormal = recent.filter(lab => LabUtils.getFlag(lab.name, lab.value));
        const normal = recent.filter(lab => !LabUtils.getFlag(lab.name, lab.value));

        // Return abnormal first, then fill with normal up to 10 items
        return [...abnormal.slice(0, 10), ...normal.slice(0, Math.max(0, 10 - abnormal.length))];
    },

    /**
     * Render active problems widget
     */
    renderProblemsWidget(data) {
        const problems = data.problems || [];

        return `
            <div class="dashboard-widget">
                <div class="widget-header">
                    <span class="widget-title">Active Problems (${problems.length})</span>
                    <a href="#/problems" class="btn btn-small">View All</a>
                </div>
                <div class="widget-body">
                    ${problems.length === 0 ? `
                        <div class="empty-state">
                            <div class="empty-state-text">No active problems</div>
                        </div>
                    ` : problems.slice(0, 8).map(p => `
                        <div class="problem-item">
                            <div class="problem-name">${p.name}</div>
                            <div class="problem-meta">
                                <span class="problem-icd">${p.icd10 || ''}</span>
                                <span>Onset: ${DateUtils.formatDate(p.onsetDate)}</span>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    },

    /**
     * Render medications widget
     */
    renderMedicationsWidget(data) {
        const medications = data.medications || [];

        return `
            <div class="dashboard-widget">
                <div class="widget-header">
                    <span class="widget-title">Active Medications (${medications.length})</span>
                    <a href="#/medications" class="btn btn-small">View All</a>
                </div>
                <div class="widget-body">
                    ${medications.length === 0 ? `
                        <div class="empty-state">
                            <div class="empty-state-text">No active medications</div>
                        </div>
                    ` : medications.slice(0, 8).map(m => `
                        <div class="med-item">
                            <div class="med-name">${m.name}</div>
                            <div class="med-details">${m.dose} ${m.route} ${m.frequency}</div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    },

    /**
     * Render recent labs widget
     */
    renderRecentLabsWidget(labs) {
        return `
            <div class="dashboard-widget">
                <div class="widget-header">
                    <span class="widget-title">Recent Results</span>
                    <a href="#/labs" class="btn btn-small">View All</a>
                </div>
                <div class="widget-body">
                    ${labs.length === 0 ? `
                        <div class="empty-state">
                            <div class="empty-state-text">No recent lab results</div>
                        </div>
                    ` : `
                        <table class="data-table" style="margin: -12px -16px; width: calc(100% + 32px);">
                            <thead>
                                <tr>
                                    <th>Test</th>
                                    <th>Result</th>
                                    <th>Date</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${labs.slice(0, 10).map(lab => {
                                    const flag = LabUtils.getFlag(lab.name, lab.value);
                                    const valueClass = LabUtils.getValueClass(flag);
                                    const flagText = LabUtils.getFlagText(flag);
                                    const flagClass = LabUtils.getFlagClass(flag);

                                    return `
                                        <tr>
                                            <td>${lab.name}</td>
                                            <td>
                                                <span class="lab-value ${valueClass}">${lab.value}</span>
                                                <span class="reference-range">${lab.unit || ''}</span>
                                                ${flag ? `<span class="lab-flag ${flagClass}">${flagText}</span>` : ''}
                                            </td>
                                            <td>${DateUtils.formatShortDate(lab.collectedDate)}</td>
                                        </tr>
                                    `;
                                }).join('')}
                            </tbody>
                        </table>
                    `}
                </div>
            </div>
        `;
    },

    /**
     * Render vitals widget
     */
    renderVitalsWidget(data) {
        const vitals = data.vitals || [];
        const mostRecent = vitals[0];

        return `
            <div class="dashboard-widget">
                <div class="widget-header">
                    <span class="widget-title">Latest Vitals</span>
                    <a href="#/vitals" class="btn btn-small">Flowsheet</a>
                </div>
                <div class="widget-body">
                    ${!mostRecent ? `
                        <div class="empty-state">
                            <div class="empty-state-text">No vitals recorded</div>
                        </div>
                    ` : `
                        <div style="font-size: 11px; color: #666; margin-bottom: 12px;">
                            ${DateUtils.formatDateTime(mostRecent.date)}
                        </div>
                        <div class="widget-item">
                            <span class="widget-item-label">Blood Pressure</span>
                            <span class="widget-item-value">${mostRecent.systolic}/${mostRecent.diastolic} mmHg</span>
                        </div>
                        <div class="widget-item">
                            <span class="widget-item-label">Heart Rate</span>
                            <span class="widget-item-value">${mostRecent.heartRate} bpm</span>
                        </div>
                        <div class="widget-item">
                            <span class="widget-item-label">Respiratory Rate</span>
                            <span class="widget-item-value">${mostRecent.respiratoryRate} /min</span>
                        </div>
                        <div class="widget-item">
                            <span class="widget-item-label">Temperature</span>
                            <span class="widget-item-value">${mostRecent.temperature} °F</span>
                        </div>
                        <div class="widget-item">
                            <span class="widget-item-label">SpO2</span>
                            <span class="widget-item-value">${mostRecent.spO2}%</span>
                        </div>
                        ${mostRecent.weight ? `
                        <div class="widget-item">
                            <span class="widget-item-label">Weight</span>
                            <span class="widget-item-value">${mostRecent.weight} kg</span>
                        </div>
                        ` : ''}
                    `}
                </div>
            </div>
        `;
    },

    /**
     * Render allergies widget
     */
    renderAllergiesWidget(data) {
        const allergies = data.allergies || [];

        return `
            <div class="dashboard-widget">
                <div class="widget-header">
                    <span class="widget-title">Allergies</span>
                    <a href="#/allergies" class="btn btn-small">View All</a>
                </div>
                <div class="widget-body">
                    ${allergies.length === 0 ? `
                        <div style="color: #38a169; font-weight: 600;">
                            No Known Drug Allergies (NKDA)
                        </div>
                    ` : allergies.map(a => `
                        <div class="widget-item" style="flex-direction: column; align-items: flex-start;">
                            <span style="font-weight: 600; color: #c53030;">${a.substance}</span>
                            ${a.reaction ? `<span style="font-size: 11px; color: #666;">Reaction: ${a.reaction}</span>` : ''}
                            ${a.severity ? `<span style="font-size: 11px; color: #666;">Severity: ${a.severity}</span>` : ''}
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    },

    /**
     * Render demographics widget
     */
    renderDemographicsWidget() {
        const patient = PatientHeader.getPatient();
        if (!patient) return '';

        return `
            <div class="dashboard-widget">
                <div class="widget-header">
                    <span class="widget-title">Demographics</span>
                </div>
                <div class="widget-body">
                    <div class="widget-item">
                        <span class="widget-item-label">Full Name</span>
                        <span class="widget-item-value">${patient.firstName} ${patient.middleName || ''} ${patient.lastName}</span>
                    </div>
                    <div class="widget-item">
                        <span class="widget-item-label">Date of Birth</span>
                        <span class="widget-item-value">${DateUtils.formatDate(patient.dateOfBirth)}</span>
                    </div>
                    <div class="widget-item">
                        <span class="widget-item-label">Age</span>
                        <span class="widget-item-value">${DateUtils.calculateAge(patient.dateOfBirth)} years</span>
                    </div>
                    <div class="widget-item">
                        <span class="widget-item-label">Sex</span>
                        <span class="widget-item-value">${patient.sex}</span>
                    </div>
                    <div class="widget-item">
                        <span class="widget-item-label">MRN</span>
                        <span class="widget-item-value">${patient.mrn}</span>
                    </div>
                    ${patient.ssn ? `
                    <div class="widget-item">
                        <span class="widget-item-label">SSN</span>
                        <span class="widget-item-value">***-**-${patient.ssn.slice(-4)}</span>
                    </div>
                    ` : ''}
                    ${patient.phone ? `
                    <div class="widget-item">
                        <span class="widget-item-label">Phone</span>
                        <span class="widget-item-value">${patient.phone}</span>
                    </div>
                    ` : ''}
                    ${patient.address ? `
                    <div class="widget-item">
                        <span class="widget-item-label">Address</span>
                        <span class="widget-item-value">${patient.address.street}, ${patient.address.city}, ${patient.address.state} ${patient.address.zip}</span>
                    </div>
                    ` : ''}
                    ${patient.insurance ? `
                    <div class="widget-item">
                        <span class="widget-item-label">Insurance</span>
                        <span class="widget-item-value">${patient.insurance.name}</span>
                    </div>
                    ` : ''}
                </div>
            </div>
        `;
    }
};

window.ChartReview = ChartReview;
