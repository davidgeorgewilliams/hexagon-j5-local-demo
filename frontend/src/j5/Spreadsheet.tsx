import { useEffect, useState, useRef } from "react";
import type { Definition, SheetCell } from "../types";
import { api } from "../api";
import {
  address,
  coord,
  defaultSheet,
  cellStyle,
  themeStyle,
  mergeAt,
  shiftSheet,
} from "./sheetUtils";
export function Spreadsheet({
  config,
  change,
  editable,
  selectField,
}: {
  config: Definition;
  change: (c: Definition) => void;
  editable: boolean;
  selectField: (i: number) => void;
}) {
  const sheet = config.sheet || defaultSheet(config),
    [selected, setSelected] = useState("A1"),
    [end, setEnd] = useState("A1"),
    [editing, setEditing] = useState(false),
    [display, setDisplay] = useState<Record<string, unknown>>({}),
    [errors, setErrors] = useState<Record<string, string>>({}),
    [message, setMessage] = useState(""),
    [functions, setFunctions] = useState<Record<string, string>>({}),
    [help, setHelp] = useState(false);
  const cell = sheet.cells[selected] || {},
    [r, c] = coord(selected),
    [er, ec] = coord(end),
    input = useRef<HTMLInputElement>(null);
  const r1 = Math.min(r, er),
    r2 = Math.max(r, er),
    c1 = Math.min(c, ec),
    c2 = Math.max(c, ec);
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      api<{ cells: Record<string, unknown>; errors: Record<string, string> }>(
        "/forms/calculate",
        "POST",
        {
          definition: { ...config, sheet },
          values: Object.fromEntries(
            config.fields
              .filter((f) => f.default !== undefined)
              .map((f) => [f.id, f.default]),
          ),
        },
      )
        .then((result) => {
          if (live) {
            setDisplay(result.cells);
            setErrors(result.errors);
          }
        })
        .catch((e) => {
          if (live) setMessage(e.message);
        });
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [config]);
  useEffect(() => {
    if (r >= sheet.rows || c >= sheet.cols) {
      setSelected("A1");
      setEnd("A1");
    }
  }, [sheet.rows, sheet.cols]);
  const patch = (value: Partial<SheetCell>) =>
    change({
      ...config,
      sheet: {
        ...sheet,
        cells: { ...sheet.cells, [selected]: { ...cell, ...value } },
      },
    });
  const content = (raw: string) =>
    raw.startsWith("=")
      ? { formula: raw, value: undefined, field: undefined }
      : {
          formula: undefined,
          field: undefined,
          value:
            raw !== "" && /^[-+]?\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw,
        };
  const applyStyle = (style: SheetCell["style"]) => {
    const cells = { ...sheet.cells };
    for (let row = r1; row <= r2; row++)
      for (let col = c1; col <= c2; col++) {
        const key = address(row, col);
        cells[key] = {
          ...cells[key],
          style: { ...cells[key]?.style, ...style },
        };
      }
    change({ ...config, sheet: { ...sheet, cells } });
  };
  const choose = (key: string, extend = false) => {
    setEditing(false);
    if (!extend) {
      setSelected(key);
      const field = sheet.cells[key]?.field;
      if (field) selectField(config.fields.findIndex((f) => f.id === field));
    }
    setEnd(key);
  };
  const paste = (text: string) => {
    const lines = text.replace(/\r/g, "").split("\n");
    if (lines.at(-1) === "") lines.pop();
    const cells = { ...sheet.cells };
    lines.forEach((line, i) =>
      line.split("\t").forEach((value, j) => {
        if (r + i < sheet.rows && c + j < sheet.cols)
          cells[address(r + i, c + j)] = {
            ...cells[address(r + i, c + j)],
            ...content(value),
          };
      }),
    );
    change({ ...config, sheet: { ...sheet, cells } });
    setMessage("Pasted cells. Values outside the sheet were excluded.");
  };
  const tsv = () =>
    Array.from({ length: r2 - r1 + 1 }, (_, i) =>
      Array.from({ length: c2 - c1 + 1 }, (_, j) => {
        const cell = sheet.cells[address(r1 + i, c1 + j)];
        return String(cell?.formula ?? cell?.value ?? "");
      }).join("\t"),
    ).join("\n");
  const merge = () => {
    const merges = sheet.merges.filter((m) => {
      const [a, b] = coord(m.start),
        [x, y] = coord(m.end);
      return x < r1 || a > r2 || y < c1 || b > c2;
    });
    if (r1 !== r2 || c1 !== c2)
      merges.push({ start: address(r1, c1), end: address(r2, c2) });
    change({ ...config, sheet: { ...sheet, merges } });
  };
  return (
    <div className="j5-spreadsheet-editor">
      <div className="j5-tools">
        <button
          disabled={!editable}
          aria-label="Bold"
          onClick={() => applyStyle({ bold: !cell.style?.bold })}
        >
          <b>B</b>
        </button>
        <button
          disabled={!editable}
          aria-label="Italic"
          onClick={() => applyStyle({ italic: !cell.style?.italic })}
        >
          <i>I</i>
        </button>
        <button
          disabled={!editable}
          aria-label="Underline"
          onClick={() => applyStyle({ underline: !cell.style?.underline })}
        >
          <u>U</u>
        </button>
        <select
          aria-label="Cell alignment"
          value={cell.style?.align || "left"}
          disabled={!editable}
          onChange={(e) =>
            applyStyle({ align: e.target.value as "left" | "center" | "right" })
          }
        >
          <option>left</option>
          <option>center</option>
          <option>right</option>
        </select>
        <input
          aria-label="Cell background"
          type="color"
          value={cell.style?.background || "#ffffff"}
          disabled={!editable}
          onChange={(e) => applyStyle({ background: e.target.value })}
        />
        <input
          aria-label="Cell text color"
          type="color"
          value={cell.style?.color || "#202020"}
          disabled={!editable}
          onChange={(e) => applyStyle({ color: e.target.value })}
        />
        <button disabled={!editable} onClick={merge}>
          {selected === end ? "Unmerge" : "Merge range"}
        </button>
        <button
          disabled={!editable}
          onClick={() => applyStyle({ border: !cell.style?.border })}
        >
          Borders
        </button>
        <button
          onClick={async () => {
            setHelp(!help);
            if (!Object.keys(functions).length) {
              try {
                const result = await api<{ functions: Record<string, string> }>(
                  "/formulas",
                );
                setFunctions(result.functions);
              } catch (e) {
                setMessage((e as Error).message);
              }
            }
          }}
        >
          ƒx Functions
        </button>
      </div>
      <div className="j5-tools">
        <button
          disabled={!editable || sheet.rows >= 500}
          onClick={() => change(shiftSheet(config, "row", r))}
        >
          Insert row
        </button>
        <button
          disabled={!editable || sheet.rows <= 1}
          onClick={() => change(shiftSheet(config, "row", r, true))}
        >
          Delete row
        </button>
        <button
          disabled={!editable || sheet.cols >= 52}
          onClick={() => change(shiftSheet(config, "column", c))}
        >
          Insert column
        </button>
        <button
          disabled={!editable || sheet.cols <= 1}
          onClick={() => change(shiftSheet(config, "column", c, true))}
        >
          Delete column
        </button>
        <label>
          Width
          <input
            type="number"
            aria-label="Column width"
            min="50"
            max="400"
            disabled={!editable}
            value={sheet.col_widths?.[c] || 150}
            onChange={(e) =>
              change({
                ...config,
                sheet: {
                  ...sheet,
                  col_widths: {
                    ...sheet.col_widths,
                    [c]: Math.max(50, Math.min(400, Number(e.target.value))),
                  },
                },
              })
            }
          />
        </label>
        <label>
          Height
          <input
            type="number"
            aria-label="Row height"
            min="20"
            max="180"
            disabled={!editable}
            value={sheet.row_heights?.[r] || 36}
            onChange={(e) =>
              change({
                ...config,
                sheet: {
                  ...sheet,
                  row_heights: {
                    ...sheet.row_heights,
                    [r]: Math.max(20, Math.min(180, Number(e.target.value))),
                  },
                },
              })
            }
          />
        </label>
      </div>
      <div className="j5-formula">
        <span>
          {selected}
          {selected !== end ? ":" + end : ""}
        </span>
        <b>ƒx</b>
        <input
          aria-label="Cell value or formula"
          disabled={!editable}
          value={cell.formula || String(cell.value ?? "")}
          placeholder={
            cell.field
              ? "Bound to " + cell.field
              : "Text, number or =SUM(B2:B5)"
          }
          onChange={(e) => patch(content(e.target.value))}
        />
      </div>
      <div className="j5-tools">
        <label>
          Input binding
          <select
            aria-label="Bind selected cell"
            disabled={!editable}
            value={cell.field || ""}
            onChange={(e) => {
              patch({
                field: e.target.value || undefined,
                formula: undefined,
                value: undefined,
              });
              if (e.target.value)
                selectField(
                  config.fields.findIndex((f) => f.id === e.target.value),
                );
            }}
          >
            <option value="">No input field</option>
            {config.fields.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label} ({f.id})
              </option>
            ))}
          </select>
        </label>
        <label className="j5-check">
          <input
            type="checkbox"
            disabled={!editable}
            checked={sheet.freeze_row || false}
            onChange={(e) =>
              change({
                ...config,
                sheet: { ...sheet, freeze_row: e.target.checked },
              })
            }
          />
          Freeze first row
        </label>
        <label className="j5-check">
          <input
            type="checkbox"
            disabled={!editable}
            checked={sheet.freeze_column || false}
            onChange={(e) =>
              change({
                ...config,
                sheet: { ...sheet, freeze_column: e.target.checked },
              })
            }
          />
          Freeze first column
        </label>
      </div>
      {help && (
        <div className="j5-function-catalog">
          <strong>Local formula evaluator · supported functions</strong>
          <p>
            Use cell addresses, ranges, field IDs, arithmetic, comparisons and
            &amp; for text. Unknown functions and cycles are rejected.
          </p>
          {Object.entries(functions).map(([name, signature]) => (
            <button
              key={name}
              onClick={() => {
                if (editable)
                  patch({
                    formula: "=" + name + "()",
                    field: undefined,
                    value: undefined,
                  });
              }}
            >
              {signature}
            </button>
          ))}
        </div>
      )}
      <div
        className="j5-free-grid-scroll"
        tabIndex={0}
        aria-label="Spreadsheet grid"
        onCopy={(e) => {
          if (editing) return;
          e.preventDefault();
          e.clipboardData.setData("text/plain", tsv());
        }}
        onPaste={(e) => {
          if (!editable || editing) return;
          e.preventDefault();
          paste(e.clipboardData.getData("text/plain"));
        }}
        onKeyDown={(e) => {
          if (editing) return;
          if (e.key === "Enter" && editable) {
            setEditing(true);
            setTimeout(() => input.current?.focus(), 0);
            e.preventDefault();
          }
          const directions: Record<string, [number, number]> = {
            ArrowUp: [-1, 0],
            ArrowDown: [1, 0],
            ArrowLeft: [0, -1],
            ArrowRight: [0, 1],
          };
          if (directions[e.key]) {
            e.preventDefault();
            const [dr, dc] = directions[e.key];
            choose(
              address(
                Math.max(
                  0,
                  Math.min(sheet.rows - 1, (e.shiftKey ? er : r) + dr),
                ),
                Math.max(
                  0,
                  Math.min(sheet.cols - 1, (e.shiftKey ? ec : c) + dc),
                ),
              ),
              e.shiftKey,
            );
          }
          if (e.key === "Delete" && editable) {
            e.preventDefault();
            const cells = { ...sheet.cells };
            for (let row = r1; row <= r2; row++)
              for (let col = c1; col <= c2; col++) {
                const key = address(row, col);
                cells[key] = { style: cells[key]?.style };
              }
            change({ ...config, sheet: { ...sheet, cells } });
          }
        }}
      >
        <table
          className={
            "j5-free-grid " +
            (sheet.freeze_row ? "freeze-row " : "") +
            (sheet.freeze_column ? "freeze-col" : "")
          }
        >
          <colgroup>
            <col style={{ width: 32 }} />
            {Array.from({ length: sheet.cols }, (_, i) => (
              <col key={i} style={{ width: sheet.col_widths?.[i] || 150 }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th />
              {Array.from({ length: sheet.cols }, (_, i) => (
                <th key={i}>{address(0, i).replace(/1$/, "")}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: sheet.rows }, (_, row) => (
              <tr key={row} style={{ height: sheet.row_heights?.[row] || 36 }}>
                <th>{row + 1}</th>
                {Array.from({ length: sheet.cols }, (_, col) => {
                  const key = address(row, col),
                    cell = sheet.cells[key] || {},
                    span = mergeAt(sheet, row, col);
                  if (!span) return null;
                  const value = cell.field
                    ? `[${cell.field}]`
                    : cell.formula
                      ? errors[key] || (display[key] ?? "…")
                      : cell.value;
                  return (
                    <td
                      data-cell={key}
                      key={col}
                      rowSpan={span.rows}
                      colSpan={span.cols}
                      style={cellStyle({
                        ...cell,
                        style: { ...themeStyle(config), ...cell.style },
                      })}
                      className={
                        (row >= r1 && row <= r2 && col >= c1 && col <= c2
                          ? "range-selected "
                          : "") +
                        (selected === key ? "current " : "") +
                        (errors[key] ? "formula-error" : "")
                      }
                      onClick={(e) => choose(key, e.shiftKey)}
                      onDoubleClick={() => {
                        if (editable) {
                          setEditing(true);
                          setTimeout(() => input.current?.focus(), 0);
                        }
                      }}
                      title={errors[key] || cell.formula || cell.field || ""}
                    >
                      {editing && selected === key ? (
                        <input
                          ref={input}
                          aria-label={"Edit " + key}
                          autoFocus
                          value={cell.formula || String(cell.value ?? "")}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => patch(content(e.target.value))}
                          onBlur={() => setEditing(false)}
                          onKeyDown={(e) => {
                            if (["Enter", "Escape"].includes(e.key)) {
                              e.stopPropagation();
                              setEditing(false);
                            }
                          }}
                        />
                      ) : (
                        <span>{String(value ?? "")}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="j5-sheet-footer">
        {sheet.rows} rows × {sheet.cols} columns · Shift-click to select a range
        · Copy/paste TSV
        <span>
          {message ||
            errors[selected] ||
            "Changes are included in the published template."}
        </span>
      </div>
    </div>
  );
}
