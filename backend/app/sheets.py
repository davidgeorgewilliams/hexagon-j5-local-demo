import math
import re
from .formulas import coord, FormulaError, validate_formulas


def validate_sheet(config):
    sheet = config.get("sheet")
    if sheet is None:
        return
    if not isinstance(sheet, dict):
        raise FormulaError("Sheet must be an object.")
    rows, cols = sheet.get("rows"), sheet.get("cols")
    if (
        type(rows) is not int
        or type(cols) is not int
        or not 1 <= rows <= 500
        or not 1 <= cols <= 52
    ):
        raise FormulaError("Sheet size must be 1–500 rows and 1–52 columns.")
    cells = sheet.get("cells", {})
    if not isinstance(cells, dict) or len(cells) > 26000:
        raise FormulaError("Invalid sheet cell collection.")
    fields = {f["id"] for f in config["fields"]}

    def inside(key):
        if not isinstance(key, str) or not re.fullmatch(
            "[A-Z]{1,2}[1-9][0-9]{0,2}", key
        ):
            raise FormulaError("Use uppercase cell addresses such as A1.")
        r, c = coord(key)
        if r >= rows or c >= cols:
            raise FormulaError(f"{key} is outside the sheet.")
        return r, c

    for key, cell in cells.items():
        inside(key)
        if not isinstance(cell, dict):
            raise FormulaError("Cells must be objects.")
        if cell.get("field") and (
            not isinstance(cell["field"], str) or cell["field"] not in fields
        ):
            raise FormulaError(f"{key} references an unknown input field.")
        if cell.get("formula") and cell.get("field"):
            raise FormulaError(
                "A cell can contain a formula or a field binding, not both."
            )
        value = cell.get("value")
        if value is not None and type(value) not in [str, int, float, bool]:
            raise FormulaError("Cell values must be scalar values.")
        if isinstance(value, str) and len(value) > 5000:
            raise FormulaError("Cell text is limited to 5,000 characters.")
        if type(value) in [int, float] and not math.isfinite(value):
            raise FormulaError("Cell numbers must be finite.")
        if "formula" in cell and not isinstance(cell["formula"], str):
            raise FormulaError("Cell formulas must be text.")
        style = cell.get("style", {})
        if not isinstance(style, dict):
            raise FormulaError("Cell styles must be objects.")
        for k in ["bold", "italic", "underline", "border"]:
            if k in style and type(style[k]) is not bool:
                raise FormulaError("Style toggles must be booleans.")
        for k in ["background", "color"]:
            if k in style and not re.fullmatch(r"#[0-9a-fA-F]{6}", str(style[k])):
                raise FormulaError("Style colors must be six-digit hex colors.")
        if style.get("align", "left") not in ["left", "center", "right"]:
            raise FormulaError("Unsupported alignment.")
        if (
            type(style.get("font_size", 12)) is not int
            or not 10 <= style.get("font_size", 12) <= 24
        ):
            raise FormulaError("Cell font size must be 10–24.")
    merged = set()
    merges = sheet.get("merges", [])
    if not isinstance(merges, list) or len(merges) > 200:
        raise FormulaError("Invalid merged cells.")
    for merge in merges:
        if not isinstance(merge, dict):
            raise FormulaError("Merged ranges must be objects.")
        r1, c1 = inside(merge.get("start"))
        r2, c2 = inside(merge.get("end"))
        if r2 < r1 or c2 < c1:
            raise FormulaError("Merged cells must run from top-left to bottom-right.")
        covered = {(r, c) for r in range(r1, r2 + 1) for c in range(c1, c2 + 1)}
        if merged & covered:
            raise FormulaError("Merged cell ranges cannot overlap.")
        merged |= covered
    for key, limit, minimum, maximum in [
        ("row_heights", rows, 20, 180),
        ("col_widths", cols, 50, 400),
    ]:
        sizes = sheet.get(key, {})
        if not isinstance(sizes, dict):
            raise FormulaError("Row/column sizes must be objects.")
        for index, size in sizes.items():
            if (
                not re.fullmatch(r"\d+", str(index))
                or not 0 <= int(index) < limit
                or type(size) not in [int, float]
                or not minimum <= size <= maximum
            ):
                raise FormulaError("Invalid row height or column width.")
    for key in ["freeze_row", "freeze_column"]:
        if key in sheet and type(sheet[key]) is not bool:
            raise FormulaError("Freeze settings must be booleans.")
    validate_formulas(config)
