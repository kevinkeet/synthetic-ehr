/**
 * Feedback Widget
 *
 * A floating "Feedback" button that opens a modal for users to type or dictate
 * long-form feedback while using the site. Feedback is stored in localStorage
 * and can be exported/downloaded as a text file.
 *
 * Dictation uses the Web Speech API — same approach as the think-out-loud feature.
 */

const FeedbackWidget = {
    isOpen: false,
    isRecording: false,
    recognition: null,
    feedbackEntries: [],

    /**
     * Initialize the feedback widget
     */
    init() {
        this.loadEntries();
        this.createUI();
        console.log('Feedback Widget initialized');
    },

    /**
     * Load saved feedback entries from localStorage
     */
    loadEntries() {
        try {
            const saved = localStorage.getItem('feedback-entries');
            if (saved) {
                this.feedbackEntries = JSON.parse(saved);
            }
        } catch (e) {
            console.error('Error loading feedback:', e);
            this.feedbackEntries = [];
        }
    },

    /**
     * Save feedback entries to localStorage
     */
    saveEntries() {
        try {
            localStorage.setItem('feedback-entries', JSON.stringify(this.feedbackEntries));
        } catch (e) {
            console.error('Error saving feedback:', e);
        }
    },

    /**
     * Create the floating button and modal
     */
    createUI() {
        // Insert trigger button into header-right, between sim controls and ABOUT link
        let btn = document.getElementById('feedback-trigger-btn');
        if (!btn) {
            btn = document.createElement('button');
            btn.id = 'feedback-trigger-btn';
            btn.className = 'feedback-trigger-btn';
            btn.onclick = () => this.toggle();
            btn.title = 'Leave feedback';
            btn.innerHTML = '<span class="feedback-trigger-icon">&#128172;</span><span class="feedback-trigger-label">Feedback</span>';

            const headerRight = document.querySelector('.header-right');
            const aboutLink = headerRight ? headerRight.querySelector('.header-about-link') : null;
            if (aboutLink) {
                headerRight.insertBefore(btn, aboutLink);
            } else if (headerRight) {
                headerRight.appendChild(btn);
            } else {
                document.body.appendChild(btn);
            }
        }

        // Modal
        let modal = document.getElementById('feedback-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'feedback-modal';
            modal.className = 'feedback-modal';
            modal.innerHTML = this._getModalHTML();
            document.body.appendChild(modal);
        }
    },

    /**
     * Get the modal HTML
     */
    _getModalHTML() {
        return `
            <div class="feedback-modal-backdrop" onclick="FeedbackWidget.close()"></div>
            <div class="feedback-modal-content">
                <div class="feedback-modal-header">
                    <div class="feedback-modal-header-left">
                        <span class="feedback-modal-icon">&#128172;</span>
                        <span class="feedback-modal-title">Share Feedback</span>
                    </div>
                    <button class="feedback-modal-close" onclick="FeedbackWidget.close()">&times;</button>
                </div>
                <div class="feedback-modal-body">
                    <p class="feedback-prompt">What's on your mind? Share thoughts, bugs, ideas, or reactions as you use the site. You can type or dictate.</p>
                    <div class="feedback-input-area">
                        <textarea
                            id="feedback-textarea"
                            class="feedback-textarea"
                            placeholder="Start typing or press the mic button to dictate..."
                            rows="5"
                        ></textarea>
                        <div class="feedback-input-actions">
                            <button id="feedback-mic-btn" class="feedback-mic-btn" onclick="FeedbackWidget.toggleDictation()" title="Dictate feedback">
                                <span>&#127908;</span>
                            </button>
                            <div class="feedback-input-actions-right">
                                <span id="feedback-count" class="feedback-count"></span>
                                <button class="feedback-submit-btn" onclick="FeedbackWidget.submit()">Save Feedback</button>
                            </div>
                        </div>
                    </div>
                    <div id="feedback-recording-indicator" class="feedback-recording-indicator" style="display:none;">
                        <span class="recording-dot"></span>
                        <span>Listening... speak your feedback</span>
                    </div>
                    <div id="feedback-history" class="feedback-history">
                        ${this._renderHistory()}
                    </div>
                </div>
                <div class="feedback-modal-footer">
                    <button class="feedback-export-btn" onclick="FeedbackWidget.exportFeedback()" title="Download all feedback as a text file">
                        <span>&#128229;</span> Export All
                    </button>
                    <span class="feedback-entry-count" id="feedback-entry-count">${this.feedbackEntries.length} entries</span>
                </div>
            </div>
        `;
    },

    /**
     * Render the feedback history list
     */
    _renderHistory() {
        if (this.feedbackEntries.length === 0) {
            return '<div class="feedback-empty">No feedback yet. Be the first to share your thoughts!</div>';
        }

        // Show most recent first, limit to last 10
        const recent = this.feedbackEntries.slice(-10).reverse();
        let html = '<div class="feedback-history-title">Recent feedback</div>';
        recent.forEach((entry, i) => {
            const date = new Date(entry.timestamp);
            const timeStr = date.toLocaleString('en-US', {
                month: 'short', day: 'numeric',
                hour: 'numeric', minute: '2-digit', hour12: true
            });
            const page = entry.page || '';
            const method = entry.method === 'voice' ? '&#127908;' : '&#9998;';
            // Truncate long text for display
            const displayText = entry.text.length > 200
                ? entry.text.substring(0, 200) + '...'
                : entry.text;
            html += `
                <div class="feedback-entry">
                    <div class="feedback-entry-meta">
                        <span class="feedback-entry-method">${method}</span>
                        <span class="feedback-entry-time">${timeStr}</span>
                        ${page ? `<span class="feedback-entry-page">${page}</span>` : ''}
                    </div>
                    <div class="feedback-entry-text">${this._escapeHtml(displayText)}</div>
                </div>
            `;
        });
        return html;
    },

    /**
     * Toggle the feedback modal open/closed
     */
    toggle() {
        if (this.isOpen) {
            this.close();
        } else {
            this.open();
        }
    },

    /**
     * Open the feedback modal
     */
    open() {
        this.isOpen = true;
        const modal = document.getElementById('feedback-modal');
        if (modal) {
            modal.classList.add('visible');
        }
        const btn = document.getElementById('feedback-trigger-btn');
        if (btn) btn.classList.add('active');

        // Focus the textarea
        setTimeout(() => {
            const textarea = document.getElementById('feedback-textarea');
            if (textarea) textarea.focus();
        }, 200);
    },

    /**
     * Close the feedback modal
     */
    close() {
        this.isOpen = false;
        const modal = document.getElementById('feedback-modal');
        if (modal) {
            modal.classList.remove('visible');
        }
        const btn = document.getElementById('feedback-trigger-btn');
        if (btn) btn.classList.remove('active');

        // Stop dictation if active
        if (this.isRecording) {
            this.stopDictation();
        }
    },

    /**
     * Submit the current feedback text
     */
    submit() {
        const textarea = document.getElementById('feedback-textarea');
        if (!textarea) return;

        const text = textarea.value.trim();
        if (!text) {
            App.showToast('Please enter some feedback first', 'info');
            return;
        }

        // Build entry
        const entry = {
            text: text,
            timestamp: new Date().toISOString(),
            page: window.location.hash || '#/chart-review',
            method: this._lastMethod || 'typed',
            userAgent: navigator.userAgent
        };

        this.feedbackEntries.push(entry);
        this.saveEntries();

        // Clear the textarea
        textarea.value = '';
        this._lastMethod = null;

        // Refresh history
        this._refreshUI();

        App.showToast('Feedback saved! Thank you.', 'success');
    },

    /**
     * Toggle voice dictation
     */
    toggleDictation() {
        if (this.isRecording) {
            this.stopDictation();
        } else {
            this.startDictation();
        }
    },

    /**
     * Start voice dictation
     */
    startDictation() {
        // Check browser support
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            App.showToast('Voice dictation not supported in this browser', 'error');
            return;
        }

        this.recognition = new SpeechRecognition();
        this.recognition.continuous = true;
        this.recognition.interimResults = true;
        this.recognition.lang = 'en-US';

        const textarea = document.getElementById('feedback-textarea');
        const existingText = textarea ? textarea.value : '';
        let finalTranscript = existingText;

        this.recognition.onresult = (event) => {
            let interim = '';
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const transcript = event.results[i][0].transcript;
                if (event.results[i].isFinal) {
                    finalTranscript += (finalTranscript ? ' ' : '') + transcript;
                } else {
                    interim = transcript;
                }
            }
            if (textarea) {
                textarea.value = finalTranscript + (interim ? ' ' + interim : '');
                // Auto-scroll to bottom
                textarea.scrollTop = textarea.scrollHeight;
            }
        };

        this.recognition.onerror = (event) => {
            console.error('Speech recognition error:', event.error);
            this.stopDictation();
            if (event.error !== 'aborted') {
                App.showToast('Voice input error: ' + event.error, 'error');
            }
        };

        this.recognition.onend = () => {
            // If still recording flag is set, the user didn't manually stop — restart
            if (this.isRecording) {
                try {
                    this.recognition.start();
                } catch (e) {
                    this.stopDictation();
                }
            }
        };

        try {
            this.recognition.start();
            this.isRecording = true;
            this._lastMethod = 'voice';

            // Update UI
            const micBtn = document.getElementById('feedback-mic-btn');
            if (micBtn) micBtn.classList.add('recording');
            const indicator = document.getElementById('feedback-recording-indicator');
            if (indicator) indicator.style.display = '';
        } catch (e) {
            console.error('Failed to start speech recognition:', e);
            App.showToast('Failed to start voice input', 'error');
        }
    },

    /**
     * Stop voice dictation
     */
    stopDictation() {
        this.isRecording = false;
        if (this.recognition) {
            try {
                this.recognition.stop();
            } catch (e) { /* ignore */ }
            this.recognition = null;
        }

        // Update UI
        const micBtn = document.getElementById('feedback-mic-btn');
        if (micBtn) micBtn.classList.remove('recording');
        const indicator = document.getElementById('feedback-recording-indicator');
        if (indicator) indicator.style.display = 'none';
    },

    /**
     * Export all feedback as a downloadable text file
     */
    exportFeedback() {
        if (this.feedbackEntries.length === 0) {
            App.showToast('No feedback to export', 'info');
            return;
        }

        let content = '=== Acting Intern — User Feedback Export ===\n';
        content += `Exported: ${new Date().toLocaleString()}\n`;
        content += `Total entries: ${this.feedbackEntries.length}\n`;
        content += '='.repeat(50) + '\n\n';

        this.feedbackEntries.forEach((entry, i) => {
            const date = new Date(entry.timestamp);
            content += `--- Entry ${i + 1} ---\n`;
            content += `Date: ${date.toLocaleString()}\n`;
            content += `Page: ${entry.page || 'unknown'}\n`;
            content += `Method: ${entry.method || 'typed'}\n`;
            content += `\n${entry.text}\n\n`;
        });

        // Create and trigger download
        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `acting-intern-feedback-${new Date().toISOString().split('T')[0]}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        App.showToast('Feedback exported!', 'success');
    },

    /**
     * Refresh the modal UI after changes
     */
    _refreshUI() {
        const history = document.getElementById('feedback-history');
        if (history) {
            history.innerHTML = this._renderHistory();
        }
        const count = document.getElementById('feedback-entry-count');
        if (count) {
            count.textContent = `${this.feedbackEntries.length} entries`;
        }
        const countBadge = document.getElementById('feedback-count');
        if (countBadge) {
            countBadge.textContent = '';
        }
    },

    /**
     * Escape HTML
     */
    _escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
};

window.FeedbackWidget = FeedbackWidget;
