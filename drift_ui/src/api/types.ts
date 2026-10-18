export type TaskStatus = "pending" | "running" | "complete" | "failed";
export type FieldStatus = "stable" | "drift" | "unstable";
export type FieldType = "str" | "numeric" | "date" | "array";
export type Mode = "blackbox" | "parsed";
export type CompareVerdict =
  | "match"
  | "similar"
  | "diverges"
  | "missing_in_a"
  | "missing_in_b";

export interface TaskCreated {
  task_id: string;
  status: TaskStatus;
}

export interface WorstField {
  field_name: string;
  consistency: number;
  status: FieldStatus;
}

export interface TaskSummary {
  id: string;
  name: string;
  status: TaskStatus;
  model: string;
  temperature: number;
  mode: Mode;
  num_runs: number;
  created_at: string;
  completed_runs: number;
  field_count: number;
  worst_field: WorstField | null;
}

export interface RunOut {
  id: string;
  input_hash: string;
  model: string;
  temperature: number;
  mode: Mode;
  raw_response: string;
  parsed_json: Record<string, unknown> | null;
  parse_success: boolean;
  created_at: string;
}

export interface FieldDriftOut {
  id: string;
  field_name: string;
  field_type: FieldType;
  unique_values: unknown[];
  consistency: number;
  status: FieldStatus;
  detail: Record<string, number | string>;
}

export interface TaskDetail {
  id: string;
  name: string;
  pdf_path: string;
  parsed_input_path: string | null;
  prompt_text: string;
  model: string;
  temperature: number;
  mode: Mode;
  num_runs: number;
  status: TaskStatus;
  created_at: string;
  runs: RunOut[];
  fields: FieldDriftOut[];
  worst_field: WorstField | null;
}

export interface ReportField {
  field_name: string;
  field_type: FieldType;
  unique_values: unknown[];
  consistency: number;
  status: FieldStatus;
  detail: Record<string, number | string>;
}

export interface ReportSummary {
  total_fields: number;
  stable: number;
  drift: number;
  unstable: number;
  worst_field: string | null;
  worst_consistency: number | null;
}

export interface DriftReport {
  task_id: string;
  task_name: string;
  model: string;
  temperature: number;
  mode: Mode;
  num_runs: number;
  parse_success_rate: number;
  fields: ReportField[];
  summary: ReportSummary;
}

export interface CompareSide {
  consistency: number;
  status: FieldStatus;
  field_type: FieldType;
  unique_values: unknown[];
  detail: Record<string, number | string>;
}

export interface CompareField {
  field_name: string;
  verdict: CompareVerdict;
  consistency_gap: number | null;
  a: CompareSide | null;
  b: CompareSide | null;
}

export interface CompareResult {
  a_task_id: string;
  b_task_id: string;
  a_name: string;
  b_name: string;
  a_mode: Mode;
  b_mode: Mode;
  fields: CompareField[];
}

/** Any message pushed by WS /ws/{task_id}. */
export interface WsMessage {
  event:
    | "status"
    | "not_found"
    | "started"
    | "run_complete"
    | "parsing_done"
    | "report_ready"
    | "failed";
  task_id?: string;
  status?: TaskStatus;
  completed_runs?: number;
  total_runs?: number;
  field_count?: number;
  completed?: number;
  parse_success?: boolean;
  parsed_runs?: number;
  error?: string;
}

export interface TaskProgress {
  status: TaskStatus | "unknown";
  completedRuns: number;
  totalRuns: number;
  fieldCount: number;
  running: boolean;
}
