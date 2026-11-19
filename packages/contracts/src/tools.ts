import { z } from 'zod';
import { FONTS } from '@viditor/composition';
import {
  DEFAULT_TITLE_STYLE,
  beatFrames,
  clipsAt,
  dbToGain,
  frameToSeconds,
  isTimedMediaClip,
  secondsToNearestFrame,
  secondsToUs,
  type Operation,
  type Project,
  type ProjectEngine,
  type TextStyle,
} from './deps.ts';
import { TITLE_PRESETS, planAddMedia } from './planning.ts';
import { planBeatTemplate, planFillSlots, sequenceOpsForFirstFill } from './templates.ts';
import type { ToolOutcome } from './protocol.ts';
import { clipView, projectView } from './views.ts';

/**
 * The assistant's tool surface. Definitions (name, description, input schema) are registered by
 * the MCP bridge; `run` executes inside the editor tab against the same ProjectEngine the UI uses,
 * so every assistant edit is validated, atomic, undoable and immediately visible.
 *
 * Deliberately absent: file access, imports and export. Those need the user's own file pickers.
 */

export interface BeatDetection {
  bpm: number | null;
  /** Marker positions in source microseconds of the media. */
  beatsUs: number[];
}

export interface ToolContext {
  engine: ProjectEngine;
  getPlayhead(): number;
  setPlayhead(frame: number): void;
  select(clipIds: string[]): void;
  /** Local beat analysis of a media file (runs in the editor; audio never leaves the tab). */
  detectBeats?(mediaId: string, mode: 'beat' | 'bass'): Promise<BeatDetection>;
}

type MaybePromise<T> = T | Promise<T>;

export interface ToolDef<S extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  title: string;
  description: string;
  shape: S;
  /** True if the tool never changes the project. */
  readOnly: boolean;
  destructive?: boolean;
  run(args: z.output<z.ZodObject<S>>, ctx: ToolContext): MaybePromise<ToolOutcome>;
}

function defineTool<S extends z.ZodRawShape>(def: ToolDef<S>): ToolDef<S> {
  return def;
}

/* -------------------------------------------------------------------------------------------- */
/* Shared argument pieces                                                                        */
/* -------------------------------------------------------------------------------------------- */

const MAX_SECONDS = 24 * 3600;
const seconds = (what: string) =>
  z.number().min(0).max(MAX_SECONDS).describe(`${what}, in seconds`);
const id = (what: string) => z.string().min(1).max(64).describe(what);
const hex = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/)
  .describe('Colour as #RRGGBB or #RRGGBBAA');
const fontFamily = z
  .enum(FONTS.map((f) => f.family) as [string, ...string[]])
  .describe('One of the bundled fonts');

const editGuards = {
  expectedRevision: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe(
      'Optional. Reject the edit with STALE_REVISION if the project changed since this revision (from get_project / get_timeline).',
    ),
  projectId: z
    .string()
    .optional()
    .describe('Optional. Reject the edit unless this project is the one open in the editor.'),
  opId: z
    .string()
    .max(100)
    .optional()
    .describe(
      'Optional idempotency key. Retrying with the same opId will not apply the edit twice.',
    ),
};
type Guards = { expectedRevision?: number; projectId?: string; opId?: string };

/* -------------------------------------------------------------------------------------------- */
/* Helpers                                                                                       */
/* -------------------------------------------------------------------------------------------- */

const fail = (code: string, message: string, data?: unknown): ToolOutcome => ({
  ok: false,
  errorCode: code,
  message,
  data,
});

function frames(project: Project, s: number) {
  return secondsToNearestFrame(s, project.sequence.fps);
}

function commit(
  ctx: ToolContext,
  guards: Guards,
  ops: Operation[],
  label: string,
  extra: Record<string, unknown> = {},
): ToolOutcome {
  const p = ctx.engine.project;
  if (guards.projectId && guards.projectId !== p.projectId) {
    return fail(
      'PROJECT_CHANGED',
      `The open project is "${p.name}" (${p.projectId}), not ${guards.projectId}. Call get_project again.`,
    );
  }
  const r = ctx.engine.apply({
    ops,
    opId: guards.opId,
    expectedRevision: guards.expectedRevision,
    label: `AI: ${label}`,
    origin: 'assistant',
  });
  if (!r.ok) {
    return {
      ok: false,
      errorCode: r.error.code,
      message: r.error.message,
      revision: r.revision,
      data: { opIndex: r.error.opIndex, issues: r.error.issues },
    };
  }
  const created = r.created;
  const createdClips = created.filter((x) => ctx.engine.project.clips.some((c) => c.id === x));
  if (createdClips.length) ctx.select(createdClips);
  return {
    ok: true,
    message: r.duplicate ? `${label} (already applied for this opId)` : label,
    revision: r.revision,
    data: { created, ...extra },
  };
}

function clipOr404(project: Project, clipId: string) {
  return project.clips.find((c) => c.id === clipId);
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Beat markers of a clip as timeline seconds (visible range only). */
function beatSeconds(project: Project, clipId: string): number[] {
  const c = clipOr404(project, clipId);
  if (!c) return [];
  return beatFrames(c, project.sequence.fps).map((f) =>
    r3(frameToSeconds(f, project.sequence.fps)),
  );
}

const MAX_LISTED_BEATS = 400;

/* -------------------------------------------------------------------------------------------- */
/* Tools                                                                                         */
/* -------------------------------------------------------------------------------------------- */

export const TOOLS = [
  defineTool({
    name: 'get_project',
    title: 'Get project overview',
    description:
      'Overview of the project open in Viditor: sequence format, duration, playhead, tracks (top layer first), media (IDs and generic labels) and the current revision. Call this first.',
    shape: {},
    readOnly: true,
    run(_args, ctx) {
      const p = ctx.engine.project;
      return {
        ok: true,
        message: 'Read project',
        revision: p.revision,
        data: projectView(p, ctx.getPlayhead()),
      };
    },
  }),

  defineTool({
    name: 'get_timeline',
    title: 'List timeline clips',
    description:
      'Clips on the timeline with IDs, track, start/end in seconds, source in-point, speed, audio and transform. Optionally limited to a time range or a track.',
    shape: {
      fromSeconds: seconds('Only clips ending after this time').optional(),
      toSeconds: seconds('Only clips starting before this time').optional(),
      trackId: id('Only clips on this track').optional(),
    },
    readOnly: true,
    run(args, ctx) {
      const p = ctx.engine.project;
      const from = args.fromSeconds !== undefined ? frames(p, args.fromSeconds) : -Infinity;
      const to = args.toSeconds !== undefined ? frames(p, args.toSeconds) : Infinity;
      const order = new Map(p.tracks.map((t, i) => [t.id, i]));
      const clips = p.clips
        .filter(
          (c) =>
            (!args.trackId || c.trackId === args.trackId) &&
            c.start < to &&
            c.start + c.duration > from,
        )
        .sort((a, b) => order.get(a.trackId)! - order.get(b.trackId)! || a.start - b.start)
        .map((c) => clipView(c, p));
      return {
        ok: true,
        message: `Read ${clips.length} clips`,
        revision: p.revision,
        data: { revision: p.revision, clips },
      };
    },
  }),

  defineTool({
    name: 'add_media_to_timeline',
    title: 'Add media to the timeline',
    description:
      'Place an imported media item (by mediaId from get_project) on the timeline. Uses the first compatible track with room unless trackId is given; creates a track if needed. Images default to 5 s. The first video on an empty timeline sets the sequence format to match it. Importing new files is done by the user in the editor.',
    shape: {
      mediaId: id('Media ID'),
      startSeconds: seconds('Timeline position')
        .optional()
        .describe('Timeline position in seconds (default: playhead)'),
      durationSeconds: seconds('Length to use (default: whole media; images 5 s)').optional(),
      trackId: id('Target track').optional(),
      ...editGuards,
    },
    readOnly: false,
    run(args, ctx) {
      const p = ctx.engine.project;
      const start =
        args.startSeconds !== undefined ? frames(p, args.startSeconds) : ctx.getPlayhead();
      const plan = planAddMedia(p, {
        mediaId: args.mediaId,
        start,
        trackId: args.trackId,
        durationFrames:
          args.durationSeconds !== undefined
            ? Math.max(1, frames(p, args.durationSeconds))
            : undefined,
      });
      if ('error' in plan) return fail(plan.code, plan.error);
      return commit(ctx, args, plan.ops, 'Add media to timeline', {
        clipId: plan.clipId,
        trackId: plan.trackId,
        ...(plan.sequenceNotice ? { notice: plan.sequenceNotice } : {}),
      });
    },
  }),

  defineTool({
    name: 'split_clip',
    title: 'Split clips',
    description:
      'Split clips at a time. With clipIds, splits only those; otherwise splits every clip under that time on unlocked tracks. Returns the IDs of the new right-hand pieces.',
    shape: {
      atSeconds: seconds('Split point'),
      clipIds: z.array(id('Clip ID')).max(100).optional(),
      ...editGuards,
    },
    readOnly: false,
    run(args, ctx) {
      const p = ctx.engine.project;
      const at = frames(p, args.atSeconds);
      const locked = new Set(p.tracks.filter((t) => t.locked).map((t) => t.id));
      const under = clipsAt(p, at).filter((c) => c.start < at && !locked.has(c.trackId));
      const targets = args.clipIds ? under.filter((c) => args.clipIds!.includes(c.id)) : under;
      if (!targets.length) return fail('INVALID_RANGE', `No splittable clip at ${args.atSeconds}s`);
      return commit(
        ctx,
        args,
        targets.map((c) => ({ type: 'splitClip' as const, clipId: c.id, frame: at })),
        `Split ${targets.length} clip${targets.length > 1 ? 's' : ''} at ${args.atSeconds}s`,
      );
    },
  }),

  defineTool({
    name: 'trim_clip',
    title: 'Trim a clip',
    description:
      'Move the start or end edge of a clip to a timeline time (seconds). Trimming the start of a video/audio clip also advances its source in-point, so the content stays in place.',
    shape: {
      clipId: id('Clip ID'),
      edge: z.enum(['start', 'end']).describe('Which edge to move'),
      toSeconds: seconds('New position of that edge on the timeline'),
      ...editGuards,
    },
    readOnly: false,
    run(args, ctx) {
      const p = ctx.engine.project;
      return commit(
        ctx,
        args,
        [
          {
            type: 'trimClip',
            clipId: args.clipId,
            edge: args.edge,
            frame: frames(p, args.toSeconds),
          },
        ],
        `Trim ${args.edge} of clip to ${args.toSeconds}s`,
      );
    },
  }),

  defineTool({
    name: 'move_clip',
    title: 'Move a clip',
    description:
      'Move a clip to a new start time, optionally onto another track of a compatible kind. Clips on one track cannot overlap.',
    shape: {
      clipId: id('Clip ID'),
      startSeconds: seconds('New start time'),
      trackId: id('Destination track').optional(),
      ...editGuards,
    },
    readOnly: false,
    run(args, ctx) {
      const p = ctx.engine.project;
      return commit(
        ctx,
        args,
        [
          {
            type: 'moveClip',
            clipId: args.clipId,
            start: frames(p, args.startSeconds),
            trackId: args.trackId,
          },
        ],
        `Move clip to ${args.startSeconds}s`,
      );
    },
  }),

  defineTool({
    name: 'delete_clips',
    title: 'Delete clips',
    description: 'Remove clips from the timeline. The media stays in the project. Undoable.',
    shape: { clipIds: z.array(id('Clip ID')).min(1).max(200), ...editGuards },
    readOnly: false,
    destructive: true,
    run(args, ctx) {
      return commit(
        ctx,
        args,
        args.clipIds.map((clipId) => ({ type: 'deleteClip' as const, clipId })),
        `Delete ${args.clipIds.length} clip${args.clipIds.length > 1 ? 's' : ''}`,
      );
    },
  }),

  defineTool({
    name: 'duplicate_clip',
    title: 'Duplicate a clip',
    description:
      'Copy a clip (with all its settings). By default the copy goes right after the original on the same track.',
    shape: {
      clipId: id('Clip ID'),
      startSeconds: seconds('Start of the copy').optional(),
      trackId: id('Track for the copy').optional(),
      ...editGuards,
    },
    readOnly: false,
    run(args, ctx) {
      const p = ctx.engine.project;
      return commit(
        ctx,
        args,
        [
          {
            type: 'duplicateClip',
            clipId: args.clipId,
            start: args.startSeconds !== undefined ? frames(p, args.startSeconds) : undefined,
            trackId: args.trackId,
          },
        ],
        'Duplicate clip',
      );
    },
  }),

  defineTool({
    name: 'add_title',
    title: 'Add a title',
    description: `Add an editable text overlay. Presets: ${TITLE_PRESETS.map((p) => `"${p.id}" (${p.name})`).join(', ')}. Position x/y is the offset of the text centre from the frame centre as a fraction of width/height (-0.5..0.5 is on screen; y=0.36 is the lower area). fontSize is in sequence pixels.`,
    shape: {
      text: z.string().min(1).max(2000).describe('Text; use \\n for line breaks'),
      startSeconds: seconds('Start time'),
      durationSeconds: z
        .number()
        .min(0.04)
        .max(MAX_SECONDS)
        .describe('How long it stays on screen, in seconds'),
      preset: z.enum(TITLE_PRESETS.map((p) => p.id) as [string, ...string[]]).optional(),
      fontFamily: fontFamily.optional(),
      fontSize: z.number().min(8).max(1000).optional(),
      color: hex.optional(),
      bold: z.boolean().optional(),
      align: z.enum(['left', 'center', 'right']).optional(),
      background: hex.nullable().optional().describe('Background box colour, or null for none'),
      x: z.number().min(-2).max(2).optional(),
      y: z.number().min(-2).max(2).optional(),
      ...editGuards,
    },
    readOnly: false,
    run(args, ctx) {
      const p = ctx.engine.project;
      const preset = TITLE_PRESETS.find((x) => x.id === (args.preset ?? 'title'))!;
      const style: Partial<TextStyle> = { ...DEFAULT_TITLE_STYLE, ...preset.style };
      if (args.fontFamily) style.fontFamily = args.fontFamily;
      if (args.fontSize) style.fontSize = args.fontSize;
      if (args.color) style.color = args.color;
      if (args.bold !== undefined) style.fontWeight = args.bold ? 700 : 400;
      if (args.align) style.align = args.align;
      if (args.background !== undefined) style.background = args.background;
      const font = FONTS.find((f) => f.family === style.fontFamily);
      if (font && !font.weights.includes(style.fontWeight!)) style.fontWeight = font.weights[0]!;
      const transform = { ...preset.transform };
      if (args.x !== undefined) transform.x = args.x;
      if (args.y !== undefined) transform.y = args.y;
      return commit(
        ctx,
        args,
        [
          {
            type: 'addTitle',
            start: frames(p, args.startSeconds),
            duration: Math.max(1, frames(p, args.durationSeconds)),
            text: args.text,
            style,
            transform,
          },
        ],
        'Add title',
      );
    },
  }),

  defineTool({
    name: 'update_text',
    title: 'Edit title or caption text/style',
    description: 'Change the text and/or style of a title or caption clip.',
    shape: {
      clipId: id('Title or caption clip ID'),
      text: z.string().max(2000).optional(),
      fontFamily: fontFamily.optional(),
      fontSize: z.number().min(8).max(1000).optional(),
      color: hex.optional(),
      bold: z.boolean().optional(),
      align: z.enum(['left', 'center', 'right']).optional(),
      background: hex.nullable().optional().describe('Background box colour, or null for none'),
      ...editGuards,
    },
    readOnly: false,
    run(args, ctx) {
      const style: Partial<TextStyle> = {};
      if (args.fontFamily) style.fontFamily = args.fontFamily;
      if (args.fontSize) style.fontSize = args.fontSize;
      if (args.color) style.color = args.color;
      if (args.bold !== undefined) style.fontWeight = args.bold ? 700 : 400;
      if (args.align) style.align = args.align;
      if (args.background !== undefined) style.background = args.background;
      return commit(
        ctx,
        args,
        [
          {
            type: 'updateText',
            clipId: args.clipId,
            text: args.text,
            style: Object.keys(style).length ? style : undefined,
          },
        ],
        'Edit text',
      );
    },
  }),

  defineTool({
    name: 'set_transform',
    title: 'Set position, scale, rotation, opacity or crop',
    description:
      'Change visual properties of a video, image, title or caption clip. x/y: offset of the layer centre from the frame centre as a fraction of width/height. scale: 1 = fitted to the frame. rotation in degrees. opacity 0..1. crop: fraction removed from each edge (0..0.49).',
    shape: {
      clipId: id('Clip ID'),
      x: z.number().min(-4).max(4).optional(),
      y: z.number().min(-4).max(4).optional(),
      scale: z.number().min(0.01).max(20).optional(),
      rotation: z.number().min(-3600).max(3600).optional(),
      opacity: z.number().min(0).max(1).optional(),
      crop: z
        .object({
          left: z.number().min(0).max(0.49).optional(),
          right: z.number().min(0).max(0.49).optional(),
          top: z.number().min(0).max(0.49).optional(),
          bottom: z.number().min(0).max(0.49).optional(),
        })
        .optional(),
      ...editGuards,
    },
    readOnly: false,
    run(args, ctx) {
      const { clipId, x, y, scale, rotation, opacity, crop } = args;
      const transform = Object.fromEntries(
        Object.entries({ x, y, scale, rotation, opacity, crop }).filter(([, v]) => v !== undefined),
      );
      if (!Object.keys(transform).length) return fail('VALIDATION', 'Nothing to change');
      return commit(ctx, args, [{ type: 'setTransform', clipId, transform }], 'Transform clip');
    },
  }),

  defineTool({
    name: 'set_audio',
    title: 'Set volume, mute or fades',
    description:
      'Audio settings for a video or audio clip. volumeDb: -60 (silent) to +12. Fades are linear, in seconds.',
    shape: {
      clipId: id('Video or audio clip ID'),
      volumeDb: z.number().min(-60).max(12).optional(),
      mute: z.boolean().optional(),
      fadeInSeconds: seconds('Fade-in length').optional(),
      fadeOutSeconds: seconds('Fade-out length').optional(),
      ...editGuards,
    },
    readOnly: false,
    run(args, ctx) {
      const p = ctx.engine.project;
      const audio: Record<string, number | boolean> = {};
      if (args.volumeDb !== undefined) audio.gain = Math.min(4, dbToGain(args.volumeDb));
      if (args.mute !== undefined) audio.mute = args.mute;
      if (args.fadeInSeconds !== undefined) audio.fadeIn = frames(p, args.fadeInSeconds);
      if (args.fadeOutSeconds !== undefined) audio.fadeOut = frames(p, args.fadeOutSeconds);
      if (!Object.keys(audio).length) return fail('VALIDATION', 'Nothing to change');
      return commit(ctx, args, [{ type: 'setAudio', clipId: args.clipId, audio }], 'Adjust audio');
    },
  }),

  defineTool({
    name: 'set_speed',
    title: 'Change clip speed',
    description:
      'Constant speed for a video or audio clip (0.1–10; 2 = twice as fast). The clip length changes accordingly; audio pitch follows speed. Fails if a slower clip would overlap the next clip.',
    shape: {
      clipId: id('Video or audio clip ID'),
      speed: z.number().min(0.1).max(10),
      ...editGuards,
    },
    readOnly: false,
    run(args, ctx) {
      return commit(
        ctx,
        args,
        [{ type: 'setSpeed', clipId: args.clipId, speed: args.speed }],
        `Speed ${args.speed}×`,
      );
    },
  }),

  defineTool({
    name: 'add_captions',
    title: 'Add captions',
    description:
      'Add one or more timed captions (subtitle-style text in the lower area). Placed on caption tracks; overlapping captions go on an extra caption track.',
    shape: {
      captions: z
        .array(
          z.object({
            text: z.string().min(1).max(2000),
            startSeconds: seconds('Caption start'),
            endSeconds: seconds('Caption end'),
          }),
        )
        .min(1)
        .max(500),
      ...editGuards,
    },
    readOnly: false,
    run(args, ctx) {
      const p = ctx.engine.project;
      const ops: Operation[] = [];
      for (const c of args.captions) {
        const start = frames(p, c.startSeconds);
        const end = frames(p, c.endSeconds);
        if (end <= start)
          return fail('INVALID_RANGE', `Caption "${c.text.slice(0, 30)}" ends before it starts`);
        ops.push({ type: 'addCaption', start, duration: end - start, text: c.text });
      }
      return commit(ctx, args, ops, `Add ${ops.length} caption${ops.length > 1 ? 's' : ''}`);
    },
  }),

  defineTool({
    name: 'set_track',
    title: 'Mute, hide, lock or rename a track',
    description:
      'Track settings. Hidden tracks are not rendered; muted tracks are silent; locked tracks cannot be edited.',
    shape: {
      trackId: id('Track ID'),
      name: z.string().min(1).max(64).optional(),
      muted: z.boolean().optional(),
      hidden: z.boolean().optional(),
      locked: z.boolean().optional(),
      ...editGuards,
    },
    readOnly: false,
    run(args, ctx) {
      const { trackId, name, muted, hidden, locked } = args;
      return commit(
        ctx,
        args,
        [{ type: 'updateTrack', trackId, name, muted, hidden, locked }],
        'Update track',
      );
    },
  }),

  defineTool({
    name: 'detect_beats',
    title: 'Detect beats in music',
    description:
      'Analyse the music of an audio or video clip locally in the editor and place beat markers on it (replacing existing ones). mode "beat" finds the steady pulse; "bass" finds kick/bass hits, including off-beat ones. Returns the tempo and the marker times on the timeline. Follow with create_beat_template to cut a template on the beats.',
    shape: {
      clipId: id('Audio or video clip holding the music'),
      mode: z.enum(['beat', 'bass']).optional().describe('Default "beat"'),
      ...editGuards,
    },
    readOnly: false,
    async run(args, ctx) {
      const p = ctx.engine.project;
      const clip = clipOr404(p, args.clipId);
      if (!clip) return fail('NOT_FOUND', `Clip ${args.clipId} not found`);
      if (!isTimedMediaClip(clip))
        return fail('UNSUPPORTED', 'Beats can only be detected on audio or video clips');
      if (!ctx.detectBeats) return fail('UNSUPPORTED', 'Beat detection is not available here');
      let r: BeatDetection;
      try {
        r = await ctx.detectBeats(clip.mediaId, args.mode ?? 'beat');
      } catch (e) {
        return fail('ANALYSIS_FAILED', e instanceof Error ? e.message : String(e));
      }
      const out = commit(
        ctx,
        args,
        [{ type: 'setBeats', clipId: clip.id, beatsUs: r.beatsUs }],
        `Detect ${args.mode ?? 'beat'} markers`,
      );
      if (!out.ok) return out;
      const times = beatSeconds(ctx.engine.project, clip.id);
      return {
        ...out,
        message: `${times.length} ${args.mode === 'bass' ? 'bass hits' : 'beats'} marked${r.bpm ? ` (~${r.bpm} BPM)` : ''}`,
        data: {
          bpm: r.bpm,
          markerCount: times.length,
          markerSeconds: times.slice(0, MAX_LISTED_BEATS),
          truncated: times.length > MAX_LISTED_BEATS,
        },
      };
    },
  }),

  defineTool({
    name: 'get_beats',
    title: 'List beat markers',
    description:
      'Beat markers of a clip, as timeline seconds (only those inside the visible clip).',
    shape: { clipId: id('Clip ID') },
    readOnly: true,
    run(args, ctx) {
      const p = ctx.engine.project;
      if (!clipOr404(p, args.clipId)) return fail('NOT_FOUND', `Clip ${args.clipId} not found`);
      const times = beatSeconds(p, args.clipId);
      return {
        ok: true,
        message: `${times.length} beat markers`,
        revision: p.revision,
        data: {
          markerSeconds: times.slice(0, MAX_LISTED_BEATS),
          truncated: times.length > MAX_LISTED_BEATS,
        },
      };
    },
  }),

  defineTool({
    name: 'set_beats',
    title: 'Set beat markers',
    description:
      'Replace the beat markers of an audio or video clip with these timeline times (seconds). Markers stay attached to the music if the clip is moved or trimmed.',
    shape: {
      clipId: id('Audio or video clip ID'),
      markerSeconds: z.array(seconds('Marker time on the timeline')).max(20_000),
      ...editGuards,
    },
    readOnly: false,
    run(args, ctx) {
      const p = ctx.engine.project;
      const clip = clipOr404(p, args.clipId);
      if (!clip) return fail('NOT_FOUND', `Clip ${args.clipId} not found`);
      if (!isTimedMediaClip(clip))
        return fail('UNSUPPORTED', 'Only audio and video clips have beat markers');
      const startS = frameToSeconds(clip.start, p.sequence.fps);
      const beatsUs = args.markerSeconds
        .map((s) => clip.sourceInUs + secondsToUs((s - startS) * clip.speed))
        .filter((us) => us >= 0);
      return commit(
        ctx,
        args,
        [{ type: 'setBeats', clipId: clip.id, beatsUs }],
        `Set ${beatsUs.length} beat markers`,
      );
    },
  }),

  defineTool({
    name: 'create_beat_template',
    title: 'Create a beat template',
    description:
      'Cut a template on the beat markers of a music clip: a new "Template" video track (above the other video) with numbered empty slots whose edges sit exactly on every Nth beat. Then fill the slots with fill_slots; each video plays for exactly its slot, so cuts land on the beat.',
    shape: {
      clipId: id('The music clip (with beat markers)'),
      everyNBeats: z
        .number()
        .int()
        .min(1)
        .max(64)
        .optional()
        .describe('Cut every N beats (default 1)'),
      fromSeconds: seconds('Template start (default: start of the music clip)').optional(),
      toSeconds: seconds('Template end (default: end of the music clip)').optional(),
      ...editGuards,
    },
    readOnly: false,
    run(args, ctx) {
      const p = ctx.engine.project;
      const plan = planBeatTemplate(p, {
        clipId: args.clipId,
        every: args.everyNBeats,
        fromFrame: args.fromSeconds !== undefined ? frames(p, args.fromSeconds) : undefined,
        toFrame: args.toSeconds !== undefined ? frames(p, args.toSeconds) : undefined,
      });
      if ('error' in plan) return fail(plan.code, plan.error);
      const fps = p.sequence.fps;
      const out = commit(
        ctx,
        args,
        plan.ops,
        `Create beat template (${plan.slotIds.length} slots)`,
        {
          trackId: plan.trackId,
          slots: plan.slotIds.map((slotId, i) => ({
            slotId,
            number: i + 1,
            startSeconds: r3(frameToSeconds(plan.boundaries[i]!, fps)),
            durationSeconds: r3(frameToSeconds(plan.boundaries[i + 1]! - plan.boundaries[i]!, fps)),
          })),
        },
      );
      if (out.ok) ctx.select([]);
      return out;
    },
  }),

  defineTool({
    name: 'fill_slots',
    title: 'Fill template slots',
    description:
      'Put videos or images into empty template slots. Either give explicit fills (slot clip ID + mediaId, optionally where in the video to start), or autoFillWith a list of mediaIds to fill every empty slot in order, cycling through the list (repeated videos continue from where they left off). Videos shorter than a slot are skipped for that slot. One undo step.',
    shape: {
      fills: z
        .array(
          z.object({
            slotId: id('Slot clip ID (or a filled template clip, to swap it)'),
            mediaId: id('Video or image media ID'),
            sourceInSeconds: seconds('Where in the video this slot starts').optional(),
          }),
        )
        .max(1000)
        .optional(),
      autoFillWith: z.array(id('Media ID')).max(200).optional(),
      ...editGuards,
    },
    readOnly: false,
    run(args, ctx) {
      const p = ctx.engine.project;
      if (args.fills?.length) {
        return commit(
          ctx,
          args,
          [
            ...sequenceOpsForFirstFill(p, args.fills[0]!.mediaId),
            ...args.fills.map((f) => ({
              type: 'replaceClipMedia' as const,
              clipId: f.slotId,
              mediaId: f.mediaId,
              sourceInUs:
                f.sourceInSeconds !== undefined ? secondsToUs(f.sourceInSeconds) : undefined,
            })),
          ],
          `Fill ${args.fills.length} slot${args.fills.length > 1 ? 's' : ''}`,
        );
      }
      if (!args.autoFillWith?.length) return fail('VALIDATION', 'Give fills or autoFillWith');
      const plan = planFillSlots(p, args.autoFillWith);
      if ('error' in plan) return fail(plan.code, plan.error);
      if (!plan.ops.length)
        return fail('INVALID_RANGE', 'Every video is shorter than the slots it would fill');
      return commit(ctx, args, plan.ops, `Fill ${plan.filled.length} slots`, {
        skippedSlots: plan.skipped,
      });
    },
  }),

  defineTool({
    name: 'slip_clip',
    title: 'Choose which part of a video shows',
    description:
      'Change which part of the source a video/audio clip plays without moving or resizing it on the timeline (a slip edit). Ideal for template slots: the cut stays on the beat while a different moment of the video shows.',
    shape: {
      clipId: id('Video or audio clip ID'),
      sourceInSeconds: seconds('Where in the source the clip should start'),
      ...editGuards,
    },
    readOnly: false,
    run(args, ctx) {
      return commit(
        ctx,
        args,
        [{ type: 'slipClip', clipId: args.clipId, sourceInUs: secondsToUs(args.sourceInSeconds) }],
        `Show from ${args.sourceInSeconds}s of the source`,
      );
    },
  }),

  defineTool({
    name: 'apply_operations',
    title: 'Apply raw engine operations (advanced)',
    description:
      'Apply a batch of low-level Viditor engine operations atomically: all succeed or none do, and the batch is one undo step. Units are FRAMES at the sequence frame rate (see get_project), and source times are microseconds. Prefer the specific tools; use this for multi-step edits that must be atomic. Operation types: renameProject, setSequence, addTrack, updateTrack, moveTrack, removeTrack, addClip, deleteClip, moveClip, splitClip, trimClip, duplicateClip, setTransform, setAudio, setSpeed, addTitle, updateText, addCaption, setBeats, replaceClipMedia, slipClip, clearSlot.',
    shape: {
      operations: z.array(z.record(z.string(), z.unknown())).min(1).max(500),
      label: z.string().max(80).optional().describe('Short description shown in the undo history'),
      ...editGuards,
    },
    readOnly: false,
    run(args, ctx) {
      const banned = args.operations.find((o) =>
        ['addMedia', 'updateMedia', 'removeMedia', 'setPrivacy', 'setExportSettings'].includes(
          String(o.type),
        ),
      );
      if (banned) return fail('UNSUPPORTED', `"${String(banned.type)}" is reserved for the user`);
      return commit(
        ctx,
        args,
        args.operations as unknown as Operation[],
        args.label ?? `Apply ${args.operations.length} operations`,
      );
    },
  }),

  defineTool({
    name: 'undo',
    title: 'Undo',
    description:
      'Undo the most recent change to the project (by anyone). Each tool call above is one step.',
    shape: {},
    readOnly: false,
    run(_args, ctx) {
      const label = ctx.engine.undoLabel;
      if (!ctx.engine.undo()) return fail('NOTHING_TO_UNDO', 'Nothing to undo');
      return { ok: true, message: `Undid "${label}"`, revision: ctx.engine.revision };
    },
  }),

  defineTool({
    name: 'redo',
    title: 'Redo',
    description: 'Redo the most recently undone change.',
    shape: {},
    readOnly: false,
    run(_args, ctx) {
      const label = ctx.engine.redoLabel;
      if (!ctx.engine.redo()) return fail('NOTHING_TO_REDO', 'Nothing to redo');
      return { ok: true, message: `Redid "${label}"`, revision: ctx.engine.revision };
    },
  }),

  defineTool({
    name: 'show_in_editor',
    title: 'Move the playhead / select clips',
    description:
      "Point the user at something: move the editor's playhead to a time and/or select clips. Does not change the project.",
    shape: {
      seconds: seconds('Playhead position').optional(),
      clipIds: z.array(id('Clip ID')).max(100).optional(),
    },
    readOnly: true,
    run(args, ctx) {
      const p = ctx.engine.project;
      if (args.seconds !== undefined) ctx.setPlayhead(frames(p, args.seconds));
      if (args.clipIds) {
        const missing = args.clipIds.filter((c) => !clipOr404(p, c));
        if (missing.length) return fail('NOT_FOUND', `Unknown clip(s): ${missing.join(', ')}`);
        ctx.select(args.clipIds);
      }
      return {
        ok: true,
        message:
          `Showing ${args.seconds !== undefined ? `${args.seconds}s` : ''}${args.clipIds ? ` ${args.clipIds.length} clip(s)` : ''}`.trim(),
        revision: p.revision,
        data: { playheadSeconds: frameToSeconds(ctx.getPlayhead(), p.sequence.fps) },
      };
    },
  }),
] as const satisfies readonly ToolDef<z.ZodRawShape>[];

export type ToolName = (typeof TOOLS)[number]['name'];

const BY_NAME = new Map<string, ToolDef<z.ZodRawShape>>(
  TOOLS.map((t) => [t.name, t as unknown as ToolDef<z.ZodRawShape>]),
);

export function getTool(name: string): ToolDef<z.ZodRawShape> | undefined {
  return BY_NAME.get(name);
}

/**
 * Validate and execute a tool call inside the editor. Never throws (a returned promise never
 * rejects). Only tools that need local analysis (detect_beats) are asynchronous.
 */
export function runTool(
  name: string,
  rawArgs: unknown,
  ctx: ToolContext,
): MaybePromise<ToolOutcome> {
  const def = BY_NAME.get(name);
  if (!def) return fail('UNKNOWN_TOOL', `Unknown tool ${name}`);
  const parsed = z.object(def.shape).safeParse(rawArgs ?? {});
  if (!parsed.success) {
    return fail(
      'VALIDATION',
      'Invalid arguments',
      parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  const internal = (e: unknown) => fail('INTERNAL', e instanceof Error ? e.message : String(e));
  try {
    const out = def.run(parsed.data, ctx);
    return out instanceof Promise ? out.catch(internal) : out;
  } catch (e) {
    return internal(e);
  }
}

export const SERVER_INSTRUCTIONS = `Viditor is a video editor running in the user's browser; these tools edit the project open there, live.
- Call get_project first, then get_timeline for clip IDs. All times are seconds.
- Every edit is validated, applied atomically and appears in the user's timeline immediately; each tool call is one undo step (undo tool, or Ctrl+Z in the editor).
- Pass expectedRevision from your last read when an edit depends on what you read; on STALE_REVISION, re-read and retry.
- You can only see metadata (IDs, timing, generic media labels), not the footage itself. File names and title text are hidden unless the user enabled sharing in the editor's AI panel.
- Importing files and exporting video are done by the user in the editor.
- Beat-sync editing: detect_beats on the music clip, create_beat_template, then fill_slots; slip_clip picks which moment of a video shows in its slot without moving the cut.`;
