/**
 * Labs Table Component
 * Displays lab results with filtering, sorting, and abnormal flagging
 */

const LabsTable = {
    allLabs: [],
    filteredLabs: [],
    filters: {
        dateRange: 'all',
        panel: 'all',
        abnormalOnly: false,
        search: ''
    },
    sortField: 'collectedDate',
    sortAscending: false,
    selectedTest: null,

    /**
     * Render the labs view
     */
    async render() {
        const content = document.getElementById('main-content');
        content.innerHTML = '<div class="loading">Loading lab results...</div>';

        try {
            this.allLabs = await dataLoader.loadAllLabs();

            // Add simulated lab results if available
            const simLabs = DynamicLabs.getSimulatedLabs();
            if (simLabs && simLabs.length > 0) {
                // Convert simulated labs to the same format
                simLabs.forEach(simLab => {
                    if (simLab.results) {
                        simLab.results.forEach(result => {
                            this.allLabs.unshift({
                                ...result,
                                panelName: simLab.name,
                                collectedDate: simLab.collectedDate,
                                resultDate: simLab.resultDate,
                                isSimulated: true
                            });
                        });
                    }
                });
            }

            this.filteredLabs = DateUtils.sortByDate([...this.allLabs], 'collectedDate');

            // Get unique panel names for filter
            const panels = [...new Set(this.allLabs.map(l => l.panelName))].filter(Boolean);

            content.innerHTML = `
                <div class="section-header">
                    <h1 class="section-title">Laboratory Results</h1>
                    <div class="section-actions">
                        <span style="font-size: 12px; color: #666; margin-right: 12px;">
                            ${this.allLabs.length} total results
                        </span>
                        <button class="btn btn-small" onclick="App.exportSectionCSV('labs')">Export CSV</button>
                    </div>
                </div>

                <div class="filters-bar">
                    <div class="filter-group">
                        <label class="filter-label">Date Range</label>
                        <select class="filter-select" id="lab-date-filter" onchange="LabsTable.applyFilters()">
                            <option value="all">All Time</option>
                            <option value="last7days">Last 7 Days</option>
                            <option value="last30days">Last 30 Days</option>
                            <option value="last90days">Last 90 Days</option>
                            <option value="last6months">Last 6 Months</option>
                            <option value="last1year">Last Year</option>
                            <option value="last2years">Last 2 Years</option>
                        </select>
                    </div>
                    <div class="filter-group">
                        <label class="filter-label">Panel</label>
                        <select class="filter-select" id="lab-panel-filter" onchange="LabsTable.applyFilters()">
                            <option value="all">All Panels</option>
                            ${panels.map(p => `<option value="${p}">${p}</option>`).join('')}
                        </select>
                    </div>
                    <div class="filter-group">
                        <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
                            <input type="checkbox" id="lab-abnormal-filter" onchange="LabsTable.applyFilters()">
                            <span class="filter-label" style="margin: 0;">Abnormal Only</span>
                        </label>
                    </div>
                    <div class="filter-group" style="flex: 1;">
                        <input type="text" class="filter-input" id="lab-search"
                               placeholder="Search tests..."
                               style="width: 100%;"
                               oninput="LabsTable.applyFilters()">
                    </div>
                </div>

                <div class="tabs">
                    <div class="tab active" data-tab="table" onclick="LabsTable.switchTab('table')">Table View</div>
                    <div class="tab" data-tab="trending" onclick="LabsTable.switchTab('trending')">Trending</div>
                </div>

                <div id="labs-table-content" class="tab-content active">
                    ${this.renderTable()}
                </div>

                <div id="labs-trending-content" class="tab-content">
                    ${LabTrending.renderTrendingSelector(this.allLabs)}
                </div>
            `;
        } catch (error) {
            console.error('Error rendering labs:', error);
            content.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">&#9888;</div>
                    <div class="empty-state-text">Error loading lab results</div>
                </div>
            `;
        }
    },

    /**
     * Render the labs table
     */
    renderTable() {
        if (this.filteredLabs.length === 0) {
            return `
                <div class="empty-state">
                    <div class="empty-state-icon">&#128300;</div>
                    <div class="empty-state-text">No lab results found</div>
                </div>
            `;
        }

        return `
            <div style="overflow-x: auto;">
                <table class="data-table">
                    <thead>
                        <tr>
                            <th style="cursor: pointer;" onclick="LabsTable.sort('collectedDate')">
                                Date ${this.getSortIndicator('collectedDate')}
                            </th>
                            <th style="cursor: pointer;" onclick="LabsTable.sort('name')">
                                Test ${this.getSortIndicator('name')}
                            </th>
                            <th>Result</th>
                            <th>Units</th>
                            <th>Reference Range</th>
                            <th>Flag</th>
                            <th style="cursor: pointer;" onclick="LabsTable.sort('panelName')">
                                Panel ${this.getSortIndicator('panelName')}
                            </th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${this.filteredLabs.slice(0, 100).map(lab => this.renderLabRow(lab)).join('')}
                    </tbody>
                </table>
            </div>
            ${this.filteredLabs.length > 100 ? `
                <div style="text-align: center; padding: 16px; color: #666; font-size: 12px;">
                    Showing 100 of ${this.filteredLabs.length} results. Use filters to narrow down.
                </div>
            ` : ''}
        `;
    },

    /**
     * Render a single lab row
     */
    renderLabRow(lab) {
        const flag = lab.flag || LabUtils.getFlag(lab.name, lab.value);
        const valueClass = LabUtils.getValueClass(flag);
        const flagText = lab.flag || LabUtils.getFlagText(flag);
        const flagClass = LabUtils.getFlagClass(flag);
        const refRange = lab.referenceRange || LabUtils.getReferenceRange(lab.name);
        const unit = lab.unit || LabUtils.getUnit(lab.name);

        const simClass = lab.isSimulated ? 'sim-lab-row' : '';
        const simBadge = lab.isSimulated ? '<span class="sim-lab-badge">SIM</span>' : '';

        return `
            <tr class="clickable ${simClass}" onclick="LabsTable.showTrending('${lab.name}')">
                <td>
                    ${simBadge}
                    ${DateUtils.formatDateTime(lab.collectedDate)}
                </td>
                <td><strong>${lab.name}</strong></td>
                <td>
                    <span class="lab-value ${valueClass}">${lab.value}</span>
                </td>
                <td class="reference-range">${unit}</td>
                <td class="reference-range">${refRange}</td>
                <td>
                    ${flag ? `<span class="lab-flag ${flagClass}">${flagText}</span>` : '-'}
                </td>
                <td style="font-size: 11px; color: #666;">${lab.panelName || '-'}</td>
                <td>
                    <button class="btn btn-small" onclick="event.stopPropagation(); LabsTable.showTrending('${lab.name}')">
                        Trend
                    </button>
                </td>
            </tr>
        `;
    },

    /**
     * Apply filters
     */
    applyFilters() {
        const dateRange = document.getElementById('lab-date-filter')?.value || 'all';
        const panel = document.getElementById('lab-panel-filter')?.value || 'all';
        const abnormalOnly = document.getElementById('lab-abnormal-filter')?.checked || false;
        const search = document.getElementById('lab-search')?.value.toLowerCase() || '';

        this.filters = { dateRange, panel, abnormalOnly, search };

        this.filteredLabs = this.allLabs.filter(lab => {
            // Date filter
            if (dateRange !== 'all') {
                const { startDate } = DateUtils.getDateRange(dateRange);
                if (new Date(lab.collectedDate) < startDate) {
                    return false;
                }
            }

            // Panel filter
            if (panel !== 'all' && lab.panelName !== panel) {
                return false;
            }

            // Abnormal filter
            if (abnormalOnly) {
                const flag = LabUtils.getFlag(lab.name, lab.value);
                if (!flag) return false;
            }

            // Search filter
            if (search) {
                if (!lab.name.toLowerCase().includes(search)) {
                    return false;
                }
            }

            return true;
        });

        // Apply current sort
        this.filteredLabs = this.sortLabs(this.filteredLabs);

        // Update table
        const tableContent = document.getElementById('labs-table-content');
        if (tableContent) {
            tableContent.innerHTML = this.renderTable();
        }
    },

    /**
     * Sort labs by field
     */
    sort(field) {
        if (this.sortField === field) {
            this.sortAscending = !this.sortAscending;
        } else {
            this.sortField = field;
            this.sortAscending = field === 'name' || field === 'panelName';
        }

        this.filteredLabs = this.sortLabs(this.filteredLabs);

        const tableContent = document.getElementById('labs-table-content');
        if (tableContent) {
            tableContent.innerHTML = this.renderTable();
        }
    },

    /**
     * Sort labs array
     */
    sortLabs(labs) {
        return [...labs].sort((a, b) => {
            let comparison = 0;
            if (this.sortField === 'collectedDate') {
                comparison = new Date(a.collectedDate) - new Date(b.collectedDate);
            } else {
                const aVal = (a[this.sortField] || '').toString().toLowerCase();
                const bVal = (b[this.sortField] || '').toString().toLowerCase();
                comparison = aVal.localeCompare(bVal);
            }
            return this.sortAscending ? comparison : -comparison;
        });
    },

    /**
     * Get sort indicator
     */
    getSortIndicator(field) {
        if (this.sortField !== field) return '';
        return this.sortAscending ? ' &#9650;' : ' &#9660;';
    },

    /**
     * Switch between table and trending view
     */
    switchTab(tabName) {
        document.querySelectorAll('.tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.tab === tabName);
        });
        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.toggle('active', content.id === `labs-${tabName}-content`);
        });
    },

    /**
     * Show trending for a specific test
     */
    showTrending(testName) {
        this.switchTab('trending');
        LabTrending.selectTest(testName, this.allLabs);
    }
};

window.LabsTable = LabsTable;
