import { app, session, type Session } from 'electron';
import { partitionFor, type AppPermission, type PrivacySettings, type WebAppDef } from '@aio/core';
import { installRequestPipeline, type RequestFilter } from '../privacy/requestPipeline';
import { buildShieldFilters } from '../privacy/shields';
import { cleanUserAgent, isGoogleSignIn, SIGN_IN_USER_AGENT } from './userAgent';

/** Request-side half of the Google sign-in fix: Firefox UA and no Chromium client hints. */
const googleSignInFilter: RequestFilter = {
  name: 'google-sign-in-ua',
  onBeforeSendHeaders(details, headers) {
    if (!isGoogleSignIn(details.url)) return headers;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers)) {
      const key = k.toLowerCase();
      if (key === 'user-agent' || key.startsWith('sec-ch-ua')) continue;
      out[k] = v;
    }
    out['User-Agent'] = SIGN_IN_USER_AGENT;
    return out;
  },
};

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

  installRequestPipeline(ses, [googleSignInFilter, ...buildShieldFilters(getPrivacy)]);

  configured.set(partition, ses);
  return ses;
}
