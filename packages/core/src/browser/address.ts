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
