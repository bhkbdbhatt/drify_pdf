import { useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError, getDefaultPrompt } from "../api/client";
import { useCreateTask } from "../hooks/useTasks";
import type { Mode } from "../api/types";

const MODELS = [
  { value: "gpt-4o", label: "gpt-4o — OpenAI flagship" },
  { value: "gpt-4o-mini", label: "gpt-4o-mini — OpenAI fast/cheap" },
  { value: "gpt-4.1", label: "gpt-4.1 — OpenAI long context" },
  { value: "gpt-4.1-mini", label: "gpt-4.1-mini — OpenAI efficient" },
  { value: "claude-sonnet-4", label: "claude-sonnet-4 — Anthropic balanced" },
  { value: "claude-opus-4", label: "claude-opus-4 — Anthropic strongest" },
  { value: "claude-3-5-haiku-latest", label: "claude-3-5-haiku — Anthropic fast" },
];

export default function NewTaskForm() {
  const navigate = useNavigate();
  const createTask = useCreateTask();

  const [name, setName] = useState("");
  const [mode, setMode] = useState<Mode>("blackbox");
  const [model, setModel] = useState(MODELS[0].value);
  const [temperature, setTemperature] = useState(0.7);
  const [numRuns, setNumRuns] = useState(5);
  const [promptText, setPromptText] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [promptLoading, setPromptLoading] = useState(false);

  const pdfRef = useRef<HTMLInputElement>(null);
  const parsedRef = useRef<HTMLInputElement>(null);

  const loadDefaultPrompt = async () => {
    setPromptLoading(true);
    try {
      setPromptText(await getDefaultPrompt());
    } finally {
      setPromptLoading(false);
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);

    const pdf = pdfRef.current?.files?.[0];
    const parsed = parsedRef.current?.files?.[0];

    if (!name.trim()) return setFormError("Task name is required.");
    if (!promptText.trim()) return setFormError("Prompt is required.");
    if (!pdf) return setFormError("A PDF upload is required.");
    if (mode === "parsed" && !parsed)
      return setFormError("A parsed input file is required for parsed mode.");
    if (numRuns < 1 || numRuns > 50)
      return setFormError("num_runs must be between 1 and 50.");

    const form = new FormData();
    form.set("name", name.trim());
    form.set("prompt_text", promptText.trim());
    form.set("model", model);
    form.set("temperature", String(temperature));
    form.set("mode", mode);
    form.set("num_runs", String(numRuns));
    if (pdf) form.set("pdf", pdf);
    if (parsed) form.set("parsed_input", parsed);

    createTask.mutate(form, {
      onSuccess: (result) => navigate(`/tasks/${result.task_id}`),
      onError: (error) =>
        setFormError(
          error instanceof ApiError ? error.message : "Failed to create task."
        ),
    });
  };

  const errorMessage =
    formError ?? (createTask.error instanceof ApiError
      ? createTask.error.message
      : createTask.error
        ? createTask.error.message
        : null);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-white">New drift task</h1>
          <p className="text-sm text-slate-500">
            Upload a PDF, pick a model, run it N times and measure field drift.
          </p>
        </div>
        <button type="button" className="btn-ghost" onClick={() => navigate(-1)}>
          ← Back
        </button>
      </div>

      <form onSubmit={onSubmit} className="card space-y-5 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label" htmlFor="task-name">
              Task name
            </label>
            <input
              id="task-name"
              className="input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="salesforce-quote-drift"
              required
            />
          </div>

          <div>
            <span className="label">Mode</span>
            <div className="flex gap-4 rounded-md border border-slate-700 px-3 py-2.5">
              {(["blackbox", "parsed"] as const).map((value) => (
                <label
                  key={value}
                  className="flex cursor-pointer items-center gap-2 text-sm text-slate-300"
                >
                  <input
                    type="radio"
                    name="mode"
                    value={value}
                    checked={mode === value}
                    onChange={() => setMode(value)}
                    className="accent-sky-500"
                  />
                  {value}
                </label>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-slate-500">
              {mode === "blackbox"
                ? "Raw PDF text is sent to the model."
                : "The parsed input file is sent instead of PDF text."}
            </p>
          </div>

          <div>
            <label className="label" htmlFor="model">
              Model
            </label>
            <select
              id="model"
              className="input"
              value={model}
              onChange={(event) => setModel(event.target.value)}
            >
              {MODELS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label" htmlFor="temperature">
              Temperature — <span className="font-mono text-slate-300">{temperature.toFixed(1)}</span>
            </label>
            <input
              id="temperature"
              type="range"
              min={0}
              max={1}
              step={0.1}
              value={temperature}
              onChange={(event) => setTemperature(Number(event.target.value))}
              className="w-full accent-sky-500"
            />
            <div className="flex justify-between text-[10px] text-slate-600">
              <span>0 deterministic</span>
              <span>1 creative</span>
            </div>
          </div>

          <div>
            <label className="label" htmlFor="num-runs">
              Runs
            </label>
            <input
              id="num-runs"
              type="number"
              min={1}
              max={50}
              className="input"
              value={numRuns}
              onChange={(event) => setNumRuns(Number(event.target.value))}
            />
            <p className="mt-1 text-[11px] text-slate-500">
              Sequential LLM calls with a small delay between them.
            </p>
          </div>

          <div>
            <label className="label" htmlFor="pdf">
              PDF file <span className="text-red-400">*</span>
            </label>
            <input
              id="pdf"
              ref={pdfRef}
              type="file"
              accept=".pdf,application/pdf"
              className="input py-1.5! file:mr-3 file:rounded file:border-0 file:bg-slate-700 file:px-2 file:py-1 file:text-xs file:text-slate-300"
            />
            <p className="mt-1 text-[11px] text-slate-500">
              Always required — the source document for the run.
            </p>
          </div>

          <div>
            <label className="label" htmlFor="parsed-input">
              Parsed input (text/JSON){" "}
              {mode === "parsed" && <span className="text-red-400">*</span>}
            </label>
            <input
              id="parsed-input"
              ref={parsedRef}
              type="file"
              accept=".json,.txt,.md,application/json,text/plain"
              className="input py-1.5! file:mr-3 file:rounded file:border-0 file:bg-slate-700 file:px-2 file:py-1 file:text-xs file:text-slate-300"
            />
          </div>

          <div className="sm:col-span-2">
            <div className="flex items-center justify-between">
              <label className="label mb-1!" htmlFor="prompt">
                Prompt
              </label>
              <button
                type="button"
                className="btn-ghost px-2! py-1! text-xs"
                onClick={() => void loadDefaultPrompt()}
                disabled={promptLoading}
              >
                {promptLoading ? "Loading…" : "Load default prompt"}
              </button>
            </div>
            <textarea
              id="prompt"
              className="input min-h-[180px] font-mono text-xs leading-relaxed"
              value={promptText}
              onChange={(event) => setPromptText(event.target.value)}
              placeholder="Extract the following fields from this Salesforce Quote PDF…"
              required
            />
          </div>
        </div>

        {errorMessage && (
          <div className="rounded-md border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300">
            {errorMessage}
          </div>
        )}

        <div className="flex items-center justify-end gap-3 border-t border-slate-800 pt-4">
          <button
            type="button"
            className="btn-ghost"
            onClick={() => navigate("/")}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="btn-primary"
            disabled={createTask.isPending}
          >
            {createTask.isPending ? "Creating…" : "Start run →"}
          </button>
        </div>
      </form>
    </div>
  );
}
