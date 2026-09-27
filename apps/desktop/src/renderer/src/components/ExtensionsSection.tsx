import { useState } from 'react';
import type { WebAppDef } from '@aio/core';
import type { ExtensionInfo, ExtensionInstallResult } from '../../../shared/ipc';

interface Props {
  installed: ExtensionInfo[];
  /** App ids per extension id that have it on. */
  usedBy: Record<string, string[]>;
  apps: WebAppDef[];
  /** The list changed in main (installed, updated or removed). */
  onChanged(): void;
  onRemoved(extensionId: string): void;
}

/**
 * Chrome extensions library (ROADMAP 4.5): install from the Chrome Web Store or an unpacked folder,
 * update, remove. Turning one on happens per app, from the puzzle button in its tile.
 */
export function ExtensionsSection({ installed, usedBy, apps, onChanged, onRemoved }: Props) {
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);

  const finish = (res: ExtensionInstallResult): void => {
    setBusy(false);
    if (!res.ok) {
      if ('error' in res)
        setMessage({ error: true, text: `Couldn’t install the extension. ${res.error}` });
      return;
    }
    setLink('');
    onChanged();
    setMessage({
      error: false,
      text: `Installed “${res.extension.name}”. Turn it on for an app with the puzzle button in that app’s tile.`,
    });
  };

  const fromStore = async (): Promise<void> => {
    setBusy(true);
    setMessage(null);
    finish(await window.aio.installExtensionFromStore(link));
  };

  const fromFolder = async (): Promise<void> => {
    setBusy(true);
    setMessage(null);
    finish(await window.aio.installExtensionFromFolder());
  };

  const remove = async (ext: ExtensionInfo): Promise<void> => {
    if (
      !window.confirm(
        `Remove “${ext.name}”? It’s turned off in every app and its files are deleted.`,
      )
    )
      return;
    onRemoved(ext.id);
    await window.aio.removeExtension(ext.id);
    onChanged();
  };

  const names = (ids: string[] = []): string =>
    ids.map((id) => apps.find((a) => a.id === id)?.name ?? id).join(', ');

  return (
    <section>
      <h2 className="popover-title">Chrome extensions</h2>
      <p className="popover-hint">
        Paste a Chrome Web Store link to install an extension, then turn it on per app with the
        puzzle button in the app’s tile. Many work; toolbar features that need browser tabs may not
        (see docs/EXTENSIONS.md).
      </p>
      <form
        className="extension-add"
        onSubmit={(e) => {
          e.preventDefault();
          if (link.trim()) void fromStore();
        }}
      >
        <input
          type="text"
          value={link}
          placeholder="chromewebstore.google.com/detail/…"
          aria-label="Chrome Web Store link or extension id"
          onChange={(e) => setLink(e.target.value)}
          disabled={busy}
        />
        <button className="text-btn" type="submit" disabled={busy || !link.trim()}>
          {busy ? 'Installing…' : 'Install'}
        </button>
      </form>
      <button className="text-btn" disabled={busy} onClick={() => void fromFolder()}>
        Install unpacked folder…
      </button>
      {message && (
        <p
          className={message.error ? 'form-error' : 'popover-hint'}
          role={message.error ? 'alert' : 'status'}
        >
          {message.text}
        </p>
      )}
      {installed.length > 0 && (
        <ul className="plugin-list">
          {installed.map((ext) => (
            <li key={ext.id}>
              <span className="extension-row">
                {ext.name} <span className="plugin-version">{ext.version}</span>
                <small>
                  {usedBy[ext.id]?.length ? `On in ${names(usedBy[ext.id])}` : 'Not on in any app'}
                </small>
              </span>
              <button
                className="icon-btn"
                title={`Remove ${ext.name}`}
                aria-label={`Remove ${ext.name}`}
                onClick={() => void remove(ext)}
              >
                <svg viewBox="0 0 20 20" aria-hidden>
                  <path d="m5 5 10 10M15 5 5 15" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
