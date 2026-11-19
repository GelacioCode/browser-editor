import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Scissors,
  Trash2,
  Copy,
  Magnet,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Eye,
  EyeOff,
  Volume2,
  VolumeX,
  Lock,
  Unlock,
  Plus,
  Film,
  Music,
  Type,
  Captions,
  X,
} from 'lucide-react';
import {
  TRACK_ACCEPTS,
  allBeatFrames,
  clipEnd,
  findMedia,
  fpsToNumber,
  isTimedMediaClip,
  maxFramesFrom,
  sequenceDuration,
  slipRangeUs,
  snapPoints,
  sourceUsToFrames,
  type Clip,
  type Operation,
  type Track,
  type TrackKind,
} from '@viditor/project-core';
import { apply, select, setPlayhead, useEditor } from '../../state/store.ts';
import {
  addMediaToTimeline,
  deleteSelection,
  duplicateSelection,
  splitAtPlayhead,
} from '../../state/actions.ts';
import { IconButton, cx } from '../../ui/ui.tsx';
import { fillSlot, moveBeat } from '../../state/beats.ts';
import { MEDIA_DRAG_TYPE } from '../MediaPanel.tsx';
import { ClipView } from './ClipView.tsx';
import { Ruler } from './Ruler.tsx';
import { HEADER_W, RULER_H, SNAP_PX, TRACK_HEIGHT, type Viewport } from './geometry.ts';

const TRACK_ICON: Record<TrackKind, typeof Film> = {
  video: Film,
  audio: Music,
  text: Type,
  caption: Captions,
};

interface DragState {
  /** 'slip' (Ctrl/⌘ + drag): change which part of the source shows; the clip stays put. */
  mode: 'move' | 'trim-start' | 'trim-end' | 'slip';
  clipId: string;
  /** Other selected clips moved together (move mode only). */
  group: string[];
  startClientX: number;
  orig: { start: number; duration: number; trackId: string };
  moved: boolean;
  /** Current preview values. */
  start: number;
  duration: number;
  trackId: string;
  snapAt: number | null;
  /** Slip mode: source in-point at drag start, and the undo-coalescing key. */
  origIn?: number;
  slipKey?: string;
}

interface BeatDrag {
  clipId: string;
  us: number;
  startClientX: number;
  moved: boolean;
  curUs: number;
}

let slipSeq = 0;

/** A template slot, or a clip that fills one: dropping library media on it swaps the media. */
function isTemplateClip(c: Clip) {
  return c.kind === 'slot' || ((c.kind === 'video' || c.kind === 'image') && !!c.templateSlot);
}

function TrackHeader({ track, empty }: { track: Track; empty: boolean }) {
  const Icon = TRACK_ICON[track.kind];
  const visual = track.kind !== 'audio';
  const audible = track.kind === 'video' || track.kind === 'audio';
  const upd = (patch: Partial<Pick<Track, 'muted' | 'hidden' | 'locked'>>) =>
    apply({ type: 'updateTrack', trackId: track.id, ...patch }, { label: 'Update track' });
  return (
    <div
      className="sticky left-0 z-20 flex shrink-0 items-center gap-0.5 border-b border-r border-border bg-surface-2 px-1.5"
      style={{ width: HEADER_W, height: TRACK_HEIGHT[track.kind] }}
    >
      <Icon size={12} className="mr-0.5 shrink-0 text-faint" />
      <span className="min-w-0 flex-1 truncate text-[11px] text-muted">{track.name}</span>
      {visual && (
        <IconButton
          label={track.hidden ? 'Show track' : 'Hide track'}
          className="h-6 w-6"
          active={track.hidden}
          onClick={() => upd({ hidden: !track.hidden })}
        >
          {track.hidden ? <EyeOff size={12} /> : <Eye size={12} />}
        </IconButton>
      )}
      {audible && (
        <IconButton
          label={track.muted ? 'Unmute track' : 'Mute track'}
          className="h-6 w-6"
          active={track.muted}
          onClick={() => upd({ muted: !track.muted })}
        >
          {track.muted ? <VolumeX size={12} /> : <Volume2 size={12} />}
        </IconButton>
      )}
      <IconButton
        label={track.locked ? 'Unlock track' : 'Lock track'}
        className="h-6 w-6"
        active={track.locked}
        onClick={() => upd({ locked: !track.locked })}
      >
        {track.locked ? <Lock size={12} /> : <Unlock size={12} />}
      </IconButton>
      {empty && (
        <IconButton
          label="Delete empty track"
          className="h-6 w-6"
          onClick={() =>
            apply({ type: 'removeTrack', trackId: track.id }, { label: 'Delete track' })
          }
        >
          <X size={12} />
        </IconButton>
      )}
    </div>
  );
}

function AddTrackMenu() {
  const [open, setOpen] = useState(false);
  const add = (kind: TrackKind) => {
    const tracks = useEditor.getState().project!.tracks;
    const index =
      kind === 'audio'
        ? tracks.length
        : kind === 'video'
          ? Math.max(
              0,
              tracks.findIndex((t) => t.kind === 'video'),
            )
          : 0;
    apply({ type: 'addTrack', kind, index }, { label: 'Add track' });
    setOpen(false);
  };
  return (
    <div className="relative">
      <IconButton label="Add track" onClick={() => setOpen(!open)} active={open}>
        <Plus size={14} />
      </IconButton>
      {open && (
        <div
          className="absolute left-0 top-8 z-40 w-36 rounded-md border border-border bg-surface-2 p-1 shadow-xl"
          onMouseLeave={() => setOpen(false)}
        >
          {(['video', 'audio', 'text', 'caption'] as TrackKind[]).map((k) => {
            const I = TRACK_ICON[k];
            return (
              <button
                key={k}
                onClick={() => add(k)}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-surface-hover"
              >
                <I size={12} /> {k[0]!.toUpperCase() + k.slice(1)} track
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function Timeline() {
  const project = useEditor((s) => s.project!);
  const media = useEditor((s) => s.media);
  const selection = useEditor((s) => s.selection);
  const zoom = useEditor((s) => s.zoom);
  const snapping = useEditor((s) => s.snapping);
  const playing = useEditor((s) => s.playing);
  const playhead = useEditor((s) => s.playhead);

  const scrollRef = useRef<HTMLDivElement>(null);
  const laneRefs = useRef(new Map<string, HTMLDivElement>());
  const [viewport, setViewport] = useState<Viewport>({ scrollLeft: 0, width: 800 });
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [dropTrack, setDropTrack] = useState<string | null>(null);
  const [dropSlot, setDropSlot] = useState<string | null>(null);
  const [beatDrag, setBeatDrag] = useState<BeatDrag | null>(null);
  const beatDragRef = useRef<BeatDrag | null>(null);
  const selectedBeat = useEditor((s) => s.selectedBeat);

  const fps = project.sequence.fps;
  const rate = fpsToNumber(fps);
  const pxPerFrame = zoom / rate;
  const duration = sequenceDuration(project);
  const contentW = Math.max(viewport.width - HEADER_W, (duration / rate + 30) * zoom);

  // Track viewport for virtualised drawing.
  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (el)
      setViewport({ scrollLeft: Math.max(0, el.scrollLeft), width: el.clientWidth - HEADER_W });
  }, []);
  useLayoutEffect(() => {
    const el = scrollRef.current!;
    const ro = new ResizeObserver(onScroll);
    ro.observe(el);
    onScroll();
    return () => ro.disconnect();
  }, [onScroll]);

  // Keep the playhead in view while playing.
  useEffect(() => {
    if (!playing) return;
    const el = scrollRef.current!;
    const x = playhead * pxPerFrame;
    const w = el.clientWidth - HEADER_W;
    if (x > el.scrollLeft + w - 40 || x < el.scrollLeft) el.scrollLeft = Math.max(0, x - 80);
  }, [playhead, playing, pxPerFrame]);

  // Ctrl/⌘ + wheel zoom anchored on the pointer.
  useEffect(() => {
    const el = scrollRef.current!;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const { zoom: z } = useEditor.getState();
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left - HEADER_W + el.scrollLeft;
      const seconds = px / z;
      const nz = Math.max(2, Math.min(800, z * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      useEditor.setState({ zoom: nz });
      requestAnimationFrame(() => {
        el.scrollLeft = Math.max(0, seconds * nz - (e.clientX - rect.left - HEADER_W));
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const fitZoom = () => {
    const w = (scrollRef.current?.clientWidth ?? 800) - HEADER_W - 40;
    const secs = Math.max(1, duration / rate);
    useEditor.setState({ zoom: Math.max(2, Math.min(800, w / secs)) });
    if (scrollRef.current) scrollRef.current.scrollLeft = 0;
  };

  const frameFromClientX = (clientX: number) => {
    const el = scrollRef.current!;
    const rect = el.getBoundingClientRect();
    return Math.max(0, Math.round((clientX - rect.left - HEADER_W + el.scrollLeft) / pxPerFrame));
  };

  const trackAtClientY = (clientY: number): string | null => {
    for (const [id, el] of laneRefs.current) {
      const r = el.getBoundingClientRect();
      if (clientY >= r.top && clientY < r.bottom) return id;
    }
    return null;
  };

  /* ---------------------------------------------------------------------------------------- */
  /* Clip drag (move / trim) with snapping                                                     */
  /* ---------------------------------------------------------------------------------------- */

  const snap = (
    frames: number[],
    ignore: string[],
    bypass: boolean,
  ): { delta: number; at: number | null } => {
    if (!useEditor.getState().snapping || bypass) return { delta: 0, at: null };
    const pts = [...snapPoints(project, ignore), useEditor.getState().playhead];
    const threshold = SNAP_PX / pxPerFrame;
    let best: { delta: number; at: number | null } = { delta: 0, at: null };
    let bestDist = threshold + 1;
    for (const f of frames) {
      for (const p of pts) {
        const d = p - f;
        if (Math.abs(d) <= threshold && Math.abs(d) < bestDist) {
          bestDist = Math.abs(d);
          best = { delta: d, at: p };
        }
      }
    }
    return best;
  };

  const onClipPointerDown = (e: React.PointerEvent, clip: Clip, mode: DragState['mode']) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const sel = useEditor.getState().selection;
    if (e.shiftKey) {
      select([clip.id], true);
      return;
    }
    if (!sel.includes(clip.id)) select([clip.id]);
    const track = project.tracks.find((t) => t.id === clip.trackId);
    if (track?.locked) return;
    if (mode === 'move' && (e.ctrlKey || e.metaKey) && isTimedMediaClip(clip)) {
      const d: DragState = {
        mode: 'slip',
        clipId: clip.id,
        group: [],
        startClientX: e.clientX,
        orig: { start: clip.start, duration: clip.duration, trackId: clip.trackId },
        moved: false,
        start: clip.start,
        duration: clip.duration,
        trackId: clip.trackId,
        snapAt: null,
        origIn: clip.sourceInUs,
        slipKey: `slip:${clip.id}:${++slipSeq}`,
      };
      dragRef.current = d;
      setDrag(d);
      return;
    }
    const group =
      mode === 'move' && sel.includes(clip.id) ? sel.filter((id) => id !== clip.id) : [];
    const d: DragState = {
      mode,
      clipId: clip.id,
      group,
      startClientX: e.clientX,
      orig: { start: clip.start, duration: clip.duration, trackId: clip.trackId },
      moved: false,
      start: clip.start,
      duration: clip.duration,
      trackId: clip.trackId,
      snapAt: null,
    };
    dragRef.current = d;
    setDrag(d);
  };

  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const p = useEditor.getState().project!;
      const clip = p.clips.find((c) => c.id === d.clipId);
      if (!clip) return;
      const rawDelta = Math.round((e.clientX - d.startClientX) / pxPerFrame);
      if (!d.moved && Math.abs(e.clientX - d.startClientX) < 3) return;
      const ignore = [d.clipId, ...d.group];
      const next: DragState = { ...d, moved: true };

      if (d.mode === 'slip') {
        // Grab the footage: dragging right reveals earlier frames, like sliding film in a gate.
        if (!isTimedMediaClip(clip)) return;
        const m = findMedia(p, clip.mediaId);
        if (!m) return;
        const range = slipRangeUs(clip, m, fps);
        const deltaUs = ((e.clientX - d.startClientX) / zoom) * clip.speed * 1_000_000;
        const sourceInUs = Math.round(
          Math.min(range.max, Math.max(range.min, (d.origIn ?? 0) - deltaUs)),
        );
        if (!d.moved) {
          const ph = useEditor.getState().playhead;
          if (ph < clip.start || ph >= clipEnd(clip)) setPlayhead(clip.start);
        }
        if (sourceInUs !== clip.sourceInUs)
          apply(
            { type: 'slipClip', clipId: clip.id, sourceInUs },
            { label: 'Slip clip', coalesceKey: d.slipKey, notify: false },
          );
        dragRef.current = next;
        setDrag(next);
        return;
      }

      if (d.mode === 'move') {
        let start = Math.max(0, d.orig.start + rawDelta);
        const s = snap([start, start + d.orig.duration], ignore, e.altKey);
        start = Math.max(0, start + s.delta);
        next.start = start;
        next.snapAt = s.at;
        if (d.group.length === 0) {
          const over = trackAtClientY(e.clientY);
          const t = over ? p.tracks.find((x) => x.id === over) : null;
          next.trackId =
            t && !t.locked && TRACK_ACCEPTS[t.kind].includes(clip.kind) ? t.id : d.orig.trackId;
        }
      } else if (d.mode === 'trim-start') {
        const end = d.orig.start + d.orig.duration;
        let minStart = 0;
        if (isTimedMediaClip(clip))
          minStart = d.orig.start - sourceUsToFrames(clip.sourceInUs, fps, clip.speed);
        let start = d.orig.start + rawDelta;
        const s = snap([start], ignore, e.altKey);
        start = Math.min(end - 1, Math.max(Math.max(0, minStart), start + s.delta));
        next.start = start;
        next.duration = end - start;
        next.snapAt = s.at;
      } else {
        let maxEnd = Infinity;
        if (isTimedMediaClip(clip)) {
          const m = findMedia(p, clip.mediaId);
          if (m) maxEnd = clip.start + maxFramesFrom(m, clip.sourceInUs, fps, clip.speed);
        }
        let end = d.orig.start + d.orig.duration + rawDelta;
        const s = snap([end], ignore, e.altKey);
        end = Math.max(d.orig.start + 1, Math.min(maxEnd, end + s.delta));
        next.duration = end - d.orig.start;
        next.snapAt = s.at;
      }
      dragRef.current = next;
      setDrag(next);
    };

    const onUp = () => {
      const d = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (!d) return;
      if (!d.moved) {
        // A click (no drag) on a clip also moves the playhead there.
        return;
      }
      if (d.mode === 'slip') return; // already applied live
      if (d.mode === 'move') {
        const delta = d.start - d.orig.start;
        if (delta === 0 && d.trackId === d.orig.trackId) return;
        const p = useEditor.getState().project!;
        const ids = [d.clipId, ...d.group];
        // Order moves so clips in the group never collide with each other mid-transaction.
        const clips = ids
          .map((id) => p.clips.find((c) => c.id === id)!)
          .filter(Boolean)
          .sort((a, b) => (delta > 0 ? b.start - a.start : a.start - b.start));
        const ops: Operation[] = clips.map((c) =>
          c.id === d.clipId
            ? { type: 'moveClip', clipId: c.id, start: d.start, trackId: d.trackId }
            : { type: 'moveClip', clipId: c.id, start: Math.max(0, c.start + delta) },
        );
        apply(ops, { label: ids.length > 1 ? `Move ${ids.length} clips` : 'Move clip' });
      } else if (d.mode === 'trim-start') {
        if (d.start !== d.orig.start)
          apply({ type: 'trimClip', clipId: d.clipId, edge: 'start', frame: d.start });
      } else if (d.duration !== d.orig.duration) {
        apply({
          type: 'trimClip',
          clipId: d.clipId,
          edge: 'end',
          frame: d.orig.start + d.duration,
        });
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag !== null, pxPerFrame]);

  /* ---------------------------------------------------------------------------------------- */
  /* Beat markers: drag to move, click to select (Delete removes)                              */
  /* ---------------------------------------------------------------------------------------- */

  const onBeatPointerDown = (e: React.PointerEvent, clip: Clip, us: number) => {
    if (e.button !== 0) return;
    useEditor.setState({ selection: [clip.id], selectedBeat: { clipId: clip.id, us } });
    if (project.tracks.find((t) => t.id === clip.trackId)?.locked) return;
    const d: BeatDrag = { clipId: clip.id, us, startClientX: e.clientX, moved: false, curUs: us };
    beatDragRef.current = d;
    setBeatDrag(d);
  };

  useEffect(() => {
    if (!beatDrag) return;
    const onMove = (e: PointerEvent) => {
      const d = beatDragRef.current;
      if (!d) return;
      const p = useEditor.getState().project!;
      const clip = p.clips.find((c) => c.id === d.clipId);
      if (!clip || !isTimedMediaClip(clip)) return;
      if (!d.moved && Math.abs(e.clientX - d.startClientX) < 3) return;
      let curUs = d.us + ((e.clientX - d.startClientX) / zoom) * clip.speed * 1_000_000;
      // Snap to the playhead (handy when correcting a marker while listening).
      const st = useEditor.getState();
      if (st.snapping && !e.altKey) {
        const atFrame = clip.start + ((curUs - clip.sourceInUs) / 1_000_000 / clip.speed) * rate;
        if (Math.abs(atFrame - st.playhead) * pxPerFrame <= SNAP_PX)
          curUs = clip.sourceInUs + ((st.playhead - clip.start) / rate) * clip.speed * 1_000_000;
      }
      const next = { ...d, moved: true, curUs };
      beatDragRef.current = next;
      setBeatDrag(next);
    };
    const onUp = () => {
      const d = beatDragRef.current;
      beatDragRef.current = null;
      setBeatDrag(null);
      if (d?.moved && Math.round(d.curUs) !== d.us) moveBeat(d.clipId, d.us, d.curUs);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beatDrag !== null, zoom]);

  /** Timeline x (content px) of a dragged beat marker, for the ghost line. */
  const beatGhostX = (() => {
    if (!beatDrag?.moved) return null;
    const clip = project.clips.find((c) => c.id === beatDrag.clipId);
    if (!clip || !isTimedMediaClip(clip)) return null;
    return (
      (clip.start + ((beatDrag.curUs - clip.sourceInUs) / 1_000_000 / clip.speed) * rate) *
      pxPerFrame
    );
  })();

  /* ---------------------------------------------------------------------------------------- */
  /* Media drops from the library                                                              */
  /* ---------------------------------------------------------------------------------------- */

  const templateClipAt = (trackId: string | null, clientX: number) => {
    if (!trackId) return undefined;
    const f = frameFromClientX(clientX);
    return project.clips.find(
      (c) => c.trackId === trackId && f >= c.start && f < clipEnd(c) && isTemplateClip(c),
    );
  };

  const onLaneDragOver = (e: React.DragEvent, trackId: string | null) => {
    if (!e.dataTransfer.types.includes(MEDIA_DRAG_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const slot = templateClipAt(trackId, e.clientX);
    setDropSlot(slot?.id ?? null);
    setDropTrack(slot ? null : (trackId ?? '__new'));
  };
  const onLaneDrop = (e: React.DragEvent, track: Track | null) => {
    const id = e.dataTransfer.getData(MEDIA_DRAG_TYPE);
    setDropTrack(null);
    setDropSlot(null);
    if (!id) return;
    e.preventDefault();
    const slot = templateClipAt(track?.id ?? null, e.clientX);
    if (slot) {
      fillSlot(slot.id, id);
      return;
    }
    const frame = frameFromClientX(e.clientX);
    const m = findMedia(project, id);
    const compatible = track && m && TRACK_ACCEPTS[track.kind].includes(m.kind);
    addMediaToTimeline(id, frame, compatible ? track!.id : undefined);
  };

  /* ---------------------------------------------------------------------------------------- */

  const scrub = (contentX: number) => {
    useEditor.setState({ playing: false });
    setPlayhead(contentX / pxPerFrame);
  };

  const displayFor = (c: Clip) => {
    if (drag && (c.id === drag.clipId || drag.group.includes(c.id)) && drag.moved) {
      if (c.id === drag.clipId)
        return { start: drag.start, duration: drag.duration, trackId: drag.trackId };
      return {
        start: Math.max(0, c.start + (drag.start - drag.orig.start)),
        duration: c.duration,
        trackId: c.trackId,
      };
    }
    return { start: c.start, duration: c.duration, trackId: c.trackId };
  };

  const visibleL = viewport.scrollLeft - 200;
  const visibleR = viewport.scrollLeft + viewport.width + 200;
  const beatGuides = allBeatFrames(project).filter((f) => {
    const x = f * pxPerFrame;
    return x >= visibleL && x <= visibleR;
  });
  const hasSelection = selection.length > 0;

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex h-9 shrink-0 items-center gap-0.5 border-b border-border px-2">
        <IconButton label="Split at playhead (S)" onClick={splitAtPlayhead}>
          <Scissors size={14} />
        </IconButton>
        <IconButton label="Delete (Del)" disabled={!hasSelection} onClick={deleteSelection}>
          <Trash2 size={14} />
        </IconButton>
        <IconButton
          label="Duplicate (Ctrl+D)"
          disabled={!hasSelection}
          onClick={duplicateSelection}
        >
          <Copy size={14} />
        </IconButton>
        <div className="mx-1.5 h-4 w-px bg-border" />
        <IconButton
          label={`Snapping ${snapping ? 'on' : 'off'} (N)`}
          active={snapping}
          onClick={() => useEditor.setState({ snapping: !snapping })}
        >
          <Magnet size={14} />
        </IconButton>
        <AddTrackMenu />
        <div className="flex-1" />
        <IconButton
          label="Zoom out (−)"
          onClick={() => useEditor.setState({ zoom: Math.max(2, zoom / 1.25) })}
        >
          <ZoomOut size={14} />
        </IconButton>
        <input
          type="range"
          aria-label="Timeline zoom"
          className="w-28"
          min={Math.log(2)}
          max={Math.log(800)}
          step={0.01}
          value={Math.log(zoom)}
          onChange={(e) => useEditor.setState({ zoom: Math.exp(Number(e.target.value)) })}
        />
        <IconButton
          label="Zoom in (+)"
          onClick={() => useEditor.setState({ zoom: Math.min(800, zoom * 1.25) })}
        >
          <ZoomIn size={14} />
        </IconButton>
        <IconButton label="Fit timeline" onClick={fitZoom}>
          <Maximize2 size={13} />
        </IconButton>
      </div>

      {/* Tracks */}
      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-auto" onScroll={onScroll}>
        <div className="relative" style={{ width: HEADER_W + contentW, minHeight: '100%' }}>
          {/* Ruler row */}
          <div
            className="sticky top-0 z-30 flex border-b border-border bg-surface-1"
            style={{ height: RULER_H }}
          >
            <div
              className="sticky left-0 z-10 shrink-0 border-r border-border bg-surface-1"
              style={{ width: HEADER_W }}
            />
            <div className="relative flex-1">
              <Ruler viewport={viewport} pxPerSecond={zoom} fps={fps} onScrub={scrub} />
            </div>
          </div>

          {project.tracks.map((track) => {
            const h = TRACK_HEIGHT[track.kind];
            const trackClips = project.clips.filter((c) => displayFor(c).trackId === track.id);
            return (
              <div key={track.id} className="flex">
                <TrackHeader
                  track={track}
                  empty={!project.clips.some((c) => c.trackId === track.id)}
                />
                <div
                  ref={(el) => {
                    if (el) laneRefs.current.set(track.id, el);
                    else laneRefs.current.delete(track.id);
                  }}
                  className={cx(
                    'relative flex-1 border-b border-border',
                    track.locked
                      ? 'bg-[repeating-linear-gradient(135deg,transparent_0_6px,rgba(255,255,255,0.025)_6px_12px)]'
                      : 'bg-surface-1',
                    dropTrack === track.id && 'bg-accent-soft',
                    track.hidden && 'opacity-50',
                  )}
                  style={{ height: h }}
                  onPointerDown={(e) => {
                    if (e.button !== 0) return;
                    select([]);
                    scrub(frameFromClientX(e.clientX) * pxPerFrame);
                  }}
                  onDragOver={(e) => onLaneDragOver(e, track.id)}
                  onDragLeave={() => {
                    setDropTrack(null);
                    setDropSlot(null);
                  }}
                  onDrop={(e) => onLaneDrop(e, track)}
                >
                  {trackClips.map((c) => {
                    const d = displayFor(c);
                    const left = d.start * pxPerFrame;
                    const width = d.duration * pxPerFrame;
                    if (left + width < visibleL || left > visibleR) return null;
                    return (
                      <ClipView
                        key={c.id}
                        clip={c}
                        left={left}
                        width={width}
                        height={h}
                        selected={selection.includes(c.id)}
                        dragging={
                          !!drag?.moved &&
                          drag.mode !== 'slip' &&
                          (drag.clipId === c.id || drag.group.includes(c.id))
                        }
                        dropTarget={dropSlot === c.id}
                        selectedBeatUs={selectedBeat?.clipId === c.id ? selectedBeat.us : null}
                        onBeatPointerDown={onBeatPointerDown}
                        media={'mediaId' in c ? findMedia(project, c.mediaId) : undefined}
                        runtime={'mediaId' in c ? media[c.mediaId] : undefined}
                        fps={fps}
                        pxPerSecond={zoom}
                        visibleFrom={Math.max(0, visibleL - left)}
                        visibleTo={Math.min(width, visibleR - left)}
                        onPointerDown={onClipPointerDown}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}

          {/* Drop zone for new tracks */}
          <div className="flex">
            <div
              className="sticky left-0 z-20 shrink-0 border-r border-border bg-surface-1"
              style={{ width: HEADER_W, height: 44 }}
            />
            <div
              className={cx(
                'flex flex-1 items-center px-3 text-[11px] text-faint',
                dropTrack === '__new' && 'bg-accent-soft text-text',
              )}
              style={{ height: 44 }}
              onDragOver={(e) => onLaneDragOver(e, null)}
              onDragLeave={() => setDropTrack(null)}
              onDrop={(e) => onLaneDrop(e, null)}
              onPointerDown={() => select([])}
            >
              <span className="sticky" style={{ left: HEADER_W + 12 }}>
                {project.clips.length === 0
                  ? 'Drag media here, or double-click it in the Media panel'
                  : 'Drop here to add on a new track'}
              </span>
            </div>
          </div>

          {/* Beat guides across all tracks */}
          {beatGuides.map((f) => (
            <div
              key={f}
              className="pointer-events-none absolute bottom-0 z-[5] w-px bg-beat-guide"
              style={{ left: HEADER_W + f * pxPerFrame, top: RULER_H }}
            />
          ))}
          {beatGhostX !== null && (
            <div
              className="pointer-events-none absolute bottom-0 top-0 z-30 w-px bg-white"
              style={{ left: HEADER_W + beatGhostX }}
            />
          )}

          {/* Snap indicator */}
          {drag?.snapAt != null && (
            <div
              className="pointer-events-none absolute bottom-0 top-0 z-30 w-px bg-snap"
              style={{ left: HEADER_W + drag.snapAt * pxPerFrame }}
            />
          )}

          {/* Playhead */}
          <div
            className="pointer-events-none absolute bottom-0 top-0 z-40 w-px bg-playhead"
            style={{ left: HEADER_W + playhead * pxPerFrame }}
          >
            <div className="absolute -left-[5px] top-0 h-0 w-0 border-x-[5px] border-t-[8px] border-x-transparent border-t-playhead" />
          </div>
        </div>
      </div>
    </div>
  );
}
