/**
 * DataLoader - Handles fetching and caching of patient data from JSON files
 * Supports lazy loading for large datasets
 */

class DataLoader {
    constructor(basePath = 'data/patients') {
        this.basePath = basePath;
        this.cache = new Map();
        this.currentPatientId = null;
        this.patientIndex = null;
    }

    /**
     * Get the base URL for data files (handles GitHub Pages vs local)
     */
    getBaseUrl() {
        // Check if running on GitHub Pages
        if (window.location.hostname.includes('github.io')) {
            const pathParts = window.location.pathname.split('/');
            const repoName = pathParts[1];
            return `/${repoName}/${this.basePath}`;
        }
        return this.basePath;
    }

    /**
     * Fetch JSON with caching
     */
    async fetchJSON(path) {
        if (this.cache.has(path)) {
            return this.cache.get(path);
        }

        try {
            const response = await fetch(path);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            const data = await response.json();
            this.cache.set(path, data);
            return data;
        } catch (error) {
            console.error(`Error fetching ${path}:`, error);
            throw error;
        }
    }

    /**
     * Load patient index (list of all patients)
     */
    async loadPatientIndex() {
        if (this.patientIndex) {
            return this.patientIndex;
        }
        const baseUrl = this.getBaseUrl();
        this.patientIndex = await this.fetchJSON(`${baseUrl}/index.json`);
        return this.patientIndex;
    }

    /**
     * Load a specific patient's demographics
     */
    async loadPatient(patientId) {
        const baseUrl = this.getBaseUrl();
        this.currentPatientId = patientId;
        return await this.fetchJSON(`${baseUrl}/${patientId}/demographics.json`);
    }

    /**
     * Load allergies for current patient
     */
    async loadAllergies(patientId = this.currentPatientId) {
        const baseUrl = this.getBaseUrl();
        return await this.fetchJSON(`${baseUrl}/${patientId}/allergies.json`);
    }

    /**
     * Load notes index (metadata only, for list view)
     */
    async loadNotesIndex(patientId = this.currentPatientId) {
        const baseUrl = this.getBaseUrl();
        return await this.fetchJSON(`${baseUrl}/${patientId}/notes/index.json`);
    }

    /**
     * Load a specific note's full content
     */
    async loadNote(noteId, patientId = this.currentPatientId) {
        const baseUrl = this.getBaseUrl();
        return await this.fetchJSON(`${baseUrl}/${patientId}/notes/${noteId}.json`);
    }

    /**
     * Load labs index (metadata for filtering/pagination)
     */
    async loadLabsIndex(patientId = this.currentPatientId) {
        const baseUrl = this.getBaseUrl();
        return await this.fetchJSON(`${baseUrl}/${patientId}/labs/index.json`);
    }

    /**
     * Load a specific lab panel
     */
    async loadLabPanel(panelId, patientId = this.currentPatientId) {
        const baseUrl = this.getBaseUrl();
        return await this.fetchJSON(`${baseUrl}/${patientId}/labs/panels/${panelId}.json`);
    }

    /**
     * Load all lab results (flattened from panels)
     * For smaller datasets, can load all at once
     */
    async loadAllLabs(patientId = this.currentPatientId) {
        const index = await this.loadLabsIndex(patientId);
        const allResults = [];

        for (const panel of index.panels) {
            try {
                const panelData = await this.loadLabPanel(panel.id, patientId);
                for (const result of panelData.results) {
                    allResults.push({
                        ...result,
                        panelName: panelData.name,
                        panelId: panelData.id,
                        collectedDate: panelData.collectedDate,
                        orderedBy: panelData.orderedBy
                    });
                }
            } catch (e) {
                console.warn(`Could not load panel ${panel.id}:`, e);
            }
        }

        return allResults;
    }

    /**
     * Load medications (active and historical)
     */
    async loadMedications(patientId = this.currentPatientId) {
        const baseUrl = this.getBaseUrl();
        const [active, historical] = await Promise.all([
            this.fetchJSON(`${baseUrl}/${patientId}/medications/active.json`),
            this.fetchJSON(`${baseUrl}/${patientId}/medications/historical.json`)
        ]);
        return { active, historical };
    }

    /**
     * Load active medications only
     */
    async loadActiveMedications(patientId = this.currentPatientId) {
        const baseUrl = this.getBaseUrl();
        return await this.fetchJSON(`${baseUrl}/${patientId}/medications/active.json`);
    }

    /**
     * Load problems (active and resolved)
     */
    async loadProblems(patientId = this.currentPatientId) {
        const baseUrl = this.getBaseUrl();
        const [active, resolved] = await Promise.all([
            this.fetchJSON(`${baseUrl}/${patientId}/problems/active.json`),
            this.fetchJSON(`${baseUrl}/${patientId}/problems/resolved.json`)
        ]);
        return { active, resolved };
    }

    /**
     * Load active problems only
     */
    async loadActiveProblems(patientId = this.currentPatientId) {
        const baseUrl = this.getBaseUrl();
        return await this.fetchJSON(`${baseUrl}/${patientId}/problems/active.json`);
    }

    /**
     * Load vitals
     */
    async loadVitals(patientId = this.currentPatientId) {
        const baseUrl = this.getBaseUrl();
        return await this.fetchJSON(`${baseUrl}/${patientId}/vitals/index.json`);
    }

    /**
     * Load encounters
     */
    async loadEncounters(patientId = this.currentPatientId) {
        const baseUrl = this.getBaseUrl();
        return await this.fetchJSON(`${baseUrl}/${patientId}/encounters/index.json`);
    }

    /**
     * Load a specific encounter
     */
    async loadEncounter(encounterId, patientId = this.currentPatientId) {
        const baseUrl = this.getBaseUrl();
        return await this.fetchJSON(`${baseUrl}/${patientId}/encounters/${encounterId}.json`);
    }

    /**
     * Load imaging studies
     */
    async loadImaging(patientId = this.currentPatientId) {
        const baseUrl = this.getBaseUrl();
        return await this.fetchJSON(`${baseUrl}/${patientId}/imaging/index.json`);
    }

    /**
     * Load a specific imaging report
     */
    async loadImagingReport(studyId, patientId = this.currentPatientId) {
        const baseUrl = this.getBaseUrl();
        return await this.fetchJSON(`${baseUrl}/${patientId}/imaging/reports/${studyId}.json`);
    }

    /**
     * Load social history
     */
    async loadSocialHistory(patientId = this.currentPatientId) {
        const baseUrl = this.getBaseUrl();
        return await this.fetchJSON(`${baseUrl}/${patientId}/social_history.json`);
    }

    /**
     * Load family history
     */
    async loadFamilyHistory(patientId = this.currentPatientId) {
        const baseUrl = this.getBaseUrl();
        return await this.fetchJSON(`${baseUrl}/${patientId}/family_history.json`);
    }

    /**
     * Load immunizations
     */
    async loadImmunizations(patientId = this.currentPatientId) {
        const baseUrl = this.getBaseUrl();
        return await this.fetchJSON(`${baseUrl}/${patientId}/immunizations.json`);
    }

    /**
     * Load procedures
     */
    async loadProcedures(patientId = this.currentPatientId) {
        const baseUrl = this.getBaseUrl();
        return await this.fetchJSON(`${baseUrl}/${patientId}/procedures/index.json`);
    }

    /**
     * Load orders
     */
    async loadOrders(patientId = this.currentPatientId) {
        const baseUrl = this.getBaseUrl();
        return await this.fetchJSON(`${baseUrl}/${patientId}/orders/index.json`);
    }

    /**
     * Clear cache (useful for switching patients)
     */
    clearCache() {
        this.cache.clear();
    }

    /**
     * Clear cache for specific patient
     */
    clearPatientCache(patientId) {
        const baseUrl = this.getBaseUrl();
        const prefix = `${baseUrl}/${patientId}`;
        for (const key of this.cache.keys()) {
            if (key.startsWith(prefix)) {
                this.cache.delete(key);
            }
        }
    }
}

// Global instance
window.dataLoader = new DataLoader();
