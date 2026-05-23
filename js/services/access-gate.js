/**
 * AccessGate — password-protected entry to the app, with the Anthropic API key
 * encrypted under that password and embedded in the build.
 *
 * Flow on page load:
 *   1. If window.ACCESS_CONFIG is missing → gate is disabled; app behaves as before.
 *   2. If localStorage 'access-granted' is true → assume previously unlocked,
 *      do nothing. (The key was written to localStorage on the original unlock,
 *      so existing app code paths find it.)
 *   3. Otherwise → render full-screen modal blocking the page. User enters the
 *      password; we derive a PBKDF2 key, decrypt the ciphertext via AES-GCM,
 *      and on success store the API key in localStorage under
 *      'anthropic-api-key' (matching the existing app convention).
 *
 * Failed-attempt lockout (sessionStorage so it resets when the tab closes):
 *   - 0–2 attempts: no delay
 *   - 3–5: 30s lockout
 *   - 6–8: 5m lockout
 *   - 9+:  30m lockout
 */

(() => {
    const STORAGE_KEY_GRANTED = 'access-granted';
    const STORAGE_KEY_API = 'anthropic-api-key';
    const SESSION_KEY_ATTEMPTS = 'accessGate.attempts';
    const SESSION_KEY_LOCKED_UNTIL = 'accessGate.lockedUntil';

    // ── lockout schedule ──
    function lockoutMsForAttemptCount(n) {
        if (n < 3) return 0;
        if (n < 6) return 30 * 1000;
        if (n < 9) return 5 * 60 * 1000;
        return 30 * 60 * 1000;
    }

    function readAttempts() {
        const n = parseInt(sessionStorage.getItem(SESSION_KEY_ATTEMPTS) || '0', 10);
        return Number.isFinite(n) ? n : 0;
    }
    function bumpAttempts() {
        const n = readAttempts() + 1;
        sessionStorage.setItem(SESSION_KEY_ATTEMPTS, String(n));
        const wait = lockoutMsForAttemptCount(n);
        if (wait > 0) sessionStorage.setItem(SESSION_KEY_LOCKED_UNTIL, String(Date.now() + wait));
        return n;
    }
    function clearAttempts() {
        sessionStorage.removeItem(SESSION_KEY_ATTEMPTS);
        sessionStorage.removeItem(SESSION_KEY_LOCKED_UNTIL);
    }
    function lockedRemainingMs() {
        const until = parseInt(sessionStorage.getItem(SESSION_KEY_LOCKED_UNTIL) || '0', 10);
        if (!until) return 0;
        return Math.max(0, until - Date.now());
    }

    // ── base64 helpers ──
    function b64ToBytes(b64) {
        const bin = atob(b64);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        return arr;
    }

    // ── crypto ──
    async function deriveKey(password, saltBytes, iterations) {
        const enc = new TextEncoder();
        const baseKey = await crypto.subtle.importKey(
            'raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveKey']
        );
        return crypto.subtle.deriveKey(
            { name: 'PBKDF2', salt: saltBytes, iterations, hash: 'SHA-256' },
            baseKey,
            { name: 'AES-GCM', length: 256 },
            false,
            ['decrypt']
        );
    }

    async function tryDecrypt(password, cfg) {
        const salt = b64ToBytes(cfg.salt);
        const iv = b64ToBytes(cfg.iv);
        const blob = b64ToBytes(cfg.cipher);
        const iterations = (cfg.kdf && cfg.kdf.iterations) || 250000;
        const key = await deriveKey(password, salt, iterations);
        // AES-GCM ciphertext+authTag is concatenated; WebCrypto expects them joined.
        const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, blob);
        return new TextDecoder().decode(pt);
    }

    // ── modal UI ──
    function buildModal() {
        const overlay = document.createElement('div');
        overlay.id = 'access-gate-overlay';
        overlay.innerHTML = `
            <div class="access-gate-card" role="dialog" aria-modal="true" aria-labelledby="access-gate-title">
                <div class="access-gate-brand">Acting Intern</div>
                <h1 id="access-gate-title" class="access-gate-title">Enter access password</h1>
                <p class="access-gate-sub">
                    This is a private demo. Ask the person who shared the link for the password.
                </p>
                <form id="access-gate-form" autocomplete="off">
                    <input
                        id="access-gate-input"
                        type="password"
                        placeholder="Password"
                        autocomplete="current-password"
                        spellcheck="false"
                        autofocus
                    >
                    <button type="submit" id="access-gate-submit">Unlock</button>
                </form>
                <div id="access-gate-error" class="access-gate-error" aria-live="polite"></div>
                <div class="access-gate-foot">
                    Or <a href="#" id="access-gate-byok">use your own Anthropic API key</a>.
                </div>
            </div>
        `;
        return overlay;
    }

    function showError(msg) {
        const el = document.getElementById('access-gate-error');
        if (el) el.textContent = msg || '';
    }

    function setBusy(isBusy) {
        const btn = document.getElementById('access-gate-submit');
        const inp = document.getElementById('access-gate-input');
        if (btn) {
            btn.disabled = isBusy;
            btn.textContent = isBusy ? 'Checking…' : 'Unlock';
        }
        if (inp) inp.disabled = isBusy;
    }

    function startLockoutCountdown(remainingMs, onDone) {
        setBusy(true);
        const tick = () => {
            const left = lockedRemainingMs();
            if (left <= 0) {
                showError('');
                setBusy(false);
                const inp = document.getElementById('access-gate-input');
                if (inp) inp.focus();
                onDone && onDone();
                return;
            }
            const s = Math.ceil(left / 1000);
            const mins = Math.floor(s / 60);
            const secs = s % 60;
            const human = mins > 0 ? `${mins}m ${secs}s` : `${s}s`;
            showError(`Too many attempts. Try again in ${human}.`);
            setTimeout(tick, 500);
        };
        tick();
    }

    function dismissModal() {
        const ov = document.getElementById('access-gate-overlay');
        if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
        document.body.classList.remove('access-gate-active');
    }

    // ── BYO key path ──
    function handleByokClick(e) {
        e.preventDefault();
        const k = window.prompt('Paste your Anthropic API key (sk-ant-…). Stored only in this browser.');
        if (!k) return;
        const trimmed = k.trim();
        if (!trimmed.startsWith('sk-ant-')) {
            showError('That does not look like an Anthropic API key.');
            return;
        }
        localStorage.setItem(STORAGE_KEY_API, trimmed);
        localStorage.setItem(STORAGE_KEY_GRANTED, 'byo');
        dismissModal();
    }

    async function attemptUnlock(password, cfg) {
        const lockedFor = lockedRemainingMs();
        if (lockedFor > 0) {
            startLockoutCountdown(lockedFor);
            return;
        }
        setBusy(true);
        showError('');
        try {
            const apiKey = await tryDecrypt(password, cfg);
            // Sanity check — Anthropic keys start with sk-ant
            if (!apiKey || !apiKey.startsWith('sk-ant-')) {
                throw new Error('Decryption succeeded but produced an unexpected value.');
            }
            // Only populate the user-facing key slot if it's empty — never overwrite
            // a user-supplied key from settings.
            if (!localStorage.getItem(STORAGE_KEY_API)) {
                localStorage.setItem(STORAGE_KEY_API, apiKey);
            }
            localStorage.setItem(STORAGE_KEY_GRANTED, 'gate');
            clearAttempts();
            dismissModal();
        } catch (err) {
            const n = bumpAttempts();
            const wait = lockoutMsForAttemptCount(n);
            if (wait > 0) {
                startLockoutCountdown(wait);
            } else {
                showError('Incorrect password.');
                setBusy(false);
                const inp = document.getElementById('access-gate-input');
                if (inp) { inp.value = ''; inp.focus(); }
            }
        }
    }

    function mount() {
        document.body.appendChild(buildModal());
        document.body.classList.add('access-gate-active');
        const form = document.getElementById('access-gate-form');
        const input = document.getElementById('access-gate-input');
        const byok = document.getElementById('access-gate-byok');
        if (byok) byok.addEventListener('click', handleByokClick);
        if (form) form.addEventListener('submit', (e) => {
            e.preventDefault();
            const pw = input ? input.value : '';
            if (!pw) return;
            attemptUnlock(pw, window.ACCESS_CONFIG);
        });
        // Honor any pre-existing lockout from a previous tab session in this browser.
        const lockedFor = lockedRemainingMs();
        if (lockedFor > 0) startLockoutCountdown(lockedFor);
    }

    // ── boot ──
    function shouldGate() {
        if (!window.ACCESS_CONFIG || !window.ACCESS_CONFIG.cipher) return false;
        if (localStorage.getItem(STORAGE_KEY_GRANTED)) return false;
        return true;
    }

    function init() {
        if (!shouldGate()) return;
        if (document.body) {
            mount();
        } else {
            document.addEventListener('DOMContentLoaded', mount, { once: true });
        }
    }

    // Expose a tiny API for the "lock" icon in the header.
    window.AccessGate = {
        lock() {
            localStorage.removeItem(STORAGE_KEY_GRANTED);
            localStorage.removeItem(STORAGE_KEY_API);
            location.reload();
        },
        isGranted() { return !!localStorage.getItem(STORAGE_KEY_GRANTED); },
    };

    init();
})();
