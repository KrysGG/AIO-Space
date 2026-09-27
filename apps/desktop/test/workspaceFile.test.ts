import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { _electron as electron } from 'playwright-core';
import {
  defaultWorkspace,
  saveTemplate,
  splitLeaf,
  WORKSPACE_VERSION,
  type LayoutNode,
  type Workspace,
} from '@aio/core';
import {
  exportWorkspace,
  importWorkspace,
  MAX_WORKSPACE_FILE,
} from '../src/main/store/workspaceFile';

const dir = mkdtempSync(join(tmpdir(), 'aio-wsfile-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Discord | YouTube over an empty tile, 30/70, in a space named Work, saved as a template. */
function arranged(): Workspace {
  const ws = defaultWorkspace();
  const leaf = ws.spaces[0]!.layout;
  let r = splitLeaf(
    { ...leaf, appId: 'discord', instanceId: 'app_disc' } as LayoutNode,
    leaf.id,
    'row',
    'youtube',
  );
  r = splitLeaf(r.root, r.newLeafId!, 'column', null);
  const layout = r.root.type === 'split' ? { ...r.root, ratio: 0.3 } : r.root;
  const out = {
    ...ws,
    spaces: [{ ...ws.spaces[0]!, name: 'Work', layout }],
    ui: { ...ws.ui, theme: 'light' },
  };
  return saveTemplate(out, out.spaces[0]!.id);
}

describe('workspace files (ROADMAP 4.6)', () => {
  it('round-trips the workspace, private to the user', async () => {
    const file = join(dir, 'ws.json');
    expect(await exportWorkspace(arranged(), file)).toEqual({ ok: true });
    expect(statSync(file).mode & 0o077).toBe(0);
    const back = await importWorkspace(file);
    expect(back).toEqual({ ok: true, workspace: JSON.parse(readFileSync(file, 'utf8')) });
    expect(back.ok && back.workspace.spaces[0]!.name).toBe('Work');
  });

  it('upgrades files from older versions', async () => {
    const old: Record<string, unknown> = {
      ...defaultWorkspace(),
      version: 16,
      ui: { railCollapsed: false, reduceMotion: false },
    };
    for (const k of ['themes', 'appCss', 'enabledPlugins', 'templates']) delete old[k];
    writeFileSync(join(dir, 'old.json'), JSON.stringify(old));
    const res = await importWorkspace(join(dir, 'old.json'));
    expect(res.ok && res.workspace.version).toBe(WORKSPACE_VERSION);
  });

  it('refuses newer, damaged, foreign, huge and missing files with a reason, never defaults', async () => {
    const cases: Record<string, string> = {
      newer: JSON.stringify({ ...defaultWorkspace(), version: WORKSPACE_VERSION + 1 }),
      damaged: JSON.stringify({ ...defaultWorkspace(), spaces: 'nope' }),
      foreign: JSON.stringify({ hello: 'world' }),
      notjson: 'hello',
      huge: ' '.repeat(MAX_WORKSPACE_FILE + 1),
    };
    for (const [name, text] of Object.entries(cases)) {
      writeFileSync(join(dir, name), text);
      const res = await importWorkspace(join(dir, name));
      expect(res.ok, name).toBe(false);
      expect('error' in res && res.error.length > 10, name).toBe(true);
    }
    expect((await importWorkspace(join(dir, 'missing.json'))).ok).toBe(false);
  });

  it('an exported workspace loads on another machine (a fresh profile) with the same layout', async () => {
    const file = join(dir, 'move.json');
    const launch = (profile: string) =>
      electron.launch({
        args: [join(__dirname, '..')],
        env: { ...process.env, AIO_USER_DATA_DIR: profile, ELECTRON_RENDERER_URL: '' },
      });

    // Machine A: arrange, export through the menu.
    const a = await launch(join(dir, 'profile-a'));
    const uiA = await a.firstWindow();
    await uiA.locator('.tile').first().waitFor();
    await uiA.evaluate((ws) => window.aio.saveWorkspace(ws), arranged());
    await uiA.reload();
    await a.evaluate(({ dialog }, f) => {
      dialog.showSaveDialog = (async () => ({
        canceled: false,
        filePath: f,
      })) as unknown as typeof dialog.showSaveDialog;
    }, file);
    await uiA.getByRole('button', { name: /menu/i }).first().click();
    await uiA.getByRole('button', { name: 'Export workspace…' }).click();
    await uiA.getByText('Workspace exported.').waitFor();
    const saved = await uiA.evaluate(() => window.aio.getWorkspace());
    await a.close();

    // Machine B: fresh profile, import through the menu, accept the confirmation.
    const b = await launch(join(dir, 'profile-b'));
    const uiB = await b.firstWindow();
    await uiB.locator('.tile').first().waitFor();
    await b.evaluate(({ dialog }, f) => {
      dialog.showOpenDialog = (async () => ({
        canceled: false,
        filePaths: [f],
      })) as unknown as typeof dialog.showOpenDialog;
    }, file);
    uiB.once('dialog', (d) => void d.accept());
    await uiB.getByRole('button', { name: /menu/i }).first().click();
    await uiB.getByRole('button', { name: 'Import workspace…' }).click();
    await expect.poll(() => uiB.locator('.tile').count(), { timeout: 10_000 }).toBe(3);
    await expect
      .poll(async () => (await uiB.evaluate(() => window.aio.getWorkspace())).spaces, {
        timeout: 10_000,
      })
      .toEqual(saved.spaces);
    const loaded = await uiB.evaluate(() => window.aio.getWorkspace());
    expect(loaded.templates).toEqual(saved.templates);
    expect(loaded.ui.theme).toBe('light');
    await b.close();
  }, 90_000);
});
