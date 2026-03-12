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
        // Use memory-based context when available (much cheaper)
        const hasMemory = this.workingMemory.longitudinalDoc?.aiMemory?.memoryDocument;
        const context = hasMemory
            ? this.workingMemory.assembleForInteraction(question)
            : this.workingMemory.assemble('ask', { question });
        const mode = typeof AIModeConfig !== 'undefined' ? AIModeConfig.getMode() : null;

        let systemPrompt = `You are an AI clinical assistant helping a physician. You have a PERSISTENT MEMORY of this patient that accumulates across interactions — use it. Don't re-derive what you already know.

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

        // Inject mode personality prefix
        if (mode && mode.responseStyle.personalityPrefix) {
            systemPrompt = mode.responseStyle.personalityPrefix + '\n\n' + systemPrompt;
        }

        const userMessage = `## Clinical Context
${context}

## Physician's Question
${question}`;

        const maxTokens = mode ? mode.responseStyle.maxTokensAsk : 2048;
        return { systemPrompt, userMessage, maxTokens };
    }

    /**
     * Build the prompt pair for dictation synthesis.
     * Uses moderate context (~6-10K chars) from working memory.
     */
    buildDictationPrompt(doctorThoughts) {
        // Use memory-based context when available (much cheaper)
        const hasMemory = this.workingMemory.longitudinalDoc?.aiMemory?.memoryDocument;
        const context = hasMemory
            ? this.workingMemory.assembleForInteraction(doctorThoughts)
            : this.workingMemory.assemble('dictate', { dictation: doctorThoughts });
        const mode = typeof AIModeConfig !== 'undefined' ? AIModeConfig.getMode() : null;

        let systemPrompt = `You are an AI clinical assistant helping a physician manage a patient case. You maintain a PERSISTENT MEMORY of this patient that accumulates across interactions.

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
    "glassesDisplay": {
        "leftLens": [
            {"title": "PATIENT", "lines": ["73M HFrEF EF25% CKD3b T2DM AFib", "Dyspnea+fatigue x3d, orthopnea", "8lb wt gain, 3+ LE edema, JVP up", "BNP>2000 Cr2.4(↑1.8) K5.8", "Volume overloaded → IV diuresis"]},
            {"title": "PROBLEMS", "lines": ["! ADHF exacerb - diuresis+echo", "! AKI on CKD - Cr1.8→2.4 monitor", "! HyperK 5.8 - kayexalate,hold K+", "  AFib - rate ctrl, on anticoag", "~ T2DM - hold metformin for AKI"]},
            {"title": "ALERTS", "lines": ["⚠ K+ 5.8 CRITICAL", "⚠ PCN allergy ANAPHYLAXIS", "⚠ Cr trending ↑ 1.8→2.4", "⚠ On anticoag - fall risk", ""]}
        ],
        "rightLens": [
            {"title": "ORDERS", "lines": ["STAT: BMP CBC Trop BNP Lactate", "IMG: CXR portable, TTE", "RX: Lasix 40mg IV now", "RX: Kayexalate 15g PO x1", "HOLD: spironolactone, metformin"]},
            {"title": "COMMS", "lines": ["ASK PT: dietary Na+ intake?", "ASK PT: med compliance?", "NOTIFY: attending re K+ 5.8", "", ""]}
        ]
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
- conflictsDetected: Flag any contradictions you notice between existing information and new data (e.g. nurse asking about anticoagulation when it's contraindicated)
- glassesDisplay: This is for a smart glasses HUD (Even Realities G1). CRITICAL formatting rules:
  * Each screen has a "title" (category label) and exactly 5 "lines" (pad empty strings if needed)
  * Each line MUST be ≤45 characters. Truncate aggressively — use abbreviations freely (pt, hx, dx, rx, tx, sx, w/, w/o, s/p, c/o, ↑, ↓, →, +, &)
  * leftLens: Screen 1 "PATIENT" = ultra-dense clinical snapshot (demographics+presentation+key values in 5 lines). Screen 2 "PROBLEMS" = top 5 problems with urgency prefix (! urgent, ~ monitoring, space for active) + abbreviated plan. Screen 3 "ALERTS" = critical safety flags only (allergies, critical values, contraindications). Omit ALERTS screen if no critical items.
  * rightLens: Screen 1 "ORDERS" = ALL pending orders compressed into 5 lines using category prefixes (STAT:, IMG:, RX:, HOLD:, CONSULT:). Pack multiple items per line with commas. Screen 2 "COMMS" = questions to ask patient/nurse/team, prefixed (ASK PT:, ASK RN:, NOTIFY:). Omit COMMS screen if no communication items.
  * This is the MOST IMPORTANT display — a doctor glances at this during patient care. Prioritize: (1) safety-critical info, (2) actionable orders, (3) key clinical values with trends
  * Use ↑↓ for trends, actual values not ranges, bold abbreviations. Every character counts.`;

        // Inject mode personality prefix
        if (mode && mode.responseStyle.personalityPrefix) {
            systemPrompt = mode.responseStyle.personalityPrefix + '\n\n' + systemPrompt;
        }

        // Inject per-mode section-specific instructions
        if (mode && typeof AIModeConfig !== 'undefined') {
            var sectionInstructions = '\nSECTION-SPECIFIC INSTRUCTIONS (follow these for how to format each section):\n' +
                '- Clinical Summary: ' + AIModeConfig.getModePromptSection(mode.id, 'summary') + '\n' +
                '- Problem List: ' + AIModeConfig.getModePromptSection(mode.id, 'problemList') + '\n' +
                '- Suggested Actions / categorizedActions: ' + AIModeConfig.getModePromptSection(mode.id, 'actions') + '\n';
            systemPrompt = systemPrompt.replace(
                'Respond in this exact JSON format:',
                sectionInstructions + '\nRespond in this exact JSON format:'
            );
        }

        // Inject DDx challenge field into JSON format (Proactive mode)
        if (mode && mode.responseStyle.includeDDxChallenge) {
            systemPrompt = systemPrompt.replace(
                '"conflictsDetected"',
                '"ddxChallenge": "A brief challenge to the differential — what else should be considered and why?",\n    "conflictsDetected"'
            );
        }

        // Inject teaching points field into JSON format (if enabled)
        if (mode && mode.responseStyle.includeTeachingPoints) {
            systemPrompt = systemPrompt.replace(
                '"conflictsDetected"',
                '"teachingPoints": ["Clinical pearl or evidence-based insight relevant to this case"],\n    "conflictsDetected"'
            );
        }

        // Build executed actions context if available
        const executedActionsBlock = this._getExecutedActionsBlock();

        // Build selective memory merge block if previous summary was degraded
        const mergeBlock = this._getMemoryMergeBlock();

        // Build outcome context block
        const outcomeBlock = this._getOutcomeTrackingBlock();

        // Build scored findings context block
        const scoredFindingsBlock = this._getScoredFindingsBlock();

        // Build ambient scribe context block
        const ambientBlock = this._getAmbientFindingsBlock();

        const userMessage = `## Clinical Context (with AI Memory)
${context}
${executedActionsBlock}${mergeBlock}${outcomeBlock}${scoredFindingsBlock}${ambientBlock}
## Doctor's Current Assessment/Thoughts
"${doctorThoughts}"

Based on the doctor's thoughts and the clinical context above, provide an updated synthesis. Update the trajectory assessment, key findings, open questions, AND your patient summary based on this new information. Do NOT re-suggest actions that have already been completed (see "Already Completed Actions" above if present).${mergeBlock ? ' IMPORTANT: Your patientSummaryUpdate MUST be comprehensive — merge all important details from both the previous and current understanding. Do NOT lose information.' : ''}`;

        const maxTokens = mode ? mode.responseStyle.maxTokensDictation : 2500;
        return { systemPrompt, userMessage, maxTokens };
    }

    /**
     * Build the prompt pair for a full case refresh.
     * Uses full context (~12-15K chars) from working memory.
     */
    buildRefreshPrompt(dictation) {
        const context = this.workingMemory.assemble('refresh');
        const mode = typeof AIModeConfig !== 'undefined' ? AIModeConfig.getMode() : null;

        let systemPrompt = `You are an AI clinical assistant embedded in an EHR. Analyze this patient and provide a synthesis.

You maintain PERSISTENT MEMORY via a longitudinal clinical document. Your insights accumulate over time.

Be CONCISE throughout. Write like an efficient attending at handoff, not a textbook. Use clinical shorthand and abbreviations freely. Every word should earn its place.

Respond in this exact JSON format:
{
    "oneLiner": "~10 word gestalt — what you'd say in 2 seconds at signout",
    "clinicalSummary": {
        "demographics": "HPI opener: age, sex, key PMH w/ clinical qualifiers. E.g. '72M w/ HFrEF (EF 35%), T2DM on insulin, AFib (not anticoagulated s/p GI bleed), CKD3b (Cr 1.8)'",
        "functional": "Key functional status + living situation in one short sentence",
        "presentation": "CC + timeline, key exam findings, pertinent negatives, key abnormal labs w/ values"
    },
    "problemList": [
        {"name": "Chief complaint (e.g. 'Acute dyspnea')", "urgency": "urgent|active|monitoring", "ddx": "2-4 diagnoses w/ brief reasoning", "plan": "One sentence plan"},
        {"name": "Active problem", "urgency": "urgent|active|monitoring", "ddx": "DDx if meaningful, or null", "plan": "One sentence plan"}
    ],
    "categorizedActions": {
        "communication": [{"text": "Ask patient about dietary K+ intake"}],
        "labs": [{"text": "Repeat BMP in 6h", "orderType": "lab", "orderData": {"name": "Basic Metabolic Panel", "specimen": "Blood", "priority": "Routine", "indication": "Monitor renal function"}}],
        "imaging": [{"text": "Portable CXR now", "orderType": "imaging", "orderData": {"modality": "X-Ray", "bodyPart": "Chest", "contrast": "Without contrast", "priority": "STAT", "indication": "Evaluate pulmonary edema"}}],
        "medications": [{"text": "Furosemide 40mg IV x1 now", "orderType": "medication", "orderData": {"name": "Furosemide", "dose": "40 mg", "route": "IV Push", "frequency": "Once", "indication": "ADHF"}}],
        "other": [{"text": "Consult cardiology", "orderType": "consult", "orderData": {"specialty": "Cardiology", "priority": "Routine", "reason": "Acute decompensated HFrEF"}}]
    },
    "summary": "One sentence with **bold** for key diagnoses",
    "keyConsiderations": [
        {"text": "Safety concern", "severity": "critical|important|info"}
    ],
    "thinking": "1-2 sentences on trajectory — where is the patient heading?",
    "suggestedActions": ["top 3 most important next steps only"],
    "observations": ["key observations"],
    "trajectoryAssessment": "2-3 sentences MAX. Concise trajectory for active problems — status, trend, concerns.",
    "keyFindings": ["durable findings worth remembering"],
    "openQuestions": ["unresolved questions"],
    "patientSummaryUpdate": "One concise paragraph: key demographics, diagnoses w/ severity, current status, trajectory, safety concerns. This is your CORE MEMORY.",
    "problemInsightUpdates": [{"problemId": "problem_id", "insight": "Brief insight"}],
    "memoryClassification": {
        "pendingDecisions": ["Awaiting physician action"],
        "activeConditions": [{"text": "What's evolving", "trend": "improving|worsening|stable|new"}],
        "backgroundFacts": ["Stable facts (EF 35%, prior GI bleed)"],
        "supersededObservations": ["Prior observations now outdated"]
    },
    "glassesDisplay": {
        "leftLens": [
            {"title": "PATIENT", "lines": ["73M HFrEF EF25% CKD3b T2DM AFib", "Dyspnea+fatigue x3d, orthopnea", "8lb wt gain, 3+ LE edema, JVP up", "BNP>2000 Cr2.4(↑1.8) K5.8", "Volume overloaded → IV diuresis"]},
            {"title": "PROBLEMS", "lines": ["! ADHF exacerb - diuresis+echo", "! AKI on CKD - Cr1.8→2.4 monitor", "! HyperK 5.8 - kayexalate,hold K+", "  AFib - rate ctrl, on anticoag", "~ T2DM - hold metformin for AKI"]},
            {"title": "ALERTS", "lines": ["⚠ K+ 5.8 CRITICAL", "⚠ PCN allergy ANAPHYLAXIS", "⚠ Cr trending ↑ 1.8→2.4", "⚠ On anticoag - fall risk", ""]}
        ],
        "rightLens": [
            {"title": "ORDERS", "lines": ["STAT: BMP CBC Trop BNP Lactate", "IMG: CXR portable, TTE", "RX: Lasix 40mg IV now", "RX: Kayexalate 15g PO x1", "HOLD: spironolactone, metformin"]},
            {"title": "COMMS", "lines": ["ASK PT: dietary Na+ intake?", "ASK PT: med compliance?", "NOTIFY: attending re K+ 5.8", "", ""]}
        ]
    },
    "conflictsDetected": [
        {"description": "Contradiction found", "severity": "critical|warning"}
    ]
}

Prioritize:
1. Safety concerns and critical values
2. Alignment with doctor's stated assessment
3. Actionable next steps
4. Things not yet addressed

RULES:
- clinicalSummary.demographics: Real HPI opener w/ specific qualifiers — include EF%, treatment regimen, anticoagulation status, baseline Cr. Format: "72M w/ HFrEF (EF 35%), T2DM on insulin, AFib not anticoagulated (s/p GI bleed), CKD3b (Cr 1.8)"
- clinicalSummary.functional: One short sentence — functional class, ADL status, living situation. E.g. "NYHA II-III, independent ADLs, wife manages meds, lives at home"
- clinicalSummary.presentation: CC w/ timeline, key positive/negative exam findings, abnormal labs w/ values. E.g. "1wk progressive dyspnea, JVP elevated, bibasilar crackles, 3+ LE edema, BNP 1850, Cr 2.4"
- problemList: 3-5 problems MAX. #1 = chief complaint (NOT diagnosis) w/ DDx. Plans = one sentence each — a verbal order, not a paragraph
- categorizedActions: One discrete step per action. Action verb first (Give, Order, Ask, Hold, Start, Stop, Check, Consult). 1-3 items per category MAX.
  * NEW meds: orderType="medication", orderData={name, dose, route (PO|IV|IV Push|IV Piggyback|IM|SC|SL|PR|Topical|Inhaled|Intranasal), frequency (Once|Daily|BID|TID|QID|Q2H|Q4H|Q6H|Q8H|Q12H|Q24H|PRN|Continuous), indication}
  * Med CHANGES (hold/stop/increase/decrease): just {"text": "Hold spironolactone"} — NO orderType
  * Labs: orderType="lab", orderData={name, specimen (Blood|Urine|Arterial Blood), priority (Routine|Urgent|STAT), indication}
  * Imaging: orderType="imaging", orderData={modality (X-Ray|CT|MRI|Ultrasound|Echo|Nuclear Medicine|Fluoroscopy), bodyPart, contrast, priority, indication}
  * Consults: orderType="consult", orderData={specialty, priority, reason}
  * Nursing: orderType="nursing", orderData={orderType, details, priority}
  * Communication: just {"text": "Ask patient..."} — NO orderType
- keyConsiderations: allergies, contraindications, drug interactions. Use "critical" for life-threatening only
- patientSummaryUpdate: your CORE MEMORY — one concise paragraph, not multiple
- memoryClassification: pendingDecisions, activeConditions (w/ trend), backgroundFacts, supersededObservations
- conflictsDetected: flag contradictions between existing and new data
- glassesDisplay: This is for a smart glasses HUD (Even Realities G1). CRITICAL formatting rules:
  * Each screen has a "title" (category label) and exactly 5 "lines" (pad empty strings if needed)
  * Each line MUST be ≤45 characters. Truncate aggressively — use abbreviations freely (pt, hx, dx, rx, tx, sx, w/, w/o, s/p, c/o, ↑, ↓, →, +, &)
  * leftLens: Screen 1 "PATIENT" = ultra-dense clinical snapshot (demographics+presentation+key values in 5 lines). Screen 2 "PROBLEMS" = top 5 problems with urgency prefix (! urgent, ~ monitoring, space for active) + abbreviated plan. Screen 3 "ALERTS" = critical safety flags only (allergies, critical values, contraindications). Omit ALERTS screen if no critical items.
  * rightLens: Screen 1 "ORDERS" = ALL pending orders compressed into 5 lines using category prefixes (STAT:, IMG:, RX:, HOLD:, CONSULT:). Pack multiple items per line with commas. Screen 2 "COMMS" = questions to ask patient/nurse/team, prefixed (ASK PT:, ASK RN:, NOTIFY:). Omit COMMS screen if no communication items.
  * This is the MOST IMPORTANT display — a doctor glances at this during patient care. Prioritize: (1) safety-critical info, (2) actionable orders, (3) key clinical values with trends
  * Use ↑↓ for trends, actual values not ranges, bold abbreviations. Every character counts.`;

        // Inject mode personality prefix
        if (mode && mode.responseStyle.personalityPrefix) {
            systemPrompt = mode.responseStyle.personalityPrefix + '\n\n' + systemPrompt;
        }

        // Inject per-mode section-specific instructions
        if (mode && typeof AIModeConfig !== 'undefined') {
            var sectionInstructions = '\nSECTION-SPECIFIC INSTRUCTIONS (follow these for how to format each section):\n' +
                '- Clinical Summary: ' + AIModeConfig.getModePromptSection(mode.id, 'summary') + '\n' +
                '- Problem List: ' + AIModeConfig.getModePromptSection(mode.id, 'problemList') + '\n' +
                '- Suggested Actions / categorizedActions: ' + AIModeConfig.getModePromptSection(mode.id, 'actions') + '\n';
            systemPrompt = systemPrompt.replace(
                'Respond in this exact JSON format:',
                sectionInstructions + '\nRespond in this exact JSON format:'
            );
        }

        // Inject DDx challenge field into JSON format (Proactive mode)
        if (mode && mode.responseStyle.includeDDxChallenge) {
            systemPrompt = systemPrompt.replace(
                '"conflictsDetected"',
                '"ddxChallenge": "A brief challenge to the differential — what else should be considered and why?",\n    "conflictsDetected"'
            );
        }

        // Inject teaching points field into JSON format (if enabled)
        if (mode && mode.responseStyle.includeTeachingPoints) {
            systemPrompt = systemPrompt.replace(
                '"conflictsDetected"',
                '"teachingPoints": ["Clinical pearl or evidence-based insight relevant to this case"],\n    "conflictsDetected"'
            );
        }

        // Build executed actions context if available
        const executedActionsBlock = this._getExecutedActionsBlock();
        const mergeBlock = this._getMemoryMergeBlock();
        const outcomeBlock = this._getOutcomeTrackingBlock();
        const scoredFindingsBlock = this._getScoredFindingsBlock();
        const ambientBlock = this._getAmbientFindingsBlock();

        const userMessage = `## Full Clinical Context (with AI Memory)
${context}
${executedActionsBlock}${mergeBlock}${outcomeBlock}${scoredFindingsBlock}${ambientBlock}
${dictation ? `## Doctor's Current Assessment\n"${dictation}"` : '## No doctor assessment recorded yet'}

Provide a concise case synthesis. Be brief and clinical — no filler. Do NOT re-suggest actions that have already been completed (see "Already Completed Actions" above if present).${mergeBlock ? ' IMPORTANT: Your patientSummaryUpdate MUST be comprehensive — merge all important details from both the previous and current understanding.' : ''}`;

        const maxTokens = mode ? mode.responseStyle.maxTokensRefresh : 3000;
        return { systemPrompt, userMessage, maxTokens };
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

        if (includeSources.ambientConversation && typeof AmbientScribe !== 'undefined') {
            var ambientData = AmbientScribe.getConversationForNote();
            if (ambientData) {
                noteData += '## Ambient Scribe \u2014 Doctor-Patient Conversation\n';
                noteData += ambientData + '\n\n';
            }
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

    /**
     * Build a context block of already-completed actions so the LLM doesn't re-suggest them.
     * Pulls from AICoworker.state.executedActions if available.
     * @returns {string} A formatted block or empty string if no actions completed.
     */
    _getExecutedActionsBlock() {
        if (typeof AICoworker === 'undefined' || !AICoworker.state || !AICoworker.state.executedActions) {
            return '';
        }
        const actions = AICoworker.state.executedActions;
        if (!actions || actions.length === 0) return '';

        const lines = actions.map(function(a) {
            var timeStr = '';
            if (a.timestamp) {
                try {
                    var d = new Date(a.timestamp);
                    timeStr = ' (' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ')';
                } catch(e) {}
            }
            return '- [DONE] ' + a.text + timeStr;
        });

        return '\n## Already Completed Actions (do NOT re-suggest these)\n' + lines.join('\n') + '\n';
    }

    /**
     * Build a selective memory merge block when the previous summary was longer/better.
     * Includes both old and new summaries so the LLM can merge them.
     */
    _getMemoryMergeBlock() {
        if (typeof AICoworker === 'undefined' || !AICoworker.longitudinalDoc) return '';
        const mem = AICoworker.longitudinalDoc.aiMemory;
        if (!mem || !mem.previousSummary || !mem._summaryDegraded) return '';

        return `\n## ⚠ MEMORY MERGE REQUIRED
Your previous patient summary was more comprehensive than your latest update. You MUST merge both versions below into your new patientSummaryUpdate — do not lose any important clinical details.

### Previous Summary (more comprehensive):
${mem.previousSummary}

### Latest Summary (may be missing details):
${mem.patientSummary}

Your patientSummaryUpdate should incorporate ALL important details from both versions.\n`;
    }

    /**
     * Build an outcome tracking context block showing suggestion → order → result chains.
     * Helps the LLM understand what happened after its suggestions were followed.
     */
    _getOutcomeTrackingBlock() {
        if (typeof AICoworker === 'undefined' || !AICoworker.longitudinalDoc) return '';
        const outcomes = AICoworker.longitudinalDoc.aiMemory.suggestionOutcomes || [];
        if (outcomes.length === 0) return '';

        const relevant = outcomes.filter(o => o.status === 'result_available' || o.status === 'awaiting_result');
        if (relevant.length === 0) return '';

        const lines = relevant.map(function(o) {
            if (o.status === 'result_available') {
                return '- ✅ Suggested: "' + o.suggestion + '" → Ordered → Result: ' + o.resultText;
            } else {
                return '- ⏳ Suggested: "' + o.suggestion + '" → Ordered → Awaiting result';
            }
        });

        return '\n## Suggestion Outcomes (your previous recommendations and their results)\n' + lines.join('\n') + '\n';
    }

    /**
     * Build a scored findings context block showing confidence-weighted findings.
     * Higher confidence findings appear first and are marked as confirmed if doctor-validated.
     */
    _getScoredFindingsBlock() {
        if (typeof AICoworker === 'undefined' || !AICoworker.longitudinalDoc) return '';
        const scored = AICoworker.longitudinalDoc.scoredFindings || [];
        if (scored.length === 0) return '';

        // Only include findings above threshold
        const significant = scored.filter(f => f.confidence > 0.3);
        if (significant.length === 0) return '';

        const lines = significant.slice(0, 10).map(function(f) {
            const conf = Math.round(f.confidence * 100);
            const badge = f.confirmed ? ' [DOCTOR-CONFIRMED]' : '';
            const reinforced = f.reinforcementCount > 0 ? ' (×' + (f.reinforcementCount + 1) + ')' : '';
            return '- [' + conf + '%] ' + f.text + badge + reinforced;
        });

        return '\n## Key Clinical Findings (confidence-scored, doctor-gated)\n' + lines.join('\n') + '\n';
    }

    /**
     * Build an ambient scribe findings context block.
     * Includes a compact summary of what the AI overheard from the doctor-patient conversation.
     * @returns {string} A formatted block or empty string if no ambient data.
     */
    _getAmbientFindingsBlock() {
        if (typeof AmbientScribe === 'undefined') return '';

        const contextBlock = AmbientScribe.getAmbientContextBlock();
        if (!contextBlock) return '';

        return '\n## Ambient Scribe \u2014 Overheard Conversation Summary\n' +
            '(Extracted from doctor-patient conversation — use to inform your analysis)\n' +
            contextBlock + '\n';
    }

    // =====================================================
    // LEARN / REFRESH / INTERACT / ORDER SAFETY PROMPTS
    // =====================================================

    /**
     * Build prompt for "Learn About Patient" — comprehensive chart digest.
     * Sends the FULL chart to build a structured memory document.
     * Model: Sonnet (quality matters). Max tokens: 4096.
     */
    buildLearnPrompt() {
        const chartContext = this.workingMemory.assembleForLearn();

        const systemPrompt = `You are an AI clinical co-pilot reading a patient's complete chart for the first time. Your task is to build a comprehensive structured MEMORY DOCUMENT that will be your persistent memory for ALL future interactions with this patient's physician.

This memory document must be thorough enough that you can answer clinical questions, suggest orders, and catch safety issues WITHOUT re-reading the chart. Think of it as your mental model after a detailed chart review.

Read the chart carefully and produce this EXACT JSON structure:

{
    "patientOverview": "3-4 paragraph comprehensive mental model. Include: demographics, chief complaint, HPI, key PMH with clinical qualifiers (EF%, baseline Cr, A1c, NYHA class), social/functional status, and current clinical trajectory. Write as a clinician would think about this patient.",
    "problemAnalysis": [
        {
            "problem": "Problem name",
            "status": "active|stable|acute|chronic|resolving",
            "trajectory": "improving|worsening|stable|fluctuating",
            "keyData": ["Key lab values, imaging findings, exam findings relevant to this problem"],
            "plan": "Current/recommended management plan",
            "medRationale": "Why the patient is on specific meds for this problem"
        }
    ],
    "safetyProfile": {
        "allergies": [{"substance": "...", "reaction": "...", "implications": "Clinical implications — what to avoid"}],
        "contraindications": ["Specific drugs/classes contraindicated and why"],
        "criticalValues": ["Any critical lab values or vital signs with clinical significance"],
        "interactions": ["Significant drug-drug or drug-disease interactions to watch"]
    },
    "medicationRationale": [
        {"name": "Med name + dose + frequency", "indication": "What it's for", "rationale": "Why this specific med/dose — clinical reasoning"}
    ],
    "pendingItems": ["Pending results, decisions, follow-ups, questions to resolve"],
    "clinicalGestalt": "One-line clinical gestalt — what is the story of this patient right now?"
}

RULES:
- problemAnalysis: Include ALL active problems, ordered by acuity. Include clinical qualifiers (EF%, baseline Cr, etc.)
- safetyProfile: Be EXHAUSTIVE — this is safety-critical. Include cross-reactivity implications (e.g., PCN allergy → avoid cephalosporins in severe cases)
- medicationRationale: Include EVERY current medication with reasoning. If the reason is unclear from the chart, note that.
- pendingItems: Include anything that needs follow-up, is awaited, or is unresolved
- clinicalGestalt: This is the "elevator pitch" — what would you tell a covering physician?

Respond with ONLY the JSON, no preamble or markdown fences.`;

        const userMessage = `Here is the complete patient chart. Build your memory document:\n\n${chartContext}`;

        return {
            systemPrompt,
            userMessage,
            maxTokens: 4096
        };
    }

    /**
     * Build prompt for incremental memory refresh.
     * Sends existing memory + delta data for the AI to update.
     * Model: Haiku (existing memory provides context). Max tokens: 2048.
     */
    buildRefreshMemoryPrompt() {
        const refreshContext = this.workingMemory.assembleForIncrementalRefresh();

        const systemPrompt = `You previously learned this patient and built a memory document. New data has arrived since your last review. Update your memory document to reflect the new information.

RULES:
- Preserve everything from your current memory that is still accurate
- Update any values, statuses, or trajectories that have changed based on new data
- Add new problems, findings, or orders that weren't in your memory
- Update pendingItems (remove resolved items, add new pending items)
- If new data contradicts your memory, update your memory and note the change
- Keep the same JSON structure

Respond with the COMPLETE updated memory document as JSON (same schema as before), no preamble or markdown fences.

{
    "patientOverview": "...",
    "problemAnalysis": [...],
    "safetyProfile": {...},
    "medicationRationale": [...],
    "pendingItems": [...],
    "clinicalGestalt": "..."
}`;

        const userMessage = refreshContext;

        return {
            systemPrompt,
            userMessage,
            maxTokens: 2048
        };
    }

    /**
     * Build prompt for digesting dictation into the memory document.
     * Takes new dictation text and existing memoryDocument, returns updated
     * encounterNarrative + any changes to problems/gestalt.
     * Model: Haiku (fast). Max tokens: 2048.
     */
    buildDigestPrompt(newDictation, memoryDocument) {
        const existingNarrative = memoryDocument?.encounterNarrative || {};
        const existingProblems = memoryDocument?.problemAnalysis || [];
        const existingGestalt = memoryDocument?.clinicalGestalt || '';

        const systemPrompt = `You are an AI clinical scribe. The attending physician and patient have been speaking during a clinical encounter. Their speech has been transcribed with speaker labels: [Doctor] and [Patient].

CRITICAL: The physician's clinical reasoning takes highest priority. Their assessment and thinking should heavily influence your output.

You will receive:
1. NEW DICTATION — speaker-labeled transcript lines. Lines starting with [Doctor] are the physician. Lines starting with [Patient] are the patient. If no speaker labels are present, assume all text is from the doctor.
2. EXISTING ENCOUNTER NARRATIVE — what you've parsed so far (may be empty on first digest)
3. EXISTING PROBLEMS — the current problem list from the memory document
4. EXISTING GESTALT — the current one-liner clinical summary

Your job: MERGE the new dictation into the existing encounter narrative. Append new info, don't lose old info.

Respond with JSON only, no preamble or markdown fences:
{
    "encounterNarrative": {
        "hpiComponents": [{"component": "onset|duration|severity|quality|context|modifying|associated", "text": "..."}],
        "examFindings": [{"system": "cardiac|pulmonary|neuro|abdominal|extremities|general|other", "finding": "..."}],
        "clinicalReasoning": ["Physician's reasoning point 1", "Physician's reasoning point 2"],
        "patientReported": ["What the patient said, organized by relevance"],
        "assessmentPlan": "Running synthesis of the clinical picture and plan"
    },
    "problemUpdates": [{"problem": "Problem Name", "status": "acute|active|stable|monitoring", "newInfo": "what changed based on dictation", "plan": "updated plan if any"}],
    "updatedGestalt": "Updated one-liner clinical summary incorporating new dictation"
}

RULES:
- MERGE with existing narrative — append new items, preserve old ones
- [Doctor] lines → clinicalReasoning (thoughts, reasoning) and examFindings (physical exam observations)
- [Patient] lines → patientReported (symptoms, concerns, history as told by patient) and hpiComponents
- For clinicalReasoning, always add the physician's thoughts verbatim or near-verbatim
- For examFindings, extract specific findings with their system
- For patientReported, capture patient statements and concerns
- For hpiComponents, map to standard HPI components when possible
- problemUpdates: only include problems that have NEW information from this dictation
- updatedGestalt: brief, must reflect the physician's current thinking`;

        let userMessage = '## NEW DICTATION\n';
        userMessage += newDictation + '\n\n';

        userMessage += '## EXISTING ENCOUNTER NARRATIVE\n';
        if (existingNarrative.clinicalReasoning?.length || existingNarrative.examFindings?.length) {
            userMessage += JSON.stringify(existingNarrative, null, 2) + '\n\n';
        } else {
            userMessage += '(First digest — no existing narrative yet)\n\n';
        }

        userMessage += '## EXISTING PROBLEMS\n';
        if (existingProblems.length) {
            existingProblems.forEach(p => {
                userMessage += `- ${p.problem} [${p.status}]: ${p.plan || 'no plan yet'}\n`;
            });
        } else {
            userMessage += '(No problems analyzed yet — run Learn Patient first for full context)\n';
        }
        userMessage += '\n';

        userMessage += '## EXISTING GESTALT\n';
        userMessage += existingGestalt || '(none yet)';

        return {
            systemPrompt,
            userMessage,
            maxTokens: 2048
        };
    }

    /**
     * Build prompt for order safety checking.
     * Sends memory document safety profile + current meds + the proposed order.
     * Model: Haiku (fast). Max tokens: 512.
     */
    buildOrderSafetyPrompt(parsedOrder, memoryDocument) {
        const safety = memoryDocument.safetyProfile || {};
        const meds = memoryDocument.medicationRationale || [];
        const problems = memoryDocument.problemAnalysis || [];

        let safetyContext = '## SAFETY PROFILE\n';
        if (safety.allergies && safety.allergies.length) {
            safetyContext += 'Allergies: ' + safety.allergies.map(a => `${a.substance} (${a.reaction}) — ${a.implications || ''}`).join('; ') + '\n';
        }
        if (safety.contraindications && safety.contraindications.length) {
            safetyContext += 'Contraindications: ' + safety.contraindications.join('; ') + '\n';
        }
        if (safety.interactions && safety.interactions.length) {
            safetyContext += 'Known interactions: ' + safety.interactions.join('; ') + '\n';
        }
        if (safety.criticalValues && safety.criticalValues.length) {
            safetyContext += 'Critical values: ' + safety.criticalValues.join('; ') + '\n';
        }

        let medContext = '## CURRENT MEDICATIONS\n';
        meds.forEach(m => { medContext += `- ${m.name}: ${m.indication}\n`; });

        let problemContext = '## ACTIVE PROBLEMS\n';
        problems.forEach(p => { problemContext += `- ${p.problem} (${p.status})\n`; });

        const systemPrompt = `You are a clinical safety checker. Given a patient's safety profile, current medications, and active problems, check the proposed order for safety concerns.

Check for:
1. Allergy conflicts (including cross-reactivity)
2. Drug-drug interactions with current medications
3. Contraindications given active conditions (e.g., NSAIDs in CKD+HF, metformin in AKI)
4. Duplicate/redundant orders
5. Dose concerns (obviously wrong doses)

Respond with ONLY JSON:
{"safe": true/false, "concerns": [{"type": "allergy|interaction|contraindication|duplicate|dose", "description": "Brief explanation", "severity": "critical|warning|info"}], "suggestedAlternative": "If unsafe, suggest an alternative (or null)"}

If the order is safe, return {"safe": true, "concerns": [], "suggestedAlternative": null}`;

        const userMessage = `${safetyContext}\n${medContext}\n${problemContext}\n## PROPOSED ORDER\n${JSON.stringify(parsedOrder, null, 2)}`;

        return {
            systemPrompt,
            userMessage,
            maxTokens: 512
        };
    }
}

window.ContextAssembler = ContextAssembler;
