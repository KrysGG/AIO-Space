import { app, Menu, nativeImage, Tray, type BrowserWindow, type NativeImage } from 'electron';
import { unreadLabel, type Unread } from '@aio/core';

const SIZE = 32;
const SAMPLES = 4; // per axis, for anti-aliased edges
type RGB = [number, number, number];
const FOCUSED: RGB = [0xff, 0xff, 0xff];
const TILE: RGB = [0x8f, 0x9a, 0xb0];
const RED: RGB = [0xe5, 0x3e, 0x3e];

/** Signed distance to a rounded rectangle (negative inside). */
function roundRect(x: number, y: number, rx: number, ry: number, w: number, h: number, r: number): number {
  const qx = Math.abs(x - (rx + w / 2)) - (w / 2 - r);
  const qy = Math.abs(y - (ry + h / 2)) - (h / 2 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

/**
 * The tray icon, drawn in code so no image assets are needed yet (real branding comes with
 * packaging, ROADMAP 5.1): a 2x2 grid of tiles, the focused one in white; a red dot when unread.
 */
function drawIcon(unread: boolean): NativeImage {
  const buf = Buffer.alloc(SIZE * SIZE * 4);
  const tiles: Array<[number, number, RGB]> = [
    [3, 3, FOCUSED],
    [17, 3, TILE],
    [3, 17, TILE],
    [17, 17, TILE],
  ];
  for (let py = 0; py < SIZE; py++) {
    for (let px = 0; px < SIZE; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const x = px + (sx + 0.5) / SAMPLES;
          const y = py + (sy + 0.5) / SAMPLES;
          let color: RGB | null = null;
          if (unread && Math.hypot(x - 25, y - 7) <= 6.5) color = RED;
          else for (const [tx, ty, c] of tiles) if (roundRect(x, y, tx, ty, 12, 12, 3) <= 0) color = c;
          if (color) {
            r += color[0];
            g += color[1];
            b += color[2];
            a += 1;
          }
        }
      }
      const n = SAMPLES * SAMPLES;
      const i = (py * SIZE + px) * 4;
      // BGRA, premultiplied alpha (sums of fully opaque samples are already premultiplied).
      buf[i] = Math.round(b / n);
      buf[i + 1] = Math.round(g / n);
      buf[i + 2] = Math.round(r / n);
      buf[i + 3] = Math.round((a / n) * 255);
    }
  }
  return nativeImage.createFromBitmap(buf, { width: SIZE, height: SIZE });
}

export interface AppTray {
  setUnread(unread: Unread): void;
}

/** Tray icon with the total unread state; click or "Show" brings the window back. */
export function createTray(win: BrowserWindow): AppTray {
  const icons = { read: drawIcon(false), unread: drawIcon(true) };
  const tray = new Tray(icons.read);
  const show = (): void => {
    if (win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  };
  tray.setToolTip('SpaceAIO');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Show SpaceAIO', click: show },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]),
  );
  tray.on('click', show);
  app.on('before-quit', () => tray.destroy());

  return {
    setUnread(unread) {
      if (tray.isDestroyed()) return;
      tray.setImage(unread ? icons.unread : icons.read);
      const label = unreadLabel(unread);
      tray.setToolTip(unread ? `SpaceAIO: ${label ? `${label} unread` : 'new activity'}` : 'SpaceAIO');
      // Launcher badge where the desktop supports it (Unity launcher API; KDE task manager).
      app.setBadgeCount(unread && unread !== 'dot' ? unread.count : 0);
    },
  };
}
