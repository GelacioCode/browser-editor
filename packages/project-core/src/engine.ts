import { applyPatches, enablePatches, produce, produceWithPatches, type Patch } from 'immer';
import { z } from 'zod';
import {
  EngineError,
  OperationSchema,
  applyOperation,
  type EngineErrorCode,
  type Operation,
} from './operations.ts';
import { ProjectSchema, type Project } from './schema.ts';

enablePatches();

export type ChangeOrigin = 'user' | 'assistant' | 'system';

export interface Transaction {
  ops: Operation[];
  /** Idempotency key: retrying the same opId returns the original result without re-applying. */
  opId?: string;
  /** If set, the transaction fails with STALE_REVISION unless it matches the current revision. */
  expectedRevision?: number;
  /** Human-readable undo label, e.g. "Split clip". */
  label?: string;
  origin?: ChangeOrigin;
  /**
   * Consecutive transactions with the same key (within `coalesceMs`) merge into one undo step.
   * Used for slider drags and keyboard nudges.
   */
  coalesceKey?: string;
}

export interface EngineFailure {
  code: EngineErrorCode;
  message: string;
  /** Index of the failing operation within the transaction, when known. */
  opIndex?: number;
  issues?: { path: string; message: string }[];
}

export type ApplyResult =
  | { ok: true; revision: number; created: string[]; duplicate?: boolean }
  | { ok: false; error: EngineFailure; revision: number };

export type ChangeKind = 'apply' | 'undo' | 'redo' | 'load';

export interface ChangeEvent {
  kind: ChangeKind;
  revision: number;
  label: string;
  origin: ChangeOrigin;
}

interface UndoEntry {
  label: string;
  origin: ChangeOrigin;
  patches: Patch[];
  inverse: Patch[];
  coalesceKey?: string;
  at: number;
}

export interface EngineOptions {
  maxUndo?: number;
  coalesceMs?: number;
  now?: () => number;
}

const MAX_IDEMPOTENCY_KEYS = 500;

/**
 * The single authoritative writer for an open project.
 * Manual UI actions and (later) assistant tool calls both go through `apply`.
 */
export class ProjectEngine {
  private state: Project;
  private undoStack: UndoEntry[] = [];
  private redoStack: UndoEntry[] = [];
  private listeners = new Set<(e: ChangeEvent) => void>();
  private results = new Map<string, ApplyResult>();
  private readonly maxUndo: number;
  private readonly coalesceMs: number;
  private readonly now: () => number;

  constructor(project: Project, opts: EngineOptions = {}) {
    this.state = ProjectEngine.validate(project);
    this.maxUndo = opts.maxUndo ?? 200;
    this.coalesceMs = opts.coalesceMs ?? 1200;
    this.now = opts.now ?? Date.now;
  }

  /** Parse/validate an untrusted project document (e.g. loaded from disk). */
  static validate(project: unknown): Project {
    return ProjectSchema.parse(project);
  }

  get project(): Project {
    return this.state;
  }

  get revision(): number {
    return this.state.revision;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get undoLabel(): string | undefined {
    return this.undoStack.at(-1)?.label;
  }

  get redoLabel(): string | undefined {
    return this.redoStack.at(-1)?.label;
  }

  subscribe(listener: (e: ChangeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Replace the whole project (open/recover). Clears history. */
  load(project: Project): void {
    this.state = ProjectEngine.validate(project);
    this.undoStack = [];
    this.redoStack = [];
    this.results.clear();
    this.emit({
      kind: 'load',
      revision: this.state.revision,
      label: 'Open project',
      origin: 'system',
    });
  }

  apply(tx: Transaction): ApplyResult {
    if (tx.opId && this.results.has(tx.opId)) {
      const prev = this.results.get(tx.opId)!;
      return prev.ok ? { ...prev, duplicate: true } : prev;
    }
    const result = this.applyInner(tx);
    if (tx.opId) {
      this.results.set(tx.opId, result);
      if (this.results.size > MAX_IDEMPOTENCY_KEYS) {
        this.results.delete(this.results.keys().next().value!);
      }
    }
    return result;
  }

  private applyInner(tx: Transaction): ApplyResult {
    const revision = this.state.revision;
    if (tx.expectedRevision !== undefined && tx.expectedRevision !== revision) {
      return {
        ok: false,
        revision,
        error: {
          code: 'STALE_REVISION',
          message: `Expected revision ${tx.expectedRevision} but project is at ${revision}. Re-read the project and retry.`,
        },
      };
    }
    if (tx.ops.length === 0) return { ok: true, revision, created: [] };

    const parsed: z.output<typeof OperationSchema>[] = [];
    for (let i = 0; i < tx.ops.length; i++) {
      const r = OperationSchema.safeParse(tx.ops[i]);
      if (!r.success) {
        return {
          ok: false,
          revision,
          error: {
            code: 'VALIDATION',
            message: `Operation ${i} is invalid`,
            opIndex: i,
            issues: r.error.issues.map((iss) => ({
              path: iss.path.join('.'),
              message: iss.message,
            })),
          },
        };
      }
      parsed.push(r.data);
    }

    const created: string[] = [];
    let failedAt = -1;
    let next: Project;
    let patches: Patch[];
    let inverse: Patch[];
    try {
      [next, patches, inverse] = produceWithPatches(this.state, (draft) => {
        for (let i = 0; i < parsed.length; i++) {
          failedAt = i;
          applyOperation(draft, parsed[i]!, { created });
        }
      });
    } catch (err) {
      if (err instanceof EngineError) {
        return {
          ok: false,
          revision,
          error: { code: err.code, message: err.message, opIndex: failedAt },
        };
      }
      throw err;
    }

    if (patches.length === 0) return { ok: true, revision, created };

    // Safety net: the result must still be a valid project document.
    const check = ProjectSchema.safeParse(next);
    if (!check.success) {
      return {
        ok: false,
        revision,
        error: {
          code: 'VALIDATION',
          message: 'Transaction would produce an invalid project',
          issues: check.error.issues.map((iss) => ({
            path: iss.path.join('.'),
            message: iss.message,
          })),
        },
      };
    }

    const label = tx.label ?? defaultLabel(parsed[0]!.type, parsed.length);
    const origin = tx.origin ?? 'user';
    this.pushUndo({ label, origin, patches, inverse, coalesceKey: tx.coalesceKey, at: this.now() });
    this.redoStack = [];
    this.commit(next, { kind: 'apply', label, origin });
    return { ok: true, revision: this.state.revision, created };
  }

  undo(): boolean {
    const entry = this.undoStack.pop();
    if (!entry) return false;
    this.redoStack.push(entry);
    this.commit(applyPatches(this.state, entry.inverse), {
      kind: 'undo',
      label: entry.label,
      origin: 'user',
    });
    return true;
  }

  redo(): boolean {
    const entry = this.redoStack.pop();
    if (!entry) return false;
    this.undoStack.push({ ...entry, coalesceKey: undefined });
    this.commit(applyPatches(this.state, entry.patches), {
      kind: 'redo',
      label: entry.label,
      origin: 'user',
    });
    return true;
  }

  private pushUndo(entry: UndoEntry) {
    const last = this.undoStack.at(-1);
    if (
      entry.coalesceKey &&
      last &&
      last.coalesceKey === entry.coalesceKey &&
      entry.at - last.at <= this.coalesceMs
    ) {
      last.patches = [...last.patches, ...entry.patches];
      last.inverse = [...entry.inverse, ...last.inverse];
      last.at = entry.at;
      return;
    }
    this.undoStack.push(entry);
    if (this.undoStack.length > this.maxUndo) this.undoStack.shift();
  }

  /** Revisions only ever increase, including on undo/redo, so stale writers are always detected. */
  private commit(next: Project, e: Omit<ChangeEvent, 'revision'>) {
    const revision = this.state.revision + 1;
    this.state = produce(next, (d) => {
      d.revision = revision;
      d.updatedAt = new Date(this.now()).toISOString();
    });
    this.emit({ ...e, revision });
  }

  private emit(e: ChangeEvent) {
    for (const l of this.listeners) l(e);
  }
}

const LABELS: Record<string, string> = {
  renameProject: 'Rename project',
  setSequence: 'Change sequence settings',
  setExportSettings: 'Change export settings',
  setPrivacy: 'Change privacy settings',
  addTrack: 'Add track',
  updateTrack: 'Update track',
  moveTrack: 'Reorder track',
  removeTrack: 'Delete track',
  addMedia: 'Import media',
  updateMedia: 'Update media',
  removeMedia: 'Remove media',
  addClip: 'Add clip',
  deleteClip: 'Delete clip',
  moveClip: 'Move clip',
  splitClip: 'Split clip',
  trimClip: 'Trim clip',
  duplicateClip: 'Duplicate clip',
  setTransform: 'Transform',
  setAudio: 'Adjust audio',
  setSpeed: 'Change speed',
  addTitle: 'Add title',
  updateText: 'Edit text',
  addCaption: 'Add caption',
};

function defaultLabel(type: string, count: number): string {
  const base = LABELS[type] ?? type;
  return count > 1 ? `${base} (+${count - 1})` : base;
}
