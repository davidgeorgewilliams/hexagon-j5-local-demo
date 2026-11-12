import { useState } from "react";
import type { Definition, Field, Role, RepeatingTable } from "../types";
import { Fields, type Values } from "./Fields";
export function RepeatingRows({
  definition,
  values,
  setValues,
  disabled,
  role,
}: {
  definition: Definition;
  values: Values;
  setValues: (v: Values) => void;
  disabled?: boolean;
  role?: Role;
}) {
  return (
    <>
      {definition.tables?.map((table) => {
        const rows = (
          Array.isArray(values[table.id]) ? values[table.id] : []
        ) as Values[];
        const update = (next: Values[]) =>
          setValues({ ...values, [table.id]: next });
        return (
          <section className="j5-repeat" key={table.id}>
            <header>
              <h3>{table.label}</h3>
              <span>
                {rows.length} / {table.max_rows} rows
              </span>
              <button
                disabled={disabled || rows.length >= table.max_rows}
                onClick={() =>
                  update([
                    ...rows,
                    Object.fromEntries(
                      table.columns
                        .filter((f) => f.default !== undefined)
                        .map((f) => [f.id, f.default!]),
                    ),
                  ])
                }
              >
                Add row to {table.label}
              </button>
            </header>
            <div className="j5-repeat-scroll">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    {table.columns.map((f) => (
                      <th key={f.id}>
                        {f.label}
                        {f.required ? " *" : ""}
                      </th>
                    ))}
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr key={i}>
                      <th>{i + 1}</th>
                      {table.columns.map((f) => (
                        <td key={f.id}>
                          <Fields
                            definition={{
                              ...definition,
                              fields: table.columns,
                              tables: [],
                              sheet: undefined,
                              state_tree: undefined,
                            }}
                            values={row}
                            setValues={(next) =>
                              update(rows.map((r, n) => (n === i ? next : r)))
                            }
                            disabled={disabled}
                            role={role}
                            renderIds={[f.id]}
                            calculate={false}
                          />
                        </td>
                      ))}
                      <td>
                        <button
                          aria-label={`Remove ${table.label} row ${i + 1}`}
                          disabled={disabled}
                          onClick={() => update(rows.filter((_, n) => n !== i))}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <small>
              At least {table.min_rows} rows required on submission.
            </small>
          </section>
        );
      })}
    </>
  );
}
export function TableDesigner({
  config,
  change,
  disabled,
}: {
  config: Definition;
  change: (d: Definition) => void;
  disabled: boolean;
}) {
  const [selected, setSelected] = useState(0);
  const tables = config.tables || [],
    table = tables[selected];
  const update = (patch: Partial<RepeatingTable>) =>
    change({
      ...config,
      tables: tables.map((t, i) => (i === selected ? { ...t, ...patch } : t)),
    });
  const field = (i: number, patch: Partial<Field>) =>
    update({
      columns: table.columns.map((f, n) => (n === i ? { ...f, ...patch } : f)),
    });
  return (
    <fieldset disabled={disabled} className="j5-resource-editor">
      <h3>Repeating inspection tables</h3>
      <div className="j5-tools">
        <select
          aria-label="Repeating table"
          value={selected}
          onChange={(e) => setSelected(Number(e.target.value))}
        >
          {tables.map((t, i) => (
            <option key={i} value={i}>
              {t.label}
            </option>
          ))}
        </select>
        <button
          onClick={() => {
            let n = tables.length + 1;
            while (
              tables.some((t) => t.id === `checks_${n}`) ||
              config.fields.some((f) => f.id === `checks_${n}`)
            )
              n++;
            change({
              ...config,
              tables: [
                ...tables,
                {
                  id: `checks_${n}`,
                  label: "Equipment checks",
                  min_rows: 1,
                  max_rows: 100,
                  columns: [
                    {
                      id: `checks_${n}_equipment`,
                      label: "Equipment",
                      type: "text",
                      required: true,
                      section: "Row",
                    },
                    {
                      id: `checks_${n}_result`,
                      label: "Result",
                      type: "choice",
                      options: ["Pass", "Attention required", "Fail"],
                      required: true,
                      section: "Row",
                    },
                  ],
                },
              ],
            });
            setSelected(tables.length);
          }}
        >
          Add repeating table
        </button>
        {table && (
          <button
            onClick={() => {
              change({
                ...config,
                tables: tables.filter((_, i) => i !== selected),
              });
              setSelected(0);
            }}
          >
            Delete table
          </button>
        )}
      </div>
      {table && (
        <>
          <div className="j5-form-row">
            <label>
              Table ID
              <input
                aria-label="Table ID"
                value={table.id}
                onChange={(e) => update({ id: e.target.value })}
              />
            </label>
            <label>
              Table label
              <input
                aria-label="Table label"
                value={table.label}
                onChange={(e) => update({ label: e.target.value })}
              />
            </label>
            <label>
              Minimum rows
              <input
                type="number"
                min={0}
                value={table.min_rows}
                onChange={(e) => update({ min_rows: Number(e.target.value) })}
              />
            </label>
            <label>
              Maximum rows
              <input
                type="number"
                min={1}
                max={500}
                value={table.max_rows}
                onChange={(e) => update({ max_rows: Number(e.target.value) })}
              />
            </label>
          </div>
          {table.columns.map((f, i) => (
            <details key={i} open>
              <summary>
                {f.label} · {f.id}
              </summary>
              <div className="j5-form-row">
                <label>
                  Column ID
                  <input
                    aria-label={`Column ${i + 1} ID`}
                    value={f.id}
                    onChange={(e) => field(i, { id: e.target.value })}
                  />
                </label>
                <label>
                  Label
                  <input
                    aria-label={`Column ${i + 1} label`}
                    value={f.label}
                    onChange={(e) => field(i, { label: e.target.value })}
                  />
                </label>
                <label>
                  Type
                  <select
                    value={f.type}
                    onChange={(e) =>
                      field(i, {
                        type: e.target.value as Field["type"],
                        options:
                          e.target.value === "choice"
                            ? ["Pass", "Fail"]
                            : undefined,
                      })
                    }
                  >
                    {[
                      "text",
                      "number",
                      "choice",
                      "checkbox",
                      "date",
                      "datetime",
                      "email",
                    ].map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={f.required}
                    onChange={(e) => field(i, { required: e.target.checked })}
                  />
                  Required
                </label>
                <label>
                  Formula
                  <input
                    value={f.formula || ""}
                    placeholder="=quantity*unit_cost"
                    onChange={(e) =>
                      field(i, { formula: e.target.value || undefined })
                    }
                  />
                </label>
                <label>
                  Upper limit
                  <input
                    type="number"
                    value={f.max ?? ""}
                    onChange={(e) =>
                      field(i, {
                        max:
                          e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                  />
                </label>
                {f.type === "choice" && (
                  <>
                    <label>
                      Options (one per line)
                      <textarea
                        value={f.options?.join("\n") || ""}
                        onChange={(e) =>
                          field(i, { options: e.target.value.split("\n") })
                        }
                      />
                    </label>
                    <label>
                      Shared option list
                      <select
                        value={f.option_list || ""}
                        onChange={(e) =>
                          field(i, { option_list: e.target.value || undefined })
                        }
                      >
                        <option value="">Inline options</option>
                        {Object.keys(config.option_lists || {}).map((k) => (
                          <option key={k}>{k}</option>
                        ))}
                      </select>
                    </label>
                  </>
                )}
                <button
                  disabled={table.columns.length <= 1}
                  onClick={() =>
                    update({ columns: table.columns.filter((_, n) => n !== i) })
                  }
                >
                  Remove column
                </button>
              </div>
            </details>
          ))}
          <button
            onClick={() => {
              let n = table.columns.length + 1;
              while (
                config.fields.some((f) => f.id === `column_${n}`) ||
                tables.some(
                  (t) =>
                    t.id === `column_${n}` ||
                    t.columns.some((f) => f.id === `column_${n}`),
                )
              )
                n++;
              update({
                columns: [
                  ...table.columns,
                  {
                    id: `column_${n}`,
                    label: "New column",
                    type: "text",
                    section: "Row",
                    required: false,
                  },
                ],
              });
            }}
          >
            Add column
          </button>
        </>
      )}
    </fieldset>
  );
}
export function LibraryDesigner({
  config,
  change,
  disabled,
}: {
  config: Definition;
  change: (d: Definition) => void;
  disabled: boolean;
}) {
  const [name, setName] = useState("equipment_options"),
    [error, setError] = useState("");
  const lists = config.option_lists || {};
  return (
    <fieldset disabled={disabled} className="j5-resource-editor">
      <h3>Reusable option lists</h3>
      <div className="j5-tools">
        <input
          aria-label="New option list name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button
          onClick={() => {
            if (!/^[a-z][a-z0-9_]{0,39}$/.test(name) || lists[name]) {
              setError("Choose a unique lowercase identifier.");
              return;
            }
            change({
              ...config,
              option_lists: { ...lists, [name]: { values: ["Pass", "Fail"] } },
            });
            setError("");
          }}
        >
          Add option list
        </button>
        <button
          onClick={async () => {
            try {
              const r = await fetch("/api/bootstrap");
              if (!r.ok) throw Error("Sign in to load equipment.");
              const data = await r.json();
              change({
                ...config,
                option_lists: {
                  ...lists,
                  equipment: {
                    values: data.assets.map((a: { id: string }) => a.id),
                  },
                },
              });
              setError(
                "Equipment list captured from the current register. Refresh to capture later additions.",
              );
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Snapshot equipment register
        </button>
      </div>
      {Object.entries(lists).map(([key, list]) => (
        <details open key={key}>
          <summary>{key}</summary>
          <label>
            Inherit from
            <select
              value={list.extends || ""}
              onChange={(e) =>
                change({
                  ...config,
                  option_lists: {
                    ...lists,
                    [key]: { ...list, extends: e.target.value || undefined },
                  },
                })
              }
            >
              <option value="">No parent</option>
              {Object.keys(lists)
                .filter((k) => k !== key)
                .map((k) => (
                  <option key={k}>{k}</option>
                ))}
            </select>
          </label>
          <label>
            Values (one per line)
            <textarea
              aria-label={`Option list ${key}`}
              value={list.values.join("\n")}
              onChange={(e) =>
                change({
                  ...config,
                  option_lists: {
                    ...lists,
                    [key]: { ...list, values: e.target.value.split("\n") },
                  },
                })
              }
            />
          </label>
          <button
            onClick={() =>
              change({
                ...config,
                option_lists: Object.fromEntries(
                  Object.entries(lists).filter(([k]) => k !== key),
                ),
              })
            }
          >
            Delete {key}
          </button>
        </details>
      ))}
      <h3>Theme inheritance</h3>
      <label>
        Active theme
        <select
          aria-label="Active theme"
          value={config.theme || ""}
          onChange={(e) =>
            change({ ...config, theme: e.target.value || undefined })
          }
        >
          <option value="">Cell styles only</option>
          {Object.keys(config.themes || {}).map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
      </label>
      <button
        onClick={() => {
          let n = 1;
          while (config.themes?.[`theme_${n}`]) n++;
          change({
            ...config,
            themes: {
              ...config.themes,
              [`theme_${n}`]: {
                style: { background: "#ffffff", color: "#222222" },
              },
            },
          });
        }}
      >
        Add theme
      </button>
      {Object.entries(config.themes || {}).map(([key, t]) => (
        <div key={key}>
          <h4>{key}</h4>
          <label>
            Parent
            <select
              value={t.extends || ""}
              onChange={(e) =>
                change({
                  ...config,
                  themes: {
                    ...config.themes,
                    [key]: { ...t, extends: e.target.value || undefined },
                  },
                })
              }
            >
              <option value="">None</option>
              {Object.keys(config.themes || {})
                .filter((k) => k !== key)
                .map((k) => (
                  <option key={k}>{k}</option>
                ))}
            </select>
          </label>
          <label>
            Background
            <input
              type="color"
              value={t.style.background || "#ffffff"}
              onChange={(e) =>
                change({
                  ...config,
                  themes: {
                    ...config.themes,
                    [key]: {
                      ...t,
                      style: { ...t.style, background: e.target.value },
                    },
                  },
                })
              }
            />
          </label>
          <label>
            Text
            <input
              type="color"
              value={t.style.color || "#222222"}
              onChange={(e) =>
                change({
                  ...config,
                  themes: {
                    ...config.themes,
                    [key]: {
                      ...t,
                      style: { ...t.style, color: e.target.value },
                    },
                  },
                })
              }
            />
          </label>
        </div>
      ))}
      {error && <p role="status">{error}</p>}
    </fieldset>
  );
}
