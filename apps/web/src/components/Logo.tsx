export function Logo({ small }: { small?: boolean }) {
  const s = small ? 22 : 30;
  return (
    <div className="flex items-center gap-2">
      <svg width={s} height={s} viewBox="0 0 32 32" aria-hidden>
        <rect width="32" height="32" rx="8" fill="var(--vd-accent)" />
        <path
          d="M9 9l7 14 7-14"
          fill="none"
          stroke="#fff"
          strokeWidth="3.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className={small ? 'text-sm font-semibold' : 'text-lg font-bold tracking-tight'}>
        Viditor
      </span>
    </div>
  );
}
