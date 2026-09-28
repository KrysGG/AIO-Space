# Decisions

Short records of choices that later work must respect. Newest last. Format:
**D-number: title** — context, decision, consequences.

**D-001: Electron for desktop.**
Need several real browser views in one window with separate logins, request filtering and
extension support. Electron (Chromium) provides all of these today. Tauri's multi-webview
support is less mature, and Firefox's engine cannot be embedded. Brave's privacy features are
reimplemented on top of Electron's session APIs (see SECURITY.md).

**D-002: `WebContentsView` managed from main, not `<webview>` or iframes.**
Most target sites forbid iframes. `<webview>` is discouraged by Electron and disabled here.
Consequence: views are native layers drawn above the UI page. The UI reports tile positions;
main moves the views. Anything the UI draws over a tile must hide views first.

**D-003: Platform-neutral `@aio/core` package.**
Mobile will not run Electron. Layout, catalog, privacy settings and workspace format live in
`packages/core` so the mobile shell reuses them. Core has no platform imports and is consumed as
TypeScript source (bundled by each app).

**D-004: Binary split tree for layouts.**
Every layout is a tree of two-way splits. Simple to render, resize, serialize and test; any
tiling arrangement can be expressed.

**D-005: One request pipeline per session.**
Electron allows a single `webRequest` listener per event per session. All filters (shields,
adblock, plugins) register as `RequestFilter`s in one pipeline.

**D-006: Hide native views while dragging a divider.**
Native views capture the pointer, which breaks drags. Views hide during the drag and the tile
placeholder shows. Since 2.13 the placeholder shows a `capturePage()` snapshot of the page (D-027).

**D-007: Per-app session partitions `persist:app-<appId>-<profile>`.**
Isolates cookies and storage per service. `profile` enables multiple accounts later (ROADMAP 2.12).

**D-008: zod for IPC and file validation.**
Everything crossing from the renderer or read from disk is untrusted until parsed.

**D-009: Vite stays on the major electron-vite supports.**
electron-vite 5 accepts Vite 5–7 only, so Vite is pinned to 7 (and `@vitejs/plugin-react` to 5, since
6 needs Vite 8) even though Vite 8 exists. Upgrade Vite only together with an electron-vite release
that supports it. electron-vite 5 externalizes `dependencies` by default; keep `@aio/core` a
devDependency so it is bundled. Electron 44 has no postinstall: the binary downloads on first
`pnpm dev` (or `node -e "require('electron')"`), so an offline first run fails until it is fetched.

**D-010: `eslint-plugin-react-hooks` for the renderer.**
Catches broken hook rules and stale effect dependencies in React code. Its flat `recommended`
config applies only to `apps/desktop/src/renderer/**`. CI (`.github/workflows/ci.yml`) runs
install, typecheck, test and lint on `ubuntu-latest`; warnings don't fail the build, errors do.

**D-011: Native Wayland via `ozone-platform-hint=auto`; Vulkan log line is expected.**
On CachyOS KDE Plasma (Electron 44) the switch in `main/index.ts` takes effect: GPU and renderer
processes run with `--ozone-platform=wayland`. Checked at 100% and 145% on two monitors: view
bounds match tile bodies and screenshots show no gaps. Chromium logs
`'--ozone-platform=wayland' is not compatible with Vulkan` at startup; it is emitted while probing
Vulkan (for WebGPU). Vulkan is `disabled_off` and GPU compositing, rasterization, WebGL and WebGPU
stay enabled, so it is harmless. Don't switch to X11 or add GPU flags to silence it.

**D-012: Firefox User-Agent on Google sign-in pages.**
Google blocks sign-in from browsers it detects as embedded ("This browser or app may not be
secure"), even with a clean Chrome UA. For `accounts.google.com` only, requests get a Firefox UA
with `Sec-CH-UA*` client hints removed (`google-sign-in-ua` filter in `appSession.ts`), and tiles and
sign-in popups switch `navigator.userAgent` to the same Firefox UA while their main frame is on that
host (`followSignInUserAgent`). Every other page keeps the normal Chrome UA. The Firefox major is
derived from Electron's Chrome major + 1 so it stays current across Electron upgrades. Verified with
YouTube sign-in on Electron 44. If Google starts rejecting it, revisit here first.

**D-013: Desktop tests with vitest and `playwright-core`.**
Unit tests (`apps/desktop/test/*.test.ts`) use vitest, like core. The Electron smoke test uses
`playwright-core`'s `_electron` API from inside vitest, so there is one runner and no browser
downloads (`@playwright/test` would add a second runner). `pnpm test` builds the app first, then runs
both. The smoke test sets `AIO_USER_DATA_DIR` to a temp folder; main honours it (before the
single-instance lock) so tests never touch real logins or layouts. CI runs tests under `xvfb-run` and
re-enables unprivileged user namespaces, which Ubuntu 24.04 blocks and Electron's sandbox needs.

**D-014: Keyboard shortcuts are caught in main, handled in the UI.**
`before-input-event` on the UI window and every web view (`main/shortcuts.ts`) catches app shortcuts
and cancels them, so pages and Electron's default menu (which also binds Ctrl+W/Ctrl+R) never see
them; the action goes to the UI over the `shortcut` channel. Letters match by `key` (layout-aware),
digits and arrows by `code` (Ctrl+1 on AZERTY reports "&"); auto-repeat is ignored. When a shortcut
moves focus, the UI also calls `view:focus` so keyboard focus follows the amber edge. New shortcuts:
add them to `shortcutFor()` and to the list in `ShortcutsHelp.tsx`. Tests must send keys with
`webContents.sendInputEvent` (CDP `Input.dispatchKeyEvent` bypasses `before-input-event`).

**D-015: Browser tile opens "new tab" links in a new tile; workspace v2 stores the search engine.**
Owner's choice over in-tile tabs. In a Browser tile, links that ask for a new tab (`foreground-tab`:
`target=_blank`, plain `window.open(url)`; `background-tab`: middle-click / Ctrl+click) go to the UI,
which splits the tile to the right and starts a Browser view on that URL (`view:navigate` before the
layout update; main keeps it as the pending start URL). Background tabs keep focus where it was. At
`MAX_TILES` the link loads in the same tile. Scripted popups (`new-window`: `window.open` with
features, e.g. "Sign in with ...") stay real popup windows so they keep `window.opener`.
The address bar turns input into an https URL or a search (`addressToUrl` in core); other schemes are
always searched, never loaded. `view:navigate` accepts only http(s) and only affects Browser tiles.
Search engine (DuckDuckGo default, Brave Search, Startpage) lives in `workspace.browser`, added in
`WORKSPACE_VERSION` 2 with a v1 migration.
Browser tiles start (and "home") on the chosen engine. Switching engine moves a tile that is showing a
search engine to the new one, rerunning its search (`urlAfterEngineSwitch`); on other sites it only
changes what the address bar searches with.

**D-016: Nothing drawn by the UI may overlap a tile body unless views are hidden.**
The UI page sits below the native web views, so custom HTML menus or panels that overlap a tile body
are hidden behind the page there; hide the views first (like the shortcuts popover). A native
`<select>` is fine: Chromium opens its list as a separate popup above the views (the owner used the
search engine dropdown in the Browser tile header and preferred it to an inline picker). Native
`Menu.popup()` also draws on top; it was tried through an IPC round trip but not confirmed on Wayland,
so check it on KDE when building the 2.4 context menu. (2.4: confirmed working on KDE Wayland when
opened from a real right-click, via the view's `context-menu` event.) Lesson from 2.2: the engine dropdown did save
the setting; it only looked broken because the open page didn't move, which is why switching engine
now moves an engine page (D-015). When a UI test changes a value from code, also check what the user
would see change.

**D-017: Built-in app icons from Simple Icons.**
`simple-icons` (CC0 SVG paths; the logos stay their owners' trademarks) provides the Discord, YouTube,
Reddit, X and Instagram marks, drawn in brand colour by `AppIcon.tsx` (X uses the text colour: its
brand black is invisible on the dark UI). It is a desktop devDependency: named imports are
tree-shaken, adding ~18 kB to the renderer bundle. The Browser tile uses our own globe. Apps without
an icon keep their text glyph. Colours are set with inline styles because stylesheet rules such as
`.rail-btn svg { fill: none }` override SVG attributes. Done ahead of order at the owner's request;
favicons for custom apps arrived with 2.7 (D-022).

**D-018: Views belong to running app instances, not tiles (workspace v3).**
Each tile with an app stores an `instanceId` (core `LeafNode`), added in `WORKSPACE_VERSION` 3 with a
v2 migration. `ViewManager` keys views by instance id and tracks which tile each one is in, so
`swapApps` (which moves `appId` and `instanceId` together) only moves views; pages keep running
(verified: a YouTube video played through a swap). `assignApp` keeps the instance when the same app
is assigned again and starts a new one for a different app. View states are keyed by instance in the
UI so titles follow the app. Schemas require an instance exactly when a tile has an app, and reject
duplicate tile or instance ids. Tile headers are drag handles for swapping (6 px threshold so clicks
still work; views hide during the drag as in D-006); Browser tiles use their header icon as the handle.

**D-019: Web view context menu is a native menu built from a pure template.**
`contextMenuTemplate(params, actions)` in `main/views/contextMenu.ts` picks sections for what was
right-clicked (spelling, link, image, selection, text field, or page), so it is unit-tested without
Electron. `ViewManager` shows it with `Menu.popup` from the view's `context-menu` event (works on KDE
Wayland, D-016). Only http(s) links/images can be opened (new Browser tile via `view:open-in-new-tile`,
or the system browser). "Search … for" uses the chosen engine in a new Browser tile. "Inspect" only in
dev builds (`!app.isPackaged`).

**D-020: Unread state comes from page titles; tray icon is drawn in code.**
Web apps put unread counts in their title ("(3) Discord", "(99+) Reddit", Discord's "• " dot).
`unreadFromTitle` / `sumUnread` in core parse and total them; the UI shows badges on rail icons (per
app, over all tiles) and tile headers (title shown without the prefix). `ViewManager` recounts on
`page-title-updated` and drives the tray: red dot + "N unread" tooltip, and `app.setBadgeCount` where
the desktop supports it. The tray icon is rendered to a bitmap in `main/tray.ts` (2x2 tiles, amber
focus) so no image assets are needed until packaging (5.1). Web notifications are Chromium's own,
shown via the desktop; only apps with `notifications` in their catalog permissions can send them.

**D-021: Downloads.**
`DownloadManager` (main) attaches to each app session's `will-download` once, saves to
`app.getPath('downloads')` with `safeFilename` + `uniquePath` (`name (1).ext`, never overwrite), and
sends the whole list to the UI (`downloads:update`, throttled to 250 ms while bytes arrive). Paths stay
in main; the UI gets file names and byte counts. Actions (`downloads:action`: open, show, cancel,
clear) are validated with zod; "open" is refused in main for risky types (`isRiskyToOpen`: scripts,
`.desktop`, installers, `.bin`...), not just hidden in the UI (SECURITY invariant 11). The list lives
for the session only. The panel is a rail popover that hides views, like the shortcuts list.

**D-022: Custom apps live in the workspace (v4) and are held to stricter rules than built-ins.**
`workspace.customApps` (added in `WORKSPACE_VERSION` 4) holds user-added `WebAppDef`s. `makeCustomApp`
(core) validates input and fills defaults: https start page, allowed sites = the site's domain
(`siteDomain`, editable), permissions all off, sign-in popups for the app's sites plus Google, Apple
and Microsoft sign-in. `CustomAppSchema` re-checks everything main stores: `custom-` ids, https,
real hostnames only (never `*`), known permissions, icon = small raster data URL (no SVG). Main's
catalog is built-ins + custom (`store.catalog()`); the UI merges the same way. Views are re-synced
after every save, so a just-added app opens at once. The icon is the page's own favicon, fetched once
through the app's session (`views/favicon.ts`: https, raster types, <= 100 KB). Removing an app
empties its tiles; its partition data stays until "clear data" (3.9).

**D-023: Spaces keep their apps running in the background.**
The rail's menu button opens `MenuPanel` (spaces + settings; hides views like other popovers).
Space operations are pure core functions (`addSpace`, `renameSpace`, `switchSpace`, `removeSpace`:
never the last space; removing the active one moves to its neighbour). `views:sync` carries
`{ placements, keep }`: `keep` lists the instance ids of every other space's apps, which main hides
instead of destroying, so switching back is instant and pages keep playing (verified with YouTube).
Apps in a space that hasn't been shown yet start when it is first shown. `setHidden(false)` and
`focus()` only touch the active space's views. Unread badges and the tray count all spaces. Sleeping
background tiles to save memory is 2.9. Shields settings will join the menu in 3.1.

**D-024: Sleep only hidden apps, and only ones that can safely miss time.**
`ViewManager` records when a view is hidden in another space and, every 30 s, sleeps views hidden
longer than `workspace.performance.sleepAfterMinutes` (workspace v5; Never/5/15/30/60, default 30):
the page is closed and its URL kept, and the same instance reloads there when its space is shown.
Never slept: pages currently audible, pages given camera/mic or screen (tracked in the permission
handler, so a silent call is still protected), and apps allowed to send notifications (they'd miss
messages). Visible tiles never sleep, even if untouched: the roadmap's "or untouched for N minutes"
is narrowed on purpose so a tile never goes blank in front of the user. Verified: a paused YouTube page
slept (-234 MB, one process fewer) and woke on the same video; Reddit and a mic-using app stayed up.

**D-025: Zoom is per app; main applies it, the UI saves only user zoom actions.**
Ctrl +/-/0 (and numpad keys) are caught with the other shortcuts (D-014); Ctrl+wheel arrives as
`zoom-changed` and is limited to one step per 150 ms (a notch can fire twice; touchpads burst).
Steps follow Chrome (`nextZoom` in core). `ViewManager.setZoom` applies the factor to every view of
the app and sends `app:zoom`; the UI stores it in `workspace.zoom` (v6; 100% = no entry). Main
re-applies the saved factor on each `did-navigate`. View states carry the current zoom for display
only, never for saving, so a page reporting 100% while loading can't wipe a saved zoom. Tiles show a
"125%" badge when not at 100% (click to reset).

**D-026: Several accounts per app, one session each.**
A tile's leaf has an optional `profile` (missing = `default`, where existing logins live); extra
accounts per app are named in `workspace.profiles` (v7; "Account 2", ids p2..p8, up to 8 per app).
Each account uses its own partition, `persist:app-<appId>-<profile>` (D-007), so logins, cookies and
storage never mix. `setProfile` gives the tile a fresh instance (new view in the other session);
`swapApps` moves the account with the app; `assignApp` resets to the first account. The tile header
shows an account dropdown on the focused tile, or on any tile whose app has several accounts, with
"+ Add account". Verified with two Browser tiles on example.com: separate partitions and cookies.
Renaming/removing accounts and clearing their data come with 3.9.

**D-027: Snapshots stand in for hidden views.**
`ViewManager.setHidden(true)` captures each visible view first (JPEG, resized to the tile width, ~20
KB; 150 ms limit per page, a slow page just shows the plain placeholder), sends them to the UI
(`views:snapshots`), then hides. The UI draws them in the tile placeholders (`object-fit: cover`,
top-left) during divider drags, tile drags and popovers. Showing again makes the views visible first,
then sends `{}` so the UI drops the snapshots, which avoids a blank flash. A show that arrives while
snapshots are being taken cancels the pending hide. Measured: views hide ~50 ms after a drag starts.

**D-028: Shields panel: a master switch plus per-app overrides of the defaults.**
`PrivacySettings.shields` (workspace v8) is a master switch; `resolvePrivacy` turns every protection
off when it's false (`SHIELDS_DOWN`), so filters need no extra check. Per-app changes are stored in
`privacyOverrides` only where they differ from the defaults (`setPrivacyOverride`), so apps follow
later default changes. Filters read settings per request, so changes apply as soon as the workspace
is saved (~300 ms); a changed WebRTC policy is set on the app's pages and they reload. The request
pipeline reports cancelled requests per page (`onBlocked`); the tile header shows the count, reset on
each navigation. The panel lists only protections that exist today (ads, third-party cookies and
fingerprinting join with 3.6, 3.3 and 3.4). Verified: with Shields down for YouTube, a tracker request
from YouTube went through while the same request from the Browser tile stayed blocked.

**D-029: HTTPS fallback: the panel lives in the UI, the allow list in the workspace.**
The https-only filter records main-frame upgrades per page (`httpsFallback.ts`). If the upgraded load
fails with a "no https here" error (connection/TLS -100..-199, certificate -200..-299, timeout -7,
empty reply -324; not DNS -105 or aborts -3), the view is hidden and its tile shows a panel ("... doesn't
offer a secure connection", Go back / Continue with HTTP). Web views have no IPC, so the panel can't be
a page inside the view. Continuing adds the host to `workspace.httpAllowedHosts` (v9) and to an
in-memory list that bridges the gap until the save lands; every save clears that list so removals in
the menu take effect at once. An allowed site covers its subdomains. Verified with a local http-only
server at 127.0.0.1.nip.io (neverssl.com is unreliable as a test: its https sometimes works and it
hops between random subdomains).

**D-030: Third-party cookie blocking in the request pipeline, with `tldts` for sites.**
`tldts` (MIT, tiny, public-suffix aware) turns hosts into sites in main (`privacy/sites.ts`); core
stays dependency-free. The pipeline gained an `onHeadersReceived` stage. The `third-party-cookies`
filter strips `Cookie` (out) and `Set-Cookie` (in) when a request's site is neither the top-level page's
site nor one of the app's own sites (sites of its `allowedHosts` + `popupHosts`, so Discord <->
discordapp.com, YouTube <-> google.com and "Sign in with Google" keep working); the Browser tile gets
the strict rule. Page loads are first-party; an unknown top page fails open. Tested with a page on
localhost embedding 127.0.0.1 with `SameSite=None; Secure` cookies (Chromium's Lax default already
blocks plain cookies, so the test must use what real trackers use). Limitation: cookies that scripts
inside a cross-site frame set via `document.cookie` are not covered (Backlog).

**D-031: Frosted-glass tile snapshots; force-repaint on window focus.**
Following user reports after live-testing 3.1–3.3: (1) growing a tile mid-drag scales its D-027
snapshot up from its captured resolution, which looked like "dragged out"/pixelated content; fixed
with a CSS treatment on `.tile-snapshot` (blur + slight scale-up + a translucent `--ink` tint) that
turns the unavoidable softness of an upscaled still into a deliberate frosted-glass look, covering
divider drags, tile-swap drags and every popover uniformly (one shared class). (2) Content dragged
over the window by another app could leave a smeared/stale frame on a view (a Wayland/Chromium
compositor damage-tracking quirk external to our code, distinct from D-024's own hide/show cycle):
`ViewManager` now invalidates every visible view when the window regains focus, forcing a clean
repaint at the next natural opportunity to notice.

**D-032: Premium look: neutral focus outline, liquid-glass surfaces, web views as inset rounded cards.**
Owner feedback after D-031: the frosted glass looked cheap, the amber focus edge should be white/grey,
and page corners poked out square. (1) `--focus` is now near-white and the focused tile gets a soft
white outline, a faint halo and a drop shadow instead of the amber edge and 3px inset bar (the tray
icon's focused tile follows). (2) Liquid-glass tokens in `styles.css` (`--glass-fill/-sheen/-edge/
-blur`): popovers and panels use a translucent fill with `backdrop-filter: blur(28px) saturate(1.8)`,
a top sheen and a bright top edge; tile snapshots use a heavier blur with boosted saturation, a
diagonal sheen and inner highlights. (3) Native views sit `VIEW_INSET` (4px) inside the tile's sides
and bottom with `setBorderRadius(VIEW_RADIUS)` (8px), concentric with the 12px tile radius; the
`.tile-body` card has the same inset and radius so launcher, snapshots and panels line up with the
view. The constants live in `shared/ipc.ts` and must match `--view-inset`/`--radius-view`.

**D-033: Fingerprinting protection through a web app preload and `executeInMainWorld`.**
ROADMAP 3.4. Web app views get `preload/webapp.ts`; it runs `contextBridge.executeInMainWorld`
(Electron 44; `webFrame.executeJavaScript` would be async and could run after page scripts) with
`preload/farble.ts`, a self-contained function whose state lives only in closures. Wrapped methods
keep their native `name`, `length` and `toString()`. The seed is FNV-1a of a random per-partition,
per-run key (made in main) and the page's registrable domain (tldts, bundled into the preload since
sandboxed preloads can't load packages: `externalizeDeps.exclude`). Web views have no IPC, so settings
travel as `--aio-webapp=level,gpc,key` in `additionalArguments` (`shared/webapp.ts`); a changed level
or GPC setting replaces the app's views, reopening their pages. Noise: the low bit of one channel in
~1/32 pixels (canvas reads, WebGL `readPixels`), audio samples scaled by 1 ± ~1e-7. Strict adds
hardwareConcurrency 4/8, deviceMemory 8, screen size snapped to a common resolution, no getBattery.
Preloads run in main frames only; subframes, workers and `about:blank` iframes are not covered yet
(Backlog). Verified with a local test page: hashes stable across reloads, different after a restart,
real with protection off; WebGL checked with SwiftShader.

**D-034: Ad and tracker blocking: @ghostery/adblocker engines in our pipeline (uBO Lite doesn't run).**
ROADMAP 3.5/3.6. Option A was tried first: uBlock Origin Lite (MV3, from its uBOL-home repo) loads
through `session.extensions.loadExtension`, but its service worker crashes on a missing chrome API and
Electron has no `declarativeNetRequest`, so nothing is blocked (a test request to doubleclick went
out). Option B: `@ghostery/adblocker` (MPL-2.0, the engine behind Ghostery; new dependency, pure JS)
compiles two engines, `ads` (EasyList, Peter Lowe, uBlock filters/2024/badware/quick-fixes/unbreak,
Brave first-party/specific/unbreak) and `trackers` (EasyPrivacy, uBlock privacy, Brave
first-party-cname/unbreak), so "Block ads" and "Block trackers" stay separate per app. Only the
engine is used, from the `filter-lists` RequestFilter; never `enableBlockingInSession`. Page loads
(mainFrame) are never blocked. Lists come only from `raw.githubusercontent.com` (Ghostery's mirror of
EasyList/uBlock, Brave's repo), fetched in an in-memory `aio-filter-lists` session with no
credentials, compiled (~175k rules in ~1.2 s), and cached as serialized engines in
`userData/filters/{ads,trackers}.{bin,json}` (atomic writes, 0600); rebuilt when older than a day or
when the library's `ENGINE_VERSION` changes; a failed update keeps the old engines. Cosmetic
filtering from main: at `dom-ready` the site's rules and generic base rules, and at `dom-ready` and
`did-finish-load` generic rules for the page's class names/ids, collected in isolated world 1001
(invisible to the page), all via `insertCSS` (user origin). Not done: scriptlets (`+js()`), so video
ads on YouTube are expected to remain; subframe cosmetics; redirect surrogates. New IPC:
`filters:status`, `filters:update` (menu shows rule counts, last update, "Update now").
Desktop tests now run one file at a time (`fileParallelism: false`): three files launch Electron.

**D-035: UI served from `aio://app`; fuses flipped in an electron-builder `afterPack` hook.**
ROADMAP 3.7. The packaged UI loads from a privileged custom scheme (`standard`, `secure`) handled only
in the default (UI) session (`main/security/uiProtocol.ts`), confined to `out/renderer`, with a strict
CSP header on HTML; dev still uses Vite's http URL. That allows the `GrantFileProtocolExtraPrivileges`
fuse to be off. Fuses are flipped with `@electron/fuses` (new dev dependency, Electron's own package)
in `scripts/afterPack.cjs`, rather than electron-builder's `electronFuses` option, so the list lives in
one readable file next to its reasons. Packaged Linux executable is named `aio-space`.

**D-036: Keyring check: backend and availability, one-time notice in the menu.**
ROADMAP 3.8. `security/keyring.ts` reads `safeStorage.getSelectedStorageBackend()` and
`isEncryptionAvailable()` after ready. Weak means `basic_text`/`unknown`, or a keyring that was picked
but can't be used (tested: with `--password-store=gnome-libsecret` and no daemon the backend still
reads `gnome_libsecret` while encryption is unavailable). New IPC `security:storage`. The menu's
Settings show a warning with how to fix it, and the menu button a small dot, until "Got it"; the
dismissal is stored in `workspace.dismissedNotices` (v10, a general list for later one-time notices).

**D-037: Clearing app data: clear the session now, delete the partition folder at the next start.**
ROADMAP 3.9. Chromium's databases keep deleted bytes until they compact, and a partition folder
can't be deleted while its session is open. So "Clear data" (per app account, in the Shields panel)
and "Clear data for all apps" (menu) call `clearStorageData`, `clearCache`, `clearAuthCache`,
`clearCodeCaches` and `clearHostResolverCache` at once (the account is logged out; its open views
restart at the app's home page) and add the partitions to `userData/wipe.json`. At the next start,
before any app session exists, those folders are deleted (`store/siteData.ts`; the list only accepts
`persist:app-*` names). "Forget when AIO Space closes" (`workspace.forgetOnClose`, v11, per app and
all its accounts) clears on quit (at most 3 s) and always deletes the folders at start, which also
covers a crash. Verified end to end: a token found in the partition's files before clearing is gone
from every file after the restart. New IPC `data:clear` (`{appId, profile}` or `{all: true}`).

**D-038: The rail collapses to a thin edge; tiles take the space.**
Owner request (part of ROADMAP 4.7's compact mode). Native web views always draw above the UI page,
so a hidden rail can't slide out over the tiles on hover; instead "Hide sidebar" (bottom of the rail,
or Ctrl+Shift+B, not Ctrl+B, which editors like Discord use for bold) shrinks it to a 14px edge with a
handle and the layout reflows. Clicking the edge brings it back. The edge shows a dot when something
needs attention (unread, downloads, a notice). Saved in `workspace.ui.railCollapsed` (v12).
Animation: native views can't follow a CSS transition (each move is an IPC round trip, so pages lag
their tiles), so toggling first hides the views behind snapshots (as for drags, D-027, but shown
sharp and 1:1), animates the rail width (220 ms) with the buttons fading out and the edge fading in,
then shows the views at their final size. With a popover open, no apps, or reduced motion it just
switches.

**D-039: Seamless resizing and one motion system, with a "Reduce animations and effects" switch.**
Owner feedback: tiles lagged when resizing. (1) Window resize: the UI now sends its layout tree and
the tile area's margins with each `views:sync` (`ViewFrame`), and main recomputes every view's bounds
on `win.on('resize')` with the same core math (`computeLayout` + `tileBodyRect`), in the same tick as
the resize; main also prefers these over the UI's (possibly a frame old) numbers. Verified: bounds match
the DOM's tile bodies to the pixel at several sizes. (2) Drags and the rail animation: snapshots are
now shown sharp at 1:1, pinned top-left like the live page (cropped or revealing a strip, never
scaled), over a blurred stretched copy that fills revealed strips; the frosted look (D-031) is gone.
(3) Motion tokens (`--ease-out`, `--ease-spring`, `--dur-*`): panels slide/pop in from their anchor,
modals settle, badges pop, controls press; tiles fade in (opacity only, since their views appear at
full size at once). (4) `workspace.ui.reduceMotion` (v13, Settings): instant transitions, no glass
blur, and main skips page snapshots; the system reduced-motion preference also turns animations off.

**D-040: App store: a curated catalog in core, installed as ordinary custom apps.**
Owner request. `core/catalog/store.ts` lists ~26 popular web apps (Twitch, Spotify, Netflix, WhatsApp,
Slack, Gmail, ChatGPT, Claude, ...) with the sites each may navigate and only the permissions its main
feature needs. "Add" runs the same validation as a typed-in app (`makeCustomApp`) and stores
`brand` (the store id) and `color`, so the UI shows the real mark from Simple Icons (19 of 26; the
others asked Simple Icons to remove theirs and get a coloured monogram), even before a favicon loads.
Opened from the rail's "+" (new) or an empty tile's "Add app" (then the pick opens in that tile);
"Add any website" leads to the manual form. Entries that need Widevine DRM (Netflix, Spotify, Prime
Video, Disney+) are marked: stock Electron can't play them (castlabs' Electron build would; Backlog).
Submitting apps to the store needs a server and review; not started (Backlog).

**D-041: Scriptlets (uBlock `##+js()` rules) through a generated session preload.**
Owner report: YouTube video ads weren't blocked. They come inside YouTube's own player data, so
request blocking can't catch them; uBlock's fix is scriptlets that run in the page before its own
code (e.g. `set-constant ytInitialPlayerResponse.adPlacements undefined`, `json-prune` and
`trusted-replace-fetch-response` on `/player`). The ad engine now loads uBlock's scriptlet library
(`resources.json`, Ghostery's mirror; optional: a missing library doesn't fail the list update).
Web views have no IPC and the preload can't read files, so main writes one preload per app session
(`userData/scriptlets/*.js`, 0600) holding that app's scriptlets as literal code, one function per
site, and registers it with `ses.registerPreloadScript`. At document start it passes the current
site's function to `contextBridge.executeInMainWorld` (runs before page scripts, not subject to page
CSP) only when `--aio-webapp` says Block ads is on (a 4th field; changing it replaces the view).
Files are rewritten when the lists update. Apps get scriptlets for their own sites; the Browser tile
for youtube.com and twitch.tv. Verified: YouTube's 29 real scriptlets (244 KB) strip `playerAds`,
`adPlacements`, `adSlots` from a YouTube-shaped page and its `/player` fetch; with Block ads off
they arrive intact; a test scriptlet runs before the page's first script in the app. Twitch: the
lists have one rule; its video ads are stitched into HLS playlists (Backlog).

**D-042: Privacy dots (microphone, camera, screen sharing, sound) from a keyed console report.**
Owner request: phone-style indicators. Electron has no capture event, so the page-world script
(always installed now, even with fingerprinting off) wraps `getUserMedia`, `getDisplayMedia`,
`MediaStreamTrack.stop/clone`, counts live tracks (polling every 2 s while any are live, for tracks
that end silently) and reports each change as `console.debug('\u2063aio-media:<key>:<mic><cam><screen>')`
with the original `console.debug`. `<key>` is the view's secret `--aio-webapp` key, which the page
can't read, so a page can't fake or hide its dots (tested: a forged report is ignored). Main parses it
(`parseMediaReport`) on `console-message`; sound comes from `audio-state-changed`. A committed new
document resets the state (not navigation start: a download link during a call keeps the dot).
UI: tile header icons (camera green, mic orange, screen blue, speaker grey), a breathing dot on the
app's rail icon (camera > mic > screen), and on the hidden rail's edge; the edge's "attention" dot
is now soft white so the colours stay unambiguous. Capturing apps never sleep (2.9).

**D-043: Twitch as a built-in app, with TwitchAdSolutions (vaft / video-swap-new) for stream ads.**
Owner request. Twitch moved from the app store to the built-in apps (brand icon; store entries added
earlier keep working: `brand` is now any slug). Its stream ads are stitched into the HLS video, so
lists can't block them; the owner's proven fix is TwitchAdSolutions (github.com/ryanbr/TwitchAdSolutions,
MIT). Both userscripts are vendored in `apps/desktop/vendor/twitch-ad-solutions/` (commit `e4dfb26`,
licence kept) and bundled into main with Vite `?raw`, so they work offline. They're refreshed daily from
the repo's `master` (Twitch changes often) through the filter-list fetcher (raw.githubusercontent.com
only, isolated session) and a download is used only if it's still a `@match *://*.twitch.tv/*`,
`@grant none`, `@run-at document-start` userscript under 2 MB; otherwise the bundled copy stays.
`workspace.twitch.adScript` (v14): 'vaft' (default, recommended upstream), 'video-swap-new' or 'off',
chosen in Twitch's (and the Browser tile's) Shields panel and in the menu. The chosen script replaces
the lists' Twitch scriptlets in the scriptlet preload (D-041) for twitch.tv, so solutions are never
combined (upstream warns against it), and runs only while Block ads is on. Changing it rebuilds the
preload files and reloads twitch.tv pages. Verified: injected through the generated session preload,
both scripts install before the page's first script (`window.Worker` already hooked,
`twitchAdSolutionsVersion` set); real Twitch playback needs the owner's check.

**D-044: Sign-in stays in the app: provider pages allowed as popups and full-page redirects.**
Owner report: "Continue with Google" opened the system browser. Two gaps: Google's button often opens
`about:blank` first and loads the provider into it (blank popups were denied as non-http), and the
site then falls back to sending the whole page to accounts.google.com, which wasn't an allowed host,
so it went to the system browser. The rules now live in `main/views/navigationPolicy.ts` (pure,
unit-tested): sign-in pages (the app's `popupHosts` plus known providers: Google incl.
accounts.youtube.com, Apple, Microsoft; `SIGN_IN_HOSTS`) may load in the tile or as a popup; blank
scripted popups are allowed (hardened window, app session); popups may only show web pages and can't
open more windows; links to the app's own sites load in the tile (only scripted `new-window` popups on
them stay popups: before, "new tab" links on apps whose `popupHosts` include their own site became
popup windows). Other links still go to the system browser. Verified end to end with a recorder in
place of the system browser.

**D-045: Opt-in shared Google sign-in: only Google's cookies are synced between first accounts.**
Owner request: signing in with Google in every app separately is tedious. Each app keeps its own
partition; with `workspace.identity.shareGoogle` (v15, off by default, Settings) `sessions/sharedSignIn.ts`
copies Google's own cookies (google.com, subdomains, country domains) between the sessions of each
app's first account, through a hub partition (`persist:aio-google-identity`) that seeds apps opened
later. Every change (`cookies.on('changed')`) is applied to the others only if it differs, which also
stops the copies' own events from bouncing. Sign-out (removals) spreads too. Extra accounts never take
part, so a second Google identity still works side by side. Clearing one app's data (3.9) is muted, so
it doesn't sign the others out. Turning it on pools open apps' sign-in and reloads them. Trade-off, stated
in the setting: Google can link these apps to one person. Also fixed: Escape didn't close the menu after
ticking one of its switches (checkboxes counted as text fields).

**D-046: No page scripts on sign-in providers' pages.**
Owner report: Gmail showed Google's "Couldn't sign you in: this browser or app may not be secure".
Google sign-in worked before 3.4 (Firefox UA, D-012); since then the fingerprinting script (it wraps
canvas/WebGL/audio methods and `Function.prototype.toString`) and the uBlock scriptlets also ran on
accounts.google.com, and Google's bot checks flag tampered browser functions. Now neither the web app
preload's page script (fingerprinting, media tracking) nor the scriptlet preload runs on
`SIGN_IN_HOSTS` (moved to `shared/webapp.ts`, `isSignInHost`); the page gets the plain browser
plus the Firefox UA, as before. X's login error ("An unexpected error occurred") may have the same
cause (our farbling is script-level, unlike Brave's, so bot-detection can see it), but X's login runs
on x.com itself; the lists only block its telemetry (checked). Owner to test with fingerprinting off
for X (Backlog).

**D-047: Sidebar right-click menu: open, open in a new tile, move up/down, hide, remove.**
Owner request (part of ROADMAP 4.7). `workspace.rail` (v16): `order` (the user's arrangement; apps
not listed follow in catalog order, so new apps join at the end) and `hidden` (still in the launcher,
restorable under Settings > "Hidden from the sidebar"). Core: `railApps`, `moveInRail`,
`setHiddenInRail`. The menu is a small glass popover at the pointer (views hidden while open, like
other popovers); "Remove app..." appears for added apps only.

**D-048: Repaint after the window settles; page stills without a blur layer.**
Owner report on a 5120x1440 screen: after maximizing, a tile header stayed blank and a page showed
torn stripes; the resize blur looked broken. (1) Since D-039 main moves views on the first `resize`
event, which on Wayland can come before a one-jump maximize is committed; the UI's later update then
changes nothing, so nothing repaints the stale frame. Now, 150 ms after the last resize (and on
maximize, unmaximize, restore, fullscreen changes), main re-places the views and invalidates every
visible view and the UI itself. (2) The blurred fill behind page stills (a 24px blur over a
tile-sized image, every frame of a drag) is gone: the still is shown at its own size and its right
and bottom edges fade (14px mask) into the tile. Checked at 5120x1440: views match the tiles, stills
stay crisp mid-drag. Not reproducible here: real Wayland maximize (owner to confirm).

**D-049: Browser tabs; tabs can move to their own tile. UI repaints after page state changes.**
(1) A Browser tile holds tabs (`LeafNode.tabs`, optional, so no workspace version bump). Each tab is
its own running instance (web view, same session as the tile); the leaf's `instanceId` is the tab on
screen. Tabs not on screen go to main in the `keep` list, like apps in other spaces (hidden, still
running, put to sleep by the same setting); a tab never opened this run starts when first shown.
The strip appears under the header once a tile has two tabs (`TAB_BAR`, `tileHeaderHeight()` in
shared/ipc.ts, used by the UI and main alike). "Open in new tile" (strip button, tab right-click,
right or below) moves the tab's instance into a new tile, so its page keeps running. In a Browser,
`target=_blank` links and "Open link in new tab" / selection searches open as tabs (supersedes the
Browser part of D-015; other apps' links still open a new Browser tile). Shortcuts: Ctrl+T (a Browser
elsewhere), Ctrl+W closes the tab when there are several, Ctrl+Tab / Ctrl+Shift+Tab / Ctrl+PageUp/Down.
Tabs remember their last http(s) page and title in the workspace to reopen after a restart, except
when the Browser is set to "forget when AIO Space closes" (then pages are stripped before saving);
views receive that page through `ViewPlacement.url` (zod-checked http(s)), Browser only.
(2) Owner report (Wayland, 5120x1440): a Browser tile's header went blank except for the back and
forward buttons, which had just changed. Header and view bounds were correct; only the redrawn parts
came back. Main now invalidates the UI page 250 ms after any view state change (debounced), which
redraws the whole window without re-rendering React.

**D-050: Themes are colour variables; imported themes are JSON with colours only.**
ROADMAP 4.1. A theme (`packages/core/src/ui/themes.ts`) sets the UI's colour variables (`THEME_KEYS`,
each `--<key>` in styles.css) plus `scheme` (dark/light, for native controls). Every colour in
styles.css now comes from these (translucent tints via `color-mix()` over `--hl`, `--warn`, `--danger`);
the glass highlights stay white on purpose, and brand-coloured store tiles keep white marks. Built-ins:
Dark (the old look), Light, High contrast. `workspace.ui.theme` (v17) is a theme id or `system`
(default: Light or Dark from `prefers-color-scheme`, live). Users import a `.json` file (`{ name, scheme,
colors }`) from Menu > Appearance; it's read in the UI (a file input: no IPC) and missing colours come
from the built-in theme of the same scheme. Values must be hex, rgb() or hsl() with plain numbers
(`isThemeColor`, again in the workspace schema), so a theme can't smuggle `url()` or extra declarations
into the page. Applied with `style.setProperty` on `<html>` (CSSOM, allowed by the strict CSP).
Not themed: the window's startup background (`window.ts`), which shows for a moment before the UI loads.

**D-051: Custom CSS per app: an injected author stylesheet, edited in a panel docked beside the tiles.**
ROADMAP 4.3. `workspace.appCss[appId] = { css, enabled }` (v17, 50 000 characters at most). Main
inserts it with `insertCSS` at every `dom-ready` (each new document) and, after each workspace save,
replaces or removes it in every open view of the app, so edits show live and "off" takes effect at once.
Author origin: injected sheets rank before the page's own, so plain rules lose to the site's and
`!important` ones win (the editor says so). Not user origin: in Electron 44 `removeInsertedCSS` is a
silent no-op for user-origin sheets (checked), so they could never be switched off or replaced. The
editor is a panel docked to the right of the tiles, not a popover: native views cover popovers, and
the tiles simply shrink so the page stays visible while typing. Opened from the sidebar's right-click
menu or Menu > Appearance.

**D-052: Plugins: local folders copied into userData, run as isolated-world content scripts.**
ROADMAP 4.4. Format in `examples/plugins/README.md` (sample: `youtube-hide-shorts`). Install: main
shows the folder picker (`plugins:install`; the UI never passes a path), validates `manifest.json`
(`PluginManifestSchema`: id, name, version, description, `apps`, `permissions`, `scripts`, `styles`,
strict), reads only the plain file names it lists (no subfolders, no symlinks, 1 MB together) and
writes them to `userData/plugins/<id>/` (atomic rename; reinstalling updates). At startup
`PluginStore` loads that folder, skipping anything invalid or whose folder name isn't its id.
`workspace.enabledPlugins` (v17) lists the ones turned on; a new plugin is off, and turning it on asks
first (and warns that modifying Discord breaks its terms). Running: at each `dom-ready` of a target
app's view, on the app's own hosts (`allowedHosts`) and never on `SIGN_IN_HOSTS`, styles are inserted
(author origin, like D-051) and scripts run with `executeJavaScriptInIsolatedWorld` in a world of their
own (1100 + the plugin's index), so neither the page nor other plugins see their variables; they have
no Node and no IPC. A script can't be unloaded, so turning a plugin on or off, updating or removing it
reloads the views of the apps whose plugin set changed. New IPC: `plugins:list`, `plugins:install`,
`plugins:remove`.
Not built yet (Backlog): permissions and the channel to main. Design when needed: a manifest
permission per capability (e.g. `"notify"`); main exposes, to that plugin's world only, one function
through a preload-free route (a keyed `console` report like D-042, or a dedicated isolated-world
bridge), with a zod schema per message, rate-limited, and shown to the user when turning the plugin on.

**D-053: Templates in the workspace; export/import of workspace.json through main's file dialogs.**
ROADMAP 4.6. A template (`workspace.templates`, v17, 20 at most) is a space's layout copied with
`freshLayout`: new ids for every tile, split and running instance (instance ids must be unique across
spaces), Browser tabs dropped, apps, accounts and ratios kept. Starting a space from one copies it again.
Export writes the saved workspace (`store.get()`, which already strips Browser pages for "forget when
closed") to a file picked in main's save dialog (0600). Import reads a file picked in main's open dialog
(5 MB at most), refuses versions it can't read instead of falling back to defaults, then migrates and
validates it with `WorkspaceSchema` exactly like `workspace.json`; the UI asks before replacing
everything and adopts it through the normal save. Logins, cookies and site data are session
partitions, never in the file. New IPC: `workspace:export`, `workspace:import` (no payload; the UI
never passes paths).

**D-054: Sidebar pinning is a fixed group at the top; drag and drop joins the target's group.**
ROADMAP 4.7 (finishes it with D-038 and D-047). `workspace.rail.pinned` (v17): pinned apps show first,
in their own group above a divider that never scrolls (the rest scroll when there are many apps).
`railApps` returns display order (pinned, then the rest, each in the user's order). Move up/down stays
within a group. Dragging an app (HTML5 drag and drop, safe in the rail since native views never cover
it) drops it before or after the app under the pointer (top or bottom half) and into that app's group,
so dragging is also a way to pin or unpin (`placeInRail`). Pin/Unpin is also in the right-click menu.

**D-055: Chrome extensions on Electron's own support, with API stand-ins; not electron-chrome-extensions.**
ROADMAP 4.5. `electron-chrome-extensions` (toolbar actions, popups, a `chrome.tabs` model) is GPL-3.0
or a paid "patron" license held only while sponsoring; AIO Space's license is undecided (free app,
light monetization), so the owner chose no GPL or paid dependency. Instead: `session.extensions` in
each app session, plus `preload/extensionShim.ts`, a session preload (service workers and frames) that,
in `chrome-extension:` contexts only, adds events that never fire and empty getters for APIs Electron
lacks (tabs/windows events, webNavigation, contextMenus, action, alarms, commands...) and maps
`storage.sync` to `storage.local`. Tested on 12 popular extensions (docs/EXTENSIONS.md): the stand-ins
turned several from crashing at startup to working. Installed packages live in
`userData/extensions/<store id | local-name>` (`ExtensionStore`); Web Store installs download the CRX
from `clients2.google.com` in a cookie-less session (`net.request`, redirects followed by hand, Google
hosts only; Electron's `fetch` gives no final URL and can't do manual redirects), unpacked by `crx.ts`
(CRX2/3 and zip; stored/deflate; paths confined, links refused; `_metadata/` dropped since Chromium
refuses it unpacked). Signatures aren't verified (https from Google, or the user's own file).
`workspace.extensions[appId]` (v17) lists what each app runs; `ExtensionHost` loads/unloads them in
every session of that app (never the UI's) and the app's pages reload. Popups and options pages open in
a small sandboxed window in the app's session, restricted to that extension's pages (popups close on
blur, like Chrome's). New IPC: `extensions:list`, `extensions:install-store`,
`extensions:install-folder`, `extensions:remove`, `extensions:open`.

**D-056: Linux packaging: `aio-space` names, explicit pacman dependencies, placeholder icon.**
ROADMAP 5.1. electron-builder builds `aio-space-<version>-x86_64.AppImage` and a pacman package
named `aio-space` (the npm name `@aio/desktop` isn't a valid pacman name); file names have no spaces so
release URLs and the AUR `source=` stay simple. The app installs to `/opt/AIO Space`, with
`/usr/bin/aio-space`, `aio-space.desktop` (validated with `desktop-file-validate`) and hicolor icons
16–512 px. `desktopName: aio-space.desktop` plus `syncDesktopName` make the Wayland app_id match the
.desktop file, so the running window gets its icon and groups with its menu entry. pacman `depends`
are listed explicitly (gtk3, nss, alsa-lib, libxss, libxtst, libnotify, libsecret, at-spi2-core,
xdg-utils): electron-builder's default names `libappindicator-gtk3`, which Arch no longer ships, so
`pacman -U` would refuse the package; Electron bundles ffmpeg and the rest. No Wayland flags in
`Exec`: `ozone-platform-hint=auto` is set in main (D-011). The icon (`build/icon.svg`: a tall tile beside
two stacked ones) is a placeholder the owner can replace; PNGs are rendered from it with
`for s in 16 24 32 48 64 128 256 512; do rsvg-convert -w $s -h $s build/icon.svg -o build/icons/${s}x${s}.png; done`
(in apps/desktop) and committed, so CI needs no SVG tools.

**D-057: AUR `aio-space-bin` repackages a `tar.gz` release build.**
ROADMAP 5.2. electron-builder now also builds `aio-space-<version>-x64.tar.gz` (the fused app folder
alone). `packaging/aur/PKGBUILD` downloads it from the GitHub release `v<version>`, plus the icon SVG
from the same tag, and installs to `/opt/aio-space` with `/usr/bin/aio-space`, its own
`aio-space.desktop` (same app_id `aio-space` as D-056) and a scalable icon. It `provides`/`conflicts`
`aio-space` (the pacman package from releases), keeps binaries unstripped, and leaves
`chrome-sandbox` 0755 (Arch allows user namespaces). Dependencies match D-056. Not the AppImage: that
would need FUSE 2 at build time and extraction; not the .pacman file: repackaging a package is odd for
the AUR. Local test: copy a built tarball and `apps/desktop/build/icon.svg` (as
`aio-space-<version>.svg`) next to the PKGBUILD, `updpkgsums`, `makepkg -si`. The checksums in the repo
match the local build of 2026-09-27; they must be regenerated from the real release tarball.

**D-058: The app is SpaceAIO; old profiles move over with their cookie key name.**
Owner's decision (2026-09-27), before any release: "SpaceAIO", one word. Visible name `SpaceAIO`
(package.json `productName`: window, notifications, data folder `~/.config/SpaceAIO`); technical name
`spaceaio` (command, pacman package, AUR `spaceaio-bin`, `spaceaio.desktop`, Wayland app_id, release
files); supersedes the `aio-space` names in D-056/D-057. Internal code names stay (`@aio/core`,
`@aio/desktop`, `window.aio`, `AIO_USER_DATA_DIR`): users never see them. Before this the app was
effectively named `@aio/desktop` (no productName) with data in `~/.config/@aio/desktop`.
Checked on the fused build: Chromium encrypts cookies (v11) with a keyring entry named after the app,
and a renamed app can't decrypt them and **deletes** them, logging every app out. So
`store/legacyProfile.ts`, before anything touches the profile: moves `~/.config/@aio/desktop` to
`~/.config/SpaceAIO` once (only if the new folder doesn't exist; refuses while the old app is running
on it, per its SingletonLock), writes `.keyring-name` = `@aio/desktop`, and on every start of such a
profile the app carries that name until `ready` (Chromium reads it for the key while starting) and
takes `SpaceAIO` back first thing after. Verified: cookies written by the old name stay readable, and
new ones too, across restarts. The UA cleanup strips both names. New installs are SpaceAIO throughout.
The GitHub repo is still `KrysGG/AIO-Space` (URLs in package.json and the PKGBUILD) until the owner
renames it; GitHub redirects the old URL.

**D-059: Release files are checked, not trusted: `verify:release` reads their fuses.**
ROADMAP 5.3. The fuse table lives in `apps/desktop/scripts/fuses.cjs`, used by `afterPack.cjs` to set it
and by `verify-release.cjs` to check it, so the two can't drift. The check unpacks each release file
the way users get it (AppImage via `--appimage-extract`, which needs no FUSE; pacman with `tar -xJ`;
tar.gz) instead of trusting `linux-unpacked`, since each target repackages the app. ASAR integrity
validation is set but Electron enforces it only on macOS/Windows; on Linux the check makes sure there's
no loose `resources/app` folder next to `app.asar`.

**D-060: Releases come only from the tag workflow; the AUR files are generated with them.**
ROADMAP 5.5. `.github/workflows/release.yml` runs on `v*` tags: the tag must equal
`apps/desktop/package.json`'s version, then typecheck, tests (xvfb), lint, `dist:linux`,
`verify:release` (D-059), `SHA256SUMS`, and `packaging/aur/update.cjs` (writes PKGBUILD/.SRCINFO for the
release; output identical to `makepkg --printsrcinfo`, checked), then `gh release create` with the
AppImage, pacman package, tar.gz, `latest-linux.yml`, `SHA256SUMS`, `PKGBUILD` and `SRCINFO`, and
generated notes. "Run workflow" by hand does all of it but publishing (files kept 7 days as an artifact).
electron-builder has a GitHub `publish` config only so it writes update metadata; `--publish never`
everywhere, so nothing but that last step uploads. Releasing = bump the version, commit, tag, push the tag.


**D-061: AppImage-only updates with electron-updater; installed on quit; SIGTERM quits properly.**
ROADMAP 5.4. `electron-updater` (MIT; its dependencies MIT/ISC) from GitHub Releases. `main/updates.ts`
creates `AppImageUpdater` itself instead of the auto-detected updater: electron-builder writes
`package-type = pacman` into the pacman build, where the default would run `pkexec pacman -U`; pacman/AUR
users update with their package manager. It starts only in a packaged app with `APPIMAGE` set, checks 15 s
after start and every 6 h while `workspace.updates.auto` (v17, on by default; Menu > Updates, shown only
in the AppImage; "Check now" works with it off), downloads in the background (sha512 from
`latest-linux.yml`), and installs on quit or with "Restart to update" (menu dot when ready).
`SPACEAIO_UPDATE_FEED` (loopback URLs only) points it at a local server and turns its log on, for tests.
Verified: a 0.1.0 AppImage served 0.1.1 locally downloaded it, and on quit the installed AppImage became
byte-identical to 0.1.1; the tar.gz build never contacted the server. Found on the way: SIGTERM (logout,
shutdown) ended the app without its quit steps, so updates never installed and "forget when SpaceAIO
closes" never ran; `process.on('SIGTERM', () => app.quit())` fixes both. The updater's cache folder is
`~/.cache/@aiodesktop-updater` (derived from the npm package name, not configurable).

**D-062: All rights reserved for now; the repo is KrysGG/SpaceAIO.**
Owner's decision (2026-09-28), before the first release: no open-source license yet. `LICENSE` says all
rights reserved, source public for viewing only, official builds free to use (not to modify or
redistribute), no warranty, third-party parts under their own licenses. `package.json` files say
`UNLICENSED` (npm's term); the AUR package uses `LicenseRef-SpaceAIO` and installs `LICENSE` (fetched from
the release tag, a fourth checksummed source); electron-builder sets `copyright`. Keeps every option open
(no GPL or paid dependencies, D-055). The GitHub repo was renamed from `AIO-Space` to `SpaceAIO` (GitHub
redirects the old URL); homepage, update feed (`publish.repo`) and AUR URLs use the new name.

**D-063: Windows: verified in CI, unsigned per-user NSIS installer, own title strip.**
ROADMAP 6.x, owner's choices (2026-09-28): no Windows machine, so everything is checked on GitHub's
Windows runners, and hands-on checks wait for a Windows 11 user (Backlog checklist); installers are
unsigned for now (SmartScreen warns). CI runs the full test suite on `windows-latest` (tests made
path-neutral; aio:// is also tested against backslash, `%5c`, drive-letter and UNC escapes; the
on-disk scan skips only empty locked files). The release workflow builds on Linux and Windows and
publishes once; on Windows it also installs the NSIS installer silently, starts the installed app
(20 s, profile created) and uninstalls it. Window: `titleBarStyle: 'hidden'` + `titleBarOverlay` on
Windows only; the UI draws a 32 px draggable title strip (`window.aio.platform`) and sends the theme's
ink/text colours (`window:title-bar`, zod-checked colours). `setAppUserModelId('com.spaceaio.app')`
matches the installer's shortcuts (toasts need it). Taskbar badge: `setOverlayIcon` with a red disc and
the count drawn in code (no numeric badge API for desktop apps). NSIS: one-click, per-user, no admin,
shortcuts, keeps app data on uninstall; `extraMetadata.name: spaceaio` so the install folder is
`%LOCALAPPDATA%\Programs\spaceaio` and the updater cache `spaceaio-updater` (not `@aiodesktop`).
Updates: `NsisUpdater` on Windows (latest.yml; unsigned, so no publisher check). Downloads: Windows-runnable
types added to "never open" (shortcuts, HTA, registry, MSIX, disk images...), and file names made valid on
Windows (no `<>:"|?*`, no reserved device names, no trailing dots/spaces, which Windows drops, so "a.exe." is
saved and checked as a.exe). Views are re-placed on window moves and display-scale changes.

