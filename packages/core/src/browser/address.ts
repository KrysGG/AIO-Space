/**
 * The Browser tile's address bar: search engines and turning typed text into a URL.
 * Only https/http URLs ever come out; anything else (javascript:, file:, ...) becomes a search.
 */

export type SearchEngineId = 'duckduckgo' | 'brave' | 'startpage';

export interface SearchEngine {
  id: SearchEngineId;
  name: string;
  home: string;
  searchUrl(query: string): string;
}

export const SEARCH_ENGINES: Record<SearchEngineId, SearchEngine> = {
  duckduckgo: {
    id: 'duckduckgo',
    name: 'DuckDuckGo',
    home: 'https://duckduckgo.com/',
    searchUrl: (q) => `https://duckduckgo.com/?q=${encodeURIComponent(q)}`,
  },
  brave: {
    id: 'brave',
    name: 'Brave Search',
    home: 'https://search.brave.com/',
    searchUrl: (q) => `https://search.brave.com/search?q=${encodeURIComponent(q)}`,
  },
  startpage: {
    id: 'startpage',
    name: 'Startpage',
    home: 'https://www.startpage.com/',
    searchUrl: (q) => `https://www.startpage.com/do/search?q=${encodeURIComponent(q)}`,
  },
};

export const DEFAULT_SEARCH_ENGINE: SearchEngineId = 'duckduckgo';

/** example.com, sub.example.co.uk:8080/path, localhost:3000, 192.168.1.10 */
const HOST_LIKE = /^(localhost|(\d{1,3}\.){3}\d{1,3}|([a-z0-9-]+\.)+[a-z][a-z0-9-]*)(:\d{1,5})?([/?#].*)?$/i;

/** True for http(s) URLs with a host; the only URLs the Browser tile may load. */
export function isWebUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (u.protocol === 'https:' || u.protocol === 'http:') && u.hostname !== '';
  } catch {
    return false;
  }
}

/** Typed text to a URL: a web address as-is (https assumed), anything else searched. Null if empty. */
export function addressToUrl(text: string, engine: SearchEngineId): string | null {
  const t = text.trim();
  if (!t) return null;
  if (/^https?:\/\//i.test(t) && isWebUrl(t)) return new URL(t).href;
  if (!/\s/.test(t) && HOST_LIKE.test(t) && isWebUrl(`https://${t}`)) return new URL(`https://${t}`).href;
  return SEARCH_ENGINES[engine].searchUrl(t);
}

/** Which engine a URL belongs to, and the search on it (null on its home or other pages). */
export function engineOf(url: string): { engine: SearchEngineId; query: string | null } | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  const engine = (Object.values(SEARCH_ENGINES) as SearchEngine[]).find((e) => {
    const home = new URL(e.home).hostname;
    return host === home || host === home.replace(/^www\./, '');
  });
  if (!engine) return null;
  const query = u.searchParams.get('q') ?? u.searchParams.get('query');
  return { engine: engine.id, query: query && query.trim() ? query : null };
}

/**
 * Where a Browser tile should go when the user switches engine: the same search (or the home page)
 * on the new engine if it's showing a search engine now; null (stay put) on any other site.
 */
export function urlAfterEngineSwitch(currentUrl: string, to: SearchEngineId): string | null {
  const on = engineOf(currentUrl);
  if (!on || on.engine === to) return null;
  return on.query ? SEARCH_ENGINES[to].searchUrl(on.query) : SEARCH_ENGINES[to].home;
}
