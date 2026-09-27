import { useEffect, useState } from 'react';
import {
  resolvePrivacy,
  FINGERPRINT_CHOICES,
  SHIELD_SWITCHES,
  WEBRTC_CHOICES,
  type AppProfile,
  type PrivacySettings,
  type WebAppDef,
  type Workspace,
} from '@aio/core';

interface Props {
  ws: Workspace;
  app: WebAppDef;
  /** Requests blocked on the tile's current page. */
  blocked: number;
  onSet<K extends keyof PrivacySettings>(key: K, value: PrivacySettings[K]): void;
  onReset(): void;
  /** The tile's account, whose data "Clear data" removes (ROADMAP 3.9). */
  profile: AppProfile;
  /** How many accounts the app has (names the account in the button when there are several). */
  accounts: number;
  onForget(forget: boolean): void;
  onClearData(profile: string): Promise<void>;
  onClose(): void;
  onClosed(): void;
}

/**
 * Shields for one app (ROADMAP 3.1), opened from the shield in its tile header. Changes are per-app
 * overrides of the defaults in the menu, and apply to that app immediately. Hides views while open.
 */
export function ShieldsPanel({ ws, app, blocked, onSet, onReset, profile, accounts, onForget, onClearData, onClose, onClosed }: Props) {
  const [clearing, setClearing] = useState<'idle' | 'busy' | 'done'>('idle');
  const who = accounts > 1 ? `${app.name} (${profile.name})` : app.name;
  const clear = (): void => {
    if (!window.confirm(`Clear all data for ${who}? You’ll be logged out, and its cookies, site storage and cache are deleted.`)) return;
    setClearing('busy');
    void onClearData(profile.id).then(() => setClearing('done'));
  };
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

  const override = ws.privacyOverrides[app.id] ?? {};
  // Show what the app would get with Shields up, so switches keep their values while it's down.
  const up = resolvePrivacy(ws.privacy, { ...override, shields: true });
  const on = resolvePrivacy(ws.privacy, override).shields;

  return (
    <div className="popover-backdrop" onPointerDown={onClose}>
      <div className="popover shields-panel" role="dialog" aria-label={`Shields for ${app.name}`} onPointerDown={(e) => e.stopPropagation()}>
        <label className="shields-master">
          <span>
            <strong>Shields for {app.name}</strong>
            <small>{on ? `${blocked} blocked on this page` : 'Down: this app gets no protection'}</small>
          </span>
          <input type="checkbox" role="switch" checked={on} onChange={(e) => onSet('shields', e.target.checked)} />
        </label>

        <fieldset className="shields-list" disabled={!on}>
          {SHIELD_SWITCHES.map((s) => (
            <label key={s.key} className="shield-switch">
              <span>
                {s.label}
                <small>{s.hint}</small>
              </span>
              <input type="checkbox" checked={up[s.key]} onChange={(e) => onSet(s.key, e.target.checked)} />
            </label>
          ))}
          <label className="shield-switch">
            <span>
              Block fingerprinting
              <small>Adds invisible noise to canvas, WebGL and audio so sites can’t recognise you across visits. Reloads the app.</small>
            </span>
            <select value={up.fingerprinting} onChange={(e) => onSet('fingerprinting', e.target.value as PrivacySettings['fingerprinting'])}>
              {FINGERPRINT_CHOICES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label className="shield-switch">
            <span>
              WebRTC IP protection
              <small>Stops calls and sites from seeing your local network address. Reloads the app.</small>
            </span>
            <select value={up.webrtcPolicy} onChange={(e) => onSet('webrtcPolicy', e.target.value as PrivacySettings['webrtcPolicy'])}>
              {WEBRTC_CHOICES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        </fieldset>

        <section className="site-data">
          <label className="shield-switch">
            <span>
              Forget {app.name} when AIO Space closes
              <small>Logs out and deletes its data{accounts > 1 ? ' (every account)' : ''} each time you quit.</small>
            </span>
            <input type="checkbox" checked={ws.forgetOnClose.includes(app.id)} onChange={(e) => onForget(e.target.checked)} />
          </label>
          <div className="site-data-row">
            <button className="btn btn-danger" onClick={clear} disabled={clearing === 'busy'}>
              {clearing === 'busy' ? 'Clearing…' : `Clear data for ${who}`}
            </button>
            {clearing === 'done' && <small role="status">Cleared. {app.name} starts fresh.</small>}
          </div>
        </section>

        <div className="shields-foot">
          <span className="popover-hint">Changes apply to {app.name} right away. Defaults for all apps are in the menu.</span>
          {Object.keys(override).length > 0 && (
            <button className="text-btn" onClick={onReset}>
              Reset to defaults
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
