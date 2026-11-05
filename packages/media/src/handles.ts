/// <reference types="wicg-file-system-access" />

/**
 * IndexedDB persistence for File System Access handles. Handles are structured-cloneable,
 * so the browser can remember which files/folders the user granted, across reloads.
 * (Permissions may still need to be re-confirmed by the user after a reload.)
 */

const DB_NAME = 'viditor';
const DB_VERSION = 1;
const MEDIA = 'mediaHandles';
const RECENT = 'recentProjects';

export interface RecentProject {
  projectId: string;
  name: string;
  dir: FileSystemDirectoryHandle;
  openedAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(MEDIA)) d.createObjectStore(MEDIA);
      if (!d.objectStoreNames.contains(RECENT))
        d.createObjectStore(RECENT, { keyPath: 'projectId' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const t = d.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

const mediaKey = (projectId: string, mediaId: string) => `${projectId}:${mediaId}`;

export function putMediaHandle(projectId: string, mediaId: string, handle: FileSystemFileHandle) {
  return tx(MEDIA, 'readwrite', (s) => s.put(handle, mediaKey(projectId, mediaId)));
}

export async function getMediaHandle(
  projectId: string,
  mediaId: string,
): Promise<FileSystemFileHandle | null> {
  return (
    ((await tx(MEDIA, 'readonly', (s) =>
      s.get(mediaKey(projectId, mediaId)),
    )) as FileSystemFileHandle) ?? null
  );
}

export function deleteMediaHandle(projectId: string, mediaId: string) {
  return tx(MEDIA, 'readwrite', (s) => s.delete(mediaKey(projectId, mediaId)));
}

export function putRecentProject(p: RecentProject) {
  return tx(RECENT, 'readwrite', (s) => s.put(p));
}

export async function listRecentProjects(): Promise<RecentProject[]> {
  const all = (await tx(RECENT, 'readonly', (s) => s.getAll())) as RecentProject[];
  return all.sort((a, b) => b.openedAt - a.openedAt);
}

export function removeRecentProject(projectId: string) {
  return tx(RECENT, 'readwrite', (s) => s.delete(projectId));
}
