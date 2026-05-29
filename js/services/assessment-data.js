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
    const CASE_IDS = ['PAT002', 'PAT003', 'PAT004', 'PAT005', 'PAT006', 'PAT007'];

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
        PAT004: {
            primary: 'Acute unprovoked pulmonary embolism + extensive DVT with a concurrent 17 cm liver mass (with portal-vein thrombus) concerning for malignancy',
            secondary: 'The teaching point is competing-risk anticoagulation management, not the tissue diagnosis of the liver mass. The case turns on protecting the patient through the highest-recurrence-risk window after acute VTE while still pursuing the malignancy workup, and on recognizing that a recurrence during a peri-procedural anticoagulation HOLD is not an anticoagulation failure (and therefore generally not an IVC-filter indication).',
            causalChain: [
                'Acute unprovoked segmental PE + extensive right-leg DVT; low-risk at presentation (troponin negative, no RV strain)',
                'Incidental 17 cm right-hepatic-lobe mass with left-lobe foci and right portal-vein thrombus — high radiologic suspicion for malignancy; biopsy recommended (the unprovoked VTE + mass raises occult-malignancy concern)',
                'Competing risk: the biopsy requires interrupting anticoagulation, but VTE recurrence risk is highest in the first ~month — so anticoagulate ~3-4 weeks first and defer the (non-emergent) biopsy',
                'For the high-bleeding-risk liver biopsy, hold apixaban ~48h (renal-function dependent); DOACs do not require bridging',
                'IR held apixaban 3 days; during that hold the PE PROGRESSED to bilateral with RV strain and troponin elevation',
                'Because the recurrence occurred OFF anticoagulation (during a supervised hold), not despite therapeutic anticoagulation, the answer is to resume/optimize anticoagulation — an IVC filter is generally NOT indicated (a retrievable filter only if another mandatory interruption is truly unavoidable)',
            ],
            source: 'Adapted from the Management Case Bank (Case 2; original discussants Allyson Pishko, Brett Carroll, Jeff Weinstein; finalized by Zahir Kanjee).',
        },
        PAT005: {
            primary: 'Iatrogenic transfusion-associated circulatory overload from PROPHYLACTIC FFP given for an elevated INR before low-risk drainage procedures in cirrhosis',
            secondary: 'The teaching point is not a hidden diagnosis but recognizing and resisting a non-evidence-based practice documented in the chart: in cirrhosis the INR does not predict procedural bleeding (rebalanced hemostasis), prophylactic FFP is not indicated for low-risk para/thoracentesis, and repeated FFP caused volume overload. The case also tests cross-system communication and PleurX-vs-TIPS bridging decisions in a transplant candidate.',
            causalChain: [
                'Decompensated alcohol-related cirrhosis with diuretic-refractory ascites + right hepatic hydrothorax; diuretics could not be up-titrated (AKI/hyperkalemia/hyponatremia) → referred for mechanical drainage',
                'INR 2.0 and platelets 55 K reflect the hemostatic profile of cirrhosis — they do NOT mandate transfusion; para/thoracentesis are low-bleeding-risk, and the academic center correctly did them without prophylactic FFP',
                'A community radiologist, following an outdated protocol, gave 4 units FFP per weekly session for the elevated INR (documented in the outpatient procedure notes — the resident must surface it)',
                'Repeated peri-procedural FFP → transfusion-associated circulatory overload → flash pulmonary edema, intubation, ICU',
                'Management: collegial, evidence-based cross-system communication to stop the FFP while preserving her local access; bridge the recurrent hydrothorax (PleurX vs TIPS — TIPS risks worsening her hepatic encephalopathy; PleurX risks infection) toward transplant',
                'Liver transplant corrected the portal hypertension driving the fluid — ascites/hydrothorax resolved and drainage was no longer needed',
            ],
            source: 'Adapted from the Management Case Bank (Case 3; original discussants Allyson Pishko, Brett Carroll, Jeff Weinstein; finalized by Adam Rodman).',
        },
        PAT006: {
            primary: 'New-onset perioperative atrial fibrillation after urgent open cholecystectomy for perforated cholecystitis',
            secondary: 'The teaching point is NOT a hidden diagnosis but the management of new atrial fibrillation detected after major surgery: distinguishing potentially transient post-operative AF from incident paroxysmal AF, weighing stroke vs bleeding risk in a borderline patient who has just had surgery, and matching a monitoring strategy to an infrequent, asymptomatic arrhythmia.',
            causalChain: [
                'Acute perforated cholecystitis + urgent open cholecystectomy → acute inflammatory/surgical milieu that can trigger atrial fibrillation',
                'POD#1: three brief (15-20 sec) asymptomatic self-terminating AF runs on telemetry — minimal burden, early post-op; reversible triggers (electrolytes, pain, volume, inflammation) should be addressed and anticoagulation is premature',
                'POD#4: a single 2-hour asymptomatic AF episode (rate 70-105, hemodynamically tolerated) that spontaneously converts — establishes paroxysmal AF with a real, if uncertain, long-term burden',
                'CHA2DS2-VASc = 4 (age 65-74, female, hypertension, diabetes) favors anticoagulation by guideline, but recent major surgery and bleeding risk complicate the timing; the decision is patient-centered and shared',
                'If anticoagulated: a DOAC (e.g., standard-dose apixaban given eGFR ~68, weight >60 kg, age <80) is preferred over warfarin for non-valvular AF',
                'Because episodes are infrequent and ASYMPTOMATIC, post-discharge monitoring must use a long-duration auto-detecting monitor (extended patch / MCT / loop recorder), not a 24-48 h Holter or a symptom-triggered recorder, with closed-loop follow-up to refine the anticoagulation decision',
            ],
            source: 'Adapted from the Management Case Bank (Case 4; original discussants Nick Villano, Jason Matos, Greg Katz, Pooja Jagadish; finalized by Eric Strong).',
        },
        PAT007: {
            primary: 'Drug fever and drug-associated neurotoxicity from antibiotics, mistaken for refractory occult sepsis',
            secondary: 'The teaching point is cognitive humility / anti-anchoring: the team fixed on occult infection and kept escalating antibiotics despite a completely negative workup, nearly proceeding to comfort measures — when the syndrome was actually caused by the antibiotics themselves and resolved once they were stopped.',
            causalChain: [
                'Decompensated alcohol-related cirrhosis with involuntary weight loss → admitted; variceal hemorrhage → emergent TIPS (hemostasis achieved); ceftriaxone started, then broadened to vancomycin + meropenem for post-TIPS fevers/shock',
                'Persistent high fevers and refractory shock despite escalating broad-spectrum antibiotics, with an exhaustively NEGATIVE infectious workup (serial cultures NGTD, no abscess on CT, normal CSF, negative repeat paracentesis, normal procalcitonin, no rising leukocytosis; mild eosinophilia)',
                'The team remained anchored on occult infection (the chart embodies this) and did not consider that the antibiotics were causing a DRUG FEVER and drug-associated neurotoxicity',
                'At ~2 weeks, with MELD ~40 and no improvement, the family elected comfort measures — an irreversible decision made while a reversible, unconsidered diagnosis remained',
                'Antibiotics (and pressors) were stopped as part of comfort care; she unexpectedly defervesced, came off pressors, and woke up — revealing the drugs as the cause',
                'Lesson: persistent fever/shock on broad antibiotics with a negative workup should prompt actively considering non-infectious causes (drug fever) and a willingness to STOP the drugs before irreversible decisions',
            ],
            source: 'Adapted from the Management Case Bank (Case 5; original discussants Wendy Stead, Emily Rubin; finalized by Jason Hom).',
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
