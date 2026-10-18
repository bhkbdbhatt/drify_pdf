import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { CompareResult } from "../api/types";

export interface Diagnosis {
  parsingPct: number;
  samplingPct: number;
  parsing: number;
  sampling: number;
}

/**
 * Split total drift between two tasks into:
 *  - parsing:  cross-task disagreement (fields present on one side only, or
 *              large consistency gaps between A and B) — caused by feeding
 *              the model different representations of the same document
 *  - sampling: run-to-run variance inside each task (1 - consistency) —
 *              caused by temperature / model randomness
 */
export function diagnose(compare: CompareResult): Diagnosis | null {
  let parsing = 0;
  let sampling = 0;

  for (const field of compare.fields) {
    if (!field.a || !field.b) {
      parsing += 1;
      continue;
    }
    const ca = field.a.consistency;
    const cb = field.b.consistency;
    parsing += Math.abs(ca - cb);
    sampling += (1 - ca + (1 - cb)) / 2;
  }

  const total = parsing + sampling;
  if (total <= 0.001) return null;

  const parsingPct = Math.round((parsing / total) * 100);
  return {
    parsing,
    sampling,
    parsingPct,
    samplingPct: 100 - parsingPct,
  };
}

const PARSING_COLOR = "#a78bfa"; // violet-400
const SAMPLING_COLOR = "#38bdf8"; // sky-400

export default function DiagnosisCard({
  compare,
}: {
  compare: CompareResult | undefined;
}) {
  if (!compare) {
    return (
      <div className="card px-4 py-6 text-sm text-slate-500">
        Diagnosis appears once two tasks are compared on the same document.
      </div>
    );
  }

  const result = diagnose(compare);

  if (!result) {
    return (
      <div className="card px-4 py-6">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Diagnosis
        </div>
        <p className="mt-2 text-sm text-slate-400">
          No measurable drift between these tasks — both are fully consistent.
        </p>
      </div>
    );
  }

  const chartData = [{ name: "drift", parsing: result.parsingPct, sampling: result.samplingPct }];

  return (
    <div className="card px-4 py-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        Diagnosis
      </div>
      <p className="mt-2 text-sm text-slate-200">
        <span className="font-semibold text-violet-300">
          {result.parsingPct}% of drift is parsing
        </span>
        ,{" "}
        <span className="font-semibold text-sky-300">
          {result.samplingPct}% is sampling
        </span>
        .
      </p>

      <div className="mt-3 h-16 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            layout="vertical"
            margin={{ top: 4, right: 8, bottom: 4, left: 8 }}
            barCategoryGap={14}
          >
            <XAxis type="number" domain={[0, 100]} hide />
            <YAxis type="category" dataKey="name" hide />
            <Tooltip
              cursor={{ fill: "rgba(148, 163, 184, 0.08)" }}
              contentStyle={{
                backgroundColor: "#0f172a",
                border: "1px solid #334155",
                borderRadius: 8,
                fontSize: 12,
              }}
              formatter={(value: number, name: string) => [
                `${value}%`,
                name === "parsing" ? "parsing" : "sampling",
              ]}
            />
            <Bar dataKey="parsing" stackId="drift" radius={[0, 0, 0, 0]}>
              {chartData.map((_, index) => (
                <Cell key={index} fill={PARSING_COLOR} />
              ))}
            </Bar>
            <Bar dataKey="sampling" stackId="drift" radius={[4, 4, 4, 4]}>
              {chartData.map((_, index) => (
                <Cell key={index} fill={SAMPLING_COLOR} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-1 flex items-center gap-4 text-[11px] text-slate-400">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: PARSING_COLOR }} />
          parsing — cross-task disagreement (input representation)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: SAMPLING_COLOR }} />
          sampling — run-to-run variance (temperature)
        </span>
      </div>
    </div>
  );
}
