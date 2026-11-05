import {
  ALL_FORMATS,
  AudioSample,
  AudioSampleSource,
  BlobSource,
  CanvasSink,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  QUALITY_LOW,
  QUALITY_MEDIUM,
  QUALITY_VERY_HIGH,
  StreamTarget,
  type WrappedCanvas,
} from 'mediabunny';
import {
  clipEnd,
  frameToSeconds,
  fpsToNumber,
  sequenceDuration,
  sourceTimeAt,
  usToSeconds,
  visualLayersAt,
  type Project,
  type VideoClip,
} from '@viditor/project-core';
import { loadFonts, renderFrame, type FrameSource } from '@viditor/composition';
import type { ExportWorkerIn, ExportWorkerOut, ExportWorkerStart } from './export-types.ts';

const post = (m: ExportWorkerOut) =>
  (self as unknown as { postMessage(m: unknown): void }).postMessage(m);

let output: Output | null = null;
let canceled = false;

const QUALITY = {
  low: QUALITY_LOW,
  medium: QUALITY_MEDIUM,
  high: QUALITY_HIGH,
  'very-high': QUALITY_VERY_HIGH,
};

/** Sequential frame reader for one clip: decodes forward and returns the frame shown at time t. */
class ClipFrameCursor {
  private gen: AsyncGenerator<WrappedCanvas>;
  private current: WrappedCanvas | null = null;
  private next: WrappedCanvas | null = null;
  private done = false;

  constructor(sink: CanvasSink, startS: number, endS: number) {
    this.gen = sink.canvases(startS, endS);
  }

  private async pull(): Promise<WrappedCanvas | null> {
    if (this.done) return null;
    const r = await this.gen.next();
    if (r.done) {
      this.done = true;
      return null;
    }
    return r.value;
  }

  async frameAt(t: number): Promise<WrappedCanvas | null> {
    if (!this.current) this.current = await this.pull();
    for (;;) {
      if (!this.next) this.next = await this.pull();
      if (this.next && this.next.timestamp <= t + 1e-6) {
        this.current = this.next;
        this.next = null;
      } else break;
    }
    return this.current;
  }

  async close() {
    await this.gen.return(undefined).catch(() => {});
  }
}

async function run(msg: ExportWorkerStart) {
  const { project, files, width, height } = msg;
  const fps = project.sequence.fps;
  const totalFrames = sequenceDuration(project);
  if (totalFrames <= 0) throw new Error('The timeline is empty');

  await loadFonts((self as unknown as { fonts: FontFaceSet }).fonts, msg.fonts);

  // Open inputs and decoders for media used by visual clips.
  const inputs = new Map<string, Input>();
  const sinks = new Map<string, CanvasSink>();
  const images = new Map<string, ImageBitmap>();
  for (const clip of project.clips) {
    if (clip.kind !== 'video' && clip.kind !== 'image') continue;
    const file = files[clip.mediaId];
    if (!file) throw new Error(`Media for clip ${clip.id} is offline. Relink it before exporting.`);
    if (clip.kind === 'image' && !images.has(clip.mediaId)) {
      images.set(clip.mediaId, await createImageBitmap(file));
    }
    if (clip.kind === 'video' && !sinks.has(clip.mediaId)) {
      const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
      const track = await input.getPrimaryVideoTrack();
      if (!track || !(await track.canDecode()))
        throw new Error(`Cannot decode video for clip ${clip.id}`);
      inputs.set(clip.mediaId, input);
      sinks.set(clip.mediaId, new CanvasSink(track, { poolSize: 3 }));
    }
  }

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { alpha: false })!;

  output = new Output({
    format: new Mp4OutputFormat({ fastStart: false }),
    target: new StreamTarget(msg.writable as WritableStream, { chunked: true }),
  });
  const quality = QUALITY[project.exportSettings.quality];
  const videoSource = new CanvasSource(canvas, { codec: 'avc', bitrate: quality });
  output.addVideoTrack(videoSource, { frameRate: fpsToNumber(fps) });

  let audioSource: AudioSampleSource | null = null;
  if (msg.audio) {
    audioSource = new AudioSampleSource({ codec: 'aac', bitrate: QUALITY_HIGH });
    output.addAudioTrack(audioSource);
  }
  await output.start();

  const audio = msg.audio;
  let audioWritten = 0; // audio frames already encoded
  const writeAudioUntil = async (seconds: number) => {
    if (!audio || !audioSource) return;
    const until = Math.min(audio.frames, Math.ceil(seconds * audio.sampleRate));
    while (audioWritten < until) {
      const n = Math.min(audio.sampleRate, until - audioWritten); // ≤ 1 s chunks
      const data = new Float32Array(n * 2);
      data.set(audio.planar.subarray(audioWritten, audioWritten + n), 0);
      data.set(
        audio.planar.subarray(audio.frames + audioWritten, audio.frames + audioWritten + n),
        n,
      );
      const sample = new AudioSample({
        data,
        format: 'f32-planar',
        numberOfChannels: 2,
        sampleRate: audio.sampleRate,
        timestamp: audioWritten / audio.sampleRate,
      });
      await audioSource.add(sample);
      sample.close();
      audioWritten += n;
    }
  };

  const cursors = new Map<string, ClipFrameCursor>();
  const frameSources = new Map<string, FrameSource>();
  const frameDur = 1 / fpsToNumber(fps);

  try {
    for (let f = 0; f < totalFrames; f++) {
      if (canceled) return;
      frameSources.clear();
      const layers = visualLayersAt(project, f);
      const active = new Set<string>();
      for (const clip of layers) {
        if (clip.kind === 'image') {
          const bmp = images.get(clip.mediaId)!;
          frameSources.set(clip.id, { image: bmp, width: bmp.width, height: bmp.height });
        } else if (clip.kind === 'video') {
          active.add(clip.id);
          let cur = cursors.get(clip.id);
          if (!cur) {
            const startS = usToSeconds(clip.sourceInUs);
            const endS =
              usToSeconds(sourceTimeAt(clip as VideoClip, clipEnd(clip), fps)) +
              frameDur * clip.speed;
            cur = new ClipFrameCursor(sinks.get(clip.mediaId)!, startS, endS);
            cursors.set(clip.id, cur);
          }
          const wc = await cur.frameAt(usToSeconds(sourceTimeAt(clip, f, fps)));
          if (wc)
            frameSources.set(clip.id, {
              image: wc.canvas,
              width: wc.canvas.width,
              height: wc.canvas.height,
            });
        }
      }
      // Close cursors of clips that ended.
      for (const [id, cur] of cursors) {
        if (!active.has(id)) {
          await cur.close();
          cursors.delete(id);
        }
      }

      renderFrame(ctx, project, f, (clip) => frameSources.get(clip.id) ?? null, {
        outWidth: width,
        outHeight: height,
      });
      const t = frameToSeconds(f, fps);
      await videoSource.add(t, frameToSeconds(f + 1, fps) - t);
      await writeAudioUntil(frameToSeconds(f + 1, fps));
      if (f % 10 === 0 || f === totalFrames - 1)
        post({ type: 'progress', frame: f + 1, totalFrames });
    }
    await writeAudioUntil(Infinity);
    if (canceled) return;
    post({ type: 'finalizing' });
    videoSource.close();
    audioSource?.close();
    await output.finalize();
  } finally {
    for (const c of cursors.values()) await c.close();
    for (const i of inputs.values()) i.dispose();
    for (const b of images.values()) b.close();
  }
}

self.onmessage = async (e: MessageEvent<ExportWorkerIn>) => {
  const msg = e.data;
  if (msg.type === 'cancel') {
    canceled = true;
    try {
      await output?.cancel();
    } catch {
      /* ignore */
    }
    post({ type: 'canceled' });
    return;
  }
  try {
    await run(msg);
    if (canceled) post({ type: 'canceled' });
    else post({ type: 'done' });
  } catch (err) {
    if (canceled) return;
    try {
      await output?.cancel();
    } catch {
      /* ignore */
    }
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};

export type { Project };
