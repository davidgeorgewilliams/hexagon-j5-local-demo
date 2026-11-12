import type { Definition, Sheet, SheetCell, WorkflowNode } from "../types";
export const address = (r: number, c: number) => {
  let label = "";
  for (let n = c + 1; n > 0;) {
    n--;
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26);
  }
  return label + (r + 1);
};
export const coord = (key: string): [number, number] => {
  const m = /^([A-Z]+)(\d+)$/.exec(key);
  if (!m) return [0, 0];
  let col = 0;
  for (const ch of m[1]) col = col * 26 + ch.charCodeAt(0) - 64;
  return [Number(m[2]) - 1, col - 1];
};
export function defaultSheet(config: Definition): Sheet {
  const cells: Record<string, SheetCell> = {
    A1: {
      value: config.name,
      style: { bold: true, background: "#b8c9d9", font_size: 16 },
    },
  };
  config.fields.forEach((f, i) => {
    cells[address(i + 1, 0)] = {
      value: f.label + (f.required ? " *" : ""),
      style: { background: "#e2edf3" },
    };
    cells[address(i + 1, 1)] = { field: f.id };
    cells[address(i + 1, 2)] = { value: f.unit || "" };
    cells[address(i + 1, 3)] = { value: f.help || f.section };
  });
  return {
    rows: Math.max(14, config.fields.length + 3),
    cols: 4,
    cells,
    merges: [{ start: "A1", end: "D1" }],
    col_widths: { "0": 220, "1": 190, "2": 80, "3": 220 },
    freeze_row: true,
    freeze_column: false,
  };
}
export const cellStyle = (cell: SheetCell) => ({
  fontWeight: cell.style?.bold ? "bold" : undefined,
  fontStyle: cell.style?.italic ? "italic" : undefined,
  textDecoration: cell.style?.underline ? "underline" : undefined,
  textAlign: cell.style?.align || "left",
  background: cell.style?.background,
  color: cell.style?.color,
  fontSize: cell.style?.font_size || 12,
  border: cell.style?.border ? "1px solid #596e80" : undefined,
});
export function mergeAt(sheet: Sheet, r: number, c: number) {
  for (const merge of sheet.merges) {
    const [r1, c1] = coord(merge.start),
      [r2, c2] = coord(merge.end);
    if (r >= r1 && r <= r2 && c >= c1 && c <= c2)
      return r === r1 && c === c1
        ? { rows: r2 - r1 + 1, cols: c2 - c1 + 1 }
        : false;
  }
  return { rows: 1, cols: 1 };
}
export function shiftSheet(
  config: Definition,
  axis: "row" | "column",
  at: number,
  remove = false,
): Definition {
  const sheet = structuredClone(config.sheet || defaultSheet(config)),
    delta = remove ? -1 : 1;
  const moveKey = (key: string) => {
    let [r, c] = coord(key);
    const v = axis === "row" ? r : c;
    if (remove && v === at) return null;
    if (v >= at) {
      if (axis === "row") r += delta;
      else c += delta;
    }
    return address(r, c);
  };
  const rewrite = (formula: string) =>
    formula
      .split(/("(?:[^"]|"")*")/g)
      .map((part, i) =>
        i % 2
          ? part
          : part.replace(
              /(?<![\w.])(\$?)([A-Z]{1,2})(\$?)([1-9]\d*)(?![\w])/g,
              (full, a, b, c, d) => {
                if (config.fields.some((f) => f.id === full)) return full;
                const shifted = moveKey(b + d);
                if (!shifted) return "#REF!";
                const [row, col] = coord(shifted);
                return `${a}${address(0, col).replace(/\d+$/, "")}${c}${row + 1}`;
              },
            ),
      )
      .join("");
  const cells: Record<string, SheetCell> = {};
  for (const [key, cell] of Object.entries(sheet.cells)) {
    const newKey = moveKey(key);
    if (newKey)
      cells[newKey] = {
        ...cell,
        formula: cell.formula ? rewrite(cell.formula) : undefined,
      };
  }
  sheet.cells = cells;
  sheet.merges = sheet.merges.flatMap((m) => {
    const start = moveKey(m.start),
      end = moveKey(m.end);
    return start && end ? [{ start, end }] : [];
  });
  const sizes = axis === "row" ? "row_heights" : "col_widths";
  sheet[sizes] = Object.fromEntries(
    Object.entries(sheet[sizes] || {}).flatMap(([key, size]) =>
      remove && Number(key) === at
        ? []
        : [
            [
              String(Number(key) >= at ? Number(key) + delta : Number(key)),
              size,
            ],
          ],
    ),
  );
  if (axis === "row") sheet.rows += delta;
  else sheet.cols += delta;
  const nodes = (ns: WorkflowNode[]): WorkflowNode[] =>
    ns.map((n) => ({
      ...n,
      entry_effects: n.entry_effects?.map((e) => ({
        ...e,
        formula: rewrite(e.formula),
      })),
      exit_effects: n.exit_effects?.map((e) => ({
        ...e,
        formula: rewrite(e.formula),
      })),
      children: n.children ? nodes(n.children) : undefined,
    }));
  return {
    ...config,
    sheet,
    state_tree: config.state_tree ? nodes(config.state_tree) : undefined,
    fields: config.fields.map((f) => ({
      ...f,
      formula: f.formula ? rewrite(f.formula) : undefined,
    })),
    transitions: config.transitions.map((t) => ({
      ...t,
      guard_formula: t.guard_formula ? rewrite(t.guard_formula) : undefined,
      effects: t.effects?.map((e) => ({ ...e, formula: rewrite(e.formula) })),
    })),
  };
}

export function themeStyle(
  config: Definition,
): NonNullable<SheetCell["style"]> {
  const resolve = (
    name: string,
    seen: string[],
  ): NonNullable<SheetCell["style"]> => {
    if (seen.includes(name) || seen.length > 10) return {};
    const item = config.themes?.[name];
    return item
      ? {
          ...(item.extends ? resolve(item.extends, [...seen, name]) : {}),
          ...item.style,
        }
      : {};
  };
  return config.theme ? resolve(config.theme, []) : {};
}
