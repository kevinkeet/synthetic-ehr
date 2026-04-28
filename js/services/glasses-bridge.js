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

    function escAttr(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
            .replace(/</g, '&lt;').replace(/>/g, '&gt;');
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

        // ==================== Config ====================

        _loadConfig: function () {
            if (this._config) return this._config;
            var defaults = { endpoint: '', secret: '', enabled: false, useG2Mic: false };
            try {
                var raw = localStorage.getItem(STORAGE_KEY);
                this._config = raw ? Object.assign(defaults, JSON.parse(raw)) : defaults;
            } catch (_) {
                this._config = defaults;
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
            return { kind: 'dictation', text: this._compress(text, 32), glyph: glyph || '\u2713' };
        },

        buildOrderEvent: function (orderData) {
            if (!orderData) return null;
            var text = this._summarizeOrder(orderData);
            var safety = this._checkOrderSafety(orderData);
            return { kind: 'order', text: this._compress(text, 30), glyph: safety };
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
                notes: this._buildNotesPages(),
                ai: this._buildAIPages(),
                problems: this._buildProblemsPages(),
                alerts: this._buildAlertsPages(),
                plan: this._buildPlanPages()
            };
        },

        // ==================== Page builders ====================

        _buildNotesPages: function () {
            try {
                var src = (typeof NotesList !== 'undefined' && NotesList.notes) ? NotesList.notes : [];
                if (!src.length) return [];
                return src.slice(0, 20).map(function (n, i) {
                    var date = n.date || n.noteDate || '';
                    var title = (n.type || n.title || 'Note').toString();
                    var author = n.author ? ' \u00B7 ' + n.author : '';
                    return {
                        line1: 'Note ' + (i + 1) + '/' + Math.min(src.length, 20) + ' \u00B7 ' + GlassesBridge._compress(title + author, 30),
                        line2: GlassesBridge._compress(date, 38)
                    };
                });
            } catch (_) { return []; }
        },

        _buildAIPages: function () {
            try {
                if (typeof AICoworker === 'undefined' || !AICoworker.state) return [];
                var s = AICoworker.state;
                var pages = [];
                if (s.aiOneLiner) pages.push({ line1: 'AI Gestalt', line2: this._compress(s.aiOneLiner, 38) });
                if (s.summary) pages.push({ line1: 'Summary', line2: this._compress(this._stripMarkdown(s.summary), 38) });
                if (s.thinking) pages.push({ line1: 'Trajectory', line2: this._compress(s.thinking, 38) });
                if (s.trajectoryAssessment) pages.push({ line1: 'Trajectory+', line2: this._compress(s.trajectoryAssessment, 38) });
                if (s.clinicalSummary && s.clinicalSummary.demographics) {
                    pages.push({ line1: 'Demographics', line2: this._compress(s.clinicalSummary.demographics, 38) });
                }
                if (s.clinicalSummary && s.clinicalSummary.presentation) {
                    pages.push({ line1: 'Presentation', line2: this._compress(s.clinicalSummary.presentation, 38) });
                }
                return pages;
            } catch (_) { return []; }
        },

        _buildProblemsPages: function () {
            try {
                if (typeof AICoworker === 'undefined' || !AICoworker.state) return [];
                var probs = AICoworker.state.problemList || [];
                var self = this;
                return probs.slice(0, 12).map(function (p) {
                    var icon = p.urgency === 'urgent' ? '! ' : (p.urgency === 'monitoring' ? '~ ' : '  ');
                    return {
                        line1: icon + self._compress(p.name || '', 36),
                        line2: self._compress(p.plan || p.ddx || '', 38)
                    };
                });
            } catch (_) { return []; }
        },

        _buildAlertsPages: function () {
            try {
                var pages = [];
                if (typeof AICoworker !== 'undefined' && AICoworker.state) {
                    var flags = AICoworker.state.flags || [];
                    flags.slice(0, 8).forEach(function (f) {
                        var text = typeof f === 'string' ? f : (f.text || '');
                        if (text) pages.push({ line1: '\u26A0 Safety flag', line2: GlassesBridge._compress(text, 38) });
                    });
                    var key = AICoworker.state.keyConsiderations || [];
                    key.slice(0, 5).forEach(function (k) {
                        var text = typeof k === 'string' ? k : (k.text || '');
                        if (text) pages.push({ line1: '\u26A0 Consideration', line2: GlassesBridge._compress(text, 38) });
                    });
                }
                // Critical labs from longitudinal doc
                try {
                    var labs = AICoworker.longitudinalDoc && AICoworker.longitudinalDoc.longitudinalData && AICoworker.longitudinalDoc.longitudinalData.labs;
                    if (labs && labs.forEach) {
                        labs.forEach(function (trend, name) {
                            if (trend && trend.latestValue && trend.latestValue.flag === 'CRITICAL') {
                                var v = trend.latestValue;
                                pages.push({
                                    line1: '\u26A0 Critical lab',
                                    line2: GlassesBridge._compress(name + ' ' + v.value + (v.unit || ''), 38)
                                });
                            }
                        });
                    }
                } catch (_) {}
                // Allergies
                var pt = this._patient();
                if (pt && Array.isArray(pt.allergies)) {
                    pt.allergies.slice(0, 4).forEach(function (a) {
                        var sub = a.substance || a.name || '';
                        var rx = a.reaction || '';
                        if (sub) pages.push({ line1: '\u26A0 Allergy', line2: GlassesBridge._compress(sub + (rx ? ' \u2192 ' + rx : ''), 38) });
                    });
                }
                return pages;
            } catch (_) { return []; }
        },

        _buildPlanPages: function () {
            try {
                if (typeof AICoworker === 'undefined' || !AICoworker.state) return [];
                var s = AICoworker.state;
                var pages = [];
                var actions = s.suggestedActions || [];
                actions.slice(0, 12).forEach(function (a) {
                    var text = typeof a === 'string' ? a : (a.text || '');
                    if (text) pages.push({ line1: '\u2192 Plan', line2: GlassesBridge._compress(text, 38) });
                });
                // Categorized actions if present and not already captured
                var cat = s.categorizedActions || {};
                ['medications', 'labs', 'imaging', 'communication', 'other'].forEach(function (key) {
                    var arr = cat[key] || [];
                    arr.slice(0, 5).forEach(function (a) {
                        var text = a.text || '';
                        if (text && !pages.some(function (p) { return p.line2.indexOf(text.slice(0, 20)) >= 0; })) {
                            pages.push({ line1: '\u2192 ' + key, line2: GlassesBridge._compress(text, 38) });
                        }
                    });
                });
                return pages;
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
                    '<input id="gb-secret" type="password" autocomplete="off" placeholder="X-Glasses-Secret header value" value="' + escAttr(c.secret) + '" ' +
                    'style="display:block;width:100%;padding:8px 10px;margin-top:4px;border:1px solid #ccc;border-radius:4px;font-size:14px;box-sizing:border-box;font-family:monospace;">' +
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

            var readForm = function () {
                return {
                    endpoint: document.getElementById('gb-endpoint').value.trim(),
                    secret: document.getElementById('gb-secret').value.trim(),
                    enabled: document.getElementById('gb-enabled').checked,
                    useG2Mic: document.getElementById('gb-mic').checked
                };
            };

            document.getElementById('gb-save').onclick = function () {
                self.configure(readForm());
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
