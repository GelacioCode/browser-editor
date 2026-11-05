import type { Rational } from './time.ts';
import { framesToSourceUs, sourceUsToFrames } from './time.ts';
import type {
  Clip,
  MediaItem,
  Project,
  TextLikeClip,
  TimedMediaClip,
  Track,
  VisualClip,
} from './schema.ts';

/** Pure read helpers shared by the engine, UI, preview and export. */

export function clipEnd(clip: Pick<Clip, 'start' | 'duration'>): number {
  return clip.start + clip.duration;
}

export function isTimedMediaClip(clip: Clip): clip is TimedMediaClip {
  return clip.kind === 'video' || clip.kind === 'audio';
}

export function isTextLike(clip: Clip): clip is TextLikeClip {
  return clip.kind === 'text' || clip.kind === 'caption';
}

export function isVisual(clip: Clip): clip is VisualClip {
  return clip.kind !== 'audio';
}

export function hasMedia(clip: Clip): clip is Extract<Clip, { mediaId: string }> {
  return 'mediaId' in clip;
}

export function findClip(project: Project, clipId: string): Clip | undefined {
  return project.clips.find((c) => c.id === clipId);
}

export function findTrack(project: Project, trackId: string): Track | undefined {
  return project.tracks.find((t) => t.id === trackId);
}

export function findMedia(project: Project, mediaId: string): MediaItem | undefined {
  return project.media.find((m) => m.id === mediaId);
}

export function clipsOnTrack(project: Project, trackId: string): Clip[] {
  return project.clips.filter((c) => c.trackId === trackId).sort((a, b) => a.start - b.start);
}

/** Returns the first clip on `trackId` overlapping [start, start+duration), ignoring `ignoreIds`. */
export function findOverlap(
  project: Project,
  trackId: string,
  start: number,
  duration: number,
  ignoreIds: readonly string[] = [],
): Clip | undefined {
  const end = start + duration;
  return project.clips.find(
    (c) =>
      c.trackId === trackId && !ignoreIds.includes(c.id) && c.start < end && clipEnd(c) > start,
  );
}

/** Total sequence length in frames (end of the last clip). */
export function sequenceDuration(project: Project): number {
  let max = 0;
  for (const c of project.clips) max = Math.max(max, clipEnd(c));
  return max;
}

/** Source time (µs) shown at timeline `frame` for a timed media clip. */
export function sourceTimeAt(clip: TimedMediaClip, frame: number, fps: Rational): number {
  return clip.sourceInUs + framesToSourceUs(frame - clip.start, fps, clip.speed);
}

/** Exclusive source out point (µs). */
export function sourceOutUs(clip: TimedMediaClip, fps: Rational): number {
  return clip.sourceInUs + framesToSourceUs(clip.duration, fps, clip.speed);
}

/** Max timeline frames available from `sourceInUs` to the end of the media. */
export function maxFramesFrom(
  media: MediaItem,
  sourceInUs: number,
  fps: Rational,
  speed: number,
): number {
  return sourceUsToFrames(Math.max(0, media.durationUs - sourceInUs), fps, speed);
}

/** Clips that are active at `frame`. */
export function clipsAt(project: Project, frame: number): Clip[] {
  return project.clips.filter((c) => frame >= c.start && frame < clipEnd(c));
}

/**
 * Visual clips active at `frame`, ordered bottom-most layer first (draw order).
 * Hidden tracks are skipped. Track index 0 is the top layer.
 */
export function visualLayersAt(project: Project, frame: number): VisualClip[] {
  const out: VisualClip[] = [];
  for (let i = project.tracks.length - 1; i >= 0; i--) {
    const track = project.tracks[i]!;
    if (track.hidden || track.kind === 'audio') continue;
    for (const c of project.clips) {
      if (c.trackId === track.id && frame >= c.start && frame < clipEnd(c) && isVisual(c))
        out.push(c);
    }
  }
  return out;
}

/** Clips that contribute audio (video + audio clips on unmuted tracks). */
export function audibleClips(project: Project): TimedMediaClip[] {
  const muted = new Set(project.tracks.filter((t) => t.muted).map((t) => t.id));
  return project.clips
    .filter(
      (c): c is TimedMediaClip =>
        isTimedMediaClip(c) && !muted.has(c.trackId) && !c.audio.mute && c.audio.gain > 0,
    )
    .filter((c) => {
      const m = findMedia(project, c.mediaId);
      return !!m && m.hasAudio;
    });
}

/** All snap candidates (clip edges) on the timeline, excluding given clip ids. */
export function snapPoints(project: Project, ignoreIds: readonly string[] = []): number[] {
  const pts = new Set<number>([0]);
  for (const c of project.clips) {
    if (ignoreIds.includes(c.id)) continue;
    pts.add(c.start);
    pts.add(clipEnd(c));
  }
  return [...pts].sort((a, b) => a - b);
}
