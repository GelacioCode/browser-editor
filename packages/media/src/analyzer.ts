import type { MediaKind } from '@viditor/project-core';
import type { AnalysisResult, AnalyzeRequest, AnalyzeResponse } from './analysis-types.ts';
import { cacheKeyFor, getCachedAnalysis, putCachedAnalysis } from './cache.ts';

export const THUMB_HEIGHT = 72;
export const PEAKS_PER_SECOND = 50;

interface Pending {
  resolve: (r: AnalysisResult) => void;
  reject: (e: Error) => void;
}

/**
 * Queues analysis jobs onto a single background worker (bounded concurrency = 1 so imports
 * don't starve playback), with an OPFS cache in front.
 */
export class MediaAnalyzer {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private inflight = new Map<string, Promise<AnalysisResult>>();

  private getWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('./analysis.worker.ts', import.meta.url), {
        type: 'module',
      });
      this.worker.onmessage = (e: MessageEvent<AnalyzeResponse>) => {
        const p = this.pending.get(e.data.jobId);
        if (!p) return;
        this.pending.delete(e.data.jobId);
        if (e.data.ok) p.resolve(e.data.result);
        else p.reject(new Error(e.data.error));
      };
      this.worker.onerror = (e) => {
        for (const p of this.pending.values())
          p.reject(new Error(e.message || 'Analysis worker crashed'));
        this.pending.clear();
        this.worker?.terminate();
        this.worker = null;
      };
    }
    return this.worker;
  }

  analyze(file: File, kind: MediaKind): Promise<AnalysisResult> {
    const key = cacheKeyFor(file);
    const existing = this.inflight.get(key);
    if (existing) return existing;
    const job = (async () => {
      const cached = await getCachedAnalysis(key);
      if (cached) return cached;
      const result = await new Promise<AnalysisResult>((resolve, reject) => {
        const jobId = this.nextId++;
        this.pending.set(jobId, { resolve, reject });
        const req: AnalyzeRequest = {
          jobId,
          file,
          kind,
          thumbHeight: THUMB_HEIGHT,
          peaksPerSecond: PEAKS_PER_SECOND,
        };
        this.getWorker().postMessage(req);
      });
      await putCachedAnalysis(key, result).catch((e) => console.warn('Cache write failed', e));
      return result;
    })().finally(() => this.inflight.delete(key));
    this.inflight.set(key, job);
    return job;
  }

  dispose() {
    this.worker?.terminate();
    this.worker = null;
  }
}
