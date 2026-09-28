import { describe, expect, it } from 'vitest';
import { BUILTIN_APPS, getApp, makeCustomApp } from '@aio/core';
import { navigationDecision, popupNavigationDecision, windowDecision } from '../src/main/views/navigationPolicy';

const twitch = getApp('twitch', BUILTIN_APPS)!;
const browser = getApp('browser', BUILTIN_APPS)!;
const custom = (() => {
  const r = makeCustomApp({ name: 'Notion', url: 'https://www.notion.so/' });
  if (!r.ok) throw new Error(r.error);
  return r.app;
})();

describe('navigation policy (D-044)', () => {
  it('keeps apps on their own sites and sends other links out (to a Browser tile, D-065)', () => {
    expect(navigationDecision(twitch, 'https://www.twitch.tv/somechannel')).toBe('allow');
    expect(navigationDecision(twitch, 'https://example.com/')).toBe('external');
    expect(navigationDecision(twitch, 'javascript:alert(1)')).toBe('block');
    expect(navigationDecision(twitch, 'file:///etc/passwd')).toBe('block');
  });

  it('lets a full-page "Continue with Google/Apple/Microsoft" stay in the app (the reported bug)', () => {
    for (const url of [
      'https://accounts.google.com/o/oauth2/v2/auth?client_id=x',
      'https://accounts.youtube.com/accounts/SetSID',
      'https://appleid.apple.com/auth/authorize?x=1',
      'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    ]) {
      expect(navigationDecision(twitch, url), url).toBe('allow');
      expect(navigationDecision(custom, url), url).toBe('allow');
    }
    // Only the sign-in pages, not the rest of those companies' sites.
    expect(navigationDecision(twitch, 'https://www.google.com/search?q=x')).toBe('external');
    expect(navigationDecision(twitch, 'https://www.apple.com/')).toBe('external');
  });

  it('opens sign-in popups in the app, including ones that start blank', () => {
    expect(windowDecision(twitch, 'about:blank', 'new-window')).toBe('popup');
    expect(windowDecision(twitch, '', 'new-window')).toBe('popup');
    expect(windowDecision(twitch, 'about:blank', 'foreground-tab')).toBe('deny');
    expect(windowDecision(twitch, 'https://accounts.google.com/gsi/select?x', 'new-window')).toBe('popup');
    expect(windowDecision(custom, 'https://appleid.apple.com/auth/authorize', 'new-window')).toBe('popup');
    expect(windowDecision(twitch, 'https://www.twitch.tv/videos/1', 'foreground-tab')).toBe('same-tile');
    expect(windowDecision(twitch, 'https://www.twitch.tv/login', 'new-window')).toBe('popup'); // its own login window
    expect(windowDecision(twitch, 'https://example.com/', 'foreground-tab')).toBe('external');
    expect(windowDecision(twitch, 'javascript:void(0)', 'new-window')).toBe('deny');
  });

  it('Browser tile: new tabs become tiles, scripted windows stay popups', () => {
    expect(windowDecision(browser, 'https://example.com/', 'foreground-tab')).toBe('new-tile');
    expect(windowDecision(browser, 'https://example.com/', 'background-tab')).toBe('new-tile');
    expect(windowDecision(browser, 'https://accounts.google.com/', 'new-window')).toBe('popup');
    expect(windowDecision(browser, 'https://example.com/', 'default')).toBe('same-tile');
  });

  it('popups may only show web pages', () => {
    expect(popupNavigationDecision('https://accounts.google.com/signin')).toBe('allow');
    expect(popupNavigationDecision('about:blank')).toBe('allow');
    expect(popupNavigationDecision('file:///etc/passwd')).toBe('block');
    expect(popupNavigationDecision('javascript:alert(1)')).toBe('block');
  });
});
