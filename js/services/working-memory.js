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

        // 3. Topic-relevant context
        sections.push(this.getRelevantContextForQuestion(question));

        // 4. Session awareness
        if (this.session) {
            sections.push(this.session.toContextString());
        }

        // 5. Previous AI insights (for continuity)
        sections.push(this.getPreviousInsightsBlock());

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
        if (!narrative) return '';

        let text = '';

        if (narrative.trajectoryAssessment) {
            text += `## AI'S TRAJECTORY ASSESSMENT\n${narrative.trajectoryAssessment}\n\n`;
        }
        if (narrative.openQuestions && narrative.openQuestions.length > 0) {
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
}

window.WorkingMemoryAssembler = WorkingMemoryAssembler;
