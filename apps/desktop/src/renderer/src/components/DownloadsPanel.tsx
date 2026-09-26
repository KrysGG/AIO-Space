import { useEffect } from 'react';
import type { DownloadInfo } from '../../../shared/ipc';

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let n = bytes / 1024;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n < 10 ? 1 : 0)} ${units[i]}`;
}

function status(d: DownloadInfo): string {
  if (d.state === 'completed') return size(d.receivedBytes);
  if (d.state === 'cancelled') return 'Cancelled';
  if (d.state === 'interrupted') return 'Failed. Try downloading it again.';
  return d.totalBytes ? `${size(d.receivedBytes)} of ${size(d.totalBytes)}` : size(d.receivedBytes);
}

/**
 * Downloads popover next to the rail. Like ShortcutsHelp it overlaps the tile area, so native views
 * are hidden while it's open. Callbacks must be stable.
 */
export function DownloadsPanel({
  downloads,
  onClose,
  onClosed,
}: {
  downloads: DownloadInfo[];
  onClose(): void;
  onClosed(): void;
}) {
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

  const finished = downloads.some((d) => d.state !== 'progressing');

  return (
    <div className="popover-backdrop" onPointerDown={onClose}>
      <div className="popover downloads" role="dialog" aria-label="Downloads" onPointerDown={(e) => e.stopPropagation()}>
        <div className="downloads-head">
          <h2 className="popover-title">Downloads</h2>
          {finished && (
            <button className="text-btn" onClick={() => window.aio.downloadAction('all', 'clear')}>
              Clear list
            </button>
          )}
        </div>
        {downloads.length === 0 ? (
          <p className="popover-hint">Files you download from any tile appear here and are saved to your Downloads folder.</p>
        ) : (
          <ul className="downloads-list">
            {downloads.map((d) => (
              <li key={d.id} className={`download is-${d.state}`}>
                <div className="download-name" title={d.filename}>
                  {d.filename}
                </div>
                <div className="download-meta">
                  {status(d)}
                  {d.host && ` · ${d.host}`}
                </div>
                {d.state === 'progressing' && (
                  <div
                    className="download-bar"
                    role="progressbar"
                    aria-label={`Downloading ${d.filename}`}
                    aria-valuemin={0}
                    aria-valuemax={d.totalBytes || undefined}
                    aria-valuenow={d.totalBytes ? d.receivedBytes : undefined}
                  >
                    <span style={{ width: d.totalBytes ? `${(100 * d.receivedBytes) / d.totalBytes}%` : '100%' }} className={d.totalBytes ? '' : 'is-unknown'} />
                  </div>
                )}
                <div className="download-actions">
                  {d.state === 'progressing' && (
                    <button className="text-btn" onClick={() => window.aio.downloadAction(d.id, 'cancel')}>
                      Cancel
                    </button>
                  )}
                  {d.state === 'completed' && d.canOpen && (
                    <button className="text-btn" onClick={() => window.aio.downloadAction(d.id, 'open')}>
                      Open
                    </button>
                  )}
                  {d.state === 'completed' && (
                    <button className="text-btn" onClick={() => window.aio.downloadAction(d.id, 'show')}>
                      Show in folder
                    </button>
                  )}
                  {d.state === 'completed' && !d.canOpen && (
                    <span className="download-note" title="Files like scripts, .desktop files and installers can run programs, so they aren't opened from here.">
                      Can run programs: open it from your file manager if you trust it.
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
