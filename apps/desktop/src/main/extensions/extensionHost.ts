import { BrowserWindow, shell, type Session } from 'electron';
import { isWebUrl } from '@aio/core';
import type { ExtensionStore } from './extensionStore';

interface AppSession {
  appId: string;
  ses: Session;
  /** Our extension id -> the id Electron gave it in this session (its chrome-extension:// host). */
  loaded: Map<string, string>;
  shimmed: boolean;
}

/**
 * Loads the Chrome extensions each app has turned on into that app's sessions (every account), and
 * nowhere else: never the UI's session (ROADMAP 4.5, D-055). Uses Electron's own extension support
 * plus the API stand-ins in preload/extensionShim.ts.
 */
export class ExtensionHost {
  private readonly sessions = new Map<string, AppSession>();
  private readonly pages = new Map<string, BrowserWindow>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly store: ExtensionStore,
    private readonly enabledFor: (appId: string) => string[],
    private readonly shimPath: string,
    private readonly parent: BrowserWindow,
  ) {}

  /** A new app session. Resolves true if extensions were loaded (pages already open should reload). */
  attach(appId: string, partition: string, ses: Session): Promise<boolean> {
    if (!this.sessions.has(partition))
      this.sessions.set(partition, { appId, ses, loaded: new Map(), shimmed: false });
    return this.serial(() => this.syncOne(this.sessions.get(partition)!));
  }

  /** Bring every session in line with the settings; resolves with the apps whose extensions changed. */
  sync(): Promise<Set<string>> {
    return this.serial(async () => {
      const changed = new Set<string>();
      for (const entry of this.sessions.values())
        if (await this.syncOne(entry)) changed.add(entry.appId);
      return changed;
    });
  }

  /** One at a time: loading the same extension twice into a session fails. */
  private serial<T>(run: () => Promise<T>): Promise<T> {
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => {});
    return next;
  }

  private async syncOne(entry: AppSession): Promise<boolean> {
    const want = new Set(this.enabledFor(entry.appId).filter((id) => this.store.path(id)));
    let changed = false;
    for (const [id, electronId] of entry.loaded) {
      if (want.has(id)) continue;
      entry.ses.extensions.removeExtension(electronId);
      entry.loaded.delete(id);
      this.closePages(electronId);
      changed = true;
    }
    for (const id of want) {
      if (entry.loaded.has(id)) continue;
      if (!entry.shimmed) {
        entry.shimmed = true;
        entry.ses.registerPreloadScript({
          type: 'service-worker',
          id: 'aio-extension-shim-sw',
          filePath: this.shimPath,
        });
        entry.ses.registerPreloadScript({
          type: 'frame',
          id: 'aio-extension-shim-frame',
          filePath: this.shimPath,
        });
      }
      try {
        const ext = await entry.ses.extensions.loadExtension(this.store.path(id)!, {
          allowFileAccess: false,
        });
        entry.loaded.set(id, ext.id);
        changed = true;
      } catch (err) {
        console.warn(
          `[extensions] ${id} didn't load in ${entry.appId}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
    return changed;
  }

  /** Reload an updated extension everywhere it runs (after reinstalling it). */
  async reloadExtension(id: string): Promise<Set<string>> {
    await this.serial(async () => {
      for (const entry of this.sessions.values()) {
        const electronId = entry.loaded.get(id);
        if (!electronId) continue;
        entry.ses.extensions.removeExtension(electronId);
        entry.loaded.delete(id);
        this.closePages(electronId);
      }
    });
    return this.sync();
  }

  /**
   * An extension's popup or options page in a small window of its own, in the app's session. It may
   * only show that extension's pages; web links go to the system browser.
   */
  openPage(partition: string, extensionId: string, kind: 'popup' | 'options'): void {
    const entry = this.sessions.get(partition);
    const electronId = entry?.loaded.get(extensionId);
    const info = this.store.list().find((e) => e.id === extensionId);
    const page = info?.[kind];
    if (!entry || !electronId || !info || !page) return;
    const origin = `chrome-extension://${electronId}/`;
    const key = `${partition}|${electronId}|${page}`;
    const open = this.pages.get(key);
    if (open && !open.isDestroyed()) return open.focus();
    const popup = kind === 'popup';
    const win = new BrowserWindow({
      parent: this.parent,
      width: popup ? 420 : 820,
      height: popup ? 600 : 700,
      autoHideMenuBar: true,
      title: info.name,
      webPreferences: {
        session: entry.ses,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
      },
    });
    const wc = win.webContents;
    const stay = (url: string): boolean => url.startsWith(origin);
    wc.on('will-navigate', (e, url) => {
      if (stay(url)) return;
      e.preventDefault();
      if (isWebUrl(url)) void shell.openExternal(url);
    });
    wc.setWindowOpenHandler(({ url }) => {
      if (isWebUrl(url)) void shell.openExternal(url);
      return { action: 'deny' };
    });
    win.on('closed', () => this.pages.delete(key));
    if (popup) win.on('blur', () => !win.isDestroyed() && win.close()); // popups close like Chrome's
    this.pages.set(key, win);
    void win.loadURL(origin + page);
  }

  private closePages(electronId: string): void {
    for (const [key, win] of this.pages)
      if (key.includes(`|${electronId}|`) && !win.isDestroyed()) win.close();
  }
}
