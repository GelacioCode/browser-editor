import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Play, Pause, SkipBack, SkipForward, ChevronLeft, ChevronRight, Frame } from 'lucide-react';
import {
  clipEnd,
  findMedia,
  formatTimecode,
  sequenceDuration,
  visualLayersAt,
  type Project,
  type VisualClip,
} from '@viditor/project-core';
import { boxContains, measureTextClip, mediaLayerBox, type LayerBox } from '@viditor/composition';
import { PreviewPlayer } from '../preview/player.ts';
import { apply, select, setPlayhead, useEditor } from '../state/store.ts';
import { IconButton } from '../ui/ui.tsx';

const measureCtx = document.createElement('canvas').getContext('2d')!;

function layerBox(project: Project, clip: VisualClip): LayerBox | null {
  if (clip.kind === 'text' || clip.kind === 'caption')
    return measureTextClip(measureCtx, project, clip).box;
  const m = findMedia(project, clip.mediaId);
  if (!m) return null;
  return mediaLayerBox(
    project.sequence,
    m.width || project.sequence.width,
    m.height || project.sequence.height,
    clip.transform,
  );
}

function Controls() {
  const playing = useEditor((s) => s.playing);
  const playhead = useEditor((s) => s.playhead);
  const project = useEditor((s) => s.project!);
  const safeArea = useEditor((s) => s.safeArea);
  const fps = project.sequence.fps;
  const total = sequenceDuration(project);
  return (
    <div className="flex h-10 shrink-0 items-center justify-center gap-1 border-t border-border px-3">
      <span className="w-28 text-[11px] tabular-nums text-text">
        {formatTimecode(playhead, fps)}
      </span>
      <div className="flex flex-1 items-center justify-center gap-1">
        <IconButton label="Go to start (Home)" onClick={() => setPlayhead(0)}>
          <SkipBack size={15} />
        </IconButton>
        <IconButton label="Previous frame (←)" onClick={() => setPlayhead(playhead - 1)}>
          <ChevronLeft size={16} />
        </IconButton>
        <button
          aria-label={playing ? 'Pause (Space)' : 'Play (Space)'}
          title={playing ? 'Pause (Space)' : 'Play (Space)'}
          onClick={() => useEditor.setState({ playing: !playing })}
          className="mx-1 flex h-8 w-8 items-center justify-center rounded-full bg-text text-bg hover:bg-white"
        >
          {playing ? <Pause size={15} /> : <Play size={15} className="ml-0.5" />}
        </button>
        <IconButton label="Next frame (→)" onClick={() => setPlayhead(playhead + 1)}>
          <ChevronRight size={16} />
        </IconButton>
        <IconButton label="Go to end (End)" onClick={() => setPlayhead(total)}>
          <SkipForward size={15} />
        </IconButton>
      </div>
      <div className="flex w-28 items-center justify-end gap-1">
        <span className="text-[11px] tabular-nums text-faint">{formatTimecode(total, fps)}</span>
        <IconButton
          label="Safe-area guides"
          active={safeArea}
          onClick={() => useEditor.setState({ safeArea: !safeArea })}
        >
          <Frame size={14} />
        </IconButton>
      </div>
    </div>
  );
}

interface Drag {
  mode: 'move' | 'scale';
  clipId: string;
  startX: number;
  startY: number;
  orig: { x: number; y: number; scale: number };
  center: { x: number; y: number };
  key: string;
}

let dragSeq = 0;

export function Preview() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playerRef = useRef<PreviewPlayer | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [snapGuide, setSnapGuide] = useState<{ x: boolean; y: boolean }>({ x: false, y: false });
  const drag = useRef<Drag | null>(null);

  const project = useEditor((s) => s.project!);
  const playhead = useEditor((s) => s.playhead);
  const selection = useEditor((s) => s.selection);
  const safeArea = useEditor((s) => s.safeArea);
  const seq = project.sequence;

  useEffect(() => {
    const p = new PreviewPlayer(canvasRef.current!);
    playerRef.current = p;
    return () => p.destroy();
  }, []);

  // Fit the canvas to the available area while keeping the sequence aspect ratio.
  useLayoutEffect(() => {
    const el = wrapRef.current!;
    const ro = new ResizeObserver(() => {
      const pad = 24;
      const aw = Math.max(0, el.clientWidth - pad);
      const ah = Math.max(0, el.clientHeight - pad);
      const k = Math.min(aw / seq.width, ah / seq.height);
      setSize({ w: Math.floor(seq.width * k), h: Math.floor(seq.height * k) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [seq.width, seq.height]);

  useEffect(() => {
    if (!size.w) return;
    const dpr = window.devicePixelRatio || 1;
    const bw = Math.min(seq.width, Math.round(size.w * dpr));
    playerRef.current?.setSize(bw, Math.round((bw * seq.height) / seq.width));
  }, [size, seq.width, seq.height]);

  const k = size.w / seq.width; // css px per sequence px

  const layers = visualLayersAt(project, playhead);
  const selectedLayer = layers.find((c) => selection.includes(c.id));
  const selBox = selectedLayer ? layerBox(project, selectedLayer) : null;
  const locked = (clip: VisualClip) => project.tracks.find((t) => t.id === clip.trackId)?.locked;
  const hiddenTracks = new Set(project.tracks.filter((t) => t.hidden).map((t) => t.id));
  const emptySlot = project.clips.find(
    (c) =>
      c.kind === 'slot' &&
      !hiddenTracks.has(c.trackId) &&
      playhead >= c.start &&
      playhead < clipEnd(c),
  );

  const toSeq = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / k, y: (e.clientY - r.top) / k };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const p = toSeq(e);
    const hit = [...layers].reverse().find((c) => {
      const b = layerBox(project, c);
      return b && boxContains(b, p.x, p.y);
    });
    if (!hit) {
      select([]);
      return;
    }
    select([hit.id], e.shiftKey);
    if (locked(hit)) return;
    const b = layerBox(project, hit)!;
    drag.current = {
      mode: 'move',
      clipId: hit.id,
      startX: e.clientX,
      startY: e.clientY,
      orig: { x: hit.transform.x, y: hit.transform.y, scale: hit.transform.scale },
      center: { x: b.cx, y: b.cy },
      key: `drag:${++dragSeq}`,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onScaleDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    if (!selectedLayer || !selBox || locked(selectedLayer)) return;
    drag.current = {
      mode: 'scale',
      clipId: selectedLayer.id,
      startX: e.clientX,
      startY: e.clientY,
      orig: { ...selectedLayer.transform },
      center: { x: selBox.cx, y: selBox.cy },
      key: `scale:${++dragSeq}`,
    };
    wrapRef.current!.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (d.mode === 'move') {
      let x = d.orig.x + (e.clientX - d.startX) / k / seq.width;
      let y = d.orig.y + (e.clientY - d.startY) / k / seq.height;
      const sx = Math.abs(x) < 0.012;
      const sy = Math.abs(y) < 0.012;
      if (sx) x = 0;
      if (sy) y = 0;
      setSnapGuide({ x: sx, y: sy });
      apply(
        {
          type: 'setTransform',
          clipId: d.clipId,
          transform: { x: clamp(x, -4, 4), y: clamp(y, -4, 4) },
        },
        { coalesceKey: d.key, label: 'Move layer', notify: false },
      );
    } else {
      const r = canvasRef.current!.getBoundingClientRect();
      const cx = r.left + d.center.x * k;
      const cy = r.top + d.center.y * k;
      const d0 = Math.hypot(d.startX - cx, d.startY - cy) || 1;
      const d1 = Math.hypot(e.clientX - cx, e.clientY - cy);
      apply(
        {
          type: 'setTransform',
          clipId: d.clipId,
          transform: { scale: clamp(d.orig.scale * (d1 / d0), 0.01, 20) },
        },
        { coalesceKey: d.key, label: 'Scale layer', notify: false },
      );
    }
  };

  const onPointerUp = () => {
    drag.current = null;
    setSnapGuide({ x: false, y: false });
  };

  return (
    <div className="flex h-full flex-col bg-bg">
      <div
        ref={wrapRef}
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden"
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="relative" style={{ width: size.w, height: size.h }}>
          <canvas
            ref={canvasRef}
            className="block h-full w-full cursor-default shadow-[0_0_0_1px_var(--vd-border)]"
            onPointerDown={onPointerDown}
            aria-label="Preview"
          />
          {safeArea && (
            <div className="pointer-events-none absolute inset-0">
              <div
                className="absolute border border-dashed border-white/35"
                style={{ inset: '5%' }}
              />
              <div
                className="absolute border border-dashed border-white/25"
                style={{ inset: '10%' }}
              />
            </div>
          )}
          {emptySlot?.kind === 'slot' && (
            <div className="pointer-events-none absolute inset-0 border-2 border-dashed border-white/30">
              <div className="absolute bottom-2 left-2 rounded bg-black/70 px-2 py-1 text-[11px] text-white">
                Empty slot #{emptySlot.index} · drag a clip onto it in the timeline
              </div>
            </div>
          )}
          {snapGuide.x && (
            <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px bg-snap" />
          )}
          {snapGuide.y && (
            <div className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-snap" />
          )}
          {selBox && (
            <div
              className="pointer-events-none absolute border border-white shadow-[0_0_0_1px_rgba(0,0,0,0.5)]"
              style={{
                left: (selBox.cx - selBox.width / 2) * k,
                top: (selBox.cy - selBox.height / 2) * k,
                width: selBox.width * k,
                height: selBox.height * k,
                transform: `rotate(${selBox.rotation}rad)`,
              }}
            >
              <div
                role="slider"
                aria-label="Scale"
                aria-valuenow={selectedLayer?.transform.scale}
                className="pointer-events-auto absolute -bottom-1.5 -right-1.5 h-3 w-3 cursor-nwse-resize rounded-sm border border-black/50 bg-white"
                onPointerDown={onScaleDown}
              />
            </div>
          )}
        </div>
      </div>
      <Controls />
    </div>
  );
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}
