import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { WebAppDef } from '@aio/core';

export interface RailMenuActions {
  open(): void;
  openInNewTile(): void;
  moveUp(): void;
  moveDown(): void;
  hide(): void;
  /** Custom apps only. */
  remove?(): void;
}

interface Props extends RailMenuActions {
  app: WebAppDef;
  /** Where the right-click happened (window coordinates). */
  at: { x: number; y: number };
  canMoveUp: boolean;
  canMoveDown: boolean;
  onClose(): void;
  onClosed(): void;
}

/**
 * Right-click menu for an app in the sidebar: open, reorder, hide, remove. It overlaps the tiles, so
 * native views are hidden while it's open (like the other popovers). `onClose`/`onClosed` must be stable.
 */
export function RailMenu({ app, at, canMoveUp, canMoveDown, onClose, onClosed, ...actions }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(at);

  useEffect(() => {
    window.aio.setViewsHidden(true);
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      window.aio.setViewsHidden(false);
      onClosed();
    };
  }, [onClose, onClosed]);

  // Keep the menu inside the window.
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setPos({ x: Math.min(at.x, window.innerWidth - r.width - 8), y: Math.min(at.y, window.innerHeight - r.height - 8) });
  }, [at]);

  const item = (label: string, run: () => void, disabled = false, danger = false) => (
    <button
      role="menuitem"
      className={`ctx-item${danger ? ' is-danger' : ''}`}
      disabled={disabled}
      onClick={() => {
        onClose();
        run();
      }}
    >
      {label}
    </button>
  );

  return (
    <div className="popover-backdrop" onPointerDown={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }}>
      <div
        ref={ref}
        className="ctx-menu"
        role="menu"
        aria-label={`${app.name} options`}
        style={{ left: pos.x, top: pos.y }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="ctx-title">{app.name}</div>
        {item('Open here', actions.open)}
        {item('Open in a new tile', actions.openInNewTile)}
        <hr />
        {item('Move up', actions.moveUp, !canMoveUp)}
        {item('Move down', actions.moveDown, !canMoveDown)}
        <hr />
        {item('Hide from sidebar', actions.hide)}
        {actions.remove && item('Remove app…', actions.remove, false, true)}
      </div>
    </div>
  );
}
