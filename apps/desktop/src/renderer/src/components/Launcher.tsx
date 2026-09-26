import type { WebAppDef } from '@aio/core';
import { AppIcon } from './AppIcon';

/** Shown inside an empty tile. Picking an app loads it into this tile. */
export function Launcher({ catalog, onPick }: { catalog: WebAppDef[]; onPick(appId: string): void }) {
  return (
    <div className="launcher">
      <p className="launcher-title">Open an app in this tile</p>
      <div className="launcher-grid">
        {catalog.map((app) => (
          <button key={app.id} className="launcher-item" onClick={() => onPick(app.id)}>
            <span className="launcher-glyph">
              <AppIcon app={app} size={24} />
            </span>
            <span>{app.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
