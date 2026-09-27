import { useEffect, useState } from 'react';
import type { WebAppDef } from '@aio/core';
import type { PluginInfo } from '../../../shared/ipc';

interface Props {
  enabled: string[];
  apps: WebAppDef[];
  onEnabled(pluginId: string, on: boolean): void;
}

/**
 * Plugins (ROADMAP 4.4): installed from a local folder, off until the user turns them on after a
 * warning. Main keeps the code; the UI only lists, switches and removes.
 */
export function PluginsSection({ enabled, apps, onEnabled }: Props) {
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void window.aio.listPlugins().then(setPlugins);
  }, []);

  const appNames = (ids: string[]): string =>
    ids.map((id) => apps.find((a) => a.id === id)?.name ?? id).join(', ');

  const install = async (): Promise<void> => {
    setBusy(true);
    const res = await window.aio.installPlugin();
    setBusy(false);
    if (!res.ok) {
      if ('error' in res)
        setMessage({ error: true, text: `Couldn’t install the plugin. ${res.error}` });
      return;
    }
    setPlugins(await window.aio.listPlugins());
    setMessage({
      error: false,
      text: `Installed “${res.plugin.name}”. It stays off until you turn it on.`,
    });
  };

  const toggle = (p: PluginInfo, on: boolean): void => {
    if (on) {
      const discord = p.apps.includes('discord')
        ? '\n\nDiscord’s terms don’t allow modifying its app. Using this plugin could get your Discord account banned.'
        : '';
      const ok = window.confirm(
        `Turn on “${p.name}”?\n\nIt can read and change everything on ${appNames(p.apps)} pages, including your messages and account details. Only turn on plugins you got from someone you trust.${discord}\n\nThose apps reload.`,
      );
      if (!ok) return;
    }
    onEnabled(p.id, on);
  };

  const remove = async (p: PluginInfo): Promise<void> => {
    if (
      !window.confirm(
        `Remove “${p.name}”? Its files are deleted from AIO Space; your plugin folder stays.`,
      )
    )
      return;
    onEnabled(p.id, false);
    await window.aio.removePlugin(p.id);
    setPlugins(await window.aio.listPlugins());
  };

  return (
    <section>
      <h2 className="popover-title">Plugins</h2>
      <p className="popover-hint">
        Plugins change how an app’s pages look or work. They can see everything on those pages, so
        they’re off until you turn them on. Install only from folders you trust.
      </p>
      {plugins.length > 0 && (
        <ul className="plugin-list">
          {plugins.map((p) => (
            <li key={p.id}>
              <label className="shield-switch">
                <span>
                  {p.name} <span className="plugin-version">{p.version}</span>
                  <small>
                    {p.description ? `${p.description} ` : ''}Runs in {appNames(p.apps)}.
                  </small>
                </span>
                <input
                  type="checkbox"
                  checked={enabled.includes(p.id)}
                  onChange={(e) => toggle(p, e.target.checked)}
                />
              </label>
              <button
                className="icon-btn"
                title={`Remove ${p.name}`}
                aria-label={`Remove ${p.name}`}
                onClick={() => void remove(p)}
              >
                <svg viewBox="0 0 20 20" aria-hidden>
                  <path d="m5 5 10 10M15 5 5 15" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}
      <button className="text-btn" disabled={busy} onClick={() => void install()}>
        {busy ? 'Installing…' : 'Install plugin from folder…'}
      </button>
      {message && (
        <p
          className={message.error ? 'form-error' : 'popover-hint'}
          role={message.error ? 'alert' : 'status'}
        >
          {message.text}
        </p>
      )}
    </section>
  );
}
