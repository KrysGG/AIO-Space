import { describe, expect, it } from 'vitest';
import { DEFAULT_PRIVACY, resolvePrivacy, setPrivacyOverride } from '../src/privacy/settings';
import { defaultWorkspace, migrateWorkspace, WORKSPACE_VERSION } from '../src/workspace/workspace';

describe('resolvePrivacy', () => {
  it('uses the defaults, then the app’s overrides', () => {
    expect(resolvePrivacy(DEFAULT_PRIVACY)).toEqual(DEFAULT_PRIVACY);
    expect(resolvePrivacy(DEFAULT_PRIVACY, { httpsOnly: false }).httpsOnly).toBe(false);
    expect(resolvePrivacy(DEFAULT_PRIVACY, { httpsOnly: false }).blockTrackers).toBe(true);
  });

  it('turns everything off when Shields are down for the app, and back on when up', () => {
    const down = resolvePrivacy(DEFAULT_PRIVACY, { shields: false });
    expect(down).toMatchObject({ shields: false, blockTrackers: false, httpsOnly: false, stripTrackingParams: false, trimReferrers: false, globalPrivacyControl: false, fingerprinting: 'off', webrtcPolicy: 'default' });
    // overrides for single switches are ignored while down...
    expect(resolvePrivacy(DEFAULT_PRIVACY, { shields: false, blockTrackers: true }).blockTrackers).toBe(false);
    // ...and come back when Shields go up again
    expect(resolvePrivacy(DEFAULT_PRIVACY, { shields: true, httpsOnly: false }).httpsOnly).toBe(false);
  });
});

describe('setPrivacyOverride', () => {
  it('stores only differences from the defaults, per app', () => {
    let o = setPrivacyOverride(DEFAULT_PRIVACY, {}, 'discord', 'httpsOnly', false);
    expect(o).toEqual({ discord: { httpsOnly: false } });
    o = setPrivacyOverride(DEFAULT_PRIVACY, o, 'youtube', 'shields', false);
    expect(o).toEqual({ discord: { httpsOnly: false }, youtube: { shields: false } });
    o = setPrivacyOverride(DEFAULT_PRIVACY, o, 'discord', 'httpsOnly', true); // back to default
    expect(o).toEqual({ youtube: { shields: false } });
  });
});

describe('workspace v8', () => {
  it('adds the Shields master switch, on', () => {
    expect(defaultWorkspace().privacy.shields).toBe(true);
    const v7 = { ...defaultWorkspace(), version: 7, privacy: { ...DEFAULT_PRIVACY } } as Record<string, unknown>;
    delete (v7['privacy'] as Record<string, unknown>)['shields'];
    const out = migrateWorkspace(v7);
    expect(out.version).toBe(WORKSPACE_VERSION);
    expect(out.privacy.shields).toBe(true);
  });
});
