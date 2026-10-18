import { Link, useNavigate } from "react-router-dom";
import { useTasks } from "../hooks/useTasks";
import { formatConsistency, formatDate } from "../api/client";
import type { TaskSummary } from "../api/types";
import StatusBadge from "../components/StatusBadge";

function SkeletonRows() {
  return (
    <>
      {[...Array(6)].map((_, index) => (
        <tr key={index} className="animate-pulse">
          <td className="td">
            <div className="h-4 w-40 rounded bg-slate-700/60" />
          </td>
          <td className="td">
            <div className="h-4 w-24 rounded bg-slate-700/60" />
          </td>
          <td className="td">
            <div className="h-4 w-16 rounded bg-slate-700/60" />
          </td>
          <td className="td">
            <div className="h-4 w-20 rounded bg-slate-700/60" />
          </td>
          <td className="td">
            <div className="h-4 w-28 rounded bg-slate-700/60" />
          </td>
          <td className="td">
            <div className="h-4 w-28 rounded bg-slate-700/60" />
          </td>
        </tr>
      ))}
    </>
  );
}

function WorstFieldCell({ task }: { task: TaskSummary }) {
  const worst = task.worst_field;
  if (!worst) {
    return <span className="text-xs text-slate-600">—</span>;
  }
  const critical = worst.status === "unstable";
  return (
    <span
      className={`inline-flex items-center gap-2 font-mono text-xs ${
        critical ? "font-medium text-red-400" : "text-slate-400"
      }`}
    >
      {critical && <span className="h-1.5 w-1.5 rounded-full bg-red-500" />}
      {worst.field_name}
      <span className="text-slate-600">·</span>
      <span className={critical ? "text-red-400/80" : "text-slate-500"}>
        {formatConsistency(worst.consistency)}
      </span>
    </span>
  );
}

export default function Dashboard() {
  const { data: tasks, isLoading, error } = useTasks();
  const navigate = useNavigate();

  const running = tasks?.filter(
    (task) => task.status === "running" || task.status === "pending"
  ).length;

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-white">Tasks</h1>
          <p className="text-sm text-slate-500">
            {tasks
              ? `${tasks.length} task${tasks.length === 1 ? "" : "s"}` +
                (running ? ` · ${running} active` : "")
              : "Loading…"}
          </p>
        </div>
        <Link to="/tasks/new" className="btn-primary">
          + New Task
        </Link>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300">
          Failed to load tasks: {error.message}
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[880px] border-collapse">
          <thead>
            <tr>
              <th className="th">Name</th>
              <th className="th">Model</th>
              <th className="th">Mode</th>
              <th className="th">Status</th>
              <th className="th">Fields</th>
              <th className="th">Worst field</th>
              <th className="th">Created</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <SkeletonRows />}
            {!isLoading && tasks?.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center">
                  <p className="text-sm text-slate-400">No tasks yet.</p>
                  <p className="mt-1 text-xs text-slate-600">
                    Create your first drift task to see results here.
                  </p>
                  <Link to="/tasks/new" className="btn-primary mt-4 inline-flex">
                    + New Task
                  </Link>
                </td>
              </tr>
            )}
            {tasks?.map((task) => (
              <tr
                key={task.id}
                className="cursor-pointer transition hover:bg-slate-700/25"
                onClick={() => navigate(`/tasks/${task.id}`)}
              >
                <td className="td font-medium text-slate-100">{task.name}</td>
                <td className="td font-mono text-xs text-slate-400">
                  {task.model}
                </td>
                <td className="td">
                  <span className="rounded bg-slate-700/40 px-1.5 py-0.5 text-xs text-slate-400">
                    {task.mode}
                  </span>
                </td>
                <td className="td">
                  <StatusBadge
                    status={task.status}
                    pulse={task.status === "running"}
                    label={
                      task.status === "running"
                        ? `${task.completed_runs}/${task.num_runs} runs`
                        : task.status
                    }
                  />
                </td>
                <td className="td font-mono text-xs text-slate-400">
                  {task.field_count > 0 ? task.field_count : "—"}
                  {task.num_runs > 0 && task.completed_runs > 0 && (
                    <span className="ml-2 text-slate-600">
                      {task.completed_runs}/{task.num_runs} runs
                    </span>
                  )}
                </td>
                <td className="td">
                  <WorstFieldCell task={task} />
                </td>
                <td className="td text-xs text-slate-500">
                  {formatDate(task.created_at)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
