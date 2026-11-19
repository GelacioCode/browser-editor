import { z } from 'zod';

// The site ships a strict Content-Security-Policy without 'unsafe-eval'; keep zod off its
// `new Function` JIT path so validation never trips the CSP.
z.config({ jitless: true });

export const SCHEMA_VERSION = 2 as const;

export const IdSchema = z.string().min(1).max(64);
export const HexColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/, 'Expected #RRGGBB or #RRGGBBAA');

export const RationalSchema = z.object({
  num: z.number().int().positive().max(1_000_000),
  den: z.number().int().positive().max(1_000_000),
});

/**
 * Visual transform, relative to the sequence frame.
 * x/y: offset of the layer centre from the frame centre, as a fraction of frame width/height.
 * scale: 1 = media fitted ("contain") into the frame.
 * crop: fraction of the source removed from each edge.
 */
export const TransformSchema = z.object({
  x: z.number().min(-4).max(4),
  y: z.number().min(-4).max(4),
  scale: z.number().min(0.01).max(20),
  rotation: z.number().min(-3600).max(3600),
  opacity: z.number().min(0).max(1),
  crop: z.object({
    left: z.number().min(0).max(0.49),
    right: z.number().min(0).max(0.49),
    top: z.number().min(0).max(0.49),
    bottom: z.number().min(0).max(0.49),
  }),
});

/** gain is linear (1 = unity, max 4 ≈ +12 dB). Fades are in timeline frames. */
export const AudioPropsSchema = z.object({
  gain: z.number().min(0).max(4),
  mute: z.boolean(),
  fadeIn: z.number().int().min(0),
  fadeOut: z.number().int().min(0),
});

export const TextStyleSchema = z.object({
  fontFamily: z.string().min(1).max(64),
  fontWeight: z.number().int().min(100).max(900),
  /** Font size in sequence pixels. */
  fontSize: z.number().min(4).max(1000),
  color: HexColorSchema,
  align: z.enum(['left', 'center', 'right']),
  lineHeight: z.number().min(0.5).max(3),
  background: HexColorSchema.nullable(),
  strokeColor: HexColorSchema.nullable(),
  strokeWidth: z.number().min(0).max(50),
});

export const MediaKindSchema = z.enum(['video', 'image', 'audio']);

export const MediaItemSchema = z.object({
  id: IdSchema,
  kind: MediaKindSchema,
  /** Original file name. UI-only; never sent to AI tools unless explicitly shared. */
  name: z.string().max(255),
  /** Generic label safe to expose to assistants (e.g. "Video 1"). */
  label: z.string().max(64),
  durationUs: z.number().int().min(0),
  width: z.number().int().min(0),
  height: z.number().int().min(0),
  fps: z.number().min(0).nullable(),
  hasVideo: z.boolean(),
  hasAudio: z.boolean(),
  sampleRate: z.number().int().min(0).nullable(),
  channels: z.number().int().min(0).nullable(),
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  sizeBytes: z.number().int().min(0),
  lastModified: z.number().int().min(0),
  /** Path relative to the project folder when the file lives inside it. */
  relativePath: z.string().max(1024).nullable(),
});

const ClipBase = {
  id: IdSchema,
  trackId: IdSchema,
  /** Timeline start, in frames. */
  start: z.number().int().min(0),
  /** Timeline duration, in frames. */
  duration: z
    .number()
    .int()
    .min(1)
    .max(60 * 60 * 24 * 120),
};

/**
 * Beat markers, in source microseconds of the clip's media. Stored for the whole media (not just
 * the visible range), so moving, trimming or splitting the clip keeps them on the music.
 */
export const BeatsSchema = z
  .array(z.number().int().min(0))
  .max(20_000)
  .default(() => []);

/** Number of the beat-template slot this clip fills (1-based), if any. */
const TemplateSlotSchema = z.number().int().min(1).max(100_000).optional();

export const VideoClipSchema = z.object({
  ...ClipBase,
  kind: z.literal('video'),
  mediaId: IdSchema,
  sourceInUs: z.number().int().min(0),
  speed: z.number().min(0.1).max(10),
  transform: TransformSchema,
  audio: AudioPropsSchema,
  beatsUs: BeatsSchema,
  templateSlot: TemplateSlotSchema,
});

export const AudioClipSchema = z.object({
  ...ClipBase,
  kind: z.literal('audio'),
  mediaId: IdSchema,
  sourceInUs: z.number().int().min(0),
  speed: z.number().min(0.1).max(10),
  audio: AudioPropsSchema,
  beatsUs: BeatsSchema,
});

export const ImageClipSchema = z.object({
  ...ClipBase,
  kind: z.literal('image'),
  mediaId: IdSchema,
  transform: TransformSchema,
  templateSlot: TemplateSlotSchema,
});

/**
 * An empty beat-template slot: a placeholder with fixed timing that a video or image fills.
 * It renders nothing (lower tracks show through); the preview overlays a hint instead.
 */
export const SlotClipSchema = z.object({
  ...ClipBase,
  kind: z.literal('slot'),
  index: z.number().int().min(1).max(100_000),
  transform: TransformSchema,
});

export const TextClipSchema = z.object({
  ...ClipBase,
  kind: z.literal('text'),
  text: z.string().max(2000),
  style: TextStyleSchema,
  transform: TransformSchema,
});

export const CaptionClipSchema = z.object({
  ...ClipBase,
  kind: z.literal('caption'),
  text: z.string().max(2000),
  style: TextStyleSchema,
  transform: TransformSchema,
});

export const ClipSchema = z.discriminatedUnion('kind', [
  VideoClipSchema,
  AudioClipSchema,
  ImageClipSchema,
  TextClipSchema,
  CaptionClipSchema,
  SlotClipSchema,
]);

export const TrackKindSchema = z.enum(['video', 'audio', 'text', 'caption']);

export const TrackSchema = z.object({
  id: IdSchema,
  kind: TrackKindSchema,
  name: z.string().max(64),
  muted: z.boolean(),
  hidden: z.boolean(),
  locked: z.boolean(),
});

export const SequenceSchema = z.object({
  width: z.number().int().min(16).max(7680),
  height: z.number().int().min(16).max(7680),
  fps: RationalSchema,
  background: HexColorSchema,
});

export const ExportQualitySchema = z.enum(['low', 'medium', 'high', 'very-high']);

export const ExportSettingsSchema = z.object({
  container: z.literal('mp4'),
  videoCodec: z.literal('avc'),
  audioCodec: z.literal('aac'),
  /** Output height; width follows the sequence aspect ratio. */
  height: z.number().int().min(144).max(2160),
  quality: ExportQualitySchema,
});

/** Everything defaults to "do not share". Enforced by the future MCP bridge. */
export const PrivacySettingsSchema = z.object({
  shareFileNames: z.boolean(),
  shareTextContent: z.boolean(),
  shareFrames: z.boolean(),
  shareAudio: z.boolean(),
  shareTranscripts: z.boolean(),
});

export const ProjectSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  projectId: IdSchema,
  name: z.string().min(1).max(120),
  createdAt: z.string(),
  updatedAt: z.string(),
  revision: z.number().int().min(0),
  sequence: SequenceSchema,
  media: z.array(MediaItemSchema),
  /** Ordered top-to-bottom as shown in the timeline. Index 0 is the topmost visual layer. */
  tracks: z.array(TrackSchema),
  clips: z.array(ClipSchema),
  exportSettings: ExportSettingsSchema,
  privacySettings: PrivacySettingsSchema,
});

export type Transform = z.infer<typeof TransformSchema>;
export type AudioProps = z.infer<typeof AudioPropsSchema>;
export type TextStyle = z.infer<typeof TextStyleSchema>;
export type MediaKind = z.infer<typeof MediaKindSchema>;
export type MediaItem = z.infer<typeof MediaItemSchema>;
export type VideoClip = z.infer<typeof VideoClipSchema>;
export type AudioClip = z.infer<typeof AudioClipSchema>;
export type ImageClip = z.infer<typeof ImageClipSchema>;
export type TextClip = z.infer<typeof TextClipSchema>;
export type CaptionClip = z.infer<typeof CaptionClipSchema>;
export type SlotClip = z.infer<typeof SlotClipSchema>;
export type Clip = z.infer<typeof ClipSchema>;
export type ClipKind = Clip['kind'];
export type TrackKind = z.infer<typeof TrackKindSchema>;
export type Track = z.infer<typeof TrackSchema>;
export type Sequence = z.infer<typeof SequenceSchema>;
export type ExportSettings = z.infer<typeof ExportSettingsSchema>;
export type PrivacySettings = z.infer<typeof PrivacySettingsSchema>;
export type Project = z.infer<typeof ProjectSchema>;

export type MediaClip = VideoClip | AudioClip | ImageClip;
export type TimedMediaClip = VideoClip | AudioClip;
export type TextLikeClip = TextClip | CaptionClip;
export type VisualClip = VideoClip | ImageClip | TextClip | CaptionClip;
