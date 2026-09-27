import { promises as fs } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import type { ExtensionInfo } from '../../shared/ipc';
import { MAX_ENTRIES, MAX_UNPACKED_BYTES, safePath, unpackCrx } from './crx';

/** A Chrome Web Store extension id: 32 letters a-p. */
export const STORE_ID = /^[a-p]{32}$/;

/** A store link (any form containing the id) or the bare id; null if there's no id in it. */
export function storeIdFrom(input: string): string | null {
  const m =
    input.trim().match(/(?:^|[/?=&])([a-p]{32})(?:$|[/?#&])/) ??
    input.trim().match(/^([a-p]{32})$/);
  return m ? m[1]! : null;
}

interface Installed extends ExtensionInfo {
  path: string;
}

/**
 * Installed Chrome extensions (ROADMAP 4.5), unpacked under userData/extensions/<id>: the store id for
 * Web Store installs, `local-<name>` for unpacked folders. Which apps run them is the workspace's
 * business (`extensions`); ExtensionHost loads them into those apps' sessions.
 */
export class ExtensionStore {
  private readonly installed = new Map<string, Installed>();

  /** `download(id)` fetches a store package (.crx) for an extension id. */
  constructor(
    private readonly dir: string,
    private readonly download: (storeId: string) => Promise<Buffer>,
  ) {}

  async load(): Promise<void> {
    this.installed.clear();
    const names = await fs.readdir(this.dir).catch(() => [] as string[]);
    for (const id of names) {
      if (id.startsWith('.')) continue;
      const info = await describe(join(this.dir, id), id).catch(() => null);
      if (info) this.installed.set(id, info);
    }
  }

  list(): ExtensionInfo[] {
    return [...this.installed.values()]
      .map(publicInfo)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  path(id: string): string | undefined {
    return this.installed.get(id)?.path;
  }

  /** Install or update from the Chrome Web Store. Throws an Error whose message is for the user. */
  async installFromStore(input: string): Promise<ExtensionInfo> {
    const storeId = storeIdFrom(input);
    if (!storeId) throw new Error('That isn’t a Chrome Web Store link or extension id.');
    const files = unpackCrx(await this.download(storeId));
    return this.write(storeId, files, 'store');
  }

  /** Install or update an unpacked extension folder (the one with manifest.json). */
  async installFromFolder(folder: string): Promise<ExtensionInfo> {
    const files = await readFolder(folder);
    const manifest = parseManifest(files.get('manifest.json'));
    const slug = String(manifest['name'] ?? 'extension')
      .toLowerCase()
      .replace(/__msg_|__/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 30);
    return this.write(`local-${slug || 'extension'}`, files, 'folder');
  }

  async remove(id: string): Promise<void> {
    const info = this.installed.get(id);
    this.installed.delete(id);
    if (info) await fs.rm(info.path, { recursive: true, force: true });
  }

  private async write(
    id: string,
    files: Map<string, Buffer>,
    source: ExtensionInfo['source'],
  ): Promise<ExtensionInfo> {
    const manifest = parseManifest(files.get('manifest.json'));
    if (manifest['manifest_version'] !== 3 && manifest['manifest_version'] !== 2)
      throw new Error('This extension’s manifest has no valid manifest_version.');
    await fs.mkdir(this.dir, { recursive: true, mode: 0o700 });
    const tmp = join(this.dir, `.install-${id}`);
    await fs.rm(tmp, { recursive: true, force: true });
    for (const [name, body] of files) {
      // The store's signature data: Chromium won't load an unpacked extension with it (and deletes it).
      if (name.startsWith('_metadata/')) continue;
      const target = join(tmp, name);
      await fs.mkdir(dirname(target), { recursive: true, mode: 0o700 });
      await fs.writeFile(target, body, { mode: 0o600 });
    }
    await fs.writeFile(join(tmp, '.aio-source'), source);
    const dest = join(this.dir, id);
    await fs.rm(dest, { recursive: true, force: true });
    await fs.rename(tmp, dest);
    const info = await describe(dest, id);
    this.installed.set(id, info);
    return publicInfo(info);
  }
}

/** What the UI may see: everything but the folder path. */
function publicInfo(i: Installed): ExtensionInfo {
  return {
    id: i.id,
    name: i.name,
    version: i.version,
    description: i.description,
    source: i.source,
    popup: i.popup,
    options: i.options,
  };
}

function parseManifest(raw: Buffer | undefined): Record<string, unknown> {
  try {
    const m: unknown = JSON.parse((raw ?? Buffer.from('')).toString('utf8').replace(/^\uFEFF/, ''));
    if (m && typeof m === 'object') return m as Record<string, unknown>;
  } catch {
    // fall through
  }
  throw new Error('This extension has no readable manifest.json.');
}

/** Name, version and pages of an installed extension (names like `__MSG_name__` are looked up). */
async function describe(path: string, id: string): Promise<Installed> {
  const manifest = parseManifest(await fs.readFile(join(path, 'manifest.json')));
  const source =
    (await fs.readFile(join(path, '.aio-source'), 'utf8').catch(() => 'folder')) === 'store'
      ? 'store'
      : 'folder';
  const locale = typeof manifest['default_locale'] === 'string' ? manifest['default_locale'] : 'en';
  let messages: Record<string, { message?: string }> = {};
  for (const l of ['en', 'en_US', locale]) {
    const text = await fs
      .readFile(join(path, '_locales', l, 'messages.json'), 'utf8')
      .catch(() => null);
    if (text) {
      try {
        messages = JSON.parse(text.replace(/^\uFEFF/, '')) as typeof messages;
        break;
      } catch {
        // try the next locale
      }
    }
  }
  const text = (v: unknown, max: number): string => {
    const s = typeof v === 'string' ? v : '';
    const key = s.match(/^__MSG_(\w+)__$/)?.[1];
    const found = key
      ? Object.entries(messages).find(([k]) => k.toLowerCase() === key.toLowerCase())?.[1]?.message
      : undefined;
    return (found ?? s).slice(0, max);
  };
  const action = (manifest['action'] ?? manifest['browser_action']) as
    { default_popup?: unknown } | undefined;
  const optionsUi = manifest['options_ui'] as { page?: unknown } | undefined;
  const popup = typeof action?.default_popup === 'string' ? action.default_popup : undefined;
  const options =
    typeof optionsUi?.page === 'string'
      ? optionsUi.page
      : typeof manifest['options_page'] === 'string'
        ? manifest['options_page']
        : undefined;
  return {
    id,
    name: text(manifest['name'], 60) || id,
    version: text(manifest['version'], 30),
    description: text(manifest['description'], 200),
    source,
    popup: popup && safePath(popup) ? popup : undefined,
    options: options && safePath(options) ? options : undefined,
    path,
  };
}

/** Every regular file under `folder`, by relative path; links refused, size and count capped. */
async function readFolder(folder: string): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>();
  let total = 0;
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      const rel = relative(folder, full).split(sep).join('/');
      if (entry.isSymbolicLink()) throw new Error(`Refusing a link in the extension: ${rel}`);
      if (entry.isDirectory()) {
        if (entry.name === '.git' || entry.name === 'node_modules') continue;
        await walk(full);
      } else if (entry.isFile()) {
        const body = await fs.readFile(full);
        total += body.length;
        if (total > MAX_UNPACKED_BYTES) throw new Error('This extension is too big (over 150 MB).');
        if (files.size >= MAX_ENTRIES) throw new Error('This extension has too many files.');
        files.set(rel, body);
      }
    }
  };
  try {
    await walk(folder);
  } catch (err) {
    if (err instanceof Error && /Refusing|too/.test(err.message)) throw err;
    throw new Error('Couldn’t read that folder.');
  }
  if (!files.has('manifest.json'))
    throw new Error('This folder has no manifest.json. Pick the unpacked extension’s folder.');
  return files;
}
