/**
 * Date utilities for EHR display
 */

const DateUtils = {
    /**
     * Format date for display (e.g., "Jan 15, 2024")
     */
    formatDate(dateString) {
        if (!dateString) return '';
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        });
    },

    /**
     * Format date and time (e.g., "Jan 15, 2024 2:30 PM")
     */
    formatDateTime(dateString) {
        if (!dateString) return '';
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });
    },

    /**
     * Format time only (e.g., "2:30 PM")
     */
    formatTime(dateString) {
        if (!dateString) return '';
        const date = new Date(dateString);
        return date.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });
    },

    /**
     * Format date in short form (e.g., "01/15/24")
     */
    formatShortDate(dateString) {
        if (!dateString) return '';
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', {
            month: '2-digit',
            day: '2-digit',
            year: '2-digit'
        });
    },

    /**
     * Calculate age from date of birth
     */
    calculateAge(dob) {
        if (!dob) return '';
        const birthDate = new Date(dob);
        const today = new Date();
        let age = today.getFullYear() - birthDate.getFullYear();
        const monthDiff = today.getMonth() - birthDate.getMonth();
        if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
            age--;
        }
        return age;
    },

    /**
     * Get relative time (e.g., "2 hours ago", "3 days ago")
     */
    getRelativeTime(dateString) {
        if (!dateString) return '';
        const date = new Date(dateString);
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return `${diffMins} min ago`;
        if (diffHours < 24) return `${diffHours} hours ago`;
        if (diffDays < 7) return `${diffDays} days ago`;
        if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
        if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
        return `${Math.floor(diffDays / 365)} years ago`;
    },

    /**
     * Check if date is within range
     */
    isWithinDays(dateString, days) {
        if (!dateString) return false;
        const date = new Date(dateString);
        const now = new Date();
        const diffMs = now - date;
        const diffDays = diffMs / 86400000;
        return diffDays <= days;
    },

    /**
     * Parse date range string (e.g., "last7days", "last30days")
     */
    getDateRange(rangeString) {
        const now = new Date();
        let startDate = new Date();

        switch (rangeString) {
            case 'today':
                startDate.setHours(0, 0, 0, 0);
                break;
            case 'last7days':
                startDate.setDate(now.getDate() - 7);
                break;
            case 'last30days':
                startDate.setDate(now.getDate() - 30);
                break;
            case 'last90days':
                startDate.setDate(now.getDate() - 90);
                break;
            case 'last6months':
                startDate.setMonth(now.getMonth() - 6);
                break;
            case 'last1year':
                startDate.setFullYear(now.getFullYear() - 1);
                break;
            case 'last2years':
                startDate.setFullYear(now.getFullYear() - 2);
                break;
            case 'all':
            default:
                startDate = new Date(1900, 0, 1);
        }

        return { startDate, endDate: now };
    },

    /**
     * Filter array by date range
     */
    filterByDateRange(items, dateField, rangeString) {
        const { startDate, endDate } = this.getDateRange(rangeString);
        return items.filter(item => {
            const itemDate = new Date(item[dateField]);
            return itemDate >= startDate && itemDate <= endDate;
        });
    },

    /**
     * Sort array by date (newest first by default)
     */
    sortByDate(items, dateField, ascending = false) {
        return [...items].sort((a, b) => {
            const dateA = new Date(a[dateField]);
            const dateB = new Date(b[dateField]);
            return ascending ? dateA - dateB : dateB - dateA;
        });
    },

    /**
     * Group items by date (for timeline views)
     */
    groupByDate(items, dateField) {
        const groups = {};
        items.forEach(item => {
            const date = this.formatDate(item[dateField]);
            if (!groups[date]) {
                groups[date] = [];
            }
            groups[date].push(item);
        });
        return groups;
    },

    /**
     * Get current time string for header
     */
    getCurrentTimeString() {
        return new Date().toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            second: '2-digit',
            hour12: true
        });
    }
};

window.DateUtils = DateUtils;
