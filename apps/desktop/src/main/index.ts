import { app, dialog, net, session } from 'electron';
import { join } from 'node:path';
import { DownloadManager } from './downloads/DownloadManager';
import { registerIpc } from './ipc/handlers';
import { PluginStore } from './plugins/pluginStore';
import { ExtensionHost } from './extensions/extensionHost';
import { ExtensionStore } from './extensions/extensionStore';
import { FilterLists } from './privacy/filterLists';
import { ScriptletFiles } from './privacy/scriptlets';
import { TwitchScripts } from './privacy/twitchScripts';
import { SharedSignIn } from './sessions/sharedSignIn';
import { installGlobalHardening, lockDownUiSession } from './security/hardening';
import { handleUiScheme, registerUiScheme } from './security/uiProtocol';
import { cleanUserAgent } from './sessions/userAgent';
import { installDictionaries } from './sessions/appSession';
import { clearPartitionNow, partitionsOfApp, wipeAtStartup } from './store/siteData';
import { WorkspaceStore } from './store/workspaceStore';
import { APP_NAME, LEGACY_NAME, legacyProfileInUse, migrateLegacyProfile } from './store/legacyProfile';
import { createTray } from './tray';
import { ViewManager } from './views/ViewManager';
import { createMainWindow } from './window';
import { Updates } from './updates';
import { IPC } from '../shared/ipc';

// ---- Before ready -----------------------------------------------------------
app.enableSandbox();

// Windows ties notifications and taskbar grouping to this id; it must match the installer's shortcut
// (electron-builder uses appId), or toasts show no app name or don't show at all (ROADMAP 6.3).
if (process.platform === 'win32') app.setAppUserModelId('com.spaceaio.app');

// Tests run against a throwaway profile so they never touch the real workspace or logins.
// Must come before the single-instance lock, which is tied to the userData path.
const userDataOverride = process.env['AIO_USER_DATA_DIR'];
// Built by hand, not app.getPath('userData'): that call creates the folder, which would hide whether
// this profile is new (the migration below needs to know).
const userData = userDataOverride ?? join(app.getPath('appData'), APP_NAME);

// Before the rename to SpaceAIO (D-058) the profile lived in ~/.config/@aio/desktop: move it over once,
// and keep the name Chromium's cookie key is stored under, or every app would be logged out.
if (!userDataOverride && legacyProfileInUse(app.getPath('appData'), userData)) {
  dialog.showErrorBox('Close the old version first', 'The old version of AIO Space is still running. Close it, then start SpaceAIO again: your apps and logins move over.');
  app.exit(1);
}
const keyringName = userDataOverride ? null : migrateLegacyProfile(app.getPath('appData'), userData);
// Pinned: the app's name changes for a moment below, and the data folder must not follow it.
app.setPath('userData', userData);

if (process.platform === 'linux') {
  // Native Wayland on CachyOS/KDE/GNOME. Recent Electron defaults to this; if it doesn't
  // take effect on your version, launch with --ozone-platform-hint=auto (ROADMAP 0.4).
  app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
  app.commandLine.appendSwitch('enable-features', 'WaylandWindowDecorations');
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

// Strip "Electron/x" and our app token so sites (Google sign-in especially) see normal Chrome.
app.userAgentFallback = cleanUserAgent(app.userAgentFallback, [APP_NAME, LEGACY_NAME]);

// Chromium reads the app's name for its cookie key while starting up; a moved profile keeps the old
// one until then, and gets its own name back first thing once ready.
if (keyringName) app.setName(keyringName);

installGlobalHardening();
registerUiScheme();

// ---- Ready ------------------------------------------------------------------
app.whenReady().then(async () => {
  if (keyringName) app.setName(APP_NAME);
  lockDownUiSession();
  handleUiScheme(join(__dirname, '../renderer'));

  const store = new WorkspaceStore(join(app.getPath('userData'), 'workspace.json'));
  await store.load();
  // Spellcheck dictionaries ship with the app; nothing is downloaded (D-066).
  await installDictionaries().catch((err: unknown) => console.error('[spellcheck] could not install dictionaries', err));
  // Before any app session exists: delete cleared accounts and "forget on close" apps (ROADMAP 3.9).
  await wipeAtStartup(app.getPath('userData'), store.get());

  const plugins = new PluginStore(join(app.getPath('userData'), 'plugins'));
  await plugins.load();
  const extensionStore = new ExtensionStore(join(app.getPath('userData'), 'extensions'), fetchExtension);
  await extensionStore.load();

  const win = createMainWindow();
  const downloads = new DownloadManager(win);
  const filterLists = new FilterLists(join(app.getPath('userData'), 'filters'), fetchFilterList);
  const twitch = new TwitchScripts(join(app.getPath('userData'), 'twitch'), fetchFilterList);
  const scriptlets = new ScriptletFiles(join(app.getPath('userData'), 'scriptlets'), () => filterLists.engine('ads'), (site) =>
    site === 'twitch.tv' ? twitch.scriptsFor(store.get().twitch.adScript) : [],
  );
  filterLists.onUpdated = () => scriptlets.refresh();
  twitch.onUpdated = () => scriptlets.refresh();
  void twitch.start();
  // Cached lists are loaded first; the scriptlet files then get their code (sessions may exist already).
  void filterLists.start().then(() => scriptlets.refresh());
  const signIn = new SharedSignIn(() => store.get().identity.shareGoogle);
  const extensionHost = new ExtensionHost(
    extensionStore,
    (appId) => store.get().extensions[appId] ?? [],
    join(__dirname, '../preload/extensionShim.js'),
    win,
  );
  const views = new ViewManager(win, store, downloads, filterLists, scriptlets, signIn, plugins, extensionHost);
  views.applyPrivacy(); // records the current settings, so later changes are detected
  const updates = new Updates(
    () => store.get().updates.auto,
    (status) => !win.isDestroyed() && win.webContents.send(IPC.updatesState, status),
  );
  registerIpc(win, store, views, downloads, filterLists, plugins, extensionStore, updates);
  updates.start();
  const tray = createTray(win);
  views.onUnreadChange = (unread) => tray.setUnread(unread);

  // "Forget when SpaceAIO closes" (ROADMAP 3.9): clear those apps before quitting (their folders
  // are deleted at the next start). Once, and at most a few seconds.
  let forgotten = false;
  app.on('before-quit', (e) => {
    const ws = store.get();
    const partitions = ws.forgetOnClose.flatMap((id) => partitionsOfApp(ws, id));
    if (forgotten || partitions.length === 0) return;
    e.preventDefault();
    forgotten = true;
    const timeout = new Promise((r) => setTimeout(r, 3000));
    void Promise.race([Promise.all(partitions.map((p) => clearPartitionNow(p))), timeout]).finally(() => app.quit());
  });

  app.on('second-instance', () => {
    if (win.isMinimized()) win.restore();
    win.focus();
  });
});

app.on('window-all-closed', () => app.quit());

// Logging out or shutting down sends SIGTERM, which would otherwise end the app without its quit steps:
// "forget when SpaceAIO closes" (ROADMAP 3.9) and installing a downloaded update (5.4) run on quit.
process.on('SIGTERM', () => app.quit());

/**
 * Filter lists are fetched in their own in-memory session (no cookies, nothing shared with apps or
 * the UI), and only from GitHub's raw file host (ROADMAP 3.5/3.6).
 */
async function fetchFilterList(url: string): Promise<string> {
  if (!url.startsWith('https://raw.githubusercontent.com/')) throw new Error(`Refusing filter list URL ${url}`);
  const res = await session.fromPartition('aio-filter-lists').fetch(url, { credentials: 'omit', cache: 'no-store' });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

/**
 * Chrome Web Store packages (ROADMAP 4.5), fetched in their own in-memory session with no cookies,
 * from Google's update server only (it redirects to a Google download host).
 */
function fetchExtension(storeId: string): Promise<Buffer> {
  const chrome = process.versions.chrome.split('.')[0];
  const url = `https://clients2.google.com/service/update2/crx?response=redirect&prodversion=${chrome}&acceptformat=crx2,crx3&x=id%3D${storeId}%26uc`;
  // Google's hosts only, https only, checked at every redirect before it's followed.
  const trusted = (u: string): boolean => {
    const { protocol, hostname } = new URL(u);
    return protocol === 'https:' && (hostname === 'clients2.google.com' || hostname.endsWith('.googleusercontent.com') || hostname.endsWith('.gvt1.com'));
  };
  return new Promise((resolve, reject) => {
    const req = net.request({ url, session: session.fromPartition('aio-extension-store'), redirect: 'manual', useSessionCookies: false, cache: 'no-store' });
    let hops = 0;
    req.on('redirect', (_status, _method, next) => {
      if (++hops > 5 || !trusted(next)) {
        req.abort();
        reject(new Error('The Chrome Web Store sent the download somewhere unexpected, so it was stopped.'));
      } else req.followRedirect();
    });
    req.on('response', (res) => {
      if (res.statusCode === 204 || res.statusCode === 404) return reject(new Error('The Chrome Web Store has no extension with that id (or it isn’t available for this browser).'));
      if (res.statusCode !== 200) return reject(new Error(`The Chrome Web Store didn’t answer (HTTP ${res.statusCode}). Try again later.`));
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (c) => {
        size += c.length;
        if (size > 200_000_000) req.abort();
        else chunks.push(c);
      });
      res.on('end', () => (size ? resolve(Buffer.concat(chunks)) : reject(new Error('The Chrome Web Store sent an empty download. Check the link and try again.'))));
      res.on('error', () => reject(new Error('The download from the Chrome Web Store broke off. Try again.')));
    });
    req.on('error', (err) => reject(new Error(`Couldn’t reach the Chrome Web Store (${err.message}).`)));
    req.end();
  });
}
