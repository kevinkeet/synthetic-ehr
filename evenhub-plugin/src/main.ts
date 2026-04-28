/**
 * Acting Intern G2 plugin entry point.
 *
 * Runs inside the Even Realities phone app WebView. Three jobs:
 *
 * 1. Render the live HUD: pulls {anchor, bottom} from the relay every 500ms
 *    and updates two stacked TextContainerProperty regions on G2.
 *
 * 2. Multi-view navigation: the relay also carries a `views` payload
 *    (notes / ai / problems / alerts / plan). Ring scroll = page within mode,
 *    single click = cycle mode, double click = back to live. EHR can also
 *    set `desiredMode` (e.g. on voice command "show notes") which we honor.
 *
 * 3. G2 mic → Deepgram → relay: opens the G2 mic, streams PCM s16le 16kHz mono
 *    over a Deepgram WebSocket, posts final transcripts back to the relay so
 *    the EHR can act on them as if they came from the laptop mic.
 */

import {
  waitForEvenAppBridge,
  TextContainerProperty,
  CreateStartUpPageContainer,
  TextContainerUpgrade,
  EvenAppBridge,
  OsEventTypeList,
  type EvenHubEvent,
} from '@evenrealities/even_hub_sdk';

// Injected by Vite at build time (see vite.config.ts).
declare const __APP_VERSION__: string;
declare const __BUILD_TIME_ISO__: string;

function buildBadgeHtml(): string {
  let timeStr = __BUILD_TIME_ISO__;
  try {
    const d = new Date(__BUILD_TIME_ISO__);
    timeStr = d.toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit', timeZoneName: 'short'
    });
  } catch { /* fall through to ISO string */ }
  return `<div style="font-family:system-ui;font-size:11px;color:#888;text-align:center;padding:8px 12px;border-bottom:1px solid #eee;background:#fafafa;">
    Acting Intern <strong style="color:#2563eb;">v${__APP_VERSION__}</strong>
    <span style="color:#bbb;margin:0 6px;">·</span>
    built ${timeStr}
  </div>`;
}

// ---------- Config & local state ----------

type Config = { relay: string; secret: string; deepgramKey: string };

type Mode = 'live' | 'dictation' | 'notes' | 'ai' | 'problems' | 'alerts' | 'plan';
// Single tap from live → dictation (most-used after live), then through the rest.
const MODE_CYCLE: Mode[] = ['live', 'dictation', 'notes', 'ai', 'problems', 'alerts', 'plan'];

type ViewPage = {
  // Old shape (still supported for back-compat with older EHR builds)
  line1?: string;
  line2?: string;
  // New shape
  title?: string;
  text?: string;
  bullets?: string[];
};
type PendingAction = { kind: string; summary: string; glyph?: string } | null;

type RelayState = {
  anchor: string;
  bottom: string;
  views: Record<Mode, ViewPage[]>;
  desiredMode: Mode | null;
  modeVersion: number;
  version: number;
  transcriptHead: number;
  pendingAction: PendingAction;
  updatedAt: number;
};

const STORAGE_KEY = 'acting-intern-glasses-config-v1';
const POLL_INTERVAL_MS = 500;
const PRESENCE_POST_DEBOUNCE_MS = 200;
// Single full-screen container instead of two halves — eliminates the blank
// gap between top + bottom that appeared when content was shorter than
// either container's fixed height.
const MAIN_CONTAINER_ID = 1;
const G2_MAX_LINE = 42; // a touch wider since we now use full width minus padding
// Pre-filled in the setup form so the user only ever types the secret + Deepgram key.
const RELAY_DEFAULT = 'https://acting-intern-relay.kevinkeet.workers.dev';
// Build-time baked secret matching the EHR's BAKED_DEFAULTS — auto-starts the
// plugin without a setup form on first launch (simulator + .ehpk reinstall).
// Anyone who installs this .ehpk gets the same auth as the EHR; rotate the
// secret on the relay to revoke.
const SECRET_DEFAULT = '59e10ba81146f1ad82b254e590f2734ae6bc92d9561ea23b244dc667386ffd16';

const localState = {
  mode: 'live' as Mode,
  page: 0,
  scrollOffset: 0,        // line offset within current page's wrapped content
  lastSeenModeVersion: -1,
  relay: null as RelayState | null,
  lastTop: '',
  lastBottom: '',
};

// Calibrated against the official Even Hub simulator screenshot: at default
// font + zero padding, the 576x288 container fits ~7 lines comfortably.
// (Was over-corrected to 3 after misinterpreting earlier two-container
// behavior — single container + this count is the right balance.)
const VISIBLE_LINES = 7;
// Non-live modes spend one line on the header, leaving 6 for content.
const VISIBLE_LINES_NONLIVE_CONTENT = VISIBLE_LINES - 1;

// Short, all-caps mode labels for the header so the user always knows which
// section they're in even when content scrolls.
const MODE_LABELS: Record<Mode, string> = {
  live: 'LIVE',
  dictation: 'DICTATION',
  notes: 'NOTES',
  ai: 'AI',
  problems: 'PROBLEMS',
  alerts: 'ALERTS',
  plan: 'PLAN',
};

let bridge: EvenAppBridge | null = null;
let cfg: Config | null = null;
let dgWs: WebSocket | null = null;
let dgConnecting = false;

/**
 * Persistent storage uses the Even app's `bridge.setLocalStorage` /
 * `bridge.getLocalStorage` rather than the WebView's native localStorage.
 * The WebView clears its own localStorage when the .ehpk is reinstalled;
 * the SDK-managed store survives reinstalls so the user only configures once.
 *
 * On first load we also try the browser localStorage as a one-time fallback
 * so users who set up under the old plugin version don't have to re-enter.
 */
async function readConfig(): Promise<Config | null> {
  if (!bridge) return null;
  let raw = '';
  try { raw = (await bridge.getLocalStorage(STORAGE_KEY)) || ''; }
  catch (e) { console.warn('[plugin] bridge.getLocalStorage failed:', e); }

  if (!raw) {
    // One-time migration from old WebView-localStorage config.
    try {
      const legacy = localStorage.getItem(STORAGE_KEY);
      if (legacy) { raw = legacy; await writeConfigRaw(legacy); console.log('[plugin] migrated config from WebView localStorage'); }
    } catch { /* ignore */ }
  }
  if (!raw) return null;
  try {
    const c = JSON.parse(raw);
    if (!c.relay || !c.secret) return null;
    return {
      relay: String(c.relay).replace(/\/+$/, ''),
      secret: String(c.secret),
      deepgramKey: String(c.deepgramKey || ''),
    };
  } catch { return null; }
}

async function writeConfig(c: Config) {
  await writeConfigRaw(JSON.stringify(c));
}

async function writeConfigRaw(raw: string) {
  if (!bridge) return;
  try { await bridge.setLocalStorage(STORAGE_KEY, raw); }
  catch (e) { console.warn('[plugin] bridge.setLocalStorage failed:', e); }
  // Mirror to WebView localStorage too — defense in depth.
  try { localStorage.setItem(STORAGE_KEY, raw); } catch { /* ignore */ }
}

function escAttr(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function secretFingerprint(s: string): string {
  if (!s) return 'no secret set';
  const n = s.length;
  if (n <= 8) return 'len ' + n + ' (too short to fingerprint)';
  return 'len ' + n + ' · ends in …' + escAttr(s.slice(-8));
}

function fit(s: string, max = G2_MAX_LINE): string {
  if (!s) return '';
  s = String(s);
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

/**
 * Split text into word-wrapped lines (no truncation, returns full array).
 * Caller decides how many lines to render; ring scroll moves the visible window.
 */
function wrapLines(text: string, maxCharsPerLine = G2_MAX_LINE): string[] {
  if (!text) return [];
  const t = String(text).replace(/\s+/g, ' ').trim();
  if (!t) return [];
  if (t.length <= maxCharsPerLine) return [t];
  const words = t.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const candidate = cur ? cur + ' ' + w : w;
    if (candidate.length <= maxCharsPerLine) {
      cur = candidate;
    } else {
      if (cur) lines.push(cur);
      // Single word longer than a line — hard-break it.
      cur = w.length > maxCharsPerLine ? w.slice(0, maxCharsPerLine - 1) + '…' : w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function setStatus(html: string) {
  const el = document.getElementById('status');
  if (el) el.innerHTML = html;
}

// ---------- Setup form ----------

function renderSetupForm(initial: Partial<Config>) {
  setStatus(`
    ${buildBadgeHtml()}
    <div style="max-width:520px;margin:0 auto;font-family:system-ui;padding:16px;">
      <h2 style="margin:0 0 8px;font-size:18px;">Acting Intern HUD setup</h2>
      <p style="margin:0 0 16px;color:#555;font-size:13px;line-height:1.4;">
        Enter the same relay URL + shared secret you set in the EHR's G2 settings.
        The Deepgram key powers G2-mic dictation; leave blank to disable that feature.
      </p>
      <label style="display:block;margin-bottom:12px;font-size:13px;">
        Relay URL <span style="color:#888;font-weight:400;">(prefilled — change only if you redeployed)</span>
        <input id="cfg-relay" type="url" value="${escAttr(initial.relay || RELAY_DEFAULT)}"
          style="display:block;width:100%;padding:8px;margin-top:4px;border:1px solid #ccc;border-radius:4px;font-size:14px;box-sizing:border-box;">
      </label>
      <label style="display:block;margin-bottom:12px;font-size:13px;">
        Shared secret
        <div style="position:relative;margin-top:4px;">
          <input id="cfg-secret" type="password" autocomplete="off" value="${escAttr(initial.secret || '')}"
            style="display:block;width:100%;padding:8px 60px 8px 10px;border:1px solid #ccc;border-radius:4px;font-size:14px;box-sizing:border-box;font-family:monospace;">
          <button type="button" id="cfg-secret-toggle" style="position:absolute;right:6px;top:50%;transform:translateY(-50%);background:#f5f5f5;border:1px solid #ddd;border-radius:3px;padding:4px 8px;font-size:11px;cursor:pointer;color:#555;font-family:system-ui;">Show</button>
        </div>
        <div id="cfg-secret-fp" style="font-family:monospace;font-size:11px;color:#666;margin-top:4px;">${secretFingerprint(initial.secret || '')}</div>
      </label>
      <label style="display:block;margin-bottom:16px;font-size:13px;">
        Deepgram API key <span style="color:#888;font-weight:400;">(optional — for G2 mic)</span>
        <input id="cfg-dg" type="password" autocomplete="off" value="${escAttr(initial.deepgramKey || '')}"
          style="display:block;width:100%;padding:8px;margin-top:4px;border:1px solid #ccc;border-radius:4px;font-size:14px;box-sizing:border-box;font-family:monospace;">
      </label>
      <button id="cfg-save"
        style="padding:10px 18px;background:#2563eb;color:#fff;border:none;border-radius:4px;font-size:14px;cursor:pointer;">
        Save & connect
      </button>
      <div id="cfg-status" style="margin-top:12px;font-size:12px;color:#888;min-height:18px;"></div>
      <hr style="margin:24px 0;border:none;border-top:1px solid #eee;">
      <h3 style="margin:0 0 8px;font-size:14px;color:#333;">Controls on G2</h3>
      <ul style="margin:0;padding-left:18px;font-size:13px;color:#555;line-height:1.6;">
        <li><strong>Single tap</strong> (ring or temple) — cycle mode (live → dictation → notes → AI → problems → alerts → plan)</li>
        <li><strong>Scroll down/up</strong> — scroll the paragraph one line within the current item; at the end, advance to the next item; at the top, jump to the previous item</li>
        <li><strong>Double tap</strong> — back to live mode</li>
      </ul>
    </div>
  `);
  const save = document.getElementById('cfg-save');
  if (save) (save as HTMLButtonElement).onclick = onSaveClicked;

  // Show/Hide toggle for the secret + live fingerprint update
  const secretInput = document.getElementById('cfg-secret') as HTMLInputElement | null;
  const toggleBtn = document.getElementById('cfg-secret-toggle') as HTMLButtonElement | null;
  const fpEl = document.getElementById('cfg-secret-fp');
  if (secretInput && toggleBtn) {
    toggleBtn.onclick = () => {
      if (secretInput.type === 'password') { secretInput.type = 'text'; toggleBtn.textContent = 'Hide'; }
      else { secretInput.type = 'password'; toggleBtn.textContent = 'Show'; }
    };
    secretInput.addEventListener('input', () => {
      if (fpEl) fpEl.innerHTML = secretFingerprint(secretInput.value);
    });
  }
}

async function onSaveClicked() {
  const relay = (document.getElementById('cfg-relay') as HTMLInputElement).value.trim();
  const secret = (document.getElementById('cfg-secret') as HTMLInputElement).value.trim();
  const deepgramKey = (document.getElementById('cfg-dg') as HTMLInputElement).value.trim();
  const statusEl = document.getElementById('cfg-status');
  if (!relay || !secret) {
    if (statusEl) { statusEl.style.color = '#c2410c'; statusEl.textContent = 'Relay URL and shared secret are required.'; }
    return;
  }
  const c: Config = { relay: relay.replace(/\/+$/, ''), secret, deepgramKey };
  await writeConfig(c);
  if (statusEl) { statusEl.style.color = '#15803d'; statusEl.textContent = 'Saved. Connecting…'; }
  await startPlugin(c);
}

// ---------- Relay I/O ----------

async function fetchRelayState(): Promise<RelayState | null> {
  if (!cfg) return null;
  try {
    const r = await fetch(`${cfg.relay}/state`, {
      headers: { 'X-Glasses-Secret': cfg.secret },
      cache: 'no-store',
    });
    if (!r.ok) return null;
    return (await r.json()) as RelayState;
  } catch { return null; }
}

async function postTranscript(text: string, isFinal: boolean) {
  if (!cfg) return;
  try {
    await fetch(`${cfg.relay}/transcript`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Glasses-Secret': cfg.secret },
      body: JSON.stringify({ text, isFinal }),
    });
  } catch (e) { console.warn('postTranscript failed:', e); }
}

// ---------- Render ----------

function buildPage(content: string): TextContainerProperty[] {
  return [
    new TextContainerProperty({
      xPosition: 0, yPosition: 0,
      width: 576, height: 288,
      borderWidth: 0, borderColor: 0,
      paddingLength: 0,           // zero padding → max usable space, denser display
      containerID: MAIN_CONTAINER_ID,
      containerName: 'main',
      content: content || ' ',
      isEventCapture: 1,
    }),
  ];
}

/**
 * Convert a page (text OR bullets, plus optional title) into a flat list of
 * display lines that all use the same width budget. The plugin then takes a
 * scrollable window of N lines from this stack.
 *
 * - bullets: each '• item' is wrapped onto continuation lines indented with 2
 *   spaces so the bullet hierarchy is preserved across line breaks.
 * - text: word-wrapped paragraph.
 */
function pageToLines(page: ViewPage, maxChars: number): string[] {
  // Back-compat: old {line1, line2} → joined paragraph
  if (page.bullets && page.bullets.length) {
    const out: string[] = [];
    for (const b of page.bullets) {
      const wrapped = wrapLines('• ' + b, maxChars);
      for (let i = 0; i < wrapped.length; i++) {
        out.push(i === 0 ? wrapped[i] : '  ' + wrapped[i]);
      }
    }
    return out;
  }
  const text = page.text != null
    ? page.text
    : [page.line1, page.line2].filter(Boolean).join(' ');
  return wrapLines(text || '', maxChars);
}

/**
 * Compute the full content string for the single G2 container.
 * Returns one string with '\n' line breaks — flows top-to-bottom naturally,
 * no fixed split, no blank gaps from container boundaries.
 */
function computeContent(): string {
  const s = localState.relay;
  if (!s) return 'Acting Intern · waiting for chart';

  // Pending action ALWAYS takes precedence — the doctor needs to see + decide
  // before navigating to anything else. Renders a small modal-style block.
  if (s.pendingAction && s.pendingAction.summary) {
    const a = s.pendingAction;
    const lines = [
      `>> CONFIRM ${a.kind.toUpperCase()}? ${a.glyph || ''}`,
      ...wrapLines(a.summary, G2_MAX_LINE),
      '',
      '[CLICK]=confirm  [DBL]=cancel',
    ];
    return lines.slice(0, VISIBLE_LINES).join('\n');
  }

  if (localState.mode === 'live') {
    const anchor = s.anchor || 'Acting Intern · ready';
    const bottom = s.bottom || '';
    // Wrap each separately so the visual feels like "anchor up top, latest event below"
    const anchorLines = wrapLines(anchor, G2_MAX_LINE);
    const bottomLines = bottom ? wrapLines(bottom, G2_MAX_LINE) : [];
    const all = [...anchorLines.slice(0, 2), ...bottomLines.slice(0, VISIBLE_LINES - anchorLines.slice(0, 2).length)];
    return all.join('\n') || ' ';
  }
  const pages = (s.views && s.views[localState.mode]) || [];
  if (!pages.length) {
    return `${MODE_LABELS[localState.mode]} — no items\n${s.anchor || ''}`;
  }
  const idx = Math.min(Math.max(0, localState.page), pages.length - 1);
  const page = pages[idx];

  // Build full scrollable stack: optional title first, then content lines.
  const titleLines = page.title ? wrapLines(page.title, G2_MAX_LINE) : [];
  const contentLines = pageToLines(page, G2_MAX_LINE);
  const stack = [...titleLines, ...contentLines];
  const total = stack.length;

  // Dictation mode: no header — give all VISIBLE_LINES to content.
  if (localState.mode === 'dictation') {
    const off = clampOffset(localState.scrollOffset, total, VISIBLE_LINES);
    return stack.slice(off, off + VISIBLE_LINES).join('\n') || ' ';
  }

  // Non-live modes: 1-line header + (VISIBLE_LINES - 1) content lines.
  const off = clampOffset(localState.scrollOffset, total, VISIBLE_LINES_NONLIVE_CONTENT);
  const end = Math.min(off + VISIBLE_LINES_NONLIVE_CONTENT, total);
  const upArrow = off > 0 ? '▲' : ' ';
  const downArrow = end < total ? '▼' : ' ';
  const scrollIndicator = total > VISIBLE_LINES_NONLIVE_CONTENT
    ? `  ${upArrow}${off + 1}-${end}/${total}${downArrow}`
    : '';
  const header = `${MODE_LABELS[localState.mode]} ${idx + 1}/${pages.length}${scrollIndicator}`;
  const visible = stack.slice(off, end);
  return [header, ...visible].join('\n');
}

function clampOffset(off: number, total: number, visible: number): number {
  if (total <= visible) return 0;
  return Math.max(0, Math.min(off, total - visible));
}

async function applyRender() {
  if (!bridge) return;
  const content = computeContent();
  if (content === localState.lastTop) return; // reuse lastTop as the de-dup key
  await bridge.textContainerUpgrade(new TextContainerUpgrade({
    containerID: MAIN_CONTAINER_ID,
    content: content || ' ',
  }));
  localState.lastTop = content;
  localState.lastBottom = '';
  postPresenceDebounced(content);
  updateDebugUi();
}

// ---------- Plugin → relay presence (so the EHR's Live HUD Mirror reflects
// what's actually on G2 right now, not just live-mode anchor + bottom) ----------
let presenceTimer: ReturnType<typeof setTimeout> | null = null;
function postPresenceDebounced(content: string) {
  if (!cfg) return;
  if (presenceTimer) clearTimeout(presenceTimer);
  presenceTimer = setTimeout(() => {
    const body = {
      mode: localState.mode,
      page: localState.page,
      scrollOffset: localState.scrollOffset,
      content,
    };
    fetch(`${cfg!.relay}/presence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Glasses-Secret': cfg!.secret },
      body: JSON.stringify(body),
    }).catch(() => { /* silent — best-effort */ });
  }, PRESENCE_POST_DEBOUNCE_MS);
}

function updateDebugUi() {
  const el = document.getElementById('plugin-state');
  if (!el) return;
  const s = localState.relay;
  el.textContent = `mode=${localState.mode} page=${localState.page} scroll=${localState.scrollOffset} v=${s?.version ?? 0}`;
}

// ---------- Navigation ----------

function setMode(mode: Mode) {
  if (localState.mode === mode) return;
  localState.mode = mode;
  localState.page = 0;
  localState.scrollOffset = 0;
  applyRender();
}

function cycleMode() {
  const i = MODE_CYCLE.indexOf(localState.mode);
  const next = MODE_CYCLE[(i + 1) % MODE_CYCLE.length];
  setMode(next);
}

function pageNext() {
  if (localState.mode === 'live') return;
  const pages = (localState.relay?.views[localState.mode]) || [];
  if (!pages.length) return;
  localState.page = (localState.page + 1) % pages.length;
  localState.scrollOffset = 0;
  applyRender();
}

function pagePrev() {
  if (localState.mode === 'live') return;
  const pages = (localState.relay?.views[localState.mode]) || [];
  if (!pages.length) return;
  localState.page = (localState.page - 1 + pages.length) % pages.length;
  localState.scrollOffset = 0;
  applyRender();
}

/** Total wrapped lines (title + content) for the current page. */
function currentPageLineCount(): number {
  const pages = (localState.relay?.views[localState.mode]) || [];
  if (!pages.length) return 0;
  const page = pages[Math.min(localState.page, pages.length - 1)];
  const titleLen = page.title ? wrapLines(page.title, G2_MAX_LINE - 2).length : 0;
  return titleLen + pageToLines(page, G2_MAX_LINE - 2).length;
}

function visibleLinesForCurrentMode(): number {
  return localState.mode === 'dictation' ? VISIBLE_LINES : VISIBLE_LINES_NONLIVE_CONTENT;
}

/**
 * Scroll DOWN one line within the current page. If already at the bottom of
 * the visible window AND content fits or is past the end, advance to the
 * next page (resetting scrollOffset).
 */
function scrollDown() {
  if (localState.mode === 'live') return;
  const total = currentPageLineCount();
  const visible = visibleLinesForCurrentMode();
  if (localState.scrollOffset + visible < total) {
    localState.scrollOffset++;
    applyRender();
  } else {
    pageNext();
  }
}

/** Scroll UP one line. If already at the top, jump to the previous page. */
function scrollUp() {
  if (localState.mode === 'live') return;
  if (localState.scrollOffset > 0) {
    localState.scrollOffset--;
    applyRender();
  } else {
    pagePrev();
  }
}

// ---------- Event handler (ring + temple) ----------

function eventTypeFrom(event: EvenHubEvent): number | null {
  // Per Even SDK quirk: protobuf strips zero-value fields, so CLICK_EVENT (0)
  // arrives as undefined within an envelope that's still present.
  // Coalesce undefined → CLICK_EVENT only when the envelope exists.
  if (event.sysEvent !== undefined && event.sysEvent !== null) {
    return event.sysEvent.eventType ?? OsEventTypeList.CLICK_EVENT;
  }
  if (event.textEvent !== undefined && event.textEvent !== null) {
    return event.textEvent.eventType ?? OsEventTypeList.CLICK_EVENT;
  }
  if (event.listEvent !== undefined && event.listEvent !== null) {
    return event.listEvent.eventType ?? OsEventTypeList.CLICK_EVENT;
  }
  return null;
}

function onEvent(event: EvenHubEvent) {
  const type = eventTypeFrom(event);
  if (type === null) return;
  console.log('[plugin] event', type, 'mode=' + localState.mode);

  // Context-aware accept/cancel: if there's a pending action, ring CLICK = confirm,
  // DOUBLE_CLICK = cancel. We send "confirm"/"cancel" through /transcript so the
  // EHR's existing _processFinalText routes them through the same code path as
  // voice — no new EHR endpoints, no duplicated logic.
  const pending = localState.relay?.pendingAction;
  if (pending && pending.summary) {
    if (type === OsEventTypeList.CLICK_EVENT) {
      postTranscript('confirm', true);
      return;
    }
    if (type === OsEventTypeList.DOUBLE_CLICK_EVENT) {
      postTranscript('cancel', true);
      return;
    }
  }

  switch (type) {
    case OsEventTypeList.DOUBLE_CLICK_EVENT:
      setMode('live');
      return;
    case OsEventTypeList.SCROLL_TOP_EVENT:
      scrollUp();
      return;
    case OsEventTypeList.SCROLL_BOTTOM_EVENT:
      scrollDown();
      return;
    case OsEventTypeList.CLICK_EVENT:
      // In bullet pages with a focused item, CLICK = "accept this suggestion"
      // by routing the bullet text through the EHR's order pipeline.
      // Otherwise, CLICK cycles mode (current behavior).
      const focused = focusedBullet();
      if (focused) {
        postTranscript('order ' + focused, true);
        return;
      }
      cycleMode();
      return;
    case OsEventTypeList.FOREGROUND_EXIT_EVENT:
    case OsEventTypeList.ABNORMAL_EXIT_EVENT:
    case OsEventTypeList.SYSTEM_EXIT_EVENT:
      stopMicCapture();
      return;
    default:
      return;
  }
}

/**
 * Returns the bullet text that's currently at the top of the visible scroll
 * window — the "focused" item the user is looking at. Returns null if the
 * current page has no bullets (paragraph mode) or no items at all.
 */
function focusedBullet(): string | null {
  if (localState.mode === 'live') return null;
  const pages = (localState.relay?.views[localState.mode]) || [];
  if (!pages.length) return null;
  const page = pages[Math.min(localState.page, pages.length - 1)];
  if (!page.bullets || !page.bullets.length) return null;
  // Account for title lines + walk through bullet wrapped-line counts to find
  // which bullet contains the line at scrollOffset.
  const titleLen = page.title ? wrapLines(page.title, G2_MAX_LINE).length : 0;
  let lineCount = titleLen;
  for (let i = 0; i < page.bullets.length; i++) {
    const wrapped = wrapLines('• ' + page.bullets[i], G2_MAX_LINE);
    if (lineCount + wrapped.length > localState.scrollOffset) {
      return page.bullets[i].replace(/^[•⚠→✎]+\s*/, ''); // strip leading marker
    }
    lineCount += wrapped.length;
  }
  return page.bullets[page.bullets.length - 1].replace(/^[•⚠→✎]+\s*/, '');
}

// ---------- G2 mic capture → Deepgram → relay ----------

function openDeepgram(apiKey: string) {
  if (dgWs && (dgWs.readyState === WebSocket.OPEN || dgWs.readyState === WebSocket.CONNECTING)) return;
  if (dgConnecting) return;
  dgConnecting = true;
  const params = new URLSearchParams({
    encoding: 'linear16',
    sample_rate: '16000',
    channels: '1',
    interim_results: 'false',
    smart_format: 'true',
    endpointing: '500',
    model: 'nova-2-medical',
  });
  const url = `wss://api.deepgram.com/v1/listen?${params.toString()}`;
  // Browser WebSocket accepts subprotocols as auth (Deepgram convention).
  const ws = new WebSocket(url, ['token', apiKey]);
  ws.binaryType = 'arraybuffer';
  ws.onopen = () => {
    console.log('[plugin] Deepgram connected');
    dgConnecting = false;
  };
  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data as string);
      const alt = msg?.channel?.alternatives?.[0];
      const text = alt?.transcript;
      if (text && text.trim() && msg.is_final === true) {
        console.log('[plugin] transcript →', text);
        postTranscript(text, true);
      }
    } catch { /* keepalive or non-JSON */ }
  };
  ws.onerror = (e) => {
    console.error('[plugin] Deepgram error', e);
    dgConnecting = false;
  };
  ws.onclose = (e) => {
    console.warn('[plugin] Deepgram closed', e.code, e.reason);
    dgWs = null;
    dgConnecting = false;
  };
  dgWs = ws;
}

function sendAudioToDeepgram(pcm: Uint8Array) {
  if (!dgWs || dgWs.readyState !== WebSocket.OPEN) return;
  dgWs.send(pcm);
}

async function startMicCapture() {
  if (!bridge || !cfg) return;
  if (!cfg.deepgramKey) {
    console.log('[plugin] Deepgram key not set; skipping G2 mic capture');
    return;
  }
  openDeepgram(cfg.deepgramKey);
  try {
    await bridge.audioControl(true);
    console.log('[plugin] G2 mic opened');
  } catch (e) {
    console.error('[plugin] audioControl(true) failed:', e);
  }
}

async function stopMicCapture() {
  if (bridge) {
    try { await bridge.audioControl(false); } catch { /* ignore */ }
  }
  if (dgWs) {
    try { dgWs.close(); } catch { /* ignore */ }
    dgWs = null;
  }
}

// ---------- Polling loop ----------

async function pollLoop() {
  const s = await fetchRelayState();
  if (!s) return;
  localState.relay = s;
  // EHR-driven mode change
  if (s.desiredMode && s.modeVersion > localState.lastSeenModeVersion) {
    localState.lastSeenModeVersion = s.modeVersion;
    if (s.desiredMode !== localState.mode) {
      console.log('[plugin] EHR set mode →', s.desiredMode);
      setMode(s.desiredMode);
      return; // setMode already calls applyRender
    }
  }
  await applyRender();
}

// ---------- Plugin lifecycle ----------

async function startPlugin(config: Config) {
  cfg = config;
  setStatus(`
    ${buildBadgeHtml()}
    <div style="max-width:520px;margin:0 auto;font-family:system-ui;padding:16px;color:#444;">
      <p style="margin:0 0 8px;">Acting Intern HUD active.</p>
      <p style="margin:0 0 4px;font-size:11px;font-family:monospace;color:#888;">
        secret: ${secretFingerprint(config.secret)}
      </p>
      <p style="margin:0 0 8px;font-size:13px;color:#666;" id="plugin-state">Waiting for first push…</p>
      <p style="margin:0 0 8px;font-size:12px;color:${config.deepgramKey ? '#15803d' : '#888'};">
        G2 mic dictation: ${config.deepgramKey ? 'ENABLED' : 'disabled (no Deepgram key)'}
      </p>
      <button id="cfg-reset" style="margin-top:12px;padding:6px 12px;background:#f5f5f5;border:1px solid #ccc;border-radius:4px;font-size:12px;cursor:pointer;">
        Reconfigure
      </button>
    </div>
  `);
  const resetBtn = document.getElementById('cfg-reset');
  if (resetBtn) (resetBtn as HTMLButtonElement).onclick = () => {
    stopMicCapture();
    renderSetupForm(config);
  };

  if (!bridge) {
    try {
      bridge = await waitForEvenAppBridge();
    } catch {
      setStatus(`<p style="color:#c2410c;font-family:system-ui;padding:24px;">Even app bridge not available. Open this from inside the Even Realities app on your phone.</p>`);
      return;
    }
  }

  // Initial state + page container
  const initial = (await fetchRelayState()) || {
    anchor: '', bottom: '', views: { live: [], dictation: [], notes: [], ai: [], problems: [], alerts: [], plan: [] },
    desiredMode: null, modeVersion: 0, version: 0, transcriptHead: 0, pendingAction: null, updatedAt: 0,
  };
  localState.relay = initial;
  localState.lastSeenModeVersion = initial.modeVersion;

  const initialContent = computeContent();
  const containers = buildPage(initialContent);
  await bridge.createStartUpPageContainer(
    new CreateStartUpPageContainer({ containerTotalNum: containers.length, textObject: containers })
  );
  localState.lastTop = initialContent;
  localState.lastBottom = '';
  updateDebugUi();

  // Wire input + audio events
  bridge.onEvenHubEvent((event) => {
    try {
      if (event.audioEvent && event.audioEvent.audioPcm) {
        sendAudioToDeepgram(event.audioEvent.audioPcm);
        return;
      }
      onEvent(event);
    } catch (e) { console.warn('[plugin] event handler threw:', e); }
  });

  // Open G2 mic (continuous) if Deepgram is configured.
  // Per docs: must come AFTER createStartUpPageContainer.
  await startMicCapture();

  // Start poll loop.
  setInterval(pollLoop, POLL_INTERVAL_MS);
}

async function main() {
  // Acquire the bridge BEFORE reading config — config now lives in
  // bridge.getLocalStorage (survives .ehpk reinstalls).
  try {
    bridge = await waitForEvenAppBridge();
  } catch {
    setStatus(`<p style="color:#c2410c;font-family:system-ui;padding:24px;">Even app bridge not available. Open this from inside the Even Realities app on your phone.</p>`);
    return;
  }
  let c = await readConfig();
  // Fall back to baked defaults so simulator + fresh installs auto-start.
  // User can still change secret/Deepgram via the Reconfigure button.
  if (!c && RELAY_DEFAULT && SECRET_DEFAULT) {
    c = { relay: RELAY_DEFAULT, secret: SECRET_DEFAULT, deepgramKey: '' };
    console.log('[plugin] no saved config — using baked defaults');
  }
  if (!c) { renderSetupForm({}); return; }
  await startPlugin(c);
}

main().catch((err) => {
  console.error('Acting Intern plugin failed:', err);
  setStatus(`<p style="color:#c2410c;font-family:system-ui;padding:24px;">Error: ${String(err && err.message || err)}</p>`);
});
