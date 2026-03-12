/**
 * Deepgram Client
 * Captures mic audio and streams to server WebSocket relay for
 * real-time transcription with speaker diarization.
 *
 * Audio pipeline: getUserMedia → AudioContext → ScriptProcessor → PCM Int16 → WebSocket
 * Receives: JSON transcript events with speaker IDs from Deepgram via server relay
 */

const DeepgramClient = {
    // State
    _ws: null,
    _audioContext: null,
    _mediaStream: null,
    _processor: null,
    _active: false,

    // Speaker mapping: Deepgram speaker IDs (0, 1, ...) → roles
    // First speaker detected = "doctor", second = "patient"
    speakerMap: {},
    _nextRole: 'doctor', // next unassigned speaker gets this role

    // Callbacks (set by DictationWidget)
    onTranscript: null,    // ({transcript, speaker, speakerRole, words, isFinal, speechFinal}) => {}
    onStateChange: null,   // (state: 'connecting'|'connected'|'disconnected') => {}

    /**
     * Start audio capture and WebSocket connection
     */
    async start() {
        if (this._active) return;

        this.speakerMap = {};
        this._nextRole = 'doctor';

        if (this.onStateChange) this.onStateChange('connecting');

        try {
            // Get mic access
            this._mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    channelCount: 1,
                    sampleRate: 16000,
                    echoCancellation: true,
                    noiseSuppression: true
                }
            });

            // Set up audio processing pipeline
            this._audioContext = new (window.AudioContext || window.webkitAudioContext)({
                sampleRate: 16000
            });

            const source = this._audioContext.createMediaStreamSource(this._mediaStream);

            // ScriptProcessor to get raw PCM samples
            // 4096 frames = ~256ms at 16kHz — good balance of latency vs overhead
            this._processor = this._audioContext.createScriptProcessor(4096, 1, 1);

            this._processor.onaudioprocess = (event) => {
                if (!this._active || !this._ws || this._ws.readyState !== WebSocket.OPEN) return;

                const float32 = event.inputBuffer.getChannelData(0);
                const int16 = this._float32ToInt16(float32);
                this._ws.send(int16.buffer);
            };

            source.connect(this._processor);
            this._processor.connect(this._audioContext.destination);

            // Open WebSocket to server relay
            const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = `${wsProtocol}//${window.location.host}/ws/transcribe`;

            this._ws = new WebSocket(wsUrl);

            this._ws.onopen = () => {
                this._active = true;
                console.log('🎙️ DeepgramClient: connected');
                if (this.onStateChange) this.onStateChange('connected');
            };

            this._ws.onmessage = (event) => {
                this._handleTranscript(event.data);
            };

            this._ws.onclose = (event) => {
                console.log(`🎙️ DeepgramClient: disconnected (${event.code})`);
                this._cleanup();
                if (this.onStateChange) this.onStateChange('disconnected');
            };

            this._ws.onerror = (err) => {
                console.error('🎙️ DeepgramClient: WebSocket error', err);
                this._cleanup();
                if (this.onStateChange) this.onStateChange('disconnected');
            };

        } catch (err) {
            console.error('🎙️ DeepgramClient: start failed', err);
            this._cleanup();
            if (this.onStateChange) this.onStateChange('disconnected');
            throw err;
        }
    },

    /**
     * Stop audio capture and close connection
     */
    stop() {
        if (this._ws && this._ws.readyState === WebSocket.OPEN) {
            this._ws.close();
        }
        this._cleanup();
    },

    /**
     * Check if actively streaming
     */
    isActive() {
        return this._active;
    },

    /**
     * Swap doctor/patient speaker mapping
     */
    swapSpeakers() {
        const entries = Object.entries(this.speakerMap);
        for (const [id, role] of entries) {
            this.speakerMap[id] = role === 'doctor' ? 'patient' : 'doctor';
        }
        console.log('🎙️ DeepgramClient: speakers swapped', this.speakerMap);
    },

    /**
     * Parse Deepgram transcript message and emit event
     */
    _handleTranscript(rawData) {
        try {
            const data = JSON.parse(rawData);

            // Only process transcript results
            if (data.type !== 'Results') return;

            const alt = data.channel?.alternatives?.[0];
            if (!alt) return;

            const transcript = alt.transcript || '';
            if (!transcript.trim()) return;

            const words = alt.words || [];
            const isFinal = !!data.is_final;
            const speechFinal = !!data.speech_final;

            // Determine dominant speaker for this utterance
            const speaker = this._getDominantSpeaker(words);
            const speakerRole = this._mapSpeaker(speaker);

            if (this.onTranscript) {
                this.onTranscript({
                    transcript,
                    speaker,        // raw Deepgram ID (0, 1, ...)
                    speakerRole,    // "doctor" or "patient"
                    words,
                    isFinal,
                    speechFinal
                });
            }
        } catch (e) {
            // Non-JSON or malformed — ignore
        }
    },

    /**
     * Find the most common speaker ID in a words array
     */
    _getDominantSpeaker(words) {
        if (!words.length) return 0;
        const counts = {};
        for (const w of words) {
            const s = w.speaker ?? 0;
            counts[s] = (counts[s] || 0) + 1;
        }
        let maxCount = 0, dominant = 0;
        for (const [id, count] of Object.entries(counts)) {
            if (count > maxCount) {
                maxCount = count;
                dominant = parseInt(id);
            }
        }
        return dominant;
    },

    /**
     * Map a Deepgram speaker ID to a role (doctor/patient)
     * First unique speaker = doctor, second = patient
     */
    _mapSpeaker(speakerId) {
        if (this.speakerMap[speakerId] !== undefined) {
            return this.speakerMap[speakerId];
        }
        // Assign next role
        const role = this._nextRole;
        this.speakerMap[speakerId] = role;
        this._nextRole = (role === 'doctor') ? 'patient' : 'unknown';
        console.log(`🎙️ DeepgramClient: speaker ${speakerId} → ${role}`);
        return role;
    },

    /**
     * Convert Float32 PCM samples to Int16 for Deepgram
     */
    _float32ToInt16(float32Array) {
        const int16 = new Int16Array(float32Array.length);
        for (let i = 0; i < float32Array.length; i++) {
            const s = Math.max(-1, Math.min(1, float32Array[i]));
            int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        return int16;
    },

    /**
     * Clean up audio resources
     */
    _cleanup() {
        this._active = false;
        if (this._processor) {
            this._processor.disconnect();
            this._processor = null;
        }
        if (this._audioContext && this._audioContext.state !== 'closed') {
            this._audioContext.close().catch(() => {});
            this._audioContext = null;
        }
        if (this._mediaStream) {
            this._mediaStream.getTracks().forEach(t => t.stop());
            this._mediaStream = null;
        }
        this._ws = null;
    }
};

window.DeepgramClient = DeepgramClient;
