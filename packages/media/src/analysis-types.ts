import type { MediaKind } from '@viditor/project-core';

export interface AnalyzeRequest {
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

export type AnalyzeResponse =
  { jobId: number; ok: true; result: AnalysisResult } | { jobId: number; ok: false; error: string };
