import { useEffect, useMemo, useState } from "react";
import { useCompare, useTasks } from "../hooks/useTasks";
import ComparePanel from "../components/ComparePanel";
import DiagnosisCard from "../components/DiagnosisCard";

function TaskSelect({
  label,
  value,
  onChange,
  tasks,
  exclude,
}: {
  label: string;
  value: string;
  onChange: (id: string) => void;
  tasks: { id: string; name: string; mode: string; status: string }[];
  exclude?: string;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <select
        className="input"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">— select task —</option>
        {tasks
          .filter((task) => task.id !== exclude)
          .map((task) => (
            <option key={task.id} value={task.id}>
              {task.name} · {task.mode} · {task.status}
            </option>
          ))}
      </select>
    </div>
  );
}

export default function Compare() {
  const { data: tasks, isLoading, error } = useTasks();
  const [taskA, setTaskA] = useState("");
  const [taskB, setTaskB] = useState("");

  useEffect(() => {
    if (!taskA && tasks && tasks.length > 0) setTaskA(tasks[0].id);
    if (!taskB && tasks && tasks.length > 1) setTaskB(tasks[1].id);
  }, [tasks, taskA, taskB]);

  const list = useMemo(() => tasks ?? [], [tasks]);
  const { data: compare, isFetching } = useCompare(
    taskA || undefined,
    taskB || undefined
  );

  const ready = Boolean(taskA && taskB && taskA !== taskB);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-white">Compare tasks</h1>
        <p className="text-sm text-slate-500">
          Side-by-side field diff between two runs — e.g. blackbox vs parsed
          mode on the same document.
        </p>
      </div>

      <div className="card grid gap-4 p-4 sm:grid-cols-2">
        <TaskSelect
          label="Task A"
          value={taskA}
          onChange={setTaskA}
          tasks={list}
          exclude={taskB || undefined}
        />
        <TaskSelect
          label="Task B"
          value={taskB}
          onChange={setTaskB}
          tasks={list}
          exclude={taskA || undefined}
        />
      </div>

      {error && (
        <div className="rounded-md border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300">
          {error.message}
        </div>
      )}

      {!ready && (
        <div className="card px-4 py-10 text-center text-sm text-slate-500">
          Select two different tasks to compare.
        </div>
      )}

      {ready && isLoading && (
        <div className="card animate-pulse px-4 py-10 text-center text-sm text-slate-500">
          Loading tasks…
        </div>
      )}

      {ready && !isLoading && isFetching && !compare && (
        <div className="card animate-pulse px-4 py-10 text-center text-sm text-slate-500">
          Comparing…
        </div>
      )}

      {ready && compare && (
        <div className="grid gap-4 lg:grid-cols-2">
          <ComparePanel compare={compare} />
          <DiagnosisCard compare={compare} />
        </div>
      )}
    </div>
  );
}
