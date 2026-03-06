/**
 * Ambient AI Scribe Service
 *
 * Passively listens to doctor-patient conversations via the microphone,
 * transcribes in real-time, identifies speakers using Claude, and extracts
 * clinical findings (symptoms, exam findings, assessments, concerns).
 *
 * Two modes:
 * 1. Single mic (default): One SpeechRecognition captures all audio,
 *    Claude infers speaker identity from conversational context.
 * 2. Dual mic (future): Separate channels for doctor and patient.
 *
 * Key difference from hands-free mode:
 * - Hands-free = doctor intentionally talks TO the AI
 * - Ambient scribe = AI passively overhears doctor talking TO the patient
 *
 * Mutual exclusion: Only one can be active at a time (single SpeechRecognition per origin).
 */

const AmbientScribe = {
    // State
    isListening: false,
    recognition: null,
    conversationLog: [],          // [{speaker, text, timestamp, isFinal}]
    rawChunks: [],                // Raw transcript chunks before diarization
    extractedFindings: [],        // [{type, text, speaker, confidence, timestamp}]
    encounterSummary: null,       // LLM-generated encounter summary
    hpiComponents: null,          // Extracted HPI components from conversation

    // Timers
    silenceTimer: null,
    silenceThreshold: 18000,      // 18 seconds of silence triggers extraction
    durationTimer: null,
    totalDuration: 0,             // seconds of listening
    startTime: null,

    // Extraction state
    extractionInProgress: false,
    lastExtractionTime: null,
    lastExtractedIndex: 0,        // Index into rawChunks of last extraction
    extractionCount: 0,

    // Callbacks
    onTranscriptUpdate: null,     // UI update callback
    onExtractionComplete: null,   // Findings callback

    // Transcript accumulation
    _finalTranscript: '',
    _interimTranscript: '',
    _chunkBuffer: '',             // Accumulates text between extractions

    /**
     * Start ambient listening.
     * Stops hands-free mode if active (mutual exclusion).
     */
    startListening() {
        var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            if (typeof App !== 'undefined') App.showToast('Speech recognition not supported in this browser', 'error');
            return false;
        }

        // Mutual exclusion: stop hands-free if active
        if (typeof AICoworker !== 'undefined' && AICoworker._handsFreeActive) {
            AICoworker.stopHandsFree();
        }

        this.isListening = true;
        this.startTime = Date.now();
        this.totalDuration = 0;
        this._finalTranscript = '';
        this._interimTranscript = '';
        this._chunkBuffer = '';

        // Initialize SpeechRecognition
        this.recognition = new SpeechRecognition();
        this.recognition.continuous = true;
        this.recognition.interimResults = true;
        this.recognition.lang = 'en-US';
        this.recognition.maxAlternatives = 1;

        var self = this;

        this.recognition.onresult = function(event) {
            self._onSpeechResult(event);
        };

        this.recognition.onerror = function(event) {
            console.error('Ambient scribe recognition error:', event.error);
            if (event.error === 'not-allowed') {
                if (typeof App !== 'undefined') App.showToast('Microphone access denied', 'error');
                self.stopListening();
            } else if (event.error === 'no-speech') {
                // Browser timed out, will restart via onend
            } else if (event.error === 'aborted') {
                // Intentional stop
            } else {
                console.warn('Ambient scribe error:', event.error);
            }
        };

        this.recognition.onend = function() {
            // Auto-restart if still listening (browser may stop on its own)
            if (self.isListening) {
                try {
                    self.recognition.start();
                } catch (e) {
                    // May fail if already started
                }
            }
        };

        // Start duration timer
        this.durationTimer = setInterval(function() {
            self.totalDuration = Math.floor((Date.now() - self.startTime) / 1000);
            if (self.onTranscriptUpdate) {
                self.onTranscriptUpdate();
            }
        }, 1000);

        try {
            this.recognition.start();
            if (typeof App !== 'undefined') App.showToast('Ambient scribe started', 'success');
            return true;
        } catch (e) {
            console.error('Failed to start ambient scribe:', e);
            this.isListening = false;
            return false;
        }
    },

    /**
     * Stop ambient listening and run final extraction.
     */
    async stopListening() {
        this.isListening = false;

        // Clear timers
        if (this.silenceTimer) {
            clearTimeout(this.silenceTimer);
            this.silenceTimer = null;
        }
        if (this.durationTimer) {
            clearInterval(this.durationTimer);
            this.durationTimer = null;
        }

        // Stop recognition
        if (this.recognition) {
            try {
                this.recognition.onend = null; // Prevent auto-restart
                this.recognition.stop();
            } catch (e) { /* ignore */ }
            this.recognition = null;
        }

        // Flush any remaining buffer
        if (this._chunkBuffer.trim()) {
            this.rawChunks.push({
                text: this._chunkBuffer.trim(),
                timestamp: new Date().toISOString(),
                isFinal: true
            });
            this._chunkBuffer = '';
        }

        // Run final extraction if we have unprocessed text
        if (this.rawChunks.length > this.lastExtractedIndex) {
            await this.extractClinicalContent();
        }

        // Persist to longitudinal doc
        this._persistToLongitudinalDoc();

        if (typeof App !== 'undefined') App.showToast('Ambient scribe stopped', 'info');
    },

    /**
     * Handle speech recognition results.
     * Accumulates transcript chunks and resets the silence timer.
     */
    _onSpeechResult(event) {
        this._interimTranscript = '';

        for (var i = event.resultIndex; i < event.results.length; i++) {
            var transcript = event.results[i][0].transcript;

            if (event.results[i].isFinal) {
                this._finalTranscript += transcript;
                this._chunkBuffer += transcript;

                // Add to raw chunks
                this.rawChunks.push({
                    text: transcript.trim(),
                    timestamp: new Date().toISOString(),
                    isFinal: true
                });

                // Add to conversation log as unattributed speech
                this.conversationLog.push({
                    speaker: 'unknown',
                    text: transcript.trim(),
                    timestamp: new Date().toISOString(),
                    isFinal: true
                });
            } else {
                this._interimTranscript += transcript;
            }
        }

        // Reset silence timer
        this._resetSilenceTimer();

        // Notify UI
        if (this.onTranscriptUpdate) {
            this.onTranscriptUpdate();
        }
    },

    /**
     * Reset the silence detection timer.
     * When it fires, triggers clinical content extraction.
     */
    _resetSilenceTimer() {
        var self = this;
        if (this.silenceTimer) {
            clearTimeout(this.silenceTimer);
        }
        this.silenceTimer = setTimeout(function() {
            self._onSilenceDetected();
        }, this.silenceThreshold);
    },

    /**
     * Called when silence is detected (18s without speech).
     * Triggers extraction if enough new text since last extraction.
     */
    _onSilenceDetected() {
        var newChunks = this.rawChunks.slice(this.lastExtractedIndex);
        var newText = newChunks.map(function(c) { return c.text; }).join(' ').trim();

        // Only extract if we have meaningful new content (at least 30 chars)
        if (newText.length >= 30) {
            this.extractClinicalContent();
        }
    },

    /**
     * Send recent transcript to Claude for speaker identification and clinical extraction.
     * This is the core intelligence of the scribe.
     */
    async extractClinicalContent() {
        if (this.extractionInProgress) return;
        this.extractionInProgress = true;

        var newChunks = this.rawChunks.slice(this.lastExtractedIndex);
        var transcriptText = newChunks.map(function(c) {
            return '[' + new Date(c.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + '] ' + c.text;
        }).join('\n');

        if (!transcriptText.trim()) {
            this.extractionInProgress = false;
            return;
        }

        // Build existing conversation context for better speaker inference
        var priorContext = '';
        if (this.lastExtractedIndex > 0 && this.extractedFindings.length > 0) {
            priorContext = '\n\nPrevious conversation context (for speaker continuity):\n';
            var recentFindings = this.extractedFindings.slice(-5);
            recentFindings.forEach(function(f) {
                priorContext += '- [' + f.type.toUpperCase() + '] ' + f.text + '\n';
            });
        }

        var systemPrompt = this._buildExtractionPrompt();
        var userMessage = 'Analyze this segment of a doctor-patient conversation:\n\n' + transcriptText;
        if (priorContext) {
            userMessage += priorContext;
        }

        try {
            // Use AICoworker's API key and endpoint
            if (typeof AICoworker === 'undefined' || !AICoworker.apiKey) {
                console.warn('Ambient scribe: No API key available');
                this.extractionInProgress = false;
                return;
            }

            var response = await fetch(AICoworker.apiEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': AICoworker.apiKey,
                    'anthropic-version': '2023-06-01',
                    'anthropic-dangerous-direct-browser-access': 'true'
                },
                body: JSON.stringify({
                    model: AICoworker.analysisModel || 'claude-sonnet-4-6',
                    max_tokens: 2048,
                    system: systemPrompt,
                    messages: [{ role: 'user', content: userMessage }]
                })
            });

            var data = await response.json();
            if (data.content && data.content[0] && data.content[0].text) {
                this._parseExtractionResponse(data.content[0].text);
            }

            this.lastExtractedIndex = this.rawChunks.length;
            this.lastExtractionTime = Date.now();
            this.extractionCount++;

        } catch (e) {
            console.error('Ambient scribe extraction failed:', e);
        }

        this.extractionInProgress = false;

        // Notify UI
        if (this.onExtractionComplete) {
            this.onExtractionComplete();
        }
        if (this.onTranscriptUpdate) {
            this.onTranscriptUpdate();
        }
    },

    /**
     * Build the extraction system prompt.
     * Instructs Claude to identify speakers and extract clinical content.
     */
    _buildExtractionPrompt() {
        return `You are a clinical scribe AI. Analyze this doctor-patient conversation transcript and extract clinical content.

For each utterance, identify the likely speaker based on conversational cues:
- DOCTOR: asks clinical questions, describes exam findings, discusses plans, uses medical terminology to explain, gives instructions
- PATIENT: reports symptoms, answers questions, describes history, expresses concerns, asks about their condition
- NURSE: reports vitals, asks about orders, provides status updates, discusses medications given

Use contextual inference — the doctor asks structured questions, the patient responds with personal experiences and symptoms.

Extract and categorize all clinical content:
1. SYMPTOMS reported by patient (with severity, duration, quality if mentioned)
2. EXAM FINDINGS described by doctor
3. CLINICAL ASSESSMENTS / differential reasoning by doctor
4. PATIENT CONCERNS or questions
5. ORDERS discussed or planned
6. KEY QUOTES worth preserving for the note (patient's own words about their experience)

Respond ONLY with valid JSON (no markdown fencing):
{
    "diarizedTranscript": [{"speaker": "doctor", "text": "..."}, {"speaker": "patient", "text": "..."}],
    "symptoms": [{"text": "...", "severity": "mild|moderate|severe|unspecified", "duration": "...", "quality": "..."}],
    "examFindings": [{"text": "...", "bodySystem": "..."}],
    "assessments": [{"text": "...", "relatedProblem": "..."}],
    "patientConcerns": ["..."],
    "ordersDiscussed": ["..."],
    "keyQuotes": [{"speaker": "patient", "text": "..."}],
    "hpiComponents": {
        "chiefComplaint": "...",
        "onset": "...",
        "duration": "...",
        "severity": "...",
        "quality": "...",
        "associated": "...",
        "alleviating": "...",
        "aggravating": "...",
        "context": "..."
    }
}

If a field has no data, use an empty array [] or empty string "". Always provide the full JSON structure.`;
    },

    /**
     * Parse the extraction response from Claude.
     * Updates conversationLog with speaker labels and extractedFindings with clinical data.
     */
    _parseExtractionResponse(responseText) {
        try {
            // Try to extract JSON from the response
            var jsonMatch = responseText.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                console.warn('Ambient scribe: No JSON in extraction response');
                return;
            }

            var result = JSON.parse(jsonMatch[0]);

            // Update conversation log with diarized transcript
            if (result.diarizedTranscript && Array.isArray(result.diarizedTranscript)) {
                // Replace the last N unknown-speaker entries with diarized versions
                var unknownEntries = [];
                for (var i = this.conversationLog.length - 1; i >= 0; i--) {
                    if (this.conversationLog[i].speaker === 'unknown') {
                        unknownEntries.unshift(i);
                    } else {
                        break; // Stop at first non-unknown entry
                    }
                }

                // Replace unknown entries with diarized transcript
                // Remove the unknown entries
                var startIdx = unknownEntries.length > 0 ? unknownEntries[0] : this.conversationLog.length;
                this.conversationLog.splice(startIdx);

                // Add diarized entries
                result.diarizedTranscript.forEach(function(entry) {
                    this.conversationLog.push({
                        speaker: entry.speaker || 'unknown',
                        text: entry.text,
                        timestamp: new Date().toISOString(),
                        isFinal: true
                    });
                }.bind(this));
            }

            // Extract symptoms
            if (result.symptoms && Array.isArray(result.symptoms)) {
                result.symptoms.forEach(function(s) {
                    this.extractedFindings.push({
                        type: 'symptom',
                        text: s.text + (s.severity && s.severity !== 'unspecified' ? ' (' + s.severity + ')' : '') +
                              (s.duration ? ', ' + s.duration : ''),
                        speaker: 'patient',
                        confidence: 0.8,
                        timestamp: new Date().toISOString()
                    });
                }.bind(this));
            }

            // Extract exam findings
            if (result.examFindings && Array.isArray(result.examFindings)) {
                result.examFindings.forEach(function(f) {
                    this.extractedFindings.push({
                        type: 'finding',
                        text: f.text + (f.bodySystem ? ' [' + f.bodySystem + ']' : ''),
                        speaker: 'doctor',
                        confidence: 0.85,
                        timestamp: new Date().toISOString()
                    });
                }.bind(this));
            }

            // Extract assessments
            if (result.assessments && Array.isArray(result.assessments)) {
                result.assessments.forEach(function(a) {
                    this.extractedFindings.push({
                        type: 'assessment',
                        text: a.text + (a.relatedProblem ? ' (re: ' + a.relatedProblem + ')' : ''),
                        speaker: 'doctor',
                        confidence: 0.8,
                        timestamp: new Date().toISOString()
                    });
                }.bind(this));
            }

            // Extract patient concerns
            if (result.patientConcerns && Array.isArray(result.patientConcerns)) {
                result.patientConcerns.forEach(function(c) {
                    this.extractedFindings.push({
                        type: 'concern',
                        text: c,
                        speaker: 'patient',
                        confidence: 0.75,
                        timestamp: new Date().toISOString()
                    });
                }.bind(this));
            }

            // Extract orders discussed
            if (result.ordersDiscussed && Array.isArray(result.ordersDiscussed)) {
                result.ordersDiscussed.forEach(function(o) {
                    this.extractedFindings.push({
                        type: 'order',
                        text: o,
                        speaker: 'doctor',
                        confidence: 0.7,
                        timestamp: new Date().toISOString()
                    });
                }.bind(this));
            }

            // Store key quotes
            if (result.keyQuotes && Array.isArray(result.keyQuotes)) {
                result.keyQuotes.forEach(function(q) {
                    this.extractedFindings.push({
                        type: 'quote',
                        text: '"' + q.text + '"',
                        speaker: q.speaker || 'patient',
                        confidence: 0.9,
                        timestamp: new Date().toISOString()
                    });
                }.bind(this));
            }

            // Store HPI components (merge with existing)
            if (result.hpiComponents) {
                if (!this.hpiComponents) {
                    this.hpiComponents = {};
                }
                // Merge — only overwrite non-empty fields
                Object.keys(result.hpiComponents).forEach(function(key) {
                    if (result.hpiComponents[key] && result.hpiComponents[key].trim()) {
                        this.hpiComponents[key] = result.hpiComponents[key];
                    }
                }.bind(this));
            }

            console.log('Ambient scribe extracted: ' + this.extractedFindings.length + ' findings total');

        } catch (e) {
            console.error('Ambient scribe: Failed to parse extraction response:', e);
        }
    },

    /**
     * Get the full transcript formatted for display.
     */
    getTranscript() {
        return this.conversationLog;
    },

    /**
     * Get the live transcript text (including interim results).
     */
    getLiveText() {
        return this._finalTranscript + this._interimTranscript;
    },

    /**
     * Get extracted findings.
     */
    getExtractedFindings() {
        return this.extractedFindings;
    },

    /**
     * Get findings count by type.
     */
    getFindingsCounts() {
        var counts = { symptom: 0, finding: 0, assessment: 0, concern: 0, order: 0, quote: 0 };
        this.extractedFindings.forEach(function(f) {
            if (counts.hasOwnProperty(f.type)) {
                counts[f.type]++;
            }
        });
        return counts;
    },

    /**
     * Format the conversation and findings for note generation.
     * Returns a structured text block ready for inclusion in note prompts.
     */
    getConversationForNote() {
        if (this.conversationLog.length === 0 && this.extractedFindings.length === 0) {
            return null;
        }

        var output = '';

        // Include diarized transcript
        if (this.conversationLog.length > 0) {
            output += '### Conversation Transcript\n';
            var lastSpeaker = '';
            this.conversationLog.forEach(function(entry) {
                if (entry.speaker !== 'unknown') {
                    var speakerLabel = entry.speaker === 'doctor' ? 'Dr' :
                                      entry.speaker === 'patient' ? 'Pt' :
                                      entry.speaker === 'nurse' ? 'RN' : '??';
                    if (entry.speaker !== lastSpeaker) {
                        output += '\n' + speakerLabel + ': ';
                        lastSpeaker = entry.speaker;
                    }
                    output += entry.text + ' ';
                }
            });
            output += '\n\n';
        }

        // Include extracted findings
        if (this.extractedFindings.length > 0) {
            output += '### Extracted Clinical Findings\n';

            var byType = {};
            this.extractedFindings.forEach(function(f) {
                if (!byType[f.type]) byType[f.type] = [];
                byType[f.type].push(f);
            });

            var typeLabels = {
                symptom: 'Patient-Reported Symptoms',
                finding: 'Exam Findings',
                assessment: 'Clinical Assessments',
                concern: 'Patient Concerns',
                order: 'Orders Discussed',
                quote: 'Key Patient Quotes'
            };

            Object.keys(typeLabels).forEach(function(type) {
                if (byType[type] && byType[type].length > 0) {
                    output += '\n' + typeLabels[type] + ':\n';
                    byType[type].forEach(function(f) {
                        output += '- ' + f.text + '\n';
                    });
                }
            });
        }

        // Include HPI components if available
        if (this.hpiComponents) {
            output += '\n### HPI Components (from conversation)\n';
            var hpi = this.hpiComponents;
            if (hpi.chiefComplaint) output += '- Chief Complaint: ' + hpi.chiefComplaint + '\n';
            if (hpi.onset) output += '- Onset: ' + hpi.onset + '\n';
            if (hpi.duration) output += '- Duration: ' + hpi.duration + '\n';
            if (hpi.severity) output += '- Severity: ' + hpi.severity + '\n';
            if (hpi.quality) output += '- Quality: ' + hpi.quality + '\n';
            if (hpi.associated) output += '- Associated: ' + hpi.associated + '\n';
            if (hpi.alleviating) output += '- Alleviating: ' + hpi.alleviating + '\n';
            if (hpi.aggravating) output += '- Aggravating: ' + hpi.aggravating + '\n';
            if (hpi.context) output += '- Context: ' + hpi.context + '\n';
        }

        return output;
    },

    /**
     * Get a compact summary of ambient findings for AI panel context.
     * Used by ContextAssembler to inject into LLM prompts.
     */
    getAmbientContextBlock() {
        if (this.extractedFindings.length === 0) return '';

        var lines = [];
        var symptoms = this.extractedFindings.filter(function(f) { return f.type === 'symptom'; });
        var findings = this.extractedFindings.filter(function(f) { return f.type === 'finding'; });
        var assessments = this.extractedFindings.filter(function(f) { return f.type === 'assessment'; });
        var concerns = this.extractedFindings.filter(function(f) { return f.type === 'concern'; });

        if (symptoms.length > 0) {
            lines.push('Patient reports: ' + symptoms.map(function(s) { return s.text; }).join('; '));
        }
        if (findings.length > 0) {
            lines.push('Exam: ' + findings.map(function(f) { return f.text; }).join('; '));
        }
        if (assessments.length > 0) {
            lines.push('Assessment: ' + assessments.map(function(a) { return a.text; }).join('; '));
        }
        if (concerns.length > 0) {
            lines.push('Patient concerns: ' + concerns.map(function(c) { return c.text; }).join('; '));
        }

        return lines.join('\n');
    },

    /**
     * Format elapsed time as M:SS.
     */
    getFormattedDuration() {
        var mins = Math.floor(this.totalDuration / 60);
        var secs = this.totalDuration % 60;
        return mins + ':' + (secs < 10 ? '0' : '') + secs;
    },

    /**
     * Persist ambient transcript and findings to the longitudinal doc.
     */
    _persistToLongitudinalDoc() {
        if (typeof AICoworker === 'undefined' || !AICoworker.longitudinalDoc) return;

        var doc = AICoworker.longitudinalDoc;

        // Store in sessionContext
        doc.sessionContext.ambientTranscript = this.conversationLog.map(function(entry) {
            return {
                speaker: entry.speaker,
                text: entry.text,
                timestamp: entry.timestamp
            };
        });

        doc.sessionContext.ambientFindings = this.extractedFindings.map(function(f) {
            return {
                type: f.type,
                text: f.text,
                speaker: f.speaker,
                confidence: f.confidence,
                timestamp: f.timestamp
            };
        });

        if (this.hpiComponents) {
            doc.sessionContext.ambientHpiComponents = this.hpiComponents;
        }

        doc.sessionContext.ambientEncounterSummary = this.encounterSummary || '';

        AICoworker.saveLongitudinalDoc();
    },

    /**
     * Clear all scribe session data.
     */
    clearSession() {
        this.conversationLog = [];
        this.rawChunks = [];
        this.extractedFindings = [];
        this.encounterSummary = null;
        this.hpiComponents = null;
        this._finalTranscript = '';
        this._interimTranscript = '';
        this._chunkBuffer = '';
        this.lastExtractedIndex = 0;
        this.extractionCount = 0;
        this.totalDuration = 0;
        this.startTime = null;
    },

    /**
     * Check if ambient scribe has any data worth including.
     */
    hasData() {
        return this.conversationLog.length > 0 || this.extractedFindings.length > 0;
    }
};

window.AmbientScribe = AmbientScribe;
console.log('Ambient Scribe service loaded');
