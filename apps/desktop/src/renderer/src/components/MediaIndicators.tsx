import type { MediaInUse } from '../../../shared/webapp';

/** Phone-style privacy colours: camera green, microphone orange, screen sharing blue. */
const LABELS = { camera: 'Camera in use', mic: 'Microphone in use', screen: 'Sharing your screen' } as const;

export function anyMedia(m: MediaInUse | undefined): boolean {
  return Boolean(m && (m.mic || m.camera || m.screen));
}

/** Combine several views' media (an app in several tiles). */
export function mergeMedia(a: MediaInUse | undefined, b: MediaInUse | undefined): MediaInUse {
  return { mic: Boolean(a?.mic || b?.mic), camera: Boolean(a?.camera || b?.camera), screen: Boolean(a?.screen || b?.screen) };
}

/** Icons in a tile header: what the page is capturing, and a quiet speaker while it plays sound. */
export function TileMedia({ media, audible }: { media: MediaInUse | undefined; audible: boolean }) {
  if (!anyMedia(media) && !audible) return null;
  return (
    <span className="tile-media">
      {media?.camera && (
        <svg className="media-icon media-camera" viewBox="0 0 20 20" role="img" aria-label={LABELS.camera}>
          <title>{LABELS.camera}</title>
          <rect x="2.5" y="5.5" width="10.5" height="9" rx="2" />
          <path d="m13 9 4.5-2.5v7L13 11" />
        </svg>
      )}
      {media?.mic && (
        <svg className="media-icon media-mic" viewBox="0 0 20 20" role="img" aria-label={LABELS.mic}>
          <title>{LABELS.mic}</title>
          <rect x="7.5" y="2.5" width="5" height="9.5" rx="2.5" />
          <path d="M4.5 10a5.5 5.5 0 0 0 11 0M10 15.5v2" />
        </svg>
      )}
      {media?.screen && (
        <svg className="media-icon media-screen" viewBox="0 0 20 20" role="img" aria-label={LABELS.screen}>
          <title>{LABELS.screen}</title>
          <rect x="2.5" y="3.5" width="15" height="10" rx="1.5" />
          <path d="M7 17h6M10 13.5V17M10 11V6.5M7.8 8.5 10 6.3l2.2 2.2" />
        </svg>
      )}
      {audible && (
        <svg className="media-icon media-audio" viewBox="0 0 20 20" role="img" aria-label="Playing sound">
          <title>Playing sound</title>
          <path d="M3.5 8v4h3l4 3.5v-11l-4 3.5z" />
          <path d="M13.5 7.5a3.5 3.5 0 0 1 0 5M15.5 5.5a6.3 6.3 0 0 1 0 9" />
        </svg>
      )}
    </span>
  );
}

/** A dot on an app's rail icon (or the hidden rail's edge): the most sensitive capture wins. */
export function MediaDot({ media, className = '' }: { media: MediaInUse | undefined; className?: string }) {
  if (!anyMedia(media)) return null;
  const kind = media!.camera ? 'camera' : media!.mic ? 'mic' : 'screen';
  const label = [media!.camera && LABELS.camera, media!.mic && LABELS.mic, media!.screen && LABELS.screen].filter(Boolean).join(', ');
  return <i className={`media-dot media-dot-${kind} ${className}`} role="img" aria-label={label} title={label} />;
}
