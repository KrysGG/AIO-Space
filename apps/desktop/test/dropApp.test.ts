import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { _electron as electron, type ElectronApplication, type Locator, type Page } from 'playwright-core';

/**
 * Sidebar apps dropped onto tiles (ROADMAP 2.16) in the real app. Drags are dispatched as DOM events
 * (mouse drags wait for paints, which a covered window may not do). Apps' pages come from memory.
 */
describe('dropping sidebar apps onto tiles', () => {
  let app: ElectronApplication;
  let ui: Page;
  const profile = mkdtempSync(join(tmpdir(), 'aio-drop-'));
  const tile = (name: string) => ui.locator(`.tile[aria-label="${name}"]`);
  const names = () => ui.locator('.tile').evaluateAll((ts) => ts.map((t) => t.getAttribute('aria-label')));

  /** Drag a sidebar app over a tile to (fx, fy) of its box, and drop it there. */
  const drop = async (appName: string, target: Locator, fx: number, fy: number, zone: string) => {
    const dataTransfer = await ui.evaluateHandle(() => new DataTransfer());
    const source = ui.getByRole('button', { name: `Open ${appName}` });
    const box = (await target.boundingBox())!;
    const at = { dataTransfer, clientX: box.x + box.width * fx, clientY: box.y + box.height * fy };
    await source.dispatchEvent('dragstart', { dataTransfer });
    await target.dispatchEvent('dragover', at);
    await expect.poll(() => target.locator(`.app-drop.is-${zone}`).count()).toBe(1); // where it will land
    await target.dispatchEvent('drop', at);
    await source.dispatchEvent('dragend', { dataTransfer });
  };

  beforeAll(async () => {
    app = await electron.launch({
      args: [join(__dirname, '..')],
      env: { ...process.env, AIO_USER_DATA_DIR: profile, ELECTRON_RENDERER_URL: '' },
    });
    ui = await app.firstWindow();
    await ui.locator('.tile').first().waitFor();
    await app.evaluate(({ session }) => {
      for (const id of ['twitch', 'youtube', 'reddit', 'discord']) {
        session
          .fromPartition(`persist:app-${id}-default`)
          .protocol.handle('https', () => new Response(`<!doctype html><title>${id}</title>`, { headers: { 'content-type': 'text/html' } }));
      }
    });
  });

  afterAll(async () => {
    await app?.close();
    rmSync(profile, { recursive: true, force: true });
  });

  it('opens in an empty tile when dropped in its middle', async () => {
    await drop('Twitch', tile('Empty tile'), 0.5, 0.5, 'center');
    await expect.poll(names).toEqual(['Twitch']);
  });

  it('splits on the side the drop leans to: right, then top', async () => {
    await drop('YouTube', tile('Twitch'), 0.9, 0.5, 'right');
    await expect.poll(names).toEqual(['Twitch', 'YouTube']);
    const twitch = (await tile('Twitch').boundingBox())!;
    const youtube = (await tile('YouTube').boundingBox())!;
    expect(youtube.x).toBeGreaterThan(twitch.x);

    await drop('Reddit', tile('YouTube'), 0.5, 0.1, 'top');
    await expect.poll(async () => (await names()).length).toBe(3);
    const reddit = (await tile('Reddit').boundingBox())!;
    const below = (await tile('YouTube').boundingBox())!;
    expect(reddit.y).toBeLessThan(below.y);
    expect(Math.abs(reddit.x - below.x)).toBeLessThan(2); // same column: YouTube's tile was split
  });

  it('asks before replacing an app, and replaces it only on yes', async () => {
    ui.once('dialog', (d) => {
      expect(d.message()).toBe('Replace Twitch with Discord?');
      void d.dismiss();
    });
    await drop('Discord', tile('Twitch'), 0.5, 0.5, 'center');
    await new Promise((r) => setTimeout(r, 300));
    expect(await tile('Twitch').count()).toBe(1);

    ui.once('dialog', (d) => void d.accept());
    await drop('Discord', tile('Twitch'), 0.5, 0.5, 'center');
    await expect.poll(() => tile('Discord').count()).toBe(1);
    expect(await tile('Twitch').count()).toBe(0);
  });
});
