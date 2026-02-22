/**
 * Context Assembler
 *
 * Builds { systemPrompt, userMessage } pairs for each LLM call type.
 * Replaces the 5 independent prompt-building patterns in ai-coworker.js
 * with a unified system that instructs the LLM to build on accumulated memory.
 *
 * Each interaction type gets:
 * - A role-appropriate system prompt with memory-aware instructions
 * - A user message with assembled working memory + doctor's input
 * - A response format that includes memory-update fields for write-back
 */

class ContextAssembler {
    constructor(workingMemory) {
        this.workingMemory = workingMemory; // WorkingMemoryAssembler
    }

    /**
     * Build the prompt pair for an "Ask AI" question.
     * Uses focused context (~3-5K chars) from working memory.
     */
    buildAskPrompt(question) {
        const context = this.workingMemory.assemble('ask', { question });

        const systemPrompt = `You are an AI clinical assistant helping a physician. You have a PERSISTENT MEMORY of this patient that accumulates across interactions — use it. Don't re-derive what you already know.

Answer their question or help with their task using the clinical context provided. Be concise, clinically relevant, and actionable. Use plain text, not markdown.

After answering, include a brief memory update in this JSON block at the end of your response:

<memory_update>
{
    "patientSummaryUpdate": "Updated 2-3 sentence summary IF this interaction changes your understanding (or null if no change)",
    "problemInsightUpdates": [{"problemId": "id", "insight": "updated understanding"}],
    "interactionDigest": "One-line summary of what you answered"
}
</memory_update>

Only include the memory_update block if you have meaningful updates. If you're just answering a simple factual question, skip it.`;

        const userMessage = `## Clinical Context
${context}

## Physician's Question
${question}`;

        return { systemPrompt, userMessage, maxTokens: 2048 };
    }

    /**
     * Build the prompt pair for dictation synthesis.
     * Uses moderate context (~6-10K chars) from working memory.
     */
    buildDictationPrompt(doctorThoughts) {
        const context = this.workingMemory.assemble('dictate', { dictation: doctorThoughts });

        const systemPrompt = `You are an AI clinical assistant helping a physician manage a patient case. You maintain a PERSISTENT MEMORY of this patient that accumulates across interactions.

Your role:
1. Synthesize the doctor's clinical reasoning with the available patient data
2. Update the case summary, your current thinking, and suggested actions
3. ALWAYS respect and incorporate the doctor's stated assessment and plan
4. Flag any safety concerns but don't override the doctor's decisions
5. Build on your existing understanding — refine, don't restart
6. Be concise and clinically relevant

IMPORTANT: The doctor drives decision-making. You support by organizing information and surfacing relevant data.

Respond in this exact JSON format:
{
    "oneLiner": "A single clinical sentence (~15 words) capturing the current gestalt — what a senior resident would say in 3 seconds at handoff",
    "clinicalSummary": {
        "demographics": "One sentence: age, sex, and key PMH using standard clinical abbreviations (e.g. HFrEF, T2DM, AFib, CKD3b, HTN, HLD, COPD, CAD)",
        "functional": "One sentence: baseline functional status, living situation, social support, occupation",
        "presentation": "One sentence: chief complaint, significant positive exam findings, pertinent negatives, and key abnormal labs/imaging"
    },
    "problemList": [
        {"name": "Most urgent problem first", "urgency": "urgent|active|monitoring", "ddx": "One sentence differential diagnosis if clinically relevant, or null", "plan": "1-2 sentence plan"}
    ],
    "categorizedActions": {
        "communication": ["Talk to patient/nurse actions — e.g. Ask about dietary K intake, Verify med compliance"],
        "labs": ["Lab orders — e.g. Repeat BMP in AM, Check Mg and Phos"],
        "imaging": ["Imaging orders — e.g. CXR to assess volume, or empty array if none needed"],
        "medications": ["Medication changes — e.g. Hold spironolactone, Increase furosemide"],
        "other": ["Other orders — e.g. Cardiology consult, Telemetry monitoring"]
    },
    "summary": "1-2 sentence case summary with **bold** for key diagnoses and decisions",
    "keyConsiderations": [
        {"text": "Safety concern or important clinical factor", "severity": "critical|important|info"}
    ],
    "thinking": "2-4 sentences about patient trajectory. Where is the patient heading? Is the situation improving, worsening, or stable? Include supporting data points.",
    "suggestedActions": ["action 1", "action 2", "action 3", "action 4", "action 5"],
    "observations": ["any new observations based on the data"],
    "trajectoryAssessment": "Brief assessment of each active problem's trajectory (improving, worsening, stable). Include key data points. BUILD ON existing trajectory if present — refine, don't restart.",
    "keyFindings": ["Critical clinical findings that should be remembered across sessions"],
    "openQuestions": ["Unresolved clinical questions that need follow-up"],
    "patientSummaryUpdate": "Your updated 2-3 paragraph mental model of this patient. This becomes YOUR memory — include key diagnoses, current status, recent trajectory, and critical safety concerns. Be comprehensive but concise.",
    "problemInsightUpdates": [{"problemId": "problem_id", "insight": "Your current understanding of this problem's trajectory and significance"}]
}

RULES:
- clinicalSummary.demographics: Use format "72M w/ HFrEF, T2DM, AFib, CKD3b, HTN". Use standard clinical abbreviations. List top 4-5 diagnoses by significance
- clinicalSummary.functional: Pull from social history — mention living situation, who patient lives with, mobility/activity level
- clinicalSummary.presentation: Include chief complaint, significant POSITIVE exam findings (edema, irregular rhythm, JVD, crackles, etc.), pertinent NEGATIVES (no murmur, lungs clear, JVP not elevated, etc.), and key abnormal lab values with arrows
- problemList: 3-5 problems MAX, most urgent first. Include DDx only when differential is clinically meaningful
- categorizedActions: Be specific and actionable. Empty array is fine for categories with no actions needed
- suggestedActions should ALIGN with the doctor's stated plan, not contradict it
- If doctor says "no anticoagulation", don't suggest anticoagulation
- Always consider safety flags when making suggestions
- trajectoryAssessment should BUILD ON any existing trajectory (don't lose prior context, refine it)
- keyFindings should be durable insights, not transient observations
- openQuestions are things that still need to be resolved
- patientSummaryUpdate is YOUR core memory — make it count`;

        const userMessage = `## Clinical Context (with AI Memory)
${context}

## Doctor's Current Assessment/Thoughts
"${doctorThoughts}"

Based on the doctor's thoughts and the clinical context above, provide an updated synthesis. Update the trajectory assessment, key findings, open questions, AND your patient summary based on this new information.`;

        return { systemPrompt, userMessage, maxTokens: 2500 };
    }

    /**
     * Build the prompt pair for a full case refresh.
     * Uses full context (~12-15K chars) from working memory.
     */
    buildRefreshPrompt(dictation) {
        const context = this.workingMemory.assemble('refresh');

        const systemPrompt = `You are an AI clinical assistant embedded in an EHR system. Analyze this patient case and provide a comprehensive synthesis.

You maintain a PERSISTENT MEMORY — a LONGITUDINAL CLINICAL DOCUMENT that persists across sessions. Your insights are written back into this document so they accumulate over time. Think of yourself as building a living understanding of this patient.

This is a FULL REFRESH — analyze everything comprehensively. If you have existing memory, validate and refine it against current data. If this is your first look, build a thorough understanding.

Respond in this exact JSON format:
{
    "oneLiner": "A single clinical sentence (~15 words) capturing the current gestalt — what a senior resident would say in 3 seconds at handoff",
    "clinicalSummary": {
        "demographics": "One sentence: age, sex, and key PMH using standard clinical abbreviations (e.g. HFrEF, T2DM, AFib, CKD3b, HTN, HLD, COPD, CAD)",
        "functional": "One sentence: baseline functional status, living situation, social support, occupation",
        "presentation": "One sentence: chief complaint, significant positive exam findings, pertinent negatives, and key abnormal labs/imaging"
    },
    "problemList": [
        {"name": "Most urgent problem first", "urgency": "urgent|active|monitoring", "ddx": "One sentence differential diagnosis if clinically relevant, or null", "plan": "1-2 sentence plan"}
    ],
    "categorizedActions": {
        "communication": ["Talk to patient/nurse actions"],
        "labs": ["Lab orders"],
        "imaging": ["Imaging orders or empty array"],
        "medications": ["Medication changes"],
        "other": ["Other orders"]
    },
    "summary": "1-2 sentence case summary with **bold** for key diagnoses",
    "keyConsiderations": [
        {"text": "Safety concern or important clinical factor", "severity": "critical|important|info"}
    ],
    "thinking": "2-4 sentences about patient trajectory. Where is the patient heading? Include supporting data points.",
    "suggestedActions": ["action 1", "action 2", "action 3", "action 4", "action 5"],
    "observations": ["key observations from the data"],
    "trajectoryAssessment": "A paragraph synthesizing disease trajectories. For each active problem, describe current status, recent trend, and concerning patterns. This is DURABLE — it persists and gets refined over time.",
    "keyFindings": ["finding 1", "finding 2"],
    "openQuestions": ["question 1", "question 2"],
    "patientSummaryUpdate": "Your comprehensive 2-3 paragraph mental model of this patient. This is your CORE MEMORY. Include: key demographics, primary diagnoses with severity, current clinical status, trajectory for each major problem, relevant history, safety concerns, and any clinical nuances you've detected.",
    "problemInsightUpdates": [{"problemId": "problem_id", "insight": "Comprehensive understanding of this problem"}]
}

Prioritize:
1. Safety concerns and critical values (put these in keyConsiderations with severity "critical")
2. Alignment with doctor's stated assessment (if any)
3. Actionable next steps
4. Things that haven't been addressed yet

RULES:
- clinicalSummary.demographics: Use format "72M w/ HFrEF, T2DM, AFib, CKD3b, HTN". Use standard clinical abbreviations. List top 4-5 diagnoses by significance
- clinicalSummary.functional: Pull from social history — living situation, support system, mobility
- clinicalSummary.presentation: Include chief complaint, significant POSITIVE exam findings, pertinent NEGATIVES, and key abnormal lab values with arrows
- problemList: 3-5 problems MAX, most urgent first. DDx only when differential is meaningful
- categorizedActions: Specific and actionable. Empty array fine for categories with nothing needed
- keyConsiderations should include allergies, contraindications, drug interactions, and clinical concerns
- Use severity "critical" for life-threatening concerns, "important" for significant issues, "info" for context
- trajectoryAssessment should be comprehensive — describe how each problem is trending
- keyFindings should be durable insights worth remembering across sessions
- openQuestions are things that still need to be resolved
- patientSummaryUpdate is your MOST IMPORTANT output — this becomes your memory for all future interactions`;

        const userMessage = `## Full Clinical Context (with AI Memory)
${context}

${dictation ? `## Doctor's Current Assessment\n"${dictation}"` : '## No doctor assessment recorded yet'}

Provide a comprehensive case synthesis. Build a trajectory assessment covering all active problems. Write a thorough patient summary for your persistent memory.`;

        return { systemPrompt, userMessage, maxTokens: 3000 };
    }

    /**
     * Build the prompt pair for clinical note generation.
     * Uses full context from working memory.
     */
    buildNotePrompt(noteType, noteTypeName, includeSources, instructions, chartData, dictation) {
        const context = this.workingMemory.assemble('writeNote');

        const systemPrompt = `You are a physician writing a clinical note in an EHR system. Write a professional, thorough clinical note based on the patient data provided. Use standard medical documentation conventions.

Write the note in plain text with clear section headers. Do NOT use markdown formatting like ** or #. Use UPPERCASE for section headers followed by a colon.

IMPORTANT:
- Be thorough but concise - include clinically relevant details
- Use the patient's actual data from the clinical context
- Include the patient and nurse conversation data if relevant to the clinical picture
- Structure the note according to the requested format
- Write as if you are the attending physician documenting the encounter`;

        // Build the note-specific data section
        let noteData = `Please write a clinical ${noteTypeName} for this patient.\n\n`;

        if (includeSources.vitals && chartData.vitals && chartData.vitals.length > 0) {
            noteData += '## Recent Vitals\n';
            const recent = chartData.vitals.slice(-3);
            recent.forEach(v => {
                noteData += '- HR: ' + (v.hr || v.heartRate || 'N/A') + ', ';
                noteData += 'BP: ' + (v.systolic || v.sbp || '?') + '/' + (v.diastolic || v.dbp || '?') + ', ';
                noteData += 'RR: ' + (v.rr || v.respRate || 'N/A') + ', ';
                noteData += 'SpO2: ' + (v.spo2 || v.o2sat || 'N/A') + '%\n';
            });
            noteData += '\n';
        }

        if (includeSources.labs && chartData.labs && chartData.labs.length > 0) {
            noteData += '## Lab Results\n';
            chartData.labs.forEach(lab => {
                noteData += '- ' + lab.name + ': ' + lab.value + ' ' + (lab.unit || '') + '\n';
            });
            noteData += '\n';
        }

        if (includeSources.meds && chartData.meds && chartData.meds.length > 0) {
            noteData += '## Current Medications\n';
            chartData.meds.forEach(med => {
                noteData += '- ' + med.name + ' ' + (med.dose || '') + ' ' + (med.route || '') + ' ' + (med.frequency || '') + '\n';
            });
            noteData += '\n';
        }

        if (includeSources.nursing && chartData.nursingNotes && chartData.nursingNotes.length > 0) {
            noteData += '## Nursing Notes\n';
            chartData.nursingNotes.slice(-5).forEach(note => {
                noteData += '- ' + note.text + '\n';
            });
            noteData += '\n';
        }

        if (includeSources.dictation && dictation) {
            noteData += '## Doctor\'s Assessment & Thoughts\n';
            noteData += dictation + '\n\n';
        }

        if (instructions) {
            noteData += '\n## Additional Instructions\n' + instructions;
        }

        const userMessage = `## Full Clinical Context
${context}

## Note Request
${noteData}`;

        return { systemPrompt, userMessage, maxTokens: 4096 };
    }

    /**
     * Build the prompt pair for the debug panel context refresh.
     * Uses the same context type as refresh.
     */
    buildDebugContextPrompt() {
        const context = this.workingMemory.assemble('refresh');
        return context;
    }

    /**
     * Parse memory update fields from an LLM response.
     * Handles both JSON responses and ask-style responses with <memory_update> blocks.
     */
    parseMemoryUpdates(responseText) {
        const updates = {
            patientSummaryUpdate: null,
            problemInsightUpdates: [],
            interactionDigest: null
        };

        // Try parsing from <memory_update> block (ask-style responses)
        const memoryBlockMatch = responseText.match(/<memory_update>\s*([\s\S]*?)\s*<\/memory_update>/);
        if (memoryBlockMatch) {
            try {
                const memBlock = JSON.parse(memoryBlockMatch[1]);
                updates.patientSummaryUpdate = memBlock.patientSummaryUpdate || null;
                updates.problemInsightUpdates = memBlock.problemInsightUpdates || [];
                updates.interactionDigest = memBlock.interactionDigest || null;
            } catch (e) {
                console.warn('Failed to parse memory_update block:', e);
            }
        }

        // Try parsing from top-level JSON (dictation/refresh-style responses)
        try {
            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const result = JSON.parse(jsonMatch[0]);
                if (result.patientSummaryUpdate) {
                    updates.patientSummaryUpdate = result.patientSummaryUpdate;
                }
                if (result.problemInsightUpdates && Array.isArray(result.problemInsightUpdates)) {
                    updates.problemInsightUpdates = result.problemInsightUpdates;
                }
            }
        } catch (e) {
            // Not a JSON response — that's fine for ask-style
        }

        return updates;
    }
}

window.ContextAssembler = ContextAssembler;
