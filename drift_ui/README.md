# Drift UI

React 18 + Vite + TypeScript dashboard for the PDF drift measurement backend
(`drift_backend/`). Dark, dense, Grafana/Linear-style — task list, live run
progress over WebSocket, per-field drift tables, raw run inspection, and
side-by-side task comparison with a parsing-vs-sampling diagnosis.

## Stack

- React 18, Vite 8, TypeScript (strict)
- Tailwind CSS 4 via `@tailwindcss/vite` (dark theme: slate-900 / slate-800,
  emerald/amber/red statuses)
- TanStack Query v5 for all HTTP (polling only while tasks are active)
- Recharts for the diagnosis stacked bar
- Native browser `WebSocket` for live progress

## Setup

```bash
cd drift_ui
npm install
npm run dev
```

Open http://localhost:5173 — the backend must be running:

```bash
cd drift_backend
uvicorn app.main:app --reload        # http://localhost:8000
```

### Configuration

Base URL comes from `.env`:

```dotenv
VITE_API_URL=http://localhost:8000   # default if unset
```

For production builds the variable is inlined at build time:

```bash
VITE_API_URL=https://api.example.com npm run build
```

WebSocket URLs are derived from the same value (`http…` → `ws…`).

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Vite dev server on :5173 |
| `npm run build` | Type-check (`tsc`) + production build to `dist/` |
| `npm run preview` | Serve the production build locally |

## Pages

- **`/` Dashboard** — all tasks with status badge, field count, worst field
  (red when `unstable`), created time. Rows navigate to the task; "New Task"
  opens the upload form.
- **`/tasks/new`** — PDF + optional parsed-input upload, name, mode radio
  (blackbox/parsed), model dropdown, temperature slider, run count, prompt
  textarea with **Load default prompt** (tries `GET /prompts/default`, falls
  back to a built-in Salesforce Quote extraction prompt), then `POST /tasks`
  and navigate to the task.
- **`/tasks/:id`** — header with live status, WebSocket progress bar + event
  log while running, the field drift table (expandable detail rows: numeric
  mean/std/min/max, string unique values with counts, array per-run diff),
  raw runs accordion with syntax-highlighted JSON, compare selector +
  side-by-side diff, and the diagnosis card.
- **`/compare`** — pick any two tasks and diff them.

## Diagnosis

`DiagnosisCard` splits drift between two tasks:

- **parsing** — cross-task disagreement: fields missing on one side, or large
  consistency gaps between A and B (different input representations of the
  same document).
- **sampling** — run-to-run variance inside each task (`1 − consistency`),
  i.e. temperature/model randomness.

Rendered as "72% of drift is parsing, 28% is sampling" plus a horizontal
stacked bar.

## Project structure

```
drift_ui/
├── index.html
├── package.json
├── vite.config.ts
├── tsconfig.json
├── tailwind.config.js         # loaded via `@config` from src/index.css
└── src/
    ├── main.tsx               # QueryClient + Router bootstrap
    ├── App.tsx                # routes + shell/nav
    ├── index.css              # `@import "tailwindcss"` + shared .card/.btn/.input
    ├── api/
    │   ├── client.ts          # fetch wrapper, endpoint helpers, formatting
    │   └── types.ts           # TS interfaces matching backend Pydantic models
    ├── hooks/
    │   ├── useTasks.ts        # React Query queries + mutations
    │   └── useTaskProgress.ts # WebSocket: { progress, log, connected }
    ├── components/
    │   ├── DriftTable.tsx
    │   ├── StatusBadge.tsx
    │   ├── ProgressBar.tsx
    │   ├── RawRunAccordion.tsx
    │   ├── ComparePanel.tsx
    │   ├── DiagnosisCard.tsx
    │   └── NewTaskForm.tsx
    └── pages/
        ├── Dashboard.tsx
        ├── TaskDetail.tsx
        └── Compare.tsx
```

## Notes

- **Toolchain:** Tailwind 4 is wired through the `@tailwindcss/vite` plugin in
  `vite.config.ts` (no `postcss.config.js`); `src/index.css` starts with
  `@import "tailwindcss"` and loads the legacy `tailwind.config.js` via
  `@config`. The Tailwind important modifier is trailing in v4: `px-3!`, not
  `!px-3`.

- Queries poll (`useTasks` 3s / `useTask` 2s) only while a task is
  `pending`/`running`; the WebSocket keeps live progress instant and
  invalidates the cache on `report_ready` / `failed`.
- The WS hook reconnects every 2s if the socket drops.
- Tables scroll horizontally on mobile (`overflow-x-auto`, `min-w-*`).
