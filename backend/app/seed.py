from psycopg.types.json import Jsonb
from .db import db, SCHEMA
from .domain import DEFAULT_CONFIG, audit


def initialize():
    with db() as c:
        c.execute("SELECT pg_advisory_xact_lock(268114)")
        c.execute(SCHEMA)
        if c.execute("SELECT count(*) AS n FROM config_versions").fetchone()["n"]:
            return
        version = c.execute(
            "INSERT INTO config_versions(definition,published_by) VALUES(%s,'Alex Morgan') RETURNING id",
            (Jsonb(DEFAULT_CONFIG),),
        ).fetchone()["id"]
        buildings = [
            ("north", "North Tower", "Commercial offices", 18),
            ("west", "West Residences", "Apartments", 12),
            ("central", "Central Services", "Campus infrastructure", 3),
            ("east", "East Exchange", "Commercial offices", 8),
        ]
        for b in buildings:
            c.execute("INSERT INTO buildings VALUES(%s,%s,%s,%s)", b)
        assets = [
            (
                "AHU-01",
                "north",
                "Air handling unit 01",
                "Level 18 · plant room",
                "HVAC",
            ),
            ("FP-02", "west", "Fire pump 02", "Basement · life safety", "Fire safety"),
            (
                "CH-01",
                "central",
                "Primary chiller",
                "Ground floor · energy centre",
                "HVAC",
            ),
            ("GEN-01", "central", "Standby generator", "Service yard", "Electrical"),
            ("LFT-03", "east", "Passenger lift 03", "East lobby", "Vertical transport"),
            ("AHU-02", "east", "Air handling unit 02", "Roof · plant room", "HVAC"),
        ]
        for a in assets:
            c.execute("INSERT INTO assets VALUES(%s,%s,%s,%s,%s)", a)
        samples = [
            (
                "Morning mechanical plant inspection",
                "AHU-01",
                "Draft",
                "Normal",
                24,
                "Routine inspection in progress.",
                "Inspection",
            ),
            (
                "Fire pump pressure fluctuation",
                "FP-02",
                "Submitted",
                "High",
                28,
                "Intermittent pressure drop. Standby pump available; maintenance investigation required.",
                "Safety",
            ),
            (
                "Chilled-water supply temperature high",
                "CH-01",
                "Approved",
                "High",
                38,
                "Cooling performance reduced. Temporary monitoring in place pending strainer replacement.",
                "Maintenance",
            ),
            (
                "Standby power weekly verification",
                "GEN-01",
                "Closed",
                "Normal",
                27,
                "Automatic transfer and fuel level verified. No defects found.",
                "Inspection",
            ),
            (
                "Lift door sensor intermittent fault",
                "LFT-03",
                "Submitted",
                "High",
                23,
                "Intermittent door sensor warning. Lift isolated and service contractor notified.",
                "Maintenance",
            ),
            (
                "East Exchange ventilation checks",
                "AHU-02",
                "Closed",
                "Normal",
                25,
                "Filters, belt tension and discharge temperature satisfactory.",
                "Inspection",
            ),
        ]
        for i, (title, asset, state, priority, temp, note, cat) in enumerate(samples):
            values = {
                "temperature": temp,
                "condition": "Normal" if priority == "Normal" else "Attention required",
                "access": True,
                "observations": note,
            }
            r = c.execute(
                "INSERT INTO records(title,asset_id,state,priority,config_id,values_json,owner_name,category,created_at,updated_at) VALUES(%s,%s,%s,%s,%s,%s,'Maya Chen',%s,now()-(%s*interval '37 minutes'),now()-(%s*interval '21 minutes')) RETURNING id",
                (
                    title,
                    asset,
                    state,
                    priority,
                    version,
                    Jsonb(values),
                    cat,
                    i + 1,
                    i + 1,
                ),
            ).fetchone()
            audit(
                c,
                "Demo seed",
                "Sample record loaded",
                r["id"],
                note="Illustrative fixture; not a real inspection or approval.",
            )
            if priority == "High":
                c.execute(
                    "INSERT INTO tasks(record_id,title,assignee,due_at) VALUES(%s,%s,%s,now()+(%s*interval '1 hour'))",
                    (
                        r["id"],
                        [
                            "",
                            "Investigate pump pressure and test standby",
                            "Replace chiller strainer and verify temperature",
                            "",
                            "Inspect lift door sensor",
                        ][i],
                        "Facilities team",
                        -1 if i == 2 else 3,
                    ),
                )
        audit(
            c,
            "Alex Morgan",
            "Configuration published",
            version=version,
            name=DEFAULT_CONFIG["name"],
        )
