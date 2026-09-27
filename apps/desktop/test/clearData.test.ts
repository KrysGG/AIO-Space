import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core';

/**
 * Clear data and forget mode (ROADMAP 3.9) in the real app, with a local "site" that logs in by
 * setting a cookie and a localStorage token. Run `electron-vite build` first; `pnpm test` does.
 */
const TOKEN = 'tok-secret-5f2a91';
const PAGE = `<!doctype html><title>site</title><script>
  if (location.pathname === '/login') localStorage.setItem('token', '${TOKEN}');
  window.state = { cookie: document.cookie, token: localStorage.getItem('token') };
</script>`;

/** True if any file under `dir` contains `needle` (cookies, LevelDB logs, caches...). */
function onDisk(dir: string, needle: string): boolean {
  if (!existsSync(dir)) return false;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory() ? onDisk(path, needle) : st.size < 50_000_000 && readFileSync(path).includes(needle)) return true;
  }
  return false;
}

describe('clear data and forget mode', () => {
  let server: Server;
  let origin = '';
  const profile = mkdtempSync(join(tmpdir(), 'aio-clear-'));
  const partition = join(profile, 'Partitions', 'app-browser-default');
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
  const go = async (path: string): Promise<void> => {
    const browser = ui.locator('.tile-body button', { hasText: 'Browser' });
    if (await browser.count()) await browser.click();
    const address = ui.getByRole('textbox', { name: 'Address or search' });
    await address.fill(origin + path);
    await address.press('Enter');
  };
  const state = () =>
    app.evaluate(async ({ webContents }, o) => {
      const wc = webContents.getAllWebContents().find((w) => w.getURL().startsWith(o) && !w.isLoading());
      return wc ? (wc.executeJavaScript('window.state') as Promise<{ cookie: string; token: string | null }>) : undefined;
    }, origin);
  const logIn = async (): Promise<void> => {
    await go('/login');
    await expect.poll(state, { timeout: 20_000 }).toEqual({ cookie: 'session=abc123', token: TOKEN });
    // Let Chromium write it all to disk (it commits storage every few seconds).
    await app.evaluate(async ({ session }) => {
      const ses = session.fromPartition('persist:app-browser-default');
      ses.flushStorageData();
      await ses.cookies.flushStore();
    });
    await new Promise((r) => setTimeout(r, 1500));
    expect(onDisk(partition, TOKEN)).toBe(true);
  };

  beforeAll(async () => {
    server = createServer((req, res) => {
      const headers: Record<string, string> = { 'content-type': 'text/html' };
      if (req.url === '/login') headers['set-cookie'] = 'session=abc123; Path=/; Max-Age=86400';
      res.writeHead(200, headers).end(PAGE);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    await launch();
  });

  afterAll(async () => {
    await app?.close();
    server?.close();
    rmSync(profile, { recursive: true, force: true });
  });

  it('"Clear data" logs the app out now and removes its files at the next start', async () => {
    await logIn();
    ui.once('dialog', (d) => void d.accept());
    await ui.locator('.shield-btn').click();
    await ui.getByRole('button', { name: /^Clear data for Browser/ }).click();
    await ui.getByRole('status').filter({ hasText: 'Cleared' }).waitFor();
    await ui.keyboard.press('Escape');

    await go('/');
    await expect.poll(state, { timeout: 20_000 }).toEqual({ cookie: '', token: null });

    await app.close();
    await launch();
    expect(onDisk(partition, TOKEN)).toBe(false);
  });

  it('"Forget when AIO Space closes" clears the app on quit', async () => {
    await logIn();
    await ui.locator('.shield-btn').click();
    await ui.locator('.shield-switch', { hasText: 'Forget Browser when AIO Space closes' }).locator('input').check();
    await ui.keyboard.press('Escape');
    await expect.poll(() => ui.evaluate(async () => (await window.aio.getWorkspace()).forgetOnClose)).toEqual(['browser']);

    await app.close();
    await launch();
    expect(onDisk(partition, TOKEN)).toBe(false);
    await go('/');
    await expect.poll(state, { timeout: 20_000 }).toEqual({ cookie: '', token: null });
  });
});
