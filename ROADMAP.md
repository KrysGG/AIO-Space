# AIO Space roadmap

All-in-one interface for web apps: resizable tiles, isolated logins, Brave-style privacy,
plugins, and deep customization. Linux (CachyOS) first, then Windows, then Android and iOS.

**How to use this file:** agents work top to bottom, one step at a time, following `AGENTS.md`.
Each step has a **Goal**, the **Files** it touches, **Tasks**, and **Done when** checks.
Tick the checkbox when every Done-when item is true. `TODO(ROADMAP x.y)` comments in the code
point back to steps here.

| Phase | Theme | Outcome |
| --- | --- | --- |
| 0 | Foundation | Repo installs, runs and is checked automatically on CachyOS |
| 1 | Working skeleton | Tiled web apps with separate logins, resizing and saved layouts |
| 2 | Daily-driver UX | Browser tile, shortcuts, notifications, downloads, spaces, custom apps |
| 3 | Shields and security | Brave-level privacy, ad blocking, audited security |
| 4 | Make it your space | Themes, per-app CSS, plugins, extensions |
| 5 | Linux release | Signed, hardened AppImage, pacman and AUR packages with updates |
| 6 | Windows | Installer, signing, Windows-specific polish |
| 7 | Mobile | Android, then iOS, reusing `@aio/core` |

A skeleton for Phase 1 already exists. Phase 0 and 1 are about making it run, verifying it and
filling gaps, not writing it from scratch.

---

## Phase 0: Foundation

### - [x] 0.1 Install and pin dependencies
**Goal:** `pnpm install` succeeds with current stable versions.
**Files:** `package.json`, `apps/desktop/package.json`, `packages/core/package.json`, `pnpm-lock.yaml`
**Tasks:**
- Run `pnpm install`. Upgrade to the latest stable Electron, electron-vite, Vite, React and zod
  if the ranges in package.json are outdated. Fix any breaking API changes (check each tool's
  migration notes; electron-vite has changed how `externalizeDepsPlugin` works across majors).
- Set `packageManager` in the root `package.json` to the installed pnpm version.
- Commit the lockfile.
**Done when:**
- `pnpm install` finishes without errors on a clean clone.
- `pnpm typecheck` passes in both packages.
- `pnpm test` runs the core tests and they pass.

### - [x] 0.2 First launch on CachyOS
**Goal:** `pnpm dev` opens the window with the rail and one empty tile showing the launcher.
**Files:** anything needed under `apps/desktop`
**Tasks:**
- Run `pnpm dev`, fix build or runtime errors.
- Open DevTools on the UI window (dev only) and confirm no console errors or CSP violations.
**Done when:**
- The window opens, the launcher grid lists Discord, YouTube, Reddit, X, Instagram, Browser.
- No errors in the terminal or the UI DevTools console.

### - [x] 0.3 Lint, format and CI
**Goal:** Every push is checked automatically.
**Files:** `eslint.config.mjs`, `.github/workflows/ci.yml` (new)
**Tasks:**
- Make `pnpm lint` pass. Add `eslint-plugin-react-hooks` for the renderer.
- Add a GitHub Actions workflow on `ubuntu-latest`: install, `pnpm typecheck`, `pnpm test`, `pnpm lint`.
- Confirm the security lint rules fire: temporarily set `sandbox: false` somewhere, see lint fail, revert.
**Done when:** CI is green on the main branch and the security rule test was verified.

### - [x] 0.4 Native Wayland check
**Goal:** Crisp rendering and correct scaling on CachyOS (KDE Plasma or GNOME on Wayland).
**Files:** `apps/desktop/src/main/index.ts`
**Tasks:**
- Check which backend is used (`chrome://gpu` in a Browser tile, or `process.argv` logging).
- If the `ozone-platform-hint` switch in `main/index.ts` doesn't take effect, document the working
  approach (launch flag, `ELECTRON_OZONE_PLATFORM_HINT`, or newer Electron default) in DECISIONS.md.
- Test at 100% and a fractional scale (125% or 150%). Tile views must line up with tile bodies with
  no gaps or overlap.
**Done when:** App runs natively on Wayland at both scales with pixel-aligned views.

---

## Phase 1: Working skeleton

### - [x] 1.1 Open an app in a tile
**Goal:** Picking an app in the launcher or rail loads it into the tile.
**Files:** `renderer/src/App.tsx`, `renderer/src/components/TileLayout.tsx`, `main/views/ViewManager.ts`
**Done when:**
- Clicking YouTube in the launcher loads youtube.com in that tile, sized exactly to the tile body.
- Clicking an app in the rail replaces the app in the focused tile.
- "Change app" (grid icon in the tile header) returns the tile to the launcher and destroys the view.
- Tile header shows the page title and a loading indicator while loading.

### - [x] 1.2 Separate, persistent logins
**Goal:** Each app keeps its own login across restarts; apps can't see each other's cookies.
**Files:** `main/sessions/appSession.ts`
**Done when:**
- Log in to Discord and Reddit, quit, relaunch: both still logged in.
- DevTools on the Reddit view shows no discord.com cookies (and vice versa).
- Folders `Partitions/app-discord-default` etc. exist in the userData directory.

### - [x] 1.3 Split and close tiles
**Goal:** Build layouts like the sketch: Discord and a launcher on top, a browser across the bottom.
**Done when:**
- Split right / split down create a new empty tile next to the focused one.
- Close tile removes it; its neighbor fills the space; its view is destroyed (check memory in the
  task manager drops).
- Closing the last tile leaves one empty tile.
- Focused tile is marked with the focus outline (amber until D-032, now white/grey); clicking a tile header or inside a web view focuses it.

### - [x] 1.4 Resize by dragging dividers
**Goal:** Smooth resizing of any split.
**Done when:**
- Dragging a divider resizes both sides live; views reappear at the right size on release.
- Ratios clamp at 10%/90%.
- Resizing the whole window keeps all views aligned.
- No stuck-hidden views after a drag ends outside the window (test releasing over another app).

### - [x] 1.5 Layout persistence and recovery
**Goal:** The layout survives restarts and bad files.
**Files:** `main/store/workspaceStore.ts`, `packages/core/src/workspace/workspace.ts`
**Done when:**
- Relaunch restores the same tiles, apps, ratios and focus.
- Replacing `workspace.json` with garbage starts with the default layout and logs a warning.
- Killing the app mid-save never corrupts the file (writes are atomic).

### - [x] 1.6 Verify navigation and popup rules
**Goal:** Apps stay in their lane.
**Done when:**
- A link to an outside site from Reddit opens in the system browser, not inside the tile.
- "Sign in with Google" on Reddit opens a popup that completes login in Reddit's session.
- A `javascript:` or `file:` URL can never be opened externally or navigated to.
- Browser tile can go anywhere; `target=_blank` links load in the same tile (until 2.2).

### - [x] 1.7 Discord voice on Linux
**Goal:** Voice chat works in the Discord tile.
**Done when:**
- Joining a voice channel asks for mic access once (permission granted by the app definition) and
  audio works through PipeWire both ways.
- Browser tile is denied microphone access (not in its permissions).

### - [x] 1.8 Desktop unit tests
**Goal:** Main-process logic is covered without launching Electron.
**Files:** `apps/desktop/vitest.config.ts` (new), `apps/desktop/test/*`
**Tasks:**
- Add vitest to desktop. Test `schemas.ts` (valid and invalid payloads, >16 tiles rejected),
  `userAgent.ts`, and each filter in `shields.ts` (feed fake `details` objects; mock settings getter).
- Add a Playwright `_electron` smoke test: launch, see launcher, open Browser, split, close.
**Done when:** Tests run in `pnpm test` and in CI (use `xvfb-run` for the smoke test).

**Phase 1 exit:** the sketch layout (Discord, launcher, browser) can be built, resized, and is
restored after restart, with separate logins.

---

## Phase 2: Daily-driver UX

### - [x] 2.1 Keyboard shortcuts
Ctrl+Alt+Arrow to move focus between tiles, Ctrl+Shift+D/E to split right/down, Ctrl+W to close
tile, Ctrl+R reload focused, Ctrl+1..9 focus nth tile. Shortcuts must work while a web view has
focus (use `before-input-event` on each view in main and forward to the UI).
**Done when:** All shortcuts work regardless of which tile has focus, and are listed in a help popover.

### - [x] 2.2 Real browser tile
Address bar in the Browser tile header (URL or search), new-tab links open a new tile to the right
(or tabs inside the tile; record the choice in DECISIONS.md), and a search engine setting
(DuckDuckGo default, Brave Search, Startpage).
New IPC: `view:navigate` (follow the IPC checklist in AGENTS.md; only http(s) allowed).
**Done when:** You can browse normally in the Browser tile, including opening links in new tiles.

### - [x] 2.3 Keep views alive when rearranging; drag tiles to swap
Today views are keyed by tile id, so moving an app reloads it. Key views by an app instance id
stored on the leaf instead. Add drag-and-drop of tile headers to swap two tiles (`swapApps` in core).
**Done when:** Swapping Discord and YouTube keeps both pages loaded (video keeps playing).

### - [x] 2.4 Context menu
Right-click in a view: back, forward, reload, copy link, open link in browser tile, open in system
browser, copy image, spell suggestions, Inspect (dev builds only).
**Done when:** Menu appears in all views with correct items for links, images and text fields.

### - [ ] 2.5 Notifications and unread badges
Allow notifications per app (already in permissions); show unread counts parsed from page titles
like `(3) Discord` on the rail icon and tile header. Linux tray icon with total unread count.
**Done when:** A Discord message in a background tile shows a system notification and a badge.

### - [x] 2.6 Downloads
Handle `will-download` per session: save to `~/Downloads`, progress in a small downloads panel in
the rail, open file / show in folder. Reject downloads from the UI session.
**Done when:** Downloading a file from any tile works and shows progress.

### - [x] 2.7 Custom apps
Add any https site as an app: name, URL, allowed hosts (defaults to the site's domain),
permissions (all off by default), glyph or favicon. Stored in the workspace (bump
`WORKSPACE_VERSION`, add migration). Catalog in main merges built-ins and custom apps.
**Done when:** A user-added app (e.g. WhatsApp Web) works exactly like a built-in one and survives restart.

### - [x] 2.8 Menu, spaces and settings panel
The rail's menu button opens a panel (hide views while it's open, or render it in the rail's side
area). Contents: spaces (create, rename, switch, delete: each space is its own layout), settings,
and the Shields panel from 3.1.
**Done when:** You can keep a "Gaming" space and a "Work" space and switch instantly; views of the
inactive space are hidden, not destroyed (unless slept by 2.9).

### - [x] 2.9 Sleep inactive tiles
Tiles not visible (other space) or untouched for N minutes are discarded to save memory and reload
when shown again. Never sleep a tile in a voice call or playing audio (`isCurrentlyAudible`).
**Done when:** Memory drops after sleeping; Discord in a call never sleeps.

### - [x] 2.10 Per-tile zoom
Ctrl+plus/minus/0 zoom the focused view only; zoom level saved per app.
**Done when:** Zoom persists per app across restarts.

### - [ ] 2.11 Screen sharing (Discord)
Implement `session.setDisplayMediaRequestHandler` for apps with `display-capture`, with a picker
built from `desktopCapturer`. On Wayland this goes through the xdg-desktop-portal / PipeWire
picker; verify on KDE and GNOME.
**Done when:** Screen share works in a Discord call on CachyOS Wayland.

### - [x] 2.12 Multiple accounts per app
Profiles per app (`partitionFor(appId, profile)`), picker in the tile header.
**Done when:** Two Discord accounts can run side by side in two tiles.

### - [x] 2.13 Polish: snapshots during drag (parallel ok)
Before hiding views for a drag, capture each with `webContents.capturePage()` and show the image
in the placeholder so the layout doesn't flash empty.
**Done when:** Dragging dividers looks continuous.

---

## Phase 3: Shields and security (Brave-level privacy)

### - [x] 3.1 Shields panel
UI for the settings in `packages/core/src/privacy/settings.ts`: global defaults plus per-app
overrides (stored in `privacyOverrides`). Shield icon in each tile header showing blocked count
for the current page. Changes apply live (filters already read settings per request); WebRTC
policy applies on next view creation, so reload the view when it changes.
**Done when:** Turning Shields off for one app affects only that app, immediately.

### - [x] 3.2 HTTPS upgrade with fallback
If an upgraded request fails with a connection/certificate error, show an interstitial in the tile
offering to continue over http once, remembering the choice per host.
**Done when:** An http-only test site shows the interstitial instead of a broken page.

### - [ ] 3.3 Third-party cookie blocking
Use `tldts` to compute registrable domains. Add an `onHeadersReceived` stage to the pipeline;
for requests whose site differs from the top-level page's site, strip `Cookie` (send) and
`Set-Cookie` (receive). Allow exceptions listed per app for sign-in flows (e.g. Discord ↔
discordapp.com, Google auth domains).
**Done when:** Third-party cookies are blocked on a test page, and every built-in app can still log in.

### - [ ] 3.4 Fingerprinting protection
Add a preload for web app views that runs in the page's main world (use
`contextBridge.executeInMainWorld` or `webFrame.executeJavaScript` depending on Electron version;
record choice in DECISIONS.md). It must not expose anything to the page. Implement:
- `standard`: farble canvas `toDataURL`/`getImageData`, WebGL `readPixels`, AudioContext
  outputs with tiny noise seeded per session and per site (stable within a session);
  `navigator.globalPrivacyControl = true`; hide `navigator.webdriver`.
- `strict`: additionally normalize `hardwareConcurrency`, `deviceMemory`, screen size to common
  buckets, and block `navigator.getBattery`.
**Done when:** Canvas fingerprint differs between sessions on a fingerprint test page, and YouTube,
Discord and X still work in `standard`.

### - [ ] 3.5 Tracker and telemetry lists
Replace the starter lists in `shields.ts` with the filter-list engine from 3.6 using EasyPrivacy
and Brave's privacy lists. Keep the Discord telemetry path rules.
**Done when:** Blocked-count shows trackers on popular sites; no built-in app breaks.

### - [ ] 3.6 Ad blocking
Two options; try A first (the owner prefers extensions), fall back to B, and record the result in
DECISIONS.md.
- **A. Extension:** load uBlock Origin Lite (MV3) per app session via Electron's extensions API.
  Check which APIs it needs that Electron lacks (declarativeNetRequest support is partial).
- **B. Engine:** `@ghostery/adblocker` `FiltersEngine` called from a `RequestFilter` (do **not**
  use its `enableBlockingInSession`, it registers its own webRequest listeners), plus cosmetic
  filtering through the 3.4 preload. Update lists daily, cached on disk.
**Done when:** Ads blocked on common test pages, YouTube works (ad blocking on YouTube is a moving
target; document current state), per-app toggle respected.

### - [x] 3.7 Security audit and fuses
Run `electronegativity`, walk Electron's security checklist, confirm every invariant in
`docs/SECURITY.md`. Apply fuses (table in SECURITY.md) with `@electron/fuses` in an
electron-builder `afterPack` hook.
**Done when:** Audit findings fixed or documented; packaged app refuses `ELECTRON_RUN_AS_NODE=1`.

### - [ ] 3.8 Secure storage on Linux
Cookie encryption depends on the system keyring (KWallet or libsecret). Detect when only the
basic fallback is available (`safeStorage.getSelectedStorageBackend()`) and warn the user once in
settings with how to fix it.
**Done when:** Warning appears on a system without a keyring and not on a normal KDE/GNOME setup.

### - [x] 3.9 Clear data and forget mode
Per app: clear cookies/cache/storage. Optional "forget on close" (clear on quit). Global "clear all".
**Done when:** Clearing an app logs it out and removes its data from disk.

---

## Phase 4: Make it your space

### - [ ] 4.1 Themes
All colors in `styles.css` are CSS variables. Theme = JSON of variable values; built-in dark,
light, high contrast; user themes importable. Respect system light/dark by default.
**Done when:** Switching theme restyles the whole UI instantly and persists.

### - [x] 4.2 Real app icons
Bundled SVG icons for built-ins; favicon fetched once and cached for custom apps (fetched through
the app's own session). Replace text glyphs.
**Done when:** Rail and launcher show proper icons.

### - [ ] 4.3 Per-app custom CSS
User CSS per app injected with `webContents.insertCSS` on each load (e.g. hide Reddit's sidebar).
Editor in settings with live preview.
**Done when:** Custom CSS applies on every navigation and can be toggled off.

### - [ ] 4.4 Plugin system
Plugin = folder with `manifest.json` (id, name, version, target app ids, permissions), content
script(s) and CSS. Scripts run in an **isolated world** in the target app's view, never with Node
or IPC. Installed only from local folders, disabled by default, with a clear warning. Plugins that
need data from main get a narrow, explicitly permissioned message channel (design in DECISIONS.md
first). Note: modifying the Discord client violates Discord's terms; show that warning on
Discord-targeting plugins.
**Done when:** A sample plugin (e.g. "YouTube: hide Shorts") installs, runs only on YouTube, and
can be disabled.

### - [ ] 4.5 Wider Chrome extension support
Evaluate `electron-chrome-extensions` for toolbar actions and popups. Add an extensions manager
per app session.
**Done when:** A documented list of tested extensions and whether they work.

### - [ ] 4.6 Layout presets, import and export
Save a space as a template; import/export the workspace (without cookies) as a file.
**Done when:** Exported workspace loads on another machine with the same layout.

### - [ ] 4.7 Rail customization
Reorder, hide and pin apps in the rail; compact mode. (Hiding the whole rail to a thin edge is done, D-038.)
**Done when:** Rail order persists.

---

## Phase 5: Linux release

### - [ ] 5.1 Packaging
electron-builder AppImage and pacman targets with icons and a `.desktop` file (Wayland flags in
`Exec` if 0.4 found they're needed).
**Done when:** `pnpm dist:linux` produces both; installing the pacman package on CachyOS adds a
working menu entry.

### - [ ] 5.2 AUR package
`PKGBUILD` for `aio-space-bin` in `packaging/aur/`.
**Done when:** `makepkg -si` installs and runs.

### - [ ] 5.3 Hardening at build time
Fuses and ASAR integrity from 3.7 applied in the release build; verify on the packaged app.

### - [ ] 5.4 Updates
AppImage auto-update with `electron-updater` from GitHub Releases (signed releases). pacman/AUR
users update through their package manager, so disable the updater there.
**Done when:** An older AppImage updates itself to a newer release.

### - [ ] 5.5 Release pipeline
GitHub Actions on tag: build, test, package, attach to release, checksums.
**Done when:** Tagging `v0.1.0` produces a release with AppImage, pacman package and SHA256 sums.

---

## Phase 6: Windows

### - [ ] 6.1 Run on Windows
Fix path and platform assumptions; skip Linux-only switches. Test mixed-DPI multi-monitor setups:
move the window between a 100% and 150% monitor and confirm views stay aligned.
### - [ ] 6.2 Windows look and feel
`titleBarOverlay` or custom title bar, Snap Layouts support, Mica/acrylic optional.
### - [ ] 6.3 Notifications
Set `app.setAppUserModelId`; verify toast notifications and taskbar badge counts.
### - [ ] 6.4 Installer and signing
NSIS installer; code signing (a certificate or a cloud signing service) to avoid SmartScreen warnings.
### - [ ] 6.5 Windows CI and release
Add `windows-latest` to CI and the release pipeline.
**Phase 6 done when:** A signed installer from CI installs and passes the Phase 1 checks on Windows 11.

---

## Phase 7: Mobile (Android first, then iOS)

Electron does not run on phones. The mobile app is a separate shell that reuses `@aio/core`
(layout tree, catalog, privacy settings, tracking-param cleaning, workspace format).

### - [ ] 7.0 Decision: mobile framework
Recommended: **React Native** with native WebViews (multiple WebViews laid out natively are
easier than in Capacitor, and React knowledge carries over). Evaluate against Capacitor and record
in DECISIONS.md. Create `apps/mobile`.

### - [ ] 7.1 Spike: two isolated WebViews side by side
Biggest risk: **per-app cookie isolation.** On Android this needs the AndroidX WebKit multi-profile
API; on iOS, `WKWebsiteDataStore(forIdentifier:)` (iOS 17+). `react-native-webview` may not expose
these, which would mean a small custom native module. Build a spike proving two logins to the same
site in two WebViews.
**Done when:** Spike works on a real Android device; findings written up before any further mobile work.

### - [ ] 7.2 Phone and tablet layouts
Phones: one app full screen, swipe or bottom bar to switch, optional two-tile split in landscape.
Tablets and foldables: full tiling using `computeLayout` from core.

### - [ ] 7.3 Privacy on mobile
Android: `shouldInterceptRequest` for blocking and param stripping. iOS: `WKContentRuleList`
(content-blocker rules compiled from filter lists); header changes like GPC are limited on iOS.
Share settings model with desktop.

### - [ ] 7.4 Store and platform risks (read before 7.5)
- Google blocks sign-in inside embedded WebViews ("disallowed_useragent"). Google-account logins
  may need the system browser, which does not share cookies with the WebView.
- App stores may reject "wrapper" apps (Apple guideline 4.2) or apps that block YouTube ads
  (YouTube terms). Consider F-Droid or direct APK for Android if store review fails.
- iOS requires WebKit for all web content; Chromium features (extensions) are unavailable there.

### - [ ] 7.5 Android release, then 7.6 iOS release

---

## Backlog

Add items found while working on other steps here, with the step where they were found.

- (0.2) In dev, userData is `~/.config/@aio/desktop` (package name), not `~/.config/AIO Space` as
  ARCHITECTURE.md says. Set `productName` in `apps/desktop/package.json` or call `app.setName()`
  early so dev and packaged builds share the documented path.
- (0.1) `pnpm install` warns that `esbuild` and `electron-winstaller` build scripts were ignored:
  pnpm 10.0 reads `onlyBuiltDependencies` from `package.json` only, so the list in
  `pnpm-workspace.yaml` has no effect. Pick one place. Electron 44 no longer needs to be listed.
- (2.4, for Phase 3) Web views have spellcheck on, and Electron downloads the Hunspell dictionary
  (`userData/Dictionaries/en-US-*.bdic`) from Google's CDN by default. No user data is sent, but it is
  an outside connection the user didn't ask for. Bundle the dictionaries or set
  `session.setSpellCheckerDictionaryDownloadURL` to a host we control; mention it in SECURITY.md.
- (2.5) Built and tested with simulated titles (badges, tray, notification permissions), but not yet
  ticked: confirm with a real Discord message in a background tile (notification + rail/tile badge +
  tray dot). Also check the notification's app name; in dev it is likely "@aio/desktop" (see the 0.2
  userData/app-name item).
- (2.12) Rename and remove accounts are still missing (clearing an account's data came with 3.9). The owner can
  confirm two real Discord logins side by side when convenient (mechanism verified with Browser).
- (2.12) The smoke test loads real sites (example.com, DuckDuckGo, Brave Search) and failed once in
  CI without a reproducible cause (d7a6221; the rerun passed). Serve test pages from a local server
  (or intercept with `protocol.handle` in a test-only session) so CI doesn't depend on outside sites.
  CI failures now show up as readable annotations (89f73fd).
- (3.3) Third-party cookie blocking strips HTTP `Cookie`/`Set-Cookie` only. Cookies that scripts in a
  cross-site frame set with `document.cookie` still work. Look at Chromium's own third-party cookie
  setting (content settings / `--test-third-party-cookie-phaseout`) or partitioned cookies.
- (3.3) Not ticked until the owner confirms every built-in app still logs in with blocking on.
- (3.3) The owner reported Discord logs them out after an app restart. Reproduced on a *copy* of
  their real Discord partition, but it still happened with `blockThirdPartyCookies` off and with
  Shields fully off for the app, so 3.3's cookie code is very likely not the cause. Cookies (incl.
  Cloudflare's `cf_clearance`) decrypt fine and aren't wiped; Discord's own session data isn't a
  plain cookie, so couldn't be inspected the same way (Discord's page blocks `executeJavaScript`
  entirely, even unrelated scripts). Needs the owner to reproduce with DevTools open (or describe
  exactly what's shown: a plain email/password form, a "Continue as ..." button, or a Cloudflare
  challenge) before guessing further at a real session.
  Update (D-032 round): the owner now sees a "prove you're not a bot" captcha on re-login, so Discord
  most likely ends the session server-side. Ruled out local storage loss: localStorage written in a
  tile survives Ctrl+C/SIGINT, SIGTERM and a hard kill 8 s after the write (only a hard kill within
  ~3 s loses it). Candidates still open: the blocked `/api/v*/science` telemetry (test with only
  "Block trackers" off for Discord for a few days), Electron's `Sec-CH-UA` brands (Chromium, no
  "Google Chrome"), and frequent new-device logins feeding Discord's risk score.
- (3.4) Built and tested on a local fingerprint page (stable within a run, different across runs), but
  not ticked: this environment can't reach YouTube, Discord or X, so the owner should check they still
  work with fingerprinting on Standard.
- (3.4) Farbling covers main frames only. Cross-origin iframes (preload with
  `nodeIntegrationInSubFrames`, which with sandbox gives no Node), same-origin `about:blank` iframes
  (their fresh prototypes are unpatched), workers and `OffscreenCanvas` are not covered yet.
- (3.5/3.6) Built and tested offline (blocking, counting, cosmetic hiding, per-app switches) and with
  the real lists on a local page, but not ticked: this environment can't reach YouTube or popular
  sites. Owner: check the blocked count on a few news sites, that no built-in app breaks, and YouTube.
  Expected on YouTube: banner/sidebar ads blocked, video ads still shown (they need uBlock scriptlets,
  not run yet). The list download itself runs through Chromium (`session.fetch`), which this
  environment's TLS proxy blocks; the same code was verified with a Node fetcher.
- (3.6) Not done yet: cosmetic filtering and scriptlets in subframes, redirect surrogates (uBlock resources)
  instead of plain blocking. Scriptlets for YouTube are done (D-041); the owner should confirm on real
  YouTube that video ads are gone.
- (3.6) Twitch video ads are stitched into the HLS playlists (`usher.ttvnw.net`, `*.hls.ttvnw.net`), which
  request filters can't rewrite. Options: intercept those playlist requests with `protocol.handle` in
  the Twitch session and drop ad segments (`#EXT-X-DATERANGE ... twitch-stitched-ad`), or request an
  ad-free player type; both need careful testing on real Twitch. Check licences before reusing any
  existing userscript (several are GPL).
- (3.8) Built; the warning is verified on a system without a keyring (this environment: `basic_text`).
  Not ticked until the owner confirms it does not appear on their normal KDE setup.
- (Store) Widevine DRM for Netflix, Spotify, Prime Video, Disney+: stock Electron has none. Options:
  castlabs' "Electron for Content Security" (ECS) build with Widevine, which needs VMP signing for
  production. Evaluate before 5.1 packaging.
- (Store) "Submit an app" to the store: needs a small backend (submissions, review, signed catalog
  updates) so the store can list and promote community apps. Owner idea; design before building.
- (2.11) Deferred by the owner: screen sharing needs a real Discord call with someone. Implement and
  test together when a second person is available (also covers 2.5's real-message check).
- (1.6, for Phase 7) Sign-in popups (e.g. Reddit "Continue with Google") work on desktop as a
  second window. On mobile they should probably become a redirect in the same WebView (or the system
  browser, see 7.4) rather than a second window. Owner's request.
