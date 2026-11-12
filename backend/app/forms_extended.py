"""Local repeating sections, reusable option lists and theme inheritance."""

from copy import deepcopy
import re
from .formulas import FormulaError, calculated_values, validate_formulas


def resolve_libraries(config):
    config = deepcopy(config)
    lists = config.get("option_lists", {})
    if not isinstance(lists, dict) or len(lists) > 40:
        raise FormulaError("Use up to 40 named option lists.")

    def options(name, path=()):
        if name in path or len(path) > 10:
            raise FormulaError("Option-list inheritance cycle or excessive depth.")
        entry = lists.get(name)
        if not isinstance(entry, dict):
            raise FormulaError("Unknown option list: " + str(name))
        vals = entry.get("values", [])
        if (
            not isinstance(vals, list)
            or len(vals) > 2000
            or any(
                not isinstance(x, str) or not x.strip() or len(x) > 300 for x in vals
            )
        ):
            raise FormulaError(
                "Option lists need non-empty text values (maximum 2,000)."
            )
        return list(
            dict.fromkeys(
                (
                    options(entry["extends"], path + (name,))
                    if entry.get("extends")
                    else []
                )
                + vals
            )
        )

    for name in lists:
        if not re.fullmatch(r"[a-z][a-z0-9_]{0,39}", name):
            raise FormulaError("Option-list names must be lowercase identifiers.")
        options(name)
    if not isinstance(config.get("fields", []), list) or not isinstance(
        config.get("tables", []), list
    ):
        raise FormulaError("Fields and tables must be lists.")
    fields = config.get("fields", []) + [
        f
        for t in config.get("tables", [])
        if isinstance(t, dict)
        for f in t.get("columns", [])
        if isinstance(f, dict)
    ]
    for field in fields:
        if not isinstance(field, dict):
            raise FormulaError("Fields must be objects.")
        if field.get("option_list"):
            if field.get("type") != "choice":
                raise FormulaError("Option lists bind to choice fields only.")
            field["options"] = options(field["option_list"])
    themes = config.get("themes", {})
    if not isinstance(themes, dict) or len(themes) > 20:
        raise FormulaError("Use up to 20 named themes.")

    def theme(name, path=()):
        if name in path or len(path) > 10:
            raise FormulaError("Theme inheritance cycle or excessive depth.")
        entry = themes.get(name)
        if not isinstance(entry, dict):
            raise FormulaError("Unknown theme: " + str(name))
        style = entry.get("style", {})
        if not isinstance(style, dict):
            raise FormulaError("Theme style must be an object.")
        return {
            **(theme(entry["extends"], path + (name,)) if entry.get("extends") else {}),
            **style,
        }

    for name in themes:
        theme(name)
    config.pop("theme_style", None)
    if config.get("theme"):
        style = theme(config["theme"])
        from .sheets import validate_sheet

        validate_sheet(
            {
                "fields": [],
                "sheet": {"rows": 1, "cols": 1, "cells": {"A1": {"style": style}}},
            }
        )
        config["theme_style"] = style
    return config


def validate_tables(config, validate_config):
    tables = config.get("tables", [])
    if not isinstance(tables, list) or len(tables) > 10:
        raise FormulaError("Use up to ten repeating tables.")
    ids = {f["id"] for f in config["fields"]}
    for table in tables:
        if (
            not isinstance(table, dict)
            or not re.fullmatch(r"[a-z][a-z0-9_]{0,39}", str(table.get("id", "")))
            or table["id"] in ids
        ):
            raise FormulaError("Repeating tables need unique lowercase IDs.")
        ids.add(table["id"])
        if not isinstance(table.get("label"), str) or not table["label"].strip():
            raise FormulaError("Repeating tables need a label.")
        low, high = table.get("min_rows", 0), table.get("max_rows", 100)
        if type(low) != int or type(high) != int or not 0 <= low <= high <= 500:
            raise FormulaError("Table row bounds must be between zero and 500.")
        cols = table.get("columns")
        if not isinstance(cols, list) or not 1 <= len(cols) <= 30:
            raise FormulaError("Repeating tables need 1–30 columns.")
        for column in cols:
            if (
                not isinstance(column, dict)
                or not isinstance(column.get("id"), str)
                or column["id"] in ids
            ):
                raise FormulaError(
                    "Field, table and repeating-column IDs must be globally unique."
                )
            ids.add(column.get("id"))
        child = {
            **config,
            "fields": cols,
            "tables": [],
            "sheet": None,
            "state_tree": None,
            "state_settings": {},
            "states": ["Draft", "Closed"],
            "transitions": [
                {
                    "id": "finish",
                    "label": "Finish",
                    "source": "Draft",
                    "target": "Closed",
                    "roles": ["administrator"],
                    "require_note": False,
                }
            ],
        }
        child.pop("sheet")
        child.pop("state_tree")
        child.pop("theme", None)
        validate_config(child)


def table_values(config, values, context=None):
    result = dict(values)
    for table in config.get("tables", []):
        rows = values.get(table["id"], [])
        if not isinstance(rows, list) or len(rows) > table.get("max_rows", 100):
            raise FormulaError("Invalid row count for " + table["label"])
        if any(not isinstance(row, dict) for row in rows):
            raise FormulaError("Repeating rows must be objects.")
        result[table["id"]] = [
            calculated_values({"fields": table["columns"]}, row, context)
            for row in rows
        ]
    return result
