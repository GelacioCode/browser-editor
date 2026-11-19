import {
  clipsAt,
  findClip,
  findMedia,
  framesToSourceUs,
  isTimedMediaClip,
  templateSlots,
  type TimedMediaClip,
} from '@viditor/project-core';
import { planBeatTemplate, planFillSlot, planFillSlots } from '@viditor/contracts';
import type { BeatMode } from '@viditor/media';
import { analyzeBeats } from './project-io.ts';
import { apply, select, toast, useEditor } from './store.ts';

/** Beat markers and beat-sync templates: the editor-side actions. */

const get = useEditor.getState;

function timedClip(clipId: string): TimedMediaClip | null {
  const p = get().project;
  const c = p ? findClip(p, clipId) : undefined;
  return c && isTimedMediaClip(c) ? c : null;
}

export async function detectBeatsForClip(
  clipId: string,
  mode: BeatMode,
): Promise<{ bpm: number | null; count: number } | null> {
  const clip = timedClip(clipId);
  if (!clip) return null;
  try {
    const r = await analyzeBeats(clip.mediaId, mode);
    const what = mode === 'bass' ? 'bass hits' : 'beats';
    if (!r.beatsUs.length) {
      toast(`No clear ${what} found in this audio. Try the other mode, or tap them with B.`);
      return { bpm: r.bpm, count: 0 };
    }
    const res = apply(
      { type: 'setBeats', clipId, beatsUs: r.beatsUs },
      { label: mode === 'bass' ? 'Detect bass hits' : 'Detect beats' },
    );
    if (!res.ok) return null;
    return { bpm: r.bpm, count: r.beatsUs.length };
  } catch (e) {
    toast(`Beat detection failed: ${e instanceof Error ? e.message : String(e)}`, 'error', 7000);
    return null;
  }
}

export function clearBeats(clipId: string) {
  apply({ type: 'setBeats', clipId, beatsUs: [] }, { label: 'Clear beat markers' });
}

/** The clip a tapped beat belongs to: the selected music clip, else audio under the playhead. */
function tapTarget(): TimedMediaClip | null {
  const { project, playhead, selection } = get();
  if (!project) return null;
  const under = clipsAt(project, playhead).filter(isTimedMediaClip);
  const selected = under.find((c) => selection.includes(c.id));
  if (selected) return selected;
  const withAudio = (c: TimedMediaClip) => !!findMedia(project, c.mediaId)?.hasAudio;
  return under.find((c) => c.kind === 'audio') ?? under.find(withAudio) ?? null;
}

let lastTapAt = 0;
let tapSession = 0;

/** Add a beat marker at the playhead (press B while the music plays). */
export function tapBeat() {
  const { project, playhead } = get();
  const clip = tapTarget();
  if (!project || !clip) {
    toast('Put the playhead over the music clip (or select it) to tap beats.');
    return;
  }
  const us =
    clip.sourceInUs + framesToSourceUs(playhead - clip.start, project.sequence.fps, clip.speed);
  const now = Date.now();
  if (now - lastTapAt > 4000) tapSession++;
  lastTapAt = now;
  // Taps in one burst (a few seconds apart at most) are one undo step.
  apply(
    { type: 'setBeats', clipId: clip.id, beatsUs: [...clip.beatsUs, us] },
    { label: 'Tap beats', coalesceKey: `tap:${clip.id}:${tapSession}` },
  );
}

export function moveBeat(clipId: string, fromUs: number, toUs: number) {
  const clip = timedClip(clipId);
  if (!clip) return;
  const rest = clip.beatsUs.filter((b) => b !== fromUs);
  const r = apply(
    { type: 'setBeats', clipId, beatsUs: [...rest, Math.max(0, Math.round(toUs))] },
    { label: 'Move beat marker' },
  );
  if (r.ok) useEditor.setState({ selectedBeat: { clipId, us: Math.max(0, Math.round(toUs)) } });
}

/** Delete the selected beat marker. Returns false when no marker is selected. */
export function deleteSelectedBeat(): boolean {
  const sel = get().selectedBeat;
  if (!sel) return false;
  const clip = timedClip(sel.clipId);
  useEditor.setState({ selectedBeat: null });
  if (!clip) return true;
  apply(
    { type: 'setBeats', clipId: clip.id, beatsUs: clip.beatsUs.filter((b) => b !== sel.us) },
    { label: 'Delete beat marker' },
  );
  return true;
}

export function createBeatTemplate(clipId: string, every: number) {
  const project = get().project;
  if (!project) return;
  const plan = planBeatTemplate(project, { clipId, every });
  if ('error' in plan) {
    toast(plan.error, 'error');
    return;
  }
  const r = apply(plan.ops, { label: `Create beat template (${plan.slotIds.length} slots)` });
  if (!r.ok) return;
  select([]);
  toast(
    `Template ready: ${plan.slotIds.length} slots on the beat. Drag videos from the Media panel onto the slots.`,
    'success',
    7000,
  );
}

/** Fill (or swap) one slot by dropping media on it. */
export function fillSlot(slotId: string, mediaId: string) {
  const project = get().project;
  if (!project) return false;
  const media = findMedia(project, mediaId);
  if (!media) return false;
  if (media.kind === 'audio') {
    toast('Template slots take videos or images. Drop music on an audio track instead.', 'error');
    return false;
  }
  if (get().media[mediaId]?.status !== 'ready') {
    toast('This media is offline. Relink it first.', 'error');
    return false;
  }
  const r = apply(planFillSlot(project, slotId, mediaId), {
    label: `Fill slot with ${media.name}`,
  });
  if (r.ok) select([slotId]);
  return r.ok;
}

export function emptySlotCount(): number {
  const p = get().project;
  return p ? templateSlots(p).length : 0;
}

/** Fill every empty slot in order with the given media, cycling through the list. */
export function autoFillSlots(mediaIds: string[]) {
  const project = get().project;
  if (!project) return;
  const ready = mediaIds.filter((id) => get().media[id]?.status === 'ready');
  const plan = planFillSlots(project, ready);
  if ('error' in plan) {
    toast(plan.error, 'error');
    return;
  }
  if (!plan.ops.length) {
    toast('Every video is shorter than the slots. Import longer clips or cut every beat.', 'error');
    return;
  }
  const r = apply(plan.ops, { label: `Fill ${plan.filled.length} template slots` });
  if (!r.ok) return;
  toast(
    plan.skipped.length
      ? `Filled ${plan.filled.length} slots; ${plan.skipped.length} stayed empty (videos too short).`
      : `Filled ${plan.filled.length} slots. Select a clip to choose which part shows.`,
    'success',
  );
}

export function clearSlot(clipId: string) {
  apply({ type: 'clearSlot', clipId }, { label: 'Empty template slot' });
}
