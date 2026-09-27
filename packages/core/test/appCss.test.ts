import { describe, expect, it } from 'vitest';
import { defaultWorkspace, MAX_APP_CSS, setAppCss } from '../src/workspace/workspace';

describe('custom CSS per app (ROADMAP 4.3)', () => {
  it('stores CSS with its on/off switch, capped; empty CSS removes the entry', () => {
    let ws = setAppCss(defaultWorkspace(), 'reddit', {
      css: 'aside { display: none }',
      enabled: true,
    });
    expect(ws.appCss['reddit']).toEqual({ css: 'aside { display: none }', enabled: true });
    ws = setAppCss(ws, 'reddit', { css: 'aside { display: none }', enabled: false });
    expect(ws.appCss['reddit']!.enabled).toBe(false);
    expect(
      setAppCss(ws, 'x', { css: 'a'.repeat(MAX_APP_CSS + 10), enabled: true }).appCss['x']!.css,
    ).toHaveLength(MAX_APP_CSS);
    expect(setAppCss(ws, 'reddit', { css: '  \n', enabled: true }).appCss).toEqual({});
  });
});
