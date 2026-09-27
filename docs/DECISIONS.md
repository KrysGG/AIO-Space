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
