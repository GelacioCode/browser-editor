/**
 * End-to-end test harness, loaded only by Playwright against the dev server
 * (`await import('/src/testing/harness.ts')`). Never imported by the app bundle.
 *
 * It exercises the real pipeline without OS file pickers: synthesises a test video in-page,
 * probes and analyses it, builds a project through the engine, exports it with the real export
 * worker to an OPFS file, then decodes the result and samples pixels.
 */
import {
  ALL_FORMATS,
  AudioSample,
  AudioSampleSource,
  BlobSource,
  BufferTarget,
  CanvasSink,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
} from 'mediabunny';
import {
  ProjectEngine,
  createProject,
  secondsToNearestFrame,
  type MediaItem,
} from '@viditor/project-core';
import { MediaAnalyzer, probeFile } from '@viditor/media';
import { startExport } from '@viditor/render';
import { FONT_FILES, ensureFontsLoaded } from '../fonts.ts';

const COLORS = ['#ff0000', '#00ff00', '#0000ff'];

/** 3 s, 640×360 @ 30 fps: red / green / blue seconds + a 440 Hz tone. */
export async function makeTestVideo(): Promise<File> {
  const w = 640;
  const h = 360;
  const fps = 30;
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d')!;
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
    target: new BufferTarget(),
  });
  const video = new CanvasSource(canvas, { codec: 'avc', bitrate: QUALITY_HIGH });
  const audio = new AudioSampleSource({ codec: 'aac', bitrate: 128e3 });
  output.addVideoTrack(video, { frameRate: fps });
  output.addAudioTrack(audio);
  await output.start();
  for (let f = 0; f < fps * 3; f++) {
    ctx.fillStyle = COLORS[Math.floor(f / fps)]!;
    ctx.fillRect(0, 0, w, h);
    await video.add(f / fps, 1 / fps);
  }
  const rate = 48000;
  for (let s = 0; s < 3; s++) {
    const data = new Float32Array(rate * 2);
    for (let i = 0; i < rate; i++) {
      const v = 0.5 * Math.sin((2 * Math.PI * 440 * (s * rate + i)) / rate);
      data[i] = v;
      data[rate + i] = v;
    }
    const sample = new AudioSample({
      data,
      format: 'f32-planar',
      numberOfChannels: 2,
      sampleRate: rate,
      timestamp: s,
    });
    await audio.add(sample);
    sample.close();
  }
  video.close();
  audio.close();
  await output.finalize();
  return new File([output.target.buffer!], 'test-rgb.mp4', { type: 'video/mp4', lastModified: 1 });
}

async function pixelAt(
  file: Blob,
  t: number,
  x: number,
  y: number,
): Promise<[number, number, number]> {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
  const track = (await input.getPrimaryVideoTrack())!;
  const sink = new CanvasSink(track);
  const wc = (await sink.getCanvas(t))!;
  const c = wc.canvas as OffscreenCanvas;
  const d = c.getContext('2d')!.getImageData(x, y, 1, 1).data;
  input.dispose();
  return [d[0]!, d[1]!, d[2]!];
}

/**
 * Open the real editor UI on a project in an OPFS folder (stands in for a user-picked folder),
 * import the synthetic clip and place it plus a title on the timeline.
 */
export async function openDemoProject(): Promise<void> {
  const { createProjectInFolder, importHandles } = await import('../state/project-io.ts');
  const { addMediaToTimeline, addTitle, TITLE_PRESETS } = await import('../state/actions.ts');
  const root = await navigator.storage.getDirectory();
  await root.removeEntry('demo-project', { recursive: true }).catch(() => {});
  const dir = await root.getDirectoryHandle('demo-project', { create: true });
  const fh = await dir.getFileHandle('test-rgb.mp4', { create: true });
  const w = await fh.createWritable();
  await w.write(await makeTestVideo());
  await w.close();
  await createProjectInFolder(dir, 'Demo project');
  const [id] = await importHandles([fh]);
  if (!id) throw new Error('import failed');
  addMediaToTimeline(id, 0);
  addTitle(TITLE_PRESETS[0]);
}

export interface E2EResult {
  probe: Omit<MediaItem, 'id' | 'label' | 'relativePath'>;
  analysis: { thumbs: number; peaks: number; maxPeak: number };
  output: {
    duration: number;
    width: number;
    height: number;
    videoCodec: string | null;
    audioCodec: string | null;
    sizeBytes: number;
  };
  /** RGB samples from the exported file. */
  pixels: Record<string, [number, number, number]>;
  undo: { clipsAfterSplit: number; clipsAfterUndo: number };
}

export async function runE2E(): Promise<E2EResult> {
  await ensureFontsLoaded();
  const file = await makeTestVideo();
  const probe = await probeFile(file);

  const analyzer = new MediaAnalyzer();
  const analysis = await analyzer.analyze(file, 'video');
  analyzer.dispose();

  const project = createProject({ width: 640, height: 360 });
  const engine = new ProjectEngine(project);
  const vt = project.tracks[0]!.id;
  const fps = project.sequence.fps;
  const media: MediaItem = { ...probe, id: 'm1', label: 'Video 1', relativePath: null };
  const ok = (r: ReturnType<ProjectEngine['apply']>) => {
    if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
    return r;
  };
  ok(engine.apply({ ops: [{ type: 'addMedia', media }] }));
  ok(
    engine.apply({
      ops: [
        {
          type: 'addClip',
          clip: { id: 'c1', kind: 'video', trackId: vt, mediaId: 'm1', start: 0, duration: 90 },
        },
        // Trim the first second off (start now shows green), fade audio out.
        { type: 'trimClip', clipId: 'c1', edge: 'start', frame: 30 },
        { type: 'moveClip', clipId: 'c1', start: 0 },
        { type: 'setAudio', clipId: 'c1', audio: { fadeOut: 15 } },
        // A white title box in the top-left quadrant from 0–1 s.
        {
          type: 'addTitle',
          clipId: 't1',
          start: 0,
          duration: secondsToNearestFrame(1, fps),
          text: 'TEST',
          style: { fontSize: 40, color: '#ffffff', background: '#ffffffff', strokeWidth: 0 },
          transform: { x: -0.3, y: -0.3 },
        },
      ],
    }),
  );

  // Undo check: split then undo restores one clip.
  ok(engine.apply({ ops: [{ type: 'splitClip', clipId: 'c1', frame: 15 }] }));
  const clipsAfterSplit = engine.project.clips.filter((c) => c.kind === 'video').length;
  engine.undo();
  const clipsAfterUndo = engine.project.clips.filter((c) => c.kind === 'video').length;

  // Export with the real worker pipeline to an OPFS file.
  const root = await navigator.storage.getDirectory();
  const target = await root.getFileHandle('e2e-export.mp4', { create: true });
  const job = startExport({
    project: engine.project,
    files: new Map([['m1', file]]),
    fonts: FONT_FILES,
    target,
    onProgress: () => {},
  });
  const status = await job.done;
  if (status !== 'done') throw new Error(`Export ${status}`);

  const out = await target.getFile();
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(out) });
  const vtrack = await input.getPrimaryVideoTrack();
  const atrack = await input.getPrimaryAudioTrack();
  const result: E2EResult['output'] = {
    duration: await input.computeDuration(),
    width: vtrack ? await vtrack.getDisplayWidth() : 0,
    height: vtrack ? await vtrack.getDisplayHeight() : 0,
    videoCodec: vtrack ? await vtrack.getCodec() : null,
    audioCodec: atrack ? await atrack.getCodec() : null,
    sizeBytes: out.size,
  };
  input.dispose();

  const pixels = {
    // t=0.5: trimmed source shows green; title box (white) in the top-left area.
    green_center_0_5: await pixelAt(out, 0.5, 480, 270),
    title_box_0_5: await pixelAt(out, 0.5, 128, 72),
    // t=1.5: blue, title gone.
    blue_center_1_5: await pixelAt(out, 1.5, 480, 270),
    no_title_1_5: await pixelAt(out, 1.5, 128, 72),
  };
  await root.removeEntry('e2e-export.mp4').catch(() => {});

  let maxPeak = 0;
  for (const p of analysis.peaks ?? []) maxPeak = Math.max(maxPeak, p);
  return {
    probe,
    analysis: { thumbs: analysis.thumbs.length, peaks: analysis.peaks?.length ?? 0, maxPeak },
    output: result,
    pixels,
    undo: { clipsAfterSplit, clipsAfterUndo },
  };
}
