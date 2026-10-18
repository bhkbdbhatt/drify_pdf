import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  createTask,
  deleteTask,
  getCompare,
  getReport,
  getTask,
  listTasks,
} from "../api/client";
import type { CompareResult, DriftReport, TaskDetail, TaskSummary } from "../api/types";

export function useTasks() {
  return useQuery<TaskSummary[], Error>({
    queryKey: ["tasks"],
    queryFn: listTasks,
    refetchInterval: (query) => {
      const tasks = query.state.data;
      const active = tasks?.some(
        (t) => t.status === "running" || t.status === "pending"
      );
      return active ? 3_000 : false;
    },
  });
}

export function useTask(id: string | undefined) {
  return useQuery<TaskDetail, Error>({
    queryKey: ["task", id],
    queryFn: () => getTask(id!),
    enabled: Boolean(id),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "running" || status === "pending" ? 2_000 : false;
    },
  });
}

export function useReport(id: string | undefined, enabled = true) {
  return useQuery<DriftReport, Error>({
    queryKey: ["report", id],
    queryFn: () => getReport(id!),
    enabled: Boolean(id) && enabled,
    retry: false,
  });
}

export function useCompare(
  idA: string | undefined,
  idB: string | undefined
) {
  return useQuery<CompareResult, Error>({
    queryKey: ["compare", idA, idB],
    queryFn: () => getCompare(idA!, idB!),
    enabled: Boolean(idA) && Boolean(idB) && idA !== idB,
    retry: false,
  });
}

export function useCreateTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (form: FormData) => createTask(form),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}

export function useDeleteTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteTask(id),
    onSuccess: (_data, id) => {
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
      void queryClient.removeQueries({ queryKey: ["task", id] });
      void queryClient.removeQueries({ queryKey: ["report", id] });
    },
  });
}
