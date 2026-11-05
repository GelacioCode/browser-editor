import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, AlertCircle } from 'lucide-react';
import { frameToSeconds, sequenceDuration, type ExportSettings } from '@viditor/project-core';
import {
  checkEncoders,
  exportDimensions,
  missingMedia,
  startExport,
  type ExportJob,
  type ExportProgress,
} from '@viditor/render';
import { getExportsDir } from '@viditor/media';
import { apply, useEditor } from '../state/store.ts';
import { availableFiles } from '../state/project-io.ts';
import { FONT_FILES, ensureFontsLoaded } from '../fonts.ts';
import { Button, Dialog, Row, Select } from '../ui/ui.tsx';

const QUALITY_LABEL: Record<ExportSettings['quality'], string> = {
  low: 'Low (smallest file)',
  medium: 'Medium',
  high: 'High (recommended)',
  'very-high': 'Very high (largest file)',
};

const PHASE_LABEL: Record<ExportProgress['phase'], string> = {
  checking: 'Checking…',
  audio: 'Mixing audio…',
  video: 'Rendering video…',
  finalizing: 'Finalizing file…',
  done: 'Export complete',
  canceled: 'Export canceled',
  error: 'Export failed',
};

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const project = useEditor((s) => s.project!);
  const dir = useEditor((s) => s.dir!);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [support, setSupport] = useState<{ video: boolean; audio: boolean } | null>(null);
  const [savedName, setSavedName] = useState<string | null>(null);
  const job = useRef<ExportJob | null>(null);
  const started = useRef(0);

  const settings = project.exportSettings;
  const { width, height } = exportDimensions(project);
  const duration = frameToSeconds(sequenceDuration(project), project.sequence.fps);
  const running = progress && !['done', 'canceled', 'error'].includes(progress.phase);
  const missing = missingMedia(project, availableFiles());

  useEffect(() => {
    void checkEncoders(width, height).then(setSupport);
  }, [width, height]);

  const heights = [
    ...new Set(
      [2160, 1440, 1080, 720, 480]
        .filter((h) => h <= project.sequence.height)
        .concat(project.sequence.height),
    ),
  ]
    .sort((a, b) => b - a)
    .slice(0, 5);

  const begin = async () => {
    let target: FileSystemFileHandle;
    try {
      target = await window.showSaveFilePicker({
        suggestedName: `${project.name.replace(/[\\/:*?"<>|]+/g, '-')}.mp4`,
        startIn: await getExportsDir(dir).catch(() => undefined),
        types: [{ description: 'MP4 video', accept: { 'video/mp4': ['.mp4'] } }],
      });
    } catch {
      return; // user canceled the picker
    }
    await ensureFontsLoaded();
    setSavedName(target.name);
    started.current = performance.now();
    useEditor.setState({ playing: false });
    job.current = startExport({
      project,
      files: availableFiles(),
      fonts: FONT_FILES,
      target,
      onProgress: setProgress,
    });
    job.current.done.catch(() => {});
  };

  const elapsed = (performance.now() - started.current) / 1000;
  const eta =
    progress?.phase === 'video' && progress.progress > 0.12
      ? Math.max(0, (elapsed / progress.progress) * (1 - progress.progress))
      : null;

  return (
    <Dialog
      title="Export video"
      onClose={() => {
        if (running) return;
        onClose();
      }}
      footer={
        running ? (
          <Button variant="danger" onClick={() => job.current?.cancel()}>
            Cancel export
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
            <Button
              variant="primary"
              disabled={!support?.video || missing.length > 0 || duration <= 0}
              onClick={() => void begin()}
            >
              {progress?.phase === 'done' ? 'Export again' : 'Choose location & export'}
            </Button>
          </>
        )
      }
    >
      <div className="space-y-3">
        <Row label="Format">
          <span className="text-xs">MP4 · H.264 video · AAC audio</span>
        </Row>
        <Row label="Resolution">
          <Select
            value={settings.height}
            options={heights.map((h) => ({
              value: h,
              label: `${Math.round((h * project.sequence.width) / project.sequence.height) & ~1}×${h & ~1}`,
            }))}
            onChange={(h) =>
              apply(
                { type: 'setExportSettings', settings: { height: h } },
                { label: 'Export resolution' },
              )
            }
          />
        </Row>
        <Row label="Quality">
          <Select
            value={settings.quality}
            options={(Object.keys(QUALITY_LABEL) as ExportSettings['quality'][]).map((q) => ({
              value: q,
              label: QUALITY_LABEL[q],
            }))}
            onChange={(quality) =>
              apply(
                { type: 'setExportSettings', settings: { quality } },
                { label: 'Export quality' },
              )
            }
          />
        </Row>
        <Row label="Length">
          <span className="text-xs tabular-nums">{duration.toFixed(2)} s</span>
        </Row>

        {support && !support.video && (
          <p className="flex gap-1.5 rounded-md bg-danger/10 p-2 text-xs text-danger">
            <AlertCircle size={14} className="shrink-0" /> This browser can't encode H.264 at{' '}
            {width}×{height}. Try a lower resolution or desktop Chrome/Edge.
          </p>
        )}
        {support && support.video && !support.audio && (
          <p className="flex gap-1.5 rounded-md bg-warning/10 p-2 text-xs text-warning">
            <AlertCircle size={14} className="shrink-0" /> AAC audio encoding isn't available here,
            so projects with audio can't be exported in this browser.
          </p>
        )}
        {missing.length > 0 && (
          <p className="flex gap-1.5 rounded-md bg-danger/10 p-2 text-xs text-danger">
            <AlertCircle size={14} className="shrink-0" /> Offline media: {missing.join(', ')}.
            Relink it in the Media panel first.
          </p>
        )}

        {progress && (
          <div className="rounded-md border border-border bg-surface-2 p-3">
            <div className="mb-2 flex items-center justify-between text-xs">
              <span
                className={
                  progress.phase === 'error'
                    ? 'text-danger'
                    : progress.phase === 'done'
                      ? 'text-success'
                      : ''
                }
              >
                {progress.phase === 'done' && <CheckCircle2 size={13} className="mr-1 inline" />}
                {PHASE_LABEL[progress.phase]}
              </span>
              <span className="tabular-nums text-muted">
                {progress.phase === 'video' &&
                  progress.frame !== undefined &&
                  `${progress.frame}/${progress.totalFrames} frames`}
                {eta !== null && ` · ~${Math.ceil(eta)}s left`}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
              <div
                className={
                  progress.phase === 'error'
                    ? 'h-full bg-danger'
                    : 'h-full bg-accent transition-[width]'
                }
                style={{ width: `${Math.round(progress.progress * 100)}%` }}
              />
            </div>
            {progress.phase === 'error' && (
              <p className="mt-2 text-xs text-danger">{progress.message}</p>
            )}
            {progress.phase === 'done' && savedName && (
              <p className="mt-2 text-xs text-muted">
                Saved <strong className="text-text">{savedName}</strong> to the folder you chose.
              </p>
            )}
            {progress.phase === 'canceled' && (
              <p className="mt-2 text-xs text-muted">The incomplete file was removed.</p>
            )}
          </div>
        )}
        <p className="text-[11px] text-faint">
          Rendering happens on this computer. Keep this tab open until the export finishes.
        </p>
      </div>
    </Dialog>
  );
}
