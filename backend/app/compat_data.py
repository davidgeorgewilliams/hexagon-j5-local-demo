"""Documented master-data and datapoint transport contracts, backed by local records."""

import json, uuid
from datetime import datetime, timezone
from zoneinfo import available_timezones
from fastapi import Depends, Request
from psycopg.types.json import Jsonb
from .db import db
from .domain import USERS, reject, audit
from .access import permits, asset_access, identity


def seed_points():
    with db() as c:
        c.execute(
            "INSERT INTO data_points(id,asset_id,description,label,unit) SELECT id||'.temperature',id,'Discharge temperature','Temperature','°C' FROM assets WHERE NOT deleted ON CONFLICT DO NOTHING"
        )


def attach(routes, auth):
    from .compat import iso, cursor, next_link, parse_date, area_path

    def meta(u, **extra):
        return {
            **extra,
            "requestDate": iso(datetime.now(timezone.utc)),
            "requestedBy": u["username"],
        }

    @routes.get("/restserver/30/area_hierarchy/areas")
    def areas(request: Request, u=Depends(auth)):
        with db() as c:
            buildings = c.execute("SELECT * FROM buildings ORDER BY id").fetchall()
        result = [
            {
                "name": "campus",
                "description": "Northbank Campus",
                "deleted": False,
                "depth": 0,
                "parent": None,
            }
        ] + [
            {
                "name": b["id"],
                "description": b["name"],
                "deleted": False,
                "depth": 1,
                "parent": "campus",
            }
            for b in buildings
            if permits(u, b["id"])
        ]
        start = cursor(request)
        page = result[start : start + 1000]
        return {
            "responseCode": 200,
            "nextLink": next_link(request, start + 1000)
            if start + 1000 < len(result)
            else None,
            "areas": page,
        }

    @routes.get("/restserver/30/asset_register/searchAsset/{searchTerm}")
    def search(searchTerm: str, u=Depends(auth)):
        with db() as c:
            rows = c.execute(
                "SELECT * FROM assets WHERE NOT deleted AND (id ILIKE %s OR name ILIKE %s) ORDER BY id,name",
                ("%" + searchTerm + "%", "%" + searchTerm + "%"),
            ).fetchall()
        return {
            "meta": meta(u, searchTerm=searchTerm),
            "matchingAssets": [
                {"asset_name": a["id"], "description": a["name"]}
                for a in rows
                if permits(u, a["building_id"])
            ][:100],
        }

    @routes.put("/restserver/30/asset_register/assets")
    def assets_update(body: dict, u=Depends(auth)):
        if u["role"] != "administrator":
            reject("Asset configuration requires administrator access.", 403)
        number, total = body.get("batchNumber"), body.get("totalBatches")
        assets = body.get("assets")
        if (
            type(number) != int
            or type(total) != int
            or not 1 <= number <= total <= 100
            or not isinstance(assets, list)
            or not 1 <= len(assets) <= 1000
        ):
            reject("Specify valid batchNumber, totalBatches and 1–1,000 assets.", 400)
        if body.get("callbackURL"):
            reject(
                "External callback delivery is not enabled in this local adapter.", 400
            )
        tid = body.get("transactionID")
        with db() as c:
            c.execute("SELECT pg_advisory_xact_lock(268118)")
            if not tid:
                tid = str(uuid.uuid4())
                c.execute(
                    "INSERT INTO asset_batches(transaction_id,username,total) VALUES(%s,%s,%s)",
                    (tid, u["username"], total),
                )
                if total > 1:
                    return {"batchNumber": number, "transactionID": tid}
            try:
                uuid.UUID(str(tid))
            except ValueError:
                reject("Invalid transactionID.", 400)
            transaction = c.execute(
                "SELECT * FROM asset_batches WHERE transaction_id=%s FOR UPDATE", (tid,)
            ).fetchone()
            if (
                not transaction
                or transaction["username"] != u["username"]
                or transaction["total"] != total
            ):
                reject("Unknown or mismatched asset transaction.", 400)
            batches = transaction["batches"]
            key = str(number)
            if key in batches and batches[key] != assets:
                reject("This batch was already supplied with different contents.", 409)
            if transaction["completed"]:
                return {"batchNumber": number, "transactionID": tid}
            batches[key] = assets
            if len(batches) == total:
                all_assets = [a for i in range(1, total + 1) for a in batches[str(i)]]
                if any(
                    not isinstance(a, dict) or not isinstance(a.get("asset_name"), str)
                    for a in all_assets
                ):
                    reject("Each asset needs a text asset_name.", 400)
                existing = c.execute("SELECT id,parent FROM assets").fetchall()
                known = {a["id"] for a in existing} | {
                    a["asset_name"] for a in all_assets
                }
                parents = {a["id"]: a["parent"] for a in existing}
                parents.update({a["asset_name"]: a.get("parent") for a in all_assets})
                for name in parents:
                    visited = set()
                    node = name
                    while node is not None:
                        if not isinstance(node, str) or node in visited:
                            reject(
                                "Asset parents must be text IDs without cycles.", 400
                            )
                        visited.add(node)
                        node = parents.get(node)
                known_areas = {
                    b["id"] for b in c.execute("SELECT id FROM buildings").fetchall()
                }
                for a in all_assets:
                    if (
                        not isinstance(a, dict)
                        or not isinstance(a.get("asset_name"), str)
                        or not 1 <= len(a["asset_name"]) <= 120
                        or not isinstance(a.get("description"), str)
                    ):
                        reject("Each asset needs asset_name and description.", 400)
                    area = a.get("area")
                    area = area.split(":")[-1] if isinstance(area, str) else area
                    if not a.get("deleted") and area not in known_areas:
                        reject("Choose an existing operational area.", 400)
                    if a.get("parent") is not None and (
                        a["parent"] not in known or a["parent"] == a["asset_name"]
                    ):
                        reject("Unknown or self-referencing asset parent.", 400)
                    for coord, limit in [("latitude", 90), ("longitude", 180)]:
                        if a.get(coord) is not None and (
                            type(a[coord]) not in [float, int]
                            or not -limit <= a[coord] <= limit
                        ):
                            reject("Invalid coordinate.", 400)
                for a in all_assets:
                    area = a.get("area")
                    area = area.split(":")[-1] if isinstance(area, str) else area
                    if a.get("deleted"):
                        c.execute(
                            "UPDATE assets SET deleted=true WHERE id=%s",
                            (a["asset_name"],),
                        )
                        continue
                    c.execute(
                        "INSERT INTO assets(id,name,building_id,location,kind,parent,latitude,longitude) VALUES(%s,%s,%s,'Imported asset','Equipment',%s,%s,%s) ON CONFLICT(id) DO UPDATE SET name=excluded.name,building_id=excluded.building_id,parent=excluded.parent,latitude=excluded.latitude,longitude=excluded.longitude,deleted=false",
                        (
                            a["asset_name"],
                            a["description"],
                            area,
                            a.get("parent"),
                            a.get("latitude"),
                            a.get("longitude"),
                        ),
                    )
                audit(
                    c,
                    u["name"],
                    "Asset batch applied",
                    transaction_id=tid,
                    assets=len(all_assets),
                )
            c.execute(
                "UPDATE asset_batches SET batches=%s,completed=%s WHERE transaction_id=%s",
                (Jsonb(batches), len(batches) == total, tid),
            )
        seed_points()
        return {"batchNumber": number, "transactionID": tid}

    def point(c, u, pid):
        row = c.execute("SELECT * FROM data_points WHERE id=%s", (pid,)).fetchone()
        if not row:
            reject("Unknown data point.", 400)
        asset_access(c, u, row["asset_id"])
        return row

    def bounds(request, required=False):
        q = request.query_params
        if required and not (q.get("fromDate") and q.get("toDate")):
            reject("fromDate and toDate are required.", 400)
        start, end = parse_date(q.get("fromDate")), parse_date(q.get("toDate"))
        if start and end and start > end:
            reject("fromDate must not follow toDate.", 400)
        try:
            size = int(q.get("pageSize", "100"))
        except ValueError:
            reject("pageSize must be a positive integer.", 400)
        if size < 1:
            reject("pageSize must be positive.", 400)
        return start, end, min(size, 1000)

    def history(c, pid, start, end):
        return c.execute(
            "SELECT value,timestamp FROM data_point_history WHERE point_id=%s AND (%s::timestamptz IS NULL OR timestamp>=%s) AND (%s::timestamptz IS NULL OR timestamp<=%s) ORDER BY timestamp,id",
            (pid, start, start, end, end),
        ).fetchall()

    @routes.get("/restserver/30/datapoints/history/get/{data_point_id}")
    def point_history(data_point_id: str, request: Request, u=Depends(auth)):
        start, end, size = bounds(request)
        offset = cursor(request)
        with db() as c:
            point(c, u, data_point_id)
            rows = history(c, data_point_id, start, end)
        return {
            "meta": meta(
                u,
                data_point_id=data_point_id,
                nextLink=next_link(request, offset + size)
                if offset + size < len(rows)
                else None,
            ),
            "records": [
                {"value": r["value"], "timestamp": iso(r["timestamp"])}
                for r in rows[offset : offset + size]
            ],
        }

    @routes.get("/restserver/30/datapoints/history/list/{data_point_ids}")
    def points_history(data_point_ids: str, request: Request, u=Depends(auth)):
        start, end, size = bounds(request, True)
        ids = data_point_ids.split(",")
        if len(ids) > 100:
            reject("Query up to 100 data points.", 400)
        records = {}
        with db() as c:
            for pid in ids:
                point(c, u, pid)
                records[pid] = [
                    {"value": r["value"], "timestamp": iso(r["timestamp"])}
                    for r in history(c, pid, start, end)[:size]
                ]
        return {"meta": meta(u), "records": records}

    @routes.get("/restserver/30/datapoints/asset/{asset_id}")
    def asset_points(asset_id: str, u=Depends(auth)):
        with db() as c:
            if not c.execute(
                "SELECT id FROM assets WHERE id=%s", (asset_id,)
            ).fetchone():
                reject("Unknown asset.", 400)
            asset_access(c, u, asset_id)
            rows = c.execute(
                "SELECT * FROM data_points WHERE asset_id=%s ORDER BY id", (asset_id,)
            ).fetchall()
        return {
            "meta": meta(u, asset_id=asset_id),
            "datapoints": [
                {
                    "data_point_id": r["id"],
                    "description": r["description"],
                    "label": r["label"],
                    "input_type": r["input_type"],
                    "unit_of_measure": r["unit"],
                }
                for r in rows
            ],
        }

    @routes.get("/ssf/datastore/predefined/{name}")
    def datastore(name: str, request: Request, u=Depends(auth)):
        with db() as c:
            buildings = [
                b
                for b in c.execute("SELECT * FROM buildings ORDER BY name").fetchall()
                if permits(u, b["id"])
            ]
        if name == "area_hierarchy":
            nodes = [
                {
                    "id": "campus",
                    "label": "Northbank Campus",
                    "parent": None,
                    "color": None,
                }
            ] + [
                {"id": b["id"], "label": b["name"], "parent": "campus", "color": None}
                for b in buildings
            ]
            if request.query_params.get("locale"):
                for node in nodes:
                    node["label.translation"] = node["label"]
            flat = request.query_params.get("flathierarchy", "false").lower() == "true"
            if not flat:
                nodes = [
                    {**nodes[0], "children": [{**n, "children": []} for n in nodes[1:]]}
                ]
            return {
                "type": "flathierarchy" if flat else "hierarchy",
                "dependencies": [],
                "data": nodes,
            }
        if name == "timezones":
            return {
                "type": "list",
                "dependencies": [],
                "data": [{"id": z, "label": z} for z in sorted(available_timezones())],
            }
        if name == "groups":
            return {
                "type": "itemlookup",
                "dependencies": [],
                "data": {
                    k: {"id": k, "label": k.title()}
                    for k in ["technician", "supervisor", "administrator"]
                },
            }
        if name == "users":
            users = [
                {
                    "id": k,
                    "username": k,
                    "label": v["name"],
                    "full_name": v["name"],
                    "groups": [v["role"]],
                    "areas": identity(k)["areas"],
                }
                for k, v in USERS.items()
            ]
            return {
                "type": "list",
                "dependencies": ["timezones", "groups", "area_hierarchy"],
                "data": users,
            }
        if name in ["logtype_hierarchy", "operator_round_type", "work_category"]:
            cats = [
                "Operations",
                "Maintenance",
                "Safety",
                "Inspection",
                "Downtime",
                "Lab",
            ]
            return {
                "type": "flathierarchy",
                "dependencies": [],
                "data": [
                    {"id": v, "label": v, "parent": None, "color": None} for v in cats
                ],
            }
        reject("This datastore is not implemented by the local model.", 404)

    @routes.get("/ssf/datastore/database/{name}")
    def database_store(name: str, request: Request, u=Depends(auth)):
        if (
            name != "db_datastore:asset_register"
            or request.query_params.get("tablename") != "asset_register"
            or request.query_params.get("id_column") != "asset_name"
            or request.query_params.get("label_column") != "description"
        ):
            reject("Only the documented asset-register mapping is enabled.", 400)
        with db() as c:
            rows = c.execute(
                "SELECT * FROM assets WHERE NOT deleted ORDER BY id"
            ).fetchall()
        return {
            "type": "list",
            "dependencies": [],
            "data": [
                {
                    "id": r["id"],
                    "label": r["name"],
                    "asset_name": r["id"],
                    "description": r["name"],
                    "area": area_path(r["building_id"]),
                }
                for r in rows
                if permits(u, r["building_id"])
            ],
        }
