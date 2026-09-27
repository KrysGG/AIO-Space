import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { PluginInfo } from '../../shared/ipc';
import { PluginManifestSchema, type PluginManifest } from '../ipc/schemas';

/** Scripts and styles together; plugins are small page tweaks, not apps. */
export const MAX_PLUGIN_BYTES = 1_000_000;
/** Each plugin runs in its own isolated world, numbered from here (1001 is cosmetic filtering). */
const FIRST_WORLD = 1100;

export interface LoadedPlugin {
  manifest: PluginManifest;
  scripts: string[];
  styles: string[];
}

/**
 * Installed plugins (ROADMAP 4.4), one folder each under userData/plugins/<id>. Installing copies
 * only the manifest and the files it lists out of the folder the user picked, after validating them;
 * the code is kept in memory and run by ViewManager in the target apps' views.
 */
export class PluginStore {
  private readonly plugins = new Map<string, LoadedPlugin>();

  constructor(private readonly dir: string) {}

  async load(): Promise<void> {
    this.plugins.clear();
    let names: string[] = [];
    try {
      names = await fs.readdir(this.dir);
    } catch {
      return; // no plugins yet
    }
    for (const name of names) {
      if (name.startsWith('.')) continue;
      try {
        const plugin = await readPlugin(join(this.dir, name));
        if (plugin.manifest.id === name) this.plugins.set(name, plugin);
      } catch (err) {
        console.warn(`[plugins] skipping ${name}:`, err instanceof Error ? err.message : err);
      }
    }
  }

  list(): PluginInfo[] {
    return [...this.plugins.values()]
      .map(({ manifest: m }) => ({
        id: m.id,
        name: m.name,
        version: m.version,
        description: m.description,
        apps: m.apps,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Enabled plugins for an app, each with its own isolated world id. */
  forApp(appId: string, enabled: readonly string[]): Array<LoadedPlugin & { world: number }> {
    const ids = [...this.plugins.keys()].sort();
    return ids
      .map((id, i) => ({ ...this.plugins.get(id)!, world: FIRST_WORLD + i }))
      .filter((p) => enabled.includes(p.manifest.id) && p.manifest.apps.includes(appId));
  }

  /** Install or update the plugin in `folder`. Throws an Error whose message is for the user. */
  async install(folder: string): Promise<PluginInfo> {
    const plugin = await readPlugin(folder);
    const { id } = plugin.manifest;
    await fs.mkdir(this.dir, { recursive: true, mode: 0o700 });
    const tmp = join(this.dir, `.install-${id}`);
    await fs.rm(tmp, { recursive: true, force: true });
    await fs.mkdir(tmp, { mode: 0o700 });
    await fs.writeFile(join(tmp, 'manifest.json'), JSON.stringify(plugin.manifest, null, 2), {
      mode: 0o600,
    });
    const files = [
      ...plugin.manifest.scripts.map((f, i) => [f, plugin.scripts[i]!]),
      ...plugin.manifest.styles.map((f, i) => [f, plugin.styles[i]!]),
    ];
    for (const [name, text] of files) await fs.writeFile(join(tmp, name!), text!, { mode: 0o600 });
    await fs.rm(join(this.dir, id), { recursive: true, force: true });
    await fs.rename(tmp, join(this.dir, id));
    this.plugins.set(id, plugin);
    return this.list().find((p) => p.id === id)!;
  }

  async remove(id: string): Promise<void> {
    this.plugins.delete(id);
    await fs.rm(join(this.dir, id), { recursive: true, force: true });
  }
}

/** Read and validate a plugin folder: manifest.json plus the plain files it lists (no links, no paths). */
async function readPlugin(folder: string): Promise<LoadedPlugin> {
  let raw: unknown;
  try {
    raw = JSON.parse(await fs.readFile(join(folder, 'manifest.json'), 'utf8'));
  } catch {
    throw new Error('This folder has no readable manifest.json. Pick the folder that contains it.');
  }
  const parsed = PluginManifestSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    throw new Error(`manifest.json: ${issue.path.join('.') || 'manifest'}: ${issue.message}`);
  }
  const manifest = parsed.data;
  let total = 0;
  const read = async (name: string): Promise<string> => {
    const path = join(folder, name);
    const stat = await fs.lstat(path).catch(() => null);
    if (!stat?.isFile())
      throw new Error(`${name} is listed in manifest.json but isn’t a file in the folder.`);
    total += stat.size;
    if (total > MAX_PLUGIN_BYTES)
      throw new Error('The plugin’s files are larger than 1 MB together.');
    return fs.readFile(path, 'utf8');
  };
  const scripts: string[] = [];
  for (const f of manifest.scripts) scripts.push(await read(f));
  const styles: string[] = [];
  for (const f of manifest.styles) styles.push(await read(f));
  return { manifest, scripts, styles };
}
