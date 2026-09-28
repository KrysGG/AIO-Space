// Point the AUR files at a release (ROADMAP 5.5): sets pkgver, resets pkgrel and fills in the sha256 sums
// of the release's tar.gz, the icon, the .desktop file and LICENSE, in PKGBUILD and .SRCINFO (same order
// as `source=`). Runs in the release pipeline, where makepkg isn't available.
// Usage: node packaging/aur/update.cjs <version> <tar.gz> <icon.svg> <LICENSE> <out dir>
const { createHash } = require('node:crypto');
const { readFileSync, writeFileSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');

const [version, tarball, icon, license, outDir] = process.argv.slice(2);
if (!/^\d+\.\d+\.\d+$/.test(version ?? '') || !tarball || !icon || !license || !outDir) {
  console.error('Usage: node packaging/aur/update.cjs <version> <tar.gz> <icon.svg> <LICENSE> <out dir>');
  process.exit(1);
}
const here = __dirname;
const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const sums = [sha(tarball), sha(icon), sha(join(here, 'spaceaio.desktop')), sha(license)];

const pkgbuild = readFileSync(join(here, 'PKGBUILD'), 'utf8')
  .replace(/^pkgver=.*$/m, `pkgver=${version}`)
  .replace(/^pkgrel=.*$/m, 'pkgrel=1')
  .replace(/^sha256sums=\([^)]*\)/m, `sha256sums=(${sums.map((s) => `'${s}'`).join('\n            ')})`);

const oldVersion = readFileSync(join(here, '.SRCINFO'), 'utf8').match(/^\tpkgver = (.+)$/m)?.[1];
if (!oldVersion) throw new Error('.SRCINFO has no pkgver');
let i = 0;
const srcinfo = readFileSync(join(here, '.SRCINFO'), 'utf8')
  .split(oldVersion)
  .join(version)
  .replace(/^\tpkgrel = .*$/m, '\tpkgrel = 1')
  .replace(/^\tsha256sums = .*$/gm, () => `\tsha256sums = ${sums[i++]}`);
if (i !== sums.length) throw new Error(`.SRCINFO has ${i} sha256sums lines, expected ${sums.length}`);

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'PKGBUILD'), pkgbuild);
writeFileSync(join(outDir, '.SRCINFO'), srcinfo);
console.log(`AUR files for ${version} written to ${outDir}`);
