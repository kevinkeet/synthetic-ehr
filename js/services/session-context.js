/**
 * Session Context
 *
 * Ephemeral tracking of the current user session — navigation trail, dwell times,
 * questions asked, orders placed. Resets on page reload.
 *
 * Feeds into Working Memory to give the AI awareness of what the doctor
 * has done this session without persisting to localStorage.
 */

class SessionContext {
    constructor() {
        this.sessionId = Date.now().toString(36);
        this.startedAt = new Date().toISOString();

        // Navigation trail — what sections doctor has visited, in order
        this.navigationHistory = []; // { timestamp, route, sectionName, dwellTime }

        // Current focus — what the doctor is looking at right now
        this.currentFocus = {
            route: null,
            sectionName: null,
            focusedNote: null,    // If reading a specific note
            focusedLab: null,     // If viewing a specific lab panel
            enteredAt: null       // When they navigated here
        };

        // Questions asked this session
        this.questionsAsked = []; // { timestamp, question, abbreviatedAnswer }

        // Dictations this session
        this.dictations = []; // { timestamp, text }

        // Orders placed this session
        this.ordersPlaced = []; // { timestamp, orderName, type }

        // Notes written this session
        this.notesWritten = []; // { timestamp, noteType }

        // What has changed since the doctor last interacted with the AI
        this.changesSinceLastAI = {
            newVitals: false,
            newLabs: false,
            newOrders: false,
            newNotes: false,
            navigationChanges: 0,
            lastAIInteraction: null
        };
    }

    /**
     * Record navigation to a new section
     */
    trackNavigation(route, sectionName) {
        const now = new Date().toISOString();

        // Calculate dwell time for previous section
        if (this.currentFocus.route && this.currentFocus.enteredAt) {
            const dwellMs = Date.now() - new Date(this.currentFocus.enteredAt).getTime();
            const lastNav = this.navigationHistory[this.navigationHistory.length - 1];
            if (lastNav) {
                lastNav.dwellTime = Math.round(dwellMs / 1000);
            }
        }

        this.navigationHistory.push({
            timestamp: now,
            route: route,
            sectionName: sectionName,
            dwellTime: null // Set when they leave
        });

        this.currentFocus = {
            route,
            sectionName,
            focusedNote: null,
            focusedLab: null,
            enteredAt: now
        };

        this.changesSinceLastAI.navigationChanges++;
    }

    /**
     * Record that a specific note was opened/read
     */
    trackNoteViewed(noteId, noteTitle) {
        this.currentFocus.focusedNote = { id: noteId, title: noteTitle };
    }

    /**
     * Record that a specific lab was viewed
     */
    trackLabViewed(labName) {
        this.currentFocus.focusedLab = labName;
    }

    /**
     * Record a question asked to the AI
     */
    trackQuestion(question, abbreviatedAnswer) {
        this.questionsAsked.push({
            timestamp: new Date().toISOString(),
            question: question.substring(0, 200),
            abbreviatedAnswer: (abbreviatedAnswer || '').substring(0, 200)
        });
    }

    /**
     * Record a dictation
     */
    trackDictation(text) {
        this.dictations.push({
            timestamp: new Date().toISOString(),
            text: text.substring(0, 500)
        });
    }

    /**
     * Record an order placed
     */
    trackOrder(orderName, type) {
        this.ordersPlaced.push({
            timestamp: new Date().toISOString(),
            orderName,
            type
        });
        this.changesSinceLastAI.newOrders = true;
    }

    /**
     * Record a note written
     */
    trackNoteWritten(noteType) {
        this.notesWritten.push({
            timestamp: new Date().toISOString(),
            noteType
        });
        this.changesSinceLastAI.newNotes = true;
    }

    /**
     * Mark that the AI was just interacted with (resets change tracking)
     */
    markAIInteraction(type) {
        this.changesSinceLastAI = {
            newVitals: false,
            newLabs: false,
            newOrders: false,
            newNotes: false,
            navigationChanges: 0,
            lastAIInteraction: new Date().toISOString()
        };
    }

    /**
     * Alias for trackNoteWritten for convenience
     */
    trackNote(noteType) {
        this.trackNoteWritten(noteType);
    }

    /**
     * Get session duration in minutes
     */
    getSessionDuration() {
        const startMs = new Date(this.startedAt).getTime();
        return Math.round((Date.now() - startMs) / 60000);
    }

    /**
     * Get unique section names that have been visited
     */
    getViewedSections() {
        return [...new Set(this.navigationHistory.map(n => n.sectionName).filter(Boolean))];
    }

    /**
     * Get a checklist of standard chart sections with visited status.
     * Used by the progress tracker when no simulation is running.
     */
    getChartReviewChecklist() {
        const standardSections = [
            { name: 'Chart Review', route: '#/chart-review' },
            { name: 'Notes', route: '#/notes' },
            { name: 'Problem List', route: '#/problems' },
            { name: 'Medications', route: '#/medications' },
            { name: 'Allergies', route: '#/allergies' },
            { name: 'Labs', route: '#/labs' },
            { name: 'Imaging', route: '#/imaging' },
            { name: 'Vitals', route: '#/vitals' },
            { name: 'Social History', route: '#/social-history' },
            { name: 'Orders', route: '#/orders' }
        ];

        const visited = this.getViewedSections();
        return standardSections.map(s => ({
            ...s,
            visited: visited.includes(s.name)
        }));
    }

    /**
     * Get a summary of what the doctor has done this session
     */
    getSessionSummary() {
        const sections = this.getViewedSections();
        const totalTime = this.navigationHistory.reduce((sum, n) => sum + (n.dwellTime || 0), 0);

        return {
            sectionsViewed: sections,
            questionsAsked: this.questionsAsked.length,
            dictationsGiven: this.dictations.length,
            ordersPlaced: this.ordersPlaced.length,
            notesWritten: this.notesWritten.length,
            sessionDurationSeconds: totalTime,
            currentSection: this.currentFocus.sectionName,
            hasChanges: this.changesSinceLastAI.newVitals ||
                this.changesSinceLastAI.newLabs ||
                this.changesSinceLastAI.newOrders ||
                this.changesSinceLastAI.navigationChanges > 0
        };
    }

    /**
     * Render a compact text summary for LLM context
     */
    toContextString() {
        let text = '## SESSION ACTIVITY\n';
        text += `Current view: ${this.currentFocus.sectionName || 'Chart Review'}\n`;

        const sections = this.getViewedSections();
        if (sections.length > 0) {
            text += `Sections reviewed this session: ${sections.join(', ')}\n`;
        }

        if (this.questionsAsked.length > 0) {
            text += `Questions asked this session: ${this.questionsAsked.length}\n`;
            // Include the last question for conversational continuity
            const last = this.questionsAsked[this.questionsAsked.length - 1];
            text += `Last question: "${last.question}"\n`;
            if (last.abbreviatedAnswer) {
                text += `Last answer summary: "${last.abbreviatedAnswer}"\n`;
            }
        }

        if (this.dictations.length > 0) {
            text += `Dictations this session: ${this.dictations.length}\n`;
        }

        if (this.ordersPlaced.length > 0) {
            text += `Orders placed: ${this.ordersPlaced.map(o => o.orderName).join(', ')}\n`;
        }

        if (this.currentFocus.focusedNote) {
            text += `Currently reading: ${this.currentFocus.focusedNote.title}\n`;
        }

        if (this.currentFocus.focusedLab) {
            text += `Currently viewing lab: ${this.currentFocus.focusedLab}\n`;
        }

        return text;
    }
}

window.SessionContext = SessionContext;
