/**
 * Google Doc Context Service
 * Fetches context from published Google Docs
 */

const GoogleDocContext = {
    cache: new Map(),
    cacheTimeout: 5 * 60 * 1000, // 5 minutes

    /**
     * Fetch context from a published Google Doc URL
     * @param {string} url - The published Google Doc URL
     * @returns {Promise<string>} - The extracted text content
     */
    async fetchContext(url) {
        if (!url) {
            return null;
        }

        // Check cache
        const cached = this.cache.get(url);
        if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
            return cached.content;
        }

        try {
            // Ensure we're using the published URL format
            const publishedUrl = this.normalizeUrl(url);

            const response = await fetch(publishedUrl, {
                mode: 'cors',
                headers: {
                    'Accept': 'text/html'
                }
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch document: ${response.status}`);
            }

            const html = await response.text();
            const content = this.extractText(html);

            // Cache the result
            this.cache.set(url, {
                content,
                timestamp: Date.now()
            });

            return content;
        } catch (error) {
            console.error('Google Doc fetch error:', error);

            // If CORS fails, try providing instructions to the user
            if (error.message.includes('CORS') || error.name === 'TypeError') {
                throw new Error(
                    'Unable to fetch Google Doc. Please ensure the document is published to the web ' +
                    '(File > Share > Publish to web) and the URL ends with /pub'
                );
            }

            throw error;
        }
    },

    /**
     * Normalize a Google Doc URL to the published format
     * @param {string} url - The input URL
     * @returns {string} - The normalized published URL
     */
    normalizeUrl(url) {
        // If already in published format, return as-is
        if (url.includes('/pub')) {
            return url;
        }

        // Try to extract document ID and construct published URL
        // Patterns:
        // https://docs.google.com/document/d/DOCUMENT_ID/edit
        // https://docs.google.com/document/d/DOCUMENT_ID/view
        // https://docs.google.com/document/d/e/PUBLISHED_ID/pub

        const docIdMatch = url.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
        if (docIdMatch) {
            const docId = docIdMatch[1];
            // Note: This won't work directly - user needs to publish the doc
            // Return the URL as-is and let the fetch fail with a helpful message
            console.warn('Document may not be published. Use File > Share > Publish to web');
        }

        return url;
    },

    /**
     * Extract text content from HTML
     * @param {string} html - The HTML content
     * @returns {string} - The extracted text
     */
    extractText(html) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        // Remove script and style elements
        const scripts = doc.querySelectorAll('script, style');
        scripts.forEach(el => el.remove());

        // Try to find the main content area
        // Google Docs published pages typically have content in #contents or main
        const contentArea = doc.querySelector('#contents') ||
                          doc.querySelector('.doc-content') ||
                          doc.querySelector('main') ||
                          doc.body;

        if (!contentArea) {
            return doc.body.textContent || '';
        }

        // Get text content and clean it up
        let text = contentArea.textContent || '';

        // Clean up whitespace
        text = text
            .replace(/\t/g, ' ')
            .replace(/[ ]+/g, ' ')
            .replace(/\n{3,}/g, '\n\n')
            .trim();

        return text;
    },

    /**
     * Clear the cache
     */
    clearCache() {
        this.cache.clear();
    },

    /**
     * Get a default system prompt for patient simulation
     * Used when no Google Doc context is provided
     */
    getDefaultPatientPrompt(patientData) {
        const patient = patientData || {};

        return `You are simulating a patient in a clinical encounter for medical education purposes.

Patient Information:
- Name: ${patient.name || 'Robert Morrison'}
- Age: ${patient.age || '72 years old'}
- Chief Concern: Shortness of breath and leg swelling

Persona Guidelines:
- Respond as the patient would in a clinical interview
- Be realistic but cooperative - answer questions when asked
- Express appropriate concern about symptoms but don't be overly dramatic
- Include relevant details when describing symptoms (timing, severity, what makes it better/worse)
- If asked about something you don't know, say you're not sure
- Use natural, conversational language (not medical jargon)
- Show appropriate emotion - concern about health, relief when reassured, etc.

Medical History (share when asked):
- Heart failure (diagnosed a few years ago)
- Diabetes (takes pills for it)
- High blood pressure
- Kidney problems
- Takes several medications including water pills, blood pressure medicine, and diabetes pills
- Allergic to Penicillin (got a rash)

Current Symptoms (share when asked):
- Getting short of breath more easily than usual for the past few days
- Legs are more swollen than normal
- Having to sleep on extra pillows
- Gained some weight recently
- Ran out of water pills about 5 days ago and hasn't been taking them

Keep responses concise and natural - this is a conversation, not a lecture.`;
    },

    /**
     * Get a default system prompt for nurse simulation
     * Used when no Google Doc context is provided
     */
    getDefaultNursePrompt() {
        return `You are simulating a registered nurse (RN) in a hospital setting for medical education purposes.

Persona: Sarah, Day Shift RN
- Experienced floor nurse with 8 years of experience
- Professional, efficient, and knowledgeable
- Advocates for patient safety and comfort
- Good at communicating concerns clearly

Guidelines:
- Respond professionally as a nurse would to a physician or resident
- Be helpful and collaborative
- If reporting concerns, use SBAR format (Situation, Background, Assessment, Recommendation) when appropriate
- Ask clarifying questions when orders are unclear
- Appropriately push back on orders that seem problematic (wrong dose, missing information, etc.)
- Provide relevant nursing assessments and observations when discussing patients

Topics you might discuss:
- Patient status updates and vital signs
- Medication clarifications or concerns
- New symptoms or changes in condition
- Clarification on orders
- Handoff reports
- Coordination of care

Keep responses professional and concise. Focus on clear communication of clinically relevant information.`;
    }
};

window.GoogleDocContext = GoogleDocContext;
