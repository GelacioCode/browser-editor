import { useEffect, useState } from 'react';
import { COMMON_FRAME_RATES, fpsToNumber } from '@viditor/project-core';
import { cacheUsage, clearCache } from '@viditor/media';
import { apply, toast, useEditor } from '../state/store.ts';
import { Button, Dialog, Row, Section, Select } from '../ui/ui.tsx';
import { formatBytes, runDiagnostics, type Check } from '../lib/capabilities.ts';
import { CheckList } from './Diagnostics.tsx';

const FORMATS = [
  { label: 'Landscape 16:9 — 1920×1080', w: 1920, h: 1080 },
  { label: 'Landscape 16:9 — 1280×720', w: 1280, h: 720 },
  { label: 'Landscape 16:9 — 3840×2160', w: 3840, h: 2160 },
  { label: 'Vertical 9:16 — 1080×1920', w: 1080, h: 1920 },
  { label: 'Square 1:1 — 1080×1080', w: 1080, h: 1080 },
  { label: 'Portrait 4:5 — 1080×1350', w: 1080, h: 1350 },
];

export function SequenceSettings() {
  const project = useEditor((s) => s.project!);
  const seq = project.sequence;
  const fmt = FORMATS.find((f) => f.w === seq.width && f.h === seq.height);
  const fpsLabel = COMMON_FRAME_RATES.find(
    (r) => r.fps.num === seq.fps.num && r.fps.den === seq.fps.den,
  )?.label;
  const empty = project.clips.length === 0;
  return (
    <div className="space-y-2.5">
      <Row label="Format">
        <Select
          className="min-w-0 flex-1"
          value={fmt ? `${fmt.w}x${fmt.h}` : 'custom'}
          options={[
            ...FORMATS.map((f) => ({ value: `${f.w}x${f.h}`, label: f.label })),
            ...(fmt ? [] : [{ value: 'custom', label: `Custom — ${seq.width}×${seq.height}` }]),
          ]}
          onChange={(v) => {
            const f = FORMATS.find((x) => `${x.w}x${x.h}` === v);
            if (f)
              apply({ type: 'setSequence', width: f.w, height: f.h }, { label: 'Change format' });
          }}
        />
      </Row>
      <Row label="Frame rate">
        <Select
          className="flex-1"
          value={fpsLabel ?? 'custom'}
          options={[
            ...COMMON_FRAME_RATES.map((r) => ({ value: r.label, label: `${r.label} fps` })),
            ...(fpsLabel
              ? []
              : [{ value: 'custom', label: `${fpsToNumber(seq.fps).toFixed(3)} fps` }]),
          ]}
          onChange={(v) => {
            const r = COMMON_FRAME_RATES.find((x) => x.label === v);
            if (r) apply({ type: 'setSequence', fps: r.fps }, { label: 'Change frame rate' });
          }}
        />
      </Row>
      {!empty && (
        <p className="text-[11px] text-faint">
          Frame rate can be changed while the timeline is empty.
        </p>
      )}
      <Row label="Background">
        <input
          type="color"
          aria-label="Background color"
          value={seq.background.slice(0, 7)}
          onChange={(e) =>
            apply(
              { type: 'setSequence', background: e.target.value },
              { coalesceKey: 'seq-bg', label: 'Background colour' },
            )
          }
        />
      </Row>
    </div>
  );
}

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const [usage, setUsage] = useState<{ entries: number; bytes: number } | null>(null);
  const [checks, setChecks] = useState<Check[] | null>(null);
  const privacy = useEditor((s) => s.project!.privacySettings);

  const refresh = () => cacheUsage().then(setUsage, () => setUsage({ entries: 0, bytes: 0 }));
  useEffect(() => {
    void refresh();
    void runDiagnostics().then(setChecks);
  }, []);

  return (
    <Dialog title="Settings" onClose={onClose} width="max-w-xl">
      <div className="-mx-4 -my-4">
        <Section title="Sequence">
          <SequenceSettings />
        </Section>
        <Section title="Cache">
          <p className="text-xs text-muted">
            Thumbnails and waveforms are cached in your browser's private storage (cap 5 GB, oldest
            removed first). Original media and exports are never part of the cache.
          </p>
          <div className="flex items-center justify-between">
            <span className="text-xs tabular-nums">
              {usage ? `${usage.entries} items · ${formatBytes(usage.bytes)}` : 'Measuring…'}
            </span>
            <Button
              size="sm"
              variant="danger"
              onClick={async () => {
                await clearCache();
                await refresh();
                toast('Cache cleared. Thumbnails will be regenerated when needed.');
              }}
            >
              Clear cache
            </Button>
          </div>
        </Section>
        <Section title="Privacy">
          <p className="text-xs text-muted">
            Viditor works fully offline once loaded. Footage, audio, thumbnails, file names and
            paths are never sent anywhere. AI assistant sharing is not available yet; when it
            arrives, everything below stays off unless you turn it on.
          </p>
          <ul className="space-y-1 text-[11px] text-faint">
            <li>Share file names with assistants: {privacy.shareFileNames ? 'on' : 'off'}</li>
            <li>
              Share title/caption text with assistants: {privacy.shareTextContent ? 'on' : 'off'}
            </li>
            <li>Share frames, audio or transcripts: off</li>
          </ul>
        </Section>
        <Section title="Browser diagnostics">
          {checks ? <CheckList checks={checks} /> : 'Checking…'}
        </Section>
        <div className="px-3 py-3 text-[11px] text-faint">Viditor {__APP_VERSION__}</div>
      </div>
    </Dialog>
  );
}
