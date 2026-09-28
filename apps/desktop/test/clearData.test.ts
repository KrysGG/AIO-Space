import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core';

/**
 * Clear data and forget mode (ROADMAP 3.9) in the real app, with a local "site" that logs in by
 * setting a cookie and a localStorage token. Run `electron-vite build` first; `pnpm test` does.
 *
 * Only the /login response's own served bytes contain the literal token (a real login endpoint
 * hands a client a token once; it doesn't keep re-printing it into every later page's markup). Every
 * other path just reads it back from localStorage/cookies client-side. This matters because D-049
 * restores a Browser tab to its last URL on the next launch and refetches it: if every response
 * echoed the token in its own source, that refetch (of a page whose *server-sent bytes* never held
 * a secret to begin with) would leave a disk-cache copy containing it, which would look like leaked
 * session data but would actually just be this app correctly behaving like a normal browser.
 */
const TOKEN = 'tok-secret-5f2a91';
const STATE_SCRIPT = `<script>window.state = { cookie: document.cookie, token: localStorage.getItem('token') };</script>`;
const LOGIN_PAGE = `<!doctype html><title>site</title><script>localStorage.setItem('token', '${TOKEN}');</script>${STATE_SCRIPT}`;
const HOME_PAGE = `<!doctype html><title>site</title>${STATE_SCRIPT}`;

/** True if any file under `dir` contains `needle` (cookies, LevelDB logs, caches...). */
function onDisk(dir: string, needle: string): boolean {
  if (!existsSync(dir)) return false;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    let st;
    try {
      st = statSync(path);
      if (st.isDirectory() ? onDisk(path, needle) : st.size < 50_000_000 && readFileSync(path).includes(needle)) return true;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      // Chromium deletes temporary files (SQLite journals) while we scan: a file that's gone holds nothing.
      // Windows: LevelDB/SQLite LOCK files are byte-range locked while the app runs; they're empty, so they
      // can't hold the needle. Any other unreadable file still fails the test.
      if (code === 'ENOENT' || (code === 'EBUSY' && st?.size === 0)) continue;
      throw err;
    }
  }
  return false;
}

/**
 * A marker file dropped straight into the partition folder (not via Chromium at all), so checking
 * it survives is a direct, deterministic test of "the whole folder gets deleted at next start" -
 * unlike grepping for a value that might happen to also be cleared some other way, which wouldn't
 * catch a regression in that specific step (see the "Chromium may keep deleted bytes until they
 * compact" comment in siteData.ts, which is what the folder delete exists to guard against).
 */
const CANARY = 'canary.marker';
function plantCanary(dir: string): void {
  writeFileSync(join(dir, CANARY), 'still here');
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
    // Load the signed-in home page too, so a session-bound (cookie-echoing) response is what ends
    // up cached on disk, the way a real account page would.
    await go('/');
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
      res.writeHead(200, headers).end(req.url === '/login' ? LOGIN_PAGE : HOME_PAGE);
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
    plantCanary(partition);
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
    expect(existsSync(join(partition, CANARY))).toBe(false);
  });

  it('adds, renames and removes an account: its tiles go back to the first, its data is deleted (ROADMAP 2.12)', async () => {
    const accounts = () => ui.evaluate(async () => (await window.aio.getWorkspace()).profiles['browser'] ?? []);
    const second = join(profile, 'Partitions', 'app-browser-p2');
    await go('/');
    await ui.getByRole('combobox', { name: 'Account' }).selectOption('+add');
    await expect.poll(accounts).toEqual([{ id: 'p2', name: 'Account 2' }]);
    await go('/login');
    await expect.poll(state, { timeout: 20_000 }).toEqual({ cookie: 'session=abc123', token: TOKEN });
    await app.evaluate(async ({ session }) => {
      const ses = session.fromPartition('persist:app-browser-p2');
      ses.flushStorageData();
      await ses.cookies.flushStore();
    });
    await expect.poll(() => onDisk(second, TOKEN), { timeout: 10_000 }).toBe(true);
    plantCanary(second);

    await ui.locator('.shield-btn').click();
    const name = ui.getByRole('textbox', { name: 'Account name' });
    await name.fill('Work');
    await name.press('Enter');
    await expect.poll(accounts).toEqual([{ id: 'p2', name: 'Work' }]);
    ui.once('dialog', (d) => void d.accept());
    await ui.getByRole('button', { name: 'Remove account' }).click();

    await expect.poll(accounts).toEqual([]);
    await expect.poll(() => ui.getByRole('combobox', { name: 'Account' }).inputValue()).toBe('default');
    await app.close();
    await launch();
    expect(existsSync(second)).toBe(false);
  });

  it('"Forget when SpaceAIO closes" clears the app on quit', async () => {
    await logIn();
    plantCanary(partition);
    await ui.locator('.shield-btn').click();
    await ui.locator('.shield-switch', { hasText: 'Forget Browser when SpaceAIO closes' }).locator('input').check();
    await ui.keyboard.press('Escape');
    await expect.poll(() => ui.evaluate(async () => (await window.aio.getWorkspace()).forgetOnClose)).toEqual(['browser']);

    await app.close();
    await launch();
    expect(onDisk(partition, TOKEN)).toBe(false);
    expect(existsSync(join(partition, CANARY))).toBe(false);
    await go('/');
    await expect.poll(state, { timeout: 20_000 }).toEqual({ cookie: '', token: null });
  });
});
