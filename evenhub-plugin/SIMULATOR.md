# Even Hub Simulator — fast iteration loop

The G2 simulator renders the plugin display at 1:1 (576×288) with the same
font/spacing the real glasses use. **Use it instead of re-uploading `.ehpk`
files for every layout tweak.**

## Run it (two terminals)

```bash
# Terminal 1 — Vite dev server (hot reloads on src/main.ts edits)
cd evenhub-plugin
npm run dev          # serves on http://localhost:5173

# Terminal 2 — Simulator with automation API enabled
npm run sim          # opens window + HTTP API on :9898
```

The simulator window shows the G2 display (top half) plus a webview pane
(bottom half — the plugin's HTML, normally hidden in the real Even app).
Edit `src/main.ts`, save, simulator hot-reloads.

## What's accurate vs. not (per Even Realities)

| ✓ accurate enough | ⚠ may differ from hardware |
|---|---|
| Layout (positions, sizes, line counts) | Font rendering at the pixel level |
| Page container behavior | Status events (audio/IMU not emitted) |
| Touchpad: click, double-click, scroll up/down | List-focus behavior in some edge cases |
| `audioEvent` payloads (16 kHz s16le PCM, 100 ms chunks) | Image processing speed (faster on sim) |

**Real-device validation is still required before shipping** — but for the
"is my display laid out right" question, the simulator is reliable.

## How Claude (or any script) drives the simulator

When the simulator runs with `--automation-port 9898`, it exposes an HTTP
control plane on `http://127.0.0.1:9898`:

```bash
# Health
curl http://127.0.0.1:9898/api/ping

# Capture exactly what's on the G2 right now (RGBA PNG, 576×288)
curl -o /tmp/g2.png http://127.0.0.1:9898/api/screenshot/glasses

# Read console.log output (incremental polling supported)
curl 'http://127.0.0.1:9898/api/console?since_id=0'
curl -X DELETE http://127.0.0.1:9898/api/console     # clear buffer

# Send touchpad input — same as ring/temple on real G2
curl -X POST http://127.0.0.1:9898/api/input -H 'Content-Type: application/json' \
  -d '{"action":"click"}'           # CLICK_EVENT
curl -X POST http://127.0.0.1:9898/api/input -d '{"action":"double_click"}'
curl -X POST http://127.0.0.1:9898/api/input -d '{"action":"up"}'    # SCROLL_TOP
curl -X POST http://127.0.0.1:9898/api/input -d '{"action":"down"}'  # SCROLL_BOTTOM
```

So when you (Kevin) say "the layout looks wrong", we can:
1. You run `npm run dev` + `npm run sim`
2. I curl `/api/screenshot/glasses`, read the PNG
3. I see exactly what you see; iterate without another `.ehpk` upload

## When you DO need to upload a new `.ehpk`

Only when:
- Manifest changes (`app.json`)
- New SDK version
- Final hardware validation

For everything layout-related, the simulator is sufficient.

## Plugin setup form in the simulator

First launch in the simulator shows the same setup form as the real plugin.
Enter:
- Relay URL: `https://acting-intern-relay.kevinkeet.workers.dev` (prefilled)
- Shared secret: same as the EHR
- Deepgram key (optional)

The simulator's localStorage persists between launches.
