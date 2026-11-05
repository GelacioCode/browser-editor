import { useEffect, useState } from 'react';
import { FolderOpen, FolderPlus, Clock, ShieldCheck, Trash2 } from 'lucide-react';
import {
  listRecentProjects,
  pickDirectory,
  removeRecentProject,
  type RecentProject,
} from '@viditor/media';
import { createProjectInFolder, openProjectFolder } from '../state/project-io.ts';
import { toast } from '../state/store.ts';
import { Button, IconButton } from '../ui/ui.tsx';
import { Logo } from './Logo.tsx';
import { CheckList } from './Diagnostics.tsx';
import type { Check } from '../lib/capabilities.ts';

export function Welcome({ checks }: { checks: Check[] }) {
  const [recent, setRecent] = useState<RecentProject[]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const warnings = checks.filter((c) => !c.ok);

  useEffect(() => {
    listRecentProjects().then(setRecent, () => {});
  }, []);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error', 7000);
    } finally {
      setBusy(false);
    }
  };

  const open = (dir: FileSystemDirectoryHandle) =>
    run(async () => {
      await openProjectFolder(dir);
    });

  return (
    <div className="flex h-full items-center justify-center overflow-auto p-6">
      <div className="grid w-full max-w-3xl gap-6 md:grid-cols-[1.2fr_1fr]">
        <div className="rounded-lg border border-border bg-surface-1 p-6">
          <Logo />
          <p className="mt-3 text-sm text-muted">
            Edit video right in your browser. Import clips, arrange them on a timeline, add titles
            and captions, and export an MP4 — all on your own computer.
          </p>

          <div className="mt-6 space-y-2">
            <label className="block text-xs font-medium text-muted" htmlFor="pname">
              New project
            </label>
            <input
              id="pname"
              className="h-9 w-full rounded-md border border-border bg-surface-2 px-3 text-sm outline-none focus:border-accent"
              placeholder="Project name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
            />
            <Button
              variant="primary"
              className="w-full"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const dir = await pickDirectory();
                  if (dir) await createProjectInFolder(dir, name);
                })
              }
            >
              <FolderPlus size={15} /> Choose a folder & create project
            </Button>
            <p className="text-[11px] text-faint">
              Pick an empty folder. Viditor saves <code>project.json</code>, autosave snapshots and
              (optionally) exports there. Tip: keep your footage inside this folder so the project
              reopens without extra permission prompts.
            </p>
          </div>

          <div className="mt-5 border-t border-border pt-5">
            <Button
              className="w-full"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const dir = await pickDirectory();
                  if (dir) await open(dir);
                })
              }
            >
              <FolderOpen size={15} /> Open project folder
            </Button>
          </div>

          <div className="mt-5 flex items-start gap-2 rounded-md bg-surface-2 p-3 text-xs text-muted">
            <ShieldCheck size={16} className="mt-px shrink-0 text-success" />
            <span>
              Your footage never leaves this computer. Viditor reads files directly from disk and
              renders exports locally — nothing is uploaded to any server.
            </span>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-surface-1 p-4">
            <h2 className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-faint">
              <Clock size={13} /> Recent projects
            </h2>
            {recent.length === 0 ? (
              <p className="text-xs text-faint">No recent projects yet.</p>
            ) : (
              <ul className="space-y-1">
                {recent.slice(0, 8).map((r) => (
                  <li key={r.projectId} className="group flex items-center gap-1">
                    <button
                      disabled={busy}
                      onClick={() => open(r.dir)}
                      className="flex min-w-0 flex-1 flex-col items-start rounded-md px-2 py-1.5 text-left hover:bg-surface-3"
                    >
                      <span className="w-full truncate text-sm">{r.name}</span>
                      <span className="text-[11px] text-faint">
                        {r.dir.name} · {new Date(r.openedAt).toLocaleDateString()}
                      </span>
                    </button>
                    <IconButton
                      label="Remove from recent"
                      className="opacity-0 group-hover:opacity-100"
                      onClick={async () => {
                        await removeRecentProject(r.projectId);
                        setRecent((x) => x.filter((y) => y.projectId !== r.projectId));
                      }}
                    >
                      <Trash2 size={13} />
                    </IconButton>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {warnings.length > 0 && (
            <div className="rounded-lg border border-border bg-surface-1 p-4">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-faint">
                Browser notes
              </h2>
              <CheckList checks={warnings} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
