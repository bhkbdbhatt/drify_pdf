import { Fragment, useState } from "react";
import type { FieldDriftOut, RunOut } from "../api/types";
import { formatConsistency, formatValue } from "../api/client";
import StatusBadge from "./StatusBadge";

function num(value: unknown): string {
  return typeof value === "number" ? value.toLocaleString() : String(value ?? "—");
}

function valueCounts(
  field: FieldDriftOut,
  runs: RunOut[]
): { value: unknown; count: number }[] {
  const map = new Map<string, { value: unknown; count: number }>();
  for (const run of runs) {
    const value = run.parsed_json?.[field.field_name];
    if (value === undefined || value === null) continue;
    const key = JSON.stringify(value);
    const entry = map.get(key);
    if (entry) entry.count += 1;
    else map.set(key, { value, count: 1 });
  }
  if (map.size > 0) return [...map.values()];
  return field.unique_values.map((value) => ({ value, count: 0 }));
}

function NumericDetail({ field }: { field: FieldDriftOut }) {
  const items = [
    ["mean", field.detail.mean],
    ["std", field.detail.std],
    ["min", field.detail.min],
    ["max", field.detail.max],
    ["n", field.detail.count],
  ] as const;
  return (
    <div className="flex flex-wrap gap-x-8 gap-y-2">
      {items.map(([key, value]) => (
        <div key={key}>
          <div className="text-[10px] uppercase tracking-wide text-slate-500">
            {key}
          </div>
          <div className="font-mono text-sm text-slate-200">{num(value)}</div>
        </div>
      ))}
    </div>
  );
}

function StringDetail({ field, runs }: { field: FieldDriftOut; runs: RunOut[] }) {
  const counts = valueCounts(field, runs);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {counts.map((entry, index) => (
          <span
            key={index}
            className="inline-flex items-center gap-1.5 rounded border border-slate-700 bg-slate-900/70 px-2 py-1 font-mono text-xs text-slate-300"
            title={formatValue(entry.value, 500)}
          >
            {formatValue(entry.value)}
            <span className="rounded bg-slate-700/70 px-1 text-[10px] text-slate-400">
              ×{entry.count}
            </span>
          </span>
        ))}
      </div>
      {typeof field.detail.avg_normalized_edit_distance === "number" && (
        <div className="text-xs text-slate-400">
          avg edit distance{" "}
          <span className="font-mono text-slate-300">
            {field.detail.avg_normalized_edit_distance}
          </span>{" "}
          · max{" "}
          <span className="font-mono text-slate-300">
            {field.detail.max_normalized_edit_distance}
          </span>
        </div>
      )}
      {typeof field.detail.min === "string" && field.field_type === "date" && (
        <div className="text-xs text-slate-400">
          range <span className="font-mono text-slate-300">{field.detail.min}</span>
          {" → "}
          <span className="font-mono text-slate-300">{field.detail.max}</span>
        </div>
      )}
    </div>
  );
}

function ArrayDetail({ field, runs }: { field: FieldDriftOut; runs: RunOut[] }) {
  const rows = runs
    .map((run, index) => ({
      index: index + 1,
      value: run.parsed_json?.[field.field_name],
    }))
    .filter((row): row is { index: number; value: unknown[] } =>
      Array.isArray(row.value)
    );

  if (rows.length === 0) {
    return <div className="text-xs text-slate-500">no array values captured</div>;
  }

  const base = rows[0].value;
  const baseKeys = new Set(base.map((element) => JSON.stringify(element)));

  const chip = (text: string, tone: "plain" | "added" | "removed") =>
    tone === "plain" ? (
      <span className="rounded bg-slate-700/50 px-1.5 py-0.5 font-mono text-xs text-slate-300">
        {text}
      </span>
    ) : tone === "added" ? (
      <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-mono text-xs text-emerald-300 ring-1 ring-inset ring-emerald-500/40">
        + {text}
      </span>
    ) : (
      <span className="rounded bg-red-500/10 px-1.5 py-0.5 font-mono text-xs text-red-400 line-through ring-1 ring-inset ring-red-500/30">
        − {text}
      </span>
    );

  return (
    <div className="space-y-1.5">
      {rows.map((row) => {
        const keys = new Set(
          row.value.map((element) => JSON.stringify(element))
        );
        const removed = base.filter(
          (element) => !keys.has(JSON.stringify(element))
        );
        return (
          <div key={row.index} className="flex flex-wrap items-center gap-1.5">
            <span className="w-12 shrink-0 text-[10px] uppercase text-slate-500">
              run {row.index}
            </span>
            {row.value.map((element, i) => {
              const isAdded = !baseKeys.has(JSON.stringify(element));
              return (
                <span key={i}>
                  {chip(
                    formatValue(element, 60),
                    isAdded ? "added" : "plain"
                  )}
                </span>
              );
            })}
            {removed.map((element, i) => (
              <span key={`r-${i}`}>
                {chip(formatValue(element, 60), "removed")}
              </span>
            ))}
          </div>
        );
      })}
      <div className="text-xs text-slate-500">
        run 1 is the baseline — <span className="text-emerald-400">+added</span>{" "}
        vs baseline, <span className="text-red-400">−removed</span> from baseline
      </div>
    </div>
  );
}

function DetailContent({ field, runs }: { field: FieldDriftOut; runs: RunOut[] }) {
  return (
    <div className="space-y-3 px-3 py-3">
      {field.field_type === "numeric" ? (
        <NumericDetail field={field} />
      ) : field.field_type === "array" ? (
        <ArrayDetail field={field} runs={runs} />
      ) : (
        <StringDetail field={field} runs={runs} />
      )}
      <div className="flex gap-4 border-t border-slate-800 pt-2 text-[11px] text-slate-500">
        <span>
          values seen:{" "}
          <span className="font-mono text-slate-400">{field.detail.value_count ?? "—"}</span>
        </span>
        <span>
          missing in{" "}
          <span className="font-mono text-slate-400">{field.detail.missing_count ?? 0}</span>{" "}
          run(s)
        </span>
        <span>
          unique: <span className="font-mono text-slate-400">{field.unique_values.length}</span>
        </span>
      </div>
    </div>
  );
}

export default function DriftTable({
  fields,
  runs,
}: {
  fields: FieldDriftOut[];
  runs: RunOut[];
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (fields.length === 0) {
    return (
      <div className="card px-4 py-8 text-center text-sm text-slate-500">
        No field drift data yet — the report is computed after all runs finish.
      </div>
    );
  }

  return (
    <div className="card overflow-x-auto">
      <table className="w-full min-w-[860px] border-collapse">
        <thead>
          <tr>
            <th className="th">Field</th>
            <th className="th">Type</th>
            <th className="th w-44">Consistency</th>
            <th className="th">Status</th>
            <th className="th text-right">Detail</th>
          </tr>
        </thead>
        <tbody>
          {fields.map((field) => {
            const open = expanded === field.id;
            return (
              <Fragment key={field.id}>
                <tr
                  className={`cursor-pointer transition hover:bg-slate-700/25 ${
                    open ? "bg-slate-700/20" : ""
                  }`}
                  onClick={() => setExpanded(open ? null : field.id)}
                >
                  <td className="td font-mono text-slate-200">
                    {field.field_name}
                  </td>
                  <td className="td">
                    <span className="rounded bg-slate-700/40 px-1.5 py-0.5 text-xs text-slate-400">
                      {field.field_type}
                    </span>
                  </td>
                  <td className="td">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-700/60">
                        <div
                          className={`h-full rounded-full ${
                            field.status === "stable"
                              ? "bg-emerald-500"
                              : field.status === "drift"
                                ? "bg-amber-500"
                                : "bg-red-500"
                          }`}
                          style={{
                            width: `${Math.round(field.consistency * 100)}%`,
                          }}
                        />
                      </div>
                      <span className="font-mono text-xs text-slate-300">
                        {formatConsistency(field.consistency)}
                      </span>
                    </div>
                  </td>
                  <td className="td">
                    <StatusBadge status={field.status} pulse={field.status === "unstable"} />
                  </td>
                  <td className="td text-right text-xs text-slate-500">
                    {open ? "hide ▲" : "show ▼"}
                  </td>
                </tr>
                {open && (
                  <tr className="bg-slate-900/40">
                    <td colSpan={5} className="border-b border-slate-800 p-0">
                      <DetailContent field={field} runs={runs} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
