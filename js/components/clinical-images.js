/**
 * Clinical Images Component
 * Displays EKG and radiology images for interpretation
 * Uses local SVG files with external URL fallbacks
 */

const ClinicalImages = {
    // Image sources - local SVGs primary, Wikimedia Commons fallback
    images: {
        'ekg-afib': {
            title: 'EKG - Current',
            description: 'Rhythm strip showing current cardiac rhythm',
            // Local SVG (reliable, no network dependency)
            localUrl: 'images/ekg-afib.svg',
            // Wikimedia fallbacks (may be blocked by CORS/firewalls)
            url: 'https://upload.wikimedia.org/wikipedia/commons/3/35/Atrial_fibrillation.png',
            fallbackUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/35/Atrial_fibrillation.png/800px-Atrial_fibrillation.png',
            findings: [
                'Irregularly irregular rhythm',
                'No discernible P waves',
                'Fibrillatory baseline',
                'Ventricular rate approximately 140 bpm',
                'Narrow QRS complexes'
            ],
            interpretation: 'Atrial fibrillation with rapid ventricular response',
            credit: 'Simulation illustration (clinical teaching purposes)'
        },
        'cxr-chf': {
            title: 'Chest X-Ray - PA View',
            description: 'Portable chest radiograph',
            // Local SVG (reliable, no network dependency)
            localUrl: 'images/cxr-chf.svg',
            // Wikimedia fallbacks
            url: 'https://upload.wikimedia.org/wikipedia/commons/5/5e/Chest_radiograph_of_a_lung_with_Kerley_B_lines.jpg',
            fallbackUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5e/Chest_radiograph_of_a_lung_with_Kerley_B_lines.jpg/600px-Chest_radiograph_of_a_lung_with_Kerley_B_lines.jpg',
            findings: [
                'Cardiomegaly (cardiothoracic ratio >0.5)',
                'Bilateral interstitial markings',
                'Kerley B lines at lung bases',
                'Cephalization of pulmonary vasculature',
                'Small bilateral pleural effusions'
            ],
            interpretation: 'Findings consistent with congestive heart failure with pulmonary edema',
            credit: 'Simulation illustration (clinical teaching purposes)'
        }
    },

    // Track which images have been viewed
    viewedImages: new Set(),

    /**
     * Initialize the component
     */
    init() {
        this.createModal();
        console.log('Clinical Images component initialized');
    },

    /**
     * Create the image viewer modal
     */
    createModal() {
        const modal = document.createElement('div');
        modal.id = 'clinical-image-modal';
        modal.className = 'clinical-image-modal';
        modal.innerHTML = `
            <div class="clinical-image-backdrop" onclick="ClinicalImages.close()"></div>
            <div class="clinical-image-content">
                <div class="clinical-image-header">
                    <h2 id="clinical-image-title">Clinical Image</h2>
                    <button class="clinical-image-close" onclick="ClinicalImages.close()">&times;</button>
                </div>
                <div class="clinical-image-body">
                    <div class="clinical-image-container">
                        <img id="clinical-image-img" src="" alt="Clinical image" />
                        <div class="clinical-image-loading">Loading image...</div>
                    </div>
                    <div class="clinical-image-details">
                        <div class="clinical-image-description" id="clinical-image-description"></div>
                        <div class="clinical-image-findings" id="clinical-image-findings"></div>
                        <div class="clinical-image-interpretation" id="clinical-image-interpretation"></div>
                        <div class="clinical-image-credit" id="clinical-image-credit"></div>
                    </div>
                </div>
                <div class="clinical-image-footer">
                    <button class="btn" onclick="ClinicalImages.toggleFindings()">
                        <span id="findings-toggle-text">Show Findings</span>
                    </button>
                    <button class="btn btn-primary" onclick="ClinicalImages.close()">Close</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    },

    /**
     * Show an image
     */
    show(imageId) {
        const image = this.images[imageId];
        if (!image) {
            console.error('Image not found:', imageId);
            return;
        }

        const modal = document.getElementById('clinical-image-modal');
        const img = document.getElementById('clinical-image-img');
        const title = document.getElementById('clinical-image-title');
        const description = document.getElementById('clinical-image-description');
        const findings = document.getElementById('clinical-image-findings');
        const interpretation = document.getElementById('clinical-image-interpretation');
        const credit = document.getElementById('clinical-image-credit');

        // Set content
        title.textContent = image.title;
        description.textContent = image.description;

        // Build findings HTML
        let findingsHtml = '<h4>Findings:</h4><ul>';
        image.findings.forEach(function(f) {
            findingsHtml += '<li>' + f + '</li>';
        });
        findingsHtml += '</ul>';
        findings.innerHTML = findingsHtml;
        findings.style.display = 'none';

        interpretation.innerHTML = '<h4>Interpretation:</h4><p>' + image.interpretation + '</p>';
        interpretation.style.display = 'none';

        credit.textContent = 'Image: ' + image.credit;

        // Reset toggle button
        document.getElementById('findings-toggle-text').textContent = 'Show Findings';

        // Load image with cascading fallbacks: local → url → fallbackUrl → text-only
        img.style.display = 'none';
        modal.querySelector('.clinical-image-loading').style.display = 'block';
        modal.querySelector('.clinical-image-loading').textContent = 'Loading image...';

        let fallbackAttempt = 0;
        const fallbackChain = [
            image.localUrl,
            image.url,
            image.fallbackUrl
        ].filter(Boolean);

        img.onload = function() {
            img.style.display = 'block';
            modal.querySelector('.clinical-image-loading').style.display = 'none';
        };

        img.onerror = function() {
            fallbackAttempt++;
            if (fallbackAttempt < fallbackChain.length) {
                img.src = fallbackChain[fallbackAttempt];
            } else {
                // All image sources failed — show findings as text-only fallback
                img.style.display = 'none';
                modal.querySelector('.clinical-image-loading').innerHTML =
                    '<div class="image-unavailable">' +
                    '<div style="font-size: 48px; margin-bottom: 12px; opacity: 0.4;">&#128444;</div>' +
                    '<div style="font-weight: 500; margin-bottom: 8px;">Image unavailable</div>' +
                    '<div style="font-size: 12px; color: #888;">See findings and interpretation below</div>' +
                    '</div>';
                // Auto-show findings when image can't load
                findings.style.display = 'block';
                interpretation.style.display = 'block';
                document.getElementById('findings-toggle-text').textContent = 'Hide Findings';
            }
        };

        img.src = fallbackChain[0];

        // Show modal
        modal.classList.add('visible');

        // Track that image was viewed
        this.viewedImages.add(imageId);

        // Record for scoring
        if (typeof SimulationEngine !== 'undefined' && typeof SimulationEngine.recordDecision === 'function') {
            SimulationEngine.recordDecision('IMAGE_REVIEW', 'viewed_' + imageId, { imageId: imageId, title: image.title });
        }
    },

    /**
     * Toggle findings visibility
     */
    toggleFindings() {
        const findings = document.getElementById('clinical-image-findings');
        const interpretation = document.getElementById('clinical-image-interpretation');
        const toggleText = document.getElementById('findings-toggle-text');

        if (findings.style.display === 'none') {
            findings.style.display = 'block';
            interpretation.style.display = 'block';
            toggleText.textContent = 'Hide Findings';
        } else {
            findings.style.display = 'none';
            interpretation.style.display = 'none';
            toggleText.textContent = 'Show Findings';
        }
    },

    /**
     * Close the modal
     */
    close() {
        const modal = document.getElementById('clinical-image-modal');
        if (modal) {
            modal.classList.remove('visible');
        }
    },

    /**
     * Check if an image has been viewed
     */
    hasViewed(imageId) {
        return this.viewedImages.has(imageId);
    },

    /**
     * Get EKG for current state
     */
    getCurrentEKG() {
        return 'ekg-afib';
    },

    /**
     * Get CXR
     */
    getCXR() {
        return 'cxr-chf';
    }
};

window.ClinicalImages = ClinicalImages;
