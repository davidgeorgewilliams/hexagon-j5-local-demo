import copy, io, csv
import pytest
from test_integration import env, new, save, move, image
from test_extended import publish, parallel_config
from app.domain import DEFAULT_CONFIG, validate_config
from app.db import db
from app import compat
from app.timers import process_due
from app.xlsx_io import export_xlsx, import_xlsx
from fastapi import HTTPException
from psycopg.types.json import Jsonb


def table_config():
    cfg = copy.deepcopy(DEFAULT_CONFIG)
    cfg["option_lists"] = {
        "condition_base": {"values": ["Pass"]},
        "condition_all": {"extends": "condition_base", "values": ["Fail"]},
    }
    cfg["tables"] = [
        {
            "id": "checks",
            "label": "Building checks",
            "min_rows": 1,
            "max_rows": 10,
            "columns": [
                {
                    "id": "room",
                    "label": "Room",
                    "type": "text",
                    "required": True,
                    "section": "Row",
                },
                {
                    "id": "reading",
                    "label": "Reading",
                    "type": "number",
                    "required": True,
                    "section": "Row",
                    "max": 32,
                },
                {
                    "id": "result",
                    "label": "Result",
                    "type": "choice",
                    "required": True,
                    "section": "Row",
                    "option_list": "condition_all",
                },
                {
                    "id": "double_reading",
                    "label": "Doubled reading",
                    "type": "number",
                    "required": False,
                    "section": "Row",
                    "formula": "=reading*2",
                },
            ],
        }
    ]
    return cfg


def test_repeat_validation_calculation_and_query_flattening(env):
    c, _ = env
    cfg = table_config()
    publish(c["alex"], cfg)
    record = save(c["maya"], new(c["maya"]))
    assert move(c["maya"], record, "submit").status_code == 422
    values = {
        **record["values_json"],
        "checks": [
            {
                "room": "Apartment 101",
                "reading": 20,
                "result": "Pass",
                "double_reading": 999,
            },
            {"room": "Office 202", "reading": 25, "result": "Fail"},
        ],
    }
    response = c["maya"].put(
        f"/api/records/{record['id']}",
        json={"revision": record["revision"], "values": values},
    )
    assert response.status_code == 200, response.text
    record = response.json()
    assert record["values_json"]["checks"][0]["double_reading"] == 40
    path = "/restserver/30/industraform/logbook-query-v2/operator_rounds"
    response = c["maya"].get(
        path,
        params={
            "attribute_names": "room,reading,double_reading,$Form.UUID,unknown.IsDefined,unknown",
            "query_repeating": "true",
            "logid": record["native_uuid"],
        },
    )
    assert response.status_code == 200, response.text
    rows = response.json()["values"]
    assert len(rows) == 2 and rows[1]["double_reading"] == 50
    assert (
        rows[0]["$Form.UUID"] == rows[1]["$Form.UUID"]
        and not rows[0]["unknown.IsDefined"]
        and rows[0]["unknown"] is None
    )
    assert response.json()["nextLink"] is None
    csv_response = c["maya"].get(
        path,
        params={"attribute_names": "room,reading", "query_repeating": "true", "top": 1},
        headers={"Accept": "text/csv"},
    )
    assert len(list(csv.DictReader(io.StringIO(csv_response.text)))) == 1
    values["checks"][0]["result"] = "Invalid"
    assert (
        c["maya"]
        .put(
            f"/api/records/{record['id']}",
            json={"revision": record["revision"], "values": values},
        )
        .status_code
        == 422
    )


def test_query_pagination_filters_and_undefined_semantics(env, monkeypatch):
    c, _ = env
    monkeypatch.setattr(compat, "PAGE_SIZE", 2)
    path = "/restserver/30/industraform/logbook-query-v2/campus_inspections"
    response = c["maya"].get(
        path,
        params={
            "attribute_names": "EntryNumber,$Form.DateTime,unknown,unknown.IsDefined",
            "top": 5,
        },
    )
    assert response.status_code == 200, response.text
    seen = []
    while True:
        result = response.json()
        seen.extend(r["EntryNumber"] for r in result["values"])
        if not result["nextLink"]:
            break
        response = c["maya"].get(result["nextLink"])
    assert len(seen) == 5 and len(set(seen)) == 5
    assert (
        c["maya"]
        .get(path, params={"attribute_names": "unknown.IsDefined"})
        .json()["values"][0]["unknown.IsDefined"]
        is False
    )
    r = new(c["maya"])
    date = r["created_at"]
    assert (
        c["maya"]
        .get(
            path,
            params={
                "attribute_names": "logid",
                "logid": r["native_uuid"],
                "from_date_time": date,
            },
        )
        .json()["values"]
    )
    assert (
        not c["maya"]
        .get(
            path,
            params={
                "attribute_names": "logid",
                "logid": r["native_uuid"],
                "to_date_time": date,
            },
        )
        .json()["values"]
    )
    assert (
        c["maya"].get(path, params={"attribute_names": "$Form.CreatedTime"}).status_code
        == 400
    )
    assert (
        c["maya"]
        .get(path, params={"attribute_names": "EntryNumber", "skiptoken": "bogus"})
        .status_code
        == 400
    )


def test_area_permissions_cover_direct_routes_downloads_and_queries(env):
    c, _ = env
    boot = c["alex"].get("/api/bootstrap").json()
    record = new(c["maya"])
    area = next(a["building_id"] for a in boot["assets"] if a["id"] == "AHU-01")
    other = next(b["id"] for b in boot["buildings"] if b["id"] != area)
    photo = (
        c["maya"]
        .post(
            f"/api/records/{record['id']}/evidence",
            files={"file": ("proof.png", image(), "image/png")},
        )
        .json()["id"]
    )
    assert (
        c["alex"]
        .put("/api/access/maya", json={"areas": [other], "revision": 0})
        .status_code
        == 200
    )
    assert c["maya"].get(f"/api/records/{record['id']}").status_code == 403
    assert c["maya"].get(f"/api/evidence/{photo}").status_code == 403
    assert (
        c["maya"]
        .post(
            "/api/records",
            json={"title": "Unauthorized area check", "asset_id": "AHU-01"},
        )
        .status_code
        == 403
    )
    current = c["maya"].get("/api/bootstrap").json()
    assert all(a["building_id"] == other for a in current["assets"])
    assert c["maya"].get("/restserver/30/datapoints/asset/AHU-01").status_code == 403
    rows = (
        c["maya"]
        .get(
            "/restserver/30/industraform/logbook-query-v2/campus_inspections",
            params={"attribute_names": "Equipment"},
        )
        .json()["values"]
    )
    assert all(r["Equipment"] != "AHU-01" for r in rows)
    entries = c["alex"].get("/api/logbook").json()
    entry = next(x for x in entries if x["asset_id"] == "AHU-01")
    assert c["maya"].get(f"/api/logbook/{entry['id']}").status_code == 403
    assert (
        c["maya"]
        .post(
            f"/api/logbook/{entry['id']}/notes", json={"message": "Unauthorized note"}
        )
        .status_code
        == 403
    )
    result = c["maya"].get("/api/logbook/query").json()
    assert all(r["building_id"] == other for r in result["values"])
    assert (
        c["alex"]
        .put("/api/access/maya", json={"areas": None, "revision": 0})
        .status_code
        == 409
    )


def test_mandatory_review_rejects_direct_admin_publication(env, monkeypatch):
    c, _ = env
    monkeypatch.setenv("REQUIRE_REVIEW", "true")
    assert c["alex"].get("/api/bootstrap").json()["release_policy"]["review_required"]
    assert (
        c["alex"]
        .post("/api/config", json={"definition": DEFAULT_CONFIG, "base_version": 1})
        .status_code
        == 403
    )
    item = (
        c["alex"]
        .post(
            "/api/config-items",
            json={
                "name": "Reviewed mandatory release",
                "definition": DEFAULT_CONFIG,
                "base_version": 1,
            },
        )
        .json()
    )
    path = f"/api/config-items/{item['id']}"
    assert (
        c["alex"]
        .post(path + "/publish", json={"revision": item["revision"]})
        .status_code
        == 409
    )
    item = c["alex"].post(path + "/submit", json={"revision": item["revision"]}).json()
    assert (
        c["alex"]
        .post(
            path + "/approve",
            json={"revision": item["revision"], "note": "Self approve"},
        )
        .status_code
        == 403
    )
    item = (
        c["james"]
        .post(
            path + "/approve",
            json={"revision": item["revision"], "note": "Independent checks complete"},
        )
        .json()
    )
    assert (
        c["alex"]
        .post(path + "/publish", json={"revision": item["revision"]})
        .status_code
        == 200
    )


def test_durable_timer_completes_once_and_records_guard_failure(env):
    c, _ = env
    cfg = copy.deepcopy(DEFAULT_CONFIG)
    cfg["transitions"][1].update(event="timer", after_seconds=1)
    publish(c["alex"], cfg)
    record = save(c["maya"], new(c["maya"]))
    record = move(c["maya"], record, "submit").json()
    assert record["timers"][0]["status"] == "Pending"
    assert move(c["james"], record, "approve").status_code == 422
    with db() as conn:
        conn.execute("UPDATE workflow_timers SET due_at=now()-interval '1 second'")
    process_due()
    process_due()
    record = c["james"].get(f"/api/records/{record['id']}").json()
    assert record["state"] == "Approved"
    assert len([x for x in record["audit"] if x["action"] == "Approve inspection"]) == 1
    cfg["transitions"][1]["guard_formula"] = "=FALSE()"
    publish(c["alex"], cfg, 2)
    record = move(c["maya"], save(c["maya"], new(c["maya"])), "submit").json()
    with db() as conn:
        conn.execute(
            "UPDATE workflow_timers SET due_at=now()-interval '1 second' WHERE status='Pending'"
        )
    process_due()
    record = c["james"].get(f"/api/records/{record['id']}").json()
    assert record["state"] == "Submitted" and record["timers"][0]["status"] == "Blocked"
    assert (
        c["maya"]
        .post(f"/api/records/{record['id']}/timers/{record['timers'][0]['id']}/retry")
        .status_code
        == 403
    )


def test_deep_history_restores_parallel_progress(env):
    c, _ = env
    cfg = parallel_config()
    cfg["state_tree"][1]["history"] = "deep"
    cfg["transitions"][0]["use_history"] = True
    publish(c["alex"], cfg)
    r = move(c["maya"], save(c["maya"], new(c["maya"])), "submit").json()
    r = move(c["james"], r, "facility").json()
    r = move(c["james"], r, "return", "Revise evidence").json()
    r = move(c["james"], r, "submit").json()
    assert set(r["active_states"]) == {"FacilityDone", "SafetyPending"}
    r = move(c["james"], r, "safety").json()
    assert r["state"] == "Approved"


def test_master_data_batch_contract_and_datapoint_history(env):
    c, _ = env
    areas = c["maya"].get("/restserver/30/area_hierarchy/areas").json()
    assert areas["responseCode"] == 200 and areas["nextLink"] is None
    area = areas["areas"][1]["name"]
    path = "/restserver/30/asset_register/assets"
    body = {
        "batchNumber": 1,
        "totalBatches": 2,
        "assets": [
            {
                "asset_name": "TEST-01",
                "description": "Test ventilation",
                "area": area,
                "parent": None,
            }
        ],
    }
    assert c["maya"].put(path, json=body).status_code == 403
    transaction = c["alex"].put(path, json=body)
    assert transaction.status_code == 200, transaction.text
    tid = transaction.json()["transactionID"]
    assert (
        not c["alex"]
        .get("/restserver/30/asset_register/searchAsset/TEST-01")
        .json()["matchingAssets"]
    )
    assert c["alex"].put(path, json={**body, "transactionID": tid}).status_code == 200
    body2 = {
        **body,
        "batchNumber": 2,
        "transactionID": tid,
        "assets": [
            {
                "asset_name": "TEST-02",
                "description": "Test pump",
                "area": area,
                "parent": "TEST-01",
            }
        ],
    }
    assert c["alex"].put(path, json=body2).status_code == 200
    assert (
        len(
            c["alex"]
            .get("/restserver/30/asset_register/searchAsset/TEST-")
            .json()["matchingAssets"]
        )
        == 2
    )
    assert c["alex"].put(path, json=body2).status_code == 200
    assert (
        c["james"]
        .post("/api/sensor-events", json={"asset_id": "TEST-01", "temperature": 24})
        .status_code
        == 202
    )
    response = c["maya"].get(
        "/restserver/30/datapoints/history/get/TEST-01.temperature"
    )
    assert response.status_code == 200, response.text
    assert (
        response.json()["records"][0]["value"] == "24.0"
        and response.json()["meta"]["nextLink"] is None
    )
    assert (
        c["maya"]
        .get("/restserver/30/datapoints/history/list/TEST-01.temperature")
        .status_code
        == 400
    )
    result = (
        c["maya"]
        .get("/ssf/datastore/predefined/area_hierarchy?flathierarchy=true")
        .json()
    )
    assert result["type"] == "flathierarchy"


def test_xlsx_layout_and_binding_roundtrip():
    cfg = table_config()
    cfg["sheet"] = {
        "rows": 5,
        "cols": 28,
        "cells": {
            "A1": {
                "value": "Property checks",
                "style": {"bold": True, "background": "#aabbcc"},
            },
            "B2": {"field": "temperature"},
            "AA3": {"formula": "=SUM(2,3)"},
        },
        "merges": [{"start": "A1", "end": "D1"}],
    }
    result = import_xlsx(export_xlsx(cfg))["definition"]
    assert result["sheet"]["cells"]["B2"]["field"] == "temperature"
    assert result["sheet"]["cells"]["AA3"]["formula"] == "=SUM(2,3)"
    assert result["sheet"]["merges"] == cfg["sheet"]["merges"]
    assert result["tables"][0]["columns"][2]["options"] == ["Pass", "Fail"]


def test_logbook_server_paging_filtering_and_csv(env):
    c, _ = env
    first = (
        c["maya"]
        .get(
            "/api/logbook/query",
            params={"limit": 2, "offset": 0, "sort": "id", "ascending": "true"},
        )
        .json()
    )
    second = (
        c["maya"]
        .get(
            "/api/logbook/query",
            params={"limit": 2, "offset": 2, "sort": "id", "ascending": "true"},
        )
        .json()
    )
    assert (
        first["total"] >= 6
        and len(first["values"]) == 2
        and first["values"][0]["id"] != second["values"][0]["id"]
    )
    rows = (
        c["maya"]
        .get("/api/logbook/query", params={"status": "Closed"})
        .json()["values"]
    )
    assert rows and all(x["status"] == "Closed" for x in rows)
    csv_response = c["maya"].get("/api/logbook/export.csv", params={"status": "Closed"})
    assert csv_response.status_code == 200
    assert all(
        row["status"] == "Closed"
        for row in csv.DictReader(io.StringIO(csv_response.text.lstrip("\ufeff")))
    )


def test_extended_lookup_and_conditional_formulas():
    from app.formulas import Engine, FormulaError

    cfg = {
        "fields": [],
        "sheet": {
            "rows": 4,
            "cols": 3,
            "cells": {
                "A1": {"value": "Pump"},
                "B1": {"value": 12},
                "A2": {"value": "Valve"},
                "B2": {"value": 30},
                "A3": {"value": "pump"},
                "B3": {"value": 40},
            },
        },
    }
    engine = Engine(cfg)
    for formula, expected in {
        '=COUNTIF(A1:A3,"pump")': 2,
        '=COUNTIF(B1:B3,">=30")': 2,
        '=SUMIF(A1:A3,"Pump",B1:B3)': 52,
        '=SUMIF(B1:B3,">20")': 70,
        "=COUNTBLANK(A1:A4)": 1,
        "=INDEX(A1:B3,2,2)": 30,
        '=MATCH("valve",A1:A3,0)': 2,
        '=VLOOKUP("Valve",A1:B3,2,FALSE)': 30,
        '=HLOOKUP("Pump",A1:B3,3,FALSE)': "pump",
        '=EXACT("Pump","pump")': False,
        '=SEARCH("PUMP","Main pump")': 6,
        '=FIND("p","Pump",2)': 4,
    }.items():
        assert engine.evaluate(formula) == expected, formula
    for formula in [
        '=VLOOKUP("Valve",A1:B3,2,TRUE)',
        '=MATCH("Valve",A1:A3,1)',
        "=INDEX(A1:B3,4,2)",
        '=SUMIF(A1:A3,"Pump",B1:B2)',
        '=VLOOKUP("Missing",A1:B3,2,FALSE)',
    ]:
        with pytest.raises(FormulaError):
            engine.evaluate(formula)


def test_repeating_column_permissions_and_library_cycles(env):
    c, _ = env
    cfg = table_config()
    cfg["tables"][0]["columns"][0]["edit_roles"] = ["administrator"]
    publish(c["alex"], cfg)
    record = new(c["alex"])
    values = {"checks": [{"room": "Secure room", "reading": 24, "result": "Pass"}]}
    response = c["alex"].put(
        f"/api/records/{record['id']}",
        json={"revision": record["revision"], "values": values},
    )
    assert response.status_code == 200, response.text
    record = response.json()
    values["checks"][0]["room"] = "Changed"
    assert (
        c["maya"]
        .put(
            f"/api/records/{record['id']}",
            json={"revision": record["revision"], "values": values},
        )
        .status_code
        == 403
    )
    values["checks"] = []
    assert (
        c["maya"]
        .put(
            f"/api/records/{record['id']}",
            json={"revision": record["revision"], "values": values},
        )
        .status_code
        == 403
    )
    cfg["option_lists"]["condition_base"]["extends"] = "condition_all"
    with pytest.raises(HTTPException):
        validate_config(cfg)
    cfg = table_config()
    cfg["tables"][0]["columns"][0]["id"] = "temperature"
    with pytest.raises(HTTPException):
        validate_config(cfg)


def test_runner_execution_trace_auth_timeout_and_environment():
    from fastapi.testclient import TestClient
    from app.runner import app

    client = TestClient(app)
    headers = {"X-Runner-Token": "local-execution-token"}
    assert client.post("/run", json={"source": "print(1)"}).status_code == 403
    response = client.post(
        "/run",
        headers=headers,
        json={
            "source": 'import os\nx = 6\ny = x * 7\nprint(y)\nassert "DATABASE_URL" not in os.environ\nassert "RUNNER_TOKEN" not in os.environ',
            "debug": True,
        },
    )
    result = response.json()
    assert result["exit_code"] == 0 and result["stdout"].strip() == "42", response.text
    assert any(e["locals"].get("y") == "42" for e in result["trace"])
    response = client.post(
        "/run", headers=headers, json={"source": "import time\ntime.sleep(30)"}
    )
    assert response.json()["timed_out"] and response.json()["exit_code"] != 0


def test_timer_cancels_on_departure_and_rearms_on_reentry(env):
    c, _ = env
    cfg = copy.deepcopy(DEFAULT_CONFIG)
    cfg["transitions"][1].update(event="timer", after_seconds=60)
    publish(c["alex"], cfg)
    r = move(c["maya"], save(c["maya"], new(c["maya"])), "submit").json()
    first = r["timers"][0]["id"]
    r = move(c["james"], r, "return", "Correct the report").json()
    assert r["timers"][0]["status"] == "Cancelled"
    with db() as conn:
        conn.execute("UPDATE workflow_timers SET due_at=now()-interval '1 second'")
    process_due()
    r = c["maya"].get(f"/api/records/{r['id']}").json()
    assert r["state"] == "Draft"
    r = move(c["maya"], r, "submit").json()
    assert r["timers"][0]["status"] == "Pending" and r["timers"][0]["id"] != first


def test_shallow_history_restarts_parallel_children(env):
    c, _ = env
    cfg = parallel_config()
    cfg["state_tree"][1]["history"] = "shallow"
    cfg["transitions"][0]["use_history"] = True
    publish(c["alex"], cfg)
    r = move(c["maya"], save(c["maya"], new(c["maya"])), "submit").json()
    r = move(c["james"], r, "facility").json()
    r = move(c["james"], r, "return", "Revise report").json()
    r = move(c["james"], r, "submit").json()
    assert set(r["active_states"]) == {"FacilityPending", "SafetyPending"}


def test_asset_hierarchy_cycles_rejected_atomically(env):
    c, _ = env
    area = c["alex"].get("/api/bootstrap").json()["buildings"][0]["id"]
    response = c["alex"].put(
        "/restserver/30/asset_register/assets",
        json={
            "batchNumber": 1,
            "totalBatches": 1,
            "assets": [
                {
                    "asset_name": "CYCLE-A",
                    "description": "A",
                    "area": area,
                    "parent": "CYCLE-B",
                },
                {
                    "asset_name": "CYCLE-B",
                    "description": "B",
                    "area": area,
                    "parent": "CYCLE-A",
                },
            ],
        },
    )
    assert response.status_code == 400
    assert (
        not c["alex"]
        .get("/restserver/30/asset_register/searchAsset/CYCLE-")
        .json()["matchingAssets"]
    )
