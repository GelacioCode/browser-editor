import type { Project } from '@viditor/project-core';
import type { FontFile } from '@viditor/composition';
import type { MixedAudio } from './mix-audio.ts';

export interface ExportWorkerStart {
  type: 'start';
  project: Project;
  files: Record<string, File>;
  fonts: FontFile[];
  audio: MixedAudio | null;
  width: number;
  height: number;
  writable: WritableStream;
}

export type ExportWorkerIn = ExportWorkerStart | { type: 'cancel' };

export type ExportWorkerOut =
  | { type: 'progress'; frame: number; totalFrames: number }
  | { type: 'finalizing' }
  | { type: 'done' }
  | { type: 'canceled' }
  | { type: 'error'; message: string };

export type ExportPhase =
  'checking' | 'audio' | 'video' | 'finalizing' | 'done' | 'canceled' | 'error';

export interface ExportProgress {
  phase: ExportPhase;
  /** 0..1 overall */
  progress: number;
  frame?: number;
  totalFrames?: number;
  message?: string;
}
