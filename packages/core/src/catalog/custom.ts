import { newId } from '../util/id';
import type { AppPermission, WebAppDef } from './apps';

/**
 * User-added web apps (ROADMAP 2.7). They work like built-ins: own session, allowed sites,
 * permissions off unless granted. They can never allow every site ('*'); that is the Browser's job.
 */

export const MAX_CUSTOM_APPS = 50;

/** Permissions a user can grant, with the words the UI shows for them. */
export const PERMISSION_LABELS: Record<AppPermission, string> = {
  notifications: 'Notifications',
  media: 'Camera and microphone',
  'display-capture': 'Screen sharing',
  fullscreen: 'Full screen',
  'clipboard-sanitized-write': 'Copy to clipboard',
};

/** Second-level labels under which a site's own domain has three parts (bbc.co.uk). */
const MULTI_PART_SUFFIX = /^(co|com|net|org|gov|edu|ac)\.[a-z]{2}$/;
const HOSTNAME = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}$/;

/** "web.whatsapp.com" -> "whatsapp.com", "news.bbc.co.uk" -> "bbc.co.uk" (a heuristic; users can edit it). */
export function siteDomain(host: string): string {
  const labels = host.toLowerCase().replace(/\.$/, '').split('.');
  if (labels.length <= 2) return labels.join('.');
  const lastTwo = labels.slice(-2).join('.');
  return MULTI_PART_SUFFIX.test(lastTwo) ? labels.slice(-3).join('.') : lastTwo;
}

export function isValidHostname(host: string): boolean {
  return HOSTNAME.test(host);
}

export interface CustomAppInput {
  name: string;
  url: string;
  /** Comma/space separated or a list; empty means "the site's domain". */
  allowedHosts?: string | string[];
  permissions?: AppPermission[];
}

export type CustomAppResult = { ok: true; app: WebAppDef } | { ok: false; error: string };

/** Two letters for the fallback glyph: "WhatsApp Web" -> "WW", "Notion" -> "No". */
function glyphFor(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const g = words.length > 1 ? words[0]![0]! + words[1]![0]! : name.trim().slice(0, 2);
  return g.charAt(0).toUpperCase() + g.slice(1);
}

/** Validate what the user typed and build the app. Errors say what to fix. */
export function makeCustomApp(input: CustomAppInput, existing: WebAppDef[] = []): CustomAppResult {
  const name = input.name.trim();
  if (!name) return { ok: false, error: 'Give the app a name.' };
  if (name.length > 40) return { ok: false, error: 'Use a name of 40 characters or fewer.' };

  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(input.url.trim()) ? input.url.trim() : `https://${input.url.trim()}`);
  } catch {
    return { ok: false, error: 'Enter the app’s web address, like web.whatsapp.com.' };
  }
  if (url.protocol !== 'https:') return { ok: false, error: 'Only https:// addresses can be added as apps.' };
  const host = url.hostname.toLowerCase();
  if (!isValidHostname(host)) return { ok: false, error: 'That address doesn’t look like a website. Check it and try again.' };

  const raw = Array.isArray(input.allowedHosts) ? input.allowedHosts : (input.allowedHosts ?? '').split(/[\s,]+/);
  const typed = raw.map((h) => h.trim().toLowerCase().replace(/^\*\./, '')).filter(Boolean);
  const bad = typed.find((h) => !isValidHostname(h));
  if (bad) return { ok: false, error: `“${bad}” isn’t a site name. Use names like whatsapp.com, separated by commas.` };
  const allowedHosts = [...new Set(typed.length ? typed : [siteDomain(host)])];
  if (!allowedHosts.some((h) => host === h || host.endsWith(`.${h}`))) {
    allowedHosts.unshift(host); // the start page must always be allowed
  }
  if (allowedHosts.length > 20) return { ok: false, error: 'List at most 20 allowed sites.' };
  if (existing.filter((a) => a.id.startsWith('custom-')).length >= MAX_CUSTOM_APPS) {
    return { ok: false, error: `You can add up to ${MAX_CUSTOM_APPS} apps. Remove one first.` };
  }

  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'app';
  const app: WebAppDef = {
    id: `custom-${slug}-${newId('x').slice(2, 8)}`,
    name,
    url: url.href,
    kind: 'app',
    allowedHosts,
    // Sign-in popups for the app's own sites and the common "Sign in with ..." providers.
    popupHosts: [...allowedHosts, 'accounts.google.com', 'appleid.apple.com', 'login.microsoftonline.com'],
    permissions: [...new Set(input.permissions ?? [])],
    glyph: glyphFor(name),
  };
  return { ok: true, app };
}
