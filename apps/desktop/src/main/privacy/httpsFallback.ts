import { hostMatches } from '@aio/core';

/**
 * HTTPS upgrade fallback (ROADMAP 3.2). The https-only filter upgrades http:// page loads; if the
 * https:// version then fails to connect, the tile offers to continue over http once, and the site
 * is remembered (workspace.httpAllowedHosts, plus this in-memory set for the current run, which
 * covers the moment before the workspace save lands).
 */

/** Last main-frame upgrade per page: the https:// URL we loaded and the http:// one asked for. */
const upgrades = new Map<number, { https: string; http: string }>();
const allowedThisRun = new Set<string>();

export function noteUpgrade(webContentsId: number, http: string, https: string): void {
  upgrades.set(webContentsId, { http, https });
}

/** The http:// URL a failed https:// page load was upgraded from, if it was. */
export function upgradedFrom(webContentsId: number, failedUrl: string): string | undefined {
  const u = upgrades.get(webContentsId);
  if (!u) return undefined;
  try {
    return new URL(u.https).href === new URL(failedUrl).href ? u.http : undefined;
  } catch {
    return undefined;
  }
}

export function forgetPage(webContentsId: number): void {
  upgrades.delete(webContentsId);
}

export function allowHttpThisRun(host: string): void {
  allowedThisRun.add(host.toLowerCase());
}

/** Allowed this run: the host itself or a subdomain of an allowed site. */
export function isHttpAllowedThisRun(host: string): boolean {
  return hostMatches(host.toLowerCase(), [...allowedThisRun]);
}

/**
 * After a workspace save the saved list is the truth again: the UI records a site before asking to
 * continue over http, so it's in the saved list, and a site the user removed must stop being allowed.
 */
export function clearHttpAllowedThisRun(): void {
  allowedThisRun.clear();
}

/**
 * Chromium net errors that mean "the secure version isn't there": connection failures (-100..-199,
 * including TLS handshake errors), certificate errors (-200..-299), timeouts (-7), and an empty
 * reply (-324: the port accepts and closes, as http-only servers like neverssl.com do). Not DNS
 * failures (-105: http would fail too), aborted loads (-3), or other HTTP errors (the server answered).
 */
export function isFallbackError(code: number): boolean {
  if (code === -105) return false;
  return code === -7 || code === -324 || (code <= -100 && code >= -299);
}
