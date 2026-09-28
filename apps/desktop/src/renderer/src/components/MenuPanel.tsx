import { useEffect, useRef, useState } from 'react';
import {
  BUILTIN_THEMES,
  listLeaves,
  parseThemeFile,
  SYSTEM_THEME,
  MAX_USER_THEMES,
  type Theme,
  MAX_SPACE_NAME,
  MAX_SPACES,
  MAX_TEMPLATES,
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
  type WebAppDef,
  type Workspace,
} from '@aio/core';
import { FilterListStatus } from './FilterListStatus';
import { PluginsSection } from './PluginsSection';
import { ExtensionsSection } from './ExtensionsSection';
import type { ExtensionInfo, UpdateStatus } from '../../../shared/ipc';

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
  /** Theme id or 'system' (ROADMAP 4.1). */
  onTheme(theme: string): void;
  onImportTheme(theme: Theme): void;
  onRemoveTheme(themeId: string): void;
  onTwitchScript(script: TwitchAdScript): void;
  onShareGoogle(on: boolean): void;
  /** Every app, for picking one to give custom CSS (ROADMAP 4.3). */
  apps: WebAppDef[];
  onCustomCss(appId: string): void;
  /** Templates (ROADMAP 4.6). */
  onSaveTemplate(spaceId: string): void;
  onAddFromTemplate(templateId: string): void;
  onRemoveTemplate(templateId: string): void;
  /** A validated workspace file the user chose to load in place of everything (ROADMAP 4.6). */
  onImported(ws: Workspace): void;
  onPluginEnabled(pluginId: string, on: boolean): void;
  /** AppImage updates (ROADMAP 5.4); the section shows only when supported. */
  updateStatus: UpdateStatus;
  onAutoUpdates(auto: boolean): void;
  /** Chrome extensions (ROADMAP 4.5). */
  extensions: ExtensionInfo[];
  onExtensionsChanged(): void;
  onExtensionRemoved(extensionId: string): void;
  /** Apps hidden from the sidebar, to show again. */
  hiddenApps: WebAppDef[];
  onShowApp(appId: string): void;
  onClose(): void;
  onClosed(): void;
}

/**
 * The rail's menu (ROADMAP 2.8): spaces and settings. A popover over the tile area, so native views
 * are hidden while it's open. `onClose` / `onClosed` must be stable.
 */
export function MenuPanel({ ws, onSwitch, onAdd, onRename, onRemove, onSearchEngine, onSleepAfter, onShieldDefault, onDisallowHttp, keyringNotice, onDismissKeyring, onClearAll, onReduceMotion, onTheme, onImportTheme, onRemoveTheme, onTwitchScript, onShareGoogle, apps, onCustomCss, onSaveTemplate, onAddFromTemplate, onRemoveTemplate, onImported, onPluginEnabled, updateStatus, onAutoUpdates, extensions, onExtensionsChanged, onExtensionRemoved, hiddenApps, onShowApp, onClose, onClosed }: Props) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [clearedAll, setClearedAll] = useState<'idle' | 'busy' | 'done'>('idle');
  const [themeError, setThemeError] = useState<string | null>(null);
  const themeFile = useRef<HTMLInputElement>(null);
  const importTheme = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    if (file.size > 20_000) return setThemeError('That file is too big for a theme (20 KB at most).');
    const taken = [...BUILTIN_THEMES, ...ws.themes].map((t) => t.id);
    const res = parseThemeFile(await file.text(), taken);
    if (!res.ok) return setThemeError(res.error);
    setThemeError(null);
    onImportTheme(res.theme);
  };
  const [fileMessage, setFileMessage] = useState<{ error: boolean; text: string } | null>(null);
  const exportFile = async (): Promise<void> => {
    const res = await window.aio.exportWorkspace();
    if (res.ok) setFileMessage({ error: false, text: 'Workspace exported.' });
    else if ('error' in res) setFileMessage({ error: true, text: res.error });
  };
  const importFile = async (): Promise<void> => {
    const res = await window.aio.importWorkspace();
    if (!res.ok) {
      if ('error' in res) setFileMessage({ error: true, text: res.error });
      return;
    }
    const n = res.workspace.spaces.length;
    const ok = window.confirm(
      `Replace your spaces, apps and settings with this file’s (${n} space${n === 1 ? '' : 's'})? Logins on this computer stay; apps you haven’t signed in to here will ask you to sign in.`,
    );
    if (ok) onImported(res.workspace);
  };
  const userTheme = ws.themes.find((t) => t.id === ws.ui.theme);
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

  // Spaces in their own windows (ROADMAP 2.15) aren't listed: each window has its one space.
  const mainSpaces = ws.spaces.filter((s) => !s.window).length;
  const remove = (id: string, name: string): void => {
    const space = ws.spaces.find((s) => s.id === id);
    const apps = space ? listLeaves(space.layout).filter((l) => l.appId).length : 0;
    const detail = apps ? ` Its ${apps === 1 ? 'app closes' : `${apps} apps close`}; logins are kept.` : '';
    if (window.confirm(`Delete the space "${name}"?${detail}`)) onRemove(id);
  };

  return (
    <div className="popover-backdrop" onPointerDown={onClose}>
      <div className="popover menu-panel" role="dialog" aria-label="Menu" onPointerDown={(e) => e.stopPropagation()}>
        {keyringNotice && (
          <div className="notice" role="alert">
            <strong>Your logins aren’t protected by a keyring</strong>
            <p>
              SpaceAIO couldn’t use KWallet or GNOME Keyring, so cookies and logins are saved with a fixed key. Anyone who can read
              your files could use them. Install and unlock KWallet (KDE) or GNOME Keyring (<code>gnome-keyring</code>,{' '}
              <code>libsecret</code>), then restart SpaceAIO.
            </p>
            <button className="text-btn" onClick={onDismissKeyring}>
              Got it
            </button>
          </div>
        )}

        <section>
          <h2 className="popover-title">Spaces</h2>
          <p className="popover-hint">Each space has its own tiles. Apps in other spaces keep running, so switching is instant.</p>
          <ul className="space-list">
            {ws.spaces.filter((s) => !s.window).map((s) => {
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
                  <button
                    className="icon-btn"
                    title={ws.templates.length < MAX_TEMPLATES ? 'Save as template' : `You can keep ${MAX_TEMPLATES} templates`}
                    aria-label={`Save ${s.name} as a template`}
                    disabled={ws.templates.length >= MAX_TEMPLATES}
                    onClick={() => onSaveTemplate(s.id)}
                  >
                    <svg viewBox="0 0 20 20" aria-hidden>
                      <path d="M5 3h8l3 3v11H5zM8 3v4h5M8 17v-5h5v5" />
                    </svg>
                  </button>
                  <button className="icon-btn" title="Rename" aria-label={`Rename ${s.name}`} onClick={() => startRename(s.id, s.name)}>
                    <svg viewBox="0 0 20 20" aria-hidden>
                      <path d="M4 16h3l8.5-8.5-3-3L4 13z" />
                    </svg>
                  </button>
                  <button
                    className="icon-btn"
                    title={mainSpaces > 1 ? 'Delete space' : 'You need at least one space'}
                    aria-label={`Delete ${s.name}`}
                    disabled={mainSpaces <= 1}
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
          {ws.templates.length > 0 && (
            <div className="template-list">
              <span>New space from a template</span>
              <ul>
                {ws.templates.map((t) => {
                  const apps = listLeaves(t.layout).filter((l) => l.appId).length;
                  return (
                    <li key={t.id}>
                      <button className="text-btn" disabled={ws.spaces.length >= MAX_SPACES} onClick={() => onAddFromTemplate(t.id)}>
                        + {t.name}
                      </button>
                      <small>{apps === 0 ? 'Empty' : `${apps} app${apps === 1 ? '' : 's'}`}</small>
                      <button className="icon-btn" title="Delete template" aria-label={`Delete template ${t.name}`} onClick={() => onRemoveTemplate(t.id)}>
                        <svg viewBox="0 0 20 20" aria-hidden>
                          <path d="m5 5 10 10M15 5 5 15" />
                        </svg>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </section>

        <section>
          <h2 className="popover-title">Apps and accounts</h2>
          {hiddenApps.length > 0 && (
            <div className="hidden-apps">
              <span>Hidden from the sidebar (still in the launcher)</span>
              <ul>
                {hiddenApps.map((a) => (
                  <li key={a.id}>
                    {a.name}
                    <button className="text-btn" onClick={() => onShowApp(a.id)}>
                      Show
                    </button>
                  </li>
                ))}
              </ul>
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
        </section>

        <section>
          <h2 className="popover-title">Privacy</h2>
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

        <section>
          <h2 className="popover-title">Appearance</h2>
          <label className="setting">
            <span>Theme</span>
            <select value={ws.ui.theme} onChange={(e) => onTheme(e.target.value)}>
              <option value={SYSTEM_THEME}>Match system (light or dark)</option>
              {[...BUILTIN_THEMES, ...ws.themes].map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <div className="site-data-row">
            <button className="text-btn" disabled={ws.themes.length >= MAX_USER_THEMES} onClick={() => themeFile.current?.click()}>
              Import theme…
            </button>
            {userTheme && (
              <button className="text-btn" onClick={() => onRemoveTheme(userTheme.id)}>
                Remove “{userTheme.name}”
              </button>
            )}
            <input
              ref={themeFile}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={(e) => {
                void importTheme(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </div>
          {themeError && (
            <p className="form-error" role="alert">
              {themeError}
            </p>
          )}
          <p className="popover-hint">
            A theme file is JSON with a name and colours, e.g. <code>{'{ "name": "Mine", "scheme": "dark", "colors": { "ink": "#101418" } }'}</code>.
            Colours you leave out come from Dark or Light.
          </p>
          <label className="shield-switch">
            <span>
              Reduce animations and effects
              <small>Instant transitions, no glass blur or page previews. Saves CPU and GPU on slower machines.</small>
            </span>
            <input type="checkbox" checked={ws.ui.reduceMotion} onChange={(e) => onReduceMotion(e.target.checked)} />
          </label>
        </section>

        <section>
          <h2 className="popover-title">Performance</h2>
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
          <h2 className="popover-title">Browser</h2>
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
        </section>

        {updateStatus.supported && (
          <section>
            <h2 className="popover-title">Updates</h2>
            {updateStatus.state === 'ready' ? (
              <div className="notice" role="status">
                <strong>SpaceAIO {updateStatus.version} is ready</strong>
                <p>Restart to use it. It’s also installed the next time you quit.</p>
                <button className="text-btn" onClick={() => window.aio.installUpdate()}>
                  Restart to update
                </button>
              </div>
            ) : (
              <div className="site-data-row">
                <button
                  className="text-btn"
                  disabled={updateStatus.state === 'checking' || updateStatus.state === 'downloading'}
                  onClick={() => window.aio.checkForUpdates()}
                >
                  Check now
                </button>
                <small role="status">
                  {updateStatus.state === 'checking' && 'Checking…'}
                  {updateStatus.state === 'none' && 'You have the latest version.'}
                  {updateStatus.state === 'downloading' && `Downloading ${updateStatus.version} (${updateStatus.percent ?? 0}%)…`}
                  {updateStatus.state === 'error' && `Couldn’t check for updates: ${updateStatus.error}. Try again later.`}
                </small>
              </div>
            )}
            <label className="shield-switch">
              <span>
                Check for updates automatically
                <small>Asks GitHub for new releases a little after start and every 6 hours, and downloads them in the background.</small>
              </span>
              <input type="checkbox" checked={ws.updates.auto} onChange={(e) => onAutoUpdates(e.target.checked)} />
            </label>
          </section>
        )}

        <section>
          <h2 className="popover-title">Customize</h2>
          <label className="setting">
            <span>Custom CSS for an app</span>
            <select value="" onChange={(e) => e.target.value && onCustomCss(e.target.value)} aria-label="Edit custom CSS for an app">
              <option value="">Pick an app…</option>
              {apps.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {ws.appCss[a.id] ? (ws.appCss[a.id]!.enabled ? ' (on)' : ' (off)') : ''}
                </option>
              ))}
            </select>
          </label>
        </section>

        <ExtensionsSection
          installed={extensions}
          usedBy={Object.fromEntries(extensions.map((x) => [x.id, Object.keys(ws.extensions).filter((appId) => ws.extensions[appId]!.includes(x.id))]))}
          apps={apps}
          onChanged={onExtensionsChanged}
          onRemoved={onExtensionRemoved}
        />

        <PluginsSection enabled={ws.enabledPlugins} apps={apps} onEnabled={onPluginEnabled} />

        <section>
          <h2 className="popover-title">Your data</h2>
          <p className="popover-hint">
            A file with your spaces, apps and settings. Logins, cookies and site data aren’t in it, so you sign in again there.
          </p>
          <div className="site-data-row">
            <button className="text-btn" onClick={() => void exportFile()}>
              Export workspace…
            </button>
            <button className="text-btn" onClick={() => void importFile()}>
              Import workspace…
            </button>
          </div>
          {fileMessage && (
            <p className={fileMessage.error ? 'form-error' : 'popover-hint'} role={fileMessage.error ? 'alert' : 'status'}>
              {fileMessage.text}
            </p>
          )}
          <div className="site-data-row">
            <button className="btn btn-danger" onClick={clearAll} disabled={clearedAll === 'busy'}>
              {clearedAll === 'busy' ? 'Clearing…' : 'Clear data for all apps…'}
            </button>
            {clearedAll === 'done' && <small role="status">Cleared. Every app starts fresh.</small>}
          </div>
        </section>
      </div>
    </div>
  );
}
