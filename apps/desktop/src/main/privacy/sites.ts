import { getDomain } from 'tldts';
import type { WebAppDef } from '@aio/core';

/**
 * A host's "site" (registrable domain): cdn.discordapp.com -> discordapp.com, news.bbc.co.uk ->
 * bbc.co.uk. IP addresses and single-label hosts like localhost are their own site.
 */
export function siteOf(host: string): string {
  const h = host.toLowerCase().replace(/\.$/, '');
  return getDomain(h, { allowPrivateDomains: true }) ?? h;
}

export function siteOfUrl(url: string): string | null {
  try {
    const host = new URL(url).hostname;
    return host ? siteOf(host) : null;
  } catch {
    return null;
  }
}

/**
 * Sites an app treats as its own (ROADMAP 3.3): the sites of its allowed hosts and sign-in popup
 * hosts, so Discord <-> discordapp.com, YouTube <-> google.com and "Sign in with Google" keep their
 * cookies. Null for the Browser tile ('*'), which gets the strict rule: only the page's own site.
 */
export function appSites(def: Pick<WebAppDef, 'allowedHosts' | 'popupHosts'>): Set<string> | null {
  if (def.allowedHosts.includes('*')) return null;
  return new Set([...def.allowedHosts, ...def.popupHosts].filter((h) => h !== '*').map(siteOf));
}
