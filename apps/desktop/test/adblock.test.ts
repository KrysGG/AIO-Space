import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ENGINE_VERSION } from '@ghostery/adblocker';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core';
import { compileEngine } from '../src/main/privacy/filterLists';

/**
 * Ad and tracker blocking (ROADMAP 3.5/3.6) in the real app, offline: the profile starts with a fresh
 * filter cache compiled from tiny lists, so nothing is downloaded. Run `electron-vite build` first.
 */
const ADS = ['/ad-script.js', '##.ad-box'].join('\n');
const TRACKERS = ['/track.gif'].join('\n');
const PAGE = `<!doctype html><title>ads</title>
  <div class="ad-box" style="height:50px">ad</div><div class="content" style="height:50px">content</div>
  <script src="/ad-script.js"></script><img src="/track.gif">`;

describe('ad and tracker blocking', () => {
  let server: Server;
  let url = '';
  const requested: string[] = [];
  const profile = mkdtempSync(join(tmpdir(), 'aio-ads-'));
  let app: ElectronApplication;
  let ui: Page;

  const inPage = (js: string) =>
    app.evaluate(async ({ webContents }, [u, code]) => {
      const wc = webContents.getAllWebContents().find((w) => w.getURL() === u && !w.isLoading());
      return wc ? wc.executeJavaScript(code) : undefined;
    }, [url, js] as const);
  const visible = (selector: string) => inPage(`document.querySelector('${selector}').offsetHeight > 0`);

  beforeAll(async () => {
    const dir = join(profile, 'filters');
    mkdirSync(dir, { recursive: true });
    for (const [kind, text, cosmetic] of [['ads', ADS, true], ['trackers', TRACKERS, false]] as const) {
      writeFileSync(join(dir, `${kind}.bin`), compileEngine([text], cosmetic).serialize());
      writeFileSync(join(dir, `${kind}.json`), JSON.stringify({ engineVersion: ENGINE_VERSION, updatedAt: Date.now(), rules: 1 }));
    }
    server = createServer((req, res) => {
      requested.push(req.url ?? '');
      res.writeHead(200, { 'content-type': req.url === '/' ? 'text/html' : 'text/plain' }).end(req.url === '/' ? PAGE : '');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
    app = await electron.launch({
      args: [join(__dirname, '..')],
      env: { ...process.env, AIO_USER_DATA_DIR: profile, ELECTRON_RENDERER_URL: '' },
    });
    ui = await app.firstWindow();
    await ui.locator('.tile-body button', { hasText: 'Browser' }).click();
    const address = ui.getByRole('textbox', { name: 'Address or search' });
    await address.fill(url);
    await address.press('Enter');
  });

  afterAll(async () => {
    await app?.close();
    server?.close();
    rmSync(profile, { recursive: true, force: true });
  });

  it('blocks listed requests, counts them, and hides ad elements', async () => {
    await expect.poll(() => visible('.ad-box'), { timeout: 20_000 }).toBe(false);
    expect(await visible('.content')).toBe(true);
    expect(requested).not.toContain('/ad-script.js');
    expect(requested).not.toContain('/track.gif');
    // The tile header's count is throttled (250 ms).
    await expect.poll(() => ui.locator('.shield-btn').innerText(), { timeout: 10_000 }).toBe('2');
  });

  it('turning "Block ads" off for the app lets ads through; trackers stay blocked', async () => {
    await ui.locator('.shield-btn').click();
    await ui.locator('.shield-switch', { hasText: 'Block ads' }).locator('input').uncheck();
    await ui.keyboard.press('Escape');
    // Settings are saved shortly after the change; filters read them per request from then on.
    await expect
      .poll(() => ui.evaluate(async () => (await window.aio.getWorkspace()).privacyOverrides['browser']?.blockAds))
      .toBe(false);
    await inPage('location.reload()');
    await expect.poll(() => requested.includes('/ad-script.js'), { timeout: 20_000 }).toBe(true);
    await expect.poll(() => visible('.ad-box')).toBe(true);
    expect(requested).not.toContain('/track.gif');
  });
});
