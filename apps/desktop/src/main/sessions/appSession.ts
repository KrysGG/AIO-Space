import { app, session, webContents, type Session, type WebContents } from 'electron';
import { partitionFor, type AppPermission, type PrivacySettings, type WebAppDef } from '@aio/core';
import { noteUpgrade } from '../privacy/httpsFallback';
import { installRequestPipeline } from '../privacy/requestPipeline';
import { buildShieldFilters } from '../privacy/shields';
import { appSites } from '../privacy/sites';
import { cleanUserAgent, googleSignInFilter } from './userAgent';

const configured = new Map<string, Session>();

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
): Session {
  const partition = partitionFor(def.id, profile);
  const existing = configured.get(partition);
  if (existing) return existing;

  const ses = session.fromPartition(partition);
  ses.setUserAgent(cleanUserAgent(ses.getUserAgent(), app.getName()));

  const allowed = new Set<string>(def.permissions satisfies AppPermission[]);
  ses.setPermissionRequestHandler((wc, permission, callback) => {
    const ok = allowed.has(permission);
    if (ok && (permission === 'media' || permission === 'display-capture')) mediaUsers.add(wc);
    callback(ok);
  });
  ses.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));

  const https = { httpAllowed, onUpgrade: noteUpgrade };
  const cookies = { appSites: appSites(def), topUrl: (id: number) => webContents.fromId(id)?.getURL() };
  installRequestPipeline(ses, [googleSignInFilter, ...buildShieldFilters(getPrivacy, https, cookies)], onBlocked);

  configured.set(partition, ses);
  return ses;
}
