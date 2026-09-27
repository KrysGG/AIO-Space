import { describe, expect, it } from 'vitest';
import {
  defaultWorkspace,
  forgetExtension,
  migrateWorkspace,
  setExtensionEnabled,
} from '../src/workspace/workspace';

describe('extensions per app (ROADMAP 4.5)', () => {
  it('turns extensions on and off per app; removing one turns it off everywhere', () => {
    let ws = setExtensionEnabled(defaultWorkspace(), 'youtube', 'ext-a', true);
    ws = setExtensionEnabled(ws, 'twitch', 'ext-a', true);
    ws = setExtensionEnabled(ws, 'youtube', 'ext-b', true);
    expect(ws.extensions).toEqual({ youtube: ['ext-a', 'ext-b'], twitch: ['ext-a'] });
    expect(setExtensionEnabled(ws, 'youtube', 'ext-a', true)).toBe(ws);
    expect(forgetExtension(ws, 'ext-a').extensions).toEqual({ youtube: ['ext-b'] });
    expect(
      setExtensionEnabled(setExtensionEnabled(defaultWorkspace(), 'x', 'e', true), 'x', 'e', false)
        .extensions,
    ).toEqual({});
  });

  it('v16 workspaces start with none', () => {
    const v16: Record<string, unknown> = { ...defaultWorkspace(), version: 16 };
    delete v16['extensions'];
    expect(migrateWorkspace(v16).extensions).toEqual({});
  });
});
