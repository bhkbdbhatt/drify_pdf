from __future__ import annotations

import json
from typing import Any, Callable

import pytest
from fastapi.testclient import TestClient


def build_pdf(text: str) -> bytes:
    """Build a minimal, xref-valid single page PDF containing `text`."""
    escaped = (
        text.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")
    )
    content = f"BT /F1 12 Tf 72 720 Td ({escaped}) Tj ET".encode("latin-1")
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        (
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            b"/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>"
        ),
        b"<< /Length "
        + str(len(content)).encode()
        + b" >>\nstream\n"
        + content
        + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]

    out = bytearray(b"%PDF-1.4\n")
    offsets: list[int] = []
    for index, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{index} 0 obj\n".encode() + body + b"\nendobj\n"

    xref_pos = len(out)
    out += f"xref\n0 {len(objects) + 1}\n".encode()
    out += b"0000000000 65535 f \n"
    for offset in offsets:
        out += f"{offset:010d} 00000 n \n".encode()
    out += (
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\n"
        f"startxref\n{xref_pos}\n%%EOF"
    ).encode()
    return bytes(out)


@pytest.fixture()
def app_env(tmp_path, monkeypatch):
    monkeypatch.setenv(
        "DATABASE_URL", f"sqlite:///{(tmp_path / 'drift_test.db').as_posix()}"
    )
    monkeypatch.setenv("UPLOADS_DIR", str(tmp_path / "uploads"))
    monkeypatch.setenv("LLM_INTER_RUN_DELAY", "0")
    monkeypatch.setenv("LLM_RETRY_BASE_DELAY", "0")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")

    from app.config import get_settings

    get_settings.cache_clear()
    from app import database

    database.reset_database_state()
    yield
    get_settings.cache_clear()
    database.reset_database_state()


@pytest.fixture()
def client(app_env):
    from app.main import app

    with TestClient(app) as test_client:
        yield test_client


class FakeLLMClient:
    """Deterministic stand-in for a provider client."""

    def __init__(self, responses: list[str]) -> None:
        self.responses = responses
        self.calls = 0

    async def complete_json(self, *, system: str, user: str, temperature: float) -> str:
        self.calls += 1
        index = min(self.calls - 1, len(self.responses) - 1)
        return self.responses[index]


@pytest.fixture()
def fake_llm(monkeypatch) -> Callable[[list[str]], FakeLLMClient]:
    def install(responses: list[str]) -> FakeLLMClient:
        client = FakeLLMClient(responses)
        monkeypatch.setattr(
            "app.services.task_runner.get_llm_client", lambda model: client
        )
        return client

    return install


def as_json(value: dict[str, Any]) -> str:
    return json.dumps(value)


def wait_for_status(
    client: TestClient,
    task_id: str,
    wanted: set[str],
    timeout: float = 15.0,
) -> dict[str, Any]:
    import time

    deadline = time.monotonic() + timeout
    payload: dict[str, Any] = {}
    while time.monotonic() < deadline:
        response = client.get(f"/tasks/{task_id}")
        assert response.status_code == 200, response.text
        payload = response.json()
        if payload["status"] in wanted:
            return payload
        time.sleep(0.05)
    raise AssertionError(
        f"task {task_id} never reached {wanted}; last status={payload.get('status')}"
    )
