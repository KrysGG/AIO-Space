import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  computeLayout,
  ratioFromPointer,
  type DividerRect,
  type LayoutNode,
  type SplitDirection,
  type WebAppDef,
} from '@aio/core';
import type { ViewPlacement, ViewState } from '../../../shared/ipc';
import { Launcher } from './Launcher';

const GUTTER = 6;
const HEADER = 34;

interface Props {
  layout: LayoutNode;
  catalog: WebAppDef[];
  focusedLeafId: string | null;
  viewStates: Record<string, ViewState>;
  onFocus(leafId: string): void;
  onResize(splitId: string, ratio: number): void;
  onOpenApp(appId: string, leafId: string): void;
  onSplit(leafId: string, dir: SplitDirection): void;
  onClose(leafId: string): void;
  onClear(leafId: string): void;
}

export function TileLayout(props: Props) {
  const { layout, catalog, focusedLeafId, viewStates } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [dragging, setDragging] = useState<DividerRect | null>(null);

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

  // Tell main where each native view goes (tile body = tile rect minus header).
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el || size.width === 0) return;
    const origin = el.getBoundingClientRect();
    const placements: ViewPlacement[] = computed.tiles
      .filter((t): t is typeof t & { appId: string } => t.appId !== null)
      .map((t) => ({
        leafId: t.leafId,
        appId: t.appId,
        bounds: {
          x: Math.round(origin.left + t.rect.x),
          y: Math.round(origin.top + t.rect.y + HEADER),
          width: Math.max(0, t.rect.width),
          height: Math.max(0, t.rect.height - HEADER),
        },
      }));
    window.aio.syncViews(placements);
  }, [computed, size]);

  // Divider drag. Native views are hidden while dragging, otherwise they swallow pointer events.
  useEffect(() => {
    if (!dragging) return;
    window.aio.setViewsHidden(true);
    const origin = containerRef.current!.getBoundingClientRect();
    const move = (e: PointerEvent): void =>
      props.onResize(
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

  const appName = (id: string | null): string => catalog.find((a) => a.id === id)?.name ?? 'Empty tile';

  return (
    <main className={`tiles${dragging ? ' is-dragging' : ''}`} ref={containerRef}>
      {computed.tiles.map((t) => {
        // A state from the tile's previous app (or a view being destroyed) must not show.
        const raw = viewStates[t.leafId];
        const state = raw && raw.appId === t.appId ? raw : undefined;
        const isFocused = t.leafId === focusedLeafId;
        return (
          <section
            key={t.leafId}
            className={`tile${isFocused ? ' is-focused' : ''}`}
            style={{ left: t.rect.x, top: t.rect.y, width: t.rect.width, height: t.rect.height }}
            onPointerDown={() => props.onFocus(t.leafId)}
            aria-label={appName(t.appId)}
          >
            <header className="tile-head" style={{ height: HEADER }}>
              <span className="tile-title">
                {state?.loading && <span className="tile-spinner" aria-label="Loading" />}
                {state?.title || appName(t.appId)}
              </span>
              <div className="tile-tools">
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
                <Launcher catalog={catalog} onPick={(id) => props.onOpenApp(id, t.leafId)} />
              ) : (
                // The native view covers this area. It shows only while views are hidden or loading.
                <div className="tile-placeholder">
                  {state?.crashed ? 'This app stopped. Press reload to restart it.' : appName(t.appId)}
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
