from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.config import get_settings
from app.database import init_db
from app.routes.tasks import router as tasks_router
from app.routes.ws import router as ws_router
from app.services.task_runner import shutdown_runner


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    init_db()
    yield
    await shutdown_runner()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="Drift Backend",
        description="PDF drift measurement tool - REST API + live WebSocket progress.",
        version=__version__,
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(tasks_router)
    app.include_router(ws_router)

    @app.get("/health", tags=["meta"])
    def health() -> dict[str, str]:
        return {"status": "ok", "version": __version__}

    return app


app = create_app()
