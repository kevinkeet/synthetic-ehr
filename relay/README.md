# Acting Intern HUD Relay

A ~50-line Cloudflare Worker that holds the latest `{anchor, bottom}` HUD state and brokers between two clients that can't talk to each other directly:

```
┌──────────────┐    POST /event     ┌─────────┐    GET /state    ┌───────────────┐
│ EHR (browser)│ ─────────────────▶ │ Worker  │ ◀─────────────── │ Even Hub      │
│ actingintern │                    │ (this)  │                  │ plugin in G2  │
│   .com       │                    │         │                  │ phone WebView │
└──────────────┘                    └─────────┘                  └───────────────┘
```

State is held in module memory keyed by your shared secret — no KV, no DO, free tier only. The EHR re-pushes the anchor every few seconds and re-pushes events as they happen, so a cache miss self-heals on the next push.

## Deploy

```bash
cd relay
npm install
npx wrangler login                      # one-time
npm run deploy
```

Wrangler prints a public URL, e.g. `https://acting-intern-relay.<you>.workers.dev`. Use that URL in:
- the EHR's G2 settings panel (Endpoint)
- the Even Hub plugin's `app.json` (`permissions[].whitelist`)
- both clients' `X-Glasses-Secret` header

Generate a fresh secret with `openssl rand -hex 32`.

## Local dev

```bash
npm run dev    # serves on http://localhost:8787
```

## API

All endpoints accept the shared secret as either:
- header `X-Glasses-Secret: <secret>`, or
- query string `?secret=<secret>` (handy for the plugin's GET requests)

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/health` | — | `{ok, secrets}` (no auth) |
| GET | `/state` | — | `{anchor, bottom, version, updatedAt}` |
| POST | `/anchor` | `{anchor}` | `{ok, version}` |
| POST | `/event` | `{anchor?, event: {kind, text, glyph?}}` | `{ok, version}` |

`event.kind`: `dictation` (quoted text), `order` (`→` prefix), `alert` (`⚠` prefix), `clear` (clears bottom).

`version` increments on every write. The plugin polls `/state` and only re-renders when version changes.
