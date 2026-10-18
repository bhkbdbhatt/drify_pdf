from __future__ import annotations

import shutil
import uuid
from pathlib import Path
from typing import Annotated

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    UploadFile,
)
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_session, session_scope
from app.models import FieldDrift, Run, Task
from app.schemas import (
    CompareResult,
    DriftReport,
    FieldDriftOut,
    RunOut,
    TaskCreated,
    TaskDetail,
    TaskSummary,
)
from app.services import drift_engine, task_runner

router = APIRouter(prefix="/tasks", tags=["tasks"])

SessionDep = Annotated[Session, Depends(get_session)]

_MODES = {"blackbox", "parsed"}


def _save_upload(upload: UploadFile, task_id: uuid.UUID, field: str) -> str:
    settings = get_settings()
    upload_dir = Path(settings.uploads_dir)
    upload_dir.mkdir(parents=True, exist_ok=True)
    original = Path(upload.filename or field).name or field
    suffix = Path(original).suffix
    if not suffix:
        suffix = ".pdf" if field == "pdf" else ".txt"
    destination = upload_dir / f"{task_id}_{field}{suffix}"
    with destination.open("wb") as handle:
        shutil.copyfileobj(upload.file, handle)
    return str(destination)


@router.post("", response_model=TaskCreated, status_code=202)
async def create_task(
    session: SessionDep,
    name: Annotated[str, Form(min_length=1, max_length=255)],
    pdf: Annotated[UploadFile, File()],
    prompt_text: Annotated[str, Form(min_length=1)],
    model: Annotated[str, Form(min_length=1)] = "gpt-4o-mini",
    temperature: Annotated[float, Form(ge=0.0, le=2.0)] = 0.0,
    mode: Annotated[str, Form(pattern="^(blackbox|parsed)$")] = "blackbox",
    num_runs: Annotated[int, Form(ge=1, le=50)] = 5,
    parsed_input: Annotated[UploadFile | None, File()] = None,
) -> TaskCreated:
    if mode not in _MODES:
        raise HTTPException(422, detail=f"mode must be one of {sorted(_MODES)}")
    if mode == "parsed" and parsed_input is None:
        raise HTTPException(
            422, detail="mode='parsed' requires a parsed_input file upload"
        )

    task_id = uuid.uuid4()
    pdf_path = _save_upload(pdf, task_id, "pdf")
    parsed_path = (
        _save_upload(parsed_input, task_id, "parsed_input")
        if parsed_input is not None
        else None
    )

    task = Task(
        id=task_id,
        name=name,
        pdf_path=pdf_path,
        parsed_input_path=parsed_path,
        prompt_text=prompt_text,
        model=model,
        temperature=temperature,
        mode=mode,
        num_runs=num_runs,
        status="pending",
    )
    session.add(task)
    session.commit()

    task_runner.spawn_task(task_id)
    return TaskCreated(task_id=task_id, status="pending")


@router.get("", response_model=list[TaskSummary])
def list_tasks(session: SessionDep) -> list[TaskSummary]:
    tasks = list(
        session.scalars(select(Task).order_by(Task.created_at.desc()))
    )
    if not tasks:
        return []

    task_ids = [t.id for t in tasks]
    completed_runs = dict(
        session.execute(
            select(Run.task_id, func.count())
            .where(Run.task_id.in_(task_ids))
            .group_by(Run.task_id)
        ).all()
    )
    drifts_by_task: dict[uuid.UUID, list[FieldDrift]] = {}
    for row in session.scalars(
        select(FieldDrift).where(FieldDrift.task_id.in_(task_ids))
    ):
        drifts_by_task.setdefault(row.task_id, []).append(row)

    summaries = []
    for task in tasks:
        drifts = sorted(
            drifts_by_task.get(task.id, []),
            key=drift_engine.severity_key,
        )
        worst = drift_engine.worst_field_of(drifts)
        summaries.append(
            TaskSummary(
                id=task.id,
                name=task.name,
                status=task.status,  # type: ignore[arg-type]
                model=task.model,
                temperature=task.temperature,
                mode=task.mode,  # type: ignore[arg-type]
                num_runs=task.num_runs,
                created_at=task.created_at,
                completed_runs=completed_runs.get(task.id, 0),
                field_count=len(drifts),
                worst_field=worst,
            )
        )
    return summaries


def _get_task_or_404(session: Session, task_id: uuid.UUID) -> Task:
    task = session.get(Task, task_id)
    if task is None:
        raise HTTPException(404, detail=f"task {task_id} not found")
    return task


@router.get("/{task_id}", response_model=TaskDetail)
def get_task(task_id: uuid.UUID, session: SessionDep) -> TaskDetail:
    task = _get_task_or_404(session, task_id)
    runs = list(
        session.scalars(
            select(Run).where(Run.task_id == task_id).order_by(Run.created_at)
        )
    )
    drifts = list(
        session.scalars(select(FieldDrift).where(FieldDrift.task_id == task_id))
    )
    drifts.sort(key=drift_engine.severity_key)
    return TaskDetail(
        id=task.id,
        name=task.name,
        pdf_path=task.pdf_path,
        parsed_input_path=task.parsed_input_path,
        prompt_text=task.prompt_text,
        model=task.model,
        temperature=task.temperature,
        mode=task.mode,  # type: ignore[arg-type]
        num_runs=task.num_runs,
        status=task.status,  # type: ignore[arg-type]
        created_at=task.created_at,
        runs=[RunOut.model_validate(r) for r in runs],
        fields=[FieldDriftOut.model_validate(d) for d in drifts],
        worst_field=drift_engine.worst_field_of(drifts),
    )


@router.get("/{task_id}/report", response_model=DriftReport)
def get_report(task_id: uuid.UUID, session: SessionDep) -> DriftReport:
    task = _get_task_or_404(session, task_id)
    if task.status != "complete":
        raise HTTPException(409, detail=f"task status is '{task.status}', report not ready")
    runs = list(session.scalars(select(Run).where(Run.task_id == task_id)))
    drifts = list(
        session.scalars(select(FieldDrift).where(FieldDrift.task_id == task_id))
    )
    return drift_engine.build_report(task, runs, drifts)


@router.get("/{task_id}/compare", response_model=CompareResult)
def compare_tasks(
    task_id: uuid.UUID,
    session: SessionDep,
    other_task_id: Annotated[uuid.UUID, Query()],
) -> CompareResult:
    if task_id == other_task_id:
        raise HTTPException(422, detail="task_id and other_task_id must differ")
    task_a = _get_task_or_404(session, task_id)
    task_b = _get_task_or_404(session, other_task_id)
    drifts_a = list(
        session.scalars(select(FieldDrift).where(FieldDrift.task_id == task_id))
    )
    drifts_b = list(
        session.scalars(
            select(FieldDrift).where(FieldDrift.task_id == other_task_id)
        )
    )
    return CompareResult(
        a_task_id=task_a.id,
        b_task_id=task_b.id,
        a_name=task_a.name,
        b_name=task_b.name,
        a_mode=task_a.mode,
        b_mode=task_b.mode,
        fields=drift_engine.compare_drifts(task_a, drifts_a, task_b, drifts_b),
    )


@router.delete("/{task_id}", status_code=204)
def delete_task(task_id: uuid.UUID, session: SessionDep) -> None:
    task = _get_task_or_404(session, task_id)
    task_runner.cancel_task(task_id)

    for path in (task.pdf_path, task.parsed_input_path):
        if path:
            try:
                Path(path).unlink(missing_ok=True)
            except OSError:
                pass

    session.execute(delete(Run).where(Run.task_id == task_id))
    session.execute(delete(FieldDrift).where(FieldDrift.task_id == task_id))
    session.execute(delete(Task).where(Task.id == task_id))
    session.commit()
