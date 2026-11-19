import { useRef, useState } from 'react';
import { AudioWaveform, LayoutTemplate, Loader2, Trash2, Undo2 } from 'lucide-react';
import {
  beatFrames,
  findMedia,
  frameToSeconds,
  framesToSourceUs,
  slipRangeUs,
  usToSeconds,
  type Clip,
  type Project,
  type SlotClip,
  type TimedMediaClip,
} from '@viditor/project-core';
import { planBeatTemplate } from '@viditor/contracts';
import type { BeatMode } from '@viditor/media';
import { apply, setPlayhead, useEditor } from '../state/store.ts';
import {
  clearBeats,
  clearSlot,
  createBeatTemplate,
  detectBeatsForClip,
  fillSlot,
} from '../state/beats.ts';
import { Button, Section, Select, cx } from '../ui/ui.tsx';

/* -------------------------------------------------------------------------------------------- */
/* Small segmented control                                                                       */
/* -------------------------------------------------------------------------------------------- */

function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string; title?: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-sm bg-surface-3 p-0.5">
      {options.map((o) => (
        <button
          key={String(o.value)}
          role="radio"
          aria-checked={o.value === value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cx(
            'h-6 flex-1 rounded-[3px] px-2 text-[11px]',
            o.value === value ? 'bg-accent text-white' : 'text-muted hover:text-text',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------------------------- */
/* Beats: detect / tap / clear, and cut a template                                               */
/* -------------------------------------------------------------------------------------------- */

export function BeatsSection({ clip, project }: { clip: TimedMediaClip; project: Project }) {
  const [mode, setMode] = useState<BeatMode>('beat');
  const [busy, setBusy] = useState(false);
  const [bpm, setBpm] = useState<number | null>(null);
  const [every, setEvery] = useState(1);
  const fps = project.sequence.fps;
  const visible = beatFrames(clip, fps).length;
  const plan = visible ? planBeatTemplate(project, { clipId: clip.id, every }) : null;
  const slots = plan && !('error' in plan) ? plan.slotIds.length : 0;

  const detect = async () => {
    setBusy(true);
    const r = await detectBeatsForClip(clip.id, mode);
    setBusy(false);
    if (r) setBpm(r.bpm);
  };

  return (
    <Section title="Beats">
      <Segmented
        label="What to mark"
        value={mode}
        onChange={setMode}
        options={[
          { value: 'beat', label: 'Beat', title: 'The steady pulse of the song' },
          { value: 'bass', label: 'Bass hits', title: 'Kicks and bass notes, including off-beats' },
        ]}
      />
      <div className="flex gap-1.5">
        <Button variant="primary" size="sm" className="flex-1" disabled={busy} onClick={detect}>
          {busy ? <Loader2 size={12} className="animate-spin" /> : <AudioWaveform size={12} />}
          {busy ? 'Listening…' : mode === 'bass' ? 'Detect bass hits' : 'Detect beats'}
        </Button>
        {clip.beatsUs.length > 0 && (
          <Button size="sm" onClick={() => clearBeats(clip.id)} title="Remove all markers">
            <Trash2 size={12} /> Clear
          </Button>
        )}
      </div>
      <p className="text-[11px] text-muted" aria-live="polite">
        {visible
          ? `${visible} marker${visible === 1 ? '' : 's'} on this clip${bpm ? ` · about ${bpm} BPM` : ''}`
          : 'No markers yet.'}
      </p>
      <p className="text-[11px] leading-relaxed text-faint">
        Tap your own: play the music and press <kbd className="text-text">B</kbd> on each beat. Drag
        a marker on the timeline to adjust it; click it and press{' '}
        <kbd className="text-text">Delete</kbd> to remove it. Analysis runs on this computer.
      </p>

      {visible > 0 && (
        <div className="mt-1 space-y-1.5 rounded-md border border-border bg-surface-1 p-2">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-text">
            <LayoutTemplate size={12} /> Beat template
          </div>
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-[11px] text-muted">Cut every</span>
            <Segmented
              label="Cut every N markers"
              value={every}
              onChange={setEvery}
              options={[1, 2, 4, 8].map((n) => ({ value: n, label: String(n) }))}
            />
          </div>
          <Button
            size="sm"
            className="w-full"
            disabled={!slots}
            onClick={() => createBeatTemplate(clip.id, every)}
          >
            Create template · {slots} slots
          </Button>
          <p className="text-[11px] text-faint">
            Adds a Template track of empty slots that start and end on the markers. Drop a video on
            a slot and it plays for exactly that slot.
          </p>
        </div>
      )}
    </Section>
  );
}

/* -------------------------------------------------------------------------------------------- */
/* Template slots: fill, swap, empty                                                             */
/* -------------------------------------------------------------------------------------------- */

function MediaPicker({
  project,
  placeholder,
  onPick,
}: {
  project: Project;
  placeholder: string;
  onPick: (mediaId: string) => void;
}) {
  const runtime = useEditor((s) => s.media);
  const options = project.media
    .filter((m) => m.kind !== 'audio' && runtime[m.id]?.status === 'ready')
    .map((m) => ({ value: m.id, label: m.name }));
  if (!options.length)
    return <p className="text-[11px] text-faint">Import videos in the Media panel first.</p>;
  return (
    <Select
      className="w-full"
      value=""
      options={[{ value: '', label: placeholder }, ...options]}
      onChange={(id) => id && onPick(id)}
    />
  );
}

export function SlotSection({ clip, project }: { clip: SlotClip; project: Project }) {
  const secs = frameToSeconds(clip.duration, project.sequence.fps);
  return (
    <Section title={`Template slot #${clip.index}`}>
      <p className="text-[11px] leading-relaxed text-muted">
        Empty for {secs.toFixed(2)} s. Drag a video from the Media panel onto this slot, or pick one
        here. It will play for exactly this long, so the cut stays on the beat.
      </p>
      <MediaPicker
        project={project}
        placeholder="Fill with…"
        onPick={(id) => fillSlot(clip.id, id)}
      />
    </Section>
  );
}

export function FilledSlotSection({
  clip,
  project,
}: {
  clip: Extract<Clip, { kind: 'video' | 'image' }>;
  project: Project;
}) {
  if (!clip.templateSlot) return null;
  return (
    <Section
      title={`Template slot #${clip.templateSlot}`}
      right={
        <button
          className="flex items-center gap-1 text-[11px] text-muted hover:text-text"
          onClick={() => clearSlot(clip.id)}
          title="Take the media out and leave an empty slot"
        >
          <Undo2 size={11} /> Empty slot
        </button>
      }
    >
      <MediaPicker
        project={project}
        placeholder="Swap for another video…"
        onPick={(id) => fillSlot(clip.id, id)}
      />
    </Section>
  );
}

/* -------------------------------------------------------------------------------------------- */
/* Clip window: choose which part of the source shows (slip)                                     */
/* -------------------------------------------------------------------------------------------- */

let slipSeq = 0;

export function ClipWindowSection({ clip, project }: { clip: TimedMediaClip; project: Project }) {
  const stripRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; orig: number; key: string } | null>(null);
  const runtime = useEditor((s) => s.media[clip.mediaId]);
  const media = findMedia(project, clip.mediaId);
  if (!media || media.durationUs <= 0) return null;
  const fps = project.sequence.fps;
  const dur = media.durationUs;
  const span = Math.min(dur, framesToSourceUs(clip.duration, fps, clip.speed));
  const range = slipRangeUs(clip, media, fps);
  const left = (clip.sourceInUs / dur) * 100;
  const width = Math.max(1.5, (span / dur) * 100);
  const thumbs = runtime?.thumbs ?? [];
  const TILES = 8;

  const slipTo = (us: number, key?: string) => {
    const sourceInUs = Math.round(Math.min(range.max, Math.max(range.min, us)));
    if (sourceInUs === clip.sourceInUs) return;
    apply(
      { type: 'slipClip', clipId: clip.id, sourceInUs },
      { label: 'Choose clip part', coalesceKey: key, notify: !key },
    );
  };

  const showClipStart = () => {
    const { playhead } = useEditor.getState();
    if (playhead < clip.start || playhead >= clip.start + clip.duration) setPlayhead(clip.start);
  };

  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || range.max <= 0) return;
    const strip = stripRef.current!.getBoundingClientRect();
    const onWindow = (e.target as HTMLElement).dataset.window === '1';
    const key = `slip:${clip.id}:${++slipSeq}`;
    let orig = clip.sourceInUs;
    if (!onWindow) {
      // Click on the strip: centre the window there, then keep dragging.
      orig = ((e.clientX - strip.left) / strip.width) * dur - span / 2;
      slipTo(orig, key);
    }
    drag.current = { x: e.clientX, orig, key };
    showClipStart();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const w = stripRef.current!.getBoundingClientRect().width || 1;
    slipTo(d.orig + ((e.clientX - d.x) / w) * dur, d.key);
  };
  const onUp = () => {
    drag.current = null;
  };

  const fmt = (us: number) => `${usToSeconds(us).toFixed(2)}s`;
  return (
    <Section title="Clip window">
      <p className="text-[11px] text-muted">
        {range.max > 0
          ? 'Drag the box to choose which part of the source plays. The clip keeps its place and length.'
          : 'The clip already uses the whole source, so there is nothing to slide.'}
      </p>
      <div
        ref={stripRef}
        role="slider"
        aria-label="Which part of the source plays"
        aria-valuemin={0}
        aria-valuemax={Math.round(usToSeconds(range.max) * 100) / 100}
        aria-valuenow={Math.round(usToSeconds(clip.sourceInUs) * 100) / 100}
        tabIndex={0}
        onKeyDown={(e) => {
          const step = framesToSourceUs(e.shiftKey ? 10 : 1, fps, clip.speed);
          if (e.key === 'ArrowLeft') slipTo(clip.sourceInUs - step);
          else if (e.key === 'ArrowRight') slipTo(clip.sourceInUs + step);
          else return;
          e.preventDefault();
          e.stopPropagation();
        }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        className={cx(
          'relative h-12 select-none overflow-hidden rounded-sm bg-surface-3 outline-none focus-visible:ring-2 focus-visible:ring-accent',
          range.max > 0 ? 'cursor-pointer' : 'cursor-default',
        )}
      >
        {media.kind === 'video' && thumbs.length > 0 && (
          <div className="pointer-events-none absolute inset-0 flex opacity-60">
            {Array.from({ length: TILES }, (_, i) => {
              const t = ((i + 0.5) / TILES) * usToSeconds(dur);
              let best = thumbs[0]!;
              for (const th of thumbs)
                if (Math.abs(th.time - t) < Math.abs(best.time - t)) best = th;
              return (
                <img
                  key={i}
                  src={best.url}
                  alt=""
                  draggable={false}
                  className="h-full min-w-0 flex-1 object-cover"
                />
              );
            })}
          </div>
        )}
        <div className="pointer-events-none absolute inset-0 bg-black/45" />
        <div
          data-window="1"
          className="absolute inset-y-0 cursor-grab border-2 border-white bg-white/10 shadow-[0_0_0_1px_rgba(0,0,0,0.6)] active:cursor-grabbing"
          style={{ left: `${Math.min(left, 100 - width)}%`, width: `${width}%` }}
        />
      </div>
      <div className="flex justify-between text-[11px] tabular-nums text-faint">
        <span>
          Plays {fmt(clip.sourceInUs)} – {fmt(clip.sourceInUs + span)}
        </span>
        <span>of {fmt(dur)}</span>
      </div>
    </Section>
  );
}
