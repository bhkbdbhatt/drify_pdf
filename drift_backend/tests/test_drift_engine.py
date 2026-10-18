from __future__ import annotations

from app.config import get_settings
from app.services.drift_engine import (
    compute_drift_report,
    compute_field_stats,
    detect_field_type,
    levenshtein,
    normalized_edit_distance,
)


def test_detect_field_type():
    assert detect_field_type([1, 2, 3]) == "numeric"
    assert detect_field_type(["1.5", "2,000"]) == "numeric"
    assert detect_field_type(["a", "b"]) == "str"
    assert detect_field_type([["x"], ["y", "z"]]) == "array"
    assert detect_field_type(["2024-05-12", "1999/01/31"]) == "date"
    assert detect_field_type([None, "abc"]) == "str"


def test_levenshtein():
    assert levenshtein("", "abc") == 3
    assert levenshtein("kitten", "sitting") == 3
    assert levenshtein("same", "same") == 0
    assert normalized_edit_distance("abc", "abc") == 0.0
    assert normalized_edit_distance("", "abc") == 1.0


def test_stable_field():
    stats = compute_field_stats(
        "invoice_no",
        ["INV-001", "INV-001", "INV-001"],
        get_settings(),
    )
    assert stats["status"] == "stable"
    assert stats["consistency"] == 1.0
    assert stats["field_type"] == "str"
    assert stats["unique_values"] == ["INV-001"]


def test_numeric_field_within_tolerance_is_stable():
    stats = compute_field_stats(
        "total", [1234.56, 1234.5600001, 1234.5599999], get_settings()
    )
    assert stats["field_type"] == "numeric"
    assert stats["status"] == "stable"
    assert {"mean", "std", "min", "max"} <= set(stats["detail"])


def test_numeric_field_with_real_drift():
    stats = compute_field_stats("total", [100.0, 200.0, 300.0], get_settings())
    assert stats["field_type"] == "numeric"
    assert stats["status"] in ("drift", "unstable")
    assert stats["detail"]["min"] == 100.0
    assert stats["detail"]["max"] == 300.0
    assert stats["detail"]["std"] > 0


def test_str_drift_and_edit_distance_detail():
    stats = compute_field_stats(
        "note",
        [
            "payment received",
            "payment recieved",
            "paymnt received",
            "totally different",
        ],
        get_settings(),
    )
    assert stats["field_type"] == "str"
    assert stats["status"] in ("drift", "unstable")
    assert stats["detail"]["avg_normalized_edit_distance"] > 0
    assert stats["detail"]["unique_count"] == 4


def test_array_count_variance():
    stats = compute_field_stats(
        "items", [["a"], ["a", "b"], ["a", "b", "c"]], get_settings()
    )
    assert stats["field_type"] == "array"
    assert stats["detail"]["min_count"] == 1
    assert stats["detail"]["max_count"] == 3
    assert stats["detail"]["count_variance"] > 0
    assert stats["status"] != "stable"


def test_missing_field_reduces_consistency():
    stats = compute_field_stats(
        "optional", ["x", "x", None, "x"], get_settings()
    )
    assert stats["consistency"] == 0.75
    assert stats["detail"]["missing_count"] == 1
    assert stats["status"] != "stable"


def test_compute_drift_report_unions_fields():
    runs = [
        {"a": 1, "b": "x"},
        {"a": 2, "b": "y"},
        {"a": 3},
    ]
    report = compute_drift_report(runs, get_settings())
    names = [row["field_name"] for row in report]
    assert names == ["a", "b"]
    by_name = {row["field_name"]: row for row in report}
    assert by_name["b"]["consistency"] == 0.3333
