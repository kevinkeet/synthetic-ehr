/**
 * Router - Simple hash-based client-side routing
 */

class Router {
    constructor() {
        this.routes = {};
        this.currentRoute = null;
        this.currentParams = {};

        // Listen for hash changes
        window.addEventListener('hashchange', () => this.handleRoute());
    }

    /**
     * Register a route handler
     */
    on(path, handler) {
        this.routes[path] = handler;
        return this;
    }

    /**
     * Navigate to a route
     */
    navigate(path, params = {}) {
        let url = `#${path}`;
        if (Object.keys(params).length > 0) {
            const queryString = Object.entries(params)
                .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
                .join('&');
            url += `?${queryString}`;
        }
        window.location.hash = url;
    }

    /**
     * Parse the current hash URL
     */
    parseHash() {
        const hash = window.location.hash.slice(1) || '/chart-review';
        const [path, queryString] = hash.split('?');

        const params = {};
        if (queryString) {
            queryString.split('&').forEach(pair => {
                const [key, value] = pair.split('=');
                params[decodeURIComponent(key)] = decodeURIComponent(value || '');
            });
        }

        return { path: path || '/chart-review', params };
    }

    /**
     * Handle route change
     */
    handleRoute() {
        const { path, params } = this.parseHash();
        this.currentRoute = path;
        this.currentParams = params;

        // Update active nav item
        document.querySelectorAll('.nav-item').forEach(item => {
            const itemPath = item.getAttribute('href')?.slice(1);
            item.classList.toggle('active', itemPath === path);
        });

        // Find and execute route handler
        const handler = this.routes[path];
        if (handler) {
            handler(params);
        } else {
            // Try to find a pattern match (e.g., /notes/:id)
            for (const [pattern, routeHandler] of Object.entries(this.routes)) {
                const match = this.matchPattern(pattern, path);
                if (match) {
                    routeHandler({ ...params, ...match });
                    return;
                }
            }

            // 404 - route not found
            console.warn(`Route not found: ${path}`);
            this.showNotFound();
        }
    }

    /**
     * Match URL against pattern with params (e.g., /notes/:id)
     */
    matchPattern(pattern, path) {
        const patternParts = pattern.split('/');
        const pathParts = path.split('/');

        if (patternParts.length !== pathParts.length) {
            return null;
        }

        const params = {};
        for (let i = 0; i < patternParts.length; i++) {
            if (patternParts[i].startsWith(':')) {
                params[patternParts[i].slice(1)] = pathParts[i];
            } else if (patternParts[i] !== pathParts[i]) {
                return null;
            }
        }

        return params;
    }

    /**
     * Show 404 page
     */
    showNotFound() {
        const content = document.getElementById('main-content');
        content.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">&#128533;</div>
                <div class="empty-state-text">Page not found</div>
            </div>
        `;
    }

    /**
     * Initialize router and handle initial route
     */
    init() {
        // Set default route if none specified
        if (!window.location.hash) {
            window.location.hash = '#/chart-review';
        }
        this.handleRoute();
    }

    /**
     * Get current route info
     */
    getCurrentRoute() {
        return {
            path: this.currentRoute,
            params: this.currentParams
        };
    }
}

// Global instance
window.router = new Router();
