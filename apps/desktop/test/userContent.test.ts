import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core';
import type { Workspace } from '@aio/core';

/**
 * The user's own additions to an app's pages: custom CSS (ROADMAP 4.3) and plugins (4.4). A custom
 * app on a local test site; the checks read the page from main.
 */
const PAGE = '<!doctype html><title>user content</title><aside id="side">sidebar</aside>';
const APP = 'custom-usercontent-test';

async function until<T>(get: () => Promise<T>, timeout = 20_000): Promise<T> {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await get();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe('user content in app pages', () => {
  let server: Server;
  let base = '';
  const profile = mkdtempSync(join(tmpdir(), 'aio-usercontent-'));
  let app: ElectronApplication;
  let ui: Page;
  let viewId = 0;

  const inPage = (js: string) =>
    app.evaluate(
      ({ webContents }, [id, code]) =>
        webContents.fromId(id as number)!.executeJavaScript(code as string, true),
      [viewId, js] as const,
    );
  const sideDisplay = () => inPage("getComputedStyle(document.getElementById('side')).display");
  const load = (path: string) =>
    app.evaluate(
      ({ webContents }, [id, url]) => webContents.fromId(id as number)!.loadURL(url as string),
      [viewId, base + path] as const,
    );
  /** Save the workspace with some top-level fields replaced. */
  const editWorkspace = (patch: Partial<Workspace>) =>
    ui.evaluate(
      async (p) => window.aio.saveWorkspace({ ...(await window.aio.getWorkspace()), ...p }),
      patch,
    );
  const cssOf = (css: string, enabled: boolean): Partial<Workspace> => ({
    appCss: { [APP]: { css, enabled } },
  });

  beforeAll(async () => {
    server = createServer((_req, res) =>
      res.writeHead(200, { 'content-type': 'text/html' }).end(PAGE),
    );
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://www.aio-usercontent.test:${(server.address() as AddressInfo).port}`;
    app = await electron.launch({
      args: [join(__dirname, '..'), '--host-resolver-rules=MAP www.aio-usercontent.test 127.0.0.1'],
      env: { ...process.env, AIO_USER_DATA_DIR: profile, ELECTRON_RENDERER_URL: '' },
    });
    ui = await app.firstWindow();
    await ui.locator('.tile').first().waitFor();
    await ui.evaluate(async (id) => {
      const ws = await window.aio.getWorkspace();
      const custom = {
        id,
        name: 'User content test',
        url: 'https://www.aio-usercontent.test/',
        kind: 'app' as const,
        allowedHosts: ['aio-usercontent.test'],
        popupHosts: [],
        permissions: [],
        glyph: 'Uc',
      };
      await window.aio.saveWorkspace({
        ...ws,
        customApps: [custom],
        privacyOverrides: { [id]: { httpsOnly: false } },
      });
    }, APP);
    await ui.reload();
    await ui.getByRole('button', { name: 'Open User content test' }).click();
    viewId = await until(() =>
      app.evaluate(
        ({ webContents }) =>
          webContents.getAllWebContents().find((w) => w.getURL().includes('aio-usercontent.test'))
            ?.id ?? 0,
      ),
    );
    await load('/');
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    server?.close();
    rmSync(profile, { recursive: true, force: true });
  });

  it('custom CSS applies at once, on every navigation, and can be turned off (ROADMAP 4.3)', async () => {
    expect(await sideDisplay()).toBe('block');
    await editWorkspace(cssOf('#side { display: none !important; }', true));
    await until(async () => (await sideDisplay()) === 'none');

    await load('/other');
    expect(await sideDisplay()).toBe('none');

    await editWorkspace(cssOf('#side { display: inline !important; }', true));
    await until(async () => (await sideDisplay()) === 'inline');

    await editWorkspace(cssOf('#side { display: inline !important; }', false));
    await until(async () => (await sideDisplay()) === 'block');
    await load('/again');
    expect(await sideDisplay()).toBe('block');
  });

  it('plugins install off, run only in their apps in a world the page can’t see, and stop when turned off (ROADMAP 4.4)', async () => {
    const folders = mkdtempSync(join(tmpdir(), 'aio-plugin-src-'));
    const plugin = (id: string, apps: string[], code: string, css = '') => {
      const d = join(folders, id);
      mkdirSync(d);
      const manifest = {
        id,
        name: id,
        version: '1.0',
        apps,
        scripts: ['p.js'],
        styles: css ? ['p.css'] : [],
      };
      writeFileSync(join(d, 'manifest.json'), JSON.stringify(manifest));
      writeFileSync(join(d, 'p.js'), code);
      if (css) writeFileSync(join(d, 'p.css'), css);
      return d;
    };
    const mine = plugin(
      'mine',
      [APP],
      "document.documentElement.dataset.plugin = 'ran'; window.pluginSecret = 42;",
      '#side { color: rgb(1, 2, 3) !important; }',
    );
    const other = plugin(
      'youtube-only',
      ['youtube'],
      "document.documentElement.dataset.wrong = 'ran';",
    );
    const install = async (folder: string) => {
      await app.evaluate(({ dialog }, f) => {
        dialog.showOpenDialog = (async () => ({
          canceled: false,
          filePaths: [f],
        })) as unknown as typeof dialog.showOpenDialog;
      }, folder);
      return ui.evaluate(() => window.aio.installPlugin());
    };
    expect(await install(mine)).toMatchObject({ ok: true, plugin: { id: 'mine' } });
    expect(await install(other)).toMatchObject({ ok: true });
    const state = () =>
      inPage(
        "[document.documentElement.dataset.plugin, document.documentElement.dataset.wrong, typeof window.pluginSecret, getComputedStyle(document.getElementById('side')).color].join('|')",
      );

    await load('/');
    expect(await state()).toBe('||undefined|rgb(0, 0, 0)'); // installed, but off

    await editWorkspace({ enabledPlugins: ['mine', 'youtube-only'] });
    // Turning it on reloads the app; the script ran in its own world: the page can't see its globals.
    await until(async () => (await state()) === 'ran||undefined|rgb(1, 2, 3)');
    await load('/next');
    expect(await state()).toBe('ran||undefined|rgb(1, 2, 3)');

    await editWorkspace({ enabledPlugins: [] });
    await until(async () => (await state()) === '||undefined|rgb(0, 0, 0)');
    rmSync(folders, { recursive: true, force: true });
  });

  it('Chrome extensions run only in apps that turn them on, with the API stand-ins, and pages open (ROADMAP 4.5)', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'aio-ext-src-'));
    writeFileSync(
      join(folder, 'manifest.json'),
      JSON.stringify({
        manifest_version: 3,
        name: 'AIO test ext',
        version: '1.0',
        background: { service_worker: 'sw.js' },
        permissions: ['storage'],
        action: { default_popup: 'popup.html' },
        content_scripts: [
          { matches: ['http://*.aio-usercontent.test/*'], js: ['cs.js'], run_at: 'document_end' },
        ],
      }),
    );
    // Without the stand-ins, Electron has neither tabs.onRemoved nor storage.sync: the worker would crash.
    writeFileSync(
      join(folder, 'sw.js'),
      `chrome.tabs.onRemoved.addListener(() => {});
       chrome.runtime.onMessage.addListener((msg, _s, reply) => { chrome.storage.sync.set({ k: 'synced' }).then(() => chrome.storage.sync.get('k')).then((v) => reply(v.k)); return true; });`,
    );
    writeFileSync(
      join(folder, 'cs.js'),
      "document.documentElement.dataset.ext = 'ran'; chrome.runtime.sendMessage('get', (v) => { document.documentElement.dataset.sync = v; });",
    );
    writeFileSync(
      join(folder, 'popup.html'),
      '<!doctype html><title>popup</title><p>AIO test popup</p>',
    );
    await app.evaluate(({ dialog }, f) => {
      dialog.showOpenDialog = (async () => ({
        canceled: false,
        filePaths: [f],
      })) as unknown as typeof dialog.showOpenDialog;
    }, folder);
    const res = await ui.evaluate(() => window.aio.installExtensionFromFolder());
    expect(res).toMatchObject({
      ok: true,
      extension: { id: 'local-aio-test-ext', popup: 'popup.html' },
    });
    const ext = () =>
      inPage(
        '[document.documentElement.dataset.ext, document.documentElement.dataset.sync].join("|")',
      );

    await load('/');
    expect(await ext()).toBe('|'); // installed, not on for this app

    await editWorkspace({ extensions: { youtube: ['local-aio-test-ext'] } });
    await load('/');
    await new Promise((r) => setTimeout(r, 1500));
    expect(await ext()).toBe('|'); // on for another app only

    await editWorkspace({ extensions: { [APP]: ['local-aio-test-ext'] } });
    await until(async () => (await ext()) === 'ran|synced'); // the app reloads with it
    await load('/again');
    await until(async () => (await ext()) === 'ran|synced');

    // Its popup opens in a window of its own, in this app's session.
    const leafId = await ui.evaluate(async (id) => {
      const ws = await window.aio.getWorkspace();
      const walk = (n: {
        type: string;
        appId?: string | null;
        id: string;
        first?: unknown;
        second?: unknown;
      }): string | null =>
        n.type === 'leaf'
          ? n.appId === id
            ? n.id
            : null
          : (walk(n.first as never) ?? walk(n.second as never));
      return walk(ws.spaces[0]!.layout as never);
    }, APP);
    await ui.evaluate(
      ([leaf]) => window.aio.openExtensionPage(leaf!, 'local-aio-test-ext', 'popup'),
      [leafId],
    );
    await until(() =>
      app.evaluate(({ webContents }) =>
        webContents
          .getAllWebContents()
          .some(
            (w) =>
              w.getURL().startsWith('chrome-extension://') && w.getURL().endsWith('/popup.html'),
          ),
      ),
    );

    await editWorkspace({ extensions: {} });
    await until(async () => (await ext()) === '|');
    rmSync(folder, { recursive: true, force: true });
  });
});
