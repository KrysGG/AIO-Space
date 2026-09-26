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
