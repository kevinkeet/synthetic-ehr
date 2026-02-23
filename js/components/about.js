/**
 * About Page Component
 * Loads content from a published Google Doc so it can be updated without code changes.
 * Falls back to hardcoded content if the fetch fails.
 * Shows as a popup on first visit (tracked via localStorage).
 */

const About = {
    // Published Google Doc URL — edit the doc to update the About page
    docUrl: 'https://docs.google.com/document/d/e/2PACX-1vRtQimxl8DaDXaIlVgXhFlkLRclI1A1TSaxqhOhdcRgpR2H40GPywC2xXp57KSeoUoa9XhPEuoayed2/pub',

    // Cache fetched content
    cachedHtml: null,
    cacheTimestamp: 0,
    cacheDuration: 5 * 60 * 1000, // 5 minutes

    // Bold/italic class maps extracted from Google Doc stylesheet
    boldClasses: new Set(),
    italicClasses: new Set(),

    /**
     * Check if this is the user's first visit and show the popup if so.
     * Called once from app init.
     */
    checkFirstVisit() {
        const seen = localStorage.getItem('about-seen');
        if (!seen) {
            this.showModal();
        }
    },

    /**
     * Show the About content as a modal overlay
     */
    async showModal() {
        // Mark as seen
        localStorage.setItem('about-seen', 'true');

        // Create modal container
        const overlay = document.createElement('div');
        overlay.className = 'about-modal-overlay';
        overlay.id = 'about-modal-overlay';
        overlay.innerHTML = `
            <div class="about-modal">
                <button class="about-modal-close" onclick="About.closeModal()">&times;</button>
                <div class="about-modal-body">
                    <div class="about-page">
                        <div class="about-hero">
                            <div class="about-hero-title">
                                <span class="logo-ai">A</span>cting <span class="logo-ai">I</span>ntern
                            </div>
                            <p class="about-hero-tagline">Loading...</p>
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        // Close on backdrop click
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) About.closeModal();
        });

        // Close on Escape
        const escHandler = (e) => {
            if (e.key === 'Escape') {
                About.closeModal();
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);

        // Load content
        let sectionHtml = null;
        try {
            sectionHtml = await this.fetchAndParse();
        } catch (err) {
            console.warn('About modal: Google Doc fetch failed, using fallback.', err);
        }

        const bodyContent = sectionHtml || this.getFallbackHtml();
        const modalBody = overlay.querySelector('.about-modal-body');
        if (modalBody) {
            modalBody.innerHTML = `
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
        }
    },

    /**
     * Close the modal overlay
     */
    closeModal() {
        const overlay = document.getElementById('about-modal-overlay');
        if (overlay) overlay.remove();
    },

    /**
     * Render the About page in the main content area (for #/about route)
     */
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
     * Google Docs published pages use class-based styling in a <style> block,
     * so we extract the bold/italic classes from that stylesheet first.
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

        // Extract bold/italic classes from the Google Docs <style> block BEFORE removing styles
        this.extractFormattingClasses(doc);

        // Remove scripts and styles (after extracting class info)
        doc.querySelectorAll('script, style').forEach(el => el.remove());

        // Find the content area
        const contentArea = doc.querySelector('#contents') || doc.querySelector('.doc-content') || doc.body;
        if (!contentArea) throw new Error('No content area found');

        // Walk through children and build sections
        let sectionsHtml = '';
        let currentSection = null;

        const elements = contentArea.querySelectorAll('h1, h2, h3, h4, h5, h6, p, ul, ol');

        for (const el of elements) {
            const tag = el.tagName.toLowerCase();
            const text = el.textContent.trim();

            // Skip empty elements
            if (!text) continue;

            // Detect headings: actual h tags OR paragraphs whose spans are all bold/large
            const isHeading = tag.match(/^h[1-6]$/) || this.isHeadingParagraph(el);

            if (isHeading) {
                if (currentSection) sectionsHtml += '</div>';
                sectionsHtml += '<div class="about-section">';
                sectionsHtml += `<h2>${this.sanitize(text)}</h2>`;
                currentSection = text;
            } else if (tag === 'p') {
                if (!currentSection) {
                    sectionsHtml += '<div class="about-section">';
                    currentSection = 'intro';
                }
                const innerHTML = this.cleanInlineHtml(el);
                sectionsHtml += `<p>${innerHTML}</p>`;
            } else if (tag === 'ul' || tag === 'ol') {
                if (!currentSection) {
                    sectionsHtml += '<div class="about-section">';
                    currentSection = 'intro';
                }
                const listItems = Array.from(el.querySelectorAll('li'))
                    .map(li => `<li>${this.cleanInlineHtml(li)}</li>`)
                    .join('');
                sectionsHtml += `<${tag}>${listItems}</${tag}>`;
            }
        }

        if (currentSection) sectionsHtml += '</div>';
        if (!sectionsHtml.trim()) throw new Error('No content parsed from document');

        this.cachedHtml = sectionsHtml;
        this.cacheTimestamp = Date.now();
        return sectionsHtml;
    },

    /**
     * Parse the Google Docs <style> block to find which CSS classes
     * correspond to bold (font-weight:700) or italic (font-style:italic).
     */
    extractFormattingClasses(doc) {
        this.boldClasses = new Set();
        this.italicClasses = new Set();

        const styleEls = doc.querySelectorAll('style');
        for (const styleEl of styleEls) {
            const css = styleEl.textContent || '';

            // Match class rules like .c3{...font-weight:700...}
            const rulePattern = /\.(c\d+)\s*\{([^}]+)\}/g;
            let match;
            while ((match = rulePattern.exec(css)) !== null) {
                const className = match[1];
                const body = match[2];

                if (/font-weight\s*:\s*(700|bold)/i.test(body)) {
                    this.boldClasses.add(className);
                }
                if (/font-style\s*:\s*italic/i.test(body)) {
                    this.italicClasses.add(className);
                }
            }
        }
    },

    /**
     * Detect if a <p> element is acting as a heading in Google Docs.
     * Google Docs often uses <p class="c2"><span class="c3">Title</span></p>
     * where c3 has larger font and bold weight.
     */
    isHeadingParagraph(el) {
        if (el.tagName !== 'P') return false;
        const spans = el.querySelectorAll('span');
        if (spans.length === 0) return false;

        // Check if ALL non-empty spans are bold (heading class)
        let allBold = true;
        let hasContent = false;
        for (const span of spans) {
            if (!span.textContent.trim()) continue;
            hasContent = true;
            if (!this.isElementBold(span)) {
                allBold = false;
                break;
            }
        }

        // Also check font-size if present — headings in Google Docs are typically > 12pt
        if (hasContent && allBold) {
            // Verify by checking if there's a larger font size class
            for (const span of spans) {
                if (!span.textContent.trim()) continue;
                const classes = Array.from(span.classList);
                // If we detected it as bold via class, trust it as a heading
                for (const cls of classes) {
                    if (this.boldClasses.has(cls)) return true;
                }
            }
        }

        return false;
    },

    /**
     * Check if an element is bold — via class, inline style, or tag
     */
    isElementBold(el) {
        // Check tag
        if (el.tagName === 'B' || el.tagName === 'STRONG') return true;

        // Check classes against extracted bold classes
        for (const cls of el.classList) {
            if (this.boldClasses.has(cls)) return true;
        }

        // Check inline style
        const style = el.getAttribute('style') || '';
        if (/font-weight\s*:\s*(700|bold)/i.test(style)) return true;

        return false;
    },

    /**
     * Check if an element is italic — via class, inline style, or tag
     */
    isElementItalic(el) {
        if (el.tagName === 'I' || el.tagName === 'EM') return true;

        for (const cls of el.classList) {
            if (this.italicClasses.has(cls)) return true;
        }

        const style = el.getAttribute('style') || '';
        if (/font-style\s*:\s*italic/i.test(style)) return true;

        return false;
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
     * Extract inline formatting (bold, italic) from a Google Docs element,
     * using the class-based formatting map extracted from the stylesheet.
     */
    cleanInlineHtml(el) {
        let result = '';

        const processNode = (node) => {
            if (node.nodeType === Node.TEXT_NODE) {
                return this.sanitize(node.textContent);
            }

            if (node.nodeType !== Node.ELEMENT_NODE) return '';

            const text = this.sanitize(node.textContent);
            if (!text.trim()) return '';

            const isBold = this.isElementBold(node);
            const isItalic = this.isElementItalic(node);

            // For elements with children spans (nested), recurse
            if (node.children.length > 0 && node.tagName === 'SPAN') {
                // Check if this span itself has formatting
                let inner = '';
                for (const child of node.childNodes) {
                    inner += processNode(child);
                }

                if (isBold && isItalic) return `<strong><em>${inner}</em></strong>`;
                if (isBold) return `<strong>${inner}</strong>`;
                if (isItalic) return `<em>${inner}</em>`;
                return inner;
            }

            // Leaf element
            if (isBold && isItalic) return `<strong><em>${text}</em></strong>`;
            if (isBold) return `<strong>${text}</strong>`;
            if (isItalic) return `<em>${text}</em>`;
            return text;
        };

        for (const node of el.childNodes) {
            result += processNode(node);
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
