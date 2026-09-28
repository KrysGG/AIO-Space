import { constants } from 'node:fs';
import { copyFile, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { app, session, webContents, type Session, type WebContents } from 'electron';
import { partitionFor, type AppPermission, type PrivacySettings, type WebAppDef } from '@aio/core';
import { noteUpgrade } from '../privacy/httpsFallback';
import { installRequestPipeline } from '../privacy/requestPipeline';
import type { FilterLists } from '../privacy/filterLists';
import { BROWSER_SCRIPTLET_SITES, type ScriptletFiles } from '../privacy/scriptlets';
import type { SharedSignIn } from './sharedSignIn';
import { buildShieldFilters } from '../privacy/shields';
import { appSites } from '../privacy/sites';
import { cleanUserAgent, googleSignInFilter, noPasskeyPopupFilter } from './userAgent';
import { APP_NAME, LEGACY_NAME } from '../store/legacyProfile';

const configured = new Map<string, Session>();

/**
 * Spellcheck without Google (D-066). Chromium's Hunspell spellchecker (Linux; Windows for languages
 * Windows can't check) downloads dictionaries from Google's CDN. The app ships US English, copied to
 * where Chromium looks first (userData/Dictionaries); any other download goes to a scheme that loads
 * nothing, so those languages simply get no spellcheck.
 */
const NO_DICTIONARY_DOWNLOADS = 'aio-no-download://dictionaries/';

export async function installDictionaries(): Promise<void> {
  const from = app.isPackaged ? join(process.resourcesPath, 'hunspell') : join(app.getAppPath(), 'vendor', 'hunspell');
  const to = join(app.getPath('userData'), 'Dictionaries');
  await mkdir(to, { recursive: true });
  for (const name of (await readdir(from)).filter((n) => n.endsWith('.bdic'))) {
    // Never over a file Chromium already has (or is loading).
    await copyFile(join(from, name), join(to, name), constants.COPYFILE_EXCL).catch(() => {});
  }
}

/** The app's own UA token, shown to Google's sign-in pages (D-064). */
export const SIGN_IN_TOKEN = `${APP_NAME}/${app.getVersion()}`;

/** Pages that were given the camera/microphone or screen sharing (e.g. a Discord call): never slept. */
const mediaUsers = new WeakSet<WebContents>();
export function hasUsedMedia(wc: WebContents): boolean {
  return mediaUsers.has(wc);
}

/**
 * One persistent, isolated session per app and account (ROADMAP 2.12).
 * Configured exactly once: UA, permissions, and the privacy request pipeline.
 */
export function getAppSession(
  def: WebAppDef,
  profile: string,
  getPrivacy: () => PrivacySettings,
  onBlocked: (webContentsId: number) => void,
  httpAllowed: (host: string) => boolean,
  filterLists?: FilterLists,
  scriptlets?: ScriptletFiles,
  signIn?: SharedSignIn,
): Session {
  const partition = partitionFor(def.id, profile);
  const existing = configured.get(partition);
  if (existing) return existing;

  const ses = session.fromPartition(partition);
  ses.setUserAgent(cleanUserAgent(ses.getUserAgent(), [APP_NAME, LEGACY_NAME]));
  ses.setSpellCheckerDictionaryDownloadURL(NO_DICTIONARY_DOWNLOADS);

  const allowed = new Set<string>(def.permissions satisfies AppPermission[]);
  ses.setPermissionRequestHandler((wc, permission, callback) => {
    const ok = allowed.has(permission);
    if (ok && (permission === 'media' || permission === 'display-capture')) mediaUsers.add(wc);
    callback(ok);
  });
  ses.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));

  const https = { httpAllowed, onUpgrade: noteUpgrade };
  const cookies = { appSites: appSites(def), topUrl: (id: number) => webContents.fromId(id)?.getURL() };
  const lists = { engine: (kind: 'ads' | 'trackers') => filterLists?.engine(kind) };
  const signInFilters = [googleSignInFilter(SIGN_IN_TOKEN), ...(process.platform === 'win32' ? [noPasskeyPopupFilter] : [])];
  installRequestPipeline(ses, [...signInFilters, ...buildShieldFilters(getPrivacy, https, cookies, lists)], onBlocked);

  // Scriptlets (ROADMAP 3.6): the app's own sites, or a few popular ones for the Browser tile.
  if (scriptlets) {
    const sites = def.kind === 'browser' ? BROWSER_SCRIPTLET_SITES : [...(appSites(def) ?? [])];
    ses.registerPreloadScript({ type: 'frame', filePath: scriptlets.fileFor(partition, sites) });
  }

  // Shared Google sign-in (D-045): first accounts only; a no-op while the setting is off.
  signIn?.attach(partition, ses);

  configured.set(partition, ses);
  return ses;
}
