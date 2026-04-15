---
name: Even Realities G2 Development Guide
description: Complete reference for building Even Hub apps for G2 smart glasses — SDK, display, packaging, debugging
type: reference
---

# Even Realities G2 Smart Glasses — Developer Reference

## Hardware Specs
- **Display**: 576 × 288 pixels per eye (single display from app perspective)
- **Color**: 4-bit greyscale (16 shades of green). White = bright green, black = off/transparent
- **Audio**: 4-mic array, 16kHz PCM mono
- **Input**: G2 touchpads (press, double press, swipe up, swipe down) + optional R1 ring (same gestures)
- **Connectivity**: Bluetooth 5.2
- **No camera, no speaker**
- **App logic runs on the phone** — glasses only handle display rendering and native scroll

## Architecture
```
Even Hub Cloud ←→ Phone (Even Realities App + WebView) ←→ G2 Glasses (display + input)
```
Apps are standard web apps running in a WebView inside the Even Realities phone app. The SDK provides a JavaScript bridge (`EvenAppBridge`) to control the glasses display and receive input.

## SDK Package
```bash
npm install @evenrealities/even_hub_sdk
```
Current version: 0.0.9 (published 2026-03-25)

## CLI Package
```bash
npm install -D @evenrealities/evenhub-cli
```
Current version: 0.1.11. Handles auth, QR sideloading, and .ehpk packaging.

## Simulator
```bash
npm install @evenrealities/evenhub-simulator
# Run: node node_modules/@evenrealities/evenhub-simulator/bin/index.js http://localhost:5173
```

## Critical Pattern: Use PLAIN OBJECTS, Not Class Instances

**This is the #1 gotcha.** The bridge serializes plain objects correctly but class instances may not serialize fields:

```javascript
// CORRECT — plain objects
await bridge.createStartUpPageContainer({
  containerTotalNum: 1,
  textObject: [{
    xPosition: 0, yPosition: 0, width: 576, height: 288,
    borderWidth: 0, borderColor: 0, borderRadius: 0, paddingLength: 0,
    containerID: 1, containerName: 'main',
    content: 'Hello World',
    isEventCapture: 1,
  }],
});

// WRONG — class instances may produce empty/invalid payloads
const tc = new TextContainerProperty({...});
const page = new CreateStartUpPageContainer({ textObject: [tc] });
await bridge.createStartUpPageContainer(page); // Returns 1 (invalid)
```

## WebView Limitations

The Even Realities WebView may NOT support `<script type="module">`. When using Vite:

1. Build with `format: 'iife'` in rollupOptions
2. Post-process `dist/index.html` to remove `type="module"` and `crossorigin` from script tags
3. Or use a bundler that outputs classic script format

```javascript
// vite.config.js
export default defineConfig({
  base: './',
  build: {
    target: 'es2015',
    rollupOptions: {
      output: {
        format: 'iife',
        entryFileNames: 'assets/app.js',
      },
    },
  },
});
```

Then post-process: `sed -i '' 's/type="module" crossorigin //' dist/index.html`

## Display System — No CSS, No DOM

The glasses display uses **containers** positioned with absolute pixel coordinates. No CSS, no flexbox, no DOM.

### Container Types
- **Text**: max 8 per page, 1000 chars at startup / 2000 during upgrade
- **Image**: max 4 per page, 20-200px wide, 20-100px tall, 4-bit greyscale
- **List**: max 20 items, 64 chars per item, native scroll

### Rules
- Max 4 image + 8 other containers per page (12 total)
- Exactly ONE container must have `isEventCapture: 1`
- `containerName` max 16 characters
- ~400-500 characters fill a full-screen text container
- `\n` works for line breaks
- Unicode supported within firmware font set

### Useful Unicode for UIs
- Progress bars: ━ ─ █▇▆▅▄▃▂▁
- Navigation: ▲△▶▷▼▽◀◁
- Selection: ●○ ■□ ★☆
- Borders: ╭╮╯╰ │─

## Page Lifecycle

```javascript
// Called ONCE at startup
bridge.createStartUpPageContainer({
  containerTotalNum: N,
  textObject: [...],
  imageObject: [...],
  listObject: [...],
})
// Returns: 0=success, 1=invalid, 2=oversize, 3=out of memory

// Update text in-place (flicker-free, preferred for frequent updates)
bridge.textContainerUpgrade({
  containerID: 1,
  containerName: 'main',
  content: 'new text',
  contentOffset: 0,
  contentLength: N,
})
// Returns: boolean

// Full page rebuild (when layout changes)
bridge.rebuildPageContainer({
  containerTotalNum: N,
  textObject: [...],
})
// Returns: boolean

// Exit app
bridge.shutDownPageContainer(0) // 0=immediate, 1=confirmation dialog
```

## Input Events

```javascript
bridge.onEvenHubEvent(event => {
  const te = event.textEvent;
  if (!te) return;

  // Use raw numeric values — importing OsEventTypeList may cause issues
  switch (te.eventType) {
    case 0:         // CLICK_EVENT (press)
    case undefined: // SDK normalizes 0 to undefined sometimes
      break;
    case 1: break;  // SCROLL_TOP_EVENT (swipe up)
    case 2: break;  // SCROLL_BOTTOM_EVENT (swipe down)
    case 3: break;  // DOUBLE_CLICK_EVENT
    case 4: break;  // FOREGROUND_ENTER_EVENT
    case 5: break;  // FOREGROUND_EXIT_EVENT
    case 6: break;  // ABNORMAL_EXIT_EVENT
  }
});
```

## Device APIs

```javascript
// Audio capture (PCM 16kHz mono)
await bridge.audioControl(true);  // start
await bridge.audioControl(false); // stop
// Audio arrives via event.sysEvent.audioData

// Device info
const info = await bridge.getDeviceInfo();
// Returns: model, serial, battery, wearing status, charging, in-case

// User info
const user = await bridge.getUserInfo();

// Local storage (persisted on phone)
await bridge.setLocalStorage('key', 'value');
const val = await bridge.getLocalStorage('key');

// IMU (accelerometer/gyroscope)
await bridge.imuControl(true, ImuReportPace.P500);
// Data arrives via event.sysEvent.imuData (x, y, z floats)
```

## app.json Manifest

```json
{
  "package_id": "com.yourname.appname",
  "edition": "202601",
  "name": "App Name (max 20 chars)",
  "version": "1.0.0",
  "min_app_version": "2.0.0",
  "min_sdk_version": "0.0.7",
  "entrypoint": "index.html",
  "permissions": [
    { "name": "network", "desc": "Why needed (1-300 chars)", "whitelist": ["https://api.example.com"] },
    { "name": "g2-microphone", "desc": "Why needed" }
  ],
  "supported_languages": ["en"]
}
```

Permission names: `network`, `location`, `g2-microphone`, `phone-microphone`, `album`, `camera`

## Packaging & Deployment

```bash
# Build
npm run build

# Pack
npx evenhub pack app.json dist -o myapp.ehpk

# QR sideload (for dev — loads from local dev server with hot reload)
npx evenhub qr --url "http://192.168.x.x:5173"

# Upload to Even Hub portal
# Go to hub.evenrealities.com/hub → Upload package → drag .ehpk
```

## Initialization Sequence (from working apps)

1. `await waitForEvenAppBridge()` — no timeout wrapper, no try/catch
2. `await bridge.createStartUpPageContainer({...})` — show content IMMEDIATELY
3. `bridge.onEvenHubEvent(handler)` — register events AFTER page creation
4. Fetch data, start polling, etc. — AFTER display is up

Do NOT:
- Wrap `waitForEvenAppBridge` in `Promise.race` with timeout
- Register event handlers before creating the startup page
- Import `OsEventTypeList` if it causes bundle issues — use raw numbers
- Use class instances (`new TextContainerProperty()`) — use plain objects

## Debugging

- The phone WebView may not show HTML content — it only routes SDK calls to glasses
- `createStartUpPageContainer` returns 1 in regular browsers (no Flutter handler)
- Use the simulator for layout testing: `evenhub-simulator http://localhost:5173`
- Check if glasses are connected and worn: `bridge.getDeviceInfo()`
- `createStartUpPageContainer` can only be called once per app lifecycle — use `rebuildPageContainer` after

## Even Hub Portal
- URL: https://hub.evenrealities.com/hub
- Upload .ehpk builds, manage testing groups, publish to store
- Even Hub launched April 3, 2026

## Key Resources
- SDK npm: https://www.npmjs.com/package/@evenrealities/even_hub_sdk
- Docs: https://hub.evenrealities.com/docs/
- EvenChess (working example): https://github.com/dmyster145/EvenChess
- Pong (working example): https://github.com/nickustinov/pong-even-g2
- G2 BLE Protocol (reverse eng): https://github.com/i-soxi/even-g2-protocol
- Even Hub Simulator: https://github.com/BxNxM/even-dev
