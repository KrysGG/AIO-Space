import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';
import { afterAll, describe, expect, it } from 'vitest';
import { unpackCrx } from '../src/main/extensions/crx';
import { ExtensionStore, storeIdFrom } from '../src/main/extensions/extensionStore';

const dir = mkdtempSync(join(tmpdir(), 'aio-ext-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** A zip with the given files (deflated), optionally with a CRX3 header and a symlink entry. */
function zip(files: Record<string, string>, opts: { crx?: boolean; link?: string } = {}): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const body = Buffer.from(text);
    const data = deflateRawSync(body);
    const n = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc32(body), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(body.length, 22);
    local.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(8, 10);
    c.writeUInt32LE(crc32(body), 16);
    c.writeUInt32LE(data.length, 20);
    c.writeUInt32LE(body.length, 24);
    c.writeUInt16LE(n.length, 28);
    if (name === opts.link) c.writeUInt32LE((0o120777 << 16) >>> 0, 38);
    c.writeUInt32LE(offset, 42);
    locals.push(local, n, data);
    central.push(c, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  const body = Buffer.concat([...locals, cd, end]);
  if (!opts.crx) return body;
  const header = Buffer.alloc(12 + 5);
  header.write('Cr24', 0, 'latin1');
  header.writeUInt32LE(3, 4);
  header.writeUInt32LE(5, 8); // 5 bytes of (fake) signed header
  return Buffer.concat([header, body]);
}

const MANIFEST = JSON.stringify({
  manifest_version: 3,
  name: '__MSG_appName__',
  version: '2.1',
  default_locale: 'en',
  action: { default_popup: 'popup.html' },
  options_ui: { page: 'options.html' },
});
const FILES = {
  'manifest.json': MANIFEST,
  '_locales/en/messages.json': '{"appName":{"message":"Test Extension"}}',
  'popup.html': '<p>hi</p>',
  'js/a.js': '1',
};

describe('extension packages (ROADMAP 4.5)', () => {
  it('unpacks CRX3 and plain zips', () => {
    for (const data of [zip(FILES, { crx: true }), zip(FILES)]) {
      const files = unpackCrx(data);
      expect([...files.keys()].sort()).toEqual(Object.keys(FILES).sort());
      expect(files.get('js/a.js')!.toString()).toBe('1');
    }
  });

  it('refuses paths outside the folder, links, and packages without a manifest', () => {
    for (const bad of ['../evil.js', '/abs.js', 'a/../../b.js', 'a\\b.js']) {
      expect(() => unpackCrx(zip({ ...FILES, [bad]: 'x' })), bad).toThrow(/outside/);
    }
    expect(() =>
      unpackCrx(zip({ ...FILES, 'link.js': '/etc/passwd' }, { link: 'link.js' })),
    ).toThrow(/link/);
    expect(() => unpackCrx(zip({ 'a.js': '1' }))).toThrow(/manifest/);
    expect(() => unpackCrx(Buffer.from('not a zip at all'))).toThrow(/package/);
  });

  it('finds the store id in links and bare ids', () => {
    const id = 'eimadpbcbfnmbkopoojfekhnkhdbieeh';
    for (const input of [
      id,
      `https://chromewebstore.google.com/detail/dark-reader/${id}`,
      `https://chromewebstore.google.com/detail/${id}?hl=en`,
      `https://chrome.google.com/webstore/detail/dark-reader/${id}`,
    ]) {
      expect(storeIdFrom(input), input).toBe(id);
    }
    for (const bad of ['', 'dark reader', 'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz', `${id}x`])
      expect(storeIdFrom(bad), bad).toBeNull();
  });

  it('installs from the store and from folders, names them, updates in place, removes', async () => {
    const root = join(dir, 'installed');
    const fetched: string[] = [];
    const store = new ExtensionStore(root, async (id) => {
      fetched.push(id);
      return zip(FILES, { crx: true });
    });
    const id = 'abcdefghijklmnopabcdefghijklmnop';
    const info = await store.installFromStore(`https://chromewebstore.google.com/detail/x/${id}`);
    expect(fetched).toEqual([id]);
    expect(info).toMatchObject({
      id,
      name: 'Test Extension',
      version: '2.1',
      source: 'store',
      popup: 'popup.html',
      options: 'options.html',
    });
    expect(readFileSync(join(root, id, 'js/a.js'), 'utf8')).toBe('1');

    const folder = join(dir, 'unpacked');
    mkdirSync(join(folder, 'js'), { recursive: true });
    writeFileSync(
      join(folder, 'manifest.json'),
      JSON.stringify({ manifest_version: 3, name: 'My Tool', version: '1' }),
    );
    writeFileSync(join(folder, 'js', 'b.js'), '2');
    const local = await store.installFromFolder(folder);
    expect(local).toMatchObject({ id: 'local-my-tool', name: 'My Tool', source: 'folder' });
    await store.installFromFolder(folder); // again: an update, not a second copy
    expect(
      store
        .list()
        .map((x) => x.id)
        .sort(),
    ).toEqual([id, 'local-my-tool'].sort());

    const again = new ExtensionStore(root, async () => Buffer.alloc(0));
    await again.load();
    expect(again.list()).toEqual(store.list());
    await store.remove(id);
    expect(existsSync(join(root, id))).toBe(false);
    await expect(store.installFromStore('not a link')).rejects.toThrow(/Chrome Web Store/);
    await expect(store.installFromFolder(join(dir, 'nope'))).rejects.toThrow(/folder/);
  });
});

describe('empty files in packages', () => {
  it('unpacks a deflated empty file', () => {
    expect(unpackCrx(zip({ ...FILES, 'empty.js': '' })).get('empty.js')!.length).toBe(0);
  });
});
