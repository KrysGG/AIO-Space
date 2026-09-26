import { stripTrackingParams, type PrivacySettings } from '@aio/core';
import type { RequestFilter } from './requestPipeline';

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

export function buildShieldFilters(getPrivacy: () => PrivacySettings): RequestFilter[] {
  return [
    {
      name: 'https-only',
      onBeforeRequest(d) {
        if (!getPrivacy().httpsOnly || !d.url.startsWith('http://')) return undefined;
        const host = hostOf(d.url);
        if (!host || LOCAL_HOST.test(host)) return undefined;
        // TODO(ROADMAP 3.2): fall back to http + interstitial when https fails.
        return { redirectURL: 'https://' + d.url.slice('http://'.length) };
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
