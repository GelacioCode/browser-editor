import type { AnalysisResult } from './analysis-types.ts';
import type { BeatAnalysis, BeatMode } from './beats.ts';

/**
 * Disposable analysis cache (thumbnails, waveforms) in the Origin Private File System.
 * Never contains original media or exports. Safe to clear at any time.
 */

const ROOT = 'viditor-cache';
export const DEFAULT_CACHE_CAP_BYTES = 5 * 1024 ** 3;

interface CacheMeta {
  thumbs: { time: number; file: string }[];
  thumbWidth: number;
  thumbHeight: number;
  peaksPerSecond: number;
  hasPeaks: boolean;
  bytes: number;
  lastUsed: number;
}

async function root(): Promise<FileSystemDirectoryHandle> {
  const opfs = await navigator.storage.getDirectory();
  return opfs.getDirectoryHandle(ROOT, { create: true });
}

/** Stable cache key from file identity (name, size, mtime). */
export function cacheKeyFor(file: Pick<File, 'name' | 'size' | 'lastModified'>): string {
  const s = `${file.name}|${file.size}|${file.lastModified}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `k${(h >>> 0).toString(16)}${file.size.toString(16)}`;
}

async function readFile(dir: FileSystemDirectoryHandle, name: string): Promise<File> {
  return (await dir.getFileHandle(name)).getFile();
}

async function writeFile(
  dir: FileSystemDirectoryHandle,
  name: string,
  data: Blob | BufferSource | string,
) {
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(data);
  await w.close();
}

export async function getCachedAnalysis(key: string): Promise<AnalysisResult | null> {
  try {
    const dir = await (await root()).getDirectoryHandle(key);
    const meta = JSON.parse(await (await readFile(dir, 'meta.json')).text()) as CacheMeta;
    const thumbs = await Promise.all(
      meta.thumbs.map(async (t) => ({ time: t.time, blob: (await readFile(dir, t.file)) as Blob })),
    );
    const peaks = meta.hasPeaks
      ? new Float32Array(await (await readFile(dir, 'peaks.bin')).arrayBuffer())
      : null;
    meta.lastUsed = Date.now();
    void writeFile(dir, 'meta.json', JSON.stringify(meta)).catch(() => {});
    return {
      thumbs,
      thumbWidth: meta.thumbWidth,
      thumbHeight: meta.thumbHeight,
      peaks,
      peaksPerSecond: meta.peaksPerSecond,
    };
  } catch {
    return null;
  }
}

export async function putCachedAnalysis(
  key: string,
  r: AnalysisResult,
  capBytes = DEFAULT_CACHE_CAP_BYTES,
) {
  const dir = await (await root()).getDirectoryHandle(key, { create: true });
  let bytes = 0;
  const thumbs: CacheMeta['thumbs'] = [];
  for (let i = 0; i < r.thumbs.length; i++) {
    const t = r.thumbs[i]!;
    const file = `t${i}.jpg`;
    await writeFile(dir, file, t.blob);
    bytes += t.blob.size;
    thumbs.push({ time: t.time, file });
  }
  if (r.peaks) {
    await writeFile(
      dir,
      'peaks.bin',
      new Uint8Array(r.peaks.buffer as ArrayBuffer, r.peaks.byteOffset, r.peaks.byteLength),
    );
    bytes += r.peaks.byteLength;
  }
  const meta: CacheMeta = {
    thumbs,
    thumbWidth: r.thumbWidth,
    thumbHeight: r.thumbHeight,
    peaksPerSecond: r.peaksPerSecond,
    hasPeaks: !!r.peaks,
    bytes,
    lastUsed: Date.now(),
  };
  await writeFile(dir, 'meta.json', JSON.stringify(meta));
  await evictToCap(capBytes);
}

/** Beat analysis is tiny JSON stored next to the thumbnails of the same file. */
export async function getCachedBeats(key: string, mode: BeatMode): Promise<BeatAnalysis | null> {
  try {
    const dir = await (await root()).getDirectoryHandle(key);
    const r = JSON.parse(
      await (await readFile(dir, 'beats-' + mode + '.json')).text(),
    ) as BeatAnalysis;
    return Array.isArray(r.beatsUs) ? r : null;
  } catch {
    return null;
  }
}

export async function putCachedBeats(key: string, mode: BeatMode, r: BeatAnalysis) {
  const dir = await (await root()).getDirectoryHandle(key, { create: true });
  await writeFile(dir, 'beats-' + mode + '.json', JSON.stringify(r));
}

export interface CacheUsage {
  entries: number;
  bytes: number;
}

async function listEntries(): Promise<{ key: string; meta: CacheMeta }[]> {
  const out: { key: string; meta: CacheMeta }[] = [];
  const r = await root();
  for await (const [key, h] of r.entries()) {
    if (h.kind !== 'directory') continue;
    try {
      const meta = JSON.parse(
        await (await readFile(h as FileSystemDirectoryHandle, 'meta.json')).text(),
      ) as CacheMeta;
      out.push({ key, meta });
    } catch {
      out.push({ key, meta: { bytes: 0, lastUsed: 0 } as CacheMeta });
    }
  }
  return out;
}

export async function cacheUsage(): Promise<CacheUsage> {
  const entries = await listEntries();
  return { entries: entries.length, bytes: entries.reduce((s, e) => s + (e.meta.bytes || 0), 0) };
}

/** Remove least-recently-used entries until the cache fits under the cap. */
export async function evictToCap(capBytes: number) {
  const entries = await listEntries();
  let total = entries.reduce((s, e) => s + (e.meta.bytes || 0), 0);
  if (total <= capBytes) return;
  entries.sort((a, b) => a.meta.lastUsed - b.meta.lastUsed);
  const r = await root();
  for (const e of entries) {
    if (total <= capBytes) break;
    await r.removeEntry(e.key, { recursive: true }).catch(() => {});
    total -= e.meta.bytes || 0;
  }
}

export async function clearCache() {
  const opfs = await navigator.storage.getDirectory();
  await opfs.removeEntry(ROOT, { recursive: true }).catch(() => {});
}
