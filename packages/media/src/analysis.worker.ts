import { ALL_FORMATS, AudioSampleSink, BlobSource, CanvasSink, Input } from 'mediabunny';
import type {
  AnalysisResult,
  AnalyzeRequest,
  AnalyzeResponse,
  BeatsRequest,
  ThumbBlob,
  WorkerRequest,
} from './analysis-types.ts';
import { MonoDownmixer, detectBeats, type BeatAnalysis } from './beats.ts';

/**
 * Off-main-thread media analysis: timeline thumbnails and audio waveform peaks.
 * Runs entirely locally; nothing is uploaded.
 */

const MAX_THUMBS = 60;

async function canvasToJpeg(c: HTMLCanvasElement | OffscreenCanvas): Promise<Blob> {
  if ('convertToBlob' in c) return c.convertToBlob({ type: 'image/jpeg', quality: 0.72 });
  throw new Error('OffscreenCanvas required');
}

async function imageThumb(req: AnalyzeRequest): Promise<AnalysisResult> {
  const bmp = await createImageBitmap(req.file);
  const h = req.thumbHeight;
  const w = Math.max(1, Math.round((bmp.width / bmp.height) * h));
  const c = new OffscreenCanvas(w, h);
  c.getContext('2d')!.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  return {
    thumbs: [{ time: 0, blob: await canvasToJpeg(c) }],
    thumbWidth: w,
    thumbHeight: h,
    peaks: null,
    peaksPerSecond: req.peaksPerSecond,
  };
}

async function analyzeAv(req: AnalyzeRequest): Promise<AnalysisResult> {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(req.file) });
  try {
    const duration = await input.computeDuration();
    const thumbs: ThumbBlob[] = [];
    let thumbWidth = 0;
    const thumbHeight = req.thumbHeight;

    const video = await input.getPrimaryVideoTrack();
    if (video && (await video.canDecode())) {
      const dw = await video.getDisplayWidth();
      const dh = await video.getDisplayHeight();
      thumbWidth = Math.max(1, Math.round((dw / Math.max(1, dh)) * thumbHeight));
      const sink = new CanvasSink(video, { width: thumbWidth, height: thumbHeight, fit: 'fill' });
      const first = await video.getFirstTimestamp();
      const count = Math.max(1, Math.min(MAX_THUMBS, Math.ceil(duration / 2)));
      const step = duration / count;
      const times = Array.from({ length: count }, (_, i) => first + i * step);
      let i = 0;
      for await (const wc of sink.canvasesAtTimestamps(times)) {
        const time = times[i++]!;
        if (wc) thumbs.push({ time, blob: await canvasToJpeg(wc.canvas) });
      }
    }

    let peaks: Float32Array | null = null;
    const audio = await input.getPrimaryAudioTrack();
    if (audio && (await audio.canDecode())) {
      const pps = req.peaksPerSecond;
      peaks = new Float32Array(Math.ceil(duration * pps) + 1);
      const sink = new AudioSampleSink(audio);
      let scratch = new Float32Array(0);
      for await (const sample of sink.samples()) {
        const n = sample.numberOfFrames;
        if (scratch.length < n) scratch = new Float32Array(n);
        const rate = sample.sampleRate;
        for (let ch = 0; ch < sample.numberOfChannels; ch++) {
          sample.copyTo(scratch, { planeIndex: ch, format: 'f32-planar' });
          for (let j = 0; j < n; j++) {
            const b = Math.floor((sample.timestamp + j / rate) * pps);
            if (b < 0 || b >= peaks.length) continue;
            const v = Math.abs(scratch[j]!);
            if (v > peaks[b]!) peaks[b] = v;
          }
        }
        sample.close();
      }
    }

    return { thumbs, thumbWidth, thumbHeight, peaks, peaksPerSecond: req.peaksPerSecond };
  } finally {
    input.dispose();
  }
}

/** Decode the primary audio track to ~11 kHz mono and find beats or bass hits. */
async function analyzeBeats(req: BeatsRequest): Promise<BeatAnalysis> {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(req.file) });
  try {
    const audio = await input.getPrimaryAudioTrack();
    if (!audio) throw new Error('This file has no audio track');
    if (!(await audio.canDecode())) throw new Error('This browser cannot decode the audio');
    const mix = new MonoDownmixer();
    const sink = new AudioSampleSink(audio);
    let planes: Float32Array[] = [];
    let offset: number | null = null;
    for await (const sample of sink.samples()) {
      offset ??= Math.max(0, sample.timestamp);
      const n = sample.numberOfFrames;
      const ch = sample.numberOfChannels;
      if (planes.length !== ch || planes[0]!.length < n)
        planes = Array.from({ length: ch }, () => new Float32Array(n));
      for (let c = 0; c < ch; c++)
        sample.copyTo(planes[c]!, { planeIndex: c, format: 'f32-planar' });
      mix.push(planes, n, sample.sampleRate);
      sample.close();
    }
    const { samples, rate } = mix.finish();
    const r = detectBeats(samples, rate, req.mode);
    const shift = Math.round((offset ?? 0) * 1_000_000);
    return { ...r, beatsUs: r.beatsUs.map((b) => b + shift) };
  } finally {
    input.dispose();
  }
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  let msg: AnalyzeResponse;
  try {
    const result =
      req.type === 'beats'
        ? await analyzeBeats(req)
        : req.kind === 'image'
          ? await imageThumb(req)
          : await analyzeAv(req);
    msg = { jobId: req.jobId, ok: true, result };
  } catch (err) {
    msg = { jobId: req.jobId, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  (self as unknown as { postMessage(m: unknown): void }).postMessage(msg);
};
