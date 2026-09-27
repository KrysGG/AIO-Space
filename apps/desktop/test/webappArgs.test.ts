import { describe, expect, it } from 'vitest';
import { parseWebAppArgs, webAppArgs } from '../src/shared/webapp';

describe('web app preload arguments', () => {
  it('round-trips through the command line', () => {
    const args = { fingerprinting: 'strict', gpc: true, key: 'a1b2c3d4e5f60718', ads: true } as const;
    expect(parseWebAppArgs(['/usr/bin/electron', ...webAppArgs(args), '--other'])).toEqual(args);
  });

  it('falls back to no fingerprint protection when missing or malformed', () => {
    expect(parseWebAppArgs([])).toEqual({ fingerprinting: 'off', gpc: false, key: '0', ads: false });
    expect(parseWebAppArgs(['--aio-webapp=paranoid,yes,not-hex!'])).toEqual({ fingerprinting: 'off', gpc: false, key: '0', ads: false });
  });
});

describe('media reports (privacy dots)', () => {
  it('accepts only this view’s key and well-formed states', async () => {
    const { parseMediaReport, MEDIA_REPORT } = await import('../src/shared/webapp');
    expect(parseMediaReport(`${MEDIA_REPORT}abc123:110`, 'abc123')).toEqual({ mic: true, camera: true, screen: false });
    expect(parseMediaReport(`${MEDIA_REPORT}abc123:001`, 'abc123')).toEqual({ mic: false, camera: false, screen: true });
    expect(parseMediaReport(`${MEDIA_REPORT}deadbeef:111`, 'abc123')).toBeNull(); // forged by the page
    expect(parseMediaReport(`${MEDIA_REPORT}abc123:12`, 'abc123')).toBeNull();
    expect(parseMediaReport('hello', 'abc123')).toBeNull();
  });
});
