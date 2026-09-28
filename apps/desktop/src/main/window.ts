import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';
import { IPC } from '../shared/ipc';
import { forwardShortcuts } from './shortcuts';
import { uiIndexUrl } from './security/uiProtocol';

const BG = '#161B26';
/** Height of the UI's title strip on Windows, where the window controls are drawn over it (ROADMAP 6.2). */
export const TITLE_BAR_HEIGHT = 32;

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 820,
    minHeight: 520,
    show: false,
    backgroundColor: BG,
    autoHideMenuBar: true,
    title: 'SpaceAIO',
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

  // The UI window only ever shows our own bundled page.
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  forwardShortcuts(win.webContents, (action) => win.webContents.send(IPC.shortcut, action));

  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl && !app.isPackaged) {
    void win.loadURL(devUrl);
  } else {
    void win.loadURL(uiIndexUrl());
  }
  return win;
}
