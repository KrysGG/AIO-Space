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

/** Digits and "+" as 3x5 pixel glyphs, for the taskbar badge. */
const GLYPHS: Record<string, string[]> = {
  '0': ['111', '101', '101', '101', '111'], '1': ['010', '110', '010', '010', '111'], '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'], '4': ['101', '101', '111', '001', '001'], '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'], '7': ['111', '001', '010', '010', '010'], '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'], '+': ['000', '010', '111', '010', '000'],
};

/**
 * Windows taskbar badge (ROADMAP 6.3): a red disc with the unread count ("9+" above 9), drawn like the
 * tray icon. Windows has no numeric badge API for desktop apps; an overlay icon on the button is the norm.
 */
export function drawBadge(text: string): NativeImage {
  const S = 16;
  const buf = Buffer.alloc(S * S * 4);
  const chars = [...text].filter((c) => GLYPHS[c]).slice(0, 2);
  const scale = chars.length === 1 ? 2 : 1; // one digit big, two digits small
  const w = chars.length * 3 * scale + (chars.length - 1) * scale;
  const x0 = Math.floor((S - w) / 2);
  const y0 = Math.floor((S - 5 * scale) / 2);
  const lit = (px: number, py: number): boolean => {
    const gx = Math.floor((px - x0) / scale);
    const gy = Math.floor((py - y0) / scale);
    if (gy < 0 || gy > 4 || px < x0) return false;
    const i = Math.floor(gx / 4);
    const col = gx % 4;
    return col < 3 && chars[i] !== undefined && GLYPHS[chars[i]!]![gy]![col] === '1';
  };
  for (let py = 0; py < S; py++) {
    for (let px = 0; px < S; px++) {
      const d = Math.hypot(px + 0.5 - S / 2, py + 0.5 - S / 2);
      const alpha = Math.max(0, Math.min(1, S / 2 - d)); // 1px anti-aliased edge
      const color: RGB = lit(px, py) ? [0xff, 0xff, 0xff] : RED;
      const i = (py * S + px) * 4;
      buf[i] = Math.round(color[2] * alpha);
      buf[i + 1] = Math.round(color[1] * alpha);
      buf[i + 2] = Math.round(color[0] * alpha);
      buf[i + 3] = Math.round(alpha * 255);
    }
  }
  return nativeImage.createFromBitmap(buf, { width: S, height: S });
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
      // Windows: an overlay on the taskbar button (ROADMAP 6.3); a plain dot for "new activity".
      if (process.platform === 'win32' && !win.isDestroyed()) {
        const text = !unread ? '' : unread === 'dot' ? ' ' : unread.count > 9 ? '9+' : String(unread.count);
        win.setOverlayIcon(unread ? drawBadge(text) : null, unread ? `${label || 'New activity'} unread` : '');
      }
    },
  };
}
