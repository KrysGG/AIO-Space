# SpaceAIO plugins

A plugin is a folder with a `manifest.json`, scripts and styles. Install it from Menu > Plugins >
"Install plugin from folder…"; it stays off until you turn it on (ROADMAP 4.4, D-052).

```jsonc
{
  "id": "youtube-hide-shorts", // a-z, 0-9 and "-"; also the installed folder's name
  "name": "YouTube: hide Shorts",
  "version": "1.0.0", // up to four numbers
  "description": "What it does.", // optional
  "apps": ["youtube"], // app ids it runs in (custom apps: "custom-...")
  "permissions": [], // none are offered yet; a plugin asking for any is refused
  "scripts": ["hide-shorts.js"], // files in the same folder, run on every page load
  "styles": ["hide-shorts.css"], // stylesheets added to every page
}
```

- Scripts run in the plugin's own isolated world, like a browser extension's content script: they
  share the page's DOM but not its JavaScript, and they have no Node.js, no IPC and no access to
  SpaceAIO. They run when the DOM is ready, once per page load; single-page apps (YouTube, Discord)
  need their own listeners or `MutationObserver` for in-page navigation.
- They run only on the app's own sites, never on sign-in pages (Google, Apple, Microsoft...).
- Styles are injected before the page's own, so use `!important` to override the site.
- Files are plain names in the folder (no subfolders), 1 MB at most together.
- Updating: install the folder again. Turning a plugin on or off reloads its apps.

Modifying Discord's app is against Discord's terms; SpaceAIO warns before turning on such plugins.
