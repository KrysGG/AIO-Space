/**
 * Minimal WHATWG URL typing. URL exists in Node, browsers and React Native (with polyfill),
 * but we don't pull in lib "DOM" so core can't accidentally use browser-only APIs.
 */
declare class URLSearchParams {
  keys(): IterableIterator<string>;
  delete(name: string): void;
  get(name: string): string | null;
}
declare class URL {
  constructor(url: string, base?: string);
  hostname: string;
  protocol: string;
  search: string;
  origin: string;
  href: string;
  readonly searchParams: URLSearchParams;
  toString(): string;
}
