/**
 * Orders Component
 * Displays active and historical orders
 */

const Orders = {
    /**
     * Render orders view
     */
    async render() {
        const content = document.getElementById('main-content');
        content.innerHTML = '<div class="loading">Loading orders...</div>';

        try {
            const data = await dataLoader.loadOrders();

            // Merge in user-submitted orders from sessionStorage
            const pendingOrders = JSON.parse(sessionStorage.getItem('pendingOrders') || '[]');
            const allActiveOrders = [...pendingOrders, ...(data.active || [])];

            const active = allActiveOrders.sort((a, b) => new Date(b.orderDate) - new Date(a.orderDate));
            const completed = (data.completed || []).sort((a, b) => new Date(b.orderDate) - new Date(a.orderDate));

            content.innerHTML = `
                <div class="section-header">
                    <h1 class="section-title">Orders</h1>
                    <div class="section-actions">
                        <button class="btn btn-primary" onclick="OrderEntry.open()">
                            <span style="margin-right: 6px;">&#43;</span> New Order
                        </button>
                    </div>
                </div>

                <div class="tabs">
                    <div class="tab active" data-tab="active" onclick="Orders.switchTab('active')">
                        Active Orders (${active.length})
                    </div>
                    <div class="tab" data-tab="completed" onclick="Orders.switchTab('completed')">
                        Completed (${completed.length})
                    </div>
                </div>

                <div id="orders-active-content" class="tab-content active">
                    ${this.renderOrdersList(active, 'active')}
                </div>

                <div id="orders-completed-content" class="tab-content">
                    ${this.renderOrdersList(completed, 'completed')}
                </div>
            `;
        } catch (error) {
            console.error('Error loading orders:', error);
            // Even if JSON load fails, still show any user-submitted orders
            const pendingOrders = JSON.parse(sessionStorage.getItem('pendingOrders') || '[]');
            if (pendingOrders.length > 0) {
                const active = pendingOrders.sort((a, b) => new Date(b.orderDate) - new Date(a.orderDate));
                content.innerHTML = `
                    <div class="section-header">
                        <h1 class="section-title">Orders</h1>
                        <div class="section-actions">
                            <button class="btn btn-primary" onclick="OrderEntry.open()">
                                <span style="margin-right: 6px;">&#43;</span> New Order
                            </button>
                        </div>
                    </div>
                    <div class="tabs">
                        <div class="tab active" data-tab="active">Active Orders (${active.length})</div>
                    </div>
                    <div id="orders-active-content" class="tab-content active">
                        ${this.renderOrdersList(active, 'active')}
                    </div>
                `;
            } else {
                content.innerHTML = `
                    <div class="section-header">
                        <h1 class="section-title">Orders</h1>
                        <div class="section-actions">
                            <button class="btn btn-primary" onclick="OrderEntry.open()">
                                <span style="margin-right: 6px;">&#43;</span> New Order
                            </button>
                        </div>
                    </div>
                    <div class="card">
                        <div class="card-body" style="text-align: center; padding: 40px;">
                            <div style="font-size: 48px; margin-bottom: 16px; opacity: 0.5;">&#128203;</div>
                            <div style="font-size: 16px; color: #666;">No orders on record</div>
                            <button class="btn btn-primary" style="margin-top: 16px;" onclick="OrderEntry.open()">
                                <span style="margin-right: 6px;">&#43;</span> Create First Order
                            </button>
                        </div>
                    </div>
                `;
            }
        }
    },

    /**
     * Render orders list
     */
    renderOrdersList(orders, type) {
        if (!orders || orders.length === 0) {
            return `
                <div class="empty-state">
                    <div class="empty-state-icon">&#128203;</div>
                    <div class="empty-state-text">No ${type} orders</div>
                </div>
            `;
        }

        return `
            <div class="card">
                <div class="card-body" style="padding: 0;">
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>Order Date</th>
                                <th>Category</th>
                                <th>Order</th>
                                <th>Priority</th>
                                <th>Ordering Provider</th>
                                <th>Status</th>
                                ${type === 'completed' ? '<th>Completed Date</th>' : ''}
                            </tr>
                        </thead>
                        <tbody>
                            ${orders.map(order => `
                                <tr>
                                    <td>${DateUtils.formatDateTime(order.orderDate)}</td>
                                    <td>
                                        <span class="order-category ${this.getCategoryClass(order.category)}">
                                            ${order.category}
                                        </span>
                                    </td>
                                    <td>
                                        <div style="font-weight: 500;">${order.name}</div>
                                        ${order.details ? `<div style="font-size: 11px; color: #666;">${order.details}</div>` : ''}
                                    </td>
                                    <td>
                                        <span class="${this.getPriorityClass(order.priority)}">
                                            ${order.priority || 'Routine'}
                                        </span>
                                    </td>
                                    <td style="font-size: 12px;">${order.orderedBy || '-'}</td>
                                    <td>
                                        <span class="problem-status ${order.status === 'Completed' ? 'resolved' : 'active'}">
                                            ${order.status}
                                        </span>
                                        ${order.id && order.id.startsWith('ORD_') ? '<span class="sim-badge" title="Submitted this session">NEW</span>' : ''}
                                    </td>
                                    ${type === 'completed' ? `<td>${DateUtils.formatDateTime(order.completedDate)}</td>` : ''}
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    },

    /**
     * Get CSS class for order category
     */
    getCategoryClass(category) {
        const classes = {
            'Lab': 'category-lab',
            'Imaging': 'category-imaging',
            'Medication': 'category-med',
            'Procedure': 'category-proc',
            'Consult': 'category-consult'
        };
        return classes[category] || '';
    },

    /**
     * Get CSS class for priority
     */
    getPriorityClass(priority) {
        if (priority === 'STAT' || priority === 'Urgent') {
            return 'priority-urgent';
        }
        return '';
    },

    /**
     * Switch tabs
     */
    switchTab(tabName) {
        document.querySelectorAll('.tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.tab === tabName);
        });
        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.toggle('active', content.id === `orders-${tabName}-content`);
        });
    }
};

window.Orders = Orders;
