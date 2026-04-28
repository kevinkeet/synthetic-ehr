/**
 * Acting Intern → G2 HUD relay (v2: views + voice control + G2 mic).
 *
 * EHR (browser) ↔ Cloudflare Worker ↔ Even Hub plugin (phone WebView) ↔ G2.
 *
 * State model (per shared secret, in a Durable Object):
 *   anchor         - persistent top line on G2
 *   bottom         - transient bottom line on G2 (live mode only)
 *   views          - { live, notes[], ai[], problems[], alerts[], plan[] }
 *                    multi-page content the plugin can navigate locally
 *                    via ring/temple inputs
 *   desiredMode    - EHR can set "notes"|"ai"|"problems"|"alerts"|"plan"|"live"
 *                    (e.g. via voice "show notes"); plugin honors on next poll
 *   modeVersion    - increments when desiredMode changes; plugin tracks last seen
 *   version        - increments on any anchor/bottom/views change
 *   transcripts    - ring buffer of {id, text, isFinal, ts} from G2 mic
 *   transcriptHead - id of newest transcript
 *   updatedAt      - ms timestamp of last write
 *
 * Auth: every request carries the shared secret in `X-Glasses-Secret`
 *       header OR `?secret=` query param. Secret is the namespace key.
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

// Loose cap for storage; the plugin word-wraps inside the G2's 144-px-tall
// container, so we don't need to truncate aggressively here.
function fit(s, max = 200) {
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
  return fit(`${prefix}${ev.text || ''}${close}${glyph}`, 200);
}

async function safeJson(request) {
  try { return await request.json(); } catch { return {}; }
}

const VALID_MODES = ['live', 'dictation', 'notes', 'ai', 'problems', 'alerts', 'plan'];
const TRANSCRIPT_BUFFER = 100;        // keep last N transcripts
const TRANSCRIPT_TTL_MS = 5 * 60_000; // drop transcripts older than 5 min

function emptyState() {
  return {
    anchor: '',
    bottom: '',
    views: { live: [], dictation: [], notes: [], ai: [], problems: [], alerts: [], plan: [] },
    desiredMode: null,
    modeVersion: 0,
    version: 0,
    transcripts: [],
    transcriptHead: 0,
    updatedAt: 0,
  };
}

/**
 * Durable Object: one instance per shared secret.
 */
export class HudState {
  constructor(state) {
    this.state = state;
  }

  async _read() {
    const stored = await this.state.storage.get('hud');
    if (!stored) return emptyState();
    // Backfill missing fields from older state shapes.
    const base = emptyState();
    return { ...base, ...stored, views: { ...base.views, ...(stored.views || {}) } };
  }

  async _write(data) {
    await this.state.storage.put('hud', data);
    return data;
  }

  _gcTranscripts(s) {
    const cutoff = Date.now() - TRANSCRIPT_TTL_MS;
    s.transcripts = s.transcripts.filter(t => t.ts >= cutoff).slice(-TRANSCRIPT_BUFFER);
  }

  async fetch(request) {
    const url = new URL(request.url);
    const m = request.method;
    const p = url.pathname;

    if (p === '/state' && m === 'GET') {
      const s = await this._read();
      // Don't return the full transcript buffer here — separate endpoint.
      return json({
        anchor: s.anchor,
        bottom: s.bottom,
        views: s.views,
        desiredMode: s.desiredMode,
        modeVersion: s.modeVersion,
        version: s.version,
        transcriptHead: s.transcriptHead,
        updatedAt: s.updatedAt,
      });
    }

    if (p === '/anchor' && m === 'POST') {
      const body = await safeJson(request);
      const s = await this._read();
      s.anchor = fit(body.anchor || '');
      s.version++;
      s.updatedAt = Date.now();
      await this._write(s);
      return json({ ok: true, version: s.version });
    }

    if (p === '/event' && m === 'POST') {
      const body = await safeJson(request);
      const s = await this._read();
      if (typeof body.anchor === 'string') s.anchor = fit(body.anchor);
      if (body.event) s.bottom = formatBottom(body.event);
      s.version++;
      s.updatedAt = Date.now();
      await this._write(s);
      return json({ ok: true, version: s.version });
    }

    if (p === '/views' && m === 'POST') {
      const body = await safeJson(request);
      const s = await this._read();
      if (body.views && typeof body.views === 'object') {
        // Merge per-mode arrays, accept only known modes.
        for (const mode of VALID_MODES) {
          if (Array.isArray(body.views[mode])) s.views[mode] = body.views[mode];
        }
      }
      s.version++;
      s.updatedAt = Date.now();
      await this._write(s);
      return json({ ok: true, version: s.version });
    }

    if (p === '/mode' && m === 'POST') {
      const body = await safeJson(request);
      const mode = body.mode;
      if (!VALID_MODES.includes(mode)) return json({ error: 'invalid mode' }, 400);
      const s = await this._read();
      s.desiredMode = mode;
      s.modeVersion++;
      s.version++;
      s.updatedAt = Date.now();
      await this._write(s);
      return json({ ok: true, modeVersion: s.modeVersion });
    }

    if (p === '/transcript' && m === 'POST') {
      const body = await safeJson(request);
      if (typeof body.text !== 'string' || !body.text.trim()) {
        return json({ error: 'text required' }, 400);
      }
      const s = await this._read();
      s.transcriptHead++;
      s.transcripts.push({
        id: s.transcriptHead,
        text: body.text,
        isFinal: body.isFinal !== false,
        ts: Date.now(),
      });
      this._gcTranscripts(s);
      s.version++;
      s.updatedAt = Date.now();
      await this._write(s);
      return json({ ok: true, id: s.transcriptHead });
    }

    if (p === '/transcripts' && m === 'GET') {
      const since = parseInt(url.searchParams.get('since') || '0', 10) || 0;
      const s = await this._read();
      const items = s.transcripts.filter(t => t.id > since);
      return json({ items, head: s.transcriptHead });
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
      return json({ ok: true, version: 'v2' });
    }

    const secret = request.headers.get('X-Glasses-Secret') || url.searchParams.get('secret') || '';
    if (!secret) return json({ error: 'missing secret' }, 401);

    const id = env.HUD_STATE.idFromName(secret);
    const stub = env.HUD_STATE.get(id);
    return stub.fetch(request);
  },
};
