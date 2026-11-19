import {
  beatFrames,
  clipEnd,
  frameToSeconds,
  fpsToNumber,
  gainToDbSafe,
  sequenceDuration,
  usToSeconds,
  type Clip,
  type MediaItem,
  type Project,
} from './deps.ts';

/**
 * What the assistant sees. Times are in seconds (rounded to ms), media is identified by ID and a
 * generic label, and file names / title text are only included if the user enabled sharing in the
 * project's privacy settings. Never includes paths.
 */

const r3 = (n: number) => Math.round(n * 1000) / 1000;

export interface MediaView {
  id: string;
  label: string;
  kind: MediaItem['kind'];
  durationSeconds: number;
  width: number;
  height: number;
  fps: number | null;
  hasAudio: boolean;
  fileName?: string;
}

export function mediaView(m: MediaItem, project: Project): MediaView {
  return {
    id: m.id,
    label: m.label,
    kind: m.kind,
    durationSeconds: r3(usToSeconds(m.durationUs)),
    width: m.width,
    height: m.height,
    fps: m.fps,
    hasAudio: m.hasAudio,
    ...(project.privacySettings.shareFileNames ? { fileName: m.name } : {}),
  };
}

export function clipView(c: Clip, project: Project) {
  const fps = project.sequence.fps;
  const base = {
    id: c.id,
    kind: c.kind,
    trackId: c.trackId,
    startSeconds: r3(frameToSeconds(c.start, fps)),
    endSeconds: r3(frameToSeconds(clipEnd(c), fps)),
    durationSeconds: r3(frameToSeconds(c.duration, fps)),
  };
  const extra: Record<string, unknown> = {};
  if ('mediaId' in c) {
    const m = project.media.find((x) => x.id === c.mediaId);
    extra.mediaId = c.mediaId;
    extra.mediaLabel = m?.label;
  }
  if ('sourceInUs' in c) {
    extra.sourceInSeconds = r3(usToSeconds(c.sourceInUs));
    extra.speed = c.speed;
  }
  if (c.kind === 'slot') {
    extra.slotNumber = c.index;
    extra.empty = true;
  }
  if ((c.kind === 'video' || c.kind === 'image') && c.templateSlot)
    extra.slotNumber = c.templateSlot;
  if ((c.kind === 'video' || c.kind === 'audio') && c.beatsUs.length)
    extra.beatMarkers = beatFrames(c, fps).length;
  if ('audio' in c) {
    extra.audio = {
      volumeDb: r3(gainToDbSafe(c.audio.gain)),
      mute: c.audio.mute,
      fadeInSeconds: r3(frameToSeconds(c.audio.fadeIn, fps)),
      fadeOutSeconds: r3(frameToSeconds(c.audio.fadeOut, fps)),
    };
  }
  if ('transform' in c) {
    const t = c.transform;
    extra.transform = {
      x: r3(t.x),
      y: r3(t.y),
      scale: r3(t.scale),
      rotation: r3(t.rotation),
      opacity: r3(t.opacity),
      crop: t.crop,
    };
  }
  if ('text' in c) {
    extra.text = project.privacySettings.shareTextContent ? c.text : '[hidden by privacy settings]';
    extra.style = {
      fontFamily: c.style.fontFamily,
      fontSize: c.style.fontSize,
      bold: c.style.fontWeight >= 700,
      color: c.style.color,
      align: c.style.align,
      background: c.style.background,
    };
  }
  return { ...base, ...extra };
}

export function projectView(project: Project, playheadFrame: number) {
  const fps = project.sequence.fps;
  return {
    projectId: project.projectId,
    name: project.name,
    revision: project.revision,
    sequence: {
      width: project.sequence.width,
      height: project.sequence.height,
      fps: r3(fpsToNumber(fps)),
      background: project.sequence.background,
    },
    durationSeconds: r3(frameToSeconds(sequenceDuration(project), fps)),
    playheadSeconds: r3(frameToSeconds(playheadFrame, fps)),
    tracks: project.tracks.map((t, i) => ({
      id: t.id,
      kind: t.kind,
      name: t.name,
      layer: i === 0 ? 'top' : i === project.tracks.length - 1 ? 'bottom' : `#${i + 1}`,
      muted: t.muted,
      hidden: t.hidden,
      locked: t.locked,
      clipCount: project.clips.filter((c) => c.trackId === t.id).length,
    })),
    media: project.media.map((m) => mediaView(m, project)),
    clipCount: project.clips.length,
    privacy: {
      fileNamesShared: project.privacySettings.shareFileNames,
      textContentShared: project.privacySettings.shareTextContent,
    },
  };
}
