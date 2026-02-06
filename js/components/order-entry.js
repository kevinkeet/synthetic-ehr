/**
 * Order Entry Component
 * Modal-based form for creating new orders (meds, labs, imaging, etc.)
 */

const OrderEntry = {
    isOpen: false,
    selectedType: null,
    currentStep: 1, // 1: type selection, 2: form, 3: review

    // Order type configurations
    orderTypes: {
        medication: {
            label: 'Medication',
            icon: '&#128138;',
            fields: [
                { name: 'name', label: 'Medication Name', type: 'text', required: true, placeholder: 'e.g., Metformin' },
                { name: 'dose', label: 'Dose', type: 'text', required: true, placeholder: 'e.g., 500 mg' },
                { name: 'route', label: 'Route', type: 'select', required: true, options: ['PO', 'IV', 'IV Push', 'IV Piggyback', 'IM', 'SC', 'SL', 'PR', 'Topical', 'Inhaled', 'Intranasal'] },
                { name: 'frequency', label: 'Frequency', type: 'select', required: true, options: ['Once', 'Daily', 'BID', 'TID', 'QID', 'Q2H', 'Q4H', 'Q6H', 'Q8H', 'Q12H', 'Q24H', 'Q4H PRN', 'Q6H PRN', 'Q8H PRN', 'PRN', 'At bedtime', 'Before meals', 'After meals', 'With meals', 'Continuous'] },
                { name: 'duration', label: 'Duration', type: 'text', required: false, placeholder: 'e.g., 7 days, Ongoing' },
                { name: 'indication', label: 'Indication', type: 'text', required: true, placeholder: 'Clinical reason for medication' },
                { name: 'notes', label: 'Special Instructions', type: 'textarea', required: false, placeholder: 'e.g., Take with food, Hold if BP < 90' }
            ]
        },
        lab: {
            label: 'Lab',
            icon: '&#128300;',
            fields: [
                { name: 'name', label: 'Lab Panel/Test', type: 'select', required: true, options: [
                    '--- Common Panels ---',
                    'Complete Blood Count',
                    'Basic Metabolic Panel',
                    'Comprehensive Metabolic Panel',
                    'Lipid Panel',
                    'Liver Function Tests',
                    'Coagulation Panel (PT/INR/PTT)',
                    'Thyroid Panel',
                    '--- Cardiac ---',
                    'Troponin',
                    'BNP',
                    'Pro-BNP',
                    '--- Individual Labs ---',
                    'Magnesium',
                    'Phosphorus',
                    'Lactate',
                    'Ammonia',
                    'Uric Acid',
                    'Iron Studies',
                    'Ferritin',
                    'Vitamin B12',
                    'Folate',
                    'Vitamin D',
                    'Hemoglobin A1c',
                    'C-Reactive Protein',
                    'ESR',
                    'Procalcitonin',
                    '--- Blood Gas ---',
                    'Arterial Blood Gas',
                    'Venous Blood Gas',
                    '--- Urine ---',
                    'Urinalysis',
                    'Urine Culture',
                    'Urine Electrolytes',
                    '--- Cultures ---',
                    'Blood Culture',
                    'Sputum Culture',
                    '--- Other ---',
                    'Other'
                ]},
                { name: 'customName', label: 'Other Test Name', type: 'text', required: false, placeholder: 'If Other selected above', showIf: 'name:Other' },
                { name: 'specimen', label: 'Specimen Type', type: 'select', required: true, options: ['Blood', 'Urine', 'Stool', 'CSF', 'Sputum', 'Swab', 'Arterial Blood', 'Venous Blood', 'Other'] },
                { name: 'priority', label: 'Priority', type: 'select', required: true, options: ['Routine', 'Urgent', 'STAT'] },
                { name: 'indication', label: 'Clinical Indication', type: 'text', required: true, placeholder: 'Reason for ordering' },
                { name: 'notes', label: 'Special Instructions', type: 'textarea', required: false, placeholder: 'e.g., Fasting required, Trough level' }
            ]
        },
        imaging: {
            label: 'Imaging',
            icon: '&#128444;',
            fields: [
                { name: 'modality', label: 'Modality', type: 'select', required: true, options: ['X-Ray', 'CT', 'MRI', 'Ultrasound', 'Echo', 'Nuclear Medicine', 'Fluoroscopy'] },
                { name: 'bodyPart', label: 'Body Part/Region', type: 'text', required: true, placeholder: 'e.g., Chest, Abdomen, Head' },
                { name: 'contrast', label: 'Contrast', type: 'select', required: true, options: ['Without contrast', 'With contrast', 'With and without contrast', 'N/A'] },
                { name: 'priority', label: 'Priority', type: 'select', required: true, options: ['Routine', 'Urgent', 'STAT'] },
                { name: 'indication', label: 'Clinical Indication', type: 'text', required: true, placeholder: 'Reason for study' },
                { name: 'notes', label: 'Additional Information', type: 'textarea', required: false, placeholder: 'e.g., Patient has pacemaker' }
            ]
        },
        procedure: {
            label: 'Procedure',
            icon: '&#128137;',
            fields: [
                { name: 'name', label: 'Procedure Name', type: 'text', required: true, placeholder: 'e.g., Colonoscopy, Bronchoscopy' },
                { name: 'priority', label: 'Priority', type: 'select', required: true, options: ['Routine', 'Urgent', 'STAT'] },
                { name: 'indication', label: 'Indication', type: 'text', required: true, placeholder: 'Clinical reason' },
                { name: 'schedulingNotes', label: 'Scheduling Notes', type: 'textarea', required: false, placeholder: 'e.g., Patient on anticoagulation' },
                { name: 'notes', label: 'Additional Instructions', type: 'textarea', required: false }
            ]
        },
        consult: {
            label: 'Consult',
            icon: '&#128101;',
            fields: [
                { name: 'specialty', label: 'Specialty', type: 'select', required: true, options: ['Cardiology', 'Nephrology', 'Endocrinology', 'Pulmonology', 'Gastroenterology', 'Neurology', 'Infectious Disease', 'Oncology', 'Rheumatology', 'Psychiatry', 'Surgery', 'Other'] },
                { name: 'customSpecialty', label: 'Other Specialty', type: 'text', required: false, showIf: 'specialty:Other' },
                { name: 'priority', label: 'Priority', type: 'select', required: true, options: ['Routine', 'Urgent', 'STAT'] },
                { name: 'reason', label: 'Reason for Consult', type: 'textarea', required: true, placeholder: 'Detailed reason and clinical question' },
                { name: 'notes', label: 'Additional Information', type: 'textarea', required: false }
            ]
        },
        nursing: {
            label: 'Nursing',
            icon: '&#9829;',
            fields: [
                { name: 'orderType', label: 'Order Type', type: 'select', required: true, options: ['Vital Signs', 'Activity', 'Diet', 'I&O Monitoring', 'Fall Precautions', 'Isolation', 'Wound Care', 'Foley Care', 'Other'] },
                { name: 'details', label: 'Order Details', type: 'text', required: true, placeholder: 'e.g., Q4H vitals, Bed rest, NPO' },
                { name: 'priority', label: 'Priority', type: 'select', required: true, options: ['Routine', 'Urgent'] },
                { name: 'duration', label: 'Duration', type: 'text', required: false, placeholder: 'e.g., Until discharge, 24 hours' },
                { name: 'notes', label: 'Special Instructions', type: 'textarea', required: false }
            ]
        }
    },

    /**
     * Initialize the order entry modal
     */
    init() {
        this.createModal();
        this.setupKeyboardShortcuts();
    },

    /**
     * Create the modal HTML structure
     */
    createModal() {
        const modal = document.createElement('div');
        modal.id = 'order-entry-modal';
        modal.className = 'order-entry-modal';
        modal.innerHTML = `
            <div class="order-entry-backdrop" onclick="OrderEntry.close()"></div>
            <div class="order-entry-content">
                <div class="order-entry-header">
                    <h2 class="order-entry-title">New Order</h2>
                    <button class="order-entry-close" onclick="OrderEntry.close()">&times;</button>
                </div>
                <div class="order-entry-body" id="order-entry-body">
                    <!-- Content injected by render methods -->
                </div>
                <div class="order-entry-footer" id="order-entry-footer">
                    <!-- Footer buttons injected by render methods -->
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    },

    /**
     * Setup keyboard shortcuts
     */
    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isOpen) {
                this.close();
            }
        });
    },

    /**
     * Open the modal
     */
    open() {
        this.isOpen = true;
        this.currentStep = 1;
        this.selectedType = null;
        this.formData = {};

        const modal = document.getElementById('order-entry-modal');
        modal.classList.add('active');

        this.renderTypeSelection();
    },

    /**
     * Close the modal
     */
    close() {
        this.isOpen = false;
        const modal = document.getElementById('order-entry-modal');
        modal.classList.remove('active');
    },

    /**
     * Render type selection step
     */
    renderTypeSelection() {
        const body = document.getElementById('order-entry-body');
        const footer = document.getElementById('order-entry-footer');

        body.innerHTML = `
            <div class="order-type-grid">
                ${Object.entries(this.orderTypes).map(([key, type]) => `
                    <div class="order-type-card ${this.selectedType === key ? 'selected' : ''}"
                         onclick="OrderEntry.selectType('${key}')">
                        <div class="order-type-icon">${type.icon}</div>
                        <div class="order-type-label">${type.label}</div>
                    </div>
                `).join('')}
            </div>
        `;

        footer.innerHTML = `
            <button class="btn" onclick="OrderEntry.close()">Cancel</button>
            <button class="btn btn-primary" onclick="OrderEntry.goToForm()" ${!this.selectedType ? 'disabled' : ''}>
                Next
            </button>
        `;
    },

    /**
     * Select an order type
     */
    selectType(type) {
        this.selectedType = type;
        this.renderTypeSelection();
    },

    /**
     * Go to form step
     */
    goToForm() {
        if (!this.selectedType) return;
        this.currentStep = 2;
        this.renderForm();
    },

    /**
     * Render the form for selected order type
     */
    renderForm() {
        const body = document.getElementById('order-entry-body');
        const footer = document.getElementById('order-entry-footer');
        const config = this.orderTypes[this.selectedType];

        body.innerHTML = `
            <div class="order-form-header">
                <span class="order-form-icon">${config.icon}</span>
                <span class="order-form-type">${config.label} Order</span>
            </div>
            <form id="order-form" class="order-form" onsubmit="return false;">
                ${config.fields.map(field => this.renderField(field)).join('')}
            </form>
        `;

        footer.innerHTML = `
            <button class="btn" onclick="OrderEntry.goBack()">Back</button>
            <button class="btn btn-primary" onclick="OrderEntry.goToReview()">Review Order</button>
        `;

        // Setup conditional field visibility
        this.setupConditionalFields();
    },

    /**
     * Render a single form field
     */
    renderField(field) {
        const value = this.formData[field.name] || '';
        const requiredMark = field.required ? '<span class="required">*</span>' : '';
        const showIfAttr = field.showIf ? `data-show-if="${field.showIf}"` : '';
        const hiddenClass = field.showIf ? 'conditional-field hidden' : '';

        let input = '';
        switch (field.type) {
            case 'text':
                input = `<input type="text" class="form-input" name="${field.name}"
                         value="${value}" placeholder="${field.placeholder || ''}"
                         ${field.required ? 'required' : ''}>`;
                break;
            case 'select':
                input = `<select class="form-select" name="${field.name}" ${field.required ? 'required' : ''}>
                    <option value="">Select...</option>
                    ${field.options.map(opt => {
                        // Handle category headers (start with ---)
                        if (opt.startsWith('---')) {
                            return `<option disabled style="font-weight: bold; background: #f0f0f0;">${opt.replace(/---/g, '').trim()}</option>`;
                        }
                        return `<option value="${opt}" ${value === opt ? 'selected' : ''}>${opt}</option>`;
                    }).join('')}
                </select>`;
                break;
            case 'textarea':
                input = `<textarea class="form-textarea" name="${field.name}"
                         placeholder="${field.placeholder || ''}" rows="3"
                         ${field.required ? 'required' : ''}>${value}</textarea>`;
                break;
        }

        return `
            <div class="form-group ${hiddenClass}" ${showIfAttr}>
                <label class="form-label">${field.label}${requiredMark}</label>
                ${input}
            </div>
        `;
    },

    /**
     * Setup conditional field visibility
     */
    setupConditionalFields() {
        const form = document.getElementById('order-form');
        if (!form) return;

        form.addEventListener('change', (e) => {
            const conditionalFields = form.querySelectorAll('[data-show-if]');
            conditionalFields.forEach(field => {
                const [name, value] = field.dataset.showIf.split(':');
                const triggerField = form.querySelector(`[name="${name}"]`);
                if (triggerField && triggerField.value === value) {
                    field.classList.remove('hidden');
                } else {
                    field.classList.add('hidden');
                }
            });
        });
    },

    /**
     * Go back to type selection
     */
    goBack() {
        this.collectFormData();
        this.currentStep = 1;
        this.renderTypeSelection();
    },

    /**
     * Collect form data
     */
    collectFormData() {
        const form = document.getElementById('order-form');
        if (!form) return;

        const formData = new FormData(form);
        for (const [key, value] of formData.entries()) {
            this.formData[key] = value;
        }
    },

    /**
     * Go to review step
     */
    goToReview() {
        this.collectFormData();

        // Validate required fields
        const config = this.orderTypes[this.selectedType];
        const errors = [];
        config.fields.forEach(field => {
            if (field.required && !this.formData[field.name]) {
                errors.push(`${field.label} is required`);
            }
        });

        if (errors.length > 0) {
            App.showToast(errors[0], 'error');
            return;
        }

        this.currentStep = 3;
        this.renderReview();
    },

    /**
     * Render review step
     */
    renderReview() {
        const body = document.getElementById('order-entry-body');
        const footer = document.getElementById('order-entry-footer');
        const config = this.orderTypes[this.selectedType];

        body.innerHTML = `
            <div class="order-review">
                <div class="order-review-header">
                    <span class="order-form-icon">${config.icon}</span>
                    <span class="order-form-type">${config.label} Order</span>
                    <span class="order-review-badge">Review</span>
                </div>
                <div class="order-review-content">
                    ${config.fields.map(field => {
                        const value = this.formData[field.name];
                        if (!value) return '';
                        return `
                            <div class="order-review-item">
                                <span class="order-review-label">${field.label}</span>
                                <span class="order-review-value">${value}</span>
                            </div>
                        `;
                    }).join('')}
                    <div class="order-review-item">
                        <span class="order-review-label">Ordered By</span>
                        <span class="order-review-value">Dr. Sarah Chen</span>
                    </div>
                    <div class="order-review-item">
                        <span class="order-review-label">Order Date</span>
                        <span class="order-review-value">${new Date().toLocaleString()}</span>
                    </div>
                </div>
            </div>
        `;

        footer.innerHTML = `
            <button class="btn" onclick="OrderEntry.editForm()">Edit</button>
            <button class="btn btn-primary" onclick="OrderEntry.submitOrder()">Submit Order</button>
        `;
    },

    /**
     * Go back to edit form
     */
    editForm() {
        this.currentStep = 2;
        this.renderForm();
    },

    /**
     * Submit the order
     */
    async submitOrder() {
        const config = this.orderTypes[this.selectedType];

        // Build order object
        const order = {
            id: `ORD_${Date.now()}`,
            orderDate: new Date().toISOString(),
            category: config.label,
            name: this.formData.name || this.formData.customName || this.formData.orderType || this.formData.modality + ' ' + this.formData.bodyPart || this.formData.specialty,
            details: this.buildOrderDetails(),
            priority: this.formData.priority || 'Routine',
            status: 'Pending',
            orderedBy: 'Dr. Sarah Chen',
            indication: this.formData.indication || this.formData.reason || '',
            notes: this.formData.notes || '',
            type: this.selectedType,
            formData: { ...this.formData }
        };

        // In a real app, this would save to the server
        // For now, we'll add it to the display and show success
        console.log('Order submitted:', order);

        // Store in sessionStorage for demo purposes
        const pendingOrders = JSON.parse(sessionStorage.getItem('pendingOrders') || '[]');
        pendingOrders.unshift(order);
        sessionStorage.setItem('pendingOrders', JSON.stringify(pendingOrders));

        // Apply intervention to simulation if running
        if (SimulationEngine.isRunning || SimulationEngine.getState()) {
            if (this.selectedType === 'lab') {
                // Order a lab
                DynamicLabs.orderLab({
                    orderId: order.id,
                    name: order.name,
                    priority: this.formData.priority || 'Routine'
                });
            } else if (this.selectedType === 'imaging') {
                // Order imaging study
                if (typeof DynamicImaging !== 'undefined') {
                    DynamicImaging.orderStudy({
                        orderId: order.id,
                        modality: this.formData.modality,
                        bodyPart: this.formData.bodyPart,
                        contrast: this.formData.contrast,
                        priority: this.formData.priority || 'Routine',
                        indication: this.formData.indication
                    });
                }
            } else if (this.selectedType === 'medication') {
                // Apply medication intervention
                const intervention = {
                    type: this.selectedType,
                    category: order.category,
                    name: order.name,
                    dose: this.parseDose(this.formData.dose),
                    route: this.formData.route,
                    frequency: this.formData.frequency,
                    indication: this.formData.indication,
                    orderId: order.id
                };
                SimulationEngine.applyIntervention(intervention);
            } else {
                // Other order types
                const intervention = {
                    type: this.selectedType,
                    category: order.category,
                    name: order.name,
                    orderId: order.id
                };
                SimulationEngine.applyIntervention(intervention);
            }
        }

        App.showToast(`${config.label} order submitted successfully`, 'success');
        this.close();

        // Send nurse acknowledgment for orders during simulation
        if ((SimulationEngine.isRunning || SimulationEngine.getState()) && typeof NurseChat !== 'undefined') {
            this.sendNurseAcknowledgment(order, config);
        }

        // Refresh orders view if on that page
        if (window.location.hash === '#/orders') {
            Orders.render();
        }
    },

    /**
     * Send nurse acknowledgment for an order
     */
    sendNurseAcknowledgment(order, config) {
        let message = '';

        switch (this.selectedType) {
            case 'medication':
                const route = this.formData.route;
                const freq = this.formData.frequency;
                if (route === 'IV' || route === 'IV Push' || route === 'IV Piggyback') {
                    message = `Got it, I'll give the ${order.name} ${this.formData.dose} IV now. I'll let you know once it's in.`;
                } else if (freq === 'Once' || freq === 'STAT') {
                    message = `Understood. I'll give the ${order.name} ${this.formData.dose} ${route} right away.`;
                } else {
                    message = `Order received for ${order.name} ${this.formData.dose} ${route} ${freq}. I'll get that started.`;
                }
                break;

            case 'lab':
                const priority = this.formData.priority;
                if (priority === 'STAT') {
                    message = `I'll draw the ${order.name} STAT. Lab is usually pretty quick with those - maybe 15-20 minutes for results.`;
                } else {
                    message = `Got it, I'll get the ${order.name} drawn. Should have results in about an hour.`;
                }
                break;

            case 'imaging':
                const studyType = `${this.formData.modality} ${this.formData.bodyPart}`;
                if (this.formData.priority === 'STAT') {
                    message = `I'm calling radiology now for the STAT ${studyType}. They said they'll be up in about 10-15 minutes for the portable.`;
                } else {
                    message = `I'll put in the request for the ${studyType}. I'll let you know when they take the patient.`;
                }
                break;

            case 'nursing':
                message = `Noted - I'll update the care plan for ${this.formData.details}. Anything else you need?`;
                break;

            case 'consult':
                message = `I'll page ${this.formData.specialty} for you. Usually takes them about 30 minutes to an hour to respond.`;
                break;

            default:
                message = `Order received. I'll take care of that.`;
        }

        // Add the acknowledgment to nurse chat after a short delay
        setTimeout(() => {
            if (typeof NurseChat !== 'undefined' && typeof AIPanel !== 'undefined') {
                NurseChat.messages.push({ role: 'assistant', content: message });
                NurseChat.saveHistory();

                // Update UI if visible
                const container = document.getElementById('nurse-messages');
                if (container) {
                    const welcome = container.querySelector('.chat-welcome');
                    if (welcome) welcome.remove();
                    AIPanel.addMessage('nurse', 'assistant', message);
                }
            }
        }, 1500); // 1.5 second delay to feel more natural
    },

    /**
     * Build order details string
     */
    buildOrderDetails() {
        const parts = [];

        if (this.formData.dose) parts.push(this.formData.dose);
        if (this.formData.route) parts.push(this.formData.route);
        if (this.formData.frequency) parts.push(this.formData.frequency);
        if (this.formData.duration) parts.push(this.formData.duration);
        if (this.formData.specimen) parts.push(this.formData.specimen);
        if (this.formData.contrast) parts.push(this.formData.contrast);
        if (this.formData.details) parts.push(this.formData.details);

        return parts.join(', ');
    },

    /**
     * Parse dose string to numeric value
     */
    parseDose(doseString) {
        if (!doseString) return null;
        const match = doseString.match(/(\d+(?:\.\d+)?)/);
        return match ? parseFloat(match[1]) : null;
    }
};

window.OrderEntry = OrderEntry;
