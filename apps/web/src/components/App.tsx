import { useEffect, useState } from 'react';
import { useEditor } from '../state/store.ts';
import { runDiagnostics, type Check } from '../lib/capabilities.ts';
import { Welcome } from './Welcome.tsx';
import { Editor } from './Editor.tsx';
import { Unsupported } from './Diagnostics.tsx';
import { Toasts } from './Toasts.tsx';

export function App() {
  const hasProject = useEditor((s) => s.project !== null);
  const [checks, setChecks] = useState<Check[] | null>(null);

  useEffect(() => {
    runDiagnostics().then(setChecks, () => setChecks([]));
  }, []);

  if (!checks) {
    return (
      <div className="flex h-full items-center justify-center text-muted">
        Checking browser capabilities…
      </div>
    );
  }
  const blocking = checks.filter((c) => c.required && !c.ok);
  return (
    <>
      {blocking.length > 0 ? (
        <Unsupported checks={checks} />
      ) : hasProject ? (
        <Editor />
      ) : (
        <Welcome checks={checks} />
      )}
      <Toasts />
    </>
  );
}
