import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useCompare, useDeleteTask, useTask, useTasks } from "../hooks/useTasks";
import { useTaskProgress } from "../hooks/useTaskProgress";
import { formatDate } from "../api/client";
import type { FieldDriftOut } from "../api/types";
import StatusBadge from "../components/StatusBadge";
import ProgressBar from "../components/ProgressBar";
import DriftTable from "../components/DriftTable";
import RawRunAccordion from "../components/RawRunAccordion";
import ComparePanel from "../components/ComparePanel";
import DiagnosisCard from "../components/DiagnosisCard";

function StatCounts({ fields }: { fields: FieldDriftOut[] }) {
  const counts = useMemo(() => {
    const acc = { stable: 0, drift: 0, unstable: 0 };
    for (const field of fields) acc[field.status] += 1;
    return acc;
  }, [fields]);

  if (fields.length === 0) return null;

  const items = [
    ["stable", counts.stable, "text-emerald-300"],
    ["drift", counts.drift, "text-amber-300"],
    ["unstable", counts.unstable, "text-red-400"],
  ] as const;

  return (
    <div className="flex gap-5">
      {items.map(([label, count, color]) => (
        <div key={label}>
          <div className={`text-lg font-semibold leading-none ${color}`}>
            {count}
          </div>
          <div className="mt-0.5 text-[10px] uppercase tracking-wide text-slate-500">
            {label}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function TaskDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: task, isLoading, error, refetch } = useTask(id);
  const { data: tasks } = useTasks();
  const { progress, log, connected } = useTaskProgress(id);
  const deleteTask = useDeleteTask();

  const others = useMemo(
    () => (tasks ?? []).filter((candidate) => candidate.id !== id),
    [tasks, id]
  );

  const [otherTaskId, setOtherTaskId] = useState("");
  useEffect(() => {
    if (!otherTaskId && others.length > 0) {
      setOtherTaskId(others[0].id);
    }
  }, [others, otherTaskId]);

  const { data: compare } = useCompare(id, otherTaskId || undefined);

  if (isLoading) {
    return (
      <div className="card animate-pulse px-4 py-16 text-center text-sm text-slate-500">
        Loading task…
      </div>
    );
  }

  if (error || !task) {
    return (
      <div className="card px-4 py-10 text-center">
        <p className="text-sm text-red-400">
          {error?.message ?? "Task not found."}
        </p>
        <div className="mt-4 flex justify-center gap-3">
          <button className="btn-ghost" onClick={() => void refetch()}>
            Retry
          </button>
          <button className="btn-primary" onClick={() => navigate("/")}>
            ← Dashboard
          </button>
        </div>
      </div>
    );
  }

  const isActive = task.status === "running" || task.status === "pending";
  const completedRuns = isActive
    ? Math.max(progress.completedRuns, task.runs.length)
    : task.runs.length;

  const onDelete = () => {
    if (!window.confirm(`Delete task "${task.name}" and all its runs?`)) return;
    deleteTask.mutate(task.id, { onSuccess: () => navigate("/") });
  };

  return (
    <div className="space-y-5">
      {/* header */}
      <div className="card px-4 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="truncate text-lg font-semibold text-white">
                {task.name}
              </h1>
              <StatusBadge
                status={task.status}
                pulse={task.status === "running"}
              />
              {connected && isActive && (
                <span className="text-[11px] text-slate-500">live</span>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 font-mono text-xs text-slate-500">
              <span>
                <span className="text-slate-600">model </span>
                {task.model}
              </span>
              <span>
                <span className="text-slate-600">temp </span>
                {task.temperature}
              </span>
              <span>
                <span className="text-slate-600">mode </span>
                {task.mode}
              </span>
              <span>
                <span className="text-slate-600">runs </span>
                {task.num_runs}
              </span>
              <span>
                <span className="text-slate-600">created </span>
                {formatDate(task.created_at)}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <StatCounts fields={task.fields} />
            <button
              className="btn-danger"
              onClick={onDelete}
              disabled={deleteTask.isPending}
            >
              {deleteTask.isPending ? "Deleting…" : "Delete"}
            </button>
          </div>
        </div>

        {isActive && (
          <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_320px]">
            <ProgressBar
              completed={completedRuns}
              total={task.num_runs}
              running={task.status === "running"}
              label={
                task.status === "pending" ? "Waiting to start" : "Running"
              }
            />
            <div className="max-h-24 overflow-y-auto rounded-md border border-slate-800 bg-slate-950/60 px-3 py-2 font-mono text-[11px] leading-relaxed text-slate-400">
              {log.length === 0 ? (
                <span className="text-slate-600">waiting for events…</span>
              ) : (
                log.slice(-6).map((line, index) => (
                  <div key={index}>{line}</div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* field drift table */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            Field drift
          </h2>
          <span className="text-xs text-slate-600">
            click a row to expand detail
          </span>
        </div>
        <DriftTable fields={task.fields} runs={task.runs} />
      </section>

      {/* compare + diagnosis */}
      <section>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            Compare
          </h2>
          {others.length > 0 ? (
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-500" htmlFor="other-task">
                against
              </label>
              <select
                id="other-task"
                className="input w-auto! py-1.5! text-xs"
                value={otherTaskId}
                onChange={(event) => setOtherTaskId(event.target.value)}
              >
                {others.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name} ({candidate.mode}, {candidate.status})
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <span className="text-xs text-slate-600">
              no other task to compare with
            </span>
          )}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <ComparePanel compare={compare} />
          <DiagnosisCard compare={compare} />
        </div>
      </section>

      {/* raw runs */}
      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">
          Raw runs
        </h2>
        <RawRunAccordion runs={task.runs} />
      </section>
    </div>
  );
}
