import { app, session } from 'electron';
import { join } from 'node:path';
import { DownloadManager } from './downloads/DownloadManager';
import { registerIpc } from './ipc/handlers';
import { FilterLists } from './privacy/filterLists';
import { installGlobalHardening, lockDownUiSession } from './security/hardening';
import { handleUiScheme, registerUiScheme } from './security/uiProtocol';
import { cleanUserAgent } from './sessions/userAgent';
import { WorkspaceStore } from './store/workspaceStore';
import { createTray } from './tray';
import { ViewManager } from './views/ViewManager';
import { createMainWindow } from './window';

// ---- Before ready -----------------------------------------------------------
app.enableSandbox();

// Tests run against a throwaway profile so they never touch the real workspace or logins.
// Must come before the single-instance lock, which is tied to the userData path.
const userDataOverride = process.env['AIO_USER_DATA_DIR'];
if (userDataOverride) app.setPath('userData', userDataOverride);

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
app.userAgentFallback = cleanUserAgent(app.userAgentFallback, app.getName());

installGlobalHardening();
registerUiScheme();

// ---- Ready ------------------------------------------------------------------
app.whenReady().then(async () => {
  lockDownUiSession();
  handleUiScheme(join(__dirname, '../renderer'));

  const store = new WorkspaceStore(join(app.getPath('userData'), 'workspace.json'));
  await store.load();

  const win = createMainWindow();
  const downloads = new DownloadManager(win);
  const filterLists = new FilterLists(join(app.getPath('userData'), 'filters'), fetchFilterList);
  void filterLists.start();
  const views = new ViewManager(win, store, downloads, filterLists);
  registerIpc(win, store, views, downloads, filterLists);
  const tray = createTray(win);
  views.onUnreadChange = (unread) => tray.setUnread(unread);

  app.on('second-instance', () => {
    if (win.isMinimized()) win.restore();
    win.focus();
  });
});

app.on('window-all-closed', () => app.quit());

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
