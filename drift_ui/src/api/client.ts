import type {
  CompareResult,
  DriftReport,
  FieldDriftOut,
  RunOut,
  TaskCreated,
  TaskDetail,
  TaskSummary,
} from "./types";

const RAW_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8000";
const BASE = RAW_BASE.replace(/\/+$/, "");

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export function apiUrl(path: string): string {
  return `${BASE}${path}`;
}

export function wsUrl(path: string): string {
  const wsBase = BASE.replace(/^http/, "ws");
  return `${wsBase}${path}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(path), init);
  if (!response.ok) {
    let detail = response.statusText || `HTTP ${response.status}`;
    try {
      const body = (await response.json()) as { detail?: unknown };
      if (typeof body.detail === "string") {
        detail = body.detail;
      } else if (body.detail) {
        detail = JSON.stringify(body.detail);
      }
    } catch {
      // non-JSON error body — keep statusText
    }
    throw new ApiError(detail, response.status);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export const api = {
  get: <T>(path: string): Promise<T> => request<T>(path),

  postForm: <T>(path: string, body: FormData): Promise<T> =>
    request<T>(path, { method: "POST", body }),

  postJson: <T>(path: string, body: unknown): Promise<T> =>
    request<T>(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),

  delete: <T>(path: string): Promise<T> =>
    request<T>(path, { method: "DELETE" }),
};

/* ---------------- endpoint helpers ---------------- */

export const listTasks = () => api.get<TaskSummary[]>("/tasks");

export const getTask = (id: string) => api.get<TaskDetail>(`/tasks/${id}`);

export const getReport = (id: string) =>
  api.get<DriftReport>(`/tasks/${id}/report`);

export const getCompare = (id: string, otherId: string) =>
  api.get<CompareResult>(
    `/tasks/${id}/compare?other_task_id=${encodeURIComponent(otherId)}`
  );

export const deleteTask = (id: string) =>
  api.delete<void>(`/tasks/${id}`);

export const createTask = (form: FormData) =>
  api.postForm<TaskCreated>("/tasks", form);

export const getRuns = async (id: string): Promise<RunOut[]> => {
  const detail = await getTask(id);
  return detail.runs;
};

export const getFieldDrifts = async (id: string): Promise<FieldDriftOut[]> => {
  const detail = await getTask(id);
  return detail.fields;
};

/* ---------------- default prompt ---------------- */

export const SALESFORCE_QUOTE_PROMPT = `Extract the following fields from this Salesforce Quote PDF. Respond with a single JSON object and nothing else.

Required fields:
- "quote_number": the quote identifier (string)
- "account_name": the account/customer name (string)
- "quote_date": the quote date in YYYY-MM-DD (string)
- "expiration_date": the expiration date in YYYY-MM-DD (string)
- "currency": the ISO currency code or symbol (string)
- "total_amount": the grand total before tax (number)
- "subtotal": the net amount before tax (number)
- "tax_amount": the total tax (number)
- "discount_percent": the overall discount percentage (number)
- "line_items": array of objects with "product_name", "quantity", "unit_price", "total_price"
- "billing_country": the billing country (string)
- "payment_terms": payment terms string (string)

Rules:
- Use null for fields that are not present in the document.
- Numbers must be plain JSON numbers without commas or currency symbols.
- Dates must be ISO 8601 (YYYY-MM-DD).
- Do not invent values; do not include commentary.`;

/**
 * Fetch the default extraction prompt. The backend may expose
 * GET /prompts/default; if it does not, the built-in Salesforce Quote
 * prompt is used so the button always works.
 */
export async function getDefaultPrompt(): Promise<string> {
  try {
    const body = await api.get<{ prompt_text: string }>("/prompts/default");
    if (body.prompt_text && body.prompt_text.trim()) {
      return body.prompt_text;
    }
  } catch {
    // endpoint not available — fall through to the built-in prompt
  }
  return SALESFORCE_QUOTE_PROMPT;
}

/* ---------------- formatting helpers ---------------- */

export function formatValue(value: unknown, maxLen = 140): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") {
    return value.length > maxLen ? `${value.slice(0, maxLen)}…` : value;
  }
  const text = JSON.stringify(value);
  return text.length > maxLen ? `${text.slice(0, maxLen)}…` : text;
}

export function formatConsistency(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}

export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function shortHash(hash: string): string {
  return hash.slice(0, 12);
}
