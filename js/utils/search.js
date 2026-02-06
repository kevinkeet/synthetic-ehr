/**
 * Search utilities for EHR data
 * Provides full-text search across patient data
 */

const SearchUtils = {
    // Search index cache
    searchIndex: null,

    /**
     * Initialize search index with patient data
     */
    async buildSearchIndex(patientId) {
        this.searchIndex = {
            notes: [],
            labs: [],
            medications: [],
            problems: [],
            encounters: []
        };

        try {
            // Index notes
            const notesIndex = await dataLoader.loadNotesIndex(patientId);
            this.searchIndex.notes = (notesIndex.notes || []).map(note => ({
                id: note.id,
                type: 'note',
                subtype: note.type,
                title: `${note.type} - ${note.author}`,
                date: note.date,
                searchText: `${note.type} ${note.author} ${note.department || ''} ${note.preview || ''}`.toLowerCase(),
                preview: note.preview
            }));

            // Index labs
            const labsIndex = await dataLoader.loadLabsIndex(patientId);
            this.searchIndex.labs = (labsIndex.panels || []).map(panel => ({
                id: panel.id,
                type: 'lab',
                subtype: panel.name,
                title: panel.name,
                date: panel.date,
                searchText: panel.name.toLowerCase()
            }));

            // Index medications
            const meds = await dataLoader.loadMedications(patientId);
            this.searchIndex.medications = [
                ...(meds.active.medications || []).map(med => ({
                    id: med.id,
                    type: 'medication',
                    subtype: 'active',
                    title: med.name,
                    searchText: `${med.name} ${med.genericName || ''} ${med.indication || ''}`.toLowerCase(),
                    details: `${med.dose} ${med.route} ${med.frequency}`
                })),
                ...(meds.historical.medications || []).map(med => ({
                    id: med.id,
                    type: 'medication',
                    subtype: 'historical',
                    title: med.name,
                    searchText: `${med.name} ${med.genericName || ''} ${med.indication || ''}`.toLowerCase(),
                    details: `${med.dose} ${med.route} ${med.frequency}`
                }))
            ];

            // Index problems
            const problems = await dataLoader.loadProblems(patientId);
            this.searchIndex.problems = [
                ...(problems.active.problems || []).map(prob => ({
                    id: prob.id,
                    type: 'problem',
                    subtype: 'active',
                    title: prob.name,
                    searchText: `${prob.name} ${prob.icd10 || ''} ${prob.notes || ''}`.toLowerCase(),
                    date: prob.onsetDate
                })),
                ...(problems.resolved.problems || []).map(prob => ({
                    id: prob.id,
                    type: 'problem',
                    subtype: 'resolved',
                    title: prob.name,
                    searchText: `${prob.name} ${prob.icd10 || ''} ${prob.notes || ''}`.toLowerCase(),
                    date: prob.onsetDate
                }))
            ];

            // Index encounters
            const encounters = await dataLoader.loadEncounters(patientId);
            this.searchIndex.encounters = (encounters.encounters || []).map(enc => ({
                id: enc.id,
                type: 'encounter',
                subtype: enc.type,
                title: `${enc.type} - ${enc.chiefComplaint}`,
                date: enc.date,
                searchText: `${enc.type} ${enc.chiefComplaint} ${enc.provider} ${enc.department || ''} ${(enc.diagnoses || []).join(' ')}`.toLowerCase()
            }));

            console.log('Search index built:', {
                notes: this.searchIndex.notes.length,
                labs: this.searchIndex.labs.length,
                medications: this.searchIndex.medications.length,
                problems: this.searchIndex.problems.length,
                encounters: this.searchIndex.encounters.length
            });

        } catch (error) {
            console.error('Error building search index:', error);
        }
    },

    /**
     * Search across all indexed data
     */
    search(query, options = {}) {
        if (!this.searchIndex || !query) return [];

        const queryLower = query.toLowerCase().trim();
        const queryTerms = queryLower.split(/\s+/);
        const results = [];

        // Search each category
        const categories = options.categories || ['notes', 'labs', 'medications', 'problems', 'encounters'];

        categories.forEach(category => {
            const items = this.searchIndex[category] || [];
            items.forEach(item => {
                // Check if all query terms match
                const matches = queryTerms.every(term => item.searchText.includes(term));
                if (matches) {
                    // Calculate relevance score
                    let score = 0;
                    queryTerms.forEach(term => {
                        if (item.title.toLowerCase().includes(term)) score += 10;
                        if (item.searchText.includes(term)) score += 1;
                    });

                    results.push({
                        ...item,
                        category,
                        score
                    });
                }
            });
        });

        // Sort by score descending, then by date descending
        results.sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            return new Date(b.date || 0) - new Date(a.date || 0);
        });

        // Limit results
        const limit = options.limit || 50;
        return results.slice(0, limit);
    },

    /**
     * Search within a specific category
     */
    searchCategory(query, category) {
        return this.search(query, { categories: [category] });
    },

    /**
     * Get search suggestions based on partial query
     */
    getSuggestions(query, limit = 10) {
        if (!query || query.length < 2) return [];

        const queryLower = query.toLowerCase();
        const suggestions = new Set();

        // Get unique terms from search index
        Object.values(this.searchIndex).flat().forEach(item => {
            if (item.title.toLowerCase().includes(queryLower)) {
                suggestions.add(item.title);
            }
            if (item.subtype && item.subtype.toLowerCase().includes(queryLower)) {
                suggestions.add(item.subtype);
            }
        });

        return Array.from(suggestions).slice(0, limit);
    }
};

window.SearchUtils = SearchUtils;
