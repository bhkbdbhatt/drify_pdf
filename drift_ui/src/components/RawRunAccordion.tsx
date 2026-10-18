import { useState } from "react";
import type { RunOut } from "../api/types";
import { formatDate, shortHash } from "../api/client";
import StatusBadge from "./StatusBadge";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Tiny JSON highlighter: keys, strings, numbers, literals, punctuation. */
function highlightJson(raw: string): string {
  let pretty = raw;
  try {
    pretty = JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    // not valid JSON — highlight the raw text anyway
  }
  const escaped = escapeHtml(pretty);
  return escaped
    .replace(
      /(&quot;|")((?:\\.|[^"\\])*?)\1(\s*:)/g,
      '<span class="text-sky-300">"$2"</span>$3'
    )
    .replace(
      /:\s*(&quot;|")((?:\\.|[^"\\])*?)\1/g,
      ': <span class="text-amber-200">"$2"</span>'
    )
    .replace(
      /:\s*(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
      ': <span class="text-violet-300">$1</span>'
    )
    .replace(
      /\b(true|false|null)\b/g,
      '<span class="text-rose-300">$1</span>'
    );
}

function RunBody({ run }: { run: RunOut }) {
  const html = highlightJson(run.raw_response);
  return (
    <div className="space-y-3 px-4 py-3">
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-4">
        <div>
          <span className="text-slate-500">model </span>
          <span className="font-mono text-slate-300">{run.model}</span>
        </div>
        <div>
          <span className="text-slate-500">temp </span>
          <span className="font-mono text-slate-300">{run.temperature}</span>
        </div>
        <div>
          <span className="text-slate-500">input </span>
          <span className="font-mono text-slate-400">{shortHash(run.input_hash)}</span>
        </div>
        <div>
          <span className="text-slate-500">at </span>
          <span className="font-mono text-slate-400">{formatDate(run.created_at)}</span>
        </div>
      </div>
      <pre
        className="max-h-96 overflow-auto rounded-md border border-slate-700/60 bg-slate-950/70 p-3 font-mono text-xs leading-relaxed text-slate-300"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {run.parsed_json && (
        <div className="text-xs text-slate-500">
          parsed object:{" "}
          <span className="font-mono text-slate-400">
            {Object.keys(run.parsed_json).length} keys
          </span>
        </div>
      )}
    </div>
  );
}

export default function RawRunAccordion({
  runs,
}: {
  runs: RunOut[];
}) {
  const [openRun, setOpenRun] = useState<string | null>(null);

  if (runs.length === 0) {
    return (
      <div className="card px-4 py-8 text-center text-sm text-slate-500">
        No runs recorded yet.
      </div>
    );
  }

  const successCount = runs.filter((run) => run.parse_success).length;

  return (
    <div className="card divide-y divide-slate-800">
      <div className="flex items-center justify-between px-4 py-2.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Raw runs
        </span>
        <span className="text-xs text-slate-500">
          {successCount}/{runs.length} parsed
        </span>
      </div>
      {runs.map((run, index) => {
        const open = openRun === run.id;
        return (
          <div key={run.id}>
            <button
              type="button"
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-slate-700/20"
              onClick={() => setOpenRun(open ? null : run.id)}
            >
              <span className="w-16 shrink-0 text-xs font-medium text-slate-400">
                run {index + 1}
              </span>
              <StatusBadge
                status={run.parse_success ? "complete" : "failed"}
                label={run.parse_success ? "parsed" : "parse failed"}
              />
              <span className="hidden font-mono text-xs text-slate-500 sm:inline">
                {shortHash(run.input_hash)}…
              </span>
              <span className="ml-auto font-mono text-xs text-slate-500">
                {formatDate(run.created_at)}
              </span>
              <span className="w-4 text-right text-xs text-slate-500">
                {open ? "▲" : "▼"}
              </span>
            </button>
            {open && <RunBody run={run} />}
          </div>
        );
      })}
    </div>
  );
}
