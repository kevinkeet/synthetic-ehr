/**
 * AdminDashboard — proctor / training-director view at #/admin/attempts
 *
 * Guards on `is_admin(auth.uid())`. If the caller is not an admin, shows a
 * 403-style notice.
 *
 * Pages:
 *   #/admin/attempts           — list of all attempts
 *   #/admin/attempts/:id       — drill-in: per-prompt responses + AI log
 */

const AdminDashboard = {

    _isAdminCached: null,

    async _checkAdmin() {
        if (this._isAdminCached !== null) return this._isAdminCached;
        const sb = (typeof SupabaseSync !== 'undefined') ? SupabaseSync.getClient() : null;
        if (!sb || !SupabaseSync.isAuthenticated()) {
            this._isAdminCached = false;
            return false;
        }
        try {
            const user = SupabaseSync.getUser();
            // Read admin_roles for this user directly (RLS allows self-read).
            const { data, error } = await sb
                .from('admin_roles')
                .select('role')
                .eq('user_id', user.id)
                .maybeSingle();
            if (error) {
                console.warn('admin role check error:', error.message);
                this._isAdminCached = false;
                return false;
            }
            this._isAdminCached = !!(data && (data.role === 'admin' || data.role === 'proctor'));
            return this._isAdminCached;
        } catch (err) {
            console.warn('admin role check failed:', err.message);
            this._isAdminCached = false;
            return false;
        }
    },

    async renderList() {
        const root = document.getElementById('main-content');
        if (!root) return;
        root.innerHTML = `<div class="admin-page"><div class="loading">Loading…</div></div>`;

        const isAdmin = await this._checkAdmin();
        if (!isAdmin) {
            this._renderForbidden(root);
            return;
        }

        const sb = SupabaseSync.getClient();
        const { data: attempts, error } = await sb
            .from('test_attempts')
            .select('*')
            .order('started_at', { ascending: false })
            .limit(500);

        if (error) {
            root.innerHTML = `<div class="admin-page"><div class="empty-state">Error loading attempts: ${this._escape(error.message)}</div></div>`;
            return;
        }

        // Bucket and aggregate
        const counts = { in_progress: 0, completed: 0, abandoned: 0, expired: 0 };
        for (const a of (attempts || [])) counts[a.status] = (counts[a.status] || 0) + 1;
        const completed = (attempts || []).filter((a) => a.status === 'completed' && a.total_score !== null);
        const avgScore = completed.length
            ? Math.round((completed.reduce((sum, a) => sum + Number(a.total_score || 0), 0) / completed.length) * 100)
            : null;

        // Group by identity (user_code preferred, user_id fallback)
        const byUser = new Map();
        for (const a of (attempts || [])) {
            const key = a.user_code || ('auth:' + (a.user_id || 'unknown').slice(0, 8));
            const bucket = byUser.get(key) || { id: key, attempts: 0, completed: 0, totalScore: 0, cases: new Set() };
            bucket.attempts += 1;
            bucket.cases.add(a.case_id);
            if (a.status === 'completed' && a.total_score !== null) {
                bucket.completed += 1;
                bucket.totalScore += Number(a.total_score || 0);
            }
            byUser.set(key, bucket);
        }
        const userRows = Array.from(byUser.values())
            .map((u) => ({
                ...u,
                avgScore: u.completed ? Math.round((u.totalScore / u.completed) * 100) : null,
                cases: Array.from(u.cases).join(', '),
            }))
            .sort((a, b) => b.attempts - a.attempts);

        root.innerHTML = `
            <div class="admin-page">
                <div class="admin-header">
                    <h1>Admin Dashboard — Attempts</h1>
                    <div class="admin-header-stats">
                        <span>${attempts.length} total</span>
                        <span>&middot; ${counts.completed || 0} completed</span>
                        <span>&middot; ${counts.in_progress || 0} in progress</span>
                        <span>&middot; ${counts.abandoned || 0} abandoned</span>
                        ${avgScore !== null ? `<span>&middot; Avg completed score ${avgScore}%</span>` : ''}
                        <span>&middot; ${userRows.length} ${userRows.length === 1 ? 'user' : 'users'}</span>
                    </div>
                </div>

                ${userRows.length > 0 ? `
                <div class="admin-user-summary">
                    <h2 class="admin-section-title">By user</h2>
                    <div class="admin-user-grid">
                        ${userRows.map((u) => `
                            <div class="admin-user-card">
                                <div class="admin-user-id">${u.id.startsWith('auth:') ? `<code>${this._escape(u.id.slice(5))}…</code>` : `<strong class="user-code-badge">${this._escape(u.id)}</strong>`}</div>
                                <div class="admin-user-meta">
                                    ${u.attempts} attempt${u.attempts === 1 ? '' : 's'}
                                    · ${u.completed} done
                                    ${u.avgScore !== null ? `· avg ${u.avgScore}%` : ''}
                                </div>
                                <div class="admin-user-cases">${this._escape(u.cases)}</div>
                            </div>
                        `).join('')}
                    </div>
                </div>` : ''}
                <div class="admin-attempts-table-wrap">
                    <table class="admin-attempts-table">
                        <thead>
                            <tr>
                                <th>User</th>
                                <th>Case</th>
                                <th>Started</th>
                                <th>Status</th>
                                <th>Current</th>
                                <th>Time</th>
                                <th>Score</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            ${(attempts || []).map((a) => this._renderAttemptRow(a)).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
        App.refreshIcons();
    },

    _renderAttemptRow(a) {
        const pct = (a.total_score !== null && a.total_score !== undefined)
            ? Math.round(Number(a.total_score) * 100) + '%'
            : '—';
        return `
            <tr>
                <td>${this._renderUserCell(a)}</td>
                <td>${this._escape(a.case_id)}</td>
                <td>${this._escape(this._fmtDate(a.started_at))}</td>
                <td><span class="status-pill status-${this._escape(a.status)}">${this._escape(a.status)}</span></td>
                <td>${this._escape(a.current_assessment || '—')}</td>
                <td>${this._fmtTime(a.time_used_seconds || 0)}</td>
                <td>${pct}</td>
                <td><a class="btn btn-sm" href="#/admin/attempts/${this._escape(a.id)}">View</a></td>
            </tr>
        `;
    },

    /**
     * Render the identity cell — prefer the human-readable user_code, fall
     * back to a truncated user_id UUID for legacy attempts.
     */
    _renderUserCell(a) {
        if (a.user_code) {
            return `<strong class="user-code-badge">${this._escape(a.user_code)}</strong>`;
        }
        if (a.user_id) {
            return `<code title="Supabase user id">${this._escape(a.user_id.slice(0, 8))}…</code>`;
        }
        return '<span class="text-muted">—</span>';
    },

    async renderDetail(attemptId) {
        const root = document.getElementById('main-content');
        if (!root) return;
        root.innerHTML = `<div class="admin-page"><div class="loading">Loading…</div></div>`;

        const isAdmin = await this._checkAdmin();
        if (!isAdmin) {
            this._renderForbidden(root);
            return;
        }

        const sb = SupabaseSync.getClient();
        const [attemptRes, respRes, logRes] = await Promise.all([
            sb.from('test_attempts').select('*').eq('id', attemptId).maybeSingle(),
            sb.from('assessment_responses').select('*').eq('attempt_id', attemptId),
            sb.from('assessment_ai_log').select('*').eq('attempt_id', attemptId).order('timestamp', { ascending: true }),
        ]);

        if (attemptRes.error || !attemptRes.data) {
            root.innerHTML = `<div class="admin-page"><div class="empty-state">Attempt not found.</div></div>`;
            return;
        }
        const attempt = attemptRes.data;
        const responses = respRes.data || [];
        const aiLog = logRes.data || [];

        const caseDef = await AssessmentData.loadCase(attempt.case_id).catch((err) => {
            console.warn('caseDef load failed', err);
            return null;
        });

        root.innerHTML = `
            <div class="admin-page admin-detail-page">
                <div class="admin-detail-header">
                    <a href="#/admin/attempts" class="admin-back-link">&larr; Back to all attempts</a>
                    <h1>${this._escape(attempt.case_id)} attempt — <code>${this._escape(attempt.id.slice(0, 8))}</code></h1>
                    <div class="admin-detail-meta">
                        <span>User ${
                            attempt.user_code
                                ? `<strong class="user-code-badge">${this._escape(attempt.user_code)}</strong>`
                                : (attempt.user_id
                                    ? `<code>${this._escape(attempt.user_id.slice(0, 8))}…</code>`
                                    : '<span class="text-muted">unknown</span>')
                        }</span>
                        <span>&middot; ${this._escape(attempt.status)}</span>
                        <span>&middot; Score ${attempt.total_score === null ? '—' : Math.round(Number(attempt.total_score) * 100) + '%'}</span>
                        <span>&middot; Time ${this._fmtTime(attempt.time_used_seconds || 0)}</span>
                        <span>&middot; Started ${this._escape(this._fmtDate(attempt.started_at))}</span>
                        ${attempt.completed_at ? `<span>&middot; Completed ${this._escape(this._fmtDate(attempt.completed_at))}</span>` : ''}
                    </div>
                </div>

                <div class="admin-detail-grid">
                    <div class="admin-detail-col">
                        <h2>Responses</h2>
                        ${this._renderResponses(caseDef, responses, aiLog)}
                    </div>
                    <div class="admin-detail-col">
                        <h2>AI usage log (${aiLog.length})</h2>
                        <div class="admin-ai-log">${this._renderAILog(aiLog)}</div>
                    </div>
                </div>
            </div>
        `;
        App.refreshIcons();
    },

    _renderResponses(caseDef, responses, aiLog) {
        // Stash for per-prompt transcript rendering below.
        this._aiLog = aiLog || [];
        if (!caseDef) {
            return responses.map((r) => this._renderRawResponse(r)).join('') || '<div class="empty-state-text">No responses yet.</div>';
        }
        return caseDef.assessments.map((ap) => `
            <div class="admin-detail-ap">
                <h3>${this._escape(ap.id)} — ${this._escape(ap.title || '')}</h3>
                ${(ap.prompts || []).map((p) => {
                    const r = responses.find((rr) => rr.prompt_id === p.id);
                    return this._renderPromptResponseCard(p, r);
                }).join('')}
            </div>
        `).join('');
    },

    _renderPromptResponseCard(prompt, r) {
        const scoreStr = (r && typeof r.score === 'number') ? Math.round(r.score * 100) + '%' : '—';
        const transcript = this._renderPromptTranscript(prompt.id);
        return `
            <div class="admin-prompt-card">
                <div class="admin-prompt-card-head">
                    <span>${this._escape(prompt.id)} · ${this._escape(prompt.type || '')}</span>
                    <span>${scoreStr}</span>
                </div>
                <div class="admin-prompt-card-q">${this._escape(prompt.question || '')}</div>
                ${r && r.ai_sample_output ? `<details><summary>Chatbot sample</summary><pre>${this._escape(r.ai_sample_output)}</pre></details>` : ''}
                <details><summary>Response</summary><pre>${this._escape((r && r.response_text) || '(none)')}</pre></details>
                ${transcript}
                ${r && r.score_breakdown ? `<details><summary>Score breakdown</summary><pre>${this._escape(JSON.stringify(r.score_breakdown, null, 2))}</pre></details>` : ''}
                ${r && r.grader_notes ? `<div class="admin-grader-notes">${this._escape(r.grader_notes)}</div>` : ''}
            </div>
        `;
    },

    _renderPromptTranscript(promptId) {
        const log = this._aiLog || [];
        const rows = log
            .filter((r) => r.prompt_id === promptId && (r.interaction_type === 'ask' || r.interaction_type === 'ask_error'))
            .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        if (rows.length === 0) {
            return '<div class="admin-prompt-transcript-empty">No chatbot use for this prompt.</div>';
        }
        const windowLabel = {
            'today': 'Today only', '7d': 'Last 7d', '30d': 'Last 30d',
            '90d': 'Last 90d', '6mo': 'Last 6mo', '1y': 'Last 1y', 'all': 'All',
        };
        const turns = rows.map((row) => {
            const setup = row.metadata && row.metadata.chatbot_setup;
            const setupLine = setup
                ? `<div class="admin-transcript-setup">${this._escape(windowLabel[setup.windowKey] || setup.windowKey)} · ${this._escape((setup.dataTypes || []).join(' · '))}</div>`
                : '';
            const userText = this._extractUserText(row.query_text || '');
            return `
                <div class="admin-transcript-turn">
                    ${setupLine}
                    <div class="admin-transcript-msg admin-transcript-user">
                        <strong>You:</strong> ${this._escape(userText)}
                    </div>
                    <div class="admin-transcript-msg admin-transcript-bot">
                        <strong>Bot:</strong> ${this._escape(row.response_text || '(no response)')}
                    </div>
                </div>
            `;
        }).join('');
        return `
            <details class="admin-prompt-transcript">
                <summary>Chatbot transcript (${rows.length} turn${rows.length === 1 ? '' : 's'})</summary>
                <div class="admin-transcript-body">${turns}</div>
            </details>
        `;
    },

    _extractUserText(serialized) {
        if (!serialized) return '';
        const lastUserIdx = serialized.lastIndexOf('[user]');
        if (lastUserIdx === -1) return serialized.slice(-500);
        const chunk = serialized.slice(lastUserIdx + '[user]'.length).trim();
        const sep = '— END OF CHART CONTEXT —';
        const sepIdx = chunk.indexOf(sep);
        if (sepIdx !== -1) return chunk.slice(sepIdx + sep.length).trim();
        return chunk;
    },

    _renderRawResponse(r) {
        return `
            <div class="admin-prompt-card">
                <div class="admin-prompt-card-head"><span>${this._escape(r.prompt_id)}</span><span>${typeof r.score === 'number' ? Math.round(r.score * 100) + '%' : '—'}</span></div>
                <pre>${this._escape(r.response_text || '')}</pre>
            </div>
        `;
    },

    _renderAILog(log) {
        if (!log.length) return '<div class="empty-state-text">No AI interactions logged.</div>';
        return log.map((row) => {
            const setup = row.metadata && row.metadata.chatbot_setup;
            const setupSummary = setup
                ? this._fmtSetupSummary(setup)
                : '';
            return `
                <details class="admin-ai-log-entry">
                    <summary>
                        <code>${this._escape(this._fmtDate(row.timestamp))}</code>
                        · ${this._escape(row.assessment_id || '—')}/${this._escape(row.prompt_id || '—')}
                        · ${this._escape(row.interaction_type || '')}
                        · ${row.context_size_chars || 0} chars
                    </summary>
                    <div class="admin-ai-log-body">
                        ${setupSummary ? `<div class="admin-ai-log-setup"><strong>Chatbot setup:</strong> ${setupSummary}</div>` : ''}
                        ${Array.isArray(row.chart_sections) && row.chart_sections.length ? `<div><strong>Chart sections:</strong> ${row.chart_sections.map((s) => this._escape(s)).join(', ')}</div>` : ''}
                        <details><summary>Query</summary><pre>${this._escape(row.query_text || '')}</pre></details>
                        <details><summary>Response</summary><pre>${this._escape(row.response_text || '')}</pre></details>
                        ${row.metadata && Object.keys(row.metadata).length ? `<details><summary>Metadata</summary><pre>${this._escape(JSON.stringify(row.metadata, null, 2))}</pre></details>` : ''}
                    </div>
                </details>
            `;
        }).join('');
    },

    _fmtSetupSummary(setup) {
        const windowLabel = {
            'today': 'Today only', '7d': 'Last 7 days', '30d': 'Last 30 days',
            '90d': 'Last 90 days', '6mo': 'Last 6 months', '1y': 'Last 1 year',
            'all': 'All available',
        };
        const typeLabel = {
            notes: 'Notes', labs: 'Labs', vitals: 'Vitals', imaging: 'Imaging',
            encounters: 'Encounters', procedures: 'Procedures', orders: 'Orders',
            problems: 'Problems', medications: 'Meds', allergies: 'Allergies',
            social: 'Social', family: 'Family', immunizations: 'Imms',
        };
        const w = windowLabel[setup.windowKey] || setup.windowKey;
        const types = (setup.dataTypes || []).map((t) => typeLabel[t] || t).join(', ');
        return `${this._escape(w)} · ${this._escape(types)} (turn ${setup.turn || '?'})`;
    },

    _renderForbidden(root) {
        root.innerHTML = `
            <div class="admin-page">
                <div class="empty-state">
                    <div class="empty-state-icon"><i data-lucide="lock"></i></div>
                    <div class="empty-state-text">Admin access only.</div>
                    <div style="margin-top:8px;color:#666;font-size:13px;">Your account is not in <code>admin_roles</code>. Ask the site admin to grant you proctor or admin role.</div>
                </div>
            </div>
        `;
        App.refreshIcons();
    },

    _fmtDate(iso) {
        if (!iso) return '';
        try { return new Date(iso).toLocaleString(); } catch (e) { return iso; }
    },

    _fmtTime(secs) {
        secs = Math.max(0, Math.floor(secs));
        const h = Math.floor(secs / 3600);
        const m = Math.floor((secs % 3600) / 60);
        if (h > 0) return `${h}h ${m}m`;
        return `${m}m`;
    },

    _escape(s) {
        const el = document.createElement('span');
        el.textContent = s == null ? '' : String(s);
        return el.innerHTML;
    },
};

window.AdminDashboard = AdminDashboard;
