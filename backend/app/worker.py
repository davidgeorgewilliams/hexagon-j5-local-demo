import logging
import os
import time
import httpx
from psycopg.types.json import Jsonb
from .db import db
from .domain import audit, create_task, validate_values
from .workflows import initialize_workflow
from fastapi import HTTPException

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


def tick():
    from .timers import process_due, sync_timers

    process_due()
    with db() as c:
        c.execute(
            "INSERT INTO worker_health VALUES(1,now()) ON CONFLICT(id) DO UPDATE SET last_seen=now()"
        )
        overdue = c.execute(
            "UPDATE tasks SET escalated=true WHERE status='Open' AND due_at<now() AND NOT escalated RETURNING *"
        ).fetchall()
        for t in overdue:
            audit(
                c,
                "Escalation worker",
                "Overdue task escalated",
                t["record_id"],
                task_id=t["id"],
                assignee=t["assignee"],
            )
    with db() as c:
        j = c.execute(
            "SELECT * FROM jobs WHERE status IN ('Queued','Retrying') AND available_at<=now() ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1"
        ).fetchone()
        if not j:
            return
        p, attempt = j["payload"], j["attempts"] + 1
        try:
            if j["kind"] == "sensor":
                cfg = c.execute(
                    "SELECT * FROM config_versions WHERE is_global ORDER BY id DESC LIMIT 1"
                ).fetchone()
                scoped = c.execute(
                    "SELECT cv.* FROM config_versions cv JOIN config_bindings b ON b.config_id=cv.id JOIN assets a ON a.building_id=b.scope WHERE a.id=%s",
                    (p["asset_id"],),
                ).fetchone()
                cfg = scoped or cfg
                temperature_field = next(
                    (
                        f
                        for f in cfg["definition"]["fields"]
                        if f["id"] == "temperature" and f["type"] == "number"
                    ),
                    None,
                )
                if not temperature_field or temperature_field.get("max") is None:
                    raise ValueError(
                        "Published form needs a numeric temperature field with an upper limit for this adapter."
                    )
                if p["temperature"] > temperature_field["max"]:
                    known = {f["id"] for f in cfg["definition"]["fields"]}
                    values = {
                        k: v
                        for k, v in {
                            "temperature": p["temperature"],
                            "condition": "Attention required",
                            "observations": "Sensor threshold exceeded. Physical verification and photographic evidence required.",
                        }.items()
                        if k in known
                    }
                    defaults = {
                        f["id"]: f["default"]
                        for f in cfg["definition"]["fields"]
                        if "default" in f
                    }
                    initial = initialize_workflow(
                        cfg["definition"],
                        {**defaults, **values},
                        {"event_user": "Sensor gateway"},
                    )
                    try:
                        validate_values(cfg["definition"], initial["values"])
                    except HTTPException as error:
                        raise ValueError(error.detail) from None
                    r = c.execute(
                        "INSERT INTO records(title,asset_id,category,priority,config_id,values_json,active_states,owner_name) VALUES(%s,%s,'Maintenance','High',%s,%s,%s,'Sensor gateway') RETURNING id",
                        (
                            f"High temperature alert · {p['asset_id']}",
                            p["asset_id"],
                            cfg["id"],
                            Jsonb(initial["values"]),
                            Jsonb(initial["active_states"]),
                        ),
                    ).fetchone()
                    sync_timers(c, r["id"], cfg["definition"], initial["active_states"])
                    task = create_task(
                        c,
                        r["id"],
                        f"Verify {p['asset_id']} temperature alert: {p['temperature']}°C",
                    )
                    audit(
                        c,
                        "Sensor worker",
                        "Sensor exception created",
                        r["id"],
                        job_id=j["id"],
                        task_id=task["id"],
                        temperature=p["temperature"],
                        effects=initial["effects"],
                    )
                else:
                    audit(
                        c,
                        "Sensor worker",
                        "Sensor reading within configured limit",
                        job_id=j["id"],
                        **p,
                    )
            elif j["kind"] == "integration":
                response = httpx.post(
                    os.getenv(
                        "MAINTENANCE_URL", "http://api:8000/internal/maintenance"
                    ),
                    json={**p, "attempt": attempt},
                    headers={
                        "X-Worker-Token": os.getenv(
                            "INTERNAL_TOKEN", "local-worker-demo-token"
                        )
                    },
                    timeout=5,
                )
                response.raise_for_status()
                audit(
                    c,
                    "Integration worker",
                    "Maintenance work order synchronized",
                    p["record_id"],
                    job_id=j["id"],
                    **response.json(),
                )
            else:
                raise ValueError("Unknown job kind")
            c.execute(
                "UPDATE jobs SET status='Completed',attempts=%s,completed_at=now(),last_error=NULL WHERE id=%s",
                (attempt, j["id"]),
            )
            logging.info("Completed %s job %s", j["kind"], j["id"])
        except (httpx.HTTPError, ValueError) as e:
            status = "Failed" if attempt >= 5 else "Retrying"
            c.execute(
                "UPDATE jobs SET status=%s,attempts=%s,last_error=%s,available_at=now()+(%s*interval '1 second') WHERE id=%s",
                (status, attempt, str(e)[:500], min(2**attempt * 2, 60), j["id"]),
            )
            audit(
                c,
                "Integration worker",
                "Job retry scheduled" if status == "Retrying" else "Job failed",
                p.get("record_id"),
                job_id=j["id"],
                attempt=attempt,
                error=str(e)[:300],
            )
            logging.warning("Job %s: %s", j["id"], status)


if __name__ == "__main__":
    while True:
        try:
            tick()
        except Exception:
            logging.exception("Worker cycle failed; retrying")
        time.sleep(2)
