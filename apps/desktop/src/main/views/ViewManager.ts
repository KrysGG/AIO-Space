import {
  app,
  BrowserWindow,
  clipboard,
  Menu,
  shell,
  WebContentsView,
  type BrowserWindowConstructorOptions,
  type ContextMenuParams,
  type WebContents,
} from 'electron';
import {
  getApp,
  hostMatches,
  isWebUrl,
  MAX_TILES,
  nextZoom,
  SEARCH_ENGINES,
  sumUnread,
  unreadFromTitle,
  type Unread,
  type WebAppDef,
} from '@aio/core';
import { IPC, type OpenInNewTile, type ViewCommand, type ViewPlacement, type ViewState } from '../../shared/ipc';
import type { DownloadManager } from '../downloads/DownloadManager';
import { getAppSession, hasUsedMedia } from '../sessions/appSession';
import { fetchFavicon } from './favicon';
import { followSignInUserAgent } from '../sessions/userAgent';
import { forwardShortcuts } from '../shortcuts';
import { contextMenuTemplate } from './contextMenu';
import type { WorkspaceStore } from '../store/workspaceStore';

/** How often hidden apps are checked for sleeping. */
const SLEEP_CHECK_MS = 30_000;
/** Minimum time between Ctrl+wheel zoom steps. */
const WHEEL_ZOOM_MS = 150;

interface Entry {
  /** The tile the view currently sits in. Changes when tiles are swapped; the view doesn't. */
  leafId: string;
  /** Account of the app (ROADMAP 2.12); a different account needs a different session, so a new view. */
  profile: string;
  /** When the view was last hidden in another space (ms), or undefined while it's on screen. */
  hiddenSince?: number;
  /** Re-sends this view's state to the UI (set up in wireState). */
  emit?: () => void;
  appId: string;
  def: WebAppDef;
  view: WebContentsView;
}

/**
 * Owns every native web view. The renderer tells us where tiles are (sync);
 * we create, move, and destroy WebContentsViews to match. Views are keyed by the tile's running
 * instance id, not the tile, so an app moved to another tile keeps its page (ROADMAP 2.3).
 *
 * Views are drawn ON TOP of the UI page. Anything the UI must show over a tile
 * (menus, dialogs, divider drags) has to call setHidden(true) first.
 */
export class ViewManager {
  /** Keyed by instance id. */
  private readonly views = new Map<string, Entry>();
  private hidden = false;
  /** Start URL / focus requested for a Browser tile before its view exists (new tiles from links). */
  private readonly pendingUrl = new Map<string, string>();
  private lastPlacements: ViewPlacement[] = [];
  private lastKeep: string[] = [];
  /** Slept apps (ROADMAP 2.9): the page they were on, to reload when their space is shown again. */
  private readonly sleeping = new Map<string, { url: string; appId: string }>();
  private pendingFocus: string | null = null;
  private lastUnread = '';

  /** Total unread across all views changed (from page titles like "(3) Discord"). */
  onUnreadChange: (unread: Unread) => void = () => {};

  constructor(
    private readonly win: BrowserWindow,
    private readonly store: WorkspaceStore,
    private readonly downloads: DownloadManager,
  ) {
    setInterval(() => this.sleepIdle(), SLEEP_CHECK_MS).unref();
  }

  /**
   * Show the active space's views at their placements; hide (but keep running) the views listed in
   * `keep`, which belong to other spaces (ROADMAP 2.8); destroy everything else. Views for `keep`
   * apps that aren't running yet are only created once their space is shown.
   */
  sync(placements: ViewPlacement[], keep: string[] = this.lastKeep): void {
    this.lastPlacements = placements;
    this.lastKeep = keep;
    const shown = new Set(placements.map((p) => p.instanceId));
    const kept = new Set(keep);
    for (const [instanceId, entry] of [...this.views]) {
      if (shown.has(instanceId)) {
        entry.hiddenSince = undefined;
        continue;
      }
      if (kept.has(instanceId)) {
        entry.view.setVisible(false);
        entry.hiddenSince ??= Date.now();
      } else this.destroy(instanceId);
    }
    for (const instanceId of [...this.sleeping.keys()]) {
      if (!shown.has(instanceId) && !kept.has(instanceId)) this.sleeping.delete(instanceId); // app closed
    }
    for (const p of placements) {
      let entry = this.views.get(p.instanceId);
      if (entry && (entry.appId !== p.appId || entry.profile !== p.profile)) {
        this.destroy(p.instanceId);
        entry = undefined;
      }
      entry ??= this.create(p.leafId, p.instanceId, p.appId, p.profile, this.wake(p.instanceId, p.appId));
      if (!entry) continue;
      entry.leafId = p.leafId;
      entry.view.setBounds(p.bounds);
      entry.view.setVisible(!this.hidden);
    }
  }

  /**
   * Re-apply the last placements, e.g. after the workspace (and so the app catalog) was saved: a
   * custom app added a moment ago may have been placed before main knew about it.
   */
  refresh(): void {
    this.sync(this.lastPlacements);
  }

  private byLeaf(leafId: string): Entry | undefined {
    for (const entry of this.views.values()) if (entry.leafId === leafId) return entry;
    return undefined;
  }

  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    const shown = new Set(this.lastPlacements.map((p) => p.instanceId));
    for (const [instanceId, { view }] of this.views) {
      if (!shown.has(instanceId)) continue; // other spaces' views stay hidden
      view.setVisible(!hidden);
      // A static page may not paint for seconds after being shown again; until it does, the Wayland
      // compositor can show its old frame in the wrong place (torn strips after a divider drag).
      if (!hidden) view.webContents.invalidate();
    }
  }

  /** Keyboard focus to a tile's view; the UI page when the tile is empty or `leafId` is null. */
  focus(leafId: string | null): void {
    if (this.win.isDestroyed()) return;
    // Only views on screen (active space) can take focus.
    const entry = leafId && this.lastPlacements.some((p) => p.leafId === leafId) ? this.byLeaf(leafId) : undefined;
    // A tile whose view is about to be created (pending URL) gets focus once it exists.
    this.pendingFocus = !entry && leafId && this.pendingUrl.has(leafId) ? leafId : null;
    if (entry && !this.hidden) entry.view.webContents.focus();
    else this.win.webContents.focus();
  }

  /** Address bar and new tiles from links. Browser tiles only, http(s) only (also checked by the schema). */
  navigate(leafId: string, url: string): void {
    if (!isWebUrl(url)) return;
    const entry = this.byLeaf(leafId);
    if (entry) {
      if (entry.def.kind === 'browser') void entry.view.webContents.loadURL(url);
      return;
    }
    if (this.pendingUrl.size >= MAX_TILES) this.pendingUrl.delete(this.pendingUrl.keys().next().value!);
    this.pendingUrl.set(leafId, url);
  }

  command(leafId: string, cmd: ViewCommand): void {
    const entry = this.byLeaf(leafId);
    if (!entry) return;
    const wc = entry.view.webContents;
    const nav = wc.navigationHistory;
    if (cmd === 'back' && nav.canGoBack()) nav.goBack();
    else if (cmd === 'forward' && nav.canGoForward()) nav.goForward();
    else if (cmd === 'reload') wc.reload();
    else if (cmd === 'home') void wc.loadURL(this.homeOf(entry.def));
    else if (cmd === 'zoom-in') this.setZoom(entry.appId, nextZoom(wc.getZoomFactor(), 'in'));
    else if (cmd === 'zoom-out') this.setZoom(entry.appId, nextZoom(wc.getZoomFactor(), 'out'));
    else if (cmd === 'zoom-reset') this.setZoom(entry.appId, 1);
  }

  /**
   * Zoom is per app (ROADMAP 2.10): every view of the app gets the factor and reports it, and the UI
   * saves it in workspace.zoom, which is applied again whenever a page of that app loads.
   */
  private setZoom(appId: string, factor: number): void {
    for (const entry of this.views.values()) {
      if (entry.appId !== appId || entry.view.webContents.isDestroyed()) continue;
      entry.view.webContents.setZoomFactor(factor);
      entry.emit?.();
    }
    if (!this.win.isDestroyed()) this.win.webContents.send(IPC.appZoom, appId, factor);
  }

  /** The Browser tile starts on the chosen search engine; other apps on their own start page. */
  private homeOf(def: WebAppDef): string {
    return def.kind === 'browser' ? SEARCH_ENGINES[this.store.get().browser.searchEngine].home : def.url;
  }

  /** A slept app's saved page, if this instance was put to sleep (and is the same app). */
  private wake(instanceId: string, appId: string): string | undefined {
    const slept = this.sleeping.get(instanceId);
    this.sleeping.delete(instanceId);
    return slept && slept.appId === appId ? slept.url : undefined;
  }

  /**
   * Put apps to sleep that have been hidden in another space longer than the user's setting: close
   * the page, remember where it was. Never an app playing audio, one that was given the camera,
   * microphone or screen (a call can be silent), or one allowed to notify (it would miss messages).
   */
  private sleepIdle(): void {
    const minutes = this.store.get().performance.sleepAfterMinutes;
    if (minutes === null) return;
    const cutoff = Date.now() - minutes * 60_000;
    for (const [instanceId, entry] of [...this.views]) {
      const wc = entry.view.webContents;
      if (entry.hiddenSince === undefined || entry.hiddenSince > cutoff || wc.isDestroyed()) continue;
      if (wc.isCurrentlyAudible() || hasUsedMedia(wc) || entry.def.permissions.includes('notifications')) continue;
      const url = wc.getURL();
      this.sleeping.set(instanceId, { url: isWebUrl(url) ? url : this.homeOf(entry.def), appId: entry.appId });
      this.destroy(instanceId);
    }
  }

  private create(leafId: string, instanceId: string, appId: string, profile: string, wakeUrl?: string): Entry | undefined {
    const def = getApp(appId, this.store.catalog());
    if (!def) return undefined;
    const ses = getAppSession(def, profile, () => this.store.privacyFor(appId));
    this.downloads.attach(ses);

    const view = new WebContentsView({
      webPreferences: {
        session: ses,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
        spellcheck: true,
        // No preload for web apps in Phase 1. Fingerprint shields add one in ROADMAP 3.4.
      },
    });
    const wc = view.webContents;
    wc.setWebRTCIPHandlingPolicy(this.store.privacyFor(appId).webrtcPolicy);
    followSignInUserAgent(wc);
    forwardShortcuts(wc, (action) => {
      if (!this.win.isDestroyed()) this.win.webContents.send(IPC.shortcut, action);
    });
    wc.on('did-create-window', (child) => followSignInUserAgent(child.webContents));
    const entry: Entry = { leafId, profile, appId, def, view };
    this.guardNavigation(def, view);
    this.wireState(entry, instanceId);
    wc.on('context-menu', (_e, params) => this.showContextMenu(entry, params));
    // Ctrl + mouse wheel inside the page; Electron leaves zooming to us. One step per 150 ms: a notch
    // can arrive as several events, and touchpads send bursts.
    let lastWheelZoom = 0;
    wc.on('zoom-changed', (_e, direction) => {
      const now = Date.now();
      if (now - lastWheelZoom < WHEEL_ZOOM_MS) return;
      lastWheelZoom = now;
      this.setZoom(appId, nextZoom(wc.getZoomFactor(), direction));
    });
    // The saved zoom, re-applied on each page load (Chromium may reset it when the page navigates).
    wc.on('did-navigate', () => {
      const saved = this.store.get().zoom[appId] ?? 1;
      if (Math.abs(wc.getZoomFactor() - saved) > 0.001) wc.setZoomFactor(saved);
      entry.emit?.();
    });
    if (def.id.startsWith('custom-') && !def.icon) this.fetchIconOnce(def, wc);

    this.win.contentView.addChildView(view);
    const startUrl = def.kind === 'browser' ? this.pendingUrl.get(leafId) : undefined;
    this.pendingUrl.delete(leafId);
    void wc.loadURL(wakeUrl ?? startUrl ?? this.homeOf(def));
    if (this.pendingFocus === leafId) {
      this.pendingFocus = null;
      wc.focus();
    }

    this.views.set(instanceId, entry);
    return entry;
  }

  /** A custom app's icon: its own favicon, fetched once through its own session (ROADMAP 2.7/4.2). */
  private fetchIconOnce(def: WebAppDef, wc: WebContents): void {
    wc.once('page-favicon-updated', (_e, favicons) => {
      void fetchFavicon(wc.session, favicons).then((icon) => {
        if (icon && !this.win.isDestroyed()) this.win.webContents.send(IPC.appIcon, def.id, icon);
      });
    });
  }

  /** Right-click menu (ROADMAP 2.4). Opened from a real right-click, so the native popup is allowed. */
  private showContextMenu(entry: Entry, params: ContextMenuParams): void {
    if (this.win.isDestroyed()) return;
    const wc = entry.view.webContents;
    const nav = wc.navigationHistory;
    const engine = SEARCH_ENGINES[this.store.get().browser.searchEngine];
    const template = contextMenuTemplate(params, {
      canGoBack: nav.canGoBack(),
      canGoForward: nav.canGoForward(),
      back: () => nav.goBack(),
      forward: () => nav.goForward(),
      reload: () => wc.reload(),
      copyText: (text) => clipboard.writeText(text),
      openInNewTile: (url) => {
        if (!isWebUrl(url) || this.win.isDestroyed()) return;
        const request: OpenInNewTile = { fromLeafId: entry.leafId, url, background: false };
        this.win.webContents.send(IPC.openInNewTile, request);
      },
      openExternal: (url) => {
        if (isWebUrl(url)) void shell.openExternal(url);
      },
      copyImageAt: (x, y) => wc.copyImageAt(x, y),
      replaceMisspelling: (word) => wc.replaceMisspelling(word),
      addToDictionary: (word) => wc.session.addWordToSpellCheckerDictionary(word),
      search: { name: engine.name, url: engine.searchUrl },
      inspect: app.isPackaged ? undefined : (x, y) => wc.inspectElement(x, y),
    });
    Menu.buildFromTemplate(template).popup({ window: this.win });
  }

  private leafOf(wc: WebContents): string | undefined {
    for (const entry of this.views.values()) if (entry.view.webContents === wc) return entry.leafId;
    return undefined;
  }

  /** Recount unread from every view's title; notify only when the total changes. */
  private updateUnread(): void {
    const total = sumUnread([...this.views.values()].map((e) => unreadFromTitle(e.view.webContents.getTitle())));
    const key = JSON.stringify(total);
    if (key === this.lastUnread) return;
    this.lastUnread = key;
    this.onUnreadChange(total);
  }

  private destroy(instanceId: string): void {
    const entry = this.views.get(instanceId);
    if (!entry) return;
    this.views.delete(instanceId);
    if (!this.win.isDestroyed()) this.win.contentView.removeChildView(entry.view);
    if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close();
    this.updateUnread();
  }

  /** Keep each app inside its own sites; everything else opens in the system browser. */
  private guardNavigation(def: WebAppDef, view: WebContentsView): void {
    const wc = view.webContents;
    const isWeb = (url: string): boolean => /^https?:\/\//i.test(url);
    const host = (url: string): string => {
      try {
        return new URL(url).hostname;
      } catch {
        return '';
      }
    };
    const openOutside = (url: string): void => {
      if (isWeb(url)) void shell.openExternal(url);
    };

    wc.on('will-navigate', (e) => {
      if (!isWeb(e.url)) return e.preventDefault();
      if (!hostMatches(host(e.url), def.allowedHosts)) {
        e.preventDefault();
        openOutside(e.url);
      }
    });

    // Sign-in popups. Child inherits this app's session; hardening applies to it too.
    const popup = {
      action: 'allow',
      overrideBrowserWindowOptions: {
        parent: this.win,
        width: 520,
        height: 720,
        autoHideMenuBar: true,
        webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
      } satisfies BrowserWindowConstructorOptions,
    } as const;

    wc.setWindowOpenHandler(({ url, disposition }) => {
      if (!isWeb(url)) return { action: 'deny' };
      if (def.kind === 'browser') {
        // Links asking for a new tab open in a new Browser tile (D-015). Scripted popups
        // (window.open with features, e.g. "Sign in with ...") stay popups so they keep their opener.
        if (disposition === 'new-window') return popup;
        if (disposition === 'foreground-tab' || disposition === 'background-tab') {
          const leafId = this.leafOf(wc);
          if (leafId && !this.win.isDestroyed()) {
            const request: OpenInNewTile = { fromLeafId: leafId, url, background: disposition === 'background-tab' };
            this.win.webContents.send(IPC.openInNewTile, request);
            return { action: 'deny' };
          }
        }
        void wc.loadURL(url);
        return { action: 'deny' };
      }
      if (hostMatches(host(url), def.popupHosts)) return popup;
      if (hostMatches(host(url), def.allowedHosts)) {
        void wc.loadURL(url);
        return { action: 'deny' };
      }
      openOutside(url);
      return { action: 'deny' };
    });
  }

  private wireState(entry: Entry, instanceId: string): void {
    const wc = entry.view.webContents;
    const emit = (crashed = false): void => {
      if (this.win.isDestroyed() || wc.isDestroyed()) return;
      const state: ViewState = {
        instanceId,
        leafId: entry.leafId,
        appId: entry.appId,
        url: wc.getURL(),
        title: wc.getTitle(),
        loading: wc.isLoading(),
        canGoBack: wc.navigationHistory.canGoBack(),
        canGoForward: wc.navigationHistory.canGoForward(),
        crashed,
        zoom: wc.getZoomFactor(),
      };
      this.win.webContents.send(IPC.viewState, state);
    };
    entry.emit = () => emit();
    wc.on('did-start-loading', () => emit());
    wc.on('did-stop-loading', () => emit());
    wc.on('did-navigate', () => emit());
    wc.on('did-navigate-in-page', () => emit());
    wc.on('page-title-updated', () => {
      emit();
      this.updateUnread();
    });
    wc.on('render-process-gone', () => emit(true));
    wc.on('focus', () => {
      // entry.leafId, read now: the view may have moved tiles since it was created.
      if (!this.win.isDestroyed()) this.win.webContents.send(IPC.viewFocused, entry.leafId);
    });
  }
}
