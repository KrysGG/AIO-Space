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
 * secure"). It checks browsers that claim to be exactly Chrome or Firefox, and ours fails that check
 * whether it claims either; a UA that names its app after the Chrome part (as Edge adds "Edg/") is let
 * through. So Google's sign-in pages see the normal UA plus the app's token (D-064, replacing D-012).
 */
const GOOGLE_SIGN_IN_HOSTS = ['accounts.google.com'];

export function isGoogleSignIn(url: string): boolean {
  try {
    return GOOGLE_SIGN_IN_HOSTS.includes(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

/** The UA with the app's token (e.g. "SpaceAIO/0.1.1") at the end, once. */
export function withAppToken(ua: string, token: string): string {
  return ua.endsWith(` ${token}`) ? ua : `${ua} ${token}`;
}

/** Page-side half of the Google sign-in fix: switch the UA while the main frame is on a sign-in page. */
export function followSignInUserAgent(wc: WebContents, token: string): void {
  const normal = wc.getUserAgent();
  wc.on('did-start-navigation', (details) => {
    if (!details.isMainFrame) return;
    const want = isGoogleSignIn(details.url) ? withAppToken(normal, token) : normal;
    if (wc.getUserAgent() !== want) wc.setUserAgent(want);
  });
}

/** Request-side half of the Google sign-in fix: the same UA on every request to the sign-in pages. */
export function googleSignInFilter(token: string): RequestFilter {
  return {
    name: 'google-sign-in-ua',
    onBeforeSendHeaders(details, headers) {
      if (!isGoogleSignIn(details.url)) return headers;
      const key = Object.keys(headers).find((k) => k.toLowerCase() === 'user-agent') ?? 'User-Agent';
      return headers[key] ? { ...headers, [key]: withAppToken(headers[key], token) } : headers;
    },
  };
}

/**
 * Windows: Electron hands the automatic ("conditional") passkey request that login pages make on load
 * (Google, Reddit, ...) to Windows Hello's modal "Choose a passkey" dialog; Chrome shows it quietly in
 * autofill instead. Turning the feature off for every page by header stops it without a page script
 * (D-046, D-064). No passkey logins in the app on Windows; passwords and other second steps still work.
 */
export const noPasskeyPopupFilter: RequestFilter = {
  name: 'no-passkey-popup',
  onHeadersReceived(details, headers) {
    if (details.resourceType !== 'mainFrame' && details.resourceType !== 'subFrame') return headers;
    const key = Object.keys(headers).find((k) => k.toLowerCase() === 'permissions-policy') ?? 'Permissions-Policy';
    return { ...headers, [key]: [[...(headers[key] ?? []), 'publickey-credentials-get=()'].join(', ')] };
  },
};
