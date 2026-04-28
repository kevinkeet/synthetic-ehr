/**
 * Acting Intern → G2 HUD relay (v4: Workers KV).
 *
 * EHR (browser) ↔ Cloudflare Worker (this) ↔ Even Hub plugin (phone WebView) ↔ G2.
 *
 * State lives in Workers KV, keyed by shared secret. KV is included in
 * the Workers Paid plan with generous limits (10M reads/day, 1M writes/day),
 * and unlike Durable Objects has no separate quota tier. Read-after-write
 * within the same region is typically <100ms, fast enough for our
 * 500ms plugin poll cadence.
 *
 * Caveat: KV writes are rate-limited to ~1/sec per key. We coalesce all
 * fields into one JSON blob per key, so very rapid POSTs (multiple
 * dictation events in <1s) may have a write dropped. The next write
 * (≥1s later) reflects the latest state — not loss, slight lag.
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
const TRANSCRIPT_BUFFER = 100;
const TRANSCRIPT_TTL_MS = 5 * 60_000;

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

async function readState(env, secret) {
  const raw = await env.HUD_STATE.get(secret);
  if (!raw) return emptyState();
  try {
    const stored = JSON.parse(raw);
    const base = emptyState();
    return { ...base, ...stored, views: { ...base.views, ...(stored.views || {}) } };
  } catch {
    return emptyState();
  }
}

async function writeState(env, secret, s) {
  // KV is rate-limited to ~1 write/sec per key; if it rejects, we silently
  // continue — the next write picks up the latest state.
  try {
    await env.HUD_STATE.put(secret, JSON.stringify(s));
  } catch (e) {
    console.warn('KV write failed (rate limit?):', e.message);
  }
}

function gcTranscripts(s) {
  const cutoff = Date.now() - TRANSCRIPT_TTL_MS;
  s.transcripts = s.transcripts.filter(t => t.ts >= cutoff).slice(-TRANSCRIPT_BUFFER);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const m = request.method;
    const p = url.pathname;

    if (m === 'OPTIONS') return withCors(new Response(null, { status: 204 }));
    if (p === '/health') return json({ ok: true, version: 'v4-kv' });

    const secret = request.headers.get('X-Glasses-Secret') || url.searchParams.get('secret') || '';
    if (!secret) return json({ error: 'missing secret' }, 401);

    if (p === '/state' && m === 'GET') {
      const s = await readState(env, secret);
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
      const s = await readState(env, secret);
      s.anchor = fit(body.anchor || '');
      s.version++;
      s.updatedAt = Date.now();
      await writeState(env, secret, s);
      return json({ ok: true, version: s.version });
    }

    if (p === '/event' && m === 'POST') {
      const body = await safeJson(request);
      const s = await readState(env, secret);
      if (typeof body.anchor === 'string') s.anchor = fit(body.anchor);
      if (body.event) s.bottom = formatBottom(body.event);
      s.version++;
      s.updatedAt = Date.now();
      await writeState(env, secret, s);
      return json({ ok: true, version: s.version });
    }

    if (p === '/views' && m === 'POST') {
      const body = await safeJson(request);
      const s = await readState(env, secret);
      if (body.views && typeof body.views === 'object') {
        for (const mode of VALID_MODES) {
          if (Array.isArray(body.views[mode])) s.views[mode] = body.views[mode];
        }
      }
      s.version++;
      s.updatedAt = Date.now();
      await writeState(env, secret, s);
      return json({ ok: true, version: s.version });
    }

    if (p === '/mode' && m === 'POST') {
      const body = await safeJson(request);
      const mode = body.mode;
      if (!VALID_MODES.includes(mode)) return json({ error: 'invalid mode' }, 400);
      const s = await readState(env, secret);
      s.desiredMode = mode;
      s.modeVersion++;
      s.version++;
      s.updatedAt = Date.now();
      await writeState(env, secret, s);
      return json({ ok: true, modeVersion: s.modeVersion });
    }

    if (p === '/transcript' && m === 'POST') {
      const body = await safeJson(request);
      if (typeof body.text !== 'string' || !body.text.trim()) {
        return json({ error: 'text required' }, 400);
      }
      const s = await readState(env, secret);
      s.transcriptHead++;
      s.transcripts.push({
        id: s.transcriptHead,
        text: body.text,
        isFinal: body.isFinal !== false,
        ts: Date.now(),
      });
      gcTranscripts(s);
      s.version++;
      s.updatedAt = Date.now();
      await writeState(env, secret, s);
      return json({ ok: true, id: s.transcriptHead });
    }

    if (p === '/transcripts' && m === 'GET') {
      const since = parseInt(url.searchParams.get('since') || '0', 10) || 0;
      const s = await readState(env, secret);
      const items = s.transcripts.filter(t => t.id > since);
      return json({ items, head: s.transcriptHead });
    }

    return json({ error: 'not found' }, 404);
  },
};
