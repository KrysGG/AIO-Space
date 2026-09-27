import type { WebContents } from 'electron';
import type { RequestFilter } from '../privacy/requestPipeline';

/** Remove Electron and app-name tokens from a UA string, leaving a normal Chrome UA. */
export function cleanUserAgent(ua: string, appNames: string | string[]): string {
  let out = ua.replace(/\sElectron\/\S+/gi, '');
  for (const name of Array.isArray(appNames) ? appNames : [appNames]) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`\\s${escaped}\\/\\S+`, 'gi'), '');
  }
  return out
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Google refuses sign-in from browsers it detects as embedded ("This browser or app may not be
 * secure"), and a clean Chrome UA is not enough. Its sign-in pages accept Firefox, so those pages
 * get a Firefox UA (see DECISIONS D-012).
 */
const GOOGLE_SIGN_IN_HOSTS = ['accounts.google.com'];

export function isGoogleSignIn(url: string): boolean {
  try {
    return GOOGLE_SIGN_IN_HOSTS.includes(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

/** Firefox's major version tracks Chrome's (Chrome 127 shipped next to Firefox 128), so derive it to stay current. */
export function firefoxUserAgent(chromeVersion: string, platform: NodeJS.Platform): string {
  const major = Number.parseInt(chromeVersion, 10) + 1;
  const os =
    platform === 'win32' ? 'Windows NT 10.0; Win64; x64' : platform === 'darwin' ? 'Macintosh; Intel Mac OS X 10.15' : 'X11; Linux x86_64';
  return `Mozilla/5.0 (${os}; rv:${major}.0) Gecko/20100101 Firefox/${major}.0`;
}

export const SIGN_IN_USER_AGENT = firefoxUserAgent(process.versions.chrome, process.platform);

/** Page-side half of the Google sign-in fix: switch the UA while the main frame is on a sign-in page. */
export function followSignInUserAgent(wc: WebContents): void {
  const normal = wc.getUserAgent();
  wc.on('did-start-navigation', (details) => {
    if (!details.isMainFrame) return;
    const want = isGoogleSignIn(details.url) ? SIGN_IN_USER_AGENT : normal;
    if (wc.getUserAgent() !== want) wc.setUserAgent(want);
  });
}

/** Request-side half of the Google sign-in fix: Firefox UA and no Chromium client hints. */
export const googleSignInFilter: RequestFilter = {
  name: 'google-sign-in-ua',
  onBeforeSendHeaders(details, headers) {
    if (!isGoogleSignIn(details.url)) return headers;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers)) {
      const key = k.toLowerCase();
      if (key === 'user-agent' || key.startsWith('sec-ch-ua')) continue;
      out[k] = v;
    }
    out['User-Agent'] = SIGN_IN_USER_AGENT;
    return out;
  },
};
