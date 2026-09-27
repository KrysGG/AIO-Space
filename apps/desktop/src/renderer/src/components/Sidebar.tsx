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
  /** Name of the active space, shown under the menu button when there's more than one. */
  spaceName: string;
  showSpaceName: boolean;
  onHelp(): void;
  helpOpen: boolean;
  onDownloads(): void;
  downloadsOpen: boolean;
  /** Downloads in progress, for the badge on the downloads button. */
  activeDownloads: number;
  /** Something in the menu needs the user's attention once (ROADMAP 3.8): a dot on the menu button. */
  menuNotice: boolean;
  /** Rail hidden down to a thin edge (the setting lives in the workspace). */
  collapsed: boolean;
  onToggleCollapsed(): void;
}

/** Left rail: menu, one button per app, and layout actions. Never covered by native views. */
export function Sidebar({ catalog, unread, onOpen, onSplit, canSplit, onMenu, menuOpen, spaceName, showSpaceName, onHelp, helpOpen, onDownloads, downloadsOpen, activeDownloads, menuNotice, collapsed, onToggleCollapsed }: Props) {
  const attention = menuNotice || Object.values(unread).some(Boolean) || activeDownloads > 0;
  if (collapsed) {
    return (
      <nav className="rail is-collapsed" aria-label="Apps">
        <button className="rail-edge" onClick={onToggleCollapsed} title="Show sidebar (Ctrl+Shift+B)" aria-label="Show sidebar">
          <span className="rail-edge-handle" />
          {attention && <i className="rail-edge-dot" aria-label="Something needs attention" />}
        </button>
      </nav>
    );
  }
  return (
    <nav className="rail" aria-label="Apps">
      <button className="rail-btn rail-menu" title={`Menu (space: ${spaceName})`} aria-label={`Menu, space ${spaceName}`} aria-expanded={menuOpen} onClick={onMenu}>
        <span />
        <span />
        <span />
        {menuNotice && <i className="rail-notice" aria-label="Needs attention" />}
      </button>
      {showSpaceName && (
        <button className="rail-space" onClick={onMenu} title={`Space: ${spaceName}`} aria-hidden tabIndex={-1}>
          {spaceName}
        </button>
      )}

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
        <button className="rail-btn" onClick={onToggleCollapsed} title="Hide sidebar (Ctrl+Shift+B)" aria-label="Hide sidebar">
          <svg viewBox="0 0 20 20" aria-hidden><rect x="2.5" y="3.5" width="15" height="13" rx="2" /><path d="M7.5 3.5v13M13.5 8l-2 2 2 2" /></svg>
        </button>
      </div>
    </nav>
  );
}
