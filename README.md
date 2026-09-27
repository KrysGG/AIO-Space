# AIO Space

All your web apps in one window, tiled the way you want. Make the app your space.

Discord next to YouTube, a browser underneath, each in its own resizable tile, each with its own
isolated login, with Brave-style privacy protections applied to all of them.

**Status:** in development (Phases 0–4 done). See `ROADMAP.md` for what is built and what comes next.

## Run it (CachyOS / Arch)

```bash
sudo pacman -S --needed nodejs pnpm git
pnpm install
pnpm dev
```

If the window opens under XWayland instead of native Wayland, see ROADMAP step 0.4.

## Install a build (CachyOS / Arch)

`pnpm dist:linux` writes both packages to `apps/desktop/release`:

```bash
# pacman package: menu entry, icon, and an `aio-space` command
sudo pacman -U apps/desktop/release/aio-space-0.1.0-x64.pacman

# or the AppImage (needs FUSE 2: sudo pacman -S fuse2)
chmod +x apps/desktop/release/aio-space-0.1.0-x86_64.AppImage
./apps/desktop/release/aio-space-0.1.0-x86_64.AppImage
```

Remove the pacman package with `sudo pacman -R aio-space`; your logins and settings stay in
`~/.config/@aio/desktop` (see the Backlog in `ROADMAP.md`).

## Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Run the desktop app with hot reload |
| `pnpm typecheck` | Type-check every package |
| `pnpm test` | Run unit tests |
| `pnpm lint` | Lint (also enforces the security settings) |
| `pnpm dist:linux` | Build AppImage and pacman packages into `apps/desktop/release` |

## Repository map

```
aio-space/
├─ AGENTS.md              rules for coding agents (read first)
├─ ROADMAP.md             phases and steps, with "Done when" checks
├─ CHANGELOG.md
├─ docs/
│  ├─ ARCHITECTURE.md     processes, data flow, where code goes
│  ├─ SECURITY.md         invariants, threat model, privacy features
│  └─ DECISIONS.md        why things are the way they are
├─ packages/
│  └─ core/               platform-neutral logic (reused on mobile later)
└─ apps/
   └─ desktop/            Electron app (Linux first, then Windows)
```
