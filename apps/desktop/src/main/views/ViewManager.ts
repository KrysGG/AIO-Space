import {
  app,
  BrowserWindow,
  clipboard,
  Menu,
  screen,
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
  partitionFor,
  computeLayout,
  tileBodyRect,
  type Rect,
  SEARCH_ENGINES,
  sumUnread,
  unreadFromTitle,
  type Unread,
  type WebAppDef,
} from '@aio/core';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { ScreenShare } from './screenShare';
import { IPC, TILE_GUTTER, tileHeaderHeight, VIEW_INSET, VIEW_RADIUS, type ViewFrame, type OpenInNewTile, type ViewCommand, type ViewPlacement, type ViewState } from '../../shared/ipc';
import type { DownloadManager } from '../downloads/DownloadManager';
import type { FilterLists } from '../privacy/filterLists';
import type { ScriptletFiles } from '../privacy/scriptlets';
import type { SharedSignIn } from '../sessions/sharedSignIn';
import type { PluginStore } from '../plugins/pluginStore';
import type { ExtensionHost } from '../extensions/extensionHost';
import { getDomain } from 'tldts';
import { allowHttpThisRun, forgetPage, isFallbackError, isHttpAllowedThisRun, upgradedFrom } from '../privacy/httpsFallback';
import { getAppSession, hasUsedMedia, SIGN_IN_TOKEN } from '../sessions/appSession';
import { fetchFavicon } from './favicon';
import { followSignInUserAgent } from '../sessions/userAgent';
import { forwardShortcuts } from '../shortcuts';
import { contextMenuTemplate } from './contextMenu';
import { navigationDecision, popupNavigationDecision, windowDecision } from './navigationPolicy';
import { isSignInHost, NO_MEDIA, parseMediaReport, webAppArgs, type MediaInUse, type WebAppArgs } from '../../shared/webapp';
import type { WorkspaceStore } from '../store/workspaceStore';

/** Isolated world (not the page's) where main reads class names and ids for cosmetic filtering. */
const COSMETIC_WORLD = 1001;
/** Collects the page's class names, ids and link targets (capped) for generic element-hiding rules. */
const COLLECT_DOM = `(() => {
  const classes = new Set(), ids = new Set(), hrefs = new Set();
  for (const el of document.querySelectorAll('[class],[id],a[href]')) {
    if (classes.size > 4000) break;
    for (const c of el.classList) classes.add(c);
    if (el.id) ids.add(el.id);
    if (el.tagName === 'A' && hrefs.size < 1000) hrefs.add(el.href);
  }
  return { classes: [...classes], ids: [...ids], hrefs: [...hrefs] };
})()`;

/** How often hidden apps are checked for sleeping. */
const SLEEP_CHECK_MS = 30_000;
/** Minimum time between Ctrl+wheel zoom steps. */
const WHEEL_ZOOM_MS = 150;
/** Longest wait for a page snapshot before hiding views (a slow page shows the plain placeholder). */
const SNAPSHOT_TIMEOUT_MS = 150;

/**
 * One SpaceAIO window (ROADMAP 2.15): the main window, or a torn-off one showing a single space. Its
 * UI page tells us where its views go; views move between windows without reloading.
 */
interface Host {
  win: BrowserWindow;
  /** The space a torn-off window shows; null for the main window (its active space). */
  spaceId: string | null;
  placements: ViewPlacement[];
  /** Instances of this UI's other spaces: hidden but kept running (ROADMAP 2.8). */
  keep: string[];
  /** The UI's layout and tile-area margins, for placing views on window resize without waiting for it. */
  frame: ViewFrame | undefined;
  hidden: boolean;
  hideGeneration: number;
  settleTimer?: NodeJS.Timeout;
  uiRepaintTimer?: NodeJS.Timeout;
}

interface Entry {
  /** The window the view is in now. */
  host: Host;
  /** The tile the view currently sits in. Changes when tiles are swapped; the view doesn't. */
  leafId: string;
  /** Account of the app (ROADMAP 2.12); a different account needs a different session, so a new view. */
  profile: string;
  /** When the view was last hidden in another space (ms), or undefined while it's on screen. */
  hiddenSince?: number;
  /** Re-sends this view's state to the UI (set up in wireState). */
  emit?: () => void;
  /** Requests Shields blocked on the current page; reset on each navigation. */
  blocked: number;
  /** Pending throttled state update for the blocked count. */
  blockedTimer?: NodeJS.Timeout;
  /** Microphone, camera, screen share in use (reported by the page-world script) and sound. */
  media: MediaInUse;
  audible: boolean;
  /** What the web app preload was started with (ROADMAP 3.4); a change needs a new view. */
  preloadArgs: WebAppArgs;
  /** The upgraded https:// load failed: view hidden, tile offers http (ROADMAP 3.2). */
  httpsFailed?: { host: string; url: string; error: string };
  /** The user's CSS on the current page (ROADMAP 4.3) and the key to remove it; reset on each new page. */
  userCss?: { css: string; key: Promise<string | undefined> };
  /** Which plugins (id@version) this view's pages run (ROADMAP 4.4); a change reloads the view. */
  plugins: string;
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
  /** Screen sharing for apps with `display-capture` (ROADMAP 2.11). */
  readonly screenShare: ScreenShare;
  /** Keyed by instance id. */
  private readonly views = new Map<string, Entry>();
  /** Every SpaceAIO window by its UI page's id; `main` is the first. */
  private readonly hosts = new Map<number, Host>();
  private readonly main: Host;
  /** Start URL / focus requested for a Browser tile before its view exists (new tiles from links). */
  private readonly pendingUrl = new Map<string, string>();
  /** Slept apps (ROADMAP 2.9): the page they were on, to reload when their space is shown again. */
  private readonly sleeping = new Map<string, { url: string; appId: string }>();
  private pendingFocus: string | null = null;
  private lastUnread = '';
  /** Fingerprint noise key per session partition, new every run (ROADMAP 3.4). */
  private readonly farbleKeys = new Map<string, string>();

  /** Total unread across all views changed (from page titles like "(3) Discord"). */
  onUnreadChange: (unread: Unread) => void = () => {};

  constructor(
    win: BrowserWindow,
    private readonly store: WorkspaceStore,
    private readonly downloads: DownloadManager,
    private readonly filterLists?: FilterLists,
    private readonly scriptlets?: ScriptletFiles,
    private readonly signIn?: SharedSignIn,
    private readonly plugins?: PluginStore,
    private readonly extensions?: ExtensionHost,
  ) {
    this.main = this.addWindow(win, null);
    // The picker shows in the window in use: the page that asks is in it, and the user just clicked.
    this.screenShare = new ScreenShare(() => this.focusedHost().win);
    setInterval(() => this.sleepIdle(), SLEEP_CHECK_MS).unref();
    // Mixed-DPI setups (ROADMAP 6.1): changing a monitor's scale rescales windows without always sending 'resize'.
    screen.on('display-metrics-changed', () => {
      for (const host of this.hosts.values()) this.settleAfterResize(host);
    });
  }

  /** Track a SpaceAIO window; its UI page then syncs its own views (ROADMAP 2.15). */
  addWindow(win: BrowserWindow, spaceId: string | null): Host {
    const host: Host = { win, spaceId, placements: [], keep: [], frame: undefined, hidden: false, hideGeneration: 0 };
    const id = win.webContents.id;
    this.hosts.set(id, host);
    // Wayland/Chromium sometimes leaves a stale, smeared frame on a view after another window is
    // dragged over ours and away again (a compositor damage-tracking quirk, not our layout code).
    // Regaining focus is the reliable moment to force a clean repaint of what's on screen.
    win.on('focus', () => this.invalidateVisible(host));
    // Move views with the window edge as it resizes: main knows the layout, so no round trip to the UI
    // (whose own update arrives a few frames later and then matches).
    win.on('resize', () => {
      if (host.frame) this.syncHost(host, host.placements, host.keep);
      this.settleAfterResize(host);
    });
    // Maximize/restore/fullscreen can land in one jump; on Wayland the first resize event may arrive
    // before the window's new size is committed, leaving stale or torn frames (seen maximizing on a
    // 5120x1440 screen). Once the window has settled: place everything again and force a repaint.
    for (const event of ['maximize', 'unmaximize', 'restore', 'enter-full-screen', 'leave-full-screen'] as const) {
      win.on(event as 'maximize', () => this.settleAfterResize(host));
    }
    // Mixed-DPI setups (ROADMAP 6.1): moving the window onto a monitor with another scale (100% -> 150%)
    // rescales it without always sending 'resize'. Same settle step.
    win.on('moved', () => this.settleAfterResize(host));
    // Its views go to the main window, hidden, until a window places them again (or the UI closes them).
    win.on('close', () => this.orphan(host));
    win.on('closed', () => this.hosts.delete(id));
    return host;
  }

  /** The SpaceAIO window whose UI page this is; undefined for anything else (IPC trust check). */
  hostOf(sender: WebContents): Host | undefined {
    return this.hosts.get(sender.id);
  }

  /** Every SpaceAIO window, the main one first. */
  windows(): Host[] {
    return [...this.hosts.values()];
  }

  private focusedHost(): Host {
    return this.windows().find((h) => !h.win.isDestroyed() && h.win.isFocused()) ?? this.main;
  }

  /** A closing torn-off window's views wait, hidden, in the main window: its next layout keeps or closes them. */
  private orphan(host: Host): void {
    if (host === this.main) return;
    for (const entry of this.views.values()) {
      if (entry.host !== host) continue;
      host.win.contentView.removeChildView(entry.view);
      entry.view.setVisible(false);
      entry.hiddenSince ??= Date.now();
      entry.host = this.main;
      if (!this.main.win.isDestroyed()) this.main.win.contentView.addChildView(entry.view);
    }
  }

  /** After the last resize event (150 ms of quiet): re-place views and repaint them and the UI. */
  private settleAfterResize(host: Host): void {
    clearTimeout(host.settleTimer);
    host.settleTimer = setTimeout(() => {
      if (host.win.isDestroyed()) return;
      if (host.frame) this.syncHost(host, host.placements, host.keep);
      this.invalidateVisible(host);
      host.win.webContents.invalidate();
    }, 150);
  }

  /** View bounds per tile for the current window size, from the UI's layout and margins. */
  private boundsFromFrame(host: Host, frame: ViewFrame): Map<string, Rect> {
    const { width, height } = host.win.getContentBounds();
    const { left, top, right, bottom } = frame.insets;
    const area = { x: 0, y: 0, width: Math.max(0, width - left - right), height: Math.max(0, height - top - bottom) };
    const out = new Map<string, Rect>();
    for (const t of computeLayout(frame.layout, area, TILE_GUTTER).tiles) {
      const body = tileBodyRect(t.rect, tileHeaderHeight(t.tabs), VIEW_INSET);
      out.set(t.leafId, { x: Math.round(body.x + left), y: Math.round(body.y + top), width: body.width, height: body.height });
    }
    return out;
  }

  /**
   * Repaint the whole UI page shortly after a page's state changed (D-049). On Wayland, parts of the
   * UI next to a view (a tile's header and address bar) were sometimes left blank until something
   * inside them changed: only the redrawn bits came back (seen on a 5120x1440 screen). A full
   * repaint once things go quiet brings the rest back; it redraws, it doesn't re-render React.
   */
  private repaintUiSoon(host: Host): void {
    clearTimeout(host.uiRepaintTimer);
    host.uiRepaintTimer = setTimeout(() => {
      if (!host.win.isDestroyed()) host.win.webContents.invalidate();
    }, 250);
  }

  /** Force every currently-visible view to repaint (see the focus handler above). */
  private invalidateVisible(host: Host): void {
    for (const entry of this.views.values()) {
      if (entry.host !== host || !entry.view.getVisible() || entry.view.webContents.isDestroyed()) continue;
      entry.view.webContents.invalidate();
    }
  }

  /**
   * Show the active space's views at their placements; hide (but keep running) the views listed in
   * `keep`, which belong to other spaces (ROADMAP 2.8); destroy everything else. Views for `keep`
   * apps that aren't running yet are only created once their space is shown.
   */
  sync(sender: WebContents, placements: ViewPlacement[], keep: string[], frame?: ViewFrame): void {
    const host = this.hostOf(sender);
    if (host) this.syncHost(host, placements, keep, frame);
  }

  /**
   * One window's views. Views another window shows are left alone, unless this window now places
   * them: then they move here, page and all (a tile dragged between windows, ROADMAP 2.15).
   */
  private syncHost(host: Host, placements: ViewPlacement[], keep: string[] = host.keep, frame: ViewFrame | undefined = host.frame): void {
    host.placements = placements;
    host.keep = keep;
    host.frame = frame;
    if (host.win.isDestroyed()) return;
    // Positions for the window as it is now (the UI measured it a moment ago, possibly smaller or larger).
    const current = frame ? this.boundsFromFrame(host, frame) : undefined;
    const shown = new Set(placements.map((p) => p.instanceId));
    const kept = new Set(keep);
    for (const [instanceId, entry] of [...this.views]) {
      if (entry.host !== host && !shown.has(instanceId)) continue;
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
      if (entry && entry.host !== host) this.move(entry, host);
      entry ??= this.create(host, p.leafId, p.instanceId, p.appId, p.profile, this.wake(p.instanceId, p.appId), p.url);
      if (!entry) continue;
      entry.leafId = p.leafId;
      entry.view.setBounds(current?.get(p.leafId) ?? p.bounds);
      entry.view.setVisible(!host.hidden && !entry.httpsFailed);
    }
  }

  /** Move a view into another window; the page keeps running (no reload). */
  private move(entry: Entry, to: Host): void {
    if (!entry.host.win.isDestroyed()) entry.host.win.contentView.removeChildView(entry.view);
    entry.host = to;
    to.win.contentView.addChildView(entry.view);
    entry.emit?.(); // the new window's UI learns its title, loading state and so on
  }

  /**
   * Re-apply the last placements, e.g. after the workspace (and so the app catalog) was saved: a
   * custom app added a moment ago may have been placed before main knew about it.
   */
  refresh(): void {
    for (const host of this.hosts.values()) this.syncHost(host, host.placements);
  }

  /** The view on screen in a tile (a Browser tile's other tabs share its leaf id but stay hidden). */
  private byLeaf(leafId: string): Entry | undefined {
    const placed = this.windows().flatMap((h) => h.placements).find((p) => p.leafId === leafId);
    if (placed) return this.views.get(placed.instanceId);
    for (const entry of this.views.values()) if (entry.leafId === leafId && entry.hiddenSince === undefined) return entry;
    return undefined;
  }

  /**
   * Hide or show the active space's views (drags, popovers). Before hiding, each page is captured and
   * the snapshots go to the UI, which shows them in the tiles so the layout doesn't flash empty
   * (ROADMAP 2.13). A show that arrives while snapshots are being taken cancels the pending hide.
   */
  setHidden(sender: WebContents, hidden: boolean): void {
    const host = this.hostOf(sender);
    if (!host) return;
    const generation = ++host.hideGeneration;
    if (!hidden) {
      host.hidden = false;
      this.applyVisibility(host);
      if (!host.win.isDestroyed()) host.win.webContents.send(IPC.viewsSnapshots, {}); // views are back on top
      return;
    }
    // "Reduce animations and effects": no snapshots (they cost a capture and encode per page).
    const shots = this.store.get().ui.reduceMotion ? this.sendNoSnapshots(host) : this.snapshot(host);
    void shots.then(() => {
      if (generation !== host.hideGeneration) return; // shown again meanwhile
      host.hidden = true;
      this.applyVisibility(host);
    });
  }

  private applyVisibility(host: Host): void {
    const shown = new Set(host.placements.map((p) => p.instanceId));
    for (const [instanceId, { view, httpsFailed }] of this.views) {
      if (!shown.has(instanceId)) continue; // other spaces' views stay hidden
      view.setVisible(!host.hidden && !httpsFailed);
      // A static page may not paint for seconds after being shown again; until it does, the Wayland
      // compositor can show its old frame in the wrong place (torn strips after a divider drag).
      if (!host.hidden) view.webContents.invalidate();
    }
  }

  private async sendNoSnapshots(host: Host): Promise<void> {
    if (!host.win.isDestroyed()) host.win.webContents.send(IPC.viewsSnapshots, {});
  }

  /** JPEG snapshots of the visible views, keyed by instance id; a slow page is simply skipped. */
  private async snapshot(host: Host): Promise<void> {
    const shown = new Set(host.placements.map((p) => p.instanceId));
    const shots: Record<string, string> = {};
    await Promise.all(
      [...this.views]
        .filter(([id, e]) => shown.has(id) && !e.view.webContents.isDestroyed())
        .map(async ([id, e]) => {
          const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), SNAPSHOT_TIMEOUT_MS));
          const image = await Promise.race([e.view.webContents.capturePage().catch(() => null), timeout]);
          if (!image || image.isEmpty()) return;
          const { width } = e.view.getBounds();
          shots[id] = `data:image/jpeg;base64,${image.resize({ width: Math.max(1, width) }).toJPEG(72).toString('base64')}`;
        }),
    );
    if (!host.win.isDestroyed()) host.win.webContents.send(IPC.viewsSnapshots, shots);
  }

  /** Keyboard focus to a tile's view; the UI page when the tile is empty or `leafId` is null. */
  focus(sender: WebContents, leafId: string | null): void {
    const host = this.hostOf(sender);
    if (!host || host.win.isDestroyed()) return;
    // Only views on screen (this window's space) can take focus.
    const entry = leafId && host.placements.some((p) => p.leafId === leafId) ? this.byLeaf(leafId) : undefined;
    // A tile whose view is about to be created (pending URL) gets focus once it exists.
    this.pendingFocus = !entry && leafId && this.pendingUrl.has(leafId) ? leafId : null;
    if (entry && !host.hidden) entry.view.webContents.focus();
    else host.win.webContents.focus();
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
    if (cmd === 'allow-http') {
      // "Continue with HTTP": remember the site for this run (the UI saves it for good), load http://.
      if (!entry.httpsFailed) return;
      allowHttpThisRun(entry.httpsFailed.host);
      void wc.loadURL(entry.httpsFailed.url);
      return;
    }
    if (cmd === 'back' && entry.httpsFailed && !nav.canGoBack()) void wc.loadURL(this.homeOf(entry.def));
    else if (cmd === 'back' && nav.canGoBack()) nav.goBack();
    else if (cmd === 'forward' && nav.canGoForward()) nav.goForward();
    else if (cmd === 'reload') wc.reload();
    else if (cmd === 'home') void wc.loadURL(this.homeOf(entry.def));
    else if (cmd === 'zoom-in') this.setZoom(entry, nextZoom(wc.getZoomFactor(), 'in'));
    else if (cmd === 'zoom-out') this.setZoom(entry, nextZoom(wc.getZoomFactor(), 'out'));
    else if (cmd === 'zoom-reset') this.setZoom(entry, 1);
  }

  /**
   * Zoom is per app (ROADMAP 2.10): every view of the app gets the factor and reports it, and the UI
   * saves it in workspace.zoom, which is applied again whenever a page of that app loads.
   */
  private setZoom(from: Entry, factor: number): void {
    for (const entry of this.views.values()) {
      if (entry.appId !== from.appId || entry.view.webContents.isDestroyed()) continue;
      entry.view.webContents.setZoomFactor(factor);
      entry.emit?.();
    }
    if (!from.host.win.isDestroyed()) from.host.win.webContents.send(IPC.appZoom, from.appId, factor);
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
      const capturing = entry.media.mic || entry.media.camera || entry.media.screen;
      if (wc.isCurrentlyAudible() || capturing || hasUsedMedia(wc) || entry.def.permissions.includes('notifications')) continue;
      const url = wc.getURL();
      this.sleeping.set(instanceId, { url: isWebUrl(url) ? url : this.homeOf(entry.def), appId: entry.appId });
      this.destroy(instanceId);
    }
  }

  private create(host: Host, leafId: string, instanceId: string, appId: string, profile: string, wakeUrl?: string, tabUrl?: string): Entry | undefined {
    const def = getApp(appId, this.store.catalog());
    if (!def) return undefined;
    const ses = getAppSession(
      def,
      profile,
      () => this.store.privacyFor(appId),
      (id) => this.countBlocked(id),
      // An allowed site covers its subdomains (http-only sites like neverssl.com hop between them).
      (host) => hostMatches(host, this.store.get().httpAllowedHosts) || isHttpAllowedThisRun(host),
      this.filterLists,
      this.scriptlets,
      this.signIn,
    );
    this.downloads.attach(ses);
    if (def.permissions.includes('display-capture')) this.screenShare.attach(ses, def.name);

    const preloadArgs = this.preloadArgsFor(appId, profile);
    const view = new WebContentsView({
      webPreferences: {
        session: ses,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
        spellcheck: true,
        // Fingerprinting protection only (ROADMAP 3.4): no IPC, nothing exposed to the page.
        preload: join(__dirname, '../preload/webapp.js'),
        additionalArguments: webAppArgs(preloadArgs),
      },
    });
    // Rounded like the tile body it sits in; native views are otherwise square and poke past it.
    view.setBorderRadius(VIEW_RADIUS);
    const wc = view.webContents;
    // Chrome extensions this app has on (ROADMAP 4.5): loaded into its session the first time; a page
    // that started loading before they were ready loads again with them.
    void this.extensions?.attach(appId, partitionFor(appId, profile), ses).then((loaded) => {
      if (loaded && !wc.isDestroyed()) wc.reload();
    });
    wc.setWebRTCIPHandlingPolicy(this.store.privacyFor(appId).webrtcPolicy);
    followSignInUserAgent(wc, SIGN_IN_TOKEN);
    wc.on('did-create-window', (child) => followSignInUserAgent(child.webContents, SIGN_IN_TOKEN));
    const entry: Entry = { host, leafId, profile, appId, def, view, blocked: 0, preloadArgs, media: NO_MEDIA, audible: false, plugins: this.pluginsKey(appId) };
    // Shortcuts, state and menus go to the window the view is in now (it can move, ROADMAP 2.15).
    forwardShortcuts(wc, (action) => {
      if (!entry.host.win.isDestroyed()) entry.host.win.webContents.send(IPC.shortcut, action);
    });
    this.guardNavigation(entry);
    this.wireState(entry, instanceId);
    wc.on('context-menu', (_e, params) => this.showContextMenu(entry, params));
    // Ctrl + mouse wheel inside the page; Electron leaves zooming to us. One step per 150 ms: a notch
    // can arrive as several events, and touchpads send bursts.
    let lastWheelZoom = 0;
    wc.on('zoom-changed', (_e, direction) => {
      const now = Date.now();
      if (now - lastWheelZoom < WHEEL_ZOOM_MS) return;
      lastWheelZoom = now;
      this.setZoom(entry, nextZoom(wc.getZoomFactor(), direction));
    });
    // The saved zoom, re-applied on each page load (Chromium may reset it when the page navigates).
    wc.on('did-navigate', () => {
      const saved = this.store.get().zoom[appId] ?? 1;
      if (Math.abs(wc.getZoomFactor() - saved) > 0.001) wc.setZoomFactor(saved);
      entry.emit?.();
    });
    wc.on('dom-ready', () => {
      entry.userCss = undefined; // a new document: the last page's stylesheet went with it
      this.applyUserCss(entry);
      void this.runPlugins(entry);
      void this.hideAds(appId, wc, true);
    });
    wc.on('did-finish-load', () => void this.hideAds(appId, wc, false));
    if (def.id.startsWith('custom-') && !def.icon) this.fetchIconOnce(entry);

    host.win.contentView.addChildView(view);
    // Browser tiles: a link's address sent before the view existed, else the tab's saved page (D-049).
    const startUrl = def.kind === 'browser' ? (this.pendingUrl.get(leafId) ?? tabUrl) : undefined;
    this.pendingUrl.delete(leafId);
    void wc.loadURL(wakeUrl ?? startUrl ?? this.homeOf(def));
    if (this.pendingFocus === leafId) {
      this.pendingFocus = null;
      wc.focus();
    }

    this.views.set(instanceId, entry);
    return entry;
  }

  /**
   * Cosmetic filtering (ROADMAP 3.6): the ad list's element-hiding rules as a user stylesheet, so
   * emptied ad slots don't leave gaps. On DOM ready: the site's own rules and the generic base rules;
   * then (and again when loading finishes) generic rules for the class names and ids on the page,
   * read in an isolated world the page can't see. Main frame only; scriptlet rules (uBlock's `+js()`,
   * which YouTube ad blocking relies on) are not run.
   */
  private async hideAds(appId: string, wc: WebContents, first: boolean): Promise<void> {
    const engine = this.filterLists?.engine('ads');
    if (!engine || wc.isDestroyed() || !this.store.privacyFor(appId).blockAds) return;
    let url: URL;
    try {
      url = new URL(wc.getURL());
    } catch {
      return;
    }
    if (!isWebUrl(url.href)) return;
    let dom: { classes: string[]; ids: string[]; hrefs: string[] } = { classes: [], ids: [], hrefs: [] };
    try {
      dom = await wc.executeJavaScriptInIsolatedWorld(COSMETIC_WORLD, [{ code: COLLECT_DOM }]);
    } catch {
      // The page is gone or refuses scripts: its own and the base rules still apply.
    }
    if (wc.isDestroyed() || wc.getURL() !== url.href) return;
    const { styles } = engine.getCosmeticsFilters({
      url: url.href,
      hostname: url.hostname,
      domain: getDomain(url.hostname) ?? url.hostname,
      ...dom,
      getBaseRules: first,
      getRulesFromHostname: first,
      getRulesFromDOM: true,
      getInjectionRules: false,
      getExtendedRules: false,
    });
    if (styles) await wc.insertCSS(styles, { cssOrigin: 'user' }).catch(() => {});
  }

  /** Re-apply every view's custom CSS after a settings change (live preview while editing, on/off). */
  applyAppCss(): void {
    for (const entry of this.views.values()) this.applyUserCss(entry);
  }

  /**
   * The user's CSS for this app (ROADMAP 4.3). Injected sheets come before the page's own, so plain
   * rules lose to the site's and `!important` ones win. Author origin on purpose: Electron can't
   * remove a user-origin sheet (removeInsertedCSS is a silent no-op for it), and this one is replaced
   * on every edit and removed when turned off.
   */
  private applyUserCss(entry: Entry): void {
    const wc = entry.view.webContents;
    const setting = this.store.get().appCss[entry.appId];
    const want = setting?.enabled ? setting.css.trim() : '';
    if (wc.isDestroyed() || want === (entry.userCss?.css ?? '')) return;
    const old = entry.userCss;
    entry.userCss = want ? { css: want, key: wc.insertCSS(want).catch(() => undefined) } : undefined;
    void old?.key.then((key) => {
      if (key && !wc.isDestroyed()) void wc.removeInsertedCSS(key).catch(() => {});
    });
  }

  private pluginsKey(appId: string): string {
    return (this.plugins?.forApp(appId, this.store.get().enabledPlugins) ?? []).map((p) => `${p.manifest.id}@${p.manifest.version}`).join(',');
  }

  /**
   * Plugins turned on or off, installed, updated or removed: reload the views of apps whose set of
   * plugins changed (a script that already ran can't be taken back out of a page).
   */
  applyPlugins(): void {
    for (const entry of this.views.values()) {
      const want = this.pluginsKey(entry.appId);
      if (want === entry.plugins) continue;
      entry.plugins = want;
      if (!entry.view.webContents.isDestroyed()) entry.view.webContents.reload();
    }
  }

  /**
   * Enabled plugins for this app (ROADMAP 4.4), on each new page: styles as injected stylesheets,
   * scripts in the plugin's own isolated world (the page can't see it, other plugins can't either;
   * no Node, no IPC). Only on the app's own sites, never on sign-in providers' pages (D-046).
   */
  private async runPlugins(entry: Entry): Promise<void> {
    const wc = entry.view.webContents;
    const plugins = this.plugins?.forApp(entry.appId, this.store.get().enabledPlugins) ?? [];
    if (plugins.length === 0 || wc.isDestroyed()) return;
    let host: string;
    try {
      host = new URL(wc.getURL()).hostname;
    } catch {
      return;
    }
    if (!isWebUrl(wc.getURL()) || isSignInHost(host) || !hostMatches(host, entry.def.allowedHosts)) return;
    for (const p of plugins) {
      for (const css of p.styles) void wc.insertCSS(css).catch(() => {});
      if (p.scripts.length === 0) continue;
      await wc
        .executeJavaScriptInIsolatedWorld(p.world, p.scripts.map((code) => ({ code })))
        .catch((err: unknown) => console.warn(`[plugins] ${p.manifest.id} failed on ${host}:`, err instanceof Error ? err.message : err));
    }
  }

  /** Extensions turned on or off for an app (ROADMAP 4.5): load or unload them, and reload that app's pages. */
  applyExtensions(): void {
    void this.extensions?.sync().then((apps) => this.reloadApps(apps));
  }

  /** An extension was reinstalled: reload it and the pages of apps that run it. */
  reloadExtension(id: string): void {
    void this.extensions?.reloadExtension(id).then((apps) => this.reloadApps(apps));
  }

  private reloadApps(apps: Set<string>): void {
    for (const entry of this.views.values()) if (apps.has(entry.appId) && !entry.view.webContents.isDestroyed()) entry.view.webContents.reload();
  }

  /** An extension's popup or options page, for the app in a tile. */
  openExtensionPage(leafId: string, extensionId: string, kind: 'popup' | 'options'): void {
    const entry = this.byLeaf(leafId);
    if (entry) this.extensions?.openPage(partitionFor(entry.appId, entry.profile), extensionId, kind);
  }

  /** A custom app's icon: its own favicon, fetched once through its own session (ROADMAP 2.7/4.2). */
  private fetchIconOnce(entry: Entry): void {
    const wc = entry.view.webContents;
    wc.once('page-favicon-updated', (_e, favicons) => {
      void fetchFavicon(wc.session, favicons).then((icon) => {
        if (icon && !entry.host.win.isDestroyed()) entry.host.win.webContents.send(IPC.appIcon, entry.def.id, icon);
      });
    });
  }

  /** Right-click menu (ROADMAP 2.4). Opened from a real right-click, so the native popup is allowed. */
  private showContextMenu(entry: Entry, params: ContextMenuParams): void {
    const win = entry.host.win;
    if (win.isDestroyed()) return;
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
        if (!isWebUrl(url) || win.isDestroyed()) return;
        const request: OpenInNewTile = { fromLeafId: entry.leafId, url, background: false };
        win.webContents.send(IPC.openInNewTile, request);
      },
      // Browser pages only (D-049): a new tab in the same tile, opened behind the current one.
      ...(entry.def.kind === 'browser'
        ? {
            openInNewTab: (url: string) => {
              if (!isWebUrl(url) || win.isDestroyed()) return;
              const request: OpenInNewTile = { fromLeafId: entry.leafId, url, background: true, tab: true };
              win.webContents.send(IPC.openInNewTile, request);
            },
          }
        : {}),
      openExternal: (url) => {
        if (isWebUrl(url)) void shell.openExternal(url);
      },
      copyImageAt: (x, y) => wc.copyImageAt(x, y),
      replaceMisspelling: (word) => wc.replaceMisspelling(word),
      addToDictionary: (word) => wc.session.addWordToSpellCheckerDictionary(word),
      search: { name: engine.name, url: engine.searchUrl },
      inspect: app.isPackaged ? undefined : (x, y) => wc.inspectElement(x, y),
    });
    Menu.buildFromTemplate(template).popup({ window: win });
  }

  /** A request from this page was blocked: count it, and tell the UI at most every 250 ms. */
  private countBlocked(webContentsId: number): void {
    for (const entry of this.views.values()) {
      if (entry.view.webContents.id !== webContentsId) continue;
      entry.blocked++;
      entry.blockedTimer ??= setTimeout(() => {
        entry.blockedTimer = undefined;
        entry.emit?.();
      }, 250);
      return;
    }
  }

  private lastShareGoogle: boolean | undefined;

  /** "Share Google sign-in" was just turned on (D-045): open apps pool their Google sign-in. */
  private applySharedSignIn(): void {
    const on = this.store.get().identity.shareGoogle;
    const turnedOn = this.lastShareGoogle === false && on;
    this.lastShareGoogle = on;
    if (!turnedOn || !this.signIn) return;
    void this.signIn.enable().then(() => {
      // Pages that were signed out pick up the shared sign-in.
      for (const entry of this.views.values()) {
        if (entry.profile === 'default' && !entry.view.webContents.isDestroyed()) entry.view.webContents.reload();
      }
    });
  }

  private lastTwitchScript: string | undefined;

  /** The Twitch ad script changed (D-043): rebuild the scriptlet files, reload pages on twitch.tv. */
  private applyTwitchScript(): void {
    const choice = this.store.get().twitch.adScript;
    if (this.lastTwitchScript === undefined || this.lastTwitchScript === choice) {
      this.lastTwitchScript = choice;
      return;
    }
    this.lastTwitchScript = choice;
    this.scriptlets?.refresh();
    for (const entry of this.views.values()) {
      const wc = entry.view.webContents;
      if (wc.isDestroyed()) continue;
      try {
        if (hostMatches(new URL(wc.getURL()).hostname, ['twitch.tv'])) wc.reload();
      } catch {
        // No page yet.
      }
    }
  }

  private preloadArgsFor(appId: string, profile: string): WebAppArgs {
    const privacy = this.store.privacyFor(appId);
    const partition = `${appId}/${profile}`;
    let key = this.farbleKeys.get(partition);
    if (!key) {
      key = randomBytes(16).toString('hex');
      this.farbleKeys.set(partition, key);
    }
    return { fingerprinting: privacy.fingerprinting, gpc: privacy.globalPrivacyControl, ads: privacy.blockAds, key };
  }

  /**
   * After settings are saved: an app whose WebRTC policy changed gets it, and its pages reload
   * (the policy only fully applies to new connections). A changed fingerprinting or GPC setting is
   * fixed into the view's preload, so that view is replaced, reopening the page it was on.
   * Other Shields settings apply per request.
   */
  applyPrivacy(): void {
    this.applyTwitchScript();
    this.applySharedSignIn();
    let replaced = false;
    for (const [instanceId, entry] of [...this.views]) {
      const wc = entry.view.webContents;
      if (wc.isDestroyed()) continue;
      const want = this.preloadArgsFor(entry.appId, entry.profile);
      if (want.fingerprinting !== entry.preloadArgs.fingerprinting || want.gpc !== entry.preloadArgs.gpc || want.ads !== entry.preloadArgs.ads) {
        const url = wc.getURL();
        this.sleeping.set(instanceId, { url: isWebUrl(url) ? url : this.homeOf(entry.def), appId: entry.appId });
        this.destroy(instanceId);
        replaced = true;
        continue;
      }
      const policy = this.store.privacyFor(entry.appId).webrtcPolicy;
      if (wc.getWebRTCIPHandlingPolicy() === policy) continue;
      wc.setWebRTCIPHandlingPolicy(policy);
      wc.reload();
    }
    if (replaced) this.refresh();
  }

  /** After an app's data was cleared (ROADMAP 3.9): its open views start over at the app's home page. */
  restartPartitions(partitions: Set<string>): void {
    for (const entry of this.views.values()) {
      const wc = entry.view.webContents;
      if (wc.isDestroyed() || !partitions.has(partitionFor(entry.appId, entry.profile))) continue;
      void wc.loadURL(this.homeOf(entry.def));
    }
    // Slept apps of these partitions wake at their home page, not the page they were on. (Sleeping
    // entries don't record the account, so any account of a cleared app forgets its page.)
    const appIds = new Set([...partitions].map((p) => p.replace(/^persist:app-/, '')));
    for (const [instanceId, slept] of [...this.sleeping]) {
      if ([...appIds].some((a) => a.startsWith(`${slept.appId}-`))) this.sleeping.delete(instanceId);
    }
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
    if (!entry.host.win.isDestroyed()) entry.host.win.contentView.removeChildView(entry.view);
    if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close();
    this.updateUnread();
  }

  /** Keep each app inside its own sites (sign-in pages included, D-044); other links open in a Browser tile. */
  private guardNavigation(entry: Entry): void {
    const { def } = entry;
    const wc = entry.view.webContents;
    const openOutside = (url: string): void => {
      if (!isWebUrl(url)) return;
      // The UI puts it in the space's Browser tile, or a new one beside this app (D-065).
      if (!entry.host.win.isDestroyed()) {
        const request: OpenInNewTile = { fromLeafId: entry.leafId, url, background: false, external: true };
        entry.host.win.webContents.send(IPC.openInNewTile, request);
      } else void shell.openExternal(url);
    };

    wc.on('will-navigate', (e) => {
      const decision = navigationDecision(def, e.url);
      if (decision === 'allow') return;
      e.preventDefault();
      if (decision === 'external') openOutside(e.url);
    });

    // Sign-in popups, over the window the app is in. Child inherits this app's session; hardening applies to it too.
    const popup = () =>
      ({
        action: 'allow',
        overrideBrowserWindowOptions: {
          parent: entry.host.win,
          width: 520,
          height: 720,
          autoHideMenuBar: true,
          webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
        } satisfies BrowserWindowConstructorOptions,
      }) as const;

    wc.setWindowOpenHandler(({ url, disposition }) => {
      switch (windowDecision(def, url, disposition)) {
        case 'popup':
          return popup();
        case 'new-tile': {
          if (!entry.host.win.isDestroyed()) {
            // Browser links asking for a new tab become tabs of the same tile (D-049).
            const request: OpenInNewTile = { fromLeafId: entry.leafId, url, background: disposition === 'background-tab', tab: def.kind === 'browser' };
            entry.host.win.webContents.send(IPC.openInNewTile, request);
          } else void wc.loadURL(url);
          return { action: 'deny' };
        }
        case 'same-tile':
          void wc.loadURL(url);
          return { action: 'deny' };
        case 'external':
          openOutside(url);
          return { action: 'deny' };
        default:
          return { action: 'deny' };
      }
    });

    // Inside a popup: web pages only, and no further windows (the login stays in this one window).
    wc.on('did-create-window', (child) => {
      child.webContents.on('will-navigate', (e) => {
        if (popupNavigationDecision(e.url) !== 'allow') e.preventDefault();
      });
      child.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    });
  }

  private wireState(entry: Entry, instanceId: string): void {
    const wc = entry.view.webContents;
    const emit = (crashed = false): void => {
      const win = entry.host.win;
      if (win.isDestroyed() || wc.isDestroyed()) return;
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
        blocked: entry.blocked,
        media: entry.media,
        audible: entry.audible,
        ...(entry.httpsFailed ? { httpsFailed: entry.httpsFailed } : {}),
      };
      win.webContents.send(IPC.viewState, state);
      this.repaintUiSoon(entry.host);
    };
    entry.emit = () => emit();
    wc.on('did-start-loading', () => emit());
    wc.on('did-stop-loading', () => emit());
    // HTTPS fallback (ROADMAP 3.2): an upgraded page that can't connect securely gets the tile's
    // "continue over http" panel instead of a broken page. Any new navigation clears it.
    wc.on('did-fail-load', (_e, code, description, url, isMainFrame) => {
      if (!isMainFrame || !isFallbackError(code)) return;
      const http = upgradedFrom(wc.id, url);
      if (!http) return;
      entry.httpsFailed = { host: new URL(http).hostname, url: http, error: description };
      this.applyVisibility(entry.host);
      emit();
    });
    wc.on('did-start-navigation', (d) => {
      if (!d.isMainFrame || d.isSameDocument || !entry.httpsFailed) return;
      entry.httpsFailed = undefined;
      this.applyVisibility(entry.host);
      emit();
    });
    const wcId = wc.id;
    wc.on('destroyed', () => forgetPage(wcId));
    // A new page starts a new blocked count (same-document navigations keep it). Reset when the
    // navigation starts: 'did-navigate' can arrive after the new page's first requests were blocked.
    wc.on('did-start-navigation', (d) => {
      if (!d.isMainFrame || d.isSameDocument) return;
      entry.blocked = 0;
      emit();
    });
    // A committed new document starts with nothing captured (the old page's tracks ended with it).
    // Not at navigation start: a download link clicked during a call must not hide the mic dot.
    wc.on('did-navigate', () => {
      entry.media = NO_MEDIA;
      emit();
    });
    // Privacy dots: the page-world script reports mic/camera/screen tracks, tagged with this view's
    // secret key; anything else on the console (or without the key) is ignored.
    wc.on('console-message', (e) => {
      const media = parseMediaReport(e.message, entry.preloadArgs.key);
      if (!media) return;
      entry.media = media;
      emit();
    });
    wc.on('audio-state-changed', (e) => {
      entry.audible = e.audible;
      emit();
    });
    wc.on('did-navigate', () => emit());
    wc.on('did-navigate-in-page', () => emit());
    wc.on('page-title-updated', () => {
      emit();
      this.updateUnread();
    });
    wc.on('render-process-gone', () => emit(true));
    wc.on('focus', () => {
      // entry.leafId, read now: the view may have moved tiles since it was created.
      if (!entry.host.win.isDestroyed()) entry.host.win.webContents.send(IPC.viewFocused, entry.leafId);
    });
  }
}
