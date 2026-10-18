from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

Mode = Literal["blackbox", "parsed"]
TaskStatus = Literal["pending", "running", "complete", "failed"]
FieldType = Literal["str", "numeric", "date", "array"]
FieldStatus = Literal["stable", "drift", "unstable"]


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class TaskCreated(BaseModel):
    task_id: uuid.UUID
    status: TaskStatus


class RunOut(ORMModel):
    id: uuid.UUID
    input_hash: str
    model: str
    temperature: float
    mode: str
    raw_response: str
    parsed_json: dict[str, Any] | None
    parse_success: bool
    created_at: datetime


class FieldDriftOut(ORMModel):
    id: uuid.UUID
    field_name: str
    field_type: FieldType
    unique_values: list[Any]
    consistency: float
    status: FieldStatus
    detail: dict[str, Any]


class WorstField(BaseModel):
    field_name: str
    consistency: float
    status: FieldStatus


class TaskSummary(BaseModel):
    id: uuid.UUID
    name: str
    status: TaskStatus
    model: str
    temperature: float
    mode: str
    num_runs: int
    created_at: datetime
    completed_runs: int = 0
    field_count: int = 0
    worst_field: WorstField | None = None


class TaskDetail(BaseModel):
    id: uuid.UUID
    name: str
    pdf_path: str
    parsed_input_path: str | None
    prompt_text: str
    model: str
    temperature: float
    mode: str
    num_runs: int
    status: TaskStatus
    created_at: datetime
    runs: list[RunOut] = Field(default_factory=list)
    fields: list[FieldDriftOut] = Field(default_factory=list)
    worst_field: WorstField | None = None


class ReportField(BaseModel):
    field_name: str
    field_type: FieldType
    unique_values: list[Any]
    consistency: float
    status: FieldStatus
    detail: dict[str, Any]


class ReportSummary(BaseModel):
    total_fields: int
    stable: int
    drift: int
    unstable: int
    worst_field: str | None
    worst_consistency: float | None


class DriftReport(BaseModel):
    task_id: uuid.UUID
    task_name: str
    model: str
    temperature: float
    mode: str
    num_runs: int
    parse_success_rate: float
    fields: list[ReportField]
    summary: ReportSummary


class CompareSide(BaseModel):
    consistency: float
    status: FieldStatus
    field_type: FieldType
    unique_values: list[Any]
    detail: dict[str, Any]


class CompareField(BaseModel):
    field_name: str
    verdict: Literal["match", "similar", "diverges", "missing_in_a", "missing_in_b"]
    consistency_gap: float | None
    a: CompareSide | None
    b: CompareSide | None


class CompareResult(BaseModel):
    a_task_id: uuid.UUID
    b_task_id: uuid.UUID
    a_name: str
    b_name: str
    a_mode: str
    b_mode: str
    fields: list[CompareField]


class ErrorOut(BaseModel):
    detail: str
