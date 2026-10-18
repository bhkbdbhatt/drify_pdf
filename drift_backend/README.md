# Drift Backend

REST API + WebSocket backend for the PDF drift measurement tool. Feed it a PDF
(prompt + model + N runs), it calls the LLM N times, parses each response as
JSON, computes per-field drift statistics, and streams live progress over a
WebSocket.

**Stack:** FastAPI · SQLAlchemy 2.0 (SQLite dev / Postgres-ready) · Pydantic v2 ·
Uvicorn · Alembic · Python 3.11+

## Project structure

```
drift_backend/
├── app/
│   ├── main.py            # FastAPI app, CORS, router registration, lifespan
│   ├── config.py          # pydantic-settings (reads .env)
│   ├── database.py        # lazy engine + session management
│   ├── models.py          # Task / Run / FieldDrift (SQLAlchemy 2.0)
│   ├── schemas.py         # Pydantic v2 request/response models
│   ├── routes/
│   │   ├── tasks.py       # REST endpoints
│   │   └── ws.py          # WS /ws/{task_id} + connection manager
│   └── services/
│       ├── llm_client.py  # LLMClient protocol, OpenAI + Anthropic, retries
│       ├── drift_engine.py# per-field variance / consistency computation
│       └── task_runner.py # background asyncio orchestration
├── alembic/               # migrations (versions/0001_initial.py)
├── tests/                 # pytest suite (drift engine + full API flow)
├── .env.example
├── alembic.ini
├── requirements.txt
└── README.md
```

## Setup

```bash
cd drift_backend
python -m venv .venv
.venv\Scripts\activate          # Windows
source .venv/bin/activate       # macOS/Linux

pip install -r requirements.txt
copy .env.example .env          # Windows
cp .env.example .env            # macOS/Linux
```

Edit `.env` and set at least one provider key:

```dotenv
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
DATABASE_URL=sqlite:///./drift.db
LLM_TIMEOUT=120
```

## Database

Tables are auto-created at startup (`init_db()` in the lifespan), so for local
dev you can just run the server. For real migrations:

```bash
alembic upgrade head            # apply all migrations
alembic revision --autogenerate -m "add something"   # create a new one
```

Switch to Postgres by changing `DATABASE_URL` (models already use
`JSONB` via a dialect variant, `UUID`, and `ON DELETE CASCADE`):

```dotenv
DATABASE_URL=postgresql+psycopg://user:pass@localhost:5432/drift
```

## Run

```bash
uvicorn app.main:app --reload
```

- API docs: http://127.0.0.1:8000/docs
- Health: `GET /health`

## API

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/tasks` | Create a task (multipart), starts background run |
| `GET` | `/tasks` | List tasks: status, field count, worst field |
| `GET` | `/tasks/{id}` | Task detail + all runs + field drift summary |
| `GET` | `/tasks/{id}/report` | Full drift report (CLI `drift_summary.json` shape) |
| `GET` | `/tasks/{id}/compare?other_task_id=` | Side-by-side field diff |
| `DELETE` | `/tasks/{id}` | Cascade delete runs + drift rows (cancels if running) |
| `WS` | `/ws/{id}` | Live progress: `run 3/5`, `parsing done`, `report ready` |

### Create a task

```bash
curl -X POST http://127.0.0.1:8000/tasks \
  -F "name=invoice-drift" \
  -F "pdf=@invoice.pdf" \
  -F "prompt_text=Extract invoice fields as JSON." \
  -F "model=gpt-4o-mini" \
  -F "temperature=0.7" \
  -F "mode=blackbox" \
  -F "num_runs=5"
# → {"task_id": "...", "status": "pending"}
```

`mode=blackbox` sends extracted PDF text to the model. `mode=parsed` requires
an extra `-F "parsed_input=@parsed.json"` upload and sends that file instead.

### Poll / report

```bash
curl http://127.0.0.1:8000/tasks/TASK_ID            # detail + runs + fields
curl http://127.0.0.1:8000/tasks/TASK_ID/report     # full drift report
curl "http://127.0.0.1:8000/tasks/A/compare?other_task_id=B"
curl -X DELETE http://127.0.0.1:8000/tasks/TASK_ID
```

### Live progress (WebSocket)

```javascript
const ws = new WebSocket("ws://127.0.0.1:8000/ws/" + taskId);
ws.onmessage = (event) => console.log(JSON.parse(event.data));
// {"event":"status", "status":"running", "completed_runs":1, "total_runs":5}
// {"event":"run_complete", "completed":3, "total_runs":5, "parse_success":true}
// {"event":"parsing_done", "parsed_runs":5, "total_runs":5}
// {"event":"report_ready", "field_count":12}
// {"event":"failed", "error":"..."}
```

## Drift report shape

`GET /tasks/{id}/report`:

```json
{
  "task_id": "…", "task_name": "invoice-drift",
  "model": "gpt-4o-mini", "temperature": 0.7, "mode": "blackbox",
  "num_runs": 5, "parse_success_rate": 1.0,
  "fields": [
    {
      "field_name": "total",
      "field_type": "numeric",
      "unique_values": [1234.56],
      "consistency": 1.0,
      "status": "stable",
      "detail": {"mean": 1234.56, "std": 0.0, "min": 1234.56, "max": 1234.56, "count": 5,
                 "value_count": 5, "missing_count": 0}
    }
  ],
  "summary": {"total_fields": 12, "stable": 9, "drift": 2, "unstable": 1,
              "worst_field": "notes", "worst_consistency": 0.4}
}
```

Field types and their `detail` payloads:

- `numeric` → mean/std/min/max (float noise within `NUMERIC_RELATIVE_TOLERANCE`
  counts as one value)
- `str` → normalized Levenshtein edit distance (avg/max), unique count
- `date` → min/max ISO date, unique count
- `array` → mean/min/max element count + count variance

Status thresholds (`.env`): `stable` ≥ `STABLE_CONSISTENCY_THRESHOLD` (0.95),
`drift` ≥ `DRIFT_CONSISTENCY_THRESHOLD` (0.5), otherwise `unstable`.

## LLM layer

`app/services/llm_client.py` defines an `LLMClient` protocol:

```python
class LLMClient(Protocol):
    async def complete_json(self, *, system: str, user: str, temperature: float) -> str: ...
```

- `OpenAIClient` forces JSON via `response_format={"type": "json_object"}`
- `AnthropicClient` forces JSON via a required `tool_use` block
- Both retry 3 times with exponential backoff (`LLM_MAX_RETRIES`,
  `LLM_RETRY_BASE_DELAY`)
- `get_llm_client(model)` picks the provider from the model name
  (`claude*` → Anthropic, everything else → OpenAI) — add your own class and
  wire it there to swap providers.

## Tests

```bash
pytest -q
```

The suite stubs the LLM client (no API calls) and runs the full
create → run → drift → report → compare → delete flow against a temp SQLite DB.

## Notes

- Uploaded files land in `UPLOADS_DIR` (`uploads/`) as
  `{task_id}_pdf.pdf` / `{task_id}_parsed_input.*` and are removed on delete.
- Runs are executed sequentially with `LLM_INTER_RUN_DELAY` seconds between
  calls to respect provider rate limits.
- `POST /tasks` responds `202 Accepted` immediately; work continues in an
  asyncio task tracked by the app (cancelled on shutdown or `DELETE`).
