import { randomUUID } from 'node:crypto';
import { desktopCapturer, type BrowserWindow, type DesktopCapturerSource, type Session, type Streams } from 'electron';
import { IPC, type ScreenShareRequest } from '../../shared/ipc';

/** Wayland: Chromium asks the desktop's own portal picker; getSources returns only what the user chose there. */
const WAYLAND = process.platform === 'linux' && (process.env['XDG_SESSION_TYPE'] === 'wayland' || !!process.env['WAYLAND_DISPLAY']);

/**
 * Refuse a request. Electron has no "deny" answer: an empty one refuses the page (AbortError) but then
 * throws, since video was asked for; without the catch that crashes main.
 */
function deny(answer: (streams: Streams) => void): void {
  try {
    answer({});
  } catch {
    // Refused already.
  }
}

interface Pending {
  sources: Map<string, DesktopCapturerSource>;
  audio: boolean;
  answer(streams: Streams): void;
}

/**
 * Screen sharing (ROADMAP 2.11, D-068) for apps with the `display-capture` permission. A page's
 * getDisplayMedia shows the UI's picker (screens and windows with thumbnails); only a source main
 * offered for that request can be chosen. macOS uses its own system picker; Wayland its portal.
 */
export class ScreenShare {
  private readonly sessions = new WeakSet<Session>();
  private pending: { id: string; request: Pending } | undefined;

  constructor(private readonly win: BrowserWindow) {}

  attach(ses: Session, appName: string): void {
    if (this.sessions.has(ses)) return;
    this.sessions.add(ses);
    ses.setDisplayMediaRequestHandler(
      (request, answer) => {
        void (async () => {
          const found = await desktopCapturer
            .getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 } })
            .catch(() => []);
          if (!found.length || this.win.isDestroyed()) return deny(answer);
          if (WAYLAND && found.length === 1) return answer({ video: found[0]! }); // chosen in the portal already
          // One picker at a time: a newer request replaces an unanswered one.
          if (this.pending) deny(this.pending.request.answer);
          const id = randomUUID();
          const audio = request.audioRequested && process.platform === 'win32';
          this.pending = { id, request: { sources: new Map(found.map((s) => [s.id, s])), audio, answer } };
          const show: ScreenShareRequest = {
            id,
            appName,
            audio,
            sources: found.map((s) => ({
              id: s.id,
              name: s.name,
              kind: s.id.startsWith('screen:') ? 'screen' : 'window',
              thumbnail: s.thumbnail.isEmpty() ? '' : s.thumbnail.toDataURL(),
            })),
          };
          this.win.webContents.send(IPC.screenSharePick, show);
        })();
      },
      { useSystemPicker: true },
    );
  }

  /** The UI's answer. Anything but a source offered for this very request cancels. */
  choose(id: string, sourceId: string | null, audio: boolean): void {
    if (!this.pending || this.pending.id !== id) return;
    const { request } = this.pending;
    this.pending = undefined;
    const source = sourceId === null ? undefined : request.sources.get(sourceId);
    if (!source) return deny(request.answer);
    // System audio (Windows loopback), only if the page asked for audio and the user left it on.
    request.answer(request.audio && audio ? { video: source, audio: 'loopback' } : { video: source });
  }
}
