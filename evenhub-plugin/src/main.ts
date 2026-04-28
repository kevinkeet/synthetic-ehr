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

// ---------- Config & local state ----------

type Config = { relay: string; secret: string; deepgramKey: string };

type Mode = 'live' | 'notes' | 'ai' | 'problems' | 'alerts' | 'plan';
const MODE_CYCLE: Mode[] = ['live', 'notes', 'ai', 'problems', 'alerts', 'plan'];

type ViewPage = { line1: string; line2: string };
type RelayState = {
  anchor: string;
  bottom: string;
  views: Record<Mode, ViewPage[]>;
  desiredMode: Mode | null;
  modeVersion: number;
  version: number;
  transcriptHead: number;
  updatedAt: number;
};

const STORAGE_KEY = 'acting-intern-glasses-config-v1';
const POLL_INTERVAL_MS = 500;
const ANCHOR_CONTAINER_ID = 1;
const BOTTOM_CONTAINER_ID = 2;
const G2_MAX_LINE = 40;
// Pre-filled in the setup form so the user only ever types the secret + Deepgram key.
const RELAY_DEFAULT = 'https://acting-intern-relay.kevinkeet.workers.dev';

const localState = {
  mode: 'live' as Mode,
  page: 0,
  lastSeenModeVersion: -1,
  relay: null as RelayState | null,
  lastTop: '',
  lastBottom: '',
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

function fit(s: string, max = G2_MAX_LINE): string {
  if (!s) return '';
  s = String(s);
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

/**
 * Wrap text at word boundaries to <= maxCharsPerLine chars per line, joined
 * with '\n'. The G2 SDK accepts '\n' inside a TextContainerProperty's content.
 * Caps at maxLines lines and adds an ellipsis if more would overflow.
 * Prefer this over fit() for the bottom container (144 px tall ≈ 3–4 lines).
 */
function wrap(text: string, maxCharsPerLine = G2_MAX_LINE, maxLines = 3): string {
  if (!text) return '';
  text = String(text).replace(/\s+/g, ' ').trim();
  if (text.length <= maxCharsPerLine) return text;
  const words = text.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const candidate = cur ? cur + ' ' + w : w;
    if (candidate.length <= maxCharsPerLine) {
      cur = candidate;
    } else {
      if (cur) lines.push(cur);
      if (lines.length >= maxLines) { cur = ''; break; }
      // Single word longer than the line — hard-break it.
      cur = w.length > maxCharsPerLine ? w.slice(0, maxCharsPerLine - 1) + '…' : w;
    }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  if (lines.length === maxLines) {
    // If there were leftover words, mark truncation on the last line.
    const consumedLen = lines.reduce((a, l) => a + l.length + 1, 0);
    if (consumedLen < text.length) {
      const last = lines[maxLines - 1];
      lines[maxLines - 1] = last.length >= maxCharsPerLine
        ? last.slice(0, maxCharsPerLine - 1) + '…'
        : last + '…';
    }
  }
  return lines.join('\n');
}

function setStatus(html: string) {
  const el = document.getElementById('status');
  if (el) el.innerHTML = html;
}

// ---------- Setup form ----------

function renderSetupForm(initial: Partial<Config>) {
  setStatus(`
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
        <input id="cfg-secret" type="password" autocomplete="off" value="${escAttr(initial.secret || '')}"
          style="display:block;width:100%;padding:8px;margin-top:4px;border:1px solid #ccc;border-radius:4px;font-size:14px;box-sizing:border-box;font-family:monospace;">
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
        <li><strong>Single tap</strong> (ring or temple) — cycle mode (live → notes → AI → problems → alerts → plan)</li>
        <li><strong>Scroll up/down</strong> — page within current mode</li>
        <li><strong>Double tap</strong> — back to live mode</li>
      </ul>
    </div>
  `);
  const save = document.getElementById('cfg-save');
  if (save) (save as HTMLButtonElement).onclick = onSaveClicked;
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

function buildPage(top: string, bottom: string): TextContainerProperty[] {
  return [
    new TextContainerProperty({
      xPosition: 0, yPosition: 0,
      width: 576, height: 144,
      borderWidth: 0, borderColor: 0,
      paddingLength: 8,
      containerID: ANCHOR_CONTAINER_ID,
      containerName: 'top',
      content: fit(top) || ' ',
      isEventCapture: 1,
    }),
    new TextContainerProperty({
      xPosition: 0, yPosition: 144,
      width: 576, height: 144,
      borderWidth: 0, borderColor: 0,
      paddingLength: 8,
      containerID: BOTTOM_CONTAINER_ID,
      containerName: 'bottom',
      content: fit(bottom) || ' ',
      isEventCapture: 0,
    }),
  ];
}

function computeLines(): { top: string; bottom: string } {
  const s = localState.relay;
  if (!s) return { top: 'Acting Intern · waiting for chart', bottom: ' ' };
  if (localState.mode === 'live') {
    return { top: s.anchor || 'Acting Intern · ready', bottom: s.bottom || ' ' };
  }
  const pages = (s.views && s.views[localState.mode]) || [];
  if (!pages.length) {
    return { top: `[${localState.mode.toUpperCase()}] no items`, bottom: s.anchor || ' ' };
  }
  const idx = Math.min(Math.max(0, localState.page), pages.length - 1);
  const page = pages[idx];
  const header = `[${localState.mode.toUpperCase()} ${idx + 1}/${pages.length}] ${page.line1 || ''}`;
  return { top: header, bottom: page.line2 || ' ' };
}

async function applyRender() {
  if (!bridge) return;
  const lines = computeLines();
  // Anchor (top): one line max, fits cleanly. Truncate hard if too long.
  const top = fit(lines.top, G2_MAX_LINE);
  // Event/page content (bottom): wrap to up to 3 lines using \n inside the container.
  const bottom = wrap(lines.bottom, G2_MAX_LINE, 3);
  if (top === localState.lastTop && bottom === localState.lastBottom) return;

  if (top !== localState.lastTop) {
    await bridge.textContainerUpgrade(new TextContainerUpgrade({
      containerID: ANCHOR_CONTAINER_ID,
      content: top || ' ',
    }));
    localState.lastTop = top;
  }
  if (bottom !== localState.lastBottom) {
    await bridge.textContainerUpgrade(new TextContainerUpgrade({
      containerID: BOTTOM_CONTAINER_ID,
      content: bottom || ' ',
    }));
    localState.lastBottom = bottom;
  }
  updateDebugUi();
}

function updateDebugUi() {
  const el = document.getElementById('plugin-state');
  if (!el) return;
  const s = localState.relay;
  el.textContent = `mode=${localState.mode} page=${localState.page} v=${s?.version ?? 0} top="${localState.lastTop.slice(0, 30)}" bot="${localState.lastBottom.slice(0, 30)}"`;
}

// ---------- Navigation ----------

function setMode(mode: Mode) {
  if (localState.mode === mode) return;
  localState.mode = mode;
  localState.page = 0;
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
  applyRender();
}

function pagePrev() {
  if (localState.mode === 'live') return;
  const pages = (localState.relay?.views[localState.mode]) || [];
  if (!pages.length) return;
  localState.page = (localState.page - 1 + pages.length) % pages.length;
  applyRender();
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
  switch (type) {
    case OsEventTypeList.DOUBLE_CLICK_EVENT:
      setMode('live');
      return;
    case OsEventTypeList.SCROLL_TOP_EVENT:
      pagePrev();
      return;
    case OsEventTypeList.SCROLL_BOTTOM_EVENT:
      pageNext();
      return;
    case OsEventTypeList.CLICK_EVENT:
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
    <div style="max-width:520px;margin:0 auto;font-family:system-ui;padding:16px;color:#444;">
      <p style="margin:0 0 8px;">Acting Intern HUD active.</p>
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
    anchor: '', bottom: '', views: { live: [], notes: [], ai: [], problems: [], alerts: [], plan: [] },
    desiredMode: null, modeVersion: 0, version: 0, transcriptHead: 0, updatedAt: 0,
  };
  localState.relay = initial;
  localState.lastSeenModeVersion = initial.modeVersion;

  const containers = buildPage(initial.anchor || ' ', initial.bottom || ' ');
  await bridge.createStartUpPageContainer(
    new CreateStartUpPageContainer({ containerTotalNum: containers.length, textObject: containers })
  );
  localState.lastTop = fit(initial.anchor || ' ');
  localState.lastBottom = fit(initial.bottom || ' ');
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
  const c = await readConfig();
  if (!c) { renderSetupForm({}); return; }
  await startPlugin(c);
}

main().catch((err) => {
  console.error('Acting Intern plugin failed:', err);
  setStatus(`<p style="color:#c2410c;font-family:system-ui;padding:24px;">Error: ${String(err && err.message || err)}</p>`);
});
