import {
  beatFrames,
  clipEnd,
  findMedia,
  framesToSourceUs,
  isTimedMediaClip,
  newId,
  templateSlots,
  type Operation,
  type Project,
} from './deps.ts';
import type { PlanError } from './planning.ts';

/**
 * Beat-sync templates, shared by the editor UI and the assistant tools.
 *
 * A template is a video track of empty "slots" whose edges sit on the music's beat markers.
 * Dropping a video on a slot fills exactly that slot (replaceClipMedia), and slipping the clip
 * chooses which part of the video shows, so every cut stays on the beat.
 */

export const TEMPLATE_TRACK_NAME = 'Template';

export interface BeatTemplatePlan {
  ops: Operation[];
  trackId: string;
  slotIds: string[];
  /** Slot boundaries on the timeline, in frames (slots + 1 entries). */
  boundaries: number[];
}

/**
 * Plan a template from the beat markers of `clipId` (a music clip). Cuts land on every
 * `every`-th beat; the range covers the music clip (optionally narrowed by from/to frames),
 * including the stretch before the first beat and after the last one.
 */
export function planBeatTemplate(
  project: Project,
  opts: { clipId: string; every?: number; fromFrame?: number; toFrame?: number },
): BeatTemplatePlan | PlanError {
  const clip = project.clips.find((c) => c.id === opts.clipId);
  if (!clip) return { code: 'NOT_FOUND', error: `Clip ${opts.clipId} not found` };
  if (!isTimedMediaClip(clip))
    return { code: 'UNSUPPORTED', error: 'Pick the music (an audio or video clip) with beats' };
  const every = Math.max(1, Math.min(64, Math.round(opts.every ?? 1)));
  const from = Math.max(clip.start, opts.fromFrame ?? clip.start);
  const to = Math.min(clipEnd(clip), opts.toFrame ?? clipEnd(clip));
  if (to - from < 2) return { code: 'INVALID_RANGE', error: 'The template range is empty' };

  const beats = beatFrames(clip, project.sequence.fps).filter((f) => f > from && f < to);
  if (beats.length === 0) {
    return {
      code: 'NO_BEATS',
      error: 'This clip has no beat markers in that range. Detect or tap beats first.',
    };
  }
  const cuts = beats.filter((_, i) => i % every === 0);
  const boundaries = [from, ...cuts, to].filter((f, i, a) => i === 0 || f > a[i - 1]!);

  const trackId = newId('t');
  const firstVideo = project.tracks.findIndex((t) => t.kind === 'video');
  const firstAudio = project.tracks.findIndex((t) => t.kind === 'audio');
  const index =
    firstVideo !== -1 ? firstVideo : firstAudio !== -1 ? firstAudio : project.tracks.length;
  const existingSlots = templateSlots(project).map((s) => s.index);
  const filled = project.clips.map((c) =>
    (c.kind === 'video' || c.kind === 'image') && c.templateSlot ? c.templateSlot : 0,
  );
  let n = Math.max(0, ...existingSlots, ...filled);

  const ops: Operation[] = [
    { type: 'addTrack', kind: 'video', id: trackId, index },
    { type: 'updateTrack', trackId, name: TEMPLATE_TRACK_NAME },
  ];
  const slotIds: string[] = [];
  for (let i = 0; i + 1 < boundaries.length; i++) {
    const id = newId('c');
    slotIds.push(id);
    ops.push({
      type: 'addClip',
      clip: {
        id,
        kind: 'slot',
        trackId,
        start: boundaries[i]!,
        duration: boundaries[i + 1]! - boundaries[i]!,
        index: ++n,
      },
    });
  }
  return { ops, trackId, slotIds, boundaries };
}

/**
 * The first picture placed into a template decides the frame size (e.g. vertical phone video →
 * vertical sequence), like the first clip on an empty timeline does. Frame rate stays as is,
 * because the template's cuts are already counted in frames.
 */
export function sequenceOpsForFirstFill(project: Project, mediaId: string): Operation[] {
  const hasPicture = project.clips.some((c) => c.kind === 'video' || c.kind === 'image');
  const m = findMedia(project, mediaId);
  if (hasPicture || !m || m.kind === 'audio' || !m.width || !m.height) return [];
  const scale = Math.min(1, 2160 / Math.max(m.width, m.height));
  const w = Math.round((m.width * scale) / 2) * 2;
  const h = Math.round((m.height * scale) / 2) * 2;
  const s = project.sequence;
  if (w === s.width && h === s.height) return [];
  return [
    { type: 'setSequence', width: w, height: h },
    { type: 'setExportSettings', settings: { height: Math.min(h, 1080) } },
  ];
}

/** Fill (or swap) one slot, matching the sequence size on the first fill. */
export function planFillSlot(
  project: Project,
  slotId: string,
  mediaId: string,
  sourceInUs?: number,
): Operation[] {
  return [
    ...sequenceOpsForFirstFill(project, mediaId),
    { type: 'replaceClipMedia', clipId: slotId, mediaId, sourceInUs },
  ];
}

export interface FillPlan {
  ops: Operation[];
  filled: { slotId: string; mediaId: string; sourceInUs: number }[];
  /** Slots that stayed empty because every given video was too short for them. */
  skipped: string[];
}

/**
 * Fill empty slots (in timeline order, or just `slotIds`) with the given media, cycling through
 * the list. When a video is used again, the next use starts where the previous one ended, so
 * repeated clips show different moments instead of the same opening seconds.
 */
export function planFillSlots(
  project: Project,
  mediaIds: readonly string[],
  slotIds?: readonly string[],
): FillPlan | PlanError {
  const media = mediaIds
    .map((id) => findMedia(project, id))
    .filter((m): m is NonNullable<typeof m> => !!m && m.kind !== 'audio');
  if (!media.length) return { code: 'NOT_FOUND', error: 'Choose at least one video or image' };
  const locked = new Set(project.tracks.filter((t) => t.locked).map((t) => t.id));
  const slots = templateSlots(project).filter(
    (s) => !locked.has(s.trackId) && (!slotIds || slotIds.includes(s.id)),
  );
  if (!slots.length) return { code: 'NOT_FOUND', error: 'There are no empty template slots' };

  const fps = project.sequence.fps;
  const cursor = new Map<string, number>();
  const ops: Operation[] = [];
  let first = true;
  const filled: FillPlan['filled'] = [];
  const skipped: string[] = [];
  let next = 0;
  for (const slot of slots) {
    const need = framesToSourceUs(slot.duration, fps, 1);
    let placed = false;
    for (let tries = 0; tries < media.length && !placed; tries++) {
      const m = media[(next + tries) % media.length]!;
      if (m.kind === 'video' && m.durationUs < need) continue;
      let sourceInUs = 0;
      if (m.kind === 'video') {
        sourceInUs = cursor.get(m.id) ?? 0;
        if (sourceInUs + need > m.durationUs) sourceInUs = 0;
        cursor.set(m.id, sourceInUs + need);
      }
      if (first) ops.push(...sequenceOpsForFirstFill(project, m.id));
      first = false;
      ops.push({ type: 'replaceClipMedia', clipId: slot.id, mediaId: m.id, sourceInUs });
      filled.push({ slotId: slot.id, mediaId: m.id, sourceInUs });
      next = (next + tries + 1) % media.length;
      placed = true;
    }
    if (!placed) skipped.push(slot.id);
  }
  return { ops, filled, skipped };
}
