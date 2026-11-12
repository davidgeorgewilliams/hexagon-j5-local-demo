"""Durable workflow deadlines; claimed inside the record transaction."""

from datetime import datetime, timezone, timedelta
from .db import db
from .workflows import source_active
from .domain import audit


def sync_timers(c, record_id, config, active):
    candidates = {
        t["id"]: t
        for t in config["transitions"]
        if t.get("event") == "timer" and source_active(config, t["source"], active)
    }
    pending = c.execute(
        "SELECT * FROM workflow_timers WHERE record_id=%s AND status IN ('Pending','Blocked') FOR UPDATE",
        (record_id,),
    ).fetchall()
    for timer in pending:
        if timer["transition_id"] not in candidates:
            c.execute(
                "UPDATE workflow_timers SET status='Cancelled' WHERE id=%s",
                (timer["id"],),
            )
    existing = {t["transition_id"] for t in pending if t["transition_id"] in candidates}
    for key, t in candidates.items():
        if key not in existing:
            c.execute(
                "INSERT INTO workflow_timers(record_id,transition_id,source,due_at) VALUES(%s,%s,%s,%s)",
                (
                    record_id,
                    key,
                    t["source"],
                    datetime.now(timezone.utc) + timedelta(seconds=t["after_seconds"]),
                ),
            )


def process_due():
    from .main import transition, Transition
    from fastapi import HTTPException

    with db() as c:
        timers = c.execute(
            "SELECT t.id,t.record_id,r.revision FROM workflow_timers t JOIN records r ON r.id=t.record_id WHERE t.status='Pending' AND t.due_at<=now() ORDER BY t.due_at LIMIT 20"
        ).fetchall()
    for timer in timers:
        with db() as c:
            entry = c.execute(
                "SELECT * FROM workflow_timers WHERE id=%s", (timer["id"],)
            ).fetchone()
        try:
            transition(
                timer["record_id"],
                Transition(
                    transition_id=entry["transition_id"],
                    revision=timer["revision"],
                    note="Scheduled workflow deadline reached.",
                ),
                {
                    "name": "Workflow timer",
                    "role": "administrator",
                    "areas": None,
                    "timer_id": timer["id"],
                },
            )
        except HTTPException as error:
            if error.status_code == 409 and "changed in another" in str(error.detail):
                continue
            with db() as c:
                row = c.execute(
                    "UPDATE workflow_timers SET status='Blocked',last_error=%s WHERE id=%s AND status='Pending' RETURNING record_id",
                    (str(error.detail)[:1000], timer["id"]),
                ).fetchone()
                if row:
                    audit(
                        c,
                        "Workflow timer",
                        "Scheduled transition blocked",
                        row["record_id"],
                        timer_id=timer["id"],
                        error=str(error.detail),
                    )
