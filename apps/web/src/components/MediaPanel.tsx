import { useState } from 'react';
import {
  Upload,
  Plus,
  Film,
  Image as ImageIcon,
  Music,
  Link2,
  Trash2,
  Lock,
  Loader2,
} from 'lucide-react';
import { usToSeconds, type MediaItem } from '@viditor/project-core';
import { apply, useEditor, type MediaRuntime } from '../state/store.ts';
import {
  grantMediaAccess,
  importDataTransfer,
  importViaPicker,
  relinkMedia,
} from '../state/project-io.ts';
import { addMediaToTimeline } from '../state/actions.ts';
import { Button, IconButton, cx } from '../ui/ui.tsx';

export const MEDIA_DRAG_TYPE = 'application/x-viditor-media';

function fmtDuration(us: number) {
  const s = usToSeconds(us);
  const m = Math.floor(s / 60);
  return `${m}:${Math.floor(s % 60)
    .toString()
    .padStart(2, '0')}`;
}

function KindIcon({ kind, size = 14 }: { kind: MediaItem['kind']; size?: number }) {
  if (kind === 'video') return <Film size={size} />;
  if (kind === 'image') return <ImageIcon size={size} />;
  return <Music size={size} />;
}

function MediaCard({ m, rt }: { m: MediaItem; rt: MediaRuntime | undefined }) {
  const status = rt?.status ?? 'loading';
  const thumb = rt?.thumbs?.[Math.min(1, (rt.thumbs?.length ?? 1) - 1)]?.url;
  const ready = status === 'ready';
  return (
    <div
      className={cx(
        'group relative overflow-hidden rounded-md border bg-surface-2',
        ready ? 'border-border hover:border-border-strong' : 'border-danger/40',
      )}
      draggable={ready}
      onDragStart={(e) => {
        e.dataTransfer.setData(MEDIA_DRAG_TYPE, m.id);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      onDoubleClick={() => ready && addMediaToTimeline(m.id)}
      title={`${m.name}\nDouble-click or drag to add to the timeline`}
    >
      <div className="relative flex aspect-video items-center justify-center bg-surface-3 text-faint">
        {thumb ? (
          <img src={thumb} alt="" className="h-full w-full object-cover" draggable={false} />
        ) : m.kind === 'audio' ? (
          <Music size={22} />
        ) : rt?.analyzing ? (
          <Loader2 size={18} className="animate-spin" />
        ) : (
          <KindIcon kind={m.kind} size={22} />
        )}
        {m.kind !== 'image' && (
          <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 text-[10px] tabular-nums text-white">
            {fmtDuration(m.durationUs)}
          </span>
        )}
        {ready && (
          <button
            aria-label={`Add ${m.name} to timeline`}
            onClick={() => addMediaToTimeline(m.id)}
            className="absolute right-1 top-1 hidden h-6 w-6 items-center justify-center rounded bg-accent text-white shadow group-hover:flex"
          >
            <Plus size={14} />
          </button>
        )}
        {status === 'offline' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/70 text-[11px] text-[#ffb3ba]">
            Missing file
            <Button size="sm" variant="secondary" onClick={() => relinkMedia(m.id)}>
              <Link2 size={12} /> Relink
            </Button>
          </div>
        )}
        {status === 'needs-permission' && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-[11px] text-warning">
            <Lock size={12} className="mr-1" /> Needs access
          </div>
        )}
      </div>
      <div className="flex items-center gap-1 px-1.5 py-1">
        <span className="text-faint">
          <KindIcon kind={m.kind} size={11} />
        </span>
        <span className="min-w-0 flex-1 truncate text-[11px]">{m.name}</span>
        <IconButton
          label="Remove from project"
          className="hidden h-5 w-5 group-hover:inline-flex"
          onClick={() => {
            const used = useEditor
              .getState()
              .project?.clips.some((c) => 'mediaId' in c && c.mediaId === m.id);
            if (used && !confirm(`Remove ${m.name}? Clips that use it will be deleted too.`))
              return;
            apply({ type: 'removeMedia', mediaId: m.id }, { label: `Remove ${m.name}` });
          }}
        >
          <Trash2 size={11} />
        </IconButton>
      </div>
    </div>
  );
}

export function MediaPanel() {
  const media = useEditor((s) => s.project?.media ?? []);
  const runtime = useEditor((s) => s.media);
  const [over, setOver] = useState(false);
  const needsPermission = media.filter((m) => runtime[m.id]?.status === 'needs-permission').length;

  return (
    <div
      className={cx('min-h-full p-3', over && 'bg-accent-soft')}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setOver(false);
        void importDataTransfer(e.dataTransfer);
      }}
    >
      <Button variant="primary" className="w-full" onClick={() => void importViaPicker()}>
        <Upload size={14} /> Import media
      </Button>
      <p className="mt-1.5 text-center text-[11px] text-faint">
        or drop files here · video, audio, images
      </p>

      {needsPermission > 0 && (
        <div className="mt-3 rounded-md border border-warning/40 bg-warning/10 p-2 text-[11px] text-warning">
          {needsPermission} file{needsPermission > 1 ? 's' : ''} need permission to be read again
          after reopening.
          <Button size="sm" className="mt-1.5 w-full" onClick={() => void grantMediaAccess()}>
            Allow access
          </Button>
        </div>
      )}

      {media.length === 0 ? (
        <div className="mt-8 text-center text-xs text-faint">
          No media yet.
          <br />
          Files stay where they are on your disk — nothing is uploaded.
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {media.map((m) => (
            <MediaCard key={m.id} m={m} rt={runtime[m.id]} />
          ))}
        </div>
      )}
    </div>
  );
}
