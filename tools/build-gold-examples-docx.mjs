/**
 * Generates a formatted Word doc of the Teaching Tutor gold-standard examples.
 * Run with NODE_PATH pointed at the global modules so `docx` resolves.
 */
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const GLOBAL_ROOT = execSync('npm root -g').toString().trim();
const {
    Document, Packer, Paragraph, TextRun, ExternalHyperlink,
    HeadingLevel, AlignmentType, BorderStyle, LevelFormat,
} = require(path.join(GLOBAL_ROOT, 'docx'));

// Inline parser: handles **bold** and [text](url) within a string.
function inline(str, base = {}) {
    const runs = [];
    let i = 0;
    const re = /(\*\*([^*]+)\*\*)|(\[([^\]]+)\]\((https?:\/\/[^)]+)\))/g;
    let m;
    let last = 0;
    while ((m = re.exec(str))) {
        if (m.index > last) runs.push(new TextRun({ text: str.slice(last, m.index), ...base }));
        if (m[1]) {
            runs.push(new TextRun({ text: m[3], bold: true, ...base }));
        } else if (m[3]) {
            runs.push(new ExternalHyperlink({
                link: m[6],
                children: [new TextRun({ text: m[5], style: 'Hyperlink' })],
            }));
        }
        last = re.lastIndex;
    }
    if (last < str.length) runs.push(new TextRun({ text: str.slice(last), ...base }));
    return runs;
}

const P = (str, opts = {}) => new Paragraph({ children: inline(str), spacing: { after: 140 }, ...opts });
const SECTION = (label, body) =>
    new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun({ text: label + ' — ', bold: true, color: '6B5310' }), ...inline(body)],
    });

const examples = [
    {
        title: 'Example 1 — Competing-risk management',
        q: 'My patient has an unprovoked PE and was just found to have a liver mass that needs a biopsy. How long do I anticoagulate, and does the mass change my plan?',
        level: 'resident',
        answer: [
            'Treat the VTE on its own clock first: a minimum of three months of therapeutic anticoagulation for an acute PE, with a direct oral anticoagulant for most patients. The liver mass does not shorten that; if anything it pushes toward longer, because an unprovoked PE plus a possible malignancy is a high-recurrence, possibly persistent-risk picture.',
            'The mass changes logistics, not the duration: the biopsy is a planned bleeding-risk procedure, so the real decision is how to bridge the clot through a short, supervised anticoagulation hold for the procedure, not whether to stop anticoagulating. Coordinate the hold with whoever does the biopsy, keep it as short as possible, and resume promptly afterward. If the recurrence risk during the hold feels unacceptable, that is an IVC-filter conversation, not a "stop anticoagulation" conversation.',
        ],
        teaching: [
            ['Principle', 'This is competing-risk reasoning: two clocks (clot recurrence vs procedural bleeding) running at once. The frame from the [CHEST 2021 VTE guideline](https://journal.chestnet.org/article/S0012-3692(21)01506-3/fulltext) is that duration is driven by provoked-vs-unprovoked, while the procedure only dictates a brief, reversible interruption.'],
            ['The trap', 'Conflating "hold for the biopsy" with "the VTE is treated, so we can stop." The recurrence risk of an unprovoked, possibly cancer-associated PE does not go away during the hold; treating the hold as a stopping point is how people get a recurrent PE on the way to the procedure.'],
            ['What would change the answer', 'Tissue diagnosis. If the mass is malignant, this becomes cancer-associated VTE: extended anticoagulation and a preference for an oral Xa inhibitor in most patients. A genuine contraindication to anticoagulation during the hold (not just discomfort with risk) is what would move you toward an IVC filter.'],
            ['Pearl', '"Hold" is not "stop." Write the resume date and the resume dose at the same moment you write the hold order.'],
            ['Check yourself', 'Your patient’s biopsy is in three days and the interventional radiologist asks you to hold the apixaban now. What is the shortest defensible hold, and what is your plan if he develops chest pain during it?'],
        ],
    },
    {
        title: 'Example 2 — Bayesian diagnosis (test interpretation)',
        q: 'My patient has a positive D-dimer but I thought she was low risk for a PE. Do I have to CT scan her now?',
        level: 'med student',
        answer: [
            'A test result only means something against the pretest probability, so start there, not with the D-dimer. If she is genuinely low risk, the first move is a clinical decision rule: in a low-risk patient who meets all of the PERC criteria, you should not have sent a D-dimer at all, because the post-test probability is already below the testing threshold.',
            'If she is low (but not PERC-negative), a D-dimer is the right test, and you are now living with the result. A negative D-dimer in a low-probability patient rules out PE. A positive D-dimer in a low-probability patient is expected and largely uninformative (D-dimer is sensitive, not specific), and it is what commits you to CT pulmonary angiography. So yes, a positive D-dimer in a low-risk patient generally earns a CTPA, but the lesson is that the cascade was set in motion by ordering the D-dimer before settling the pretest probability.',
        ],
        teaching: [
            ['Principle', 'Bayes. The same result updates you differently depending on the prior, which is exactly the [PIOPED II](https://pubmed.ncbi.nlm.nih.gov/?term=PIOPED+II+computed+tomographic+pulmonary+angiography) lesson for imaging and the [Wells/PERC](https://pubmed.ncbi.nlm.nih.gov/?term=Kline+clinical+criteria+pulmonary+embolism+rule-out) lesson for D-dimer. Set the pretest probability first; it determines whether to test and how to read the result.'],
            ['The trap', 'Reflex D-dimer before assessing pretest probability. A sensitive, non-specific test ordered in a low-probability patient mostly generates false positives, each of which drags a low-risk patient into a contrast CT she likely did not need.'],
            ['What would change the answer', 'A higher pretest probability changes the whole pathway: in high-probability patients you skip the D-dimer and go straight to imaging, and a negative CT no longer fully reassures you (the discordant-result danger zone).'],
            ['Pearl', 'Don’t order a test whose result you can’t act on, before you know how you’d act on each result. D-dimer rules out; it does not rule in.'],
            ['Check yourself', 'Her D-dimer is back at 620 ng/mL. Before you book the CT: what was her Wells category, and would a negative CT have actually reassured you if she had been high risk?'],
        ],
    },
    {
        title: 'Example 3 — A counterintuitive landmark trial',
        q: 'Should I tightly control my ICU patient’s glucose to normal?',
        level: 'resident',
        answer: [
            'No. Target a moderate range of roughly 140 to 180 mg/dL, not normoglycemia. Tight control sounds physiologic, but the large NICE-SUGAR trial randomized critically ill adults to tight control (81 to 108) versus conventional (≤180) and found higher 90-day mortality with tight control, driven by severe hypoglycemia and glycemic variability.',
            'So treat hyperglycemia, avoid hypoglycemia even more, and don’t chase a normal number. Use a protocolized insulin infusion with frequent glucose checks in patients who need it, and accept "good enough" over "perfect."',
        ],
        teaching: [
            ['Principle', 'A physiologically appealing target is not the same as a better outcome. The endpoint that matters is patient-centered (mortality, harm), not the surrogate (a normal lab value). See [NICE-SUGAR](https://pubmed.ncbi.nlm.nih.gov/19318384/).'],
            ['The trap', 'Surrogate-outcome seduction, compounded by trusting a striking single-center result. Tight control was popularized by one center’s trial and then reversed by a large multicenter one; chasing the normal number caused net harm via hypoglycemia.'],
            ['What would change the answer', 'Context still matters: the specific population and protocol. NICE-SUGAR is the ICU answer; it does not dictate, say, outpatient diabetes targets. Match the evidence to the setting it was generated in.'],
            ['Pearl', 'In the ICU, the dangerous glucose is the low one. "140 to 180 and stable" beats "normal and brittle."'],
            ['Check yourself', 'Your patient’s glucose is 110 on an insulin drip and you feel good about it. Given NICE-SUGAR, what are you actually more worried about at 110 than at 160, and what would you change?'],
        ],
    },
    {
        title: 'Example 4 — The trial-vs-reality gap',
        q: 'When do I add spironolactone in heart failure, and what do I have to watch?',
        level: 'resident',
        answer: [
            'Add a mineralocorticoid-receptor antagonist (spironolactone or eplerenone) to an ACE inhibitor/ARB/ARNI plus beta-blocker in symptomatic HFrEF with an ejection fraction at or below ~35%. The mortality benefit is large and old: RALES showed roughly a 30% reduction in all-cause mortality in NYHA III to IV HFrEF.',
            'But the benefit is inseparable from the safety scaffolding. Start only if potassium is below ~5.0 and renal function is adequate (e.g., eGFR above ~30), use a low dose, and recheck potassium and creatinine within about a week and again after dose changes. If you can’t monitor it, you shouldn’t start it.',
        ],
        teaching: [
            ['Principle', 'Guideline-directed therapy is a package: the right patient, the right dose, and the monitoring that made the trial safe. The drug’s benefit and its safety came from the same protocol. See [RALES](https://www.nejm.org/doi/full/10.1056/NEJM199909023411001).'],
            ['The trap', 'Implementation drift. After RALES, real-world prescribing without its potassium/renal selection and monitoring drove a measurable rise in hyperkalemia hospitalizations and deaths. The pill alone is not the intervention; the pill plus the monitoring is.'],
            ['What would change the answer', 'Baseline potassium and renal function. A patient with K+ of 5.3 or an eGFR of 22 is a different decision, as is a patient you cannot reliably get follow-up labs on. CKD, other potassium-raising drugs, and adherence all move the risk/benefit.'],
            ['Pearl', 'Before you start the spironolactone, book the potassium recheck. The order set isn’t done until the follow-up lab is scheduled.'],
            ['Check yourself', 'Your HFrEF patient has a K+ of 4.9 and an eGFR of 38 and takes lisinopril. Do you start spironolactone today, and exactly when is the next potassium?'],
        ],
    },
    {
        title: 'Example 5 — A diagnostic schema (framework-forward)',
        q: 'How should I think about hyponatremia? I always get lost.',
        level: 'med student',
        answer: [
            'Don’t memorize a list, run a schema. First confirm it’s true hypotonic hyponatremia (check serum osmolality to exclude pseudo- and hyperosmolar causes like hyperglycemia). Then the master branch point is volume status: hypovolemic, euvolemic, or hypervolemic.',
            'Hypovolemic: losses (GI, diuretics, salt-wasting); urine sodium helps localize renal vs extrarenal. Euvolemic: think SIADH (a diagnosis of exclusion after thyroid and cortisol are normal), plus water intoxication and low-solute states. Hypervolemic: the edematous states (heart failure, cirrhosis, nephrotic/kidney disease) where total-body water is up.',
            'Urine osmolality and urine sodium are the two labs that move you through the branches. Correct at a safe rate to avoid osmotic demyelination.',
        ],
        teaching: [
            ['Principle', 'Use a [diagnostic schema](https://clinicalproblemsolving.com): a branching framework with one strong first split (here, volume status) rather than a flat differential. Schemas make reasoning reproducible and teachable, the core idea behind the Clinical Problem Solvers approach.'],
            ['The trap', 'Premature closure on "SIADH" before establishing euvolemia and excluding hypothyroidism and adrenal insufficiency. SIADH is the euvolemic leftover, not the reflex answer; calling it early skips the branch work.'],
            ['What would change the answer', 'The first two labs: serum osmolality (is it truly hypotonic?) and assessed volume status, then urine osmolality and urine sodium. Each reading reroutes you down a different branch, which is the whole point of a schema.'],
            ['Pearl', 'Two numbers do most of the work in hyponatremia: urine osmolality (is ADH on?) and urine sodium (is the kidney holding or wasting salt?).'],
            ['Check yourself', 'Serum is hypotonic, the patient looks euvolemic, urine osm is 600 and urine Na is 50. What’s your leading diagnosis, and what two tests must be normal before you commit to it?'],
        ],
    },
];

const children = [];
children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Teaching Tutor — Gold-Standard Example Answers')] }));
children.push(P('Hand-authored exemplars that define the quality bar for the tutor: what a very cool educational answer should look like. Each pairs a crisp clinician answer with structured teaching points (Principle / The trap / What would change the answer / Pearl / Check yourself), names the landmark study or framework, and links it.'));
children.push(P('These span different kinds of thinking, not just different topics: competing-risk management, Bayesian diagnosis, a counterintuitive trial, the trial-vs-reality gap, and a diagnostic schema.'));

for (const ex of examples) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 280, after: 120 }, children: [new TextRun(ex.title)] }));
    children.push(new Paragraph({
        spacing: { after: 140 },
        children: [
            new TextRun({ text: `Question (${ex.level}): `, bold: true }),
            new TextRun({ text: ex.q, italics: true }),
        ],
    }));
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_3, spacing: { before: 80, after: 80 }, children: [new TextRun('Answer')] }));
    ex.answer.forEach((a) => children.push(P(a)));
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_3, spacing: { before: 120, after: 80 }, children: [new TextRun('Teaching points')] }));
    ex.teaching.forEach(([label, body]) => children.push(SECTION(label, body)));
}

children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 320, after: 120 }, children: [new TextRun('What makes these the bar')] }));
const barPoints = [
    'The answer is genuinely good and concise — a strong clinician answer, not a textbook dump.',
    'The teaching teaches around the answer, it doesn’t restate it: it names the principle, the specific trap, and the feature that flips the decision.',
    'It transfers — every example names a reusable frame (competing risk, Bayes, surrogate-vs-outcome, trial-vs-reality, diagnostic schema).',
    'Citations are real and linked, anchored to landmark trials/guidelines/frameworks.',
    '"Check yourself" is a real probe — a specific micro-case the learner must reason through.',
];
barPoints.forEach((b) =>
    children.push(new Paragraph({ numbering: { reference: 'bullets', level: 0 }, spacing: { after: 80 }, children: inline(b) }))
);

const doc = new Document({
    styles: {
        default: { document: { run: { font: 'Calibri', size: 22 } } },
        paragraphStyles: [
            { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 34, bold: true, color: '1B3A5C' }, paragraph: { spacing: { after: 200 }, outlineLevel: 0 } },
            { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 26, bold: true, color: '1B3A5C' }, paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 1, border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'D5DBE3', space: 4 } } } },
            { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 22, bold: true, color: '2B6CB0' }, paragraph: { spacing: { before: 100, after: 60 }, outlineLevel: 2 } },
        ],
    },
    numbering: {
        config: [
            { reference: 'bullets', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 260 } } } }] },
        ],
    },
    sections: [{
        properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
        children,
    }],
});

const outNames = [
    path.join(os.homedir(), 'Downloads', 'Teaching-Tutor-Gold-Examples.docx'),
    path.join(os.homedir(), 'Desktop', 'Teaching-Tutor-Gold-Examples.docx'),
];
const buf = await Packer.toBuffer(doc);
for (const out of outNames) {
    try { fs.writeFileSync(out, buf); console.log('Wrote', out); }
    catch (e) { console.warn('Skip', out, e.message); }
}
