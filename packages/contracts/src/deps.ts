/** Re-exports from project-core used by the contracts (one place to see the dependency surface). */
export {
  ProjectEngine,
  OperationSchema,
  DEFAULT_TITLE_STYLE,
  TRACK_ACCEPTS,
  beatFrames,
  clipEnd,
  framesToSourceUs,
  isTimedMediaClip,
  slipRangeUs,
  sourceUsToTimelineFrame,
  templateSlots,
  clipsAt,
  findMedia,
  findOverlap,
  frameToSeconds,
  fpsToNumber,
  maxFramesFrom,
  newId,
  secondsToNearestFrame,
  secondsToUs,
  sequenceDuration,
  trackKindForClip,
  usToSeconds,
  type ApplyResult,
  type Clip,
  type MediaItem,
  type SlotClip,
  type TimedMediaClip,
  type Operation,
  type Project,
  type TextStyle,
  type Transform,
} from '@viditor/project-core';

/** Linear gain → dB, clamped at -60 dB so JSON never contains -Infinity. */
export function gainToDbSafe(gain: number): number {
  return gain <= 0.001 ? -60 : 20 * Math.log10(gain);
}

export function dbToGain(db: number): number {
  return db <= -60 ? 0 : Math.pow(10, db / 20);
}
