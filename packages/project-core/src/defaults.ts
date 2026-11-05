import { nanoid } from 'nanoid';
import {
  SCHEMA_VERSION,
  type AudioProps,
  type ClipKind,
  type Project,
  type TextStyle,
  type Track,
  type TrackKind,
  type Transform,
} from './schema.ts';

export function newId(prefix: string): string {
  return `${prefix}_${nanoid(10)}`;
}

export const DEFAULT_TRANSFORM: Transform = {
  x: 0,
  y: 0,
  scale: 1,
  rotation: 0,
  opacity: 1,
  crop: { left: 0, right: 0, top: 0, bottom: 0 },
};

export const DEFAULT_AUDIO: AudioProps = { gain: 1, mute: false, fadeIn: 0, fadeOut: 0 };

export const DEFAULT_TITLE_STYLE: TextStyle = {
  fontFamily: 'Inter',
  fontWeight: 700,
  fontSize: 96,
  color: '#ffffff',
  align: 'center',
  lineHeight: 1.2,
  background: null,
  strokeColor: '#000000',
  strokeWidth: 0,
};

export const DEFAULT_CAPTION_STYLE: TextStyle = {
  fontFamily: 'Inter',
  fontWeight: 700,
  fontSize: 54,
  color: '#ffffff',
  align: 'center',
  lineHeight: 1.25,
  background: '#000000a6',
  strokeColor: null,
  strokeWidth: 0,
};

/** Caption default position: lower third, inside the title-safe area. */
export const DEFAULT_CAPTION_TRANSFORM: Transform = { ...DEFAULT_TRANSFORM, y: 0.36 };

/** Which clip kinds may live on which track kinds. */
export const TRACK_ACCEPTS: Record<TrackKind, readonly ClipKind[]> = {
  video: ['video', 'image'],
  audio: ['audio'],
  text: ['text'],
  caption: ['caption'],
};

export function trackKindForClip(kind: ClipKind): TrackKind {
  switch (kind) {
    case 'video':
    case 'image':
      return 'video';
    case 'audio':
      return 'audio';
    case 'text':
      return 'text';
    case 'caption':
      return 'caption';
  }
}

const TRACK_LABEL: Record<TrackKind, string> = {
  video: 'Video',
  audio: 'Audio',
  text: 'Text',
  caption: 'Captions',
};

export function makeTrack(kind: TrackKind, existing: Track[], id = newId('t')): Track {
  const n = existing.filter((t) => t.kind === kind).length + 1;
  return {
    id,
    kind,
    name: `${TRACK_LABEL[kind]} ${n}`,
    muted: false,
    hidden: false,
    locked: false,
  };
}

export interface CreateProjectOptions {
  name?: string;
  width?: number;
  height?: number;
  fps?: { num: number; den: number };
  now?: Date;
  projectId?: string;
}

export function createProject(opts: CreateProjectOptions = {}): Project {
  const now = (opts.now ?? new Date()).toISOString();
  const video = makeTrack('video', []);
  const audio = makeTrack('audio', []);
  return {
    schemaVersion: SCHEMA_VERSION,
    projectId: opts.projectId ?? newId('p'),
    name: opts.name ?? 'Untitled project',
    createdAt: now,
    updatedAt: now,
    revision: 0,
    sequence: {
      width: opts.width ?? 1920,
      height: opts.height ?? 1080,
      fps: opts.fps ?? { num: 30, den: 1 },
      background: '#000000',
    },
    media: [],
    tracks: [video, audio],
    clips: [],
    exportSettings: {
      container: 'mp4',
      videoCodec: 'avc',
      audioCodec: 'aac',
      height: opts.height ?? 1080,
      quality: 'high',
    },
    privacySettings: {
      shareFileNames: false,
      shareTextContent: false,
      shareFrames: false,
      shareAudio: false,
      shareTranscripts: false,
    },
  };
}
