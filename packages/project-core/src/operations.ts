import { z } from 'zod';
import {
  AudioPropsSchema,
  CaptionClipSchema,
  ExportSettingsSchema,
  HexColorSchema,
  IdSchema,
  ImageClipSchema,
  MediaItemSchema,
  PrivacySettingsSchema,
  RationalSchema,
  TextClipSchema,
  TextStyleSchema,
  TrackKindSchema,
  TransformSchema,
  VideoClipSchema,
  AudioClipSchema,
  SlotClipSchema,
  type Clip,
  type Project,
  type TimedMediaClip,
  type Track,
} from './schema.ts';
import {
  DEFAULT_AUDIO,
  DEFAULT_CAPTION_STYLE,
  DEFAULT_CAPTION_TRANSFORM,
  DEFAULT_TITLE_STYLE,
  DEFAULT_TRANSFORM,
  TRACK_ACCEPTS,
  makeTrack,
  newId,
} from './defaults.ts';
import { clipEnd, findOverlap, isTimedMediaClip, maxFramesFrom } from './model.ts';
import { framesToSourceUs, US_PER_SECOND } from './time.ts';

/* ------------------------------------------------------------------------------------------------
 * Errors
 * ---------------------------------------------------------------------------------------------- */

export type EngineErrorCode =
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'INVALID_RANGE'
  | 'OVERLAP'
  | 'TRACK_MISMATCH'
  | 'LOCKED'
  | 'STALE_REVISION'
  | 'UNSUPPORTED';

export class EngineError extends Error {
  constructor(
    public readonly code: EngineErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'EngineError';
  }
}

/** Deep copy that also works on immer drafts (structuredClone cannot clone proxies). */
export const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const fail = (code: EngineErrorCode, message: string): never => {
  throw new EngineError(code, message);
};

/* ------------------------------------------------------------------------------------------------
 * Operation schemas
 * ---------------------------------------------------------------------------------------------- */

const CropPartial = TransformSchema.shape.crop.partial();
export const TransformPatchSchema = TransformSchema.extend({ crop: CropPartial }).partial();
export const AudioPatchSchema = AudioPropsSchema.partial();
export const TextStylePatchSchema = TextStyleSchema.partial();

const frame = z.number().int().min(0);

const ClipInputSchema = z.discriminatedUnion('kind', [
  VideoClipSchema.extend({
    id: IdSchema.optional(),
    sourceInUs: z.number().int().min(0).default(0),
    speed: z.number().min(0.1).max(10).default(1),
    transform: TransformSchema.default(() => clone(DEFAULT_TRANSFORM)),
    audio: AudioPropsSchema.default(() => clone(DEFAULT_AUDIO)),
  }),
  AudioClipSchema.extend({
    id: IdSchema.optional(),
    sourceInUs: z.number().int().min(0).default(0),
    speed: z.number().min(0.1).max(10).default(1),
    audio: AudioPropsSchema.default(() => clone(DEFAULT_AUDIO)),
  }),
  ImageClipSchema.extend({
    id: IdSchema.optional(),
    transform: TransformSchema.default(() => clone(DEFAULT_TRANSFORM)),
  }),
  TextClipSchema.extend({
    id: IdSchema.optional(),
    style: TextStyleSchema.default(() => clone(DEFAULT_TITLE_STYLE)),
    transform: TransformSchema.default(() => clone(DEFAULT_TRANSFORM)),
  }),
  CaptionClipSchema.extend({
    id: IdSchema.optional(),
    style: TextStyleSchema.default(() => clone(DEFAULT_CAPTION_STYLE)),
    transform: TransformSchema.default(() => clone(DEFAULT_CAPTION_TRANSFORM)),
  }),
  SlotClipSchema.extend({
    id: IdSchema.optional(),
    transform: TransformSchema.default(() => clone(DEFAULT_TRANSFORM)),
  }),
]);

export const OperationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('renameProject'), name: z.string().min(1).max(120) }),
  z.object({
    type: z.literal('setSequence'),
    width: z.number().int().min(16).max(7680).optional(),
    height: z.number().int().min(16).max(7680).optional(),
    fps: RationalSchema.optional(),
    background: HexColorSchema.optional(),
  }),
  z.object({ type: z.literal('setExportSettings'), settings: ExportSettingsSchema.partial() }),
  z.object({ type: z.literal('setPrivacy'), settings: PrivacySettingsSchema.partial() }),

  z.object({
    type: z.literal('addTrack'),
    kind: TrackKindSchema,
    index: z.number().int().min(0).optional(),
    id: IdSchema.optional(),
  }),
  z.object({
    type: z.literal('updateTrack'),
    trackId: IdSchema,
    name: z.string().min(1).max(64).optional(),
    muted: z.boolean().optional(),
    hidden: z.boolean().optional(),
    locked: z.boolean().optional(),
  }),
  z.object({ type: z.literal('moveTrack'), trackId: IdSchema, index: z.number().int().min(0) }),
  z.object({ type: z.literal('removeTrack'), trackId: IdSchema }),

  z.object({ type: z.literal('addMedia'), media: MediaItemSchema }),
  z.object({
    type: z.literal('updateMedia'),
    mediaId: IdSchema,
    patch: MediaItemSchema.omit({ id: true, kind: true }).partial(),
  }),
  z.object({ type: z.literal('removeMedia'), mediaId: IdSchema }),

  z.object({ type: z.literal('addClip'), clip: ClipInputSchema }),
  z.object({ type: z.literal('deleteClip'), clipId: IdSchema }),
  z.object({
    type: z.literal('moveClip'),
    clipId: IdSchema,
    start: frame,
    trackId: IdSchema.optional(),
  }),
  z.object({
    type: z.literal('splitClip'),
    clipId: IdSchema,
    frame,
    newClipId: IdSchema.optional(),
  }),
  z.object({
    type: z.literal('trimClip'),
    clipId: IdSchema,
    edge: z.enum(['start', 'end']),
    /** New timeline position of the edge. */
    frame,
  }),
  z.object({
    type: z.literal('duplicateClip'),
    clipId: IdSchema,
    newClipId: IdSchema.optional(),
    start: frame.optional(),
    trackId: IdSchema.optional(),
  }),
  z.object({ type: z.literal('setTransform'), clipId: IdSchema, transform: TransformPatchSchema }),
  z.object({ type: z.literal('setAudio'), clipId: IdSchema, audio: AudioPatchSchema }),
  z.object({ type: z.literal('setSpeed'), clipId: IdSchema, speed: z.number().min(0.1).max(10) }),
  z.object({
    type: z.literal('addTitle'),
    start: frame,
    duration: z.number().int().min(1),
    text: z.string().max(2000),
    trackId: IdSchema.optional(),
    clipId: IdSchema.optional(),
    style: TextStylePatchSchema.optional(),
    transform: TransformPatchSchema.optional(),
  }),
  z.object({
    type: z.literal('updateText'),
    clipId: IdSchema,
    text: z.string().max(2000).optional(),
    style: TextStylePatchSchema.optional(),
  }),
  z.object({
    type: z.literal('addCaption'),
    start: frame,
    duration: z.number().int().min(1),
    text: z.string().max(2000),
    trackId: IdSchema.optional(),
    clipId: IdSchema.optional(),
  }),

  /** Replace the beat markers of a video/audio clip (source µs of its media). */
  z.object({
    type: z.literal('setBeats'),
    clipId: IdSchema,
    beatsUs: z.array(z.number().int().min(0)).max(20_000),
  }),
  /**
   * Put a different video or image into a clip's place, keeping its timing exactly. Works on
   * empty template slots and on video/image clips (to swap what fills a slot).
   */
  z.object({
    type: z.literal('replaceClipMedia'),
    clipId: IdSchema,
    mediaId: IdSchema,
    /** Where in the new video the clip starts. Defaults to 0. */
    sourceInUs: z.number().int().min(0).optional(),
  }),
  /** Choose which part of the source shows, without changing the clip's timing. */
  z.object({ type: z.literal('slipClip'), clipId: IdSchema, sourceInUs: z.number().int().min(0) }),
  /** Turn a video/image clip back into an empty template slot with the same timing. */
  z.object({ type: z.literal('clearSlot'), clipId: IdSchema }),
]);

export type Operation = z.input<typeof OperationSchema>;
export type ParsedOperation = z.output<typeof OperationSchema>;
export type OperationType = Operation['type'];

/* ------------------------------------------------------------------------------------------------
 * Helpers (operate on immer drafts)
 * ---------------------------------------------------------------------------------------------- */

interface Ctx {
  /** IDs created by this transaction, in order. */
  created: string[];
}

function getTrack(p: Project, trackId: string): Track {
  return p.tracks.find((t) => t.id === trackId) ?? fail('NOT_FOUND', `Track ${trackId} not found`);
}

function getClip(p: Project, clipId: string): Clip {
  return p.clips.find((c) => c.id === clipId) ?? fail('NOT_FOUND', `Clip ${clipId} not found`);
}

function assertUnlocked(track: Track) {
  if (track.locked) fail('LOCKED', `Track "${track.name}" is locked`);
}

function assertNoOverlap(
  p: Project,
  trackId: string,
  start: number,
  duration: number,
  ignore: string[],
) {
  const hit = findOverlap(p, trackId, start, duration, ignore);
  if (hit) fail('OVERLAP', `Clip would overlap clip ${hit.id} on the same track`);
}

function assertTrackAccepts(track: Track, clip: Pick<Clip, 'kind'>) {
  if (!TRACK_ACCEPTS[track.kind].includes(clip.kind)) {
    fail('TRACK_MISMATCH', `A ${track.kind} track cannot hold ${clip.kind} clips`);
  }
}

/** Ensure a timed media clip doesn't read past the end of its media. */
function assertSourceRange(p: Project, clip: TimedMediaClip) {
  const media =
    p.media.find((m) => m.id === clip.mediaId) ??
    fail('NOT_FOUND', `Media ${clip.mediaId} not found`);
  const max = maxFramesFrom(media, clip.sourceInUs, p.sequence.fps, clip.speed);
  if (clip.sourceInUs > media.durationUs)
    fail('INVALID_RANGE', 'Source in-point is past the end of the media');
  if (clip.duration > max) {
    fail(
      'INVALID_RANGE',
      `Clip needs ${clip.duration} frames but only ${max} are available in the source`,
    );
  }
}

/** Minimum spacing between two beat markers; closer taps are treated as the same beat. */
export const MIN_BEAT_SPACING_US = 40_000;

/** Sort, drop duplicates/near-duplicates and clamp beat markers to the media length. */
export function normalizeBeats(beatsUs: readonly number[], durationUs: number): number[] {
  const sorted = beatsUs
    .filter((b) => Number.isFinite(b) && b >= 0 && b <= durationUs)
    .map((b) => Math.round(b))
    .sort((a, b) => a - b);
  const out: number[] = [];
  for (const b of sorted) {
    const last = out[out.length - 1];
    if (last === undefined || b - last >= MIN_BEAT_SPACING_US) out.push(b);
  }
  return out;
}

const fmtSeconds = (us: number) => `${(us / US_PER_SECOND).toFixed(1)} s`;

function clampFades(clip: TimedMediaClip) {
  clip.audio.fadeIn = Math.min(clip.audio.fadeIn, clip.duration);
  clip.audio.fadeOut = Math.min(clip.audio.fadeOut, clip.duration - clip.audio.fadeIn);
}

function validateClipPlacement(p: Project, clip: Clip) {
  const track = getTrack(p, clip.trackId);
  assertUnlocked(track);
  assertTrackAccepts(track, clip);
  if ('mediaId' in clip) {
    const media =
      p.media.find((m) => m.id === clip.mediaId) ??
      fail('NOT_FOUND', `Media ${clip.mediaId} not found`);
    const expected = clip.kind === 'image' ? 'image' : clip.kind === 'video' ? 'video' : null;
    if (expected && media.kind !== expected)
      fail('VALIDATION', `Media ${media.id} is not ${expected}`);
    if (clip.kind === 'audio' && !media.hasAudio)
      fail('VALIDATION', `Media ${media.id} has no audio`);
  }
  if (isTimedMediaClip(clip)) assertSourceRange(p, clip);
  assertNoOverlap(p, clip.trackId, clip.start, clip.duration, [clip.id]);
}

/** First track of `kind` that has room for [start, start+duration), or a new one. */
function findOrCreateTrack(
  p: Project,
  kind: Track['kind'],
  start: number,
  duration: number,
  ctx: Ctx,
): Track {
  const existing = p.tracks.find(
    (t) => t.kind === kind && !t.locked && !findOverlap(p, t.id, start, duration),
  );
  if (existing) return existing;
  const track = makeTrack(kind, p.tracks);
  // Text/caption tracks go on top; video tracks above audio; audio at the bottom.
  if (kind === 'audio') p.tracks.push(track);
  else if (kind === 'video') {
    const firstAudio = p.tracks.findIndex((t) => t.kind === 'audio');
    p.tracks.splice(firstAudio === -1 ? p.tracks.length : firstAudio, 0, track);
  } else p.tracks.unshift(track);
  ctx.created.push(track.id);
  return track;
}

/* ------------------------------------------------------------------------------------------------
 * Operation implementations
 * ---------------------------------------------------------------------------------------------- */

export function applyOperation(p: Project, op: ParsedOperation, ctx: Ctx): void {
  switch (op.type) {
    case 'renameProject':
      p.name = op.name;
      return;

    case 'setSequence': {
      if (op.width !== undefined) p.sequence.width = op.width;
      if (op.height !== undefined) p.sequence.height = op.height;
      if (op.background !== undefined) p.sequence.background = op.background;
      if (op.fps !== undefined) {
        if (p.clips.length > 0)
          fail('UNSUPPORTED', 'Frame rate can only be changed while the timeline is empty');
        p.sequence.fps = op.fps;
      }
      return;
    }

    case 'setExportSettings':
      Object.assign(p.exportSettings, op.settings);
      return;

    case 'setPrivacy':
      Object.assign(p.privacySettings, op.settings);
      return;

    case 'addTrack': {
      const id = op.id ?? newId('t');
      if (p.tracks.some((t) => t.id === id)) fail('VALIDATION', `Track ${id} already exists`);
      const track = makeTrack(op.kind, p.tracks, id);
      const index = Math.min(op.index ?? p.tracks.length, p.tracks.length);
      p.tracks.splice(index, 0, track);
      ctx.created.push(id);
      return;
    }

    case 'updateTrack': {
      const t = getTrack(p, op.trackId);
      if (op.name !== undefined) t.name = op.name;
      if (op.muted !== undefined) t.muted = op.muted;
      if (op.hidden !== undefined) t.hidden = op.hidden;
      if (op.locked !== undefined) t.locked = op.locked;
      return;
    }

    case 'moveTrack': {
      const from = p.tracks.findIndex((t) => t.id === op.trackId);
      if (from === -1) fail('NOT_FOUND', `Track ${op.trackId} not found`);
      const [t] = p.tracks.splice(from, 1);
      p.tracks.splice(Math.min(op.index, p.tracks.length), 0, t!);
      return;
    }

    case 'removeTrack': {
      const t = getTrack(p, op.trackId);
      assertUnlocked(t);
      p.clips = p.clips.filter((c) => c.trackId !== t.id);
      p.tracks = p.tracks.filter((x) => x.id !== t.id);
      return;
    }

    case 'addMedia': {
      if (p.media.some((m) => m.id === op.media.id))
        fail('VALIDATION', `Media ${op.media.id} already exists`);
      p.media.push(op.media);
      ctx.created.push(op.media.id);
      return;
    }

    case 'updateMedia': {
      const m =
        p.media.find((x) => x.id === op.mediaId) ??
        fail('NOT_FOUND', `Media ${op.mediaId} not found`);
      Object.assign(m, op.patch);
      return;
    }

    case 'removeMedia': {
      if (!p.media.some((m) => m.id === op.mediaId))
        fail('NOT_FOUND', `Media ${op.mediaId} not found`);
      p.clips = p.clips.filter((c) => !('mediaId' in c) || c.mediaId !== op.mediaId);
      p.media = p.media.filter((m) => m.id !== op.mediaId);
      return;
    }

    case 'addClip': {
      const id = op.clip.id ?? newId('c');
      if (p.clips.some((c) => c.id === id)) fail('VALIDATION', `Clip ${id} already exists`);
      const clip = { ...op.clip, id } as Clip;
      if (isTimedMediaClip(clip)) clampFades(clip);
      validateClipPlacement(p, clip);
      p.clips.push(clip);
      ctx.created.push(id);
      return;
    }

    case 'deleteClip': {
      const c = getClip(p, op.clipId);
      assertUnlocked(getTrack(p, c.trackId));
      p.clips = p.clips.filter((x) => x.id !== op.clipId);
      return;
    }

    case 'moveClip': {
      const c = getClip(p, op.clipId);
      assertUnlocked(getTrack(p, c.trackId));
      c.start = op.start;
      if (op.trackId !== undefined) c.trackId = op.trackId;
      validateClipPlacement(p, c);
      return;
    }

    case 'splitClip': {
      const c = getClip(p, op.clipId);
      assertUnlocked(getTrack(p, c.trackId));
      if (op.frame <= c.start || op.frame >= clipEnd(c)) {
        fail('INVALID_RANGE', `Split point ${op.frame} must be strictly inside the clip`);
      }
      const leftDuration = op.frame - c.start;
      const right = clone(c) as Clip;
      right.id = op.newClipId ?? newId('c');
      if (p.clips.some((x) => x.id === right.id))
        fail('VALIDATION', `Clip ${right.id} already exists`);
      right.start = op.frame;
      right.duration = c.duration - leftDuration;
      c.duration = leftDuration;
      if (isTimedMediaClip(right) && isTimedMediaClip(c)) {
        right.sourceInUs = c.sourceInUs + framesToSourceUs(leftDuration, p.sequence.fps, c.speed);
        right.audio.fadeIn = 0;
        c.audio.fadeOut = 0;
        clampFades(c);
        clampFades(right);
      }
      p.clips.splice(p.clips.indexOf(c) + 1, 0, right);
      ctx.created.push(right.id);
      return;
    }

    case 'trimClip': {
      const c = getClip(p, op.clipId);
      assertUnlocked(getTrack(p, c.trackId));
      const end = clipEnd(c);
      if (op.edge === 'start') {
        if (op.frame >= end) fail('INVALID_RANGE', 'Trim would make the clip empty');
        const delta = op.frame - c.start;
        if (isTimedMediaClip(c)) {
          const newIn = c.sourceInUs + framesToSourceUs(delta, p.sequence.fps, c.speed);
          if (newIn < 0)
            fail('INVALID_RANGE', 'Cannot extend before the start of the source media');
          c.sourceInUs = newIn;
        }
        c.start = op.frame;
        c.duration = end - op.frame;
      } else {
        if (op.frame <= c.start) fail('INVALID_RANGE', 'Trim would make the clip empty');
        c.duration = op.frame - c.start;
      }
      if (isTimedMediaClip(c)) clampFades(c);
      validateClipPlacement(p, c);
      return;
    }

    case 'duplicateClip': {
      const c = getClip(p, op.clipId);
      const copy = clone(c) as Clip;
      copy.id = op.newClipId ?? newId('c');
      if (p.clips.some((x) => x.id === copy.id))
        fail('VALIDATION', `Clip ${copy.id} already exists`);
      copy.start = op.start ?? clipEnd(c);
      copy.trackId = op.trackId ?? c.trackId;
      validateClipPlacement(p, copy);
      p.clips.push(copy);
      ctx.created.push(copy.id);
      return;
    }

    case 'setTransform': {
      const c = getClip(p, op.clipId);
      if (!('transform' in c)) fail('UNSUPPORTED', `${c.kind} clips have no visual transform`);
      const t = (c as Extract<Clip, { transform: unknown }>).transform;
      const { crop, ...rest } = op.transform;
      Object.assign(t, rest);
      if (crop) Object.assign(t.crop, crop);
      if (t.crop.left + t.crop.right > 0.98 || t.crop.top + t.crop.bottom > 0.98) {
        fail('INVALID_RANGE', 'Crop removes the entire image');
      }
      return;
    }

    case 'setAudio': {
      const c = getClip(p, op.clipId);
      if (!isTimedMediaClip(c)) fail('UNSUPPORTED', `${c.kind} clips have no audio`);
      const tc = c as TimedMediaClip;
      Object.assign(tc.audio, op.audio);
      if (tc.audio.fadeIn + tc.audio.fadeOut > tc.duration) {
        fail('INVALID_RANGE', 'Fade in + fade out cannot exceed the clip duration');
      }
      return;
    }

    case 'setSpeed': {
      const c = getClip(p, op.clipId);
      if (!isTimedMediaClip(c)) fail('UNSUPPORTED', `${c.kind} clips have no speed`);
      const tc = c as TimedMediaClip;
      assertUnlocked(getTrack(p, tc.trackId));
      const newDuration = Math.max(1, Math.round((tc.duration * tc.speed) / op.speed));
      const media =
        p.media.find((m) => m.id === tc.mediaId) ?? fail('NOT_FOUND', 'Media not found');
      tc.duration = Math.max(
        1,
        Math.min(newDuration, maxFramesFrom(media, tc.sourceInUs, p.sequence.fps, op.speed)),
      );
      tc.speed = op.speed;
      clampFades(tc);
      validateClipPlacement(p, tc);
      return;
    }

    case 'addTitle': {
      const track = op.trackId
        ? getTrack(p, op.trackId)
        : findOrCreateTrack(p, 'text', op.start, op.duration, ctx);
      const id = op.clipId ?? newId('c');
      const { crop, ...tRest } = op.transform ?? {};
      const clip: Clip = {
        id,
        kind: 'text',
        trackId: track.id,
        start: op.start,
        duration: op.duration,
        text: op.text,
        style: { ...DEFAULT_TITLE_STYLE, ...op.style },
        transform: { ...DEFAULT_TRANSFORM, ...tRest, crop: { ...DEFAULT_TRANSFORM.crop, ...crop } },
      };
      validateClipPlacement(p, clip);
      p.clips.push(clip);
      ctx.created.push(id);
      return;
    }

    case 'updateText': {
      const c = getClip(p, op.clipId);
      if (c.kind !== 'text' && c.kind !== 'caption')
        fail('UNSUPPORTED', `${c.kind} clips have no text`);
      const tc = c as Extract<Clip, { text: string }>;
      if (op.text !== undefined) tc.text = op.text;
      if (op.style) Object.assign(tc.style, op.style);
      return;
    }

    case 'addCaption': {
      const track = op.trackId
        ? getTrack(p, op.trackId)
        : findOrCreateTrack(p, 'caption', op.start, op.duration, ctx);
      const id = op.clipId ?? newId('c');
      const clip: Clip = {
        id,
        kind: 'caption',
        trackId: track.id,
        start: op.start,
        duration: op.duration,
        text: op.text,
        style: clone(DEFAULT_CAPTION_STYLE),
        transform: clone(DEFAULT_CAPTION_TRANSFORM),
      };
      validateClipPlacement(p, clip);
      p.clips.push(clip);
      ctx.created.push(id);
      return;
    }

    case 'setBeats': {
      const c = getClip(p, op.clipId);
      if (!isTimedMediaClip(c)) fail('UNSUPPORTED', `${c.kind} clips have no beat markers`);
      const tc = c as TimedMediaClip;
      const media =
        p.media.find((m) => m.id === tc.mediaId) ?? fail('NOT_FOUND', 'Media not found');
      tc.beatsUs = normalizeBeats(op.beatsUs, media.durationUs);
      return;
    }

    case 'replaceClipMedia': {
      const c = getClip(p, op.clipId);
      if (c.kind !== 'slot' && c.kind !== 'video' && c.kind !== 'image')
        fail('UNSUPPORTED', 'Only template slots, video and image clips can take new media');
      const old = c as Extract<Clip, { kind: 'slot' | 'video' | 'image' }>;
      assertUnlocked(getTrack(p, old.trackId));
      const media =
        p.media.find((m) => m.id === op.mediaId) ??
        fail('NOT_FOUND', `Media ${op.mediaId} not found`);
      if (media.kind === 'audio')
        fail('VALIDATION', 'Template slots and video clips need a video or an image, not audio');
      const slot = old.kind === 'slot' ? old.index : old.templateSlot;
      const slotProp = slot !== undefined ? { templateSlot: slot } : {};
      const transform = clone(old.transform);
      let next: Clip;
      if (media.kind === 'image') {
        next = {
          id: old.id,
          kind: 'image',
          trackId: old.trackId,
          start: old.start,
          duration: old.duration,
          mediaId: media.id,
          transform,
          ...slotProp,
        };
      } else {
        const speed = old.kind === 'video' ? old.speed : 1;
        const need = framesToSourceUs(old.duration, p.sequence.fps, speed);
        if (need > media.durationUs) {
          const what = slot !== undefined ? 'slot' : 'clip';
          fail(
            'INVALID_RANGE',
            `That video is ${fmtSeconds(media.durationUs)} long but this ${what} needs ` +
              `${fmtSeconds(need)}. Pick a longer video, or shorten the ${what}.`,
          );
        }
        const sourceInUs = Math.min(op.sourceInUs ?? 0, media.durationUs - need);
        const video: Clip = {
          id: old.id,
          kind: 'video',
          trackId: old.trackId,
          start: old.start,
          duration: old.duration,
          mediaId: media.id,
          sourceInUs,
          speed,
          transform,
          audio: old.kind === 'video' ? clone(old.audio) : clone(DEFAULT_AUDIO),
          beatsUs: [],
          ...slotProp,
        };
        clampFades(video);
        next = video;
      }
      p.clips[p.clips.indexOf(c)] = next;
      validateClipPlacement(p, next);
      return;
    }

    case 'slipClip': {
      const c = getClip(p, op.clipId);
      if (!isTimedMediaClip(c)) fail('UNSUPPORTED', `${c.kind} clips have no source to slip`);
      const tc = c as TimedMediaClip;
      assertUnlocked(getTrack(p, tc.trackId));
      const media =
        p.media.find((m) => m.id === tc.mediaId) ?? fail('NOT_FOUND', 'Media not found');
      const max = media.durationUs - framesToSourceUs(tc.duration, p.sequence.fps, tc.speed);
      if (op.sourceInUs > max) {
        fail(
          'INVALID_RANGE',
          `The clip would run past the end of the media; the latest start is ${fmtSeconds(Math.max(0, max))}`,
        );
      }
      tc.sourceInUs = op.sourceInUs;
      return;
    }

    case 'clearSlot': {
      const c = getClip(p, op.clipId);
      if (c.kind !== 'video' && c.kind !== 'image')
        fail('UNSUPPORTED', 'Only video and image clips can be turned back into a slot');
      const vc = c as Extract<Clip, { kind: 'video' | 'image' }>;
      assertUnlocked(getTrack(p, vc.trackId));
      let maxIndex = 0;
      for (const x of p.clips) {
        if (x.kind === 'slot') maxIndex = Math.max(maxIndex, x.index);
        else if ((x.kind === 'video' || x.kind === 'image') && x.templateSlot)
          maxIndex = Math.max(maxIndex, x.templateSlot);
      }
      const slot: Clip = {
        id: vc.id,
        kind: 'slot',
        trackId: vc.trackId,
        start: vc.start,
        duration: vc.duration,
        index: vc.templateSlot ?? maxIndex + 1,
        transform: clone(vc.transform),
      };
      p.clips[p.clips.indexOf(c)] = slot;
      return;
    }
  }
}
