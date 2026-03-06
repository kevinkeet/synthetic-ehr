/**
 * Pre-Visit Mode
 * A clinical prep sheet overlay that consolidates chart review into 4 focused sections:
 * 1. Recent notes by specialty
 * 2. Abnormal labs & trends
 * 3. Current medications
 * 4. Patient communications
 *
 * Opens as a full-screen overlay. All data comes from existing data loaders — no LLM required.
 */

const PreVisit = {
    isOpen: false,

    // ==================== Public API ====================

    toggle() {
        if (this.isOpen) {
            this.close();
        } else {
            this.open();
        }
    },

    async open() {
        if (this.isOpen) return;
        this.isOpen = true;

        // Show loading overlay immediately
        this._createOverlay();

        try {
            const data = await this._loadData();
            this._renderContent(data);
        } catch (err) {
            console.error('Pre-Visit: failed to load data', err);
            this._showError('Could not load chart data. Please try again.');
        }
    },

    close() {
        const overlay = document.getElementById('previsit-overlay');
        if (overlay) overlay.remove();
        this.isOpen = false;
    },

    // ==================== Data Loading ====================

    async _loadData() {
        const patientId = typeof dataLoader !== 'undefined' ? dataLoader.currentPatientId : 'PAT001';

        // Load notes index, medications, and all labs in parallel
        const [notesData, medsData, allLabs] = await Promise.all([
            dataLoader.loadNotesIndex(patientId).catch(() => ({ notes: [] })),
            dataLoader.loadMedications(patientId).catch(() => ({ active: { medications: [] }, historical: { medications: [] } })),
            dataLoader.loadAllLabs(patientId).catch(() => [])
        ]);

        const notes = notesData.notes || [];

        return {
            notesBySpecialty: this._getRecentNotesBySpecialty(notes),
            abnormalLabs: this._getAbnormalLabs(allLabs),
            medications: this._getCurrentMedications(medsData),
            communications: this._getPatientCommunications(notes),
            patientName: this._getPatientName()
        };
    },

    _getPatientName() {
        if (typeof PatientHeader !== 'undefined' && PatientHeader.currentPatient) {
            var p = PatientHeader.currentPatient;
            return (p.lastName || '') + ', ' + (p.firstName || '');
        }
        return 'Patient';
    },

    // ---- Notes by Specialty ----

    _getRecentNotesBySpecialty(notes) {
        // Group by department, take the most recent per department
        var groups = {};
        var sorted = notes.slice().sort(function(a, b) {
            return new Date(b.date) - new Date(a.date);
        });

        for (var i = 0; i < sorted.length; i++) {
            var note = sorted[i];
            var dept = note.department || 'Unknown';
            // Skip telephone encounters — they go in Communications
            if (note.type === 'Telephone Encounter') continue;
            if (!groups[dept]) {
                groups[dept] = {
                    department: dept,
                    latestDate: note.date,
                    notes: []
                };
            }
            // Keep up to 2 most recent notes per specialty
            if (groups[dept].notes.length < 2) {
                groups[dept].notes.push(note);
            }
        }

        // Sort departments by most recent note date
        return Object.values(groups).sort(function(a, b) {
            return new Date(b.latestDate) - new Date(a.latestDate);
        });
    },

    // ---- Abnormal Labs ----

    _getAbnormalLabs(allLabs) {
        // Group labs by name, get most recent value and recent history
        var labMap = {};
        // Sort by date ascending so latest overwrites
        var sorted = allLabs.slice().sort(function(a, b) {
            return new Date(a.collectedDate) - new Date(b.collectedDate);
        });

        for (var i = 0; i < sorted.length; i++) {
            var lab = sorted[i];
            var name = lab.name;
            if (!labMap[name]) {
                labMap[name] = {
                    name: name,
                    unit: lab.unit || '',
                    referenceRange: lab.referenceRange || '',
                    values: []
                };
            }
            labMap[name].values.push({
                value: lab.value,
                date: lab.collectedDate,
                panelName: lab.panelName
            });
        }

        // Filter to abnormal labs and compute trends
        var results = [];
        var labNames = Object.keys(labMap);
        for (var j = 0; j < labNames.length; j++) {
            var entry = labMap[labNames[j]];
            var vals = entry.values;
            var latest = vals[vals.length - 1];
            var flag = null;

            // Use LabUtils if available
            if (typeof LabUtils !== 'undefined') {
                flag = LabUtils.getFlag(entry.name, latest.value);
            } else {
                // Simple fallback: check reference range string
                flag = this._simpleFlag(latest.value, entry.referenceRange);
            }

            // Compute trend from last 3+ values
            var trend = this._computeTrend(vals);

            // Only include if abnormal or trending
            if (flag || (trend && trend !== 'stable')) {
                results.push({
                    name: entry.name,
                    unit: entry.unit,
                    referenceRange: entry.referenceRange,
                    latestValue: latest.value,
                    latestDate: latest.date,
                    flag: flag,
                    flagText: typeof LabUtils !== 'undefined' ? LabUtils.getFlagText(flag) : (flag || ''),
                    trend: trend,
                    recentValues: vals.slice(-5)
                });
            }
        }

        // Sort: critical first, then high/low, then trending
        var flagPriority = { 'critical-high': 0, 'critical-low': 0, 'high': 1, 'low': 1 };
        results.sort(function(a, b) {
            var pa = a.flag ? (flagPriority[a.flag] !== undefined ? flagPriority[a.flag] : 2) : 3;
            var pb = b.flag ? (flagPriority[b.flag] !== undefined ? flagPriority[b.flag] : 2) : 3;
            if (pa !== pb) return pa - pb;
            return new Date(b.latestDate) - new Date(a.latestDate);
        });

        return results;
    },

    _simpleFlag(value, refRange) {
        if (!refRange || value === null || value === undefined) return null;
        var parts = refRange.split('-').map(function(s) { return parseFloat(s.trim()); });
        if (parts.length !== 2 || isNaN(parts[0]) || isNaN(parts[1])) return null;
        var num = parseFloat(value);
        if (isNaN(num)) return null;
        if (num < parts[0]) return 'low';
        if (num > parts[1]) return 'high';
        return null;
    },

    _computeTrend(values) {
        if (values.length < 2) return null;
        var recent = values.slice(-4);
        var first = parseFloat(recent[0].value);
        var last = parseFloat(recent[recent.length - 1].value);
        if (isNaN(first) || isNaN(last)) return null;
        var pctChange = ((last - first) / Math.abs(first || 1)) * 100;
        if (pctChange > 15) return 'rising';
        if (pctChange < -15) return 'falling';
        if (Math.abs(pctChange) > 5) return pctChange > 0 ? 'rising slightly' : 'falling slightly';
        return 'stable';
    },

    // ---- Medications ----

    _getCurrentMedications(medsData) {
        var meds = (medsData.active && medsData.active.medications) || [];
        // Group by indication
        var groups = {};
        for (var i = 0; i < meds.length; i++) {
            var med = meds[i];
            var indication = med.indication || 'Other';
            if (!groups[indication]) {
                groups[indication] = { indication: indication, meds: [] };
            }
            groups[indication].meds.push(med);
        }
        // Sort groups alphabetically, but put 'Other' last
        return Object.values(groups).sort(function(a, b) {
            if (a.indication === 'Other') return 1;
            if (b.indication === 'Other') return -1;
            return a.indication.localeCompare(b.indication);
        });
    },

    // ---- Communications ----

    _getPatientCommunications(notes) {
        // Filter telephone encounters and sort by date
        return notes
            .filter(function(n) { return n.type === 'Telephone Encounter'; })
            .sort(function(a, b) { return new Date(b.date) - new Date(a.date); })
            .slice(0, 10);
    },

    // ==================== Overlay / Rendering ====================

    _createOverlay() {
        // Remove existing if any
        var existing = document.getElementById('previsit-overlay');
        if (existing) existing.remove();

        var overlay = document.createElement('div');
        overlay.className = 'previsit-overlay';
        overlay.id = 'previsit-overlay';
        overlay.innerHTML = '<div class="previsit-panel">' +
            '<div class="previsit-header">' +
                '<div class="previsit-header-left">' +
                    '<span class="previsit-icon">&#128203;</span>' +
                    '<span class="previsit-title">Pre-Visit Prep</span>' +
                '</div>' +
                '<button class="previsit-close" onclick="PreVisit.close()" title="Close">&times;</button>' +
            '</div>' +
            '<div class="previsit-body" id="previsit-body">' +
                '<div class="previsit-loading">' +
                    '<div class="previsit-loading-spinner"></div>' +
                    '<span>Loading chart data...</span>' +
                '</div>' +
            '</div>' +
        '</div>';

        document.body.appendChild(overlay);

        // Close on backdrop click
        overlay.addEventListener('click', function(e) {
            if (e.target === overlay) PreVisit.close();
        });

        // Close on Escape
        this._escHandler = function(e) {
            if (e.key === 'Escape') {
                PreVisit.close();
                document.removeEventListener('keydown', PreVisit._escHandler);
            }
        };
        document.addEventListener('keydown', this._escHandler);
    },

    _showError(msg) {
        var body = document.getElementById('previsit-body');
        if (body) {
            body.innerHTML = '<div class="previsit-error">' +
                '<span>&#9888;</span> ' + msg +
            '</div>';
        }
    },

    _renderContent(data) {
        var body = document.getElementById('previsit-body');
        if (!body) return;

        var html = '';

        // Patient name subheader
        html += '<div class="previsit-patient-bar">' +
            '<span class="previsit-patient-name">' + this._escapeHtml(data.patientName) + '</span>' +
            '<span class="previsit-date">Prepared ' + this._formatDate(new Date()) + '</span>' +
        '</div>';

        // Grid layout: notes full-width top, then 2 columns below
        html += '<div class="previsit-grid">';

        // Section 1: Recent Notes by Specialty (full width)
        html += '<div class="previsit-section previsit-section-notes">';
        html += this._renderNotesSection(data.notesBySpecialty);
        html += '</div>';

        // Section 2: Abnormal Labs (left column)
        html += '<div class="previsit-section previsit-section-labs">';
        html += this._renderLabsSection(data.abnormalLabs);
        html += '</div>';

        // Bottom right: stacked Medications + Communications
        html += '<div class="previsit-section-right-stack">';

        // Section 3: Medications
        html += '<div class="previsit-section previsit-section-meds">';
        html += this._renderMedsSection(data.medications);
        html += '</div>';

        // Section 4: Communications
        html += '<div class="previsit-section previsit-section-comms">';
        html += this._renderCommsSection(data.communications);
        html += '</div>';

        html += '</div>'; // end right stack
        html += '</div>'; // end grid

        body.innerHTML = html;
    },

    // ---- Notes Section ----

    _renderNotesSection(notesBySpecialty) {
        var count = notesBySpecialty.reduce(function(sum, g) { return sum + g.notes.length; }, 0);
        var html = '<div class="previsit-section-header">' +
            '<span class="previsit-section-icon">&#128196;</span>' +
            '<span class="previsit-section-title">Recent Notes by Specialty</span>' +
            '<span class="previsit-section-count">' + notesBySpecialty.length + ' specialties</span>' +
        '</div>';

        if (notesBySpecialty.length === 0) {
            return html + '<div class="previsit-empty">No notes found.</div>';
        }

        html += '<div class="previsit-section-body">';
        for (var i = 0; i < notesBySpecialty.length; i++) {
            var group = notesBySpecialty[i];
            var deptColor = this._getDeptColor(group.department);

            html += '<div class="previsit-note-group">';
            html += '<div class="previsit-dept-badge" style="background:' + deptColor + '">' +
                this._escapeHtml(group.department) + '</div>';

            for (var j = 0; j < group.notes.length; j++) {
                var note = group.notes[j];
                var noteDate = this._formatDate(new Date(note.date));
                var preview = (note.preview || '').substring(0, 150);
                if ((note.preview || '').length > 150) preview += '...';

                html += '<div class="previsit-note-item" data-note-id="' + note.id + '" onclick="PreVisit._toggleNoteExpand(this, \'' + note.id + '\')">';
                html += '<div class="previsit-note-meta">';
                html += '<span class="previsit-note-type">' + this._escapeHtml(note.type || '') + '</span>';
                html += '<span class="previsit-note-author">' + this._escapeHtml(note.author || '') + '</span>';
                html += '<span class="previsit-note-date">' + noteDate + '</span>';
                html += '</div>';
                html += '<div class="previsit-note-preview">' + this._escapeHtml(preview) + '</div>';
                html += '<div class="previsit-note-detail" id="note-detail-' + note.id + '" style="display:none;"></div>';
                html += '</div>';
            }
            html += '</div>';
        }
        html += '</div>';
        return html;
    },

    async _toggleNoteExpand(el, noteId) {
        var detail = document.getElementById('note-detail-' + noteId);
        if (!detail) return;

        if (detail.style.display !== 'none') {
            detail.style.display = 'none';
            el.classList.remove('expanded');
            return;
        }

        // Load full note if not yet loaded
        if (!detail.innerHTML) {
            detail.innerHTML = '<div class="previsit-note-loading">Loading note...</div>';
            detail.style.display = 'block';
            el.classList.add('expanded');

            try {
                var note = await dataLoader.loadNote(noteId);
                detail.innerHTML = this._renderNoteDetail(note);
            } catch (err) {
                detail.innerHTML = '<div class="previsit-note-loading">Could not load note.</div>';
            }
        } else {
            detail.style.display = 'block';
            el.classList.add('expanded');
        }
    },

    _renderNoteDetail(note) {
        var html = '<div class="previsit-note-full">';

        // Chief complaint
        if (note.chiefComplaint) {
            html += '<div class="previsit-note-field"><strong>CC:</strong> ' + this._escapeHtml(note.chiefComplaint) + '</div>';
        }

        // HPI
        if (note.hpi) {
            html += '<div class="previsit-note-field"><strong>HPI:</strong> ' + this._escapeHtml(note.hpi) + '</div>';
        }

        // Assessment
        if (note.assessment && note.assessment.length > 0) {
            html += '<div class="previsit-note-field"><strong>Assessment:</strong></div>';
            html += '<ul class="previsit-note-list">';
            for (var i = 0; i < note.assessment.length; i++) {
                var a = note.assessment[i];
                html += '<li>' + this._escapeHtml(a.diagnosis || a.problem || '');
                if (a.notes) html += ' — ' + this._escapeHtml(a.notes);
                html += '</li>';
            }
            html += '</ul>';
        }

        // Plan
        if (note.plan && note.plan.length > 0) {
            html += '<div class="previsit-note-field"><strong>Plan:</strong></div>';
            html += '<ul class="previsit-note-list">';
            for (var i = 0; i < note.plan.length; i++) {
                var p = note.plan[i];
                html += '<li>';
                if (p.problem) html += '<em>' + this._escapeHtml(p.problem) + ':</em> ';
                html += this._escapeHtml(p.action || p.details || '');
                html += '</li>';
            }
            html += '</ul>';
        }

        // Fallback: raw content if no structured fields
        if (!note.chiefComplaint && !note.hpi && !note.assessment && note.content) {
            html += '<div class="previsit-note-field">' + this._escapeHtml(note.content).substring(0, 500) + '</div>';
        }

        html += '</div>';
        return html;
    },

    // ---- Labs Section ----

    _renderLabsSection(abnormalLabs) {
        var html = '<div class="previsit-section-header">' +
            '<span class="previsit-section-icon">&#128300;</span>' +
            '<span class="previsit-section-title">Abnormal Labs & Trends</span>' +
            '<span class="previsit-section-count">' + abnormalLabs.length + ' results</span>' +
        '</div>';

        if (abnormalLabs.length === 0) {
            return html + '<div class="previsit-empty">All labs within normal limits.</div>';
        }

        html += '<div class="previsit-section-body">';
        html += '<div class="previsit-lab-table">';

        // Header row
        html += '<div class="previsit-lab-header-row">';
        html += '<span class="previsit-lab-col-name">Lab</span>';
        html += '<span class="previsit-lab-col-value">Value</span>';
        html += '<span class="previsit-lab-col-flag">Flag</span>';
        html += '<span class="previsit-lab-col-ref">Ref Range</span>';
        html += '<span class="previsit-lab-col-trend">Trend</span>';
        html += '</div>';

        for (var i = 0; i < abnormalLabs.length; i++) {
            var lab = abnormalLabs[i];
            var flagClass = lab.flag ? 'previsit-flag-' + lab.flag.replace('-', '') : '';
            var trendArrow = this._getTrendArrow(lab.trend);
            var trendClass = (lab.trend && lab.trend.indexOf('rising') >= 0) ? 'trend-up' :
                             (lab.trend && lab.trend.indexOf('falling') >= 0) ? 'trend-down' : '';

            html += '<div class="previsit-lab-row">';
            html += '<span class="previsit-lab-col-name">' + this._escapeHtml(lab.name) + '</span>';
            html += '<span class="previsit-lab-col-value">' + lab.latestValue + ' <small>' + this._escapeHtml(lab.unit) + '</small></span>';
            html += '<span class="previsit-lab-col-flag"><span class="previsit-lab-flag ' + flagClass + '">' + (lab.flagText || '') + '</span></span>';
            html += '<span class="previsit-lab-col-ref">' + this._escapeHtml(lab.referenceRange) + '</span>';
            html += '<span class="previsit-lab-col-trend ' + trendClass + '">';

            // Mini trend: last few values
            if (lab.recentValues && lab.recentValues.length > 1) {
                var miniVals = lab.recentValues.slice(-4).map(function(v) { return v.value; });
                html += '<span class="previsit-mini-trend">' + miniVals.join(' \u2192 ') + '</span> ';
            }
            html += trendArrow;
            html += '</span>';
            html += '</div>';
        }

        html += '</div>';
        html += '</div>';
        return html;
    },

    _getTrendArrow(trend) {
        if (!trend) return '';
        if (trend === 'rising') return '<span class="trend-arrow trend-up">\u2191</span>';
        if (trend === 'rising slightly') return '<span class="trend-arrow trend-up">\u2197</span>';
        if (trend === 'falling') return '<span class="trend-arrow trend-down">\u2193</span>';
        if (trend === 'falling slightly') return '<span class="trend-arrow trend-down">\u2198</span>';
        if (trend === 'stable') return '<span class="trend-arrow">\u2192</span>';
        return '';
    },

    // ---- Medications Section ----

    _renderMedsSection(medGroups) {
        var totalMeds = medGroups.reduce(function(sum, g) { return sum + g.meds.length; }, 0);
        var html = '<div class="previsit-section-header">' +
            '<span class="previsit-section-icon">&#128138;</span>' +
            '<span class="previsit-section-title">Current Medications</span>' +
            '<span class="previsit-section-count">' + totalMeds + ' active</span>' +
        '</div>';

        if (medGroups.length === 0) {
            return html + '<div class="previsit-empty">No active medications.</div>';
        }

        html += '<div class="previsit-section-body">';
        for (var i = 0; i < medGroups.length; i++) {
            var group = medGroups[i];
            html += '<div class="previsit-med-group">';
            html += '<div class="previsit-med-indication">' + this._escapeHtml(group.indication) + '</div>';
            for (var j = 0; j < group.meds.length; j++) {
                var med = group.meds[j];
                html += '<div class="previsit-med-row">';
                html += '<span class="previsit-med-name">' + this._escapeHtml(med.name) + '</span>';
                html += '<span class="previsit-med-detail">' +
                    this._escapeHtml((med.dose || '') + ' ' + (med.route || '') + ' ' + (med.frequency || '')) +
                '</span>';
                html += '</div>';
            }
            html += '</div>';
        }
        html += '</div>';
        return html;
    },

    // ---- Communications Section ----

    _renderCommsSection(communications) {
        var html = '<div class="previsit-section-header">' +
            '<span class="previsit-section-icon">&#128222;</span>' +
            '<span class="previsit-section-title">Patient Communications</span>' +
            '<span class="previsit-section-count">' + communications.length + ' recent</span>' +
        '</div>';

        if (communications.length === 0) {
            return html + '<div class="previsit-empty">No recent communications.</div>';
        }

        html += '<div class="previsit-section-body">';
        for (var i = 0; i < communications.length; i++) {
            var comm = communications[i];
            var commDate = this._formatDate(new Date(comm.date));
            var preview = (comm.preview || '').substring(0, 120);
            if ((comm.preview || '').length > 120) preview += '...';

            html += '<div class="previsit-comm-item">';
            html += '<div class="previsit-comm-header">';
            html += '<span class="previsit-comm-date">' + commDate + '</span>';
            html += '<span class="previsit-comm-author">' + this._escapeHtml(comm.author || '') + '</span>';
            html += '</div>';
            html += '<div class="previsit-comm-preview">' + this._escapeHtml(preview) + '</div>';
            html += '</div>';
        }
        html += '</div>';
        return html;
    },

    // ==================== Utilities ====================

    _escapeHtml(str) {
        if (!str) return '';
        var div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    },

    _formatDate(date) {
        if (!date || isNaN(date.getTime())) return '';
        var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        return months[date.getMonth()] + ' ' + date.getDate() + ', ' + date.getFullYear();
    },

    _getDeptColor(department) {
        var colors = {
            'Cardiology': '#e53e3e',
            'Endocrinology': '#dd6b20',
            'Nephrology': '#38a169',
            'Pulmonology': '#3182ce',
            'Primary Care': '#2b6cb0',
            'Internal Medicine': '#4a5568',
            'Gastroenterology': '#805ad5',
            'Urology': '#d69e2e',
            'Radiology': '#718096',
            'Emergency Medicine': '#c53030',
            'Hospital Medicine': '#2c5282',
            'Surgery': '#b83280'
        };
        return colors[department] || '#4a5568';
    }
};

window.PreVisit = PreVisit;
