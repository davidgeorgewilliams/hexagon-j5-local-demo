"""Local project packages, controlled configuration releases and developer workspace."""

import hashlib
import io
import json
import re
import zipfile
import httpx, os
from pathlib import PurePosixPath
from fastapi import APIRouter, Depends, File, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field
from psycopg.types.json import Jsonb
from .access import permits
from .db import db
from .domain import reject, audit, validate_config

FORMAT = "campus-project/v2"


def project_files(definition, name="Campus operations"):
    workflow = {
        k: definition[k]
        for k in ["states", "transitions", "state_tree", "state_settings"]
        if k in definition
    }
    form = {k: v for k, v in definition.items() if k not in workflow}
    return {
        "project.json": json.dumps({"format": FORMAT, "name": name}, indent=2),
        "forms/inspection.json": json.dumps(form, indent=2),
        "workflows/inspection.json": json.dumps(workflow, indent=2),
        "README.md": "# "
        + name
        + "\n\nIndependent local emulator project. Import this ZIP in Developer workspace. Not a native J5 package.\n",
        "services/inspection_service.py": '"""Standalone property inspection rule, runnable in the local workspace."""\ndef assess(readings):\n    issues = [r for r in readings if r["temperature"] > 32]\n    return {"checked": len(readings), "exceptions": len(issues), "handover_required": bool(issues)}\n\nreadings = [{"space": "Apartment 101", "temperature": 24}, {"space": "Office 202", "temperature": 35}]\nresult = assess(readings)\nassert result["exceptions"] == 1\nprint(result)\n',
        "services/client_example.py": '"""Example client for this emulator; run locally after exporting the project."""\nimport httpx\nwith httpx.Client(base_url="http://localhost:8088") as client:\n    client.post("/api/session", json={"username":"alex", "password":"campus-demo"}).raise_for_status()\n    print(client.get("/api/bootstrap").json()["records"])\n',
    }


def validate_files(files):
    if not isinstance(files, dict) or not 1 <= len(files) <= 100:
        reject("Projects need 1–100 text files.")
    if sum(len(str(v).encode()) for v in files.values()) > 2 * 1024 * 1024:
        reject("Project text files exceed 2 MB.")
    for name, content in files.items():
        if name == "manifest.json":
            reject("manifest.json is reserved for package checksums.")
        if (
            not name
            or name.startswith("/")
            or "\\" in name
            or any(p in ["..", "."] for p in name.split("/"))
            or len(name) > 180
            or not re.fullmatch(r"[A-Za-z0-9_./ -]+", name)
        ):
            reject("Use relative project paths without traversal.")
        if not isinstance(content, str) or len(content) > 200000:
            reject("Each project file must be text of at most 200,000 characters.")
    try:
        meta = json.loads(files["project.json"])
        form = json.loads(files["forms/inspection.json"])
        workflow = json.loads(files["workflows/inspection.json"])
        if not isinstance(meta, dict) or meta.get("format") != FORMAT:
            reject(
                "This is not a campus-project/v2 project. Native J5 formats are not executable here."
            )
        if not isinstance(form, dict) or not isinstance(workflow, dict):
            reject("Form and workflow files must contain JSON objects.")
        if set(workflow) - {"states", "transitions", "state_tree", "state_settings"}:
            reject("Workflow file contains unsupported top-level keys.")
        if set(form) & {"states", "transitions", "state_tree", "state_settings"}:
            reject("Workflow definitions belong in workflows/inspection.json.")
        return validate_config({**form, **workflow})
    except (KeyError, json.JSONDecodeError, TypeError) as error:
        reject("Invalid project structure or JSON: " + str(error)[:150])


def archive_bytes(files):
    out = io.BytesIO()
    manifest = {
        "format": FORMAT,
        "files": {
            name: hashlib.sha256(content.encode()).hexdigest()
            for name, content in files.items()
        },
    }
    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, content in files.items():
            archive.writestr(name, content)
        archive.writestr("manifest.json", json.dumps(manifest, indent=2))
    return out.getvalue()


def inspect_archive(data):
    if len(data) > 10 * 1024 * 1024:
        reject("Packages are limited to 10 MB compressed.", 413)
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            infos = archive.infolist()
            if len(infos) > 100 or sum(i.file_size for i in infos) > 20 * 1024 * 1024:
                reject("Package exceeds 100 entries or 20 MB expanded.", 413)
            names = set()
            contents = {}
            entries = []
            for info in infos:
                name = info.filename
                if (
                    name.startswith("/")
                    or "\\" in name
                    or ".." in PurePosixPath(name).parts
                    or name in names
                    or info.flag_bits & 1
                    or (info.external_attr >> 16) & 0o170000 == 0o120000
                ):
                    reject("Unsafe, duplicate, linked or encrypted archive entry.")
                names.add(name)
                if info.is_dir():
                    continue
                content = archive.read(info)
                digest = hashlib.sha256(content).hexdigest()
                entries.append({"path": name, "size": len(content), "sha256": digest})
                contents[name] = content
            manifest = {}
            if "manifest.json" in contents:
                try:
                    manifest = json.loads(contents["manifest.json"])
                except (ValueError, UnicodeError):
                    pass
            recognized = isinstance(manifest, dict) and manifest.get("format") == FORMAT
            if recognized:
                hashes = manifest.get("files")
                if not isinstance(hashes, dict) or set(hashes) != set(contents) - {
                    "manifest.json"
                }:
                    reject("Package manifest does not match its files.")
                for name, digest in hashes.items():
                    if hashlib.sha256(contents[name]).hexdigest() != digest:
                        reject("Package checksum mismatch: " + name)
            files = {}
            if recognized:
                try:
                    files = {
                        name: data.decode("utf-8")
                        for name, data in contents.items()
                        if name != "manifest.json"
                    }
                except UnicodeError:
                    reject("Local project packages must contain UTF-8 text files.")
                validate_files(files)
            return {
                "format": FORMAT if recognized else "unrecognized/native-unverified",
                "importable": recognized,
                "entries": entries,
                "files": files,
                "message": "Validated local project package."
                if recognized
                else "Archive inspected only. No verified native J5 schema is available; its contents have not been executed or converted.",
            }
    except (
        zipfile.BadZipFile,
        RuntimeError,
        NotImplementedError,
        UnicodeError,
    ) as error:
        reject("Unreadable ZIP package: " + str(error)[:150])


class Workspace(BaseModel):
    name: str = Field(min_length=3, max_length=120)
    files: dict[str, str]
    revision: int = 0
    base_version: int


class Export(BaseModel):
    definition: dict
    name: str = "Campus operations"


class Item(BaseModel):
    name: str = Field(min_length=3, max_length=120)
    definition: dict
    scope: str = "*"
    revision: int = 0
    base_version: int


class Decision(BaseModel):
    revision: int
    note: str = Field(default="", max_length=5000)


def router(user, admin):
    routes = APIRouter(prefix="/api")

    def valid_base(c, version):
        if not c.execute(
            "SELECT id FROM config_versions WHERE id=%s AND is_global", (version,)
        ).fetchone():
            reject("Choose a published global base version.")

    @routes.get("/workspace")
    def workspaces(u=Depends(admin)):
        with db() as c:
            return c.execute(
                "SELECT * FROM dev_projects ORDER BY updated_at DESC"
            ).fetchall()

    @routes.post("/workspace", status_code=201)
    def new_project(body: Workspace, u=Depends(admin)):
        # Invalid edits remain in the browser until corrected.
        validate_files(body.files)
        with db() as c:
            valid_base(c, body.base_version)
            row = c.execute(
                "INSERT INTO dev_projects(name,files,base_version,author) VALUES(%s,%s,%s,%s) RETURNING *",
                (body.name, Jsonb(body.files), body.base_version, u["name"]),
            ).fetchone()
            audit(c, u["name"], "Developer project created", project_id=row["id"])
            return row

    @routes.put("/workspace/{pid}")
    def save_project(pid: int, body: Workspace, u=Depends(admin)):
        # Save only valid projects: invalid edits remain in the browser until corrected.
        validate_files(body.files)
        with db() as c:
            valid_base(c, body.base_version)
            row = c.execute(
                "UPDATE dev_projects SET name=%s,files=%s,revision=revision+1,updated_at=now(),base_version=%s WHERE id=%s AND revision=%s RETURNING *",
                (body.name, Jsonb(body.files), body.base_version, pid, body.revision),
            ).fetchone()
            if not row:
                reject("Project changed in another session. Reload before saving.", 409)
            audit(
                c,
                u["name"],
                "Developer project saved",
                project_id=pid,
                revision=row["revision"],
            )
            return row

    @routes.post("/workspace/validate")
    def validate_workspace(body: Workspace, u=Depends(admin)):
        cfg = validate_files(body.files)
        return {
            "definition": cfg,
            "message": f"Valid project: {len(cfg['fields'])} fields and {len(cfg['transitions'])} transitions.",
        }

    @routes.post("/workspace/run")
    def execute(body: dict, u=Depends(admin)):
        source = body.get("source")
        debug = body.get("debug", False)
        if (
            not isinstance(source, str)
            or len(source) > 200000
            or type(debug) is not bool
        ):
            reject("Provide a Python source file and a boolean debug option.")
        try:
            response = httpx.post(
                os.getenv("RUNNER_URL", "http://runner:8010/run"),
                json={"source": source, "debug": debug},
                headers={
                    "X-Runner-Token": os.getenv("RUNNER_TOKEN", "local-execution-token")
                },
                timeout=8,
            )
            response.raise_for_status()
        except httpx.HTTPError:
            reject(
                "The local execution container is unavailable. Start Docker Compose and retry.",
                503,
            )
        with db() as c:
            audit(
                c,
                u["name"],
                "Developer source executed",
                source_sha256=hashlib.sha256(source.encode()).hexdigest(),
                debug=debug,
            )
        return response.json()

    @routes.post("/workspace/scaffold")
    def scaffold(body: Export, u=Depends(admin)):
        cfg = validate_config(body.definition)
        return {"files": project_files(cfg, body.name)}

    @routes.post("/packages/export")
    def export(body: Export, u=Depends(user)):
        files = project_files(validate_config(body.definition), body.name)
        return Response(
            archive_bytes(files),
            media_type="application/zip",
            headers={
                "Content-Disposition": 'attachment; filename="campus-project.zip"'
            },
        )

    @routes.get("/workspace/{pid}/package")
    def export_workspace(pid: int, u=Depends(admin)):
        with db() as c:
            row = c.execute(
                "SELECT files FROM dev_projects WHERE id=%s", (pid,)
            ).fetchone()
        if not row:
            reject("Project not found.", 404)
        validate_files(row["files"])
        return Response(
            archive_bytes(row["files"]),
            media_type="application/zip",
            headers={
                "Content-Disposition": 'attachment; filename="campus-workspace.zip"'
            },
        )

    @routes.post("/packages/inspect")
    async def inspect(file: UploadFile = File(...), u=Depends(admin)):
        return inspect_archive(await file.read(10 * 1024 * 1024 + 1))

    @routes.get("/config-items")
    def items(u=Depends(user)):
        with db() as c:
            items = [
                item
                for item in c.execute(
                    "SELECT * FROM config_items ORDER BY updated_at DESC"
                ).fetchall()
                if item["scope"] == "*" or permits(u, item["scope"])
            ]
            ids = [item["id"] for item in items]
            return {
                "items": items,
                "history": c.execute(
                    "SELECT * FROM config_item_history WHERE item_id=ANY(%s) ORDER BY id DESC LIMIT 200",
                    (ids,),
                ).fetchall(),
                "bindings": [
                    b
                    for b in c.execute(
                        "SELECT * FROM config_bindings ORDER BY scope"
                    ).fetchall()
                    if permits(u, b["scope"])
                ],
            }

    def entry_history(c, item_id, actor, action, detail):
        c.execute(
            "INSERT INTO config_item_history(item_id,actor,action,detail) VALUES(%s,%s,%s,%s)",
            (item_id, actor, action, Jsonb(detail)),
        )
        audit(c, actor, "Configuration item: " + action, item_id=item_id, **detail)

    @routes.post("/config-items", status_code=201)
    def new_item(body: Item, u=Depends(admin)):
        cfg = validate_config(body.definition)
        with db() as c:
            valid_base(c, body.base_version)
            if (
                body.scope != "*"
                and not c.execute(
                    "SELECT id FROM buildings WHERE id=%s", (body.scope,)
                ).fetchone()
            ):
                reject("Unknown operational scope.")
            row = c.execute(
                "INSERT INTO config_items(name,definition,scope,base_version,author) VALUES(%s,%s,%s,%s,%s) RETURNING *",
                (body.name, Jsonb(cfg), body.scope, body.base_version, u["name"]),
            ).fetchone()
            entry_history(
                c,
                row["id"],
                u["name"],
                "Draft created",
                {
                    "revision": 1,
                    "definition": cfg,
                    "scope": body.scope,
                    "base_version": body.base_version,
                },
            )
            return row

    @routes.put("/config-items/{item_id}")
    def edit_item(item_id: int, body: Item, u=Depends(admin)):
        cfg = validate_config(body.definition)
        with db() as c:
            valid_base(c, body.base_version)
            if (
                body.scope != "*"
                and not c.execute(
                    "SELECT id FROM buildings WHERE id=%s", (body.scope,)
                ).fetchone()
            ):
                reject("Unknown operational scope.")
            row = c.execute(
                "UPDATE config_items SET name=%s,definition=%s,scope=%s,base_version=%s,revision=revision+1,updated_at=now(),reviewed_by=null WHERE id=%s AND revision=%s AND status='Draft' RETURNING *",
                (
                    body.name,
                    Jsonb(cfg),
                    body.scope,
                    body.base_version,
                    item_id,
                    body.revision,
                ),
            ).fetchone()
            if not row:
                reject("Only the latest draft revision can be edited.", 409)
            entry_history(
                c,
                item_id,
                u["name"],
                "Draft updated",
                {
                    "revision": row["revision"],
                    "definition": cfg,
                    "scope": body.scope,
                    "base_version": body.base_version,
                },
            )
            return row

    @routes.post("/config-items/{item_id}/{action}")
    def decide(item_id: int, action: str, body: Decision, u=Depends(user)):
        if action not in ["submit", "approve", "reject", "publish"]:
            reject("Unknown configuration action.", 404)
        if action in ["submit", "publish"] and u["role"] != "administrator":
            reject("Administrator access is required.", 403)
        if action in ["approve", "reject"] and u["role"] not in [
            "administrator",
            "supervisor",
        ]:
            reject("Reviewer access is required.", 403)
        with db() as c:
            c.execute("SELECT pg_advisory_xact_lock(268116)")
            row = c.execute(
                "SELECT * FROM config_items WHERE id=%s FOR UPDATE", (item_id,)
            ).fetchone()
            if not row:
                reject("Configuration item not found.", 404)
            if row["scope"] != "*" and not permits(u, row["scope"]):
                reject("You cannot review this operational area.", 403)
            if row["revision"] != body.revision:
                reject("Configuration item changed. Reload before continuing.", 409)
            required = {
                "submit": "Draft",
                "approve": "In Review",
                "reject": "In Review",
                "publish": "Approved",
            }[action]
            if row["status"] != required:
                reject("This action is not available for the current item status.", 409)
            if action in ["approve", "reject"]:
                if u["name"] == row["submitted_by"]:
                    reject("A different person must review the submitted change.", 403)
                if len(body.note.strip()) < 3:
                    reject("Record a review comment.")
            state = {
                "submit": "In Review",
                "approve": "Approved",
                "reject": "Draft",
                "publish": "Published",
            }[action]
            version = None
            if action == "publish":
                c.execute("SELECT pg_advisory_xact_lock(268115)")
                current = c.execute(
                    "SELECT id FROM config_versions WHERE is_global ORDER BY id DESC LIMIT 1"
                ).fetchone()["id"]
                if current != row["base_version"]:
                    reject(
                        "The global base version changed. Create a fresh draft and review it before publication.",
                        409,
                    )
                definition = validate_config(row["definition"])
                version = c.execute(
                    "INSERT INTO config_versions(definition,published_by,is_global) VALUES(%s,%s,%s) RETURNING id",
                    (Jsonb(definition), u["name"], row["scope"] == "*"),
                ).fetchone()["id"]
                if row["scope"] != "*":
                    c.execute(
                        "INSERT INTO config_bindings(scope,config_id,item_id) VALUES(%s,%s,%s) ON CONFLICT(scope) DO UPDATE SET config_id=excluded.config_id,item_id=excluded.item_id",
                        (row["scope"], version, item_id),
                    )
            result = c.execute(
                "UPDATE config_items SET status=%s,revision=revision+1,updated_at=now(),submitted_by=CASE WHEN %s THEN %s ELSE submitted_by END,reviewed_by=CASE WHEN %s THEN %s ELSE reviewed_by END,published_version=COALESCE(%s,published_version) WHERE id=%s RETURNING *",
                (
                    state,
                    action == "submit",
                    u["name"],
                    action == "approve",
                    u["name"],
                    version,
                    item_id,
                ),
            ).fetchone()
            entry_history(
                c,
                item_id,
                u["name"],
                action.title(),
                {
                    "note": body.note,
                    "revision": result["revision"],
                    "published_version": version,
                },
            )
            return result

    return routes
