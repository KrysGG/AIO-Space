import { stripTrackingParams, type PrivacySettings } from '@aio/core';
import type { RequestFilter } from './requestPipeline';
import { siteOfUrl } from './sites';

/**
 * Brave-style "Shields". Filters read settings through a getter on every request,
 * so toggling a setting takes effect immediately without restarting.
 */

const LOCAL_HOST = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|.+\.local)$/i;

/** Conservative starter list. Replaced by the filter-list engine in ROADMAP 3.5/3.6. */
const TRACKER_HOSTS = [
  'google-analytics.com',
  'doubleclick.net',
  'scorecardresearch.com',
  'app-measurement.com',
];
/** Path-level telemetry endpoints on otherwise-needed hosts. */
const TELEMETRY_PATHS: Array<{ host: string; path: RegExp }> = [
  { host: 'discord.com', path: /^\/api\/v\d+\/(science|metrics)/ },
];

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function matchesHost(host: string, list: string[]): boolean {
  return list.some((h) => host === h || host.endsWith(`.${h}`));
}

export interface HttpsOptions {
  /** Sites the user allowed over http after https failed (ROADMAP 3.2): not upgraded. */
  httpAllowed(host: string): boolean;
  /** A page load was upgraded; remembered so a failure can offer http instead. */
  onUpgrade(webContentsId: number, httpUrl: string, httpsUrl: string): void;
}

const NO_HTTPS_OPTIONS: HttpsOptions = { httpAllowed: () => false, onUpgrade: () => {} };

export interface CookieOptions {
  /** The app's own sites (never third-party for it); null for the Browser tile. */
  appSites: Set<string> | null;
  /** The top-level page URL of the tab a request belongs to. */
  topUrl(webContentsId: number): string | undefined;
}

const NO_COOKIE_OPTIONS: CookieOptions = { appSites: null, topUrl: () => undefined };

/**
 * Third-party (ROADMAP 3.3): the request's site is neither the top-level page's site nor one of the
 * app's own sites. Page loads themselves are first-party. Unknown top page: not treated as third
 * party (fail open, rather than log the user out of the app).
 */
function isThirdParty(
  d: { url: string; resourceType: string; webContentsId?: number },
  cookies: CookieOptions,
): boolean {
  if (d.resourceType === 'mainFrame' || d.webContentsId === undefined) return false;
  const top = cookies.topUrl(d.webContentsId);
  const reqSite = siteOfUrl(d.url);
  const topSite = top ? siteOfUrl(top) : null;
  if (!reqSite || !topSite || reqSite === topSite) return false;
  return !cookies.appSites?.has(reqSite);
}

function withoutHeader<T extends string | string[]>(headers: Record<string, T>, name: string): Record<string, T> {
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
  if (!key) return headers;
  const out = { ...headers };
  delete out[key];
  return out;
}

export function buildShieldFilters(
  getPrivacy: () => PrivacySettings,
  https: HttpsOptions = NO_HTTPS_OPTIONS,
  cookies: CookieOptions = NO_COOKIE_OPTIONS,
): RequestFilter[] {
  return [
    {
      name: 'third-party-cookies',
      onBeforeSendHeaders(d, headers) {
        if (!getPrivacy().blockThirdPartyCookies || !isThirdParty(d, cookies)) return headers;
        return withoutHeader(headers, 'cookie');
      },
      onHeadersReceived(d, headers) {
        if (!getPrivacy().blockThirdPartyCookies || !isThirdParty(d, cookies)) return headers;
        return withoutHeader(headers, 'set-cookie');
      },
    },
    {
      name: 'https-only',
      onBeforeRequest(d) {
        if (!getPrivacy().httpsOnly || !d.url.startsWith('http://')) return undefined;
        const host = hostOf(d.url);
        if (!host || LOCAL_HOST.test(host) || https.httpAllowed(host)) return undefined;
        const upgraded = 'https://' + d.url.slice('http://'.length);
        if (d.resourceType === 'mainFrame' && d.webContentsId !== undefined) https.onUpgrade(d.webContentsId, d.url, upgraded);
        return { redirectURL: upgraded };
      },
    },
    {
      name: 'tracker-block',
      onBeforeRequest(d) {
        if (!getPrivacy().blockTrackers) return undefined;
        let u: URL;
        try {
          u = new URL(d.url);
        } catch {
          return undefined;
        }
        const host = u.hostname.toLowerCase();
        if (matchesHost(host, TRACKER_HOSTS)) return { cancel: true };
        if (TELEMETRY_PATHS.some((t) => matchesHost(host, [t.host]) && t.path.test(u.pathname))) {
          return { cancel: true };
        }
        return undefined;
      },
    },
    {
      name: 'strip-tracking-params',
      onBeforeRequest(d) {
        if (!getPrivacy().stripTrackingParams) return undefined;
        if (d.resourceType !== 'mainFrame' && d.resourceType !== 'subFrame') return undefined;
        const cleaned = stripTrackingParams(d.url);
        return cleaned ? { redirectURL: cleaned } : undefined;
      },
    },
    {
      name: 'global-privacy-control',
      onBeforeSendHeaders(_d, headers) {
        if (getPrivacy().globalPrivacyControl) headers['Sec-GPC'] = '1';
        return headers;
      },
    },
    {
      name: 'trim-referrer',
      onBeforeSendHeaders(d, headers) {
        if (!getPrivacy().trimReferrers) return headers;
        const key = Object.keys(headers).find((k) => k.toLowerCase() === 'referer');
        if (!key || !headers[key]) return headers;
        try {
          const ref = new URL(headers[key]!);
          const target = new URL(d.url);
          if (ref.origin !== target.origin) headers[key] = `${ref.origin}/`;
        } catch {
          delete headers[key];
        }
        return headers;
      },
    },
  ];
}
