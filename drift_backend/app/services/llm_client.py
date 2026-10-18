from __future__ import annotations

import asyncio
import json
from typing import Any, Protocol, runtime_checkable

from app.config import get_settings


class LLMError(RuntimeError):
    """Raised when an LLM call fails after all retries."""


@runtime_checkable
class LLMClient(Protocol):
    """Provider-agnostic JSON completion interface.

    Implementations must return the raw JSON text produced by the model.
    """

    async def complete_json(self, *, system: str, user: str, temperature: float) -> str:
        ...


async def _with_retries(coro_factory, *, attempts: int | None = None):  # type: ignore[no-untyped-def]
    """Run `coro_factory()` with exponential backoff."""
    settings = get_settings()
    tries = attempts if attempts is not None else settings.llm_max_retries
    last_exc: Exception | None = None
    for attempt in range(tries):
        try:
            return await coro_factory()
        except Exception as exc:  # noqa: BLE001 - retry any provider error
            last_exc = exc
            if attempt == tries - 1:
                break
            delay = settings.llm_retry_base_delay * (2**attempt)
            await asyncio.sleep(delay)
    raise LLMError(f"LLM call failed after {tries} attempts: {last_exc}") from last_exc


class OpenAIClient:
    """Forces JSON output via `response_format={"type": "json_object"}`."""

    def __init__(self, api_key: str, model: str, timeout: float) -> None:
        from openai import AsyncOpenAI

        if not api_key:
            raise LLMError("OPENAI_API_KEY is not configured")
        self.model = model
        self._client = AsyncOpenAI(api_key=api_key, timeout=timeout)

    async def complete_json(self, *, system: str, user: str, temperature: float) -> str:
        async def call() -> str:
            response = await self._client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                temperature=temperature,
                response_format={"type": "json_object"},
            )
            content = response.choices[0].message.content
            if not content:
                raise LLMError("OpenAI returned an empty message")
            return content

        return await _with_retries(call)


class AnthropicClient:
    """Forces JSON output via a required `tool_use` block."""

    _TOOL = {
        "name": "emit_json",
        "description": "Return the extracted document data as a single JSON object.",
        "input_schema": {
            "type": "object",
            "properties": {},
            "additionalProperties": True,
        },
    }

    def __init__(self, api_key: str, model: str, timeout: float) -> None:
        from anthropic import AsyncAnthropic

        if not api_key:
            raise LLMError("ANTHROPIC_API_KEY is not configured")
        self.model = model
        self._client = AsyncAnthropic(api_key=api_key, timeout=timeout)

    async def complete_json(self, *, system: str, user: str, temperature: float) -> str:
        async def call() -> str:
            message = await self._client.messages.create(
                model=self.model,
                max_tokens=4096,
                system=system,
                messages=[{"role": "user", "content": user}],
                temperature=temperature,
                tools=[self._TOOL],
                tool_choice={"type": "tool", "name": "emit_json"},
            )
            for block in message.content:
                if getattr(block, "type", None) == "tool_use":
                    return json.dumps(block.input)
            raise LLMError("Anthropic returned no tool_use block")

        return await _with_retries(call)


def get_llm_client(model: str) -> LLMClient:
    """Factory: pick a provider from the model name."""
    settings = get_settings()
    if model.startswith("claude"):
        return AnthropicClient(
            api_key=settings.anthropic_api_key, model=model, timeout=settings.llm_timeout
        )
    return OpenAIClient(
        api_key=settings.openai_api_key, model=model, timeout=settings.llm_timeout
    )


def json_from_text(text: str) -> dict[str, Any]:
    """Parse a JSON object from raw model text (tolerates code fences)."""
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("```", 2)[1]
        if cleaned.startswith("json"):
            cleaned = cleaned[4:]
    data = json.loads(cleaned)
    if not isinstance(data, dict):
        raise ValueError("model response is not a JSON object")
    return data
