/**
 * GlassesBridge — pushes HUD content to the Acting Intern relay
 * (Cloudflare Worker), which the Even Hub plugin polls and renders to G2.
 *
 *   anchor (top line)   = persistent patient identity + decision-changing number
 *   bottom (event line) = the most recent dictated finding OR the most recent order
 *   views               = multi-page browseable content (notes, AI, problems, alerts, plan)
 *                          plugin navigates locally with ring/temple inputs
 *   desiredMode         = EHR can ask plugin to switch to a specific view
 *                          (e.g. on voice command "show notes")
 *   transcripts         = G2 mic transcripts flow back: plugin → relay → EHR poller
 *                          → DictationWidget._processFinalText (acts as if from local mic)
 *
 * Settings persist in localStorage. Disabled by default — clinician opts in.
 */
(function () {
    'use strict';

    var STORAGE_KEY = 'glasses-bridge-config-v1';
    var REQUEST_TIMEOUT_MS = 4000;
    var COALESCE_MS = 120;
    var MIC_POLL_MS = 250;

    // Build-time defaults — used when localStorage is empty (first visit, or
    // after Supabase sync wipes it). The URL is safe to hardcode; the secret
    // will be filled in once you paste it. Anyone visiting actingintern.com
    // can read these from the JS bundle, so don't bake anything more sensitive.
    var BAKED_DEFAULTS = {
        endpoint: 'https://acting-intern-relay.kevinkeet.workers.dev',
        secret: '59e10ba81146f1ad82b254e590f2734ae6bc92d9561ea23b244dc667386ffd16',
        enabled: true,      // baked secret → safe to auto-enable on first load
        useG2Mic: false,    // user opts in via the G2 settings toggle
        // ---- Display tuning (glasses-side, independent of EHR's AIPreferences) ----
        // Verbosity: how much text per item. 1=minimal, 2=moderate (default), 3=detailed
        verbosity: 2,
        // Assertiveness: what kinds of content reach the glasses.
        //   1 = facts only (chart data: problems, alerts, notes — no AI suggestions)
        //   2 = suggestions (default — adds AI plan + key considerations)
        //   3 = proactive (adds AI thinking, trajectory, ddx challenges, teaching)
        assertiveness: 2
    };

    // Per-mode caps based on display tuning. Returns { textChars, maxItems }.
    function tuningFor(mode, verbosity) {
        var v = Math.max(1, Math.min(3, verbosity || 2));
        // Char limits per bullet/paragraph
        var chars = { 1: 60, 2: 200, 3: 400 }[v];
        // Max items per page (or pages for non-list modes)
        var maxItemsByMode = {
            plan:       { 1: 5,  2: 10, 3: 20 },
            alerts:     { 1: 5,  2: 10, 3: 20 },
            problems:   { 1: 5,  2: 10, 3: 15 },
            notes:      { 1: 5,  2: 12, 3: 20 },
            ai:         { 1: 2,  2: 4,  3: 8 },
            dictation:  { 1: 5,  2: 10, 3: 20 }
        };
        var max = (maxItemsByMode[mode] || maxItemsByMode.plan)[v];
        return { textChars: chars, maxItems: max };
    }

    function escAttr(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
            .replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function secretFingerprint(s) {
        if (!s) return 'no secret set';
        var n = s.length;
        if (n <= 8) return 'len ' + n + ' (too short to fingerprint)';
        return 'len ' + n + ' · ends in …' + escAttr(s.slice(-8));
    }

    var GlassesBridge = {
        _config: null,
        _lastAnchor: '',
        _lastViewsJson: '',
        _coalesceTimer: null,
        _pending: null,
        _inFlight: 0,
        _micPollTimer: null,
        _micLastSeenId: 0,
        _dictationLog: [], // ring buffer of recent dictations for the dictation-mode page list

        // ==================== Config ====================

        _loadConfig: function () {
            if (this._config) return this._config;
            // Start from baked defaults so first-visit + post-wipe both pick up the URL/secret.
            var base = Object.assign({}, BAKED_DEFAULTS);
            try {
                var raw = localStorage.getItem(STORAGE_KEY);
                if (raw) {
                    var saved = JSON.parse(raw);
                    // User-saved values win over baked, but baked fills any blanks.
                    this._config = Object.assign(base, saved);
                    // Backfill new tuning fields if user has an older saved config.
                    if (this._config.verbosity == null) this._config.verbosity = BAKED_DEFAULTS.verbosity;
                    if (this._config.assertiveness == null) this._config.assertiveness = BAKED_DEFAULTS.assertiveness;
                    // If the user wiped settings (or Supabase did) and baked has both
                    // endpoint and secret, auto-enable so the HUD just works again.
                    if (BAKED_DEFAULTS.endpoint && BAKED_DEFAULTS.secret &&
                        (!saved.endpoint || !saved.secret)) {
                        this._config.endpoint = this._config.endpoint || BAKED_DEFAULTS.endpoint;
                        this._config.secret = this._config.secret || BAKED_DEFAULTS.secret;
                        if (saved.enabled === undefined) this._config.enabled = true;
                    }
                } else {
                    this._config = base;
                    // Fresh install with baked secret → enable by default.
                    if (BAKED_DEFAULTS.endpoint && BAKED_DEFAULTS.secret) this._config.enabled = true;
                }
            } catch (_) {
                this._config = base;
            }
            return this._config;
        },

        _saveConfig: function () {
            try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this._config)); } catch (_) {}
        },

        configure: function (patch) {
            this._loadConfig();
            Object.assign(this._config, patch || {});
            this._saveConfig();
            // Sync mic poll loop to current settings.
            if (this.isG2MicEnabled()) this._startMicPolling();
            else this._stopMicPolling();
        },

        getConfig: function () { return Object.assign({}, this._loadConfig()); },

        isEnabled: function () {
            var c = this._loadConfig();
            return !!(c.enabled && c.endpoint && c.secret);
        },

        isG2MicEnabled: function () {
            var c = this._loadConfig();
            return !!(c.enabled && c.endpoint && c.secret && c.useG2Mic);
        },

        enable: function () { this.configure({ enabled: true }); },
        disable: function () { this.configure({ enabled: false }); },

        // ==================== Public push API ====================

        setAnchor: function (anchor) {
            if (!anchor || typeof anchor !== 'string') return;
            anchor = anchor.trim();
            if (anchor === this._lastAnchor) return;
            this._lastAnchor = anchor;
            console.log('[GlassesBridge] anchor →', anchor);
            this._enqueue({ anchor: anchor });
        },

        pushEvent: function (event) {
            if (!event || !event.kind) return;
            console.log('[GlassesBridge] event →', event.kind, event.text, event.glyph || '');
            this._enqueue({ event: event });
        },

        pushViews: function (views) {
            if (!views) return;
            var json = JSON.stringify(views);
            if (json === this._lastViewsJson) return;
            this._lastViewsJson = json;
            this._enqueue({ views: views });
        },

        setDesiredMode: function (mode) {
            if (!this.isEnabled()) return;
            var c = this._loadConfig();
            console.log('[GlassesBridge] mode →', mode);
            this._post(c, '/mode', { mode: mode });
        },

        /**
         * Tell the plugin "there's an action awaiting your accept/cancel".
         * Plugin renders this prominently and ring CLICK = confirm,
         * DOUBLE_CLICK = cancel.
         *   pendingAction: { kind: 'order', summary: '...', glyph: '⚠'|'✓' } | null
         */
        setPendingAction: function (action) {
            if (!this.isEnabled()) return;
            var c = this._loadConfig();
            console.log('[GlassesBridge] pendingAction →', action);
            this._post(c, '/pending', { pendingAction: action });
        },

        clear: function () {
            this._enqueue({ event: { kind: 'clear', text: '' } });
        },

        // ==================== Builders (formatting helpers) ====================

        buildAnchor: function () {
            var pieces = [];
            var initials = this._patientInitials();
            var ageSex = this._ageSex();
            if (initials || ageSex) pieces.push((initials + ' ' + ageSex).trim());
            var dx = this._dominantDx();
            if (dx) pieces.push(dx);
            var renal = this._renalSnapshot();
            if (renal) pieces.push(renal);
            return pieces.length ? pieces.join(' \u00B7 ') : '';
        },

        buildDictationEvent: function (text, glyph) {
            // Append to local log so dictation-mode pages can show history.
            // Only real dictations, not mode-switch feedback (those use a different code path).
            if (text && typeof text === 'string') {
                this._dictationLog.push({ text: text, ts: Date.now() });
                if (this._dictationLog.length > 20) this._dictationLog = this._dictationLog.slice(-20);
            }
            return { kind: 'dictation', text: this._compress(text, 140), glyph: glyph || '\u2713' };
        },

        buildOrderEvent: function (orderData) {
            if (!orderData) return null;
            var text = this._summarizeOrder(orderData);
            var safety = this._checkOrderSafety(orderData);
            return { kind: 'order', text: this._compress(text, 120), glyph: safety };
        },

        /**
         * Build the multi-page views object from current chart + AI state.
         * Returns { live: [], notes: [...], ai: [...], problems: [...],
         *           alerts: [...], plan: [...] }
         * Each page is { line1, line2 } — exactly what the plugin will render
         * to the two stacked text containers on G2.
         */
        buildViews: function () {
            return {
                live: [],
                dictation: this._buildDictationPages(),
                notes: this._buildNotesPages(),
                ai: this._buildAIPages(),
                problems: this._buildProblemsPages(),
                alerts: this._buildAlertsPages(),
                plan: this._buildPlanPages()
            };
        },

        // ==================== Page builders ====================

        /**
         * Live dictation scratchpad: each recent dictation utterance becomes
         * one page. The plugin renders it full-screen (both top + bottom
         * containers used for the same dictation).
         */
        _buildDictationPages: function () {
            try {
                var c = this._loadConfig();
                var t = tuningFor('dictation', c.verbosity);
                var hist = this._dictationLog && this._dictationLog.length
                    ? this._dictationLog
                    : ((typeof AICoworker !== 'undefined' && AICoworker.state && AICoworker.state.dictationHistory) || []);
                if (!hist.length) return [];
                return hist.slice().reverse().slice(0, t.maxItems).map(function (entry) {
                    var text = (typeof entry === 'string') ? entry : (entry.text || entry.dictation || '');
                    return { text: GlassesBridge._compress(text, t.textChars) };
                });
            } catch (_) { return []; }
        },

        _buildNotesPages: function () {
            try {
                var c = this._loadConfig();
                var t = tuningFor('notes', c.verbosity);
                var src = (typeof NotesList !== 'undefined' && NotesList.notes) ? NotesList.notes : [];
                if (!src.length) return [];
                return src.slice(0, t.maxItems).map(function (n, i) {
                    var date = n.date || n.noteDate || '';
                    var title = (n.type || n.title || 'Note').toString();
                    var author = n.author ? ' · ' + n.author : '';
                    var snippet = (n.summary || n.body || n.text || '').toString();
                    return {
                        title: 'Note ' + (i + 1) + '/' + Math.min(src.length, t.maxItems) + ' · ' + GlassesBridge._compress(title + author + ' · ' + date, 80),
                        text: GlassesBridge._compress(snippet, t.textChars)
                    };
                });
            } catch (_) { return []; }
        },

        _buildAIPages: function () {
            try {
                if (typeof AICoworker === 'undefined' || !AICoworker.state) return [];
                var c = this._loadConfig();
                // Assertiveness=1 hides AI synthesis entirely (facts only)
                if (c.assertiveness < 2) return [];
                var t = tuningFor('ai', c.verbosity);
                var s = AICoworker.state;
                var pages = [];
                if (s.aiOneLiner) pages.push({ title: 'AI Gestalt', text: this._compress(s.aiOneLiner, t.textChars) });
                if (s.summary) pages.push({ title: 'Summary', text: this._compress(this._stripMarkdown(s.summary), t.textChars) });
                if (s.clinicalSummary && s.clinicalSummary.presentation) {
                    pages.push({ title: 'Presentation', text: this._compress(s.clinicalSummary.presentation, t.textChars) });
                }
                if (s.clinicalSummary && s.clinicalSummary.demographics) {
                    pages.push({ title: 'Demographics', text: this._compress(s.clinicalSummary.demographics, t.textChars) });
                }
                // Proactive content only at assertiveness=3
                if (c.assertiveness >= 3) {
                    if (s.thinking) pages.push({ title: 'Trajectory', text: this._compress(s.thinking, t.textChars) });
                    if (s.trajectoryAssessment) pages.push({ title: 'Trajectory+', text: this._compress(s.trajectoryAssessment, t.textChars) });
                    if (s.ddxChallenge) pages.push({ title: 'DDx Challenge', text: this._compress(s.ddxChallenge, t.textChars) });
                    if (Array.isArray(s.teachingPoints)) {
                        s.teachingPoints.forEach(function (tp, i) {
                            var text = typeof tp === 'string' ? tp : (tp.text || '');
                            if (text) pages.push({ title: 'Teaching ' + (i + 1), text: GlassesBridge._compress(text, t.textChars) });
                        });
                    }
                }
                return pages.slice(0, t.maxItems);
            } catch (_) { return []; }
        },

        _buildProblemsPages: function () {
            try {
                if (typeof AICoworker === 'undefined' || !AICoworker.state) return [];
                var c = this._loadConfig();
                var t = tuningFor('problems', c.verbosity);
                var probs = AICoworker.state.problemList || [];
                var self = this;
                return probs.slice(0, t.maxItems).map(function (p) {
                    var icon = p.urgency === 'urgent' ? '! ' : (p.urgency === 'monitoring' ? '~ ' : '  ');
                    var page = { title: icon + self._compress(p.name || '', 80) };
                    var plan = p.plan || p.ddx || '';
                    if (!plan) return page;
                    // If plan has clear list separators, render as bullets — much
                    // easier to scan ("Continue X, Y, Z" → 3 bullets).
                    var bullets = self._splitToBullets(plan);
                    if (bullets.length >= 2 && c.verbosity >= 2) {
                        page.bullets = bullets.map(function (b) { return self._compress(b, t.textChars); });
                    } else {
                        page.text = self._compress(plan, t.textChars);
                    }
                    return page;
                });
            } catch (_) { return []; }
        },

        /**
         * Heuristic: split a plan/order string into list items.
         * Separators we trust: "; " (clearest), ". " (sentence-final),
         * ", " when surrounding tokens look list-shaped (drug + dose).
         * Falls back to a single-item array if no good split.
         */
        _splitToBullets: function (text) {
            if (!text) return [];
            var t = String(text).trim();
            if (!t) return [];
            // Strong separators first.
            if (t.indexOf(';') >= 0) return t.split(/\s*;\s*/).filter(Boolean);
            // Sentence-final periods (avoid "e.g." etc by requiring uppercase next).
            var sents = t.split(/\.\s+(?=[A-Z])/).filter(Boolean);
            if (sents.length >= 2) return sents.map(function (s) { return s.replace(/\.+$/, ''); });
            // Comma-only fallback: only split if 3+ commas (signals list).
            var commaParts = t.split(/,\s+/);
            if (commaParts.length >= 3) return commaParts;
            return [t];
        },

        _buildAlertsPages: function () {
            try {
                var c = this._loadConfig();
                var t = tuningFor('alerts', c.verbosity);
                var bullets = [];
                // Critical labs (always show — pure facts)
                try {
                    var labs = AICoworker.longitudinalDoc && AICoworker.longitudinalDoc.longitudinalData && AICoworker.longitudinalDoc.longitudinalData.labs;
                    if (labs && labs.forEach) {
                        labs.forEach(function (trend, name) {
                            if (trend && trend.latestValue && trend.latestValue.flag === 'CRITICAL') {
                                var v = trend.latestValue;
                                bullets.push('⚠ ' + name + ' ' + v.value + (v.unit || '') + ' CRITICAL');
                            }
                        });
                    }
                } catch (_) {}
                // Allergies (always — safety facts)
                var pt = this._patient();
                if (pt && Array.isArray(pt.allergies)) {
                    pt.allergies.slice(0, 6).forEach(function (a) {
                        var sub = a.substance || a.name || '';
                        var rx = a.reaction || '';
                        if (sub) bullets.push('⚠ ' + sub + (rx ? ' → ' + rx : ''));
                    });
                }
                // AI safety flags (assertiveness >= 2)
                if (c.assertiveness >= 2 && typeof AICoworker !== 'undefined' && AICoworker.state) {
                    var flags = AICoworker.state.flags || [];
                    flags.slice(0, 6).forEach(function (f) {
                        var text = typeof f === 'string' ? f : (f.text || '');
                        if (text) bullets.push('⚠ ' + text);
                    });
                    if (c.assertiveness >= 3) {
                        var key = AICoworker.state.keyConsiderations || [];
                        key.slice(0, 5).forEach(function (k) {
                            var text = typeof k === 'string' ? k : (k.text || '');
                            if (text) bullets.push('⚠ ' + text);
                        });
                    }
                }
                if (!bullets.length) return [];
                bullets = bullets.slice(0, t.maxItems).map(function (b) {
                    return GlassesBridge._compress(b, t.textChars);
                });
                return [{ title: 'Alerts (' + bullets.length + ')', bullets: bullets }];
            } catch (_) { return []; }
        },

        _buildPlanPages: function () {
            try {
                if (typeof AICoworker === 'undefined' || !AICoworker.state) return [];
                var c = this._loadConfig();
                // Assertiveness=1 hides plan suggestions entirely.
                if (c.assertiveness < 2) return [];
                var t = tuningFor('plan', c.verbosity);
                var s = AICoworker.state;
                // Build a deduped list of all plan items with category prefixes.
                var seen = {};
                var bullets = [];
                function add(prefix, text) {
                    if (!text) return;
                    var key = String(text).slice(0, 30).toLowerCase();
                    if (seen[key]) return;
                    seen[key] = 1;
                    bullets.push((prefix ? prefix + ' ' : '') + GlassesBridge._compress(text, t.textChars));
                }
                // Suggested actions are AI's top picks \u2014 show first.
                (s.suggestedActions || []).forEach(function (a) {
                    add('', typeof a === 'string' ? a : (a.text || ''));
                });
                // Categorized actions add detail per category.
                var cat = s.categorizedActions || {};
                var prefixes = { medications: 'RX', labs: 'LAB', imaging: 'IMG', communication: 'ASK', other: '\u2192' };
                ['medications', 'labs', 'imaging', 'communication', 'other'].forEach(function (key) {
                    var arr = cat[key] || [];
                    arr.forEach(function (a) {
                        add(prefixes[key] || '\u2192', a.text || '');
                    });
                });
                if (!bullets.length) return [];
                bullets = bullets.slice(0, t.maxItems);
                return [{ title: 'Plan (' + bullets.length + ')', bullets: bullets }];
            } catch (_) { return []; }
        },

        // ==================== Private: G2 mic polling ====================

        _startMicPolling: function () {
            if (this._micPollTimer) return;
            console.log('[GlassesBridge] G2 mic poll loop started');
            var self = this;
            this._micPollTimer = setInterval(function () { self._pollMicOnce(); }, MIC_POLL_MS);
        },

        _stopMicPolling: function () {
            if (!this._micPollTimer) return;
            clearInterval(this._micPollTimer);
            this._micPollTimer = null;
            console.log('[GlassesBridge] G2 mic poll loop stopped');
        },

        _pollMicOnce: function () {
            if (!this.isG2MicEnabled()) return;
            var c = this._loadConfig();
            var url = c.endpoint.replace(/\/+$/, '') + '/transcripts?since=' + this._micLastSeenId;
            var self = this;
            fetch(url, { headers: { 'X-Glasses-Secret': c.secret }, cache: 'no-store' })
                .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
                .then(function (data) {
                    if (!data || !Array.isArray(data.items)) return;
                    data.items.forEach(function (item) {
                        if (item.id > self._micLastSeenId) self._micLastSeenId = item.id;
                        if (item.isFinal !== false && item.text && typeof DictationWidget !== 'undefined' && DictationWidget._processFinalText) {
                            console.log('[GlassesBridge] G2 mic transcript →', item.text);
                            try { DictationWidget._processFinalText(item.text); } catch (e) { console.warn('[GlassesBridge] _processFinalText threw', e); }
                        }
                    });
                })
                .catch(function (err) {
                    // Silent during a single failed poll; log only once per minute
                    if (!self._lastMicErrLog || Date.now() - self._lastMicErrLog > 60000) {
                        console.warn('[GlassesBridge] mic poll failed:', err && err.message);
                        self._lastMicErrLog = Date.now();
                    }
                });
        },

        // ==================== Private: anchor data extraction ====================

        _patientInitials: function () {
            try {
                var pt = this._patient();
                if (!pt) return '';
                var f = (pt.firstName || pt.first_name || '').trim();
                var l = (pt.lastName || pt.last_name || '').trim();
                return ((f[0] || '') + (l[0] || '')).toUpperCase();
            } catch (_) { return ''; }
        },

        _ageSex: function () {
            try {
                var pt = this._patient();
                if (!pt) return '';
                var dob = pt.dateOfBirth || pt.dob;
                var sex = (pt.sex || pt.gender || '').toString().charAt(0).toUpperCase();
                if (!dob) return sex;
                var birth = new Date(dob);
                var now = new Date();
                var age = now.getFullYear() - birth.getFullYear();
                var m = now.getMonth() - birth.getMonth();
                if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
                return age + (sex || '');
            } catch (_) { return ''; }
        },

        _patient: function () {
            if (typeof PatientHeader !== 'undefined' && PatientHeader.currentPatient) return PatientHeader.currentPatient;
            if (typeof window !== 'undefined' && window.currentPatient) return window.currentPatient;
            return null;
        },

        _dominantDx: function () {
            try {
                if (typeof AICoworker === 'undefined' || !AICoworker.state) return '';
                var probs = AICoworker.state.problemList || AICoworker.state.problems || [];
                if (!probs.length) return '';
                var pick = probs[1] || probs[0];
                if (!pick) return '';
                var name = pick.name || pick.text || pick.diagnosis || '';
                return this._abbreviateDx(name);
            } catch (_) { return ''; }
        },

        _renalSnapshot: function () {
            try {
                if (typeof AICoworker === 'undefined' || !AICoworker.longitudinalDoc) return '';
                var labs = AICoworker.longitudinalDoc.longitudinalData && AICoworker.longitudinalDoc.longitudinalData.labs;
                if (!labs) return '';
                var trend = (labs.get && labs.get('Creatinine')) || labs.Creatinine;
                if (!trend || !trend.latestValue) return '';
                var v = trend.latestValue;
                var arrow = v.flag === 'HIGH' || v.flag === 'CRITICAL' ? '\u2191' : (v.flag === 'LOW' ? '\u2193' : '');
                return 'Cr ' + v.value + arrow;
            } catch (_) { return ''; }
        },

        _abbreviateDx: function (name) {
            if (!name) return '';
            var s = name.trim();
            var map = [
                [/heart failure with reduced ejection fraction/i, 'HFrEF'],
                [/heart failure with preserved ejection fraction/i, 'HFpEF'],
                [/acute decompensated heart failure/i, 'ADHF'],
                [/congestive heart failure/i, 'CHF'],
                [/chronic kidney disease/i, 'CKD'],
                [/acute kidney injury/i, 'AKI'],
                [/atrial fibrillation/i, 'AFib'],
                [/type 2 diabetes mellitus/i, 'T2DM'],
                [/type 1 diabetes mellitus/i, 'T1DM'],
                [/diabetes mellitus/i, 'DM'],
                [/hypertension/i, 'HTN'],
                [/coronary artery disease/i, 'CAD'],
                [/myocardial infarction/i, 'MI'],
                [/pulmonary embolism/i, 'PE'],
                [/chronic obstructive pulmonary disease/i, 'COPD']
            ];
            for (var i = 0; i < map.length; i++) {
                if (map[i][0].test(s)) return map[i][1];
            }
            return s.split(/\s+/)[0].slice(0, 12);
        },

        _stripMarkdown: function (s) {
            return String(s || '').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1');
        },

        // ==================== Private: order summarization + safety ====================

        _summarizeOrder: function (orderData) {
            var t = orderData.type || orderData.orderType;
            var d = orderData.details || orderData.orderData || orderData;
            if (t === 'medication') {
                var route = (d.route || '').replace(/IV Push/i, 'IV').replace(/IV Piggyback/i, 'IV');
                return [d.name, d.dose, route, d.frequency && d.frequency !== 'Once' ? d.frequency : ''].filter(Boolean).join(' ');
            }
            if (t === 'lab') return 'LAB ' + (d.name || 'lab') + (d.priority === 'STAT' ? ' STAT' : '');
            if (t === 'imaging') return 'IMG ' + [d.modality, d.bodyPart].filter(Boolean).join(' ') + (d.priority === 'STAT' ? ' STAT' : '');
            if (t === 'consult') return 'Consult ' + (d.specialty || '');
            return orderData.summary || (d.name || 'order');
        },

        _checkOrderSafety: function (orderData) {
            try {
                var t = orderData.type || orderData.orderType;
                if (t !== 'medication') return '\u2713';
                var d = orderData.details || orderData.orderData || {};
                var name = (d.name || '').toLowerCase();
                var allergies = this._getAllergies();
                for (var i = 0; i < allergies.length; i++) {
                    var a = allergies[i].toLowerCase();
                    if (a && (name.indexOf(a) >= 0 || a.indexOf(name) >= 0)) return '\u26A0';
                    if (a.indexOf('penicillin') >= 0 && /(cillin|cef[a-z]+|amoxi|ampici)/.test(name)) return '\u26A0';
                    if (a.indexOf('sulfa') >= 0 && /(sulfa|tmp.smx|bactrim|sulfameth)/.test(name)) return '\u26A0';
                }
                var k = this._latestLab('Potassium');
                if (k && k.value >= 5.0 && /(spironolactone|eplerenone|lisinopril|enalapril|losartan|valsartan|potassium)/.test(name)) {
                    return '\u26A0';
                }
                var cr = this._latestLab('Creatinine');
                if (cr && cr.value >= 2.0 && /(metformin|gabapentin|enoxaparin|nitrofurantoin)/.test(name)) {
                    return '\u26A0';
                }
                return '\u2713';
            } catch (_) { return ''; }
        },

        _getAllergies: function () {
            try {
                var pt = this._patient();
                if (!pt || !pt.allergies) return [];
                return pt.allergies.map(function (a) { return a.substance || a.name || ''; }).filter(Boolean);
            } catch (_) { return []; }
        },

        _latestLab: function (name) {
            try {
                if (typeof AICoworker === 'undefined' || !AICoworker.longitudinalDoc) return null;
                var labs = AICoworker.longitudinalDoc.longitudinalData && AICoworker.longitudinalDoc.longitudinalData.labs;
                if (!labs) return null;
                var trend = (labs.get && labs.get(name)) || labs[name];
                return trend && trend.latestValue ? trend.latestValue : null;
            } catch (_) { return null; }
        },

        _compress: function (text, max) {
            if (!text) return '';
            text = String(text).replace(/\s+/g, ' ').trim();
            return text.length <= max ? text : text.slice(0, max - 1) + '\u2026';
        },

        // ==================== Settings UI ====================

        openSettings: function () {
            this._loadConfig();
            var existing = document.getElementById('glasses-bridge-settings');
            if (existing) existing.remove();

            var c = this._config;
            var overlay = document.createElement('div');
            overlay.id = 'glasses-bridge-settings';
            overlay.style.cssText =
                'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:99999;' +
                'display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif;';

            overlay.innerHTML =
                '<div style="background:#fff;border-radius:8px;padding:24px;width:480px;max-width:92vw;box-shadow:0 12px 40px rgba(0,0,0,0.3);">' +
                  '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">' +
                    '<h3 style="margin:0;font-size:18px;font-weight:600;">G2 Glasses Bridge</h3>' +
                    '<button id="gb-close" style="background:none;border:none;font-size:22px;cursor:pointer;color:#666;line-height:1;">\u00D7</button>' +
                  '</div>' +
                  '<p style="margin:0 0 18px;font-size:13px;color:#555;line-height:1.4;">' +
                    'Pushes a 2-line HUD to the relay (Cloudflare Worker), which the Even Hub plugin polls and renders to G2. ' +
                    'Use the <strong>same secret</strong> here and in the plugin\u2019s setup screen.' +
                  '</p>' +
                  '<label style="display:block;margin-bottom:14px;font-size:13px;font-weight:500;">' +
                    'Relay URL' +
                    '<input id="gb-endpoint" type="url" placeholder="https://acting-intern-relay.workers.dev" value="' + escAttr(c.endpoint) + '" ' +
                    'style="display:block;width:100%;padding:8px 10px;margin-top:4px;border:1px solid #ccc;border-radius:4px;font-size:14px;box-sizing:border-box;">' +
                  '</label>' +
                  '<label style="display:block;margin-bottom:14px;font-size:13px;font-weight:500;">' +
                    'Shared Secret' +
                    '<div style="position:relative;margin-top:4px;">' +
                      '<input id="gb-secret" type="password" autocomplete="off" placeholder="X-Glasses-Secret header value" value="' + escAttr(c.secret) + '" ' +
                      'style="display:block;width:100%;padding:8px 60px 8px 10px;border:1px solid #ccc;border-radius:4px;font-size:14px;box-sizing:border-box;font-family:monospace;">' +
                      '<button type="button" id="gb-secret-toggle" style="position:absolute;right:6px;top:50%;transform:translateY(-50%);background:#f5f5f5;border:1px solid #ddd;border-radius:3px;padding:4px 8px;font-size:11px;cursor:pointer;color:#555;font-family:system-ui;">Show</button>' +
                    '</div>' +
                    '<div id="gb-secret-fp" style="font-family:monospace;font-size:11px;color:#666;margin-top:4px;">' + secretFingerprint(c.secret) + '</div>' +
                  '</label>' +
                  '<label style="display:flex;align-items:center;gap:8px;margin:18px 0 6px;font-size:14px;cursor:pointer;">' +
                    '<input id="gb-enabled" type="checkbox" ' + (c.enabled ? 'checked' : '') + ' style="width:16px;height:16px;cursor:pointer;">' +
                    '<span>Enable HUD output</span>' +
                  '</label>' +
                  '<label style="display:flex;align-items:center;gap:8px;margin:6px 0 12px;font-size:14px;cursor:pointer;">' +
                    '<input id="gb-mic" type="checkbox" ' + (c.useG2Mic ? 'checked' : '') + ' style="width:16px;height:16px;cursor:pointer;">' +
                    '<span>Use G2 mic for dictation <span style="color:#888;font-weight:400;font-size:12px;">(requires plugin Deepgram setup)</span></span>' +
                  '</label>' +
                  '<div id="gb-status" style="font-size:12px;color:#888;min-height:18px;margin-bottom:12px;"></div>' +
                  '<div style="display:flex;justify-content:flex-end;gap:8px;">' +
                    '<button id="gb-test" style="padding:8px 14px;border:1px solid #ccc;background:#f5f5f5;border-radius:4px;cursor:pointer;font-size:13px;">Test push</button>' +
                    '<button id="gb-save" style="padding:8px 16px;border:1px solid #2563eb;background:#2563eb;color:#fff;border-radius:4px;cursor:pointer;font-size:13px;font-weight:500;">Save</button>' +
                  '</div>' +
                '</div>';

            document.body.appendChild(overlay);

            var self = this;
            var close = function () { overlay.remove(); };
            document.getElementById('gb-close').onclick = close;
            overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });

            var statusEl = document.getElementById('gb-status');
            var setStatus = function (msg, ok) {
                statusEl.style.color = ok === false ? '#c2410c' : (ok === true ? '#15803d' : '#888');
                statusEl.textContent = msg || '';
            };

            // Show/Hide toggle for the secret + live fingerprint update
            var secretInput = document.getElementById('gb-secret');
            var toggleBtn = document.getElementById('gb-secret-toggle');
            var fpEl = document.getElementById('gb-secret-fp');
            toggleBtn.onclick = function () {
                if (secretInput.type === 'password') {
                    secretInput.type = 'text';
                    toggleBtn.textContent = 'Hide';
                } else {
                    secretInput.type = 'password';
                    toggleBtn.textContent = 'Show';
                }
            };
            secretInput.addEventListener('input', function () {
                fpEl.innerHTML = secretFingerprint(secretInput.value);
            });

            var readForm = function () {
                return {
                    endpoint: document.getElementById('gb-endpoint').value.trim(),
                    secret: document.getElementById('gb-secret').value.trim(),
                    enabled: document.getElementById('gb-enabled').checked,
                    useG2Mic: document.getElementById('gb-mic').checked,
                    verbosity: parseInt(document.getElementById('gb-verb').value, 10) || 2,
                    assertiveness: parseInt(document.getElementById('gb-assert').value, 10) || 2
                };
            };

            // Live update tuning labels + helper text
            var VERB_LABELS = { 1: 'minimal — short, glanceable', 2: 'moderate — balanced', 3: 'detailed — full text per item' };
            var ASSERT_LABELS = {
                1: 'facts only — no AI suggestions, just chart data',
                2: 'suggestions — AI plan + key considerations',
                3: 'proactive — AI thinking, ddx challenges, teaching'
            };
            var verbInput = document.getElementById('gb-verb');
            var assertInput = document.getElementById('gb-assert');
            var verbLabel = document.getElementById('gb-verb-label');
            var assertLabel = document.getElementById('gb-assert-label');
            var helpEl = document.getElementById('gb-tuning-help');
            var updateTuningLabels = function () {
                var v = parseInt(verbInput.value, 10);
                var a = parseInt(assertInput.value, 10);
                verbLabel.textContent = VERB_LABELS[v] || '';
                assertLabel.textContent = ASSERT_LABELS[a] || '';
                helpEl.textContent = 'Plan ' + (a < 2 ? 'hidden' : (a >= 3 ? 'expanded' : 'shown')) +
                    ' · AI mode ' + (a < 2 ? 'hidden' : (a >= 3 ? 'expanded' : 'shown')) +
                    ' · ' + (v === 1 ? 'fewer items, shorter text' : v === 3 ? 'more items, longer text' : 'balanced item count');
            };
            verbInput.addEventListener('input', updateTuningLabels);
            assertInput.addEventListener('input', updateTuningLabels);
            updateTuningLabels();

            document.getElementById('gb-save').onclick = function () {
                self.configure(readForm());
                self._lastViewsJson = ''; // force views push with new settings
                setStatus('Saved.', true);
                setTimeout(close, 600);
            };

            document.getElementById('gb-test').onclick = function () {
                var f = readForm();
                if (!f.endpoint || !f.secret) { setStatus('Endpoint and secret required.', false); return; }
                self.configure(f);
                self._lastAnchor = '';
                self.setAnchor(self.buildAnchor() || 'Acting Intern \u00B7 test');
                self.pushEvent({ kind: 'dictation', text: 'glasses test', glyph: '\u2713' });
                self.pushViews(self.buildViews());
                setStatus('Test sent. Check your G2.', true);
            };
        },

        // ==================== Private: networking ====================

        _enqueue: function (patch) {
            if (!this.isEnabled()) return;
            this._pending = Object.assign(this._pending || {}, patch);
            if (this._coalesceTimer) return;
            var self = this;
            this._coalesceTimer = setTimeout(function () {
                self._coalesceTimer = null;
                var payload = self._pending;
                self._pending = null;
                if (payload) self._send(payload);
            }, COALESCE_MS);
        },

        _send: function (payload) {
            var c = this._loadConfig();
            // Fan out: anchor/event → /event (or /anchor), views → /views.
            if (payload.event !== undefined || payload.anchor !== undefined) {
                if (payload.event !== undefined) {
                    this._post(c, '/event', { anchor: payload.anchor, event: payload.event });
                } else {
                    this._post(c, '/anchor', { anchor: payload.anchor });
                }
            }
            if (payload.views !== undefined) {
                this._post(c, '/views', { views: payload.views });
            }
        },

        _post: function (c, path, body) {
            var url = c.endpoint.replace(/\/+$/, '') + path;
            var headers = { 'Content-Type': 'application/json', 'X-Glasses-Secret': c.secret };
            var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
            var timeoutId = controller ? setTimeout(function () { controller.abort(); }, REQUEST_TIMEOUT_MS) : null;
            this._inFlight++;
            var self = this;
            return fetch(url, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(body),
                signal: controller ? controller.signal : undefined
            })
            .then(function (r) {
                if (!r.ok && r.status === 401) console.warn('[GlassesBridge] 401 — check shared secret');
                else if (!r.ok) console.warn('[GlassesBridge] relay error', r.status, 'on', path);
            })
            .catch(function (err) {
                if (err && err.name === 'AbortError') console.warn('[GlassesBridge] timeout on', path);
                else console.warn('[GlassesBridge] push failed:', err && err.message, 'on', path);
            })
            .finally(function () {
                if (timeoutId) clearTimeout(timeoutId);
                self._inFlight--;
            });
        }
    };

    if (typeof window !== 'undefined') {
        window.GlassesBridge = GlassesBridge;
        // Auto-start mic polling if config already says so (page reload after save).
        if (GlassesBridge.isG2MicEnabled()) GlassesBridge._startMicPolling();
    }
})();
