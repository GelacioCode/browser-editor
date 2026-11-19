import {
  DEFAULT_TITLE_STYLE,
  clipEnd,
  clipsAt,
  cueToFrames,
  findMedia,
  formatSrt,
  framesToCue,
  newId,
  parseSrt,
  secondsToNearestFrame,
  type Operation,
  type Project,
} from '@viditor/project-core';
import { TITLE_PRESETS, planAddMedia, type TitlePreset } from '@viditor/contracts';
import { apply, select, setPlayhead, toast, useEditor } from './store.ts';

export { TITLE_PRESETS, type TitlePreset };

const get = useEditor.getState;

/**
 * Place a media item on the timeline (same planning as the assistant's add_media_to_timeline):
 * first compatible track with room, or a new one; the first video on an empty timeline sets the
 * sequence format to match it.
 */
export function addMediaToTimeline(mediaId: string, at?: number, trackId?: string): string | null {
  const project = get().project;
  if (!project) return null;
  const media = findMedia(project, mediaId);
  if (!media) return null;
  if (get().media[mediaId]?.status !== 'ready') {
    toast('This media is offline. Relink it first.', 'error');
    return null;
  }
  const plan = planAddMedia(project, {
    mediaId,
    start: Math.max(0, at ?? get().playhead),
    trackId,
  });
  if ('error' in plan) {
    toast(plan.error, 'error');
    return null;
  }
  const r = apply(plan.ops, { label: `Add ${media.name}` });
  if (!r.ok) return null;
  if (plan.sequenceNotice) toast(plan.sequenceNotice);
  select([plan.clipId]);
  return plan.clipId;
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
