/**
 * Global Search Component
 * Provides search across all patient data
 */

const GlobalSearch = {
    isOpen: false,
    results: [],
    selectedIndex: -1,

    /**
     * Initialize global search
     */
    init() {
        // Add search modal to DOM
        this.createSearchModal();
        this.setupKeyboardShortcuts();
    },

    /**
     * Create search modal HTML
     */
    createSearchModal() {
        const modal = document.createElement('div');
        modal.id = 'global-search-modal';
        modal.className = 'search-modal';
        modal.innerHTML = `
            <div class="search-modal-backdrop" onclick="GlobalSearch.close()"></div>
            <div class="search-modal-content">
                <div class="search-modal-header">
                    <input type="text" id="global-search-input"
                           placeholder="Search notes, labs, medications, problems..."
                           autocomplete="off"
                           oninput="GlobalSearch.onSearch(this.value)"
                           onkeydown="GlobalSearch.onKeyDown(event)">
                    <button class="search-close-btn" onclick="GlobalSearch.close()">&times;</button>
                </div>
                <div class="search-modal-body" id="search-results-container">
                    <div class="search-hint">
                        <div>Type to search across all patient data</div>
                        <div class="search-shortcuts">
                            <span><kbd>↑</kbd><kbd>↓</kbd> Navigate</span>
                            <span><kbd>Enter</kbd> Select</span>
                            <span><kbd>Esc</kbd> Close</span>
                        </div>
                    </div>
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
            // Cmd/Ctrl + K to open search
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                e.preventDefault();
                this.toggle();
            }
            // Escape to close
            if (e.key === 'Escape' && this.isOpen) {
                this.close();
            }
        });
    },

    /**
     * Toggle search modal
     */
    toggle() {
        if (this.isOpen) {
            this.close();
        } else {
            this.open();
        }
    },

    /**
     * Open search modal
     */
    open() {
        const modal = document.getElementById('global-search-modal');
        if (!modal) return;

        modal.classList.add('active');
        this.isOpen = true;

        // Focus input
        const input = document.getElementById('global-search-input');
        if (input) {
            input.value = '';
            input.focus();
        }

        // Reset results
        this.results = [];
        this.selectedIndex = -1;
        document.getElementById('search-results-container').innerHTML = `
            <div class="search-hint">
                <div>Type to search across all patient data</div>
                <div class="search-shortcuts">
                    <span><kbd>↑</kbd><kbd>↓</kbd> Navigate</span>
                    <span><kbd>Enter</kbd> Select</span>
                    <span><kbd>Esc</kbd> Close</span>
                </div>
            </div>
        `;
    },

    /**
     * Close search modal
     */
    close() {
        const modal = document.getElementById('global-search-modal');
        if (modal) {
            modal.classList.remove('active');
        }
        this.isOpen = false;
    },

    /**
     * Handle search input
     */
    onSearch(query) {
        if (!query || query.length < 2) {
            document.getElementById('search-results-container').innerHTML = `
                <div class="search-hint">
                    <div>Type at least 2 characters to search</div>
                </div>
            `;
            this.results = [];
            return;
        }

        // Perform search
        this.results = SearchUtils.search(query, { limit: 30 });
        this.selectedIndex = -1;
        this.renderResults();
    },

    /**
     * Render search results
     */
    renderResults() {
        const container = document.getElementById('search-results-container');

        if (this.results.length === 0) {
            container.innerHTML = `
                <div class="search-no-results">
                    <div class="empty-state-icon">&#128269;</div>
                    <div>No results found</div>
                </div>
            `;
            return;
        }

        // Group results by category
        const grouped = {};
        this.results.forEach(result => {
            if (!grouped[result.category]) {
                grouped[result.category] = [];
            }
            grouped[result.category].push(result);
        });

        const categoryNames = {
            notes: 'Clinical Notes',
            labs: 'Laboratory Results',
            medications: 'Medications',
            problems: 'Problem List',
            encounters: 'Encounters'
        };

        const categoryIcons = {
            notes: '&#128196;',
            labs: '&#128300;',
            medications: '&#128138;',
            problems: '&#9733;',
            encounters: '&#128197;'
        };

        let html = '';
        let globalIndex = 0;

        Object.entries(grouped).forEach(([category, items]) => {
            html += `
                <div class="search-category">
                    <div class="search-category-header">
                        <span class="search-category-icon">${categoryIcons[category]}</span>
                        ${categoryNames[category]} (${items.length})
                    </div>
                    <div class="search-category-items">
            `;

            items.slice(0, 10).forEach((item, index) => {
                const isSelected = globalIndex === this.selectedIndex;
                html += `
                    <div class="search-result-item ${isSelected ? 'selected' : ''}"
                         data-index="${globalIndex}"
                         onclick="GlobalSearch.selectResult(${globalIndex})"
                         onmouseenter="GlobalSearch.setSelected(${globalIndex})">
                        <div class="search-result-title">${this.highlightMatch(item.title)}</div>
                        <div class="search-result-meta">
                            <span class="search-result-type">${item.subtype}</span>
                            ${item.date ? `<span class="search-result-date">${DateUtils.formatDate(item.date)}</span>` : ''}
                        </div>
                        ${item.preview ? `<div class="search-result-preview">${item.preview.substring(0, 80)}...</div>` : ''}
                        ${item.details ? `<div class="search-result-details">${item.details}</div>` : ''}
                    </div>
                `;
                globalIndex++;
            });

            html += '</div></div>';
        });

        container.innerHTML = html;
    },

    /**
     * Highlight matching text
     */
    highlightMatch(text) {
        const input = document.getElementById('global-search-input');
        if (!input || !input.value) return text;

        const query = input.value.toLowerCase();
        const textLower = text.toLowerCase();
        const index = textLower.indexOf(query);

        if (index === -1) return text;

        return text.substring(0, index) +
               '<mark>' + text.substring(index, index + query.length) + '</mark>' +
               text.substring(index + query.length);
    },

    /**
     * Handle keyboard navigation
     */
    onKeyDown(event) {
        switch (event.key) {
            case 'ArrowDown':
                event.preventDefault();
                this.setSelected(Math.min(this.selectedIndex + 1, this.results.length - 1));
                break;
            case 'ArrowUp':
                event.preventDefault();
                this.setSelected(Math.max(this.selectedIndex - 1, 0));
                break;
            case 'Enter':
                event.preventDefault();
                if (this.selectedIndex >= 0) {
                    this.selectResult(this.selectedIndex);
                }
                break;
        }
    },

    /**
     * Set selected result index
     */
    setSelected(index) {
        this.selectedIndex = index;

        // Update visual selection
        document.querySelectorAll('.search-result-item').forEach((el, i) => {
            el.classList.toggle('selected', parseInt(el.dataset.index) === index);
        });

        // Scroll into view
        const selectedEl = document.querySelector(`.search-result-item[data-index="${index}"]`);
        if (selectedEl) {
            selectedEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    },

    /**
     * Select and navigate to a result
     */
    selectResult(index) {
        const result = this.results[index];
        if (!result) return;

        this.close();

        // Navigate based on result type
        switch (result.category) {
            case 'notes':
                router.navigate('/notes', { noteId: result.id });
                break;
            case 'labs':
                router.navigate('/labs', { panelId: result.id });
                break;
            case 'medications':
                router.navigate('/medications');
                break;
            case 'problems':
                router.navigate('/problems');
                break;
            case 'encounters':
                router.navigate('/encounters', { encounterId: result.id });
                break;
        }
    }
};

window.GlobalSearch = GlobalSearch;
