import { RepeatingRows } from "./Tables";
import { useState, useEffect } from "react";
import type { Definition, Role } from "../types";
import { Fields, type Values } from "./Fields";
import { api } from "../api";
import { address, cellStyle, mergeAt, themeStyle } from "./sheetUtils";
export function SheetForm({
  definition,
  values,
  setValues,
  disabled = false,
  role,
}: {
  definition: Definition;
  values: Values;
  setValues: (values: Values) => void;
  disabled?: boolean;
  role?: Role;
}) {
  const [result, setResult] = useState<{
      cells: Record<string, unknown>;
      computed: Values;
      tables: Record<string, Values[]>;
      errors: Record<string, string>;
    }>({ cells: {}, computed: {}, tables: {}, errors: {} }),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const timer = setTimeout(
      () =>
        api<typeof result>("/forms/calculate", "POST", { definition, values })
          .then((r) => {
            if (active) {
              setResult(r);
              setError("");
            }
          })
          .catch((e) => {
            if (active) setError(e.message);
          }),
      150,
    );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [definition, values]);
  if (!definition.sheet)
    return (
      <>
        <Fields
          definition={definition}
          values={{ ...values, ...result.tables }}
          setValues={setValues}
          disabled={disabled}
          role={role}
        />
        <RepeatingRows
          definition={definition}
          values={{ ...values, ...result.tables }}
          setValues={setValues}
          disabled={disabled}
          role={role}
        />
      </>
    );
  const sheet = definition.sheet,
    bound = Object.values(sheet.cells).flatMap((c) =>
      c.field ? [c.field] : [],
    ),
    all = { ...values, ...result.computed, ...result.tables };
  return (
    <>
      <RepeatingRows
        definition={definition}
        values={{ ...values, ...result.tables }}
        setValues={setValues}
        disabled={disabled}
        role={role}
      />
      <div className="j5-sheet-runtime">
        <table>
          <colgroup>
            {Array.from({ length: sheet.cols }, (_, c) => (
              <col key={c} style={{ width: sheet.col_widths?.[c] || 150 }} />
            ))}
          </colgroup>
          <tbody>
            {Array.from({ length: sheet.rows }, (_, r) => (
              <tr key={r} style={{ height: sheet.row_heights?.[r] || 36 }}>
                {Array.from({ length: sheet.cols }, (_, c) => {
                  const key = address(r, c),
                    cell = sheet.cells[key] || {},
                    span = mergeAt(sheet, r, c);
                  if (!span) return null;
                  return (
                    <td
                      key={c}
                      rowSpan={span.rows}
                      colSpan={span.cols}
                      style={cellStyle({
                        ...cell,
                        style: { ...themeStyle(definition), ...cell.style },
                      })}
                      title={result.errors[key] || ""}
                    >
                      {cell.field ? (
                        <Fields
                          definition={definition}
                          values={all}
                          setValues={setValues}
                          disabled={disabled}
                          role={role}
                          calculate={false}
                          renderIds={[cell.field]}
                        />
                      ) : (
                        <span className={result.errors[key] ? "red" : ""}>
                          {String(
                            result.errors[key] ??
                              (cell.formula ? result.cells[key] : cell.value) ??
                              "",
                          )}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {error && (
        <p className="red" role="alert">
          {error}
        </p>
      )}
      {Object.entries(result.errors)
        .filter(([key]) => definition.fields.some((f) => f.id === key))
        .map(([key, message]) => (
          <p className="red" key={key}>
            {key}: {message}
          </p>
        ))}
      <Fields
        definition={definition}
        values={all}
        setValues={setValues}
        disabled={disabled}
        role={role}
        calculate={false}
        renderIds={definition.fields
          .filter((f) => !bound.includes(f.id))
          .map((f) => f.id)}
      />
    </>
  );
}
