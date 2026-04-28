/**
 * GlassesBridgeWiring — non-invasive integration of GlassesBridge with the EHR.
 *
 * Hooks (monkey-patches) three existing emission points:
 *   1. AmbientScribe.onExtractionComplete  → push the newest finding as a dictation event
 *   2. SmartGlasses.showOrderConfirmation  → push the order as an order event with safety glyph
 *   3. AICoworker render                   → opportunistically refresh the anchor
 *
 * All hooks chain to existing handlers — they never replace them.
 */
(function () {
    'use strict';

    function whenReady(check, fn, maxTries) {
        var tries = 0;
        var max = maxTries || 100;
        var iv = setInterval(function () {
            tries++;
            if (check()) { clearInterval(iv); fn(); return; }
            if (tries > max) clearInterval(iv);
        }, 200);
    }

    function refreshAnchor() {
        if (!window.GlassesBridge || !GlassesBridge.isEnabled()) return;
        var a = GlassesBridge.buildAnchor();
        if (a) GlassesBridge.setAnchor(a);
    }

    // ---------- 1. Ambient scribe extraction → dictation event ----------
    function hookAmbientScribe() {
        if (typeof AmbientScribe === 'undefined') return;

        var prevHandler = AmbientScribe.onExtractionComplete;
        var lastFindingTs = 0;

        AmbientScribe.onExtractionComplete = function () {
            try {
                if (window.GlassesBridge && GlassesBridge.isEnabled()) {
                    refreshAnchor();
                    var findings = AmbientScribe.extractedFindings || [];
                    // Pick the newest finding we haven't pushed yet.
                    for (var i = findings.length - 1; i >= 0; i--) {
                        var f = findings[i];
                        var ts = f.timestamp || 0;
                        if (ts <= lastFindingTs) break;
                    }
                    var newest = findings[findings.length - 1];
                    if (newest && (newest.timestamp || 0) > lastFindingTs) {
                        lastFindingTs = newest.timestamp || Date.now();
                        var glyph = newest.confidence === 'low' ? '?' : '\u2713';
                        var label = newest.type ? newest.type.toUpperCase().slice(0, 4) + ': ' : '';
                        GlassesBridge.pushEvent(
                            GlassesBridge.buildDictationEvent(label + (newest.text || ''), glyph)
                        );
                    }
                }
            } catch (e) { console.warn('[GlassesBridgeWiring] scribe hook failed:', e); }

            if (typeof prevHandler === 'function') {
                try { prevHandler.apply(this, arguments); } catch (_) {}
            }
        };
    }

    // ---------- 1b. Dictation widget final text → dictation event ----------
    function hookDictationWidget() {
        if (typeof DictationWidget === 'undefined' || !DictationWidget._processFinalText) return;
        var orig = DictationWidget._processFinalText;
        DictationWidget._processFinalText = function (text) {
            try {
                if (window.GlassesBridge && GlassesBridge.isEnabled() && text) {
                    refreshAnchor();
                    GlassesBridge.pushEvent(GlassesBridge.buildDictationEvent(text, '\u2713'));
                }
            } catch (e) { console.warn('[GlassesBridgeWiring] dictation hook failed:', e); }
            return orig.apply(this, arguments);
        };
    }

    // ---------- 2. Order confirmation → order event ----------
    function hookOrderConfirmation() {
        if (typeof SmartGlasses === 'undefined') return;

        var origShow = SmartGlasses.showOrderConfirmation;
        if (!origShow) return;

        SmartGlasses.showOrderConfirmation = function (orderData) {
            try {
                if (window.GlassesBridge && GlassesBridge.isEnabled() && orderData) {
                    refreshAnchor();
                    var ev = GlassesBridge.buildOrderEvent(orderData);
                    if (ev) GlassesBridge.pushEvent(ev);
                }
            } catch (e) { console.warn('[GlassesBridgeWiring] order hook failed:', e); }
            return origShow.apply(this, arguments);
        };

        var origConfirm = SmartGlasses.confirmOrder;
        if (origConfirm) {
            SmartGlasses.confirmOrder = function () {
                var pending = SmartGlasses._orderConfirmation;
                var result = origConfirm.apply(this, arguments);
                try {
                    if (window.GlassesBridge && GlassesBridge.isEnabled() && pending) {
                        var name = (pending.details && pending.details.name) || pending.summary || 'order';
                        GlassesBridge.pushEvent({
                            kind: 'order',
                            text: GlassesBridge._compress('PLACED ' + name, 32),
                            glyph: '\u2713'
                        });
                    }
                } catch (e) { console.warn('[GlassesBridgeWiring] confirm hook failed:', e); }
                return result;
            };
        }
    }

    // ---------- 3. Periodic anchor refresh (chart opens, AI updates) ----------
    function startAnchorRefresh() {
        // Cheap: builds the string from existing in-memory state, dedupes via _lastAnchor.
        setInterval(refreshAnchor, 3000);
    }

    function init() {
        whenReady(function () { return typeof AmbientScribe !== 'undefined'; }, hookAmbientScribe);
        whenReady(function () { return typeof DictationWidget !== 'undefined' && DictationWidget._processFinalText; }, hookDictationWidget);
        whenReady(function () { return typeof SmartGlasses !== 'undefined' && SmartGlasses.showOrderConfirmation; }, hookOrderConfirmation);
        whenReady(function () { return typeof AICoworker !== 'undefined'; }, startAnchorRefresh);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
