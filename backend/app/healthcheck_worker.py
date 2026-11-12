import sys
from .db import db

with db() as conn:
    row = conn.execute(
        "SELECT last_seen>now()-interval '20 seconds' AS healthy FROM worker_health WHERE id=1"
    ).fetchone()
    sys.exit(0 if row and row["healthy"] else 1)
