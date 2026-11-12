import copy
import base64
from test_integration import env, new, save, move, image
from app.domain import DEFAULT_CONFIG
from app.platform import project_files


def publish(client, cfg, version=1):
    r = client.post("/api/config", json={"definition": cfg, "base_version": version})
    assert r.status_code == 201, r.text
    return r.json()


def parallel_config():
    cfg = copy.deepcopy(DEFAULT_CONFIG)
    cfg["state_tree"] = [
        {
            "id": "Draft",
            "kind": "compound",
            "initial": "Preparing",
            "children": [{"id": "Preparing", "kind": "atomic"}],
        },
        {
            "id": "Submitted",
            "kind": "parallel",
            "children": [
                {
                    "id": "Facilities",
                    "kind": "compound",
                    "initial": "FacilityPending",
                    "children": [
                        {"id": "FacilityPending", "kind": "atomic"},
                        {"id": "FacilityDone", "kind": "final"},
                    ],
                },
                {
                    "id": "Safety",
                    "kind": "compound",
                    "initial": "SafetyPending",
                    "children": [
                        {"id": "SafetyPending", "kind": "atomic"},
                        {"id": "SafetyDone", "kind": "final"},
                    ],
                },
            ],
        },
        {"id": "Approved", "kind": "atomic"},
        {"id": "Closed", "kind": "final"},
    ]
    cfg["transitions"][1]["event"] = "completion"
    for prefix in ["Facility", "Safety"]:
        cfg["transitions"].append(
            {
                "id": prefix.lower(),
                "label": "Approve " + prefix,
                "source": prefix + "Pending",
                "target": prefix + "Done",
                "roles": ["supervisor", "administrator"],
                "require_note": False,
            }
        )
    cfg["transitions"][-1]["effects"] = [
        {"field": "observations", "formula": '="Approved by "&WORKFLOW.EVENTUSER()'}
    ]
    return cfg


def test_calculations_are_authoritative_and_initial_effects_run(env):
    c, _ = env
    cfg = copy.deepcopy(DEFAULT_CONFIG)
    cfg["fields"].append(
        {
            "id": "fahrenheit",
            "label": "Fahrenheit",
            "type": "number",
            "section": "Equipment checks",
            "required": False,
            "formula": "=temperature*9/5+32",
        }
    )
    cfg["state_tree"] = [
        {"id": s, "kind": "final" if s == "Closed" else "atomic"} for s in cfg["states"]
    ]
    cfg["state_tree"][0]["entry_effects"] = [
        {"field": "observations", "formula": '="Created by "&WORKFLOW.EVENTUSER()'}
    ]
    publish(c["alex"], cfg)
    r = new(c["maya"])
    assert r["values_json"]["observations"] == "Created by Maya Chen"
    r = c["maya"].put(
        f"/api/records/{r['id']}",
        json={"revision": 1, "values": {"temperature": 20, "fahrenheit": 999}},
    )
    assert r.status_code == 200, r.text
    assert r.json()["values_json"]["fahrenheit"] == 68
    r = c["maya"].post(
        "/api/forms/calculate", json={"definition": cfg, "values": {"temperature": 30}}
    )
    assert r.json()["computed"]["fahrenheit"] == 86


def test_parallel_completion_permissions_inherited_actions_and_simulation(env):
    c, _ = env
    cfg = parallel_config()
    publish(c["alex"], cfg)
    r = save(c["maya"], new(c["maya"]))
    assert r["active_states"] == ["Preparing"]
    r = move(c["maya"], r, "submit").json()
    assert set(r["active_states"]) == {"FacilityPending", "SafetyPending"}
    assert move(c["maya"], r, "facility").status_code == 403
    sim = c["james"].post(
        "/api/workflow/simulate",
        json={
            "definition": cfg,
            "state": r["state"],
            "active_states": r["active_states"],
            "transition_id": "facility",
            "role": "supervisor",
            "values": r["values_json"],
        },
    )
    assert sim.status_code == 200, sim.text
    r = move(c["james"], r, "facility").json()
    assert r["state"] == "Submitted"
    assert set(r["active_states"]) == set(sim.json()["active_states"])
    returned = move(c["james"], r, "return", "Needs correction")
    assert returned.status_code == 200, returned.text
    assert returned.json()["active_states"] == ["Preparing"]
    r = move(c["james"], returned.json(), "submit").json()
    r = move(c["james"], r, "facility").json()
    r = move(c["james"], r, "safety")
    assert r.status_code == 200, r.text
    r = r.json()
    assert r["state"] == "Approved" and r["active_states"] == ["Approved"]
    assert r["values_json"]["observations"] == "Approved by James Wilson"
    assert len([a for a in r["audit"] if a["action"] == "Approve inspection"]) == 1
    assert move(c["james"], r, "safety").status_code == 422
    assert move(c["james"], r, "close").json()["state"] == "Closed"


def test_completion_cannot_skip_tasks_created_in_same_transaction(env):
    c, _ = env
    cfg = parallel_config()
    cfg["evidence_on_exception"] = False
    cfg["transitions"][1]["target"] = "Closed"
    cfg["transitions"][-1]["create_exception_task"] = True
    cfg["transitions"][0]["create_exception_task"] = False
    # Keep Approved reachable via explicit parent action.
    cfg["transitions"].append(
        {
            "id": "bypass",
            "label": "Manual review",
            "source": "Submitted",
            "target": "Approved",
            "roles": ["administrator"],
            "require_note": True,
        }
    )
    publish(c["alex"], cfg)
    r = save(c["maya"], new(c["maya"]), 40)
    r = move(c["maya"], r, "submit").json()
    r = move(c["james"], r, "facility").json()
    response = move(c["james"], r, "safety")
    assert response.status_code == 409, response.text
    unchanged = c["james"].get(f"/api/records/{r['id']}").json()
    assert (
        unchanged["active_states"] == r["active_states"]
        and unchanged["revision"] == r["revision"]
    )
    simulation = c["james"].post(
        "/api/workflow/simulate",
        json={
            "definition": cfg,
            "state": r["state"],
            "active_states": r["active_states"],
            "transition_id": "safety",
            "role": "supervisor",
            "values": r["values_json"],
        },
    )
    assert simulation.status_code == 409


def test_rich_logbook_attachments_conflicts_and_download_auth(env):
    c, anonymous = env
    r = c["maya"].post(
        "/api/logbook",
        json={
            "asset_id": "AHU-01",
            "category": "Operations",
            "status": "Open",
            "priority": "Normal",
            "message": "ignored",
            "message_html": "<p>Inspect <strong>pump</strong><script>evil()</script></p>",
            "event_time": "2026-11-12T10:30:00Z",
        },
    )
    assert r.status_code == 201, r.text
    r = r.json()
    path = f"/api/logbook/{r['id']}"
    assert (
        r["message"] == "Inspect pump"
        and "<strong>pump</strong>" in r["message_html"]
        and "script" not in r["message_html"]
    )
    bad = c["maya"].post(
        path + "/attachments",
        data={"revision": r["revision"]},
        files={"file": ("fake.png", b"bad", "image/png")},
    )
    assert bad.status_code == 422
    uploaded = c["maya"].post(
        path + "/attachments",
        data={"revision": r["revision"]},
        files={"file": ("evidence.png", image(), "image/png")},
    )
    assert uploaded.status_code == 201, uploaded.text
    current = c["maya"].get(path).json()
    attachment = current["attachments"][0]
    download = path + "/attachments/" + attachment["id"]
    assert anonymous.get(download).status_code == 401
    assert c["maya"].get(download).content == image()
    assert "attachment" in c["maya"].get(download).headers["content-disposition"]
    assert (
        c["maya"]
        .post(
            path + "/attachments",
            data={"revision": r["revision"]},
            files={"file": ("notes.txt", b"hello", "text/plain")},
        )
        .status_code
        == 409
    )
    removed = c["maya"].delete(download, params={"revision": current["revision"]})
    assert removed.status_code == 200, removed.text
    assert c["maya"].get(download).status_code == 404
    assert not c["maya"].get(path).json()["attachments"]


def test_workspace_roundtrip_and_optimistic_locking(env):
    c, _ = env
    body = {
        "name": "Test workspace",
        "files": project_files(DEFAULT_CONFIG),
        "base_version": 1,
    }
    assert c["maya"].post("/api/workspace", json=body).status_code == 403
    result = c["alex"].post("/api/workspace", json=body)
    assert result.status_code == 201, result.text
    p = result.json()
    body["revision"] = p["revision"]
    body["files"]["README.md"] = "Edited project."
    assert c["alex"].put(f"/api/workspace/{p['id']}", json=body).status_code == 200
    assert c["alex"].put(f"/api/workspace/{p['id']}", json=body).status_code == 409
    package = c["alex"].get(f"/api/workspace/{p['id']}/package")
    assert package.status_code == 200
    inspected = c["alex"].post(
        "/api/packages/inspect",
        files={"file": ("project.zip", package.content, "application/zip")},
    )
    assert (
        inspected.status_code == 200
        and inspected.json()["files"]["README.md"] == "Edited project."
    )
    assert (
        c["alex"].post("/api/workspace", json={**body, "base_version": 999}).status_code
        == 422
    )


def test_controlled_release_separation_scope_pinning_and_history(env):
    c, _ = env
    before = new(c["maya"])
    boot = c["alex"].get("/api/bootstrap").json()
    area = next(a["building_id"] for a in boot["assets"] if a["id"] == "AHU-01")
    cfg = copy.deepcopy(DEFAULT_CONFIG)
    cfg["name"] = "Building-specific reviewed inspection"
    body = {
        "name": "Scoped facilities release",
        "definition": cfg,
        "scope": area,
        "base_version": 1,
    }
    result = c["alex"].post("/api/config-items", json=body)
    assert result.status_code == 201, result.text
    item = result.json()
    path = f"/api/config-items/{item['id']}"
    item = c["alex"].post(path + "/submit", json={"revision": item["revision"]}).json()
    assert (
        c["alex"]
        .post(
            path + "/approve",
            json={"revision": item["revision"], "note": "Self review"},
        )
        .status_code
        == 403
    )
    assert (
        c["maya"]
        .post(
            path + "/approve",
            json={"revision": item["revision"], "note": "No authority"},
        )
        .status_code
        == 403
    )
    assert (
        c["james"]
        .post(path + "/approve", json={"revision": item["revision"], "note": ""})
        .status_code
        == 422
    )
    item = (
        c["james"]
        .post(
            path + "/approve",
            json={"revision": item["revision"], "note": "Reviewed fields and states"},
        )
        .json()
    )
    assert (
        c["james"]
        .post(path + "/publish", json={"revision": item["revision"]})
        .status_code
        == 403
    )
    result = c["alex"].post(path + "/publish", json={"revision": item["revision"]})
    assert result.status_code == 200, result.text
    item = result.json()
    after = new(c["maya"])
    assert after["config_id"] == item["published_version"]
    assert (
        before["config_id"] == 1
        and c["alex"].get("/api/bootstrap").json()["config"]["id"] == 1
    )
    other = next(a for a in boot["assets"] if a["building_id"] != area)
    r = (
        c["maya"]
        .post(
            "/api/records",
            json={"title": "Unchanged global template", "asset_id": other["id"]},
        )
        .json()
    )
    assert r["config_id"] == 1
    history = c["alex"].get("/api/config-items").json()["history"]
    assert history[-1]["detail"]["definition"] == cfg
    assert (
        c["alex"].put(path, json={**body, "revision": item["revision"]}).status_code
        == 409
    )


def test_documented_query_shape_auth_and_explicit_contract(env):
    c, anonymous = env
    path = "/restserver/30/industraform/logbook-query-v2/campus_inspections"
    params = {"attribute_names": "EntryNumber,State,temperature,$Form.StateName"}
    assert anonymous.get(path, params=params).status_code == 401
    response = anonymous.get(
        path,
        params=params,
        headers={
            "Authorization": "Basic " + base64.b64encode(b"maya:campus-demo").decode()
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["values"][0]["EntryNumber"].startswith("INS-")
    assert "native-j5-unverified" in response.headers["x-implementation"]
    old = c["maya"].get(path.replace("-v2", ""), params=params)
    assert isinstance(old.json(), list)
    assert (
        c["maya"].get(path, params={**params, "invented_native_option": 1}).status_code
        == 400
    )
    assert (
        c["maya"].get(path, params={"attribute_names": "unknown_attribute"}).status_code
        == 200
    )
    assert (
        anonymous.get(
            path, params=params, headers={"Authorization": "Basic bad!"}
        ).status_code
        == 401
    )
    assert not c["maya"].get("/api/native-contract").json()["native_verified"]
    assert "/api/workspace" in c["alex"].get("/api/openapi.json").json()["paths"]
