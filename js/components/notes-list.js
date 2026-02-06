/**
 * Notes List Component
 * Displays list of clinical notes with filtering
 */

const NotesList = {
    notes: [],
    filteredNotes: [],
    selectedNoteId: null,
    filters: {
        type: 'all',
        dateRange: 'all',
        search: ''
    },

    /**
     * Render the notes view
     */
    async render() {
        const content = document.getElementById('main-content');
        content.innerHTML = '<div class="loading">Loading notes...</div>';

        try {
            const notesIndex = await dataLoader.loadNotesIndex();
            this.notes = DateUtils.sortByDate(notesIndex.notes || [], 'date');
            this.filteredNotes = [...this.notes];

            content.innerHTML = `
                <div class="section-header">
                    <h1 class="section-title">Clinical Notes</h1>
                </div>

                <div class="notes-container">
                    <div class="notes-list">
                        <div class="notes-list-header">
                            <div class="notes-filter">
                                <select id="note-type-filter" onchange="NotesList.applyFilters()">
                                    <option value="all">All Types</option>
                                    <option value="Progress Note">Progress Note</option>
                                    <option value="H&P">H&P</option>
                                    <option value="Consult">Consult</option>
                                    <option value="Discharge Summary">Discharge Summary</option>
                                    <option value="Procedure Note">Procedure Note</option>
                                    <option value="Telephone Encounter">Telephone Encounter</option>
                                </select>
                                <select id="note-date-filter" onchange="NotesList.applyFilters()">
                                    <option value="all">All Time</option>
                                    <option value="last7days">Last 7 Days</option>
                                    <option value="last30days">Last 30 Days</option>
                                    <option value="last90days">Last 90 Days</option>
                                    <option value="last1year">Last Year</option>
                                </select>
                            </div>
                            <input type="text" id="note-search" placeholder="Search notes..."
                                   oninput="NotesList.applyFilters()">
                        </div>
                        <div class="notes-list-body" id="notes-list-body">
                            ${this.renderNotesList()}
                        </div>
                    </div>
                    <div class="note-viewer" id="note-viewer">
                        <div class="empty-state">
                            <div class="empty-state-icon">&#128196;</div>
                            <div class="empty-state-text">Select a note to view</div>
                        </div>
                    </div>
                </div>
            `;

            // Select first note by default if available
            if (this.filteredNotes.length > 0) {
                this.selectNote(this.filteredNotes[0].id);
            }
        } catch (error) {
            console.error('Error rendering notes:', error);
            content.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">&#9888;</div>
                    <div class="empty-state-text">Error loading notes</div>
                </div>
            `;
        }
    },

    /**
     * Render the notes list
     */
    renderNotesList() {
        if (this.filteredNotes.length === 0) {
            return `
                <div class="empty-state">
                    <div class="empty-state-text">No notes found</div>
                </div>
            `;
        }

        return this.filteredNotes.map(note => `
            <div class="note-list-item ${note.id === this.selectedNoteId ? 'selected' : ''}"
                 data-note-id="${note.id}"
                 onclick="NotesList.selectNote('${note.id}')">
                <div class="note-item-header">
                    <span class="note-type">${note.type}</span>
                    <span class="note-date">${DateUtils.formatDate(note.date)}</span>
                </div>
                <div class="note-author">${note.author} - ${note.department || ''}</div>
                <div class="note-preview">${note.preview || ''}</div>
            </div>
        `).join('');
    },

    /**
     * Apply filters to notes list
     */
    applyFilters() {
        const typeFilter = document.getElementById('note-type-filter')?.value || 'all';
        const dateFilter = document.getElementById('note-date-filter')?.value || 'all';
        const searchTerm = document.getElementById('note-search')?.value.toLowerCase() || '';

        this.filters = { type: typeFilter, dateRange: dateFilter, search: searchTerm };

        this.filteredNotes = this.notes.filter(note => {
            // Type filter
            if (typeFilter !== 'all' && note.type !== typeFilter) {
                return false;
            }

            // Date filter
            if (dateFilter !== 'all') {
                const { startDate } = DateUtils.getDateRange(dateFilter);
                if (new Date(note.date) < startDate) {
                    return false;
                }
            }

            // Search filter
            if (searchTerm) {
                const searchableText = `${note.type} ${note.author} ${note.preview || ''} ${note.department || ''}`.toLowerCase();
                if (!searchableText.includes(searchTerm)) {
                    return false;
                }
            }

            return true;
        });

        // Update list
        const listBody = document.getElementById('notes-list-body');
        if (listBody) {
            listBody.innerHTML = this.renderNotesList();
        }
    },

    /**
     * Select and display a note
     */
    async selectNote(noteId) {
        this.selectedNoteId = noteId;

        // Update selected state in list
        document.querySelectorAll('.note-list-item').forEach(item => {
            item.classList.toggle('selected', item.dataset.noteId === noteId);
        });

        // Load and display full note
        const viewer = document.getElementById('note-viewer');
        if (!viewer) return;

        viewer.innerHTML = '<div class="loading">Loading note...</div>';

        try {
            const note = await dataLoader.loadNote(noteId);
            NoteViewer.render(note, viewer);
        } catch (error) {
            console.error('Error loading note:', error);
            viewer.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">&#9888;</div>
                    <div class="empty-state-text">Error loading note</div>
                </div>
            `;
        }
    },

    /**
     * Get note count by type
     */
    getNoteCountByType() {
        const counts = {};
        this.notes.forEach(note => {
            counts[note.type] = (counts[note.type] || 0) + 1;
        });
        return counts;
    }
};

window.NotesList = NotesList;
