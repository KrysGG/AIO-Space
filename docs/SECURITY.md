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
3. Web app views get only `preload/webapp.ts` (ROADMAP 3.4) and their session's generated scriptlet preload
   (3.6, D-041). Neither uses IPC or exposes anything to the page. They read settings from
   `additionalArguments` and run code only in the page's own world: fingerprinting protection
   (`preload/farble.ts`), media-in-use tracking for the privacy dots (a one-way console report tagged
   with the view's secret key, D-042), and uBlock scriptlets from the ad lists.
4. The UI window never navigates away from our bundled page; it cannot open windows.
5. IPC handlers accept messages only from the UI window's main frame (`fromUi()`), and parse every
   payload with zod. Invalid input is dropped.
6. Each app has its own session partition. The one opt-in exception: "Share Google sign-in between apps"
   copies Google's own account cookies (and nothing else) between each app's first account (D-045). Permission requests are denied unless listed in the
   app's `permissions`. The UI session denies all permissions.
7. App views may navigate only within `allowedHosts`. Other links go to the system browser, and
   only `http(s)` URLs are ever opened externally.
8. Popups are allowed only for sign-in (the app's `popupHosts`, known providers in `SIGN_IN_HOSTS`, or a blank
   scripted popup that loads one), with the same hardened preferences; popups show only web pages and
   can't open further windows (D-044). Provider sign-in pages may also load in the app's own tile.
9. Workspace file is written atomically with mode `0600`.
10. No telemetry, analytics, or crash upload from this app. Anything like that must be opt-in and
    documented here first.
11. Downloads only come from app sessions (the UI session cancels every download), are saved into the
    Downloads folder under a sanitized, never-overwriting name, and file types the desktop could run
    (scripts, `.desktop`, installers, binaries) are never opened from the app, only shown in the folder.
12. User-added apps are validated like IPC input: https start page, real hostnames (never `*`),
    permissions off unless granted, icons only as small raster data URLs.
13. Filter lists are fetched only from `raw.githubusercontent.com`, in their own in-memory session with
    no credentials. List rules feed the blocking engine; uBlock's scriptlet library (also from there) runs
    only inside web pages' own world, with the page's own privileges, never in the UI or main.
14. Twitch ad blocking runs TwitchAdSolutions (MIT, vendored, D-043) in twitch.tv pages' own world only.
    Daily updates come from the same host and are used only if they pass `isTwitchUserscript`.
15. User content (ROADMAP 4.3/4.4). Custom CSS is inserted as a stylesheet only. Plugins are installed only
    from a local folder the user picks in a main-process dialog (the UI never passes a path); only the
    manifest and the plain files it lists are copied (no paths, no links, 1 MB). They are off until the
    user turns them on after a warning. Their scripts run in a separate isolated world per plugin in the
    target apps' views only, on those apps' own hosts, never on sign-in providers' pages: no Node, no IPC,
    no `window.aio`, and the page can't see them. Plugins get no permissions and no channel to main yet.
16. Chrome extensions (ROADMAP 4.5, D-055) load only into the sessions of apps the user turned them on for
    (after a warning), never into the UI's session. Store packages are downloaded in their own
    cookie-less session from Google's update hosts only (https, every redirect checked), unpacked with
    paths confined to the extension's folder (no `..`, no links, size-capped). The API stand-in preload
    acts only in `chrome-extension:` contexts and talks to nothing. Extension pages open in their own
    sandboxed window that can show only that extension's pages; web links go to the system browser.
    Extensions keep their own powers inside that app (reading its pages, their own network requests):
    that is what the user opts into.

## Packaging hardening (ROADMAP 3.7, release builds in 5.3)

Electron fuses are flipped on the packaged binary by `apps/desktop/scripts/afterPack.cjs`
(electron-builder `afterPack`, `@electron/fuses`):

| Fuse | Value |
| --- | --- |
| RunAsNode | off |
| EnableNodeOptionsEnvironmentVariable | off |
| EnableNodeCliInspectArguments | off |
| EnableEmbeddedAsarIntegrityValidation | on |
| OnlyLoadAppFromAsar | on |
| EnableCookieEncryption | on |
| GrantFileProtocolExtraPrivileges | off (the UI is served from `aio://app`, not `file://`) |

`EnableEmbeddedAsarIntegrityValidation` is enforced by Electron on macOS and Windows only; on Linux it
is set but has no effect yet.

Verified on a packaged build (`electron-builder --linux dir`, 2026-09-26): `@electron/fuses read`
shows the values above; with `ELECTRON_RUN_AS_NODE=1` the binary starts SpaceAIO instead of Node
(stock Electron runs the script); `NODE_OPTIONS=--require ...` and `--inspect` are ignored.

Also run `electronegativity` and go through Electron's security checklist before each release.

## Audit (ROADMAP 3.7, 2026-09-26)

**electronegativity 1.10.3** (`electronegativity -i apps/desktop/src -e 44.4.5`), 7 findings:

| Finding | Where | Outcome |
| --- | --- | --- |
| CSP_GLOBAL_CHECK (low) | `renderer/index.html` | The meta CSP must allow Vite's inline styles in dev. Packaged builds now also get a strict CSP header from the `aio://` handler (no `'unsafe-inline'`, `form-action 'none'`); browsers enforce both. |
| AUXCLICK_JS_CHECK | `main/window.ts` | Fixed: UI window sets `disableBlinkFeatures: 'Auxclick'`. Web views keep middle-click (Browser tile opens links in new tiles); their window-open handler decides. |
| PRELOAD_JS_CHECK | `main/window.ts` | Accepted: our own preload, `contextBridge` only, named functions, no raw `ipcRenderer`. |
| DANGEROUS_FUNCTIONS (insertCSS) | `main/views/ViewManager.ts` | Accepted: filter-list element-hiding CSS, injected as user CSS; CSS can't run script. |
| OPEN_EXTERNAL ×3 | `ViewManager.ts`, `contextMenu.ts` | Accepted: every call is behind `isWebUrl` / `isWeb` (http(s) only), invariant 7. |

**Electron security checklist** (electronjs.org/docs/latest/tutorial/security):

| # | Recommendation | Status |
| --- | --- | --- |
| 1 | Only load secure content | HTTPS upgrade by default (3.2); http only after the user chooses it per site. |
| 2 | No Node integration for remote content | `nodeIntegration: false` everywhere (lint-enforced). |
| 3 | Context isolation | On everywhere (lint-enforced). |
| 4 | Process sandboxing | `app.enableSandbox()`, `sandbox: true` (lint-enforced). |
| 5 | Handle permission requests | Per-app allow list; UI session denies all. |
| 6 | Don't disable webSecurity | Never (lint-enforced). |
| 7 | Content Security Policy | UI: meta CSP + strict header in packaged builds. Remote sites keep their own. |
| 8 | No `allowRunningInsecureContent` | Never set. |
| 9 | No experimental features | Never set. |
| 10 | No `enableBlinkFeatures` | Never set (only `disableBlinkFeatures: 'Auxclick'` on the UI). |
| 11–12 | `<webview>` options | `<webview>` is disabled (`will-attach-webview` prevented). |
| 13 | Limit navigation | UI can't navigate; apps limited to `allowedHosts`. |
| 14 | Limit new windows | Denied by default; sign-in popups only for `popupHosts`, hardened. |
| 15 | `shell.openExternal` with untrusted content | http(s) only. |
| 16 | Current Electron | 44.4.5. |
| 17 | Validate IPC senders | `fromUi()` on every handler, zod on every payload. |
| 18 | Avoid `file://` | Fixed: UI served from `aio://app` (`main/security/uiProtocol.ts`), confined to the renderer folder (tested against path traversal). |
| 19 | Check fuses | Flipped in `afterPack` (table above). |
| 20 | Don't expose Electron APIs to web content | Web views get no IPC; their preload exposes nothing. |

## Storage encryption (ROADMAP 3.8)

Cookies and logins are encrypted with a key from the system keyring (KWallet or GNOME Keyring via
libsecret on Linux). Without one, Chromium falls back to a fixed key; SpaceAIO detects this
(`main/security/keyring.ts`) and warns once in the menu with how to fix it.

## Clearing data (ROADMAP 3.9)

Per app account (Shields panel) or for all apps (menu): the session is cleared at once and its
partition folder is deleted at the next start, before any session opens. Apps set to "forget when AIO
Space closes" are cleared on quit and deleted at every start (D-037).

## Privacy features ("Shields")

Settings live in `packages/core/src/privacy/settings.ts`; implementation in
`apps/desktop/src/main/privacy`. Global defaults, overridable per app.

| Feature | Brave equivalent | Status |
| --- | --- | --- |
| Isolated session per app | Separate profiles | Done |
| Clean user agent (no "Electron") | n/a | Done |
| Strip tracking query params | Query filtering | Done (starter list) |
| Global Privacy Control | GPC | Done (header and `navigator.globalPrivacyControl`) |
| Cross-origin referrer trimming | Referrer policy | Done |
| HTTPS upgrade | HTTPS by default | Done, fallback in 3.2 |
| WebRTC local IP protection | WebRTC IP policy | Done (keeps Discord voice working) |
| Tracker and telemetry blocking | Shields trackers | Done (3.5): EasyPrivacy, uBlock privacy, Brave lists, updated daily; starter list as fallback |
| Ad blocking | Shields ads | Done (3.6): EasyList, uBlock, Brave lists + cosmetic hiding; no scriptlets (YouTube video ads remain) |
| Third-party cookie blocking | Cookie blocking | Done for HTTP cookies (3.3); script-set cookies in cross-site frames: Backlog |
| Fingerprint randomization | Farbling | Done in main frames (3.4): canvas, WebGL, audio; strict buckets hardware and screen. Subframes/workers: Backlog |
| Discord telemetry endpoints | n/a | Done (`/api/v*/science`, `/metrics`) |

Blocking breaks sites sometimes, so every app has a Shields panel (shield in its tile header, ROADMAP 3.1):
a master off switch and per-feature switches, stored as per-app overrides of the defaults in the menu.
