"""Building grants are enforced on each read/write, including alternate download paths."""

from .domain import USERS, reject, audit
from .db import db
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from psycopg.types.json import Jsonb
import os


def review_required():
    return os.getenv("REQUIRE_REVIEW", "true").lower() not in ["0", "false", "no"]


def identity(username):
    with db() as c:
        row = c.execute(
            "SELECT areas,revision FROM user_access WHERE username=%s", (username,)
        ).fetchone()
    return {
        "username": username,
        **USERS[username],
        "areas": None
        if USERS[username]["role"] == "administrator" or not row
        else row["areas"],
        "access_revision": row["revision"] if row else 0,
    }


def permits(u, area):
    return u.get("areas") is None or area in u["areas"]


def asset_access(c, u, asset):
    row = c.execute("SELECT building_id FROM assets WHERE id=%s", (asset,)).fetchone()
    if not row:
        reject("Asset not found.", 404)
    if not permits(u, row["building_id"]):
        reject("You do not have access to this operational area.", 403)
    return row["building_id"]


def version_visible(c, u, version):
    if u.get("areas") is None:
        return True
    return bool(
        c.execute(
            "SELECT 1 FROM config_versions cv WHERE cv.id=%s AND (cv.is_global OR EXISTS (SELECT 1 FROM config_items ci WHERE ci.published_version=cv.id AND ci.scope=ANY(%s)) OR EXISTS (SELECT 1 FROM records r JOIN assets a ON a.id=r.asset_id WHERE r.config_id=cv.id AND a.building_id=ANY(%s)))",
            (version, u["areas"], u["areas"]),
        ).fetchone()
    )


def record_access(c, u, rid):
    row = c.execute("SELECT asset_id FROM records WHERE id=%s", (rid,)).fetchone()
    if not row:
        reject("Inspection not found.", 404)
    asset_access(c, u, row["asset_id"])


def log_access(c, u, lid):
    row = c.execute("SELECT asset_id FROM log_entries WHERE id=%s", (lid,)).fetchone()
    if not row:
        reject("Logbook entry not found.", 404)
    asset_access(c, u, row["asset_id"])


def handover_access(c, u, row):
    if u.get("areas") is None:
        return
    snapshot = row["snapshot"]
    areas = snapshot.get("areas")
    if areas is None:
        # Legacy campus-wide briefings may contain free text about any area.
        reject("This legacy handover requires campus-wide access.", 403)
    if not set(areas) <= set(u["areas"]):
        reject("This handover contains areas outside your access.", 403)


def scope_bootstrap(data):
    u = data["user"]
    data["release_policy"] = {"review_required": review_required()}
    if u.get("areas") is None:
        return data
    data["buildings"] = [b for b in data["buildings"] if permits(u, b["id"])]
    data["assets"] = [a for a in data["assets"] if permits(u, a["building_id"])]
    assets = {a["id"] for a in data["assets"]}
    data["records"] = [r for r in data["records"] if permits(u, r["building_id"])]
    with db() as c:
        data["versions"] = [
            v for v in data["versions"] if version_visible(c, u, v["id"])
        ]
    records = {r["id"] for r in data["records"]}
    data["tasks"] = [t for t in data["tasks"] if t["record_id"] in records]
    data["jobs"] = [
        j
        for j in data["jobs"]
        if j["payload"].get("record_id") in records
        or j["payload"].get("asset_id") in assets
    ]
    # Unscoped administrative audit detail can contain private operational data.
    data["audit"] = [a for a in data["audit"] if a["record_id"] in records]
    data["handovers"] = [
        h
        for h in data["handovers"]
        if "areas" in h["snapshot"] and set(h["snapshot"]["areas"]) <= set(u["areas"])
    ]
    return data


class Grant(BaseModel):
    areas: list[str] | None = None
    revision: int = 0


def router(user, admin):
    r = APIRouter(prefix="/api/access")

    @r.get("")
    def get(u=Depends(admin)):
        return {
            "users": [identity(name) for name in USERS],
            "review_required": review_required(),
        }

    @r.put("/{username}")
    def put(username: str, body: Grant, u=Depends(admin)):
        if username not in USERS:
            reject("Unknown user.", 404)
        if USERS[username]["role"] == "administrator":
            reject("Administrators retain campus-wide access.")
        with db() as c:
            c.execute("SELECT pg_advisory_xact_lock(268117)")
            row = c.execute(
                "SELECT * FROM user_access WHERE username=%s FOR UPDATE", (username,)
            ).fetchone()
            if (row["revision"] if row else 0) != body.revision:
                reject("Access settings changed; refresh before saving.", 409)
            areas = None if body.areas is None else sorted(set(body.areas))
            known = {b["id"] for b in c.execute("SELECT id FROM buildings").fetchall()}
            if areas is not None and set(areas) - known:
                reject("Unknown building in access grant.")
            c.execute(
                "INSERT INTO user_access(username,areas,revision) VALUES(%s,%s,1) ON CONFLICT(username) DO UPDATE SET areas=excluded.areas,revision=user_access.revision+1",
                (username, Jsonb(areas)),
            )
            audit(
                c,
                u["name"],
                "Building access changed",
                username=username,
                before=row["areas"] if row else None,
                after=areas,
            )
        return identity(username)

    return r
