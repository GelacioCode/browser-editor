import {
  clipEnd,
  fpsToNumber,
  frameToSeconds,
  isTimedMediaClip,
  sequenceDuration,
  sourceTimeAt,
  usToSeconds,
  type Project,
  type TimedMediaClip,
} from '@viditor/project-core';
import { clipGainAt, renderFrame, type FrameSource } from '@viditor/composition';
import { onProjectChange, setPlayhead, useEditor, type MediaRuntime } from '../state/store.ts';
import { ensureFontsLoaded } from '../fonts.ts';

interface ElementEntry {
  el: HTMLVideoElement | HTMLAudioElement;
  url: string;
  source: MediaElementAudioSourceNode | null;
  gain: GainNode | null;
}

const PRELOAD_SECONDS = 2;
const RELEASE_SECONDS = 6;
const PLAY_DRIFT_TOLERANCE = 0.25;

const EMPTY: FrameSource = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 1;
  return { image: c, width: 1, height: 1 };
})();

/**
 * Real-time preview. Uses <video>/<audio> elements as frame/audio sources (hardware decoded,
 * synced to a wall clock), and the shared `renderFrame` compositor so the preview shows the same
 * composition the exporter renders.
 */
export class PreviewPlayer {
  private ctx: CanvasRenderingContext2D;
  private audioCtx: AudioContext | null = null;
  private master: GainNode | null = null;
  private elements = new Map<string, ElementEntry>();
  private images = new Map<string, { url: string; bmp: ImageBitmap | null }>();
  private raf = 0;
  private dirty = true;
  private lastFrame = -1;
  private playStartFrame = 0;
  private playStartTime = 0;
  private unsubs: (() => void)[] = [];

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.unsubs.push(onProjectChange(() => this.invalidate()));
    this.unsubs.push(
      useEditor.subscribe((s, prev) => {
        if (s.media !== prev.media) this.invalidate();
        if (s.playing !== prev.playing) {
          if (s.playing) this.onPlay();
          else this.onPause();
        }
      }),
    );
    void ensureFontsLoaded().then(() => this.invalidate());
    this.raf = requestAnimationFrame(this.tick);
  }

  invalidate() {
    this.dirty = true;
  }

  setSize(width: number, height: number) {
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.invalidate();
    }
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.unsubs.forEach((u) => u());
    for (const id of [...this.elements.keys()]) this.release(id);
    for (const img of this.images.values()) img.bmp?.close();
    void this.audioCtx?.close();
  }

  /* ---------------------------------------------------------------------------------------- */

  private ensureAudio() {
    if (!this.audioCtx) {
      this.audioCtx = new AudioContext({ latencyHint: 'playback' });
      this.master = this.audioCtx.createGain();
      this.master.connect(this.audioCtx.destination);
    }
    if (this.audioCtx.state === 'suspended') void this.audioCtx.resume();
    for (const e of this.elements.values()) this.connect(e);
  }

  private connect(e: ElementEntry) {
    if (!this.audioCtx || e.source) return;
    e.source = this.audioCtx.createMediaElementSource(e.el);
    e.gain = this.audioCtx.createGain();
    e.source.connect(e.gain).connect(this.master!);
  }

  private onPlay() {
    const s = useEditor.getState();
    if (!s.project) return;
    const end = sequenceDuration(s.project);
    if (end === 0) {
      useEditor.setState({ playing: false });
      return;
    }
    if (s.playhead >= end - 1) setPlayhead(0);
    this.ensureAudio();
    this.playStartFrame = useEditor.getState().playhead;
    this.playStartTime = performance.now();
  }

  private onPause() {
    for (const e of this.elements.values()) if (!e.el.paused) e.el.pause();
    this.invalidate();
  }

  private getElement(clip: TimedMediaClip, media: MediaRuntime): ElementEntry | null {
    if (media.status !== 'ready' || !media.url) return null;
    let e = this.elements.get(clip.id);
    if (e && e.url !== media.url) {
      this.release(clip.id);
      e = undefined;
    }
    if (!e) {
      const el =
        clip.kind === 'video' ? document.createElement('video') : document.createElement('audio');
      el.preload = 'auto';
      el.src = media.url;
      el.preservesPitch = false; // match export: speed changes resample audio
      if (el instanceof HTMLVideoElement) el.playsInline = true;
      el.addEventListener('seeked', () => this.invalidate());
      el.addEventListener('loadeddata', () => this.invalidate());
      e = { el, url: media.url, source: null, gain: null };
      this.elements.set(clip.id, e);
      if (this.audioCtx) this.connect(e);
    }
    return e;
  }

  private release(clipId: string) {
    const e = this.elements.get(clipId);
    if (!e) return;
    e.el.pause();
    e.source?.disconnect();
    e.gain?.disconnect();
    e.el.removeAttribute('src');
    e.el.load();
    this.elements.delete(clipId);
  }

  private image(mediaId: string, media: MediaRuntime): FrameSource | null {
    if (media.status !== 'ready' || !media.file || !media.url) return null;
    let img = this.images.get(mediaId);
    if (img && img.url !== media.url) {
      img.bmp?.close();
      img = undefined;
    }
    if (!img) {
      const entry: { url: string; bmp: ImageBitmap | null } = { url: media.url, bmp: null };
      this.images.set(mediaId, entry);
      createImageBitmap(media.file)
        .then((b) => {
          entry.bmp = b;
          this.invalidate();
        })
        .catch(() => {});
      return EMPTY;
    }
    return img.bmp ? { image: img.bmp, width: img.bmp.width, height: img.bmp.height } : EMPTY;
  }

  /** Bring media elements in line with the timeline at `frame`. Returns true if any seek is pending. */
  private sync(project: Project, frame: number, playing: boolean): boolean {
    const fps = project.sequence.fps;
    const rate = fpsToNumber(fps);
    const media = useEditor.getState().media;
    const mutedTracks = new Set(project.tracks.filter((t) => t.muted).map((t) => t.id));
    const seen = new Set<string>();
    let pending = false;

    for (const clip of project.clips) {
      if (!isTimedMediaClip(clip)) continue;
      const mr = media[clip.mediaId];
      if (!mr) continue;
      const startS = frameToSeconds(clip.start, fps);
      const endS = frameToSeconds(clipEnd(clip), fps);
      const nowS = frameToSeconds(frame, fps);
      if (nowS < startS - PRELOAD_SECONDS || nowS > endS + RELEASE_SECONDS) continue;
      const e = this.getElement(clip, mr);
      if (!e) continue;
      seen.add(clip.id);
      const el = e.el;
      const active = frame >= clip.start && frame < clipEnd(clip);

      if (e.gain && this.audioCtx) {
        const trackMuted = mutedTracks.has(clip.trackId);
        const g = active && !trackMuted ? clipGainAt(clip, frame) : 0;
        e.gain.gain.setTargetAtTime(g, this.audioCtx.currentTime, 0.015);
      }

      if (!active) {
        if (!el.paused) el.pause();
        // Pre-roll: park upcoming clips on their first frame.
        if (frame < clip.start) {
          const target = usToSeconds(clip.sourceInUs);
          if (Math.abs(el.currentTime - target) > 0.05 && !el.seeking) el.currentTime = target;
        }
        continue;
      }

      const desired = usToSeconds(sourceTimeAt(clip, frame, fps));
      if (el.playbackRate !== clip.speed) el.playbackRate = clip.speed;
      if (playing) {
        if (el.paused) {
          el.currentTime = desired;
          void el.play().catch(() => {});
        } else if (Math.abs(el.currentTime - desired) > PLAY_DRIFT_TOLERANCE * clip.speed) {
          el.currentTime = desired;
        }
      } else {
        if (!el.paused) el.pause();
        if (Math.abs(el.currentTime - desired) > 0.5 / rate && !el.seeking)
          el.currentTime = desired;
        if (el.seeking || el.readyState < 2) pending = true;
      }
    }

    for (const id of [...this.elements.keys()]) if (!seen.has(id)) this.release(id);
    return pending;
  }

  private tick = () => {
    this.raf = requestAnimationFrame(this.tick);
    const s = useEditor.getState();
    const project = s.project;
    if (!project) return;
    const fps = project.sequence.fps;
    let frame = s.playhead;

    if (s.playing) {
      const elapsed = (performance.now() - this.playStartTime) / 1000;
      frame = this.playStartFrame + Math.floor(elapsed * fpsToNumber(fps));
      const end = sequenceDuration(project);
      if (frame >= end) {
        frame = Math.max(0, end - 1);
        useEditor.setState({ playing: false, playhead: frame });
      } else if (frame !== s.playhead) {
        useEditor.setState({ playhead: frame });
      }
    }

    const pending = this.sync(project, frame, s.playing);
    if (!s.playing && pending) return; // keep the last good frame until seeks land
    if (!s.playing && !this.dirty && frame === this.lastFrame) return;

    this.dirty = false;
    this.lastFrame = frame;
    const media = s.media;
    renderFrame(
      this.ctx,
      project,
      frame,
      (clip) => {
        const mr = media[clip.mediaId];
        if (!mr || mr.status === 'loading') return EMPTY;
        if (clip.kind === 'image') return this.image(clip.mediaId, mr);
        const e = this.elements.get(clip.id);
        if (!e) return mr.status === 'ready' ? EMPTY : null;
        const v = e.el as HTMLVideoElement;
        if (v.readyState < 2 || !v.videoWidth) return EMPTY;
        return { image: v, width: v.videoWidth, height: v.videoHeight };
      },
      { outWidth: this.canvas.width, outHeight: this.canvas.height, drawMissing: true },
    );
  };
}
