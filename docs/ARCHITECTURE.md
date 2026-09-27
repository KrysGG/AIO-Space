# Architecture

## Processes

```
┌───────────────────────────── BrowserWindow ─────────────────────────────┐
│  UI renderer (React, sandboxed)          Native WebContentsViews on top │
│  ┌──────┐ ┌───────────────┬──────────┐   ┌───────────┐ ┌──────────┐    │
│  │ rail │ │ tile header   │ header   │   │ Discord   │ │ YouTube  │    │
│  │      │ │ [placeholder] │ [ph.]    │ ← │ view      │ │ view     │    │
│  │      │ ├───────────────┴──────────┤   └───────────┘ └──────────┘    │
│  │      │ │ header                   │   ┌──────────────────────────┐  │
│  │      │ │ [placeholder]            │ ← │ Browser view             │  │
│  └──────┘ └──────────────────────────┘   └──────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────┘
              │ window.aio (preload)                ▲ setBounds / create / destroy
              ▼                                     │
        ┌──────────────── main process (Node + Electron) ────────────────┐
        │ ipc/handlers → ViewManager → sessions/appSession → privacy/*   │
        │               WorkspaceStore (userData/workspace.json)         │
        └────────────────────────────────────────────────────────────────┘
```

- **Main process** has all privileges: windows, sessions, filesystem, network filters.
- **UI renderer** is our own React page. It draws the rail, tile headers, dividers, launcher and
  placeholders. It has no Node access and reaches main only through `window.aio`.
- **Web app views** are `WebContentsView`s, one per tile with an app. Each uses its app's own
  persistent session partition. They have no preload and no IPC in Phase 1.

## The positioning loop

1. Workspace state (layout tree) lives in the renderer and is saved through IPC (debounced).
2. `computeLayout()` from core turns the tree plus container size into tile and divider rects.
3. The renderer draws tiles, then sends `views:sync` with each tile body's rect in window
   coordinates.
4. `ViewManager.sync()` creates missing views, destroys removed ones, and calls `setBounds`.

Coordinates are CSS pixels in the renderer, which equal Electron DIPs at zoom 1. Do not zoom the
UI page; zoom individual views instead (ROADMAP 2.10).

## Views are always on top

Native views cover anything the UI draws in their area. Rules:

- The rail is never covered, so global menus should open from the rail into space not used by
  tiles, or hide views first.
- Any popover, dialog or drag over the tile area must call `window.aio.setViewsHidden(true)`
  and restore afterwards.

## Data

| Data | Where | Format |
| --- | --- | --- |
| Workspace (spaces, layouts, privacy settings) | `~/.config/SpaceAIO/workspace.json` (Linux) | JSON, `WORKSPACE_VERSION`, validated by zod |
| Installed Chrome extensions | `~/.config/SpaceAIO/extensions/<id>/` | unpacked extension |
| Installed plugins | `~/.config/SpaceAIO/plugins/<id>/` | manifest.json + listed scripts/styles |
| Logins, cookies, cache per app | `~/.config/SpaceAIO/Partitions/app-<id>-<profile>` | Chromium profile data |

Changing the workspace shape requires bumping `WORKSPACE_VERSION` and adding a migration in
`packages/core/src/workspace/workspace.ts`.

## Directory layout

```
packages/core/src/
  layout/types.ts          LayoutNode, Rect, ComputedLayout
  layout/tree.ts           split, remove, resize, swap, computeLayout, ratioFromPointer
  catalog/apps.ts          built-in apps, permissions, host allowlists, partition names
  privacy/settings.ts      Shields settings + defaults (Brave-like)
  privacy/trackingParams.ts  URL cleaning
  workspace/workspace.ts   Workspace/Space model, defaults, migrations, templates, rail order
  ui/themes.ts             built-in themes, theme file parsing (ROADMAP 4.1)
  util/id.ts               ids
packages/core/test/        vitest unit tests

apps/desktop/src/
  shared/ipc.ts            channel names + types (the UI↔main contract)
  preload/index.ts         exposes window.aio
  main/index.ts            startup, Linux/Wayland flags, UA cleanup
  main/window.ts           the UI BrowserWindow
  main/views/ViewManager.ts  native views: create/move/destroy, navigation guard, state events
  main/sessions/appSession.ts  per-app session setup (UA, permissions, pipeline)
  main/sessions/userAgent.ts   UA cleanup
  main/privacy/requestPipeline.ts  single webRequest listener → RequestFilters
  main/privacy/shields.ts  https-only, tracker block, param strip, GPC, referrer trim
  main/security/hardening.ts  global web-contents guards, UI session lockdown
  main/ipc/schemas.ts      zod schemas for everything from the renderer or disk
  main/ipc/handlers.ts     IPC handlers with sender checks
  main/store/workspaceStore.ts  atomic JSON persistence
  main/store/workspaceFile.ts   workspace export/import files (ROADMAP 4.6)
  main/plugins/pluginStore.ts   installed plugins in userData/plugins (ROADMAP 4.4)
  main/extensions/          Chrome extensions: store/CRX unpacking, per-app loading (ROADMAP 4.5)
  preload/extensionShim.ts  stand-ins for Chrome APIs Electron lacks (extension contexts only)
  renderer/index.html      CSP
  renderer/src/App.tsx     workspace state + actions
  renderer/src/components/ Sidebar, TileLayout, Launcher
  renderer/src/styles.css  design tokens (themes override these)
```

## Future: mobile

`packages/core` is shared. A mobile shell (ROADMAP Phase 7) provides its own view manager
(native WebViews), storage, and privacy implementation behind the same settings model.
