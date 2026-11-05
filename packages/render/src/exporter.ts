import { canEncodeAudio, canEncodeVideo, QUALITY_HIGH } from 'mediabunny';
import { audibleClips, findMedia, type Project } from '@viditor/project-core';
import type { FontFile } from '@viditor/composition';
import { mixTimelineAudio } from './mix-audio.ts';
import type { ExportProgress, ExportWorkerOut, ExportWorkerStart } from './export-types.ts';

export interface ExportOptions {
  project: Project;
  /** mediaId → File (from the user's approved file handles). */
  files: ReadonlyMap<string, File>;
  fonts: FontFile[];
  /** Destination chosen by the user (showSaveFilePicker). */
  target: FileSystemFileHandle;
  onProgress: (p: ExportProgress) => void;
}

export interface ExportJob {
  done: Promise<'done' | 'canceled'>;
  cancel(): void;
}

/** Output size: export height with the sequence aspect ratio, rounded to even numbers for H.264. */
export function exportDimensions(project: Project): { width: number; height: number } {
  const { width: sw, height: sh } = project.sequence;
  const height = Math.min(project.exportSettings.height, sh) & ~1;
  const width = Math.round((height * sw) / sh) & ~1;
  return { width, height };
}

export interface EncoderSupport {
  video: boolean;
  audio: boolean;
}

export async function checkEncoders(width: number, height: number): Promise<EncoderSupport> {
  const [video, audio] = await Promise.all([
    canEncodeVideo('avc', { width, height, bitrate: QUALITY_HIGH }),
    canEncodeAudio('aac', { numberOfChannels: 2, sampleRate: 48000, bitrate: QUALITY_HIGH }),
  ]);
  return { video, audio };
}

/** Verify every clip's media is available before spending time rendering. */
export function missingMedia(project: Project, files: ReadonlyMap<string, File>): string[] {
  const ids = new Set<string>();
  for (const c of project.clips) if ('mediaId' in c && !files.has(c.mediaId)) ids.add(c.mediaId);
  return [...ids].map((id) => findMedia(project, id)?.name ?? id);
}

async function removeFile(handle: FileSystemFileHandle) {
  // Chromium-only FileSystemHandle.remove(): delete the incomplete output on cancel/failure.
  const h = handle as FileSystemFileHandle & { remove?: () => Promise<void> };
  await h.remove?.().catch(() => {});
}

export function startExport(opts: ExportOptions): ExportJob {
  let worker: Worker | null = null;
  let canceled = false;
  let writable: FileSystemWritableFileStream | null = null;
  const report = opts.onProgress;

  const done = (async (): Promise<'done' | 'canceled'> => {
    const { project, files } = opts;
    report({ phase: 'checking', progress: 0 });
    const missing = missingMedia(project, files);
    if (missing.length)
      throw new Error(`Offline media: ${missing.join(', ')}. Relink before exporting.`);
    const { width, height } = exportDimensions(project);
    const enc = await checkEncoders(width, height);
    if (!enc.video) throw new Error(`This browser cannot encode H.264 at ${width}×${height}.`);
    const needsAudio = audibleClips(project).length > 0;
    if (needsAudio && !enc.audio) {
      throw new Error(
        'This browser cannot encode AAC audio. Use desktop Chrome or Edge on Windows/macOS.',
      );
    }

    report({ phase: 'audio', progress: 0.01 });
    const audio = needsAudio
      ? await mixTimelineAudio(project, files, 48000, (d, t) =>
          report({ phase: 'audio', progress: 0.01 + 0.09 * (d / t) }),
        )
      : null;
    if (canceled) return 'canceled';

    writable = await opts.target.createWritable();
    // FileSystemWritableFileStream itself is not transferable, so hand the worker a plain
    // WritableStream that forwards positioned writes to the file on this thread.
    // The worker's close() resolves before this side has committed the file, so track it here.
    const fileStream = writable;
    let markClosed!: () => void;
    const fileClosed = new Promise<void>((r) => (markClosed = r));
    const proxy = new WritableStream<{ type: 'write'; data: Uint8Array; position: number }>({
      write: (chunk) =>
        fileStream.write({
          type: 'write',
          data: chunk.data as Uint8Array<ArrayBuffer>,
          position: chunk.position,
        }),
      close: async () => {
        await fileStream.close();
        markClosed();
      },
      abort: async (reason) => {
        await fileStream.abort(reason).catch(() => {});
        markClosed();
      },
    });
    worker = new Worker(new URL('./export.worker.ts', import.meta.url), { type: 'module' });
    const filesObj: Record<string, File> = {};
    for (const [k, v] of files) filesObj[k] = v;

    const result = await new Promise<'done' | 'canceled'>((resolve, reject) => {
      worker!.onmessage = (e: MessageEvent<ExportWorkerOut>) => {
        const m = e.data;
        if (m.type === 'progress') {
          report({
            phase: 'video',
            progress: 0.1 + 0.88 * (m.frame / m.totalFrames),
            frame: m.frame,
            totalFrames: m.totalFrames,
          });
        } else if (m.type === 'finalizing') report({ phase: 'finalizing', progress: 0.99 });
        else if (m.type === 'done') void fileClosed.then(() => resolve('done'));
        else if (m.type === 'canceled') resolve('canceled');
        else if (m.type === 'error') reject(new Error(m.message));
      };
      worker!.onerror = (e) => reject(new Error(e.message || 'Export worker crashed'));
      const msg: ExportWorkerStart = {
        type: 'start',
        project,
        files: filesObj,
        fonts: opts.fonts,
        audio,
        width,
        height,
        writable: proxy,
      };
      const transfer: Transferable[] = [proxy as unknown as Transferable];
      if (audio) transfer.push(audio.planar.buffer as ArrayBuffer);
      worker!.postMessage(msg, transfer);
    });
    return result;
  })()
    .then(async (r) => {
      worker?.terminate();
      if (r === 'canceled') {
        await removeFile(opts.target);
        report({ phase: 'canceled', progress: 0 });
      } else report({ phase: 'done', progress: 1 });
      return r;
    })
    .catch(async (err: unknown) => {
      worker?.terminate();
      await removeFile(opts.target);
      const message = err instanceof Error ? err.message : String(err);
      report({ phase: 'error', progress: 0, message });
      throw err;
    });

  return {
    done,
    cancel() {
      canceled = true;
      if (worker) worker.postMessage({ type: 'cancel' });
    },
  };
}
