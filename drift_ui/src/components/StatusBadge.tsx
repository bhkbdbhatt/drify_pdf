import type { TaskStatus, FieldStatus, CompareVerdict } from "../api/types";

type AnyStatus = TaskStatus | FieldStatus | CompareVerdict;

const STYLES: Record<AnyStatus, string> = {
  pending: "bg-slate-500/15 text-slate-300 ring-slate-500/40",
  running: "bg-sky-500/15 text-sky-300 ring-sky-500/40",
  complete: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/40",
  failed: "bg-red-500/15 text-red-400 ring-red-500/40",
  stable: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/40",
  drift: "bg-amber-500/15 text-amber-300 ring-amber-500/40",
  unstable: "bg-red-500/15 text-red-400 ring-red-500/40",
  match: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/40",
  similar: "bg-amber-500/15 text-amber-300 ring-amber-500/40",
  diverges: "bg-red-500/15 text-red-400 ring-red-500/40",
  missing_in_a: "bg-slate-500/15 text-slate-400 ring-slate-500/40",
  missing_in_b: "bg-slate-500/15 text-slate-400 ring-slate-500/40",
};

const LABELS: Partial<Record<AnyStatus, string>> = {};

export default function StatusBadge({
  status,
  label,
  pulse = false,
}: {
  status: AnyStatus;
  label?: string;
  pulse?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
        STYLES[status] ?? STYLES.pending
      }`}
    >
      {pulse && (
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-75" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
        </span>
      )}
      {label ?? LABELS[status] ?? status}
    </span>
  );
}
