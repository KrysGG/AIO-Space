import { useEffect } from 'react';
import type { WebAppDef } from '@aio/core';
import type { ExtensionInfo } from '../../../shared/ipc';

interface Props {
  app: WebAppDef;
  leafId: string;
  installed: ExtensionInfo[];
  enabled: string[];
  onToggle(extensionId: string, on: boolean): void;
  onClose(): void;
  onClosed(): void;
}

/**
 * Chrome extensions for one app (ROADMAP 4.5), from the puzzle button in its tile header: which
 * installed extensions run in this app, and their popup and options pages. Hides views while open.
 */
export function ExtensionsPanel({
  app,
  leafId,
  installed,
  enabled,
  onToggle,
  onClose,
  onClosed,
}: Props) {
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

  const toggle = (ext: ExtensionInfo, on: boolean): void => {
    if (on) {
      const discord =
        app.id === 'discord'
          ? '\n\nDiscord’s terms don’t allow modifying its app; this could get your account banned.'
          : '';
      const ok = window.confirm(
        `Turn on “${ext.name}” for ${app.name}?\n\nIt can read and change everything on ${app.name}’s pages, including your messages and account details.${discord}\n\n${app.name} reloads.`,
      );
      if (!ok) return;
    }
    onToggle(ext.id, on);
  };

  const open = (ext: ExtensionInfo, page: 'popup' | 'options'): void => {
    onClose(); // views come back first; the page opens in its own window
    window.aio.openExtensionPage(leafId, ext.id, page);
  };

  return (
    <div className="popover-backdrop" onPointerDown={onClose}>
      <div
        className="popover shields-panel"
        role="dialog"
        aria-label={`Extensions for ${app.name}`}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <h2 className="popover-title">Extensions for {app.name}</h2>
        <p className="popover-hint">
          Each app runs only the extensions you turn on for it. Extensions that change pages
          usually work; features that need browser tabs (per-site popups, autofill) may not.
        </p>
        <ul className="plugin-list">
          {installed.map((ext) => {
            const on = enabled.includes(ext.id);
            return (
              <li key={ext.id}>
                <label className="shield-switch">
                  <span>
                    {ext.name} <span className="plugin-version">{ext.version}</span>
                    {ext.description && <small>{ext.description}</small>}
                  </span>
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={(e) => toggle(ext, e.target.checked)}
                  />
                </label>
                {on && ext.popup && (
                  <button className="text-btn" onClick={() => open(ext, 'popup')}>
                    Popup
                  </button>
                )}
                {on && ext.options && (
                  <button className="text-btn" onClick={() => open(ext, 'options')}>
                    Options
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
