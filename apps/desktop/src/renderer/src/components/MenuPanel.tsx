import { useEffect, useState } from 'react';
import {
  listLeaves,
  MAX_SPACE_NAME,
  MAX_SPACES,
  SEARCH_ENGINES,
  FINGERPRINT_CHOICES,
  TWITCH_AD_SCRIPTS,
  type TwitchAdScript,
  SHIELD_SWITCHES,
  SLEEP_CHOICES,
  WEBRTC_CHOICES,
  type PrivacySettings,
  type SearchEngineId,
  type SleepAfterMinutes,
  type Workspace,
} from '@aio/core';
import { FilterListStatus } from './FilterListStatus';

interface Props {
  ws: Workspace;
  onSwitch(spaceId: string): void;
  onAdd(): void;
  onRename(spaceId: string, name: string): void;
  onRemove(spaceId: string): void;
  onSearchEngine(engine: SearchEngineId): void;
  onSleepAfter(minutes: SleepAfterMinutes): void;
  /** Change a Shields default for all apps (apps with their own setting keep it). */
  onShieldDefault<K extends keyof PrivacySettings>(key: K, value: PrivacySettings[K]): void;
  /** Stop allowing a site over http (it gets upgraded to https again). */
  onDisallowHttp(host: string): void;
  /** Logins aren't protected by a system keyring (ROADMAP 3.8), and the user hasn't dismissed it. */
  keyringNotice: boolean;
  onDismissKeyring(): void;
  onClearAll(): Promise<void>;
  onReduceMotion(on: boolean): void;
  onTwitchScript(script: TwitchAdScript): void;
  onShareGoogle(on: boolean): void;
  onClose(): void;
  onClosed(): void;
}

/**
 * The rail's menu (ROADMAP 2.8): spaces and settings. A popover over the tile area, so native views
 * are hidden while it's open. `onClose` / `onClosed` must be stable.
 */
export function MenuPanel({ ws, onSwitch, onAdd, onRename, onRemove, onSearchEngine, onSleepAfter, onShieldDefault, onDisallowHttp, keyringNotice, onDismissKeyring, onClearAll, onReduceMotion, onTwitchScript, onShareGoogle, onClose, onClosed }: Props) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [clearedAll, setClearedAll] = useState<'idle' | 'busy' | 'done'>('idle');
  const clearAll = (): void => {
    if (!window.confirm('Clear data for every app? You’ll be logged out everywhere, and all cookies, site storage and caches are deleted. Your tiles and settings stay.')) return;
    setClearedAll('busy');
    void onClearAll().then(() => setClearedAll('done'));
  };

  useEffect(() => {
    window.aio.setViewsHidden(true);
    window.aio.focusView(null);
    const onKey = (e: KeyboardEvent): void => {
      // Escape in the space-rename field cancels the rename instead; switches and lists close the menu.
      const typing = e.target instanceof HTMLInputElement && e.target.type === 'text';
      if (e.key === 'Escape' && !typing) onClose();
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
          {keyringNotice && (
            <div className="notice" role="alert">
              <strong>Your logins aren’t protected by a keyring</strong>
              <p>
                AIO Space couldn’t use KWallet or GNOME Keyring, so cookies and logins are saved with a fixed key. Anyone who can read
                your files could use them. Install and unlock KWallet (KDE) or GNOME Keyring (<code>gnome-keyring</code>,{' '}
                <code>libsecret</code>), then restart AIO Space.
              </p>
              <button className="text-btn" onClick={onDismissKeyring}>
                Got it
              </button>
            </div>
          )}
          <label className="shield-switch">
            <span>
              Share Google sign-in between apps
              <small>
                Sign in to Google once and every app’s first account is signed in; signing out signs them all out. Only Google’s
                own cookies are shared, everything else stays in each app. Google can then tell these apps are you.
              </small>
            </span>
            <input type="checkbox" checked={ws.identity.shareGoogle} onChange={(e) => onShareGoogle(e.target.checked)} />
          </label>
          <label className="shield-switch">
            <span>
              Reduce animations and effects
              <small>Instant transitions, no glass blur or page previews. Saves CPU and GPU on slower machines.</small>
            </span>
            <input type="checkbox" checked={ws.ui.reduceMotion} onChange={(e) => onReduceMotion(e.target.checked)} />
          </label>
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
          <label className="setting">
            <span>Sleep apps hidden in other spaces</span>
            <select
              value={String(ws.performance.sleepAfterMinutes)}
              onChange={(e) => onSleepAfter(e.target.value === 'null' ? null : (Number(e.target.value) as SleepAfterMinutes))}
            >
              {SLEEP_CHOICES.map((m) => (
                <option key={String(m)} value={String(m)}>
                  {m === null ? 'Never' : m < 60 ? `After ${m} minutes` : 'After 1 hour'}
                </option>
              ))}
            </select>
          </label>
          <p className="popover-hint">
            Sleeping apps free memory and reload when you open their space. Apps that play audio, use your camera or microphone, or can send
            notifications stay awake.
          </p>
        </section>

        <section>
          <h2 className="popover-title">Shields defaults</h2>
          <p className="popover-hint">For every app. Use the shield in a tile to change one app, or turn its Shields off.</p>
          {SHIELD_SWITCHES.map((s) => (
            <label key={s.key} className="shield-switch">
              <span>
                {s.label}
                <small>{s.hint}</small>
              </span>
              <input type="checkbox" checked={ws.privacy[s.key]} onChange={(e) => onShieldDefault(s.key, e.target.checked)} />
            </label>
          ))}
          <label className="shield-switch">
            <span>
              Block fingerprinting
              <small>Adds invisible noise to canvas, WebGL and audio so sites can’t recognise you across visits. Reloads the app.</small>
            </span>
            <select value={ws.privacy.fingerprinting} onChange={(e) => onShieldDefault('fingerprinting', e.target.value as PrivacySettings['fingerprinting'])}>
              {FINGERPRINT_CHOICES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label className="shield-switch">
            <span>
              Twitch ad blocking
              <small>Skips the ads Twitch puts into streams, using TwitchAdSolutions. Works while Block ads is on. Reloads Twitch.</small>
            </span>
            <select value={ws.twitch.adScript} onChange={(e) => onTwitchScript(e.target.value as TwitchAdScript)} aria-label="Twitch ad blocking">
              {TWITCH_AD_SCRIPTS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label className="shield-switch">
            <span>WebRTC IP protection</span>
            <select value={ws.privacy.webrtcPolicy} onChange={(e) => onShieldDefault('webrtcPolicy', e.target.value as PrivacySettings['webrtcPolicy'])}>
              {WEBRTC_CHOICES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <FilterListStatus />
          <div className="site-data-row">
            <button className="btn btn-danger" onClick={clearAll} disabled={clearedAll === 'busy'}>
              {clearedAll === 'busy' ? 'Clearing…' : 'Clear data for all apps…'}
            </button>
            {clearedAll === 'done' && <small role="status">Cleared. Every app starts fresh.</small>}
          </div>
          {ws.httpAllowedHosts.length > 0 && (
            <div className="http-allowed">
              <span>Sites allowed without HTTPS</span>
              <ul>
                {ws.httpAllowedHosts.map((h) => (
                  <li key={h}>
                    {h}
                    <button className="icon-btn" title={`Upgrade ${h} to HTTPS again`} aria-label={`Remove ${h}`} onClick={() => onDisallowHttp(h)}>
                      <svg viewBox="0 0 20 20" aria-hidden>
                        <path d="m5 5 10 10M15 5 5 15" />
                      </svg>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
