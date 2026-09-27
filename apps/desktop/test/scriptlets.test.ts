import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileEngine } from '../src/main/privacy/filterLists';
import { buildScriptletPreload, ScriptletFiles, scriptletsFor } from '../src/main/privacy/scriptlets';

import { TEST_RESOURCES } from './fixtures';

const engineWith = (rules: string) => {
  const engine = compileEngine([rules], true);
  engine.updateResources(TEST_RESOURCES, 'test');
  return engine;
};

describe('scriptlets (ROADMAP 3.6)', () => {
  it('gets a site’s scriptlets from the ad list, for the site and its subdomains only', () => {
    const engine = engineWith('youtube.com##+js(aio-test, adsOff, yes)');
    const scripts = scriptletsFor(engine, 'youtube.com');
    expect(scripts).toHaveLength(1);
    expect(scripts[0]).toContain('aioTest');
    expect(scriptletsFor(engine, 'example.com')).toEqual([]);
  });

  it('survives the engine cache (resources are serialized with the engine)', async () => {
    const { FiltersEngine } = await import('@ghostery/adblocker');
    const copy = FiltersEngine.deserialize(engineWith('twitch.tv##+js(aio-test, a, b)').serialize());
    expect(scriptletsFor(copy, 'twitch.tv')).toHaveLength(1);
  });

  it('builds a preload that parses, gates on "Block ads", and matches sites by host', () => {
    const src = buildScriptletPreload({ 'youtube.com': ['window.x = 1;'], 'empty.com': [] });
    expect(() => new Function('require', 'process', 'location', src)).not.toThrow();
    expect(src).toContain('"youtube.com"');
    expect(src).not.toContain('"empty.com"');

    const run = (host: string, ads: string) => {
      const calls: string[] = [];
      const contextBridge = { executeInMainWorld: ({ func }: { func: () => void }) => calls.push(func.toString()) };
      new Function('require', 'process', 'location', src)(() => ({ contextBridge }), { argv: [`--aio-webapp=standard,1,abc12345,${ads}`] }, { hostname: host });
      return calls;
    };
    expect(run('www.youtube.com', '1')).toHaveLength(1);
    expect(run('www.youtube.com', '1')[0]).toContain('window.x = 1;');
    expect(run('youtube.com', '1')).toHaveLength(1);
    expect(run('www.youtube.com', '0')).toHaveLength(0); // Block ads off
    expect(run('notyoutube.com', '1')).toHaveLength(0);

    // Never on a sign-in provider's page, even when its site has scriptlets (D-046).
    const google = buildScriptletPreload({ 'google.com': ['window.x = 1;'] });
    const runOn = (host: string) => {
      const calls: string[] = [];
      const contextBridge = { executeInMainWorld: () => calls.push('ran') };
      new Function('require', 'process', 'location', google)(() => ({ contextBridge }), { argv: ['--aio-webapp=standard,1,abc12345,1'] }, { hostname: host });
      return calls.length;
    };
    expect(runOn('www.google.com')).toBe(1);
    expect(runOn('accounts.google.com')).toBe(0);
  });

  it('writes one file per session and rewrites it when the lists change', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aio-scriptlets-'));
    let engine = engineWith('');
    const files = new ScriptletFiles(dir, () => engine);
    const file = files.fileFor('persist:app-youtube-default', ['youtube.com']);
    expect(readFileSync(file, 'utf8')).not.toContain('aioTest');
    engine = engineWith('youtube.com##+js(aio-test, adsOff, yes)');
    files.refresh();
    expect(readFileSync(file, 'utf8')).toContain('aioTest');
    rmSync(dir, { recursive: true, force: true });
  });
});

