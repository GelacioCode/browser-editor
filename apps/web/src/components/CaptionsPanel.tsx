import { useEffect, useState } from 'react';
import { Plus, FileUp, FileDown } from 'lucide-react';
import { formatShort, type CaptionClip } from '@viditor/project-core';
import { apply, useEditor } from '../state/store.ts';
import {
  addCaptionAtPlayhead,
  captionClips,
  exportSrtFile,
  importSrtFile,
  jumpToClip,
} from '../state/actions.ts';
import { Button, cx } from '../ui/ui.tsx';

function CaptionRow({ c, selected }: { c: CaptionClip; selected: boolean }) {
  const fps = useEditor((s) => s.project!.sequence.fps);
  const [text, setText] = useState(c.text);
  useEffect(() => setText(c.text), [c.text]);
  return (
    <li
      className={cx(
        'rounded-md border p-2',
        selected ? 'border-accent bg-accent-soft' : 'border-border bg-surface-2',
      )}
      onClick={() => jumpToClip(c.id)}
    >
      <div className="mb-1 text-[10px] tabular-nums text-faint">
        {formatShort(c.start, fps)} → {formatShort(c.start + c.duration, fps)}
      </div>
      <textarea
        aria-label="Caption text"
        className="w-full resize-none rounded-sm border border-transparent bg-transparent text-xs outline-none focus:border-accent focus:bg-surface-1"
        rows={Math.min(3, text.split('\n').length)}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() =>
          text !== c.text &&
          apply({ type: 'updateText', clipId: c.id, text }, { label: 'Edit caption' })
        }
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            (e.target as HTMLTextAreaElement).blur();
          }
        }}
      />
    </li>
  );
}

export function CaptionsPanel() {
  const project = useEditor((s) => s.project!);
  const selection = useEditor((s) => s.selection);
  const caps = captionClips(project) as CaptionClip[];
  return (
    <div className="p-3">
      <Button variant="primary" className="w-full" onClick={() => addCaptionAtPlayhead()}>
        <Plus size={14} /> Add caption at playhead
      </Button>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Button size="sm" onClick={() => void importSrtFile()}>
          <FileUp size={12} /> Import SRT
        </Button>
        <Button size="sm" disabled={!caps.length} onClick={() => void exportSrtFile()}>
          <FileDown size={12} /> Export SRT
        </Button>
      </div>
      <p className="mt-2 text-[11px] text-faint">
        Captions are typed manually or imported from .srt. Automatic transcription is not available
        yet.
      </p>
      <ul className="mt-3 space-y-1.5">
        {caps.map((c) => (
          <CaptionRow key={c.id} c={c} selected={selection.includes(c.id)} />
        ))}
      </ul>
    </div>
  );
}
