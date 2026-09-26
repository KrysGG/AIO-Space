# Changelog

One line per completed roadmap step, newest first. Format: `- [x.y] what changed`.

- [1.1] Verified opening, replacing and clearing apps in a tile; fixed empty tiles keeping the previous page title (view states now carry `appId`).
- [0.4] Verified native Wayland on KDE at 100% and 145% (two monitors); views align with tile bodies. Vulkan log line documented as harmless (D-011).
- [0.3] GitHub Actions CI (install, typecheck, test, lint) green on main; react-hooks lint for the renderer; security lint rule verified.
- [0.2] Verified first launch on CachyOS KDE Wayland: launcher lists all six apps, no UI console errors or CSP violations. Chromium's Wayland/Vulkan log line moved to 0.4.
- [0.1] Upgraded to Electron 44, electron-vite 5, Vite 7, zod 4; dropped deprecated `externalizeDepsPlugin`.
- [skeleton] Initial monorepo, core layout tree, Electron shell with tiled web app views, per-app sessions, starter shields.
