import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core';

/**
 * Fingerprinting protection (ROADMAP 3.4) in the real app, against a page served from 127.0.0.1
 * (local hosts are never upgraded to https). Run `electron-vite build` first; `pnpm test` does.
 */
const PAGE = `<!doctype html><title>fp</title><script>
  const c = document.createElement('canvas'); c.width = 64; c.height = 32;
  const x = c.getContext('2d'); x.fillStyle = '#f60'; x.fillRect(0, 0, 64, 32);
  x.fillStyle = '#069'; x.font = '14px sans-serif'; x.fillText('fp test', 2, 20);
  window.fpHash = [...x.getImageData(0, 0, 64, 32).data].reduce((h, v) => (Math.imul(h, 31) + v) | 0, 7);
</script>`;

describe('fingerprinting protection', () => {
  let server: Server;
  let url = '';
  const profile = mkdtempSync(join(tmpdir(), 'aio-fp-'));
  let app: ElectronApplication;
  let ui: Page;

  const launch = async (): Promise<void> => {
    app = await electron.launch({
      args: [join(__dirname, '..')],
      env: { ...process.env, AIO_USER_DATA_DIR: profile, ELECTRON_RENDERER_URL: '' },
    });
    ui = await app.firstWindow();
    await ui.locator('.tile').first().waitFor();
  };
  const inPage = (js: string) =>
    app.evaluate(async ({ webContents }, [u, code]) => {
      const wc = webContents.getAllWebContents().find((w) => w.getURL() === u && !w.isLoading());
      return wc ? wc.executeJavaScript(code) : undefined;
    }, [url, js] as const);
  const openPage = async (): Promise<void> => {
    const browser = ui.locator('.tile-body button', { hasText: 'Browser' });
    if (await browser.count()) await browser.click();
    const address = ui.getByRole('textbox', { name: 'Address or search' });
    await address.fill(url);
    await address.press('Enter');
    await expect.poll(() => inPage('typeof window.fpHash'), { timeout: 20_000 }).toBe('number');
  };

  beforeAll(async () => {
    server = createServer((_req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end(PAGE));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
    await launch();
  });

  afterAll(async () => {
    await app?.close();
    server?.close();
    rmSync(profile, { recursive: true, force: true });
  });

  let firstRun = 0;

  it('farbles canvas reads, stable within a run, and exposes nothing to the page', async () => {
    await openPage();
    firstRun = await inPage('window.fpHash');
    expect(await inPage('navigator.globalPrivacyControl')).toBe(true);
    expect(await inPage('navigator.webdriver')).toBe(false); // true under automation without protection
    expect(await inPage('HTMLCanvasElement.prototype.toDataURL.toString()')).toBe('function toDataURL() { [native code] }');
    expect(await inPage('Function.prototype.toString.toString()')).toBe('function toString() { [native code] }');
    expect(await inPage('Object.keys(window).filter((k) => /aio|farbl|seed/i.test(k)).length')).toBe(0);

    await inPage('location.reload()');
    await expect.poll(() => inPage('window.fpHash'), { timeout: 20_000 }).toBe(firstRun);
  });

  it('gives the same page a different fingerprint in the next run', async () => {
    await app.close();
    await launch();
    await openPage();
    expect(await inPage('window.fpHash')).not.toBe(firstRun);
  });

  it('turning fingerprinting off gives the page its real values', async () => {
    await ui.evaluate(async () => {
      const ws = await window.aio.getWorkspace();
      await window.aio.saveWorkspace({ ...ws, privacy: { ...ws.privacy, fingerprinting: 'off', globalPrivacyControl: false } });
    });
    await expect.poll(() => inPage('navigator.webdriver'), { timeout: 20_000 }).toBe(true);
    expect(await inPage('navigator.globalPrivacyControl')).toBeUndefined();
  });
});
