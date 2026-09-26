/**
 * "Shields" settings modelled on Brave's defaults. Global defaults can be
 * overridden per app (e.g. relax fingerprinting for a site that breaks).
 * Implementations live in the platform shells (apps/desktop/src/main/privacy).
 */
export interface PrivacySettings {
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

export function resolvePrivacy(
  global: PrivacySettings,
  override?: Partial<PrivacySettings>,
): PrivacySettings {
  return { ...global, ...(override ?? {}) };
}
