import { create } from 'zustand';
import {
  ProjectEngine,
  type ApplyResult,
  type Operation,
  type Project,
  type Transaction,
} from '@viditor/project-core';
import type { RecoverySnapshot } from '@viditor/media';

export type MediaStatus = 'loading' | 'ready' | 'needs-permission' | 'offline' | 'error';

/** Runtime-only media state (never persisted): file access, preview URLs, analysis output. */
export interface MediaRuntime {
  status: MediaStatus;
  file?: File;
  handle?: FileSystemFileHandle;
  /** Object URL for <video>/<audio>/<img> playback. Local blob: URL, never uploaded. */
  url?: string;
  thumbs?: { time: number; url: string }[];
  thumbWidth?: number;
  thumbHeight?: number;
  peaks?: Float32Array;
  peaksPerSecond?: number;
  analyzing?: boolean;
  error?: string;
}

export type SaveState = 'saved' | 'dirty' | 'saving' | 'error';
export type DialogKind = null | 'export' | 'settings' | 'shortcuts';
export type LeftTab = 'media' | 'text' | 'captions' | 'ai';

export interface Toast {
  id: number;
  kind: 'info' | 'error' | 'success';
  message: string;
}

export interface EditorState {
  engine: ProjectEngine | null;
  project: Project | null;
  dir: FileSystemDirectoryHandle | null;
  saveState: SaveState;
  lastSavedAt: number | null;
  media: Record<string, MediaRuntime>;

  playhead: number;
  playing: boolean;
  selection: string[];
  /** Timeline zoom in pixels per second. */
  zoom: number;
  snapping: boolean;
  safeArea: boolean;

  canUndo: boolean;
  canRedo: boolean;
  undoLabel?: string;
  redoLabel?: string;

  dialog: DialogKind;
  leftTab: LeftTab;
  /** Autosave newer than project.json, offered on open. */
  recovery: RecoverySnapshot | null;
  toasts: Toast[];
}

export const useEditor = create<EditorState>(() => ({
  engine: null,
  project: null,
  dir: null,
  saveState: 'saved',
  lastSavedAt: null,
  media: {},
  playhead: 0,
  playing: false,
  selection: [],
  zoom: 60,
  snapping: true,
  safeArea: false,
  canUndo: false,
  canRedo: false,
  dialog: null,
  leftTab: 'media',
  recovery: null,
  toasts: [],
}));

const get = useEditor.getState;
const set = useEditor.setState;

/* -------------------------------------------------------------------------------------------- */
/* Toasts                                                                                        */
/* -------------------------------------------------------------------------------------------- */

let toastId = 1;
export function toast(message: string, kind: Toast['kind'] = 'info', ms = 4000) {
  const id = toastId++;
  set((s) => ({ toasts: [...s.toasts.slice(-3), { id, kind, message }] }));
  setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), ms);
}

/* -------------------------------------------------------------------------------------------- */
/* Engine wiring                                                                                 */
/* -------------------------------------------------------------------------------------------- */

type ChangeHook = (project: Project, kind: 'apply' | 'undo' | 'redo' | 'load') => void;
const changeHooks = new Set<ChangeHook>();

/** Subscribe to committed project changes (autosave, preview invalidation, …). */
export function onProjectChange(hook: ChangeHook): () => void {
  changeHooks.add(hook);
  return () => changeHooks.delete(hook);
}

let unsubscribeEngine: (() => void) | null = null;

export function attachEngine(engine: ProjectEngine, dir: FileSystemDirectoryHandle) {
  unsubscribeEngine?.();
  const sync = () => {
    const project = engine.project;
    // Drop selection of clips that no longer exist.
    const ids = new Set(project.clips.map((c) => c.id));
    set((s) => ({
      project,
      canUndo: engine.canUndo,
      canRedo: engine.canRedo,
      undoLabel: engine.undoLabel,
      redoLabel: engine.redoLabel,
      selection: s.selection.filter((id) => ids.has(id)),
    }));
  };
  unsubscribeEngine = engine.subscribe((e) => {
    sync();
    if (e.kind !== 'load') set({ saveState: 'dirty' });
    for (const h of changeHooks) h(engine.project, e.kind);
  });
  set({ engine, dir, playhead: 0, playing: false, selection: [], saveState: 'saved' });
  sync();
}

export function detachEngine() {
  unsubscribeEngine?.();
  unsubscribeEngine = null;
  for (const m of Object.values(get().media)) {
    if (m.url) URL.revokeObjectURL(m.url);
    m.thumbs?.forEach((t) => URL.revokeObjectURL(t.url));
  }
  set({
    engine: null,
    project: null,
    dir: null,
    media: {},
    selection: [],
    playing: false,
    playhead: 0,
  });
}

export interface ApplyOptions {
  label?: string;
  coalesceKey?: string;
  /** Show a toast when the transaction fails (default true). */
  notify?: boolean;
}

/** Apply operations through the engine (the only way the UI changes the project). */
export function apply(ops: Operation | Operation[], opts: ApplyOptions = {}): ApplyResult {
  const engine = get().engine;
  if (!engine)
    return { ok: false, revision: 0, error: { code: 'NOT_FOUND', message: 'No project open' } };
  const tx: Transaction = {
    ops: Array.isArray(ops) ? ops : [ops],
    label: opts.label,
    coalesceKey: opts.coalesceKey,
    origin: 'user',
  };
  const r = engine.apply(tx);
  if (!r.ok && opts.notify !== false) toast(friendlyError(r.error.code, r.error.message), 'error');
  return r;
}

function friendlyError(code: string, message: string): string {
  switch (code) {
    case 'OVERLAP':
      return 'There is no room there — clips on one track cannot overlap.';
    case 'TRACK_MISMATCH':
      return 'That clip type cannot go on this track.';
    case 'LOCKED':
      return message;
    default:
      return message;
  }
}

export function undo() {
  const e = get().engine;
  if (e?.undo()) toast(`Undo: ${get().redoLabel ?? ''}`, 'info', 1500);
}

export function redo() {
  const e = get().engine;
  if (e?.redo()) toast(`Redo: ${get().undoLabel ?? ''}`, 'info', 1500);
}

/* -------------------------------------------------------------------------------------------- */
/* UI state helpers                                                                              */
/* -------------------------------------------------------------------------------------------- */

export function setPlayhead(frame: number) {
  set({ playhead: Math.max(0, Math.round(frame)) });
}

export function select(ids: string[], additive = false) {
  set((s) => ({
    selection: additive
      ? [
          ...new Set([
            ...s.selection.filter((x) => !ids.includes(x)),
            ...ids.filter((x) => !s.selection.includes(x)),
          ]),
        ]
      : ids,
  }));
}

export function updateMedia(id: string, patch: Partial<MediaRuntime>) {
  set((s) => ({
    media: { ...s.media, [id]: { ...(s.media[id] ?? { status: 'loading' }), ...patch } },
  }));
}

export function openDialog(dialog: DialogKind) {
  set({ dialog });
}
