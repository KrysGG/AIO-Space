/**
 * "Shields" settings modelled on Brave's defaults. Global defaults can be
 * overridden per app (e.g. relax fingerprinting for a site that breaks).
 * Implementations live in the platform shells (apps/desktop/src/main/privacy).
 */
export interface PrivacySettings {
  /** Master switch (ROADMAP 3.1): off turns every protection below off. Per app, usually. */
  shields: boolean;
  /** Block ads via the filter-list engine (Phase 3.6). */
  blockAds: boolean;
  /** Block known tracker and telemetry hosts (Phase 3.5). */
  blockTrackers: boolean;
  /** Remove tracking query params like utm_*, fbclid, gclid. */
  stripTrackingParams: boolean;
  /** Send the Global Privacy Control header (Sec-GPC: 1). */
  globalPrivacyControl: boolean;
  /** Upgrade http:// requests to https://. */
  httpsOnly: boolean;
  /** Cross-origin Referer is trimmed to the origin only. */
  trimReferrers: boolean;
  /** Block third-party cookies (Phase 3.3). */
  blockThirdPartyCookies: boolean;
  /** Brave-style farbling of canvas/audio/etc. (Phase 3.4). */
  fingerprinting: 'off' | 'standard' | 'strict';
  /**
   * WebRTC IP handling. 'default_public_interface_only' hides local IPs but keeps
   * Discord voice working. 'disable_non_proxied_udp' is stricter and can break calls.
   */
  webrtcPolicy: 'default' | 'default_public_interface_only' | 'disable_non_proxied_udp';
}

export const DEFAULT_PRIVACY: PrivacySettings = {
  shields: true,
  blockAds: true,
  blockTrackers: true,
  stripTrackingParams: true,
  globalPrivacyControl: true,
  httpsOnly: true,
  trimReferrers: true,
  blockThirdPartyCookies: true,
  fingerprinting: 'standard',
  webrtcPolicy: 'default_public_interface_only',
};

/** Everything a site sees with Shields down: no blocking, no rewriting, Chromium's defaults. */
export const SHIELDS_DOWN: Omit<PrivacySettings, 'shields'> = {
  blockAds: false,
  blockTrackers: false,
  stripTrackingParams: false,
  globalPrivacyControl: false,
  httpsOnly: false,
  trimReferrers: false,
  blockThirdPartyCookies: false,
  fingerprinting: 'off',
  webrtcPolicy: 'default',
};

/** Effective settings for an app: global defaults, its overrides, and the master switch. */
export function resolvePrivacy(
  global: PrivacySettings,
  override?: Partial<PrivacySettings>,
): PrivacySettings {
  const merged = { ...global, ...(override ?? {}) };
  return merged.shields ? merged : { ...merged, ...SHIELDS_DOWN };
}

/** Switches shown in the Shields panel: only protections that are implemented today. */
export const SHIELD_SWITCHES: Array<{ key: ShieldSwitch; label: string; hint: string }> = [
  { key: 'blockTrackers', label: 'Block trackers and telemetry', hint: 'Stops known tracking and analytics requests.' },
  { key: 'httpsOnly', label: 'Upgrade connections to HTTPS', hint: 'Loads secure versions of sites when you follow http:// links.' },
  { key: 'stripTrackingParams', label: 'Remove tracking from links', hint: 'Drops utm_, fbclid and similar tags from addresses.' },
  { key: 'trimReferrers', label: 'Hide the page you came from', hint: 'Other sites only learn the site, not the exact page.' },
  { key: 'globalPrivacyControl', label: 'Ask sites not to sell or share your data', hint: 'Sends the Global Privacy Control signal.' },
  // TODO(ROADMAP 3.3, 3.4, 3.6): third-party cookies, fingerprinting, ads join this list when built.
];
export type ShieldSwitch = 'blockTrackers' | 'httpsOnly' | 'stripTrackingParams' | 'trimReferrers' | 'globalPrivacyControl';

export const WEBRTC_CHOICES: Array<{ value: PrivacySettings['webrtcPolicy']; label: string }> = [
  { value: 'default_public_interface_only', label: 'Hide local address (recommended)' },
  { value: 'disable_non_proxied_udp', label: 'Strict (may break calls)' },
  { value: 'default', label: 'Off' },
];

/**
 * Set one setting for an app. A value equal to the global default removes the override, so apps
 * follow later changes to the defaults; an empty override is removed entirely.
 */
export function setPrivacyOverride<K extends keyof PrivacySettings>(
  global: PrivacySettings,
  overrides: Record<string, Partial<PrivacySettings>>,
  appId: string,
  key: K,
  value: PrivacySettings[K],
): Record<string, Partial<PrivacySettings>> {
  const current = { ...(overrides[appId] ?? {}) };
  if (global[key] === value) delete current[key];
  else current[key] = value;
  const next = { ...overrides };
  if (Object.keys(current).length) next[appId] = current;
  else delete next[appId];
  return next;
}
