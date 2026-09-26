import { net, protocol } from 'electron';
import { isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * The packaged UI is served from `aio://app/` instead of `file://` (ROADMAP 3.7, Electron security
 * checklist "avoid file://"): the page can only reach files inside the renderer folder, and the
 * `GrantFileProtocolExtraPrivileges` fuse can be turned off. Only the default (UI) session knows the
 * scheme; web app sessions don't, and their navigation guard only allows http(s) anyway.
 */
export const UI_SCHEME = 'aio';
export const UI_ORIGIN = `${UI_SCHEME}://app`;

/**
 * Stricter than the page's meta CSP (which must allow Vite's inline styles in dev): browsers apply
 * both, so the packaged app gets no inline styles at all. React's `style` props use the CSSOM, which
 * CSP doesn't restrict.
 */
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; " +
  "object-src 'none'; base-uri 'none'; frame-src 'none'; form-action 'none'";

/** Call before `app.ready`. */
export function registerUiScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: UI_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
}

/** The file a UI URL maps to, or null if it points outside `root` (or is malformed). Exported for tests. */
export function uiFilePath(root: string, url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== `${UI_SCHEME}:` || u.host !== 'app') return null;
  const path = decodeURIComponent(u.pathname);
  const file = resolve(root, `.${path === '/' ? '/index.html' : path}`);
  const rel = relative(root, file);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null;
  return file;
}

/** Call after `app.ready`: serve the renderer build from `root`. */
export function handleUiScheme(root: string): void {
  protocol.handle(UI_SCHEME, async (request) => {
    const file = uiFilePath(root, request.url);
    if (!file) return new Response('Not found', { status: 404 });
    let res: Response;
    try {
      res = await net.fetch(pathToFileURL(file).toString());
    } catch {
      return new Response('Not found', { status: 404 });
    }
    const headers = new Headers(res.headers);
    if (file.endsWith('.html')) headers.set('Content-Security-Policy', CSP);
    headers.set('X-Content-Type-Options', 'nosniff');
    return new Response(res.body, { status: res.status, headers });
  });
}

export function uiIndexUrl(): string {
  return `${UI_ORIGIN}/index.html`;
}

