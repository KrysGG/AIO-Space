import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  activeSpace,
  addressToUrl,
  assignApp,
  computeLayout,
  ensureFocus,
  findLeaf,
  listLeaves,
  MAX_TILES,
  neighborTile,
  removeLeaf,
  setRatio,
  splitLeaf,
  swapApps,
  updateActiveSpace,
  urlAfterEngineSwitch,
  type SearchEngineId,
  type SplitDirection,
  type WebAppDef,
  type Workspace,
} from '@aio/core';
import type { OpenInNewTile, ShortcutAction, ViewState } from '../../shared/ipc';
import { ShortcutsHelp } from './components/ShortcutsHelp';
import { Sidebar } from './components/Sidebar';
import { TileLayout } from './components/TileLayout';

const SAVE_DELAY_MS = 300;
/** Any area works for finding neighbours: only the relative position of tiles matters. */
const UNIT_AREA = { x: 0, y: 0, width: 1000, height: 1000 };

export function App() {
  const [ws, setWs] = useState<Workspace | null>(null);
  const [catalog, setCatalog] = useState<WebAppDef[]>([]);
  // Keyed by instance id, so a page's title and state follow it when tiles are swapped.
  const [viewStates, setViewStates] = useState<Record<string, ViewState>>({});
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const saveTimer = useRef<number | undefined>(undefined);
  // Latest handlers and focused tile; the IPC listeners and callbacks are created once.
  const shortcutRef = useRef<(action: ShortcutAction) => void>(() => {});
  const openInNewTileRef = useRef<(request: OpenInNewTile) => void>(() => {});
  const focusedRef = useRef<string | null>(null);

  useEffect(() => {
    Promise.all([window.aio.getWorkspace(), window.aio.getCatalog()])
      .then(([w, c]) => {
        setWs(w);
        setCatalog(c);
      })
      .catch((e: unknown) => setError(String(e)));
    const offState = window.aio.onViewState((s) => setViewStates((prev) => ({ ...prev, [s.instanceId]: s })));
    const offFocus = window.aio.onViewFocused((leafId) =>
      setWs((prev) => (prev ? updateActiveSpace(prev, (s) => ({ ...s, focusedLeafId: leafId })) : prev)),
    );
    const offShortcut = window.aio.onShortcut((action) => shortcutRef.current(action));
    const offNewTile = window.aio.onOpenInNewTile((request) => openInNewTileRef.current(request));
    return () => {
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
  // Runs after the popover has shown the views again, so the focused tile can take the keyboard back.
  const refocusTile = useCallback(() => window.aio.focusView(focusedRef.current), []);

  useLayoutEffect(() => {
    focusedRef.current = ws ? activeSpace(ws).focusedLeafId : null;
    shortcutRef.current = (action) => {
      if (!ws) return;
      if (action.kind === 'help') return setHelpOpen((open) => !open);
      const space = activeSpace(ws);
      const focused = space.focusedLeafId;
      if (!focused) return;
      // Moves the amber edge and keyboard focus together, so typing goes to the tile you see focused.
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
  const focused = space.focusedLeafId;

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
    <div className={`shell${menuOpen ? ' menu-open' : ''}`}>
      <Sidebar
        catalog={catalog}
        onOpen={(id) => openApp(id)}
        onSplit={(dir) => focused && split(focused, dir)}
        canSplit={Boolean(focused)}
        onMenu={() => setMenuOpen(!menuOpen)}
        menuOpen={menuOpen}
        onHelp={() => setHelpOpen(!helpOpen)}
        helpOpen={helpOpen}
      />
      <TileLayout
        layout={space.layout}
        catalog={catalog}
        focusedLeafId={focused}
        viewStates={viewStates}
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
      />
      {helpOpen && <ShortcutsHelp onClose={closeHelp} onClosed={refocusTile} />}
    </div>
  );
}
