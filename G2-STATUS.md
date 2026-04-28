# G2 Glasses HUD — Overnight Build Notes

## What's new since last night

Three big things, all wired together end-to-end:

1. **Multi-view menu on G2** — six modes you can navigate locally:
   - **live** (default) — anchor + last dictation/order event
   - **notes** — paginated through recent clinical notes
   - **ai** — AI gestalt → summary → trajectory → demographics → presentation
   - **problems** — paginated problem list with urgency markers (`!` / `~`)
   - **alerts** — safety flags, critical labs, allergies
   - **plan** — suggested actions from the AI panel

2. **G2 ring + temple navigation** — built using the official SDK event types:
   - **Single tap** (ring or temple) → cycle to next mode
   - **Scroll up / down** → previous / next page within the current mode
   - **Double tap** → jump back to live mode

3. **G2 mic dictation** — open the G2 mic, stream PCM s16le 16 kHz mono to Deepgram's WebSocket, post final transcripts back to the relay; the EHR injects them into `DictationWidget._processFinalText` as if they came from the laptop mic. All your existing voice commands keep working — just spoken into the glasses now.

Plus voice-command mode switching: **"show notes"**, **"show AI"**, **"show problem list"**, **"show alerts"**, **"show plan"**, **"back to live"** all push the desired mode to the plugin via the relay.

## Morning checklist

### 1. Update the EHR (~30 sec)
```
Hard refresh actingintern.com   (Cmd+Shift+R)
```
You should see cache `20260427e` and a new "Use G2 mic for dictation" checkbox in the **G2** settings modal.

### 2. Upload the new plugin (~2 min)
- File: [evenhub-plugin/acting-intern.ehpk](evenhub-plugin/acting-intern.ehpk) (33 KB, built `0.2.0`)
- Go to https://hub.evenrealities.com/ → submit as **Private Build** (no review).
- New permissions you'll see in the upload prompt: `g2-microphone` and additional network whitelist entries for `api.deepgram.com` (REST + WSS).
- Install on your G2 through the Even Realities phone app.

### 3. Configure the plugin (~30 sec, one-time)
First launch shows a setup form with three fields now:
- **Relay URL** — same as before: `https://acting-intern-relay.kevinkeet.workers.dev`
- **Shared secret** — same as you set in the EHR
- **Deepgram API key** — *new, optional*. Paste your Deepgram key here to enable G2 mic dictation. Leave blank to skip that feature.

### 4. (Optional) Turn on G2 mic in the EHR
- AI panel → **G2** button → check **"Use G2 mic for dictation"** → Save.
- The EHR will now poll the relay for transcripts every 250 ms and feed them to `DictationWidget._processFinalText`. You can still use the laptop mic too — they don't conflict.

## What to test

| Scenario | Expected |
|---|---|
| Open a patient | Anchor like `RM 74M · HFrEF · Cr 2.4↑` appears on G2 within ~3 s |
| Run AI analysis | After it finishes, anchor expands with the dominant Dx; problems / plan / alerts pages populate |
| Dictate "show notes" | Bottom flashes `"→ notes" ✓`, then plugin switches to notes mode and shows page 1 |
| Scroll down on ring | Page 2 of notes appears |
| Double tap ring | Back to live mode, anchor + bottom |
| Single tap ring | Cycles through modes (live → notes → ai → problems → alerts → plan → live) |
| Speak into G2 mic (with Deepgram key set + "Use G2 mic" enabled) | Spoken finding shows on bottom of G2 within ~1 s, AND lands in the EHR's Ambient Scribe / dictation flow |

## Likely issues + diagnostics

**Plugin shows setup form repeatedly on launch**
WebView may have cleared localStorage. Re-enter the values once.

**"Even app bridge not available"**
Plugin opened in a desktop browser instead of the Even Realities app WebView. Open it from the app on the phone.

**Anchor shows but mode-switching does nothing**
Open the EHR browser console. Filter for `[GlassesBridge]`. You should see `mode → notes` etc. when you say a command. If yes, the EHR side is fine — likely the plugin isn't seeing the modeVersion increment on its next poll (check phone-side debugger for `EHR set mode →` log line).

**G2 mic shows "G2 mic dictation: disabled"**
Deepgram key wasn't saved. Tap **Reconfigure** in the plugin and re-enter.

**Deepgram says "401" or websocket closes immediately**
API key wrong or expired. Try `curl -H "Authorization: Token $KEY" https://api.deepgram.com/v1/projects` to verify.

**Ring inputs feel ambiguous (single vs double tap)**
The G2 SDK only exposes 4 input types — `CLICK`, `DOUBLE_CLICK`, `SCROLL_TOP`, `SCROLL_BOTTOM`. There's no long-press. If you want different bindings (e.g. swap "single = next mode" with "single = next page"), say which and I'll swap them — it's one switch statement in [evenhub-plugin/src/main.ts](evenhub-plugin/src/main.ts).

## Architecture cheat-sheet

```
EHR browser (actingintern.com)
   │
   ├─ POST /event,  /anchor    [voice / scribe / order events]
   ├─ POST /views               [refreshed every 5 s]
   ├─ POST /mode                [voice command "show notes" etc.]
   ├─ GET  /transcripts?since=N [polled every 250 ms when "Use G2 mic" is on]
   │
   ▼
Cloudflare Worker (acting-intern-relay)
   │  state in Durable Object, per-secret namespaced
   ▲
   ├─ GET  /state               [polled every 500 ms]
   ├─ POST /transcript          [each final Deepgram result]
   │
Even Hub plugin (in Even Realities phone WebView)
   │
   ├─ G2 mic → audioControl(true) → audioPcm chunks
   ├─        → Deepgram WebSocket (linear16 16k mono)
   ├─        → final transcripts → POST /transcript
   │
   ├─ Ring/temple events → onEvenHubEvent
   │   ├─ CLICK → cycle mode
   │   ├─ DOUBLE_CLICK → live
   │   └─ SCROLL_TOP/BOTTOM → page
   │
   └─ textContainerUpgrade → 2 stacked text containers on G2
```

## Files changed in this build

- [relay/src/worker.js](relay/src/worker.js) — added `views`, `desiredMode`, transcript queue endpoints (already deployed)
- [js/services/glasses-bridge.js](js/services/glasses-bridge.js) — `pushViews`, `setDesiredMode`, `buildViews`, mic poll loop, settings UI updates
- [js/services/glasses-bridge-wiring.js](js/services/glasses-bridge-wiring.js) — voice command regex → `setDesiredMode`, periodic views push
- [evenhub-plugin/app.json](evenhub-plugin/app.json) — `g2-microphone` permission, Deepgram WSS whitelist, version `0.2.0`
- [evenhub-plugin/src/main.ts](evenhub-plugin/src/main.ts) — full rewrite for navigation + mic capture + Deepgram client
- [index.html](index.html) — cache version `20260427e`

## What I did NOT verify (you'll need real hardware)

- Actual ring scroll firing `SCROLL_TOP`/`SCROLL_BOTTOM` events the way the docs claim
- Actual G2 mic audio arriving as PCM (vs. some other format the docs got wrong about)
- Deepgram WebSocket auth via `['token', apiKey]` subprotocol from inside the WebView (browser variation)

If any of those fail, ping me — they're 5–15 minute fixes once you can show me the console output from the phone WebView.
