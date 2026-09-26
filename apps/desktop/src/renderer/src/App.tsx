import { useCallback, useEffect, useRef, useState } from 'react';
import {
  activeSpace,
  assignApp,
  ensureFocus,
  removeLeaf,
  setRatio,
  splitLeaf,
  updateActiveSpace,
  type SplitDirection,
  type WebAppDef,
  type Workspace,
} from '@aio/core';
import type { ViewState } from '../../shared/ipc';
import { Sidebar } from './components/Sidebar';
import { TileLayout } from './components/TileLayout';

const SAVE_DELAY_MS = 300;

export function App() {
  const [ws, setWs] = useState<Workspace | null>(null);
  const [catalog, setCatalog] = useState<WebAppDef[]>([]);
  const [viewStates, setViewStates] = useState<Record<string, ViewState>>({});
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const saveTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    Promise.all([window.aio.getWorkspace(), window.aio.getCatalog()])
      .then(([w, c]) => {
        setWs(w);
        setCatalog(c);
      })
      .catch((e: unknown) => setError(String(e)));
    const offState = window.aio.onViewState((s) => setViewStates((prev) => ({ ...prev, [s.leafId]: s })));
    const offFocus = window.aio.onViewFocused((leafId) =>
      setWs((prev) => (prev ? updateActiveSpace(prev, (s) => ({ ...s, focusedLeafId: leafId })) : prev)),
    );
    return () => {
      offState();
      offFocus();
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

  return (
    <div className={`shell${menuOpen ? ' menu-open' : ''}`}>
      <Sidebar
        catalog={catalog}
        onOpen={(id) => openApp(id)}
        onSplit={(dir) => focused && split(focused, dir)}
        canSplit={Boolean(focused)}
        onMenu={() => setMenuOpen(!menuOpen)}
        menuOpen={menuOpen}
      />
      <TileLayout
        layout={space.layout}
        catalog={catalog}
        focusedLeafId={focused}
        viewStates={viewStates}
        onFocus={(leafId) => edit((w) => updateActiveSpace(w, (s) => ({ ...s, focusedLeafId: leafId })))}
        onResize={(splitId, ratio) => edit((w) => updateActiveSpace(w, (s) => ({ ...s, layout: setRatio(s.layout, splitId, ratio) })))}
        onOpenApp={openApp}
        onSplit={split}
        onClose={close}
        onClear={clear}
      />
    </div>
  );
}
