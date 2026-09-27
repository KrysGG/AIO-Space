import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface TabMenuActions {
  newTab(): void;
  moveRight(): void;
  moveDown(): void;
  close(): void;
  closeOthers(): void;
}

interface Props extends TabMenuActions {
  title: string;
  /** Where the right-click happened (window coordinates). */
  at: { x: number; y: number };
  /** Room for another tile (MAX_TILES), and the tab isn't the tile's only one. */
  canMove: boolean;
  canClose: boolean;
  onClose(): void;
  onClosed(): void;
}

/**
 * Right-click menu for a Browser tab (D-049). It overlaps the tiles, so native views are hidden while
 * it's open, like the other popovers. `onClose`/`onClosed` must be stable.
 */
export function TabMenu({ title, at, canMove, canClose, onClose, onClosed, ...actions }: Props) {
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

  const item = (label: string, run: () => void, disabled = false) => (
    <button
      role="menuitem"
      className="ctx-item"
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
        aria-label={`${title} options`}
        style={{ left: pos.x, top: pos.y }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="ctx-title">{title}</div>
        {item('New tab', actions.newTab)}
        <hr />
        {item('Open in new tile to the right', actions.moveRight, !canMove)}
        {item('Open in new tile below', actions.moveDown, !canMove)}
        <hr />
        {item('Close tab', actions.close, !canClose)}
        {item('Close other tabs', actions.closeOthers, !canClose)}
      </div>
    </div>
  );
}
