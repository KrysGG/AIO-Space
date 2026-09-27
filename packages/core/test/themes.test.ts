import { describe, expect, it } from 'vitest';
import {
  BUILTIN_THEMES,
  isThemeColor,
  parseThemeFile,
  resolveTheme,
  SYSTEM_THEME,
  THEME_KEYS,
} from '../src/ui/themes';
import { defaultWorkspace, migrateWorkspace, WORKSPACE_VERSION } from '../src/workspace/workspace';

describe('themes (ROADMAP 4.1)', () => {
  it('built-ins set every colour, with valid values', () => {
    for (const t of BUILTIN_THEMES)
      for (const k of THEME_KEYS) expect(isThemeColor(t.colors[k]), `${t.id}.${k}`).toBe(true);
  });

  it('follows the system by default, and falls back to Dark for an unknown id', () => {
    expect(defaultWorkspace().ui.theme).toBe(SYSTEM_THEME);
    expect(resolveTheme(SYSTEM_THEME, [], true).id).toBe('dark');
    expect(resolveTheme(SYSTEM_THEME, [], false).id).toBe('light');
    expect(resolveTheme('high-contrast', [], false).id).toBe('high-contrast');
    expect(resolveTheme('user-gone', [], false).id).toBe('dark');
  });

  it('accepts colours only: no url(), no escaping the declaration', () => {
    for (const ok of [
      '#fff',
      '#1c2230',
      '#1c2230cc',
      'rgb(1 2 3 / 0.5)',
      'rgba(1,2,3,0.5)',
      'hsl(210 20% 30%)',
    ])
      expect(isThemeColor(ok), ok).toBe(true);
    for (const bad of [
      'red',
      'url(https://x.test/a.png)',
      '#fff; background: url(x)',
      'rgb(1 2 3) }',
      'var(--x)',
      'expression(1)',
      42,
    ]) {
      expect(isThemeColor(bad), String(bad)).toBe(false);
    }
  });

  it('imports a theme file, filling missing colours from its scheme and picking a free id', () => {
    const res = parseThemeFile(
      JSON.stringify({ name: '  My   Night ', colors: { ink: '#000000', nope: '#fff' } }),
      ['user-my-night'],
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.theme).toMatchObject({ id: 'user-my-night-2', name: 'My Night', scheme: 'dark' });
    expect(res.theme.colors.ink).toBe('#000000');
    expect(res.theme.colors.text).toBe(BUILTIN_THEMES[0]!.colors.text);
    const light = parseThemeFile(
      JSON.stringify({ name: 'Day', scheme: 'light', colors: { text: '#111' } }),
      [],
    );
    expect(light.ok && light.theme.colors.ink).toBe(BUILTIN_THEMES[1]!.colors.ink);
  });

  it('rejects files that are not themes, with a reason', () => {
    for (const text of [
      'nope',
      '[]',
      '{"colors":{"ink":"#000"}}',
      '{"name":"x"}',
      '{"name":"x","colors":{}}',
      '{"name":"x","colors":{"ink":"url(a)"}}',
    ]) {
      const res = parseThemeFile(text, []);
      expect(res.ok, text).toBe(false);
      if (!res.ok) expect(res.error.length).toBeGreaterThan(10);
    }
  });

  it('migrates v16 workspaces', () => {
    const v16: Record<string, unknown> = {
      ...defaultWorkspace(),
      version: 16,
      ui: { railCollapsed: true, reduceMotion: false },
    };
    delete v16['themes'];
    const out = migrateWorkspace(v16);
    expect(out.version).toBe(WORKSPACE_VERSION);
    expect(out.ui).toEqual({ railCollapsed: true, reduceMotion: false, theme: SYSTEM_THEME });
    expect(out.themes).toEqual([]);
  });
});
