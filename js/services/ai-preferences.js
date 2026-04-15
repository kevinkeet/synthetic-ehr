// ai-preferences.js — User preferences system for AI clinical assistant
// Stores in localStorage, auto-syncs to Supabase via monkey-patch in supabase-sync.js

const AIPreferences = (() => {
    const STORAGE_KEY = 'ai-user-preferences';

    const DEFAULTS = {
        assertiveness: 3,
        detailLevels: {
            summary: 'moderate',
            problemList: 'moderate',
            actions: 'moderate',
            thinking: 'brief'
        },
        summarySections: [
            { key: 'demographics', label: 'ID', instruction: 'HPI-style: age, sex, key PMH with specific qualifiers (EF%, treatment regimen, anticoagulation status, baseline Cr/eGFR)' },
            { key: 'functional', label: 'USOH', instruction: 'Functional status, living situation, ADL/IADL dependence, mobility, caregiver, key psychosocial factors' },
            { key: 'presentation', label: 'NOW', instruction: 'Chief complaint with timeline, significant exam findings, pertinent negatives, key abnormal labs with actual values' }
        ],
        noteTemplates: {},
        globalInstruction: ''
    };

    const ASSERTIVENESS_LABELS = {
        1: 'Passive — Facts only, no interpretation',
        2: 'Reserved — Observations + safety flags',
        3: 'Balanced — Summarizes, suggests, flags concerns',
        4: 'Engaged — Full analysis, challenges gaps',
        5: 'Assertive — Opinionated, debates, teaches'
    };

    // Each level defines: personality prefix, which sections to include,
    // which optional JSON fields to add, and depth instructions
    const ASSERTIVENESS_PROFILES = {
        1: {
            prefix: 'You are a clinical AI assistant operating in PASSIVE mode. Your ONLY job is to organize the available data into a clean summary. Do NOT offer opinions, differential diagnoses, or suggest actions. Do NOT interpret findings — just report them. The physician will make all decisions.',
            includeSections: ['clinicalSummary', 'problemList'],
            excludeSections: ['categorizedActions', 'suggestedActions', 'keyConsiderations', 'thinking', 'ddxChallenge', 'teachingPoints'],
            problemListRule: 'List problems with status only. Do NOT include plans, DDx, or recommendations. Just "Problem — status (active/stable/monitoring)".',
            actionsRule: null, // no actions at Level 1
            summaryDepth: 'Ultra-brief. One line per section. Just the facts.',
            extraFields: []
        },
        2: {
            prefix: 'You are a clinical AI assistant operating in RESERVED mode. Report findings clearly. Only flag SAFETY CONCERNS (critical values, drug interactions, allergies). Defer all clinical decisions to the physician. Do not suggest actions unless they involve patient safety.',
            includeSections: ['clinicalSummary', 'problemList', 'keyConsiderations'],
            excludeSections: ['categorizedActions', 'suggestedActions', 'ddxChallenge', 'teachingPoints'],
            problemListRule: 'List problems with brief status and trajectory. Include a 1-sentence plan only if one already exists in the chart. Do NOT suggest new plans.',
            actionsRule: null,
            summaryDepth: 'Concise. 1-2 sentences per section.',
            extraFields: []
        },
        3: {
            prefix: 'You are a clinical AI assistant operating in BALANCED mode. Summarize findings, suggest reasonable next steps, and flag safety concerns. Support the physician\'s decision-making without being pushy. Offer 2-4 suggested actions focused on what needs to happen next.',
            includeSections: ['clinicalSummary', 'problemList', 'categorizedActions', 'keyConsiderations', 'thinking'],
            excludeSections: ['ddxChallenge', 'teachingPoints'],
            problemListRule: 'List 3-5 active problems with plans. Problem #1 should be the chief complaint with a brief DDx (2-3 items). Keep plans actionable and specific.',
            actionsRule: 'Suggest 3-5 concrete next steps. Be specific (dose, route, frequency for meds; exact lab names; specific questions to ask).',
            summaryDepth: 'Moderate detail. Include key qualifiers and values.',
            extraFields: []
        },
        4: {
            prefix: 'You are a clinical AI assistant operating in ENGAGED mode. Provide a thorough analysis with differential diagnoses, evidence-based reasoning, and comprehensive action plans. Actively identify gaps in the workup. Challenge the current differential if it seems incomplete. Cite guidelines when relevant.',
            includeSections: ['clinicalSummary', 'problemList', 'categorizedActions', 'keyConsiderations', 'thinking'],
            excludeSections: [],
            problemListRule: 'List 4-6 problems. Problem #1 MUST have a comprehensive DDx with 3-5 diagnoses and brief reasoning for/against each. All problems need specific, evidence-based plans with guideline references where applicable.',
            actionsRule: 'Suggest 4-8 specific actions across all categories. Include evidence field citing guidelines (AHA/ACC, KDIGO, ADA, etc.) or landmark trials. Flag any gaps in the current workup.',
            summaryDepth: 'Detailed. Include all relevant qualifiers, specific values, and clinical context.',
            extraFields: ['ddxChallenge']
        },
        5: {
            prefix: 'You are a clinical AI assistant operating in ASSERTIVE mode. Be OPINIONATED. Question the physician\'s reasoning. Challenge weak differential diagnoses. Point out what they might be missing. Teach through Socratic questioning. Cite specific guidelines and landmark trials. If you disagree with the current plan, say so directly and explain why. Hold the physician to a high standard of clinical reasoning.',
            includeSections: ['clinicalSummary', 'problemList', 'categorizedActions', 'keyConsiderations', 'thinking'],
            excludeSections: [],
            problemListRule: 'List 5-8 problems comprehensively. Problem #1 MUST have a rigorous DDx with 4-6 diagnoses, each with specific evidence for/against from this patient\'s data. Challenge the most likely diagnosis — what could be missed? All problems need evidence-based plans with specific guideline citations.',
            actionsRule: 'Suggest 5-10 specific actions. Every action MUST have an evidence field citing a specific guideline or trial. Flag ANYTHING that seems suboptimal or missing. Include a "What are you missing?" item if the workup has gaps.',
            summaryDepth: 'Comprehensive. Include all qualifiers, trends, and clinical reasoning. Write like a thorough attending note.',
            extraFields: ['ddxChallenge', 'teachingPoints']
        }
    };

    const DEFAULT_NOTE_TYPES = ['Progress', 'H&P', 'Discharge', 'Patient Instructions', 'Patient Letter'];

    // --- Helpers ---

    function deepClone(obj) {
        return JSON.parse(JSON.stringify(obj));
    }

    function deepMerge(target, source) {
        const result = deepClone(target);
        for (const key of Object.keys(source)) {
            if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
                result[key] = deepMerge(result[key] || {}, source[key]);
            } else {
                result[key] = deepClone(source[key] !== undefined ? source[key] : target[key]);
            }
        }
        return result;
    }

    function log(...args) {
        console.log('\u2699\uFE0F', ...args);
    }

    // --- Storage Methods ---

    function get() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return deepClone(DEFAULTS);
            const parsed = JSON.parse(raw);
            return deepMerge(DEFAULTS, parsed);
        } catch (e) {
            log('Error reading preferences, returning defaults:', e.message);
            return deepClone(DEFAULTS);
        }
    }

    function set(prefs) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
            log('Preferences saved');
        } catch (e) {
            log('Error saving preferences:', e.message);
        }
    }

    function update(partial) {
        const current = get();
        const merged = deepMerge(current, partial);
        set(merged);
        return merged;
    }

    function reset() {
        localStorage.removeItem(STORAGE_KEY);
        log('Preferences reset to defaults');
    }

    function getDefaults() {
        return deepClone(DEFAULTS);
    }

    // --- Accessor Methods ---

    function getAssertiveness() {
        return get().assertiveness;
    }

    function getDetailLevel(section) {
        const levels = get().detailLevels;
        return levels[section] || 'moderate';
    }

    function getSummarySections() {
        return get().summarySections;
    }

    function getNoteTemplate(noteType) {
        const templates = get().noteTemplates;
        return templates[noteType] || null;
    }

    function getGlobalInstruction() {
        return get().globalInstruction || '';
    }

    // --- Prompt Generation Methods ---

    /**
     * Get the full assertiveness profile for the current level.
     * This controls which sections exist, how deep each section goes,
     * and what the AI's personality is.
     */
    function getAssertiveProfile() {
        const level = getAssertiveness();
        return ASSERTIVENESS_PROFILES[level] || ASSERTIVENESS_PROFILES[3];
    }

    function buildPersonalityPrefix(modePrefix) {
        const profile = getAssertiveProfile();
        const prefix = profile.prefix;
        if (modePrefix) {
            return prefix + '\n\n' + modePrefix;
        }
        return prefix;
    }

    function buildSectionInstructions(modeInstructions) {
        const profile = getAssertiveProfile();
        const parts = [];

        // Assertiveness-driven depth
        parts.push('RESPONSE DEPTH: ' + profile.summaryDepth);

        // Problem list behavior changes with assertiveness
        if (profile.problemListRule) {
            parts.push('PROBLEM LIST: ' + profile.problemListRule);
        }

        // Actions behavior changes with assertiveness
        if (profile.actionsRule) {
            parts.push('SUGGESTED ACTIONS: ' + profile.actionsRule);
        } else {
            parts.push('SUGGESTED ACTIONS: Do NOT include suggested actions or categorizedActions. The physician will decide independently.');
        }

        // Sections to EXCLUDE
        if (profile.excludeSections.length > 0) {
            parts.push('OMIT these fields from your response (set to null or empty): ' + profile.excludeSections.join(', '));
        }

        // Extra fields to INCLUDE
        if (profile.extraFields.length > 0) {
            if (profile.extraFields.includes('ddxChallenge')) {
                parts.push('INCLUDE ddxChallenge: Challenge the current differential — what else should be considered?');
            }
            if (profile.extraFields.includes('teachingPoints')) {
                parts.push('INCLUDE teachingPoints: 1-2 clinical pearls or evidence-based teaching points relevant to this case.');
            }
        }

        // User-set detail level overrides (from the customize panel)
        const levels = get().detailLevels;
        for (const [section, level] of Object.entries(levels)) {
            if (level === 'brief') {
                parts.push(`For ${section}: Override to BRIEF. 1-2 sentences max.`);
            } else if (level === 'detailed') {
                parts.push(`For ${section}: Override to DETAILED. Include all relevant details and reasoning.`);
            }
        }

        return parts.join('\n');
    }

    function buildSummaryFormatSpec() {
        const sections = getSummarySections();
        return '"clinicalSummary": {\n' +
            sections.map(s => `    "${s.key}": "${s.instruction}"`).join(',\n') +
            '\n}';
    }

    function buildNoteTemplateInstruction(noteType) {
        const template = getNoteTemplate(noteType);
        if (template) {
            return '\n\nIMPORTANT: Follow this exact note template format:\n' + template;
        }
        return '';
    }

    // --- Customize UI Panel ---

    function openCustomizePanel() {
        const _draft = get();

        // Build overlay
        const overlay = document.createElement('div');
        overlay.className = 'about-modal-overlay customize-overlay';
        overlay.style.cssText = 'display:flex; align-items:center; justify-content:center; z-index:10000;';

        const panel = document.createElement('div');
        panel.className = 'customize-panel';
        panel.innerHTML = `
            <div class="customize-header">
                <h2>AI Preferences</h2>
                <button class="customize-close" aria-label="Close">&times;</button>
            </div>
            <div class="customize-body">
                ${renderAssertiveness(_draft)}
                ${renderDetailLevels(_draft)}
                ${renderSummarySections(_draft)}
                ${renderNoteTemplates(_draft)}
                ${renderGlobalInstruction(_draft)}
            </div>
            <div class="customize-footer">
                <button class="btn customize-reset">Reset to Defaults</button>
                <button class="btn btn-primary customize-save">Save</button>
            </div>
        `;
        overlay.appendChild(panel);
        document.body.appendChild(overlay);
        injectStyles();

        // --- Bind Events ---

        // Close
        const closePanel = () => overlay.remove();
        panel.querySelector('.customize-close').addEventListener('click', closePanel);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) closePanel(); });
        document.addEventListener('keydown', function escHandler(e) {
            if (e.key === 'Escape') { closePanel(); document.removeEventListener('keydown', escHandler); }
        });

        // Assertiveness slider — updates level name, description, and section badges
        const slider = panel.querySelector('#customize-assertiveness');
        const sliderLabel = panel.querySelector('.customize-assertiveness-label');
        const descEl = panel.querySelector('#assertive-description');
        const sectionsEl = panel.querySelector('#assertive-sections');

        const levelDescriptions = {
            1: 'Summary only. No suggestions, no DDx, no actions. Just organized facts.',
            2: 'Summary + safety flags. No suggested actions. Defers all decisions to you.',
            3: 'Summary + problems with plans + suggested actions. Balanced support.',
            4: 'Full DDx with evidence, comprehensive actions with guidelines, challenges gaps.',
            5: 'Debates your reasoning, teaches through questioning, cites trials, flags what you\'re missing.'
        };
        const levelSections = {
            1: ['Summary'],
            2: ['Summary', 'Safety Flags'],
            3: ['Summary', 'Problem List + Plans', 'Suggested Actions', 'AI Thinking'],
            4: ['Summary', 'Problem List + DDx', 'Actions + Evidence', 'AI Thinking', 'DDx Challenge'],
            5: ['Summary', 'Problem List + DDx', 'Actions + Evidence', 'AI Thinking', 'DDx Challenge', 'Teaching Points']
        };

        slider.addEventListener('input', () => {
            const val = parseInt(slider.value);
            _draft.assertiveness = val;
            sliderLabel.textContent = ASSERTIVENESS_LABELS[val];
            if (descEl) descEl.textContent = levelDescriptions[val];
            if (sectionsEl) {
                sectionsEl.innerHTML = '<span class="assertive-sections-label">AI will provide:</span>' +
                    levelSections[val].map(s => `<span class="assertive-badge">${s}</span>`).join('');
            }
        });

        // Detail level buttons
        panel.querySelectorAll('.customize-detail-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const section = btn.dataset.section;
                const level = btn.dataset.level;
                _draft.detailLevels[section] = level;
                // Update active state
                panel.querySelectorAll(`.customize-detail-btn[data-section="${section}"]`).forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            });
        });

        // Summary sections
        bindSummarySectionEvents(panel, _draft);

        // Note templates
        bindNoteTemplateEvents(panel, _draft);

        // Global instruction
        const globalTextarea = panel.querySelector('#customize-global-instruction');
        globalTextarea.addEventListener('input', () => {
            _draft.globalInstruction = globalTextarea.value;
        });

        // Save
        panel.querySelector('.customize-save').addEventListener('click', () => {
            set(_draft);
            closePanel();
            showToast('AI preferences saved');
        });

        // Reset
        panel.querySelector('.customize-reset').addEventListener('click', () => {
            if (confirm('Reset all AI preferences to defaults? This cannot be undone.')) {
                reset();
                closePanel();
                showToast('AI preferences reset to defaults');
            }
        });
    }

    // --- Render Helpers ---

    function renderAssertiveness(draft) {
        const val = draft.assertiveness;
        const profile = ASSERTIVENESS_PROFILES[val];

        // Build "what changes" preview for each level
        const levelDescriptions = {
            1: 'Summary only. No suggestions, no DDx, no actions. Just organized facts.',
            2: 'Summary + safety flags. No suggested actions. Defers all decisions to you.',
            3: 'Summary + problems with plans + suggested actions. Balanced support.',
            4: 'Full DDx with evidence, comprehensive actions with guidelines, challenges gaps.',
            5: 'Debates your reasoning, teaches through questioning, cites trials, flags what you\'re missing.'
        };

        const levelSections = {
            1: ['Summary'],
            2: ['Summary', 'Safety Flags'],
            3: ['Summary', 'Problem List + Plans', 'Suggested Actions', 'AI Thinking'],
            4: ['Summary', 'Problem List + DDx', 'Actions + Evidence', 'AI Thinking', 'DDx Challenge'],
            5: ['Summary', 'Problem List + DDx', 'Actions + Evidence', 'AI Thinking', 'DDx Challenge', 'Teaching Points']
        };

        const sectionBadges = levelSections[val].map(s => `<span class="assertive-badge">${s}</span>`).join('');

        return `
            <div class="customize-section customize-assertiveness-section">
                <h3>AI Cognitive Level</h3>
                <div class="assertive-slider-row">
                    <span class="assertive-end-label">Passive</span>
                    <input type="range" id="customize-assertiveness" min="1" max="5" step="1" value="${val}" class="customize-slider">
                    <span class="assertive-end-label">Assertive</span>
                </div>
                <div class="assertive-level-name customize-assertiveness-label">${ASSERTIVENESS_LABELS[val]}</div>
                <div class="assertive-description" id="assertive-description">${levelDescriptions[val]}</div>
                <div class="assertive-sections" id="assertive-sections">
                    <span class="assertive-sections-label">AI will provide:</span>
                    ${sectionBadges}
                </div>
            </div>`;
    }

    function renderDetailLevels(draft) {
        const sections = [
            { key: 'summary', label: 'Summary' },
            { key: 'problemList', label: 'Problem List' },
            { key: 'actions', label: 'Actions' },
            { key: 'thinking', label: 'Thinking' }
        ];
        const levels = ['brief', 'moderate', 'detailed'];
        const rows = sections.map(s => {
            const btns = levels.map(l => {
                const active = draft.detailLevels[s.key] === l ? 'active' : '';
                return `<button class="btn customize-detail-btn ${active}" data-section="${s.key}" data-level="${l}">${capitalize(l)}</button>`;
            }).join('');
            return `<div class="customize-detail-row"><span class="customize-detail-label">${s.label}</span><div class="customize-detail-btns">${btns}</div></div>`;
        }).join('');
        return `<div class="customize-section"><h3>Detail Levels</h3>${rows}</div>`;
    }

    function renderSummarySections(draft) {
        const rows = draft.summarySections.map((s, i) => renderSummarySectionRow(s, i)).join('');
        return `
            <div class="customize-section" id="customize-summary-sections">
                <h3>Clinical Summary Structure</h3>
                <div class="customize-summary-list">${rows}</div>
                <button class="btn customize-add-section">+ Add Section</button>
            </div>`;
    }

    function renderSummarySectionRow(section, index) {
        return `
            <div class="customize-summary-row" data-index="${index}">
                <input type="text" class="customize-summary-label" value="${escapeAttr(section.label)}" placeholder="Label" maxlength="10">
                <textarea class="customize-summary-instruction" placeholder="Instruction for this section">${escapeHtml(section.instruction)}</textarea>
                <button class="btn customize-delete-section" data-index="${index}">&times;</button>
            </div>`;
    }

    function renderNoteTemplates(draft) {
        const allTypes = [...new Set([...DEFAULT_NOTE_TYPES, ...Object.keys(draft.noteTemplates)])];
        const rows = allTypes.map(type => {
            const hasCustom = !!draft.noteTemplates[type];
            const badge = hasCustom ? '<span class="customize-badge custom">Custom \u270E</span>' : '<span class="customize-badge default">Default</span>';
            return `
                <div class="customize-note-row" data-type="${escapeAttr(type)}">
                    <span class="customize-note-name">${escapeHtml(type)}</span>
                    ${badge}
                    <button class="btn customize-note-edit" data-type="${escapeAttr(type)}">Edit</button>
                    ${hasCustom ? `<button class="btn customize-note-delete" data-type="${escapeAttr(type)}">Delete</button>` : ''}
                </div>`;
        }).join('');
        return `
            <div class="customize-section" id="customize-note-templates">
                <h3>Note Templates</h3>
                <div class="customize-note-list">${rows}</div>
                <button class="btn customize-add-note">+ Add Note Type</button>
            </div>`;
    }

    function renderGlobalInstruction(draft) {
        return `
            <div class="customize-section">
                <h3>Global Instructions</h3>
                <textarea id="customize-global-instruction" class="customize-global-textarea" placeholder="e.g., 'Always mention guideline citations. Use metric units. Focus on cardiac issues.'">${escapeHtml(draft.globalInstruction)}</textarea>
            </div>`;
    }

    // --- Event Binding for Dynamic Sections ---

    function bindSummarySectionEvents(panel, draft) {
        const container = panel.querySelector('.customize-summary-list');

        // Delegated input events
        container.addEventListener('input', (e) => {
            const row = e.target.closest('.customize-summary-row');
            if (!row) return;
            const idx = parseInt(row.dataset.index);
            if (e.target.classList.contains('customize-summary-label')) {
                draft.summarySections[idx].label = e.target.value;
            } else if (e.target.classList.contains('customize-summary-instruction')) {
                draft.summarySections[idx].instruction = e.target.value;
            }
        });

        // Delete
        container.addEventListener('click', (e) => {
            if (!e.target.classList.contains('customize-delete-section')) return;
            if (draft.summarySections.length <= 1) {
                showToast('At least one section is required');
                return;
            }
            const idx = parseInt(e.target.dataset.index);
            draft.summarySections.splice(idx, 1);
            refreshSummarySections(panel, draft);
        });

        // Add
        panel.querySelector('.customize-add-section').addEventListener('click', () => {
            const newKey = 'section_' + Date.now();
            draft.summarySections.push({ key: newKey, label: '', instruction: '' });
            refreshSummarySections(panel, draft);
        });
    }

    function refreshSummarySections(panel, draft) {
        const container = panel.querySelector('.customize-summary-list');
        container.innerHTML = draft.summarySections.map((s, i) => renderSummarySectionRow(s, i)).join('');
    }

    function bindNoteTemplateEvents(panel, draft) {
        const container = panel.querySelector('#customize-note-templates');

        container.addEventListener('click', (e) => {
            const type = e.target.dataset.type;
            if (e.target.classList.contains('customize-note-edit')) {
                openNoteTemplateEditor(panel, draft, type);
            } else if (e.target.classList.contains('customize-note-delete')) {
                delete draft.noteTemplates[type];
                refreshNoteTemplates(panel, draft);
            }
        });

        panel.querySelector('.customize-add-note').addEventListener('click', () => {
            const name = prompt('Enter note type name:');
            if (name && name.trim()) {
                draft.noteTemplates[name.trim()] = '';
                openNoteTemplateEditor(panel, draft, name.trim());
            }
        });
    }

    function refreshNoteTemplates(panel, draft) {
        const container = panel.querySelector('.customize-note-list');
        const allTypes = [...new Set([...DEFAULT_NOTE_TYPES, ...Object.keys(draft.noteTemplates)])];
        container.innerHTML = allTypes.map(type => {
            const hasCustom = !!draft.noteTemplates[type];
            const badge = hasCustom ? '<span class="customize-badge custom">Custom \u270E</span>' : '<span class="customize-badge default">Default</span>';
            return `
                <div class="customize-note-row" data-type="${escapeAttr(type)}">
                    <span class="customize-note-name">${escapeHtml(type)}</span>
                    ${badge}
                    <button class="btn customize-note-edit" data-type="${escapeAttr(type)}">Edit</button>
                    ${hasCustom ? `<button class="btn customize-note-delete" data-type="${escapeAttr(type)}">Delete</button>` : ''}
                </div>`;
        }).join('');
    }

    function openNoteTemplateEditor(panel, draft, noteType) {
        const existing = draft.noteTemplates[noteType] || '';
        const editorOverlay = document.createElement('div');
        editorOverlay.className = 'customize-sub-overlay';
        editorOverlay.innerHTML = `
            <div class="customize-sub-modal">
                <h3>Edit Template: ${escapeHtml(noteType)}</h3>
                <textarea class="customize-template-textarea" placeholder="Enter note template format...">${escapeHtml(existing)}</textarea>
                <div class="customize-sub-footer">
                    <button class="btn customize-sub-cancel">Cancel</button>
                    <button class="btn btn-primary customize-sub-save">Save Template</button>
                </div>
            </div>`;
        panel.appendChild(editorOverlay);

        editorOverlay.querySelector('.customize-sub-cancel').addEventListener('click', () => editorOverlay.remove());
        editorOverlay.querySelector('.customize-sub-save').addEventListener('click', () => {
            const val = editorOverlay.querySelector('.customize-template-textarea').value;
            if (val.trim()) {
                draft.noteTemplates[noteType] = val;
            } else {
                delete draft.noteTemplates[noteType];
            }
            refreshNoteTemplates(panel, draft);
            editorOverlay.remove();
        });
    }

    // --- Utilities ---

    function capitalize(s) {
        return s.charAt(0).toUpperCase() + s.slice(1);
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str || '';
        return div.innerHTML;
    }

    function escapeAttr(str) {
        return (str || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function showToast(message) {
        const toast = document.createElement('div');
        toast.className = 'customize-toast';
        toast.textContent = message;
        document.body.appendChild(toast);
        requestAnimationFrame(() => toast.classList.add('visible'));
        setTimeout(() => {
            toast.classList.remove('visible');
            setTimeout(() => toast.remove(), 300);
        }, 2500);
    }

    // --- Inject Styles ---

    let stylesInjected = false;
    function injectStyles() {
        if (stylesInjected) return;
        stylesInjected = true;

        const style = document.createElement('style');
        style.textContent = `
            .customize-overlay {
                position: fixed; top: 0; left: 0; right: 0; bottom: 0;
                background: rgba(0,0,0,0.45);
                z-index: 10000; display: flex; align-items: center; justify-content: center;
            }
            .customize-panel {
                background: #ffffff; color: #1a202c;
                border-radius: 12px; width: 640px; max-width: 95vw; max-height: 90vh;
                display: flex; flex-direction: column; box-shadow: 0 8px 32px rgba(0,0,0,0.18);
                position: relative;
            }
            .customize-header {
                display: flex; justify-content: space-between; align-items: center;
                padding: 16px 20px; border-bottom: 1px solid #e2e8f0;
                background: #f7fafc; border-radius: 12px 12px 0 0;
            }
            .customize-header h2 { margin: 0; font-size: 18px; color: #1a365d; }
            .customize-close {
                background: none; border: none; color: #a0aec0;
                font-size: 24px; cursor: pointer; padding: 0 4px; line-height: 1;
            }
            .customize-close:hover { color: #2d3748; }
            .customize-body {
                flex: 1; overflow-y: auto; padding: 16px 20px;
            }
            .customize-section {
                margin-bottom: 24px;
            }
            .customize-section h3 {
                font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em;
                color: #718096; margin: 0 0 12px 0; font-weight: 700;
            }
            .customize-assertiveness-section {
                background: #f0f4f8; border-radius: 8px; padding: 16px;
            }
            .assertive-slider-row {
                display: flex; align-items: center; gap: 10px; margin: 8px 0;
            }
            .assertive-end-label {
                font-size: 10px; font-weight: 600; color: #718096;
                text-transform: uppercase; letter-spacing: 0.5px; white-space: nowrap;
            }
            .customize-slider {
                flex: 1; margin: 0; accent-color: #1b3a5c; height: 6px;
            }
            .assertive-level-name, .customize-assertiveness-label {
                font-size: 14px; font-weight: 700; color: #1b3a5c;
                text-align: center; margin: 4px 0;
            }
            .assertive-description {
                font-size: 12px; color: #4a5568; text-align: center;
                margin: 4px 0 10px; line-height: 1.4;
            }
            .assertive-sections {
                display: flex; flex-wrap: wrap; gap: 4px; align-items: center;
                justify-content: center;
            }
            .assertive-sections-label {
                font-size: 10px; color: #718096; font-weight: 600;
                text-transform: uppercase; margin-right: 4px;
            }
            .assertive-badge {
                font-size: 10px; padding: 2px 8px; border-radius: 10px;
                background: #dce6f0; color: #1b3a5c; font-weight: 600;
            }
            .customize-detail-row {
                display: flex; align-items: center; justify-content: space-between;
                margin-bottom: 8px;
            }
            .customize-detail-label {
                flex: 0 0 130px; font-size: 14px; color: #2d3748;
            }
            .customize-detail-btns { display: flex; gap: 6px; }
            .customize-detail-btn {
                font-size: 12px; padding: 4px 12px; border-radius: 4px;
                border: 1px solid #cbd5e0; background: #fff;
                color: #718096; cursor: pointer; transition: all 0.15s;
            }
            .customize-detail-btn.active {
                background: #2c5282; color: #fff;
                border-color: #2c5282;
            }
            .customize-detail-btn:hover:not(.active) {
                border-color: #a0aec0; background: #f7fafc;
            }
            .customize-summary-row {
                display: flex; gap: 8px; align-items: flex-start; margin-bottom: 8px;
            }
            .customize-summary-label {
                width: 60px; flex-shrink: 0; padding: 6px 8px; font-size: 13px;
                background: #f7fafc; border: 1px solid #e2e8f0;
                border-radius: 4px; color: #2d3748;
            }
            .customize-summary-instruction {
                flex: 1; padding: 6px 8px; font-size: 13px; min-height: 48px; resize: vertical;
                background: #f7fafc; border: 1px solid #e2e8f0;
                border-radius: 4px; color: #2d3748; font-family: inherit;
            }
            .customize-delete-section {
                flex-shrink: 0; font-size: 16px; padding: 4px 8px;
                background: transparent; border: 1px solid #e2e8f0;
                color: #a0aec0; border-radius: 4px; cursor: pointer;
            }
            .customize-delete-section:hover { color: #e53e3e; border-color: #e53e3e; }
            .customize-note-row {
                display: flex; align-items: center; gap: 8px; margin-bottom: 6px;
                padding: 8px 10px; border-radius: 6px;
                background: #f7fafc; border: 1px solid #e2e8f0;
            }
            .customize-note-name { flex: 1; font-size: 14px; color: #2d3748; }
            .customize-badge {
                font-size: 11px; padding: 2px 8px; border-radius: 10px;
            }
            .customize-badge.default { background: #edf2f7; color: #718096; }
            .customize-badge.custom { background: #c6f6d5; color: #276749; }
            .customize-note-edit, .customize-note-delete {
                font-size: 12px; padding: 3px 10px;
            }
            .customize-global-textarea {
                width: 100%; min-height: 80px; padding: 10px; font-size: 13px;
                background: #f7fafc; border: 1px solid #e2e8f0;
                border-radius: 6px; color: #2d3748; font-family: inherit;
                resize: vertical; box-sizing: border-box;
            }
            .customize-footer {
                display: flex; justify-content: space-between; align-items: center;
                padding: 12px 20px; border-top: 1px solid #e2e8f0;
                background: #f7fafc; border-radius: 0 0 12px 12px;
            }
            .customize-reset {
                color: #718096; border-color: #cbd5e0;
            }
            .customize-sub-overlay {
                position: absolute; top: 0; left: 0; right: 0; bottom: 0;
                background: rgba(0,0,0,0.35); display: flex; align-items: center;
                justify-content: center; border-radius: 12px; z-index: 1;
            }
            .customize-sub-modal {
                background: #ffffff; padding: 20px; border-radius: 8px;
                width: 90%; max-width: 500px; box-shadow: 0 4px 16px rgba(0,0,0,0.15);
            }
            .customize-sub-modal h3 { margin: 0 0 12px 0; font-size: 15px; color: #1a365d; }
            .customize-template-textarea {
                width: 100%; min-height: 200px; padding: 10px; font-size: 13px;
                background: #f7fafc; border: 1px solid #e2e8f0;
                border-radius: 6px; color: #2d3748;
                font-family: 'Courier New', monospace; resize: vertical; box-sizing: border-box;
            }
            .customize-sub-footer {
                display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px;
            }
            .customize-toast {
                position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%) translateY(20px);
                background: #2d6a4f; color: #fff; padding: 10px 24px; border-radius: 8px;
                font-size: 14px; opacity: 0; transition: all 0.3s ease; z-index: 10001;
                pointer-events: none;
            }
            .customize-toast.visible { opacity: 1; transform: translateX(-50%) translateY(0); }
        `;
        document.head.appendChild(style);
    }

    // --- Public API ---

    log('AI Preferences module loaded');

    return {
        get,
        set,
        update,
        reset,
        getDefaults,
        getAssertiveness,
        getAssertiveProfile,
        getDetailLevel,
        getSummarySections,
        getNoteTemplate,
        getGlobalInstruction,
        buildPersonalityPrefix,
        buildSectionInstructions,
        buildSummaryFormatSpec,
        buildNoteTemplateInstruction,
        openCustomizePanel
    };
})();

window.AIPreferences = AIPreferences;
