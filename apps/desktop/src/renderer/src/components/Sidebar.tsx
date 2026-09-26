import type { SplitDirection, Unread, WebAppDef } from '@aio/core';
import { AppIcon } from './AppIcon';
import { UnreadBadge } from './UnreadBadge';

interface Props {
  catalog: WebAppDef[];
  /** Unread per app id, summed over its tiles. */
  unread: Record<string, Unread>;
  onOpen(appId: string): void;
  onSplit(dir: SplitDirection): void;
  canSplit: boolean;
  onMenu(): void;
  menuOpen: boolean;
  onHelp(): void;
  helpOpen: boolean;
  onDownloads(): void;
  downloadsOpen: boolean;
  /** Downloads in progress, for the badge on the downloads button. */
  activeDownloads: number;
}

/** Left rail: menu, one button per app, and layout actions. Never covered by native views. */
export function Sidebar({ catalog, unread, onOpen, onSplit, canSplit, onMenu, menuOpen, onHelp, helpOpen, onDownloads, downloadsOpen, activeDownloads }: Props) {
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
            <AppIcon app={app} size={20} />
            <UnreadBadge unread={unread[app.id] ?? null} className="rail-badge" />
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
        <button
          className="rail-btn"
          onClick={onDownloads}
          aria-expanded={downloadsOpen}
          title="Downloads"
          aria-label={activeDownloads ? `Downloads, ${activeDownloads} in progress` : 'Downloads'}
        >
          <svg viewBox="0 0 20 20" aria-hidden><path d="M10 3v9M6 8.5l4 4 4-4M4 15.5h12" /></svg>
          <UnreadBadge unread={activeDownloads ? { count: activeDownloads, more: false } : null} className="rail-badge rail-badge-info" />
        </button>
        <button className="rail-btn" onClick={onHelp} aria-expanded={helpOpen} title="Keyboard shortcuts (Ctrl+/)" aria-label="Keyboard shortcuts">
          <svg viewBox="0 0 20 20" aria-hidden><rect x="2.5" y="5" width="15" height="10" rx="2" /><path d="M5.5 8h1M9.5 8h1M13.5 8h1M6.5 12h7" /></svg>
        </button>
      </div>
    </nav>
  );
}
