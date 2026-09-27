import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  activeSpace,
  addProfile,
  allowHttpHost,
  addSpace,
  addressToUrl,
  assignApp,
  catalogOf,
  computeLayout,
  disallowHttpHost,
  dismissNotice,
  setForgetOnClose,
  ensureFocus,
  findLeaf,
  listLeaves,
  MAX_TILES,
  neighborTile,
  profilesOf,
  removeLeaf,
  removeSpace,
  resolvePrivacy,
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
  type SplitDirection,
  type Unread,
  type WebAppDef,
  type Workspace,
} from '@aio/core';
import type { DownloadInfo, OpenInNewTile, ShortcutAction, ViewState } from '../../shared/ipc';
import { AddAppDialog } from './components/AddAppDialog';
import { DownloadsPanel } from './components/DownloadsPanel';
import { MenuPanel } from './components/MenuPanel';
import { ShieldsPanel } from './components/ShieldsPanel';
import { ShortcutsHelp } from './components/ShortcutsHelp';
import { Sidebar } from './components/Sidebar';
import { TileLayout } from './components/TileLayout';

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
  // Tile whose Shields panel is open (ROADMAP 3.1).
  const [shieldsLeaf, setShieldsLeaf] = useState<string | null>(null);
  /** The rail is animating (D-038): views are hidden and sharp snapshots stand in for them. */
  const [railMoving, setRailMoving] = useState(false);
  const snapshotWaiter = useRef<(() => void) | null>(null);
  /** Logins stored without a system keyring (ROADMAP 3.8); shown in the menu until dismissed. */
  const [weakKeyring, setWeakKeyring] = useState(false);
  useEffect(() => {
    void window.aio.getStorageStatus().then((s) => setWeakKeyring(s.weak));
  }, []);
  const saveTimer = useRef<number | undefined>(undefined);
  // Latest handlers and focused tile; the IPC listeners and callbacks are created once.
  const shortcutRef = useRef<(action: ShortcutAction) => void>(() => {});
  const openInNewTileRef = useRef<(request: OpenInNewTile) => void>(() => {});
  const focusedRef = useRef<string | null>(null);

  useEffect(() => {
    Promise.all([window.aio.getWorkspace(), window.aio.getCatalog()])
      .then(([w, c]) => {
        setWs(w);
        setBuiltins(c);
      })
      .catch((e: unknown) => setError(String(e)));
    const offState = window.aio.onViewState((s) => setViewStates((prev) => ({ ...prev, [s.instanceId]: s })));
    const offFocus = window.aio.onViewFocused((leafId) =>
      setWs((prev) => (prev ? updateActiveSpace(prev, (s) => ({ ...s, focusedLeafId: leafId })) : prev)),
    );
    const offShortcut = window.aio.onShortcut((action) => shortcutRef.current(action));
    const offNewTile = window.aio.onOpenInNewTile((request) => openInNewTileRef.current(request));
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
    };
  }, []);

  // Debounced persistence of every workspace change.
  useEffect(() => {
    if (!ws) return;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      window.aio.saveWorkspace(ws).catch((e: unknown) => setError(`Couldn't save layout: ${String(e)}`));
    }, SAVE_DELAY_MS);
  }, [ws]);

  const edit = useCallback((fn: (w: Workspace) => Workspace) => {
    setWs((prev) => (prev ? fn(prev) : prev));
  }, []);

  const closeHelp = useCallback(() => setHelpOpen(false), []);
  const closeDownloads = useCallback(() => setDownloadsOpen(false), []);
  const closeAdding = useCallback(() => setAdding(null), []);
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
      const popoverOpen = menuOpen || helpOpen || downloadsOpen || shieldsLeaf !== null || adding !== null;
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
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
        case 'close': {
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
    openInNewTileRef.current = ({ fromLeafId, url, background }) => {
      if (!ws) return;
      const space = activeSpace(ws);
      if (!findLeaf(space.layout, fromLeafId)) return;
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
  const backgroundInstances = ws.spaces
    .filter((s) => s.id !== space.id)
    .flatMap((s) => listLeaves(s.layout).flatMap((l) => (l.instanceId ? [l.instanceId] : [])));

  // Unread per app for the rail, from every tile's page title (all spaces: they all run).
  const unreadByApp: Record<string, Unread> = {};
  for (const leaf of ws.spaces.flatMap((sp) => listLeaves(sp.layout))) {
    const title = leaf.instanceId ? viewStates[leaf.instanceId]?.title : undefined;
    if (leaf.appId && title) unreadByApp[leaf.appId] = sumUnread([unreadByApp[leaf.appId] ?? null, unreadFromTitle(title)]);
  }

  const openApp = (appId: string, leafId = focused): void => {
    if (!leafId) return;
    edit((w) => updateActiveSpace(w, (s) => ({ ...s, layout: assignApp(s.layout, leafId, appId), focusedLeafId: leafId })));
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
    <div className={`shell${railMoving ? ' is-rail-moving' : ''}`}>
      <Sidebar
        catalog={catalog}
        unread={unreadByApp}
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
        menuNotice={keyringNotice}
        collapsed={ws.ui.railCollapsed}
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
        accountsOf={(appId) => profilesOf(ws, appId)}
        onAccount={setAccount}
        shieldsUp={(appId) => resolvePrivacy(ws.privacy, ws.privacyOverrides[appId]).shields}
        onShields={setShieldsLeaf}
        onAllowHttp={(host) => edit((w) => allowHttpHost(w, host))}
        onAddApp={(leafId) => setAdding({ leafId })}
        onRemoveApp={removeApp}
      />
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
          onClearData={(profile) => window.aio.clearData({ appId: shieldsApp.id, profile })}
          onClose={closeShields}
          onClosed={refocusTile}
        />
      )}
      {adding && <AddAppDialog catalog={catalog} onAdd={addApp} onClose={closeAdding} onClosed={refocusTile} />}
      {downloadsOpen && <DownloadsPanel downloads={downloads} onClose={closeDownloads} onClosed={refocusTile} />}
    </div>
  );
}
