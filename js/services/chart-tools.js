/**
 * ChartTools — exposes targeted chart lookup tools for Claude to use
 * during Ask interactions.
 *
 * When Claude's memory document doesn't contain enough detail to
 * answer a question, Claude can call one of these tools to search
 * or fetch specific chart content. Each tool returns a structured
 * result that also feeds back into the memory document so future
 * questions benefit from the discovery.
 *
 * Usage (from ai-coworker):
 *   const schemas = ChartTools.getSchemas();          // send to Claude
 *   const result = await ChartTools.execute(toolName, input);
 *   // result: { ok, data, factsToRemember }
 */

const ChartTools = {
    /**
     * JSON Schemas in the Anthropic tool_use format.
     * These get sent with every Ask request so Claude knows what's available.
     */
    getSchemas() {
        return [
            {
                name: 'search_notes',
                description:
                    'Search the patient\'s clinical notes for text matching a query. ' +
                    'Returns matching notes with date, author, department, type, and a preview. ' +
                    'Use this when the user asks about something a specific clinician said, ' +
                    'a past visit, a symptom discussed in a note, or events not in your memory.',
                input_schema: {
                    type: 'object',
                    properties: {
                        query: {
                            type: 'string',
                            description: 'Keywords or phrase to search for (e.g. "metformin", "chest pain", "Dr. Martinez").',
                        },
                        department: {
                            type: 'string',
                            description: 'Optional filter by department (e.g. "Cardiology", "Endocrinology", "Behavioral Health").',
                        },
                        note_type: {
                            type: 'string',
                            description: 'Optional filter by note type (e.g. "Progress Note", "Consult Note", "Discharge Summary", "Telephone Encounter").',
                        },
                        limit: {
                            type: 'integer',
                            description: 'Max number of matches to return (default 5, max 15).',
                        },
                    },
                    required: ['query'],
                },
            },
            {
                name: 'get_note',
                description:
                    'Fetch the full content of a specific clinical note by its ID. ' +
                    'Use after search_notes when you need the complete note text to answer precisely.',
                input_schema: {
                    type: 'object',
                    properties: {
                        note_id: {
                            type: 'string',
                            description: 'The note ID (e.g. "NOTE042", "NOTE_BEHAV001").',
                        },
                    },
                    required: ['note_id'],
                },
            },
            {
                name: 'search_labs',
                description:
                    'Get the trend and values for a specific lab test over time. ' +
                    'Returns date-ordered results with values, units, flags, and reference ranges. ' +
                    'Use when the user asks about a specific lab trend or wants values not in your memory.',
                input_schema: {
                    type: 'object',
                    properties: {
                        test_name: {
                            type: 'string',
                            description: 'The lab test name (e.g. "Creatinine", "Hemoglobin A1c", "BNP"). Case-insensitive partial match.',
                        },
                        limit: {
                            type: 'integer',
                            description: 'Max number of most-recent values to return (default 10).',
                        },
                    },
                    required: ['test_name'],
                },
            },
            {
                name: 'get_medication_history',
                description:
                    'Get history of a specific medication — past and present doses, start/stop dates, and reasons. ' +
                    'Use when the user asks whether a med was ever tried, when it was changed, or why it was stopped.',
                input_schema: {
                    type: 'object',
                    properties: {
                        medication_name: {
                            type: 'string',
                            description: 'Medication name (e.g. "metformin", "lisinopril"). Case-insensitive partial match.',
                        },
                    },
                    required: ['medication_name'],
                },
            },
            {
                name: 'search_chart',
                description:
                    'Broad keyword search across ALL chart data (notes, labs, meds, problems, imaging). ' +
                    'Use as a last resort when you don\'t know where to look or when a question spans multiple areas. ' +
                    'Returns grouped results from each area.',
                input_schema: {
                    type: 'object',
                    properties: {
                        query: {
                            type: 'string',
                            description: 'Keywords or phrase to search for across the chart.',
                        },
                    },
                    required: ['query'],
                },
            },
        ];
    },

    /**
     * Execute a tool call from Claude.
     * @param {string} name - Tool name from the schema
     * @param {object} input - Parameters Claude passed
     * @returns {Promise<{ok, data, summary, factsToRemember}>}
     */
    async execute(name, input) {
        try {
            switch (name) {
                case 'search_notes':
                    return await this._searchNotes(input);
                case 'get_note':
                    return await this._getNote(input);
                case 'search_labs':
                    return await this._searchLabs(input);
                case 'get_medication_history':
                    return await this._getMedicationHistory(input);
                case 'search_chart':
                    return await this._searchChart(input);
                default:
                    return { ok: false, error: `Unknown tool: ${name}`, data: null };
            }
        } catch (err) {
            console.error(`ChartTools.execute(${name}) failed:`, err);
            return { ok: false, error: err.message, data: null };
        }
    },

    // ──────────────────────────────────────────────────────────────
    // Tool implementations
    // ──────────────────────────────────────────────────────────────

    async _searchNotes({ query, department, note_type, limit }) {
        if (typeof dataLoader === 'undefined') {
            return { ok: false, error: 'dataLoader not available', data: null };
        }
        const max = Math.min(Math.max(1, limit || 5), 15);
        const idx = await dataLoader.loadNotesIndex();
        const notes = idx?.notes || [];
        const q = (query || '').toLowerCase().trim();

        const matches = notes.filter(n => {
            if (department && n.department && !n.department.toLowerCase().includes(department.toLowerCase())) return false;
            if (note_type && n.type && !n.type.toLowerCase().includes(note_type.toLowerCase())) return false;
            if (!q) return true;
            const hay = [n.preview, n.title, n.type, n.author, n.department].filter(Boolean).join(' ').toLowerCase();
            return hay.includes(q);
        });

        matches.sort((a, b) => new Date(b.date) - new Date(a.date));
        const trimmed = matches.slice(0, max);

        const data = trimmed.map(n => ({
            id: n.id,
            date: n.date ? n.date.substring(0, 10) : null,
            type: n.type,
            author: n.author,
            department: n.department,
            title: n.title,
            preview: n.preview ? n.preview.substring(0, 300) : '',
        }));

        return {
            ok: true,
            data,
            summary: `Found ${matches.length} note${matches.length === 1 ? '' : 's'}${matches.length > max ? ` (showing first ${max})` : ''}.`,
            factsToRemember: this._extractFactsFromNotes(data, q),
        };
    },

    async _getNote({ note_id }) {
        if (typeof dataLoader === 'undefined') return { ok: false, error: 'dataLoader not available', data: null };
        const note = await dataLoader.loadNote(note_id);
        if (!note) return { ok: false, error: `Note ${note_id} not found`, data: null };

        const data = {
            id: note_id,
            date: note.date ? (note.date.substring ? note.date.substring(0, 10) : note.date) : null,
            type: note.type,
            author: note.author,
            department: note.department,
            title: note.title,
            content: note.content || note.body || note.text || '',
        };

        return {
            ok: true,
            data,
            summary: `Retrieved note ${note_id}: ${data.type || ''} by ${data.author || 'unknown'} (${data.date || 'unknown date'}).`,
            factsToRemember: [], // Caller will decide what to extract from reading
        };
    },

    async _searchLabs({ test_name, limit }) {
        if (typeof dataLoader === 'undefined') return { ok: false, error: 'dataLoader not available', data: null };
        const max = Math.max(1, limit || 10);
        const q = (test_name || '').toLowerCase().trim();
        const allLabs = await dataLoader.loadAllLabs();

        const matches = allLabs.filter(lab => {
            const name = (lab.name || lab.test || '').toLowerCase();
            return name.includes(q);
        });

        matches.sort((a, b) => new Date(b.date || b.collectedDate || 0) - new Date(a.date || a.collectedDate || 0));
        const trimmed = matches.slice(0, max);

        const data = trimmed.map(lab => ({
            name: lab.name || lab.test,
            date: (lab.date || lab.collectedDate || '').substring(0, 10),
            value: lab.value,
            unit: lab.unit,
            flag: lab.flag,
            referenceRange: lab.referenceRange || lab.reference,
        }));

        return {
            ok: true,
            data,
            summary: `Found ${matches.length} result${matches.length === 1 ? '' : 's'} for "${test_name}".`,
            factsToRemember: this._extractFactsFromLabs(test_name, data),
        };
    },

    async _getMedicationHistory({ medication_name }) {
        if (typeof dataLoader === 'undefined') return { ok: false, error: 'dataLoader not available', data: null };
        const q = (medication_name || '').toLowerCase().trim();
        const meds = await dataLoader.loadMedications();
        const active = meds?.active?.medications || meds?.active || [];
        const historical = meds?.historical?.medications || meds?.historical || [];

        const matchActive = active.filter(m => (m.name || '').toLowerCase().includes(q));
        const matchHist = historical.filter(m => (m.name || '').toLowerCase().includes(q));

        const format = m => ({
            name: m.name,
            dose: m.dose,
            route: m.route,
            frequency: m.frequency,
            indication: m.indication,
            started: m.startDate || m.started,
            stopped: m.endDate || m.discontinuedDate || m.stopped,
            reasonStopped: m.reasonDiscontinued || m.reasonStopped,
            prescriber: m.prescriber,
        });

        const data = {
            active: matchActive.map(format),
            historical: matchHist.map(format),
        };

        const total = matchActive.length + matchHist.length;
        return {
            ok: true,
            data,
            summary: `Found ${total} match${total === 1 ? '' : 'es'} for "${medication_name}" (${matchActive.length} active, ${matchHist.length} historical).`,
            factsToRemember: this._extractFactsFromMeds(medication_name, data),
        };
    },

    async _searchChart({ query }) {
        if (typeof dataLoader === 'undefined') return { ok: false, error: 'dataLoader not available', data: null };
        const q = (query || '').toLowerCase().trim();
        if (!q) return { ok: false, error: 'Empty query', data: null };

        // Parallel search across areas
        const [notesRes, labsRes, medsRes] = await Promise.all([
            this._searchNotes({ query: q, limit: 5 }).catch(() => ({ ok: false, data: [] })),
            this._searchLabs({ test_name: q, limit: 5 }).catch(() => ({ ok: false, data: [] })),
            this._getMedicationHistory({ medication_name: q }).catch(() => ({ ok: false, data: { active: [], historical: [] } })),
        ]);

        // Also look at problems + allergies (quick inline match)
        const problems = await dataLoader.loadProblems().catch(() => null);
        const probMatches = [];
        if (problems) {
            const active = problems.active?.problems || problems.active || [];
            const resolved = problems.resolved?.problems || problems.resolved || [];
            [...active, ...resolved].forEach(p => {
                const text = [p.name, p.icd, p.description].filter(Boolean).join(' ').toLowerCase();
                if (text.includes(q)) probMatches.push({ name: p.name, icd: p.icd, status: p.status });
            });
        }

        const data = {
            notes: notesRes.data || [],
            labs: labsRes.data || [],
            medications: medsRes.data || { active: [], historical: [] },
            problems: probMatches.slice(0, 5),
        };

        const totalHits =
            data.notes.length +
            data.labs.length +
            data.medications.active.length +
            data.medications.historical.length +
            data.problems.length;

        return {
            ok: true,
            data,
            summary: `Cross-chart search for "${query}" found ${totalHits} result${totalHits === 1 ? '' : 's'}.`,
            factsToRemember: [], // Enrichment is tricky for broad search; skip
        };
    },

    // ──────────────────────────────────────────────────────────────
    // Fact extraction for memory enrichment
    // ──────────────────────────────────────────────────────────────

    _extractFactsFromNotes(notes, query) {
        if (!notes?.length) return [];
        return notes.slice(0, 3).map(n => ({
            section: 'notes',
            text: `${n.date || '?'} ${n.type || 'Note'} by ${n.author || 'unknown'}${n.department ? ' (' + n.department + ')' : ''}: ${(n.preview || '').substring(0, 140)}`,
            meta: { noteId: n.id, date: n.date, department: n.department, query: query },
        }));
    },

    _extractFactsFromLabs(testName, results) {
        if (!results?.length) return [];
        const recent = results.slice(0, 5);
        const summary = recent.map(r => `${r.date}: ${r.value}${r.unit ? ' ' + r.unit : ''}${r.flag && r.flag !== 'normal' ? ' [' + r.flag + ']' : ''}`).join(', ');
        return [{
            section: 'labTrends',
            text: `${testName}: ${summary}`,
            meta: { testName, values: recent },
        }];
    },

    _extractFactsFromMeds(medName, data) {
        const facts = [];
        data.active.forEach(m => {
            facts.push({
                section: 'medications',
                text: `${m.name} ${m.dose || ''} ${m.route || ''} ${m.frequency || ''} (active${m.indication ? ', for ' + m.indication : ''})`,
                meta: { ...m, status: 'active' },
            });
        });
        data.historical.forEach(m => {
            facts.push({
                section: 'medications',
                text: `${m.name} ${m.dose || ''} (historical${m.started ? ', started ' + m.started : ''}${m.stopped ? ', stopped ' + m.stopped : ''}${m.reasonStopped ? ' — ' + m.reasonStopped : ''})`,
                meta: { ...m, status: 'historical' },
            });
        });
        return facts;
    },
};

if (typeof window !== 'undefined') window.ChartTools = ChartTools;
if (typeof module !== 'undefined' && module.exports) module.exports = ChartTools;
