"""Integration tests use real PostgreSQL in a temporary, isolated schema."""

import copy
import hashlib
import io
import uuid
import pytest
import psycopg
from psycopg import sql
from psycopg.conninfo import make_conninfo
from fastapi.testclient import TestClient
from PIL import Image
from app import db as database
from app import main
from app.domain import DEFAULT_CONFIG
from app.worker import tick


@pytest.fixture()
def env(monkeypatch, tmp_path):
    monkeypatch.setenv("REQUIRE_REVIEW", "false")
    original = database.DATABASE_URL
    schema = "test_" + uuid.uuid4().hex
    with psycopg.connect(original, autocommit=True) as c:
        c.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(schema)))
    monkeypatch.setattr(
        database,
        "DATABASE_URL",
        make_conninfo(original, options=f"-c search_path={schema}"),
    )
    monkeypatch.setattr(main, "FILES", tmp_path)
    clients = {}
    try:
        with TestClient(main.app) as root:
            for username in ["maya", "james", "alex"]:
                client = TestClient(main.app)
                assert (
                    client.post(
                        "/api/session",
                        json={"username": username, "password": main.DEMO_PASSWORD},
                    ).status_code
                    == 200
                )
                clients[username] = client
            yield clients, root
    finally:
        for client in clients.values():
            client.close()
        with psycopg.connect(original, autocommit=True) as c:
            c.execute(sql.SQL("DROP SCHEMA {} CASCADE").format(sql.Identifier(schema)))


def new(client):
    response = client.post(
        "/api/records",
        json={"title": "Integration test inspection", "asset_id": "AHU-01"},
    )
    assert response.status_code == 201, response.text
    return response.json()


def save(client, r, temperature=24):
    response = client.put(
        f"/api/records/{r['id']}",
        json={
            "revision": r["revision"],
            "values": {
                "temperature": temperature,
                "condition": "Normal",
                "access": True,
                "observations": "Verified during inspection.",
            },
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def move(client, r, transition, note=""):
    return client.post(
        f"/api/records/{r['id']}/transition",
        json={"revision": r["revision"], "transition_id": transition, "note": note},
    )


def image():
    out = io.BytesIO()
    Image.new("RGB", (80, 60), "steelblue").save(out, format="PNG")
    return out.getvalue()


def test_authentication_and_server_side_permissions(env):
    c, anonymous = env
    assert anonymous.get("/api/bootstrap").status_code == 401
    assert (
        anonymous.post(
            "/api/session", json={"username": "alex", "password": "incorrect"}
        ).status_code
        == 401
    )
    assert (
        c["maya"]
        .post("/api/config", json={"definition": DEFAULT_CONFIG, "base_version": 1})
        .status_code
        == 403
    )
    assert (
        c["maya"]
        .post("/api/sensor-events", json={"asset_id": "AHU-01", "temperature": 40})
        .status_code
        == 403
    )
    assert (
        c["maya"]
        .post(
            "/api/handovers",
            json={"shift": "Day → night", "note": "Ready for incoming crew."},
        )
        .status_code
        == 403
    )
    assert c["maya"].post("/internal/maintenance", json={}).status_code == 403


def test_full_inspection_lifecycle_and_role_guard(env):
    c, _ = env
    r = save(c["maya"], new(c["maya"]))
    response = move(c["maya"], r, "submit")
    assert response.status_code == 200
    r = response.json()
    assert move(c["maya"], r, "approve").status_code == 403
    response = move(c["james"], r, "approve")
    assert response.status_code == 200
    response = move(c["james"], response.json(), "close")
    assert response.status_code == 200
    assert response.json()["state"] == "Closed"
    assert (
        c["maya"]
        .put(
            f"/api/records/{r['id']}",
            json={"revision": response.json()["revision"], "values": {}},
        )
        .status_code
        == 409
    )
    assert len(response.json()["audit"]) == 5


def test_required_fields_invalid_types_and_unknown_fields(env):
    c, _ = env
    r = new(c["maya"])
    assert move(c["maya"], r, "submit").status_code == 422
    for values in [
        {"temperature": "hot"},
        {"temperature": True},
        {"condition": "Not a choice"},
        {"access": "true"},
        {"unknown": "value"},
    ]:
        assert (
            c["maya"]
            .put(f"/api/records/{r['id']}", json={"revision": 1, "values": values})
            .status_code
            == 422
        )


def test_exception_evidence_corrective_task_and_close_guard(env):
    c, anonymous = env
    r = save(c["maya"], new(c["maya"]), 40)
    assert move(c["maya"], r, "submit").status_code == 422
    content = image()
    upload = c["maya"].post(
        f"/api/records/{r['id']}/evidence",
        files={"file": ("equipment.png", content, "image/png")},
    )
    assert upload.status_code == 201, upload.text
    eid = upload.json()["id"]
    assert anonymous.get("/api/evidence/" + eid).status_code == 401
    assert c["maya"].get("/api/evidence/" + eid).content == content
    r = c["maya"].get(f"/api/records/{r['id']}").json()
    assert r["evidence"][0]["sha256"] == hashlib.sha256(content).hexdigest()
    response = move(c["maya"], r, "submit")
    assert response.status_code == 200
    r = response.json()
    assert r["priority"] == "High" and len(r["tasks"]) == 1
    r = move(c["james"], r, "approve").json()
    assert move(c["james"], r, "close").status_code == 409
    assert (
        c["maya"]
        .post(
            f"/api/tasks/{r['tasks'][0]['id']}/complete",
            json={"note": "Strainer replaced; temperature verified at 24 C."},
        )
        .status_code
        == 200
    )
    assert move(c["james"], r, "close").json()["state"] == "Closed"


def test_optimistic_locking_and_evidence_rejection(env):
    c, _ = env
    r = new(c["maya"])
    saved = save(c["maya"], r)
    assert (
        c["maya"]
        .put(f"/api/records/{r['id']}", json={"revision": r["revision"], "values": {}})
        .status_code
        == 409
    )
    assert (
        c["maya"]
        .post(
            f"/api/records/{r['id']}/evidence",
            files={"file": ("fake.png", b"not an image", "image/png")},
        )
        .status_code
        == 422
    )
    submitted = move(c["maya"], saved, "submit").json()
    assert (
        c["maya"]
        .post(
            f"/api/records/{r['id']}/evidence",
            files={"file": ("real.png", image(), "image/png")},
        )
        .status_code
        == 409
    )
    assert move(c["james"], submitted, "return").status_code == 422
    assert (
        move(c["james"], submitted, "return", "Please verify the reading.").json()[
            "state"
        ]
        == "Draft"
    )


def test_published_configuration_changes_new_records_only(env):
    c, _ = env
    old = new(c["maya"])
    cfg = copy.deepcopy(DEFAULT_CONFIG)
    cfg["fields"][0]["max"] = 50
    cfg["transitions"][0]["roles"] = ["administrator"]
    published = c["alex"].post(
        "/api/config", json={"definition": cfg, "base_version": 1}
    )
    assert published.status_code == 201, published.text
    assert (
        c["alex"]
        .post("/api/config", json={"definition": cfg, "base_version": 1})
        .status_code
        == 409
    )
    old_detail = c["maya"].get(f"/api/records/{old['id']}").json()
    assert old_detail["definition"]["fields"][0]["max"] == 32
    fresh = save(c["maya"], new(c["maya"]), 40)
    assert fresh["config_id"] == published.json()["id"] and fresh["exceptions"] == []
    assert move(c["maya"], fresh, "submit").status_code == 403
    assert move(c["alex"], fresh, "submit").status_code == 200


def test_invalid_configuration_is_rejected(env):
    c, _ = env
    for mutate in [
        lambda x: x.update(states=["Draft"]),
        lambda x: x["fields"].append(x["fields"][0]),
        lambda x: x["transitions"][0].update(roles=[]),
        lambda x: x.update(fields=[]),
        lambda x: x["transitions"][0].update(target="Closed"),
    ]:
        cfg = copy.deepcopy(DEFAULT_CONFIG)
        mutate(cfg)
        assert (
            c["alex"]
            .post("/api/config", json={"definition": cfg, "base_version": 1})
            .status_code
            == 422
        )


def test_handover_is_snapshot_and_acknowledgement_is_audited(env):
    c, _ = env
    h = (
        c["james"]
        .post(
            "/api/handovers",
            json={
                "shift": "Day → Night",
                "note": "Inspect cooling exception before next round.",
            },
        )
        .json()
    )
    count = len(h["snapshot"]["records"])
    new(c["maya"])
    fresh = c["maya"].get("/api/bootstrap").json()["handovers"][0]
    assert len(fresh["snapshot"]["records"]) == count
    assert (
        c["maya"]
        .post(f"/api/handovers/{h['id']}/acknowledge")
        .json()["acknowledged_by"]
        == "Maya Chen"
    )
    assert c["james"].post(f"/api/handovers/{h['id']}/acknowledge").status_code == 409


def test_worker_sensor_retry_idempotency_and_escalation(env, monkeypatch):
    c, anonymous = env
    event = c["james"].post(
        "/api/sensor-events", json={"asset_id": "CH-01", "temperature": 39}
    )
    assert event.status_code == 202
    tick()
    boot = c["james"].get("/api/bootstrap").json()
    assert boot["worker"]["healthy"]
    assert any(a["action"] == "Overdue task escalated" for a in boot["audit"])
    record = next(r for r in boot["records"] if r["owner_name"] == "Sensor gateway")
    assert record["state"] == "Draft" and record["open_tasks"] == 1
    import app.worker as worker

    monkeypatch.setattr(
        worker.httpx,
        "post",
        lambda url, **kwargs: anonymous.post(
            "/internal/maintenance",
            **{k: v for k, v in kwargs.items() if k != "timeout"},
        ),
    )
    tick()
    boot = c["james"].get("/api/bootstrap").json()
    j = next(j for j in boot["jobs"] if j["kind"] == "integration")
    assert j["status"] == "Retrying" and j["attempts"] == 1
    with database.db() as conn:
        conn.execute("UPDATE jobs SET available_at=now() WHERE id=%s", (j["id"],))
    tick()
    tick()
    boot = c["james"].get("/api/bootstrap").json()
    j = next(j for j in boot["jobs"] if j["kind"] == "integration")
    assert j["status"] == "Completed" and j["attempts"] == 2
    with database.db() as conn:
        assert (
            conn.execute("SELECT count(*) AS n FROM maintenance_receipts").fetchone()[
                "n"
            ]
            == 1
        )
    assert (
        len([a for a in boot["audit"] if a["action"] == "Overdue task escalated"]) == 1
    )


def test_worker_accepts_normal_readings_without_creating_work(env):
    c, _ = env
    c["james"].post("/api/sensor-events", json={"asset_id": "CH-01", "temperature": 24})
    tick()
    boot = c["james"].get("/api/bootstrap").json()
    assert len(boot["records"]) == 6
    assert boot["jobs"][0]["status"] == "Completed"


def test_import_validation_rejects_malformed_definitions_before_editor(env):
    c, _ = env
    for mutate in [
        lambda cfg: cfg["transitions"][0].update(source=[]),
        lambda cfg: cfg["fields"][0].update(section={}),
        lambda cfg: cfg.update(transitions=None),
    ]:
        cfg = copy.deepcopy(DEFAULT_CONFIG)
        mutate(cfg)
        response = c["alex"].post(
            "/api/config/validate", json={"definition": cfg, "base_version": 1}
        )
        assert response.status_code == 422, response.text
    assert (
        c["alex"]
        .post(
            "/api/config/validate",
            json={"definition": DEFAULT_CONFIG, "base_version": 1},
        )
        .status_code
        == 200
    )
    assert len(c["alex"].get("/api/bootstrap").json()["versions"]) == 1


def test_custom_states_guards_simulation_and_editability(env):
    c, _ = env
    cfg = copy.deepcopy(DEFAULT_CONFIG)
    cfg["states"].insert(2, "Engineering review")
    cfg["state_settings"] = {
        "Engineering review": {"editable": True, "x": 400, "y": 200}
    }
    cfg["transitions"][1]["target"] = "Engineering review"
    cfg["transitions"].append(
        {
            "id": "release",
            "label": "Release engineering review",
            "source": "Engineering review",
            "target": "Approved",
            "roles": ["supervisor"],
            "require_note": True,
            "guards": [
                {
                    "field": "temperature",
                    "op": "lte",
                    "value": 28,
                    "message": "Temperature must be 28 C or lower.",
                }
            ],
        }
    )
    published = c["alex"].post(
        "/api/config", json={"definition": cfg, "base_version": 1}
    )
    assert published.status_code == 201, published.text
    r = save(c["maya"], new(c["maya"]), 30)
    r = move(c["maya"], r, "submit").json()
    r = move(c["james"], r, "approve").json()
    assert r["state"] == "Engineering review"
    live = move(c["james"], r, "release", "Verified")
    simulated = c["james"].post(
        "/api/workflow/simulate",
        json={
            "definition": cfg,
            "transition_id": "release",
            "state": r["state"],
            "role": "supervisor",
            "values": r["values_json"],
            "note": "Verified",
        },
    )
    assert live.status_code == simulated.status_code == 422
    assert live.json()["detail"] == simulated.json()["detail"]
    assert move(c["maya"], r, "release", "Verified").status_code == 403
    r = save(c["james"], r, 24)
    assert move(c["james"], r, "release").status_code == 422
    assert move(c["james"], r, "release", "Verified").json()["state"] == "Approved"
    pinned = c["maya"].get("/api/records/1").json()
    assert "Engineering review" not in pinned["definition"]["states"]


def test_designer_rules_defaults_visibility_and_field_permissions(env):
    c, _ = env
    cfg = copy.deepcopy(DEFAULT_CONFIG)
    cfg["fields"][0]["default"] = 23
    cfg["fields"][0]["invalid_if"] = [
        {
            "field": "temperature",
            "op": "lt",
            "value": 0,
            "message": "Reading cannot be negative.",
        }
    ]
    cfg["fields"][0]["flag_if"] = [
        {
            "field": "temperature",
            "op": "gte",
            "value": 28,
            "message": "Review elevated reading.",
        }
    ]
    cfg["fields"].append(
        {
            "id": "review_date",
            "label": "Review date",
            "type": "date",
            "required": True,
            "section": "Review",
            "edit_roles": ["supervisor", "administrator"],
            "visible_if": [{"field": "temperature", "op": "gte", "value": 28}],
        }
    )
    assert (
        c["alex"]
        .post("/api/config", json={"definition": cfg, "base_version": 1})
        .status_code
        == 201
    )
    r = new(c["maya"])
    assert r["values_json"]["temperature"] == 23
    bad = {"temperature": -1}
    assert (
        c["maya"]
        .put(f"/api/records/{r['id']}", json={"values": bad, "revision": 1})
        .status_code
        == 422
    )
    assert (
        c["maya"]
        .put(
            f"/api/records/{r['id']}",
            json={"values": {"review_date": "2026-11-12"}, "revision": 1},
        )
        .status_code
        == 403
    )
    assert (
        c["james"]
        .put(
            f"/api/records/{r['id']}",
            json={"values": {"review_date": "not-a-date"}, "revision": 1},
        )
        .status_code
        == 422
    )
    r = save(c["maya"], r, 24)
    assert (
        move(c["maya"], r, "submit").status_code == 200
    )  # hidden required field does not block
    vals = {**r["values_json"], "temperature": 29}
    preview = c["maya"].post(
        "/api/forms/validate", json={"definition": cfg, "values": vals}
    )
    assert preview.status_code == 422 and "Review date" in preview.text
    vals["review_date"] = "2026-11-12"
    preview = c["maya"].post(
        "/api/forms/validate", json={"definition": cfg, "values": vals}
    )
    assert preview.status_code == 200 and preview.json()["exceptions"] == [
        "Review elevated reading."
    ]


def test_reject_invalid_graph_and_rule_references(env):
    c, _ = env
    mutations = [
        lambda cfg: cfg["states"].insert(1, "Unreachable"),
        lambda cfg: cfg["transitions"][0].update(
            guards=[{"field": "missing", "op": "eq", "value": 1}]
        ),
        lambda cfg: cfg["transitions"][0].update(
            guards=[{"field": "temperature", "op": "gt", "value": "hot"}]
        ),
        lambda cfg: cfg.update(state_settings={"Closed": {"editable": True}}),
        lambda cfg: cfg["transitions"][0].update(source="Closed"),
        lambda cfg: cfg["fields"][0].update(invalid_if={}),
    ]
    for mutate in mutations:
        cfg = copy.deepcopy(DEFAULT_CONFIG)
        mutate(cfg)
        response = c["alex"].post(
            "/api/config/validate", json={"definition": cfg, "base_version": 1}
        )
        assert response.status_code == 422, response.text


def test_logbook_crud_permissions_conflicts_notes_and_handover(env):
    c, anonymous = env
    assert anonymous.get("/api/logbook").status_code == 401
    body = {
        "asset_id": "AHU-01",
        "category": "Operations",
        "status": "Open",
        "priority": "High",
        "message": "Test property handover entry",
        "event_time": "2026-11-12T10:30:00Z",
        "add_to_handover": True,
    }
    created = c["maya"].post("/api/logbook", json=body)
    assert created.status_code == 201, created.text
    row = created.json()
    path = f"/api/logbook/{row['id']}"
    assert (
        c["maya"]
        .put(path, json={**body, "revision": 1, "status": "Closed"})
        .status_code
        == 403
    )
    saved = c["james"].put(path, json={**body, "revision": 1, "status": "On Hold"})
    assert saved.status_code == 200
    assert c["james"].put(path, json={**body, "revision": 1}).status_code == 409
    note = c["maya"].post(
        path + "/notes",
        json={"message": "Incoming team must verify readings.", "flagged": True},
    )
    assert note.status_code == 201
    assert len(note.json()["notes"]) == 1 and len(note.json()["history"]) == 3
    listed = next(
        r for r in c["james"].get("/api/logbook").json() if r["id"] == row["id"]
    )
    assert listed["flag_count"] == 1 and listed["note_count"] == 1
    handover = (
        c["james"]
        .post(
            "/api/handovers",
            json={"shift": "Day to night", "note": "Operational handover test"},
        )
        .json()
    )
    assert any(e["id"] == row["id"] for e in handover["snapshot"]["logbook"])
    closed = c["james"].put(path, json={**body, "revision": 2, "status": "Closed"})
    assert closed.status_code == 200 and closed.json()["closed_by"] == "James Wilson"
    assert c["maya"].put(path, json={**body, "revision": 3}).status_code == 403
    assert c["maya"].post(path + "/notes", json={"message": "   "}).status_code == 422
    assert (
        c["maya"]
        .post("/api/logbook", json={**body, "event_time": "2026-11-12T10:30:00"})
        .status_code
        == 422
    )
