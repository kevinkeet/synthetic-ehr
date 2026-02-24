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
        "demographics": "One sentence HPI-style: age, sex, key PMH with SPECIFIC clinical qualifiers. E.g. 'HFrEF (EF 35%)', 'T2DM on basal-bolus insulin', 'persistent AFib not on anticoagulation (s/p GI bleed)', 'CKD3b (baseline Cr 1.8-2.2)'",
        "functional": "One sentence: baseline functional status (NYHA class, ADL/IADL dependence, mobility aids, chronic pain, who manages meds/IADLs), living situation, key psychosocial factors",
        "presentation": "One sentence: chief complaint with timeline, significant positive exam findings, pertinent negatives, and key abnormal labs/imaging with actual values"
    },
    "problemList": [
        {"name": "Problem #1 MUST be the chief complaint/presenting symptom (e.g. 'Acute dyspnea'), NOT a specific diagnosis yet", "urgency": "urgent|active|monitoring", "ddx": "REQUIRED for #1: list 2-4 plausible diagnoses with brief reasoning (e.g. 'CHF exacerbation (missed diuretics, volume overload on exam), ACS (age, risk factors, though no chest pain), PE (AFib, immobility), pneumonia (crackles, though afebrile)')", "plan": "1-2 sentence plan"},
        {"name": "Subsequent problems: specific diagnoses or active issues", "urgency": "urgent|active|monitoring", "ddx": "DDx if differential is clinically meaningful, or null", "plan": "1-2 sentence plan"}
    ],
    "categorizedActions": {
        "communication": [{"text": "Ask patient about dietary potassium intake"}, {"text": "Ask nurse for today\\'s I&Os"}],
        "labs": [{"text": "Repeat BMP in 6 hours", "orderType": "lab", "orderData": {"name": "Basic Metabolic Panel", "specimen": "Blood", "priority": "Routine", "indication": "Monitor renal function and electrolytes post-diuresis"}}],
        "imaging": [{"text": "Portable CXR now", "orderType": "imaging", "orderData": {"modality": "X-Ray", "bodyPart": "Chest", "contrast": "Without contrast", "priority": "STAT", "indication": "Evaluate pulmonary edema"}}],
        "medications": [{"text": "Give furosemide 40mg IV x1 now", "orderType": "medication", "orderData": {"name": "Furosemide", "dose": "40 mg", "route": "IV Push", "frequency": "Once", "indication": "Acute decompensated heart failure"}}],
        "other": [{"text": "Consult cardiology", "orderType": "consult", "orderData": {"specialty": "Cardiology", "priority": "Routine", "reason": "Evaluation of acute decompensated HFrEF"}}]
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
    "problemInsightUpdates": [{"problemId": "problem_id", "insight": "Your current understanding of this problem's trajectory and significance"}],
    "memoryClassification": {
        "pendingDecisions": ["Decision or question awaiting physician action — include who raised it"],
        "activeConditions": [{"text": "What's actively evolving right now", "trend": "improving|worsening|stable|new"}],
        "backgroundFacts": ["Stable facts that don't change (e.g. EF 35%, prior GI bleed, baseline Cr)"],
        "supersededObservations": ["Text of any prior AI observations that are now outdated or proven wrong by new data"]
    },
    "conflictsDetected": [
        {"description": "Brief description of any contradiction between existing info and new data", "severity": "critical|warning"}
    ]
}

RULES:
- clinicalSummary.demographics: Write like a REAL HPI opening line. Include SPECIFIC clinical qualifiers for each diagnosis:
  * Heart failure: include EF% and NYHA class (e.g. "HFrEF (EF 35%, NYHA III)")
  * Diabetes: include treatment regimen (e.g. "T2DM on basal-bolus insulin" or "T2DM diet-controlled")
  * A-fib: include anticoagulation status and WHY (e.g. "persistent AFib not on anticoagulation s/p major GI bleed" or "AFib on apixaban")
  * CKD: include baseline Cr/eGFR (e.g. "CKD3b (baseline Cr 1.8)")
  * Any condition where treatment status or severity matters: include it
  * Format example: "72M w/ HFrEF (EF 35%), T2DM on insulin, persistent AFib not on anticoagulation (s/p GI bleed 9/2023), CKD3b (Cr 1.8-2.2)"
- clinicalSummary.functional: This is the SOCIAL/FUNCTIONAL snapshot. Include:
  * Functional class or baseline activity level (e.g. "NYHA class II-III at baseline")
  * ADL/IADL status — who does what (e.g. "independent in ADLs, wife manages meds and IADLs")
  * Chronic pain or symptoms at baseline (e.g. "chronic neuropathic foot pain on gabapentin")
  * Living situation and caregiver (e.g. "lives with wife Patricia who is primary caregiver")
  * Any mobility aids, fall risk, or cognitive concerns
  * Key psychosocial factors (e.g. "brother died in hospital — health anxiety", "possible depression")
  * Format example: "NYHA II-III at baseline, independent in ADLs (uses shower chair), wife manages meds/IADLs, chronic neuropathic foot pain (gabapentin), moderate fall risk, lives with wife Patricia"
- clinicalSummary.presentation: Write like a REAL presentation line. Include:
  * Chief complaint with timeline (e.g. "presenting with 1 week progressive dyspnea")
  * Precipitant if known (e.g. "after running out of furosemide 5-7 days ago")
  * Significant POSITIVE exam findings with specifics (e.g. "JVP elevated to angle of jaw, bibasilar crackles 1/3 up, 3+ pitting edema bilateral LE, S3 gallop")
  * Pertinent NEGATIVES (e.g. "afebrile, no chest pain")
  * Key abnormal lab values with actual numbers (e.g. "BNP 1850, Cr 2.4 (above baseline 1.8), K 5.1")
- problemList: 3-5 problems MAX.
  * Problem #1 MUST ALWAYS be the CHIEF COMPLAINT or presenting symptom (e.g. "Acute dyspnea", "Chest pain", "Altered mental status") — NOT a specific diagnosis. Don't jump to the diagnosis too quickly.
  * Problem #1 MUST ALWAYS have a DDx with 2-4 plausible differential diagnoses, each with brief supporting/refuting evidence from the patient's data
  * Problems #2+ can be specific active diagnoses (e.g. "Hyperkalemia", "AKI on CKD") with plans
  * The DDx for #1 should demonstrate clinical reasoning — what could this be and why?
- categorizedActions: Each action is ONE discrete step — a single verbal order, a single question, a single task. NOT a plan or a category.
  * CRITICAL: Each action = one thing you could say to one person in one sentence. If it has "and" connecting two different tasks, split it into two actions.
  * WRONG: "Consider increasing diuretics" (vague), "Monitor renal function" (not actionable), "Discuss fluid status and potassium" (two things), "Check labs and adjust medications" (two things)
  * RIGHT: "Give furosemide 40mg IV Push x1 now", "Ask patient how many pillows they sleep with", "Repeat BMP in 6 hours"
  * Start each action text with an action verb: Give, Order, Ask, Hold, Start, Stop, Increase, Decrease, Check, Send, Consult, Place
  * TWO types of medication actions:
    - NEW medication orders: use orderType="medication" with orderData (name, dose, route, frequency, indication). Example: {"text": "Give furosemide 40mg IV x1 now", "orderType": "medication", "orderData": {...}}
    - CHANGES to existing meds (hold, stop, discontinue, increase dose, decrease dose, wean, titrate): NO orderType — just {"text": "Hold spironolactone"} or {"text": "Discontinue lisinopril"}. These get routed to the nurse, not the order form.
  * For NEW medication orders: orderType="medication", orderData needs: name, dose, route (PO|IV|IV Push|IV Piggyback|IM|SC|SL|PR|Topical|Inhaled|Intranasal), frequency (Once|Daily|BID|TID|QID|Q2H|Q4H|Q6H|Q8H|Q12H|Q24H|Q4H PRN|Q6H PRN|Q8H PRN|PRN|At bedtime|Continuous), indication
  * For labs: orderType="lab", orderData needs: name (use exact: "Complete Blood Count"|"Basic Metabolic Panel"|"Comprehensive Metabolic Panel"|"Lipid Panel"|"Liver Function Tests"|"Coagulation Panel (PT/INR/PTT)"|"Troponin"|"BNP"|"Pro-BNP"|"Magnesium"|"Phosphorus"|"Lactate"|"Hemoglobin A1c"|"Arterial Blood Gas"|"Urinalysis"|"Blood Culture"), specimen (Blood|Urine|Arterial Blood), priority (Routine|Urgent|STAT), indication
  * For imaging: orderType="imaging", orderData needs: modality (X-Ray|CT|MRI|Ultrasound|Echo|Nuclear Medicine|Fluoroscopy), bodyPart, contrast (Without contrast|With contrast|With and without contrast|N/A), priority (Routine|Urgent|STAT), indication
  * For consults: orderType="consult", orderData needs: specialty (Cardiology|Nephrology|Endocrinology|Pulmonology|Gastroenterology|Neurology|Infectious Disease|Oncology|Rheumatology|Psychiatry|Surgery|Other), priority, reason
  * For nursing orders: orderType="nursing", orderData needs: orderType (Vital Signs|Activity|Diet|I&O Monitoring|Fall Precautions|Isolation|Wound Care|Other), details, priority
  * For communication (asking patient or nurse a question): NO orderType or orderData, just {"text": "Ask patient how many pillows they sleep with"} or {"text": "Ask nurse for most recent urine output"}
  * For med changes (hold/stop/discontinue/increase/decrease): NO orderType, just {"text": "Hold spironolactone until K+ < 5.0"} — these go to nurse chat, not order entry
  * Keep each category to 1-3 items MAX. Quality over quantity. Only the most important next steps.
  * Empty array is fine for categories with no actions needed
- suggestedActions should ALIGN with the doctor's stated plan, not contradict it
- If doctor says "no anticoagulation", don't suggest anticoagulation
- Always consider safety flags when making suggestions
- trajectoryAssessment should BUILD ON any existing trajectory (don't lose prior context, refine it)
- keyFindings should be durable insights, not transient observations
- openQuestions are things that still need to be resolved
- patientSummaryUpdate is YOUR core memory — make it count
- memoryClassification: Classify your observations into three tiers:
  1. pendingDecisions: Actions/questions needing physician response (nurse asks about heparin = pending decision)
  2. activeConditions: Evolving clinical state with trend direction (patient trending toward AKI, volume overload improving)
  3. backgroundFacts: Stable historical information that doesn't change (EF 35%, prior GI bleed history, baseline Cr 1.8)
  List any prior observations now outdated in supersededObservations
- conflictsDetected: Flag any contradictions you notice between existing information and new data (e.g. nurse asking about anticoagulation when it's contraindicated)`;

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
        "demographics": "One sentence HPI-style: age, sex, key PMH with SPECIFIC clinical qualifiers. E.g. 'HFrEF (EF 35%)', 'T2DM on basal-bolus insulin', 'persistent AFib not on anticoagulation (s/p GI bleed)', 'CKD3b (baseline Cr 1.8-2.2)'",
        "functional": "One sentence: baseline functional status (NYHA class, ADL/IADL dependence, chronic pain, who manages meds), living situation, key psychosocial factors",
        "presentation": "One sentence: chief complaint with timeline, significant positive exam findings, pertinent negatives, and key abnormal labs/imaging with actual values"
    },
    "problemList": [
        {"name": "Problem #1 MUST be the chief complaint/presenting symptom (e.g. 'Acute dyspnea'), NOT a specific diagnosis yet", "urgency": "urgent|active|monitoring", "ddx": "REQUIRED for #1: list 2-4 plausible diagnoses with brief reasoning", "plan": "1-2 sentence plan"},
        {"name": "Subsequent problems: specific diagnoses or active issues", "urgency": "urgent|active|monitoring", "ddx": "DDx if meaningful, or null", "plan": "1-2 sentence plan"}
    ],
    "categorizedActions": {
        "communication": [{"text": "Ask patient about dietary potassium intake"}, {"text": "Ask nurse for today\\'s I&Os"}],
        "labs": [{"text": "Repeat BMP in 6 hours", "orderType": "lab", "orderData": {"name": "Basic Metabolic Panel", "specimen": "Blood", "priority": "Routine", "indication": "Monitor renal function and electrolytes"}}],
        "imaging": [{"text": "Portable CXR now", "orderType": "imaging", "orderData": {"modality": "X-Ray", "bodyPart": "Chest", "contrast": "Without contrast", "priority": "STAT", "indication": "Evaluate pulmonary edema"}}],
        "medications": [{"text": "Give furosemide 40mg IV x1 now", "orderType": "medication", "orderData": {"name": "Furosemide", "dose": "40 mg", "route": "IV Push", "frequency": "Once", "indication": "Acute decompensated heart failure"}}],
        "other": [{"text": "Consult cardiology", "orderType": "consult", "orderData": {"specialty": "Cardiology", "priority": "Routine", "reason": "Evaluation of acute decompensated HFrEF"}}]
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
    "problemInsightUpdates": [{"problemId": "problem_id", "insight": "Comprehensive understanding of this problem"}],
    "memoryClassification": {
        "pendingDecisions": ["Decision or question awaiting physician action"],
        "activeConditions": [{"text": "What's actively evolving", "trend": "improving|worsening|stable|new"}],
        "backgroundFacts": ["Stable facts that don't change (e.g. EF 35%, prior GI bleed)"],
        "supersededObservations": ["Text of any prior AI observations now outdated"]
    },
    "conflictsDetected": [
        {"description": "Brief description of any contradiction", "severity": "critical|warning"}
    ]
}

Prioritize:
1. Safety concerns and critical values (put these in keyConsiderations with severity "critical")
2. Alignment with doctor's stated assessment (if any)
3. Actionable next steps
4. Things that haven't been addressed yet

RULES:
- clinicalSummary.demographics: Write like a REAL HPI opening line. Include SPECIFIC clinical qualifiers for each diagnosis:
  * Heart failure: include EF% and NYHA class (e.g. "HFrEF (EF 35%, NYHA III)")
  * Diabetes: include treatment regimen (e.g. "T2DM on basal-bolus insulin" or "T2DM diet-controlled")
  * A-fib: include anticoagulation status and WHY (e.g. "persistent AFib not on anticoagulation s/p major GI bleed")
  * CKD: include baseline Cr/eGFR (e.g. "CKD3b (baseline Cr 1.8)")
  * Any condition where treatment status or severity matters: include it
  * Format example: "72M w/ HFrEF (EF 35%), T2DM on insulin, persistent AFib not on anticoagulation (s/p GI bleed 9/2023), CKD3b (Cr 1.8-2.2)"
- clinicalSummary.functional: This is the SOCIAL/FUNCTIONAL snapshot. Include:
  * Functional class or baseline activity level (e.g. "NYHA class II-III at baseline")
  * ADL/IADL status — who does what (e.g. "independent in ADLs, wife manages meds and IADLs")
  * Chronic pain or symptoms at baseline (e.g. "chronic neuropathic foot pain on gabapentin")
  * Living situation and caregiver (e.g. "lives with wife Patricia who is primary caregiver")
  * Any mobility aids, fall risk, or cognitive concerns
  * Key psychosocial factors (e.g. "brother died in hospital — health anxiety")
  * Format example: "NYHA II-III at baseline, independent in ADLs (uses shower chair), wife manages meds/IADLs, chronic neuropathic foot pain (gabapentin), lives with wife Patricia"
- clinicalSummary.presentation: Write like a REAL presentation line. Include:
  * Chief complaint with timeline (e.g. "presenting with 1 week progressive dyspnea")
  * Precipitant if known (e.g. "after running out of furosemide 5-7 days ago")
  * Significant POSITIVE exam findings with specifics (e.g. "JVP elevated to angle of jaw, bibasilar crackles 1/3 up, 3+ pitting edema bilateral LE, S3 gallop")
  * Pertinent NEGATIVES (e.g. "afebrile, no chest pain")
  * Key abnormal lab values with actual numbers (e.g. "BNP 1850, Cr 2.4 (above baseline 1.8), K 5.1")
- problemList: 3-5 problems MAX.
  * Problem #1 MUST ALWAYS be the CHIEF COMPLAINT or presenting symptom (e.g. "Acute dyspnea", "Chest pain") — NOT a specific diagnosis. Don't jump to the diagnosis too quickly.
  * Problem #1 MUST ALWAYS have a DDx with 2-4 plausible differential diagnoses, each with brief supporting/refuting evidence
  * Problems #2+ can be specific active diagnoses with plans
  * The DDx for #1 should demonstrate clinical reasoning — what could this be and why?
- categorizedActions: Each action is ONE discrete step — a single verbal order, a single question, a single task. NOT a plan or a category.
  * CRITICAL: Each action = one thing you could say to one person in one sentence. If it has "and" connecting two different tasks, split it into two actions.
  * WRONG: "Consider increasing diuretics" (vague), "Monitor renal function" (not actionable), "Discuss fluid status and potassium" (two things)
  * RIGHT: "Give furosemide 40mg IV Push x1 now", "Ask patient how many pillows they sleep with", "Repeat BMP in 6 hours"
  * Start each action text with an action verb: Give, Order, Ask, Hold, Start, Stop, Increase, Decrease, Check, Send, Consult, Place
  * TWO types of medication actions:
    - NEW medication orders: use orderType="medication" with orderData. Example: {"text": "Give furosemide 40mg IV x1 now", "orderType": "medication", "orderData": {...}}
    - CHANGES to existing meds (hold, stop, discontinue, increase dose, decrease dose, wean, titrate): NO orderType — just {"text": "Hold spironolactone"} or {"text": "Discontinue lisinopril"}. These go to nurse chat.
  * For NEW medication orders: orderType="medication", orderData={name, dose, route (PO|IV|IV Push|IV Piggyback|IM|SC|SL|PR|Topical|Inhaled|Intranasal), frequency (Once|Daily|BID|TID|QID|Q2H|Q4H|Q6H|Q8H|Q12H|Q24H|PRN|Continuous), indication}
  * For labs: orderType="lab", orderData={name (exact match: "Complete Blood Count"|"Basic Metabolic Panel"|"Comprehensive Metabolic Panel"|"Lipid Panel"|"Liver Function Tests"|"Coagulation Panel (PT/INR/PTT)"|"Troponin"|"BNP"|"Pro-BNP"|"Magnesium"|"Phosphorus"|"Lactate"|"Hemoglobin A1c"|"Arterial Blood Gas"|"Urinalysis"|"Blood Culture"), specimen (Blood|Urine|Arterial Blood), priority (Routine|Urgent|STAT), indication}
  * For imaging: orderType="imaging", orderData={modality (X-Ray|CT|MRI|Ultrasound|Echo|Nuclear Medicine|Fluoroscopy), bodyPart, contrast (Without contrast|With contrast|With and without contrast|N/A), priority (Routine|Urgent|STAT), indication}
  * For consults: orderType="consult", orderData={specialty (Cardiology|Nephrology|Endocrinology|Pulmonology|Gastroenterology|Neurology|Infectious Disease|Oncology|Rheumatology|Psychiatry|Surgery|Other), priority, reason}
  * For nursing orders: orderType="nursing", orderData={orderType (Vital Signs|Activity|Diet|I&O Monitoring|Fall Precautions), details, priority}
  * For communication (asking patient/nurse a question): just {"text": "Ask patient how many pillows they sleep with"} — NO orderType
  * For med changes (hold/stop/discontinue/increase/decrease): just {"text": "Hold spironolactone until K+ < 5.0"} — NO orderType
  * Keep each category to 1-3 items MAX. Quality over quantity.
  * Empty array fine for categories with nothing needed
- keyConsiderations should include allergies, contraindications, drug interactions, and clinical concerns
- Use severity "critical" for life-threatening concerns, "important" for significant issues, "info" for context
- trajectoryAssessment should be comprehensive — describe how each problem is trending
- keyFindings should be durable insights worth remembering across sessions
- openQuestions are things that still need to be resolved
- patientSummaryUpdate is your MOST IMPORTANT output — this becomes your memory for all future interactions
- memoryClassification: Classify observations into three tiers:
  1. pendingDecisions: Actions/questions needing physician response
  2. activeConditions: Evolving clinical state with trend direction
  3. backgroundFacts: Stable historical information that doesn't change
  List prior observations now outdated in supersededObservations
- conflictsDetected: Flag contradictions between existing and new information`;

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

        // Get real date/time for note
        const simTime = typeof SimulationEngine !== 'undefined' && SimulationEngine.getSimulatedTime
            ? SimulationEngine.getSimulatedTime() : null;
        const noteDate = simTime ? new Date(simTime) : new Date();
        const noteDateStr = noteDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
        const noteTimeStr = noteDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
        const patientName = (typeof window !== 'undefined' && window.PatientHeader?.currentPatient?.name) || 'Robert Morrison';

        const systemPrompt = `You are a physician writing a clinical note in an EHR system. Write a professional, thorough clinical note based on the patient data provided. Use standard medical documentation conventions.

Write the note in plain text with clear section headers. Do NOT use markdown formatting like ** or #. Use UPPERCASE for section headers followed by a colon.

IMPORTANT:
- Be thorough but concise - include clinically relevant details
- Use the patient's actual data from the clinical context
- Include the patient and nurse conversation data if relevant to the clinical picture
- Structure the note according to the requested format
- Write as if you are the attending physician documenting the encounter
- The current date is ${noteDateStr} and the time is ${noteTimeStr}
- The attending physician is Dr. Sarah Chen
- The patient's name is ${patientName}
- Do NOT use placeholder brackets like [Current Date], [Physician Name], [Patient Name], or [Date and Time] — always use the actual values provided above`;

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
            interactionDigest: null,
            memoryClassification: null,
            conflictsDetected: []
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
                // Extract memory classification (active/passive/background)
                if (result.memoryClassification) {
                    updates.memoryClassification = result.memoryClassification;
                }
                // Extract detected conflicts
                if (result.conflictsDetected && Array.isArray(result.conflictsDetected)) {
                    updates.conflictsDetected = result.conflictsDetected;
                }
            }
        } catch (e) {
            // Not a JSON response — that's fine for ask-style
        }

        return updates;
    }
}

window.ContextAssembler = ContextAssembler;
