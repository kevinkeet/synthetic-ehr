/**
 * GlassesBridgeWiring — non-invasive integration of GlassesBridge with the EHR.
 *
 * Hooks (monkey-patches) emission points so push-to-G2 happens automatically:
 *   1. AmbientScribe.onExtractionComplete  → push the newest finding as a dictation event
 *   1b. DictationWidget._processFinalText  → push the dictated final text + voice nav commands
 *   2. SmartGlasses.showOrderConfirmation  → push the order as an order event with safety glyph
 *   2b. SmartGlasses.confirmOrder          → push "PLACED" follow-up
 *   3. AICoworker render                   → opportunistically refresh the anchor + push views
 *
 * Voice commands routed to the bridge (in addition to existing in-browser handling):
 *   "show notes" / "review notes"          → setDesiredMode('notes')
 *   "show ai" / "show analysis"            → setDesiredMode('ai')
 *   "show problems" / "show problem list"  → setDesiredMode('problems')
 *   "show alerts" / "show warnings"        → setDesiredMode('alerts')
 *   "show plan" / "show orders"            → setDesiredMode('plan')
 *   "back to live" / "go live" / "go back" → setDesiredMode('live')
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

    function refreshViews() {
        if (!window.GlassesBridge || !GlassesBridge.isEnabled()) return;
        try { GlassesBridge.pushViews(GlassesBridge.buildViews()); }
        catch (e) { console.warn('[GlassesBridgeWiring] pushViews failed:', e); }
    }

    // ---------- Voice command → mode switch ----------
    var MODE_PATTERNS = [
        { mode: 'dictation', re: /\b(show|switch to|go to|display|enter|open)\s+(the\s+)?dictation(\s+mode)?\b/i },
        { mode: 'dictation', re: /\bdictation mode\b/i },
        { mode: 'notes',     re: /\b(show|review|open|switch to|go to|display)\s+(the\s+)?notes?\b/i },
        { mode: 'ai',        re: /\b(show|review|open|switch to|go to|display)\s+(the\s+)?(ai|analysis|assessment)\b/i },
        { mode: 'problems',  re: /\b(show|review|open|switch to|go to|display)\s+(the\s+)?problem(\s+list)?s?\b/i },
        { mode: 'alerts',    re: /\b(show|review|open|switch to|go to|display)\s+(the\s+)?(alert|warning|safety)s?\b/i },
        { mode: 'plan',      re: /\b(show|review|open|switch to|go to|display)\s+(the\s+)?(plan|orders?|recommendations?)\b/i },
        { mode: 'live',      re: /\b(back to live|go live|live mode|exit menu|home|main)\b/i }
    ];

    function detectModeCommand(text) {
        if (!text) return null;
        for (var i = 0; i < MODE_PATTERNS.length; i++) {
            if (MODE_PATTERNS[i].re.test(text)) return MODE_PATTERNS[i].mode;
        }
        return null;
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
                    var newest = findings[findings.length - 1];
                    if (newest && (newest.timestamp || 0) > lastFindingTs) {
                        lastFindingTs = newest.timestamp || Date.now();
                        var glyph = newest.confidence === 'low' ? '?' : '\u2713';
                        var label = newest.type ? newest.type.toUpperCase().slice(0, 4) + ': ' : '';
                        GlassesBridge.pushEvent(GlassesBridge.buildDictationEvent(label + (newest.text || ''), glyph));
                    }
                }
            } catch (e) { console.warn('[GlassesBridgeWiring] scribe hook failed:', e); }
            if (typeof prevHandler === 'function') {
                try { prevHandler.apply(this, arguments); } catch (_) {}
            }
        };
    }

    // ---------- 1b. Dictation widget final text → mode command OR dictation event ----------
    function hookDictationWidget() {
        if (typeof DictationWidget === 'undefined' || !DictationWidget._processFinalText) return;
        var orig = DictationWidget._processFinalText;
        DictationWidget._processFinalText = function (text) {
            var isModeCmd = false;
            try {
                if (window.GlassesBridge && GlassesBridge.isEnabled() && text) {
                    refreshAnchor();
                    var mode = detectModeCommand(text);
                    if (mode) {
                        isModeCmd = true;
                        GlassesBridge.setDesiredMode(mode);
                        // Brief feedback on the bottom line so the doctor sees their command landed.
                        GlassesBridge.pushEvent({ kind: 'dictation', text: '\u2192 ' + mode, glyph: '\u2713' });
                    } else {
                        GlassesBridge.pushEvent(GlassesBridge.buildDictationEvent(text, '\u2713'));
                    }
                }
            } catch (e) { console.warn('[GlassesBridgeWiring] dictation hook failed:', e); }

            var result = orig.apply(this, arguments);

            // After original runs, dictationHistory is populated → refresh views
            // so the dictation-mode page list reflects this utterance immediately.
            if (!isModeCmd) {
                try {
                    if (window.GlassesBridge && GlassesBridge.isEnabled()) refreshViews();
                } catch (e) { console.warn('[GlassesBridgeWiring] post-dictation views refresh failed:', e); }
            }
            return result;
        };
    }

    // ---------- 1c. Agentic action triggers from DictationWidget → G2 feedback ----------
    // The dictation widget routes voice commands to actions (place order, draft
    // note, message nurse/patient). Each action talks to OTHER subsystems
    // (OrderEntry, AICoworker, FloatingChat) — hooking them here means the
    // doctor sees on-G2 feedback whether or not the laptop UI is in view.
    function hookDictationActions() {
        if (typeof DictationWidget === 'undefined') return;

        // Order parsing → confirmation pending
        var origShowOrder = DictationWidget._showOrderConfirmation;
        if (typeof origShowOrder === 'function') {
            DictationWidget._showOrderConfirmation = function (order) {
                try {
                    if (window.GlassesBridge && GlassesBridge.isEnabled() && order) {
                        var summary = order.summary || (order.details && order.details.name) || order.type || 'order';
                        var glyph = (order._safety && order._safety.safe === false) ? '⚠' : '?';
                        GlassesBridge.pushEvent({
                            kind: 'order',
                            text: GlassesBridge._compress('CONFIRM? ' + summary, 100),
                            glyph: glyph
                        });
                    }
                } catch (e) { console.warn('[GlassesBridgeWiring] _showOrderConfirmation hook failed:', e); }
                return origShowOrder.apply(this, arguments);
            };
        }

        // Voice "confirm" → order placed
        var origConfirmOrder = DictationWidget._confirmCurrentOrder;
        if (typeof origConfirmOrder === 'function') {
            DictationWidget._confirmCurrentOrder = function () {
                var pending = DictationWidget._activeConfirmation;
                var result = origConfirmOrder.apply(this, arguments);
                try {
                    if (window.GlassesBridge && GlassesBridge.isEnabled() && pending) {
                        var summary = pending.summary || (pending.details && pending.details.name) || pending.type || 'order';
                        GlassesBridge.pushEvent({
                            kind: 'order',
                            text: GlassesBridge._compress('PLACED ' + summary, 100),
                            glyph: '✓'
                        });
                        // Refresh views so plan mode reflects the new order
                        refreshViews();
                    }
                } catch (e) { console.warn('[GlassesBridgeWiring] _confirmCurrentOrder hook failed:', e); }
                return result;
            };
        }

        // Voice "cancel" → order cancelled
        var origCancelOrder = DictationWidget._cancelCurrentOrder;
        if (typeof origCancelOrder === 'function') {
            DictationWidget._cancelCurrentOrder = function () {
                var pending = DictationWidget._activeConfirmation;
                var result = origCancelOrder.apply(this, arguments);
                try {
                    if (window.GlassesBridge && GlassesBridge.isEnabled() && pending) {
                        var summary = pending.summary || (pending.details && pending.details.name) || pending.type || 'order';
                        GlassesBridge.pushEvent({
                            kind: 'alert',
                            text: GlassesBridge._compress('CANCELLED ' + summary, 100),
                            glyph: '✗'
                        });
                    }
                } catch (e) { console.warn('[GlassesBridgeWiring] _cancelCurrentOrder hook failed:', e); }
                return result;
            };
        }

        // "Write a note" → drafting feedback
        var origWriteNote = DictationWidget._triggerWriteNote;
        if (typeof origWriteNote === 'function') {
            DictationWidget._triggerWriteNote = function (text) {
                try {
                    if (window.GlassesBridge && GlassesBridge.isEnabled()) {
                        var noteType = 'progress';
                        if (/instruction/i.test(text)) noteType = 'patient instructions';
                        else if (/letter/i.test(text)) noteType = 'patient letter';
                        else if (/h\s*(?:and|&)\s*p|(?:^|\s)hp\b/i.test(text)) noteType = 'H&P';
                        else if (/discharge/i.test(text)) noteType = 'discharge';
                        else if (/consult/i.test(text)) noteType = 'consult';
                        GlassesBridge.pushEvent({
                            kind: 'order',
                            text: '✎ Drafting ' + noteType + ' note',
                            glyph: '✓'
                        });
                    }
                } catch (e) { console.warn('[GlassesBridgeWiring] _triggerWriteNote hook failed:', e); }
                return origWriteNote.apply(this, arguments);
            };
        }

        // "Message the nurse / patient" → chat feedback
        ['_triggerMessageNurse', '_triggerMessagePatient'].forEach(function (fn) {
            var orig = DictationWidget[fn];
            if (typeof orig !== 'function') return;
            var who = fn === '_triggerMessageNurse' ? 'nurse' : 'patient';
            DictationWidget[fn] = function (context) {
                try {
                    if (window.GlassesBridge && GlassesBridge.isEnabled()) {
                        var preview = (context || '').toString().trim().slice(0, 60);
                        GlassesBridge.pushEvent({
                            kind: 'order',
                            text: '💬 ' + who + (preview ? ': ' + preview : ' chat opened'),
                            glyph: '✓'
                        });
                    }
                } catch (e) { console.warn('[GlassesBridgeWiring] ' + fn + ' hook failed:', e); }
                return orig.apply(this, arguments);
            };
        });

        // AICoworker.draftSpecificNote / draftContextualNote completion (if exposed)
        if (typeof AICoworker !== 'undefined') {
            ['draftSpecificNote', 'draftContextualNote'].forEach(function (fn) {
                var orig = AICoworker[fn];
                if (typeof orig !== 'function') return;
                AICoworker[fn] = function () {
                    try {
                        if (window.GlassesBridge && GlassesBridge.isEnabled()) {
                            var noteType = arguments[0] || 'note';
                            GlassesBridge.pushEvent({
                                kind: 'order',
                                text: '✎ Note draft ready: ' + noteType,
                                glyph: '✓'
                            });
                        }
                    } catch (e) { console.warn('[GlassesBridgeWiring] ' + fn + ' hook failed:', e); }
                    return orig.apply(this, arguments);
                };
            });
        }
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

    // ---------- 3. Periodic anchor + views refresh ----------
    function startBackgroundRefresh() {
        // Anchor every 3s (cheap, dedupes if unchanged).
        setInterval(refreshAnchor, 3000);
        // Views every 5s (slightly more expensive payload, dedupes via JSON compare).
        setInterval(refreshViews, 5000);
    }

    function init() {
        whenReady(function () { return typeof AmbientScribe !== 'undefined'; }, hookAmbientScribe);
        whenReady(function () { return typeof DictationWidget !== 'undefined' && DictationWidget._processFinalText; }, hookDictationWidget);
        whenReady(function () { return typeof DictationWidget !== 'undefined' && DictationWidget._showOrderConfirmation; }, hookDictationActions);
        whenReady(function () { return typeof SmartGlasses !== 'undefined' && SmartGlasses.showOrderConfirmation; }, hookOrderConfirmation);
        whenReady(function () { return typeof AICoworker !== 'undefined'; }, startBackgroundRefresh);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
