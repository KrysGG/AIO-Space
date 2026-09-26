import { app } from 'electron';
import { join } from 'node:path';
import { registerIpc } from './ipc/handlers';
import { installGlobalHardening, lockDownUiSession } from './security/hardening';
import { cleanUserAgent } from './sessions/userAgent';
import { WorkspaceStore } from './store/workspaceStore';
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

// ---- Ready ------------------------------------------------------------------
app.whenReady().then(async () => {
  lockDownUiSession();

  const store = new WorkspaceStore(join(app.getPath('userData'), 'workspace.json'));
  await store.load();

  const win = createMainWindow();
  const views = new ViewManager(win, store);
  registerIpc(win, store, views);

  app.on('second-instance', () => {
    if (win.isMinimized()) win.restore();
    win.focus();
  });
});

app.on('window-all-closed', () => app.quit());
