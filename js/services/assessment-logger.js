/**
 * AssessmentLogger — captures every resident-facing AI interaction during
 * an active assessment attempt and writes it to `assessment_ai_log` in Supabase.
 *
 * Hook strategy: monkey-patch `ClaudeAPI.sendMessage` and `ClaudeAPI.chat`.
 * The grader bypasses logging by calling `ClaudeAPI._singleChat` directly.
 * Background AI memory builds (`parallelChat`) also use `_singleChat`, so they
 * don't pollute the resident's logged usage.
 *
 * Usage:
 *   AssessmentLogger.start({ attemptId, getActiveContext });
 *   ...resident takes the test...
 *   AssessmentLogger.stop();
 *
 *   getActiveContext is a function () => ({ assessmentId, promptId })
 *   so the logger can stamp each record with the current AP/prompt.
 */

const AssessmentLogger = (() => {
    let _active = false;
    let _attemptId = null;
    let _getContext = null;
    let _originalSendMessage = null;
    let _originalChat = null;
    let _queue = [];   // pending inserts (best-effort flush)
    let _flushTimer = null;

    const LOG = (...args) => console.log('🪵 AILog', ...args);
    const WARN = (...args) => console.warn('🪵 AILog', ...args);

    // ── helpers ────────────────────────────────────────────────────────

    function _supabase() {
        if (typeof SupabaseSync === 'undefined') return null;
        if (typeof SupabaseSync.getClient === 'function') return SupabaseSync.getClient();
        return SupabaseSync.client || null;
    }

    function _serializeMessages(messages) {
        // Compress to a readable string for storage.
        if (!messages) return '';
        if (typeof messages === 'string') return messages;
        if (!Array.isArray(messages)) {
            try { return JSON.stringify(messages); } catch (e) { return String(messages); }
        }
        return messages.map((m) => {
            const role = m.role || 'user';
            let content = m.content;
            if (Array.isArray(content)) {
                content = content.map((c) =>
                    typeof c === 'string'
                        ? c
                        : (c.text || c.input || JSON.stringify(c))
                ).join('\n');
            }
            return `[${role}]\n${content || ''}`;
        }).join('\n\n');
    }

    function _extractResponseText(response) {
        // ClaudeAPI.sendMessage returns the raw API response object.
        // ClaudeAPI.chat returns just the text string.
        if (!response) return '';
        if (typeof response === 'string') return response;
        if (response.content && Array.isArray(response.content)) {
            return response.content
                .filter((c) => c && c.type === 'text')
                .map((c) => c.text)
                .join('\n');
        }
        return '';
    }

    function _activeChartSections() {
        if (typeof AssessmentChartGate !== 'undefined' && AssessmentChartGate.getVisibleSections) {
            return AssessmentChartGate.getVisibleSections();
        }
        return [];
    }

    // ── persistence ────────────────────────────────────────────────────

    async function _writeRow(row) {
        const sb = _supabase();
        if (!sb) {
            // Queue for later; if a session restarts, we accept the loss
            // (these are observational, not gate-critical).
            _queue.push(row);
            return;
        }
        try {
            const { error } = await sb.from('assessment_ai_log').insert(row);
            if (error) WARN('insert error:', error.message);
        } catch (err) {
            WARN('insert exception:', err.message);
            _queue.push(row);
        }
    }

    function _scheduleFlush() {
        if (_flushTimer) return;
        _flushTimer = setTimeout(() => {
            _flushTimer = null;
            const pending = _queue.slice();
            _queue = [];
            pending.forEach(_writeRow);
        }, 1500);
    }

    // ── public log methods ─────────────────────────────────────────────

    /**
     * Manually log a chart-view (called from router or component hooks).
     */
    function logChartView(section) {
        if (!_active || !_attemptId) return;
        const ctx = _safeGetContext();
        _writeRow({
            attempt_id: _attemptId,
            assessment_id: ctx.assessmentId || null,
            prompt_id: ctx.promptId || null,
            interaction_type: 'chart_view',
            query_text: section,
            response_text: null,
            tool_name: null,
            context_size_chars: 0,
            chart_sections: [section],
            metadata: {},
        });
    }

    function _safeGetContext() {
        try {
            return _getContext ? (_getContext() || {}) : {};
        } catch (e) {
            return {};
        }
    }

    // ── patches ────────────────────────────────────────────────────────

    function _installPatches() {
        if (typeof ClaudeAPI === 'undefined') {
            WARN('ClaudeAPI not loaded; cannot install patches');
            return;
        }

        _originalSendMessage = ClaudeAPI.sendMessage.bind(ClaudeAPI);
        _originalChat = ClaudeAPI.chat.bind(ClaudeAPI);

        ClaudeAPI.sendMessage = async function (systemPrompt, messages) {
            const startedAt = new Date();
            const queryText = _serializeMessages(messages);
            const contextSize = (systemPrompt || '').length + queryText.length;
            try {
                const response = await _originalSendMessage(systemPrompt, messages);
                if (_active && _attemptId) {
                    const ctx = _safeGetContext();
                    _writeRow({
                        attempt_id: _attemptId,
                        assessment_id: ctx.assessmentId || null,
                        prompt_id: ctx.promptId || null,
                        interaction_type: 'ask',
                        query_text: queryText.slice(0, 20000),
                        response_text: _extractResponseText(response).slice(0, 20000),
                        tool_name: null,
                        context_size_chars: contextSize,
                        chart_sections: _activeChartSections(),
                        metadata: {
                            system_prompt_preview: (systemPrompt || '').slice(0, 500),
                            started_at: startedAt.toISOString(),
                            model: ClaudeAPI.model,
                        },
                    });
                }
                return response;
            } catch (err) {
                if (_active && _attemptId) {
                    const ctx = _safeGetContext();
                    _writeRow({
                        attempt_id: _attemptId,
                        assessment_id: ctx.assessmentId || null,
                        prompt_id: ctx.promptId || null,
                        interaction_type: 'ask_error',
                        query_text: queryText.slice(0, 20000),
                        response_text: String(err.message || err).slice(0, 2000),
                        tool_name: null,
                        context_size_chars: contextSize,
                        chart_sections: _activeChartSections(),
                        metadata: { started_at: startedAt.toISOString(), failed: true },
                    });
                }
                throw err;
            }
        };

        ClaudeAPI.chat = async function (systemPrompt, messages) {
            const startedAt = new Date();
            const queryText = _serializeMessages(messages);
            const contextSize = (systemPrompt || '').length + queryText.length;
            try {
                const text = await _originalChat(systemPrompt, messages);
                if (_active && _attemptId) {
                    const ctx = _safeGetContext();
                    _writeRow({
                        attempt_id: _attemptId,
                        assessment_id: ctx.assessmentId || null,
                        prompt_id: ctx.promptId || null,
                        interaction_type: 'ask',
                        query_text: queryText.slice(0, 20000),
                        response_text: (text || '').slice(0, 20000),
                        tool_name: null,
                        context_size_chars: contextSize,
                        chart_sections: _activeChartSections(),
                        metadata: {
                            system_prompt_preview: (systemPrompt || '').slice(0, 500),
                            started_at: startedAt.toISOString(),
                            via: 'chat',
                            model: ClaudeAPI.model,
                        },
                    });
                }
                return text;
            } catch (err) {
                if (_active && _attemptId) {
                    const ctx = _safeGetContext();
                    _writeRow({
                        attempt_id: _attemptId,
                        assessment_id: ctx.assessmentId || null,
                        prompt_id: ctx.promptId || null,
                        interaction_type: 'ask_error',
                        query_text: queryText.slice(0, 20000),
                        response_text: String(err.message || err).slice(0, 2000),
                        tool_name: null,
                        context_size_chars: contextSize,
                        chart_sections: _activeChartSections(),
                        metadata: { started_at: startedAt.toISOString(), failed: true, via: 'chat' },
                    });
                }
                throw err;
            }
        };

        LOG('Patches installed');
    }

    function _restorePatches() {
        if (typeof ClaudeAPI === 'undefined') return;
        if (_originalSendMessage) ClaudeAPI.sendMessage = _originalSendMessage;
        if (_originalChat) ClaudeAPI.chat = _originalChat;
        _originalSendMessage = null;
        _originalChat = null;
        LOG('Patches restored');
    }

    // ── lifecycle ──────────────────────────────────────────────────────

    function start({ attemptId, getActiveContext }) {
        if (_active) {
            WARN('start called while already active — stopping previous first');
            stop();
        }
        _attemptId = attemptId;
        _getContext = getActiveContext;
        _installPatches();
        _active = true;
        LOG('Started for attempt', attemptId);
    }

    function stop() {
        if (!_active) return;
        _active = false;
        _restorePatches();
        if (_queue.length > 0) _scheduleFlush();
        _attemptId = null;
        _getContext = null;
        LOG('Stopped');
    }

    function isActive() { return _active; }

    return {
        start,
        stop,
        isActive,
        logChartView,
    };
})();

window.AssessmentLogger = AssessmentLogger;
