/// <reference types="wicg-file-system-access" />
import { parseProjectDocument, serializeProject, type Project } from '@viditor/project-core';

/**
 * Project folder layout (inside a folder the user picks):
 *   project.json       durable editing instructions
 *   project.prev.json  previous saved version (backup)
 *   recovery/          autosave snapshots
 *   exports/           suggested export location
 * Disposable caches (thumbnails, waveforms) live in the browser's origin-private storage, not here.
 */
export const PROJECT_FILE = 'project.json';
export const PROJECT_BACKUP_FILE = 'project.prev.json';
export const RECOVERY_DIR = 'recovery';
const MAX_RECOVERY_SNAPSHOTS = 5;

export type PermissionMode = 'read' | 'readwrite';

export async function ensurePermission(
  handle: FileSystemHandle,
  mode: PermissionMode,
  request: boolean,
): Promise<boolean> {
  const opts = { mode } as const;
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  if (!request) return false;
  return (await handle.requestPermission(opts)) === 'granted';
}

export async function readTextFile(
  dir: FileSystemDirectoryHandle,
  name: string,
): Promise<string | null> {
  try {
    const fh = await dir.getFileHandle(name);
    return await (await fh.getFile()).text();
  } catch (e) {
    if (e instanceof DOMException && e.name === 'NotFoundError') return null;
    throw e;
  }
}

/**
 * createWritable() writes to a swap file and atomically replaces the target on close(),
 * so an interrupted write never leaves a half-written file behind.
 */
export async function writeTextFile(
  dir: FileSystemDirectoryHandle,
  name: string,
  text: string,
): Promise<void> {
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  try {
    await w.write(text);
    await w.close();
  } catch (e) {
    await w.abort().catch(() => {});
    throw e;
  }
}

export async function hasProjectFile(dir: FileSystemDirectoryHandle): Promise<boolean> {
  return (await readTextFile(dir, PROJECT_FILE)) !== null;
}

export async function loadProject(dir: FileSystemDirectoryHandle): Promise<Project> {
  const text = await readTextFile(dir, PROJECT_FILE);
  if (text === null) throw new Error('This folder does not contain a project.json');
  try {
    return parseProjectDocument(text);
  } catch (e) {
    // Fall back to the previous good version if the main file is damaged.
    const backup = await readTextFile(dir, PROJECT_BACKUP_FILE);
    if (backup) return parseProjectDocument(backup);
    throw e;
  }
}

/** Save project.json, keeping the previous valid version as project.prev.json. */
export async function saveProject(dir: FileSystemDirectoryHandle, project: Project): Promise<void> {
  const previous = await readTextFile(dir, PROJECT_FILE);
  if (previous !== null) {
    try {
      parseProjectDocument(previous);
      await writeTextFile(dir, PROJECT_BACKUP_FILE, previous);
    } catch {
      // Existing file is invalid; don't overwrite the backup with it.
    }
  }
  await writeTextFile(dir, PROJECT_FILE, serializeProject(project));
}

export async function ensureProjectDirs(dir: FileSystemDirectoryHandle): Promise<void> {
  await dir.getDirectoryHandle(RECOVERY_DIR, { create: true });
  await dir.getDirectoryHandle('exports', { create: true });
}

export async function getExportsDir(
  dir: FileSystemDirectoryHandle,
): Promise<FileSystemDirectoryHandle> {
  return dir.getDirectoryHandle('exports', { create: true });
}

export interface RecoverySnapshot {
  name: string;
  savedAt: number;
  project: Project;
}

export async function writeRecoverySnapshot(
  dir: FileSystemDirectoryHandle,
  project: Project,
): Promise<void> {
  const rec = await dir.getDirectoryHandle(RECOVERY_DIR, { create: true });
  const name = `autosave-${Date.now()}-r${project.revision}.json`;
  await writeTextFile(rec, name, serializeProject(project));
  const names: string[] = [];
  for await (const [n, h] of rec.entries())
    if (h.kind === 'file' && n.startsWith('autosave-')) names.push(n);
  names.sort();
  for (const old of names.slice(0, Math.max(0, names.length - MAX_RECOVERY_SNAPSHOTS))) {
    await rec.removeEntry(old).catch(() => {});
  }
}

/** Newest valid autosave snapshot, if any. */
export async function latestRecovery(
  dir: FileSystemDirectoryHandle,
): Promise<RecoverySnapshot | null> {
  let rec: FileSystemDirectoryHandle;
  try {
    rec = await dir.getDirectoryHandle(RECOVERY_DIR);
  } catch {
    return null;
  }
  const files: { name: string; savedAt: number }[] = [];
  for await (const [n, h] of rec.entries()) {
    const m = /^autosave-(\d+)-r\d+\.json$/.exec(n);
    if (h.kind === 'file' && m) files.push({ name: n, savedAt: Number(m[1]) });
  }
  files.sort((a, b) => b.savedAt - a.savedAt);
  for (const f of files) {
    const text = await readTextFile(rec, f.name);
    if (!text) continue;
    try {
      return { ...f, project: parseProjectDocument(text) };
    } catch {
      continue;
    }
  }
  return null;
}

export async function clearRecovery(dir: FileSystemDirectoryHandle): Promise<void> {
  try {
    const rec = await dir.getDirectoryHandle(RECOVERY_DIR);
    for await (const [n] of rec.entries()) await rec.removeEntry(n).catch(() => {});
  } catch {
    /* no recovery dir */
  }
}

/** Path of `handle` relative to `dir`, if it lives inside it. */
export async function relativePathOf(
  dir: FileSystemDirectoryHandle,
  handle: FileSystemFileHandle,
): Promise<string | null> {
  const parts = await dir.resolve(handle);
  return parts ? parts.join('/') : null;
}

export async function fileByRelativePath(
  dir: FileSystemDirectoryHandle,
  path: string,
): Promise<FileSystemFileHandle | null> {
  const parts = path.split('/').filter(Boolean);
  if (parts.some((p) => p === '..' || p === '.')) return null;
  try {
    let cur = dir;
    for (const p of parts.slice(0, -1)) cur = await cur.getDirectoryHandle(p);
    return await cur.getFileHandle(parts.at(-1)!);
  } catch {
    return null;
  }
}

export const MEDIA_ACCEPT: FilePickerAcceptType[] = [
  {
    description: 'Video, audio and images',
    accept: {
      'video/*': ['.mp4', '.mov', '.m4v', '.webm', '.mkv'],
      'audio/*': ['.mp3', '.m4a', '.aac', '.wav', '.ogg', '.opus', '.flac'],
      'image/*': ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'],
    },
  },
];

export async function pickMediaFiles(): Promise<FileSystemFileHandle[]> {
  try {
    return await window.showOpenFilePicker({
      multiple: true,
      types: MEDIA_ACCEPT,
      id: 'viditor-media',
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return [];
    throw e;
  }
}

export async function pickDirectory(): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await window.showDirectoryPicker({ mode: 'readwrite', id: 'viditor-project' });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return null;
    throw e;
  }
}
