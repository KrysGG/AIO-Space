/** Random id that works in Node 19+, browsers, and React Native (with a crypto polyfill). */
export function newId(prefix = 'n'): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  const raw = c?.randomUUID ? c.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `${prefix}_${raw.replace(/-/g, '').slice(0, 12)}`;
}
