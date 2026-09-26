/** Chrome's zoom steps, so +/- feel familiar (ROADMAP 2.10). */
export const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5] as const;
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 5;

export type ZoomChange = 'in' | 'out' | 'reset';

/** The next zoom factor from `current` (which may sit between steps, e.g. after a pinch). */
export function nextZoom(current: number, change: ZoomChange): number {
  if (change === 'reset') return 1;
  const eps = 0.001;
  if (change === 'in') return ZOOM_STEPS.find((z) => z > current + eps) ?? MAX_ZOOM;
  return [...ZOOM_STEPS].reverse().find((z) => z < current - eps) ?? MIN_ZOOM;
}

/** "110%" */
export function zoomLabel(factor: number): string {
  return `${Math.round(factor * 100)}%`;
}
