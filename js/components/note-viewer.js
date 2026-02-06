/**
 * Note Viewer Component
 * Displays full clinical note content with formatting
 */

const NoteViewer = {
    /**
     * Render a note in the viewer container
     */
    render(note, container) {
        if (!note || !container) return;

        container.innerHTML = `
            <div class="note-viewer-header">
                <div class="note-viewer-title">${note.type}</div>
                <div class="note-viewer-meta">
                    <span><strong>Date:</strong> ${DateUtils.formatDateTime(note.date)}</span>
                    <span><strong>Author:</strong> ${note.author}</span>
                    ${note.department ? `<span><strong>Dept:</strong> ${note.department}</span>` : ''}
                    ${note.encounter ? `<span><strong>Encounter:</strong> ${note.encounter}</span>` : ''}
                </div>
            </div>
            <div class="note-viewer-body">
                ${this.formatNoteContent(note)}
            </div>
        `;
    },

    /**
     * Format note content based on note type and structure
     */
    formatNoteContent(note) {
        // If note has structured sections
        if (note.sections && Array.isArray(note.sections)) {
            return note.sections.map(section => `
                <div class="note-section">
                    <div class="note-section-title">${section.title}</div>
                    <div class="note-section-content">${this.formatText(section.content)}</div>
                </div>
            `).join('');
        }

        // If note has SOAP format
        if (note.subjective || note.objective || note.assessment || note.plan) {
            return this.formatSOAPNote(note);
        }

        // If note has simple content
        if (note.content) {
            return `<div class="note-section-content">${this.formatText(note.content)}</div>`;
        }

        // If note has body
        if (note.body) {
            return `<div class="note-section-content">${this.formatText(note.body)}</div>`;
        }

        return '<div class="empty-state-text">No content available</div>';
    },

    /**
     * Format SOAP note
     */
    formatSOAPNote(note) {
        let html = '';

        if (note.chiefComplaint) {
            html += `
                <div class="note-section">
                    <div class="note-section-title">Chief Complaint</div>
                    <div class="note-section-content">${this.formatText(note.chiefComplaint)}</div>
                </div>
            `;
        }

        if (note.subjective) {
            html += `
                <div class="note-section">
                    <div class="note-section-title">Subjective</div>
                    <div class="note-section-content">${this.formatText(note.subjective)}</div>
                </div>
            `;
        }

        if (note.hpi) {
            html += `
                <div class="note-section">
                    <div class="note-section-title">History of Present Illness</div>
                    <div class="note-section-content">${this.formatText(note.hpi)}</div>
                </div>
            `;
        }

        if (note.reviewOfSystems) {
            html += `
                <div class="note-section">
                    <div class="note-section-title">Review of Systems</div>
                    <div class="note-section-content">${this.formatROS(note.reviewOfSystems)}</div>
                </div>
            `;
        }

        if (note.objective) {
            html += `
                <div class="note-section">
                    <div class="note-section-title">Objective</div>
                    <div class="note-section-content">${this.formatText(note.objective)}</div>
                </div>
            `;
        }

        if (note.physicalExam) {
            html += `
                <div class="note-section">
                    <div class="note-section-title">Physical Examination</div>
                    <div class="note-section-content">${this.formatPhysicalExam(note.physicalExam)}</div>
                </div>
            `;
        }

        if (note.vitals) {
            html += `
                <div class="note-section">
                    <div class="note-section-title">Vital Signs</div>
                    <div class="note-section-content">${this.formatVitals(note.vitals)}</div>
                </div>
            `;
        }

        if (note.assessment) {
            html += `
                <div class="note-section">
                    <div class="note-section-title">Assessment</div>
                    <div class="note-section-content">${this.formatAssessment(note.assessment)}</div>
                </div>
            `;
        }

        if (note.plan) {
            html += `
                <div class="note-section">
                    <div class="note-section-title">Plan</div>
                    <div class="note-section-content">${this.formatPlan(note.plan)}</div>
                </div>
            `;
        }

        if (note.attestation) {
            html += `
                <div class="note-section" style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #e2e8f0;">
                    <div class="note-section-content" style="font-style: italic; color: #666;">
                        ${this.formatText(note.attestation)}
                    </div>
                </div>
            `;
        }

        return html;
    },

    /**
     * Format text content (handle newlines, etc.)
     */
    formatText(text) {
        if (!text) return '';
        if (typeof text !== 'string') return JSON.stringify(text);

        // Escape HTML
        const escaped = text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

        // Convert newlines to <br>
        return escaped.replace(/\n/g, '<br>');
    },

    /**
     * Format Review of Systems
     */
    formatROS(ros) {
        if (typeof ros === 'string') {
            return this.formatText(ros);
        }

        if (typeof ros === 'object') {
            return Object.entries(ros).map(([system, findings]) => {
                return `<strong>${system}:</strong> ${findings}`;
            }).join('<br>');
        }

        return '';
    },

    /**
     * Format Physical Exam
     */
    formatPhysicalExam(exam) {
        if (typeof exam === 'string') {
            return this.formatText(exam);
        }

        if (typeof exam === 'object') {
            return Object.entries(exam).map(([system, findings]) => {
                return `<strong>${system}:</strong> ${findings}`;
            }).join('<br>');
        }

        return '';
    },

    /**
     * Format Vitals
     */
    formatVitals(vitals) {
        if (typeof vitals === 'string') {
            return this.formatText(vitals);
        }

        if (typeof vitals === 'object') {
            const parts = [];
            if (vitals.bp || vitals.bloodPressure) parts.push(`BP: ${vitals.bp || vitals.bloodPressure}`);
            if (vitals.hr || vitals.heartRate) parts.push(`HR: ${vitals.hr || vitals.heartRate}`);
            if (vitals.rr || vitals.respiratoryRate) parts.push(`RR: ${vitals.rr || vitals.respiratoryRate}`);
            if (vitals.temp || vitals.temperature) parts.push(`Temp: ${vitals.temp || vitals.temperature}`);
            if (vitals.spo2 || vitals.oxygenSaturation) parts.push(`SpO2: ${vitals.spo2 || vitals.oxygenSaturation}`);
            if (vitals.weight) parts.push(`Weight: ${vitals.weight}`);
            if (vitals.height) parts.push(`Height: ${vitals.height}`);
            return parts.join(' | ');
        }

        return '';
    },

    /**
     * Format Assessment (may be array of diagnoses)
     */
    formatAssessment(assessment) {
        if (typeof assessment === 'string') {
            return this.formatText(assessment);
        }

        if (Array.isArray(assessment)) {
            return assessment.map((item, index) => {
                if (typeof item === 'string') {
                    return `${index + 1}. ${item}`;
                }
                if (typeof item === 'object') {
                    return `${index + 1}. ${item.diagnosis || item.name}${item.icd10 ? ` (${item.icd10})` : ''}`;
                }
                return '';
            }).join('<br>');
        }

        return '';
    },

    /**
     * Format Plan (may be array or object with categories)
     */
    formatPlan(plan) {
        if (typeof plan === 'string') {
            return this.formatText(plan);
        }

        if (Array.isArray(plan)) {
            return plan.map((item, index) => {
                if (typeof item === 'string') {
                    return `${index + 1}. ${item}`;
                }
                if (typeof item === 'object') {
                    let text = `${index + 1}. `;
                    if (item.problem) text += `<strong>${item.problem}:</strong> `;
                    text += item.action || item.plan || '';
                    return text;
                }
                return '';
            }).join('<br>');
        }

        if (typeof plan === 'object') {
            return Object.entries(plan).map(([category, items]) => {
                let html = `<strong>${category}:</strong><br>`;
                if (Array.isArray(items)) {
                    html += items.map(item => `  - ${item}`).join('<br>');
                } else {
                    html += `  ${items}`;
                }
                return html;
            }).join('<br><br>');
        }

        return '';
    }
};

window.NoteViewer = NoteViewer;
