import type { Session } from 'electron';

const MAX_BYTES = 100 * 1024;
const TYPES = new Set(['image/png', 'image/x-icon', 'image/vnd.microsoft.icon', 'image/gif', 'image/webp', 'image/jpeg']);

/**
 * First usable favicon as a data: URL, or null. Fetched with the app's own session (its cookies,
 * its shields), https only, small raster images only (no SVG), so it's safe to show in the UI.
 */
export async function fetchFavicon(ses: Session, candidates: string[]): Promise<string | null> {
  for (const url of candidates.slice(0, 4)) {
    if (!url.startsWith('https://')) continue;
    try {
      const res = await ses.fetch(url, { signal: AbortSignal.timeout(8000) });
      const type = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
      if (!res.ok || !TYPES.has(type)) continue;
      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes.length === 0 || bytes.length > MAX_BYTES) continue;
      return `data:${type};base64,${bytes.toString('base64')}`;
    } catch {
      // try the next one
    }
  }
  return null;
}
