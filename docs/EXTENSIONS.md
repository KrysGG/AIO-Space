# Chrome extensions in SpaceAIO

ROADMAP 4.5, D-055. Install from Menu > Chrome extensions (paste a Chrome Web Store link, or pick an
unpacked folder), then turn an extension on per app with the puzzle button in that app's tile.
Extensions run only in the apps you turn them on for, each app in its own session.

SpaceAIO uses Electron's built-in extension support (no extra library, D-055), plus small stand-ins
for Chrome APIs Electron lacks (`preload/extensionShim.ts`). What that means:

- **Content scripts work** (the part of an extension that changes pages). Most "change this site"
  extensions work.
- **Popups and options pages open** from the tile's puzzle button, in a small window.
- **No browser tabs or windows.** Electron has no Chrome tab model, so anything that asks "which tab
  am I on?" gets nothing: per-site switches in popups, autofill triggered from the toolbar, context
  menu items, keyboard commands, badges on the toolbar icon.
- **No `declarativeNetRequest`**, so blocking extensions (uBlock Origin Lite, Privacy Badger's
  blocking) don't block. SpaceAIO's own Shields do this already.
- `storage.sync` is local storage in extension pages and workers (nothing syncs to a Google
  account); in content scripts it's unavailable.

## Tested extensions

Electron 44.4.5, 2026-09-27. Each was installed from the Chrome Web Store and checked for: its
service worker starting, its content script being injected on a real target site (and a visible
effect where there is one), and its popup/options page rendering.

| Extension              | Version       | Result        | What was seen                                                                                                                                    |
| ---------------------- | ------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Return YouTube Dislike | 4.0.5         | ✅ Works      | Its dislike bar is added on a YouTube video; worker starts cleanly with the stand-ins (5 errors without); popup and options render.              |
| Unhook                 | 1.6.9         | ✅ Works      | Sets its hide switches on YouTube (26 page attributes); popup with all switches renders.                                                         |
| SponsorBlock           | 6.1.6         | ✅ Works      | Its elements are added on a YouTube video; popup renders (the per-video part stays "Loading…": needs the active tab).                            |
| 7TV                    | 3.1.25        | ✅ Works      | Injects on Twitch; popup and options render, no errors.                                                                                          |
| Dark Reader            | 4.9.133       | 🟡 Partly     | Darkens pages (default settings); popup stays on "Loading" (needs the active tab), so settings can't be changed.                                 |
| DeArrow                | 2.3.10        | 🟡 Partly     | Content script is injected only with the stand-ins; popup shows "Activate DeArrow". Effect on titles not confirmed.                              |
| BetterTTV              | 7.7.25        | 🟡 Partly     | Its page script loads on Twitch; its worker crashes on a missing API (`…onAdded`).                                                               |
| Bitwarden              | 2026.9.2      | ❌ Not useful | Worker starts with the stand-ins and the popup shows its login screen, but no autofill on pages (needs tab APIs). Use the Bitwarden desktop app. |
| Grammarly              | 14.1332.0     | ❌ No         | Content script injects, but the worker fails (`…focused`) and the popup is blank.                                                                |
| Privacy Badger         | 2026.9.15     | ❌ No         | Worker starts with the stand-ins and options work; popup fails; can't block (no `declarativeNetRequest`). Shields cover this.                    |
| uBlock Origin Lite     | 2026.926.2202 | ❌ No         | Worker crashes; blocking needs `declarativeNetRequest` (D-034). Shields' ad blocking covers this.                                                |
| Google Translate       | 2.0.17        | ❌ No         | Worker crashes on `contextMenus`; with the stand-ins the test didn't finish (hung).                                                              |

Return YouTube Dislike, Unhook, SponsorBlock and Dark Reader were also installed through SpaceAIO
itself (store link, per-app switch on the YouTube app) and checked on real YouTube: all four loaded
into YouTube's session only (none in the UI's), with their effects on the page.

## Adding to this list

Test with a fresh profile (`AIO_USER_DATA_DIR=/tmp/aio-test pnpm dev`), install from the store, turn
it on for the app it's meant for, and note: does it change the page, does its popup work? Say which
missing API an error names (the service worker's console errors are printed in the terminal).
