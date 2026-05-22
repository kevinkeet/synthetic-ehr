/**
 * AssessmentChartGate — restricts chart visibility during an active assessment
 * by filtering dataLoader's outputs to entries on/before the AP's anchorDate.
 *
 * Monkey-patches the global `dataLoader` instance so BOTH the chart UI and the
 * AI assistant's tools (which read through dataLoader) see the same gated view.
 *
 * Usage:
 *   AssessmentChartGate.activate({ caseId, anchorDateIso });
 *   ...resident interacts with chart and AI...
 *   AssessmentChartGate.advance(newAnchorDateIso);   // move forward to next AP
 *   AssessmentChartGate.deactivate();                // restore originals
 *
 * The gate only applies to the case it was activated for; if the user switches
 * patients, the gate is automatically deactivated.
 */

const AssessmentChartGate = (() => {
    let _active = false;
    let _caseId = null;
    let _anchorMs = null;   // epoch ms cutoff inclusive
    let _originals = null;  // map: methodName → original dataLoader method
    let _visibleSections = new Set();  // for logger: which sections were viewed

    const LOG = (...args) => console.log('⏳ ChartGate', ...args);

    // ── helpers ────────────────────────────────────────────────────────

    /**
     * Pull a usable date string out of an arbitrary chart item.
     * We check common field names in priority order.
     */
    function _itemDate(item) {
        if (!item || typeof item !== 'object') return null;
        return (
            item.date ||
            item.collectedDate ||
            item.resultedDate ||
            item.studyDate ||
            item.orderDate ||
            item.performedDate ||
            item.encounterDate ||
            item.startDate ||  // medications — only show if started ≤ anchor
            null
        );
    }

    /**
     * True if item's date is on/before the gate's anchor.
     * Items without any recognizable date pass through (we don't want to
     * accidentally hide static documents like demographics or family history).
     */
    function _passesGate(item) {
        if (!_active) return true;
        const d = _itemDate(item);
        if (!d) return true;
        const ms = Date.parse(d);
        if (Number.isNaN(ms)) return true;
        return ms <= _anchorMs;
    }

    function _filterArray(arr) {
        if (!Array.isArray(arr)) return arr;
        return arr.filter(_passesGate);
    }

    function _markSection(name) {
        _visibleSections.add(name);
    }

    // ── activation ─────────────────────────────────────────────────────

    function activate({ caseId, anchorDateIso }) {
        if (!anchorDateIso) {
            console.warn('ChartGate.activate called without anchorDateIso');
            return;
        }
        _caseId = caseId || null;
        _anchorMs = Date.parse(anchorDateIso);
        if (Number.isNaN(_anchorMs)) {
            console.warn('ChartGate.activate: invalid anchorDateIso', anchorDateIso);
            return;
        }

        if (typeof dataLoader === 'undefined') {
            console.warn('ChartGate.activate: dataLoader not available');
            return;
        }

        // Clear any cached, un-gated results from prior loads.
        try { dataLoader.clearCache(); } catch (e) { /* ignore */ }

        if (!_originals) _installPatches();
        _active = true;
        LOG('Activated for', caseId, '@', anchorDateIso);
    }

    function advance(newAnchorDateIso) {
        if (!_active) return activate({ caseId: _caseId, anchorDateIso: newAnchorDateIso });
        const ms = Date.parse(newAnchorDateIso);
        if (Number.isNaN(ms)) {
            console.warn('ChartGate.advance: invalid date', newAnchorDateIso);
            return;
        }
        _anchorMs = ms;
        try { dataLoader.clearCache(); } catch (e) { /* ignore */ }
        LOG('Advanced to', newAnchorDateIso);
    }

    function deactivate() {
        if (!_active) return;
        _restorePatches();
        _active = false;
        _caseId = null;
        _anchorMs = null;
        try { dataLoader.clearCache(); } catch (e) { /* ignore */ }
        LOG('Deactivated');
    }

    function isActive() { return _active; }
    function getAnchor() { return _anchorMs ? new Date(_anchorMs).toISOString() : null; }
    function getCaseId() { return _caseId; }

    function getVisibleSections() {
        return Array.from(_visibleSections);
    }

    function resetVisibleSections() {
        _visibleSections = new Set();
    }

    // ── patches ────────────────────────────────────────────────────────

    function _installPatches() {
        _originals = {};

        const wrap = (name, transform) => {
            _originals[name] = dataLoader[name].bind(dataLoader);
            dataLoader[name] = async function (...args) {
                const result = await _originals[name](...args);
                return transform(result);
            };
        };

        // Notes
        wrap('loadNotesIndex', (data) => {
            _markSection('notes');
            if (!data) return data;
            return { ...data, notes: _filterArray(data.notes) };
        });
        wrap('loadNote', (data) => {
            _markSection('notes');
            if (!data) return data;
            // Hide note content for future notes by throwing.
            if (!_passesGate(data)) {
                const err = new Error('Note not yet available at this point in the case timeline.');
                err.code = 'GATED';
                throw err;
            }
            return data;
        });

        // Labs (index + panel)
        wrap('loadLabsIndex', (data) => {
            _markSection('labs');
            if (!data) return data;
            return { ...data, panels: _filterArray(data.panels) };
        });
        wrap('loadLabPanel', (data) => {
            _markSection('labs');
            if (!data) return data;
            if (!_passesGate(data)) {
                const err = new Error('Lab panel not yet available at this point in the case timeline.');
                err.code = 'GATED';
                throw err;
            }
            return data;
        });
        // loadAllLabs aggregates panels — the panel calls above will filter
        // upstream via loadLabsIndex(), so just re-mark the section.
        wrap('loadAllLabs', (data) => {
            _markSection('labs');
            if (!Array.isArray(data)) return data;
            return data.filter(_passesGate);
        });

        // Encounters
        wrap('loadEncounters', (data) => {
            _markSection('encounters');
            if (!data) return data;
            return { ...data, encounters: _filterArray(data.encounters) };
        });
        wrap('loadEncounter', (data) => {
            _markSection('encounters');
            if (!data) return data;
            if (!_passesGate(data)) {
                const err = new Error('Encounter not yet available at this point in the case timeline.');
                err.code = 'GATED';
                throw err;
            }
            return data;
        });

        // Imaging
        wrap('loadImaging', (data) => {
            _markSection('imaging');
            if (!data) return data;
            return { ...data, studies: _filterArray(data.studies) };
        });
        wrap('loadImagingReport', (data) => {
            _markSection('imaging');
            if (!data) return data;
            if (!_passesGate(data)) {
                const err = new Error('Imaging report not yet available at this point in the case timeline.');
                err.code = 'GATED';
                throw err;
            }
            return data;
        });

        // Vitals
        wrap('loadVitals', (data) => {
            _markSection('vitals');
            if (!data) return data;
            return { ...data, vitals: _filterArray(data.vitals) };
        });

        // Procedures
        wrap('loadProcedures', (data) => {
            _markSection('procedures');
            if (!data) return data;
            return { ...data, procedures: _filterArray(data.procedures) };
        });

        // Orders — filter by orderDate
        wrap('loadOrders', (data) => {
            _markSection('orders');
            if (!data) return data;
            return {
                ...data,
                active: _filterArray(data.active),
                completed: _filterArray(data.completed),
                discontinued: _filterArray(data.discontinued),
            };
        });

        // Medications — gate by startDate; show active meds whose course
        // had started by anchor date. (Static lists like allergies, demographics,
        // social/family history, immunizations, problems are NOT gated since
        // they're treated as standing chart documents the resident is given.)
        wrap('loadActiveMedications', (data) => {
            _markSection('medications');
            if (!data) return data;
            return { ...data, medications: _filterArray(data.medications) };
        });
        wrap('loadMedications', (data) => {
            _markSection('medications');
            if (!data) return data;
            const filter = (sub) => sub ? { ...sub, medications: _filterArray(sub.medications) } : sub;
            return {
                ...data,
                active: filter(data.active),
                historical: filter(data.historical),
            };
        });

        // Problems — leave un-gated. The problem list is treated as the
        // chart's current best summary at the time of the AP. Era-specific
        // problem list nuance would require time-stamped problem entries,
        // which we don't have. Future enhancement.
    }

    function _restorePatches() {
        if (!_originals) return;
        for (const [name, fn] of Object.entries(_originals)) {
            dataLoader[name] = fn;
        }
        _originals = null;
    }

    // ── module bootstrap ───────────────────────────────────────────────

    // If something else triggers a patient switch while the gate is active,
    // deactivate so we don't leak the gate onto an unrelated patient.
    window.addEventListener('assessment:patient-switch-detected', () => {
        if (_active) {
            LOG('Patient switch detected — auto-deactivating gate');
            deactivate();
        }
    });

    return {
        activate,
        advance,
        deactivate,
        isActive,
        getAnchor,
        getCaseId,
        getVisibleSections,
        resetVisibleSections,
    };
})();

window.AssessmentChartGate = AssessmentChartGate;
