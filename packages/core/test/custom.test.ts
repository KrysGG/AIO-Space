import { describe, expect, it } from 'vitest';
import { makeCustomApp, siteDomain } from '../src/catalog/custom';
import { hostMatches } from '../src/catalog/apps';
import { defaultWorkspace, migrateWorkspace, WORKSPACE_VERSION } from '../src/workspace/workspace';

describe('siteDomain', () => {
  it('takes the site’s own domain from a host', () => {
    expect(siteDomain('web.whatsapp.com')).toBe('whatsapp.com');
    expect(siteDomain('notion.so')).toBe('notion.so');
    expect(siteDomain('news.bbc.co.uk')).toBe('bbc.co.uk');
    expect(siteDomain('app.example.com.au')).toBe('example.com.au');
  });
});

describe('makeCustomApp', () => {
  it('builds an app from a name and address, with safe defaults', () => {
    const r = makeCustomApp({ name: 'WhatsApp Web', url: 'web.whatsapp.com' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.app).toMatchObject({ name: 'WhatsApp Web', url: 'https://web.whatsapp.com/', kind: 'app', allowedHosts: ['whatsapp.com'], permissions: [], glyph: 'WW' });
    expect(r.app.id).toMatch(/^custom-whatsapp-web-[a-z0-9]{6}$/);
    expect(hostMatches('web.whatsapp.com', r.app.allowedHosts)).toBe(true);
    expect(r.app.popupHosts).toContain('accounts.google.com');
  });

  it('uses the allowed sites and permissions given, and always allows the start page', () => {
    const r = makeCustomApp({ name: 'Mail', url: 'https://mail.proton.me/u/0', allowedHosts: 'account.proton.me, *.protonmail.com', permissions: ['notifications', 'notifications'] });
    expect(r.ok && r.app.allowedHosts).toEqual(['mail.proton.me', 'account.proton.me', 'protonmail.com']);
    expect(r.ok && r.app.permissions).toEqual(['notifications']);
  });

  it('refuses non-https, wildcards, bad names and bad hosts with a helpful message', () => {
    const err = (i: Parameters<typeof makeCustomApp>[0]) => {
      const r = makeCustomApp(i);
      return r.ok ? null : r.error;
    };
    expect(err({ name: 'X', url: 'http://example.com' })).toMatch(/https/);
    expect(err({ name: 'X', url: 'javascript:alert(1)' })).toMatch(/https/);
    expect(err({ name: 'X', url: 'file:///etc/passwd' })).toMatch(/https/);
    expect(err({ name: '', url: 'example.com' })).toMatch(/name/);
    expect(err({ name: 'X'.repeat(41), url: 'example.com' })).toMatch(/40/);
    expect(err({ name: 'X', url: 'not a site' })).toBeTruthy();
    expect(err({ name: 'X', url: 'example.com', allowedHosts: '*' })).toMatch(/isn’t a site name/);
    expect(err({ name: 'X', url: 'example.com', allowedHosts: 'good.com, bad_host' })).toMatch(/bad_host/);
  });
});

describe('workspace v4', () => {
  it('starts with no custom apps and migrates v3 by adding an empty list', () => {
    expect(defaultWorkspace().customApps).toEqual([]);
    const v3: Record<string, unknown> = { ...defaultWorkspace(), version: 3 };
    delete v3['customApps'];
    const out = migrateWorkspace(v3);
    expect(out.version).toBe(WORKSPACE_VERSION);
    expect(out.customApps).toEqual([]);
  });
});
