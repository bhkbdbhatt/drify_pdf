from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy import func, select

from app.database import session_scope
from app.models import FieldDrift, Run, Task

router = APIRouter()


class WSManager:
    """Tracks live WebSocket connections per task and broadcasts progress."""

    def __init__(self) -> None:
        self._connections: dict[uuid.UUID, set[WebSocket]] = {}

    async def connect(self, task_id: uuid.UUID, websocket: WebSocket) -> None:
        await websocket.accept()
        self._connections.setdefault(task_id, set()).add(websocket)
        snapshot = await task_snapshot(task_id)
        await websocket.send_json(snapshot)

    def disconnect(self, task_id: uuid.UUID, websocket: WebSocket) -> None:
        conns = self._connections.get(task_id)
        if conns is None:
            return
        conns.discard(websocket)
        if not conns:
            self._connections.pop(task_id, None)

    async def broadcast(self, task_id: uuid.UUID, payload: dict[str, Any]) -> None:
        conns = list(self._connections.get(task_id, ()))
        for websocket in conns:
            try:
                await websocket.send_json(payload)
            except Exception:  # noqa: BLE001 - drop broken sockets
                self.disconnect(task_id, websocket)

    def connection_count(self, task_id: uuid.UUID) -> int:
        return len(self._connections.get(task_id, ()))


manager = WSManager()


async def task_snapshot(task_id: uuid.UUID) -> dict[str, Any]:
    """Current task state, sent to every newly connected client."""
    with session_scope() as session:
        task = session.get(Task, task_id)
        if task is None:
            return {"event": "not_found", "task_id": str(task_id)}
        completed = session.scalar(
            select(func.count()).select_from(Run).where(Run.task_id == task_id)
        ) or 0
        field_count = session.scalar(
            select(func.count())
            .select_from(FieldDrift)
            .where(FieldDrift.task_id == task_id)
        ) or 0
    return {
        "event": "status",
        "task_id": str(task_id),
        "status": task.status,
        "completed_runs": completed,
        "total_runs": task.num_runs,
        "field_count": field_count,
    }


@router.websocket("/ws/{task_id}")
async def task_progress_socket(websocket: WebSocket, task_id: uuid.UUID) -> None:
    await manager.connect(task_id, websocket)
    try:
        while True:
            await websocket.receive_text()  # keepalive / client messages
    except WebSocketDisconnect:
        manager.disconnect(task_id, websocket)
    except Exception:
        manager.disconnect(task_id, websocket)
        try:
            await websocket.close()
        except Exception:  # noqa: BLE001
            pass
