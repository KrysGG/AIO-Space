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
