import { beforeEach, describe, expect, it } from 'vitest';
import type { OnBeforeRequestListenerDetails, OnBeforeSendHeadersListenerDetails } from 'electron';
import { DEFAULT_PRIVACY, type PrivacySettings } from '@aio/core';
import { buildShieldFilters } from '../src/main/privacy/shields';
import { allowHttpThisRun, clearHttpAllowedThisRun, forgetPage, isFallbackError, isHttpAllowedThisRun, noteUpgrade, upgradedFrom } from '../src/main/privacy/httpsFallback';
import type { RequestFilter } from '../src/main/privacy/requestPipeline';
import { googleSignInFilter } from '../src/main/sessions/userAgent';

let settings: PrivacySettings;
const filters = buildShieldFilters(() => settings);
const filter = (name: string): RequestFilter => {
  const f = filters.find((x) => x.name === name);
  if (!f) throw new Error(`no filter ${name}`);
  return f;
};

/** Only the fields the filters read; the rest of Electron's details object is irrelevant here. */
const req = (url: string, resourceType = 'mainFrame', webContentsId?: number) =>
  ({ url, resourceType, webContentsId }) as unknown as OnBeforeRequestListenerDetails;
const hdr = (url: string) => ({ url }) as unknown as OnBeforeSendHeadersListenerDetails;

beforeEach(() => {
  settings = { ...DEFAULT_PRIVACY };
});

describe('https-only', () => {
  const f = filter('https-only');

  it('upgrades http to https', () => {
    expect(f.onBeforeRequest!(req('http://example.com/a?b=1'))).toEqual({ redirectURL: 'https://example.com/a?b=1' });
  });

  it('leaves https, local hosts and a disabled setting alone', () => {
    expect(f.onBeforeRequest!(req('https://example.com/'))).toBeUndefined();
    expect(f.onBeforeRequest!(req('http://localhost:5173/'))).toBeUndefined();
    expect(f.onBeforeRequest!(req('http://127.0.0.1/'))).toBeUndefined();
    expect(f.onBeforeRequest!(req('http://printer.local/'))).toBeUndefined();
    settings.httpsOnly = false;
    expect(f.onBeforeRequest!(req('http://example.com/'))).toBeUndefined();
  });
});

describe('tracker-block', () => {
  const f = filter('tracker-block');

  it('cancels tracker hosts and their subdomains', () => {
    expect(f.onBeforeRequest!(req('https://www.google-analytics.com/collect', 'xhr'))).toEqual({ cancel: true });
    expect(f.onBeforeRequest!(req('https://stats.g.doubleclick.net/x', 'image'))).toEqual({ cancel: true });
  });

  it('cancels Discord telemetry paths but not the rest of the API', () => {
    expect(f.onBeforeRequest!(req('https://discord.com/api/v9/science', 'xhr'))).toEqual({ cancel: true });
    expect(f.onBeforeRequest!(req('https://discord.com/api/v10/metrics', 'xhr'))).toEqual({ cancel: true });
    expect(f.onBeforeRequest!(req('https://discord.com/api/v9/users/@me', 'xhr'))).toBeUndefined();
  });

  it('does not match look-alike hosts, and respects the setting', () => {
    expect(f.onBeforeRequest!(req('https://notdoubleclick.net/', 'xhr'))).toBeUndefined();
    settings.blockTrackers = false;
    expect(f.onBeforeRequest!(req('https://www.google-analytics.com/collect', 'xhr'))).toBeUndefined();
  });
});

describe('strip-tracking-params', () => {
  const f = filter('strip-tracking-params');

  it('redirects frames to the cleaned URL', () => {
    const d = f.onBeforeRequest!(req('https://example.com/p?utm_source=x&id=7'));
    expect(d?.redirectURL).toBe('https://example.com/p?id=7');
    expect(f.onBeforeRequest!(req('https://example.com/p?utm_source=x', 'subFrame'))?.redirectURL).toBeDefined();
  });

  it('ignores clean URLs, subresources and a disabled setting', () => {
    expect(f.onBeforeRequest!(req('https://example.com/p?id=7'))).toBeUndefined();
    expect(f.onBeforeRequest!(req('https://example.com/p?utm_source=x', 'xhr'))).toBeUndefined();
    settings.stripTrackingParams = false;
    expect(f.onBeforeRequest!(req('https://example.com/p?utm_source=x'))).toBeUndefined();
  });
});

describe('global-privacy-control', () => {
  const f = filter('global-privacy-control');

  it('adds Sec-GPC only when enabled', () => {
    expect(f.onBeforeSendHeaders!(hdr('https://example.com/'), {})).toEqual({ 'Sec-GPC': '1' });
    settings.globalPrivacyControl = false;
    expect(f.onBeforeSendHeaders!(hdr('https://example.com/'), {})).toEqual({});
  });
});

describe('trim-referrer', () => {
  const f = filter('trim-referrer');

  it('trims cross-origin referrers to the origin', () => {
    const out = f.onBeforeSendHeaders!(hdr('https://other.example/x'), { Referer: 'https://site.example/secret/path?q=1' });
    expect(out['Referer']).toBe('https://site.example/');
  });

  it('keeps same-origin referrers, drops unparseable ones, and respects the setting', () => {
    const same = 'https://site.example/a/b';
    expect(f.onBeforeSendHeaders!(hdr('https://site.example/c'), { referer: same })['referer']).toBe(same);
    expect(f.onBeforeSendHeaders!(hdr('https://site.example/c'), { Referer: 'not a url' })).not.toHaveProperty('Referer');
    settings.trimReferrers = false;
    const cross = 'https://site.example/secret';
    expect(f.onBeforeSendHeaders!(hdr('https://other.example/'), { Referer: cross })['Referer']).toBe(cross);
  });
});

describe('google-sign-in-ua', () => {
  const chromeHeaders = {
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) Chrome/152.0.0.0 Safari/537.36',
    'sec-ch-ua': '"Chromium";v="152"',
    'sec-ch-ua-platform': '"Linux"',
    Accept: 'text/html',
  };

  it('sends a Firefox UA without client hints to accounts.google.com', () => {
    const out = googleSignInFilter.onBeforeSendHeaders!(hdr('https://accounts.google.com/signin'), { ...chromeHeaders });
    expect(out['User-Agent']).toMatch(/Firefox\//);
    expect(Object.keys(out).filter((k) => k.toLowerCase().startsWith('sec-ch-ua'))).toEqual([]);
    expect(out['Accept']).toBe('text/html');
  });

  it('leaves every other host untouched', () => {
    const out = googleSignInFilter.onBeforeSendHeaders!(hdr('https://www.youtube.com/'), { ...chromeHeaders });
    expect(out).toEqual(chromeHeaders);
  });
});

describe('https-only fallback hooks (ROADMAP 3.2)', () => {
  it('skips sites the user allowed over http, and notes main-frame upgrades only', () => {
    const upgrades: string[] = [];
    const f = buildShieldFilters(() => settings, {
      httpAllowed: (h) => h === 'neverssl.com',
      onUpgrade: (id, http, https) => upgrades.push(`${id} ${http} -> ${https}`),
    }).find((x) => x.name === 'https-only')!;
    expect(f.onBeforeRequest!(req('http://neverssl.com/', 'mainFrame', 7))).toBeUndefined();
    expect(f.onBeforeRequest!(req('http://example.com/a', 'mainFrame', 7))).toEqual({ redirectURL: 'https://example.com/a' });
    expect(f.onBeforeRequest!(req('http://example.com/img.png', 'image', 7))).toEqual({ redirectURL: 'https://example.com/img.png' });
    expect(upgrades).toEqual(['7 http://example.com/a -> https://example.com/a']);
  });
});

describe('httpsFallback', () => {
  it('maps a failed upgraded load back to its http address, per page', () => {
    noteUpgrade(1, 'http://neverssl.com/', 'https://neverssl.com/');
    expect(upgradedFrom(1, 'https://neverssl.com/')).toBe('http://neverssl.com/');
    expect(upgradedFrom(1, 'https://other.example/')).toBeUndefined();
    expect(upgradedFrom(2, 'https://neverssl.com/')).toBeUndefined();
    forgetPage(1);
    expect(upgradedFrom(1, 'https://neverssl.com/')).toBeUndefined();
  });

  it('treats connection, TLS, certificate and timeout errors as "no https", not DNS or aborts', () => {
    for (const code of [-7, -100, -102, -107, -118, -200, -202, -324]) expect(isFallbackError(code)).toBe(true);
    for (const code of [-3, -105, -300, -2, 0]) expect(isFallbackError(code)).toBe(false);
  });

  it('remembers allowed sites for this run, case-insensitively, until the next save', () => {
    allowHttpThisRun('NeverSSL.com');
    expect(isHttpAllowedThisRun('neverssl.com')).toBe(true);
    expect(isHttpAllowedThisRun('random.neverssl.com')).toBe(true); // subdomains too
    expect(isHttpAllowedThisRun('notneverssl.com')).toBe(false);
    expect(isHttpAllowedThisRun('example.com')).toBe(false);
    clearHttpAllowedThisRun();
    expect(isHttpAllowedThisRun('neverssl.com')).toBe(false);
  });
});
