import { useEffect, useState } from 'react';
import type { ScreenShareRequest } from '../../../shared/ipc';

interface Props {
  request: ScreenShareRequest;
  /** `sourceId` null cancels. */
  onChoose(sourceId: string | null, audio: boolean): void;
}

/**
 * Screen-share picker (ROADMAP 2.11): a page in an app asked to share the screen. Screens first, then
 * windows; double-click or Share. Hides views while open, like the other panels.
 */
export function SharePicker({ request, onChoose }: Props) {
  const [picked, setPicked] = useState<string | null>(null);
  const [audio, setAudio] = useState(true);
  useEffect(() => {
    window.aio.setViewsHidden(true);
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onChoose(null, false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.aio.setViewsHidden(false);
    };
  }, [onChoose]);

  const groups = [
    { label: 'Screens', items: request.sources.filter((s) => s.kind === 'screen') },
    { label: 'Windows', items: request.sources.filter((s) => s.kind === 'window') },
  ].filter((g) => g.items.length);

  return (
    <div className="popover-backdrop modal-backdrop" onPointerDown={() => onChoose(null, false)}>
      <div className="popover modal share-picker" role="dialog" aria-label={`Share your screen with ${request.appName}`} onPointerDown={(e) => e.stopPropagation()}>
        <h2 className="popover-title">Share your screen with {request.appName}</h2>
        {groups.map((g) => (
          <section key={g.label} className="share-group">
            <h3>{g.label}</h3>
            <div className="share-grid" role="listbox" aria-label={g.label}>
              {g.items.map((s) => (
                <button
                  key={s.id}
                  role="option"
                  aria-selected={picked === s.id}
                  className={`share-source${picked === s.id ? ' is-picked' : ''}`}
                  onClick={() => setPicked(s.id)}
                  onDoubleClick={() => onChoose(s.id, audio)}
                >
                  {s.thumbnail ? <img src={s.thumbnail} alt="" /> : <span className="share-thumb-empty" />}
                  <span className="share-name">{s.name}</span>
                </button>
              ))}
            </div>
          </section>
        ))}
        <div className="share-foot">
          {request.audio && (
            <label className="share-audio">
              <input type="checkbox" checked={audio} onChange={(e) => setAudio(e.target.checked)} /> Share system audio
            </label>
          )}
          <button className="btn" onClick={() => onChoose(null, false)}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!picked} onClick={() => onChoose(picked, audio)}>
            Share
          </button>
        </div>
      </div>
    </div>
  );
}
