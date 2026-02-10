/**
 * Longitudinal Document Renderer
 *
 * Converts a LongitudinalClinicalDocument into a markdown text format
 * optimized for LLM consumption.
 */

class LongitudinalDocumentRenderer {
    constructor(options = {}) {
        this.options = {
            format: options.format || 'detailed', // 'detailed', 'summary', 'compact'
            maxTokens: options.maxTokens || 50000,
            prioritizeRecent: options.prioritizeRecent !== false,
            includeNarrative: options.includeNarrative !== false,
            includeLabTrends: options.includeLabTrends !== false,
            maxLabDates: options.maxLabDates || 10,
            maxVitalsRows: options.maxVitalsRows || 15,
            ...options
        };
    }

    // ============================================================
    // MAIN RENDER METHOD
    // ============================================================

    render(doc) {
        const sections = [];

        // 1. Patient Header
        sections.push(this.renderPatientHeader(doc));

        // 2. Safety-Critical Information (always first after header)
        sections.push(this.renderSafetySection(doc));

        // 3. Problem-Oriented Matrix
        sections.push(this.renderProblemMatrix(doc));

        // 4. Lab Trends
        if (this.options.includeLabTrends) {
            sections.push(this.renderLabTrends(doc));
        }

        // 5. Vital Sign Trends
        sections.push(this.renderVitalTrends(doc));

        // 6. Medication Timeline
        sections.push(this.renderMedications(doc));

        // 7. Clinical Narrative (if enabled and has content)
        if (this.options.includeNarrative) {
            const narrative = this.renderClinicalNarrative(doc);
            if (narrative.trim()) sections.push(narrative);
        }

        // 8. Session Context (doctor's thoughts, reviewed items, etc.)
        sections.push(this.renderSessionContext(doc));

        // Join with clear separators
        return sections.filter(s => s && s.trim()).join('\n\n' + '='.repeat(60) + '\n\n');
    }

    // ============================================================
    // PATIENT HEADER
    // ============================================================

    renderPatientHeader(doc) {
        const demo = doc.patientSnapshot.demographics;
        if (!demo) return '# PATIENT: Unknown';

        const age = this.calculateAge(demo.dateOfBirth);
        const name = [demo.lastName, demo.firstName, demo.middleName].filter(Boolean).join(', ');

        let header = `# PATIENT: ${name}
MRN: ${demo.mrn || 'Unknown'} | DOB: ${demo.dateOfBirth || 'Unknown'} (${age} yo ${demo.sex || 'Unknown'})
PCP: ${doc.patientSnapshot.primaryProvider?.name || 'Unknown'}
Code Status: ${doc.patientSnapshot.codeStatus || 'Full Code'}`;

        if (doc.patientSnapshot.advanceDirectives?.livingWill) {
            header += `\nAdvance Directives: Living Will on file`;
        }

        return header;
    }

    // ============================================================
    // SAFETY SECTION
    // ============================================================

    renderSafetySection(doc) {
        let text = `## SAFETY-CRITICAL INFORMATION (ALWAYS REVIEW)\n\n`;

        // Allergies
        text += `### ALLERGIES:\n`;
        const allergies = doc.patientSnapshot.allergies;
        if (!allergies || allergies.length === 0) {
            text += `NKDA (No Known Drug Allergies)\n`;
        } else {
            for (const allergy of allergies) {
                const severityIcon = allergy.severity === 'Severe' ? '!!!' :
                                     allergy.severity === 'Moderate' ? '!!' : '!';
                text += `${severityIcon} ${allergy.substance} (${allergy.type || 'Drug'}): ${allergy.reaction || 'Unknown reaction'} [${allergy.severity || 'Unknown severity'}]\n`;
            }
        }

        // Active safety flags
        const flags = doc.sessionContext.safetyFlags;
        if (flags && flags.length > 0) {
            text += `\n### ACTIVE SAFETY FLAGS:\n`;
            for (const flag of flags) {
                const icon = flag.severity === 'critical' ? '!!!' : '!!';
                text += `${icon} ${flag.text}\n`;
            }
        }

        return text;
    }

    // ============================================================
    // PROBLEM MATRIX
    // ============================================================

    renderProblemMatrix(doc) {
        let text = `## PROBLEM-ORIENTED LONGITUDINAL MATRIX\n\n`;

        // Group problems by category
        const categories = this.groupProblemsByCategory(doc.problemMatrix);

        // Sort categories by clinical priority
        const priorityOrder = ['cardiovascular', 'renal', 'endocrine', 'pulmonary', 'gi', 'hematologic', 'infectious', 'neurologic', 'psychiatric', 'musculoskeletal', 'other'];

        const sortedCategories = [...categories.entries()].sort((a, b) =>
            priorityOrder.indexOf(a[0]) - priorityOrder.indexOf(b[0])
        );

        for (const [category, problems] of sortedCategories) {
            if (problems.size === 0) continue;

            text += `### ${category.toUpperCase()}\n\n`;

            for (const [problemId, timeline] of problems) {
                // Only render problems with data or that are active
                if (!timeline.hasAnyData() && timeline.problem.status !== 'active') continue;

                text += this.renderProblemTimeline(timeline, doc);
                text += '\n';
            }
        }

        return text;
    }

    renderProblemTimeline(timeline, doc) {
        const p = timeline.problem;
        let text = `#### ${p.name}`;
        if (p.icd10) text += ` [${p.icd10}]`;
        text += ` - Status: ${p.status.toUpperCase()}\n`;

        if (p.onsetDate) {
            text += `Onset: ${this.formatDate(p.onsetDate)}`;
        }
        if (p.priority) {
            text += ` | Priority: ${p.priority}`;
        }
        text += '\n\n';

        // Render timeline as table
        text += `| Time Period | Status | Key Events | Labs | Medications |\n`;
        text += `|------------|--------|------------|------|-------------|\n`;

        for (const period of doc.options.timePeriods) {
            const data = timeline.getPeriodData(period.label);
            if (!data) continue;

            const status = data.status?.trend || 'N/A';
            const events = data.encounters.length > 0 ?
                `${data.encounters.length} enc` : '-';

            // Summarize labs
            const labSummary = data.labs.slice(0, 3).map(l => {
                const flag = l.flag ? `(${l.flag})` : '';
                return `${this.abbreviateLab(l.name)}: ${l.value}${flag}`;
            }).join('; ') || '-';

            // Summarize medication changes
            const medChanges = [
                ...data.medications.started.map(m => `+${this.abbreviateMed(m.name)}`),
                ...data.medications.stopped.map(m => `-${this.abbreviateMed(m.name)}`),
                ...data.medications.adjusted.map(m => `~${this.abbreviateMed(m.name)}`)
            ].slice(0, 3).join(', ') || '-';

            text += `| ${period.label} | ${status} | ${events} | ${labSummary} | ${medChanges} |\n`;
        }

        // Add recent note excerpts
        const allNotes = [];
        for (const [periodLabel, data] of timeline.timeline) {
            if (data.notes) allNotes.push(...data.notes);
        }
        const recentNotes = allNotes.slice(0, 3);

        if (recentNotes.length > 0) {
            text += `\n**Recent Notes:**\n`;
            for (const note of recentNotes) {
                const date = this.formatDate(note.date);
                const excerpt = note.excerpt || 'No excerpt available';
                text += `- ${date}: "${excerpt.substring(0, 150)}${excerpt.length > 150 ? '...' : ''}"\n`;
            }
        }

        // Add critical context if relevant
        if (p.notes) {
            text += `\n**Critical Context:** ${p.notes}\n`;
        }

        return text;
    }

    groupProblemsByCategory(problemMatrix) {
        const groups = new Map();

        for (const [id, timeline] of problemMatrix) {
            const category = timeline.problem.category;
            if (!groups.has(category)) {
                groups.set(category, new Map());
            }
            groups.get(category).set(id, timeline);
        }

        return groups;
    }

    // ============================================================
    // LAB TRENDS
    // ============================================================

    renderLabTrends(doc) {
        const labs = doc.longitudinalData.labs;
        if (!labs || labs.size === 0) return '';

        let text = `## LABORATORY TRENDS\n\n`;

        // Group labs by clinical relevance
        const labGroups = {
            'Renal Function': ['BUN', 'Creatinine', 'eGFR', 'Potassium'],
            'Cardiac Markers': ['BNP', 'NT-proBNP', 'Troponin', 'Troponin I', 'Troponin T'],
            'Diabetes Management': ['Glucose', 'Hemoglobin A1c', 'HbA1c'],
            'Complete Blood Count': ['Hemoglobin', 'Hematocrit', 'WBC', 'Platelets'],
            'Coagulation': ['PT', 'INR', 'PTT'],
            'Electrolytes': ['Sodium', 'Chloride', 'CO2', 'Calcium', 'Magnesium', 'Phosphorus'],
            'Liver Function': ['AST', 'ALT', 'Alkaline Phosphatase', 'Bilirubin', 'Albumin'],
            'Lipids': ['Total Cholesterol', 'LDL', 'HDL', 'Triglycerides']
        };

        for (const [groupName, labNames] of Object.entries(labGroups)) {
            const groupLabs = labNames
                .map(name => {
                    // Find labs that match this name (case-insensitive partial match)
                    for (const [labName, trend] of labs) {
                        if (labName.toLowerCase().includes(name.toLowerCase())) {
                            return trend;
                        }
                    }
                    return null;
                })
                .filter(Boolean);

            if (groupLabs.length > 0) {
                text += `### ${groupName}\n`;
                text += this.renderLabTable(groupLabs);
                text += '\n';
            }
        }

        return text;
    }

    renderLabTable(labTrends) {
        // Collect all unique dates
        const allDates = new Set();
        for (const trend of labTrends) {
            for (const v of trend.values) {
                allDates.add(v.date.toISOString().split('T')[0]);
            }
        }

        // Sort dates (most recent first) and limit
        const sortedDates = Array.from(allDates)
            .sort()
            .reverse()
            .slice(0, this.options.maxLabDates);

        if (sortedDates.length === 0) return 'No data available\n';

        // Build header
        let text = `| Lab | ${sortedDates.map(d => d.slice(5)).join(' | ')} | Trend |\n`;
        text += `|-----|${'------|'.repeat(sortedDates.length + 1)}\n`;

        // Build rows
        for (const trend of labTrends) {
            const values = sortedDates.map(date => {
                const match = trend.values.find(v =>
                    v.date.toISOString().split('T')[0] === date
                );
                if (!match) return '-';
                const flag = match.flag ? `(${match.flag})` : '';
                return `${match.value}${flag}`;
            });

            const trendIndicator = this.getTrendIndicator(trend.trend);
            text += `| ${this.abbreviateLab(trend.name)} | ${values.join(' | ')} | ${trendIndicator} |\n`;
        }

        return text;
    }

    getTrendIndicator(trend) {
        switch (trend) {
            case 'rising': return '↑';
            case 'rising significantly': return '↑↑';
            case 'falling': return '↓';
            case 'falling significantly': return '↓↓';
            case 'fluctuating': return '↕';
            case 'stable': return '→';
            default: return '?';
        }
    }

    // ============================================================
    // VITAL SIGNS
    // ============================================================

    renderVitalTrends(doc) {
        const vitals = doc.longitudinalData.vitals;
        if (!vitals || vitals.length === 0) return '';

        let text = `## VITAL SIGN TRENDS\n\n`;

        // Most recent vitals
        const recentVitals = vitals.slice(0, this.options.maxVitalsRows);

        text += `| Date | BP | HR | RR | SpO2 | Temp | Weight | Pain |\n`;
        text += `|------|----|----|----|----|-------|--------|------|\n`;

        for (const v of recentVitals) {
            const date = this.formatDate(v.date);
            const bp = `${v.systolic || '?'}/${v.diastolic || '?'}`;
            const hr = v.heartRate || '-';
            const rr = v.respiratoryRate || '-';
            const spo2 = v.spO2 ? `${v.spO2}%` : '-';
            const temp = v.temperature || '-';
            const weight = v.weight ? `${v.weight}kg` : '-';
            const pain = v.painScore !== undefined ? `${v.painScore}/10` : '-';

            text += `| ${date} | ${bp} | ${hr} | ${rr} | ${spo2} | ${temp} | ${weight} | ${pain} |\n`;
        }

        // Add trend analysis
        text += `\n**Trends:**\n`;
        text += this.analyzeVitalTrends(vitals);

        return text;
    }

    analyzeVitalTrends(vitals) {
        if (vitals.length < 2) return '- Insufficient data for trend analysis\n';

        const recent = vitals.slice(0, 10);
        let analysis = '';

        // Weight trend
        const weights = recent.filter(v => v.weight).map(v => v.weight);
        if (weights.length >= 2) {
            const avgWeight = weights.reduce((a, b) => a + b, 0) / weights.length;
            const latestWeight = weights[0];
            const oldestWeight = weights[weights.length - 1];
            const change = latestWeight - oldestWeight;

            if (Math.abs(change) > 2) {
                const direction = change > 0 ? 'GAINED' : 'LOST';
                const concern = change > 2 ? ' (possible fluid retention)' : '';
                analysis += `- Weight: ${direction} ${Math.abs(change).toFixed(1)}kg over ${weights.length} measurements${concern}\n`;
            } else {
                analysis += `- Weight: STABLE around ${avgWeight.toFixed(1)}kg\n`;
            }
        }

        // BP trend
        const systolics = recent.filter(v => v.systolic).map(v => v.systolic);
        if (systolics.length >= 2) {
            const avgSystolic = systolics.reduce((a, b) => a + b, 0) / systolics.length;
            const status = avgSystolic > 140 ? 'ELEVATED' :
                          avgSystolic < 100 ? 'LOW' : 'CONTROLLED';
            analysis += `- BP: ${status} (avg systolic: ${avgSystolic.toFixed(0)})\n`;
        }

        // SpO2 trend
        const spo2s = recent.filter(v => v.spO2).map(v => v.spO2);
        if (spo2s.length >= 2) {
            const avgSpO2 = spo2s.reduce((a, b) => a + b, 0) / spo2s.length;
            const minSpO2 = Math.min(...spo2s);
            if (minSpO2 < 92) {
                analysis += `- SpO2: CONCERNING - dipped to ${minSpO2}% (avg: ${avgSpO2.toFixed(0)}%)\n`;
            } else if (avgSpO2 < 95) {
                analysis += `- SpO2: BORDERLINE (avg: ${avgSpO2.toFixed(0)}%)\n`;
            }
        }

        return analysis || '- Vitals appear stable\n';
    }

    // ============================================================
    // MEDICATIONS
    // ============================================================

    renderMedications(doc) {
        let text = `## MEDICATIONS\n\n`;

        // Current medications grouped by indication
        const meds = doc.longitudinalData.medications.current;
        if (meds && meds.length > 0) {
            text += `### Current Medications\n`;
            const medsByIndication = this.groupMedsByIndication(meds);

            for (const [indication, indMeds] of Object.entries(medsByIndication)) {
                text += `**${indication}:**\n`;
                for (const med of indMeds) {
                    let line = `- ${med.name}`;
                    if (med.dose) line += ` ${med.dose}`;
                    if (med.route) line += ` ${med.route}`;
                    if (med.frequency) line += ` ${med.frequency}`;
                    if (med.instructions) line += ` - ${med.instructions}`;
                    text += line + '\n';
                }
            }
        }

        // Recent changes
        const changes = doc.longitudinalData.medications.recentChanges;
        if (changes && changes.length > 0) {
            text += `\n### Recent Medication Changes (90 days)\n`;
            for (const change of changes.slice(0, 10)) {
                const date = this.formatDate(change.date);
                const icon = change.type === 'started' ? '+' :
                            change.type === 'stopped' ? '-' : '~';
                const reason = change.reason ? ` - ${change.reason}` : '';
                text += `${date}: ${icon} ${change.name}${change.dose ? ' ' + change.dose : ''}${reason}\n`;
            }
        }

        return text;
    }

    groupMedsByIndication(meds) {
        const groups = {};
        for (const med of meds) {
            const indication = med.indication || 'Other';
            if (!groups[indication]) groups[indication] = [];
            groups[indication].push(med);
        }
        return groups;
    }

    // ============================================================
    // CLINICAL NARRATIVE
    // ============================================================

    renderClinicalNarrative(doc) {
        const narrative = doc.clinicalNarrative;
        let text = `## CLINICAL NARRATIVE\n\n`;
        let hasContent = false;

        // Disease trajectory
        if (narrative.trajectoryAssessment) {
            text += `### Disease Trajectory Assessment\n`;
            text += narrative.trajectoryAssessment + '\n\n';
            hasContent = true;
        } else {
            // Auto-generate trajectory from problem data
            const trajectory = this.generateTrajectoryAssessment(doc);
            if (trajectory) {
                text += `### Disease Trajectory Assessment\n`;
                text += trajectory + '\n\n';
                hasContent = true;
            }
        }

        // Key findings
        if (narrative.keyFindings && narrative.keyFindings.length > 0) {
            text += `### Key Findings\n`;
            for (const f of narrative.keyFindings) {
                text += `- ${f}\n`;
            }
            text += '\n';
            hasContent = true;
        }

        // Patient voice
        if (narrative.patientVoice) {
            text += `### Patient Reported\n`;
            text += `"${narrative.patientVoice}"\n\n`;
            hasContent = true;
        }

        // Nursing assessment
        if (narrative.nursingAssessment) {
            text += `### Nursing Assessment\n`;
            text += narrative.nursingAssessment + '\n\n';
            hasContent = true;
        }

        // Open questions
        if (narrative.openQuestions && narrative.openQuestions.length > 0) {
            text += `### Unresolved Clinical Questions\n`;
            for (const q of narrative.openQuestions) {
                text += `? ${q}\n`;
            }
            hasContent = true;
        }

        return hasContent ? text : '';
    }

    generateTrajectoryAssessment(doc) {
        const trajectories = [];

        for (const [problemId, timeline] of doc.problemMatrix) {
            if (timeline.problem.status !== 'active') continue;

            const recent = timeline.getPeriodData('Past 30 Days');
            const older = timeline.getPeriodData('Past 90 Days');

            let status = '';

            // Determine trajectory from period data
            if (recent && recent.status?.trend) {
                status = recent.status.trend;
            } else if (recent && !recent.isEmpty()) {
                // Infer from data
                if (recent.encounters.length > 2) {
                    status = 'actively managed';
                } else if (recent.medications.started.length > 0) {
                    status = 'treatment escalation';
                } else if (recent.medications.stopped.length > 0) {
                    status = 'treatment de-escalation';
                }
            }

            if (status) {
                trajectories.push(`- **${timeline.problem.name}**: ${status}`);
            }
        }

        return trajectories.length > 0 ? trajectories.join('\n') : null;
    }

    // ============================================================
    // SESSION CONTEXT
    // ============================================================

    renderSessionContext(doc) {
        const ctx = doc.sessionContext;
        let text = `## CURRENT SESSION CONTEXT\n\n`;
        let hasContent = false;

        // Doctor's dictation (most important)
        if (ctx.doctorDictation && ctx.doctorDictation.length > 0) {
            text += `### Physician's Assessment/Reasoning\n`;
            for (const d of ctx.doctorDictation) {
                const time = d.timestamp ? new Date(d.timestamp).toLocaleTimeString() : '';
                text += `[${time}] "${d.text}"\n`;
            }
            text += '\n';
            hasContent = true;
        }

        // Patient conversation (what the patient told us)
        if (ctx.patientConversation && ctx.patientConversation.length > 0) {
            text += `### Patient Interview (Recent)\n`;
            text += `The following is the recent conversation between the physician and the patient:\n`;
            for (const msg of ctx.patientConversation) {
                const speaker = msg.role === 'doctor' ? 'Doctor' : 'Patient';
                text += `${speaker}: ${msg.content}\n`;
            }
            text += '\n';
            hasContent = true;
        }

        // Nurse conversation (what the nurse reported)
        if (ctx.nurseConversation && ctx.nurseConversation.length > 0) {
            text += `### Nurse Communication (Recent)\n`;
            text += `The following is the recent conversation between the physician and the nurse:\n`;
            for (const msg of ctx.nurseConversation) {
                const speaker = msg.role === 'doctor' ? 'Doctor' : 'Nurse';
                text += `${speaker}: ${msg.content}\n`;
            }
            text += '\n';
            hasContent = true;
        }

        // AI observations
        if (ctx.aiObservations && ctx.aiObservations.length > 0) {
            text += `### AI Observations\n`;
            for (const obs of ctx.aiObservations) {
                text += `- ${obs}\n`;
            }
            text += '\n';
            hasContent = true;
        }

        // Reviewed items
        if (ctx.reviewedItems && ctx.reviewedItems.length > 0) {
            text += `### Reviewed This Session\n`;
            for (const item of ctx.reviewedItems) {
                text += `[x] ${item}\n`;
            }
            text += '\n';
            hasContent = true;
        }

        // Pending items
        if (ctx.pendingItems && ctx.pendingItems.length > 0) {
            text += `### Pending/Open Items\n`;
            for (const item of ctx.pendingItems) {
                text += `[ ] ${item}\n`;
            }
            hasContent = true;
        }

        return hasContent ? text : '';
    }

    // ============================================================
    // UTILITY METHODS
    // ============================================================

    calculateAge(dob) {
        if (!dob) return 'Unknown';
        const birthDate = new Date(dob);
        const today = new Date();
        let age = today.getFullYear() - birthDate.getFullYear();
        const monthDiff = today.getMonth() - birthDate.getMonth();
        if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
            age--;
        }
        return age;
    }

    formatDate(dateStr) {
        if (!dateStr) return 'Unknown';
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-US', {
            month: 'numeric',
            day: 'numeric',
            year: '2-digit'
        });
    }

    abbreviateLab(labName) {
        const abbreviations = {
            'Hemoglobin A1c': 'HbA1c',
            'Hemoglobin': 'Hgb',
            'Hematocrit': 'Hct',
            'White Blood Cell': 'WBC',
            'Blood Urea Nitrogen': 'BUN',
            'Creatinine': 'Cr',
            'Potassium': 'K',
            'Sodium': 'Na',
            'Chloride': 'Cl',
            'Carbon Dioxide': 'CO2',
            'Alkaline Phosphatase': 'ALP',
            'Alanine Aminotransferase': 'ALT',
            'Aspartate Aminotransferase': 'AST',
            'Brain Natriuretic Peptide': 'BNP',
            'Glomerular Filtration Rate': 'eGFR',
            'Prothrombin Time': 'PT',
            'International Normalized Ratio': 'INR',
            'Partial Thromboplastin Time': 'PTT'
        };

        return abbreviations[labName] || labName;
    }

    abbreviateMed(medName) {
        // Return first word or first 15 chars
        const firstWord = medName.split(' ')[0];
        return firstWord.length > 15 ? firstWord.substring(0, 12) + '...' : firstWord;
    }
}

// ============================================================
// EXPORTS
// ============================================================

window.LongitudinalDocumentRenderer = LongitudinalDocumentRenderer;

console.log('Longitudinal Document Renderer loaded');
