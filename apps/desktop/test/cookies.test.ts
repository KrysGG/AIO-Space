import { describe, expect, it } from 'vitest';
import type { OnBeforeSendHeadersListenerDetails, OnHeadersReceivedListenerDetails } from 'electron';
import { DEFAULT_PRIVACY, getApp, type PrivacySettings } from '@aio/core';
import { buildShieldFilters } from '../src/main/privacy/shields';
import { appSites, siteOf } from '../src/main/privacy/sites';

describe('siteOf / appSites', () => {
  it('reduces hosts to their site', () => {
    expect(siteOf('cdn.discordapp.com')).toBe('discordapp.com');
    expect(siteOf('news.bbc.co.uk')).toBe('bbc.co.uk');
    expect(siteOf('foo.github.io')).toBe('foo.github.io'); // private suffix: each user site is separate
    expect(siteOf('127.0.0.1')).toBe('127.0.0.1');
    expect(siteOf('LOCALHOST')).toBe('localhost');
  });

  it("collects an app's own sites, including sign-in popups; none for the Browser", () => {
    expect([...appSites(getApp('discord')!)!].sort()).toEqual(['discord.com', 'discord.gg', 'discordapp.com']);
    expect(appSites(getApp('youtube')!)!.has('google.com')).toBe(true);
    expect(appSites(getApp('reddit')!)!.has('google.com')).toBe(true); // Sign in with Google
    expect(appSites(getApp('browser')!)).toBeNull();
  });
});

describe('third-party-cookies filter', () => {
  let settings: PrivacySettings = { ...DEFAULT_PRIVACY };
  const tops: Record<number, string> = { 1: 'https://www.reddit.com/r/linux', 2: 'https://example.com/', 3: 'https://discord.com/app' };
  const make = (appId: string) =>
    buildShieldFilters(() => settings, undefined, { appSites: appSites(getApp(appId)!), topUrl: (id) => tops[id] }).find((f) => f.name === 'third-party-cookies')!;
  const send = (url: string, webContentsId: number, resourceType = 'script') =>
    ({ url, webContentsId, resourceType }) as unknown as OnBeforeSendHeadersListenerDetails;
  const recv = (url: string, webContentsId: number, resourceType = 'subFrame') =>
    ({ url, webContentsId, resourceType }) as unknown as OnHeadersReceivedListenerDetails;
  const cookieHdr = { Cookie: 'a=1', Accept: '*/*' };
  const setCookieHdr = { 'Set-Cookie': ['t=1'], 'Content-Type': ['text/html'] };

  it('strips cookies both ways for a third-party request', () => {
    const f = make('browser');
    expect(f.onBeforeSendHeaders!(send('https://tracker.example.net/p.js', 2), cookieHdr)).toEqual({ Accept: '*/*' });
    expect(f.onHeadersReceived!(recv('https://tracker.example.net/frame', 2), setCookieHdr)).toEqual({ 'Content-Type': ['text/html'] });
  });

  it('keeps cookies for the page’s own site, its subdomains, and page loads', () => {
    const f = make('browser');
    expect(f.onBeforeSendHeaders!(send('https://cdn.example.com/x.js', 2), cookieHdr)).toBe(cookieHdr);
    expect(f.onBeforeSendHeaders!(send('https://elsewhere.org/', 2, 'mainFrame'), cookieHdr)).toBe(cookieHdr);
  });

  it("keeps cookies for the app's own sites: Discord <-> discordapp.com, Reddit <-> Google sign-in", () => {
    expect(make('discord').onBeforeSendHeaders!(send('https://cdn.discordapp.com/x', 3), cookieHdr)).toBe(cookieHdr);
    expect(make('reddit').onHeadersReceived!(recv('https://accounts.google.com/gsi/iframe', 1), setCookieHdr)).toBe(setCookieHdr);
    expect(make('reddit').onBeforeSendHeaders!(send('https://ads.doubleclick.net/x', 1), cookieHdr)).toEqual({ Accept: '*/*' });
  });

  it('fails open when the top page is unknown, and respects the setting', () => {
    const f = make('browser');
    expect(f.onBeforeSendHeaders!(send('https://tracker.example.net/p.js', 99), cookieHdr)).toBe(cookieHdr);
    settings = { ...DEFAULT_PRIVACY, blockThirdPartyCookies: false };
    expect(f.onBeforeSendHeaders!(send('https://tracker.example.net/p.js', 2), cookieHdr)).toBe(cookieHdr);
    settings = { ...DEFAULT_PRIVACY };
  });

  it('matches header names case-insensitively', () => {
    const f = make('browser');
    expect(f.onBeforeSendHeaders!(send('https://t.example.net/', 2), { cookie: 'a=1' })).toEqual({});
    expect(f.onHeadersReceived!(recv('https://t.example.net/', 2), { 'set-cookie': ['a=1'] })).toEqual({});
  });

});
