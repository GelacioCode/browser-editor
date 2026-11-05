import {
  COMMON_FRAME_RATES,
  DEFAULT_TITLE_STYLE,
  TRACK_ACCEPTS,
  clipEnd,
  clipsAt,
  cueToFrames,
  findMedia,
  findOverlap,
  formatSrt,
  framesToCue,
  fpsToNumber,
  maxFramesFrom,
  newId,
  parseSrt,
  secondsToNearestFrame,
  trackKindForClip,
  type ClipKind,
  type Operation,
  type Project,
  type TextStyle,
  type Transform,
} from '@viditor/project-core';
import { apply, select, setPlayhead, toast, useEditor } from './store.ts';

const get = useEditor.getState;

function nearestFps(avg: number | null) {
  if (!avg) return null;
  let best = COMMON_FRAME_RATES[0]!;
  for (const r of COMMON_FRAME_RATES) {
    if (Math.abs(fpsToNumber(r.fps) - avg) < Math.abs(fpsToNumber(best.fps) - avg)) best = r;
  }
  // 59.94 / 23.976 are common on phones and cameras too.
  if (Math.abs(avg - 59.94) < 0.05) return { num: 60000, den: 1001 };
  if (Math.abs(avg - 23.976) < 0.05) return { num: 24000, den: 1001 };
  return Math.abs(fpsToNumber(best.fps) - avg) < 0.6 ? best.fps : null;
}

/**
 * Place a media item on the timeline. If no `trackId` is given, uses the first compatible track
 * with room, or creates a new one. The first video placed on an empty timeline sets the sequence
 * format (resolution + frame rate) to match it.
 */
export function addMediaToTimeline(mediaId: string, at?: number, trackId?: string): string | null {
  const project = get().project;
  if (!project) return null;
  const media = findMedia(project, mediaId);
  if (!media) return null;
  const rt = get().media[mediaId];
  if (rt?.status !== 'ready') {
    toast('This media is offline. Relink it first.', 'error');
    return null;
  }
  const ops: Operation[] = [];
  let fps = project.sequence.fps;

  if (project.clips.length === 0 && media.kind === 'video' && media.width > 0) {
    const scale = Math.min(1, 2160 / Math.max(media.width, media.height));
    const w = Math.round((media.width * scale) / 2) * 2;
    const h = Math.round((media.height * scale) / 2) * 2;
    const nf = nearestFps(media.fps) ?? fps;
    if (
      w !== project.sequence.width ||
      h !== project.sequence.height ||
      nf.num !== fps.num ||
      nf.den !== fps.den
    ) {
      ops.push({ type: 'setSequence', width: w, height: h, fps: nf });
      ops.push({ type: 'setExportSettings', settings: { height: Math.min(h, 1080) } });
      fps = nf;
      toast(
        `Sequence set to ${w}×${h} @ ${fpsToNumber(nf).toFixed(2).replace(/\.00$/, '')} fps to match the first clip`,
      );
    }
  }

  const kind: ClipKind = media.kind;
  const duration =
    media.kind === 'image'
      ? secondsToNearestFrame(5, fps)
      : Math.max(1, maxFramesFrom(media, 0, fps, 1));
  const start = Math.max(0, at ?? get().playhead);

  let targetTrack = trackId;
  if (targetTrack) {
    const t = project.tracks.find((x) => x.id === targetTrack);
    if (!t || !TRACK_ACCEPTS[t.kind].includes(kind)) {
      toast(`A ${media.kind} can't go on that track`, 'error');
      return null;
    }
  } else {
    const wanted = trackKindForClip(kind);
    targetTrack = project.tracks.find(
      (t) => t.kind === wanted && !t.locked && !findOverlap(project, t.id, start, duration),
    )?.id;
    if (!targetTrack) {
      targetTrack = newId('t');
      // New audio tracks go at the bottom; new video tracks go above existing video (overlay).
      const firstOf = (k: string) => project.tracks.findIndex((t) => t.kind === k);
      let index = project.tracks.length;
      if (wanted === 'video') {
        index = firstOf('video');
        if (index === -1) index = firstOf('audio');
        if (index === -1) index = project.tracks.length;
      }
      ops.push({ type: 'addTrack', kind: wanted, id: targetTrack, index });
    }
  }

  const clipId = newId('c');
  const base = { id: clipId, trackId: targetTrack, mediaId, start, duration };
  ops.push({
    type: 'addClip',
    clip:
      kind === 'video'
        ? { ...base, kind: 'video' }
        : kind === 'audio'
          ? { ...base, kind: 'audio' }
          : { ...base, kind: 'image' },
  });
  const r = apply(ops, { label: `Add ${media.name}` });
  if (!r.ok) return null;
  select([clipId]);
  return clipId;
}

/** Split selected clips at the playhead; if none are selected, split everything under it. */
export function splitAtPlayhead() {
  const { project, playhead, selection } = get();
  if (!project) return;
  const locked = new Set(project.tracks.filter((t) => t.locked).map((t) => t.id));
  const under = clipsAt(project, playhead).filter(
    (c) => c.start < playhead && !locked.has(c.trackId),
  );
  const targets = selection.length ? under.filter((c) => selection.includes(c.id)) : under;
  if (targets.length === 0) {
    toast('Move the playhead over a clip to split it');
    return;
  }
  const newIds = targets.map(() => newId('c'));
  const r = apply(
    targets.map((c, i) => ({
      type: 'splitClip' as const,
      clipId: c.id,
      frame: playhead,
      newClipId: newIds[i],
    })),
    { label: 'Split' },
  );
  if (r.ok) select(newIds);
}

export function deleteSelection() {
  const { selection } = get();
  if (!selection.length) return;
  apply(
    selection.map((clipId) => ({ type: 'deleteClip' as const, clipId })),
    { label: 'Delete' },
  );
}

export function duplicateSelection() {
  const { selection } = get();
  if (!selection.length) return;
  const ids = selection.map(() => newId('c'));
  const r = apply(
    selection.map((clipId, i) => ({ type: 'duplicateClip' as const, clipId, newClipId: ids[i] })),
    { label: 'Duplicate' },
  );
  if (r.ok) select(ids);
}

export interface TitlePreset {
  id: string;
  name: string;
  text: string;
  style: Partial<TextStyle>;
  transform?: Partial<Transform>;
}

/** Original Viditor title presets. */
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

export function addTitle(preset: TitlePreset = TITLE_PRESETS[0]!) {
  const { project, playhead } = get();
  if (!project) return;
  const clipId = newId('c');
  const r = apply(
    {
      type: 'addTitle',
      clipId,
      start: playhead,
      duration: secondsToNearestFrame(3, project.sequence.fps),
      text: preset.text,
      style: { ...DEFAULT_TITLE_STYLE, ...preset.style },
      transform: preset.transform,
    },
    { label: `Add ${preset.name.toLowerCase()}` },
  );
  if (r.ok) select([clipId]);
}

export function addCaptionAtPlayhead(text = 'Caption text') {
  const { project, playhead } = get();
  if (!project) return;
  const clipId = newId('c');
  const r = apply(
    {
      type: 'addCaption',
      clipId,
      start: playhead,
      duration: secondsToNearestFrame(2, project.sequence.fps),
      text,
    },
    { label: 'Add caption' },
  );
  if (r.ok) select([clipId]);
}

export function captionClips(project: Project) {
  return project.clips.filter((c) => c.kind === 'caption').sort((a, b) => a.start - b.start);
}

export async function importSrtFile() {
  const project = get().project;
  if (!project) return;
  let handle: FileSystemFileHandle | undefined;
  try {
    [handle] = await window.showOpenFilePicker({
      types: [{ description: 'SubRip subtitles', accept: { 'application/x-subrip': ['.srt'] } }],
    });
  } catch {
    return;
  }
  if (!handle) return;
  const cues = parseSrt(await (await handle.getFile()).text());
  if (!cues.length) {
    toast('No captions found in that file', 'error');
    return;
  }
  const trackId = newId('t');
  const fps = project.sequence.fps;
  const ops: Operation[] = [{ type: 'addTrack', kind: 'caption', id: trackId, index: 0 }];
  let lastEnd = 0;
  for (const cue of cues) {
    const { start, duration } = cueToFrames(cue, fps);
    // Overlapping cues are trimmed so they fit on one track.
    const s = Math.max(start, lastEnd);
    const d = Math.max(1, start + duration - s);
    ops.push({ type: 'addCaption', trackId, start: s, duration: d, text: cue.text });
    lastEnd = s + d;
  }
  const r = apply(ops, { label: 'Import captions' });
  if (r.ok) toast(`Imported ${cues.length} captions`, 'success');
}

export async function exportSrtFile() {
  const project = get().project;
  if (!project) return;
  const caps = captionClips(project);
  if (!caps.length) {
    toast('There are no captions to export');
    return;
  }
  const fps = project.sequence.fps;
  const text = formatSrt(
    caps.map((c) => framesToCue(c.start, c.duration, c.kind === 'caption' ? c.text : '', fps)),
  );
  try {
    const handle = await window.showSaveFilePicker({
      suggestedName: `${project.name}.srt`,
      types: [{ description: 'SubRip subtitles', accept: { 'application/x-subrip': ['.srt'] } }],
    });
    const w = await handle.createWritable();
    await w.write(text);
    await w.close();
    toast('Captions exported', 'success');
  } catch (e) {
    if (!(e instanceof DOMException && e.name === 'AbortError')) toast(String(e), 'error');
  }
}

export function jumpToClip(clipId: string) {
  const c = get().project?.clips.find((x) => x.id === clipId);
  if (c) {
    setPlayhead(c.start);
    select([c.id]);
  }
}

export function nextEdit(direction: 1 | -1) {
  const { project, playhead } = get();
  if (!project) return;
  const points = [...new Set(project.clips.flatMap((c) => [c.start, clipEnd(c)]))].sort(
    (a, b) => a - b,
  );
  const target =
    direction > 0
      ? points.find((p) => p > playhead)
      : [...points].reverse().find((p) => p < playhead);
  if (target !== undefined) setPlayhead(target);
}
