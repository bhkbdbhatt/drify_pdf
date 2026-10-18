# Drift PDF

Drift PDF is a full-stack application for measuring LLM output drift - how consistently a model extracts structured JSON from PDF documents across multiple runs.

The system sends the same PDF + prompt to an LLM multiple times, parses each response as JSON, computes per-field consistency statistics (numeric variance, string edit distance, date ranges, array element counts), and presents results with live WebSocket progress tracking. It supports side-by-side comparison of runs/tasks and diagnosis of whether variance comes from parsing differences or sampling randomness.

## Project Structure

`
drift_pdf/
  drift_backend/  # FastAPI REST API + WebSocket + drift computation engine
  drift_ui/       # React 18 + Vite + TypeScript dashboard
`

## Tech Stack

**Backend:** FastAPI, SQLAlchemy 2.0, Pydantic v2, Alembic, Uvicorn, PyPDF, OpenAI/Anthropic SDKs

**Frontend:** React 18, Vite, TypeScript (strict), TanStack Query v5, Tailwind CSS 4, Recharts, native WebSocket

## Quick Start

### Prerequisites
- Python 3.11+ (for backend)
- Node.js 18+ (for frontend)
- At least one LLM provider API key (OpenAI or Anthropic)

### 1. Start Backend

`ash
cd drift_backend
python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS/Linux
source .venv/bin/activate

pip install -r requirements.txt
cp .env.example .env  # or copy on Windows
`

Edit .env:
`dotenv
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
DATABASE_URL=sqlite:///./drift.db
`

Run server:
`ash
uvicorn app.main:app --reload
`

API docs: http://127.0.0.1:8000/docs | Health: http://127.0.0.1:8000/health

### 2. Start Frontend

`ash
cd drift_ui
npm install
npm run dev
`

Open http://localhost:5173

## Key Features

- **Blackbox or Parsed modes**: Extract from raw PDF text, or provide pre-parsed JSON input
- **Multi-run evaluation**: Run the same extraction N times (configurable, sequential with rate limiting)
- **Per-field drift analysis**: Detects stable/drift/unstable fields with consistency scoring
- **Live progress**: Real-time WebSocket updates during runs (status, completion, parsing results)
- **Task comparison**: Side-by-side diff of two tasks with verdicts (match/similar/diverges/missing)
- **Drift diagnosis**: Splits variance into parsing vs sampling components
- **Raw run inspection**: View each LLM response and parsed JSON

## API Endpoints

| Method | Path | Description |
| --- | --- | --- |
| POST | /tasks | Create task (multipart), starts background run |
| GET | /tasks | List all tasks with summary stats |
| GET | /tasks/{id} | Task detail with runs + field drift |
| GET | /tasks/{id}/report | Full drift report (machine-readable) |
| GET | /tasks/{id}/compare?other_task_id= | Compare against another task |
| DELETE | /tasks/{id} | Delete task (cascades runs + drift, cancels if running) |
| WS | /ws/{id} | Live progress stream

## Documentation

- [HLD - High Level Design](./HLD.md)
- [LLD - Low Level Design](./LLD.md)
- Backend README: [drift_backend/README.md](./drift_backend/README.md)
- Frontend README: [drift_ui/README.md](./drift_ui/README.md)

## Contributing

See [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md). This project follows standard practices; run tests and lint/typecheck before submitting changes (as specified in the backend/frontend READMEs).

## License

MIT License - see LICENSE file if present.
