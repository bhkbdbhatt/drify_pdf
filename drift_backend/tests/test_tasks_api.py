from __future__ import annotations

import json
import uuid

from tests.conftest import build_pdf, wait_for_status

RUN_A = json.dumps(
    {
        "invoice_no": "INV-001",
        "total": 1234.56,
        "date": "2024-05-12",
        "items": ["widget", "gadget"],
        "notes": "payment received",
    }
)
RUN_B = json.dumps(
    {
        "invoice_no": "INV-001",
        "total": 1234.5600002,
        "date": "2024-05-12",
        "items": ["widget", "gadget", "doodad"],
        "notes": "paymnt recieved",
    }
)
RUN_C = json.dumps(
    {
        "invoice_no": "INV-001",
        "total": 1234.5599998,
        "date": "2024-05-13",
        "items": ["widget"],
        "notes": "totally different wording",
    }
)


def _create_task(client, parsed_input: str | None = None, **overrides):
    data = {
        "name": "invoice-drift",
        "prompt_text": "Extract invoice fields as JSON.",
        "model": "gpt-4o-mini",
        "temperature": "0.0",
        "mode": "blackbox",
        "num_runs": "3",
    }
    data.update(overrides)
    files = {"pdf": ("invoice.pdf", build_pdf("Invoice INV-001"), "application/pdf")}
    if parsed_input is not None:
        files["parsed_input"] = ("parsed.json", parsed_input.encode(), "application/json")
    return client.post(
        "/tasks", data={k: str(v) for k, v in data.items()}, files=files
    )


def test_health(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_create_task_runs_and_computes_report(client, fake_llm):
    fake_llm([RUN_A, RUN_B, RUN_C])
    response = _create_task(client)
    assert response.status_code == 202, response.text
    body = response.json()
    assert body["status"] == "pending"
    task_id = body["task_id"]

    detail = wait_for_status(client, task_id, {"complete", "failed"})
    assert detail["status"] == "complete", detail
    assert len(detail["runs"]) == 3
    assert all(run["parse_success"] for run in detail["runs"])
    assert len(detail["runs"][0]["input_hash"]) == 64

    field_names = {f["field_name"] for f in detail["fields"]}
    assert field_names == {"invoice_no", "total", "date", "items", "notes"}

    by_name = {f["field_name"]: f for f in detail["fields"]}
    assert by_name["invoice_no"]["status"] == "stable"
    assert by_name["invoice_no"]["consistency"] == 1.0
    assert by_name["total"]["field_type"] == "numeric"
    assert by_name["items"]["field_type"] == "array"
    assert by_name["date"]["field_type"] == "date"
    assert by_name["notes"]["status"] in ("drift", "unstable")
    assert detail["worst_field"] is not None

    report = client.get(f"/tasks/{task_id}/report")
    assert report.status_code == 200, report.text
    report_body = report.json()
    assert report_body["num_runs"] == 3
    assert report_body["parse_success_rate"] == 1.0
    assert report_body["summary"]["total_fields"] == 5
    assert report_body["summary"]["worst_field"] in {"notes", "items"}
    assert report_body["summary"]["unstable"] >= 1

    listing = client.get("/tasks").json()
    assert len(listing) == 1
    assert listing[0]["field_count"] == 5
    assert listing[0]["completed_runs"] == 3
    assert listing[0]["worst_field"]["field_name"] in {"notes", "items"}
    assert listing[0]["worst_field"]["status"] == "unstable"


def test_parsed_mode_requires_parsed_input(client):
    response = _create_task(client, mode="parsed", parsed_input=None)
    assert response.status_code == 422


def test_parsed_mode_uses_uploaded_input(client, fake_llm):
    fake_llm([RUN_A, RUN_A, RUN_A])
    response = _create_task(
        client, mode="parsed", parsed_input='{"raw": "parsed doc text"}'
    )
    assert response.status_code == 202, response.text
    task_id = response.json()["task_id"]
    detail = wait_for_status(client, task_id, {"complete", "failed"})
    assert detail["status"] == "complete", detail
    assert detail["parsed_input_path"] is not None


def test_failed_task_when_all_parses_fail(client, fake_llm):
    fake_llm(["this is not json", "still not json", "nope"])
    response = _create_task(client)
    task_id = response.json()["task_id"]
    detail = wait_for_status(client, task_id, {"failed", "complete"})
    assert detail["status"] == "failed"
    report = client.get(f"/tasks/{task_id}/report")
    assert report.status_code == 409


def test_compare_two_tasks(client, fake_llm):
    fake_llm([RUN_A, RUN_B, RUN_C])
    first = _create_task(client, name="blackbox-run").json()
    wait_for_status(client, first["task_id"], {"complete", "failed"})

    fake_llm([RUN_A, RUN_A, RUN_A])
    second = _create_task(client, name="parsed-run", mode="parsed",
                          parsed_input='{"raw": "parsed doc text"}').json()
    wait_for_status(client, second["task_id"], {"complete", "failed"})

    response = client.get(
        f"/tasks/{first['task_id']}/compare",
        params={"other_task_id": second["task_id"]},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["a_task_id"] == first["task_id"]
    assert body["b_task_id"] == second["task_id"]
    verdicts = {f["field_name"]: f["verdict"] for f in body["fields"]}
    assert verdicts["invoice_no"] == "match"
    assert verdicts["notes"] == "diverges"
    assert set(verdicts) == {
        "invoice_no",
        "total",
        "date",
        "items",
        "notes",
    }


def test_compare_same_task_rejected(client):
    task_id = str(uuid.uuid4())
    response = client.get(
        f"/tasks/{task_id}/compare", params={"other_task_id": task_id}
    )
    assert response.status_code == 422


def test_delete_task_cascades(client, fake_llm):
    fake_llm([RUN_A, RUN_B, RUN_C])
    task_id = _create_task(client).json()["task_id"]
    wait_for_status(client, task_id, {"complete", "failed"})

    response = client.delete(f"/tasks/{task_id}")
    assert response.status_code == 204
    assert client.get(f"/tasks/{task_id}").status_code == 404
    assert client.get("/tasks").json() == []


def test_missing_task_returns_404(client):
    assert client.get(f"/tasks/{uuid.uuid4()}").status_code == 404
    assert client.delete(f"/tasks/{uuid.uuid4()}").status_code == 404


def test_websocket_status_snapshot(client, fake_llm):
    fake_llm([RUN_A, RUN_A, RUN_A])
    task_id = _create_task(client).json()["task_id"]
    wait_for_status(client, task_id, {"complete", "failed"})

    with client.websocket_connect(f"/ws/{task_id}") as websocket:
        snapshot = websocket.receive_json()
        assert snapshot["event"] == "status"
        assert snapshot["status"] == "complete"
        assert snapshot["completed_runs"] == 3
        assert snapshot["field_count"] == 5
