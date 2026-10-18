from __future__ import annotations

import asyncio
import hashlib
import logging
import uuid
from pathlib import Path

from sqlalchemy import delete

from app.config import get_settings
from app.database import session_scope
from app.models import FieldDrift, Run, Task
from app.routes.ws import manager as ws_manager
from app.services import drift_engine
from app.services.llm_client import LLMClient, get_llm_client, json_from_text

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = (
    "You are a precise document data extraction engine. "
    "Respond with a single valid JSON object only - no markdown, no code fences, "
    "no commentary. Use consistent field names and types across responses."
)

_ACTIVE: dict[uuid.UUID, asyncio.Task] = {}


def spawn_task(task_id: uuid.UUID) -> asyncio.Task:
    """Start (or reuse) the background asyncio task for a drift run."""
    existing = _ACTIVE.get(task_id)
    if existing is not None and not existing.done():
        return existing

    task = asyncio.create_task(
        execute_task(task_id), name=f"drift-task-{task_id}"
    )
    _ACTIVE[task_id] = task

    def _cleanup(t: asyncio.Task, tid: uuid.UUID = task_id) -> None:
        if _ACTIVE.get(tid) is t:
            _ACTIVE.pop(tid, None)

    task.add_done_callback(_cleanup)
    return task


def cancel_task(task_id: uuid.UUID) -> bool:
    task = _ACTIVE.get(task_id)
    if task is not None and not task.done():
        task.cancel()
        return True
    return False


async def shutdown_runner() -> None:
    tasks = [t for t in _ACTIVE.values() if not t.done()]
    for task in tasks:
        task.cancel()
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)
    _ACTIVE.clear()


def is_running(task_id: uuid.UUID) -> bool:
    task = _ACTIVE.get(task_id)
    return task is not None and not task.done()


def extract_pdf_text(path: str) -> str:
    from pypdf import PdfReader

    reader = PdfReader(path)
    text = "\n".join((page.extract_text() or "") for page in reader.pages).strip()
    if not text:
        raise ValueError(
            f"no extractable text in PDF at {path} (scanned/image-only document?)"
        )
    return text


def load_input(task_id: uuid.UUID) -> tuple[bytes, str]:
    """Return (raw input bytes for hashing, text to send to the model)."""
    settings = get_settings()
    with session_scope() as session:
        task = session.get(Task, task_id)
        if task is None:
            raise ValueError("task no longer exists")
        mode = task.mode
        pdf_path = task.pdf_path
        parsed_path = task.parsed_input_path

    if mode == "parsed":
        if not parsed_path:
            raise ValueError("mode 'parsed' requires an uploaded parsed_input file")
        raw = Path(parsed_path).read_bytes()
        return raw, raw.decode("utf-8", errors="replace")

    if not Path(pdf_path).is_file():
        raise ValueError(f"PDF not found at {pdf_path}")
    raw = Path(pdf_path).read_bytes()
    text = extract_pdf_text(pdf_path)
    return raw, text[: settings.max_document_chars]


def build_user_prompt(prompt_text: str, document_text: str) -> str:
    return f"{prompt_text.strip()}\n\n---\nDOCUMENT CONTENT:\n{document_text}"


async def execute_task(task_id: uuid.UUID) -> None:
    settings = get_settings()
    try:
        with session_scope() as session:
            task = session.get(Task, task_id)
            if task is None:
                return
            task.status = "running"
            prompt_text = task.prompt_text
            model = task.model
            temperature = task.temperature
            num_runs = task.num_runs
            mode = task.mode

        await ws_manager.broadcast(
            task_id,
            {"event": "started", "task_id": str(task_id), "total_runs": num_runs},
        )

        input_bytes, document_text = load_input(task_id)
        input_hash = hashlib.sha256(input_bytes).hexdigest()
        user_prompt = build_user_prompt(prompt_text, document_text)
        client: LLMClient = get_llm_client(model)

        parsed_runs: list[dict] = []
        for index in range(num_runs):
            raw_response = await client.complete_json(
                system=SYSTEM_PROMPT, user=user_prompt, temperature=temperature
            )
            try:
                parsed = json_from_text(raw_response)
                parse_success = True
            except Exception:  # noqa: BLE001 - a bad parse is data, not an error
                parsed = None
                parse_success = False

            with session_scope() as session:
                session.add(
                    Run(
                        task_id=task_id,
                        input_hash=input_hash,
                        model=model,
                        temperature=temperature,
                        mode=mode,
                        raw_response=raw_response,
                        parsed_json=parsed,
                        parse_success=parse_success,
                    )
                )

            if parse_success:
                parsed_runs.append(parsed)

            await ws_manager.broadcast(
                task_id,
                {
                    "event": "run_complete",
                    "task_id": str(task_id),
                    "completed": index + 1,
                    "total_runs": num_runs,
                    "parse_success": parse_success,
                },
            )

            if index < num_runs - 1 and settings.llm_inter_run_delay > 0:
                await asyncio.sleep(settings.llm_inter_run_delay)

        await ws_manager.broadcast(
            task_id,
            {
                "event": "parsing_done",
                "task_id": str(task_id),
                "parsed_runs": len(parsed_runs),
                "total_runs": num_runs,
            },
        )

        if not parsed_runs:
            raise RuntimeError("no runs produced a valid JSON object - report impossible")

        drift_payloads = drift_engine.compute_drift_report(parsed_runs, settings)

        with session_scope() as session:
            session.execute(
                delete(FieldDrift).where(FieldDrift.task_id == task_id)
            )
            for payload in drift_payloads:
                session.add(FieldDrift(task_id=task_id, **payload))
            task = session.get(Task, task_id)
            if task is None:
                return
            task.status = "complete"

        await ws_manager.broadcast(
            task_id,
            {
                "event": "report_ready",
                "task_id": str(task_id),
                "field_count": len(drift_payloads),
            },
        )
    except asyncio.CancelledError:
        _mark_failed(task_id, "cancelled")
        raise
    except Exception as exc:  # noqa: BLE001 - surface any failure to clients
        logger.exception("task %s failed", task_id)
        _mark_failed(task_id, str(exc))


def _mark_failed(task_id: uuid.UUID, error: str) -> None:
    try:
        with session_scope() as session:
            task = session.get(Task, task_id)
            if task is not None and task.status in ("pending", "running"):
                task.status = "failed"
    except Exception:  # noqa: BLE001 - never mask the original failure
        logger.exception("could not mark task %s as failed", task_id)
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    loop.create_task(
        ws_manager.broadcast(
            task_id,
            {"event": "failed", "task_id": str(task_id), "error": error},
        )
    )
