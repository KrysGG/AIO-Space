import { useEffect, useState, type FormEvent } from 'react';
import { makeCustomApp, PERMISSION_LABELS, siteDomain, type AppPermission, type WebAppDef } from '@aio/core';

/** Placeholder for "Allowed sites": the domain we'd use if the field stays empty. */
function defaultSites(address: string): string {
  try {
    const host = new URL(/^[a-z][a-z0-9+.-]*:/i.test(address) ? address : `https://${address}`).hostname;
    return host.includes('.') ? siteDomain(host) : 'example.com';
  } catch {
    return 'example.com';
  }
}

/**
 * Add any https site as an app (ROADMAP 2.7). Centered over the tiles, so native views are hidden
 * while it's open. Callbacks must be stable.
 */
export function AddAppDialog({
  catalog,
  onAdd,
  onClose,
  onClosed,
}: {
  catalog: WebAppDef[];
  onAdd(app: WebAppDef): void;
  onClose(): void;
  onClosed(): void;
}) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [sites, setSites] = useState('');
  const [permissions, setPermissions] = useState<AppPermission[]>([]);
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

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    const r = makeCustomApp({ name, url, allowedHosts: sites, permissions }, catalog);
    if (!r.ok) return setError(r.error);
    onAdd(r.app);
  };

  const toggle = (p: AppPermission): void =>
    setPermissions((ps) => (ps.includes(p) ? ps.filter((x) => x !== p) : [...ps, p]));

  return (
    <div className="popover-backdrop modal-backdrop" onPointerDown={onClose}>
      <form className="popover modal add-app" role="dialog" aria-label="Add an app" onPointerDown={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2 className="popover-title">Add an app</h2>
        <p className="popover-hint">Any website that works in a browser. It gets its own login and storage, like the built-in apps.</p>

        <label className="field">
          <span>Name</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="WhatsApp" maxLength={40} />
        </label>
        <label className="field">
          <span>Web address</span>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="web.whatsapp.com" spellCheck={false} />
        </label>
        <label className="field">
          <span>Allowed sites</span>
          <input value={sites} onChange={(e) => setSites(e.target.value)} placeholder={defaultSites(url)} spellCheck={false} />
          <small>The app can open these sites (and their subdomains). Other links go to your system browser.</small>
        </label>

        <fieldset className="field">
          <legend>Allow</legend>
          <div className="checks">
            {(Object.keys(PERMISSION_LABELS) as AppPermission[]).map((p) => (
              <label key={p} className="check">
                <input type="checkbox" checked={permissions.includes(p)} onChange={() => toggle(p)} />
                {PERMISSION_LABELS[p]}
              </label>
            ))}
          </div>
          <small>Everything is off unless you turn it on.</small>
        </fieldset>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary">
            Add app
          </button>
        </div>
      </form>
    </div>
  );
}
