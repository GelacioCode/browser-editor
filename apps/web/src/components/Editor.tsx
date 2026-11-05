import { useCallback, useEffect, useRef, useState } from 'react';
import { sequenceDuration, secondsToNearestFrame } from '@viditor/project-core';
import { TopBar } from './TopBar.tsx';
import { LeftPanel } from './LeftPanel.tsx';
import { Preview } from './Preview.tsx';
import { Inspector } from './Inspector.tsx';
import { Timeline } from './timeline/Timeline.tsx';
import { ExportDialog } from './ExportDialog.tsx';
import { SettingsDialog } from './SettingsDialog.tsx';
import { ShortcutsDialog } from './ShortcutsDialog.tsx';
import { RecoveryDialog } from './RecoveryDialog.tsx';
import { openDialog, redo, select, setPlayhead, undo, useEditor } from '../state/store.ts';
import {
  deleteSelection,
  duplicateSelection,
  nextEdit,
  splitAtPlayhead,
} from '../state/actions.ts';
import { saveNow } from '../state/project-io.ts';

function usePersistedNumber(key: string, initial: number): [number, (v: number) => void] {
  const [v, setV] = useState(() => {
    try {
      const s = localStorage.getItem(key);
      return s ? Number(s) || initial : initial;
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (n: number) => {
      setV(n);
      try {
        localStorage.setItem(key, String(n));
      } catch {
        /* storage unavailable */
      }
    },
    [key],
  );
  return [v, set];
}

function Splitter({ axis, onDrag }: { axis: 'x' | 'y'; onDrag: (delta: number) => void }) {
  const last = useRef(0);
  return (
    <div
      role="separator"
      aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
      className={
        axis === 'x'
          ? 'w-1 shrink-0 cursor-col-resize bg-border/40 hover:bg-accent/60'
          : 'h-1 shrink-0 cursor-row-resize bg-border/40 hover:bg-accent/60'
      }
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        last.current = axis === 'x' ? e.clientX : e.clientY;
      }}
      onPointerMove={(e) => {
        if (!(e.target as HTMLElement).hasPointerCapture(e.pointerId)) return;
        const pos = axis === 'x' ? e.clientX : e.clientY;
        onDrag(pos - last.current);
        last.current = pos;
      }}
    />
  );
}

function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  return (
    !!t &&
    (t.tagName === 'INPUT' ||
      t.tagName === 'TEXTAREA' ||
      t.tagName === 'SELECT' ||
      t.isContentEditable)
  );
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || useEditor.getState().dialog) return;
      const s = useEditor.getState();
      if (!s.project) return;
      const mod = e.ctrlKey || e.metaKey;
      const fps = s.project.sequence.fps;
      const k = e.key.toLowerCase();
      let handled = true;
      if (k === ' ') useEditor.setState({ playing: !s.playing });
      else if (mod && k === 'z' && !e.shiftKey) undo();
      else if ((mod && k === 'z' && e.shiftKey) || (mod && k === 'y')) redo();
      else if (mod && k === 's') void saveNow();
      else if (mod && k === 'd') duplicateSelection();
      else if (mod && k === 'a') select(s.project.clips.map((c) => c.id));
      else if (mod && k === 'e') openDialog('export');
      else if (!mod && k === 's') splitAtPlayhead();
      else if (k === 'delete' || k === 'backspace') deleteSelection();
      else if (k === 'escape') select([]);
      else if (k === 'arrowleft')
        setPlayhead(s.playhead - (e.shiftKey ? secondsToNearestFrame(1, fps) : 1));
      else if (k === 'arrowright')
        setPlayhead(s.playhead + (e.shiftKey ? secondsToNearestFrame(1, fps) : 1));
      else if (k === 'arrowup') nextEdit(-1);
      else if (k === 'arrowdown') nextEdit(1);
      else if (k === 'home') setPlayhead(0);
      else if (k === 'end') setPlayhead(sequenceDuration(s.project));
      else if (k === '=' || k === '+') useEditor.setState({ zoom: Math.min(800, s.zoom * 1.25) });
      else if (k === '-') useEditor.setState({ zoom: Math.max(2, s.zoom / 1.25) });
      else if (k === 'n') useEditor.setState({ snapping: !s.snapping });
      else if (k === '?') openDialog('shortcuts');
      else handled = false;
      if (handled) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export function Editor() {
  const dialog = useEditor((s) => s.dialog);
  const recovery = useEditor((s) => s.recovery);
  const [left, setLeft] = usePersistedNumber('vd.leftWidth', 300);
  const [right, setRight] = usePersistedNumber('vd.rightWidth', 300);
  const [bottom, setBottom] = usePersistedNumber('vd.timelineHeight', 300);
  useShortcuts();
  const close = () => openDialog(null);

  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <div
          style={{ width: left }}
          className="shrink-0 overflow-hidden border-r border-border bg-surface-1"
        >
          <LeftPanel />
        </div>
        <Splitter axis="x" onDrag={(d) => setLeft(Math.max(220, Math.min(520, left + d)))} />
        <div className="min-w-0 flex-1">
          <Preview />
        </div>
        <Splitter axis="x" onDrag={(d) => setRight(Math.max(240, Math.min(480, right - d)))} />
        <div
          style={{ width: right }}
          className="shrink-0 overflow-hidden border-l border-border bg-surface-1"
        >
          <Inspector />
        </div>
      </div>
      <Splitter
        axis="y"
        onDrag={(d) => setBottom(Math.max(160, Math.min(window.innerHeight - 260, bottom - d)))}
      />
      <div style={{ height: bottom }} className="shrink-0 border-t border-border bg-surface-1">
        <Timeline />
      </div>
      {dialog === 'export' && <ExportDialog onClose={close} />}
      {dialog === 'settings' && <SettingsDialog onClose={close} />}
      {dialog === 'shortcuts' && <ShortcutsDialog onClose={close} />}
      {recovery && (
        <RecoveryDialog snapshot={recovery} onDone={() => useEditor.setState({ recovery: null })} />
      )}
    </div>
  );
}
