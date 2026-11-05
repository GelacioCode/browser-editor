import { CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import type { Check } from '../lib/capabilities.ts';
import { Logo } from './Logo.tsx';

export function CheckList({ checks }: { checks: Check[] }) {
  return (
    <ul className="space-y-1.5">
      {checks.map((c) => (
        <li key={c.id} className="flex items-start gap-2 text-xs">
          {c.ok ? (
            <CheckCircle2 size={14} className="mt-px shrink-0 text-success" />
          ) : c.required ? (
            <XCircle size={14} className="mt-px shrink-0 text-danger" />
          ) : (
            <AlertTriangle size={14} className="mt-px shrink-0 text-warning" />
          )}
          <div>
            <div className="text-text">{c.label}</div>
            {!c.ok && <div className="text-muted">{c.detail}</div>}
            {c.ok && c.id === 'quota' && <div className="text-muted">{c.detail}</div>}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function Unsupported({ checks }: { checks: Check[] }) {
  return (
    <div className="flex h-full items-center justify-center overflow-auto p-6">
      <div className="w-full max-w-md rounded-lg border border-border bg-surface-1 p-6">
        <Logo />
        <h1 className="mt-5 text-lg font-semibold">This browser can't run Viditor yet</h1>
        <p className="mt-2 text-sm text-muted">
          Viditor edits video entirely on your computer, which needs a few modern browser features.
          Please open it in a current desktop version of{' '}
          <strong className="text-text">Google Chrome</strong> or{' '}
          <strong className="text-text">Microsoft Edge</strong>.
        </p>
        <div className="mt-5">
          <CheckList checks={checks} />
        </div>
      </div>
    </div>
  );
}
