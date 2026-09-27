import { inflateRawSync } from 'node:zlib';

/** Limits for an extension package: Chrome Web Store extensions are rarely over 30 MB unpacked. */
export const MAX_UNPACKED_BYTES = 150_000_000;
export const MAX_ENTRIES = 20_000;

/**
 * The files in a Chrome extension package (.crx, versions 2 and 3, or a plain .zip), as
 * relative path -> contents. Only stored and deflated files; paths are checked so nothing can land
 * outside the extension's folder (no absolute paths, no `..`, no backslashes). Signatures are not
 * checked: packages come over https from Google's servers or from a file the user chose.
 */
export function unpackCrx(data: Buffer): Map<string, Buffer> {
  const zip = zipPart(data);
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0 || eocd + 22 > zip.length)
    throw new Error('This isn’t an extension package (no zip directory).');
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  if (count > MAX_ENTRIES) throw new Error('This extension has too many files.');
  const files = new Map<string, Buffer>();
  let total = 0;
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error('This extension package is damaged.');
    const method = zip.readUInt16LE(p + 10);
    const compressed = zip.readUInt32LE(p + 20);
    const size = zip.readUInt32LE(p + 24);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const externalAttrs = zip.readUInt32LE(p + 38);
    const local = zip.readUInt32LE(p + 42);
    const name = zip.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue; // folder entry
    if (!safePath(name)) throw new Error(`Refusing a file outside the extension: ${name}`);
    if (((externalAttrs >>> 16) & 0o170000) === 0o120000)
      throw new Error(`Refusing a link in the extension: ${name}`);
    total += size;
    if (total > MAX_UNPACKED_BYTES)
      throw new Error('This extension is too big (over 150 MB unpacked).');
    if (zip.readUInt32LE(local) !== 0x04034b50)
      throw new Error('This extension package is damaged.');
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const raw = zip.subarray(start, start + compressed);
    const body =
      method === 0
        ? Buffer.from(raw)
        : method === 8
          ? inflateRawSync(raw, { maxOutputLength: Math.max(size, 1) })
          : null;
    if (!body || body.length !== size)
      throw new Error(`Can’t unpack ${name} (unsupported compression).`);
    files.set(name, body);
  }
  if (!files.has('manifest.json'))
    throw new Error('This package has no manifest.json at its top level.');
  return files;
}

/** Skip the CRX header, if there is one: the rest is a zip. */
function zipPart(data: Buffer): Buffer {
  if (data.length < 16 || data.toString('latin1', 0, 4) !== 'Cr24') return data;
  const version = data.readUInt32LE(4);
  if (version === 3) return data.subarray(12 + data.readUInt32LE(8));
  if (version === 2) return data.subarray(16 + data.readUInt32LE(8) + data.readUInt32LE(12));
  throw new Error(`Unsupported extension package version ${version}.`);
}

export function safePath(name: string): boolean {
  return (
    name.length > 0 &&
    name.length < 400 &&
    !name.startsWith('/') &&
    !name.includes('\\') &&
    !name.includes('\0') &&
    name.split('/').every((part) => part !== '' && part !== '.' && part !== '..')
  );
}
