/**
 * Tutorial / Feature Walkthrough Component
 * Spotlight-style guided tour that highlights key UI areas.
 * Triggered from the About modal or re-playable from the About page.
 */

const Tutorial = {
    currentStep: 0,
    isActive: false,
    _prevTarget: null,
    _prevTargetStyles: null,
    _resizeHandler: null,

    steps: [
        {
            target: '.sidebar',
            position: 'right',
            title: 'Patient Chart',
            description: 'Navigate the chart sidebar to view labs, medications, vitals, imaging, notes, and more. Click any section to load it in the main content area.',
            icon: '&#128203;'
        },
        {
            target: '.content',
            position: 'left',
            title: 'Main Content',
            description: 'This is where patient data appears as you navigate — lab results, medication lists, clinical notes, imaging reports, and vitals charts.',
            icon: '&#128196;'
        },
        {
            target: '#ai-panel',
            position: 'left',
            title: 'AI Assistant',
            description: 'Your AI coworker lives here. It can summarize the chart, suggest orders, draft H&P notes, and reason through differential diagnoses — always deferring to your clinical judgment.',
            icon: '&#129302;'
        },
        {
            target: '#chat-trigger-buttons',
            position: 'right',
            title: 'Chat Interfaces',
            description: 'Talk to the simulated patient to gather history and build rapport, or communicate with the charge nurse who responds to your orders and flags clinical changes.',
            icon: '&#128172;'
        },
        {
            target: '.sim-controls',
            position: 'below',
            title: 'Simulation Controls',
            description: 'Start a clinical scenario here — choose a patient case, set the simulation speed, and manage the timeline. The simulation drives dynamic vitals, lab results, and nurse alerts.',
            icon: '&#127919;'
        },
        {
            target: '.header-center',
            position: 'below',
            title: 'Patient Banner',
            description: 'Key demographics are always visible — name, MRN, DOB, age, and sex. The allergy banner below flags critical drug allergies.',
            icon: '&#129489;'
        },
        {
            target: null, // Centered completion card
            position: 'center',
            title: "You're Ready!",
            description: 'Start by exploring the chart, then launch a simulation to see the patient come to life. The AI assistant and chat interfaces will activate once a scenario is running.',
            icon: '&#127881;'
        }
    ],

    /**
     * Start the tutorial walkthrough
     */
    start() {
        if (this.isActive) return;
        this.isActive = true;
        this.currentStep = 0;

        this._createOverlay();
        this.goToStep(0);

        // Handle window resize
        this._resizeHandler = () => {
            if (this.isActive) this._updatePositions();
        };
        window.addEventListener('resize', this._resizeHandler);
    },

    /**
     * Advance to the next step
     */
    next() {
        if (this.currentStep < this.steps.length - 1) {
            this.goToStep(this.currentStep + 1);
        } else {
            this.end();
        }
    },

    /**
     * Go back one step
     */
    prev() {
        if (this.currentStep > 0) {
            this.goToStep(this.currentStep - 1);
        }
    },

    /**
     * Jump to a specific step
     */
    goToStep(index) {
        if (index < 0 || index >= this.steps.length) return;

        // Unhighlight previous target
        this._unhighlightTarget();

        this.currentStep = index;
        const step = this.steps[index];

        if (step.target) {
            // Highlight the target element
            this._highlightTarget(step);
            this._positionSpotlight(step);
        } else {
            // No target — hide spotlight for centered card
            this._hideSpotlight();
        }

        this._renderTooltip(step, index);
        this._positionTooltip(step);
    },

    /**
     * End the tutorial and clean up
     */
    end() {
        this.isActive = false;
        this._unhighlightTarget();

        // Remove overlay elements
        const overlay = document.getElementById('tutorial-overlay');
        const spotlight = document.getElementById('tutorial-spotlight');
        const tooltip = document.getElementById('tutorial-tooltip');
        if (overlay) overlay.remove();
        if (spotlight) spotlight.remove();
        if (tooltip) tooltip.remove();

        // Remove resize listener
        if (this._resizeHandler) {
            window.removeEventListener('resize', this._resizeHandler);
            this._resizeHandler = null;
        }

        // Mark as seen
        localStorage.setItem('tutorial-seen', 'true');
    },

    /**
     * Create the overlay and spotlight elements
     */
    _createOverlay() {
        // Remove any existing
        ['tutorial-overlay', 'tutorial-spotlight', 'tutorial-tooltip'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.remove();
        });

        // Dark overlay background
        const overlay = document.createElement('div');
        overlay.id = 'tutorial-overlay';
        overlay.className = 'tutorial-overlay';
        document.body.appendChild(overlay);

        // Spotlight cutout
        const spotlight = document.createElement('div');
        spotlight.id = 'tutorial-spotlight';
        spotlight.className = 'tutorial-spotlight';
        document.body.appendChild(spotlight);

        // Tooltip card
        const tooltip = document.createElement('div');
        tooltip.id = 'tutorial-tooltip';
        tooltip.className = 'tutorial-tooltip';
        document.body.appendChild(tooltip);
    },

    /**
     * Highlight the target element by raising it above the overlay
     */
    _highlightTarget(step) {
        const target = document.querySelector(step.target);
        if (!target) return;

        // Save previous styles
        this._prevTarget = target;
        this._prevTargetStyles = {
            position: target.style.position,
            zIndex: target.style.zIndex,
            borderRadius: target.style.borderRadius
        };

        // Raise above overlay
        const computed = getComputedStyle(target);
        if (computed.position === 'static') {
            target.style.position = 'relative';
        }
        target.style.zIndex = '10003';
    },

    /**
     * Restore the previously highlighted target
     */
    _unhighlightTarget() {
        if (this._prevTarget && this._prevTargetStyles) {
            this._prevTarget.style.position = this._prevTargetStyles.position;
            this._prevTarget.style.zIndex = this._prevTargetStyles.zIndex;
            this._prevTarget = null;
            this._prevTargetStyles = null;
        }
    },

    /**
     * Position the spotlight cutout over the target element
     */
    _positionSpotlight(step) {
        const spotlight = document.getElementById('tutorial-spotlight');
        const target = document.querySelector(step.target);
        if (!spotlight || !target) return;

        const rect = target.getBoundingClientRect();
        const padding = 8;

        spotlight.style.display = 'block';
        spotlight.style.top = (rect.top - padding) + 'px';
        spotlight.style.left = (rect.left - padding) + 'px';
        spotlight.style.width = (rect.width + padding * 2) + 'px';
        spotlight.style.height = (rect.height + padding * 2) + 'px';
    },

    /**
     * Hide the spotlight (for centered cards with no target)
     */
    _hideSpotlight() {
        const spotlight = document.getElementById('tutorial-spotlight');
        if (spotlight) {
            spotlight.style.display = 'none';
        }
    },

    /**
     * Render the tooltip content for the current step
     */
    _renderTooltip(step, index) {
        const tooltip = document.getElementById('tutorial-tooltip');
        if (!tooltip) return;

        const isFirst = index === 0;
        const isLast = index === this.steps.length - 1;
        const total = this.steps.length;

        // Step dots
        let dots = '';
        for (let i = 0; i < total; i++) {
            const activeClass = i === index ? 'active' : '';
            const completedClass = i < index ? 'completed' : '';
            dots += `<span class="tutorial-dot ${activeClass} ${completedClass}"></span>`;
        }

        tooltip.innerHTML = `
            <div class="tutorial-tooltip-header">
                <span class="tutorial-tooltip-icon">${step.icon}</span>
                <span class="tutorial-tooltip-step">Step ${index + 1} of ${total}</span>
            </div>
            <h3 class="tutorial-tooltip-title">${step.title}</h3>
            <p class="tutorial-tooltip-desc">${step.description}</p>
            <div class="tutorial-tooltip-dots">${dots}</div>
            <div class="tutorial-tooltip-actions">
                ${isFirst ? '' : '<button class="tutorial-btn tutorial-btn-back" onclick="Tutorial.prev()">Back</button>'}
                <button class="tutorial-btn tutorial-btn-skip" onclick="Tutorial.end()">Skip Tour</button>
                <button class="tutorial-btn tutorial-btn-next" onclick="${isLast ? 'Tutorial.end()' : 'Tutorial.next()'}">
                    ${isLast ? 'Get Started' : 'Next'}
                </button>
            </div>
        `;

        // Add centered class for completion step
        if (step.position === 'center') {
            tooltip.classList.add('centered');
        } else {
            tooltip.classList.remove('centered');
        }
    },

    /**
     * Position the tooltip relative to the spotlight area
     */
    _positionTooltip(step) {
        const tooltip = document.getElementById('tutorial-tooltip');
        if (!tooltip) return;

        // Reset any inline positioning
        tooltip.style.top = '';
        tooltip.style.left = '';
        tooltip.style.right = '';
        tooltip.style.bottom = '';
        tooltip.style.transform = '';

        if (step.position === 'center' || !step.target) {
            // Center on screen
            tooltip.style.top = '50%';
            tooltip.style.left = '50%';
            tooltip.style.transform = 'translate(-50%, -50%)';
            return;
        }

        const target = document.querySelector(step.target);
        if (!target) return;

        const rect = target.getBoundingClientRect();
        const tooltipRect = tooltip.getBoundingClientRect();
        const gap = 16;
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        let top, left;

        switch (step.position) {
            case 'right':
                top = rect.top + (rect.height / 2) - (tooltipRect.height / 2);
                left = rect.right + gap;
                break;
            case 'left':
                top = rect.top + (rect.height / 2) - (tooltipRect.height / 2);
                left = rect.left - tooltipRect.width - gap;
                break;
            case 'below':
                top = rect.bottom + gap;
                left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);
                break;
            case 'above':
                top = rect.top - tooltipRect.height - gap;
                left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);
                break;
            default:
                top = rect.bottom + gap;
                left = rect.left;
        }

        // Clamp to viewport
        top = Math.max(12, Math.min(vh - tooltipRect.height - 12, top));
        left = Math.max(12, Math.min(vw - tooltipRect.width - 12, left));

        tooltip.style.top = top + 'px';
        tooltip.style.left = left + 'px';
    },

    /**
     * Update positions on window resize
     */
    _updatePositions() {
        const step = this.steps[this.currentStep];
        if (!step) return;

        if (step.target) {
            this._positionSpotlight(step);
        }
        this._positionTooltip(step);
    }
};

window.Tutorial = Tutorial;
