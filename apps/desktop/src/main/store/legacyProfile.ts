import { existsSync, readFileSync, readlinkSync, renameSync, rmdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** The app's name (package.json `productName`): data folder, notifications, window class. */
export const APP_NAME = 'SpaceAIO';
/** What the app was called before the rename (D-058): its data lived in <appData>/@aio/desktop. */
export const LEGACY_NAME = '@aio/desktop';
/** In the data folder: the name Chromium's cookie key is stored under, when it isn't APP_NAME. */
const KEYRING_FILE = '.keyring-name';

/**
 * Move a profile from before the rename (D-058) into the new data folder, once: only when the new
 * folder doesn't exist yet and the old one does (a rename on the same disk, so atomic). Cookies are
 * encrypted with a keyring entry named after the app, so a moved profile remembers the old name.
 *
 * Returns the name the app must carry while Chromium starts, so it finds that key (null: APP_NAME).
 */
export function migrateLegacyProfile(appData: string, userData: string): string | null {
  const legacy = join(appData, ...LEGACY_NAME.split('/'));
  if (!existsSync(userData) && existsSync(legacy)) {
    renameSync(legacy, userData);
    writeFileSync(join(userData, KEYRING_FILE), LEGACY_NAME, { mode: 0o600 });
    try {
      rmdirSync(join(appData, LEGACY_NAME.split('/')[0]!)); // the now-empty "@aio" folder
    } catch {
      // not empty or already gone: leave it
    }
  }
  let name = '';
  try {
    name = readFileSync(join(userData, KEYRING_FILE), 'utf8').trim();
  } catch {
    return null;
  }
  return /^[@\w./ -]{1,64}$/.test(name) && name !== APP_NAME ? name : null;
}

/**
 * The pre-rename app is running on this profile right now (Chromium's SingletonLock is a link named
 * "<host>-<pid>"): moving the folder from under it would break both, so the migration must wait.
 */
export function legacyProfileInUse(appData: string, userData: string): boolean {
  if (existsSync(userData)) return false; // already migrated (or a fresh profile): nothing to move
  let target: string;
  try {
    target = readlinkSync(join(appData, ...LEGACY_NAME.split('/'), 'SingletonLock'));
  } catch {
    return false;
  }
  const pid = Number(target.split('-').pop());
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false; // a stale lock from a crash
  }
}

