import { describe, expect, it } from 'vitest';
import type { OnHeadersReceivedListenerDetails } from 'electron';
import { cleanUserAgent, isGoogleSignIn, noPasskeyPopupFilter, withAppToken } from '../src/main/sessions/userAgent';

const ELECTRON_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) SpaceAIO/0.1.0 Chrome/152.0.7977.130 Electron/44.4.5 Safari/537.36';

describe('cleanUserAgent', () => {
  it('removes the Electron and app tokens, leaving a normal Chrome UA', () => {
    expect(cleanUserAgent(ELECTRON_UA, 'SpaceAIO')).toBe(
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.7977.130 Safari/537.36',
    );
  });

  it('treats regex characters in the app name literally', () => {
    const ua = 'Mozilla/5.0 Chrome/152.0 a+b/1.0 Safari/537.36';
    expect(cleanUserAgent(ua, 'a+b')).toBe('Mozilla/5.0 Chrome/152.0 Safari/537.36');
    expect(cleanUserAgent(ua, '.*')).toBe(ua);
  });

  it('strips every name the app may carry while starting (a moved profile starts as @aio/desktop, D-058)', () => {
    const legacy = ELECTRON_UA.replace('SpaceAIO/0.1.0', '@aio/desktop/0.1.0');
    const clean = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.7977.130 Safari/537.36';
    for (const ua of [ELECTRON_UA, legacy]) expect(cleanUserAgent(ua, ['SpaceAIO', '@aio/desktop'])).toBe(clean);
  });
});

describe('Google sign-in UA', () => {
  it('matches only accounts.google.com', () => {
    expect(isGoogleSignIn('https://accounts.google.com/v3/signin/identifier')).toBe(true);
    expect(isGoogleSignIn('https://ACCOUNTS.google.com/')).toBe(true);
    expect(isGoogleSignIn('https://www.google.com/')).toBe(false);
    expect(isGoogleSignIn('https://accounts.google.com.evil.example/')).toBe(false);
    expect(isGoogleSignIn('not a url')).toBe(false);
  });

  it('adds the app token once (D-064)', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.7977.130 Safari/537.36';
    expect(withAppToken(ua, 'SpaceAIO/0.1.1')).toBe(`${ua} SpaceAIO/0.1.1`);
    expect(withAppToken(withAppToken(ua, 'SpaceAIO/0.1.1'), 'SpaceAIO/0.1.1')).toBe(`${ua} SpaceAIO/0.1.1`);
  });
});

const res = (url: string, resourceType = 'mainFrame'): OnHeadersReceivedListenerDetails =>
  ({ url, resourceType }) as unknown as OnHeadersReceivedListenerDetails;

describe('no passkey popup on sign-in pages (D-064)', () => {
  it('turns off passkey requests on sign-in providers’ pages only, keeping their own policy', () => {
    const out = noPasskeyPopupFilter.onHeadersReceived!(res('https://accounts.google.com/'), { 'permissions-policy': ['ch-ua-arch=*'] });
    expect(out['permissions-policy']).toEqual(['ch-ua-arch=*, publickey-credentials-get=()']);
    expect(noPasskeyPopupFilter.onHeadersReceived!(res('https://login.live.com/'), {})['Permissions-Policy']).toEqual(['publickey-credentials-get=()']);
    const other = { a: ['1'] };
    expect(noPasskeyPopupFilter.onHeadersReceived!(res('https://github.com/'), other)).toBe(other);
    expect(noPasskeyPopupFilter.onHeadersReceived!(res('https://accounts.google.com/x.js', 'script'), other)).toBe(other);
  });
});
