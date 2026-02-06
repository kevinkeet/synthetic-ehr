/**
 * Vitals Component
 * Displays vitals in flowsheet format
 */

const Vitals = {
    /**
     * Render vitals flowsheet
     */
    async render() {
        const content = document.getElementById('main-content');
        content.innerHTML = '<div class="loading">Loading vitals...</div>';

        try {
            const data = await dataLoader.loadVitals();
            let vitals = data.vitals || [];

            // If simulation is running, prepend current simulated vitals
            if (SimulationEngine.isRunning || SimulationEngine.getState()) {
                const simVitals = SimulationEngine.getCurrentVitals();
                if (simVitals) {
                    simVitals.isSimulated = true;
                    vitals = [simVitals, ...vitals];
                }
            }

            // Sort by date (most recent first)
            const sorted = DateUtils.sortByDate([...vitals], 'date');

            content.innerHTML = `
                <div class="section-header">
                    <h1 class="section-title">Vital Signs</h1>
                    <div class="section-actions">
                        <span style="font-size: 12px; color: #666; margin-right: 12px;">
                            ${vitals.length} recorded measurements
                        </span>
                        <button class="btn btn-small" onclick="App.exportSectionCSV('vitals')">Export CSV</button>
                    </div>
                </div>

                ${vitals.length === 0 ? `
                    <div class="empty-state">
                        <div class="empty-state-icon">&#10084;</div>
                        <div class="empty-state-text">No vitals recorded</div>
                    </div>
                ` : `
                    <div class="card">
                        <div class="card-body" style="padding: 0; overflow-x: auto;">
                            ${this.renderFlowsheet(sorted)}
                        </div>
                    </div>
                `}
            `;
        } catch (error) {
            console.error('Error loading vitals:', error);
            content.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">&#9888;</div>
                    <div class="empty-state-text">Error loading vitals</div>
                </div>
            `;
        }
    },

    /**
     * Render vitals as flowsheet table
     */
    renderFlowsheet(vitals) {
        // Take last 20 measurements for display
        const displayVitals = vitals.slice(0, 20);

        // Helper to get BP value (handles both formats)
        const getBP = (v) => {
            if (v.bloodPressure) return v.bloodPressure;
            if (v.systolic && v.diastolic) return `${Math.round(v.systolic)}/${Math.round(v.diastolic)}`;
            return '-';
        };

        // Helper to get SpO2 (handles both field names)
        const getSpO2 = (v) => {
            return v.oxygenSaturation || v.spO2 || '-';
        };

        // Parse BP for abnormal check
        const parseBP = (bp) => {
            if (!bp || bp === '-') return { systolic: 0, diastolic: 0 };
            const parts = bp.split('/');
            return {
                systolic: parseInt(parts[0]) || 0,
                diastolic: parseInt(parts[1]) || 0
            };
        };

        return `
            <table class="vitals-table">
                <thead>
                    <tr>
                        <th>Vital Sign</th>
                        ${displayVitals.map(v => `
                            <th class="${v.isSimulated ? 'sim-vital-header' : ''}">
                                ${v.isSimulated ? '<span class="sim-badge">LIVE</span>' : ''}
                                <div>${DateUtils.formatShortDate(v.date)}</div>
                                <div style="font-weight: 400; font-size: 10px;">${DateUtils.formatTime(v.date)}</div>
                            </th>
                        `).join('')}
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>Blood Pressure (mmHg)</td>
                        ${displayVitals.map(v => {
                            const bp = getBP(v);
                            const parsed = parseBP(bp);
                            const isAbnormal = parsed.systolic > 140 || parsed.systolic < 90 || parsed.diastolic > 90 || parsed.diastolic < 60;
                            return `<td class="${isAbnormal ? 'vital-abnormal' : ''} ${v.isSimulated ? 'sim-vital' : ''}">${bp}</td>`;
                        }).join('')}
                    </tr>
                    <tr>
                        <td>Heart Rate (bpm)</td>
                        ${displayVitals.map(v => {
                            const hr = Math.round(v.heartRate) || '-';
                            const isAbnormal = v.heartRate > 100 || v.heartRate < 60;
                            return `<td class="${isAbnormal ? 'vital-abnormal' : ''} ${v.isSimulated ? 'sim-vital' : ''}">${hr}</td>`;
                        }).join('')}
                    </tr>
                    <tr>
                        <td>Respiratory Rate (/min)</td>
                        ${displayVitals.map(v => {
                            const rr = Math.round(v.respiratoryRate) || '-';
                            const isAbnormal = v.respiratoryRate > 20 || v.respiratoryRate < 12;
                            return `<td class="${isAbnormal ? 'vital-abnormal' : ''} ${v.isSimulated ? 'sim-vital' : ''}">${rr}</td>`;
                        }).join('')}
                    </tr>
                    <tr>
                        <td>Temperature (°F)</td>
                        ${displayVitals.map(v => {
                            const temp = v.temperature || '-';
                            const isAbnormal = v.temperature > 100.4 || v.temperature < 96.8;
                            return `<td class="${isAbnormal ? 'vital-abnormal' : ''} ${v.isSimulated ? 'sim-vital' : ''}">${temp}</td>`;
                        }).join('')}
                    </tr>
                    <tr>
                        <td>SpO2 (%)</td>
                        ${displayVitals.map(v => {
                            const spo2 = getSpO2(v);
                            const isAbnormal = (parseInt(spo2) || 100) < 95;
                            return `<td class="${isAbnormal ? 'vital-abnormal' : ''} ${v.isSimulated ? 'sim-vital' : ''}">${spo2}</td>`;
                        }).join('')}
                    </tr>
                    <tr>
                        <td>Weight (kg)</td>
                        ${displayVitals.map(v => {
                            const weight = v.weight ? (typeof v.weight === 'number' ? v.weight.toFixed(1) : v.weight) : '-';
                            return `<td class="${v.isSimulated ? 'sim-vital' : ''}">${weight}</td>`;
                        }).join('')}
                    </tr>
                    <tr>
                        <td>Height (cm)</td>
                        ${displayVitals.map(v => `<td>${v.height || '-'}</td>`).join('')}
                    </tr>
                    <tr>
                        <td>BMI</td>
                        ${displayVitals.map(v => {
                            if (v.weight && v.height) {
                                const bmi = (v.weight / Math.pow(v.height / 100, 2)).toFixed(1);
                                const isAbnormal = bmi < 18.5 || bmi > 30;
                                return `<td class="${isAbnormal ? 'vital-abnormal' : ''}">${bmi}</td>`;
                            }
                            return '<td>-</td>';
                        }).join('')}
                    </tr>
                    <tr>
                        <td>Pain Score (0-10)</td>
                        ${displayVitals.map(v => {
                            if (v.painScore !== undefined && v.painScore !== null) {
                                const isAbnormal = v.painScore >= 4;
                                return `<td class="${isAbnormal ? 'vital-abnormal' : ''}">${v.painScore}</td>`;
                            }
                            return '<td>-</td>';
                        }).join('')}
                    </tr>
                </tbody>
            </table>
        `;
    }
};

window.Vitals = Vitals;
