import { useEffect, useState } from 'react';
import type { FilterListStatus as Status } from '../../../shared/ipc';

const NAMES = { ads: 'Ad list', trackers: 'Tracker list' } as const;

function ago(ms: number): string {
  const minutes = Math.round((Date.now() - ms) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`;
}

/** Filter list state for the menu's Shields section (ROADMAP 3.5/3.6), with "Update now". */
export function FilterListStatus() {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = (): void => {
      void window.aio.getFilterListStatus().then((s) => alive && setStatus(s));
    };
    load();
    // Lists may be downloading in the background (first launch, daily refresh).
    const timer = setInterval(load, 2000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  const update = (): void => {
    setBusy(true);
    void window.aio
      .updateFilterLists()
      .then(setStatus)
      .finally(() => setBusy(false));
  };

  if (!status) return null;
  const updating = busy || status.updating;
  return (
    <div className="filter-lists">
      <ul>
        {status.lists.map((l) => (
          <li key={l.kind}>
            <span>{NAMES[l.kind]}</span>
            <small>{l.updatedAt ? `${l.rules.toLocaleString()} rules · updated ${ago(l.updatedAt)}` : updating ? 'Downloading…' : 'Not downloaded yet'}</small>
          </li>
        ))}
      </ul>
      {status.error && !updating && (
        <p className="form-error">Couldn’t update the lists ({status.error}). The previous lists stay in use; try again later.</p>
      )}
      <button className="text-btn" onClick={update} disabled={updating}>
        {updating ? 'Updating…' : 'Update now'}
      </button>
    </div>
  );
}
