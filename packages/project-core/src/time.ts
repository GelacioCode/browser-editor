/**
 * Time model
 * - Timeline positions/durations: integer frames at the sequence frame rate.
 * - Source positions: integer microseconds (the WebCodecs time base).
 * - Frame rates are rationals (e.g. 30000/1001).
 */

export interface Rational {
  num: number;
  den: number;
}

export const US_PER_SECOND = 1_000_000;

export function fpsToNumber(fps: Rational): number {
  return fps.num / fps.den;
}

/** Exact timeline time in seconds for a frame index. */
export function frameToSeconds(frame: number, fps: Rational): number {
  return (frame * fps.den) / fps.num;
}

/** Microseconds for a frame index (rounded to integer µs). */
export function frameToUs(frame: number, fps: Rational): number {
  return Math.round((frame * fps.den * US_PER_SECOND) / fps.num);
}

/** Frame index containing time t (floor, with a small epsilon for float noise). */
export function secondsToFrame(seconds: number, fps: Rational): number {
  return Math.floor((seconds * fps.num) / fps.den + 1e-6);
}

/** Nearest frame for a time in seconds. */
export function secondsToNearestFrame(seconds: number, fps: Rational): number {
  return Math.round((seconds * fps.num) / fps.den);
}

export function usToSeconds(us: number): number {
  return us / US_PER_SECOND;
}

export function secondsToUs(seconds: number): number {
  return Math.round(seconds * US_PER_SECOND);
}

/** Duration of `frames` timeline frames, in microseconds of source time, at the given speed. */
export function framesToSourceUs(frames: number, fps: Rational, speed: number): number {
  return Math.round((frames * fps.den * US_PER_SECOND * speed) / fps.num);
}

/** How many whole timeline frames a source span (µs) occupies at the given speed. */
export function sourceUsToFrames(us: number, fps: Rational, speed: number): number {
  // +0.5 µs compensates for the rounding done in framesToSourceUs, so round-trips are exact.
  return Math.floor(((us + 0.5) * fps.num) / (fps.den * US_PER_SECOND * speed) + 1e-9);
}

/** Format a frame as HH:MM:SS:FF (non-drop-frame display). */
export function formatTimecode(frame: number, fps: Rational): string {
  const rate = Math.round(fpsToNumber(fps));
  const totalSeconds = Math.floor(frameToSeconds(frame, fps));
  const ff = frame - secondsToNearestFrame(totalSeconds, fps);
  const s = totalSeconds % 60;
  const m = Math.floor(totalSeconds / 60) % 60;
  const h = Math.floor(totalSeconds / 3600);
  const pad = (n: number) => String(Math.max(0, n)).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}:${pad(Math.min(ff, rate - 1))}`;
}

/** Short m:ss.t display */
export function formatShort(frame: number, fps: Rational): string {
  const t = frameToSeconds(frame, fps);
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

export const COMMON_FRAME_RATES: { label: string; fps: Rational }[] = [
  { label: '24', fps: { num: 24, den: 1 } },
  { label: '25', fps: { num: 25, den: 1 } },
  { label: '29.97', fps: { num: 30000, den: 1001 } },
  { label: '30', fps: { num: 30, den: 1 } },
  { label: '50', fps: { num: 50, den: 1 } },
  { label: '60', fps: { num: 60, den: 1 } },
];
