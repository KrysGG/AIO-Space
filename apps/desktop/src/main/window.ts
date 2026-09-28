import { app, BrowserWindow } from 'electron';
import type { WindowBounds } from '@aio/core';
import { join } from 'node:path';
import { IPC } from '../shared/ipc';
import { forwardShortcuts } from './shortcuts';
import { uiIndexUrl } from './security/uiProtocol';

const BG = '#161B26';
/** Height of the UI's title strip on Windows, where the window controls are drawn over it (ROADMAP 6.2). */
export const TITLE_BAR_HEIGHT = 32;

/**
 * The main window, or with `spaceId` a torn-off window showing that one space at `bounds` (ROADMAP
 * 2.15). Both load the same UI page; the space goes in its query.
 */
export function createMainWindow(torn?: { spaceId: string; bounds: WindowBounds; title: string }): BrowserWindow {
  const win = new BrowserWindow({
    ...(torn ? torn.bounds : { width: 1440, height: 900 }),
    minWidth: torn ? 360 : 820,
    minHeight: torn ? 280 : 520,
    show: false,
    backgroundColor: BG,
    autoHideMenuBar: true,
    title: torn ? `${torn.title} - SpaceAIO` : 'SpaceAIO',
    // Windows: no system title bar. Windows draws its minimize/maximize/close buttons (with Windows 11's
    // Snap Layouts) over the UI's own title strip, in the theme's colours (set from the UI). Linux keeps
    // its native decorations.
    ...(process.platform === 'win32'
      ? { titleBarStyle: 'hidden' as const, titleBarOverlay: { color: BG, symbolColor: '#E4E8F0', height: TITLE_BAR_HEIGHT } }
      : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      // Middle-click can't open anything from the UI (Electron checklist; windows are denied anyway).
      disableBlinkFeatures: 'Auxclick',
    },
  });

  win.once('ready-to-show', () => win.show());
  // A torn-off window keeps its app's name as its title (the UI page's own title would replace it).
  if (torn) win.on('page-title-updated', (e) => e.preventDefault());

  // The UI window only ever shows our own bundled page.
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  forwardShortcuts(win.webContents, (action) => win.webContents.send(IPC.shortcut, action));

  const query = torn ? `?space=${encodeURIComponent(torn.spaceId)}` : '';
  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl && !app.isPackaged) {
    void win.loadURL(devUrl + query);
  } else {
    void win.loadURL(uiIndexUrl() + query);
  }
  return win;
}
