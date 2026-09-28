import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core';

/**
 * Sign-in stays in the app (D-044): a custom app's page opens a blank sign-in popup and sends the
 * page to Google's sign-in, as "Continue with Google" buttons do. The system browser is replaced by a
 * recorder, so the test sees exactly what would have left the app.
 */
const PAGE = '<!doctype html><title>signin</title>';

async function until<T>(get: () => Promise<T>, timeout = 20_000): Promise<T> {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await get();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe('sign-in popups and redirects stay in the app', () => {
  let server: Server;
  let page = '';
  const profile = mkdtempSync(join(tmpdir(), 'aio-signin-'));
  let app: ElectronApplication;
  let ui: Page;
  let viewId = 0;

  const inPage = (js: string) =>
    app.evaluate(async ({ webContents }, code) => {
      const wc = webContents.getAllWebContents().find((w) => w.getURL().includes('aio-signin.test') && !w.isLoading());
      return wc ? Promise.race([wc.executeJavaScript(code, true), new Promise((r) => setTimeout(r, 2000))]) : undefined; // A page that unloads mid-call never answers: wait 2 s at most (polls retry).
    }, js);
  const external = () => app.evaluate(() => (globalThis as unknown as { opened: string[] }).opened);

  beforeAll(async () => {
    server = createServer((_req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end(PAGE));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    page = `http://www.aio-signin.test:${(server.address() as AddressInfo).port}/`;
    app = await electron.launch({
      args: [join(__dirname, '..'), '--host-resolver-rules=MAP www.aio-signin.test 127.0.0.1'],
      env: { ...process.env, AIO_USER_DATA_DIR: profile, ELECTRON_RENDERER_URL: '' },
    });
    ui = await app.firstWindow();
    // Browser pages come from memory, not the internet, so the test doesn't depend on outside sites
    // (it only checks which URL loads). ROADMAP Backlog 2.12.
    await app.evaluate(({ session }) =>
      session
        .fromPartition('persist:app-browser-default')
        .protocol.handle('https', () => new Response('<!doctype html><title>stub</title>', { headers: { 'content-type': 'text/html' } })),
    );
    await ui.locator('.tile').first().waitFor();
    await app.evaluate(({ shell, webContents }) => {
      const g = globalThis as unknown as { opened: string[]; started: string[] };
      g.opened = [];
      g.started = [];
      shell.openExternal = async (url: string) => void g.opened.push(url);
      for (const wc of webContents.getAllWebContents()) wc.on('did-start-navigation', (d) => d.isMainFrame && g.started.push(d.url));
    });
    await ui.evaluate(async () => {
      const ws = await window.aio.getWorkspace();
      const custom = {
        id: 'custom-signin-test',
        name: 'Sign-in test',
        url: 'https://www.aio-signin.test/',
        kind: 'app' as const,
        allowedHosts: ['aio-signin.test'],
        popupHosts: ['aio-signin.test', 'accounts.google.com'],
        permissions: [],
        glyph: 'Si',
      };
      await window.aio.saveWorkspace({ ...ws, customApps: [custom], privacyOverrides: { 'custom-signin-test': { httpsOnly: false } } });
    });
    await ui.reload();
    await ui.getByRole('button', { name: 'Open Sign-in test' }).click();
    const id = (viewId = await until(() => app.evaluate(({ webContents }) => webContents.getAllWebContents().find((w) => w.getURL().includes('aio-signin.test'))?.id ?? 0)));
    await app.evaluate(({ webContents }, [i, u]) => {
      const wc = webContents.fromId(i as number)!;
      const g = globalThis as unknown as { started: string[] };
      wc.on('did-start-navigation', (d) => d.isMainFrame && g.started.push(d.url));
      void wc.loadURL(u as string);
    }, [id, page] as const);
    await until(async () => (await inPage('document.title')) === 'signin');
  });

  afterAll(async () => {
    await app?.close();
    server?.close();
    rmSync(profile, { recursive: true, force: true });
  });

  it('opens a blank-first sign-in popup inside the app', async () => {
    const windows = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
    const before = await windows();
    await inPage("void window.open('', 'signin', 'width=480,height=640')");
    await until(async () => (await windows()) === before + 1);
    expect(await external()).toEqual([]);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => w.getParentWindow()).forEach((w) => w.close()));
  });

  it('keeps a full-page redirect to Google sign-in in the tile', async () => {
    const target = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=test';
    // Navigate after the script returns: a script that unloads its own page may never answer.
    await inPage(`setTimeout(() => (location.href = ${JSON.stringify(target)}))`);
    await until(() => app.evaluate((_e, t) => (globalThis as unknown as { started: string[] }).started.includes(t as string), target));
    expect(await external()).toEqual([]);
  });

  it('opens ordinary outside links in a Browser tile beside the app, not the system browser (D-065)', async () => {
    await app.evaluate(({ webContents }, [i, u]) => void webContents.fromId(i as number)!.loadURL(u as string), [viewId, page] as const);
    await until(async () => (await inPage('document.title')) === 'signin');
    await inPage("setTimeout(() => (location.href = 'https://example.com/'))");
    await until(() =>
      app.evaluate(({ webContents }) => webContents.getAllWebContents().some((w) => w.getURL().startsWith('https://example.com/'))),
    );
    // The app's own tile stays on its page, and nothing went to the system browser.
    expect(await app.evaluate(({ webContents }, i) => webContents.fromId(i)!.getURL(), viewId)).toBe(page);
    expect(await external()).toEqual([]);
  });
});
