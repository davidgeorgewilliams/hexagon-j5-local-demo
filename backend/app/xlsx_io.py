"""XLSX layout interchange with explicit local metadata, not IndustraForm packages."""

import io, json, zipfile
from datetime import date, datetime
from copy import deepcopy
from fastapi import APIRouter, Depends, UploadFile, File, Form
from fastapi.responses import Response
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.comments import Comment
from openpyxl.utils import get_column_letter
from .domain import validate_config, reject, DEFAULT_CONFIG
from .formulas import address


def export_xlsx(definition):
    cfg = validate_config(definition)
    sheet = cfg.get("sheet")
    if not sheet:
        sheet = {"rows": len(cfg["fields"]) + 2, "cols": 2, "cells": {}, "merges": []}
        for i, f in enumerate(cfg["fields"], 1):
            sheet["cells"][f"A{i}"] = {"value": f["label"]}
            sheet["cells"][f"B{i}"] = {"field": f["id"]}
    book = Workbook()
    ws = book.active
    ws.title = "Inspection"
    ws.cell(sheet["rows"], sheet["cols"], "")  # Preserve blank layout dimensions.
    for key, cell in sheet.get("cells", {}).items():
        target = ws[key]
        target.value = cell.get("formula") or (
            f"[{cell['field']}]" if cell.get("field") else cell.get("value")
        )
        if not cell.get("formula") and isinstance(target.value, str):
            target.data_type = "s"
        if cell.get("field"):
            target.comment = Comment(
                json.dumps({"campus_field": cell["field"]}), "Campus Operations"
            )
        style = {**cfg.get("theme_style", {}), **cell.get("style", {})}
        target.font = Font(
            name="Arial",
            size=style.get("font_size", 12),
            bold=style.get("bold", False),
            italic=style.get("italic", False),
            underline="single" if style.get("underline") else None,
            color=style.get("color", "#222222")[1:],
        )
        if style.get("background"):
            target.fill = PatternFill("solid", fgColor=style["background"][1:])
        target.alignment = Alignment(
            horizontal=style.get("align", "left"), vertical="center", wrap_text=True
        )
        if style.get("border"):
            target.border = Border(*([Side(style="thin", color="888888")] * 4))
    for merge in sheet.get("merges", []):
        ws.merge_cells(merge["start"] + ":" + merge["end"])
    for index, pixels in sheet.get("col_widths", {}).items():
        ws.column_dimensions[get_column_letter(int(index) + 1)].width = max(
            1, (pixels - 5) / 7
        )
    for index, pixels in sheet.get("row_heights", {}).items():
        ws.row_dimensions[int(index) + 1].height = pixels * 0.75
    ws.freeze_panes = (
        "B2"
        if sheet.get("freeze_column") and sheet.get("freeze_row")
        else "A2"
        if sheet.get("freeze_row")
        else "B1"
        if sheet.get("freeze_column")
        else None
    )
    metadata = book.create_sheet("_campus")
    metadata.sheet_state = "hidden"
    metadata["A1"] = "campus-xlsx/v1"
    text = json.dumps(cfg)
    for i in range(0, len(text), 30000):
        metadata.cell(i // 30000 + 2, 1, text[i : i + 30000])
    out = io.BytesIO()
    book.save(out)
    return out.getvalue()


def import_xlsx(content):
    if len(content) > 10 * 1024 * 1024:
        reject("Workbook exceeds 10 MB.", 413)
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as z:
            infos = z.infolist()
            if len(infos) > 200 or sum(i.file_size for i in infos) > 20 * 1024 * 1024:
                reject("Workbook exceeds the expanded-size limit.", 413)
            if any(
                "vbaProject" in i.filename or "externalLinks/" in i.filename
                for i in infos
            ):
                reject("Macro and external-link workbooks are unsupported.")
        book = load_workbook(io.BytesIO(content), data_only=False, keep_links=False)
        metadata = book["_campus"] if "_campus" in book.sheetnames else None
        if metadata and metadata["A1"].value == "campus-xlsx/v1":
            if metadata.max_row > 100:
                reject("Workbook metadata exceeds the limit.")
            cfg = json.loads(
                "".join(
                    str(metadata.cell(i, 1).value or "")
                    for i in range(2, metadata.max_row + 1)
                )
            )
        else:
            cfg = deepcopy(DEFAULT_CONFIG)
            cfg["name"] = "Imported spreadsheet layout"
        ws = next(
            w for w in book if w.title != "_campus" and w.sheet_state == "visible"
        )
        if ws.max_row > 500 or ws.max_column > 52:
            reject("The local layout supports up to 500 rows and 52 columns.")
        cells = {}
        warnings = []
        for row in ws:
            for cell in row:
                if cell.value is None and not cell.has_style:
                    continue
                style = {
                    "bold": bool(cell.font.bold),
                    "italic": bool(cell.font.italic),
                    "underline": bool(cell.font.underline),
                    "font_size": max(10, min(24, int(cell.font.sz or 12))),
                    "align": cell.alignment.horizontal
                    if cell.alignment.horizontal in ["left", "center", "right"]
                    else "left",
                }
                if cell.font.color and cell.font.color.type == "rgb":
                    style["color"] = "#" + str(cell.font.color.rgb)[-6:]
                if cell.fill.patternType == "solid" and cell.fill.fgColor.type == "rgb":
                    style["background"] = "#" + str(cell.fill.fgColor.rgb)[-6:]
                if any(
                    side and side.style
                    for side in [
                        cell.border.left,
                        cell.border.right,
                        cell.border.top,
                        cell.border.bottom,
                    ]
                ):
                    style["border"] = True
                value = (
                    cell.value.isoformat()
                    if isinstance(cell.value, (date, datetime))
                    else cell.value
                )
                entry = (
                    {"style": style, "formula": value}
                    if cell.data_type == "f"
                    else {"style": style, "value": value}
                )
                if cell.comment:
                    try:
                        binding = json.loads(cell.comment.text).get("campus_field")
                        if binding:
                            entry = {"style": style, "field": binding}
                    except (ValueError, AttributeError):
                        pass
                cells[cell.coordinate] = entry
        freeze = ws.freeze_panes
        cfg["sheet"] = {
            "rows": max(ws.max_row, 1),
            "cols": max(ws.max_column, 1),
            "cells": cells,
            "merges": [
                {"start": str(r).split(":")[0], "end": str(r).split(":")[-1]}
                for r in ws.merged_cells.ranges
            ],
            "col_widths": {
                str(i - 1): max(
                    50,
                    min(
                        400,
                        round(
                            (ws.column_dimensions[get_column_letter(i)].width or 13) * 7
                            + 5
                        ),
                    ),
                )
                for i in range(1, ws.max_column + 1)
            },
            "row_heights": {
                str(i - 1): max(
                    20, min(180, round((ws.row_dimensions[i].height or 27) / 0.75))
                )
                for i in range(1, ws.max_row + 1)
            },
            "freeze_row": bool(freeze and ws[freeze].row > 1),
            "freeze_column": bool(freeze and ws[freeze].column > 1),
        }
        if len(book.worksheets) > 1 + (1 if metadata else 0):
            warnings.append("Only the first visible worksheet was imported.")
        return {
            "definition": validate_config(cfg),
            "warnings": warnings,
            "format": "campus-xlsx/v1" if metadata else "xlsx-layout",
        }
    except (
        zipfile.BadZipFile,
        ValueError,
        KeyError,
        StopIteration,
        TypeError,
    ) as error:
        reject("Invalid workbook: " + str(error)[:200])


def router(user, admin):
    routes = APIRouter(prefix="/api/forms")

    @routes.post("/export.xlsx")
    def export(body: dict, u=Depends(user)):
        return Response(
            export_xlsx(body.get("definition")),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": 'attachment; filename="inspection.xlsx"'},
        )

    @routes.post("/import.xlsx")
    async def upload(file: UploadFile = File(...), u=Depends(admin)):
        return import_xlsx(await file.read(10 * 1024 * 1024 + 1))

    return routes
