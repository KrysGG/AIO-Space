import { useEffect, useState } from 'react';
import { listLeaves, MAX_SPACE_NAME, MAX_SPACES, SEARCH_ENGINES, type SearchEngineId, type Workspace } from '@aio/core';

interface Props {
  ws: Workspace;
  onSwitch(spaceId: string): void;
  onAdd(): void;
  onRename(spaceId: string, name: string): void;
  onRemove(spaceId: string): void;
  onSearchEngine(engine: SearchEngineId): void;
  onClose(): void;
  onClosed(): void;
}

/**
 * The rail's menu (ROADMAP 2.8): spaces and settings. A popover over the tile area, so native views
 * are hidden while it's open. `onClose` / `onClosed` must be stable.
 */
export function MenuPanel({ ws, onSwitch, onAdd, onRename, onRemove, onSearchEngine, onClose, onClosed }: Props) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    window.aio.setViewsHidden(true);
    window.aio.focusView(null);
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !(e.target instanceof HTMLInputElement)) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.aio.setViewsHidden(false);
      onClosed();
    };
  }, [onClose, onClosed]);

  const startRename = (id: string, name: string): void => {
    setRenaming(id);
    setDraft(name);
  };
  const finishRename = (): void => {
    if (renaming) onRename(renaming, draft);
    setRenaming(null);
  };

  const remove = (id: string, name: string): void => {
    const space = ws.spaces.find((s) => s.id === id);
    const apps = space ? listLeaves(space.layout).filter((l) => l.appId).length : 0;
    const detail = apps ? ` Its ${apps === 1 ? 'app closes' : `${apps} apps close`}; logins are kept.` : '';
    if (window.confirm(`Delete the space "${name}"?${detail}`)) onRemove(id);
  };

  return (
    <div className="popover-backdrop" onPointerDown={onClose}>
      <div className="popover menu-panel" role="dialog" aria-label="Menu" onPointerDown={(e) => e.stopPropagation()}>
        <section>
          <h2 className="popover-title">Spaces</h2>
          <p className="popover-hint">Each space has its own tiles. Apps in other spaces keep running, so switching is instant.</p>
          <ul className="space-list">
            {ws.spaces.map((s) => {
              const active = s.id === ws.activeSpaceId;
              const count = listLeaves(s.layout).filter((l) => l.appId).length;
              return (
                <li key={s.id} className={`space-row${active ? ' is-active' : ''}`}>
                  {renaming === s.id ? (
                    <input
                      className="space-rename"
                      aria-label={`Rename ${s.name}`}
                      autoFocus
                      value={draft}
                      maxLength={MAX_SPACE_NAME}
                      onChange={(e) => setDraft(e.target.value)}
                      onFocus={(e) => e.currentTarget.select()}
                      onBlur={finishRename}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') finishRename();
                        if (e.key === 'Escape') setRenaming(null);
                      }}
                    />
                  ) : (
                    <button
                      className="space-switch"
                      aria-current={active ? 'true' : undefined}
                      title={active ? 'Current space (double-click to rename)' : `Switch to ${s.name}`}
                      onClick={() => {
                        if (!active) onSwitch(s.id);
                        else onClose();
                      }}
                      onDoubleClick={() => startRename(s.id, s.name)}
                    >
                      <span className="space-name">{s.name}</span>
                      <span className="space-count">{count === 0 ? 'Empty' : `${count} app${count === 1 ? '' : 's'}`}</span>
                    </button>
                  )}
                  <button className="icon-btn" title="Rename" aria-label={`Rename ${s.name}`} onClick={() => startRename(s.id, s.name)}>
                    <svg viewBox="0 0 20 20" aria-hidden>
                      <path d="M4 16h3l8.5-8.5-3-3L4 13z" />
                    </svg>
                  </button>
                  <button
                    className="icon-btn"
                    title={ws.spaces.length > 1 ? 'Delete space' : 'You need at least one space'}
                    aria-label={`Delete ${s.name}`}
                    disabled={ws.spaces.length <= 1}
                    onClick={() => remove(s.id, s.name)}
                  >
                    <svg viewBox="0 0 20 20" aria-hidden>
                      <path d="m5 5 10 10M15 5 5 15" />
                    </svg>
                  </button>
                </li>
              );
            })}
          </ul>
          <button className="text-btn" disabled={ws.spaces.length >= MAX_SPACES} onClick={onAdd}>
            + New space
          </button>
        </section>

        <section>
          <h2 className="popover-title">Settings</h2>
          <label className="setting">
            <span>Search engine for the Browser tile</span>
            <select value={ws.browser.searchEngine} onChange={(e) => onSearchEngine(e.target.value as SearchEngineId)}>
              {Object.values(SEARCH_ENGINES).map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </label>
          {/* TODO(ROADMAP 3.1): Shields settings (global and per app) go here. */}
        </section>
      </div>
    </div>
  );
}
