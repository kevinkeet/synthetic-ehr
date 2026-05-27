/**
 * AssessmentData — loads static assessment definitions from
 * `data/assessments/{caseId}/{index|ap1..apN}.json`.
 *
 * No Supabase. Pure file loader with in-memory cache.
 *
 * Exposes:
 *   AssessmentData.listCases()           → [{caseId, caseTitle, ...meta}]
 *   AssessmentData.loadCase(caseId)      → { meta, assessments: [ap1, ap2, ...] }
 *   AssessmentData.getAssessment(caseId, apId)    → single AP definition
 *   AssessmentData.getPrompt(caseId, apId, promptId)
 *   AssessmentData.getCaseDiagnosis(caseId)       → spoiler text for results page
 */

const AssessmentData = (() => {
    const BASE = 'data/assessments';

    // List of cases offered. Add new caseIds here as they're scaffolded.
    const CASE_IDS = ['PAT002', 'PAT003'];

    // Per-case diagnosis reveal (used on the results page only).
    // Lives in code rather than the JSON so it can't accidentally leak via
    // the chart-loading path during the test.
    const CASE_DIAGNOSES = {
        PAT002: {
            primary: 'Active systemic lupus erythematosus with inflammatory myositis',
            secondary: 'Severe protein-calorie malnutrition / kwashiorkor from starvation',
            causalChain: [
                'SLE → inflammatory myositis (oropharyngeal muscle involvement)',
                'Myositis → oropharyngeal dysphagia',
                'Dysphagia + social-determinant amplifiers (insurance loss, language, food access) → progressive starvation',
                'Starvation → kwashiorkor (hypoalbuminemia, edema, scaling rash, hair changes)',
            ],
            source: 'Adapted from NEJM Clinical Problem-Solving "Peeling and Plummeting" (2024).',
        },
        PAT003: {
            primary: 'Incidental 2.5 cm right upper lobe pulmonary nodule, indeterminate — discovered during prolonged ICU admission for severe biliary pancreatitis',
            secondary: 'The teaching point is NOT the final diagnosis of the nodule (which requires biopsy or 3-month interval imaging) but the safe operationalization of the workup at discharge in a complex patient.',
            causalChain: [
                'Nodule discovered HD3 on a CXR ordered for sepsis workup',
                'Confirmed HD~29 on dedicated chest CT with radiologist recommendation (biopsy or 3-month repeat)',
                'Mentioned in HD5 ID consult, HD8 MICU progress note — then dropped off all subsequent progress notes for 49 days',
                'Re-surfaced only on imaging review at discharge — was never added to the discharge summary as a follow-up item until the resident catches it',
                'Decision point: hospitalize for biopsy now (risks: deconditioning, nosocomial infection, anticoagulation conflict) vs defer to outpatient (risks: loss to follow-up given language barrier, cost concerns, fragmented care across multiple specialties)',
            ],
            source: 'Adapted from the Management Case Bank (Case 1; original discussants Anil Vachani, Corinne Rhodes, Karin Ouchida; finalized by Parsons).',
        },
    };

    // ── cache ──────────────────────────────────────────────────────────
    const _cache = new Map();

    function _getBaseUrl() {
        // Mirror dataLoader.getBaseUrl behavior so GitHub Pages works.
        if (window.location.hostname.includes('github.io')) {
            const parts = window.location.pathname.split('/');
            const repoName = parts[1];
            return `/${repoName}/${BASE}`;
        }
        return BASE;
    }

    async function _fetchJson(path) {
        if (_cache.has(path)) return _cache.get(path);
        const res = await fetch(path);
        if (!res.ok) throw new Error(`Failed to fetch ${path}: HTTP ${res.status}`);
        const data = await res.json();
        _cache.set(path, data);
        return data;
    }

    // ── public ─────────────────────────────────────────────────────────

    function listCases() {
        // Lazy load case metadata to keep the manifest cheap.
        return CASE_IDS.map((id) => ({ caseId: id }));
    }

    async function loadCaseMeta(caseId) {
        const base = _getBaseUrl();
        return await _fetchJson(`${base}/${caseId}/index.json`);
    }

    async function loadCase(caseId) {
        const meta = await loadCaseMeta(caseId);
        const ids = meta.assessments || [];
        const assessments = await Promise.all(
            ids.map((apId) => loadAssessment(caseId, apId))
        );
        // Sort by `order` field, fall back to array index.
        assessments.sort((a, b) => (a.order || 0) - (b.order || 0));
        return { meta, assessments };
    }

    async function loadAssessment(caseId, apId) {
        const base = _getBaseUrl();
        const slug = String(apId).toLowerCase();
        return await _fetchJson(`${base}/${caseId}/${slug}.json`);
    }

    async function getPrompt(caseId, apId, promptId) {
        const ap = await loadAssessment(caseId, apId);
        return (ap.prompts || []).find((p) => p.id === promptId) || null;
    }

    function getCaseDiagnosis(caseId) {
        return CASE_DIAGNOSES[caseId] || null;
    }

    function clearCache() {
        _cache.clear();
    }

    return {
        listCases,
        loadCaseMeta,
        loadCase,
        loadAssessment,
        getPrompt,
        getCaseDiagnosis,
        clearCache,
    };
})();

window.AssessmentData = AssessmentData;
