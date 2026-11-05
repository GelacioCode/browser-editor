import type { TrackKind } from '@viditor/project-core';

export const HEADER_W = 148;
export const RULER_H = 26;

export const TRACK_HEIGHT: Record<TrackKind, number> = {
  video: 60,
  audio: 46,
  text: 30,
  caption: 30,
};

export const SNAP_PX = 8;
export const EDGE_PX = 7;

export interface Viewport {
  scrollLeft: number;
  width: number;
}

/** Choose a ruler tick interval (seconds) so that labels are at least `minPx` apart. */
export function tickInterval(
  pxPerSecond: number,
  fps: number,
  minPx = 80,
): { major: number; minor: number } {
  const steps = [
    1 / fps,
    2 / fps,
    5 / fps,
    10 / fps,
    0.5,
    1,
    2,
    5,
    10,
    15,
    30,
    60,
    120,
    300,
    600,
    1800,
    3600,
  ];
  const major = steps.find((s) => s * pxPerSecond >= minPx) ?? 3600;
  const minorDiv = major >= 1 ? (major % 5 === 0 ? 5 : major % 2 === 0 ? 4 : 2) : 2;
  return { major, minor: major / minorDiv };
}

export function formatRulerLabel(seconds: number, major: number, fps: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const base = `${m}:${String(s).padStart(2, '0')}`;
  if (major < 1) {
    const f = Math.round((seconds - Math.floor(seconds)) * fps);
    return f === 0 ? base : `${f}f`;
  }
  return base;
}
