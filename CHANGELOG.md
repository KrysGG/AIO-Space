# Changelog

One line per completed roadmap step, newest first. Format: `- [x.y] what changed`.

- [3.9] Clear data per app account (Shields panel) or for all apps (menu), and "forget when AIO Space closes" per app; data is cleared at once and the files deleted at the next start (workspace v11, D-037).
- [3.8 built] Warning in the menu (and a dot on the menu button) when logins aren't protected by KWallet or GNOME Keyring, with how to fix it; dismissible, remembered in workspace v10 (D-036). Waiting for the owner to confirm no warning on their KDE setup.
- [3.7] Security audit (electronegativity + Electron checklist, in SECURITY.md); UI served from `aio://app` with a strict CSP instead of `file://`; fuses flipped on packaged builds (verified: `ELECTRON_RUN_AS_NODE=1` starts the app, not Node); tile blocked counts no longer miss early requests.
- [3.5/3.6 built] Ad and tracker blocking with EasyList, EasyPrivacy, uBlock Origin and Brave lists (@ghostery/adblocker engine in our pipeline), cosmetic hiding of ad slots, daily list updates cached on disk, "Block ads" switch and list status in the menu (D-034). Waiting for the owner to check popular sites and YouTube.
- [3.4 built] Fingerprinting protection (standard/strict) for canvas, WebGL and audio, `navigator.globalPrivacyControl`, hidden `webdriver`; a choice in both Shields panels (D-033). Waiting for the owner to check YouTube, Discord and X.
- [UI polish] White/grey focus outline instead of amber, liquid-glass panels and snapshots, web pages as inset rounded cards (no more square corners), menu icon centered in its button, subtle scrollbars (D-032).
- [2.13 fix] Frosted-glass look for tile snapshots while resizing/dragging (hides upscale blur instead of looking pixelated); views force-repaint on window focus to clear smeared frames left by other apps dragged over ours.
- [3.2] When the HTTPS upgrade fails, the tile offers "Continue with HTTP (not secure)" and remembers the site (removable in the menu); workspace v9.
- [3.1] Shields panel per app (shield in the tile header with blocked count; master switch and per-feature switches) and Shields defaults in the menu; workspace v8.
- [2.13] Tiles show a snapshot of their page while views are hidden (drags, popovers), so layouts no longer flash empty.
- [2.12] Several accounts per app: account dropdown in the tile header (+ Add account), each account with its own session; workspace v7.
- [2.10] Zoom per app with Ctrl +/-/0 or Ctrl+wheel, remembered across restarts; a badge in the tile header shows and resets it.
- [2.9] Apps hidden in other spaces sleep after a set time (default 30 min) and reload where they were; audible, call/mic and notifying apps stay awake.
- [2.8] Menu panel from the rail: spaces (create, rename, switch, delete) whose apps keep running in the background, and settings (search engine).
- [2.7] Custom apps: add any https site (name, address, allowed sites, permissions off by default) from the launcher; own session, favicon icon, saved in workspace v4.
- [4.2] App icons complete: custom apps show their own favicon.
- [2.6] Downloads to ~/Downloads (unique names) with progress, cancel, open / show in folder in a rail panel; risky file types are never opened from the app.
- [2.4] Right-click menu in every web view: links, images, selected text, text fields with spelling suggestions, page navigation, Inspect in dev.
- [2.3] Views follow running app instances (workspace v3), so swapping tiles keeps pages loaded; drag a tile header onto another tile to swap.
- [4.2 partial] Brand icons for built-in apps in the rail, launcher and tile headers (custom-app favicons wait for 2.7).
- [2.2] Browser tile: address bar (Ctrl+L), search engine picker (DuckDuckGo, Brave, Startpage), new-tab links open in a new tile; workspace v2 with migration.
- [2.1] Keyboard shortcuts (focus by arrow or number, split, close, reload, help) work from any tile or page; help popover in the rail (Ctrl+/).
- [1.6] Verified navigation rules (outside links to system browser, no javascript:/file:, Browser tile goes anywhere) and Google sign-in in tiles and popups via a Firefox UA on accounts.google.com (D-012).
- [1.8] Desktop tests: vitest for schemas, UA and shield filters; Electron smoke test (launch, open Browser, split, close) in `pnpm test` and CI via xvfb-run.
- [1.7] Verified Discord voice both ways over PipeWire (mic granted by app permissions); Browser tile gets NotAllowedError for the mic.
- [1.5] Verified layout restore after relaunch and atomic saves (15/15 SIGKILL-mid-save runs valid); unreadable or wrong-version workspace files now log a warning.
- [1.4] Verified live divider drag, 10%/90% clamp, window resize alignment and release outside the window; drag listeners read the latest `onResize` from a ref.
- [1.3] Verified split right/down, close (neighbor fills, view destroyed, memory drops), last-tile reset, and focus by header or click inside a view.
- [1.2] Verified per-app logins persist across restarts (Discord, Reddit) and cookies stay isolated per partition.
- [1.1] Verified opening, replacing and clearing apps in a tile; fixed empty tiles keeping the previous page title (view states now carry `appId`).
- [0.4] Verified native Wayland on KDE at 100% and 145% (two monitors); views align with tile bodies. Vulkan log line documented as harmless (D-011).
- [0.3] GitHub Actions CI (install, typecheck, test, lint) green on main; react-hooks lint for the renderer; security lint rule verified.
- [0.2] Verified first launch on CachyOS KDE Wayland: launcher lists all six apps, no UI console errors or CSP violations. Chromium's Wayland/Vulkan log line moved to 0.4.
- [0.1] Upgraded to Electron 44, electron-vite 5, Vite 7, zod 4; dropped deprecated `externalizeDepsPlugin`.
- [skeleton] Initial monorepo, core layout tree, Electron shell with tiled web app views, per-app sessions, starter shields.
