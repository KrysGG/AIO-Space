/** Query params removed from URLs when stripTrackingParams is on. */
const GLOBAL_PARAMS = new Set([
  'fbclid', 'gclid', 'gclsrc', 'dclid', 'gbraid', 'wbraid', 'msclkid', 'yclid', 'twclid',
  'igshid', 'mc_eid', 'mc_cid', '_hsenc', '_hsmi', 'mkt_tok', 'oly_anon_id', 'oly_enc_id',
  'vero_id', 'rb_clickid', 's_cid', 'ttclid', 'epik',
]);
const GLOBAL_PREFIXES = ['utm_', '__hs'];

/** Params that are only tracking on specific hosts (they mean something else elsewhere). */
const HOST_PARAMS: Record<string, string[]> = {
  'youtube.com': ['si', 'pp'],
  'youtu.be': ['si'],
  'x.com': ['s', 't'],
  'twitter.com': ['s', 't'],
  'instagram.com': ['igsh'],
  'reddit.com': ['share_id', 'rdt'],
};

function hostParams(host: string): string[] {
  const out: string[] = [];
  for (const [h, params] of Object.entries(HOST_PARAMS)) {
    if (host === h || host.endsWith(`.${h}`)) out.push(...params);
  }
  return out;
}

/** Returns the cleaned URL, or null if nothing was removed. Never throws. */
export function stripTrackingParams(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (!url.search) return null;
  const perHost = hostParams(url.hostname.toLowerCase());
  let changed = false;
  for (const key of [...url.searchParams.keys()]) {
    const k = key.toLowerCase();
    if (GLOBAL_PARAMS.has(k) || GLOBAL_PREFIXES.some((p) => k.startsWith(p)) || perHost.includes(k)) {
      url.searchParams.delete(key);
      changed = true;
    }
  }
  return changed ? url.toString() : null;
}
