import hashlib
import io
import os
import secrets
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any
from fastapi import FastAPI, Depends, Request, Response, UploadFile, File, HTTPException
from fastapi.responses import FileResponse
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, Field
from psycopg.types.json import Jsonb
from .db import db
from .domain import (
    USERS,
    audit,
    reject,
    validate_config,
    validate_values,
    exceptions,
    create_task,
    can_edit,
    check_transition,
    prepare_values,
)
from .access import (
    identity,
    asset_access,
    record_access,
    log_access,
    handover_access,
    scope_bootstrap,
    review_required,
)
from .seed import initialize
from .workflows import (
    initialize_workflow,
    active_leaves,
    source_active,
    advance,
    WorkflowError,
)
from .timers import sync_timers
from .formulas import FormulaError
from datetime import datetime, timezone

FILES = Path(os.getenv("FILE_DIR", "/data/evidence"))
DEMO_PASSWORD = os.getenv("DEMO_PASSWORD", "campus-demo")
INTERNAL_TOKEN = os.getenv("INTERNAL_TOKEN", "local-worker-demo-token")


@asynccontextmanager
async def lifespan(app):
    initialize()
    from .compat_data import seed_points

    seed_points()
    from .logbook import seed_logbook

    seed_logbook()
    FILES.mkdir(parents=True, exist_ok=True)
    yield


app = FastAPI(
    title="Campus Operations · independent J5-inspired demo",
    version="1.0.0",
    lifespan=lifespan,
)


def user(request: Request):
    token = request.cookies.get("campus_session", "")
    with db() as c:
        row = c.execute(
            "SELECT username FROM sessions WHERE token_hash=%s AND expires_at>now()",
            (hashlib.sha256(token.encode()).hexdigest(),),
        ).fetchone()
    if not row or row["username"] not in USERS:
        reject("Sign in to continue.", 401)
    return identity(row["username"])


def admin(u=Depends(user)):
    if u["role"] != "administrator":
        reject("Administrator access is required.", 403)
    return u


class Login(BaseModel):
    username: str
    password: str


@app.post("/api/session")
def login(body: Login, response: Response):
    if body.username not in USERS or not secrets.compare_digest(
        body.password, DEMO_PASSWORD
    ):
        reject("Incorrect demo account or password.", 401)
    token = secrets.token_urlsafe(32)
    with db() as c:
        c.execute("DELETE FROM sessions WHERE expires_at<now()")
        c.execute(
            "INSERT INTO sessions(token_hash,username) VALUES(%s,%s)",
            (hashlib.sha256(token.encode()).hexdigest(), body.username),
        )
    response.set_cookie(
        "campus_session", token, httponly=True, samesite="strict", max_age=43200
    )
    return identity(body.username)


@app.delete("/api/session")
def logout(request: Request, response: Response):
    with db() as c:
        c.execute(
            "DELETE FROM sessions WHERE token_hash=%s",
            (
                hashlib.sha256(
                    request.cookies.get("campus_session", "").encode()
                ).hexdigest(),
            ),
        )
    response.delete_cookie("campus_session")
    return {"ok": True}


@app.get("/api/health")
def health():
    with db() as c:
        c.execute("SELECT 1")
        worker = c.execute(
            "SELECT last_seen, last_seen>now()-interval '20 seconds' AS healthy FROM worker_health WHERE id=1"
        ).fetchone()
    return {"api": "healthy", "database": "healthy", "worker": worker}


@app.get("/api/bootstrap")
def bootstrap(u=Depends(user)):
    with db() as c:
        return scope_bootstrap(
            {
                "user": u,
                "buildings": c.execute(
                    "SELECT * FROM buildings ORDER BY name"
                ).fetchall(),
                "assets": c.execute(
                    "SELECT a.*, b.name AS building_name FROM assets a JOIN buildings b ON b.id=a.building_id WHERE NOT a.deleted ORDER BY a.id"
                ).fetchall(),
                "records": c.execute(
                    "SELECT r.*,a.building_id,a.name AS asset_name,b.name AS building_name,(SELECT count(*) FROM tasks t WHERE t.record_id=r.id AND t.status='Open') AS open_tasks FROM records r JOIN assets a ON r.asset_id=a.id JOIN buildings b ON a.building_id=b.id ORDER BY r.created_at DESC"
                ).fetchall(),
                "tasks": c.execute(
                    "SELECT t.*,r.title AS record_title,a.building_id FROM tasks t JOIN records r ON r.id=t.record_id JOIN assets a ON a.id=r.asset_id ORDER BY t.due_at"
                ).fetchall(),
                "config": c.execute(
                    "SELECT * FROM config_versions WHERE is_global ORDER BY id DESC LIMIT 1"
                ).fetchone(),
                "versions": c.execute(
                    "SELECT id,published_by,created_at,definition->>'name' AS name FROM config_versions ORDER BY id DESC"
                ).fetchall(),
                "jobs": c.execute(
                    "SELECT * FROM jobs ORDER BY id DESC LIMIT 50"
                ).fetchall(),
                "audit": c.execute(
                    "SELECT * FROM audit ORDER BY id DESC LIMIT 150"
                ).fetchall(),
                "handovers": c.execute(
                    "SELECT * FROM handovers ORDER BY id DESC LIMIT 30"
                ).fetchall(),
                "worker": c.execute(
                    "SELECT last_seen, last_seen>now()-interval '20 seconds' AS healthy FROM worker_health WHERE id=1"
                ).fetchone(),
            }
        )


class NewRecord(BaseModel):
    title: str = Field(min_length=3, max_length=180)
    asset_id: str
    category: str = "Inspection"


@app.post("/api/records", status_code=201)
def new_record(body: NewRecord, u=Depends(user)):
    if len(body.title.strip()) < 3:
        reject("An inspection title must contain at least three non-blank characters.")
    if body.category not in ["Inspection", "Maintenance", "Safety", "Operations"]:
        reject("Unknown category.")
    with db() as c:
        if not c.execute(
            "SELECT id FROM assets WHERE id=%s AND NOT deleted", (body.asset_id,)
        ).fetchone():
            reject("Choose an existing asset.")
        asset_access(c, u, body.asset_id)
        published = c.execute(
            "SELECT id,definition FROM config_versions WHERE is_global ORDER BY id DESC LIMIT 1"
        ).fetchone()
        scoped = c.execute(
            "SELECT cv.* FROM config_versions cv JOIN config_bindings b ON b.config_id=cv.id JOIN assets a ON a.building_id=b.scope WHERE a.id=%s",
            (body.asset_id,),
        ).fetchone()
        published = scoped or published
        version = published["id"]
        defaults = {
            f["id"]: f["default"]
            for f in published["definition"]["fields"]
            if "default" in f
        }
        try:
            initial = initialize_workflow(
                published["definition"],
                defaults,
                {
                    "event_user": u["name"],
                    "event_time": datetime.now(timezone.utc).isoformat(),
                },
            )
        except (WorkflowError, FormulaError) as error:
            reject(str(error))
        validate_values(published["definition"], initial["values"])
        row = c.execute(
            "INSERT INTO records(title,asset_id,category,config_id,owner_name,values_json,active_states) VALUES(%s,%s,%s,%s,%s,%s,%s) RETURNING *",
            (
                body.title.strip(),
                body.asset_id,
                body.category,
                version,
                u["name"],
                Jsonb(initial["values"]),
                Jsonb(initial["active_states"]),
            ),
        ).fetchone()
        audit(
            c,
            u["name"],
            "Inspection created",
            row["id"],
            config_version=version,
            effects=initial["effects"],
        )
        sync_timers(c, row["id"], published["definition"], initial["active_states"])
        return row


def locked_record(c, rid, u=None):
    row = c.execute("SELECT * FROM records WHERE id=%s FOR UPDATE", (rid,)).fetchone()
    if not row:
        reject("Inspection not found.", 404)
    if u:
        asset_access(c, u, row["asset_id"])
    cfg = c.execute(
        "SELECT definition FROM config_versions WHERE id=%s", (row["config_id"],)
    ).fetchone()["definition"]
    return row, cfg


@app.get("/api/records/{rid}")
def record(rid: int, u=Depends(user)):
    with db() as c:
        r, cfg = locked_record(c, rid, u)
        return {
            **r,
            "definition": cfg,
            "timers": c.execute(
                "SELECT * FROM workflow_timers WHERE record_id=%s ORDER BY id DESC",
                (rid,),
            ).fetchall(),
            "active_states": active_leaves(cfg, r["state"], r.get("active_states")),
            "editable": can_edit(cfg, r["state"], r.get("active_states")),
            "available_transitions": [
                t["id"]
                for t in cfg["transitions"]
                if t.get("event", "manual") == "manual"
                and source_active(
                    cfg,
                    t["source"],
                    active_leaves(cfg, r["state"], r.get("active_states")),
                )
            ],
            "exceptions": exceptions(cfg, r["values_json"]),
            "evidence": c.execute(
                "SELECT * FROM evidence WHERE record_id=%s ORDER BY created_at", (rid,)
            ).fetchall(),
            "audit": c.execute(
                "SELECT * FROM audit WHERE record_id=%s ORDER BY id DESC", (rid,)
            ).fetchall(),
            "tasks": c.execute(
                "SELECT * FROM tasks WHERE record_id=%s ORDER BY id", (rid,)
            ).fetchall(),
        }


class Values(BaseModel):
    values: dict[str, Any]
    revision: int


def revision_check(row, revision):
    if row["revision"] != revision:
        reject("This record changed in another session. Reopen it before saving.", 409)


@app.put("/api/records/{rid}")
def save_record(rid: int, body: Values, u=Depends(user)):
    with db() as c:
        r, cfg = locked_record(c, rid, u)
        revision_check(r, body.revision)
        if not can_edit(cfg, r["state"], r.get("active_states")):
            reject("Only a draft can be edited. Return it for correction first.", 409)
        for field in cfg["fields"]:
            if (
                not field.get("formula")
                and "edit_roles" in field
                and u["role"] not in field["edit_roles"]
                and body.values.get(field["id"]) != r["values_json"].get(field["id"])
            ):
                reject(f"Your role cannot edit {field['label']}.", 403)
        for table in cfg.get("tables", []):
            before = r["values_json"].get(table["id"], [])
            after = body.values.get(table["id"], [])
            if isinstance(before, list) and isinstance(after, list):
                for field in table["columns"]:
                    if (
                        not field.get("formula")
                        and field.get("edit_roles") is not None
                        and u["role"] not in field["edit_roles"]
                    ):
                        old = [
                            row.get(field["id"])
                            for row in before
                            if isinstance(row, dict)
                        ]
                        new = [
                            row.get(field["id"])
                            for row in after
                            if isinstance(row, dict)
                        ]
                        if old != new:
                            reject(
                                f"Your role cannot edit {table['label']}: {field['label']}.",
                                403,
                            )
        body.values = prepare_values(cfg, body.values, {"event_user": u["name"]})
        validate_values(cfg, body.values)
        c.execute(
            "UPDATE records SET values_json=%s,revision=revision+1,updated_at=now() WHERE id=%s",
            (Jsonb(body.values), rid),
        )
        audit(
            c, u["name"], "Draft saved", rid, before=r["values_json"], after=body.values
        )
    return record(rid, u)


class Transition(BaseModel):
    transition_id: str
    revision: int
    note: str = Field(default="", max_length=5000)


@app.post("/api/records/{rid}/transition")
def transition(rid: int, body: Transition, u=Depends(user)):
    with db() as c:
        r, cfg = locked_record(c, rid, u)
        revision_check(r, body.revision)
        if u.get("timer_id"):
            timer = c.execute(
                "SELECT * FROM workflow_timers WHERE id=%s AND record_id=%s FOR UPDATE",
                (u["timer_id"], rid),
            ).fetchone()
            if (
                not timer
                or timer["status"] != "Pending"
                or timer["due_at"] > datetime.now(timezone.utc)
                or timer["transition_id"] != body.transition_id
            ):
                reject("Timer is no longer due.", 409)
        count = c.execute(
            "SELECT count(*) AS n FROM evidence WHERE record_id=%s", (rid,)
        ).fetchone()["n"]
        open_count = c.execute(
            "SELECT count(*) AS n FROM tasks WHERE record_id=%s AND status='Open'",
            (rid,),
        ).fetchone()["n"]
        context = {
            "history": r.get("workflow_history", {}),
            "event_kind": "timer" if u.get("timer_id") else "manual",
            "event_user": u["name"],
            "event_time": datetime.now(timezone.utc).isoformat(),
        }
        pending_flags = []

        def check(t, values, automatic):
            check_transition(
                cfg,
                t,
                t["source"],
                t["roles"][0] if automatic else u["role"],
                values,
                body.note,
                count,
                open_count + bool(pending_flags),
                context,
            )

        def after(t, values):
            flags = exceptions(cfg, values)
            if (
                flags
                and not open_count
                and t.get("create_exception_task", t["target"] == "Submitted")
                and not pending_flags
            ):
                pending_flags.extend(flags)
            if t["target"] == "Closed" and pending_flags:
                reject(
                    "Complete all corrective tasks before closing this inspection.", 409
                )

        try:
            result = advance(
                cfg,
                r["state"],
                r.get("active_states"),
                body.transition_id,
                r["values_json"],
                context,
                check,
                after,
            )
        except (WorkflowError, FormulaError) as error:
            reject(str(error))
        validate_values(cfg, result["values"])
        flags = exceptions(cfg, result["values"])
        if pending_flags:
            task = create_task(c, rid, "Investigate: " + pending_flags[0])
            audit(
                c,
                "Workflow engine",
                "Corrective task created",
                rid,
                task_id=task["id"],
                exceptions=pending_flags,
            )
        c.execute(
            "UPDATE records SET state=%s,active_states=%s,values_json=%s,priority=%s,revision=revision+1,updated_at=now() WHERE id=%s",
            (
                result["state"],
                Jsonb(result["active_states"]),
                Jsonb(result["values"]),
                "High" if flags else r["priority"],
                rid,
            ),
        )
        c.execute(
            "UPDATE records SET workflow_history=%s WHERE id=%s",
            (Jsonb(result["history"]), rid),
        )
        if u.get("timer_id"):
            c.execute(
                "UPDATE workflow_timers SET status='Completed',last_error=null WHERE id=%s",
                (u["timer_id"],),
            )
        sync_timers(c, rid, cfg, result["active_states"])
        for step in result["trace"]:
            audit(
                c,
                "Workflow engine" if step["automatic"] else u["name"],
                step["label"],
                rid,
                source=step["source"],
                target=step["target"],
                automatic=step["automatic"],
                note=body.note,
                active_states=result["active_states"],
                effects=result["effects"],
            )

    return record(rid, u)


@app.post("/api/records/{rid}/evidence", status_code=201)
async def upload(rid: int, file: UploadFile = File(...), u=Depends(user)):
    data = await file.read(10 * 1024 * 1024 + 1)
    if len(data) > 10 * 1024 * 1024:
        reject("Photographs must be 10 MB or smaller.", 413)
    try:
        im = Image.open(io.BytesIO(data))
        if im.format not in ["JPEG", "PNG", "WEBP"]:
            reject("Upload a JPEG, PNG or WebP image.")
        media = Image.MIME[im.format]
        im.verify()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
        reject("This file is not a valid photograph.")
    eid = str(uuid.uuid4())
    destination = FILES / eid
    try:
        with db() as c:
            r, cfg = locked_record(c, rid, u)
            if not can_edit(cfg, r["state"], r.get("active_states")):
                reject("Evidence can only be added to a draft.", 409)
            destination.write_bytes(data)
            c.execute(
                "INSERT INTO evidence(id,record_id,filename,media_type,size,sha256) VALUES(%s,%s,%s,%s,%s,%s)",
                (
                    eid,
                    rid,
                    Path(file.filename or "photo").name[:200],
                    media,
                    len(data),
                    hashlib.sha256(data).hexdigest(),
                ),
            )
            c.execute(
                "UPDATE records SET revision=revision+1,updated_at=now() WHERE id=%s",
                (rid,),
            )
            audit(c, u["name"], "Photographic evidence attached", rid, evidence_id=eid)
    except Exception:
        destination.unlink(missing_ok=True)
        raise
    return {"id": eid}


@app.get("/api/evidence/{eid}")
def evidence_file(eid: str, u=Depends(user)):
    with db() as c:
        e = c.execute("SELECT * FROM evidence WHERE id=%s", (eid,)).fetchone()
        if e:
            record_access(c, u, e["record_id"])
    if not e or not (FILES / e["id"]).is_file():
        reject("Evidence not found.", 404)
    return FileResponse(
        FILES / e["id"],
        media_type=e["media_type"],
        headers={"X-Content-Type-Options": "nosniff"},
    )


class TaskCompletion(BaseModel):
    note: str = Field(min_length=3, max_length=2000)


@app.post("/api/tasks/{tid}/complete")
def complete_task(tid: int, body: TaskCompletion, u=Depends(user)):
    with db() as c:
        t = c.execute("SELECT * FROM tasks WHERE id=%s FOR UPDATE", (tid,)).fetchone()
        if not t:
            reject("Task not found.", 404)
        record_access(c, u, t["record_id"])
        if t["status"] != "Open":
            reject("This task has already been completed.", 409)
        if not body.note.strip():
            reject("A completion note is required.")
        c.execute("UPDATE tasks SET status='Completed' WHERE id=%s", (tid,))
        audit(
            c,
            u["name"],
            "Corrective task completed",
            t["record_id"],
            task_id=tid,
            note=body.note,
        )
    return {"ok": True}


class Configuration(BaseModel):
    definition: dict[str, Any]
    base_version: int


@app.post("/api/config/validate")
def validate_definition(body: Configuration, u=Depends(admin)):
    return {"definition": validate_config(body.definition)}


@app.post("/api/config", status_code=201)
def publish(body: Configuration, u=Depends(admin)):
    if review_required():
        reject(
            "Publication requires an approved configuration item. Submit the working definition for independent review.",
            403,
        )
    cfg = validate_config(body.definition)
    with db() as c:
        c.execute("SELECT pg_advisory_xact_lock(268115)")
        latest = c.execute(
            "SELECT id FROM config_versions WHERE is_global ORDER BY id DESC LIMIT 1"
        ).fetchone()["id"]
        if latest != body.base_version:
            reject("A newer configuration was published. Reload before editing.", 409)
        row = c.execute(
            "INSERT INTO config_versions(definition,published_by) VALUES(%s,%s) RETURNING *",
            (Jsonb(cfg), u["name"]),
        ).fetchone()
        audit(
            c,
            u["name"],
            "Configuration published",
            version=row["id"],
            previous_version=latest,
            name=cfg["name"],
        )
        return row


@app.get("/api/config/{version}")
def config_version(version: int, u=Depends(user)):
    from .access import version_visible

    with db() as c:
        if not version_visible(c, u, version):
            reject("Configuration version is outside your operational areas.", 403)
        row = c.execute(
            "SELECT * FROM config_versions WHERE id=%s", (version,)
        ).fetchone()
    if not row:
        reject("Configuration version not found.", 404)
    return row


class Sensor(BaseModel):
    asset_id: str
    temperature: float = Field(ge=-50, le=200, allow_inf_nan=False)


@app.post("/api/sensor-events", status_code=202)
def sensor(body: Sensor, u=Depends(user)):
    if u["role"] == "technician":
        reject("A supervisor or administrator must inject a sensor event.", 403)
    with db() as c:
        if not c.execute(
            "SELECT id FROM assets WHERE id=%s AND NOT deleted", (body.asset_id,)
        ).fetchone():
            reject("Asset not found.")
        asset_access(c, u, body.asset_id)
        c.execute(
            "INSERT INTO data_point_history(point_id,value) VALUES(%s,%s)",
            (body.asset_id + ".temperature", str(body.temperature)),
        )
        job = c.execute(
            "INSERT INTO jobs(kind,payload) VALUES('sensor',%s) RETURNING *",
            (Jsonb(body.model_dump()),),
        ).fetchone()
        audit(
            c, u["name"], "Sensor event queued", job_id=job["id"], **body.model_dump()
        )
        return job


class Handover(BaseModel):
    shift: str = Field(min_length=3, max_length=100)
    note: str = Field(min_length=3, max_length=5000)


@app.post("/api/handovers", status_code=201)
def handover(body: Handover, u=Depends(user)):
    if len(body.note.strip()) < 3 or len(body.shift.strip()) < 3:
        reject("A shift and handover briefing are required.")
    if u["role"] == "technician":
        reject("Supervisor access is required to issue a handover.", 403)
    with db() as c:
        rows = c.execute(
            "SELECT r.id,r.title,r.state,r.priority,r.asset_id FROM records r WHERE state<>'Closed' ORDER BY r.id"
        ).fetchall()
        tasks = c.execute(
            "SELECT id,record_id,title,status,assignee,due_at::text FROM tasks WHERE status='Open' ORDER BY due_at"
        ).fetchall()
        assets = {
            r["id"]
            for r in c.execute("SELECT id,building_id FROM assets").fetchall()
            if u.get("areas") is None or r["building_id"] in u["areas"]
        }
        rows = [r for r in rows if r["asset_id"] in assets]
        ids = {r["id"] for r in rows}
        tasks = [t for t in tasks if t["record_id"] in ids]
        areas = (
            u.get("areas")
            if u.get("areas") is not None
            else [b["id"] for b in c.execute("SELECT id FROM buildings").fetchall()]
        )
        row = c.execute(
            "INSERT INTO handovers(shift,note,snapshot,author) VALUES(%s,%s,%s,%s) RETURNING *",
            (
                body.shift,
                body.note,
                Jsonb(
                    {
                        "areas": areas,
                        "records": rows,
                        "tasks": tasks,
                        "logbook": c.execute(
                            "SELECT id,message,status,priority,event_time::text FROM log_entries WHERE add_to_handover=true AND status<>'Closed' AND asset_id=ANY(%s) ORDER BY event_time",
                            (list(assets),),
                        ).fetchall(),
                    }
                ),
                u["name"],
            ),
        ).fetchone()
        audit(
            c,
            u["name"],
            "Shift handover issued",
            handover_id=row["id"],
            outstanding_tasks=len(tasks),
        )
        return row


@app.post("/api/handovers/{hid}/acknowledge")
def acknowledge(hid: int, u=Depends(user)):
    with db() as c:
        existing = c.execute(
            "SELECT * FROM handovers WHERE id=%s FOR UPDATE", (hid,)
        ).fetchone()
        if not existing:
            reject("Handover not found.", 404)
        handover_access(c, u, existing)
        row = c.execute(
            "UPDATE handovers SET acknowledged_by=%s,acknowledged_at=now() WHERE id=%s AND acknowledged_by IS NULL RETURNING *",
            (u["name"], hid),
        ).fetchone()
        if not row:
            reject("Handover missing or already acknowledged.", 409)
        audit(c, u["name"], "Shift handover acknowledged", handover_id=hid)
    return row


@app.post("/internal/maintenance")
def maintenance(payload: dict, request: Request):
    if not secrets.compare_digest(
        request.headers.get("X-Worker-Token", ""), INTERNAL_TOKEN
    ):
        reject("Internal authentication required.", 403)
    if payload.get("fail_first") and payload.get("attempt") == 1:
        raise HTTPException(503, "Simulated maintenance outage: retry scheduled")
    with db() as c:
        c.execute(
            "INSERT INTO maintenance_receipts(request_id,payload) VALUES(%s,%s) ON CONFLICT DO NOTHING",
            (str(payload["task_id"]), Jsonb(payload)),
        )
    return {"work_order": f"WO-{payload['task_id']:05}", "accepted": True}


class Simulation(BaseModel):
    definition: dict
    transition_id: str
    state: str
    active_states: list[str] = Field(default_factory=list)
    role: str
    values: dict = Field(default_factory=dict)
    note: str = ""
    evidence_count: int = Field(default=0, ge=0)
    open_tasks: int = Field(default=0, ge=0)
    elapsed_seconds: int = Field(default=0, ge=0)
    history: dict = Field(default_factory=dict)


@app.post("/api/workflow/simulate")
def simulate(body: Simulation, u=Depends(user)):
    cfg = validate_config(body.definition)
    tr = next((t for t in cfg["transitions"] if t["id"] == body.transition_id), None)
    if tr and tr.get("event") == "timer" and body.elapsed_seconds < tr["after_seconds"]:
        reject("The simulated timer has not elapsed.")
    context = {
        "history": body.history,
        "event_kind": "timer" if tr and tr.get("event") == "timer" else "manual",
        "event_user": body.role,
        "event_time": datetime.now(timezone.utc).isoformat(),
    }
    values = prepare_values(cfg, body.values, context)
    validate_values(cfg, values)
    pending_flags = []

    def check(t, values, automatic):
        check_transition(
            cfg,
            t,
            t["source"],
            t["roles"][0] if automatic else body.role,
            values,
            body.note,
            body.evidence_count,
            body.open_tasks + bool(pending_flags),
            context,
        )

    def after(t, values):
        flags = exceptions(cfg, values)
        if (
            flags
            and not body.open_tasks
            and t.get("create_exception_task", t["target"] == "Submitted")
            and not pending_flags
        ):
            pending_flags.extend(flags)
        if t["target"] == "Closed" and pending_flags:
            reject("Complete all corrective tasks before closing this inspection.", 409)

    try:
        result = advance(
            cfg,
            body.state,
            body.active_states,
            body.transition_id,
            values,
            context,
            check,
            after,
        )
    except (WorkflowError, FormulaError) as error:
        reject(str(error))
    validate_values(cfg, result["values"])
    return {
        **result,
        "open_tasks": body.open_tasks + bool(pending_flags),
        "message": "; ".join(
            f"{step['source']} → {step['target']}" for step in result["trace"]
        )
        + f" · {body.role}",
        "exceptions": exceptions(cfg, result["values"]),
    }


from .logbook import router as logbook_router

app.include_router(logbook_router(user, lambda: FILES))


class FormPreview(BaseModel):
    definition: dict
    values: dict


@app.post("/api/forms/validate")
def form_preview(body: FormPreview, u=Depends(user)):
    cfg = validate_config(body.definition)
    values = prepare_values(cfg, body.values, {"event_user": u["name"]})
    validate_values(cfg, values, complete=True)
    return {"exceptions": exceptions(cfg, values), "values": values}


@app.get("/api/formulas")
def formula_catalog(u=Depends(user)):
    from .formulas import FUNCTIONS

    return {"engine": "campus-formulas/v1", "native_j5": False, "functions": FUNCTIONS}


@app.post("/api/forms/calculate")
def calculate_form(body: FormPreview, u=Depends(user)):
    from .formulas import calculate_sheet

    cfg = validate_config(body.definition)
    from .forms_extended import table_values

    try:
        values = table_values(cfg, body.values, {"event_user": u["name"]})
    except FormulaError as error:
        reject(str(error))
    result = calculate_sheet(cfg, values, {"event_user": u["name"]})
    result["tables"] = {t["id"]: values.get(t["id"], []) for t in cfg.get("tables", [])}
    return result


from .platform import router as platform_router

app.include_router(platform_router(user, admin))

from .compat import router as compat_router

app.include_router(compat_router(user, DEMO_PASSWORD))


@app.get("/api/openapi.json")
def local_openapi(u=Depends(user)):
    return app.openapi()


from .access import router as access_router

app.include_router(access_router(user, admin))


@app.post("/api/records/{rid}/timers/{timer_id}/retry")
def retry_timer(rid: int, timer_id: int, u=Depends(user)):
    if u["role"] == "technician":
        reject("Supervisor access required.", 403)
    with db() as c:
        r, cfg = locked_record(c, rid, u)
        row = c.execute(
            "SELECT * FROM workflow_timers WHERE id=%s AND record_id=%s FOR UPDATE",
            (timer_id, rid),
        ).fetchone()
        if not row or row["status"] != "Blocked":
            reject("Only blocked timers can be retried.", 409)
        if not source_active(
            cfg, row["source"], active_leaves(cfg, r["state"], r.get("active_states"))
        ):
            reject("Timer source is no longer active.", 409)
        c.execute(
            "UPDATE workflow_timers SET status='Pending',due_at=now(),last_error=null WHERE id=%s",
            (timer_id,),
        )
        audit(
            c, u["name"], "Scheduled transition retry requested", rid, timer_id=timer_id
        )
    return {"ok": True}


from .xlsx_io import router as xlsx_router

app.include_router(xlsx_router(user, admin))
