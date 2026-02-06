/**
 * Speech Service
 * Web Speech API wrapper for voice input and output
 */

const SpeechService = {
    recognition: null,
    synthesis: window.speechSynthesis,
    selectedVoice: null,
    isSpeaking: false,
    isListening: false,

    /**
     * Check if speech recognition is supported
     */
    isSupported() {
        return 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
    },

    /**
     * Check if speech synthesis is supported
     */
    isSynthesisSupported() {
        return 'speechSynthesis' in window;
    },

    /**
     * Initialize speech recognition
     */
    initRecognition() {
        if (!this.isSupported()) {
            console.warn('Speech recognition not supported');
            return null;
        }

        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        this.recognition = new SpeechRecognition();

        // Configuration
        this.recognition.continuous = false;
        this.recognition.interimResults = true;
        this.recognition.lang = 'en-US';
        this.recognition.maxAlternatives = 1;

        return this.recognition;
    },

    /**
     * Start listening for voice input
     * @param {Function} onResult - Callback with (transcript, isFinal)
     * @param {Function} onError - Callback with error
     * @param {Function} onEnd - Callback when listening ends
     */
    startListening(onResult, onError, onEnd) {
        if (!this.recognition) {
            this.initRecognition();
        }

        if (!this.recognition) {
            if (onError) onError(new Error('Speech recognition not supported'));
            return;
        }

        // Stop any current speech output while listening
        this.stop();

        this.recognition.onresult = (event) => {
            const result = event.results[event.results.length - 1];
            const transcript = result[0].transcript;
            const isFinal = result.isFinal;

            if (onResult) {
                onResult(transcript, isFinal);
            }
        };

        this.recognition.onerror = (event) => {
            console.error('Speech recognition error:', event.error);
            this.isListening = false;

            if (event.error === 'no-speech') {
                // Not a critical error, just no speech detected
                if (onEnd) onEnd();
                return;
            }

            if (onError) {
                onError(new Error(event.error));
            }
        };

        this.recognition.onend = () => {
            this.isListening = false;
            if (onEnd) onEnd();
        };

        try {
            this.recognition.start();
            this.isListening = true;
        } catch (error) {
            console.error('Failed to start recognition:', error);
            if (onError) onError(error);
        }
    },

    /**
     * Stop listening
     */
    stopListening() {
        if (this.recognition && this.isListening) {
            try {
                this.recognition.stop();
            } catch (error) {
                console.warn('Error stopping recognition:', error);
            }
            this.isListening = false;
        }
    },

    /**
     * Set the voice for speech synthesis
     * @param {string} voiceName - The name of the voice to use
     */
    setVoice(voiceName) {
        if (!this.isSynthesisSupported()) return;

        const voices = this.synthesis.getVoices();
        this.selectedVoice = voices.find(v => v.name === voiceName) || null;
    },

    /**
     * Get available voices
     */
    getVoices() {
        if (!this.isSynthesisSupported()) return [];
        return this.synthesis.getVoices();
    },

    /**
     * Speak text using speech synthesis
     * @param {string} text - The text to speak
     * @param {Object} options - Optional settings (rate, pitch, volume)
     * @returns {Promise} - Resolves when speech is complete
     */
    speak(text, options = {}) {
        return new Promise((resolve, reject) => {
            if (!this.isSynthesisSupported()) {
                reject(new Error('Speech synthesis not supported'));
                return;
            }

            // Stop any current speech
            this.stop();

            const utterance = new SpeechSynthesisUtterance(text);

            // Set voice
            if (this.selectedVoice) {
                utterance.voice = this.selectedVoice;
            } else {
                // Try to find a good default English voice
                const voices = this.synthesis.getVoices();
                const englishVoices = voices.filter(v => v.lang.startsWith('en'));
                const preferredVoice = englishVoices.find(v =>
                    v.name.includes('Daniel') ||
                    v.name.includes('Alex') ||
                    v.name.includes('Samantha') ||
                    v.localService
                );
                if (preferredVoice) {
                    utterance.voice = preferredVoice;
                }
            }

            // Apply options
            utterance.rate = options.rate || 1.0;
            utterance.pitch = options.pitch || 1.0;
            utterance.volume = options.volume || 1.0;

            utterance.onstart = () => {
                this.isSpeaking = true;
            };

            utterance.onend = () => {
                this.isSpeaking = false;
                resolve();
            };

            utterance.onerror = (event) => {
                this.isSpeaking = false;
                // 'interrupted' is not a real error, just means we stopped it
                if (event.error === 'interrupted') {
                    resolve();
                } else {
                    reject(new Error(event.error));
                }
            };

            this.synthesis.speak(utterance);
        });
    },

    /**
     * Stop current speech
     */
    stop() {
        if (this.isSynthesisSupported() && this.isSpeaking) {
            this.synthesis.cancel();
            this.isSpeaking = false;
        }
    },

    /**
     * Pause speech
     */
    pause() {
        if (this.isSynthesisSupported()) {
            this.synthesis.pause();
        }
    },

    /**
     * Resume speech
     */
    resume() {
        if (this.isSynthesisSupported()) {
            this.synthesis.resume();
        }
    },

    /**
     * Check if currently speaking
     */
    getSpeakingState() {
        return this.isSpeaking;
    },

    /**
     * Check if currently listening
     */
    getListeningState() {
        return this.isListening;
    }
};

// Initialize voices when available
if (typeof speechSynthesis !== 'undefined' && speechSynthesis.onvoiceschanged !== undefined) {
    speechSynthesis.onvoiceschanged = () => {
        // Load saved voice preference
        const savedVoice = localStorage.getItem('patient-voice-id');
        if (savedVoice) {
            SpeechService.setVoice(savedVoice);
        }
    };
}

window.SpeechService = SpeechService;
