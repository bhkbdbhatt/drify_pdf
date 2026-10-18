import type { CompareResult, CompareSide, CompareVerdict } from "../api/types";
import { formatConsistency, formatValue } from "../api/client";
import StatusBadge from "./StatusBadge";

function ValueCell({ side }: { side: CompareSide | null }) {
  if (!side) {
    return <span className="text-xs italic text-slate-600">missing</span>;
  }
  return (
    <div className="min-w-0 space-y-1">
      <div className="truncate font-mono text-xs text-slate-200" title={formatValue(side.unique_values, 500)}>
        {side.unique_values.length > 0
          ? formatValue(side.unique_values[0])
          : "—"}
      </div>
      <div className="flex items-center gap-1.5">
        <StatusBadge status={side.status} />
        <span className="font-mono text-[10px] text-slate-500">
          {formatConsistency(side.consistency)}
        </span>
        {side.unique_values.length > 1 && (
          <span className="text-[10px] text-slate-500">
            +{side.unique_values.length - 1} more
          </span>
        )}
      </div>
    </div>
  );
}

const VERDICT_LABEL: Record<CompareVerdict, string> = {
  match: "match",
  similar: "similar",
  diverges: "diverges",
  missing_in_a: "missing in A",
  missing_in_b: "missing in B",
};

export default function ComparePanel({
  compare,
}: {
  compare: CompareResult | undefined;
}) {
  if (!compare) {
    return (
      <div className="card px-4 py-8 text-center text-sm text-slate-500">
        Select a second task to see the side-by-side diff.
      </div>
    );
  }

  const diverging = compare.fields.filter(
    (field) => field.verdict !== "match"
  ).length;

  return (
    <div className="card overflow-x-auto">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-4 py-3">
        <div className="text-sm font-medium text-slate-200">
          {compare.a_name}
          <span className="mx-2 text-slate-600">vs</span>
          {compare.b_name}
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span className="rounded bg-slate-700/50 px-1.5 py-0.5 font-mono">
            A = {compare.a_mode}
          </span>
          <span className="rounded bg-slate-700/50 px-1.5 py-0.5 font-mono">
            B = {compare.b_mode}
          </span>
          <span>
            {diverging}/{compare.fields.length} fields differ
          </span>
        </div>
      </div>

      <table className="w-full min-w-[760px] border-collapse">
        <thead>
          <tr>
            <th className="th">Field</th>
            <th className="th">A value</th>
            <th className="th">B value</th>
            <th className="th">Match?</th>
            <th className="th">Δ consistency</th>
          </tr>
        </thead>
        <tbody>
          {compare.fields.map((field) => (
            <tr key={field.field_name} className="transition hover:bg-slate-700/20">
              <td className="td font-mono text-slate-200">{field.field_name}</td>
              <td className="td max-w-[260px]">
                <ValueCell side={field.a} />
              </td>
              <td className="td max-w-[260px]">
                <ValueCell side={field.b} />
              </td>
              <td className="td">
                <StatusBadge status={field.verdict} label={VERDICT_LABEL[field.verdict]} />
              </td>
              <td className="td font-mono text-xs">
                {field.consistency_gap === null ? (
                  <span className="text-slate-600">—</span>
                ) : (
                  <span
                    className={
                      field.consistency_gap > 0.3
                        ? "text-red-400"
                        : field.consistency_gap > 0.1
                          ? "text-amber-300"
                          : "text-slate-400"
                    }
                  >
                    {field.consistency_gap.toFixed(2)}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
