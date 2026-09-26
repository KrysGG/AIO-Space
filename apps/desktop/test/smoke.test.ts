import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core';

/**
 * Launches the built app (run `electron-vite build` first; `pnpm test` does) with a throwaway
 * profile, and walks the Phase 1 basics. Needs a display: use `xvfb-run` on headless machines.
 */
describe('desktop smoke test', () => {
  let app: ElectronApplication;
  let ui: Page;
  const profile = mkdtempSync(join(tmpdir(), 'aio-smoke-'));

  const viewCount = () =>
    app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0]?.contentView.children.length ?? -1);
  const tiles = () => ui.locator('.tile');

  beforeAll(async () => {
    app = await electron.launch({
      args: [join(__dirname, '..')],
      env: { ...process.env, AIO_USER_DATA_DIR: profile, ELECTRON_RENDERER_URL: '' },
    });
    ui = await app.firstWindow();
  });

  afterAll(async () => {
    await app?.close();
    rmSync(profile, { recursive: true, force: true });
  });

  it('opens with one empty tile showing the launcher', async () => {
    await expect.poll(() => tiles().count()).toBe(1);
    for (const name of ['Discord', 'YouTube', 'Reddit', 'X', 'Instagram', 'Browser']) {
      await ui.locator('.tile-body button', { hasText: name }).first().waitFor();
    }
    expect(await viewCount()).toBe(0);
  });

  it('opens Browser in the tile as a native view', async () => {
    await ui.locator('.tile-body button', { hasText: 'Browser' }).click();
    await expect.poll(viewCount).toBe(1);
    await expect.poll(() => tiles().first().getAttribute('aria-label')).toBe('Browser');
  });

  it('splits the tile, then closes both tiles back to one empty tile', async () => {
    await tiles().first().getByRole('button', { name: 'Split right' }).click();
    await expect.poll(() => tiles().count()).toBe(2);
    expect(await viewCount()).toBe(1);

    await tiles().nth(1).getByRole('button', { name: 'Close tile' }).click();
    await expect.poll(() => tiles().count()).toBe(1);

    await tiles().first().getByRole('button', { name: 'Close tile' }).click();
    await expect.poll(viewCount).toBe(0);
    await expect.poll(() => tiles().first().getAttribute('aria-label')).toBe('Empty tile');
  });
});
