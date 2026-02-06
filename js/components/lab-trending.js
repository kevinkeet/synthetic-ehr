/**
 * Lab Trending Component
 * Displays lab trends over time with charts
 */

const LabTrending = {
    chart: null,
    selectedTest: null,
    allLabs: [],

    /**
     * Render test selector for trending view
     */
    renderTrendingSelector(labs) {
        this.allLabs = labs;

        // Get unique test names with counts
        const testCounts = {};
        labs.forEach(lab => {
            testCounts[lab.name] = (testCounts[lab.name] || 0) + 1;
        });

        // Sort by count (most frequent first)
        const sortedTests = Object.entries(testCounts)
            .sort((a, b) => b[1] - a[1])
            .map(([name, count]) => ({ name, count }));

        return `
            <div style="display: flex; gap: 20px;">
                <div style="width: 250px; flex-shrink: 0;">
                    <div class="card">
                        <div class="card-header">
                            <span class="card-title">Select Test</span>
                        </div>
                        <div class="card-body" style="padding: 0; max-height: 400px; overflow-y: auto;">
                            ${sortedTests.map(test => `
                                <div class="trend-test-item ${this.selectedTest === test.name ? 'selected' : ''}"
                                     data-test="${test.name}"
                                     onclick="LabTrending.selectTest('${test.name.replace(/'/g, "\\'")}', LabTrending.allLabs)"
                                     style="padding: 10px 16px; cursor: pointer; border-bottom: 1px solid #e2e8f0;
                                            ${this.selectedTest === test.name ? 'background: #bee3f8;' : ''}">
                                    <div style="font-weight: 500;">${test.name}</div>
                                    <div style="font-size: 11px; color: #666;">${test.count} result${test.count > 1 ? 's' : ''}</div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                </div>
                <div style="flex: 1;">
                    <div id="trending-chart-container">
                        <div class="empty-state">
                            <div class="empty-state-icon">&#128200;</div>
                            <div class="empty-state-text">Select a test to view trending data</div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    },

    /**
     * Select a test and show its trend
     */
    selectTest(testName, labs) {
        this.selectedTest = testName;
        this.allLabs = labs || this.allLabs;

        // Update selected state
        document.querySelectorAll('.trend-test-item').forEach(item => {
            const isSelected = item.dataset.test === testName;
            item.style.background = isSelected ? '#bee3f8' : '';
            item.classList.toggle('selected', isSelected);
        });

        // Get trending data
        const trendData = LabUtils.getTrendingData(this.allLabs, testName, 50);

        if (trendData.length === 0) {
            document.getElementById('trending-chart-container').innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">&#128300;</div>
                    <div class="empty-state-text">No data available for ${testName}</div>
                </div>
            `;
            return;
        }

        // Get reference range
        const ref = LabUtils.referenceRanges[testName];
        const unit = LabUtils.getUnit(testName);

        // Render chart and data table
        document.getElementById('trending-chart-container').innerHTML = `
            <div class="card">
                <div class="card-header">
                    <span class="card-title">${testName} Trend</span>
                    <span style="font-size: 12px; color: #666;">
                        ${trendData.length} results |
                        ${ref ? `Normal: ${ref.range[0]}-${ref.range[1]} ${unit}` : ''}
                    </span>
                </div>
                <div class="card-body">
                    <div class="chart-container">
                        <canvas id="trend-chart"></canvas>
                    </div>
                </div>
            </div>
            <div class="card" style="margin-top: 16px;">
                <div class="card-header">
                    <span class="card-title">Historical Values</span>
                </div>
                <div class="card-body" style="padding: 0;">
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>Date</th>
                                <th>Value</th>
                                <th>Flag</th>
                                <th>Change</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${trendData.slice().reverse().map((point, index, arr) => {
                                const flag = point.flag;
                                const valueClass = LabUtils.getValueClass(flag);
                                const flagText = LabUtils.getFlagText(flag);
                                const flagClass = LabUtils.getFlagClass(flag);

                                // Calculate change from previous
                                let change = '';
                                if (index < arr.length - 1) {
                                    const prev = arr[index + 1].value;
                                    const diff = point.value - prev;
                                    const pctChange = ((diff / prev) * 100).toFixed(1);
                                    if (diff > 0) {
                                        change = `<span style="color: #c53030;">+${diff.toFixed(1)} (+${pctChange}%)</span>`;
                                    } else if (diff < 0) {
                                        change = `<span style="color: #38a169;">${diff.toFixed(1)} (${pctChange}%)</span>`;
                                    } else {
                                        change = '<span style="color: #666;">No change</span>';
                                    }
                                }

                                return `
                                    <tr>
                                        <td>${DateUtils.formatDateTime(point.date)}</td>
                                        <td>
                                            <span class="lab-value ${valueClass}">${point.value}</span>
                                            <span class="reference-range">${unit}</span>
                                        </td>
                                        <td>
                                            ${flag ? `<span class="lab-flag ${flagClass}">${flagText}</span>` : '-'}
                                        </td>
                                        <td style="font-size: 11px;">${change || '-'}</td>
                                    </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;

        // Render chart
        this.renderChart(testName, trendData, ref);
    },

    /**
     * Render Chart.js line chart
     */
    renderChart(testName, trendData, ref) {
        const ctx = document.getElementById('trend-chart')?.getContext('2d');
        if (!ctx) return;

        // Destroy existing chart
        if (this.chart) {
            this.chart.destroy();
        }

        const labels = trendData.map(d => DateUtils.formatShortDate(d.date));
        const values = trendData.map(d => d.value);

        // Determine colors based on flags
        const pointColors = trendData.map(d => {
            if (d.flag === 'critical-high' || d.flag === 'critical-low') return '#c53030';
            if (d.flag === 'high') return '#dd6b20';
            if (d.flag === 'low') return '#3182ce';
            return '#38a169';
        });

        const datasets = [
            {
                label: testName,
                data: values,
                borderColor: '#2c5282',
                backgroundColor: 'rgba(44, 82, 130, 0.1)',
                pointBackgroundColor: pointColors,
                pointBorderColor: pointColors,
                pointRadius: 6,
                pointHoverRadius: 8,
                fill: true,
                tension: 0.1
            }
        ];

        // Add reference range lines if available
        const annotations = {};
        if (ref) {
            annotations.lowLine = {
                type: 'line',
                yMin: ref.range[0],
                yMax: ref.range[0],
                borderColor: '#38a169',
                borderWidth: 1,
                borderDash: [5, 5],
                label: {
                    display: true,
                    content: `Low: ${ref.range[0]}`,
                    position: 'start'
                }
            };
            annotations.highLine = {
                type: 'line',
                yMin: ref.range[1],
                yMax: ref.range[1],
                borderColor: '#38a169',
                borderWidth: 1,
                borderDash: [5, 5],
                label: {
                    display: true,
                    content: `High: ${ref.range[1]}`,
                    position: 'start'
                }
            };
        }

        this.chart = new Chart(ctx, {
            type: 'line',
            data: { labels, datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        callbacks: {
                            label: (context) => {
                                const value = context.raw;
                                const flag = trendData[context.dataIndex].flag;
                                let label = `${testName}: ${value}`;
                                if (flag) {
                                    label += ` (${LabUtils.getFlagText(flag)})`;
                                }
                                return label;
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: false,
                        title: {
                            display: true,
                            text: LabUtils.getUnit(testName) || 'Value'
                        }
                    },
                    x: {
                        title: {
                            display: true,
                            text: 'Date'
                        }
                    }
                }
            }
        });
    }
};

window.LabTrending = LabTrending;
