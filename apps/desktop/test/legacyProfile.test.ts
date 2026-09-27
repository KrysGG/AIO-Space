import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { APP_NAME, LEGACY_NAME, legacyProfileInUse, migrateLegacyProfile } from '../src/main/store/legacyProfile';

const dirs: string[] = [];
function appData(): { appData: string; legacy: string; userData: string } {
  const d = mkdtempSync(join(tmpdir(), 'aio-rename-'));
  dirs.push(d);
  return { appData: d, legacy: join(d, '@aio', 'desktop'), userData: join(d, APP_NAME) };
}
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

describe('moving the profile after the rename to SpaceAIO (D-058)', () => {
  it('moves the old profile once and keeps the old keyring name for its cookies', () => {
    const { appData: a, legacy, userData } = appData();
    mkdirSync(join(legacy, 'Partitions', 'app-discord-default'), { recursive: true });
    writeFileSync(join(legacy, 'workspace.json'), '{"version":17}');
    expect(migrateLegacyProfile(a, userData)).toBe(LEGACY_NAME);
    expect(readFileSync(join(userData, 'workspace.json'), 'utf8')).toBe('{"version":17}');
    expect(existsSync(join(userData, 'Partitions', 'app-discord-default'))).toBe(true);
    expect(existsSync(join(a, '@aio'))).toBe(false); // the empty parent is tidied up
    // Every later start: nothing to move, still the old keyring name.
    expect(migrateLegacyProfile(a, userData)).toBe(LEGACY_NAME);
  });

  it('leaves fresh installs and already-used new profiles alone', () => {
    const fresh = appData();
    expect(migrateLegacyProfile(fresh.appData, fresh.userData)).toBeNull();
    expect(existsSync(fresh.userData)).toBe(false);

    const both = appData();
    mkdirSync(both.legacy, { recursive: true });
    writeFileSync(join(both.legacy, 'workspace.json'), 'old');
    mkdirSync(both.userData);
    writeFileSync(join(both.userData, 'workspace.json'), 'new');
    expect(migrateLegacyProfile(both.appData, both.userData)).toBeNull();
    expect(readFileSync(join(both.userData, 'workspace.json'), 'utf8')).toBe('new'); // never overwritten
    expect(existsSync(both.legacy)).toBe(true);
  });

  it('ignores a damaged keyring-name file', () => {
    const { appData: a, userData } = appData();
    mkdirSync(userData);
    writeFileSync(join(userData, '.keyring-name'), 'bad\nname$(rm)');
    expect(migrateLegacyProfile(a, userData)).toBeNull();
  });

  it('waits while the old app is running on the profile, not for stale locks', () => {
    const { appData: a, legacy, userData } = appData();
    mkdirSync(legacy, { recursive: true });
    symlinkSync(`myhost-${process.pid}`, join(legacy, 'SingletonLock'));
    expect(legacyProfileInUse(a, userData)).toBe(true);
    rmSync(join(legacy, 'SingletonLock'));
    symlinkSync('myhost-999999999', join(legacy, 'SingletonLock'));
    expect(legacyProfileInUse(a, userData)).toBe(false);
  });
});
