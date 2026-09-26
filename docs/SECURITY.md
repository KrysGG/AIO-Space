# Security and privacy

## Threat model (short)

We load untrusted, heavily scripted websites next to each other in one app. Main risks:

1. **A site escaping into our app** (getting Node, IPC, or filesystem access). Worst case.
2. **Sites seeing each other's data** (cookies, storage) or linking identities across apps.
3. **Tracking and fingerprinting** by the sites themselves and third parties they load.
4. **Our own app leaking data** (telemetry, logs, weak storage).

## Invariants

These are enforced by review, and several by ESLint. Do not break them.

1. Every `BrowserWindow`/`WebContentsView`: `contextIsolation: true`, `sandbox: true`,
   `nodeIntegration: false`, `webSecurity: true`. `app.enableSandbox()` is called at startup.
2. `<webview>` is disabled (`will-attach-webview` is prevented everywhere).
3. Web app views have **no preload** until ROADMAP 3.4, and that preload may never expose IPC.
4. The UI window never navigates away from our bundled page; it cannot open windows.
5. IPC handlers accept messages only from the UI window's main frame (`fromUi()`), and parse every
   payload with zod. Invalid input is dropped.
6. Each app has its own session partition. Permission requests are denied unless listed in the
   app's `permissions`. The UI session denies all permissions.
7. App views may navigate only within `allowedHosts`. Other links go to the system browser, and
   only `http(s)` URLs are ever opened externally.
8. Popups are allowed only for `popupHosts` (sign-in flows), with the same hardened preferences.
9. Workspace file is written atomically with mode `0600`.
10. No telemetry, analytics, or crash upload from this app. Anything like that must be opt-in and
    documented here first.
11. Downloads only come from app sessions (the UI session cancels every download), are saved into the
    Downloads folder under a sanitized, never-overwriting name, and file types the desktop could run
    (scripts, `.desktop`, installers, binaries) are never opened from the app, only shown in the folder.
12. User-added apps are validated like IPC input: https start page, real hostnames (never `*`),
    permissions off unless granted, icons only as small raster data URLs.

## Packaging hardening (ROADMAP 5.3)

Apply Electron fuses at build time:

| Fuse | Value |
| --- | --- |
| RunAsNode | off |
| EnableNodeOptionsEnvironmentVariable | off |
| EnableNodeCliInspectArguments | off |
| EnableEmbeddedAsarIntegrityValidation | on |
| OnlyLoadAppFromAsar | on |
| EnableCookieEncryption | on |

Also run `electronegativity` and go through Electron's security checklist before each release.

## Privacy features ("Shields")

Settings live in `packages/core/src/privacy/settings.ts`; implementation in
`apps/desktop/src/main/privacy`. Global defaults, overridable per app.

| Feature | Brave equivalent | Status |
| --- | --- | --- |
| Isolated session per app | Separate profiles | Done |
| Clean user agent (no "Electron") | n/a | Done |
| Strip tracking query params | Query filtering | Done (starter list) |
| Global Privacy Control header | GPC | Done (header). JS `navigator.globalPrivacyControl` in 3.4 |
| Cross-origin referrer trimming | Referrer policy | Done |
| HTTPS upgrade | HTTPS by default | Done, fallback in 3.2 |
| WebRTC local IP protection | WebRTC IP policy | Done (keeps Discord voice working) |
| Tracker and telemetry blocking | Shields trackers | Starter list; filter lists in 3.5 |
| Ad blocking | Shields ads | 3.6 |
| Third-party cookie blocking | Cookie blocking | Done for HTTP cookies (3.3); script-set cookies in cross-site frames: Backlog |
| Fingerprint randomization | Farbling | 3.4 |
| Discord telemetry endpoints | n/a | Done (`/api/v*/science`, `/metrics`) |

Blocking breaks sites sometimes, so every app has a Shields panel (shield in its tile header, ROADMAP 3.1):
a master off switch and per-feature switches, stored as per-app overrides of the defaults in the menu.
