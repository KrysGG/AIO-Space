import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { OnBeforeRequestListenerDetails } from 'electron';
import { DEFAULT_PRIVACY, type PrivacySettings } from '@aio/core';
import { compileEngine, FILTER_LISTS, FilterLists, SCRIPTLET_RESOURCES } from '../src/main/privacy/filterLists';
import { TEST_RESOURCES } from './fixtures';
import { buildShieldFilters } from '../src/main/privacy/shields';

const ADS = ['||ads.example^', '/banner-ad.', '@@||ads.example/allowed.js', '##.ad-slot', 'news.test##.sponsored'].join('\n');
const TRACKERS = ['||metrics.example^$third-party', '/collect?tid='].join('\n');

let settings: PrivacySettings;
const engines = { ads: compileEngine([ADS], true), trackers: compileEngine([TRACKERS], false) };
const topUrl = 'https://news.test/story';
const filter = buildShieldFilters(
  () => settings,
  undefined,
  { appSites: null, topUrl: () => topUrl },
  { engine: (kind) => engines[kind] },
).find((f) => f.name === 'filter-lists')!;

const req = (url: string, resourceType = 'script') =>
  ({ url, resourceType, webContentsId: 1, referrer: '' }) as unknown as OnBeforeRequestListenerDetails;

beforeEach(() => {
  settings = { ...DEFAULT_PRIVACY };
});

describe('filter-lists request filter', () => {
  it('blocks ads and trackers from the lists', () => {
    expect(filter.onBeforeRequest!(req('https://ads.example/x.js'))).toEqual({ cancel: true });
    expect(filter.onBeforeRequest!(req('https://cdn.test/img/banner-ad.png', 'image'))).toEqual({ cancel: true });
    expect(filter.onBeforeRequest!(req('https://metrics.example/p', 'xhr'))).toEqual({ cancel: true });
    expect(filter.onBeforeRequest!(req('https://news.test/collect?tid=1', 'ping'))).toEqual({ cancel: true });
  });

  it('respects exception rules, first-party options and ordinary requests', () => {
    expect(filter.onBeforeRequest!(req('https://ads.example/allowed.js'))).toBeUndefined();
    expect(filter.onBeforeRequest!(req('https://cdn.test/app.js'))).toBeUndefined();
  });

  it('never blocks the page load itself', () => {
    expect(filter.onBeforeRequest!(req('https://ads.example/', 'mainFrame'))).toBeUndefined();
  });

  it('follows the per-app switches separately', () => {
    settings.blockAds = false;
    expect(filter.onBeforeRequest!(req('https://ads.example/x.js'))).toBeUndefined();
    expect(filter.onBeforeRequest!(req('https://metrics.example/p', 'xhr'))).toEqual({ cancel: true });
    settings.blockAds = true;
    settings.blockTrackers = false;
    expect(filter.onBeforeRequest!(req('https://metrics.example/p', 'xhr'))).toBeUndefined();
    expect(filter.onBeforeRequest!(req('https://ads.example/x.js'))).toEqual({ cancel: true });
  });

  it('gives cosmetic rules for the site and for classes on the page', () => {
    const { styles } = engines.ads.getCosmeticsFilters({
      url: topUrl,
      hostname: 'news.test',
      domain: 'news.test',
      classes: ['ad-slot', 'content'],
      getRulesFromDOM: true,
      getRulesFromHostname: true,
    });
    expect(styles).toContain('.sponsored');
    expect(styles).toContain('.ad-slot');
    expect(styles).not.toContain('.content');
  });
});

describe('FilterLists', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aio-lists-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('only fetches lists from GitHub raw file URLs', () => {
    for (const { urls } of Object.values(FILTER_LISTS)) {
      for (const u of urls) expect(u).toMatch(/^https:\/\/raw\.githubusercontent\.com\//);
    }
  });

  it('builds engines, caches them on disk, and loads the cache on the next start', async () => {
    const fetched: string[] = [];
    const lists = new FilterLists(dir, async (url) => {
      fetched.push(url);
      if (url === SCRIPTLET_RESOURCES) return TEST_RESOURCES;
      return url.includes('easyprivacy') ? TRACKERS : ADS;
    });
    await lists.update();
    // Every list, plus uBlock's scriptlet library for the ad engine.
    expect(fetched.length).toBe(FILTER_LISTS.ads.urls.length + FILTER_LISTS.trackers.urls.length + 1);
    expect(lists.status().lists.every((l) => l.rules > 0 && l.updatedAt !== null)).toBe(true);

    const offline = new FilterLists(dir, async () => {
      throw new Error('offline');
    });
    await offline.start();
    expect(offline.engine('ads')).toBeDefined();
    expect(offline.engine('trackers')).toBeDefined();
    expect(offline.status().error).toBeNull(); // cache is fresh, so no update was attempted
  });

  it('keeps the old engines and reports the error when an update fails', async () => {
    const lists = new FilterLists(dir, async () => {
      throw new Error('HTTP 503');
    });
    await lists.start();
    await lists.update();
    expect(lists.engine('ads')).toBeDefined();
    expect(lists.status().error).toBe('HTTP 503');
  });

  it('still updates blocking when the scriptlet library is missing', async () => {
    const dir2 = mkdtempSync(join(tmpdir(), 'aio-lists-'));
    const lists = new FilterLists(dir2, async (url) => {
      if (url === SCRIPTLET_RESOURCES) throw new Error('HTTP 404');
      return url.includes('easyprivacy') ? TRACKERS : ADS;
    });
    await lists.update();
    expect(lists.status().error).toBeNull();
    expect(lists.engine('ads')).toBeDefined();
    rmSync(dir2, { recursive: true, force: true });
  });
});
