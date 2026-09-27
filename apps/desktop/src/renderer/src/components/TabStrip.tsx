import type { BrowserTab } from '@aio/core';
import { TAB_BAR, type ViewState } from '../../../shared/ipc';

interface Props {
  tabs: BrowserTab[];
  /** Instance id of the tab on screen. */
  active: string | null;
  viewStates: Record<string, ViewState>;
  canMoveToTile: boolean;
  onSelect(instanceId: string): void;
  onClose(instanceId: string): void;
  onNew(): void;
  onMoveToTile(instanceId: string): void;
  /** Right-click on a tab (window coordinates). */
  onMenu(instanceId: string, at: { x: number; y: number }): void;
}

/** What a tab is called: the live page title, the saved one, the site, or "New tab". */
export function tabLabel(tab: BrowserTab, state: ViewState | undefined): string {
  const title = state?.title || tab.title;
  if (title) return title;
  const url = state?.url || tab.url;
  if (url) {
    try {
      return new URL(url).hostname;
    } catch {
      // Not a URL: fall through.
    }
  }
  return 'New tab';
}

/**
 * Browser tile tabs (D-049), shown under the header once a tile has more than one. Middle-click
 * closes a tab; right-click offers moving it into its own tile.
 */
export function TabStrip({ tabs, active, viewStates, canMoveToTile, onSelect, onClose, onNew, onMoveToTile, onMenu }: Props) {
  return (
    <div className="tab-strip" role="tablist" aria-label="Tabs" style={{ height: TAB_BAR }}>
      <div className="tab-list">
        {tabs.map((tab) => {
          const state = viewStates[tab.instanceId];
          const label = tabLabel(tab, state);
          const selected = tab.instanceId === active;
          return (
            <div
              key={tab.instanceId}
              role="tab"
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              className={`tab${selected ? ' is-active' : ''}`}
              title={state?.url || tab.url ? `${label}\n${state?.url || tab.url}` : label}
              onPointerDown={(e) => {
                if (e.button === 0) onSelect(tab.instanceId);
              }}
              // Middle-click closes, as in browsers ('auxclick' is turned off in the UI, so mouseup).
              onMouseUp={(e) => {
                if (e.button === 1) onClose(tab.instanceId);
              }}
              onMouseDown={(e) => {
                if (e.button === 1) e.preventDefault(); // no autoscroll
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                onMenu(tab.instanceId, { x: e.clientX, y: e.clientY });
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') onSelect(tab.instanceId);
              }}
            >
              {state?.loading ? <span className="tile-spinner" aria-label="Loading" /> : <span className="tab-dot" aria-hidden />}
              <span className="tab-title">{label}</span>
              <button
                className="tab-close"
                title="Close tab (Ctrl+W)"
                aria-label={`Close ${label}`}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => onClose(tab.instanceId)}
              >
                <svg viewBox="0 0 20 20" aria-hidden>
                  <path d="m6 6 8 8M14 6l-8 8" />
                </svg>
              </button>
            </div>
          );
        })}
        <button className="tab-new" title="New tab (Ctrl+T)" aria-label="New tab" onClick={onNew}>
          <svg viewBox="0 0 20 20" aria-hidden>
            <path d="M10 5v10M5 10h10" />
          </svg>
        </button>
      </div>
      {active && (
        <button
          className="tab-pop"
          title={canMoveToTile ? 'Open this tab in a new tile' : 'No room for another tile'}
          aria-label="Open this tab in a new tile"
          disabled={!canMoveToTile}
          onClick={() => onMoveToTile(active)}
        >
          <svg viewBox="0 0 20 20" aria-hidden>
            <path d="M3 4h14v12H3zM10 4v12M12.5 10h3M14 8.5v3" />
          </svg>
          <span>Open in new tile</span>
        </button>
      )}
    </div>
  );
}
