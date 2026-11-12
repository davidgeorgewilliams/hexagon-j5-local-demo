"""Server-side logbook filtering, ordering, pagination and CSV export."""

import csv, io
from fastapi import Depends, Request
from fastapi.responses import Response
from .db import db
from .domain import reject
from .compat import parse_date


def attach(routes, user):
    def select(request, u, export=False):
        q = request.query_params
        where = []
        params = []
        if u.get("areas") is not None:
            where.append("a.building_id=ANY(%s)")
            params.append(u["areas"])
        base_where = list(where)
        base_params = list(params)
        search = q.get("search", "")
        if search:
            where.append(
                "(l.message ILIKE %s OR l.asset_id ILIKE %s OR l.author ILIKE %s OR ('LOG-'||lpad(l.id::text,4,'0')) ILIKE %s)"
            )
            params.extend(["%" + search + "%"] * 4)
        for key, column in [
            ("category", "l.category"),
            ("status", "l.status"),
            ("priority", "l.priority"),
            ("building", "a.building_id"),
            ("asset", "l.asset_id"),
        ]:
            if q.get(key):
                where.append(column + "=%s")
                params.append(q[key])
        if q.get("author"):
            where.append("l.author ILIKE %s")
            params.append("%" + q["author"] + "%")
        for key, op in [("from", ">="), ("to", "<")]:
            if q.get(key):
                where.append("l.event_time" + op + "%s")
                params.append(parse_date(q[key]))
        if q.get("flagged") == "true":
            where.append(
                "EXISTS(SELECT 1 FROM log_notes n WHERE n.entry_id=l.id AND n.flagged)"
            )
        if q.get("handover") == "true":
            where.append("l.add_to_handover")
        columns = {
            "id": "l.id",
            "event_time": "l.event_time",
            "building_name": "b.name",
            "category": "l.category",
            "message": "l.message",
            "status": "l.status",
            "priority": "l.priority",
            "author": "l.author",
            "asset_id": "l.asset_id",
        }
        order = columns.get(q.get("sort", "event_time"))
        if not order:
            reject("Unsupported logbook sort column.", 400)
        try:
            limit = 100000 if export else min(500, max(1, int(q.get("limit", "25"))))
            offset = 0 if export else max(0, int(q.get("offset", "0")))
        except ValueError:
            reject("Invalid pagination values.", 400)
        joins = " FROM log_entries l JOIN assets a ON a.id=l.asset_id JOIN buildings b ON b.id=a.building_id"
        clause = " WHERE " + " AND ".join(where) if where else ""
        with db() as c:
            total = c.execute(
                "SELECT count(*) AS n" + joins + clause, params
            ).fetchone()["n"]
            all_count = c.execute(
                "SELECT count(*) AS n"
                + joins
                + (" WHERE " + " AND ".join(base_where) if base_where else ""),
                base_params,
            ).fetchone()["n"]
            if export and total > 100000:
                reject(
                    "Narrow the filters before exporting more than 100,000 entries.",
                    413,
                )
            rows = c.execute(
                "SELECT l.*,a.name AS asset_name,b.name AS building_name,b.id AS building_id,(SELECT count(*) FROM log_notes n WHERE n.entry_id=l.id) AS note_count,(SELECT count(*) FROM log_notes n WHERE n.entry_id=l.id AND n.flagged) AS flag_count"
                + joins
                + clause
                + " ORDER BY "
                + order
                + (" ASC" if q.get("ascending") == "true" else " DESC")
                + ",l.id LIMIT %s OFFSET %s",
                (*params, limit, offset),
            ).fetchall()
        return {
            "values": rows,
            "total": total,
            "all_count": all_count,
            "offset": offset,
            "limit": limit,
        }

    @routes.get("/query")
    def query(request: Request, u=Depends(user)):
        return select(request, u)

    @routes.get("/export.csv")
    def export(request: Request, u=Depends(user)):
        rows = select(request, u, True)["values"]
        keys = [
            "id",
            "event_time",
            "building_name",
            "asset_id",
            "category",
            "message",
            "status",
            "priority",
            "author",
            "add_to_handover",
        ]
        stream = io.StringIO()
        writer = csv.writer(stream)
        writer.writerow(keys)
        for row in rows:
            values = []
            for key in keys:
                text = str(row[key])
                values.append(
                    "'" + text
                    if text.lstrip().startswith(("=", "+", "-", "@"))
                    else text
                )
            writer.writerow(values)
        return Response(
            "\ufeff" + stream.getvalue(),
            media_type="text/csv",
            headers={
                "Content-Disposition": 'attachment; filename="operations-logbook.csv"'
            },
        )
