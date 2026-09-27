import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  computeLayout,
  ratioFromPointer,
  tileBodyRect,
  titleWithoutUnread,
  zoomLabel,
  unreadFromTitle,
  type DividerRect,
  type AppProfile,
  type LayoutNode,
  type Rect,
  type SearchEngineId,
  type SplitDirection,
  type WebAppDef,
} from '@aio/core';
import { TILE_GUTTER, TILE_HEADER, VIEW_INSET, type ViewFrame, type ViewPlacement, type ViewState } from '../../../shared/ipc';
import { AddressBar } from './AddressBar';
import { AppIcon } from './AppIcon';
import { UnreadBadge } from './UnreadBadge';
import { Launcher } from './Launcher';

const GUTTER = TILE_GUTTER;
const HEADER = TILE_HEADER;

const offset = (r: Rect, dx: number, dy: number): Rect => ({ x: Math.round(r.x + dx), y: Math.round(r.y + dy), width: r.width, height: r.height });

interface Props {
  layout: LayoutNode;
  catalog: WebAppDef[];
  focusedLeafId: string | null;
  /** Keyed by instance id. */
  viewStates: Record<string, ViewState>;
  /** Instance ids of apps in other spaces: kept running (hidden) by main. */
  backgroundInstances: string[];
  /** Page snapshots by instance id, shown while the views are hidden (ROADMAP 2.13). */
  snapshots: Record<string, string>;
  searchEngine: SearchEngineId;
  /** Engine picked in a Browser tile's header; the tile follows if it's showing a search engine. */
  onSearchEngine(leafId: string, engine: SearchEngineId): void;
  /** Address bar input from a Browser tile. */
  onNavigate(leafId: string, text: string): void;
  onFocus(leafId: string): void;
  onResize(splitId: string, ratio: number): void;
  onOpenApp(appId: string, leafId: string): void;
  onSplit(leafId: string, dir: SplitDirection): void;
  onClose(leafId: string): void;
  onClear(leafId: string): void;
  /** A tile header was dragged onto another tile. */
  onSwap(fromLeafId: string, toLeafId: string): void;
  /** Accounts of an app (ROADMAP 2.12), the first one included. */
  accountsOf(appId: string): AppProfile[];
  /** Pick an account for a tile, or '+add' to create one. */
  onAccount(leafId: string, profile: string): void;
  /** "Continue with HTTP" on the https fallback panel: remember the site (ROADMAP 3.2). */
  onAllowHttp(host: string): void;
  /** Whether Shields are up for an app (ROADMAP 3.1). */
  shieldsUp(appId: string): boolean;
  onShields(leafId: string): void;
  /** "Add app" in an empty tile's launcher: the new app opens in that tile. */
  onAddApp(leafId: string): void;
  onRemoveApp(appId: string): void;
}

/** Pointer travel before a header press becomes a tile drag (so clicks still work). */
const DRAG_THRESHOLD = 6;

interface TileDrag {
  from: string;
  start: { x: number; y: number };
  active: boolean;
  over: string | null;
}

export function TileLayout(props: Props) {
  const { layout, catalog, focusedLeafId, viewStates } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [dragging, setDragging] = useState<DividerRect | null>(null);
  const [tileDrag, setTileDrag] = useState<TileDrag | null>(null);
  // The live drag for the pointer listeners; `tileDrag` is its rendered copy.
  const tileDragRef = useRef<TileDrag | null>(null);
  const tileDragFrom = tileDrag?.from ?? null;

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return;
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const computed = useMemo(
    () => computeLayout(layout, { x: 0, y: 0, ...size }, GUTTER),
    [layout, size],
  );

  // A string, so a new but equal list from the parent doesn't re-sync every render.
  const keepKey = props.backgroundInstances.join('|');

  // Tell main where each native view goes (tile body = tile rect minus header).
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el || size.width === 0) return;
    const origin = el.getBoundingClientRect();
    const placements: ViewPlacement[] = computed.tiles
      .filter((t): t is typeof t & { appId: string; instanceId: string } => t.appId !== null && t.instanceId !== null)
      .map((t) => ({
        leafId: t.leafId,
        instanceId: t.instanceId,
        appId: t.appId,
        profile: t.profile,
        bounds: offset(tileBodyRect(t.rect, HEADER, VIEW_INSET), origin.left, origin.top),
      }));
    const frame: ViewFrame = {
      layout,
      insets: {
        left: origin.left,
        top: origin.top,
        right: Math.max(0, window.innerWidth - origin.right),
        bottom: Math.max(0, window.innerHeight - origin.bottom),
      },
    };
    window.aio.syncViews(placements, keepKey ? keepKey.split('|') : [], frame);
  }, [computed, size, keepKey, layout]);

  // Latest onResize for the drag listeners, so they aren't re-attached (and views re-shown) every render.
  const onResizeRef = useRef(props.onResize);
  useLayoutEffect(() => {
    onResizeRef.current = props.onResize;
  });

  // Divider drag. Native views are hidden while dragging, otherwise they swallow pointer events.
  useEffect(() => {
    if (!dragging) return;
    window.aio.setViewsHidden(true);
    const origin = containerRef.current!.getBoundingClientRect();
    const move = (e: PointerEvent): void =>
      onResizeRef.current(
        dragging.splitId,
        ratioFromPointer(dragging.direction, dragging.parentRect, {
          x: e.clientX - origin.left,
          y: e.clientY - origin.top,
        }),
      );
    const end = (): void => setDragging(null);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    window.addEventListener('blur', end); // released outside the window / focus lost
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      window.removeEventListener('blur', end);
      window.aio.setViewsHidden(false);
    };
  }, [dragging]);

  // Latest onSwap for the tile-drag listeners (same reason as onResizeRef).
  const onSwapRef = useRef(props.onSwap);
  useLayoutEffect(() => {
    onSwapRef.current = props.onSwap;
  });

  // Tile drag: press a header, move past the threshold, drop on another tile to swap their apps.
  // Views hide once the drag starts; they would swallow the pointer (like divider drags, D-006).
  useEffect(() => {
    if (!tileDragFrom) return;
    let activated = false; // views were hidden by this drag and must come back
    const update = (next: TileDrag | null): void => {
      tileDragRef.current = next;
      setTileDrag(next);
    };
    const tileAt = (e: PointerEvent): string | null =>
      (document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-leaf-id]') as HTMLElement | null)?.dataset['leafId'] ?? null;
    const move = (e: PointerEvent): void => {
      const d = tileDragRef.current;
      if (!d) return;
      if (!d.active && Math.hypot(e.clientX - d.start.x, e.clientY - d.start.y) < DRAG_THRESHOLD) return;
      if (!d.active) {
        activated = true;
        window.aio.setViewsHidden(true);
      }
      const over = tileAt(e);
      if (d.active && over === d.over) return;
      update({ ...d, active: true, over });
    };
    const drop = (e: PointerEvent): void => {
      const d = tileDragRef.current;
      if (d?.active) {
        const target = tileAt(e);
        if (target && target !== d.from) onSwapRef.current(d.from, target);
      }
      update(null);
    };
    const cancel = (): void => update(null);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', drop);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('blur', cancel);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', drop);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('blur', cancel);
      if (activated) window.aio.setViewsHidden(false);
    };
  }, [tileDragFrom]);

  const appName = (id: string | null): string => appOf(id)?.name ?? 'Empty tile';
  const appOf = (id: string | null): WebAppDef | undefined => catalog.find((a) => a.id === id);
  const isBrowser = (id: string | null): boolean => appOf(id)?.kind === 'browser';

  return (
    <main className={`tiles${dragging ? ' is-dragging' : ''}${tileDrag?.active ? ' is-moving-tile' : ''}`} ref={containerRef}>
      {computed.tiles.map((t) => {
        // States are keyed by running instance, so they follow an app when tiles are swapped.
        const state = t.instanceId ? viewStates[t.instanceId] : undefined;
        const isFocused = t.leafId === focusedLeafId;
        return (
          <section
            key={t.leafId}
            data-leaf-id={t.leafId}
            className={[
              'tile',
              isFocused && 'is-focused',
              tileDrag?.active && tileDrag.from === t.leafId && 'is-drag-source',
              tileDrag?.active && tileDrag.over === t.leafId && tileDrag.from !== t.leafId && 'is-drop-target',
            ]
              .filter(Boolean)
              .join(' ')}
            style={{ left: t.rect.x, top: t.rect.y, width: t.rect.width, height: t.rect.height }}
            onPointerDown={() => props.onFocus(t.leafId)}
            aria-label={appName(t.appId)}
          >
            <header
              className="tile-head"
              style={{ height: HEADER }}
              title="Drag onto another tile to swap them"
              onPointerDown={(e) => {
                // Buttons, the address bar and the engine dropdown keep their own clicks.
                if (e.button !== 0 || (e.target as HTMLElement).closest('button, input, select')) return;
                tileDragRef.current = { from: t.leafId, start: { x: e.clientX, y: e.clientY }, active: false, over: null };
                setTileDrag(tileDragRef.current);
              }}
            >
              {isBrowser(t.appId) ? (
                <div className="tile-title tile-title-browser" title={state?.title}>
                  {/* Always-present drag handle: the rest of this header is address bar and buttons. */}
                  <span className="tile-handle">
                    {state?.loading ? (
                      <span className="tile-spinner" aria-label="Loading" />
                    ) : (
                      appOf(t.appId) && <AppIcon app={appOf(t.appId)!} size={14} />
                    )}
                  </span>
                  <AddressBar
                    leafId={t.leafId}
                    url={state?.url ?? ''}
                    engine={props.searchEngine}
                    onEngine={(engine) => props.onSearchEngine(t.leafId, engine)}
                    onGo={(text) => props.onNavigate(t.leafId, text)}
                  />
                </div>
              ) : (
                <span className="tile-title">
                  {state?.loading ? (
                    <span className="tile-spinner" aria-label="Loading" />
                  ) : (
                    appOf(t.appId) && <AppIcon app={appOf(t.appId)!} size={14} />
                  )}
                  <span className="tile-title-text">{state?.title ? titleWithoutUnread(state.title) : appName(t.appId)}</span>
                  <UnreadBadge unread={state ? unreadFromTitle(state.title) : null} />
                </span>
              )}
              <div className="tile-tools">
                {t.appId && (isFocused || props.accountsOf(t.appId).length > 1) && (
                  <select
                    className="account-select"
                    aria-label="Account"
                    title="Account: each has its own login"
                    value={t.profile}
                    onChange={(e) => props.onAccount(t.leafId, e.target.value)}
                  >
                    {props.accountsOf(t.appId).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                    <option value="+add">+ Add account</option>
                  </select>
                )}
                {t.appId && (
                  <button
                    className={`shield-btn${props.shieldsUp(t.appId) ? '' : ' is-down'}`}
                    title={props.shieldsUp(t.appId) ? `Shields: ${state?.blocked ?? 0} blocked on this page` : 'Shields are down for this app'}
                    aria-label={props.shieldsUp(t.appId) ? `Shields, ${state?.blocked ?? 0} blocked` : 'Shields down'}
                    onClick={() => props.onShields(t.leafId)}
                  >
                    <svg viewBox="0 0 20 20" aria-hidden>
                      <path d="M10 2.5 4 5v4.5c0 3.8 2.6 6.6 6 8 3.4-1.4 6-4.2 6-8V5z" />
                      {!props.shieldsUp(t.appId) && <path d="m4 4 12 12" />}
                    </svg>
                    {props.shieldsUp(t.appId) && (state?.blocked ?? 0) > 0 && <span>{state!.blocked > 99 ? '99+' : state!.blocked}</span>}
                  </button>
                )}
                {t.appId && state && Math.abs(state.zoom - 1) > 0.001 && (
                  <button className="zoom-badge" title="Reset zoom (Ctrl+0)" aria-label={`Zoom ${zoomLabel(state.zoom)}, reset`} onClick={() => window.aio.viewCommand(t.leafId, 'zoom-reset')}>
                    {zoomLabel(state.zoom)}
                  </button>
                )}
                {t.appId && (
                  <>
                    <IconBtn label="Back" disabled={!state?.canGoBack} onClick={() => window.aio.viewCommand(t.leafId, 'back')} d="M12 5 7 10l5 5" />
                    <IconBtn label="Forward" disabled={!state?.canGoForward} onClick={() => window.aio.viewCommand(t.leafId, 'forward')} d="m8 5 5 5-5 5" />
                    <IconBtn label="Reload" onClick={() => window.aio.viewCommand(t.leafId, 'reload')} d="M15 10a5 5 0 1 1-1.5-3.6M15 4v3h-3" />
                    <IconBtn label="Change app" onClick={() => props.onClear(t.leafId)} d="M4 4h5v5H4zM11 4h5v5h-5zM4 11h5v5H4zM11 11h5v5h-5z" />
                  </>
                )}
                <IconBtn label="Split right" onClick={() => props.onSplit(t.leafId, 'row')} d="M3 4h14v12H3zM10 4v12" />
                <IconBtn label="Split down" onClick={() => props.onSplit(t.leafId, 'column')} d="M3 4h14v12H3zM3 10h14" />
                <IconBtn label="Close tile" onClick={() => props.onClose(t.leafId)} d="m5 5 10 10M15 5 5 15" />
              </div>
            </header>
            <div className="tile-body">
              {t.appId === null ? (
                <Launcher
                  catalog={catalog}
                  onPick={(id) => props.onOpenApp(id, t.leafId)}
                  onAddApp={() => props.onAddApp(t.leafId)}
                  onRemoveApp={props.onRemoveApp}
                />
              ) : (
                // The native view covers this area. It shows only while views are hidden or loading;
                // while hidden for a drag or popover, a snapshot of the page stands in for it.
                <div className="tile-placeholder">
                  {state?.httpsFailed ? (
                    <div className="https-failed" role="alert">
                      <svg viewBox="0 0 20 20" aria-hidden>
                        <path d="M6 9V6.5a4 4 0 0 1 8 0V9M4.5 9h11v8h-11z" />
                        <path d="m3 3 14 14" />
                      </svg>
                      <h3>{state.httpsFailed.host} doesn’t offer a secure connection</h3>
                      <p>
                        AIO Space tried the secure (https) version and it didn’t work ({state.httpsFailed.error}). The site may only
                        support http, where anyone on your network can see and change what you send and receive.
                      </p>
                      <div className="form-actions">
                        <button className="btn" onClick={() => window.aio.viewCommand(t.leafId, 'back')}>
                          Go back
                        </button>
                        <button
                          className="btn btn-warn"
                          onClick={() => {
                            props.onAllowHttp(state.httpsFailed!.host);
                            window.aio.viewCommand(t.leafId, 'allow-http');
                          }}
                        >
                          Continue with HTTP (not secure)
                        </button>
                      </div>
                      <small>The choice is remembered for {state.httpsFailed.host}. You can undo it in the menu.</small>
                    </div>
                  ) : t.instanceId && props.snapshots[t.instanceId] ? (
                    <>
                      {/* Blurred fill for any area the still doesn't cover yet (the tile grew), under the sharp still. */}
                      <img className="tile-snapshot-fill" src={props.snapshots[t.instanceId]} alt="" draggable={false} />
                      <img className="tile-snapshot" src={props.snapshots[t.instanceId]} alt="" draggable={false} />
                    </>
                  ) : state?.crashed ? (
                    'This app stopped. Press reload to restart it.'
                  ) : (
                    appName(t.appId)
                  )}
                </div>
              )}
            </div>
          </section>
        );
      })}

      {computed.dividers.map((d) => (
        <div
          key={d.splitId}
          className={`divider divider-${d.direction}`}
          role="separator"
          aria-orientation={d.direction === 'row' ? 'vertical' : 'horizontal'}
          style={{ left: d.rect.x, top: d.rect.y, width: d.rect.width, height: d.rect.height }}
          onPointerDown={(e) => {
            e.preventDefault();
            e.currentTarget.setPointerCapture(e.pointerId);
            setDragging(d);
          }}
        />
      ))}
    </main>
  );
}

function IconBtn(p: { label: string; d: string; onClick(): void; disabled?: boolean }) {
  return (
    <button className="icon-btn" title={p.label} aria-label={p.label} disabled={p.disabled} onClick={p.onClick}>
      <svg viewBox="0 0 20 20" aria-hidden>
        <path d={p.d} />
      </svg>
    </button>
  );
}
