# Access gate — operator notes

A password-protected entry to actingintern.com with an Anthropic API key
encrypted under that password and embedded in the build. Designed for a small
trusted group; not for public release.

## Threat model (read this first)

Mitigated:
- Random visitor hits the URL — blocked by password.
- Someone shares the URL but not the password — useless without the password.
- Someone downloads the JS source — the API key is AES-GCM ciphertext;
  decrypting requires the password. Each guess pays the cost of a 250 000-round
  PBKDF2 derivation, so offline brute-force is slow but not impossible for weak
  passwords.

Not mitigated:
- Anyone you give the password to has the key for life. They can extract it
  from their browser's localStorage at any time.
- If the password leaks publicly, your Anthropic quota gets drained until you
  rotate.

Backstop you MUST set:
- A monthly spending cap on your Anthropic account
  (console.anthropic.com → Settings → Billing → Usage limits). If anything goes
  wrong, the cap stops the bleeding.

## One-time setup

```bash
node scripts/setup-access.js
```

You'll be prompted for:
1. Your Anthropic API key (`sk-ant-...`)
2. An access password (twice)

Writes `js/access-config.js` with the encrypted key. Then:

```bash
git add js/access-config.js
# bump cache version in index.html if you want users to refresh
git commit -m "Enable access gate"
git push origin main && git push shared main
```

Share the password with your trusted group out-of-band (Signal, in person —
not in the repo, not in chat that's logged).

## How users experience it

First visit to actingintern.com:
1. Full-screen modal: "Enter access password"
2. They type the password and hit Unlock.
3. The API key is decrypted and saved in their browser's localStorage.
4. They never see the modal again on that device.

After 3 wrong attempts: 30s lockout. After 6: 5 min. After 9: 30 min.
Lockouts are per browser tab session (clear on tab close).

There's also a "use your own Anthropic API key" link at the bottom of the
modal for power users who'd rather bring their own.

## Rotating the password or the key

Re-run `node scripts/setup-access.js`, commit the new `js/access-config.js`,
bump cache version, push. Existing users with the old password still have a
cached unlock flag in their localStorage, so they won't be re-prompted unless
you also force a re-lock — either:
- Have them clear site data, OR
- Add a one-line bump to `access-gate.js` that clears the `access-granted` key
  when a new build is detected.

## If you ever want to disable the gate

Delete `js/access-config.js` (or empty it). On next load, `window.ACCESS_CONFIG`
will be undefined, the gate self-disables, and the app falls back to the
existing "user supplies own key in settings" flow.

## Files

- `scripts/setup-access.js` — Node CLI to encrypt and write the config.
- `js/access-config.js` — Generated. Encrypted key blob. Safe to commit.
- `js/services/access-gate.js` — Browser-side modal + decryption.
- `css/epic-theme.css` — Modal styles (search for `#access-gate-overlay`).
- `index.html` — Loads access-config.js and access-gate.js BEFORE any other
  service.
