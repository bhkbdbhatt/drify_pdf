# High-Level Design (HLD) - Drift PDF

## 1. Overview

Drift PDF is a full-stack system for measuring **LLM output drift** - the consistency of JSON extraction from PDF documents across multiple runs. It provides a web-based interface to create drift evaluation tasks, execute multiple LLM calls, compute per-field consistency statistics, and visualize results with live WebSocket progress tracking.

## 2. Goals and Non-Goals

**Goals:**
- Measure consistency of LLM structured extraction from PDFs
- Support multiple LLM providers (OpenAI, Anthropic)
- Provide real-time progress feedback during long-running multi-run evaluations
- Enable comparison between different extraction runs/tasks
- Offer clear diagnosis of variance sources (parsing vs sampling)

**Non-Goals:**
- Training/fine-tuning models
- PDF OCR/vision-heavy preprocessing beyond text extraction
- Complex workflow orchestration beyond single task execution
- Production-grade authentication/authorization

## 3. System Context

```text
User (Browser) ---> React UI (drift_ui) ---> FastAPI (drift_backend) ---> LLM Providers (OpenAI/Anthropic)
                                                    |
                                                    +-- SQLite/Postgres (Storage)
                                                    +-- File System (Uploads)
```

## 4. High-Level Architecture

```mermaid
graph TB
    subgraph Client_Layer["Client Layer"]
        A[User Browser]
    end

    subgraph Frontend["Frontend (drift_ui)"]
        B[React 18 + Vite + TS]
        B1[Router: Dashboard / TaskDetail / Compare]
        B2[TanStack Query - Data Fetching]
        B3[useTaskProgress - WebSocket Hook]
        B4[Components: Tables / Forms / Charts]
        B --> B1
        B --> B2
        B --> B3
        B --> B4
    end

    subgraph Backend["Backend (drift_backend)"]
        C[FastAPI App]
        C1[Routes: /tasks REST]
        C2[Routes: /ws WebSocket]
        C3[Task Runner Service]
        C4[LLM Client Service]
        C5[Drift Engine Service]
        C6[DB Layer - SQLAlchemy 2.0]
        C7[Config - Pydantic Settings]
        C --> C1
        C --> C2
        C --> C3
        C --> C4
        C --> C5
        C --> C6
        C --> C7
    end

    subgraph External["External"]
        D[LLM Providers: OpenAI / Anthropic]
        E[File Storage: uploads/]
        F[(Database: SQLite / Postgres)]
    end

    A --> B
    B <-->|HTTP/REST| C1
    B <-->|WebSocket| C2
    C3 --> C4
    C3 --> C5
    C4 --> D
    C6 --> F
    C3 --> E
```

## 5. Component Overview

| Component | Responsibility |
| --- | --- |
| **Frontend (React)** | User interface, task creation/upload, progress display, drift visualization, comparison |
| **REST API** | Task CRUD, reporting, comparison endpoints, file uploads |
| **WebSocket Manager** | Real-time progress broadcasting (run completion, parsing, report ready, failures) |
| **Task Runner** | Background async orchestration of multi-run execution, lifecycle management, cancellation |
| **LLM Client** | Abstraction over providers, JSON enforcement, retry with exponential backoff, timeout handling |
| **Drift Engine** | Compute per-field statistics, detect types, consistency scoring, classification (stable/drift/unstable) |
| **Database Layer** | Persistence of tasks, runs, field drift results; migrations via Alembic |
| **File Storage** | Store uploaded PDFs and parsed inputs, cleanup on deletion |

## 6. Key Use Cases / Data Flows

### 6.1 Create and Execute Drift Task (Primary Flow)

```mermaid
sequenceDiagram
    participant U as User (UI)
    participant API as FastAPI /tasks
    participant Runner as Task Runner
    participant FS as File System
    participant DB as Database
    participant LLM as LLM Provider
    participant WS as WS Manager

    U->>API: POST /tasks (multipart: pdf, prompt, model, num_runs, mode)
    API->>FS: Save uploaded files (pdf_path, parsed_path)
    API->>DB: Create Task (status=pending)
    API->>Runner: spawn_task(task_id)
    API-->>U: 202 Accepted {task_id, status}

    Runner->>DB: Set status=running
    Runner->>WS: Broadcast "started"

    loop N runs (sequential)
        Runner->>LLM: complete_json(system, user, temperature)
        LLM-->>Runner: Raw response
        Runner->>Runner: Parse JSON (json_from_text)
        Runner->>DB: Store Run (raw_response, parsed_json, parse_success)
        Runner->>WS: Broadcast "run_complete" (completed, total, parse_success)
        Runner->>Runner: sleep(inter_run_delay)
    end

    Runner->>WS: Broadcast "parsing_done" (parsed_runs count)
    Runner->>Runner: Compute drift report (drift_engine)
    Runner->>DB: Store FieldDrift rows, set Task status=complete
    Runner->>WS: Broadcast "report_ready" (field_count)
```

### 6.2 Real-time Progress via WebSocket

```mermaid
sequenceDiagram
    participant UI as React UI
    participant WS as FastAPI WS (/ws/{id})
    participant Mgr as Connection Manager
    participant Runner as Task Runner

    UI->>WS: Connect WS ws://.../ws/{task_id}
    WS->>Mgr: Register connection (task_id, websocket)
    Mgr-->>UI: Send initial {event: status, status, ...}

    Note over Runner,Mgr: During execution
    Runner->>Mgr: broadcast(task_id, event)
    Mgr-->>UI: Push event to all subscribers
    UI->>UI: Update progress bar/log, invalidate queries on report_ready
```

### 6.3 Task Comparison Flow

```mermaid
sequenceDiagram
    participant U as User
    participant API as FastAPI
    participant DB as Database
    participant Engine as Drift Engine

    U->>API: GET /tasks/{a}/compare?other_task_id={b}
    API->>DB: Load Task A (with field_drifts)
    API->>DB: Load Task B (with field_drifts)
    API->>Engine: compare_reports(a_fields, b_fields)
    Engine-->>API: CompareResult (per-field verdicts, gaps)
    API-->>U: 200 OK with comparison
```

### 6.4 Drift Diagnosis (Frontend Concept)

```mermaid
graph LR
    A[Variance observed between tasks] --> B{Split into components}
    B -->|Cross-task disagreement, Missing fields, Large consistency gaps| C[Parsing Variance]
    B -->|Run-to-run within task, 1 - consistency| D[Sampling Variance]
    C & D --> E[DiagnosisCard visualization: Stacked bar + percentages]
```

## 7. Data Model (Conceptual)

Three core entities:

- **Task**: One drift evaluation job (PDF + prompt + params). Has multiple Runs and FieldDrifts
- **Run**: One LLM invocation result (raw response, parsed JSON if successful, parse success flag)
- **FieldDrift**: Aggregated per-field statistics computed across all successful parsed runs for a task

Relationships: Task 1:N Runs, Task 1:N FieldDrifts, cascaded deletes on removal.

See LLD for detailed schema with types.

## 8. Non-Functional Requirements

| Aspect | Requirement |
| --- | --- |
| **Scalability** | Single-node design; runs executed sequentially per task to respect rate limits. Connection manager tracks in-memory WS connections. |
| **Performance** | Polling only while active tasks; WS for live updates; TanStack Query caching/invalidation. |
| **Reliability** | Retry with exponential backoff for LLM calls; task cancellation on delete/shutdown; error handling with failed status and WS notifications. |
| **Extensibility** | Provider-agnostic LLMClient protocol; easy to add new providers. Drift engine pluggable per field type. |
| **Security** | No secrets logged; uploaded files isolated per task; CORS configurable. API keys read from env. |
| **Data Integrity** | Cascading deletes, FK constraints, JSONB for flexible payloads (Postgres) with JSON fallback (SQLite). |
| **Resiliency** | Sequential runs with inter-run delay to avoid rate limits; timeouts configurable. |

## 9. Technology Decisions

| Choice | Rationale |
| --- | --- |
| **FastAPI** | Async-first, Pydantic v2 integration, auto docs, great for REST + WS. |
| **SQLAlchemy 2.0** | Modern ORM, type-safe Mapped annotations, flexible for SQLite/Postgres. |
| **Alembic** | Schema migrations for production DBs. |
| **Pydantic Settings** | Centralized env config with validation. |
| **PyPDF** | Simple text extraction from PDFs (blackbox mode). |
| **React + Vite + TS** | Fast dev/build, type safety, modern SPA. |
| **TanStack Query v5** | Smart caching, polling control, invalidation on WS events. |
| **Tailwind CSS 4** | Utility-first, fast iteration, dark theme. |
| **Recharts** | Lightweight charts for diagnosis visualization. |

## 10. Deployment View (High-Level)

```mermaid
graph TB
    subgraph Dev["Development"]
        Dev[Developer] --> BE[uvicorn --reload :8000]
        Dev --> FE[Vite dev :5173]
        BE --> SQLite[./drift.db]
        BE --> Uploads[./uploads/]
    end

    subgraph Prod["Production (conceptual)"]
        LB[Load Balancer / Reverse Proxy]
        FE_S[Static Files: dist/ served by Nginx/CDN]
        BE_S[ASGI: Uvicorn / Gunicorn workers]
        PG[(Postgres)]
        FS[Persistent Storage for uploads]
        LB --> FE_S
        LB --> BE_S
        BE_S --> PG
        BE_S --> FS
        BE_S --> LLM[LLM APIs]
    end
```

Notes: Current setup is dev-oriented. For production, consider process management, persistent volumes, DB migrations on startup, and secrets management.

## 11. Future Considerations

- **Parallel runs**: Could speed up when rate limits allow (with concurrency control)
- **Batch comparisons**: Multi-task comparison/reporting
- **Custom field validators**: Schema-aware drift detection
- **Authentication/RBAC**: Multi-user support
- **Export formats**: PDF/CSV reports
- **Caching**: Result caching by input hash
- **Observability**: Logging/metrics/tracing
- **OCR fallback**: For scanned PDFs in blackbox mode
