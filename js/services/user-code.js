/**
 * UserCode — self-chosen resident identifier used in place of a Supabase
 * user account. Lives in localStorage; surfaces a modal to collect the code
 * the first time the resident tries to begin an assessment.
 *
 * Format rules (enforced both here and by the DB check constraint):
 *   - 3 to 32 chars
 *   - letters, digits, underscore, hyphen only
 *
 * Public surface:
 *   UserCode.get()                → current code or null
 *   UserCode.set(code)            → store after validating
 *   UserCode.clear()              → forget it
 *   UserCode.prompt({reason})     → show modal; resolves to the chosen code,
 *                                   or rejects if user cancels
 *   UserCode.isAdmin()            → true if the Supabase-authed user is in
 *                                   admin_roles (no code prompt for admins)
 */

(() => {
    const STORAGE_KEY = 'user-code';
    const VALIDATION_RE = /^[A-Za-z0-9_-]{3,32}$/;

    function get() {
        const v = localStorage.getItem(STORAGE_KEY);
        return v && VALIDATION_RE.test(v) ? v : null;
    }

    function set(code) {
        if (!code || typeof code !== 'string') {
            throw new Error('Code is required');
        }
        const trimmed = code.trim();
        if (!VALIDATION_RE.test(trimmed)) {
            throw new Error('Code must be 3–32 characters, letters/digits/underscore/hyphen only.');
        }
        localStorage.setItem(STORAGE_KEY, trimmed);
        return trimmed;
    }

    function clear() {
        localStorage.removeItem(STORAGE_KEY);
    }

    function isAdmin() {
        // Best-effort sync check — relies on AdminDashboard having loaded
        // the role flag earlier. For a hard check, query Supabase directly.
        return !!localStorage.getItem('user-is-admin');
    }

    // ── modal ──
    function _buildModal(reason) {
        const overlay = document.createElement('div');
        overlay.id = 'user-code-overlay';
        overlay.innerHTML = `
            <div class="user-code-card" role="dialog" aria-modal="true" aria-labelledby="user-code-title">
                <div class="user-code-brand">Acting Intern</div>
                <h1 id="user-code-title" class="user-code-title">Choose your code</h1>
                <p class="user-code-sub">
                    ${reason || 'Before you begin, pick a code to identify yourself. Your scores and chatbot interactions will be saved under this code so a proctor can review them later.'}
                </p>
                <p class="user-code-rules">
                    3–32 characters. Letters, digits, <code>_</code>, <code>-</code>. Examples:
                    <code>DR-ALICE</code>, <code>resident_07</code>, <code>HS_2026_KEVIN</code>.
                </p>
                <form id="user-code-form" autocomplete="off">
                    <input
                        id="user-code-input"
                        type="text"
                        placeholder="your-code"
                        autocomplete="username"
                        spellcheck="false"
                        autocapitalize="off"
                        autofocus
                        maxlength="32"
                    >
                    <button type="submit" id="user-code-submit">Save and continue</button>
                </form>
                <div id="user-code-error" class="user-code-error" aria-live="polite"></div>
                <div class="user-code-foot">
                    Your code is stored only in this browser. To switch identities, clear your browser data or
                    <a href="#" id="user-code-clear-link">use a different code</a>.
                </div>
            </div>
        `;
        return overlay;
    }

    function _showError(msg) {
        const el = document.getElementById('user-code-error');
        if (el) el.textContent = msg || '';
    }

    function _dismissModal() {
        const ov = document.getElementById('user-code-overlay');
        if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
        document.body.classList.remove('user-code-active');
    }

    function prompt(opts) {
        const reason = opts && opts.reason;
        return new Promise((resolve, reject) => {
            // If already set, return immediately unless caller asks to force.
            if (!opts?.force) {
                const existing = get();
                if (existing) return resolve(existing);
            }

            const overlay = _buildModal(reason);
            document.body.appendChild(overlay);
            document.body.classList.add('user-code-active');

            const form = document.getElementById('user-code-form');
            const input = document.getElementById('user-code-input');
            const clearLink = document.getElementById('user-code-clear-link');

            // Prefill with existing code if forcing
            if (opts?.force && get()) input.value = get();

            form.addEventListener('submit', (e) => {
                e.preventDefault();
                const value = input.value;
                try {
                    const saved = set(value);
                    _dismissModal();
                    resolve(saved);
                } catch (err) {
                    _showError(err.message);
                    input.focus();
                    input.select();
                }
            });

            clearLink.addEventListener('click', (e) => {
                e.preventDefault();
                input.value = '';
                _showError('');
                input.focus();
            });
        });
    }

    window.UserCode = { get, set, clear, prompt, isAdmin };
})();
