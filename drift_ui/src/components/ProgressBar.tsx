export default function ProgressBar({
  completed,
  total,
  running,
  label,
}: {
  completed: number;
  total: number;
  running: boolean;
  label?: string;
}) {
  const safeTotal = Math.max(total, completed, 1);
  const pct = Math.round((completed / safeTotal) * 100);

  return (
    <div className="w-full">
      <div className="mb-1.5 flex items-baseline justify-between text-xs">
        <span className="text-slate-400">
          {label ?? (running ? "Running" : "Progress")}
        </span>
        <span className="font-mono text-slate-300">
          run {completed}/{total} · {pct}%
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-700/60">
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            running
              ? "bg-sky-500"
              : completed >= total && total > 0
                ? "bg-emerald-500"
                : "bg-slate-500"
          }`}
          style={{ width: `${pct}%` }}
        >
          {running && (
            <div className="h-full w-full animate-pulse bg-gradient-to-r from-transparent via-white/25 to-transparent" />
          )}
        </div>
      </div>
    </div>
  );
}
