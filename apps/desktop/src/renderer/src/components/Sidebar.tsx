import type { SplitDirection, WebAppDef } from '@aio/core';

interface Props {
  catalog: WebAppDef[];
  onOpen(appId: string): void;
  onSplit(dir: SplitDirection): void;
  canSplit: boolean;
  onMenu(): void;
  menuOpen: boolean;
  onHelp(): void;
  helpOpen: boolean;
}

/** Left rail: menu, one button per app, and layout actions. Never covered by native views. */
export function Sidebar({ catalog, onOpen, onSplit, canSplit, onMenu, menuOpen, onHelp, helpOpen }: Props) {
  return (
    <nav className="rail" aria-label="Apps">
      {/* TODO(ROADMAP 2.8): menu with spaces, settings, shields panel */}
      <button className="rail-btn rail-menu" title="Menu" aria-label="Menu" aria-expanded={menuOpen} onClick={onMenu}>
        <span />
        <span />
        <span />
      </button>

      <div className="rail-apps">
        {catalog.map((app) => (
          <button
            key={app.id}
            className="rail-btn app-glyph"
            title={`Open ${app.name} in the focused tile`}
            aria-label={`Open ${app.name}`}
            onClick={() => onOpen(app.id)}
          >
            {app.glyph}
          </button>
        ))}
      </div>

      <div className="rail-actions">
        <button className="rail-btn" disabled={!canSplit} onClick={() => onSplit('row')} title="Split right" aria-label="Split focused tile right">
          <svg viewBox="0 0 20 20" aria-hidden><rect x="2.5" y="3.5" width="15" height="13" rx="2" /><line x1="10" y1="3.5" x2="10" y2="16.5" /></svg>
        </button>
        <button className="rail-btn" disabled={!canSplit} onClick={() => onSplit('column')} title="Split down" aria-label="Split focused tile down">
          <svg viewBox="0 0 20 20" aria-hidden><rect x="2.5" y="3.5" width="15" height="13" rx="2" /><line x1="2.5" y1="10" x2="17.5" y2="10" /></svg>
        </button>
        <button className="rail-btn" onClick={onHelp} aria-expanded={helpOpen} title="Keyboard shortcuts (Ctrl+/)" aria-label="Keyboard shortcuts">
          <svg viewBox="0 0 20 20" aria-hidden><rect x="2.5" y="5" width="15" height="10" rx="2" /><path d="M5.5 8h1M9.5 8h1M13.5 8h1M6.5 12h7" /></svg>
        </button>
      </div>
    </nav>
  );
}
