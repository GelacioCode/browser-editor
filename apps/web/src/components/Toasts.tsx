import { useEditor } from '../state/store.ts';
import { cx } from '../ui/ui.tsx';

export function Toasts() {
  const toasts = useEditor((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.kind === 'error' ? 'alert' : 'status'}
          className={cx(
            'max-w-md rounded-md border px-3 py-2 text-xs shadow-lg',
            t.kind === 'error' && 'border-danger/40 bg-[#2a1418] text-[#ffc2c8]',
            t.kind === 'success' && 'border-success/40 bg-[#112219] text-[#b6f3d6]',
            t.kind === 'info' && 'border-border-strong bg-surface-3 text-text',
          )}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
