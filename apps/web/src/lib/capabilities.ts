import { canEncodeAudio, canEncodeVideo } from 'mediabunny';

export interface Check {
  id: string;
  label: string;
  ok: boolean;
  /** Required checks block the editor; optional ones only degrade features. */
  required: boolean;
  detail: string;
}

/** Resolve to `fallback` if a probe takes too long (e.g. slow GPU process start-up). */
function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    p.catch(() => fallback),
    new Promise<T>((r) => setTimeout(() => r(fallback), ms)),
  ]);
}

/** Browser equivalent of the guide's `doctor` script. */
export async function runDiagnostics(): Promise<Check[]> {
  const checks: Check[] = [];
  const add = (c: Check) => checks.push(c);

  add({
    id: 'secure',
    label: 'Secure context (HTTPS or localhost)',
    ok: window.isSecureContext,
    required: true,
    detail: window.isSecureContext
      ? 'OK'
      : 'Open Viditor over https:// — file access APIs are disabled otherwise.',
  });
  add({
    id: 'fsa',
    label: 'File System Access (local project folders)',
    ok:
      'showDirectoryPicker' in window &&
      'showOpenFilePicker' in window &&
      'showSaveFilePicker' in window,
    required: true,
    detail: 'showDirectoryPicker' in window ? 'OK' : 'Not available. Use desktop Chrome or Edge.',
  });
  add({
    id: 'webcodecs',
    label: 'WebCodecs (decode/encode)',
    ok: 'VideoEncoder' in window && 'VideoDecoder' in window && 'AudioEncoder' in window,
    required: true,
    detail:
      'VideoEncoder' in window ? 'OK' : 'Not available. Use a current desktop Chrome or Edge.',
  });
  add({
    id: 'offscreen',
    label: 'OffscreenCanvas in workers',
    ok: 'OffscreenCanvas' in window,
    required: true,
    detail: 'OffscreenCanvas' in window ? 'OK' : 'Not available.',
  });
  add({
    id: 'opfs',
    label: 'Origin-private storage (analysis cache)',
    ok: typeof navigator.storage?.getDirectory === 'function',
    required: false,
    detail:
      typeof navigator.storage?.getDirectory === 'function'
        ? 'OK'
        : 'Thumbnails/waveforms will not be cached between sessions.',
  });

  if ('VideoEncoder' in window) {
    const h264 = await withTimeout(
      canEncodeVideo('avc', { width: 1920, height: 1080, bitrate: 8e6 }),
      8000,
      false,
    );
    add({
      id: 'h264',
      label: 'H.264 encoder at 1080p',
      ok: h264,
      required: false,
      detail: h264 ? 'OK' : 'MP4 export is unavailable in this browser.',
    });
    const aac = await withTimeout(
      canEncodeAudio('aac', { numberOfChannels: 2, sampleRate: 48000, bitrate: 192e3 }),
      8000,
      false,
    );
    add({
      id: 'aac',
      label: 'AAC audio encoder',
      ok: aac,
      required: false,
      detail: aac
        ? 'OK'
        : 'Projects with audio cannot be exported in this browser (Linux Chrome lacks AAC).',
    });
  }

  if (navigator.storage?.estimate) {
    const est = await withTimeout(navigator.storage.estimate(), 3000, {} as StorageEstimate);
    const free = (est.quota ?? 0) - (est.usage ?? 0);
    add({
      id: 'quota',
      label: 'Browser storage quota',
      ok: free > 200 * 1024 ** 2,
      required: false,
      detail: `${formatBytes(free)} available for caches`,
    });
  }
  return checks;
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}
