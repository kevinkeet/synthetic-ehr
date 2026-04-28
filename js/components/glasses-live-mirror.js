/**
 * GlassesLiveMirror — live preview of what's currently being rendered to G2.
 *
 * Polls the relay's /state every ~500ms and shows the anchor + bottom in a
 * G2-styled rectangle (green-on-black, monospace, ~2x the actual 576x288 res
 * for visibility). The mirror assumes the plugin is in 'live' mode; if the
 * EHR has asked the plugin to switch modes, that's noted in the header.
 *
 * Replaces the existing SmartGlasses overlay (👓 button) for the in-browser
 * preview workflow. SmartGlasses module remains for order confirmations,
 * voice-command-driven note review, etc.
 */
(function () {
    'use strict';

    var POLL_MS = 500;
    var GREEN = '#6EFF6E';
    var GREEN_DIM = 'rgba(110, 255, 110, 0.5)';

    var GlassesLiveMirror = {
        isOpen: false,
        _pollTimer: null,
        _lastVersion: -1,
        _lastUpdateMs: 0,
        _keyHandler: null,

        toggle: function () {
            if (this.isOpen) this.close();
            else this.open();
        },

        open: function () {
            if (this.isOpen) return;
            this.isOpen = true;
            this._lastVersion = -1;
            this._createOverlay();
            this._poll();
            var self = this;
            this._pollTimer = setInterval(function () { self._poll(); }, POLL_MS);
            this._keyHandler = function (e) { if (e.key === 'Escape') self.close(); };
            document.addEventListener('keydown', this._keyHandler);
        },

        close: function () {
            this.isOpen = false;
            var el = document.getElementById('glasses-live-mirror');
            if (el) el.remove();
            if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = null; }
            if (this._keyHandler) {
                document.removeEventListener('keydown', this._keyHandler);
                this._keyHandler = null;
            }
        },

        _createOverlay: function () {
            var overlay = document.createElement('div');
            overlay.id = 'glasses-live-mirror';
            overlay.style.cssText =
                'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:99998;' +
                'display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif;';

            overlay.innerHTML =
                '<div style="background:#1a1a1a;border-radius:12px;padding:20px;width:920px;max-width:96vw;box-shadow:0 12px 40px rgba(0,0,0,0.5);">' +
                  '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;color:#eee;">' +
                    '<div>' +
                      '<h3 style="margin:0;font-size:16px;font-weight:600;">G2 Live HUD</h3>' +
                      '<div id="lhud-subtitle" style="color:#888;font-size:12px;margin-top:4px;">Mirroring relay — assumes plugin is in <strong style="color:#aaa;">live</strong> mode</div>' +
                    '</div>' +
                    '<button id="lhud-close" style="background:none;border:none;font-size:26px;color:#aaa;cursor:pointer;line-height:1;padding:0 8px;">×</button>' +
                  '</div>' +
                  // The simulated G2 display — 576x288 native, drawn 2x.
                  '<div id="lhud-screen" style="background:#000;border:2px solid #333;border-radius:8px;padding:32px 36px;height:340px;display:flex;flex-direction:column;justify-content:space-between;font-family:\'Menlo\',\'Courier New\',monospace;color:' + GREEN + ';text-shadow:0 0 6px ' + GREEN_DIM + ';position:relative;overflow:hidden;">' +
                    // Top half (anchor)
                    '<div id="lhud-top" style="font-size:26px;line-height:1.25;white-space:pre-wrap;letter-spacing:0.02em;min-height:80px;"></div>' +
                    // Divider for visual reference (matches plugin's two-container split)
                    '<div style="position:absolute;left:36px;right:36px;top:50%;height:1px;background:rgba(110,255,110,0.08);"></div>' +
                    // Bottom half (event/page)
                    '<div id="lhud-bottom" style="font-size:24px;line-height:1.3;white-space:pre-wrap;letter-spacing:0.02em;min-height:80px;"></div>' +
                    // Subtle scanline effect
                    '<div style="position:absolute;inset:0;background:repeating-linear-gradient(0deg,transparent 0,transparent 3px,rgba(0,0,0,0.15) 3px,rgba(0,0,0,0.15) 4px);pointer-events:none;"></div>' +
                  '</div>' +
                  '<div style="display:flex;justify-content:space-between;color:#888;font-size:12px;margin-top:10px;font-family:\'Menlo\',monospace;">' +
                    '<span id="lhud-status">Connecting…</span>' +
                    '<span id="lhud-meta"></span>' +
                  '</div>' +
                  '<div id="lhud-views" style="margin-top:14px;border-top:1px solid #333;padding-top:14px;color:#bbb;font-size:11px;font-family:\'Menlo\',monospace;line-height:1.5;max-height:200px;overflow-y:auto;display:none;"></div>' +
                '</div>';

            document.body.appendChild(overlay);
            var self = this;
            document.getElementById('lhud-close').onclick = function () { self.close(); };
            overlay.addEventListener('click', function (e) { if (e.target === overlay) self.close(); });
        },

        _poll: function () {
            if (!window.GlassesBridge || !GlassesBridge.isEnabled()) {
                this._renderError('GlassesBridge not enabled — open G2 settings.');
                return;
            }
            var c = GlassesBridge.getConfig();
            var url = c.endpoint.replace(/\/+$/, '') + '/state';
            var self = this;
            fetch(url, { headers: { 'X-Glasses-Secret': c.secret }, cache: 'no-store' })
                .then(function (r) {
                    if (!r.ok) throw new Error('relay ' + r.status);
                    return r.json();
                })
                .then(function (s) {
                    self._lastUpdateMs = Date.now();
                    self._render(s);
                })
                .catch(function (err) {
                    self._renderError(err && err.message || 'network error');
                });
        },

        _render: function (s) {
            var topEl = document.getElementById('lhud-top');
            var botEl = document.getElementById('lhud-bottom');
            var statusEl = document.getElementById('lhud-status');
            var metaEl = document.getElementById('lhud-meta');
            var viewsEl = document.getElementById('lhud-views');
            var subtitleEl = document.getElementById('lhud-subtitle');
            if (!topEl) return; // overlay closed

            var top = s.anchor || 'Acting Intern · ready';
            var bottom = s.bottom || ' ';
            topEl.textContent = this._wrap(top, 40, 1);
            botEl.textContent = this._wrap(bottom, 40, 3);

            var ago = s.updatedAt ? Math.max(0, Math.floor((Date.now() - s.updatedAt) / 1000)) : 0;
            statusEl.textContent = '● connected · v' + s.version + ' · last write ' + ago + 's ago';

            var counts = [];
            if (s.views) {
                ['live','dictation','notes','ai','problems','alerts','plan'].forEach(function (k) {
                    var n = (s.views[k] || []).length;
                    if (n > 0) counts.push(k + ':' + n);
                });
            }
            metaEl.textContent = counts.length ? 'views: ' + counts.join('  ') : 'views: (none yet)';

            // Note when EHR has asked plugin to switch modes
            if (s.desiredMode && s.desiredMode !== 'live') {
                subtitleEl.innerHTML = 'Mirroring relay — EHR last asked plugin to switch to <strong style="color:#fbbf24;">' + s.desiredMode + '</strong> mode (modeVersion ' + s.modeVersion + ')';
            } else {
                subtitleEl.innerHTML = 'Mirroring relay — assumes plugin is in <strong style="color:#aaa;">live</strong> mode';
            }

            // Optional: show the per-mode page lists below the screen
            if (s.views) {
                var html = '';
                ['dictation','notes','ai','problems','alerts','plan'].forEach(function (mode) {
                    var pages = s.views[mode] || [];
                    if (!pages.length) return;
                    html += '<div style="margin-bottom:8px;"><span style="color:#fbbf24;text-transform:uppercase;font-weight:600;">' + mode + '</span> <span style="color:#888;">(' + pages.length + ')</span></div>';
                    pages.slice(0, 5).forEach(function (p, i) {
                        html += '<div style="margin-left:12px;color:#999;">' + (i + 1) + '. ' + escHtml(p.line1 || '') + (p.line2 ? '  ·  ' + escHtml(p.line2) : '') + '</div>';
                    });
                    if (pages.length > 5) html += '<div style="margin-left:12px;color:#666;font-style:italic;">… ' + (pages.length - 5) + ' more</div>';
                });
                if (html) {
                    viewsEl.innerHTML = html;
                    viewsEl.style.display = 'block';
                } else {
                    viewsEl.style.display = 'none';
                }
            }
        },

        _renderError: function (msg) {
            var statusEl = document.getElementById('lhud-status');
            if (statusEl) {
                statusEl.style.color = '#fbbf24';
                statusEl.textContent = '⚠ ' + msg;
            }
        },

        _wrap: function (text, maxChars, maxLines) {
            if (!text) return '';
            text = String(text).replace(/\s+/g, ' ').trim();
            if (text.length <= maxChars) return text;
            var words = text.split(' ');
            var lines = [];
            var cur = '';
            for (var i = 0; i < words.length; i++) {
                var w = words[i];
                var cand = cur ? cur + ' ' + w : w;
                if (cand.length <= maxChars) {
                    cur = cand;
                } else {
                    if (cur) lines.push(cur);
                    if (lines.length >= maxLines) { cur = ''; break; }
                    cur = w.length > maxChars ? w.slice(0, maxChars - 1) + '…' : w;
                }
            }
            if (cur && lines.length < maxLines) lines.push(cur);
            if (lines.length === maxLines) {
                var consumed = lines.reduce(function (a, l) { return a + l.length + 1; }, 0);
                if (consumed < text.length) {
                    var last = lines[maxLines - 1];
                    lines[maxLines - 1] = last.length >= maxChars
                        ? last.slice(0, maxChars - 1) + '…'
                        : last + '…';
                }
            }
            return lines.join('\n');
        }
    };

    function escHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
            .replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    if (typeof window !== 'undefined') window.GlassesLiveMirror = GlassesLiveMirror;
})();
