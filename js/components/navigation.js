/**
 * Navigation Component
 * Handles sidebar navigation and patient search
 */

const Navigation = {
    /**
     * Initialize navigation
     */
    init() {
        this.setupNavClickHandlers();
        this.setupPatientSearch();
    },

    /**
     * Setup click handlers for nav items
     */
    setupNavClickHandlers() {
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                // Update active state
                document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
                item.classList.add('active');
            });
        });
    },

    /**
     * Setup patient search functionality
     */
    setupPatientSearch() {
        const searchInput = document.getElementById('patient-search');
        const searchResults = document.getElementById('search-results');

        if (!searchInput || !searchResults) return;

        let debounceTimer;

        searchInput.addEventListener('input', (e) => {
            clearTimeout(debounceTimer);
            const query = e.target.value.trim();

            if (query.length < 2) {
                searchResults.classList.remove('active');
                return;
            }

            debounceTimer = setTimeout(() => {
                this.searchPatients(query);
            }, 300);
        });

        searchInput.addEventListener('focus', () => {
            if (searchInput.value.trim().length >= 2) {
                searchResults.classList.add('active');
            }
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!searchInput.contains(e.target) && !searchResults.contains(e.target)) {
                searchResults.classList.remove('active');
            }
        });
    },

    /**
     * Search patients
     */
    async searchPatients(query) {
        const searchResults = document.getElementById('search-results');

        try {
            const index = await dataLoader.loadPatientIndex();
            const queryLower = query.toLowerCase();

            const matches = index.patients.filter(p => {
                return p.name.toLowerCase().includes(queryLower) ||
                       p.mrn.includes(query) ||
                       (p.dob && p.dob.includes(query));
            });

            if (matches.length === 0) {
                searchResults.innerHTML = `
                    <div class="search-result-item">
                        No patients found
                    </div>
                `;
            } else {
                searchResults.innerHTML = matches.map(p => `
                    <div class="search-result-item" data-patient-id="${p.id}">
                        <div><strong>${p.name}</strong></div>
                        <div style="font-size: 11px; color: #666;">
                            MRN: ${p.mrn} | DOB: ${p.dob}
                        </div>
                    </div>
                `).join('');

                // Add click handlers
                searchResults.querySelectorAll('.search-result-item[data-patient-id]').forEach(item => {
                    item.addEventListener('click', () => {
                        const patientId = item.dataset.patientId;
                        this.selectPatient(patientId);
                        searchResults.classList.remove('active');
                        document.getElementById('patient-search').value = '';
                    });
                });
            }

            searchResults.classList.add('active');
        } catch (error) {
            console.error('Error searching patients:', error);
            searchResults.innerHTML = `
                <div class="search-result-item">
                    Error searching patients
                </div>
            `;
            searchResults.classList.add('active');
        }
    },

    /**
     * Select a patient and load their chart
     */
    async selectPatient(patientId) {
        // Clear cache and load new patient
        dataLoader.clearCache();
        await PatientHeader.init(patientId);

        // Navigate to chart review
        router.navigate('/chart-review');
    },

    /**
     * Update active nav item
     */
    setActiveNav(section) {
        document.querySelectorAll('.nav-item').forEach(item => {
            const itemSection = item.dataset.section;
            item.classList.toggle('active', itemSection === section);
        });
    }
};

window.Navigation = Navigation;
