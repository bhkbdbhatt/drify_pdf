from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    Uuid,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

# JSONB on Postgres, plain JSON everywhere else (SQLite dev).
JSONField = JSON().with_variant(JSONB(), "postgresql")

TASK_MODES = ("blackbox", "parsed")
TASK_STATUSES = ("pending", "running", "complete", "failed")
FIELD_TYPES = ("str", "numeric", "date", "array")
FIELD_STATUSES = ("stable", "drift", "unstable")


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4
    )
    name: Mapped[str] = mapped_column(String(255))
    pdf_path: Mapped[str] = mapped_column(String(1024))
    parsed_input_path: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    prompt_text: Mapped[str] = mapped_column(Text)
    model: Mapped[str] = mapped_column(String(128))
    temperature: Mapped[float] = mapped_column(Float, default=0.0)
    mode: Mapped[str] = mapped_column(String(32), default="blackbox")
    num_runs: Mapped[int] = mapped_column(Integer, default=5)
    status: Mapped[str] = mapped_column(String(32), default="pending")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow
    )

    runs: Mapped[list["Run"]] = relationship(
        back_populates="task",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="Run.created_at",
    )
    field_drifts: Mapped[list["FieldDrift"]] = relationship(
        back_populates="task",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="FieldDrift.consistency",
    )


class Run(Base):
    __tablename__ = "runs"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4
    )
    task_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("tasks.id", ondelete="CASCADE"),
        index=True,
    )
    input_hash: Mapped[str] = mapped_column(String(64))
    model: Mapped[str] = mapped_column(String(128))
    temperature: Mapped[float] = mapped_column(Float, default=0.0)
    mode: Mapped[str] = mapped_column(String(32), default="blackbox")
    raw_response: Mapped[str] = mapped_column(Text)
    parsed_json: Mapped[dict[str, Any] | None] = mapped_column(JSONField, nullable=True)
    parse_success: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow
    )

    task: Mapped[Task] = relationship(back_populates="runs")


class FieldDrift(Base):
    __tablename__ = "field_drifts"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4
    )
    task_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("tasks.id", ondelete="CASCADE"),
        index=True,
    )
    field_name: Mapped[str] = mapped_column(String(255))
    field_type: Mapped[str] = mapped_column(String(32))
    unique_values: Mapped[list[Any]] = mapped_column(JSONField, default=list)
    consistency: Mapped[float] = mapped_column(Float, default=0.0)
    status: Mapped[str] = mapped_column(String(32), default="stable")
    detail: Mapped[dict[str, Any]] = mapped_column(JSONField, default=dict)

    task: Mapped[Task] = relationship(back_populates="field_drifts")
