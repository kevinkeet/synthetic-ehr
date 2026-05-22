/**
 * AssessmentGrader — uses Claude to grade resident responses and generate
 * live AI sample outputs for `ai-output-evaluation` prompts.
 *
 * Bypasses the AssessmentLogger by calling `ClaudeAPI._singleChat` directly,
 * so grading + sample-generation traffic doesn't pollute the resident's
 * logged AI usage.
 *
 * Public API:
 *   AssessmentGrader.generateAISample(prompt) → { sampleText }
 *   AssessmentGrader.grade(prompt, responseText, opts?) →
 *      { score: 0-1, breakdown, notes }
 */

const AssessmentGrader = (() => {
    const GRADER_MODEL = 'claude-sonnet-4-6';
    const SAMPLE_MODEL = 'claude-sonnet-4-6';

    const LOG = (...args) => console.log('🧮 Grader', ...args);
    const WARN = (...args) => console.warn('🧮 Grader', ...args);

    // ── Sample generation ──────────────────────────────────────────────

    async function generateAISample(prompt, contextHint = '') {
        const sysFromPrompt = prompt._aiPromptToGenerate || '';
        const isPlaceholder = !sysFromPrompt || /^TODO/i.test(sysFromPrompt);

        const systemPrompt = isPlaceholder
            ? _fallbackSampleSystemPrompt(prompt)
            : sysFromPrompt + '\n\n' + _baseSampleGuardrails();

        const userMessage = [
            'You are roleplaying as an AI clinical assistant responding to a resident\'s question.',
            'Produce ONE confident-sounding response to the question below.',
            '',
            'QUESTION: ' + (prompt.question || '(no question provided)'),
            '',
            contextHint ? 'CONTEXT THE RESIDENT GAVE YOU:\n' + contextHint : '',
            '',
            'Respond as the AI would — do NOT label your response as flawed or mention that you were instructed to make a specific style of error. Stay in character.',
        ].filter(Boolean).join('\n');

        try {
            const text = await ClaudeAPI._singleChat({
                systemPrompt,
                userMessage,
                model: SAMPLE_MODEL,
                maxTokens: 1200,
            });
            return { sampleText: (text || '').trim() };
        } catch (err) {
            WARN('generateAISample failed:', err.message);
            return {
                sampleText: '(The AI sample could not be generated. Please proceed with your evaluation — note in your response that no sample was available.)',
                error: err.message,
            };
        }
    }

    function _baseSampleGuardrails() {
        return [
            'Hard constraints:',
            '- Output ONLY the AI\'s in-character response. No meta-commentary, no preface.',
            '- Do NOT reveal the case\'s true diagnosis.',
            '- Keep length under ~350 words.',
            '- Sound confident and well-organized so the resident has to do real critique work.',
        ].join('\n');
    }

    function _fallbackSampleSystemPrompt(prompt) {
        // Used when the assessment JSON\'s _aiPromptToGenerate is still a TODO.
        // Produces a generic "plausibly mediocre attending" response.
        const promptType = prompt.type || 'unknown';
        return [
            'You are an AI clinical assistant. Produce a response that sounds confident',
            'and structured but exhibits a common reasoning weakness for this kind of question:',
            '',
            promptType === 'differential'
                ? '- Anchor on one diagnosis based on a single positive test, give a short list of nearby differentials with weak distinguishing reasoning, and omit broader-category considerations (infection, nutrition, environmental).'
                : promptType === 'management'
                ? '- Provide a treatment plan that is reasonable on its face but skips one or more pre-treatment safety checks (e.g., infection screen before immunosuppression, refeeding precautions before aggressive caloric load).'
                : promptType === 'context-curation'
                ? '- Suggest a context strategy that includes too much (a "dump everything" approach) rather than discriminating signal from noise.'
                : '- Provide a confident, plausibly-correct response that omits one important alternative consideration without acknowledging the uncertainty.',
            '',
            _baseSampleGuardrails(),
        ].join('\n');
    }

    // ── Grading ────────────────────────────────────────────────────────

    /**
     * Grade a free-text response against a rubric.
     *
     * @param {object} prompt - assessment prompt definition (from ap*.json)
     * @param {string} responseText - resident's free-text answer
     * @param {object} [opts]
     * @param {string} [opts.aiSample] - for ai-output-evaluation prompts,
     *      the AI sample the resident was critiquing
     * @returns {Promise<{score:number, breakdown:object, notes:string, raw:string}>}
     */
    async function grade(prompt, responseText, opts = {}) {
        if (!responseText || !responseText.trim()) {
            return {
                score: 0,
                breakdown: { essential_hit: [], essential_missed: ['(no response submitted)'], bonus_hit: [], red_flags_triggered: [] },
                notes: 'No response was submitted.',
                raw: '',
            };
        }

        const rubric = prompt.rubric || {};
        const isAIEval = prompt.type === 'ai-output-evaluation';
        const isPlaceholderRubric = _rubricIsAllTODO(rubric);

        const systemPrompt = _graderSystemPrompt({ isAIEval, isPlaceholderRubric });
        const userMessage = _graderUserMessage({ prompt, responseText, aiSample: opts.aiSample });

        let raw = '';
        try {
            raw = await ClaudeAPI._singleChat({
                systemPrompt,
                userMessage,
                model: GRADER_MODEL,
                maxTokens: 1200,
            });
        } catch (err) {
            WARN('grade call failed:', err.message);
            return {
                score: 0,
                breakdown: { essential_hit: [], essential_missed: ['(grader call failed)'], bonus_hit: [], red_flags_triggered: [] },
                notes: 'Grader call failed: ' + err.message,
                raw: '',
            };
        }

        const parsed = _parseGraderResponse(raw);
        if (!parsed) {
            return {
                score: 0,
                breakdown: { essential_hit: [], essential_missed: ['(grader output unparseable)'], bonus_hit: [], red_flags_triggered: [] },
                notes: 'Grader returned a response we could not parse as JSON.',
                raw,
            };
        }

        return {
            score: _clampScore(parsed.score),
            breakdown: parsed.breakdown || {},
            notes: parsed.notes || '',
            raw,
        };
    }

    function _rubricIsAllTODO(rubric) {
        const arrs = [
            rubric.essential, rubric.bonus, rubric.redFlags,
            rubric.shouldIdentify, rubric.shouldNotEcho,
        ].filter(Array.isArray);
        if (arrs.length === 0) return true;
        const allItems = arrs.flat();
        if (allItems.length === 0) return true;
        return allItems.every((item) => /^TODO/i.test(String(item)));
    }

    function _graderSystemPrompt({ isAIEval, isPlaceholderRubric }) {
        const base = [
            'You are an expert clinical educator grading a resident\'s free-text response',
            'against a rubric. You return ONLY valid JSON. Do not include any prose outside',
            'the JSON object. Do not reveal the final case diagnosis in your feedback.',
            '',
            'Output schema:',
            '{',
            '  "score": <number, 0.0 to 1.0>,',
            '  "breakdown": {',
            '    "essential_hit": [<strings>],',
            '    "essential_missed": [<strings>],',
            '    "bonus_hit": [<strings>],',
            '    "red_flags_triggered": [<strings>]',
            '  },',
            '  "notes": "<1-2 sentence rationale, no diagnosis spoilers>"',
            '}',
            '',
            'Scoring formula:',
            '  base = (essential hit count) / max(1, essential count)',
            '  + 0.08 per bonus_hit, capped at +0.20',
            '  - 0.15 per red flag triggered',
            '  Clamp final score to [0.0, 1.0].',
            '',
        ];

        if (isAIEval) {
            base.push(
                'For ai-output-evaluation prompts, the rubric uses `shouldIdentify` instead of',
                '`essential`. Treat shouldIdentify items as the essentials. Also treat any',
                '`shouldNotEcho` items as red flags if the resident merely repeats them.',
                ''
            );
        }

        if (isPlaceholderRubric) {
            base.push(
                'IMPORTANT: The rubric for this prompt is still a placeholder (all items start with',
                '"TODO"). Apply general clinical-educator judgment instead:',
                '  - Reward a structured, prioritized, evidence-grounded response.',
                '  - Penalize confident statements without supporting reasoning.',
                '  - Score 0.5 as baseline; adjust up/down based on quality.',
                'Return the rubric items you considered "essential" by paraphrasing what a strong',
                'response would include, in the essential_hit/missed arrays.',
                ''
            );
        }

        base.push('Return ONLY the JSON object. No preamble. No code fences.');
        return base.join('\n');
    }

    function _graderUserMessage({ prompt, responseText, aiSample }) {
        const parts = [];
        parts.push('PROMPT TYPE: ' + (prompt.type || 'unknown'));
        parts.push('QUESTION: ' + (prompt.question || ''));
        parts.push('');
        parts.push('RUBRIC:');
        parts.push(JSON.stringify(prompt.rubric || {}, null, 2));
        parts.push('');
        if (aiSample) {
            parts.push('AI SAMPLE THE RESIDENT WAS CRITIQUING:');
            parts.push(aiSample);
            parts.push('');
        }
        parts.push('RESIDENT RESPONSE:');
        parts.push(responseText);
        parts.push('');
        parts.push('Grade the response. Return ONLY the JSON object.');
        return parts.join('\n');
    }

    function _parseGraderResponse(text) {
        if (!text) return null;
        let cleaned = String(text).trim();
        // Strip code fences if present
        cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
        // Find first '{' and last '}' and parse the substring
        const first = cleaned.indexOf('{');
        const last = cleaned.lastIndexOf('}');
        if (first === -1 || last === -1 || last <= first) return null;
        const json = cleaned.slice(first, last + 1);
        try {
            return JSON.parse(json);
        } catch (e) {
            return null;
        }
    }

    function _clampScore(s) {
        const n = Number(s);
        if (!Number.isFinite(n)) return 0;
        return Math.max(0, Math.min(1, n));
    }

    return {
        generateAISample,
        grade,
    };
})();

window.AssessmentGrader = AssessmentGrader;
