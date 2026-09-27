import { hostMatches, isWebUrl, type WebAppDef } from '@aio/core';
import { SIGN_IN_HOSTS } from '../../shared/webapp';

export { SIGN_IN_HOSTS };

/**
 * Where an app's navigations and new windows go (ROADMAP 1.6, D-044). Pure, so the rules are tested
 * without Electron; ViewManager acts on the answers.
 *
 * Apps stay on their own sites; other links open in the system browser. Sign-in is the exception:
 * "Continue with Google/Apple/Microsoft" either opens a popup or sends the whole page to the provider
 * and back, and both must stay inside the app (in its own session), or the login ends up in the
 * system browser where the app can't see it.
 */

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/** A sign-in page this app may show: its own sign-in sites (popupHosts) or a known provider. */
export function isSignIn(def: Pick<WebAppDef, 'popupHosts'>, url: string): boolean {
  const host = hostOf(url);
  return host !== '' && (hostMatches(host, def.popupHosts) || hostMatches(host, SIGN_IN_HOSTS));
}

export type NavigationDecision = 'allow' | 'external' | 'block';

/** A page in the app's tile wants to go to `url`. */
export function navigationDecision(def: Pick<WebAppDef, 'allowedHosts' | 'popupHosts'>, url: string): NavigationDecision {
  if (!isWebUrl(url)) return 'block';
  if (hostMatches(hostOf(url), def.allowedHosts)) return 'allow';
  // Full-page sign-in ("redirect" flow): the provider sends the page back to the app afterwards.
  if (isSignIn(def, url)) return 'allow';
  return 'external';
}

export type WindowDecision = 'popup' | 'new-tile' | 'same-tile' | 'external' | 'deny';

/** A page asked for a new window (`window.open`, `target=_blank`). */
export function windowDecision(
  def: Pick<WebAppDef, 'kind' | 'allowedHosts' | 'popupHosts'>,
  url: string,
  disposition: string,
): WindowDecision {
  // Sign-in buttons often open an empty popup first and load the provider's page into it after,
  // so a blank scripted popup is allowed (it's a hardened window in the app's session).
  const blank = url === '' || url === 'about:blank';
  if (blank) return disposition === 'new-window' ? 'popup' : 'deny';
  if (!isWebUrl(url)) return 'deny';
  if (def.kind === 'browser') {
    // Links asking for a new tab open in a new Browser tile (D-015). Scripted popups
    // (window.open with features, e.g. "Sign in with ...") stay popups so they keep their opener.
    if (disposition === 'new-window') return 'popup';
    if (disposition === 'foreground-tab' || disposition === 'background-tab') return 'new-tile';
    return 'same-tile';
  }
  // The app's own pages: a scripted popup (window.open with features, e.g. its own login window)
  // stays a popup so it keeps its opener; a plain "new tab" link just loads in the tile.
  if (hostMatches(hostOf(url), def.allowedHosts)) return disposition === 'new-window' ? 'popup' : 'same-tile';
  if (isSignIn(def, url)) return 'popup';
  return 'external';
}

/** Inside a sign-in popup: web pages only (the provider hops between its own hosts). */
export function popupNavigationDecision(url: string): NavigationDecision {
  return isWebUrl(url) || url === 'about:blank' ? 'allow' : 'block';
}
