/**
 * Preload for WEB APP views (ROADMAP 3.4). Never exposes anything to the page and never uses IPC:
 * it only reads its settings from the command line main gave this view and installs the
 * fingerprinting protection in the page's main world. Runs sandboxed; tldts is bundled in.
 */
import { contextBridge } from 'electron';
import { getDomain } from 'tldts';
import { farble, type FarbleConfig } from './farble';
import { parseWebAppArgs } from '../shared/webapp';

const args = parseWebAppArgs(process.argv);

/** FNV-1a, 32-bit: the run's session key mixed with the site gives this page's seed. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

if (args.fingerprinting !== 'off' || args.gpc) {
  const host = location.hostname;
  const site = getDomain(host) ?? host;
  const config: FarbleConfig = { level: args.fingerprinting, gpc: args.gpc, seed: hash(`${args.key}|${site}`) };
  try {
    contextBridge.executeInMainWorld({ func: farble, args: [config] });
  } catch {
    // A page that can't run scripts (e.g. an error page): nothing to protect.
  }
}
