import { describe, expect, it } from 'vitest';
import { nextZoom, zoomLabel } from '../src/apps/zoom';
import { defaultWorkspace, migrateWorkspace, WORKSPACE_VERSION } from '../src/workspace/workspace';

describe('nextZoom', () => {
  it('steps like Chrome', () => {
    expect(nextZoom(1, 'in')).toBe(1.1);
    expect(nextZoom(1.1, 'in')).toBe(1.25);
    expect(nextZoom(1, 'out')).toBe(0.9);
    expect(nextZoom(0.9, 'out')).toBe(0.8);
    expect(nextZoom(1.75, 'reset')).toBe(1);
  });

  it('snaps from in-between values and stops at the ends', () => {
    expect(nextZoom(1.03, 'in')).toBe(1.1);
    expect(nextZoom(1.03, 'out')).toBe(1);
    expect(nextZoom(5, 'in')).toBe(5);
    expect(nextZoom(0.25, 'out')).toBe(0.25);
  });

  it('labels as a percentage', () => {
    expect(zoomLabel(1.1)).toBe('110%');
    expect(zoomLabel(0.67)).toBe('67%');
  });
});

describe('workspace v6 (zoom)', () => {
  it('starts empty and migrates v5', () => {
    expect(defaultWorkspace().zoom).toEqual({});
    const v5: Record<string, unknown> = { ...defaultWorkspace(), version: 5 };
    delete v5['zoom'];
    const out = migrateWorkspace(v5);
    expect(out.version).toBe(WORKSPACE_VERSION);
    expect(out.zoom).toEqual({});
  });
});
