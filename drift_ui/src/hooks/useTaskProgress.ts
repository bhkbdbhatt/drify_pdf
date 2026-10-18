import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { wsUrl } from "../api/client";
import type { TaskProgress, WsMessage } from "../api/types";

const INITIAL_PROGRESS: TaskProgress = {
  status: "unknown",
  completedRuns: 0,
  totalRuns: 0,
  fieldCount: 0,
  running: false,
};

function formatLog(message: WsMessage): string {
  const time = new Date().toLocaleTimeString();
  switch (message.event) {
    case "status":
      return `[${time}] ${message.status} — ${message.completed_runs ?? 0}/${message.total_runs ?? 0} runs, ${message.field_count ?? 0} fields`;
    case "started":
      return `[${time}] started — ${message.total_runs ?? 0} runs queued`;
    case "run_complete":
      return `[${time}] run ${message.completed}/${message.total_runs} complete (${message.parse_success ? "parsed" : "parse failed"})`;
    case "parsing_done":
      return `[${time}] parsing done — ${message.parsed_runs}/${message.total_runs} responses parsed`;
    case "report_ready":
      return `[${time}] report ready — ${message.field_count ?? 0} fields measured`;
    case "failed":
      return `[${time}] failed — ${message.error ?? "unknown error"}`;
    case "not_found":
      return `[${time}] task not found`;
    default:
      return `[${time}] ${message.event}`;
  }
}

/**
 * Live progress for a task via WS /ws/{task_id}.
 * Reconnects with a 2s backoff while the component stays mounted.
 */
export function useTaskProgress(taskId: string | undefined) {
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<TaskProgress>(INITIAL_PROGRESS);
  const [log, setLog] = useState<string[]>([]);
  const [connected, setConnected] = useState(false);
  const invalidated = useRef(false);

  useEffect(() => {
    if (!taskId) return undefined;

    let socket: WebSocket | null = null;
    let disposed = false;
    let retryTimer: number | undefined;

    const handleMessage = (message: WsMessage) => {
      setLog((prev) => [...prev.slice(-79), formatLog(message)]);

      if (message.event === "status") {
        setProgress({
          status: message.status ?? "unknown",
          completedRuns: message.completed_runs ?? 0,
          totalRuns: message.total_runs ?? 0,
          fieldCount: message.field_count ?? 0,
          running: message.status === "running" || message.status === "pending",
        });
      } else if (message.event === "run_complete") {
        setProgress((prev) => ({
          ...prev,
          status: "running",
          completedRuns: message.completed ?? prev.completedRuns,
          totalRuns: message.total_runs ?? prev.totalRuns,
          running: true,
        }));
      } else if (message.event === "report_ready") {
        setProgress((prev) => ({
          ...prev,
          status: "complete",
          fieldCount: message.field_count ?? prev.fieldCount,
          running: false,
        }));
        if (!invalidated.current) {
          invalidated.current = true;
          void queryClient.invalidateQueries({ queryKey: ["task", taskId] });
          void queryClient.invalidateQueries({ queryKey: ["report", taskId] });
          void queryClient.invalidateQueries({ queryKey: ["tasks"] });
        }
      } else if (message.event === "failed") {
        setProgress((prev) => ({ ...prev, status: "failed", running: false }));
        if (!invalidated.current) {
          invalidated.current = true;
          void queryClient.invalidateQueries({ queryKey: ["task", taskId] });
          void queryClient.invalidateQueries({ queryKey: ["tasks"] });
        }
      }
    };

    const connect = () => {
      if (disposed) return;
      socket = new WebSocket(wsUrl(`/ws/${taskId}`));

      socket.onopen = () => setConnected(true);

      socket.onmessage = (event) => {
        try {
          handleMessage(JSON.parse(event.data as string) as WsMessage);
        } catch {
          // ignore malformed frames
        }
      };

      socket.onclose = () => {
        setConnected(false);
        if (!disposed) {
          retryTimer = window.setTimeout(connect, 2_000);
        }
      };

      socket.onerror = () => socket?.close();
    };

    connect();

    return () => {
      disposed = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      setConnected(false);
      socket?.close();
    };
  }, [taskId, queryClient]);

  return { progress, log, connected };
}
