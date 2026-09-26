import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import { app, shell, type BrowserWindow, type DownloadItem, type Session } from 'electron';
import { newId } from '@aio/core';
import { IPC, type DownloadAction, type DownloadInfo } from '../../shared/ipc';
import { isRiskyToOpen, safeFilename, uniquePath } from './files';

interface Tracked {
  id: string;
  item: DownloadItem;
  path: string;
  host: string;
  canOpen: boolean;
}

/** Progress updates are sent at most this often while bytes are arriving. */
const THROTTLE_MS = 250;
/** Finished downloads kept in the list (the files themselves are never deleted). */
const KEEP = 30;

/**
 * Downloads from every app session (ROADMAP 2.6): saved to ~/Downloads without overwriting,
 * progress sent to the UI, open / show in folder / cancel. The UI's own session never downloads
 * (see lockDownUiSession).
 */
export class DownloadManager {
  private readonly downloads: Tracked[] = [];
  private readonly sessions = new WeakSet<Session>();
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly win: BrowserWindow) {}

  /** Called once per app session. */
  attach(ses: Session): void {
    if (this.sessions.has(ses)) return;
    this.sessions.add(ses);
    ses.on('will-download', (_e, item) => this.track(item));
  }

  action(id: string, action: DownloadAction): void {
    if (action === 'clear') {
      for (let i = this.downloads.length - 1; i >= 0; i--) {
        if (this.downloads[i]!.item.getState() !== 'progressing') this.downloads.splice(i, 1);
      }
      this.send();
      return;
    }
    const d = this.downloads.find((x) => x.id === id);
    if (!d) return;
    const done = d.item.getState() === 'completed';
    if (action === 'cancel' && d.item.getState() === 'progressing') d.item.cancel();
    else if (action === 'show' && done) shell.showItemInFolder(d.path);
    // Checked again here, not just hidden in the UI: never hand a risky file to the desktop to open.
    else if (action === 'open' && done && d.canOpen) void shell.openPath(d.path);
  }

  private track(item: DownloadItem): void {
    const filename = safeFilename(item.getFilename());
    const path = uniquePath(app.getPath('downloads'), filename, existsSync);
    item.setSavePath(path);
    let host = '';
    try {
      host = new URL(item.getURL()).hostname;
    } catch {
      // blob:/data: downloads have no host
    }
    const d: Tracked = { id: newId('dl'), item, path, host, canOpen: !isRiskyToOpen(path) };
    this.downloads.unshift(d);
    if (this.downloads.length > KEEP) {
      const drop = this.downloads.findIndex((x, i) => i >= KEEP && x.item.getState() !== 'progressing');
      if (drop >= 0) this.downloads.splice(drop, 1);
    }
    item.on('updated', () => this.sendSoon());
    item.once('done', () => this.send());
    this.send();
  }

  private info(d: Tracked): DownloadInfo {
    return {
      id: d.id,
      filename: basename(d.path),
      host: d.host,
      receivedBytes: d.item.getReceivedBytes(),
      totalBytes: d.item.getTotalBytes(),
      state: d.item.getState(),
      canOpen: d.canOpen,
    };
  }

  private sendSoon(): void {
    this.timer ??= setTimeout(() => this.send(), THROTTLE_MS);
  }

  private send(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.win.isDestroyed()) return;
    this.win.webContents.send(IPC.downloadsUpdate, this.downloads.map((d) => this.info(d)));
  }
}
