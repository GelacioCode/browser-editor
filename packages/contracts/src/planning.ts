import {
  TRACK_ACCEPTS,
  findMedia,
  findOverlap,
  fpsToNumber,
  maxFramesFrom,
  newId,
  secondsToNearestFrame,
  trackKindForClip,
  type Operation,
  type Project,
  type TextStyle,
  type Transform,
} from './deps.ts';
import { COMMON_FRAME_RATES } from '@viditor/project-core';

/**
 * Edit planning shared by the UI and the assistant tools, so "add this clip" behaves the same
 * whichever side asks for it.
 */

export function nearestStandardFps(avg: number | null) {
  if (!avg) return null;
  if (Math.abs(avg - 59.94) < 0.05) return { num: 60000, den: 1001 };
  if (Math.abs(avg - 23.976) < 0.05) return { num: 24000, den: 1001 };
  let best = COMMON_FRAME_RATES[0]!;
  for (const r of COMMON_FRAME_RATES) {
    if (Math.abs(fpsToNumber(r.fps) - avg) < Math.abs(fpsToNumber(best.fps) - avg)) best = r;
  }
  return Math.abs(fpsToNumber(best.fps) - avg) < 0.6 ? best.fps : null;
}

export interface AddMediaPlan {
  ops: Operation[];
  clipId: string;
  trackId: string;
  /** Set when the plan also changes the sequence format to match the first clip. */
  sequenceNotice?: string;
}

export type PlanError = { error: string; code: string };

/**
 * Plan placing `mediaId` at frame `start`. Uses `trackId` if given, otherwise the first compatible
 * unlocked track with room, otherwise a new track. The first video on an empty timeline sets the
 * sequence resolution and frame rate to match it.
 */
export function planAddMedia(
  project: Project,
  opts: { mediaId: string; start: number; trackId?: string; durationFrames?: number },
): AddMediaPlan | PlanError {
  const media = findMedia(project, opts.mediaId);
  if (!media) return { code: 'NOT_FOUND', error: `Media ${opts.mediaId} not found` };
  const ops: Operation[] = [];
  let fps = project.sequence.fps;
  let sequenceNotice: string | undefined;

  if (project.clips.length === 0 && media.kind === 'video' && media.width > 0) {
    const scale = Math.min(1, 2160 / Math.max(media.width, media.height));
    const w = Math.round((media.width * scale) / 2) * 2;
    const h = Math.round((media.height * scale) / 2) * 2;
    const nf = nearestStandardFps(media.fps) ?? fps;
    const s = project.sequence;
    if (w !== s.width || h !== s.height || nf.num !== fps.num || nf.den !== fps.den) {
      ops.push({ type: 'setSequence', width: w, height: h, fps: nf });
      ops.push({ type: 'setExportSettings', settings: { height: Math.min(h, 1080) } });
      fps = nf;
      sequenceNotice = `Sequence set to ${w}×${h} @ ${Number(fpsToNumber(nf).toFixed(3))} fps to match the first clip`;
    }
  }

  const full =
    media.kind === 'image' ? secondsToNearestFrame(5, fps) : maxFramesFrom(media, 0, fps, 1);
  const duration = Math.max(
    1,
    Math.min(opts.durationFrames ?? full, media.kind === 'image' ? Infinity : full),
  );
  const kind = media.kind;

  let trackId = opts.trackId;
  if (trackId) {
    const t = project.tracks.find((x) => x.id === trackId);
    if (!t) return { code: 'NOT_FOUND', error: `Track ${trackId} not found` };
    if (!TRACK_ACCEPTS[t.kind].includes(kind)) {
      return { code: 'TRACK_MISMATCH', error: `A ${kind} can't go on a ${t.kind} track` };
    }
  } else {
    const wanted = trackKindForClip(kind);
    trackId = project.tracks.find(
      (t) => t.kind === wanted && !t.locked && !findOverlap(project, t.id, opts.start, duration),
    )?.id;
    if (!trackId) {
      trackId = newId('t');
      // New audio tracks go at the bottom; new video tracks above existing video (overlay).
      const firstOf = (k: string) => project.tracks.findIndex((t) => t.kind === k);
      let index = project.tracks.length;
      if (wanted === 'video') {
        index = firstOf('video');
        if (index === -1) index = firstOf('audio');
        if (index === -1) index = project.tracks.length;
      } else if (wanted !== 'audio') index = 0;
      ops.push({ type: 'addTrack', kind: wanted, id: trackId, index });
    }
  }

  const clipId = newId('c');
  const base = { id: clipId, trackId, mediaId: media.id, start: opts.start, duration };
  ops.push({
    type: 'addClip',
    clip:
      kind === 'video'
        ? { ...base, kind: 'video' }
        : kind === 'audio'
          ? { ...base, kind: 'audio' }
          : { ...base, kind: 'image' },
  });
  return { ops, clipId, trackId, sequenceNotice };
}

export interface TitlePreset {
  id: string;
  name: string;
  text: string;
  style: Partial<TextStyle>;
  transform?: Partial<Transform>;
}

/** Original Viditor title presets (shared by the Text panel and the add_title tool). */
export const TITLE_PRESETS: TitlePreset[] = [
  { id: 'title', name: 'Title', text: 'Your title', style: { fontSize: 120, fontWeight: 700 } },
  {
    id: 'subtitle',
    name: 'Subtitle',
    text: 'A short subtitle',
    style: { fontSize: 64, fontWeight: 400, color: '#e6e6e6' },
  },
  {
    id: 'lower-third',
    name: 'Lower third',
    text: 'Name Surname\nRole or location',
    style: {
      fontSize: 48,
      fontWeight: 700,
      align: 'left',
      background: '#111111cc',
      lineHeight: 1.35,
    },
    transform: { x: -0.25, y: 0.3 },
  },
  {
    id: 'poster',
    name: 'Poster',
    text: 'BIG NEWS',
    style: {
      fontFamily: 'Bebas Neue',
      fontWeight: 400,
      fontSize: 220,
      strokeColor: '#000000',
      strokeWidth: 6,
    },
  },
  {
    id: 'serif',
    name: 'Elegant',
    text: 'Chapter One',
    style: { fontFamily: 'Playfair Display', fontWeight: 400, fontSize: 110 },
  },
  {
    id: 'tag',
    name: 'Tag',
    text: '@yourhandle',
    style: { fontFamily: 'Montserrat', fontSize: 44, fontWeight: 700, background: '#6d5efcdd' },
    transform: { y: -0.36 },
  },
];
