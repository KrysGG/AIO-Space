import type { WebAppDef } from '@aio/core';
import { AppIcon } from './AppIcon';

/** Shown inside an empty tile. Picking an app loads it into this tile; "Add app" adds your own. */
export function Launcher({
  catalog,
  onPick,
  onAddApp,
  onRemoveApp,
}: {
  catalog: WebAppDef[];
  onPick(appId: string): void;
  onAddApp(): void;
  onRemoveApp(appId: string): void;
}) {
  return (
    <div className="launcher">
      <p className="launcher-title">Open an app in this tile</p>
      <div className="launcher-grid">
        {catalog.map((app) => (
          <div key={app.id} className="launcher-cell">
            <button className="launcher-item" onClick={() => onPick(app.id)}>
              <span className="launcher-glyph">
                <AppIcon app={app} size={24} />
              </span>
              <span className="launcher-name">{app.name}</span>
            </button>
            {app.id.startsWith('custom-') && (
              <button className="launcher-remove" title={`Remove ${app.name}`} aria-label={`Remove ${app.name}`} onClick={() => onRemoveApp(app.id)}>
                <svg viewBox="0 0 20 20" aria-hidden>
                  <path d="m6 6 8 8M14 6l-8 8" />
                </svg>
              </button>
            )}
          </div>
        ))}
        <div className="launcher-cell">
          <button className="launcher-item launcher-add" onClick={onAddApp}>
            <span className="launcher-glyph" aria-hidden>
              +
            </span>
            <span className="launcher-name">Add app</span>
          </button>
        </div>
      </div>
    </div>
  );
}
