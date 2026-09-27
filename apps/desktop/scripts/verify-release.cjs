// Checks the Linux release files before they're published (ROADMAP 5.3): every package's binary has the
// fuses from fuses.cjs, and the app ships only as resources/app.asar. Exits 1 on any problem.
// Usage: node scripts/verify-release.cjs [release folder]   (default: release)
const { execFileSync } = require('node:child_process');
const { existsSync, mkdtempSync, readdirSync, rmSync, statSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { FuseState, FuseV1Options, getCurrentFuseWire } = require('@electron/fuses');
const { EXPECTED_FUSES } = require('./fuses.cjs');

const EXECUTABLE = 'spaceaio';
const dir = process.argv[2] ?? 'release';

/** Unpack one release file into a temp folder; returns the folder. */
function unpack(file) {
  const out = mkdtempSync(join(tmpdir(), 'spaceaio-verify-'));
  if (file.endsWith('.AppImage')) {
    // Extracting runs the AppImage's own runtime, but needs no FUSE.
    execFileSync(join(process.cwd(), dir, file), ['--appimage-extract'], { cwd: out, stdio: 'ignore' });
  } else if (file.endsWith('.pacman')) {
    execFileSync('tar', ['-xJf', join(dir, file), '-C', out]);
  } else {
    execFileSync('tar', ['-xzf', join(dir, file), '-C', out]);
  }
  return out;
}

/** The app binary (named EXECUTABLE, next to resources/app.asar) inside an unpacked tree. */
function findBinary(root) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      const found = findBinary(path);
      if (found) return found;
    } else if (entry.name === EXECUTABLE && existsSync(join(root, 'resources', 'app.asar'))) return path;
  }
  return null;
}

async function check(file) {
  const problems = [];
  const root = unpack(file);
  try {
    const binary = findBinary(root);
    if (!binary) return [`no ${EXECUTABLE} binary next to resources/app.asar`];
    const wire = await getCurrentFuseWire(binary);
    for (const [option, on] of Object.entries(EXPECTED_FUSES)) {
      const want = on ? FuseState.ENABLE : FuseState.DISABLE;
      if (wire[option] !== want) problems.push(`fuse ${FuseV1Options[option]}: ${FuseState[wire[option]] ?? 'missing'}, expected ${FuseState[want]}`);
    }
    const resources = join(binary, '..', 'resources');
    if (existsSync(join(resources, 'app')) && statSync(join(resources, 'app')).isDirectory()) {
      problems.push('resources/app folder present: the app must load only from app.asar');
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  return problems;
}

(async () => {
  const files = readdirSync(dir).filter((f) => /\.(AppImage|pacman|tar\.gz)$/.test(f));
  if (files.length === 0) {
    console.error(`No release files in ${dir}. Run pnpm dist:linux first.`);
    process.exit(1);
  }
  let failed = false;
  for (const file of files) {
    const problems = await check(file);
    console.log(`${problems.length ? '✗' : '✓'} ${file}${problems.map((p) => `\n    ${p}`).join('')}`);
    failed ||= problems.length > 0;
  }
  process.exit(failed ? 1 : 0);
})();
