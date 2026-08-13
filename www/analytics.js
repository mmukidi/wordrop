/**
 * analytics.js
 * Privacy-respecting, anonymous event analytics for Wordrop.
 *
 * - All events stored locally (no external servers)
 * - No user IDs, device IDs, or cross-app tracking
 * - Anonymous timestamps and game data only
 * - Batch export for analysis
 * - Per privacy policy: event-level, not identity-linked
 */

const EVENTS_STORAGE_KEY = "wordrop_analytics_events";
const MAX_STORED_EVENTS = 500; // Keep last 500 events

export const analytics = {
    /**
     * Track a game event. Privacy-respecting: no user ID, device ID, or PII.
     * @param {string} event - Event name (game_started, word_cleared, etc.)
     * @param {object} data - Event data (score, level, word length, etc.)
     */
    track(event, data = {}) {
        if (!event) return;

        const entry = {
            event,
            timestamp: new Date().toISOString(),
            ...data
        };

        // Get existing events from localStorage
        let events = [];
        try {
            const stored = localStorage.getItem(EVENTS_STORAGE_KEY);
            if (stored) events = JSON.parse(stored);
        } catch (e) {
            console.error("Failed to read analytics events:", e);
            return;
        }

        // Add new event
        events.push(entry);

        // Trim to max stored events (keep newest)
        if (events.length > MAX_STORED_EVENTS) {
            events = events.slice(-MAX_STORED_EVENTS);
        }

        // Save back to localStorage
        try {
            localStorage.setItem(EVENTS_STORAGE_KEY, JSON.stringify(events));
        } catch (e) {
            console.error("Failed to save analytics event:", e);
        }
    },

    /**
     * Get all stored events for export/analysis
     * @returns {Array} Array of event objects
     */
    getAllEvents() {
        try {
            const stored = localStorage.getItem(EVENTS_STORAGE_KEY);
            return stored ? JSON.parse(stored) : [];
        } catch (e) {
            console.error("Failed to read analytics events:", e);
            return [];
        }
    },

    /**
     * Clear all stored events (for testing or reset)
     */
    clearEvents() {
        try {
            localStorage.removeItem(EVENTS_STORAGE_KEY);
        } catch (e) {
            console.error("Failed to clear analytics events:", e);
        }
    },

    /**
     * Export events as JSON (for debugging or external analysis)
     * @returns {string} JSON string of all events
     */
    exportJSON() {
        return JSON.stringify(this.getAllEvents(), null, 2);
    },

    /**
     * Export events as CSV (for spreadsheet analysis)
     * @returns {string} CSV formatted events
     */
    exportCSV() {
        const events = this.getAllEvents();
        if (events.length === 0) return "";

        // Get all unique keys across all events
        const allKeys = new Set();
        events.forEach(evt => {
            Object.keys(evt).forEach(key => allKeys.add(key));
        });

        const keys = Array.from(allKeys);
        const headers = keys.join(",");
        const rows = events.map(evt =>
            keys.map(key => {
                const val = evt[key];
                if (val === undefined || val === null) return "";
                if (typeof val === "string") return `"${val.replace(/"/g, '""')}"`;
                return val;
            }).join(",")
        );

        return [headers, ...rows].join("\n");
    },

    /**
     * Get summary stats (for dashboard/debugging)
     * @returns {object} Summary stats
     */
    getSummary() {
        const events = this.getAllEvents();
        if (events.length === 0) {
            return { total_events: 0, events_by_type: {} };
        }

        const summary = {
            total_events: events.length,
            events_by_type: {},
            date_range: {
                first: events[0].timestamp,
                last: events[events.length - 1].timestamp
            }
        };

        events.forEach(evt => {
            summary.events_by_type[evt.event] =
                (summary.events_by_type[evt.event] || 0) + 1;
        });

        return summary;
    },

    /**
     * Get last N games (for recent activity)
     * @param {number} count - Number of games to return
     * @returns {Array} Array of game sessions
     */
    getRecentGames(count = 10) {
        const events = this.getAllEvents();
        const games = [];
        let currentGame = null;

        // Build games from events
        events.forEach(evt => {
            if (evt.event === "game_started") {
                if (currentGame) games.push(currentGame);
                currentGame = {
                    started_at: evt.timestamp,
                    mode: evt.mode || "endless",
                    level: evt.level || 1,
                    events: []
                };
            } else if (currentGame) {
                currentGame.events.push(evt);
                if (evt.event === "game_over") {
                    currentGame.final_score = evt.final_score;
                    currentGame.final_level = evt.final_level;
                    currentGame.words_cleared = evt.words_cleared;
                }
            }
        });

        if (currentGame) games.push(currentGame);

        return games.slice(-count);
    }
};
