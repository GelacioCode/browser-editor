import { useEffect, useState } from 'react';
import {
  Undo2,
  Redo2,
  Download,
  Settings,
  Keyboard,
  Check,
  Loader2,
  AlertCircle,
  X,
  Circle,
} from 'lucide-react';
import { fpsToNumber } from '@viditor/project-core';
import { apply, openDialog, redo, undo, useEditor } from '../state/store.ts';
import { closeProject, saveNow } from '../state/project-io.ts';
import { Button, IconButton } from '../ui/ui.tsx';
import { Logo } from './Logo.tsx';

function SaveIndicator() {
  const state = useEditor((s) => s.saveState);
  const map = {
    saved: { icon: <Check size={13} />, text: 'Saved', cls: 'text-faint' },
    dirty: {
      icon: <Circle size={9} className="fill-current" />,
      text: 'Unsaved',
      cls: 'text-warning',
    },
    saving: {
      icon: <Loader2 size={13} className="animate-spin" />,
      text: 'Saving…',
      cls: 'text-muted',
    },
    error: { icon: <AlertCircle size={13} />, text: 'Save failed — retry', cls: 'text-danger' },
  }[state];
  return (
    <button
      onClick={() => void saveNow()}
      title="Save now (Ctrl+S). Changes are also saved automatically."
      className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] hover:bg-surface-3 ${map.cls}`}
    >
      {map.icon}
      {map.text}
    </button>
  );
}

function ProjectName() {
  const name = useEditor((s) => s.project?.name ?? '');
  const [draft, setDraft] = useState(name);
  useEffect(() => setDraft(name), [name]);
  return (
    <input
      aria-label="Project name"
      className="h-7 w-52 rounded-md border border-transparent bg-transparent px-2 text-sm font-medium outline-none hover:border-border focus:border-accent focus:bg-surface-2"
      value={draft}
      maxLength={120}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const v = draft.trim();
        if (v && v !== name) apply({ type: 'renameProject', name: v });
        else setDraft(name);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        e.stopPropagation();
      }}
    />
  );
}

export function TopBar() {
  const canUndo = useEditor((s) => s.canUndo);
  const canRedo = useEditor((s) => s.canRedo);
  const undoLabel = useEditor((s) => s.undoLabel);
  const redoLabel = useEditor((s) => s.redoLabel);
  const seq = useEditor((s) => s.project?.sequence);
  const hasClips = useEditor((s) => (s.project?.clips.length ?? 0) > 0);

  return (
    <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border bg-surface-1 px-3">
      <Logo small />
      <div className="mx-2 h-5 w-px bg-border" />
      <ProjectName />
      <SaveIndicator />
      <div className="mx-1 h-5 w-px bg-border" />
      <IconButton
        label={undoLabel ? `Undo ${undoLabel} (Ctrl+Z)` : 'Undo (Ctrl+Z)'}
        disabled={!canUndo}
        onClick={undo}
      >
        <Undo2 size={15} />
      </IconButton>
      <IconButton
        label={redoLabel ? `Redo ${redoLabel} (Ctrl+Shift+Z)` : 'Redo (Ctrl+Shift+Z)'}
        disabled={!canRedo}
        onClick={redo}
      >
        <Redo2 size={15} />
      </IconButton>

      <div className="flex-1" />

      {seq && (
        <button
          onClick={() => openDialog('settings')}
          className="rounded-md px-2 py-1 text-[11px] tabular-nums text-muted hover:bg-surface-3 hover:text-text"
          title="Sequence settings"
        >
          {seq.width}×{seq.height} · {Number(fpsToNumber(seq.fps).toFixed(3))} fps
        </button>
      )}
      <IconButton label="Keyboard shortcuts (?)" onClick={() => openDialog('shortcuts')}>
        <Keyboard size={15} />
      </IconButton>
      <IconButton label="Settings" onClick={() => openDialog('settings')}>
        <Settings size={15} />
      </IconButton>
      <Button
        variant="primary"
        disabled={!hasClips}
        onClick={() => openDialog('export')}
        title="Export (Ctrl+E)"
      >
        <Download size={14} /> Export
      </Button>
      <IconButton label="Close project" onClick={() => void closeProject()}>
        <X size={15} />
      </IconButton>
    </header>
  );
}
