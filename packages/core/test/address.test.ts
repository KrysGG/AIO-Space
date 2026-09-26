import { describe, expect, it } from 'vitest';
import { addressToUrl, engineOf, isWebUrl, SEARCH_ENGINES, urlAfterEngineSwitch } from '../src/browser/address';
import { defaultWorkspace, migrateWorkspace, WORKSPACE_VERSION } from '../src/workspace/workspace';

describe('addressToUrl', () => {
  const go = (t: string) => addressToUrl(t, 'duckduckgo');

  it('keeps full http(s) URLs', () => {
    expect(go('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
    expect(go('  http://example.com  ')).toBe('http://example.com/');
  });

  it('adds https:// to things that look like addresses', () => {
    expect(go('example.com')).toBe('https://example.com/');
    expect(go('news.ycombinator.com/item?id=1')).toBe('https://news.ycombinator.com/item?id=1');
    expect(go('localhost:5173')).toBe('https://localhost:5173/');
    expect(go('192.168.1.10')).toBe('https://192.168.1.10/');
  });

  it('searches everything else with the chosen engine', () => {
    expect(go('how to tile windows')).toBe('https://duckduckgo.com/?q=how%20to%20tile%20windows');
    expect(go('electron')).toBe('https://duckduckgo.com/?q=electron');
    expect(addressToUrl('a&b', 'brave')).toBe('https://search.brave.com/search?q=a%26b');
    expect(addressToUrl('x', 'startpage')).toBe('https://www.startpage.com/do/search?q=x');
  });

  it('never turns other schemes into URLs', () => {
    for (const t of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,hi', 'chrome://settings', 'ssh://host']) {
      const url = go(t)!;
      expect(url.startsWith('https://duckduckgo.com/?q=')).toBe(true);
    }
  });

  it('returns null for empty input', () => {
    expect(go('   ')).toBeNull();
  });

  it('isWebUrl accepts only http(s) with a host', () => {
    expect(isWebUrl('https://a.example')).toBe(true);
    expect(isWebUrl('javascript:alert(1)')).toBe(false);
    expect(isWebUrl('https://')).toBe(false);
    expect(isWebUrl('nonsense')).toBe(false);
  });

  it('every engine searches over https', () => {
    for (const e of Object.values(SEARCH_ENGINES)) expect(e.searchUrl('q').startsWith('https://')).toBe(true);
  });
});

describe('switching search engine', () => {
  it('recognises engine pages and their query', () => {
    expect(engineOf('https://duckduckgo.com/')).toEqual({ engine: 'duckduckgo', query: null });
    expect(engineOf('https://duckduckgo.com/?q=tiling+wm&ia=web')).toEqual({ engine: 'duckduckgo', query: 'tiling wm' });
    expect(engineOf('https://search.brave.com/search?q=a%26b')).toEqual({ engine: 'brave', query: 'a&b' });
    expect(engineOf('https://www.startpage.com/do/search?query=x')).toEqual({ engine: 'startpage', query: 'x' });
    expect(engineOf('https://startpage.com/')).toEqual({ engine: 'startpage', query: null });
    expect(engineOf('https://example.com/?q=1')).toBeNull();
    expect(engineOf('https://duckduckgo.com.evil.example/')).toBeNull();
  });

  it('moves engine pages to the new engine and leaves other sites alone', () => {
    expect(urlAfterEngineSwitch('https://duckduckgo.com/', 'brave')).toBe('https://search.brave.com/');
    expect(urlAfterEngineSwitch('https://duckduckgo.com/?q=tiling+wm', 'startpage')).toBe('https://www.startpage.com/do/search?q=tiling%20wm');
    expect(urlAfterEngineSwitch('https://search.brave.com/search?q=x', 'brave')).toBeNull();
    expect(urlAfterEngineSwitch('https://example.com/', 'brave')).toBeNull();
    expect(urlAfterEngineSwitch('', 'brave')).toBeNull();
  });
});

describe('migrateWorkspace', () => {
  it('upgrades version 1 by adding browser settings and keeping the layout', () => {
    const current = defaultWorkspace();
    const v1: Record<string, unknown> = { ...current, version: 1 };
    delete v1['browser'];
    const out = migrateWorkspace(v1);
    expect(out.version).toBe(WORKSPACE_VERSION);
    expect(out.browser).toEqual({ searchEngine: 'duckduckgo' });
    expect(out.spaces).toEqual(current.spaces);
  });

  it('upgrades version 2 by giving every app tile an instance id', () => {
    const leaf = (id: string, appId: string | null) => ({ type: 'leaf', id, appId });
    const v2 = {
      ...defaultWorkspace(),
      version: 2,
      spaces: [{ id: 'space_main', name: 'Main', focusedLeafId: 'leaf_a', layout: { type: 'split', id: 'split_1', direction: 'row', ratio: 0.5, first: leaf('leaf_a', 'discord'), second: leaf('leaf_b', null) } }],
    };
    const out = migrateWorkspace(v2);
    expect(out.version).toBe(3);
    const layout = out.spaces[0]!.layout as { first: { instanceId: string | null }; second: { instanceId: string | null } };
    expect(layout.first.instanceId).toMatch(/^app_[a-z0-9]+$/);
    expect(layout.second.instanceId).toBeNull();
  });

  it('falls back to defaults for unknown or future versions', () => {
    expect(migrateWorkspace({ version: 99 }).spaces).toHaveLength(1);
    expect(migrateWorkspace({ foo: 1 }).version).toBe(WORKSPACE_VERSION);
    expect(migrateWorkspace(null).version).toBe(WORKSPACE_VERSION);
  });
});
