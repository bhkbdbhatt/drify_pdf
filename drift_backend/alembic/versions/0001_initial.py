"""initial schema: tasks, runs, field_drifts

Revision ID: 0001_initial
Revises:
Create Date: 2026-10-18

"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001_initial"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

JSON_FIELD = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def upgrade() -> None:
    op.create_table(
        "tasks",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("pdf_path", sa.String(length=1024), nullable=False),
        sa.Column("parsed_input_path", sa.String(length=1024), nullable=True),
        sa.Column("prompt_text", sa.Text(), nullable=False),
        sa.Column("model", sa.String(length=128), nullable=False),
        sa.Column("temperature", sa.Float(), nullable=False),
        sa.Column("mode", sa.String(length=32), nullable=False),
        sa.Column("num_runs", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )

    op.create_table(
        "runs",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "task_id",
            sa.Uuid(),
            sa.ForeignKey("tasks.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("input_hash", sa.String(length=64), nullable=False),
        sa.Column("model", sa.String(length=128), nullable=False),
        sa.Column("temperature", sa.Float(), nullable=False),
        sa.Column("mode", sa.String(length=32), nullable=False),
        sa.Column("raw_response", sa.Text(), nullable=False),
        sa.Column("parsed_json", JSON_FIELD, nullable=True),
        sa.Column("parse_success", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_runs_task_id", "runs", ["task_id"])

    op.create_table(
        "field_drifts",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "task_id",
            sa.Uuid(),
            sa.ForeignKey("tasks.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("field_name", sa.String(length=255), nullable=False),
        sa.Column("field_type", sa.String(length=32), nullable=False),
        sa.Column("unique_values", JSON_FIELD, nullable=False),
        sa.Column("consistency", sa.Float(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("detail", JSON_FIELD, nullable=False),
    )
    op.create_index("ix_field_drifts_task_id", "field_drifts", ["task_id"])


def downgrade() -> None:
    op.drop_index("ix_field_drifts_task_id", table_name="field_drifts")
    op.drop_table("field_drifts")
    op.drop_index("ix_runs_task_id", table_name="runs")
    op.drop_table("runs")
    op.drop_table("tasks")
