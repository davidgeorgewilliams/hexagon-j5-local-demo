"""Documentation-derived J5 v30 transport contracts over local models."""

import base64, csv, hashlib, hmac, io, json, os, secrets
from datetime import datetime, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from fastapi import APIRouter, Depends, Request, Response, HTTPException
from fastapi.encoders import jsonable_encoder
from .db import db
from .domain import USERS, reject, validate_values, exceptions
from .access import identity, permits
from .formulas import Engine, FormulaError

SOURCE = "https://docs.hexagonppm.com/r/en-US/j5-API-Reference/Version-30/"
ELEMENT_ATTRS = {
    "Value",
    "DisplayValue",
    "IsDefined",
    "IsValid",
    "IsError",
    "Error",
    "IsHtml",
    "IsTask",
    "LastModifiedTime",
    "LastModifiedUser",
    "NormalMax",
    "NormalMin",
    "ValidMax",
    "ValidMin",
    "NoReadingAvailable",
    "Latitude",
    "Longitude",
    "Altitude",
    "LocationAccuracy",
    "AltitudeAccuracy",
    "SignatureSVG",
    "SignatureTime",
    "SignatureUserDisplayName",
}
DEFAULT_ATTRS = {"Value", "DisplayValue", "IsDefined", "IsValid", "IsError", "Error"}
FORM_ATTRS = {
    "Area",
    "Category",
    "DateTime",
    "FlagsPending",
    "FlagsTotal",
    "IsComplete",
    "last_modification",
    "ParentLogID",
    "SectionsWaitingForApproval",
    "SectionsWaitingForRevision",
    "SectionsWaitingForSubmission",
    "SpecificationName",
    "SpecificationVersion",
    "StateName",
    "StateDisplayName",
    "Status",
    "UUID",
}
PAGE_SIZE = 1000


def iso(value):
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    return value


def parse_date(raw):
    if not raw:
        return None
    try:
        result = datetime.fromisoformat(raw.replace("z", "Z").replace("Z", "+00:00"))
        if result.tzinfo is None:
            raise ValueError()
        return result
    except ValueError:
        reject("Use an RFC3339 timestamp including a timezone.", 400)


def cursor(request, offset=None):
    query = sorted(
        (k, v) for k, v in request.query_params.multi_items() if k != "skiptoken"
    )
    fingerprint = hashlib.sha256(
        json.dumps([request.url.path, query]).encode()
    ).hexdigest()
    secret = os.getenv("INTERNAL_TOKEN", "local-worker-demo-token").encode()
    if offset is not None:
        payload = json.dumps([offset, fingerprint], separators=(",", ":")).encode()
        sig = hmac.new(secret, payload, hashlib.sha256).digest()
        return base64.urlsafe_b64encode(payload + sig).decode().rstrip("=")
    token = request.query_params.get("skiptoken")
    if not token:
        return 0
    try:
        raw = base64.urlsafe_b64decode(token + "=" * (-len(token) % 4))
        payload, sig = raw[:-32], raw[-32:]
        start, fp = json.loads(payload)
        if (
            not hmac.compare_digest(
                sig, hmac.new(secret, payload, hashlib.sha256).digest()
            )
            or fp != fingerprint
            or type(start) != int
            or start < 0
        ):
            raise ValueError()
        return start
    except (ValueError, TypeError, UnicodeError):
        reject("Invalid skiptoken for this query.", 400)


def next_link(request, offset):
    return str(request.url.include_query_params(skiptoken=cursor(request, offset)))


def username(name):
    return next((k for k, v in USERS.items() if v["name"] == name), name)


def area_path(area):
    return "campus:" + area


def router(user, password):
    routes = APIRouter()

    def auth(request: Request):
        header = request.headers.get("authorization", "")
        if not header:
            return user(request)
        try:
            scheme, encoded = header.split(" ", 1)
            name, provided = (
                base64.b64decode(encoded, validate=True).decode().split(":", 1)
            )
            if (
                scheme.lower() != "basic"
                or name not in USERS
                or not secrets.compare_digest(provided, password)
            ):
                raise ValueError()
            return identity(name)
        except (ValueError, UnicodeError):
            raise HTTPException(
                401,
                "Invalid Basic authentication.",
                headers={"WWW-Authenticate": 'Basic realm="Campus J5 demo"'},
            )

    @routes.get("/api/native-contract")
    def contract(u=Depends(user)):
        return {
            "implementation": "Documentation-derived local adapter",
            "native_verified": False,
            "source": SOURCE + "1277228",
            "methods": [
                "logbook-query",
                "logbook-query-v2",
                "areas",
                "searchAsset",
                "assets",
                "datapoints/history/get",
                "datapoints/history/list",
                "datapoints/asset",
                "datastore",
            ],
            "logbooks": ["campus_inspections", "operator_rounds", "general_logbook"],
            "element_attributes": sorted(ELEMENT_ATTRS),
            "form_attributes": sorted(FORM_ATTRS),
            "extensions": ["local_area", "local_from", "local_to"],
            "parameters": [
                "attribute_names",
                "area",
                "category",
                "status",
                "logid",
                "form_spec_name",
                "from_date_time",
                "to_date_time",
                "last_modified",
                "top",
                "pretty",
                "query_repeating",
                "default_element_attribute",
                "display_locale_name",
                "display_timezone_name",
                "skiptoken",
            ],
            "notes": [
                "Queries follow the documented parameters, undefined-element semantics, CSV negotiation and nextLink envelopes.",
                "Local form/asset IDs and status models are used. Full native schema and runtime parity are not claimed.",
                "Formula-error DisplayValue uses the error-name string, following the documentation example; prose differs.",
                "No assigned participant model or signatures/GPS readings: undefined attributes return null/IsDefined=false.",
                "Native round-definition export/import schemas are not published in the reference and are not fabricated.",
                "Only one repeating section per query; no native task/signature/GPS element types or participant assignments.",
                "Section counts, flags, completion and specification hashes map to local whole-form records.",
                "Asset callbacks, measurement-parent methods and native round definitions/plans are not implemented.",
                "User/group/timezone datastore envelopes are local interpretations where the public reference omits schemas.",
                "Native query/history pagination is implemented over in-memory result sets, without load testing.",
            ],
        }

    @routes.get("/restserver/30/industraform/{method}/{logbook}")
    def query(method: str, logbook: str, request: Request, u=Depends(auth)):
        if method not in ["logbook-query", "logbook-query-v2"] or logbook not in [
            "campus_inspections",
            "operator_rounds",
            "general_logbook",
        ]:
            reject("Unsupported logbook or query method.", 404)
        q = request.query_params
        allowed = {
            "attribute_names",
            "area",
            "category",
            "status",
            "logid",
            "form_spec_name",
            "from_date_time",
            "to_date_time",
            "last_modified",
            "top",
            "pretty",
            "query_repeating",
            "default_element_attribute",
            "display_locale_name",
            "display_timezone_name",
            "skiptoken",
            "local_area",
            "local_from",
            "local_to",
        }
        if set(q) - allowed:
            reject(
                "Unsupported query parameters: " + ", ".join(sorted(set(q) - allowed)),
                400,
            )
        attrs = [a.strip() for a in q.get("attribute_names", "").split(",")]
        if not 1 <= len(attrs) <= 200 or any(not a for a in attrs):
            reject("Request 1–200 attribute names.", 400)
        default = q.get("default_element_attribute", "Value")
        if default not in DEFAULT_ATTRS:
            reject("Invalid default_element_attribute.", 400)

        def boolean(name):
            val = q.get(name, "false").lower()
            if val not in ["true", "false"]:
                reject(name + " must be true or false.", 400)
            return val == "true"

        repeating = boolean("query_repeating")
        pretty = boolean("pretty")
        try:
            top = int(q.get("top", "2147483647"))
            tz = ZoneInfo(q.get("display_timezone_name", "UTC"))
        except (ValueError, ZoneInfoNotFoundError):
            reject("Invalid top or display timezone.", 400)
        if top < 0:
            reject("top cannot be negative.", 400)
        locale = q.get("display_locale_name", "en-GB")
        if locale not in ["en-GB", "en-US", "en", "de-DE", "fr-FR"]:
            reject(
                "This local adapter supports display locales en-GB, en-US, en, de-DE and fr-FR.",
                400,
            )
        start = parse_date(q.get("from_date_time", q.get("local_from")))
        end = parse_date(q.get("to_date_time", q.get("local_to")))
        modified = parse_date(q.get("last_modified"))
        if start and end and start > end:
            reject("from_date_time must not follow to_date_time.", 400)
        with db() as c:
            if logbook == "general_logbook":
                records = c.execute(
                    "SELECT l.*,a.building_id,a.name AS asset_name FROM log_entries l JOIN assets a ON a.id=l.asset_id ORDER BY l.id"
                ).fetchall()
                for r in records:
                    r.update(
                        state=r["status"],
                        owner_name=r["author"],
                        primary_time=r["event_time"],
                        definition={"name": "$local.general_logbook", "fields": []},
                        values_json={
                            "Message": r["message"],
                            "EventTime": iso(r["event_time"]),
                            "Equipment": r["asset_id"],
                            "Priority": r["priority"],
                            "CreatedByUser": username(r["author"]),
                        },
                    )
                    r["definition"]["fields"] = [
                        {
                            "id": k,
                            "label": k,
                            "type": "datetime" if k == "EventTime" else "text",
                            "required": False,
                        }
                        for k in r["values_json"]
                    ]
            else:
                records = c.execute(
                    "SELECT r.*,a.building_id,a.name AS asset_name,cv.definition FROM records r JOIN assets a ON a.id=r.asset_id JOIN config_versions cv ON cv.id=r.config_id ORDER BY r.id"
                ).fetchall()
                for r in records:
                    r["primary_time"] = r["created_at"]
            results = []
            for r in records:
                if not permits(u, r["building_id"]):
                    continue
                cfg = r["definition"]
                values = r["values_json"]
                spec = cfg.get(
                    "specification_name",
                    "$local.campus.inspection"
                    if logbook != "general_logbook"
                    else "$local.general_logbook",
                )
                area = q.get("area")
                category = q.get("category")
                status = q.get("status")
                ids = q.get("logid")
                if area and not (
                    area_path(r["building_id"]) == area
                    or area_path(r["building_id"]).startswith(area + ":")
                ):
                    continue
                if q.get("local_area") and r["building_id"] != q["local_area"]:
                    continue
                if category and not any(
                    r["category"] == k or r["category"].startswith(k + ":")
                    for k in category.split(",")
                ):
                    continue
                if status and r["state"] not in status.split(","):
                    continue
                if (
                    ids
                    and str(r["native_uuid"]) not in ids.split(",")
                    and str(r["id"]) not in ids.split(",")
                ):
                    continue
                if q.get("form_spec_name") and spec != q["form_spec_name"]:
                    continue
                if (
                    start
                    and r["primary_time"] < start
                    or end
                    and r["primary_time"] >= end
                    or modified
                    and r["updated_at"] <= modified
                ):
                    continue
                flags = exceptions(cfg, values)
                fields = {f["id"]: f for f in cfg["fields"]}
                builtins = {
                    "EntryNumber": f"{'LOG' if logbook == 'general_logbook' else 'INS'}-{r['id']:04d}",
                    "logid": str(r["native_uuid"]),
                    "ResponsiblePerson": username(r["owner_name"]),
                    "Priority": r["priority"],
                    "StartedTime": iso(r["created_at"]),
                    "State": r["state"],
                    "Equipment": r["asset_id"],
                    "Area": area_path(r["building_id"]),
                }
                form = {
                    "Area": area_path(r["building_id"]),
                    "Category": r["category"],
                    "DateTime": iso(r["primary_time"]),
                    "FlagsTotal": len(flags),
                    "FlagsPending": len(flags) if r["state"] == "Draft" else 0,
                    "IsComplete": r["state"] in ["Approved", "Closed"],
                    "last_modification": iso(r["updated_at"]),
                    "ParentLogID": str(r["native_uuid"]),
                    "UUID": str(r["native_uuid"]),
                    "Status": r["state"],
                    "StateName": r["state"],
                    "StateDisplayName": r["state"],
                    "SpecificationName": spec,
                    "SpecificationVersion": hashlib.sha1(
                        json.dumps(cfg, sort_keys=True).encode()
                    ).hexdigest(),
                    "SectionsWaitingForApproval": int(r["state"] == "Submitted"),
                    "SectionsWaitingForRevision": 0,
                    "SectionsWaitingForSubmission": int(r["state"] == "Draft"),
                }
                table_ids = {
                    f["id"]: table
                    for table in cfg.get("tables", [])
                    for f in table["columns"]
                }
                requested_tables = {
                    table_ids[a.split(".")[0]]["id"]
                    for a in attrs
                    if a.split(".")[0] in table_ids
                }
                if repeating and not requested_tables:
                    continue
                if repeating and len(requested_tables) > 1:
                    reject("Query one repeating section at a time.", 400)
                table = next(
                    (t for t in cfg.get("tables", []) if t["id"] in requested_tables),
                    None,
                )
                repeats = values.get(table["id"], []) if repeating and table else [None]
                for row in repeats:
                    row_fields = (
                        {f["id"]: f for f in table["columns"]}
                        if row is not None
                        else {}
                    )
                    all_fields = {**fields, **row_fields}
                    all_values = {**values, **(row or {})}
                    engine = Engine(
                        {
                            "fields": list(all_fields.values()),
                            "sheet": cfg.get("sheet", {}),
                        },
                        all_values,
                    )
                    output = {}
                    for attribute in attrs:
                        if attribute.startswith("$Form."):
                            suffix = attribute[6:]
                            if suffix not in FORM_ATTRS:
                                reject("Unknown $Form attribute: " + suffix, 400)
                            output[attribute] = form[suffix]
                            continue
                        if attribute.startswith("$Participants."):
                            parts = attribute.split(".")
                            suffix = parts[2] if len(parts) > 2 else default
                            if suffix not in DEFAULT_ATTRS:
                                reject("Unsupported participant attribute.", 400)
                            output[attribute] = False if suffix == "IsDefined" else None
                            continue
                        name, sep, suffix = attribute.rpartition(".")
                        if not sep:
                            name, suffix = attribute, default
                        if suffix not in ELEMENT_ATTRS:
                            reject("Unknown element attribute: " + suffix, 400)
                        f = all_fields.get(name)
                        defined = f is not None or name in builtins
                        if not defined:
                            output[attribute] = False if suffix == "IsDefined" else None
                            continue
                        error = None
                        try:
                            value = engine.reference(name) if f else builtins[name]
                        except FormulaError as exc:
                            value = None
                            error = {
                                "error_type": 2 if "DIV/0" in str(exc) else 1,
                                "error_name": "#DIV/0!"
                                if "DIV/0" in str(exc)
                                else "#VALUE!",
                                "error_message": str(exc),
                            }
                        valid = error is None
                        if f and not error:
                            try:
                                validate_values(
                                    {"fields": [f]}, {name: value}, complete=True
                                )
                            except HTTPException:
                                valid = False
                        if suffix == "Value":
                            out = value
                        elif suffix == "DisplayValue":
                            out = (
                                error["error_name"]
                                if error
                                else ""
                                if value is None
                                else "TRUE"
                                if value is True
                                else "FALSE"
                                if value is False
                                else str(value)
                            )
                            if name == "Equipment":
                                out = r["asset_name"]
                            if name in ["CreatedByUser", "ResponsiblePerson"]:
                                out = USERS.get(str(value), {}).get("name", value)
                            if f and f.get("type") == "datetime" and value:
                                dt = parse_date(str(value))
                                out = dt.astimezone(tz).strftime(
                                    "%m/%d/%Y %H:%M:%S"
                                    if locale == "en-US"
                                    else "%d/%m/%Y %H:%M:%S"
                                )
                        elif suffix == "IsDefined":
                            out = True
                        elif suffix == "IsValid":
                            out = valid
                        elif suffix == "IsError":
                            out = error is not None
                        elif suffix == "Error":
                            out = error
                        elif suffix == "IsHtml":
                            out = name == "Message" and bool(r.get("message_html"))
                        elif suffix == "IsTask":
                            out = False  # No native Task element type is implemented.
                        elif suffix in [
                            "NormalMax",
                            "NormalMin",
                            "ValidMax",
                            "ValidMin",
                        ]:
                            out = (
                                f.get(
                                    {
                                        "NormalMax": "max",
                                        "NormalMin": "min",
                                        "ValidMax": "valid_max",
                                        "ValidMin": "valid_min",
                                    }[suffix]
                                )
                                if f
                                else None
                            )
                        elif suffix in ["LastModifiedTime", "LastModifiedUser"]:
                            changes = (
                                c.execute(
                                    "SELECT actor,created_at,detail FROM audit WHERE record_id=%s ORDER BY id DESC",
                                    (r["id"],),
                                ).fetchall()
                                if logbook != "general_logbook"
                                else []
                            )
                            change = next(
                                (
                                    a
                                    for a in changes
                                    if isinstance(a["detail"].get("after"), dict)
                                    and a["detail"]["after"].get(name)
                                    != a["detail"].get("before", {}).get(name)
                                ),
                                None,
                            )
                            out = (
                                iso(change["created_at"] if change else r["created_at"])
                                if suffix == "LastModifiedTime"
                                else username(
                                    change["actor"] if change else r["owner_name"]
                                )
                            )
                        elif suffix == "NoReadingAvailable":
                            out = False
                        else:
                            out = None
                        output[attribute] = iso(out)
                    results.append(output)
            cap = min(top, 1000) if method == "logbook-query" else top
            results = results[:cap]
            offset = cursor(request)
            page = results[offset : offset + PAGE_SIZE]
            link = (
                next_link(request, offset + len(page))
                if offset + len(page) < len(results)
                else None
            )
            if "text/csv" in request.headers.get("accept", ""):
                stream = io.StringIO()
                writer = csv.writer(stream)
                writer.writerow(attrs)
                for row in page:
                    writer.writerow(
                        [
                            v.get("error_message") if isinstance(v, dict) else v
                            for v in row.values()
                        ]
                    )
                return Response(
                    stream.getvalue(),
                    media_type="text/csv",
                    headers={
                        "X-Implementation": "campus-local-emulator; native-j5-unverified",
                        **({"Link": f'<{link}>; rel="next"'} if link else {}),
                    },
                )
            payload = (
                {"values": page, "nextLink": link}
                if method == "logbook-query-v2"
                else page
            )
            return Response(
                json.dumps(jsonable_encoder(payload), indent=2 if pretty else None),
                media_type="application/json",
                headers={
                    "X-Implementation": "campus-local-emulator; native-j5-unverified"
                },
            )

    from .compat_data import attach

    attach(routes, auth)
    return routes
