import type { RecoverySnapshot } from '@viditor/media';
import { applyRecovery, discardRecovery } from '../state/project-io.ts';
import { Button, Dialog } from '../ui/ui.tsx';

export function RecoveryDialog({
  snapshot,
  onDone,
}: {
  snapshot: RecoverySnapshot;
  onDone: () => void;
}) {
  return (
    <Dialog
      title="Recover unsaved changes?"
      onClose={onDone}
      footer={
        <>
          <Button
            variant="ghost"
            onClick={async () => {
              await discardRecovery();
              onDone();
            }}
          >
            Discard
          </Button>
          <Button
            variant="primary"
            onClick={async () => {
              await applyRecovery(snapshot);
              onDone();
            }}
          >
            Recover
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted">
        Viditor found an autosave from{' '}
        <strong className="text-text">{new Date(snapshot.savedAt).toLocaleString()}</strong> that is
        newer than the saved project. This usually means the tab closed before the last save
        finished.
      </p>
      <p className="mt-2 text-xs text-faint">
        The saved project.json has not been changed. Choosing Recover replaces the open project with
        the autosave and saves it.
      </p>
    </Dialog>
  );
}
