/**
 * Acting Intern G2 plugin entry point.
 *
 * Runs inside the Even Realities phone app WebView. Reads HUD state
 * (anchor + bottom line) from a relay URL and pushes it to the G2 display
 * via the Even Hub SDK.
 *
 * Display: two stacked TextContainerProperty regions on the 576×288 canvas:
 *   top half  = anchor (persistent patient identity)
 *   bottom half = event (latest dictation snippet or pending order)
 */

import {
  waitForEvenAppBridge,
  TextContainerProperty,
  CreateStartUpPageContainer,
  TextContainerUpgrade,
  EvenAppBridge,
} from '@evenrealities/even_hub_sdk';

type RelayState = {
  anchor: string;
  bottom: string;
  version: number;
  updatedAt: number;
};

const STORAGE_KEY = 'acting-intern-glasses-config-v1';
const POLL_INTERVAL_MS = 500;
const ANCHOR_CONTAINER_ID = 1;
const BOTTOM_CONTAINER_ID = 2;

type Config = { relay: string; secret: string };

function readConfig(): Config | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw);
    if (!c.relay || !c.secret) return null;
    return { relay: String(c.relay).replace(/\/+$/, ''), secret: String(c.secret) };
  } catch {
    return null;
  }
}

function writeConfig(c: Config) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(c));
}

function setStatus(html: string) {
  const el = document.getElementById('status');
  if (el) el.innerHTML = html;
}

function renderSetupForm(initial: Partial<Config>) {
  setStatus(`
    <div style="max-width:480px;margin:0 auto;font-family:system-ui;">
      <h2 style="margin:0 0 8px;font-size:18px;">Acting Intern HUD setup</h2>
      <p style="margin:0 0 16px;color:#555;font-size:13px;line-height:1.4;">
        Enter the same relay URL and shared secret you configured in the EHR's G2 settings.
      </p>
      <label style="display:block;margin-bottom:12px;font-size:13px;">
        Relay URL
        <input id="cfg-relay" type="url" value="${escAttr(initial.relay || '')}"
          placeholder="https://acting-intern-relay.workers.dev"
          style="display:block;width:100%;padding:8px;margin-top:4px;border:1px solid #ccc;border-radius:4px;font-size:14px;box-sizing:border-box;">
      </label>
      <label style="display:block;margin-bottom:16px;font-size:13px;">
        Shared secret
        <input id="cfg-secret" type="password" autocomplete="off" value="${escAttr(initial.secret || '')}"
          style="display:block;width:100%;padding:8px;margin-top:4px;border:1px solid #ccc;border-radius:4px;font-size:14px;box-sizing:border-box;font-family:monospace;">
      </label>
      <button id="cfg-save"
        style="padding:10px 18px;background:#2563eb;color:#fff;border:none;border-radius:4px;font-size:14px;cursor:pointer;">
        Save & connect
      </button>
      <div id="cfg-status" style="margin-top:12px;font-size:12px;color:#888;min-height:18px;"></div>
    </div>
  `);

  const save = document.getElementById('cfg-save') as HTMLButtonElement | null;
  if (save) save.onclick = onSaveClicked;
}

function escAttr(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function onSaveClicked() {
  const relay = (document.getElementById('cfg-relay') as HTMLInputElement).value.trim();
  const secret = (document.getElementById('cfg-secret') as HTMLInputElement).value.trim();
  const statusEl = document.getElementById('cfg-status');
  if (!relay || !secret) {
    if (statusEl) { statusEl.style.color = '#c2410c'; statusEl.textContent = 'Both fields required.'; }
    return;
  }
  const cfg = { relay: relay.replace(/\/+$/, ''), secret };
  writeConfig(cfg);
  if (statusEl) { statusEl.style.color = '#15803d'; statusEl.textContent = 'Saved. Connecting…'; }
  await startPlugin(cfg);
}

async function fetchState(cfg: Config): Promise<RelayState | null> {
  try {
    const r = await fetch(`${cfg.relay}/state`, {
      headers: { 'X-Glasses-Secret': cfg.secret },
      cache: 'no-store',
    });
    if (!r.ok) return null;
    return (await r.json()) as RelayState;
  } catch {
    return null;
  }
}

function buildPage(anchor: string, bottom: string): TextContainerProperty[] {
  const top = new TextContainerProperty({
    xPosition: 0, yPosition: 0,
    width: 576, height: 144,
    borderWidth: 0, borderColor: 0,
    paddingLength: 8,
    containerID: ANCHOR_CONTAINER_ID,
    containerName: 'anchor',
    content: anchor || ' ',
    isEventCapture: 1,
  });
  const bot = new TextContainerProperty({
    xPosition: 0, yPosition: 144,
    width: 576, height: 144,
    borderWidth: 0, borderColor: 0,
    paddingLength: 8,
    containerID: BOTTOM_CONTAINER_ID,
    containerName: 'bottom',
    content: bottom || ' ',
    isEventCapture: 0,
  });
  return [top, bot];
}

async function startPlugin(cfg: Config) {
  setStatus(`
    <div style="max-width:480px;margin:0 auto;font-family:system-ui;color:#444;">
      <p style="margin:0 0 8px;">Acting Intern HUD active.</p>
      <p style="margin:0 0 8px;font-size:13px;color:#666;" id="plugin-state">Waiting for first push…</p>
      <button id="cfg-reset" style="margin-top:12px;padding:6px 12px;background:#f5f5f5;border:1px solid #ccc;border-radius:4px;font-size:12px;cursor:pointer;">
        Reconfigure
      </button>
    </div>
  `);
  const resetBtn = document.getElementById('cfg-reset');
  if (resetBtn) resetBtn.onclick = () => renderSetupForm(cfg);

  let bridge: EvenAppBridge;
  try {
    bridge = await waitForEvenAppBridge();
  } catch (e) {
    setStatus(`<p style="color:#c2410c;font-family:system-ui;">Even app bridge not available. Open this from inside the Even Realities app on your phone.</p>`);
    return;
  }

  const initial = (await fetchState(cfg)) || { anchor: '', bottom: '', version: 0, updatedAt: 0 };
  const containers = buildPage(initial.anchor, initial.bottom);
  await bridge.createStartUpPageContainer(
    new CreateStartUpPageContainer({
      containerTotalNum: containers.length,
      textObject: containers,
    })
  );

  let lastVersion = initial.version;
  let lastAnchor = initial.anchor;
  let lastBottom = initial.bottom;

  const stateEl = () => document.getElementById('plugin-state');

  setInterval(async () => {
    const s = await fetchState(cfg);
    if (!s) return;
    if (s.version === lastVersion) return;

    const anchorChanged = s.anchor !== lastAnchor;
    const bottomChanged = s.bottom !== lastBottom;

    if (anchorChanged) {
      await bridge.textContainerUpgrade(new TextContainerUpgrade({
        containerID: ANCHOR_CONTAINER_ID,
        content: s.anchor || ' ',
      }));
    }
    if (bottomChanged) {
      await bridge.textContainerUpgrade(new TextContainerUpgrade({
        containerID: BOTTOM_CONTAINER_ID,
        content: s.bottom || ' ',
      }));
    }

    lastVersion = s.version;
    lastAnchor = s.anchor;
    lastBottom = s.bottom;

    const el = stateEl();
    if (el) el.textContent = `v${s.version} · ${s.anchor.slice(0, 40)} | ${s.bottom.slice(0, 40)}`;
  }, POLL_INTERVAL_MS);
}

async function main() {
  const cfg = readConfig();
  if (!cfg) {
    renderSetupForm({});
    return;
  }
  await startPlugin(cfg);
}

main().catch((err) => {
  console.error('Acting Intern plugin failed:', err);
  setStatus(`<p style="color:#c2410c;font-family:system-ui;">Error: ${String(err && err.message || err)}</p>`);
});
