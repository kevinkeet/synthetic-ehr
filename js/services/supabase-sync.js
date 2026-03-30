/**
 * supabase-sync.js
 * Supabase auth + settings sync module for Synthetic EHR.
 * Vanilla JS, no build system required.
 *
 * Expects the Supabase CDN client to be loaded before this script:
 *   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
 *
 * Configuration via globals:
 *   window.__SUPABASE_URL       (default: project URL below)
 *   window.__SUPABASE_ANON_KEY  (required)
 */

const SupabaseSync = (() => {
  // ── Constants ───────────────────────────────────────────────────────
  const DEFAULT_URL = 'https://piwoinyrlicvndpsmtde.supabase.co';

  const SYNC_KEYS = [
    'anthropic-api-key',
    'ai-model-chat',
    'ai-model-analysis',
    'ai-assistant-mode',
    'ai-panel-collapsed',
    'ai-panel-width',
    'copilot-section-collapsed',
    'about-seen',
    'tutorial-seen',
    'patient-voice-id',
    'ai-user-instructions',
  ];

  const SYNC_PREFIXES = ['customPrompt_', 'modePrompt_'];

  const DEBOUNCE_MS = 2000;
  const LOG_PREFIX = '\uD83D\uDD10';  // lock emoji

  // ── Internal state ──────────────────────────────────────────────────
  let _client = null;
  let _user = null;
  let _initialized = false;
  let _saveTimer = null;
  let _originalSetItem = null;

  // ── Helpers ─────────────────────────────────────────────────────────

  function log(...args) {
    console.log(LOG_PREFIX, ...args);
  }

  function warn(...args) {
    console.warn(LOG_PREFIX, ...args);
  }

  function isSyncKey(key) {
    if (SYNC_KEYS.includes(key)) return true;
    return SYNC_PREFIXES.some((p) => key.startsWith(p));
  }

  function collectSyncData() {
    const data = {
      api_key: localStorage.getItem('anthropic-api-key') || null,
      model_preferences: {
        chat: localStorage.getItem('ai-model-chat'),
        analysis: localStorage.getItem('ai-model-analysis'),
        mode: localStorage.getItem('ai-assistant-mode'),
      },
      custom_prompts: {},
      ai_instructions: localStorage.getItem('ai-user-instructions') || null,
      panel_preferences: {
        'ai-panel-collapsed': localStorage.getItem('ai-panel-collapsed'),
        'ai-panel-width': localStorage.getItem('ai-panel-width'),
        'copilot-section-collapsed': localStorage.getItem('copilot-section-collapsed'),
        'about-seen': localStorage.getItem('about-seen'),
        'tutorial-seen': localStorage.getItem('tutorial-seen'),
        'patient-voice-id': localStorage.getItem('patient-voice-id'),
      },
    };

    // Gather custom prompt and mode prompt keys
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.startsWith('customPrompt_') || key.startsWith('modePrompt_'))) {
        data.custom_prompts[key] = localStorage.getItem(key);
      }
    }

    return data;
  }

  // ── Core methods ────────────────────────────────────────────────────

  async function init() {
    if (_initialized) {
      log('Already initialized');
      return;
    }

    if (typeof supabase === 'undefined' || !supabase.createClient) {
      warn('Supabase CDN not loaded. Auth features disabled.');
      _initialized = true;
      window.dispatchEvent(new CustomEvent('supabase:auth-ready', { detail: { user: null } }));
      return;
    }

    const url = window.__SUPABASE_URL || DEFAULT_URL;
    const key = window.__SUPABASE_ANON_KEY;

    if (!key) {
      warn('Missing window.__SUPABASE_ANON_KEY. Auth features disabled.');
      _initialized = true;
      window.dispatchEvent(new CustomEvent('supabase:auth-ready', { detail: { user: null } }));
      return;
    }

    _client = supabase.createClient(url, key);
    log('Client created for', url);

    // Check existing session
    try {
      const { data: { session } } = await _client.auth.getSession();
      if (session && session.user) {
        _user = session.user;
        log('Existing session found for', _user.email);
        await loadSettingsFromCloud();
      }
    } catch (err) {
      warn('Session check failed:', err.message);
    }

    // Listen for auth changes
    _client.auth.onAuthStateChange((event, session) => {
      log('Auth event:', event);
      if (session && session.user) {
        _user = session.user;
        if (event === 'SIGNED_IN') {
          log('Signed in as', _user.email);
          loadSettingsFromCloud();
        }
      } else {
        _user = null;
        if (event === 'SIGNED_OUT') {
          log('Signed out');
        }
      }
      window.dispatchEvent(
        new CustomEvent('supabase:auth-state-change', {
          detail: { event, user: _user },
        })
      );
    });

    patchLocalStorage();
    _initialized = true;
    window.dispatchEvent(new CustomEvent('supabase:auth-ready', { detail: { user: _user } }));
    log('Initialization complete');
  }

  // ── Auth methods ────────────────────────────────────────────────────

  async function signUp(email, password) {
    if (!_client) { warn('Not initialized'); return { error: { message: 'Not initialized' } }; }
    log('Signing up', email);
    const result = await _client.auth.signUp({ email, password });
    if (result.error) warn('Sign-up error:', result.error.message);
    else log('Sign-up successful for', email);
    return result;
  }

  async function signIn(email, password) {
    if (!_client) { warn('Not initialized'); return { error: { message: 'Not initialized' } }; }
    log('Signing in', email);
    const result = await _client.auth.signInWithPassword({ email, password });
    if (result.error) {
      warn('Sign-in error:', result.error.message);
    } else {
      _user = result.data.user;
      log('Signed in as', _user.email);
      await loadSettingsFromCloud();
    }
    return result;
  }

  async function signInWithGoogle() {
    if (!_client) { warn('Not initialized'); return { error: { message: 'Not initialized' } }; }
    log('Initiating Google OAuth');
    return _client.auth.signInWithOAuth({ provider: 'google' });
  }

  async function signOut() {
    if (!_client) { warn('Not initialized'); return; }
    log('Signing out (localStorage preserved)');
    const { error } = await _client.auth.signOut();
    if (error) warn('Sign-out error:', error.message);
    _user = null;
    return { error };
  }

  function getUser() {
    return _user || null;
  }

  function isAuthenticated() {
    return _user !== null;
  }

  // ── Settings sync ───────────────────────────────────────────────────

  async function loadSettingsFromCloud() {
    if (!_client || !_user) return;

    log('Loading settings from cloud for', _user.id);
    try {
      const { data, error } = await _client
        .from('user_settings')
        .select('*')
        .eq('user_id', _user.id)
        .maybeSingle();

      if (error) { warn('Load settings error:', error.message); return; }
      if (!data) { log('No cloud settings found, using local'); return; }

      // api_key
      if (data.api_key) {
        localStorage.setItem('anthropic-api-key', data.api_key);
        if (typeof AICoworker !== 'undefined' && AICoworker.saveApiKey) {
          AICoworker.saveApiKey(data.api_key);
        }
      }

      // model_preferences
      if (data.model_preferences) {
        const mp = data.model_preferences;
        if (mp.chat) localStorage.setItem('ai-model-chat', mp.chat);
        if (mp.analysis) localStorage.setItem('ai-model-analysis', mp.analysis);
        if (mp.mode) localStorage.setItem('ai-assistant-mode', mp.mode);
      }

      // custom_prompts
      if (data.custom_prompts && typeof data.custom_prompts === 'object') {
        for (const [key, value] of Object.entries(data.custom_prompts)) {
          if (key.startsWith('customPrompt_') || key.startsWith('modePrompt_')) {
            localStorage.setItem(key, value);
          }
        }
      }

      // ai_instructions
      if (data.ai_instructions) {
        localStorage.setItem('ai-user-instructions', data.ai_instructions);
      }

      // panel_preferences
      if (data.panel_preferences && typeof data.panel_preferences === 'object') {
        const validKeys = [
          'ai-panel-collapsed', 'ai-panel-width', 'copilot-section-collapsed',
          'about-seen', 'tutorial-seen', 'patient-voice-id',
        ];
        for (const key of validKeys) {
          if (data.panel_preferences[key] != null) {
            localStorage.setItem(key, data.panel_preferences[key]);
          }
        }
      }

      log('Settings loaded from cloud');
      window.dispatchEvent(new CustomEvent('settings:synced-from-cloud', { detail: data }));
    } catch (err) {
      warn('loadSettingsFromCloud exception:', err.message);
    }
  }

  async function saveSettingsToCloud() {
    if (!_client || !_user) return;

    const payload = {
      user_id: _user.id,
      ...collectSyncData(),
      updated_at: new Date().toISOString(),
    };

    log('Saving settings to cloud');
    try {
      const { error } = await _client
        .from('user_settings')
        .upsert(payload, { onConflict: 'user_id' });

      if (error) warn('Save settings error:', error.message);
      else log('Settings saved to cloud');
    } catch (err) {
      warn('saveSettingsToCloud exception:', err.message);
    }
  }

  function debouncedSave() {
    if (!isAuthenticated()) return;
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => {
      saveSettingsToCloud();
    }, DEBOUNCE_MS);
  }

  // ── localStorage interception ───────────────────────────────────────

  function patchLocalStorage() {
    if (_originalSetItem) return; // already patched

    _originalSetItem = localStorage.setItem.bind(localStorage);

    localStorage.setItem = function (key, value) {
      _originalSetItem(key, value);
      if (isSyncKey(key)) {
        debouncedSave();
      }
    };

    log('localStorage.setItem patched for sync');
  }

  // ── Auth UI rendering ───────────────────────────────────────────────

  function renderAuthUI(containerId) {
    const container = document.getElementById(containerId);
    if (!container) {
      warn('renderAuthUI: container not found:', containerId);
      return;
    }

    // Logged-in state
    if (isAuthenticated()) {
      container.innerHTML = `
        <div class="supabase-auth-panel auth-logged-in">
          <p style="margin:0 0 8px">Signed in as <strong>${_escHtml(_user.email)}</strong></p>
          <button class="btn" id="supabase-sign-out-btn">Sign Out</button>
        </div>
      `;
      container.querySelector('#supabase-sign-out-btn').addEventListener('click', async () => {
        await signOut();
        renderAuthUI(containerId);
      });
      return;
    }

    // Logged-out state
    container.innerHTML = `
      <div class="supabase-auth-panel">
        <div class="supabase-auth-tabs" style="display:flex;gap:4px;margin-bottom:12px;">
          <button class="btn btn-primary supabase-tab-btn" data-tab="signin">Sign In</button>
          <button class="btn supabase-tab-btn" data-tab="register">Create Account</button>
        </div>
        <form id="supabase-auth-form" autocomplete="on">
          <div style="margin-bottom:8px;">
            <input type="email" id="supabase-email" placeholder="Email" required
                   style="width:100%;padding:6px 8px;box-sizing:border-box;" />
          </div>
          <div style="margin-bottom:8px;">
            <input type="password" id="supabase-password" placeholder="Password" required
                   minlength="6" style="width:100%;padding:6px 8px;box-sizing:border-box;" />
          </div>
          <button type="submit" class="btn btn-primary" id="supabase-submit-btn"
                  style="width:100%;">Sign In</button>
        </form>
        <div id="supabase-auth-message" style="margin-top:8px;font-size:0.9em;"></div>
      </div>
    `;

    let mode = 'signin'; // 'signin' | 'register'
    const tabs = container.querySelectorAll('.supabase-tab-btn');
    const submitBtn = container.querySelector('#supabase-submit-btn');
    const msgEl = container.querySelector('#supabase-auth-message');
    const form = container.querySelector('#supabase-auth-form');

    function setMode(newMode) {
      mode = newMode;
      tabs.forEach((t) => {
        t.classList.toggle('btn-primary', t.dataset.tab === mode);
      });
      submitBtn.textContent = mode === 'signin' ? 'Sign In' : 'Create Account';
      msgEl.textContent = '';
      msgEl.style.color = '';
    }

    tabs.forEach((t) =>
      t.addEventListener('click', () => setMode(t.dataset.tab))
    );

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = container.querySelector('#supabase-email').value.trim();
      const password = container.querySelector('#supabase-password').value;

      if (!email || !password) return;

      submitBtn.disabled = true;
      submitBtn.textContent = 'Please wait...';
      msgEl.textContent = '';
      msgEl.style.color = '';

      try {
        if (mode === 'signin') {
          const { error } = await signIn(email, password);
          if (error) {
            msgEl.style.color = '#c0392b';
            msgEl.textContent = error.message;
          } else {
            renderAuthUI(containerId); // re-render as logged-in
            return;
          }
        } else {
          const { data, error } = await signUp(email, password);
          if (error) {
            msgEl.style.color = '#c0392b';
            msgEl.textContent = error.message;
          } else if (data && data.user && !data.session) {
            msgEl.style.color = '#27ae60';
            msgEl.textContent = 'Check your email to confirm your account.';
          } else if (data && data.session) {
            renderAuthUI(containerId);
            return;
          }
        }
      } catch (err) {
        msgEl.style.color = '#c0392b';
        msgEl.textContent = 'Unexpected error. Please try again.';
      }

      submitBtn.disabled = false;
      submitBtn.textContent = mode === 'signin' ? 'Sign In' : 'Create Account';
    });
  }

  function _escHtml(str) {
    const el = document.createElement('span');
    el.textContent = str || '';
    return el.innerHTML;
  }

  // ── Public API ──────────────────────────────────────────────────────

  return {
    init,
    signUp,
    signIn,
    signInWithGoogle,
    signOut,
    getUser,
    isAuthenticated,
    loadSettingsFromCloud,
    saveSettingsToCloud,
    debouncedSave,
    patchLocalStorage,
    renderAuthUI,
    get _user() { return _user; },
  };
})();

window.SupabaseSync = SupabaseSync;
