import { useEffect, useMemo, useState } from 'react';
import { STORE_MARKS } from './BrandMarks';
import { installedFromStore, searchStore, STORE_CATEGORIES, type StoreApp, type StoreCategory, type WebAppDef } from '@aio/core';

type Tab = StoreCategory | 'Popular' | 'All';
const TABS: Tab[] = ['Popular', ...STORE_CATEGORIES, 'All'];

interface Props {
  catalog: WebAppDef[];
  /** Add the entry as an app; returns an error message, or null when added. */
  onInstall(entry: StoreApp): string | null;
  /** Open an added app in the focused tile (and close the store). */
  onOpen(appId: string): void;
  /** "Add any website": the manual form. */
  onCustom(): void;
  onClose(): void;
  onClosed(): void;
}

/**
 * The app store: popular web apps to add in one click, plus "Add any website". A modal over the
 * tiles, so native views are hidden while it's open. Callbacks must be stable where noted in App.
 */
export function AppStore({ catalog, onInstall, onOpen, onCustom, onClose, onClosed }: Props) {
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<Tab>('Popular');
  const [error, setError] = useState<string | null>(null);

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

  const apps = useMemo(() => searchStore(query, tab), [query, tab]);

  return (
    <div className="popover-backdrop modal-backdrop" onPointerDown={onClose}>
      <div className="popover modal store" role="dialog" aria-label="App store" onPointerDown={(e) => e.stopPropagation()}>
        <header className="store-head">
          <div>
            <h2 className="store-title">App store</h2>
            <p className="popover-hint">Popular web apps, each with its own login and Shields.</p>
          </div>
          <input
            className="store-search"
            type="search"
            placeholder="Search apps"
            aria-label="Search apps"
            value={query}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
          />
        </header>

        {!query && (
          <nav className="store-tabs" aria-label="Categories">
            {TABS.map((t) => (
              <button key={t} className={`store-tab${t === tab ? ' is-active' : ''}`} aria-pressed={t === tab} onClick={() => setTab(t)}>
                {t}
              </button>
            ))}
          </nav>
        )}

        {error && <p className="form-error">{error}</p>}

        <ul className="store-grid">
          {apps.map((entry) => {
            const added = installedFromStore(entry, catalog);
            return (
              <li key={entry.id} className="store-card">
                <span className="store-mono" style={{ background: entry.color }} aria-hidden>
                  {STORE_MARKS[entry.id] ? (
                    <svg viewBox="0 0 24 24">
                      <path d={STORE_MARKS[entry.id]} />
                    </svg>
                  ) : (
                    entry.name[0]
                  )}
                </span>
                <span className="store-info">
                  <span className="store-name">
                    <strong>{entry.name}</strong>
                    {entry.drm && (
                      <span className="store-pill" title="Its videos or music use Widevine DRM, which this version of SpaceAIO can’t play yet. Browsing and signing in work.">
                        DRM
                      </span>
                    )}
                  </span>
                  <small>{entry.description}</small>
                </span>
                {added ? (
                  <button className="btn" onClick={() => onOpen(added.id)} title={`Open ${entry.name} in the focused tile`}>
                    Open
                  </button>
                ) : (
                  <button className="btn btn-primary" onClick={() => setError(onInstall(entry))}>
                    Add
                  </button>
                )}
              </li>
            );
          })}
          {apps.length === 0 && <li className="store-empty">No apps match “{query}”. You can add any website below.</li>}
        </ul>

        <footer className="store-foot">
          <button className="text-btn" onClick={onCustom}>
            + Add any website
          </button>
          <span className="popover-hint">Submitting apps to the store is coming later.</span>
        </footer>
      </div>
    </div>
  );
}
