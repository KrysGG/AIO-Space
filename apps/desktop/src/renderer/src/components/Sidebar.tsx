import { useState } from 'react';
import type { SplitDirection, Unread, WebAppDef } from '@aio/core';
import { AppIcon } from './AppIcon';
import { UnreadBadge } from './UnreadBadge';
import { MediaDot, mergeMedia } from './MediaIndicators';
import type { MediaInUse } from '../../../shared/webapp';

/** Drag data type for sidebar apps: reordered in the sidebar (ROADMAP 4.7), dropped onto tiles (2.16). */
export const RAIL_APP_DRAG = 'application/x-aio-rail-app';

interface Props {
  /** The sidebar's apps in display order (pinned first). */
  catalog: WebAppDef[];
  /** Pinned app ids: shown in their own group at the top, which doesn't scroll. */
  pinned: string[];
  /** Drag and drop: put `appId` before or after `targetId` (joining its group). */
  onReorder(appId: string, targetId: string, after: boolean): void;
  /** Unread per app id, summed over its tiles. */
  unread: Record<string, Unread>;
  /** Microphone/camera/screen in use per app id. */
  media: Record<string, MediaInUse>;
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
  /** Opens the app store. */
  onAddApp(): void;
  /** Right-click on an app: its options menu at the pointer. */
  onAppMenu(appId: string, at: { x: number; y: number }): void;
}

/** Left rail: menu, one button per app, and layout actions. Never covered by native views. */
export function Sidebar({ catalog, pinned, onReorder, unread, media, onOpen, onSplit, canSplit, onMenu, menuOpen, spaceName, showSpaceName, onHelp, helpOpen, onDownloads, downloadsOpen, activeDownloads, menuNotice, collapsed, onToggleCollapsed, onAddApp, onAppMenu }: Props) {
  /** Where a dragged app would land: before or after which app. */
  const [drop, setDrop] = useState<{ id: string; after: boolean } | null>(null);
  const appButton = (app: WebAppDef) => (
    <button
      key={app.id}
      className={`rail-btn app-glyph${drop?.id === app.id ? (drop.after ? ' is-drop-after' : ' is-drop-before') : ''}`}
      title={`Open ${app.name} in the focused tile (drag to reorder)`}
      aria-label={`Open ${app.name}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(RAIL_APP_DRAG, app.id);
        e.dataTransfer.effectAllowed = 'move';
        // It may be dropped onto a tile: the pages would swallow the drag, so hide them (snapshots show).
        window.aio.setViewsHidden(true);
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(RAIL_APP_DRAG)) return;
        e.preventDefault();
        const r = e.currentTarget.getBoundingClientRect();
        const after = e.clientY > r.top + r.height / 2;
        if (drop?.id !== app.id || drop.after !== after) setDrop({ id: app.id, after });
      }}
      onDragLeave={() => setDrop((d) => (d?.id === app.id ? null : d))}
      onDrop={(e) => {
        e.preventDefault();
        const dragged = e.dataTransfer.getData(RAIL_APP_DRAG);
        if (dragged && drop) onReorder(dragged, app.id, drop.after);
        setDrop(null);
      }}
      onDragEnd={() => {
        setDrop(null);
        window.aio.setViewsHidden(false);
      }}
      onClick={() => onOpen(app.id)}
      onContextMenu={(e) => {
        e.preventDefault();
        onAppMenu(app.id, { x: e.clientX, y: e.clientY });
      }}
    >
      <AppIcon app={app} size={20} />
      <UnreadBadge unread={unread[app.id] ?? null} className="rail-badge" />
      <MediaDot media={media[app.id]} className="rail-media" />
    </button>
  );
  const pinnedApps = catalog.filter((a) => pinned.includes(a.id));
  const otherApps = catalog.filter((a) => !pinned.includes(a.id));
  const attention = menuNotice || Object.values(unread).some(Boolean) || activeDownloads > 0;
  // One structure for both states, so the width can animate while the buttons fade out and the edge
  // fades in. `inert` keeps the hidden half out of the tab order and away from the pointer.
  return (
    <nav className={`rail${collapsed ? ' is-collapsed' : ''}`} aria-label="Apps">
      <button className="rail-edge" onClick={onToggleCollapsed} title="Show sidebar (Ctrl+Shift+B)" aria-label="Show sidebar" inert={!collapsed}>
        <span className="rail-edge-handle" />
        {attention && <i className="rail-edge-dot" aria-label="Something needs attention" />}
        <MediaDot media={Object.values(media).reduce<MediaInUse | undefined>((a, m) => mergeMedia(a, m), undefined)} className="rail-edge-media" />
      </button>
      <div className="rail-inner" inert={collapsed}>
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

        {pinnedApps.length > 0 && (
          <div className="rail-pinned" role="group" aria-label="Pinned apps">
            {pinnedApps.map(appButton)}
          </div>
        )}
        <div className="rail-apps">
          {otherApps.map(appButton)}
          <button className="rail-btn rail-add" onClick={onAddApp} title="Add an app (app store)" aria-label="Add an app">
            <svg viewBox="0 0 20 20" aria-hidden><path d="M10 4.5v11M4.5 10h11" /></svg>
          </button>
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
      </div>
    </nav>
  );
}
