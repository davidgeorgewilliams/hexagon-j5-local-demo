"""Operational logbook with optimistic edits, status permissions and immutable history."""

from datetime import datetime, timezone
from fastapi import APIRouter, Depends, UploadFile, File, Form
from fastapi.responses import FileResponse
from fastapi.encoders import jsonable_encoder
import hashlib
import io
import uuid
from pathlib import Path
from PIL import Image, UnidentifiedImageError
from .richtext import sanitize_html
from pydantic import BaseModel, Field
from psycopg.types.json import Jsonb
from .db import db
from .domain import reject, audit
from .access import asset_access, log_access, permits


class Entry(BaseModel):
    asset_id: str
    category: str = "Operations"
    status: str = "Open"
    priority: str = "Normal"
    message: str = Field(min_length=3, max_length=10000)
    message_html: str = Field(default="", max_length=50000)
    event_time: datetime
    add_to_handover: bool = True
    revision: int = 0


class Note(BaseModel):
    message: str = Field(min_length=1, max_length=5000)
    flagged: bool = False


def router(user, files_dir):
    routes = APIRouter(prefix="/api/logbook")
    from .logbook_query import attach

    attach(routes, user)

    def detail(conn, entry_id, u):
        log_access(conn, u, entry_id)
        row = conn.execute(
            "SELECT * FROM log_entries WHERE id=%s", (entry_id,)
        ).fetchone()
        if not row:
            reject("Logbook entry not found.", 404)
        return {
            **row,
            "attachments": conn.execute(
                "SELECT * FROM log_attachments WHERE entry_id=%s AND NOT deleted ORDER BY created_at",
                (entry_id,),
            ).fetchall(),
            "notes": conn.execute(
                "SELECT * FROM log_notes WHERE entry_id=%s ORDER BY id DESC",
                (entry_id,),
            ).fetchall(),
            "history": conn.execute(
                "SELECT * FROM log_history WHERE entry_id=%s ORDER BY id DESC",
                (entry_id,),
            ).fetchall(),
        }

    @routes.get("")
    def listing(u=Depends(user)):
        with db() as c:
            rows = c.execute("""SELECT l.*,a.name AS asset_name,b.name AS building_name,b.id AS building_id,
                (SELECT count(*) FROM log_notes n WHERE n.entry_id=l.id) AS note_count,
                (SELECT count(*) FROM log_notes n WHERE n.entry_id=l.id AND n.flagged) AS flag_count
                FROM log_entries l JOIN assets a ON a.id=l.asset_id JOIN buildings b ON b.id=a.building_id
                ORDER BY event_time DESC,id DESC""").fetchall()
            return [row for row in rows if permits(u, row["building_id"])]

    @routes.get("/{entry_id}")
    def get(entry_id: int, u=Depends(user)):
        with db() as c:
            return detail(c, entry_id, u)

    def write(body, u, entry_id=None):
        if body.message_html:
            body.message_html, body.message = sanitize_html(body.message_html)
        if not 3 <= len(body.message.strip()) <= 10000:
            reject("The message must contain 3–10,000 characters of readable text.")
        if not body.message.strip():
            reject("An operational message is required.")
        if body.category not in [
            "Operations",
            "Maintenance",
            "Safety",
            "Inspection",
            "Downtime",
            "Lab",
        ]:
            reject("Unknown category.")
        if body.status not in ["Open", "On Hold", "Closed"]:
            reject("Unknown status.")
        if body.priority not in ["Low", "Normal", "High", "Critical"]:
            reject("Unknown priority.")
        if body.event_time.tzinfo is None:
            reject("Event time must include a timezone.")
        with db() as c:
            if not c.execute(
                "SELECT id FROM assets WHERE id=%s", (body.asset_id,)
            ).fetchone():
                reject("Choose an existing asset.")
            asset_access(c, u, body.asset_id)
            if entry_id:
                log_access(c, u, entry_id)
            before = None
            if entry_id:
                before = c.execute(
                    "SELECT * FROM log_entries WHERE id=%s FOR UPDATE", (entry_id,)
                ).fetchone()
                if not before:
                    reject("Logbook entry not found.", 404)
                if before["revision"] != body.revision:
                    reject(
                        "Entry changed in another session. Reopen it before saving.",
                        409,
                    )
            if u["role"] == "technician" and (
                body.status == "Closed" or (before and before["status"] == "Closed")
            ):
                reject(
                    "Supervisor access is required to close or revise closed entries.",
                    403,
                )
            data = body.model_dump(exclude={"revision"})
            closed_by = (
                (
                    before["closed_by"]
                    if before and before["status"] == "Closed"
                    else u["name"]
                )
                if body.status == "Closed"
                else None
            )
            closed_at = (
                (
                    before["closed_at"]
                    if before and before["status"] == "Closed"
                    else datetime.now(timezone.utc)
                )
                if body.status == "Closed"
                else None
            )
            params = (
                data["asset_id"],
                data["category"],
                data["status"],
                data["priority"],
                data["message"].strip(),
                data["event_time"],
                data["add_to_handover"],
                closed_by,
                closed_at,
            )
            if entry_id:
                c.execute(
                    """UPDATE log_entries SET asset_id=%s,category=%s,status=%s,priority=%s,message=%s,event_time=%s,add_to_handover=%s,
                    closed_by=%s,closed_at=%s,revision=revision+1,updated_at=now() WHERE id=%s""",
                    (*params, entry_id),
                )
            else:
                entry_id = c.execute(
                    """INSERT INTO log_entries(asset_id,category,status,priority,message,event_time,add_to_handover,closed_by,closed_at,author)
                    VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
                    (*params, u["name"]),
                ).fetchone()["id"]
            c.execute(
                "UPDATE log_entries SET message_html=%s WHERE id=%s",
                (body.message_html, entry_id),
            )
            change = {
                "before": {k: jsonable_encoder(v) for k, v in before.items()}
                if before
                else None,
                "after": body.model_dump(mode="json", exclude={"revision"}),
            }
            action = "Entry updated" if before else "Entry created"
            c.execute(
                "INSERT INTO log_history(entry_id,action,actor,detail) VALUES(%s,%s,%s,%s)",
                (entry_id, action, u["name"], Jsonb(change)),
            )
            audit(c, u["name"], "Logbook: " + action, log_entry_id=entry_id)
            return detail(c, entry_id, u)

    @routes.post("", status_code=201)
    def create(body: Entry, u=Depends(user)):
        return write(body, u)

    @routes.put("/{entry_id}")
    def update(entry_id: int, body: Entry, u=Depends(user)):
        return write(body, u, entry_id)

    @routes.post("/{entry_id}/notes", status_code=201)
    def add_note(entry_id: int, body: Note, u=Depends(user)):
        if not body.message.strip():
            reject("A note cannot be blank.")
        with db() as c:
            log_access(c, u, entry_id)
            if not c.execute(
                "SELECT id FROM log_entries WHERE id=%s FOR UPDATE", (entry_id,)
            ).fetchone():
                reject("Logbook entry not found.", 404)
            c.execute(
                "INSERT INTO log_notes(entry_id,message,flagged,author) VALUES(%s,%s,%s,%s)",
                (entry_id, body.message.strip(), body.flagged, u["name"]),
            )
            action = "Flag added" if body.flagged else "Note added"
            c.execute(
                "INSERT INTO log_history(entry_id,action,actor,detail) VALUES(%s,%s,%s,%s)",
                (entry_id, action, u["name"], Jsonb(body.model_dump())),
            )
            audit(c, u["name"], "Logbook: " + action, log_entry_id=entry_id)
            return detail(c, entry_id, u)

    def attachment_lock(c, entry_id, revision, u):
        log_access(c, u, entry_id)
        row = c.execute(
            "SELECT * FROM log_entries WHERE id=%s FOR UPDATE", (entry_id,)
        ).fetchone()
        if not row:
            reject("Logbook entry not found.", 404)
        if row["revision"] != revision:
            reject("Entry changed. Reload before changing attachments.", 409)
        if row["status"] == "Closed" and u["role"] == "technician":
            reject("Supervisor access is required to change closed entries.", 403)

    @routes.post("/{entry_id}/attachments", status_code=201)
    async def attach(
        entry_id: int,
        revision: int = Form(...),
        file: UploadFile = File(...),
        u=Depends(user),
    ):
        content = await file.read(10 * 1024 * 1024 + 1)
        if not content or len(content) > 10 * 1024 * 1024:
            reject("Attach a non-empty file up to 10 MB.", 413)
        filename = Path((file.filename or "attachment").replace("\\", "/")).name[:180]
        suffix = Path(filename).suffix.lower()
        if suffix in {".png", ".jpg", ".jpeg", ".webp"}:
            try:
                im = Image.open(io.BytesIO(content))
                im.verify()
                if im.format not in {"PNG", "JPEG", "WEBP"}:
                    reject("Unsupported image format.")
                media = Image.MIME[im.format]
            except (OSError, UnidentifiedImageError, Image.DecompressionBombError):
                reject("Invalid image attachment.")
        elif suffix == ".pdf" and content.startswith(b"%PDF-"):
            media = "application/pdf"
        elif suffix in {".txt", ".csv"}:
            try:
                content.decode("utf-8")
            except UnicodeError:
                reject("Text attachments must be UTF-8 encoded.")
            media = "text/plain" if suffix == ".txt" else "text/csv"
        else:
            reject("Supported attachments: PNG, JPEG, WebP, PDF, UTF-8 TXT and CSV.")
        attachment_id = str(uuid.uuid4())
        destination = files_dir() / attachment_id
        try:
            with db() as c:
                attachment_lock(c, entry_id, revision, u)
                if (
                    c.execute(
                        "SELECT count(*) AS n FROM log_attachments WHERE entry_id=%s AND NOT deleted",
                        (entry_id,),
                    ).fetchone()["n"]
                    >= 20
                ):
                    reject("A logbook entry may have up to 20 active attachments.")
                destination.write_bytes(content)
                digest = hashlib.sha256(content).hexdigest()
                c.execute(
                    "INSERT INTO log_attachments(id,entry_id,filename,media_type,size,sha256,author) VALUES(%s,%s,%s,%s,%s,%s,%s)",
                    (
                        attachment_id,
                        entry_id,
                        filename,
                        media,
                        len(content),
                        digest,
                        u["name"],
                    ),
                )
                c.execute(
                    "UPDATE log_entries SET revision=revision+1,updated_at=now() WHERE id=%s",
                    (entry_id,),
                )
                info = {
                    "attachment_id": attachment_id,
                    "filename": filename,
                    "sha256": digest,
                    "size": len(content),
                }
                c.execute(
                    "INSERT INTO log_history(entry_id,action,actor,detail) VALUES(%s,'Attachment added',%s,%s)",
                    (entry_id, u["name"], Jsonb(info)),
                )
                audit(
                    c,
                    u["name"],
                    "Logbook: Attachment added",
                    log_entry_id=entry_id,
                    **info,
                )
                return detail(c, entry_id, u)
        except Exception:
            destination.unlink(missing_ok=True)
            raise

    @routes.get("/{entry_id}/attachments/{attachment_id}")
    def download(entry_id: int, attachment_id: str, u=Depends(user)):
        with db() as c:
            log_access(c, u, entry_id)
            attachment = c.execute(
                "SELECT * FROM log_attachments WHERE id=%s AND entry_id=%s AND NOT deleted",
                (attachment_id, entry_id),
            ).fetchone()
            if not attachment:
                reject("Attachment not found.", 404)
            return FileResponse(
                files_dir() / attachment["id"],
                filename=attachment["filename"],
                media_type=attachment["media_type"],
                headers={"X-Content-Type-Options": "nosniff"},
            )

    @routes.delete("/{entry_id}/attachments/{attachment_id}")
    def remove_attachment(
        entry_id: int, attachment_id: str, revision: int, u=Depends(user)
    ):
        with db() as c:
            attachment_lock(c, entry_id, revision, u)
            row = c.execute(
                "UPDATE log_attachments SET deleted=true WHERE id=%s AND entry_id=%s AND NOT deleted RETURNING filename",
                (attachment_id, entry_id),
            ).fetchone()
            if not row:
                reject("Attachment not found.", 404)
            c.execute(
                "UPDATE log_entries SET revision=revision+1,updated_at=now() WHERE id=%s",
                (entry_id,),
            )
            c.execute(
                "INSERT INTO log_history(entry_id,action,actor,detail) VALUES(%s,'Attachment removed',%s,%s)",
                (
                    entry_id,
                    u["name"],
                    Jsonb(
                        {"attachment_id": attachment_id, "filename": row["filename"]}
                    ),
                ),
            )
            audit(
                c,
                u["name"],
                "Logbook: Attachment removed",
                log_entry_id=entry_id,
                attachment_id=attachment_id,
            )
            return detail(c, entry_id, u)

    return routes


def seed_logbook():
    """Only initialize an empty logbook; never replace existing operational work."""
    examples = [
        (
            "AHU-01",
            "Maintenance",
            "Open",
            "High",
            "Discharge temperature above operating limit. Facilities team to inspect the air handling unit and verify cooling performance.",
        ),
        (
            "FP-02",
            "Safety",
            "Open",
            "High",
            "Standby fire pump pressure test requires follow-up. Duty pump operational; supervisor notified.",
        ),
        (
            "CH-01",
            "Maintenance",
            "On Hold",
            "High",
            "Chiller strainer replacement awaiting delivery. Monitor temperature at the start of each shift.",
        ),
        (
            "LFT-03",
            "Operations",
            "Open",
            "Normal",
            "Lift door sensor intermittent. Technician scheduled for the afternoon maintenance window.",
        ),
        (
            "GEN-01",
            "Operations",
            "Closed",
            "Normal",
            "Weekly standby generator test completed. Fuel level checked and equipment returned to automatic mode.",
        ),
        (
            "AHU-02",
            "Inspection",
            "Closed",
            "Low",
            "Roof plant-room inspection complete. Access routes clear and equipment readings within limits.",
        ),
    ]
    with db() as c:
        c.execute("SELECT pg_advisory_xact_lock(268115)")
        if c.execute("SELECT count(*) AS n FROM log_entries").fetchone()["n"]:
            return
        for i, (asset, category, status, priority, message) in enumerate(examples):
            row = c.execute(
                """INSERT INTO log_entries(asset_id,category,status,priority,message,author,event_time,closed_by,closed_at)
                VALUES(%s,%s,%s,%s,%s,'James Wilson',now() - (%s * interval '18 minutes'),%s,%s) RETURNING id""",
                (
                    asset,
                    category,
                    status,
                    priority,
                    message,
                    i,
                    "James Wilson" if status == "Closed" else None,
                    datetime.now(timezone.utc) if status == "Closed" else None,
                ),
            ).fetchone()
            c.execute(
                "INSERT INTO log_history(entry_id,action,actor) VALUES(%s,'Demo entry initialized','Demo seed')",
                (row["id"],),
            )
            if i in [0, 1]:
                c.execute(
                    "INSERT INTO log_notes(entry_id,message,flagged,author) VALUES(%s,'Carry this item into the next facilities handover.',true,'James Wilson')",
                    (row["id"],),
                )
