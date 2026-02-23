/**
 * About Page Component
 * Loads content from a published Google Doc so it can be updated without code changes.
 * Falls back to hardcoded content if the fetch fails.
 */

const About = {
    // Published Google Doc URL — edit the doc to update the About page
    docUrl: 'https://docs.google.com/document/d/e/2PACX-1vRtQimxl8DaDXaIlVgXhFlkLRclI1A1TSaxqhOhdcRgpR2H40GPywC2xXp57KSeoUoa9XhPEuoayed2/pub',

    // Cache fetched content
    cachedHtml: null,
    cacheTimestamp: 0,
    cacheDuration: 5 * 60 * 1000, // 5 minutes

    async render() {
        const content = document.getElementById('main-content');

        // Show loading state
        content.innerHTML = `
            <div class="about-page">
                <div class="about-hero">
                    <div class="about-hero-title">
                        <span class="logo-ai">A</span>cting <span class="logo-ai">I</span>ntern
                    </div>
                    <p class="about-hero-tagline">Loading...</p>
                </div>
            </div>
        `;

        // Try to load from Google Doc
        let sectionHtml = null;
        try {
            sectionHtml = await this.fetchAndParse();
        } catch (err) {
            console.warn('About: Google Doc fetch failed, using fallback content.', err);
        }

        // Render with fetched or fallback content
        const bodyContent = sectionHtml || this.getFallbackHtml();

        content.innerHTML = `
            <div class="about-page">
                <div class="about-hero">
                    <div class="about-hero-title">
                        <span class="logo-ai">A</span>cting <span class="logo-ai">I</span>ntern
                    </div>
                    <p class="about-hero-tagline">A PHI-free playground for exploring how AI can support clinical reasoning and medical decision-making.</p>
                </div>
                ${bodyContent}
                <div class="about-footer">
                    <p>Built with care in the spirit of better clinical reasoning.</p>
                </div>
            </div>
        `;
    },

    /**
     * Fetch the published Google Doc and parse its HTML into styled sections.
     * Google Docs published pages put content in #contents with headings and paragraphs.
     */
    async fetchAndParse() {
        // Check cache
        if (this.cachedHtml && (Date.now() - this.cacheTimestamp < this.cacheDuration)) {
            return this.cachedHtml;
        }

        const response = await fetch(this.docUrl, { mode: 'cors', headers: { 'Accept': 'text/html' } });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const html = await response.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        // Remove scripts and styles
        doc.querySelectorAll('script, style').forEach(el => el.remove());

        // Find the content area
        const contentArea = doc.querySelector('#contents') || doc.querySelector('.doc-content') || doc.body;
        if (!contentArea) throw new Error('No content area found');

        // Walk through children and build sections
        // Google Docs uses various heading tags (h1-h6) and p tags with class-based spans
        let sectionsHtml = '';
        let currentSection = null;

        const elements = contentArea.querySelectorAll('h1, h2, h3, h4, h5, h6, p, ul, ol');

        for (const el of elements) {
            const tag = el.tagName.toLowerCase();
            const text = el.textContent.trim();

            // Skip empty elements
            if (!text) continue;

            // Headings start new sections
            if (tag.match(/^h[1-6]$/)) {
                // Close previous section
                if (currentSection) {
                    sectionsHtml += '</div>';
                }
                // Start new section
                sectionsHtml += '<div class="about-section">';
                sectionsHtml += `<h2>${this.sanitize(text)}</h2>`;
                currentSection = text;
            } else if (tag === 'p') {
                // If no section started yet, start one
                if (!currentSection) {
                    sectionsHtml += '<div class="about-section">';
                    currentSection = 'intro';
                }
                // Preserve bold and italic from Google Docs
                const innerHTML = this.cleanInlineHtml(el);
                sectionsHtml += `<p>${innerHTML}</p>`;
            } else if (tag === 'ul' || tag === 'ol') {
                if (!currentSection) {
                    sectionsHtml += '<div class="about-section">';
                    currentSection = 'intro';
                }
                const listItems = Array.from(el.querySelectorAll('li'))
                    .map(li => `<li>${this.sanitize(li.textContent.trim())}</li>`)
                    .join('');
                sectionsHtml += `<${tag}>${listItems}</${tag}>`;
            }
        }

        // Close last section
        if (currentSection) {
            sectionsHtml += '</div>';
        }

        // If we got nothing meaningful, throw so we fall back
        if (!sectionsHtml.trim()) throw new Error('No content parsed from document');

        // Cache it
        this.cachedHtml = sectionsHtml;
        this.cacheTimestamp = Date.now();

        return sectionsHtml;
    },

    /**
     * Sanitize text to prevent XSS — strip all HTML tags
     */
    sanitize(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    /**
     * Extract inline formatting (bold, italic) from a Google Docs paragraph element,
     * while stripping everything else for safety.
     */
    cleanInlineHtml(el) {
        let result = '';
        for (const node of el.childNodes) {
            if (node.nodeType === Node.TEXT_NODE) {
                result += this.sanitize(node.textContent);
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                const text = this.sanitize(node.textContent);
                if (!text.trim()) continue;

                // Check computed/inline style for bold/italic
                const style = node.getAttribute('style') || '';
                const isBold = style.includes('font-weight:700') || style.includes('font-weight:bold') ||
                               node.tagName === 'B' || node.tagName === 'STRONG';
                const isItalic = style.includes('font-style:italic') ||
                                 node.tagName === 'I' || node.tagName === 'EM';

                if (isBold && isItalic) {
                    result += `<strong><em>${text}</em></strong>`;
                } else if (isBold) {
                    result += `<strong>${text}</strong>`;
                } else if (isItalic) {
                    result += `<em>${text}</em>`;
                } else {
                    result += text;
                }
            }
        }
        return result;
    },

    /**
     * Fallback content if Google Doc fetch fails
     */
    getFallbackHtml() {
        return `
            <div class="about-section">
                <h2>Why "Acting Intern"?</h2>
                <p>
                    In the final year of medical school, students complete a capstone rotation called the Acting Internship. By this point, they have accumulated an enormous body of knowledge — sometimes a PhD's worth of scientific depth — and have become remarkably effective at getting things done in the hospital. They build problem representations, construct differential diagnoses, develop frameworks and approaches, and maintain meticulous problem lists.
                </p>
                <p>
                    What makes acting interns unique is their relationship to supervision. An attending might give a general instruction — "let's replete their potassium" — and the acting intern does the diligent work: researching the right formulation, checking renal function, reviewing the rate of correction, and entering a specific order for a senior resident or attending to cosign. They don't make the final call, but they do the thinking that makes the final call possible.
                </p>
                <p>
                    This is exactly the role we envision for AI in clinical care. An AI acting intern brings the same attributes: deep knowledge, diligent research, structured clinical reasoning, and a clear understanding that the physician drives the decisions. By naming this project Acting Intern, we invoke that relationship — capable, supportive, never overstepping.
                </p>
            </div>
            <div class="about-section">
                <h2>Philosophy</h2>
                <p>
                    Acting Intern is built on a simple conviction: AI should support the physician's reasoning process, not supplant it.
                </p>
                <p>
                    The doctor drives decision-making. The AI supports by organizing information, surfacing relevant data at the right moment, flagging safety concerns, and tracking what has been addressed versus what remains open. It mirrors back the clinician's own thinking in a structured way — not to lead, but to help them see the full picture.
                </p>
                <p>
                    This platform is a PHI-free environment where clinicians, educators, and developers can explore how agentic AI will reshape medical workflows. Every patient is synthetic. Every interaction is a learning opportunity. The goal is to understand, before these tools reach the bedside, how they should behave when they get there.
                </p>
            </div>
            <div class="about-section">
                <h2>About the Creator</h2>
                <p>
                    I studied cognitive science as an undergraduate, with a focus on human-computer interaction and a passion for architectures of intelligence — how minds organize, retrieve, and apply knowledge in complex environments.
                </p>
                <p>
                    That passion found a natural home in medical education, where the same principles of knowledge building and reasoning exist, all deeply focused on the patient in front of us. How can we reason the best for our patients? How should we structure our thinking, our notes, our signout? How can our cognitive frameworks and information management help us be fully present at the bedside?
                </p>
                <p>
                    Over the past 15 years, I have had the privilege of supervising thousands of Stanford residents, medical students, and advanced practice providers. That experience has shaped a deep belief: the best clinical tools don't replace thinking — they create the conditions for better thinking.
                </p>
                <p>
                    Acting Intern is an expression of that belief. It's an exploration of how AI, designed with the right relationship to the clinician, can further support our reasoning process to create the best care for our patients.
                </p>
            </div>
        `;
    }
};

window.About = About;
