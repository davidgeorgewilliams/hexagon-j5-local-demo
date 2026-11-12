import copy
import pytest
from fastapi import HTTPException
from app.domain import DEFAULT_CONFIG, validate_config
from app.formulas import Engine, FormulaError, validate_formulas
from app.platform import project_files, archive_bytes, inspect_archive, validate_files
from app.richtext import sanitize_html as sanitize
import io
import json
import zipfile


def sheet_config():
    cfg = copy.deepcopy(DEFAULT_CONFIG)
    cfg["sheet"] = {
        "rows": 12,
        "cols": 5,
        "cells": {
            "A1": {"value": 2},
            "A2": {"value": 3},
            "A3": {"value": 4},
            "B1": {"field": "temperature"},
        },
        "merges": [],
    }
    return cfg


@pytest.mark.parametrize(
    "expression,expected",
    [
        ("=2+3*4", 14),
        ("=-2^2", -4),
        ("=2^3^2", 512),
        ("=IF(TRUE,7,1/0)", 7),
        ("=IF(FALSE,7)", False),
        ("=IFERROR(1/0,9)", 9),
        ("=ROUND(2.345,2)", 2.35),
        ("=SUM(A1:A3,$B$1)", 33),
        ('=IF([temperature]>20,"Warm","Cool")', "Warm"),
        ('=LEFT("ABC",2)&LOWER("DE")', "ABde"),
        ("=WORKFLOW.EVENTUSER()", "Operator"),
        ("=AND(TRUE,NOT(FALSE))", True),
        ("=DATE(2026,11,12)", "2026-11-12"),
    ],
)
def test_formula_results(expression, expected):
    assert (
        Engine(
            sheet_config(), {"temperature": 24}, {"event_user": "Operator"}
        ).evaluate(expression)
        == expected
    )


@pytest.mark.parametrize(
    "expression",
    [
        '=__import__("os")',
        "=SUM(A1:Z100)",
        "=POWER(2,10000000)",
        "=1/0",
        "=A999",
        "=IF(",
        "=" + "(" * 100 + "1" + ")" * 100,
    ],
)
def test_formula_limits(expression):
    with pytest.raises(FormulaError):
        Engine(sheet_config()).evaluate(expression)


def test_static_cycles_include_range_interior_and_bindings():
    cfg = sheet_config()
    cfg["sheet"]["cells"]["A2"] = {"formula": "=SUM(A1:A3)"}
    with pytest.raises(FormulaError, match="CYCLE"):
        validate_formulas(cfg)
    cfg = sheet_config()
    cfg["fields"][0]["formula"] = "=B1+1"
    with pytest.raises(FormulaError, match="CYCLE"):
        validate_formulas(cfg)
    cfg = sheet_config()
    cfg["fields"][0]["formula"] = "=Z99"
    with pytest.raises(FormulaError, match="outside"):
        validate_formulas(cfg)


def test_sheet_validation():
    cfg = sheet_config()
    cfg["sheet"]["merges"] = [
        {"start": "A4", "end": "C4"},
        {"start": "B4", "end": "D4"},
    ]
    with pytest.raises(HTTPException):
        validate_config(cfg)
    cfg = sheet_config()
    cfg["sheet"]["cells"]["B1"]["field"] = "unknown"
    with pytest.raises(HTTPException):
        validate_config(cfg)


def test_sanitizer_preserves_formatting_removes_active_content():
    html, plain = sanitize(
        '<p onclick="alert(1)">Safe <strong>text</strong><script>bad()</script><svg><text>hidden</text></svg><a href="javascript:alert(1)">link</a></p>'
    )
    assert "<strong>text</strong>" in html
    assert all(
        x not in html
        for x in ["onclick", "script", "javascript", "svg", "bad()", "hidden"]
    )
    assert "Safe textlink" in plain
    html, _ = sanitize('<a href="https://example.com">safe</a>')
    assert "noopener" in html


def test_packages_roundtrip_checksums_and_unverified_native():
    files = project_files(sheet_config())
    result = inspect_archive(archive_bytes(files))
    assert result["importable"] and result["files"] == files
    assert validate_files(result["files"]) == sheet_config()
    with pytest.raises(HTTPException):
        validate_files({**files, "manifest.json": "{}"})
    for name in ["../escape.json", "/absolute.json"]:
        out = io.BytesIO()
        with zipfile.ZipFile(out, "w") as z:
            z.writestr(name, "{}")
        with pytest.raises(HTTPException):
            inspect_archive(out.getvalue())
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        z.writestr("unknown-native-template.xml", "<template/>")
    result = inspect_archive(out.getvalue())
    assert not result["importable"] and result["files"] == {}
    original = zipfile.ZipFile(io.BytesIO(archive_bytes(files)))
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        for name in original.namelist():
            z.writestr(name, original.read(name) if name != "README.md" else "tampered")
    with pytest.raises(HTTPException, match=""):
        inspect_archive(out.getvalue())
