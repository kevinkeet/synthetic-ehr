/**
 * Working Memory Assembler
 *
 * Builds focused context subsets for each LLM call type instead of dumping
 * the entire longitudinal document. Uses the existing LongitudinalDocumentRenderer's
 * individual render methods selectively.
 *
 * Context budget comparison (approximate characters):
 * - Ask AI (simple Q): 3,000-5,000 (down from 12,000-15,000)
 * - Dictation:         6,000-10,000
 * - Refresh:           12,000-15,000 (full — this IS the comprehensive pull)
 * - Write Note:        12,000-15,000 (full)
 */

class WorkingMemoryAssembler {
    constructor(pkb, sessionContext, renderer) {
        this.pkb = pkb;                // LongitudinalClinicalDocument
        this.session = sessionContext;  // SessionContext
        this.renderer = renderer;       // LongitudinalDocumentRenderer
    }

    /**
     * Assemble working memory for a specific interaction type.
     * Returns a string ready to be inserted into the LLM prompt.
     */
    assemble(interactionType, additionalContext = {}) {
        switch (interactionType) {
            case 'ask':
                return this.assembleForAsk(additionalContext.question);
            case 'dictate':
                return this.assembleForDictation(additionalContext.dictation);
            case 'refresh':
                return this.assembleForRefresh();
            case 'writeNote':
                return this.assembleForNoteWriting(additionalContext);
            default:
                return this.assembleDefault();
        }
    }

    /**
     * ASK interaction: Focused context based on the question topic.
     * Budget: ~3,000-5,000 chars
     */
    assembleForAsk(question) {
        const sections = [];

        // 1. Always: AI's patient summary (not the full PKB render)
        sections.push(this.getPatientSummaryBlock());

        // 2. Always: Safety info (allergies, critical flags)
        sections.push(this.getSafetyBlock());

        // 3. Topic-relevant context (with 2-hop associative reasoning)
        sections.push(this.getRelevantContextForQuestion(question));

        // 4. Associative context: follow clinical reasoning chains 2 hops deep
        // e.g., K+ question → diuretics → HF → renal function
        sections.push(this.getAssociativeContext(question));

        // 5. Session awareness
        if (this.session) {
            sections.push(this.session.toContextString());
        }

        // 6. Previous AI insights (for continuity)
        sections.push(this.getPreviousInsightsBlock());

        // 7. Ambient scribe findings (if available and relevant)
        sections.push(this.getAmbientFindingsBlock());

        return sections.filter(s => s && s.trim()).join('\n\n');
    }

    /**
     * DICTATION interaction: More context because doctor is sharing reasoning.
     * Budget: ~6,000-10,000 chars
     */
    assembleForDictation(dictation) {
        const sections = [];

        // 1. AI's patient summary
        sections.push(this.getPatientSummaryBlock());

        // 2. Safety info
        sections.push(this.getSafetyBlock());

        // 3. Problem context — relevant to what was mentioned in dictation
        const mentionedProblems = this.identifyMentionedProblems(dictation || '');
        if (mentionedProblems.length > 0) {
            sections.push(this.getProblemsBlock(mentionedProblems));
        } else {
            sections.push(this.getActiveProblemsBlock());
        }

        // 4. Recent data (compact)
        sections.push(this.getRecentDataBlock());

        // 5. Current medications
        sections.push(this.getMedicationsBlock());

        // 6. Session activity
        if (this.session) {
            sections.push(this.session.toContextString());
        }

        // 7. Previous AI analysis (for continuity)
        sections.push(this.getPreviousInsightsBlock());

        // 8. Ambient scribe findings (if available)
        sections.push(this.getAmbientFindingsBlock());

        return sections.filter(s => s && s.trim()).join('\n\n');
    }

    /**
     * REFRESH interaction: Comprehensive — full PKB render.
     * Budget: 12,000-15,000 chars (unchanged)
     */
    assembleForRefresh() {
        // This is the ONE case where we render the full longitudinal document
        const fullRender = this.renderer.render(this.pkb);

        // Also include AI's accumulated memory
        const aiMemoryBlock = this.getAIMemoryBlock();

        return `${fullRender}\n\n${aiMemoryBlock}`;
    }

    /**
     * NOTE WRITING: Comprehensive clinical data.
     * Budget: Full
     */
    assembleForNoteWriting(options) {
        return this.renderer.render(this.pkb);
    }

    /**
     * Default: moderate context
     */
    assembleDefault() {
        const sections = [];
        sections.push(this.getPatientSummaryBlock());
        sections.push(this.getSafetyBlock());
        sections.push(this.getActiveProblemsBlock());
        sections.push(this.getRecentDataBlock());
        if (this.session) {
            sections.push(this.session.toContextString());
        }
        return sections.filter(s => s && s.trim()).join('\n\n');
    }

    // =====================================================
    // CONTEXT BUILDING BLOCKS
    // =====================================================

    /**
     * AI's accumulated patient summary — the core memory
     */
    getPatientSummaryBlock() {
        const mem = this.pkb.aiMemory;

        // If AI has built a summary, use it (this is the key memory feature)
        if (mem && mem.patientSummary) {
            // Also include basic demographics for grounding
            const header = this.renderer.renderPatientHeader(this.pkb);
            return `${header}\n\n## AI'S CURRENT UNDERSTANDING\n${mem.patientSummary}`;
        }

        // Fallback: just the patient header from the renderer
        return this.renderer.renderPatientHeader(this.pkb);
    }

    /**
     * Safety-critical info (allergies, flags) — always included, never truncated
     */
    getSafetyBlock() {
        return this.renderer.renderSafetySection(this.pkb);
    }

    /**
     * Topic-relevant context for a question — the smart filtering
     */
    getRelevantContextForQuestion(question) {
        if (!question) return '';
        const q = question.toLowerCase();
        const sections = [];

        // Detect what the question is about
        const labKeywords = ['lab', 'result', 'level', 'value', 'trend', 'creatinine', 'potassium',
            'bnp', 'troponin', 'hemoglobin', 'a1c', 'inr', 'glucose', 'sodium', 'magnesium',
            'calcium', 'phosphorus', 'albumin', 'bilirubin', 'ast', 'alt', 'wbc', 'platelet',
            'hematocrit', 'egfr', 'bun', 'procalcitonin', 'lactate', 'iron', 'ferritin'];
        const medKeywords = ['medication', 'med', 'drug', 'dose', 'dosing', 'interaction',
            'contraindic', 'prescri', 'formulary', 'generic', 'pharma'];
        const vitalKeywords = ['vital', 'blood pressure', 'bp', 'heart rate', 'hr', 'oxygen',
            'spo2', 'temperature', 'temp', 'respiratory rate', 'rr', 'weight'];
        const noteKeywords = ['note', 'documentation', 'assessment', 'plan', 'history',
            'consult', 'discharge', 'progress', 'hpi'];
        const imagingKeywords = ['imaging', 'xray', 'x-ray', 'ct', 'mri', 'ultrasound',
            'echo', 'echocardiogram', 'chest'];

        if (labKeywords.some(kw => q.includes(kw))) {
            sections.push(this.renderer.renderLabTrends(this.pkb));
        }
        if (medKeywords.some(kw => q.includes(kw))) {
            sections.push(this.renderer.renderMedications(this.pkb));
        }
        if (vitalKeywords.some(kw => q.includes(kw))) {
            sections.push(this.renderer.renderVitalTrends(this.pkb));
        }

        // Check for specific problem mentions
        const matchedProblems = this.identifyMentionedProblems(question);
        if (matchedProblems.length > 0) {
            sections.push(this.getProblemsBlock(matchedProblems));
        }

        // If nothing specific matched, include a compact overview
        if (sections.length === 0) {
            sections.push(this.getActiveProblemsBlock());
            sections.push(this.getRecentDataBlock());
        }

        return sections.filter(s => s && s.trim()).join('\n\n');
    }

    /**
     * Render specific problems with their full timeline data
     */
    getProblemsBlock(problemIds) {
        if (!problemIds || problemIds.length === 0) return '';

        let text = '## RELEVANT PROBLEMS\n\n';
        for (const id of problemIds) {
            const timeline = this.pkb.problemMatrix.get(id);
            if (timeline) {
                const p = timeline.problem;
                text += `### ${p.name} [${p.status}]\n`;
                if (p.icdCode) text += `ICD-10: ${p.icdCode}\n`;
                if (p.onsetDate) text += `Onset: ${p.onsetDate}\n`;

                // Include AI insight for this problem if available
                const insight = this.pkb.aiMemory?.problemInsights?.get(id);
                if (insight) {
                    text += `**AI Analysis:** ${insight}\n`;
                }

                // Include related labs for this problem
                const category = p.category;
                if (category && typeof PROBLEM_CATEGORIES !== 'undefined' && PROBLEM_CATEGORIES[category]) {
                    const relatedLabNames = PROBLEM_CATEGORIES[category].relatedLabs || [];
                    const labData = [];
                    for (const labName of relatedLabNames) {
                        const trend = this.pkb.longitudinalData.labs.get(labName);
                        if (trend && trend.latestValue) {
                            const flag = trend.latestValue.flag ? ` [${trend.latestValue.flag}]` : '';
                            labData.push(`${trend.name}: ${trend.latestValue.value} ${trend.latestValue.unit || ''}${flag}`);
                        }
                    }
                    if (labData.length > 0) {
                        text += `Related labs: ${labData.join(', ')}\n`;
                    }
                }

                text += '\n';
            }
        }
        return text;
    }

    /**
     * Compact list of all active problems
     */
    getActiveProblemsBlock() {
        const active = this.pkb.getActiveProblems();
        if (active.length === 0) return '';

        let text = '## ACTIVE PROBLEMS\n';
        for (const timeline of active) {
            const p = timeline.problem;
            const insight = this.pkb.aiMemory?.problemInsights?.get(p.id) || '';
            text += `- **${p.name}** [${p.status}]`;
            if (p.icdCode) text += ` (${p.icdCode})`;
            if (insight) text += `: ${insight}`;
            text += '\n';
        }
        return text;
    }

    /**
     * Recent vitals + abnormal labs — compact overview
     */
    getRecentDataBlock() {
        let text = '## RECENT DATA\n';

        // Latest vitals
        const vitals = this.pkb.longitudinalData.vitals;
        if (vitals && vitals.length > 0) {
            const v = vitals[0];
            text += `Latest Vitals: BP ${v.systolic || '?'}/${v.diastolic || '?'}, `;
            text += `HR ${v.heartRate || '?'}, RR ${v.respiratoryRate || '?'}, `;
            text += `SpO2 ${v.spO2 || '?'}%, Temp ${v.temperature || '?'}`;
            if (v.weight) text += `, Wt ${v.weight}kg`;
            text += '\n';
        }

        // Recent abnormal labs (compact)
        const abnormalLabs = [];
        for (const [name, trend] of this.pkb.longitudinalData.labs) {
            if (trend.latestValue && trend.latestValue.flag) {
                const flag = trend.latestValue.flag;
                abnormalLabs.push(`${name}: ${trend.latestValue.value}${trend.latestValue.unit ? ' ' + trend.latestValue.unit : ''} [${flag}]`);
            }
        }
        if (abnormalLabs.length > 0) {
            text += `Abnormal Labs: ${abnormalLabs.slice(0, 15).join('; ')}\n`;
            if (abnormalLabs.length > 15) {
                text += `(${abnormalLabs.length - 15} more abnormal results)\n`;
            }
        }

        // Active medication count
        const meds = this.pkb.longitudinalData.medications;
        if (meds && meds.current) {
            text += `Active Medications: ${meds.current.length}\n`;
        }

        return text;
    }

    /**
     * Current medication list
     */
    getMedicationsBlock() {
        return this.renderer.renderMedications(this.pkb);
    }

    /**
     * Previous AI insights for continuity
     */
    getPreviousInsightsBlock() {
        const narrative = this.pkb.clinicalNarrative;
        const ctx = this.pkb.sessionContext;
        let text = '';

        // Highest priority: pending decisions (action items needing physician response)
        const pendingDecisions = (ctx?.activeClinicalState?.pendingDecisions || [])
            .filter(d => !d.resolvedAt);
        if (pendingDecisions.length > 0) {
            text += '## PENDING DECISIONS (Awaiting Physician Action)\n';
            for (const d of pendingDecisions) {
                text += `! [${(d.raisedBy || 'unknown').toUpperCase()}] ${d.text}\n`;
            }
            text += '\n';
        }

        // Active conflicts
        const conflicts = (ctx?.conflicts || []).filter(c => !c.resolvedAt);
        if (conflicts.length > 0) {
            text += '## UNRESOLVED CONFLICTS\n';
            for (const c of conflicts) {
                text += `!! ${c.itemA.text} vs ${c.itemB.text}\n`;
            }
            text += '\n';
        }

        // Trajectory assessment
        if (narrative && narrative.trajectoryAssessment) {
            text += `## AI'S TRAJECTORY ASSESSMENT\n${narrative.trajectoryAssessment}\n\n`;
        }

        // Open questions
        if (narrative && narrative.openQuestions && narrative.openQuestions.length > 0) {
            text += '## UNRESOLVED QUESTIONS\n';
            narrative.openQuestions.forEach(q => { text += `? ${q}\n`; });
        }

        return text || '';
    }

    /**
     * Full AI memory block (for refresh/comprehensive interactions)
     */
    getAIMemoryBlock() {
        const mem = this.pkb.aiMemory;
        if (!mem) return '';

        let text = '## AI MEMORY (Accumulated Understanding)\n\n';

        if (mem.patientSummary) {
            text += `### Patient Summary\n${mem.patientSummary}\n\n`;
        }

        if (mem.problemInsights && mem.problemInsights.size > 0) {
            text += '### Per-Problem Insights\n';
            for (const [id, insight] of mem.problemInsights) {
                const timeline = this.pkb.problemMatrix.get(id);
                const name = timeline ? timeline.problem.name : id;
                text += `- **${name}**: ${insight}\n`;
            }
            text += '\n';
        }

        if (mem.clinicalDecisions && mem.clinicalDecisions.length > 0) {
            text += '### Clinical Decisions Made\n';
            for (const d of mem.clinicalDecisions.slice(-5)) {
                text += `- ${d.decision}${d.rationale ? ' (' + d.rationale + ')' : ''}\n`;
            }
            text += '\n';
        }

        if (mem.interactionLog && mem.interactionLog.length > 0) {
            text += '### Recent AI Interactions\n';
            for (const entry of mem.interactionLog.slice(-5)) {
                text += `- [${entry.type}] ${entry.summary}\n`;
            }
        }

        return text;
    }

    /**
     * Identify which problems are mentioned in a text string
     * Returns array of problem IDs
     */
    identifyMentionedProblems(text) {
        if (!text) return [];
        const mentioned = [];
        const lower = text.toLowerCase();

        for (const [problemId, timeline] of this.pkb.problemMatrix) {
            const pName = timeline.problem.name.toLowerCase();
            // Direct name match
            if (lower.includes(pName)) {
                mentioned.push(problemId);
                continue;
            }
            // Category keyword match
            const category = timeline.problem.category;
            if (category && typeof PROBLEM_CATEGORIES !== 'undefined' && PROBLEM_CATEGORIES[category]) {
                const keywords = PROBLEM_CATEGORIES[category].keywords || [];
                if (keywords.some(kw => lower.includes(kw))) {
                    mentioned.push(problemId);
                }
            }
        }

        return mentioned;
    }

    // =====================================================
    // ASSOCIATIVE CONTEXT: 2-hop clinical reasoning chains
    // =====================================================

    /**
     * Follow clinical reasoning chains to include context that's related to the
     * question but not directly mentioned. E.g., a question about "potassium"
     * should also pull in diuretics (which affect K+) and renal function.
     *
     * The chain: keyword → problem category → related categories → related data
     *
     * Category linkage map (clinical reasoning associations):
     * - renal ↔ cardiovascular (cardiorenal syndrome)
     * - renal ↔ endocrine (diabetic nephropathy)
     * - cardiovascular ↔ hematologic (anticoagulation, bleeding risk)
     * - pulmonary ↔ cardiovascular (CHF → pulmonary edema)
     * - endocrine ↔ cardiovascular (diabetes → CAD risk)
     * - gi ↔ hematologic (GI bleed → anemia, anticoagulation risk)
     */
    getAssociativeContext(question) {
        if (!question) return '';

        // Define clinical reasoning associations between problem categories
        const CLINICAL_ASSOCIATIONS = {
            renal: ['cardiovascular', 'endocrine'],
            cardiovascular: ['renal', 'pulmonary', 'hematologic'],
            endocrine: ['renal', 'cardiovascular'],
            pulmonary: ['cardiovascular', 'infectious'],
            hematologic: ['gi', 'cardiovascular'],
            gi: ['hematologic'],
            infectious: ['pulmonary', 'hematologic']
        };

        // Lab → category associations (which categories care about which labs)
        const LAB_CATEGORY_MAP = {
            'potassium': ['renal', 'cardiovascular'],
            'creatinine': ['renal'],
            'egfr': ['renal'],
            'bun': ['renal'],
            'bnp': ['cardiovascular'],
            'troponin': ['cardiovascular'],
            'inr': ['hematologic', 'gi'],
            'hemoglobin': ['hematologic'],
            'glucose': ['endocrine'],
            'a1c': ['endocrine'],
            'lactate': ['infectious'],
            'wbc': ['infectious', 'hematologic'],
            'sodium': ['renal', 'cardiovascular']
        };

        const q = question.toLowerCase();
        const directCategories = new Set();

        // Step 1: Find directly mentioned categories
        const directProblems = this.identifyMentionedProblems(question);
        for (const pid of directProblems) {
            const timeline = this.pkb.problemMatrix.get(pid);
            if (timeline && timeline.problem.category) {
                directCategories.add(timeline.problem.category);
            }
        }

        // Step 2: Check lab keyword → category mappings
        for (const [labKeyword, categories] of Object.entries(LAB_CATEGORY_MAP)) {
            if (q.includes(labKeyword)) {
                for (const cat of categories) {
                    directCategories.add(cat);
                }
            }
        }

        // Step 3: Follow 1 hop of clinical associations
        const associatedCategories = new Set();
        for (const cat of directCategories) {
            const associations = CLINICAL_ASSOCIATIONS[cat] || [];
            for (const assoc of associations) {
                if (!directCategories.has(assoc)) {
                    associatedCategories.add(assoc);
                }
            }
        }

        if (associatedCategories.size === 0) return '';

        // Step 4: Find problems in associated categories that have relevant data
        const associatedProblems = [];
        for (const [id, timeline] of this.pkb.problemMatrix) {
            if (timeline.problem.status === 'active' &&
                associatedCategories.has(timeline.problem.category) &&
                !directProblems.includes(id)) {
                associatedProblems.push(id);
            }
        }

        if (associatedProblems.length === 0) return '';

        // Step 5: Build compact context for associated problems
        let text = '## CLINICALLY ASSOCIATED CONTEXT\n';
        text += '(Related problems that may affect the question — follow the clinical reasoning chain)\n\n';

        for (const id of associatedProblems.slice(0, 3)) { // Max 3 associated problems
            const timeline = this.pkb.problemMatrix.get(id);
            if (!timeline) continue;
            const p = timeline.problem;
            text += `**${p.name}** [${p.category}]: `;

            // Include AI insight if available
            const insight = this.pkb.aiMemory?.problemInsights?.get(id);
            if (insight) {
                text += insight;
            }

            // Include related labs (compact)
            const relatedLabNames = (typeof PROBLEM_CATEGORIES !== 'undefined' && PROBLEM_CATEGORIES[p.category])
                ? PROBLEM_CATEGORIES[p.category].relatedLabs || [] : [];
            const labSnippets = [];
            for (const labName of relatedLabNames.slice(0, 3)) {
                const trend = this.pkb.longitudinalData.labs.get(labName);
                if (trend && trend.latestValue) {
                    labSnippets.push(`${trend.name}: ${trend.latestValue.value}${trend.latestValue.unit || ''}${trend.latestValue.flag ? ' [' + trend.latestValue.flag + ']' : ''}`);
                }
            }
            if (labSnippets.length > 0) {
                text += ` | Labs: ${labSnippets.join(', ')}`;
            }
            text += '\n';
        }

        return text;
    }

    // =====================================================
    // AMBIENT SCRIBE CONTEXT BLOCK
    // =====================================================

    /**
     * Build a compact context block from ambient scribe findings.
     * Includes key clinical data overheard from the doctor-patient conversation.
     * Returns empty string if no ambient data available.
     */
    getAmbientFindingsBlock() {
        if (typeof AmbientScribe === 'undefined' || !AmbientScribe.hasData()) {
            // Fallback: check longitudinal doc for persisted ambient data
            if (this.pkb && this.pkb.sessionContext && this.pkb.sessionContext.ambientFindings &&
                this.pkb.sessionContext.ambientFindings.length > 0) {
                return this._buildAmbientBlockFromPersisted();
            }
            return '';
        }

        var block = AmbientScribe.getAmbientContextBlock();
        if (!block) return '';

        return '## FROM AMBIENT CONVERSATION (doctor-patient dialogue)\n' + block;
    }

    /**
     * Build ambient block from persisted data (when AmbientScribe service isn't active
     * but data was previously captured and saved to the longitudinal doc).
     */
    _buildAmbientBlockFromPersisted() {
        var findings = this.pkb.sessionContext.ambientFindings;
        if (!findings || findings.length === 0) return '';

        var lines = [];
        var symptoms = findings.filter(function(f) { return f.type === 'symptom'; });
        var examFindings = findings.filter(function(f) { return f.type === 'finding'; });
        var assessments = findings.filter(function(f) { return f.type === 'assessment'; });
        var concerns = findings.filter(function(f) { return f.type === 'concern'; });

        if (symptoms.length > 0) {
            lines.push('Patient reports: ' + symptoms.map(function(s) { return s.text; }).join('; '));
        }
        if (examFindings.length > 0) {
            lines.push('Exam: ' + examFindings.map(function(f) { return f.text; }).join('; '));
        }
        if (assessments.length > 0) {
            lines.push('Assessment: ' + assessments.map(function(a) { return a.text; }).join('; '));
        }
        if (concerns.length > 0) {
            lines.push('Patient concerns: ' + concerns.map(function(c) { return c.text; }).join('; '));
        }

        if (lines.length === 0) return '';

        return '## FROM AMBIENT CONVERSATION (doctor-patient dialogue)\n' + lines.join('\n');
    }
    // =====================================================
    // LEARN / REFRESH / INTERACT ASSEMBLY
    // =====================================================

    /**
     * LEARN: Full chart render for initial patient learning.
     * Like assembleForRefresh but WITHOUT prior AI memory (clean slate).
     * Budget: ~12,000-15,000 chars
     */
    assembleForLearn() {
        return this.renderer.render(this.pkb);
    }

    /**
     * DEEP LEARN LEVEL 1: Full text of specified items for comprehensive initial read.
     * Items: array of { type: 'note'|'lab'|'imaging', id, data? }
     * Returns assembled text with full content for each item.
     */
    assembleForDeepLearnLevel1(items) {
        var sections = [];

        // Patient header from PKB
        if (this.pkb && this.pkb.demographics) {
            var d = this.pkb.demographics;
            sections.push('## PATIENT\n' + [d.name, d.age, d.sex, d.mrn].filter(Boolean).join(' | '));
        }

        // Allergies
        if (this.pkb && this.pkb.allergies && this.pkb.allergies.length) {
            sections.push('## ALLERGIES\n' + this.pkb.allergies.map(function(a) {
                return '- ' + a.substance + ' (' + (a.reaction || 'unknown reaction') + ')';
            }).join('\n'));
        }

        // Active medications
        if (this.pkb && this.pkb.medications) {
            var meds = this.pkb.medications.active || this.pkb.medications;
            if (Array.isArray(meds) && meds.length) {
                sections.push('## CURRENT MEDICATIONS\n' + meds.map(function(m) {
                    return '- ' + (m.name || m.medication) + ' ' + (m.dose || '') + ' ' + (m.frequency || '');
                }).join('\n'));
            }
        }

        // Active problems
        if (this.pkb && this.pkb.problems) {
            var probs = this.pkb.problems.active || this.pkb.problems;
            if (Array.isArray(probs) && probs.length) {
                sections.push('## ACTIVE PROBLEMS\n' + probs.map(function(p) {
                    return '- ' + (p.name || p.description || p);
                }).join('\n'));
            }
        }

        // Vitals (most recent)
        if (this.pkb && this.pkb.vitals && this.pkb.vitals.length) {
            var latest = this.pkb.vitals[0];
            var vStr = Object.entries(latest).filter(function(e) {
                return e[0] !== 'date' && e[0] !== 'timestamp' && e[1];
            }).map(function(e) { return e[0] + ': ' + e[1]; }).join(', ');
            if (vStr) sections.push('## VITALS (latest)\n' + vStr);
        }

        // Group items by type
        var notes = items.filter(function(i) { return i.type === 'note'; });
        var labs = items.filter(function(i) { return i.type === 'lab'; });
        var imaging = items.filter(function(i) { return i.type === 'imaging'; });

        // Notes — full text
        if (notes.length) {
            sections.push('## NOTES (' + notes.length + ')');
            notes.forEach(function(item) {
                var n = item.data;
                if (!n) return;
                var header = '### ' + (n.type || 'Note') + ' — ' + (n.date || '') + ' — ' + (n.author || '');
                var body = '';
                // Helper to render a value (string, array, or dict) into readable text
                function renderVal(label, val) {
                    if (typeof val === 'string') {
                        return '**' + label + ':** ' + val;
                    } else if (Array.isArray(val)) {
                        return '**' + label + ':**\n' + val.map(function(v) {
                            return '- ' + (typeof v === 'string' ? v : JSON.stringify(v));
                        }).join('\n');
                    } else if (typeof val === 'object' && val !== null) {
                        var sub = Object.entries(val).map(function(e) {
                            return '  ' + e[0] + ': ' + (typeof e[1] === 'string' ? e[1] : JSON.stringify(e[1]));
                        }).join('\n');
                        return '**' + label + ':**\n' + sub;
                    }
                    return '';
                }
                function camelToLabel(key) {
                    return key.replace(/([A-Z])/g, ' $1').replace(/^./, function(s) { return s.toUpperCase(); }).trim();
                }

                // Format 1: notes with a "sections" field (H&P, Discharge Summary with dict/array sections)
                if (n.sections && typeof n.sections === 'object') {
                    if (Array.isArray(n.sections)) {
                        // Array of {title, content} objects
                        body = n.sections.map(function(sec) {
                            var title = sec.title || sec.heading || 'Section';
                            var content = sec.content || sec.text || '';
                            if (typeof content !== 'string') content = JSON.stringify(content);
                            return '**' + title + ':** ' + content;
                        }).join('\n\n');
                    } else {
                        body = Object.entries(n.sections).map(function(entry) {
                            return renderVal(camelToLabel(entry[0]), entry[1]);
                        }).filter(Boolean).join('\n\n');
                    }
                }

                // Format 2: structured notes with clinical fields directly on the note object
                // (chiefComplaint, hpi, assessment, plan, physicalExam, etc.)
                if (!body) {
                    var clinicalFields = ['chiefComplaint', 'hpi', 'historyOfPresentIllness', 'reviewOfSystems',
                        'vitals', 'physicalExam', 'assessment', 'plan', 'impression', 'recommendations',
                        'hospitalCourse', 'dischargeMedications', 'dischargeInstructions', 'followUp'];
                    var found = [];
                    clinicalFields.forEach(function(field) {
                        if (n[field]) {
                            found.push(renderVal(camelToLabel(field), n[field]));
                        }
                    });
                    if (found.length > 0) body = found.join('\n\n');
                }

                // Format 3: flat content string
                if (!body) {
                    body = n.content || n.text || n.body || n.preview || '[no content]';
                }
                // Cap individual note to keep Level 1 fast
                if (body.length > 3000) body = body.substring(0, 3000) + '\n... [truncated]';
                sections.push(header + '\n' + body);
            });
        }

        // Labs — full results
        if (labs.length) {
            sections.push('## LAB PANELS (' + labs.length + ')');
            labs.forEach(function(item) {
                var panel = item.data;
                if (!panel) return;
                var header = '### ' + (panel.name || 'Lab') + ' — ' + (panel.collectedDate || panel.date || '');
                var results = (panel.results || []).map(function(r) {
                    var flag = r.flag ? ' [' + r.flag + ']' : '';
                    var ref = r.referenceRange ? ' (ref: ' + r.referenceRange + ')' : '';
                    return '- ' + (r.name || r.test) + ': ' + r.value + ' ' + (r.unit || '') + flag + ref;
                }).join('\n');
                sections.push(header + '\n' + (results || '[no results]'));
            });
        }

        // Imaging — full reports
        if (imaging.length) {
            sections.push('## IMAGING REPORTS (' + imaging.length + ')');
            imaging.forEach(function(item) {
                var rpt = item.data;
                if (!rpt) return;
                var header = '### ' + (rpt.description || rpt.modality || 'Imaging') + ' — ' + (rpt.date || '');
                var parts = [];
                if (rpt.indication) parts.push('**Indication:** ' + rpt.indication);
                if (rpt.technique && typeof rpt.technique === 'string') parts.push('**Technique:** ' + rpt.technique);
                if (rpt.comparison) parts.push('**Comparison:** ' + rpt.comparison);
                // findings can be a string, dict, or missing
                if (rpt.findings) {
                    if (typeof rpt.findings === 'string') {
                        parts.push('**Findings:** ' + rpt.findings);
                    } else if (typeof rpt.findings === 'object') {
                        var findingsText = Object.entries(rpt.findings).map(function(e) {
                            return '  ' + e[0] + ': ' + (typeof e[1] === 'string' ? e[1] : JSON.stringify(e[1]));
                        }).join('\n');
                        parts.push('**Findings:**\n' + findingsText);
                    }
                }
                // impression can be a string, array, or missing
                if (rpt.impression) {
                    if (typeof rpt.impression === 'string') {
                        parts.push('**Impression:** ' + rpt.impression);
                    } else if (Array.isArray(rpt.impression)) {
                        parts.push('**Impression:**\n' + rpt.impression.map(function(i) {
                            return '- ' + (typeof i === 'string' ? i : JSON.stringify(i));
                        }).join('\n'));
                    }
                }
                if (rpt.report) parts.push(typeof rpt.report === 'string' ? rpt.report : JSON.stringify(rpt.report));
                var body = parts.length > 0 ? parts.join('\n') : (rpt.text || '[no report]');
                sections.push(header + '\n' + body);
            });
        }

        return sections.join('\n\n');
    }

    /**
     * INCREMENTAL REFRESH: Existing memory document + delta data.
     * Much cheaper than full learn.
     * Budget: ~4,000-6,000 chars
     */
    assembleForIncrementalRefresh() {
        var sections = [];
        var mem = this.pkb.aiMemory;

        // 1. Existing memory document (the AI's current understanding)
        if (mem && mem.memoryDocument) {
            sections.push('## YOUR CURRENT MEMORY DOCUMENT\n' + JSON.stringify(mem.memoryDocument, null, 2));
        }

        // 2. Delta data since last refresh
        var since = mem.lastRefreshedAt || mem.lastLearnedAt || null;
        sections.push(this._buildDeltaContext(since));

        return sections.filter(function(s) { return s && s.trim(); }).join('\n\n');
    }

    /**
     * INTERACTION: Memory-only context for questions and dictation.
     * NO chart data — works entirely from the memory document.
     * Budget: ~2,000-3,000 chars
     */
    assembleForInteraction(question) {
        var mem = this.pkb.aiMemory;
        if (!mem || !mem.memoryDocument) {
            // Fallback to legacy behavior if no memory document
            return question ? this.assembleForAsk(question) : this.assembleDefault();
        }

        var sections = [];
        var doc = mem.memoryDocument;

        // 1. Patient overview (always)
        sections.push('## PATIENT OVERVIEW\n' + (doc.patientOverview || ''));

        // 2. Safety profile (always)
        if (doc.safetyProfile) {
            var safety = '## SAFETY PROFILE\n';
            if (doc.safetyProfile.allergies && doc.safetyProfile.allergies.length) {
                safety += 'Allergies: ' + doc.safetyProfile.allergies.map(function(a) {
                    return a.substance + ' (' + a.reaction + ') — ' + (a.implications || '');
                }).join('; ') + '\n';
            }
            if (doc.safetyProfile.contraindications && doc.safetyProfile.contraindications.length) {
                safety += 'Contraindications: ' + doc.safetyProfile.contraindications.join('; ') + '\n';
            }
            if (doc.safetyProfile.criticalValues && doc.safetyProfile.criticalValues.length) {
                safety += 'Critical values: ' + doc.safetyProfile.criticalValues.join('; ') + '\n';
            }
            if (doc.safetyProfile.interactions && doc.safetyProfile.interactions.length) {
                safety += 'Interactions: ' + doc.safetyProfile.interactions.join('; ') + '\n';
            }
            sections.push(safety);
        }

        // 3. Relevant problem analysis (filtered by question if provided)
        if (doc.problemAnalysis && doc.problemAnalysis.length) {
            var problems = doc.problemAnalysis;
            if (question) {
                var q = question.toLowerCase();
                problems = problems.filter(function(p) {
                    var text = (p.problem + ' ' + p.status + ' ' + (p.plan || '')).toLowerCase();
                    // Check if any word in the question appears in the problem
                    return q.split(/\s+/).some(function(word) {
                        return word.length > 3 && text.indexOf(word) !== -1;
                    }) || true; // Include all if no specific match (for short questions)
                });
            }
            var probText = '## PROBLEM ANALYSIS\n';
            problems.forEach(function(p) {
                probText += '- **' + p.problem + '** [' + (p.status || 'active') + ', ' + (p.trajectory || 'stable') + ']\n';
                if (p.keyData && p.keyData.length) probText += '  Data: ' + p.keyData.join(', ') + '\n';
                if (p.plan) probText += '  Plan: ' + p.plan + '\n';
            });
            sections.push(probText);
        }

        // 4. Medication rationale (if question mentions meds or always include brief list)
        if (doc.medicationRationale && doc.medicationRationale.length) {
            var medText = '## MEDICATIONS\n';
            doc.medicationRationale.forEach(function(m) {
                medText += '- ' + m.name + ': ' + m.rationale + '\n';
            });
            sections.push(medText);
        }

        // 5. Pending items
        if (doc.pendingItems && doc.pendingItems.length) {
            sections.push('## PENDING\n' + doc.pendingItems.map(function(i) { return '- ' + i; }).join('\n'));
        }

        // 6. Session context (recent interactions)
        if (this.session) {
            var sessionStr = this.session.toContextString();
            if (sessionStr) sections.push(sessionStr);
        }

        return sections.filter(function(s) { return s && s.trim(); }).join('\n\n');
    }

    /**
     * Build delta context string for incremental refresh.
     * Only includes data newer than the given timestamp.
     */
    _buildDeltaContext(sinceTimestamp) {
        var lines = [];
        var since = sinceTimestamp ? new Date(sinceTimestamp).getTime() : 0;

        // New dictation entries
        if (this.pkb.sessionContext && this.pkb.sessionContext.doctorDictation) {
            var newDicts = this.pkb.sessionContext.doctorDictation.filter(function(d) {
                return !sinceTimestamp || (d.timestamp && new Date(d.timestamp).getTime() > since);
            });
            if (newDicts.length > 0) {
                lines.push('NEW DICTATION:\n' + newDicts.map(function(d) { return '- ' + (d.text || d); }).join('\n'));
            }
        }

        // New executed orders
        var mem = this.pkb.aiMemory;
        if (mem && mem.executedActions) {
            var newOrders = mem.executedActions.filter(function(a) {
                return !sinceTimestamp || (a.timestamp && new Date(a.timestamp).getTime() > since);
            });
            if (newOrders.length > 0) {
                lines.push('NEW ORDERS PLACED:\n' + newOrders.map(function(o) { return '- ' + (o.text || JSON.stringify(o)); }).join('\n'));
            }
        }

        // New ambient scribe findings
        var ambientBlock = this.getAmbientFindingsBlock();
        if (ambientBlock) {
            lines.push(ambientBlock);
        }

        // Recent lab/vitals changes (rendered from longitudinal data)
        var recentData = this.getRecentDataBlock();
        if (recentData) {
            lines.push('RECENT DATA:\n' + recentData);
        }

        if (lines.length === 0) return '## DELTA SINCE LAST REVIEW\nNo new data.';
        return '## DELTA SINCE LAST REVIEW\n' + lines.join('\n\n');
    }
}

window.WorkingMemoryAssembler = WorkingMemoryAssembler;
