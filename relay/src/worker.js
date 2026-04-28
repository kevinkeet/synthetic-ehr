/**
 * Acting Intern → G2 HUD relay.
 *
 * EHR (browser) POSTs the latest {anchor, event} here.
 * Even Hub plugin (running in a phone WebView) GETs /state and renders to G2.
 *
 * State lives in a Durable Object keyed by shared secret. Each unique secret
 * gets its own globally-singleton DO instance with persistent SQLite storage,
 * so the EHR's POST and the plugin's poll always see consistent state even
 * when they hit different Worker isolates.
 *
 * Auth: every request must carry the shared secret in `X-Glasses-Secret`
 *       header OR `?secret=` query param. The secret is the namespace key.
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Glasses-Secret, X-User-Id',
  'Access-Control-Max-Age': '86400',
};

function withCors(resp) {
  for (const [k, v] of Object.entries(CORS_HEADERS)) resp.headers.set(k, v);
  return resp;
}

function json(body, status = 200) {
  return withCors(new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  }));
}

function fit(s, max = 40) {
  if (!s) return '';
  s = String(s);
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

function formatBottom(ev) {
  if (!ev || ev.kind === 'clear') return '';
  const glyph = ev.glyph ? ' ' + ev.glyph : '';
  const prefix =
    ev.kind === 'dictation' ? '“' :
    ev.kind === 'order'     ? '→ ' :
    ev.kind === 'alert'     ? '⚠ ' : '';
  const close = ev.kind === 'dictation' ? '”' : '';
  return fit(`${prefix}${ev.text || ''}${close}${glyph}`);
}

async function safeJson(request) {
  try { return await request.json(); } catch { return {}; }
}

const EMPTY_STATE = { anchor: '', bottom: '', version: 0, updatedAt: 0 };

/**
 * Durable Object: one instance per shared secret. Holds the live HUD state.
 */
export class HudState {
  constructor(state) {
    this.state = state;
  }

  async _read() {
    return (await this.state.storage.get('hud')) || { ...EMPTY_STATE };
  }

  async _write(data) {
    await this.state.storage.put('hud', data);
    return data;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/state' && request.method === 'GET') {
      const s = await this._read();
      return json(s);
    }

    if (url.pathname === '/anchor' && request.method === 'POST') {
      const body = await safeJson(request);
      const s = await this._read();
      s.anchor = fit(body.anchor || '');
      s.version++;
      s.updatedAt = Date.now();
      await this._write(s);
      return json({ ok: true, version: s.version });
    }

    if (url.pathname === '/event' && request.method === 'POST') {
      const body = await safeJson(request);
      const s = await this._read();
      if (typeof body.anchor === 'string') s.anchor = fit(body.anchor);
      if (body.event) s.bottom = formatBottom(body.event);
      s.version++;
      s.updatedAt = Date.now();
      await this._write(s);
      return json({ ok: true, version: s.version });
    }

    return json({ error: 'not found' }, 404);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return withCors(new Response(null, { status: 204 }));
    }

    if (url.pathname === '/health') {
      return json({ ok: true });
    }

    const secret = request.headers.get('X-Glasses-Secret') || url.searchParams.get('secret') || '';
    if (!secret) return json({ error: 'missing secret' }, 401);

    // Route to the per-secret Durable Object.
    const id = env.HUD_STATE.idFromName(secret);
    const stub = env.HUD_STATE.get(id);
    return stub.fetch(request);
  },
};
