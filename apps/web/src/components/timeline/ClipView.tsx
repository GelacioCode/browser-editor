import { memo, useEffect, useRef } from 'react';
import { Gauge, AlertTriangle, LayoutTemplate } from 'lucide-react';
import {
  frameToSeconds,
  usToSeconds,
  type Clip,
  type MediaItem,
  type Rational,
} from '@viditor/project-core';
import type { MediaRuntime } from '../../state/store.ts';
import { cx } from '../../ui/ui.tsx';
import { EDGE_PX } from './geometry.ts';

const KIND_COLOR: Record<Clip['kind'], string> = {
  video: 'var(--vd-clip-video)',
  image: 'var(--vd-clip-image)',
  audio: 'var(--vd-clip-audio)',
  text: 'var(--vd-clip-text)',
  caption: 'var(--vd-clip-caption)',
  slot: 'var(--vd-clip-slot)',
};

interface Props {
  clip: Clip;
  /** Display geometry (may differ from the clip while dragging). */
  left: number;
  width: number;
  height: number;
  selected: boolean;
  dragging: boolean;
  /** A library item is being dragged over this template clip. */
  dropTarget?: boolean;
  /** Source µs of the selected beat marker on this clip, if any. */
  selectedBeatUs?: number | null;
  onBeatPointerDown?: (e: React.PointerEvent, clip: Clip, us: number) => void;
  media?: MediaItem;
  runtime?: MediaRuntime;
  fps: Rational;
  pxPerSecond: number;
  /** Visible span of this clip, in clip-local px. */
  visibleFrom: number;
  visibleTo: number;
  onPointerDown: (
    e: React.PointerEvent,
    clip: Clip,
    mode: 'move' | 'trim-start' | 'trim-end',
  ) => void;
}

function Thumbs({
  clip,
  runtime,
  height,
  pxPerSecond,
  fps,
  visibleFrom,
  visibleTo,
}: Pick<
  Props,
  'clip' | 'runtime' | 'height' | 'pxPerSecond' | 'fps' | 'visibleFrom' | 'visibleTo'
>) {
  const thumbs = runtime?.thumbs;
  if (!thumbs?.length || !runtime?.thumbWidth || !runtime.thumbHeight) return null;
  const tileW = Math.max(16, (runtime.thumbWidth / runtime.thumbHeight) * height);
  const first = Math.max(0, Math.floor(visibleFrom / tileW));
  const last = Math.ceil(visibleTo / tileW);
  const tiles = [];
  for (let i = first; i <= last; i++) {
    const x = i * tileW;
    let url = thumbs[0]!.url;
    if (clip.kind === 'video') {
      const src = usToSeconds(clip.sourceInUs) + (x / pxPerSecond) * clip.speed;
      let best = thumbs[0]!;
      for (const t of thumbs) if (Math.abs(t.time - src) < Math.abs(best.time - src)) best = t;
      url = best.url;
    }
    tiles.push(
      <img
        key={i}
        src={url}
        alt=""
        draggable={false}
        className="absolute top-0 h-full object-cover"
        style={{ left: x, width: tileW }}
      />,
    );
  }
  void fps;
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden opacity-70">{tiles}</div>
  );
}

function Waveform({
  clip,
  runtime,
  height,
  pxPerSecond,
  visibleFrom,
  visibleTo,
  className,
}: Pick<Props, 'clip' | 'runtime' | 'height' | 'pxPerSecond' | 'visibleFrom' | 'visibleTo'> & {
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const peaks = runtime?.peaks;
  const pps = runtime?.peaksPerSecond ?? 50;
  const w = Math.max(1, Math.ceil(visibleTo - visibleFrom));
  useEffect(() => {
    const c = ref.current;
    if (!c || !peaks || !('sourceInUs' in clip)) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(w * dpr);
    c.height = Math.round(height * dpr);
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, height);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    const srcStart = usToSeconds(clip.sourceInUs);
    const mid = height / 2;
    const gain = clip.audio.mute ? 0 : Math.min(2, clip.audio.gain);
    for (let x = 0; x < w; x++) {
      const t0 = srcStart + ((visibleFrom + x) / pxPerSecond) * clip.speed;
      const t1 = srcStart + ((visibleFrom + x + 1) / pxPerSecond) * clip.speed;
      let max = 0;
      for (let i = Math.floor(t0 * pps); i <= Math.floor(t1 * pps) && i < peaks.length; i++)
        max = Math.max(max, peaks[i] ?? 0);
      const h = Math.max(0.5, Math.min(1, max * gain) * (height - 2));
      ctx.fillRect(x, mid - h / 2, 1, h);
    }
  }, [peaks, pps, w, height, visibleFrom, pxPerSecond, clip]);
  if (!peaks) return null;
  return (
    <canvas
      ref={ref}
      className={cx('pointer-events-none absolute', className)}
      style={{ left: visibleFrom, width: w, height }}
    />
  );
}

/** Beat marker ticks (source µs → clip-local px), drawn for the visible part of the clip. */
function BeatTicks(p: Props) {
  const { clip } = p;
  if (!('beatsUs' in clip) || clip.beatsUs.length === 0) return null;
  const pxPerUs = p.pxPerSecond / 1_000_000 / clip.speed;
  const ticks = [];
  for (const us of clip.beatsUs) {
    const x = (us - clip.sourceInUs) * pxPerUs;
    if (x < 0 || x >= p.width) continue;
    if (x < p.visibleFrom - 10 || x > p.visibleTo + 10) continue;
    const sel = p.selectedBeatUs === us;
    ticks.push(
      <div
        key={us}
        data-beat={us}
        title="Beat marker: drag to move · click, then Delete to remove"
        className="group/beat absolute top-0 z-10 h-full w-[11px] -translate-x-1/2 cursor-ew-resize"
        style={{ left: x }}
        onPointerDown={(e) => {
          e.stopPropagation();
          p.onBeatPointerDown?.(e, clip, us);
        }}
      >
        <div
          className={cx(
            'absolute left-1/2 top-0 h-full w-px -translate-x-1/2',
            sel ? 'bg-white' : 'bg-beat/80 group-hover/beat:bg-white',
          )}
        />
        <div
          className={cx(
            'absolute left-1/2 top-0 h-0 w-0 -translate-x-1/2 border-x-[4px] border-t-[6px] border-x-transparent',
            sel ? 'border-t-white' : 'border-t-beat',
          )}
        />
      </div>,
    );
  }
  return <>{ticks}</>;
}

function SlotBody({
  clip,
  width,
  fps,
}: {
  clip: Extract<Clip, { kind: 'slot' }>;
  width: number;
  fps: Rational;
}) {
  const secs = frameToSeconds(clip.duration, fps);
  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col justify-center gap-0.5 overflow-hidden rounded-[5px] border border-dashed border-white/35 px-1.5 text-[10px] leading-tight text-muted">
      <span className="flex items-center gap-1 font-medium text-text">
        <LayoutTemplate size={10} className="shrink-0" />#{clip.index}
        {width > 70 && <span className="tabular-nums text-faint">{secs.toFixed(2)}s</span>}
      </span>
      {width > 90 && <span className="truncate text-faint">Drop a clip</span>}
    </div>
  );
}

export const ClipView = memo(function ClipView(p: Props) {
  const { clip, media, runtime } = p;
  const offline =
    'mediaId' in clip && runtime && runtime.status !== 'ready' && runtime.status !== 'loading';
  const label =
    clip.kind === 'text' || clip.kind === 'caption'
      ? clip.text.split('\n')[0] || '(empty)'
      : clip.kind === 'slot'
        ? ''
        : (media?.name ?? 'Media');
  const slotNo = (clip.kind === 'video' || clip.kind === 'image') && clip.templateSlot;
  const showWave =
    (clip.kind === 'audio' || (clip.kind === 'video' && media?.hasAudio)) && !!runtime?.peaks;
  const waveH = clip.kind === 'audio' ? p.height - 16 : 16;
  const speed = 'speed' in clip && clip.speed !== 1 ? clip.speed : null;
  const fade = 'audio' in clip ? clip.audio : null;
  const fadeInPx = fade ? frameToSeconds(fade.fadeIn, p.fps) * p.pxPerSecond : 0;
  const fadeOutPx = fade ? frameToSeconds(fade.fadeOut, p.fps) * p.pxPerSecond : 0;

  return (
    <div
      data-clip-id={clip.id}
      className={cx(
        'group absolute top-0.5 overflow-hidden rounded-[5px] text-white',
        p.dragging ? 'z-20 opacity-90 shadow-lg' : 'z-10',
        p.selected ? 'ring-2 ring-white' : 'ring-1 ring-black/40',
        p.dropTarget && 'ring-2 ring-accent brightness-125',
      )}
      style={{
        left: p.left,
        width: Math.max(2, p.width),
        height: p.height - 4,
        background: KIND_COLOR[clip.kind],
      }}
      onPointerDown={(e) => {
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const x = e.clientX - r.left;
        const edge = Math.min(EDGE_PX, r.width / 4);
        p.onPointerDown(
          e,
          clip,
          x < edge ? 'trim-start' : x > r.width - edge ? 'trim-end' : 'move',
        );
      }}
    >
      {clip.kind === 'slot' && <SlotBody clip={clip} width={p.width} fps={p.fps} />}
      {(clip.kind === 'video' || clip.kind === 'image') && (
        <Thumbs
          clip={clip}
          runtime={runtime}
          height={p.height - 4}
          pxPerSecond={p.pxPerSecond}
          fps={p.fps}
          visibleFrom={p.visibleFrom}
          visibleTo={p.visibleTo}
        />
      )}
      {showWave && (
        <Waveform
          clip={clip}
          runtime={runtime}
          height={waveH}
          pxPerSecond={p.pxPerSecond}
          visibleFrom={p.visibleFrom}
          visibleTo={p.visibleTo}
          className={clip.kind === 'audio' ? 'top-[14px]' : 'bottom-0 bg-black/35'}
        />
      )}
      {fadeInPx > 1 && (
        <svg
          className="pointer-events-none absolute left-0 top-0 h-full"
          style={{ width: fadeInPx }}
          preserveAspectRatio="none"
          viewBox="0 0 10 10"
        >
          <path d="M0 10 L10 0 L0 0 Z" fill="rgba(0,0,0,0.35)" />
        </svg>
      )}
      {fadeOutPx > 1 && (
        <svg
          className="pointer-events-none absolute right-0 top-0 h-full"
          style={{ width: fadeOutPx }}
          preserveAspectRatio="none"
          viewBox="0 0 10 10"
        >
          <path d="M0 0 L10 10 L10 0 Z" fill="rgba(0,0,0,0.35)" />
        </svg>
      )}
      <BeatTicks {...p} />
      <div className="pointer-events-none relative flex items-center gap-1 px-1.5 pt-0.5 text-[10px] font-medium leading-tight [text-shadow:0_1px_2px_rgba(0,0,0,0.8)]">
        {offline && <AlertTriangle size={10} className="shrink-0 text-warning" />}
        {slotNo && (
          <span className="flex shrink-0 items-center gap-0.5 rounded bg-black/40 px-1">
            <LayoutTemplate size={9} />#{slotNo}
          </span>
        )}
        {speed && (
          <span className="flex shrink-0 items-center gap-0.5 rounded bg-black/40 px-1">
            <Gauge size={9} />
            {speed}×
          </span>
        )}
        <span className="truncate">{label}</span>
      </div>
      {/* Trim handles */}
      <div className="absolute inset-y-0 left-0 w-[7px] cursor-ew-resize bg-white/0 group-hover:bg-white/25" />
      <div className="absolute inset-y-0 right-0 w-[7px] cursor-ew-resize bg-white/0 group-hover:bg-white/25" />
    </div>
  );
});
