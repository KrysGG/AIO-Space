import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  activeSpace,
  addProfile,
  allowHttpHost,
  addSpace,
  addSpaceFromTemplate,
  removeTemplate,
  saveTemplate,
  addressToUrl,
  addTab,
  assignApp,
  closeTab,
  forgetTabPages,
  hiddenTabsOf,
  instancesOf,
  isWebUrl,
  moveTabToNewTile,
  selectTab,
  setTabInfo,
  tabsOf,
  catalogOf,
  computeLayout,
  disallowHttpHost,
  dismissNotice,
  moveInRail,
  railApps,
  setHiddenInRail,
  setPinnedInRail,
  placeInRail,
  appFromStore,
  setForgetOnClose,
  setAppCss,
  setPluginEnabled,
  setExtensionEnabled,
  forgetExtension,
  ensureFocus,
  findLeaf,
  listLeaves,
  MAX_TILES,
  neighborTile,
  profilesOf,
  removeProfile,
  renameProfile,
  removeLeaf,
  removeSpace,
  resolvePrivacy,
  resolveTheme,
  renameSpace,
  setPrivacyOverride,
  setProfile,
  setRatio,
  splitLeaf,
  sumUnread,
  swapApps,
  switchSpace,
  unreadFromTitle,
  updateActiveSpace,
  urlAfterEngineSwitch,
  type PrivacySettings,
  type SearchEngineId,
  type LayoutNode,
  type Space,
  type SplitDirection,
  type Unread,
  type WebAppDef,
  type Workspace,
} from '@aio/core';
import type { DownloadInfo, ExtensionInfo, OpenInNewTile, ScreenShareRequest, ShortcutAction, UpdateStatus, ViewState } from '../../shared/ipc';
import { AddAppDialog } from './components/AddAppDialog';
import { AppStore } from './components/AppStore';
import { CssEditor } from './components/CssEditor';
import { ExtensionsPanel } from './components/ExtensionsPanel';
import { RailMenu } from './components/RailMenu';
import { TabMenu } from './components/TabMenu';
import { tabLabel } from './components/TabStrip';
import { anyMedia, mergeMedia } from './components/MediaIndicators';
import type { MediaInUse } from '../../shared/webapp';
import { DownloadsPanel } from './components/DownloadsPanel';
import { MenuPanel } from './components/MenuPanel';
import { ShieldsPanel } from './components/ShieldsPanel';
import { SharePicker } from './components/SharePicker';
import { ShortcutsHelp } from './components/ShortcutsHelp';
import { Sidebar } from './components/Sidebar';
import { TileLayout, type DropZone } from './components/TileLayout';
import { applyTheme, useSystemDark } from './theme';

const SAVE_DELAY_MS = 300;
/** Any area works for finding neighbours: only the relative position of tiles matters. */
const UNIT_AREA = { x: 0, y: 0, width: 1000, height: 1000 };

/** Matches --rail-ms in styles.css. */
const RAIL_ANIMATION_MS = 220;
/** Longest wait for page snapshots before the rail moves anyway (main gives up on a page at 150 ms). */
const SNAPSHOT_WAIT_MS = 250;
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const nextFrame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));
const activeSpaceHasApps = (ws: Workspace): boolean => listLeaves(activeSpace(ws).layout).some((l) => l.appId !== null);
/** Longest tab title kept in the workspace (the schema's limit). */
const MAX_TAB_TITLE = 300;

/** Every space's layout through `fn`; the same workspace when nothing changed (no re-render, no save). */
function mapLayouts(ws: Workspace, fn: (layout: LayoutNode) => LayoutNode): Workspace {
  let changed = false;
  const spaces = ws.spaces.map((s) => {
    const layout = fn(s.layout);
    if (layout === s.layout) return s;
    changed = true;
    return { ...s, layout };
  });
  return changed ? { ...ws, spaces } : ws;
}

/** Put the keyboard in a tile's address bar (after the next render, once it's there). */
function focusAddress(leafId: string): void {
  requestAnimationFrame(() => {
    const input = document.querySelector<HTMLInputElement>(`[data-address-for="${leafId}"]`);
    if (!input) return;
    window.aio.focusView(null);
    input.focus();
  });
}

/** Browser tab actions on the active space (D-049), for the tab strip, its menu, shortcuts and links. */
function tabActions(ws: Workspace, edit: (fn: (w: Workspace) => Workspace) => void) {
  const layout = activeSpace(ws).layout;
  const canAddTile = listLeaves(layout).length < MAX_TILES;
  const onSpace = (fn: (s: Space) => Space): void => edit((w) => updateActiveSpace(w, fn));
  return {
    /**
     * Open a tab in a Browser tile, at `url` or the search engine's home page; `background` keeps
     * the current tab on screen. Elsewhere (Ctrl+T), a Browser opens in the tile if it's empty, or in
     * a new tile beside it. False when nothing was opened.
     */
    newTab(leafId: string, url?: string, background = false): boolean {
      const leaf = findLeaf(layout, leafId);
      if (!leaf) return false;
      if (leaf.appId !== 'browser') {
        if (url) return false;
        if (leaf.appId === null) {
          onSpace((s) => ({ ...s, layout: assignApp(s.layout, leafId, 'browser'), focusedLeafId: leafId }));
        } else if (canAddTile) {
          onSpace((s) => {
            const r = splitLeaf(s.layout, leafId, 'row', 'browser');
            return { ...s, layout: r.root, focusedLeafId: r.newLeafId ?? s.focusedLeafId };
          });
        } else return false;
        return true;
      }
      const r = addTab(layout, leafId, url);
      if (!r.instanceId) return false;
      const next = background && leaf.instanceId ? selectTab(r.root, leafId, leaf.instanceId) : r.root;
      onSpace((s) => ({ ...s, layout: next, focusedLeafId: background ? s.focusedLeafId : leafId }));
      if (!background) {
        if (url) window.aio.focusView(leafId);
        else focusAddress(leafId);
      }
      return true;
    },
    select(leafId: string, instanceId: string): void {
      onSpace((s) => ({ ...s, layout: selectTab(s.layout, leafId, instanceId), focusedLeafId: leafId }));
      window.aio.focusView(leafId);
    },
    close(leafId: string, instanceId: string): void {
      onSpace((s) => ({ ...s, layout: closeTab(s.layout, leafId, instanceId) }));
    },
    closeOthers(leafId: string, keepId: string): void {
      onSpace((s) => {
        const leaf = findLeaf(s.layout, leafId);
        if (!leaf) return s;
        const others = tabsOf(leaf).filter((t) => t.instanceId !== keepId);
        return { ...s, layout: others.reduce((l, t) => closeTab(l, leafId, t.instanceId), selectTab(s.layout, leafId, keepId)) };
      });
    },
    /** Move a tab into a new tile to the right (`row`) or below (`column`); the page keeps running. */
    move(leafId: string, instanceId: string, direction: SplitDirection = 'row'): void {
      if (!canAddTile) return;
      const r = moveTabToNewTile(layout, leafId, instanceId, direction);
      const newLeafId = r.newLeafId;
      if (!newLeafId) return;
      onSpace((s) => ({ ...s, layout: r.root, focusedLeafId: newLeafId }));
      window.aio.focusView(newLeafId);
    },
  };
}

export function App() {
  const [ws, setWs] = useState<Workspace | null>(null);
  // Built-in apps from main; the full catalog adds the user's own (workspace.customApps).
  const [builtins, setBuiltins] = useState<WebAppDef[]>([]);
  // Keyed by instance id, so a page's title and state follow it when tiles are swapped.
  const [viewStates, setViewStates] = useState<Record<string, ViewState>>({});
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [downloads, setDownloads] = useState<DownloadInfo[]>([]);
  // Page snapshots shown in tiles while the views are hidden (drags, popovers).
  const [snapshots, setSnapshots] = useState<Record<string, string>>({});
  const [downloadsOpen, setDownloadsOpen] = useState(false);
  // Open "Add app" dialog; leafId = the empty tile it was opened from (the new app opens there).
  const [adding, setAdding] = useState<{ leafId: string | null } | null>(null);
  /** The app store is open; `leafId` is the empty tile it was opened from (its pick opens there). */
  const [store, setStore] = useState<{ leafId: string | null } | null>(null);
  /** Right-click menu of a sidebar app. */
  const [railMenu, setRailMenu] = useState<{ appId: string; at: { x: number; y: number } } | null>(null);
  /** Right-click menu of a Browser tab. */
  const [tabMenu, setTabMenu] = useState<{ leafId: string; instanceId: string; at: { x: number; y: number } } | null>(null);
  /** AppImage updates (ROADMAP 5.4). */
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ supported: false, state: 'idle' });
  useEffect(() => {
    void window.aio.getUpdateStatus().then(setUpdateStatus);
    return window.aio.onUpdateStatus(setUpdateStatus);
  }, []);
  /** Installed Chrome extensions (ROADMAP 4.5), and the tile whose extensions panel is open. */
  const [extensions, setExtensions] = useState<ExtensionInfo[]>([]);
  const refreshExtensions = useCallback(() => void window.aio.listExtensions().then(setExtensions), []);
  useEffect(refreshExtensions, [refreshExtensions]);
  const [extensionsLeaf, setExtensionsLeaf] = useState<string | null>(null);
  const [shareRequest, setShareRequest] = useState<ScreenShareRequest | null>(null);
  const closeExtensions = useCallback(() => setExtensionsLeaf(null), []);
  /** App whose custom CSS editor is docked beside the tiles (ROADMAP 4.3). */
  const [cssFor, setCssFor] = useState<string | null>(null);
  // Tile whose Shields panel is open (ROADMAP 3.1).
  const [shieldsLeaf, setShieldsLeaf] = useState<string | null>(null);
  /** The rail is animating (D-038): views are hidden and sharp snapshots stand in for them. */
  const [railMoving, setRailMoving] = useState(false);
  // "Reduce animations and effects": one class on <html> turns off every transition and the glass blur.
  const reduceMotion = ws?.ui.reduceMotion ?? false;
  useLayoutEffect(() => {
    document.documentElement.classList.toggle('instant', reduceMotion);
  }, [reduceMotion]);
  // Theme (ROADMAP 4.1): the chosen one, or light/dark following the desktop.
  const systemDark = useSystemDark();
  const theme = ws ? resolveTheme(ws.ui.theme, ws.themes, systemDark) : null;
  useLayoutEffect(() => {
    if (!theme) return;
    applyTheme(theme);
    // Windows' window controls sit on our title strip: same colours as the theme (ROADMAP 6.2).
    if (window.aio.platform === 'win32') window.aio.setTitleBarColors(theme.colors.ink, theme.colors.text);
  }, [theme]);
  const snapshotWaiter = useRef<(() => void) | null>(null);
  /** Logins stored without a system keyring (ROADMAP 3.8); shown in the menu until dismissed. */
  const [weakKeyring, setWeakKeyring] = useState(false);
  useEffect(() => {
    void window.aio.getStorageStatus().then((s) => setWeakKeyring(s.weak));
  }, []);
  const saveTimer = useRef<number | undefined>(undefined);
  /** The workspace as loaded from main: saving it back unchanged is pointless, and could overwrite a newer one. */
  const loadedWs = useRef<Workspace | null>(null);
  // Latest handlers and focused tile; the IPC listeners and callbacks are created once.
  const shortcutRef = useRef<(action: ShortcutAction) => void>(() => {});
  const openInNewTileRef = useRef<(request: OpenInNewTile) => void>(() => {});
  const focusedRef = useRef<string | null>(null);

  useEffect(() => {
    Promise.all([window.aio.getWorkspace(), window.aio.getCatalog()])
      .then(([w, c]) => {
        loadedWs.current = w;
        setWs(w);
        setBuiltins(c);
      })
      .catch((e: unknown) => setError(String(e)));
    const offState = window.aio.onViewState((s) => {
      setViewStates((prev) => ({ ...prev, [s.instanceId]: s }));
      // Browser tabs remember their page, to reopen it after a restart (D-049).
      if (s.appId === 'browser' && isWebUrl(s.url) && s.url.length <= 2048) {
        const info = { url: s.url, title: s.title.slice(0, MAX_TAB_TITLE) };
        setWs((prev) => (prev ? mapLayouts(prev, (l) => setTabInfo(l, s.instanceId, info)) : prev));
      }
    });
    const offFocus = window.aio.onViewFocused((leafId) =>
      setWs((prev) => (prev ? updateActiveSpace(prev, (s) => ({ ...s, focusedLeafId: leafId })) : prev)),
    );
    const offShortcut = window.aio.onShortcut((action) => shortcutRef.current(action));
    const offNewTile = window.aio.onOpenInNewTile((request) => openInNewTileRef.current(request));
    const offShare = window.aio.onScreenSharePick(setShareRequest);
    const offDownloads = window.aio.onDownloads(setDownloads);
    const offSnapshots = window.aio.onViewSnapshots((shots) => {
      setSnapshots(shots);
      snapshotWaiter.current?.();
    });
    // Save user zoom per app; 100% is the default, so it's removed instead of stored.
    const offZoom = window.aio.onAppZoom((appId, factor) =>
      setWs((prev) => {
        if (!prev) return prev;
        const zoom = { ...prev.zoom };
        if (Math.abs(factor - 1) < 0.001) delete zoom[appId];
        else zoom[appId] = factor;
        return { ...prev, zoom };
      }),
    );
    const offIcon = window.aio.onAppIcon((appId, icon) =>
      setWs((prev) =>
        prev ? { ...prev, customApps: prev.customApps.map((a) => (a.id === appId && !a.icon ? { ...a, icon } : a)) } : prev,
      ),
    );
    return () => {
      offSnapshots();
      offZoom();
      offIcon();
      offDownloads();
      offState();
      offFocus();
      offShortcut();
      offNewTile();
      offShare();
    };
  }, []);

  // Debounced persistence of every workspace change.
  useEffect(() => {
    if (!ws || ws === loadedWs.current) return;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      // Browser set to "forget when SpaceAIO closes": its tabs' pages are never written to disk.
      const saved = ws.forgetOnClose.includes('browser') ? mapLayouts(ws, forgetTabPages) : ws;
      window.aio.saveWorkspace(saved).catch((e: unknown) => setError(`Couldn't save layout: ${String(e)}`));
    }, SAVE_DELAY_MS);
  }, [ws]);

  const edit = useCallback((fn: (w: Workspace) => Workspace) => {
    setWs((prev) => (prev ? fn(prev) : prev));
  }, []);

  const closeHelp = useCallback(() => setHelpOpen(false), []);
  const closeDownloads = useCallback(() => setDownloadsOpen(false), []);
  const closeAdding = useCallback(() => setAdding(null), []);
  const closeStore = useCallback(() => setStore(null), []);
  const closeRailMenu = useCallback(() => setRailMenu(null), []);
  const closeTabMenu = useCallback(() => setTabMenu(null), []);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const closeShields = useCallback(() => setShieldsLeaf(null), []);
  // Runs after the popover has shown the views again, so the focused tile can take the keyboard back.
  const refocusTile = useCallback(() => window.aio.focusView(focusedRef.current), []);

  /**
   * Hide or show the rail (D-038). Native views can't follow a CSS transition frame by frame (each
   * move is an IPC round trip), so they're swapped for snapshots first, the tiles animate with the
   * rail in plain CSS, and the live views come back at their final size.
   */
  const toggleRailRef = useRef<() => void>(() => {});
  useLayoutEffect(() => {
    toggleRailRef.current = () => {
      if (!ws || railMoving) return;
      const flip = (): void => edit((w) => ({ ...w, ui: { ...w.ui, railCollapsed: !w.ui.railCollapsed } }));
      const hasViews = activeSpaceHasApps(ws);
      const popoverOpen = menuOpen || helpOpen || downloadsOpen || shieldsLeaf !== null || extensionsLeaf !== null || adding !== null || store !== null || railMenu !== null || tabMenu !== null;
      const reduceMotion = ws.ui.reduceMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      // Views already hidden (a popover is open), none to hide, or no animation wanted: just switch.
      if (!hasViews || popoverOpen || reduceMotion) return flip();
      setRailMoving(true);
      void (async () => {
        const snapshotsIn = new Promise<void>((resolve) => (snapshotWaiter.current = resolve));
        window.aio.setViewsHidden(true);
        await Promise.race([snapshotsIn, sleep(SNAPSHOT_WAIT_MS)]);
        snapshotWaiter.current = null;
        await nextFrame(); // snapshots painted before the rail starts moving
        flip();
        await sleep(RAIL_ANIMATION_MS + 40);
        window.aio.setViewsHidden(false);
        setRailMoving(false);
      })();
    };
  });

  useLayoutEffect(() => {
    focusedRef.current = ws ? activeSpace(ws).focusedLeafId : null;
    shortcutRef.current = (action) => {
      if (!ws) return;
      if (action.kind === 'help') return setHelpOpen((open) => !open);
      if (action.kind === 'toggle-rail') return toggleRailRef.current();
      const space = activeSpace(ws);
      const focused = space.focusedLeafId;
      if (!focused) return;
      // Moves the focus outline and keyboard focus together, so typing goes to the tile you see focused.
      const focusTile = (leafId: string | null): void => {
        if (leafId) edit((w) => updateActiveSpace(w, (s) => ({ ...s, focusedLeafId: leafId })));
        window.aio.focusView(leafId);
      };
      switch (action.kind) {
        case 'focus-direction':
          focusTile(neighborTile(computeLayout(space.layout, UNIT_AREA).tiles, focused, action.direction));
          return;
        case 'focus-index': {
          const leaf = listLeaves(space.layout)[action.index];
          if (leaf) focusTile(leaf.id);
          return;
        }
        case 'split':
          edit((w) =>
            updateActiveSpace(w, (s) => {
              const r = splitLeaf(s.layout, focused, action.direction, null);
              return { ...s, layout: r.root, focusedLeafId: r.newLeafId };
            }),
          );
          window.aio.focusView(null); // the new tile is empty: the launcher lives in the UI
          return;
        case 'new-tab':
          tabActions(ws, edit).newTab(focused);
          return;
        case 'switch-tab': {
          const leaf = findLeaf(space.layout, focused);
          const tabs = leaf ? tabsOf(leaf) : [];
          if (!leaf || tabs.length < 2) return;
          const i = tabs.findIndex((t) => t.instanceId === leaf.instanceId);
          tabActions(ws, edit).select(focused, tabs[(i + action.delta + tabs.length) % tabs.length]!.instanceId);
          return;
        }
        case 'close': {
          // A Browser tile with tabs closes the tab on screen, not the whole tile.
          const leaf = findLeaf(space.layout, focused);
          if (leaf?.instanceId && tabsOf(leaf).length > 1) {
            tabActions(ws, edit).close(focused, leaf.instanceId);
            return;
          }
          const after = ensureFocus({ ...space, layout: removeLeaf(space.layout, focused) });
          edit((w) => updateActiveSpace(w, () => after));
          window.aio.focusView(after.focusedLeafId);
          return;
        }
        case 'reload':
          window.aio.viewCommand(focused, 'reload');
          return;
        case 'zoom':
          window.aio.viewCommand(focused, `zoom-${action.change}`);
          return;
        case 'focus-address': {
          const input = document.querySelector<HTMLInputElement>(`[data-address-for="${focused}"]`);
          if (!input) return;
          window.aio.focusView(null); // keyboard to the UI page, then to the address bar inside it
          input.focus();
          return;
        }
      }
    };

    // A Browser tile link asked for a new tab: open it in a new Browser tile to the right (D-015).
    openInNewTileRef.current = ({ fromLeafId, url, background, tab, external }) => {
      if (!ws) return;
      const space = activeSpace(ws);
      const from = findLeaf(space.layout, fromLeafId);
      if (!from) return;
      // A link that left its app: a new tab in this space's Browser tile, else a Browser tile beside
      // the app, else (no room) the system browser (D-065).
      if (external) {
        const browser = listLeaves(space.layout).find((l) => l.appId === 'browser');
        if (browser && tabActions(ws, edit).newTab(browser.id, url)) return;
        if (listLeaves(space.layout).length >= MAX_TILES) {
          window.aio.openExternal(url);
          return;
        }
      }
      // Browser links asking for a new tab open as a tab of the same tile (D-049).
      if (tab && from.appId === 'browser' && tabActions(ws, edit).newTab(fromLeafId, url, background)) return;
      if (listLeaves(space.layout).length >= MAX_TILES) {
        window.aio.navigate(fromLeafId, url); // no room: same tile, like before
        return;
      }
      const r = splitLeaf(space.layout, fromLeafId, 'row', 'browser');
      const newLeafId = r.newLeafId;
      if (!newLeafId) return;
      window.aio.navigate(newLeafId, url); // before the layout update, so the view starts on this URL
      edit((w) =>
        updateActiveSpace(w, (s) => ({ ...s, layout: r.root, focusedLeafId: background ? s.focusedLeafId : newLeafId })),
      );
      if (!background) window.aio.focusView(newLeafId);
    };
  });

  if (error) return <div className="fatal">{error}</div>;
  if (!ws) return <div className="boot" />;

  const space = activeSpace(ws);
  const keyringNotice = weakKeyring && !ws.dismissedNotices.includes('weak-keyring');
  const focused = space.focusedLeafId;
  const catalog = catalogOf(ws, builtins);
  // Apps in the other spaces keep running (hidden) so switching is instant (ROADMAP 2.8).
  // So do Browser tabs that aren't on screen (D-049).
  const backgroundInstances = [
    ...ws.spaces.filter((s) => s.id !== space.id).flatMap((s) => instancesOf(s.layout)),
    ...hiddenTabsOf(space.layout),
  ];

  // Unread per app for the rail, from every tile's page title (all spaces: they all run).
  const unreadByApp: Record<string, Unread> = {};
  // Microphone/camera/screen in use per app, across every space (privacy dots on the rail).
  const mediaByApp: Record<string, MediaInUse> = {};
  for (const leaf of ws.spaces.flatMap((sp) => listLeaves(sp.layout))) {
    for (const { instanceId } of tabsOf(leaf)) {
      const state = viewStates[instanceId];
      const title = state?.title;
      if (leaf.appId && title) unreadByApp[leaf.appId] = sumUnread([unreadByApp[leaf.appId] ?? null, unreadFromTitle(title)]);
      if (leaf.appId && state && anyMedia(state.media)) mediaByApp[leaf.appId] = mergeMedia(mediaByApp[leaf.appId], state.media);
    }
  }

  // The sidebar in the user's order, without hidden apps (the launcher still lists every app).
  const sidebarApps = railApps(catalog, ws.rail);

  /** Open an app in a new tile to the right of the focused one (or in the focused tile at the tile limit). */
  const openInNewTile = (appId: string): void => {
    if (!focused || listLeaves(space.layout).length >= MAX_TILES) return openApp(appId);
    edit((w) =>
      updateActiveSpace(w, (s) => {
        const r = splitLeaf(s.layout, focused, 'row', appId);
        return { ...s, layout: r.root, focusedLeafId: r.newLeafId ?? s.focusedLeafId };
      }),
    );
  };

  const openApp = (appId: string, leafId = focused): void => {
    if (!leafId) return;
    edit((w) => updateActiveSpace(w, (s) => ({ ...s, layout: assignApp(s.layout, leafId, appId), focusedLeafId: leafId })));
  };

  /** A sidebar app dropped on a tile (ROADMAP 2.16): beside it on that side, or in it after asking. */
  const dropApp = (leafId: string, appId: string, zone: DropZone): void => {
    const leaf = findLeaf(space.layout, leafId);
    if (!leaf) return;
    if (zone === 'center') {
      const name = (id: string): string => catalog.find((a) => a.id === id)?.name ?? id;
      if (leaf.appId === appId) return;
      if (leaf.appId && !window.confirm(`Replace ${name(leaf.appId)} with ${name(appId)}?`)) return;
      return openApp(appId, leafId);
    }
    edit((w) =>
      updateActiveSpace(w, (s) => {
        const r = splitLeaf(s.layout, leafId, zone === 'left' || zone === 'right' ? 'row' : 'column', appId, zone === 'left' || zone === 'top');
        return { ...s, layout: r.root, focusedLeafId: r.newLeafId ?? s.focusedLeafId };
      }),
    );
  };

  const split = (leafId: string, dir: SplitDirection): void =>
    edit((w) =>
      updateActiveSpace(w, (s) => {
        const r = splitLeaf(s.layout, leafId, dir, null);
        return { ...s, layout: r.root, focusedLeafId: r.newLeafId };
      }),
    );

  const close = (leafId: string): void =>
    edit((w) => updateActiveSpace(w, (s) => ensureFocus({ ...s, layout: removeLeaf(s.layout, leafId) })));

  const clear = (leafId: string): void =>
    edit((w) => updateActiveSpace(w, (s) => ({ ...s, layout: assignApp(s.layout, leafId, null) })));

  // Focus follows the app you dragged. Views are keyed by instance, so neither page reloads.
  const swap = (from: string, to: string): void =>
    edit((w) => updateActiveSpace(w, (s) => ({ ...s, layout: swapApps(s.layout, from, to), focusedLeafId: to })));

  const addApp = (app: WebAppDef): void => {
    const leafId = adding?.leafId ?? null;
    edit((w) => {
      const withApp = { ...w, customApps: [...w.customApps, app] };
      return leafId
        ? updateActiveSpace(withApp, (s) => ({ ...s, layout: assignApp(s.layout, leafId, app.id), focusedLeafId: leafId }))
        : withApp;
    });
    setAdding(null);
  };

  const removeApp = (appId: string): void => {
    const app = ws.customApps.find((a) => a.id === appId);
    if (!app) return;
    const ok = window.confirm(
      `Remove ${app.name}? Tiles showing it will be emptied. Its login and site data stay on this computer until you clear app data.`,
    );
    if (!ok) return;
    edit((w) => ({
      ...w,
      customApps: w.customApps.filter((a) => a.id !== appId),
      spaces: w.spaces.map((s) => ({
        ...s,
        layout: listLeaves(s.layout)
          .filter((l) => l.appId === appId)
          .reduce((layout, l) => assignApp(layout, l.id, null), s.layout),
      })),
    }));
  };

  const spaces = {
    switch: (id: string): void => {
      edit((w) => switchSpace(w, id));
      setMenuOpen(false);
    },
    add: (): void => {
      edit((w) => addSpace(w));
      setMenuOpen(false);
    },
    rename: (id: string, name: string): void => edit((w) => renameSpace(w, id, name)),
    remove: (id: string): void => edit((w) => removeSpace(w, id)),
  };

  // Accounts (ROADMAP 2.12): pick one for a tile, or add one and switch the tile to it.
  const setAccount = (leafId: string, profile: string): void =>
    edit((w) => {
      const appId = findLeaf(activeSpace(w).layout, leafId)?.appId;
      if (!appId) return w;
      if (profile !== '+add') return updateActiveSpace(w, (s) => ({ ...s, layout: setProfile(s.layout, leafId, profile) }));
      const added = addProfile(w, appId);
      if (!added.profileId) return w;
      const id = added.profileId;
      return updateActiveSpace(added.ws, (s) => ({ ...s, layout: setProfile(s.layout, leafId, id) }));
    });

  // Shields: per-app overrides (only differences from the defaults are stored), and the defaults.
  const setAppShield = <K extends keyof PrivacySettings>(appId: string, key: K, value: PrivacySettings[K]): void =>
    edit((w) => ({ ...w, privacyOverrides: setPrivacyOverride(w.privacy, w.privacyOverrides, appId, key, value) }));
  const resetAppShields = (appId: string): void =>
    edit((w) => {
      const privacyOverrides = { ...w.privacyOverrides };
      delete privacyOverrides[appId];
      return { ...w, privacyOverrides };
    });
  const setShieldDefault = <K extends keyof PrivacySettings>(key: K, value: PrivacySettings[K]): void =>
    edit((w) => ({ ...w, privacy: { ...w.privacy, [key]: value } }));
  const shieldsLeafNode = shieldsLeaf ? findLeaf(space.layout, shieldsLeaf) : null;
  const shieldsApp = shieldsLeafNode?.appId ? catalog.find((a) => a.id === shieldsLeafNode.appId) : undefined;

  const canAddTile = listLeaves(space.layout).length < MAX_TILES;
  const tabs = tabActions(ws, edit);

  const setSearchEngine = (leafId: string, searchEngine: SearchEngineId): void => {
    edit((w) => ({ ...w, browser: { ...w.browser, searchEngine } }));
    // Make the switch visible: a tile showing a search engine moves to the new one (same search).
    const instanceId = findLeaf(space.layout, leafId)?.instanceId;
    const next = urlAfterEngineSwitch((instanceId && viewStates[instanceId]?.url) || '', searchEngine);
    if (next) window.aio.navigate(leafId, next);
  };

  const navigate = (leafId: string, text: string): void => {
    const url = addressToUrl(text, ws.browser.searchEngine);
    if (url) window.aio.navigate(leafId, url);
  };

  return (
    <div className="frame">
      {/* Windows: our own title strip; Windows draws its window controls over its right end (ROADMAP 6.2). */}
      {window.aio.platform === 'win32' && (
        <div className="titlebar">
          <span className="titlebar-name">SpaceAIO</span>
          {ws.spaces.length > 1 && <span className="titlebar-space">{space.name}</span>}
        </div>
      )}
    <div className={`shell${railMoving ? ' is-rail-moving' : ''}`}>
      <Sidebar
        catalog={sidebarApps}
        pinned={ws.rail.pinned}
        onReorder={(appId, targetId, after) => edit((w) => placeInRail(w, catalog, appId, targetId, after))}
        unread={unreadByApp}
        media={mediaByApp}
        onOpen={(id) => openApp(id)}
        onSplit={(dir) => focused && split(focused, dir)}
        canSplit={Boolean(focused)}
        onMenu={() => setMenuOpen(!menuOpen)}
        menuOpen={menuOpen}
        spaceName={space.name}
        showSpaceName={ws.spaces.length > 1}
        onHelp={() => setHelpOpen(!helpOpen)}
        helpOpen={helpOpen}
        onDownloads={() => setDownloadsOpen(!downloadsOpen)}
        downloadsOpen={downloadsOpen}
        activeDownloads={downloads.filter((d) => d.state === 'progressing').length}
        menuNotice={keyringNotice || updateStatus.state === 'ready'}
        collapsed={ws.ui.railCollapsed}
        onAddApp={() => setStore({ leafId: null })}
        onAppMenu={(appId, at) => setRailMenu({ appId, at })}
        onToggleCollapsed={() => toggleRailRef.current()}
      />
      <TileLayout
        layout={space.layout}
        catalog={catalog}
        focusedLeafId={focused}
        viewStates={viewStates}
        backgroundInstances={backgroundInstances}
        snapshots={snapshots}
        searchEngine={ws.browser.searchEngine}
        onSearchEngine={setSearchEngine}
        onNavigate={navigate}
        onFocus={(leafId) => edit((w) => updateActiveSpace(w, (s) => ({ ...s, focusedLeafId: leafId })))}
        onResize={(splitId, ratio) => edit((w) => updateActiveSpace(w, (s) => ({ ...s, layout: setRatio(s.layout, splitId, ratio) })))}
        onOpenApp={openApp}
        onSplit={split}
        onClose={close}
        onClear={clear}
        onSwap={swap}
        onDropApp={dropApp}
        accountsOf={(appId) => profilesOf(ws, appId)}
        onAccount={setAccount}
        shieldsUp={(appId) => resolvePrivacy(ws.privacy, ws.privacyOverrides[appId]).shields}
        onShields={setShieldsLeaf}
        extensionsInstalled={extensions.length > 0}
        extensionsOn={(appId) => (ws.extensions[appId] ?? []).filter((id) => extensions.some((x) => x.id === id)).length}
        onExtensions={setExtensionsLeaf}
        onAllowHttp={(host) => edit((w) => allowHttpHost(w, host))}
        onAddApp={(leafId) => setStore({ leafId })}
        onRemoveApp={removeApp}
        onNewTab={(leafId) => tabs.newTab(leafId)}
        onSelectTab={tabs.select}
        onCloseTab={tabs.close}
        onMoveTab={(leafId, id) => tabs.move(leafId, id)}
        onTabMenu={(leafId, instanceId, at) => setTabMenu({ leafId, instanceId, at })}
        canAddTile={canAddTile}
      />
      {cssFor && (() => {
        const cssApp = catalog.find((a) => a.id === cssFor);
        return cssApp ? (
          <CssEditor
            app={cssApp}
            value={ws.appCss[cssApp.id]}
            onChange={(value) => edit((w) => setAppCss(w, cssApp.id, value))}
            onClose={() => {
              setCssFor(null);
              refocusTile();
            }}
          />
        ) : null;
      })()}
      {helpOpen && <ShortcutsHelp onClose={closeHelp} onClosed={refocusTile} />}
      {menuOpen && (
        <MenuPanel
          ws={ws}
          onSwitch={spaces.switch}
          onAdd={spaces.add}
          onRename={spaces.rename}
          onRemove={spaces.remove}
          onSearchEngine={(engine) => edit((w) => ({ ...w, browser: { ...w.browser, searchEngine: engine } }))}
          onShieldDefault={setShieldDefault}
          onDisallowHttp={(host) => edit((w) => disallowHttpHost(w, host))}
          keyringNotice={keyringNotice}
          onDismissKeyring={() => edit((w) => dismissNotice(w, 'weak-keyring'))}
          onClearAll={() => window.aio.clearData({ all: true })}
          onReduceMotion={(on) => edit((w) => ({ ...w, ui: { ...w.ui, reduceMotion: on } }))}
          onTheme={(theme) => edit((w) => ({ ...w, ui: { ...w.ui, theme } }))}
          onImportTheme={(t) => edit((w) => ({ ...w, themes: [...w.themes, t], ui: { ...w.ui, theme: t.id } }))}
          onRemoveTheme={(id) =>
            edit((w) => ({ ...w, themes: w.themes.filter((t) => t.id !== id), ui: { ...w.ui, theme: w.ui.theme === id ? 'system' : w.ui.theme } }))
          }
          onTwitchScript={(adScript) => edit((w) => ({ ...w, twitch: { adScript } }))}
          onShareGoogle={(shareGoogle) => edit((w) => ({ ...w, identity: { shareGoogle } }))}
          apps={catalog}
          onSaveTemplate={(id) => edit((w) => saveTemplate(w, id))}
          onAddFromTemplate={(id) => {
            edit((w) => addSpaceFromTemplate(w, id));
            setMenuOpen(false);
          }}
          onRemoveTemplate={(id) => edit((w) => removeTemplate(w, id))}
          onImported={(imported) => {
            setWs(imported);
            setMenuOpen(false);
          }}
          onPluginEnabled={(id, on) => edit((w) => setPluginEnabled(w, id, on))}
          updateStatus={updateStatus}
          onAutoUpdates={(auto) => edit((w) => ({ ...w, updates: { auto } }))}
          extensions={extensions}
          onExtensionsChanged={refreshExtensions}
          onExtensionRemoved={(id) => edit((w) => forgetExtension(w, id))}
          onCustomCss={(appId) => {
            setMenuOpen(false);
            setCssFor(appId);
          }}
          hiddenApps={catalog.filter((a) => ws.rail.hidden.includes(a.id))}
          onShowApp={(appId) => edit((w) => setHiddenInRail(w, appId, false))}
          onSleepAfter={(sleepAfterMinutes) => edit((w) => ({ ...w, performance: { ...w.performance, sleepAfterMinutes } }))}
          onClose={closeMenu}
          onClosed={refocusTile}
        />
      )}
      {shieldsApp && shieldsLeafNode && (
        <ShieldsPanel
          ws={ws}
          app={shieldsApp}
          blocked={(shieldsLeafNode.instanceId && viewStates[shieldsLeafNode.instanceId]?.blocked) || 0}
          onSet={(key, value) => setAppShield(shieldsApp.id, key, value)}
          onReset={() => resetAppShields(shieldsApp.id)}
          profile={profilesOf(ws, shieldsApp.id).find((p) => p.id === (shieldsLeafNode.profile ?? 'default')) ?? profilesOf(ws, shieldsApp.id)[0]!}
          accounts={profilesOf(ws, shieldsApp.id).length}
          onForget={(forget) => edit((w) => setForgetOnClose(w, shieldsApp.id, forget))}
          onTwitchScript={(adScript) => edit((w) => ({ ...w, twitch: { adScript } }))}
          onClearData={(profile) => window.aio.clearData({ appId: shieldsApp.id, profile })}
          onRenameAccount={(name) => edit((w) => renameProfile(w, shieldsApp.id, shieldsLeafNode.profile ?? 'default', name))}
          onRemoveAccount={async () => {
            const profile = shieldsLeafNode.profile ?? 'default';
            edit((w) => removeProfile(w, shieldsApp.id, profile));
            await window.aio.clearData({ appId: shieldsApp.id, profile });
          }}
          onClose={closeShields}
          onClosed={refocusTile}
        />
      )}
      {shareRequest && (
        <SharePicker
          key={shareRequest.id}
          request={shareRequest}
          onChoose={(sourceId, audio) => {
            window.aio.chooseScreenShare(shareRequest.id, sourceId, audio);
            setShareRequest(null);
          }}
        />
      )}
      {extensionsLeaf && (() => {
        const leaf = findLeaf(space.layout, extensionsLeaf);
        const extApp = leaf?.appId ? catalog.find((a) => a.id === leaf.appId) : undefined;
        return leaf && extApp ? (
          <ExtensionsPanel
            app={extApp}
            leafId={leaf.id}
            installed={extensions}
            enabled={ws.extensions[extApp.id] ?? []}
            onToggle={(id, on) => edit((w) => setExtensionEnabled(w, extApp.id, id, on))}
            onClose={closeExtensions}
            onClosed={refocusTile}
          />
        ) : null;
      })()}
      {railMenu && (() => {
        const menuApp = catalog.find((a) => a.id === railMenu.appId);
        if (!menuApp) return null;
        const index = sidebarApps.findIndex((a) => a.id === menuApp.id);
        const pinned = ws.rail.pinned.includes(menuApp.id);
        // Up and down stay within the pinned group or the rest.
        const inGroup = (i: number): boolean => i >= 0 && i < sidebarApps.length && ws.rail.pinned.includes(sidebarApps[i]!.id) === pinned;
        return (
          <RailMenu
            app={menuApp}
            at={railMenu.at}
            canMoveUp={index >= 0 && inGroup(index - 1)}
            canMoveDown={index >= 0 && inGroup(index + 1)}
            pinned={pinned}
            togglePin={() => edit((w) => setPinnedInRail(w, catalog, menuApp.id, !pinned))}
            open={() => openApp(menuApp.id)}
            openInNewTile={() => openInNewTile(menuApp.id)}
            moveUp={() => edit((w) => moveInRail(w, catalog, menuApp.id, -1))}
            moveDown={() => edit((w) => moveInRail(w, catalog, menuApp.id, 1))}
            hide={() => edit((w) => setHiddenInRail(w, menuApp.id, true))}
            customCss={() => setCssFor(menuApp.id)}
            {...(menuApp.id.startsWith('custom-') ? { remove: () => removeApp(menuApp.id) } : {})}
            onClose={closeRailMenu}
            onClosed={refocusTile}
          />
        );
      })()}
      {tabMenu && (() => {
        const leaf = findLeaf(space.layout, tabMenu.leafId);
        const tab = leaf && tabsOf(leaf).find((t) => t.instanceId === tabMenu.instanceId);
        if (!leaf || !tab) return null;
        const several = tabsOf(leaf).length > 1;
        return (
          <TabMenu
            title={tabLabel(tab, viewStates[tab.instanceId])}
            at={tabMenu.at}
            canMove={several && canAddTile}
            canClose={several}
            newTab={() => tabs.newTab(leaf.id)}
            moveRight={() => tabs.move(leaf.id, tab.instanceId, 'row')}
            moveDown={() => tabs.move(leaf.id, tab.instanceId, 'column')}
            close={() => tabs.close(leaf.id, tab.instanceId)}
            closeOthers={() => tabs.closeOthers(leaf.id, tab.instanceId)}
            onClose={closeTabMenu}
            onClosed={refocusTile}
          />
        );
      })()}
      {store && (
        <AppStore
          catalog={catalog}
          onInstall={(entry) => {
            const res = appFromStore(entry, catalog);
            if (!res.ok) return res.error;
            const leafId = store.leafId;
            edit((w) => {
              const withApp = { ...w, customApps: [...w.customApps, res.app] };
              return leafId
                ? updateActiveSpace(withApp, (s) => ({ ...s, layout: assignApp(s.layout, leafId, res.app.id), focusedLeafId: leafId }))
                : withApp;
            });
            if (leafId) setStore(null); // opened from an empty tile: the app is now in it
            return null;
          }}
          onOpen={(appId) => {
            openApp(appId, store.leafId ?? focused);
            setStore(null);
          }}
          onCustom={() => {
            setAdding({ leafId: store.leafId });
            setStore(null);
          }}
          onClose={closeStore}
          onClosed={refocusTile}
        />
      )}
      {adding && <AddAppDialog catalog={catalog} onAdd={addApp} onClose={closeAdding} onClosed={refocusTile} />}
      {downloadsOpen && <DownloadsPanel downloads={downloads} onClose={closeDownloads} onClosed={refocusTile} />}
    </div>
    </div>
  );
}
