# Acting Intern — Even Hub plugin (G2)

Renders the live Acting Intern HUD on Even Realities G2 glasses. Two-line layout:

```
┌──────────────────────────────────────────────────────┐
│  RM 73M HFrEF · Cr 2.4↑ eGFR 28                      │  ← anchor (persistent)
│  → Furosemide 80 IV q12h                       ⚠     │  ← bottom (latest event)
└──────────────────────────────────────────────────────┘
                576 × 288 px greyscale
```

This plugin **does not talk to the EHR directly.** It polls a relay (Cloudflare Worker, see `../relay/`) every 500 ms and re-renders when the version changes. The EHR pushes updates to that same relay.

## One-time setup

1. **Install evenhub-cli + log in**
   ```bash
   npm install -g @evenrealities/evenhub-cli
   evenhub login
   ```
2. **Install plugin deps**
   ```bash
   cd evenhub-plugin
   npm install
   ```
3. **Deploy the relay** (separate package) and note its URL. See `../relay/README.md`.
4. **Update `app.json`** — replace the URL in `permissions[0].whitelist` with your actual deployed relay URL. The Even Realities app blocks any fetch that isn't whitelisted.

## Dev loop — sideload to G2 with hot reload

```bash
npm run dev          # starts vite on http://localhost:5173
# in another terminal:
npm run qr           # generates a QR code in the terminal
```

Scan the QR code with the Even Realities app. The plugin loads in the WebView and renders to G2 with hot reload — no .ehpk needed during dev. Whitelist is bypassed for sideloaded apps.

On first launch, the plugin shows a setup form (relay URL + shared secret). Enter the same values you configured in the EHR's G2 settings panel.

## Build the .ehpk

```bash
npm run pack
```

Produces `acting-intern.ehpk` in the plugin directory. This is what you upload to https://hub.evenrealities.com/ — submit as a **Private Build** to skip review and install only on your own paired devices.

## Display constraints

- 576 × 288 per eye, 4-bit greyscale
- No font size control — both lines render at the same size
- `textContainerUpgrade` content limit: 2,000 chars
- Two stacked text containers (IDs 1 = anchor top half, 2 = bottom event)

## Troubleshooting

| Symptom | Cause |
|---|---|
| Plugin shows "Even app bridge not available" | Opened in a desktop browser instead of the Even app WebView |
| Setup form keeps reappearing | localStorage cleared by the WebView; re-enter |
| HUD never updates | Relay URL / secret mismatch with EHR — check `/health` on the relay first |
| Whitelist error in production .ehpk | `app.json` `permissions[0].whitelist` doesn't match the relay URL exactly |
