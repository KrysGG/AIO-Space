import { describe, expect, it } from 'vitest';
import { BUILTIN_APPS } from '../src/catalog/apps';
import { appFromStore, installedFromStore, searchStore, STORE_APPS } from '../src/catalog/store';

describe('app store (catalog)', () => {
  it('every entry builds a valid custom app with the listed permissions', () => {
    for (const entry of STORE_APPS) {
      const res = appFromStore(entry, []);
      expect(res.ok, entry.id).toBe(true);
      if (!res.ok) continue;
      expect(res.app.url).toBe(entry.url);
      expect(res.app.permissions).toEqual(entry.permissions);
      expect(res.app.allowedHosts).not.toContain('*');
      expect(res.app.brand).toBe(entry.id);
      expect(res.app.color).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('has unique ids and no entry duplicating a built-in app', () => {
    expect(new Set(STORE_APPS.map((a) => a.id)).size).toBe(STORE_APPS.length);
    const builtinHosts = BUILTIN_APPS.map((a) => new URL(a.url).hostname);
    for (const entry of STORE_APPS) expect(builtinHosts).not.toContain(new URL(entry.url).hostname);
  });

  it('knows which entries were added already', () => {
    const twitch = STORE_APPS.find((a) => a.id === 'twitch')!;
    const res = appFromStore(twitch, []);
    if (!res.ok) throw new Error(res.error);
    expect(installedFromStore(twitch, [...BUILTIN_APPS])).toBeUndefined();
    expect(installedFromStore(twitch, [...BUILTIN_APPS, res.app])?.id).toBe(res.app.id);
  });

  it('searches names, descriptions and categories; filters by category and Popular', () => {
    expect(searchStore('twitch', 'All').map((a) => a.id)).toEqual(['twitch']);
    expect(searchStore('email', 'All').map((a) => a.id)).toEqual(expect.arrayContaining(['gmail', 'outlook']));
    expect(searchStore('', 'Music').every((a) => a.category === 'Music')).toBe(true);
    expect(searchStore('', 'Popular').every((a) => a.popular)).toBe(true);
    expect(searchStore('', 'All').length).toBe(STORE_APPS.length);
  });
});
