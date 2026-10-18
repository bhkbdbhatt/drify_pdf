from __future__ import annotations

import math
import statistics
import uuid
from collections import Counter
from datetime import date, datetime
from typing import Any

from app.config import Settings, get_settings
from app.models import FieldDrift, Run, Task
from app.schemas import CompareField, DriftReport, ReportField, ReportSummary

_DATE_PREFIXES = ("19", "20", "21")


def detect_field_type(values: list[Any]) -> str:
    present = [v for v in values if v is not None]
    if not present:
        return "str"
    if all(_is_numeric(v) for v in present):
        return "numeric"
    if all(_is_array(v) for v in present):
        return "array"
    if all(_is_date(v) for v in present):
        return "date"
    return "str"


def _is_numeric(value: Any) -> bool:
    if isinstance(value, bool):
        return False
    if isinstance(value, (int, float)):
        return math.isfinite(float(value))
    if isinstance(value, str):
        try:
            float(value.replace(",", "").replace("$", "").replace("%", ""))
            return True
        except ValueError:
            return False
    return False


def _to_float(value: Any) -> float:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    return float(str(value).replace(",", "").replace("$", "").replace("%", ""))


def _is_array(value: Any) -> bool:
    return isinstance(value, (list, tuple))


def _is_date(value: Any) -> bool:
    if isinstance(value, (datetime, date)):
        return True
    if not isinstance(value, str):
        return False
    text = value.strip()
    if len(text) < 8 or not text[:4].isdigit() or not text[:2].isdigit():
        return False
    if not text.startswith(_DATE_PREFIXES):
        return False
    return text[4] in "-/" or (text[2] in "-" and text[:2].isdigit())


def levenshtein(a: str, b: str) -> int:
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)
    previous = list(range(len(b) + 1))
    for i, ca in enumerate(a, start=1):
        current = [i]
        for j, cb in enumerate(b, start=1):
            insert_cost = current[j - 1] + 1
            delete_cost = previous[j] + 1
            replace_cost = previous[j - 1] + (ca != cb)
            current.append(min(insert_cost, delete_cost, replace_cost))
        previous = current
    return previous[-1]


def normalized_edit_distance(a: str, b: str) -> float:
    longest = max(len(a), len(b))
    if longest == 0:
        return 0.0
    return levenshtein(a, b) / longest


def pairwise_edit_stats(texts: list[str]) -> dict[str, float]:
    if len(texts) < 2:
        return {"avg_normalized_edit_distance": 0.0, "max_normalized_edit_distance": 0.0}
    distances = [
        normalized_edit_distance(texts[i], texts[j])
        for i in range(len(texts))
        for j in range(i + 1, len(texts))
    ]
    return {
        "avg_normalized_edit_distance": round(statistics.fmean(distances), 4),
        "max_normalized_edit_distance": round(max(distances), 4),
    }


def _json_safe(value: Any) -> Any:
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, tuple):
        return list(value)
    if isinstance(value, float) and not math.isfinite(value):
        return str(value)
    return value


def compute_field_stats(
    field_name: str,
    per_run_values: list[Any],
    settings: Settings | None = None,
) -> dict[str, Any]:
    """Return the FieldDrift row payload for one field.

    `per_run_values` contains one entry per run (None when the field was absent).
    """
    settings = settings or get_settings()
    total = len(per_run_values)
    present = [v for v in per_run_values if v is not None]
    field_type = detect_field_type(per_run_values)

    serializable = [_json_safe(v) for v in present]
    if field_type == "numeric" and serializable:
        # Quantize floats onto the relative-tolerance grid so that noise
        # within NUMERIC_RELATIVE_TOLERANCE counts as the same value.
        numbers = [_to_float(v) for v in serializable]
        scale = max(abs(statistics.fmean(numbers)) * settings.numeric_relative_tolerance, 1e-12)
        keys = [str(int(round(n / scale))) for n in numbers]
    else:
        keys = [json_key(v) for v in serializable]
    counter = Counter(keys)
    most_common_count = counter.most_common(1)[0][1] if counter else 0
    consistency = round(most_common_count / total, 4) if total else 0.0

    unique_values = _unique_preserving_order(serializable)

    detail: dict[str, Any] = {"value_count": len(present), "missing_count": total - len(present)}
    detail.update(
        _type_detail(field_type, present, settings)
    )

    status = _classify_status(
        field_type=field_type,
        consistency=consistency,
        unique_count=len(unique_values),
        detail=detail,
        settings=settings,
    )

    # A stable numeric field is reported as its mean rather than raw float noise.
    if field_type == "numeric" and status == "stable" and present:
        unique_values = [round(statistics.fmean(_to_float(v) for v in present), 6)]
    capped_unique = unique_values[: settings.max_unique_values]

    return {
        "field_name": field_name,
        "field_type": field_type,
        "unique_values": capped_unique,
        "consistency": consistency,
        "status": status,
        "detail": detail,
    }


def json_key(value: Any) -> str:
    import json

    return json.dumps(value, sort_keys=True, default=str)


def _unique_preserving_order(values: list[Any]) -> list[Any]:
    seen: set[str] = set()
    out: list[Any] = []
    for value in values:
        key = json_key(value)
        if key not in seen:
            seen.add(key)
            out.append(value)
    return out


def _type_detail(field_type: str, values: list[Any], settings: Settings) -> dict[str, Any]:
    if not values:
        return {}
    if field_type == "numeric":
        numbers = [_to_float(v) for v in values]
        mean = statistics.fmean(numbers)
        std = statistics.pstdev(numbers) if len(numbers) > 1 else 0.0
        return {
            "mean": round(mean, 6),
            "std": round(std, 6),
            "min": round(min(numbers), 6),
            "max": round(max(numbers), 6),
            "count": len(numbers),
        }
    if field_type == "array":
        counts = [len(v) for v in values]
        variance = statistics.pvariance(counts) if len(counts) > 1 else 0.0
        return {
            "mean_count": round(statistics.fmean(counts), 4),
            "min_count": min(counts),
            "max_count": max(counts),
            "count_variance": round(variance, 4),
            "count": len(counts),
        }
    if field_type == "date":
        texts = [str(v) for v in values]
        return {
            "min": min(texts),
            "max": max(texts),
            "unique_count": len(set(texts)),
            "count": len(texts),
        }
    texts = [str(v) for v in values]
    stats = pairwise_edit_stats(texts)
    stats["unique_count"] = len(set(texts))
    stats["count"] = len(texts)
    return stats


def _classify_status(
    *,
    field_type: str,
    consistency: float,
    unique_count: int,
    detail: dict[str, Any],
    settings: Settings,
) -> str:
    if unique_count <= 1 and detail.get("missing_count", 0) == 0:
        return "stable"

    # Numeric drift within relative tolerance counts as stable (float noise).
    if field_type == "numeric" and detail.get("count", 0) > 1:
        mean = abs(detail.get("mean", 0.0))
        std = detail.get("std", 0.0)
        spread = detail.get("max", 0.0) - detail.get("min", 0.0)
        rel_std = std / mean if mean > 0 else (0.0 if std == 0 else float("inf"))
        if rel_std <= settings.numeric_relative_tolerance and (
            spread <= max(mean * settings.numeric_relative_tolerance * 2, 1e-9)
        ):
            if detail.get("missing_count", 0) == 0:
                return "stable"

    if consistency >= settings.stable_consistency_threshold:
        return "stable"
    if consistency >= settings.drift_consistency_threshold:
        return "drift"
    return "unstable"


def compute_drift_report(
    parsed_runs: list[dict[str, Any]],
    settings: Settings | None = None,
) -> list[dict[str, Any]]:
    """Per-field drift payloads across all successfully parsed runs."""
    settings = settings or get_settings()
    field_order: list[str] = []
    for run in parsed_runs:
        if not isinstance(run, dict):
            continue
        for key in run.keys():
            if key not in field_order:
                field_order.append(key)

    results = []
    for field in field_order:
        values = [run.get(field) for run in parsed_runs]
        results.append(compute_field_stats(field, values, settings))
    return results


STATUS_SEVERITY = {"unstable": 0, "drift": 1, "stable": 2}


def severity_key(drift: FieldDrift) -> tuple[int, float]:
    """Worst-first ordering: severity, then consistency ascending."""
    return (STATUS_SEVERITY.get(drift.status, 3), drift.consistency)


def build_report(
    task: Task,
    runs: list[Run],
    drifts: list[FieldDrift],
    settings: Settings | None = None,
) -> DriftReport:
    """Full drift report, shaped like the CLI tool's drift_summary.json."""
    settings = settings or get_settings()
    del settings  # thresholds applied when rows were computed

    total_runs = len(runs)
    success_runs = [r for r in runs if r.parse_success]
    parse_success_rate = (
        round(len(success_runs) / total_runs, 4) if total_runs else 0.0
    )

    ordered = sorted(drifts, key=severity_key)
    fields = [
        ReportField(
            field_name=d.field_name,
            field_type=d.field_type,  # type: ignore[arg-type]
            unique_values=d.unique_values,
            consistency=d.consistency,
            status=d.status,  # type: ignore[arg-type]
            detail=d.detail,
        )
        for d in ordered
    ]

    worst = ordered[0] if ordered else None
    summary = ReportSummary(
        total_fields=len(fields),
        stable=sum(1 for f in fields if f.status == "stable"),
        drift=sum(1 for f in fields if f.status == "drift"),
        unstable=sum(1 for f in fields if f.status == "unstable"),
        worst_field=worst.field_name if worst else None,
        worst_consistency=worst.consistency if worst else None,
    )

    return DriftReport(
        task_id=task.id,
        task_name=task.name,
        model=task.model,
        temperature=task.temperature,
        mode=task.mode,  # type: ignore[arg-type]
        num_runs=task.num_runs,
        parse_success_rate=parse_success_rate,
        fields=fields,
        summary=summary,
    )


def compare_drifts(
    task_a: Task,
    drifts_a: list[FieldDrift],
    task_b: Task,
    drifts_b: list[FieldDrift],
    *,
    similarity_gap: float = 0.1,
) -> list[CompareField]:
    """Side-by-side field diff (e.g. blackbox vs parsed mode on one PDF)."""
    by_a = {d.field_name: d for d in drifts_a}
    by_b = {d.field_name: d for d in drifts_b}
    names = list(dict.fromkeys([*by_a.keys(), *by_b.keys()]))

    results: list[CompareField] = []
    for name in names:
        a = by_a.get(name)
        b = by_b.get(name)
        if a is None:
            results.append(
                CompareField(
                    field_name=name,
                    verdict="missing_in_a",
                    consistency_gap=None,
                    a=None,
                    b=_side(b),
                )
            )
            continue
        if b is None:
            results.append(
                CompareField(
                    field_name=name,
                    verdict="missing_in_b",
                    consistency_gap=None,
                    a=_side(a),
                    b=None,
                )
            )
            continue

        gap = round(abs(a.consistency - b.consistency), 4)
        if a.status == b.status and a.status == "stable":
            verdict = "match"
        elif a.status == b.status and gap <= similarity_gap:
            verdict = "match" if a.status == "stable" else "similar"
        elif gap > similarity_gap and {a.status, b.status} == {"stable", "unstable"}:
            verdict = "diverges"
        elif a.status != b.status or gap > similarity_gap:
            verdict = "diverges"
        else:
            verdict = "similar"

        results.append(
            CompareField(
                field_name=name,
                verdict=verdict,  # type: ignore[arg-type]
                consistency_gap=gap,
                a=_side(a),
                b=_side(b),
            )
        )
    return results


def _side(drift: FieldDrift | None):  # type: ignore[no-untyped-def]
    if drift is None:
        return None
    from app.schemas import CompareSide

    return CompareSide(
        consistency=drift.consistency,
        status=drift.status,  # type: ignore[arg-type]
        field_type=drift.field_type,  # type: ignore[arg-type]
        unique_values=drift.unique_values,
        detail=drift.detail,
    )


def worst_field_of(drifts: list[FieldDrift]):  # type: ignore[no-untyped-def]
    from app.schemas import WorstField

    if not drifts:
        return None
    worst = min(drifts, key=severity_key)
    return WorstField(
        field_name=worst.field_name,
        consistency=worst.consistency,
        status=worst.status,  # type: ignore[arg-type]
    )
