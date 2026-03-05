/**
 * AI Mode Configuration
 *
 * Defines three AI assistant modes: Light, Medium, Heavy.
 * Controls system prompt personality, visible sections, suggestion chips,
 * proactive behavior, response verbosity, and per-section prompt instructions.
 *
 * Light  — Minimal. Facts and expected orders only.
 * Medium — Balanced copilot. Concise summaries, flags safety.
 * Heavy  — Maximalist attending. Comprehensive, teaches, challenges.
 *
 * Each mode has editable promptSections (summary, problemList, actions)
 * that persist to localStorage when customized by the user.
 */

const AIModeConfig = {
    MODES: {
        'light': {
            id: 'light',
            label: 'Light',
            icon: '\u25CB',     // ○
            description: 'Does what you ask. Minimal opinions.',
            sections: {
                alertBar: true,
                clinicalSummary: true,
                problemList: true,
                suggestedActions: true,
                conversationThread: true,
                teachingPoints: false,
                ddxChallenge: false
            },
            chips: [
                { label: 'Summarize', prompt: 'Summarize case briefly' },
                { label: 'Orders?', prompt: 'What orders are pending?' },
                { label: 'Labs', prompt: 'Show recent lab results' }
            ],
            proactive: {
                autoRefreshOnExpand: true,
                autoSynthesizeOnDictation: true
            },
            responseStyle: {
                maxTokensAsk: 1024,
                maxTokensDictation: 1500,
                maxTokensRefresh: 2000,
                personalityPrefix: 'You are a minimal clinical task assistant. Be extremely brief. Only answer what is asked. Do not volunteer opinions, teaching points, or differential diagnoses unless explicitly requested. Keep responses under 3 sentences when possible.',
                includeTeachingPoints: false,
                includeDDxChallenge: false
            },
            promptSections: {
                summary: 'Minimal summary. One sentence describing current clinical state. No detailed history.',
                problemList: 'List ONLY objective findings and reported symptoms as short labels. Examples: "SOB", "Hyperkalemia", "Tachycardia", "Elevated troponin". Do NOT include differential diagnoses, plans, or reasoning. Just the facts.',
                actions: 'List only the most expected, standard next orders. Keep to 3-5 items. No explanations.'
            }
        },
        'medium': {
            id: 'medium',
            label: 'Medium',
            icon: '\u25D0',     // ◐
            description: 'Balanced. Mirrors your thinking, flags safety.',
            sections: {
                alertBar: true,
                clinicalSummary: true,
                problemList: true,
                suggestedActions: true,
                conversationThread: true,
                teachingPoints: false,
                ddxChallenge: false
            },
            chips: [
                { label: 'Summarize', prompt: 'Summarize case' },
                { label: 'Concerns?', prompt: 'What are the key concerns?' },
                { label: 'Missing?', prompt: "What haven't I checked yet?" }
            ],
            proactive: {
                autoRefreshOnExpand: true,
                autoSynthesizeOnDictation: true
            },
            responseStyle: {
                maxTokensAsk: 2048,
                maxTokensDictation: 2500,
                maxTokensRefresh: 3000,
                personalityPrefix: '',  // empty = existing prompts unchanged
                includeTeachingPoints: false,
                includeDDxChallenge: false
            },
            promptSections: {
                summary: 'Concise 3-sentence clinical summary. Demographics/PMH in one sentence, functional status in one sentence, current presentation in one sentence. Use clinical shorthand.',
                problemList: 'Concise problem list with brief 1-sentence plans. Include DDx for the chief complaint only. Keep each problem entry short.',
                actions: 'Standard categorized actions. 1-3 items per category. Each action is one discrete step with an action verb.'
            }
        },
        'heavy': {
            id: 'heavy',
            label: 'Heavy',
            icon: '\u25CF',     // ●
            description: 'Opinionated. Teaches, challenges, leads.',
            sections: {
                alertBar: true,
                clinicalSummary: true,
                problemList: true,
                suggestedActions: true,
                conversationThread: true,
                teachingPoints: true,
                ddxChallenge: true
            },
            chips: [
                { label: 'Teach me', prompt: 'What should I learn from this case?' },
                { label: 'Challenge DDx', prompt: 'Challenge my differential diagnosis. What am I missing?' },
                { label: 'Critique plan', prompt: 'Critique my current plan. What would you change?' },
                { label: 'Pimp me', prompt: 'Ask me a tough clinical question about this case' }
            ],
            proactive: {
                autoRefreshOnExpand: true,
                autoSynthesizeOnDictation: true
            },
            responseStyle: {
                maxTokensAsk: 4096,
                maxTokensDictation: 4096,
                maxTokensRefresh: 4096,
                personalityPrefix: `You are a senior attending physician who is brilliant, opinionated, and a great teacher. You:
- Actively push differential diagnoses and challenge the learner's thinking
- Offer your own assessment when you have one, clearly labeled as "My thinking:"
- Provide teaching points relevant to the case (evidence-based, practical pearls)
- Point out things the doctor may have missed or not considered
- Use Socratic questioning when appropriate
- Are direct and confident but not dismissive
- Flag when the doctor's plan diverges from best practices
- Include a "Teaching Point" section in your synthesis responses

Include these additional JSON fields in your synthesis:
"teachingPoints": ["Clinical pearl or evidence-based teaching point relevant to this case"],
"ddxChallenge": "A brief challenge to the current differential — what else should be considered and why?"`,
                includeTeachingPoints: true,
                includeDDxChallenge: true
            },
            promptSections: {
                summary: 'Comprehensive clinical summary with detailed qualifiers for every diagnosis. Include treatment regimens, baseline values, specific severity markers. Be thorough.',
                problemList: 'Detailed problem list with full differential diagnoses and reasoning for each problem. Include evidence for and against each DDx item. Detailed plans with rationale.',
                actions: 'Comprehensive action set across all categories. Include detailed indications and clinical reasoning for each order. Be thorough — don\'t leave out steps.'
            }
        }
    },

    currentMode: 'medium',

    /**
     * Get the current mode configuration
     */
    getMode() {
        return this.MODES[this.currentMode];
    },

    /**
     * Set the active mode
     */
    setMode(modeId) {
        if (!this.MODES[modeId]) return;
        this.currentMode = modeId;
        localStorage.setItem('ai-assistant-mode', modeId);
        // Dispatch event for other components to react
        window.dispatchEvent(new CustomEvent('ai-mode-changed', { detail: { mode: modeId } }));
    },

    /**
     * Get a prompt section for a mode — returns custom override if saved, else default.
     * @param {string} modeId - 'light', 'medium', or 'heavy'
     * @param {string} section - 'summary', 'problemList', or 'actions'
     * @returns {string} The prompt section text
     */
    getModePromptSection(modeId, section) {
        var key = 'modePrompt_' + modeId + '_' + section;
        var custom = localStorage.getItem(key);
        if (custom !== null) return custom;
        var mode = this.MODES[modeId];
        if (mode && mode.promptSections && mode.promptSections[section]) {
            return mode.promptSections[section];
        }
        return '';
    },

    /**
     * Save a custom prompt section override for a mode.
     */
    saveModePromptSection(modeId, section, text) {
        var key = 'modePrompt_' + modeId + '_' + section;
        localStorage.setItem(key, text);
    },

    /**
     * Reset a prompt section for a mode to its default.
     */
    resetModePromptSection(modeId, section) {
        var key = 'modePrompt_' + modeId + '_' + section;
        localStorage.removeItem(key);
    },

    /**
     * Reset ALL prompt sections for a mode to defaults.
     */
    resetAllModePromptSections(modeId) {
        ['summary', 'problemList', 'actions'].forEach(function(section) {
            localStorage.removeItem('modePrompt_' + modeId + '_' + section);
        });
    },

    /**
     * Check if a mode has a custom override for a given section.
     */
    hasCustomModePrompt(modeId, section) {
        var key = 'modePrompt_' + modeId + '_' + section;
        return localStorage.getItem(key) !== null;
    },

    /**
     * Load saved mode from localStorage
     */
    loadMode() {
        var saved = localStorage.getItem('ai-assistant-mode');
        if (saved && this.MODES[saved]) {
            this.currentMode = saved;
        }
    },

    /**
     * Initialize — load persisted mode
     */
    init() {
        this.loadMode();
    }
};

window.AIModeConfig = AIModeConfig;
