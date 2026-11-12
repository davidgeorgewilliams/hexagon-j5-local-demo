"""Bounded, independently implemented spreadsheet formulas; never eval/exec Python."""

import math
import re
from datetime import datetime, timezone, date
from decimal import Decimal, ROUND_HALF_UP

FUNCTIONS = {
    "COUNTBLANK": "COUNTBLANK(range)",
    "COUNTIF": "COUNTIF(range, criterion)",
    "SUMIF": "SUMIF(range, criterion[, sum_range])",
    "INDEX": "INDEX(range, row[, column])",
    "MATCH": "MATCH(value, range, 0) — exact match only",
    "VLOOKUP": "VLOOKUP(value, range, column, FALSE) — exact match only",
    "HLOOKUP": "HLOOKUP(value, range, row, FALSE) — exact match only",
    "EXACT": "EXACT(text, text)",
    "FIND": "FIND(needle, text[, start]) — case sensitive",
    "SEARCH": "SEARCH(needle, text[, start]) — case insensitive, literal text",
    "IF": "IF(condition, when_true[, when_false])",
    "IFERROR": "IFERROR(expression, fallback)",
    "AND": "AND(condition, ...)",
    "OR": "OR(condition, ...)",
    "NOT": "NOT(condition)",
    "SUM": "SUM(value or range, ...)",
    "AVERAGE": "AVERAGE(value or range, ...)",
    "MIN": "MIN(value or range, ...)",
    "MAX": "MAX(value or range, ...)",
    "COUNT": "COUNT(value or range, ...)",
    "COUNTA": "COUNTA(value or range, ...)",
    "ABS": "ABS(number)",
    "ROUND": "ROUND(number, digits)",
    "ROUNDUP": "ROUNDUP(number, digits)",
    "ROUNDDOWN": "ROUNDDOWN(number, digits)",
    "INT": "INT(number)",
    "MOD": "MOD(number, divisor)",
    "SQRT": "SQRT(number)",
    "POWER": "POWER(number, exponent)",
    "CONCATENATE": "CONCATENATE(value, ...)",
    "CONCAT": "CONCAT(value, ...)",
    "UPPER": "UPPER(text)",
    "LOWER": "LOWER(text)",
    "TRIM": "TRIM(text)",
    "LEN": "LEN(text)",
    "LEFT": "LEFT(text, count)",
    "RIGHT": "RIGHT(text, count)",
    "MID": "MID(text, start, count)",
    "SUBSTITUTE": "SUBSTITUTE(text, old, new)",
    "VALUE": "VALUE(text)",
    "ISBLANK": "ISBLANK(value)",
    "ISNUMBER": "ISNUMBER(value)",
    "ISTEXT": "ISTEXT(value)",
    "TRUE": "TRUE()",
    "FALSE": "FALSE()",
    "TODAY": "TODAY()",
    "NOW": "NOW()",
    "DATE": "DATE(year, month, day)",
    "YEAR": "YEAR(ISO date)",
    "MONTH": "MONTH(ISO date)",
    "DAY": "DAY(ISO date)",
    "WORKFLOW.EVENTUSER": "WORKFLOW.EVENTUSER()",
    "WORKFLOW.EVENTTIME": "WORKFLOW.EVENTTIME()",
}
TOKEN = re.compile(
    r'\s*(?:(\d+(?:\.\d*)?(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)|("(?:[^"]|"")*")|(\$?[A-Za-z_][A-Za-z0-9_.$]*|\[[A-Za-z_][A-Za-z0-9_]*\])|(<=|>=|<>|!=|==|[+\-*/^&=<>(),:%]))'
)
CELL = re.compile(r"^\$?([A-Za-z]{1,2})\$?([1-9][0-9]{0,2})$")


class FormulaError(ValueError):
    pass


def coord(address):
    m = CELL.fullmatch(address)
    if not m:
        raise FormulaError(f"Invalid cell address: {address}")
    col = 0
    for ch in m[1].upper():
        col = col * 26 + ord(ch) - 64
    return int(m[2]) - 1, col - 1


def address(row, col):
    result = ""
    col += 1
    while col:
        col, digit = divmod(col - 1, 26)
        result = chr(65 + digit) + result
    return f"{result}{row + 1}"


class Parser:
    def __init__(self, text):
        if not isinstance(text, str) or len(text) > 4000:
            raise FormulaError("Formula must be text of at most 4,000 characters.")
        text = text.strip().removeprefix("=")
        self.tokens = []
        pos = 0
        while pos < len(text):
            if not text[pos:].strip():
                break
            match = TOKEN.match(text, pos)
            if not match:
                raise FormulaError(f"Unexpected character at position {pos + 1}.")
            num, string, name, op = match.groups()
            pos = match.end()
            if num:
                value = float(num)
                if not math.isfinite(value):
                    raise FormulaError("Number is outside the supported range.")
                self.tokens.append(("literal", value))
            elif string:
                self.tokens.append(("literal", string[1:-1].replace('""', '"')))
            elif name:
                self.tokens.append(("name", name.strip("[]")))
            else:
                self.tokens.append((op, op))
            if len(self.tokens) > 800:
                raise FormulaError("Formula has too many terms.")
        self.tokens.append(("end", None))
        self.i = 0

    def take(self, kind=None):
        token = self.tokens[self.i]
        if kind and token[0] != kind:
            raise FormulaError(f"Expected {kind}, found {token[0]}.")
        self.i += 1
        return token

    def expression(self, minimum=0, depth=0):
        if depth > 40:
            raise FormulaError("Formula nesting limit exceeded.")
        kind, value = self.take()
        if kind == "literal":
            node = ("literal", value)
        elif kind == "name":
            if self.tokens[self.i][0] == "(":
                self.take("(")
                args = []
                name = value.upper()
                if name not in FUNCTIONS:
                    raise FormulaError(f"Unsupported function: {name}")
                if self.tokens[self.i][0] != ")":
                    while True:
                        args.append(self.expression(0, depth + 1))
                        if self.tokens[self.i][0] != ",":
                            break
                        self.take(",")
                self.take(")")
                zero = {
                    "TRUE",
                    "FALSE",
                    "TODAY",
                    "NOW",
                    "WORKFLOW.EVENTUSER",
                    "WORKFLOW.EVENTTIME",
                }
                two = {"IFERROR", "MOD", "POWER", "LEFT", "RIGHT"}
                three = {"MID", "SUBSTITUTE", "DATE"}
                variable = {
                    "SUM",
                    "AVERAGE",
                    "MIN",
                    "MAX",
                    "COUNT",
                    "COUNTA",
                    "AND",
                    "OR",
                    "CONCAT",
                    "CONCATENATE",
                }
                allowed = (
                    (0, 0)
                    if name in zero
                    else (2, 3)
                    if name in {"IF", "SUMIF", "INDEX", "FIND", "SEARCH"}
                    else (1, 2)
                    if name in {"ROUND", "ROUNDUP", "ROUNDDOWN"}
                    else (4, 4)
                    if name in {"VLOOKUP", "HLOOKUP"}
                    else (2, 2)
                    if name in two | {"COUNTIF", "EXACT"}
                    else (3, 3)
                    if name in three | {"MATCH"}
                    else (1, 30)
                    if name == "SUM"
                    else (1, 100)
                    if name in variable
                    else (1, 1)
                )
                if not allowed[0] <= len(args) <= allowed[1]:
                    raise FormulaError(
                        f"{name} expects {allowed[0]}–{allowed[1]} arguments."
                    )
                node = ("call", name, args)
            elif value.upper() in {"TRUE", "FALSE"}:
                node = ("literal", value.upper() == "TRUE")
            else:
                node = ("ref", value)
        elif kind == "(":
            node = self.expression(0, depth + 1)
            self.take(")")
        elif kind in {"+", "-"}:
            node = ("unary", kind, self.expression(35, depth + 1))
        else:
            raise FormulaError(f"Unexpected {kind}.")
        powers = {
            "=": 10,
            "==": 10,
            "<>": 10,
            "!=": 10,
            "<": 10,
            ">": 10,
            "<=": 10,
            ">=": 10,
            "&": 15,
            "+": 20,
            "-": 20,
            "*": 30,
            "/": 30,
            "^": 40,
            ":": 50,
            "%": 60,
        }
        while (
            self.tokens[self.i][0] in powers
            and powers[self.tokens[self.i][0]] >= minimum
        ):
            op = self.take()[0]
            power = powers[op]
            if op == "%":
                node = ("unary", "%", node)
                continue
            right = self.expression(power if op == "^" else power + 1, depth + 1)
            if op == ":" and (node[0] != "ref" or right[0] != "ref"):
                raise FormulaError("Ranges require two cell addresses.")
            node = ("binary", op, node, right)
        return node

    def parse(self):
        try:
            result = self.expression()
            self.take("end")
            return result
        except (IndexError, RecursionError):
            raise FormulaError("Incomplete or overly nested formula.") from None


def flatten(values):
    for v in values:
        if isinstance(v, list):
            yield from flatten(v)
        else:
            yield v


def number(value):
    if value is None or value == "":
        return 0
    if isinstance(value, (float, int)):
        return float(value)
    try:
        result = float(value)
    except (TypeError, ValueError):
        raise FormulaError("#VALUE! Expected a number.") from None
    if not math.isfinite(result):
        raise FormulaError("#NUM! Non-finite number.")
    return result


def text(value):
    if value is None:
        return ""
    if type(value) is bool:
        return "TRUE" if value else "FALSE"
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def lookup_equal(a, b):
    if isinstance(a, str) and isinstance(b, str):
        return a.casefold() == b.casefold()
    return (
        type(a) is type(b)
        and a == b
        or type(a) in [int, float]
        and type(b) in [int, float]
        and a == b
    )


def criterion_matches(value, criterion):
    if not isinstance(criterion, str):
        return lookup_equal(value, criterion)
    match = re.fullmatch(r"(<=|>=|<>|=|<|>)?(.*)", criterion, re.S)
    op, rhs = match.groups()
    op = op or "="
    try:
        left, right = number(value), float(rhs)
    except (FormulaError, ValueError):
        left, right = text(value).casefold(), rhs.casefold()
    return {
        "=": left == right,
        "<>": left != right,
        "<": left < right,
        ">": left > right,
        "<=": left <= right,
        ">=": left >= right,
    }[op]


class Engine:
    def __init__(self, config, values=None, context=None):
        self.config = config
        self.values = dict(values or {})
        self.fields = {f["id"]: f for f in config.get("fields", [])}
        self.cells = config.get("sheet", {}).get("cells", {})
        self.context = {
            "event_time": datetime.now(timezone.utc).isoformat(),
            **(context or {}),
        }
        self.cache = {}
        self.stack = []
        self.budget = 30000

    def reference(self, name):
        key = name if name in self.fields else name.replace("$", "").upper()
        if key in self.cache:
            return self.cache[key]
        if key in self.stack:
            raise FormulaError("#CYCLE! " + " → ".join(self.stack + [key]))
        if len(self.stack) >= 80:
            raise FormulaError("Reference depth limit exceeded.")
        self.stack.append(key)
        try:
            if key in self.fields:
                field = self.fields[key]
                result = (
                    self.evaluate(field["formula"])
                    if field.get("formula")
                    else self.values.get(key)
                )
            elif CELL.fullmatch(key):
                r, c = coord(key)
                sheet = self.config.get("sheet", {})
                if r >= sheet.get("rows", 500) or c >= sheet.get("cols", 52):
                    raise FormulaError(f"#REF! {key} is outside the sheet.")
                cell = self.cells.get(key, {})
                if cell.get("field"):
                    result = self.reference(cell["field"])
                elif cell.get("formula"):
                    result = self.evaluate(cell["formula"])
                else:
                    result = cell.get("value")
            else:
                raise FormulaError(f"#NAME? Unknown reference: {name}")
            self.cache[key] = result
            return result
        finally:
            self.stack.pop()

    def evaluate(self, formula):
        try:
            value = self.run(Parser(formula).parse())
            if isinstance(value, float) and not math.isfinite(value):
                raise FormulaError("#NUM! Non-finite result.")
            if isinstance(value, str) and len(value) > 20000:
                raise FormulaError("Formula result is too long.")
            return value
        except FormulaError:
            raise
        except (TypeError, ValueError, ArithmeticError, IndexError) as error:
            raise FormulaError(f"#VALUE! {str(error)[:120]}") from None

    def run(self, node):
        self.budget -= 1
        if self.budget < 0:
            raise FormulaError("Calculation budget exceeded.")
        kind = node[0]
        if kind == "literal":
            return node[1]
        if kind == "ref":
            return self.reference(node[1])
        if kind == "unary":
            value = number(self.run(node[2]))
            return (
                -value if node[1] == "-" else value / 100 if node[1] == "%" else value
            )
        if kind == "binary":
            op = node[1]
            if op == ":":
                r1, c1 = coord(node[2][1])
                r2, c2 = coord(node[3][1])
                r1, r2 = sorted([r1, r2])
                c1, c2 = sorted([c1, c2])
                if (r2 - r1 + 1) * (c2 - c1 + 1) > 1000:
                    raise FormulaError("Ranges are limited to 1,000 cells.")
                return [
                    self.reference(address(r, c))
                    for r in range(r1, r2 + 1)
                    for c in range(c1, c2 + 1)
                ]
            a, b = self.run(node[2]), self.run(node[3])
            if op == "&":
                return text(a) + text(b)
            if op in {"=", "==", "<>", "!="}:
                equal = a == b and (
                    type(a) is type(b)
                    or type(a) in [int, float]
                    and type(b) in [int, float]
                )
                return not equal if op in {"<>", "!="} else equal
            if op in {"<", ">", "<=", ">="}:
                if isinstance(a, str) and isinstance(b, str):
                    pass
                else:
                    a, b = number(a), number(b)
                return {"<": a < b, ">": a > b, "<=": a <= b, ">=": a >= b}[op]
            a, b = number(a), number(b)
            if op == "+":
                return a + b
            if op == "-":
                return a - b
            if op == "*":
                return a * b
            if op == "/":
                if b == 0:
                    raise FormulaError("#DIV/0!")
                return a / b
            if op == "^":
                if abs(b) > 100:
                    raise FormulaError("Exponent must be between -100 and 100.")
                result = a**b
                if isinstance(result, complex):
                    raise FormulaError("#NUM! Complex result.")
                return result
        name, args = node[1], node[2]
        if name == "IF":
            if len(args) not in [2, 3]:
                raise FormulaError("IF requires two or three arguments.")
            return (
                self.run(args[1])
                if self.run(args[0])
                else self.run(args[2])
                if len(args) == 3
                else False
            )
        if name == "IFERROR":
            if len(args) != 2:
                raise FormulaError("IFERROR requires two arguments.")
            try:
                return self.run(args[0])
            except (FormulaError, ArithmeticError, ValueError, TypeError):
                return self.run(args[1])
        a = [self.run(n) for n in args]
        flat = list(flatten(a))
        nums = [float(v) for v in flat if type(v) in [int, float]]
        if name == "COUNTBLANK":
            return sum(v is None or v == "" for v in flat)
        if name in {"COUNTIF", "SUMIF"}:
            values = list(flatten([a[0]]))
            sums = list(flatten([a[2]])) if len(a) == 3 else values
            if len(sums) != len(values):
                raise FormulaError("Conditional ranges must have equal sizes.")
            matched = [
                i for i, value in enumerate(values) if criterion_matches(value, a[1])
            ]
            return (
                len(matched)
                if name == "COUNTIF"
                else sum(
                    float(sums[i]) for i in matched if type(sums[i]) in [int, float]
                )
            )
        if name == "EXACT":
            return text(a[0]) == text(a[1])
        if name in {"FIND", "SEARCH"}:
            start = int(number(a[2])) if len(a) == 3 else 1
            if start < 1:
                raise FormulaError("Search start must be at least one.")
            needle, haystack = text(a[0]), text(a[1])
            if name == "SEARCH":
                needle, haystack = needle.casefold(), haystack.casefold()
            found = haystack.find(needle, start - 1)
            if found < 0:
                raise FormulaError("#VALUE! Text not found.")
            return found + 1
        if name == "MATCH":
            if number(a[2]) != 0:
                raise FormulaError("MATCH supports explicit exact matching (0) only.")
            for i, value in enumerate(flatten([a[1]]), 1):
                if lookup_equal(value, a[0]):
                    return i
            raise FormulaError("#N/A! Lookup value not found.")
        if name in {"INDEX", "VLOOKUP", "HLOOKUP"}:
            pos = 0 if name == "INDEX" else 1
            node_range = args[pos]
            if node_range[0] != "binary" or node_range[1] != ":":
                raise FormulaError("Lookup requires a rectangular cell range.")
            r1, c1 = coord(node_range[2][1])
            r2, c2 = coord(node_range[3][1])
            height, width = abs(r2 - r1) + 1, abs(c2 - c1) + 1
            values = list(flatten([a[pos]]))
            if name == "INDEX":
                row, col = number(a[1]), number(a[2]) if len(a) == 3 else 1
            else:
                if a[3] not in [False, 0]:
                    raise FormulaError(
                        "Lookups support explicit exact matching (FALSE) only."
                    )
                axis = range(height) if name == "VLOOKUP" else range(width)
                found = next(
                    (
                        i
                        for i in axis
                        if lookup_equal(
                            values[i * width if name == "VLOOKUP" else i], a[0]
                        )
                    ),
                    None,
                )
                if found is None:
                    raise FormulaError("#N/A! Lookup value not found.")
                row, col = (
                    (found + 1, number(a[2]))
                    if name == "VLOOKUP"
                    else (number(a[2]), found + 1)
                )
            if (
                row != int(row)
                or col != int(col)
                or not 1 <= row <= height
                or not 1 <= col <= width
            ):
                raise FormulaError("#REF! Lookup index outside range.")
            return values[(int(row) - 1) * width + int(col) - 1]
        if name == "SUM":
            return sum(nums)
        if name == "AVERAGE":
            if not nums:
                raise FormulaError("#DIV/0! No numeric values.")
            return sum(nums) / len(nums)
        if name == "MIN":
            return min(nums, default=0)
        if name == "MAX":
            return max(nums, default=0)
        if name == "COUNT":
            return len(nums)
        if name == "COUNTA":
            return sum(v is not None and v != "" for v in flat)
        if name == "AND":
            return all(bool(v) for v in flat)
        if name == "OR":
            return any(bool(v) for v in flat)
        if name in {"CONCATENATE", "CONCAT"}:
            return "".join(text(v) for v in flat)
        zero = {
            "TRUE": True,
            "FALSE": False,
            "NOW": self.context["event_time"],
            "TODAY": self.context["event_time"][:10],
            "WORKFLOW.EVENTUSER": self.context.get("event_user", ""),
            "WORKFLOW.EVENTTIME": self.context["event_time"],
        }
        if name in zero:
            if a:
                raise FormulaError(f"{name} takes no arguments.")
            return zero[name]
        if not a:
            raise FormulaError(f"{name} requires arguments.")
        first = a[0]
        if name == "NOT":
            return not bool(first)
        if name == "ISBLANK":
            return first is None or first == ""
        if name == "ISNUMBER":
            return type(first) in [float, int]
        if name == "ISTEXT":
            return isinstance(first, str)
        if name == "ABS":
            return abs(number(first))
        if name == "INT":
            return math.floor(number(first))
        if name == "SQRT":
            return math.sqrt(number(first))
        if name == "VALUE":
            return number(first)
        if name == "MOD":
            return number(first) % number(a[1])
        if name == "POWER":
            return self.run(("binary", "^", ("literal", first), ("literal", a[1])))
        if name in {"ROUND", "ROUNDUP", "ROUNDDOWN"}:
            digits = int(number(a[1])) if len(a) > 1 else 0
            if abs(digits) > 12:
                raise FormulaError("Rounding supports at most 12 digits.")
            n = number(first)
            if name == "ROUND":
                return float(
                    Decimal(str(n)).quantize(
                        Decimal(10) ** (-digits), rounding=ROUND_HALF_UP
                    )
                )
            scale = 10**digits
            rounded = (math.ceil if name == "ROUNDUP" else math.floor)(
                abs(n) * scale
            ) / scale
            return -rounded if n < 0 else rounded
        if name == "LEN":
            return len(text(first))
        if name == "UPPER":
            return text(first).upper()
        if name == "LOWER":
            return text(first).lower()
        if name == "TRIM":
            return " ".join(text(first).split())
        if name in {"LEFT", "RIGHT"}:
            n = int(number(a[1])) if len(a) > 1 else 1
            if n < 0:
                raise FormulaError("Character count cannot be negative.")
            return text(first)[:n] if name == "LEFT" else text(first)[-n:] if n else ""
        if name == "MID":
            start, count = int(number(a[1])), int(number(a[2]))
            if start < 1 or count < 0:
                raise FormulaError("MID uses a positive start and non-negative count.")
            return text(first)[start - 1 : start - 1 + count]
        if name == "SUBSTITUTE":
            return text(first).replace(text(a[1]), text(a[2]))
        if name == "DATE":
            return date(
                int(number(first)), int(number(a[1])), int(number(a[2]))
            ).isoformat()
        d = date.fromisoformat(text(first)[:10])
        return {"YEAR": d.year, "MONTH": d.month, "DAY": d.day}[name]


def formula_references(node):
    if node[0] == "ref":
        return {node[1]}
    if node[0] == "binary" and node[1] == ":":
        r1, c1 = coord(node[2][1])
        r2, c2 = coord(node[3][1])
        if r2 < r1 or c2 < c1 or (r2 - r1 + 1) * (c2 - c1 + 1) > 1000:
            raise FormulaError(
                "Ranges must be ordered and contain at most 1,000 cells."
            )
        return {address(r, c) for r in range(r1, r2 + 1) for c in range(c1, c2 + 1)}
    if node[0] == "binary":
        return formula_references(node[2]) | formula_references(node[3])
    if node[0] == "unary":
        return formula_references(node[2])
    if node[0] == "call":
        return set().union(*(formula_references(n) for n in node[2]))
    return set()


def validate_formulas(config):
    formulas = {
        f["id"]: f["formula"] for f in config.get("fields", []) if f.get("formula")
    }
    formulas.update(
        {
            key: cell["formula"]
            for key, cell in config.get("sheet", {}).get("cells", {}).items()
            if cell.get("formula")
        }
    )
    fields = {f["id"] for f in config.get("fields", [])}
    edges = {}
    for key, formula in formulas.items():
        refs = formula_references(Parser(formula).parse())
        edges[key] = set()
        for ref in refs:
            canonical = ref if ref in fields else ref.replace("$", "").upper()
            if canonical not in fields and not CELL.fullmatch(canonical):
                raise FormulaError(f"Unknown reference: {ref}")
            if canonical not in fields:
                r, c = coord(canonical)
                sheet = config.get("sheet", {})
                if r >= sheet.get("rows", 500) or c >= sheet.get("cols", 52):
                    raise FormulaError(f"#REF! {canonical} is outside the sheet.")
            edges[key].add(canonical)
    # Bound cells participate in dependency cycles, too.
    for key, cell in config.get("sheet", {}).get("cells", {}).items():
        if cell.get("field"):
            edges[key] = {cell["field"]}
    visited = set()

    def visit(key, path):
        if key in path:
            raise FormulaError("#CYCLE! " + " → ".join(path + [key]))
        if len(path) > 80:
            raise FormulaError("Reference depth limit exceeded.")
        if key in visited:
            return
        for ref in edges.get(key, []):
            visit(ref, path + [key])
        visited.add(key)

    for key in edges:
        visit(key, [])


def calculated_values(config, values, context=None):
    engine = Engine(config, values, context)
    result = dict(values)
    for f in config.get("fields", []):
        if f.get("formula"):
            value = engine.reference(f["id"])
            if isinstance(value, list):
                raise FormulaError(f"{f['label']} must calculate a single value.")
            result[f["id"]] = value
    return result


def calculate_sheet(config, values, context=None):
    engine = Engine(config, values, context)
    cells = {}
    errors = {}
    for key in config.get("sheet", {}).get("cells", {}):
        try:
            cells[key] = engine.reference(key)
        except FormulaError as e:
            errors[key] = str(e)
    computed = {}
    for f in config.get("fields", []):
        if f.get("formula"):
            try:
                computed[f["id"]] = engine.reference(f["id"])
            except FormulaError as e:
                errors[f["id"]] = str(e)
    return {"cells": cells, "computed": computed, "errors": errors}
