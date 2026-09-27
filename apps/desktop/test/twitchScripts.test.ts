import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileEngine } from '../src/main/privacy/filterLists';
import { ScriptletFiles } from '../src/main/privacy/scriptlets';
import { isTwitchUserscript, TWITCH_SCRIPT_URLS, TwitchScripts } from '../src/main/privacy/twitchScripts';
import { TEST_RESOURCES } from './fixtures';

const vendored = (name: string) => readFileSync(join(__dirname, '../vendor/twitch-ad-solutions', name), 'utf8');

describe('Twitch ad scripts (D-043)', () => {
  it('ships both TwitchAdSolutions scripts, and they pass the download check', () => {
    expect(isTwitchUserscript(vendored('vaft.user.js'))).toBe(true);
    expect(isTwitchUserscript(vendored('video-swap-new.user.js'))).toBe(true);
    expect(() => new Function(vendored('vaft.user.js'))).not.toThrow();
    expect(() => new Function(vendored('video-swap-new.user.js'))).not.toThrow();
  });

  it('rejects downloads that are not those userscripts', () => {
    expect(isTwitchUserscript('<html>404</html>')).toBe(false);
    const other = vendored('vaft.user.js').replace('*://*.twitch.tv/*', '*://*/*');
    expect(isTwitchUserscript(other)).toBe(false);
    const privileged = vendored('vaft.user.js').replace('@grant        none', '@grant        GM_xmlhttpRequest');
    expect(isTwitchUserscript(privileged)).toBe(false);
  });

  it('gives the chosen script, bundled until a valid download replaces it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aio-twitch-'));
    const fresh = vendored('vaft.user.js').replace('68.5.7', '99.0.0');
    const fetched: string[] = [];
    const scripts = new TwitchScripts(dir, async (url) => {
      fetched.push(url);
      if (url === TWITCH_SCRIPT_URLS.vaft) return fresh;
      throw new Error('HTTP 503');
    });
    expect(scripts.scriptsFor('off')).toEqual([]);
    expect(scripts.scriptsFor('vaft')[0]).toContain('68.5.7');
    let updated = 0;
    scripts.onUpdated = () => updated++;
    await scripts.update();
    expect(fetched).toEqual([TWITCH_SCRIPT_URLS.vaft, TWITCH_SCRIPT_URLS['video-swap-new']]);
    expect(scripts.scriptsFor('vaft')[0]).toContain('99.0.0');
    expect(scripts.scriptsFor('video-swap-new')[0]).toContain('video-swap-new'); // failed download: bundled copy
    expect(updated).toBe(1);

    const again = new TwitchScripts(dir, async () => {
      throw new Error('offline');
    });
    await again.start();
    expect(again.scriptsFor('vaft')[0]).toContain('99.0.0'); // cached download
    rmSync(dir, { recursive: true, force: true });
  });

  it('replaces the lists’ Twitch scriptlets with the chosen script, and only on twitch.tv', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aio-twitch-files-'));
    const engine = compileEngine(['twitch.tv##+js(aio-test, listRule, 1)', 'youtube.com##+js(aio-test, ytRule, 1)'], true);
    engine.updateResources(TEST_RESOURCES, 't');
    let choice: string[] = ['/* TWITCH SCRIPT */'];
    const files = new ScriptletFiles(dir, () => engine, (site) => (site === 'twitch.tv' ? choice : []));
    const file = files.fileFor('persist:app-twitch-default', ['twitch.tv', 'youtube.com']);
    let src = readFileSync(file, 'utf8');
    expect(src).toContain('/* TWITCH SCRIPT */');
    expect(src).not.toContain('listRule');
    expect(src).toContain('ytRule');
    choice = []; // "Off": the lists' rule is back
    files.refresh();
    src = readFileSync(file, 'utf8');
    expect(src).not.toContain('/* TWITCH SCRIPT */');
    expect(src).toContain('listRule');
    rmSync(dir, { recursive: true, force: true });
  });
});
