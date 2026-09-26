/**
 * Settings main hands to the web app preload (ROADMAP 3.4) through `additionalArguments`: web views
 * have no IPC, so the command line is the only channel, fixed when the view is created.
 */
export type FingerprintLevel = 'off' | 'standard' | 'strict';

export interface WebAppArgs {
  fingerprinting: FingerprintLevel;
  gpc: boolean;
  /** Random per app session and run (hex): seeds the noise. */
  key: string;
}

const PREFIX = '--aio-webapp=';

export function webAppArgs(args: WebAppArgs): string[] {
  return [`${PREFIX}${args.fingerprinting},${args.gpc ? 1 : 0},${args.key}`];
}

/** Anything missing or malformed means no protection changes, never a broken page. */
export function parseWebAppArgs(argv: readonly string[]): WebAppArgs {
  const raw = argv.find((a) => a.startsWith(PREFIX))?.slice(PREFIX.length) ?? '';
  const [level, gpc, key] = raw.split(',');
  const fingerprinting: FingerprintLevel = level === 'standard' || level === 'strict' ? level : 'off';
  return { fingerprinting, gpc: gpc === '1', key: /^[0-9a-f]{8,64}$/.test(key ?? '') ? key! : '0' };
}
