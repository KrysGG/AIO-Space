/**
 * Themes (ROADMAP 4.1): a theme is a set of values for the UI's colour variables (styles.css).
 * Built-ins: dark, light, high contrast. Users can import their own as JSON:
 *
 *   { "name": "Nord", "scheme": "dark", "colors": { "ink": "#2e3440", "text": "#eceff4", ... } }
 *
 * Colours not given fall back to the built-in theme of the same scheme. Values are colours only
 * (hex, rgb(), hsl()): they end up in CSS, so nothing like url() or `;` can get through.
 */

/** Colour variables a theme sets; each is `--<key>` in styles.css. */
export const THEME_KEYS = [
  'ink', // window background, gutters
  'rail', // sidebar
  'tile', // tile header / placeholder
  'line', // hairlines
  'text',
  'text-strong', // focused tile title
  'muted',
  'focus', // accents + keyboard focus
  'focus-ring', // focused tile outline
  'glass-fill', // popovers and menus
  'hl', // highlight overlays (hover, sheen); mixed in at low strength
  'warn',
  'warn-text',
  'danger',
  'danger-text',
  'badge', // unread count
] as const;
export type ThemeKey = (typeof THEME_KEYS)[number];
export type ThemeColors = Record<ThemeKey, string>;
export type ColorScheme = 'dark' | 'light';

export interface Theme {
  id: string;
  name: string;
  scheme: ColorScheme;
  colors: ThemeColors;
}

/** The workspace's choice: follow the system's light/dark setting, or a theme id. */
export const SYSTEM_THEME = 'system';
export const MAX_USER_THEMES = 20;
export const MAX_THEME_NAME = 40;

const DARK: Theme = {
  id: 'dark',
  name: 'Dark',
  scheme: 'dark',
  colors: {
    ink: '#161b26',
    rail: '#1c2231',
    tile: '#212939',
    line: '#2e384d',
    text: '#e4e8f0',
    'text-strong': '#ffffff',
    muted: '#8f9ab0',
    focus: '#e6e9ef',
    'focus-ring': 'rgb(255 255 255 / 0.55)',
    'glass-fill': 'rgb(24 29 42 / 0.74)',
    hl: '#ffffff',
    warn: '#e8793b',
    'warn-text': '#f3a574',
    danger: '#f08a8a',
    'danger-text': '#f3a0a0',
    badge: '#e53e3e',
  },
};

const LIGHT: Theme = {
  id: 'light',
  name: 'Light',
  scheme: 'light',
  colors: {
    ink: '#e7eaf0',
    rail: '#f3f5f8',
    tile: '#fbfcfd',
    line: '#d3d8e2',
    text: '#1c2230',
    'text-strong': '#000000',
    muted: '#5d6780',
    focus: '#2b3446',
    'focus-ring': 'rgb(20 26 40 / 0.5)',
    'glass-fill': 'rgb(250 251 253 / 0.8)',
    hl: '#1c2230',
    warn: '#c05412',
    'warn-text': '#a4460c',
    danger: '#c53030',
    'danger-text': '#b02a2a',
    badge: '#d42f2f',
  },
};

const HIGH_CONTRAST: Theme = {
  id: 'high-contrast',
  name: 'High contrast',
  scheme: 'dark',
  colors: {
    ink: '#000000',
    rail: '#000000',
    tile: '#0a0a0a',
    line: '#ffffff',
    text: '#ffffff',
    'text-strong': '#ffff00',
    muted: '#d0d0d0',
    focus: '#ffff00',
    'focus-ring': '#ffff00',
    'glass-fill': 'rgb(0 0 0 / 0.96)',
    hl: '#ffffff',
    warn: '#ffb000',
    'warn-text': '#ffc940',
    danger: '#ff6b6b',
    'danger-text': '#ff8c8c',
    badge: '#ff0000',
  },
};

export const BUILTIN_THEMES: Theme[] = [DARK, LIGHT, HIGH_CONTRAST];

/** Hex, rgb()/rgba() or hsl()/hsla() with plain numbers only. */
export function isThemeColor(v: unknown): v is string {
  return (
    typeof v === 'string' &&
    v.length <= 40 &&
    (/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v) ||
      /^(rgb|rgba|hsl|hsla)\([0-9.,%\s/]+\)$/i.test(v))
  );
}

/** The theme to show: `choice` is a theme id or 'system' (light or dark to match the desktop). */
export function resolveTheme(choice: string, userThemes: Theme[], systemDark: boolean): Theme {
  if (choice === SYSTEM_THEME) return systemDark ? DARK : LIGHT;
  return [...BUILTIN_THEMES, ...userThemes].find((t) => t.id === choice) ?? DARK;
}

/**
 * Read a theme file the user picked. Unknown keys are ignored; missing colours come from the
 * built-in theme of the same scheme. Returns a theme with a new `user-...` id not in `takenIds`.
 */
export function parseThemeFile(
  text: string,
  takenIds: string[],
): { ok: true; theme: Theme } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'This file isn’t valid JSON. Pick a theme file (.json).' };
  }
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'This file isn’t a theme.' };
  const r = raw as Record<string, unknown>;
  const name =
    typeof r['name'] === 'string'
      ? r['name'].trim().replace(/\s+/g, ' ').slice(0, MAX_THEME_NAME)
      : '';
  if (!name) return { ok: false, error: 'The theme needs a "name".' };
  const scheme: ColorScheme = r['scheme'] === 'light' ? 'light' : 'dark';
  const given =
    r['colors'] && typeof r['colors'] === 'object'
      ? (r['colors'] as Record<string, unknown>)
      : null;
  if (!given) return { ok: false, error: 'The theme needs "colors", e.g. { "ink": "#101418" }.' };
  const base = scheme === 'light' ? LIGHT : DARK;
  const colors = { ...base.colors };
  let used = 0;
  for (const key of THEME_KEYS) {
    const v = given[key];
    if (v === undefined) continue;
    if (!isThemeColor(v))
      return { ok: false, error: `"${key}" isn’t a colour. Use hex (#1c2230), rgb() or hsl().` };
    colors[key] = v;
    used++;
  }
  if (used === 0)
    return {
      ok: false,
      error: `No known colours. Use keys like ${THEME_KEYS.slice(0, 4).join(', ')}.`,
    };
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 30) || 'theme';
  let id = `user-${slug}`;
  for (let n = 2; takenIds.includes(id); n++) id = `user-${slug}-${n}`;
  return { ok: true, theme: { id, name, scheme, colors } };
}
