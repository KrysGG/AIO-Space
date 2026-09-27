import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { defaultWorkspace, setForgetOnClose, addProfile } from '@aio/core';

vi.mock('electron', () => ({ session: {} }));
const { allAppPartitions, partitionDir, partitionsOfApp, scheduleWipe, wipeAtStartup } = await import('../src/main/store/siteData');

describe('site data (ROADMAP 3.9)', () => {
  const userData = mkdtempSync(join(tmpdir(), 'aio-data-'));
  afterAll(() => rmSync(userData, { recursive: true, force: true }));
  const makeDir = (name: string): string => {
    const dir = join(userData, 'Partitions', name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'Cookies'), 'secret');
    return dir;
  };

  it('knows every account partition of an app, and of all apps', () => {
    const { ws } = addProfile(defaultWorkspace(), 'discord');
    expect(partitionsOfApp(ws, 'discord')).toEqual(['persist:app-discord-default', 'persist:app-discord-p2']);
    expect(allAppPartitions(ws)).toContain('persist:app-discord-p2');
    expect(allAppPartitions(ws)).toContain('persist:app-browser-default');
    expect(partitionDir('/u', 'persist:app-reddit-default')).toBe('/u/Partitions/app-reddit-default');
  });

  it('deletes queued folders and forget-on-close apps at startup, and nothing else', async () => {
    const reddit = makeDir('app-reddit-default');
    const x = makeDir('app-x-default');
    const discord = makeDir('app-discord-default');
    await scheduleWipe(userData, ['persist:app-reddit-default']);
    await scheduleWipe(userData, ['persist:app-reddit-default']); // queued once
    expect(JSON.parse(readFileSync(join(userData, 'wipe.json'), 'utf8'))).toEqual(['persist:app-reddit-default']);

    const ws = setForgetOnClose(defaultWorkspace(), 'x', true);
    await wipeAtStartup(userData, ws);
    expect(existsSync(reddit)).toBe(false);
    expect(existsSync(x)).toBe(false);
    expect(existsSync(discord)).toBe(true);
    expect(existsSync(join(userData, 'wipe.json'))).toBe(false);
  });

  it('ignores anything in the wipe list that is not an app partition', async () => {
    writeFileSync(join(userData, 'wipe.json'), JSON.stringify(['../../etc', 'persist:aio-filter-lists', 42]));
    const deleted = await wipeAtStartup(userData, defaultWorkspace());
    expect(deleted).toEqual([]);
  });
});
