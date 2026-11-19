import { useEffect, useState } from 'react';
import { AlignLeft, AlignCenter, AlignRight, Bold, RotateCcw } from 'lucide-react';
import {
  DEFAULT_TRANSFORM,
  findClip,
  findMedia,
  frameToSeconds,
  secondsToNearestFrame,
  type Clip,
  type Operation,
  type Project,
  type TextStyle,
  type TimedMediaClip,
  type Transform,
} from '@viditor/project-core';
import { FONTS, dbToGain, gainToDb } from '@viditor/composition';
import { apply, useEditor } from '../state/store.ts';
import {
  IconButton,
  NumberInput,
  Row,
  Section,
  Select,
  SliderField,
  Toggle,
  cx,
} from '../ui/ui.tsx';
import { SequenceSettings } from './SettingsDialog.tsx';
import { BeatsSection, ClipWindowSection, FilledSlotSection, SlotSection } from './BeatTools.tsx';

const pct = { to: (v: number) => v * 100, from: (v: number) => v / 100 };

function useApply(clipId: string) {
  return (op: Operation, field: string, label: string) =>
    apply(op, { coalesceKey: `${clipId}:${field}`, label });
}

function TransformSection({ clip }: { clip: Extract<Clip, { transform: Transform }> }) {
  const t = clip.transform;
  const run = useApply(clip.id);
  const set = (
    field: string,
    transform: Partial<Transform> | { crop: Partial<Transform['crop']> },
  ) => run({ type: 'setTransform', clipId: clip.id, transform }, field, 'Transform');
  const isMedia = clip.kind === 'video' || clip.kind === 'image';
  return (
    <Section
      title="Transform"
      right={
        <IconButton
          label="Reset transform"
          onClick={() =>
            apply(
              {
                type: 'setTransform',
                clipId: clip.id,
                transform:
                  clip.kind === 'caption' ? { ...DEFAULT_TRANSFORM, y: t.y } : DEFAULT_TRANSFORM,
              },
              { label: 'Reset transform' },
            )
          }
        >
          <RotateCcw size={12} />
        </IconButton>
      }
    >
      <SliderField
        label="Position X"
        value={t.x}
        min={-1}
        max={1}
        step={0.001}
        display={pct}
        suffix="%"
        precision={1}
        onChange={(x) => set('x', { x })}
      />
      <SliderField
        label="Position Y"
        value={t.y}
        min={-1}
        max={1}
        step={0.001}
        display={pct}
        suffix="%"
        precision={1}
        onChange={(y) => set('y', { y })}
      />
      <SliderField
        label="Scale"
        value={t.scale}
        min={0.05}
        max={5}
        step={0.01}
        display={pct}
        suffix="%"
        precision={0}
        onChange={(scale) => set('scale', { scale })}
      />
      <SliderField
        label="Rotation"
        value={t.rotation}
        min={-180}
        max={180}
        step={0.5}
        suffix="°"
        precision={1}
        onChange={(rotation) => set('rotation', { rotation })}
      />
      <SliderField
        label="Opacity"
        value={t.opacity}
        min={0}
        max={1}
        step={0.01}
        display={pct}
        suffix="%"
        precision={0}
        onChange={(opacity) => set('opacity', { opacity })}
      />
      {isMedia && (
        <>
          <div className="pt-1 text-[11px] font-medium text-faint">Crop</div>
          {(['left', 'right', 'top', 'bottom'] as const).map((side) => (
            <SliderField
              key={side}
              label={side[0]!.toUpperCase() + side.slice(1)}
              value={t.crop[side]}
              min={0}
              max={0.49}
              step={0.005}
              display={pct}
              suffix="%"
              precision={1}
              onChange={(v) => set(`crop.${side}`, { crop: { [side]: v } })}
            />
          ))}
        </>
      )}
    </Section>
  );
}

function AudioSection({ clip, project }: { clip: TimedMediaClip; project: Project }) {
  const run = useApply(clip.id);
  const fps = project.sequence.fps;
  const a = clip.audio;
  const media = findMedia(project, clip.mediaId);
  if (!media?.hasAudio) {
    return (
      <Section title="Audio">
        <p className="text-xs text-faint">This clip has no audio track.</p>
      </Section>
    );
  }
  const db = Math.max(-60, gainToDb(a.gain));
  const maxFadeS = frameToSeconds(clip.duration, fps);
  return (
    <Section title="Audio">
      <Row label="Mute">
        <Toggle
          label="Mute clip"
          checked={a.mute}
          onChange={(mute) =>
            apply(
              { type: 'setAudio', clipId: clip.id, audio: { mute } },
              { label: mute ? 'Mute clip' : 'Unmute clip' },
            )
          }
        />
      </Row>
      <SliderField
        label="Volume"
        value={db}
        min={-60}
        max={12}
        step={0.5}
        suffix="dB"
        precision={1}
        onChange={(v) =>
          run(
            {
              type: 'setAudio',
              clipId: clip.id,
              audio: { gain: v <= -60 ? 0 : Math.min(4, dbToGain(v)) },
            },
            'gain',
            'Volume',
          )
        }
      />
      <SliderField
        label="Fade in"
        value={frameToSeconds(a.fadeIn, fps)}
        min={0}
        max={Math.max(0.1, maxFadeS - frameToSeconds(a.fadeOut, fps))}
        step={0.05}
        suffix="s"
        onChange={(s) =>
          run(
            { type: 'setAudio', clipId: clip.id, audio: { fadeIn: secondsToNearestFrame(s, fps) } },
            'fadeIn',
            'Fade in',
          )
        }
      />
      <SliderField
        label="Fade out"
        value={frameToSeconds(a.fadeOut, fps)}
        min={0}
        max={Math.max(0.1, maxFadeS - frameToSeconds(a.fadeIn, fps))}
        step={0.05}
        suffix="s"
        onChange={(s) =>
          run(
            {
              type: 'setAudio',
              clipId: clip.id,
              audio: { fadeOut: secondsToNearestFrame(s, fps) },
            },
            'fadeOut',
            'Fade out',
          )
        }
      />
    </Section>
  );
}

const SPEED_PRESETS = [0.25, 0.5, 1, 1.5, 2, 4];

function SpeedSection({ clip }: { clip: TimedMediaClip }) {
  return (
    <Section title="Speed">
      <div className="flex flex-wrap gap-1">
        {SPEED_PRESETS.map((s) => (
          <button
            key={s}
            onClick={() =>
              apply({ type: 'setSpeed', clipId: clip.id, speed: s }, { label: `Speed ${s}×` })
            }
            className={cx(
              'h-6 rounded-sm px-2 text-[11px] tabular-nums',
              Math.abs(clip.speed - s) < 1e-6
                ? 'bg-accent text-white'
                : 'bg-surface-3 text-muted hover:text-text',
            )}
          >
            {s}×
          </button>
        ))}
      </div>
      <Row label="Custom">
        <NumberInput
          value={clip.speed}
          min={0.1}
          max={10}
          step={0.05}
          suffix="×"
          onChange={(speed) =>
            apply({ type: 'setSpeed', clipId: clip.id, speed }, { label: `Speed ${speed}×` })
          }
        />
      </Row>
      <p className="text-[11px] text-faint">Constant speed. Audio pitch follows speed.</p>
    </Section>
  );
}

function TextSection({ clip }: { clip: Extract<Clip, { text: string }> }) {
  const run = useApply(clip.id);
  const s = clip.style;
  const [text, setText] = useState(clip.text);
  useEffect(() => setText(clip.text), [clip.text, clip.id]);
  const setStyle = (field: string, style: Partial<TextStyle>) =>
    run({ type: 'updateText', clipId: clip.id, style }, field, 'Text style');
  const font = FONTS.find((f) => f.family === s.fontFamily) ?? FONTS[0]!;
  return (
    <Section title={clip.kind === 'caption' ? 'Caption' : 'Text'}>
      <textarea
        aria-label="Text"
        className="w-full resize-y rounded-sm border border-border bg-surface-1 p-2 text-sm outline-none focus:border-accent"
        rows={3}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          run({ type: 'updateText', clipId: clip.id, text: e.target.value }, 'text', 'Edit text');
        }}
        onKeyDown={(e) => e.stopPropagation()}
      />
      <Row label="Font">
        <Select
          className="flex-1"
          value={s.fontFamily}
          options={FONTS.map((f) => ({ value: f.family, label: f.family }))}
          onChange={(fontFamily) => {
            const f = FONTS.find((x) => x.family === fontFamily)!;
            setStyle('font', {
              fontFamily,
              fontWeight: f.weights.includes(s.fontWeight) ? s.fontWeight : f.weights[0]!,
            });
          }}
        />
        <IconButton
          label="Bold"
          active={s.fontWeight >= 700}
          disabled={!font.weights.includes(700) || !font.weights.includes(400)}
          onClick={() => setStyle('weight', { fontWeight: s.fontWeight >= 700 ? 400 : 700 })}
        >
          <Bold size={13} />
        </IconButton>
      </Row>
      <SliderField
        label="Size"
        value={s.fontSize}
        min={8}
        max={400}
        step={1}
        suffix="px"
        precision={0}
        onChange={(fontSize) => setStyle('size', { fontSize })}
      />
      <Row label="Align">
        {(['left', 'center', 'right'] as const).map((al) => (
          <IconButton
            key={al}
            label={`Align ${al}`}
            active={s.align === al}
            onClick={() => setStyle('align', { align: al })}
          >
            {al === 'left' ? (
              <AlignLeft size={13} />
            ) : al === 'center' ? (
              <AlignCenter size={13} />
            ) : (
              <AlignRight size={13} />
            )}
          </IconButton>
        ))}
      </Row>
      <Row label="Color">
        <input
          type="color"
          aria-label="Text color"
          value={s.color.slice(0, 7)}
          onChange={(e) => setStyle('color', { color: e.target.value })}
        />
      </Row>
      <Row label="Background">
        <Toggle
          label="Background box"
          checked={!!s.background}
          onChange={(on) => setStyle('bg-toggle', { background: on ? '#000000a6' : null })}
        />
        {s.background && (
          <input
            type="color"
            aria-label="Background color"
            value={s.background.slice(0, 7)}
            onChange={(e) =>
              setStyle('bg', { background: e.target.value + (s.background!.slice(7) || 'cc') })
            }
          />
        )}
      </Row>
      <Row label="Outline">
        <input
          type="color"
          aria-label="Outline color"
          value={(s.strokeColor ?? '#000000').slice(0, 7)}
          onChange={(e) => setStyle('stroke', { strokeColor: e.target.value })}
        />
        <input
          type="range"
          aria-label="Outline width"
          className="min-w-0 flex-1"
          min={0}
          max={20}
          step={0.5}
          value={s.strokeWidth}
          onChange={(e) =>
            setStyle('strokeWidth', {
              strokeWidth: Number(e.target.value),
              strokeColor: s.strokeColor ?? '#000000',
            })
          }
        />
      </Row>
      <SliderField
        label="Line height"
        value={s.lineHeight}
        min={0.8}
        max={2.5}
        step={0.05}
        onChange={(lineHeight) => setStyle('lineHeight', { lineHeight })}
      />
    </Section>
  );
}

function ClipInfo({ clip, project }: { clip: Clip; project: Project }) {
  const fps = project.sequence.fps;
  const media = 'mediaId' in clip ? findMedia(project, clip.mediaId) : undefined;
  return (
    <Section title="Clip">
      <div className="truncate text-sm">
        {media?.name ??
          (clip.kind === 'slot'
            ? `Empty slot #${clip.index}`
            : clip.kind === 'caption'
              ? 'Caption'
              : 'Text')}
      </div>
      <div className="grid grid-cols-2 gap-1 text-[11px] text-muted tabular-nums">
        <span>Start {frameToSeconds(clip.start, fps).toFixed(2)}s</span>
        <span>Length {frameToSeconds(clip.duration, fps).toFixed(2)}s</span>
        {media && media.kind !== 'image' && (
          <span className="col-span-2 text-faint">
            {media.width ? `${media.width}×${media.height} · ` : ''}
            {media.fps ? `${media.fps} fps · ` : ''}
            {media.hasAudio ? `${media.sampleRate} Hz` : 'no audio'}
          </span>
        )}
      </div>
    </Section>
  );
}

export function Inspector() {
  const project = useEditor((s) => s.project!);
  const selection = useEditor((s) => s.selection);
  const clip = selection.length === 1 ? findClip(project, selection[0]!) : undefined;

  if (selection.length > 1) {
    return (
      <div className="p-4 text-xs text-muted">
        {selection.length} clips selected. Press <kbd className="text-text">Delete</kbd> to remove
        them or <kbd className="text-text">S</kbd> to split them at the playhead.
      </div>
    );
  }

  if (!clip) {
    return (
      <div className="h-full overflow-y-auto">
        <Section title="Project">
          <SequenceSettings />
        </Section>
        <p className="px-3 py-3 text-[11px] text-faint">
          Select a clip on the timeline or in the preview to edit it.
        </p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto" key={clip.id}>
      <ClipInfo clip={clip} project={project} />
      {clip.kind === 'slot' && <SlotSection clip={clip} project={project} />}
      {(clip.kind === 'video' || clip.kind === 'image') && (
        <FilledSlotSection clip={clip} project={project} />
      )}
      {clip.kind === 'audio' && <BeatsSection clip={clip} project={project} />}
      {(clip.kind === 'video' || clip.kind === 'audio') && (
        <ClipWindowSection clip={clip} project={project} />
      )}
      {(clip.kind === 'text' || clip.kind === 'caption') && <TextSection clip={clip} />}
      {'transform' in clip && clip.kind !== 'slot' && <TransformSection clip={clip} />}
      {(clip.kind === 'video' || clip.kind === 'audio') && (
        <>
          <AudioSection clip={clip} project={project} />
          {clip.kind === 'video' && findMedia(project, clip.mediaId)?.hasAudio && (
            <BeatsSection clip={clip} project={project} />
          )}
          <SpeedSection clip={clip} />
        </>
      )}
    </div>
  );
}
