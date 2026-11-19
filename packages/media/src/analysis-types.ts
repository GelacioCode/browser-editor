import type { MediaKind } from '@viditor/project-core';
import type { BeatAnalysis, BeatMode } from './beats.ts';

export interface AnalyzeRequest {
  type: 'analyze';
  jobId: number;
  file: File;
  kind: MediaKind;
  thumbHeight: number;
  peaksPerSecond: number;
}

export interface ThumbBlob {
  /** Source time in seconds. */
  time: number;
  blob: Blob;
}

export interface AnalysisResult {
  thumbs: ThumbBlob[];
  thumbWidth: number;
  thumbHeight: number;
  /** Max-abs peaks (0..1), `peaksPerSecond` per second of source. Null if no audio. */
  peaks: Float32Array | null;
  peaksPerSecond: number;
}

export interface BeatsRequest {
  type: 'beats';
  jobId: number;
  file: File;
  mode: BeatMode;
}

export type WorkerRequest = AnalyzeRequest | BeatsRequest;

export type AnalyzeResponse =
  | { jobId: number; ok: true; result: AnalysisResult | BeatAnalysis }
  | { jobId: number; ok: false; error: string };
