/**
 * Imaging Component
 * Displays imaging studies and reports
 */

const Imaging = {
    studies: [],
    selectedStudy: null,

    /**
     * Render imaging view
     */
    async render() {
        const content = document.getElementById('main-content');
        content.innerHTML = '<div class="loading">Loading imaging studies...</div>';

        try {
            const data = await dataLoader.loadImaging();
            let allStudies = data.studies || [];

            // Merge in dynamic simulation imaging results
            if (typeof DynamicImaging !== 'undefined') {
                const dynamicCompleted = DynamicImaging.getCompletedStudies ? DynamicImaging.getCompletedStudies() : (DynamicImaging.completedStudies || []);
                const dynamicPending = DynamicImaging.getPendingStudies ? DynamicImaging.getPendingStudies() : (DynamicImaging.pendingStudies || []);

                const convertedCompleted = dynamicCompleted.map(s => ({
                    id: s.id || s.orderId || `dyn_${Date.now()}_${Math.random().toString(36).substr(2,5)}`,
                    modality: s.modality,
                    description: s.name || `${s.modality} ${s.bodyPart}`,
                    date: s.reportDate || s.studyDate || new Date().toISOString(),
                    status: 'Final',
                    facility: 'Simulation',
                    findings: s.report?.findings,
                    impression: s.report?.impression,
                    indication: s.indication,
                    technique: s.report?.technique,
                    comparison: s.report?.comparison,
                    recommendations: s.report?.recommendations,
                    radiologist: s.report?.radiologist || 'Simulated Read',
                    isSimulated: true
                }));

                const convertedPending = dynamicPending.map(s => ({
                    id: s.id || s.orderId || `pend_${Date.now()}_${Math.random().toString(36).substr(2,5)}`,
                    modality: s.modality,
                    description: s.name || `${s.modality} ${s.bodyPart}`,
                    date: s.orderTime ? (typeof s.orderTime === 'object' ? s.orderTime.toISOString() : s.orderTime) : new Date().toISOString(),
                    status: s.status || 'Pending',
                    facility: 'Simulation',
                    indication: s.indication,
                    isSimulated: true
                }));

                allStudies = [...convertedCompleted, ...convertedPending, ...allStudies];
            }

            this.studies = DateUtils.sortByDate(allStudies, 'date');

            content.innerHTML = `
                <div class="section-header">
                    <h1 class="section-title">Imaging</h1>
                    <div class="section-actions">
                        <span style="font-size: 12px; color: #666;">
                            ${this.studies.length} studies
                        </span>
                    </div>
                </div>

                ${this.studies.length === 0 ? `
                    <div class="empty-state">
                        <div class="empty-state-icon">&#128444;</div>
                        <div class="empty-state-text">No imaging studies found</div>
                    </div>
                ` : `
                    <div class="notes-container" style="height: auto;">
                        <div class="notes-list" style="max-height: 600px;">
                            <div class="notes-list-header">
                                <select class="filter-select" style="width: 100%;" id="imaging-type-filter" onchange="Imaging.applyFilter()">
                                    <option value="all">All Modalities</option>
                                    <option value="X-Ray">X-Ray</option>
                                    <option value="CT">CT</option>
                                    <option value="MRI">MRI</option>
                                    <option value="Ultrasound">Ultrasound</option>
                                    <option value="Echo">Echo</option>
                                    <option value="Nuclear">Nuclear Medicine</option>
                                </select>
                            </div>
                            <div class="notes-list-body" id="imaging-list">
                                ${this.renderStudiesList(this.studies)}
                            </div>
                        </div>
                        <div class="note-viewer" id="imaging-viewer" style="min-height: 400px;">
                            <div class="empty-state">
                                <div class="empty-state-icon">&#128444;</div>
                                <div class="empty-state-text">Select a study to view report</div>
                            </div>
                        </div>
                    </div>
                `}
            `;

            // Select first study if available
            if (this.studies.length > 0) {
                this.selectStudy(this.studies[0].id);
            }
        } catch (error) {
            console.error('Error loading imaging:', error);
            content.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">&#9888;</div>
                    <div class="empty-state-text">Error loading imaging studies</div>
                </div>
            `;
        }
    },

    /**
     * Render studies list
     */
    renderStudiesList(studies) {
        if (studies.length === 0) {
            return `
                <div class="empty-state">
                    <div class="empty-state-text">No studies found</div>
                </div>
            `;
        }

        return studies.map(study => `
            <div class="note-list-item ${study.id === this.selectedStudy ? 'selected' : ''}"
                 data-study-id="${study.id}"
                 onclick="Imaging.selectStudy('${study.id}')">
                <div class="note-item-header">
                    <span class="note-type">${study.modality}</span>
                    <span class="note-date">${DateUtils.formatDate(study.date)}</span>
                </div>
                <div style="font-weight: 500; margin-bottom: 4px;">${study.description}</div>
                <div class="note-author">${study.facility || ''}</div>
                ${study.status ? `
                    <div style="margin-top: 4px;">
                        <span class="problem-status ${study.status === 'Final' ? 'resolved' : 'active'}">
                            ${study.status}
                        </span>
                        ${study.isSimulated ? '<span class="sim-badge" title="Simulation result">SIM</span>' : ''}
                    </div>
                ` : ''}
                <div class="note-item-action">View Report &#8250;</div>
            </div>
        `).join('');
    },

    /**
     * Apply modality filter
     */
    applyFilter() {
        const filter = document.getElementById('imaging-type-filter')?.value || 'all';
        let filtered = this.studies;

        if (filter !== 'all') {
            filtered = this.studies.filter(s => s.modality === filter);
        }

        document.getElementById('imaging-list').innerHTML = this.renderStudiesList(filtered);
    },

    /**
     * Select and display a study
     */
    async selectStudy(studyId) {
        this.selectedStudy = studyId;

        // Update selected state
        document.querySelectorAll('.note-list-item').forEach(item => {
            item.classList.toggle('selected', item.dataset.studyId === studyId);
        });

        const viewer = document.getElementById('imaging-viewer');
        if (!viewer) return;

        viewer.innerHTML = '<div class="loading">Loading report...</div>';

        try {
            const report = await dataLoader.loadImagingReport(studyId);
            this.renderReport(report, viewer);
        } catch (error) {
            // If detailed report not found, show summary from index
            const study = this.studies.find(s => s.id === studyId);
            if (study) {
                this.renderReport(study, viewer);
            } else {
                viewer.innerHTML = `
                    <div class="empty-state">
                        <div class="empty-state-icon">&#9888;</div>
                        <div class="empty-state-text">Error loading report</div>
                    </div>
                `;
            }
        }
    },

    /**
     * Check if this study has a viewable clinical image
     */
    getImageId(report) {
        // Map certain imaging types to clinical images for simulation
        if (report.modality === 'X-Ray' && report.description && report.description.toLowerCase().includes('chest')) {
            return 'cxr-chf';
        }
        if (report.modality === 'ECG' || report.modality === 'EKG') {
            return 'ekg-afib';
        }
        return null;
    },

    /**
     * Render imaging report
     */
    renderReport(report, container) {
        const imageId = this.getImageId(report);
        const viewImageButton = imageId && typeof ClinicalImages !== 'undefined' ?
            '<button class="view-image-btn" onclick="ClinicalImages.show(\'' + imageId + '\')"><span class="btn-icon">&#128444;</span> View Image</button>' : '';

        container.innerHTML = `
            <div class="note-viewer-header">
                <div class="note-viewer-title">${report.description || report.modality}</div>
                <div class="note-viewer-meta">
                    <span><strong>Date:</strong> ${DateUtils.formatDateTime(report.date)}</span>
                    <span><strong>Modality:</strong> ${report.modality}</span>
                    ${report.radiologist ? `<span><strong>Radiologist:</strong> ${report.radiologist}</span>` : ''}
                    ${report.facility ? `<span><strong>Facility:</strong> ${report.facility}</span>` : ''}
                    ${viewImageButton}
                </div>
            </div>
            <div class="note-viewer-body">
                ${report.indication ? `
                    <div class="note-section">
                        <div class="note-section-title">Clinical Indication</div>
                        <div class="note-section-content">${report.indication}</div>
                    </div>
                ` : ''}

                ${report.technique ? `
                    <div class="note-section">
                        <div class="note-section-title">Technique</div>
                        <div class="note-section-content">${report.technique}</div>
                    </div>
                ` : ''}

                ${report.comparison ? `
                    <div class="note-section">
                        <div class="note-section-title">Comparison</div>
                        <div class="note-section-content">${report.comparison}</div>
                    </div>
                ` : ''}

                ${report.findings ? `
                    <div class="note-section">
                        <div class="note-section-title">Findings</div>
                        <div class="note-section-content">${this.formatFindings(report.findings)}</div>
                    </div>
                ` : ''}

                ${report.impression ? `
                    <div class="note-section">
                        <div class="note-section-title">Impression</div>
                        <div class="note-section-content" style="font-weight: 500;">
                            ${this.formatImpression(report.impression)}
                        </div>
                    </div>
                ` : ''}

                ${report.recommendations ? `
                    <div class="note-section">
                        <div class="note-section-title">Recommendations</div>
                        <div class="note-section-content">${this.formatRecommendations(report.recommendations)}</div>
                    </div>
                ` : ''}
            </div>
        `;
    },

    /**
     * Format findings text
     */
    formatFindings(findings) {
        if (typeof findings === 'string') {
            return findings.replace(/\n/g, '<br>');
        }
        if (Array.isArray(findings)) {
            return findings.map(f => `<p>${f}</p>`).join('');
        }
        if (typeof findings === 'object') {
            return this.formatNestedFindings(findings);
        }
        return findings;
    },

    /**
     * Format nested findings objects recursively
     */
    formatNestedFindings(obj, level = 0) {
        const indent = level > 0 ? 'margin-left: 16px;' : '';
        let html = `<div style="${indent}">`;

        for (const [key, value] of Object.entries(obj)) {
            const label = this.formatFindingLabel(key);

            if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                html += `<div style="margin-bottom: 8px;"><strong style="color: #1a5276;">${label}:</strong></div>`;
                html += this.formatNestedFindings(value, level + 1);
            } else if (Array.isArray(value)) {
                html += `<div style="margin-bottom: 8px;"><strong>${label}:</strong> ${value.join(', ')}</div>`;
            } else {
                html += `<div style="margin-bottom: 4px;"><strong>${label}:</strong> ${value}</div>`;
            }
        }

        html += '</div>';
        return html;
    },

    /**
     * Format finding key to readable label
     */
    formatFindingLabel(key) {
        // Convert camelCase to Title Case with spaces
        return key
            .replace(/([A-Z])/g, ' $1')
            .replace(/^./, str => str.toUpperCase())
            .replace(/\b(cca|ica|eca|pa|lv|rv|la|ra|ivc|mra|tid|gfr|edv|esv|lvef)\b/gi, str => str.toUpperCase())
            .trim();
    },

    /**
     * Format impression
     */
    formatImpression(impression) {
        if (typeof impression === 'string') {
            return impression.replace(/\n/g, '<br>');
        }
        if (Array.isArray(impression)) {
            return impression.map((item, index) => `${index + 1}. ${item}`).join('<br>');
        }
        return impression;
    },

    /**
     * Format recommendations
     */
    formatRecommendations(recommendations) {
        if (typeof recommendations === 'string') {
            return recommendations.replace(/\n/g, '<br>');
        }
        if (Array.isArray(recommendations)) {
            return '<ul style="margin: 0; padding-left: 20px;">' +
                recommendations.map(rec => `<li>${rec}</li>`).join('') +
                '</ul>';
        }
        return recommendations;
    }
};

window.Imaging = Imaging;
