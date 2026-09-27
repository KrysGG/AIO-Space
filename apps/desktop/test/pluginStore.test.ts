import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  existsSync,
  readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MAX_PLUGIN_BYTES, PluginStore } from '../src/main/plugins/pluginStore';

const SAMPLE = join(__dirname, '../../../examples/plugins/youtube-hide-shorts');
const dirs: string[] = [];
const temp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'aio-plugins-'));
  dirs.push(d);
  return d;
};
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

/** A plugin folder with the given manifest fields and files. */
function pluginFolder(
  manifest: Record<string, unknown>,
  files: Record<string, string> = { 'a.js': '1', 'a.css': 'a{}' },
): string {
  const d = temp();
  writeFileSync(
    join(d, 'manifest.json'),
    JSON.stringify({
      id: 'test-plugin',
      name: 'Test',
      version: '1.0',
      apps: ['youtube'],
      scripts: ['a.js'],
      styles: ['a.css'],
      ...manifest,
    }),
  );
  for (const [name, text] of Object.entries(files)) writeFileSync(join(d, name), text);
  return d;
}

describe('PluginStore (ROADMAP 4.4)', () => {
  it('installs the sample plugin, copying only what the manifest lists, and loads it again', async () => {
    const dir = temp();
    const store = new PluginStore(dir);
    const info = await store.install(SAMPLE);
    expect(info).toMatchObject({
      id: 'youtube-hide-shorts',
      name: 'YouTube: hide Shorts',
      apps: ['youtube'],
    });
    expect(readdirSync(join(dir, 'youtube-hide-shorts')).sort()).toEqual([
      'hide-shorts.css',
      'hide-shorts.js',
      'manifest.json',
    ]);
    const again = new PluginStore(dir);
    await again.load();
    expect(again.list()).toEqual([info]);
  });

  it('runs a plugin only in its apps, and only when enabled, each in its own world', async () => {
    const store = new PluginStore(temp());
    await store.install(SAMPLE);
    await store.install(pluginFolder({ id: 'other', apps: ['youtube', 'reddit'] }));
    expect(store.forApp('youtube', [])).toEqual([]);
    expect(store.forApp('reddit', ['youtube-hide-shorts'])).toEqual([]);
    const both = store.forApp('youtube', ['youtube-hide-shorts', 'other']);
    expect(both.map((p) => p.manifest.id).sort()).toEqual(['other', 'youtube-hide-shorts']);
    expect(new Set(both.map((p) => p.world)).size).toBe(2);
    expect(both.find((p) => p.manifest.id === 'youtube-hide-shorts')!.scripts[0]).toContain(
      '/watch?v=',
    );
  });

  it('refuses bad plugins with a reason, and never reads outside the folder', async () => {
    const store = new PluginStore(temp());
    const outside = join(temp(), 'secret.js');
    writeFileSync(outside, 'secret');
    const linked = pluginFolder({ scripts: ['link.js'], styles: [] }, {});
    symlinkSync(outside, join(linked, 'link.js'));
    const cases: Array<[string, RegExp]> = [
      [temp(), /manifest\.json/],
      [pluginFolder({ id: '../escape' }), /id/],
      [pluginFolder({ scripts: ['../secret.js'] }), /scripts/],
      [pluginFolder({ scripts: ['sub/a.js'] }), /scripts/],
      [pluginFolder({ scripts: ['missing.js'] }), /missing\.js/],
      [linked, /link\.js/],
      [pluginFolder({ permissions: ['storage'] }), /permissions/],
      [pluginFolder({ apps: [] }), /apps/],
      [pluginFolder({ scripts: [], styles: [] }), /script or style/],
      [pluginFolder({ extra: true }), /Unrecognized/],
      [pluginFolder({}, { 'a.js': 'x'.repeat(MAX_PLUGIN_BYTES), 'a.css': 'a{}' }), /1 MB/],
    ];
    for (const [folder, reason] of cases)
      await expect(store.install(folder), folder).rejects.toThrow(reason);
    expect(store.list()).toEqual([]);
  });

  it('updates in place, removes, and skips folders that don’t match their manifest', async () => {
    const dir = temp();
    const store = new PluginStore(dir);
    await store.install(pluginFolder({ version: '1.0' }));
    await store.install(pluginFolder({ version: '2.0' }));
    expect(store.list().map((p) => p.version)).toEqual(['2.0']);
    await store.remove('test-plugin');
    expect(store.list()).toEqual([]);
    expect(existsSync(join(dir, 'test-plugin'))).toBe(false);
    // A folder renamed by hand (id and folder differ) is ignored.
    mkdirSync(join(dir, 'renamed'));
    writeFileSync(
      join(dir, 'renamed', 'manifest.json'),
      JSON.stringify({
        id: 'other',
        name: 'x',
        version: '1',
        apps: ['youtube'],
        styles: ['a.css'],
      }),
    );
    writeFileSync(join(dir, 'renamed', 'a.css'), 'a{}');
    await store.load();
    expect(store.list()).toEqual([]);
  });
});
