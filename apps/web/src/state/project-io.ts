import {
  ProjectEngine,
  createProject,
  newId,
  usToSeconds,
  type MediaItem,
  type Project,
} from '@viditor/project-core';
import {
  MediaAnalyzer,
  UnsupportedMediaError,
  clearRecovery,
  ensurePermission,
  ensureProjectDirs,
  fileByRelativePath,
  getMediaHandle,
  hasProjectFile,
  latestRecovery,
  loadProject,
  pickMediaFiles,
  probeFile,
  putMediaHandle,
  putRecentProject,
  relativePathOf,
  saveProject,
  writeRecoverySnapshot,
  type RecoverySnapshot,
} from '@viditor/media';
import {
  attachEngine,
  detachEngine,
  onProjectChange,
  toast,
  updateMedia,
  useEditor,
  type MediaRuntime,
} from './store.ts';

const analyzer = new MediaAnalyzer();
const get = useEditor.getState;

/* -------------------------------------------------------------------------------------------- */
/* Autosave                                                                                      */
/* -------------------------------------------------------------------------------------------- */

const RECOVERY_DEBOUNCE_MS = 1000;
const AUTOSAVE_DEBOUNCE_MS = 3000;
let recoveryTimer: ReturnType<typeof setTimeout> | undefined;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let saving: Promise<void> | null = null;

onProjectChange((_project, kind) => {
  if (kind === 'load') return;
  clearTimeout(recoveryTimer);
  recoveryTimer = setTimeout(() => {
    const { dir, project } = get();
    if (dir && project)
      writeRecoverySnapshot(dir, project).catch((e) => console.warn('Recovery snapshot failed', e));
  }, RECOVERY_DEBOUNCE_MS);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void saveNow(), AUTOSAVE_DEBOUNCE_MS);
});

export async function saveNow(): Promise<void> {
  clearTimeout(saveTimer);
  if (saving) await saving;
  const { dir, project } = get();
  if (!dir || !project) return;
  useEditor.setState({ saveState: 'saving' });
  saving = (async () => {
    try {
      await saveProject(dir, project);
      // Only mark saved if nothing changed while we were writing.
      if (get().project === project)
        useEditor.setState({ saveState: 'saved', lastSavedAt: Date.now() });
      else useEditor.setState({ saveState: 'dirty' });
      await putRecentProject({
        projectId: project.projectId,
        name: project.name,
        dir,
        openedAt: Date.now(),
      });
    } catch (e) {
      console.error(e);
      useEditor.setState({ saveState: 'error' });
      toast(`Save failed: ${e instanceof Error ? e.message : String(e)}`, 'error', 8000);
    } finally {
      saving = null;
    }
  })();
  await saving;
}

window.addEventListener('beforeunload', (e) => {
  const s = get().saveState;
  if (s === 'dirty' || s === 'saving') {
    e.preventDefault();
  }
});

/* -------------------------------------------------------------------------------------------- */
/* Open / create                                                                                 */
/* -------------------------------------------------------------------------------------------- */

export interface OpenResult {
  recovery: RecoverySnapshot | null;
}

export async function createProjectInFolder(
  dir: FileSystemDirectoryHandle,
  name: string,
): Promise<void> {
  if (!(await ensurePermission(dir, 'readwrite', true)))
    throw new Error('Permission to the folder was denied');
  if (await hasProjectFile(dir)) {
    throw new Error('That folder already contains a Viditor project. Use "Open project" instead.');
  }
  const project = createProject({ name: name.trim() || dir.name || 'Untitled project' });
  await ensureProjectDirs(dir);
  await saveProject(dir, project);
  await openEngine(project, dir);
}

/** Open a project folder. Returns a recovery snapshot if unsaved autosave data is newer. */
export async function openProjectFolder(dir: FileSystemDirectoryHandle): Promise<OpenResult> {
  if (!(await ensurePermission(dir, 'readwrite', true)))
    throw new Error('Permission to the folder was denied');
  const project = await loadProject(dir);
  await ensureProjectDirs(dir);
  const snap = await latestRecovery(dir);
  const recovery =
    snap && snap.project.projectId === project.projectId && snap.project.revision > project.revision
      ? snap
      : null;
  await openEngine(project, dir);
  useEditor.setState({ recovery });
  return { recovery };
}

async function openEngine(project: Project, dir: FileSystemDirectoryHandle) {
  detachEngine();
  const engine = new ProjectEngine(project);
  attachEngine(engine, dir);
  await putRecentProject({
    projectId: project.projectId,
    name: project.name,
    dir,
    openedAt: Date.now(),
  });
  await resolveAllMedia(false);
}

export async function applyRecovery(snap: RecoverySnapshot) {
  const { engine, dir } = get();
  if (!engine || !dir) return;
  engine.load(snap.project);
  useEditor.setState({ saveState: 'dirty' });
  await resolveAllMedia(false);
  await saveNow();
  await clearRecovery(dir);
  toast('Recovered unsaved changes', 'success');
}

export async function discardRecovery() {
  const dir = get().dir;
  if (dir) await clearRecovery(dir);
}

export async function closeProject() {
  if (get().saveState === 'dirty') await saveNow();
  detachEngine();
}

/* -------------------------------------------------------------------------------------------- */
/* Media resolution                                                                              */
/* -------------------------------------------------------------------------------------------- */

async function activate(m: MediaItem, handle: FileSystemFileHandle | undefined, file: File) {
  const prev = get().media[m.id];
  if (prev?.url) URL.revokeObjectURL(prev.url);
  updateMedia(m.id, {
    status: 'ready',
    file,
    handle,
    url: URL.createObjectURL(file),
    error: undefined,
  });
  runAnalysis(m, file);
}

function runAnalysis(m: MediaItem, file: File) {
  if (get().media[m.id]?.thumbs) return;
  updateMedia(m.id, { analyzing: true });
  analyzer
    .analyze(file, m.kind)
    .then((r) => {
      const thumbs = r.thumbs.map((t) => ({ time: t.time, url: URL.createObjectURL(t.blob) }));
      updateMedia(m.id, {
        analyzing: false,
        thumbs,
        thumbWidth: r.thumbWidth,
        thumbHeight: r.thumbHeight,
        peaks: r.peaks ?? undefined,
        peaksPerSecond: r.peaksPerSecond,
      });
    })
    .catch((e) => {
      console.warn('Analysis failed', m.id, e);
      updateMedia(m.id, { analyzing: false });
    });
}

/**
 * Find each media file: first via the project folder (relative path), then via the remembered
 * file handle. `request` = may show permission prompts (needs a user gesture).
 */
export async function resolveAllMedia(request: boolean) {
  const { project, dir } = get();
  if (!project || !dir) return;
  await Promise.all(project.media.map((m) => resolveMedia(project, dir, m, request)));
}

async function resolveMedia(
  project: Project,
  dir: FileSystemDirectoryHandle,
  m: MediaItem,
  request: boolean,
) {
  const cur = get().media[m.id];
  if (cur?.status === 'ready') return;
  updateMedia(m.id, { status: 'loading' });

  if (m.relativePath) {
    const fh = await fileByRelativePath(dir, m.relativePath);
    if (fh) {
      try {
        const file = await fh.getFile();
        if (file.size === m.sizeBytes) return activate(m, fh, file);
      } catch {
        /* fall through */
      }
    }
  }

  const handle = await getMediaHandle(project.projectId, m.id).catch(() => null);
  if (!handle) return updateMedia(m.id, { status: 'offline' });
  if (!(await ensurePermission(handle, 'read', request))) {
    return updateMedia(m.id, { status: 'needs-permission', handle });
  }
  try {
    const file = await handle.getFile();
    await activate(m, handle, file);
  } catch {
    updateMedia(m.id, { status: 'offline', handle });
  }
}

/** Must be called from a click handler (permission prompts need a user gesture). */
export async function grantMediaAccess() {
  await resolveAllMedia(true);
  const pending = Object.values(get().media).filter((m) => m.status === 'needs-permission').length;
  if (pending) toast(`${pending} file(s) still need permission`, 'error');
}

/* -------------------------------------------------------------------------------------------- */
/* Import                                                                                        */
/* -------------------------------------------------------------------------------------------- */

const KIND_LABEL = { video: 'Video', image: 'Image', audio: 'Audio' } as const;

export async function importHandles(handles: FileSystemFileHandle[]): Promise<string[]> {
  const { project, dir, engine } = get();
  if (!project || !dir || !engine || handles.length === 0) return [];
  const imported: string[] = [];
  const counts = { video: 0, image: 0, audio: 0 };
  for (const m of project.media) counts[m.kind]++;

  for (const handle of handles) {
    let file: File;
    try {
      file = await handle.getFile();
    } catch {
      toast(`Could not read ${handle.name}`, 'error');
      continue;
    }
    const dupe = engine.project.media.find(
      (m) =>
        m.name === file.name && m.sizeBytes === file.size && m.lastModified === file.lastModified,
    );
    if (dupe) {
      toast(`${file.name} is already in this project`);
      continue;
    }
    try {
      const probe = await probeFile(file);
      const id = newId('m');
      counts[probe.kind]++;
      const media: MediaItem = {
        ...probe,
        id,
        label: `${KIND_LABEL[probe.kind]} ${counts[probe.kind]}`,
        relativePath: await relativePathOf(dir, handle).catch(() => null),
      };
      const r = engine.apply({ ops: [{ type: 'addMedia', media }], label: `Import ${file.name}` });
      if (!r.ok) {
        toast(r.error.message, 'error');
        continue;
      }
      await putMediaHandle(project.projectId, id, handle);
      await activate(media, handle, file);
      imported.push(id);
    } catch (e) {
      const msg =
        e instanceof UnsupportedMediaError
          ? e.message
          : `${file.name}: ${e instanceof Error ? e.message : e}`;
      toast(msg, 'error', 7000);
    }
  }
  if (imported.length)
    toast(`Imported ${imported.length} file${imported.length > 1 ? 's' : ''}`, 'success');
  return imported;
}

export async function importViaPicker(): Promise<string[]> {
  return importHandles(await pickMediaFiles());
}

/** Drag-and-drop from the OS: get real file handles so the project can reopen them later. */
export async function importDataTransfer(dt: DataTransfer): Promise<string[]> {
  const handles: FileSystemFileHandle[] = [];
  const items = [...dt.items].filter((i) => i.kind === 'file');
  const results = await Promise.all(items.map((i) => i.getAsFileSystemHandle?.()));
  for (const h of results) if (h && h.kind === 'file') handles.push(h as FileSystemFileHandle);
  if (handles.length === 0 && dt.files.length) {
    toast(
      'This browser cannot keep access to dropped files. Use the Import button instead.',
      'error',
    );
  }
  return importHandles(handles);
}

/** Point an offline media item at a new file. */
export async function relinkMedia(mediaId: string) {
  const { project, dir, engine } = get();
  const m = project?.media.find((x) => x.id === mediaId);
  if (!project || !dir || !engine || !m) return;
  let handle: FileSystemFileHandle | undefined;
  try {
    [handle] = await window.showOpenFilePicker({ multiple: false, id: 'viditor-media' });
  } catch {
    return;
  }
  if (!handle) return;
  const file = await handle.getFile();
  try {
    const probe = await probeFile(file);
    if (probe.kind !== m.kind) {
      toast(`Expected a${m.kind === 'image' ? 'n' : ''} ${m.kind} file`, 'error');
      return;
    }
    if (m.kind !== 'image' && Math.abs(probe.durationUs - m.durationUs) > 500_000) {
      toast(
        `Duration differs (${usToSeconds(probe.durationUs).toFixed(1)}s vs ${usToSeconds(m.durationUs).toFixed(1)}s). Linked anyway — check your edits.`,
        'info',
        7000,
      );
    }
    engine.apply({
      label: 'Relink media',
      ops: [
        {
          type: 'updateMedia',
          mediaId,
          patch: {
            name: probe.name,
            sizeBytes: probe.sizeBytes,
            lastModified: probe.lastModified,
            durationUs: probe.durationUs,
            relativePath: await relativePathOf(dir, handle).catch(() => null),
          },
        },
      ],
    });
    await putMediaHandle(project.projectId, mediaId, handle);
    updateMedia(mediaId, { thumbs: undefined, peaks: undefined } as Partial<MediaRuntime>);
    await activate(
      { ...m, ...probe, id: m.id, label: m.label, relativePath: m.relativePath },
      handle,
      file,
    );
    toast(`Relinked ${file.name}`, 'success');
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), 'error');
  }
}

/** mediaId → File for every media item that is currently available. */
export function availableFiles(): Map<string, File> {
  const out = new Map<string, File>();
  for (const [id, m] of Object.entries(get().media))
    if (m.status === 'ready' && m.file) out.set(id, m.file);
  return out;
}
