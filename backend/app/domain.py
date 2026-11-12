import math
import re
from datetime import date, datetime
from fastapi import HTTPException
from psycopg.types.json import Jsonb
from .formulas import FormulaError, validate_formulas, calculated_values, Engine
from .workflows import (
    index_tree,
    validate_workflow,
    WorkflowError,
    active_leaves,
    ancestors,
)
from .sheets import validate_sheet

USERS = {
    "maya": {"name": "Maya Chen", "role": "technician", "initials": "MC"},
    "james": {"name": "James Wilson", "role": "supervisor", "initials": "JW"},
    "alex": {"name": "Alex Morgan", "role": "administrator", "initials": "AM"},
}
DEFAULT_CONFIG = {
    "name": "Critical equipment inspection",
    "description": "Daily inspection · mechanical and life-safety systems",
    "fields": [
        {
            "id": "temperature",
            "label": "Discharge temperature",
            "type": "number",
            "required": True,
            "unit": "°C",
            "max": 32,
            "section": "Equipment checks",
        },
        {
            "id": "condition",
            "label": "Equipment condition",
            "type": "choice",
            "required": True,
            "options": ["Normal", "Attention required", "Out of service"],
            "section": "Equipment checks",
        },
        {
            "id": "access",
            "label": "Access route is clear and safe",
            "type": "checkbox",
            "required": True,
            "section": "Safety & observations",
        },
        {
            "id": "observations",
            "label": "Inspection observations",
            "type": "text",
            "required": True,
            "section": "Safety & observations",
        },
    ],
    "evidence_on_exception": True,
    "states": ["Draft", "Submitted", "Approved", "Closed"],
    "transitions": [
        {
            "id": "submit",
            "label": "Submit for review",
            "source": "Draft",
            "target": "Submitted",
            "roles": ["technician", "supervisor", "administrator"],
            "require_note": False,
        },
        {
            "id": "approve",
            "label": "Approve inspection",
            "source": "Submitted",
            "target": "Approved",
            "roles": ["supervisor", "administrator"],
            "require_note": False,
        },
        {
            "id": "return",
            "label": "Return for correction",
            "source": "Submitted",
            "target": "Draft",
            "roles": ["supervisor", "administrator"],
            "require_note": True,
        },
        {
            "id": "close",
            "label": "Close inspection",
            "source": "Approved",
            "target": "Closed",
            "roles": ["supervisor", "administrator"],
            "require_note": False,
        },
    ],
}


def reject(message, status=422):
    raise HTTPException(status_code=status, detail=message)


def audit(conn, actor, action, record_id=None, **detail):
    conn.execute(
        "INSERT INTO audit(record_id,actor,action,detail) VALUES(%s,%s,%s,%s)",
        (record_id, actor, action, Jsonb(detail)),
    )


def validate_config(c):
    from .forms_extended import resolve_libraries, validate_tables

    try:
        c = resolve_libraries(c) if isinstance(c, dict) else c
    except (FormulaError, TypeError, AttributeError) as error:
        reject(str(error))
    if (
        not isinstance(c, dict)
        or not isinstance(c.get("name"), str)
        or not c["name"].strip()
        or len(c["name"]) > 150
    ):
        reject("A form name of up to 150 characters is required.")
    if not isinstance(c.get("description", ""), str):
        reject("Description must be text.")
    fields = c.get("fields", [])
    if not isinstance(fields, list) or not 1 <= len(fields) <= 40:
        reject("Define between 1 and 40 fields.")
    seen = set()
    for f in fields:
        if (
            not isinstance(f, dict)
            or not re.fullmatch(r"[a-z][a-z0-9_]{0,39}", str(f.get("id", "")))
            or f["id"] in seen
        ):
            reject("Field IDs must be unique lowercase identifiers.")
        seen.add(f["id"])
        if not isinstance(f.get("section", ""), str) or not isinstance(
            f.get("unit", ""), str
        ):
            reject("Section and unit must be text.")
        if (
            f.get("type")
            not in ["number", "text", "choice", "checkbox", "date", "datetime", "email"]
            or not isinstance(f.get("label"), str)
            or not f["label"].strip()
        ):
            reject("Each field needs a label and a supported input type.")
        if not isinstance(f.get("required"), bool):
            reject("Required must be true or false.")
        if f["type"] == "choice" and (
            not isinstance(f.get("options"), list)
            or not f["options"]
            or any(not isinstance(x, str) or not x.strip() for x in f["options"])
        ):
            reject("Choice fields need non-empty text options.")
        if f.get("max") is not None and (
            type(f["max"]) not in (int, float) or not math.isfinite(f["max"])
        ):
            reject("An upper limit must be a finite number.")
    states = c.get("states")
    if (
        not isinstance(states, list)
        or not 2 <= len(states) <= 20
        or any(not isinstance(s, str) or not s.strip() or len(s) > 60 for s in states)
        or len(set(states)) != len(states)
        or states[0] != "Draft"
        or states[-1] != "Closed"
    ):
        reject(
            "Define 2–20 unique states, beginning with Draft and ending with Closed."
        )
    try:
        nodes, _ = index_tree(c)
    except WorkflowError as error:
        reject(str(error))
    settings = c.get("state_settings", {})
    if not isinstance(settings, dict) or set(settings) - set(nodes):
        reject("State settings must refer to defined states.")
    for state, settings_item in settings.items():
        if (
            not isinstance(settings_item, dict)
            or type(settings_item.get("editable", False)) is not bool
        ):
            reject("State editability must be a boolean.")
        if nodes[state].get("kind") == "final" and settings_item.get("editable"):
            reject("Completion states are read-only.")
        for axis in ["x", "y"]:
            v = settings_item.get(axis, 0)
            if (
                type(v) not in (int, float)
                or not math.isfinite(v)
                or not 0 <= v <= 5000
            ):
                reject(
                    "State positions must be finite coordinates between 0 and 5,000."
                )
    transitions = c.get("transitions")
    if not isinstance(transitions, list) or not 1 <= len(transitions) <= 80:
        reject("Define 1–80 transitions.")
    seen = set()
    for t in transitions:
        if (
            not isinstance(t, dict)
            or not re.fullmatch(r"[a-z][a-z0-9_]{0,39}", str(t.get("id", "")))
            or t["id"] in seen
        ):
            reject("Transition IDs must be unique lowercase identifiers.")
        seen.add(t["id"])
        if not isinstance(t.get("label"), str) or not t["label"].strip():
            reject("Every transition needs a label.")
        if (
            not isinstance(t.get("source"), str)
            or not isinstance(t.get("target"), str)
            or t["source"] not in nodes
            or t["target"] not in nodes
            or t["source"] == "Closed"
            or t["source"] == t["target"]
        ):
            reject(
                "Transitions need different, defined states; Closed has no outgoing transitions."
            )
        if (
            not isinstance(t.get("roles"), list)
            or not t["roles"]
            or any(
                r not in ["technician", "supervisor", "administrator"]
                for r in t["roles"]
            )
        ):
            reject("Each transition needs at least one valid role.")
        for key in [
            "require_note",
            "validate_required",
            "require_evidence",
            "require_no_tasks",
            "create_exception_task",
        ]:
            if key in t and type(t[key]) is not bool:
                reject(f"{key} must be true or false.")
        validate_rules(t.get("guards", []), {f["id"] for f in fields})
    try:
        validate_workflow(c)
    except WorkflowError as error:
        reject(str(error))
    for f in fields:
        for key in ["invalid_if", "flag_if", "visible_if"]:
            validate_rules(f.get(key, []), {field["id"] for field in fields})
        if "edit_roles" in f and (
            not isinstance(f["edit_roles"], list)
            or any(r not in USERS_ROLE for r in f["edit_roles"])
        ):
            reject("Field edit roles must be valid roles.")
        if not isinstance(f.get("help", ""), str):
            reject("Help text must be text.")
        if type(f.get("width", 1)) is not int or f.get("width", 1) not in [1, 2]:
            reject("Field width must be one or two columns.")
        if "formula" in f and not isinstance(f["formula"], str):
            reject("Field formulas must be text.")
        if "default" in f:
            validate_values(
                {"fields": [{**f, "invalid_if": []}]}, {f["id"]: f["default"]}
            )
    if type(c.get("evidence_on_exception")) is not bool:
        reject("Evidence on exception must be true or false.")
    try:
        validate_tables(c, validate_config)
        validate_sheet(c)
        validate_formulas(c)
    except FormulaError as error:
        reject(str(error))
    return c


def prepare_values(config, values, context=None):
    try:
        from .forms_extended import table_values

        return calculated_values(config, table_values(config, values, context), context)
    except FormulaError as error:
        reject(str(error))


def validate_values(config, values, complete=False):
    known = {f["id"] for f in config["fields"]} | {
        t["id"] for t in config.get("tables", [])
    }
    if set(values) - known:
        reject("Submission contains fields outside its published definition.")
    for table in config.get("tables", []):
        rows = values.get(table["id"], [])
        if (
            not isinstance(rows, list)
            or len(rows) > table.get("max_rows", 100)
            or complete
            and len(rows) < table.get("min_rows", 0)
        ):
            reject(f"{table['label']}: invalid row count.")
        for i, row in enumerate(rows):
            if not isinstance(row, dict):
                reject("Repeating rows must be objects.")
            validate_values({"fields": table["columns"]}, row, complete)
    for f in config["fields"]:
        v = values.get(f["id"])
        visible = not f.get("visible_if") or all(
            rule_matches(r, values) for r in f["visible_if"]
        )
        empty = v is None or v == ""
        if (
            complete
            and visible
            and f["required"]
            and (empty or (f["type"] == "checkbox" and v is not True))
        ):
            reject(f"{f['label']} is required.")
        if empty:
            continue
        if f["type"] == "number" and (
            type(v) not in (int, float) or not math.isfinite(v)
        ):
            reject(f"{f['label']} must be a finite number.")
        if f["type"] == "checkbox" and type(v) is not bool:
            reject(f"{f['label']} must be true or false.")
        if f["type"] == "choice" and v not in f["options"]:
            reject(f"Choose a valid option for {f['label']}.")
        if f["type"] in ["text", "date", "datetime", "email"] and (
            not isinstance(v, str) or len(v) > 5000
        ):
            reject(f"{f['label']} must be text of at most 5,000 characters.")
        if f["type"] in ["date", "datetime"]:
            try:
                (date.fromisoformat if f["type"] == "date" else datetime.fromisoformat)(
                    v
                )
            except (ValueError, TypeError):
                reject(f"{f['label']} requires a valid {f['type']}.")
        if f["type"] == "email" and not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", v):
            reject(f"{f['label']} requires an email address.")
        for rule in f.get("invalid_if", []):
            if rule_matches(rule, values):
                reject(rule.get("message") or f"{f['label']} failed validation.")


def exceptions(config, values):
    result = []
    for table in config.get("tables", []):
        for i, row in enumerate(values.get(table["id"], [])):
            result.extend(
                f"{table['label']} row {i + 1}: {message}"
                for message in exceptions({"fields": table["columns"]}, row)
            )
    for f in config["fields"]:
        v = values.get(f["id"])
        if (
            f["type"] == "number"
            and v is not None
            and v != ""
            and f.get("max") is not None
            and v > f["max"]
        ):
            result.append(
                f"{f['label']}: {v}{f.get('unit', '')} exceeds {f['max']}{f.get('unit', '')}"
            )
        for rule in f.get("flag_if", []):
            if rule_matches(rule, values):
                result.append(rule.get("message") or f"{f['label']} raised a flag.")
    if values.get("condition") in ["Attention required", "Out of service"]:
        result.append(f"Equipment condition: {values['condition']}")
    return result


def create_task(conn, record_id, title):
    task = conn.execute(
        "INSERT INTO tasks(record_id,title) VALUES(%s,%s) RETURNING *",
        (record_id, title),
    ).fetchone()
    conn.execute(
        "INSERT INTO jobs(kind,payload) VALUES('integration',%s)",
        (
            Jsonb(
                {
                    "task_id": task["id"],
                    "record_id": record_id,
                    "title": title,
                    "fail_first": True,
                }
            ),
        ),
    )
    return task


USERS_ROLE = ["technician", "supervisor", "administrator"]
RULE_OPS = ["eq", "ne", "gt", "gte", "lt", "lte", "contains", "empty", "not_empty"]


def validate_rules(rules, fields):
    if not isinstance(rules, list) or len(rules) > 20:
        reject("Use at most 20 conditions per rule group.")
    for r in rules:
        if (
            not isinstance(r, dict)
            or not isinstance(r.get("field"), str)
            or r["field"] not in fields
            or r.get("op") not in RULE_OPS
        ):
            reject("Conditions require a known field and supported operator.")
        if not isinstance(r.get("message", ""), str):
            reject("Condition messages must be text.")
        if r.get("value") is not None and type(r["value"]) not in [
            str,
            int,
            float,
            bool,
        ]:
            reject("Condition values must be scalar values.")
        if r["op"] in ["gt", "gte", "lt", "lte"] and (
            type(r.get("value")) not in [int, float] or not math.isfinite(r["value"])
        ):
            reject("Numeric comparisons need a finite numeric value.")


def rule_matches(rule, values):
    value, expected, op = values.get(rule["field"]), rule.get("value"), rule["op"]
    if op == "empty":
        return value is None or value == ""
    if op == "not_empty":
        return value is not None and value != ""
    numeric = type(value) in [int, float] and type(expected) in [int, float]
    equal = (numeric or type(value) is type(expected)) and value == expected
    if op == "eq":
        return equal
    if op == "ne":
        return not equal
    if op == "contains":
        return isinstance(value, str) and str(expected).casefold() in value.casefold()
    if type(value) not in [int, float] or type(expected) not in [int, float]:
        return False
    return {
        "gt": value > expected,
        "gte": value >= expected,
        "lt": value < expected,
        "lte": value <= expected,
    }.get(op, False)


def can_edit(config, state, stored=None):
    if state == "Closed":
        return False
    nodes, parents = index_tree(config)
    for leaf in active_leaves(config, state, stored):
        if nodes[leaf].get("kind") == "final":
            continue
        for key in ancestors(leaf, parents):
            if "editable" in config.get("state_settings", {}).get(key, {}):
                if config["state_settings"][key]["editable"]:
                    return True
                break
        else:
            if state == "Draft":
                return True
    return False


def check_transition(
    config,
    transition,
    state,
    role,
    values,
    note="",
    evidence_count=0,
    open_tasks=0,
    context=None,
):
    if transition["source"] != state:
        reject("That transition is not available in the current state.", 409)
    if role not in transition["roles"]:
        reject("Your role does not have permission for this transition.", 403)
    if transition.get("require_note") and not note.strip():
        reject("This transition requires a comment.")
    for guard in transition.get("guards", []):
        if not rule_matches(guard, values):
            reject(
                guard.get("message")
                or f"Guard condition failed: {guard['field']} {guard['op']}."
            )
    if transition.get("guard_formula"):
        try:
            result = Engine(config, values, context).evaluate(
                transition["guard_formula"]
            )
        except FormulaError as error:
            reject(str(error))
        if type(result) is not bool:
            reject("A workflow guard formula must return TRUE or FALSE.")
        if not result:
            reject("The workflow guard formula is false.")
    submitting = transition["target"] == "Submitted"
    if transition.get("validate_required", submitting):
        validate_values(config, values, complete=True)
    if transition.get("require_evidence") and not evidence_count:
        reject("This transition requires photographic evidence.")
    if (
        submitting
        and exceptions(config, values)
        and config["evidence_on_exception"]
        and not evidence_count
    ):
        reject("Attach photographic evidence before submitting an exception.")
    if (
        transition["target"] == "Closed" or transition.get("require_no_tasks")
    ) and open_tasks:
        reject("Complete all corrective tasks before closing this inspection.", 409)
