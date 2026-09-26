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
placeholder shows. Upgrade path: show `capturePage()` snapshots instead (ROADMAP 2.13).

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
favicons for custom apps wait for 2.7 (TODO(ROADMAP 4.2) in `AppIcon.tsx`).

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
