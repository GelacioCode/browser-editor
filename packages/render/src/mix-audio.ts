import { ALL_FORMATS, AudioBufferSink, BlobSource, Input } from 'mediabunny';
import {
  audibleClips,
  frameToSeconds,
  sequenceDuration,
  usToSeconds,
  type Project,
  type TimedMediaClip,
} from '@viditor/project-core';
import { gainAutomation } from '@viditor/composition';

export interface MixedAudio {
  /** Planar float32: all of channel 0, then all of channel 1. */
  planar: Float32Array;
  numberOfChannels: number;
  sampleRate: number;
  frames: number;
}

/** Decode the source span a clip uses into one AudioBuffer (at the source sample rate). */
async function decodeClipSource(
  ctx: BaseAudioContext,
  file: File,
  clip: TimedMediaClip,
  fps: Project['sequence']['fps'],
) {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track || !(await track.canDecode())) return null;
    const startS = usToSeconds(clip.sourceInUs);
    const lengthS = frameToSeconds(clip.duration, fps) * clip.speed;
    const rate = await track.getSampleRate();
    const channels = Math.max(1, Math.min(2, await track.getNumberOfChannels()));
    const total = Math.max(1, Math.ceil(lengthS * rate));
    const out = ctx.createBuffer(channels, total, rate);
    const sink = new AudioBufferSink(track);
    for await (const { buffer, timestamp } of sink.buffers(startS, startS + lengthS)) {
      let dst = Math.round((timestamp - startS) * rate);
      let src = 0;
      if (dst < 0) {
        src = -dst;
        dst = 0;
      }
      const n = Math.min(buffer.length - src, total - dst);
      if (n <= 0) continue;
      for (let ch = 0; ch < channels; ch++) {
        const data = buffer.getChannelData(Math.min(ch, buffer.numberOfChannels - 1));
        out.getChannelData(ch).set(data.subarray(src, src + n), dst);
      }
    }
    return out;
  } finally {
    input.dispose();
  }
}

/**
 * Mix all audible clips into one stereo buffer. Uses the same gain/fade automation model as the
 * preview (`gainAutomation`). Speed changes resample (pitch follows speed, as in the preview).
 */
export async function mixTimelineAudio(
  project: Project,
  files: ReadonlyMap<string, File>,
  sampleRate = 48000,
  onProgress?: (done: number, total: number) => void,
): Promise<MixedAudio | null> {
  const clips = audibleClips(project);
  const durationS = frameToSeconds(sequenceDuration(project), project.sequence.fps);
  if (clips.length === 0 || durationS <= 0) return null;
  const frames = Math.ceil(durationS * sampleRate);
  const ctx = new OfflineAudioContext(2, frames, sampleRate);
  const fps = project.sequence.fps;

  let done = 0;
  for (const clip of clips) {
    const file = files.get(clip.mediaId);
    if (!file) throw new Error(`Media for clip ${clip.id} is offline`);
    const buf = await decodeClipSource(ctx, file, clip, fps);
    onProgress?.(++done, clips.length);
    if (!buf) continue;
    const node = ctx.createBufferSource();
    node.buffer = buf;
    node.playbackRate.value = clip.speed;
    const gain = ctx.createGain();
    const pts = gainAutomation(clip, fps);
    gain.gain.setValueAtTime(pts[0]!.value, pts[0]!.time);
    for (const p of pts.slice(1)) gain.gain.linearRampToValueAtTime(p.value, p.time);
    node.connect(gain).connect(ctx.destination);
    const startS = frameToSeconds(clip.start, fps);
    node.start(startS, 0, buf.duration);
    node.stop(frameToSeconds(clip.start + clip.duration, fps));
  }

  const rendered = await ctx.startRendering();
  const planar = new Float32Array(frames * 2);
  planar.set(rendered.getChannelData(0), 0);
  planar.set(rendered.getChannelData(rendered.numberOfChannels > 1 ? 1 : 0), frames);
  return { planar, numberOfChannels: 2, sampleRate, frames };
}
