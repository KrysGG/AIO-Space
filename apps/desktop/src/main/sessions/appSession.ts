import { app, session, type Session } from 'electron';
import { partitionFor, type AppPermission, type PrivacySettings, type WebAppDef } from '@aio/core';
import { installRequestPipeline } from '../privacy/requestPipeline';
import { buildShieldFilters } from '../privacy/shields';
import { cleanUserAgent } from './userAgent';

const configured = new Map<string, Session>();

/**
 * One persistent, isolated session per app (per profile later).
 * Configured exactly once: UA, permissions, and the privacy request pipeline.
 */
export function getAppSession(def: WebAppDef, getPrivacy: () => PrivacySettings): Session {
  const partition = partitionFor(def.id);
  const existing = configured.get(partition);
  if (existing) return existing;

  const ses = session.fromPartition(partition);
  ses.setUserAgent(cleanUserAgent(ses.getUserAgent(), app.getName()));

  const allowed = new Set<string>(def.permissions satisfies AppPermission[]);
  ses.setPermissionRequestHandler((_wc, permission, callback) => callback(allowed.has(permission)));
  ses.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));

  installRequestPipeline(ses, buildShieldFilters(getPrivacy));

  configured.set(partition, ses);
  return ses;
}
