/**
 * GlassesBridge — pushes a 2-line HUD ({anchor, event}) to the Acting Intern
 * MentraOS app, which forwards to Even Realities G2 glasses via showDoubleTextWall.
 *
 * The G2 is binocular (same image to both eyes), so this is intentionally minimal:
 *   topText    = anchor: persistent patient identity + decision-changing number
 *   bottomText = event:  the most recent dictated finding OR the most recent order
 *
 * Settings persist in localStorage. Disabled by default — clinician opts in.
 */
(function () {
    'use strict';

    var STORAGE_KEY = 'glasses-bridge-config-v1';
    var REQUEST_TIMEOUT_MS = 4000;
    var COALESCE_MS = 120;

    function escAttr(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
            .replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    var GlassesBridge = {
        _config: null,
        _lastAnchor: '',
        _coalesceTimer: null,
        _pending: null, // { anchor?, event? }
        _inFlight: 0,

        // ==================== Config ====================

        _loadConfig: function () {
            if (this._config) return this._config;
            var defaults = { endpoint: '', secret: '', enabled: false };
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
        },

        getConfig: function () { return Object.assign({}, this._loadConfig()); },

        isEnabled: function () {
            var c = this._loadConfig();
            return !!(c.enabled && c.endpoint && c.secret);
        },

        enable: function () { this.configure({ enabled: true }); },
        disable: function () { this.configure({ enabled: false }); },

        // ==================== Public push API ====================

        /**
         * Set the persistent top line. Idempotent — same anchor twice is a no-op.
         */
        setAnchor: function (anchor) {
            if (!anchor || typeof anchor !== 'string') return;
            anchor = anchor.trim();
            if (anchor === this._lastAnchor) return;
            this._lastAnchor = anchor;
            this._enqueue({ anchor: anchor });
        },

        /**
         * Push a transient bottom-line event.
         *   { kind: 'dictation'|'order'|'alert'|'clear', text: string, glyph?: '✓'|'⚠'|'?' }
         */
        pushEvent: function (event) {
            if (!event || !event.kind) return;
            this._enqueue({ event: event });
        },

        clear: function () {
            this._enqueue({ event: { kind: 'clear', text: '' } });
        },

        // ==================== Builders (formatting helpers) ====================

        /**
         * Build the anchor from AICoworker state + longitudinal doc.
         * Pattern: "RM 73M HFrEF · Cr 2.4↑ eGFR 28"
         * Falls back gracefully when data is missing.
         */
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

        /**
         * Build a dictation event from an extracted finding string.
         */
        buildDictationEvent: function (text, glyph) {
            return { kind: 'dictation', text: this._compress(text, 32), glyph: glyph || '\u2713' };
        },

        /**
         * Build an order event with safety glyph derived from chart context.
         */
        buildOrderEvent: function (orderData) {
            if (!orderData) return null;
            var text = this._summarizeOrder(orderData);
            var safety = this._checkOrderSafety(orderData);
            return { kind: 'order', text: this._compress(text, 30), glyph: safety };
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
            if (typeof DataLoader !== 'undefined' && DataLoader.currentPatient) return DataLoader.currentPatient;
            if (typeof window !== 'undefined' && window.currentPatient) return window.currentPatient;
            return null;
        },

        _dominantDx: function () {
            try {
                if (typeof AICoworker === 'undefined' || !AICoworker.state) return '';
                var probs = AICoworker.state.problems || (AICoworker.state.problemList || []);
                if (!probs.length) return '';
                // Skip the chief-complaint placeholder (problem #1 per the prompt schema is the CC)
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
                // labs is a Map keyed by lab name
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
            // Common abbreviations
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
            // Default: first word, capitalised, max 12 chars
            return s.split(/\s+/)[0].slice(0, 12);
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

                // Allergy match
                var allergies = this._getAllergies();
                for (var i = 0; i < allergies.length; i++) {
                    var a = allergies[i].toLowerCase();
                    if (a && (name.indexOf(a) >= 0 || a.indexOf(name) >= 0)) return '\u26A0';
                    // Cross-reactivity heuristics
                    if (a.indexOf('penicillin') >= 0 && /(cillin|cef[a-z]+|amoxi|ampici)/.test(name)) return '\u26A0';
                    if (a.indexOf('sulfa') >= 0 && /(sulfa|tmp.smx|bactrim|sulfameth)/.test(name)) return '\u26A0';
                }

                // K+ raisers when K is high
                var k = this._latestLab('Potassium');
                if (k && k.value >= 5.0 && /(spironolactone|eplerenone|lisinopril|enalapril|losartan|valsartan|potassium)/.test(name)) {
                    return '\u26A0';
                }

                // Renal-cleared at low eGFR (rough — flag for review, not a hard stop)
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
                  '<label style="display:flex;align-items:center;gap:8px;margin:18px 0;font-size:14px;cursor:pointer;">' +
                    '<input id="gb-enabled" type="checkbox" ' + (c.enabled ? 'checked' : '') + ' style="width:16px;height:16px;cursor:pointer;">' +
                    '<span>Enable HUD output</span>' +
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
                    enabled: document.getElementById('gb-enabled').checked
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
                self._lastAnchor = ''; // force re-send
                self.setAnchor(self.buildAnchor() || 'Acting Intern \u00B7 test');
                self.pushEvent({ kind: 'dictation', text: 'glasses test', glyph: '\u2713' });
                setStatus('Test sent. Check your G2.', true);
            };
        },

        _send: function (payload) {
            var c = this._loadConfig();
            var path = payload.event ? '/event' : '/anchor';
            var url = c.endpoint.replace(/\/+$/, '') + path;
            var headers = { 'Content-Type': 'application/json', 'X-Glasses-Secret': c.secret };

            var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
            var timeoutId = controller ? setTimeout(function () { controller.abort(); }, REQUEST_TIMEOUT_MS) : null;

            this._inFlight++;
            var self = this;
            fetch(url, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(payload),
                signal: controller ? controller.signal : undefined
            })
            .then(function (r) {
                if (!r.ok && r.status === 401) console.warn('[GlassesBridge] 401 — check shared secret');
                else if (!r.ok) console.warn('[GlassesBridge] relay error', r.status);
            })
            .catch(function (err) {
                if (err && err.name === 'AbortError') console.warn('[GlassesBridge] timeout');
                else console.warn('[GlassesBridge] push failed:', err && err.message);
            })
            .finally(function () {
                if (timeoutId) clearTimeout(timeoutId);
                self._inFlight--;
            });
        }
    };

    if (typeof window !== 'undefined') window.GlassesBridge = GlassesBridge;
})();
