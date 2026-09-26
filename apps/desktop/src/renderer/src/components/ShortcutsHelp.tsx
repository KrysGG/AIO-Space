import { useEffect } from 'react';

/** Keep in step with shortcutFor() in main/shortcuts.ts. */
const SHORTCUTS: Array<[keys: string, action: string]> = [
  ['Ctrl+Alt+Arrow keys', 'Move focus to the next tile'],
  ['Ctrl+1 to Ctrl+9', 'Focus tile 1 to 9'],
  ['Ctrl+Shift+D', 'Split right'],
  ['Ctrl+Shift+E', 'Split down'],
  ['Ctrl+W', 'Close tile'],
  ['Ctrl+R', 'Reload tile'],
  ['Ctrl+L', 'Go to the address bar (Browser tile)'],
  ['Ctrl+Plus / Ctrl+Minus', 'Zoom the tile in or out (also Ctrl+wheel)'],
  ['Ctrl+0', 'Reset the tile’s zoom'],
  ['Ctrl+/', 'Show or hide this list'],
];

/**
 * Popover next to the rail. It overlaps the tile area, so native views are hidden while it's open
 * and keyboard focus moves to the UI so Escape reaches it. `onClosed` runs after the views are shown
 * again. Both callbacks must be stable.
 */
export function ShortcutsHelp({ onClose, onClosed }: { onClose(): void; onClosed(): void }) {
  useEffect(() => {
    window.aio.setViewsHidden(true);
    window.aio.focusView(null);
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.aio.setViewsHidden(false);
      onClosed();
    };
  }, [onClose, onClosed]);

  return (
    <div className="popover-backdrop" onPointerDown={onClose}>
      <div className="shortcuts" role="dialog" aria-label="Keyboard shortcuts" onPointerDown={(e) => e.stopPropagation()}>
        <h2 className="shortcuts-title">Keyboard shortcuts</h2>
        <dl className="shortcuts-list">
          {SHORTCUTS.map(([keys, action]) => (
            <div key={keys} className="shortcuts-row">
              <dt>
                <kbd>{keys}</kbd>
              </dt>
              <dd>{action}</dd>
            </div>
          ))}
        </dl>
        <p className="shortcuts-hint">Work in every tile, even while a web page has focus. Press Escape to close.</p>
      </div>
    </div>
  );
}
