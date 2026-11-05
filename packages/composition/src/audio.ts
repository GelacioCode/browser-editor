import { frameToSeconds, type Rational, type TimedMediaClip } from '@viditor/project-core';

/**
 * Linear fade envelope (0..1) at `frame` (timeline frames, may be fractional).
 * Shared by preview gain updates and export gain automation.
 */
export function fadeEnvelope(clip: TimedMediaClip, frame: number): number {
  const local = frame - clip.start;
  if (local < 0 || local > clip.duration) return 0;
  let v = 1;
  if (clip.audio.fadeIn > 0 && local < clip.audio.fadeIn)
    v = Math.min(v, local / clip.audio.fadeIn);
  const remaining = clip.duration - local;
  if (clip.audio.fadeOut > 0 && remaining < clip.audio.fadeOut)
    v = Math.min(v, remaining / clip.audio.fadeOut);
  return Math.max(0, Math.min(1, v));
}

/** Effective linear gain at `frame`. */
export function clipGainAt(clip: TimedMediaClip, frame: number): number {
  if (clip.audio.mute) return 0;
  return clip.audio.gain * fadeEnvelope(clip, frame);
}

export interface GainPoint {
  /** Seconds on the timeline. */
  time: number;
  value: number;
}

/**
 * Gain automation breakpoints for a clip (linear ramps between points), in timeline seconds.
 * Export schedules these on a GainNode with linearRampToValueAtTime.
 */
export function gainAutomation(clip: TimedMediaClip, fps: Rational): GainPoint[] {
  const g = clip.audio.mute ? 0 : clip.audio.gain;
  const t = (f: number) => frameToSeconds(f, fps);
  const start = clip.start;
  const end = clip.start + clip.duration;
  const pts: GainPoint[] = [];
  pts.push({ time: t(start), value: clip.audio.fadeIn > 0 ? 0 : g });
  if (clip.audio.fadeIn > 0) pts.push({ time: t(start + clip.audio.fadeIn), value: g });
  if (clip.audio.fadeOut > 0) {
    pts.push({ time: t(end - clip.audio.fadeOut), value: g });
    pts.push({ time: t(end), value: 0 });
  } else {
    pts.push({ time: t(end), value: g });
  }
  return pts;
}

export function gainToDb(gain: number): number {
  return gain <= 0 ? -Infinity : 20 * Math.log10(gain);
}

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}
