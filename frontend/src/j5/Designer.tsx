import { TableDesigner, LibraryDesigner } from "./Tables";
import { renameField, formulaUses } from "./references";
import { useState, useRef } from "react";
import {
  Folder,
  FileText,
  ChevronDown,
  Database,
  Save,
  Undo2,
  Redo2,
  Plus,
  Copy,
  ArrowUp,
  ArrowDown,
  Trash2,
  Eye,
  Grid2X2,
  Check,
  Smartphone,
} from "lucide-react";
import type { Definition, Field, Role } from "../types";
import { Fields, type Values } from "./Fields";
import { Rules } from "./Rules";
import { api } from "../api";
import { Spreadsheet } from "./Spreadsheet";
import { SheetForm } from "./SheetForm";
export type EditorProps = {
  config: Definition;
  setConfig: (d: Definition) => void;
  editable: boolean;
};
const roles: Role[] = ["technician", "supervisor", "administrator"];
export function Designer({ config, setConfig, editable }: EditorProps) {
  const [selected, setSelected] = useState(0),
    [tab, setTab] = useState("Properties"),
    [preview, setPreview] = useState(false),
    [grid, setGrid] = useState(true),
    [mobile, setMobile] = useState(false),
    [values, setValues] = useState<Values>({}),
    [message, setMessage] = useState(""),
    [pending, setPending] = useState(false);
  const undo = useRef<Definition[]>([]),
    redo = useRef<Definition[]>([]);
  const field = config.fields[Math.min(selected, config.fields.length - 1)];
  const change = (next: Definition) => {
    undo.current = [...undo.current.slice(-49), structuredClone(config)];
    redo.current = [];
    setConfig(next);
    setMessage(
      "Working copy saved in this browser. Publish to use it for new inspections.",
    );
  };
  const update = (p: Partial<Field>) =>
    change({
      ...config,
      fields: config.fields.map((f) => (f === field ? { ...f, ...p } : f)),
    });
  const renameId = (id: string) => {
    if (config.fields.some((f) => f !== field && f.id === id)) {
      setMessage("That field ID is already in use.");
      return;
    }
    change(renameField(config, field.id, id));
  };
  const add = (duplicate = false) => {
    let n = config.fields.length + 1;
    while (config.fields.some((f) => f.id === `field_${n}`)) n++;
    change({
      ...config,
      fields: [
        ...config.fields,
        duplicate
          ? {
              ...structuredClone(field),
              id: `field_${n}`,
              label: field.label + " copy",
            }
          : {
              id: `field_${n}`,
              label: "New field",
              type: "text",
              required: false,
              section: field.section,
              width: 1,
            },
      ],
    });
    setSelected(config.fields.length);
    setTab("Properties");
  };
  const move = (direction: number) => {
    const i = config.fields.indexOf(field),
      j = i + direction;
    if (j < 0 || j >= config.fields.length) return;
    const fields = [...config.fields];
    [fields[i], fields[j]] = [fields[j], fields[i]];
    change({ ...config, fields });
    setSelected(j);
  };
  const validate = async () => {
    setPending(true);
    try {
      await api("/config/validate", "POST", {
        definition: config,
        base_version: 0,
      });
      setMessage(
        "Definition valid: all fields, rules, permissions and workflow paths checked.",
      );
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setPending(false);
    }
  };
  const sections = [
    ...new Set(config.fields.map((f) => f.section || "General")),
  ];
  return (
    <section className="j5-workbench" aria-label="IndustraForm-style designer">
      <div className="j5-window-title">
        <Grid2X2 size={14} />
        <strong>IndustraForm Designer</strong>
        <span>Campus Operations · local authoring environment</span>
        <a
          href="/j5-references/?category=Designer"
          target="_blank"
          rel="noreferrer"
        >
          Source screenshots ↗
        </a>
      </div>
      <div className="j5-tools">
        <button
          onClick={() => {
            setGrid(!grid);
            setPreview(false);
          }}
        >
          {grid ? "Field rows" : "Spreadsheet"}
        </button>
        <button
          onClick={async () => {
            try {
              const response = await fetch("/api/forms/export.xlsx", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ definition: config }),
              });
              if (!response.ok) throw Error((await response.json()).detail);
              const url = URL.createObjectURL(await response.blob());
              const a = document.createElement("a");
              a.href = url;
              a.download = "inspection.xlsx";
              a.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            } catch (e) {
              setMessage((e as Error).message);
            }
          }}
        >
          Export XLSX
        </button>
        <label className="j5-file-button">
          Import XLSX
          <input
            aria-label="Import XLSX"
            type="file"
            accept=".xlsx"
            disabled={!editable}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              const form = new FormData();
              form.append("file", file);
              api<{ definition: Definition; warnings: string[] }>(
                "/forms/import.xlsx",
                "POST",
                form,
              )
                .then((r) => {
                  change(r.definition);
                  setMessage("Workbook imported. " + r.warnings.join(" "));
                })
                .catch((e) => setMessage(e.message));
            }}
          />
        </label>
        <button
          disabled={!editable || !undo.current.length}
          onClick={() => {
            redo.current.push(config);
            setConfig(undo.current.pop()!);
          }}
        >
          {" "}
          <Undo2 /> Undo
        </button>
        <button
          disabled={!editable || !redo.current.length}
          onClick={() => {
            undo.current.push(config);
            setConfig(redo.current.pop()!);
          }}
        >
          <Redo2 /> Redo
        </button>
        <i />
        <button
          disabled={!editable || config.fields.length >= 40}
          onClick={() => add()}
        >
          <Plus /> Add field
        </button>
        <button
          disabled={!editable || config.fields.length >= 40}
          onClick={() => add(true)}
        >
          <Copy /> Duplicate
        </button>
        <button
          aria-label="Move field up"
          disabled={!editable || selected === 0}
          onClick={() => move(-1)}
        >
          <ArrowUp />
        </button>
        <button
          aria-label="Move field down"
          disabled={!editable || selected >= config.fields.length - 1}
          onClick={() => move(1)}
        >
          <ArrowDown />
        </button>
        <button
          disabled={!editable || config.fields.length <= 1}
          onClick={() => {
            const refs = [
              ...config.fields.flatMap((f) => [
                ...(f.invalid_if || []),
                ...(f.flag_if || []),
                ...(f.visible_if || []),
              ]),
              ...config.transitions.flatMap((t) => t.guards || []),
            ];
            if (
              refs.some((r) => r.field === field.id) ||
              formulaUses(config, field.id)
            ) {
              setMessage(
                "Remove conditions, formulas or effects referencing this field before deleting it.",
              );
              return;
            }
            change({
              ...config,
              fields: config.fields.filter((f) => f !== field),
              sheet: config.sheet
                ? {
                    ...config.sheet,
                    cells: Object.fromEntries(
                      Object.entries(config.sheet.cells).map(([k, c]) => [
                        k,
                        c.field === field.id ? { ...c, field: undefined } : c,
                      ]),
                    ),
                  }
                : undefined,
            });
            setSelected(0);
          }}
        >
          <Trash2 /> Delete field
        </button>
        <i />
        <button
          onClick={() => {
            setPreview(!preview);
            if (!preview)
              setValues(
                Object.fromEntries(
                  config.fields
                    .filter((f) => "default" in f)
                    .map((f) => [f.id, f.default ?? null]),
                ),
              );
          }}
        >
          {preview ? <Grid2X2 /> : <Eye />}
          {preview ? "Design" : "Preview"}
        </button>
        <button
          className={mobile ? "active" : ""}
          onClick={() => {
            setMobile(!mobile);
            setPreview(true);
          }}
        >
          <Smartphone /> Mobile layout
        </button>
        <button disabled={pending || !editable} onClick={validate}>
          <Check /> Validate
        </button>
      </div>
      {!editable && (
        <div className="j5-notice">
          Read-only. Sign in as Alex Morgan to edit and publish.
        </div>
      )}
      <div className="j5-designer-grid">
        <aside className="j5-explorer">
          <div className="j5-pane-caption">Navigation</div>
          <div className="j5-tree-root">
            <ChevronDown />
            <Database /> Campus [LOCAL]
          </div>
          {[
            "Operations Logbook",
            "Operator Rounds",
            "Reports",
            "Shift Handover",
            "Work Instructions",
          ].map((name) => (
            <details key={name} open={name === "Operator Rounds"}>
              <summary>
                <Folder />
                {name}
              </summary>
              {name === "Operator Rounds" ? (
                <>
                  <div className="j5-tree-file">
                    <FileText />
                    {config.name}
                  </div>
                  {sections.map((section) => (
                    <details open key={section}>
                      <summary>
                        <Folder />
                        {section}
                      </summary>
                      {config.fields.map(
                        (f, i) =>
                          f.section === section && (
                            <button
                              key={f.id}
                              className={field === f ? "selected" : ""}
                              onClick={() => {
                                setSelected(i);
                                setPreview(false);
                                setTab("Properties");
                              }}
                            >
                              <FileText />
                              {f.label}
                            </button>
                          ),
                      )}
                    </details>
                  ))}
                </>
              ) : (
                <span className="j5-tree-empty">
                  No form templates in this module
                </span>
              )}
            </details>
          ))}
          <div className="j5-pane-caption">Operational hierarchy</div>
          <details open>
            <summary>
              <Folder />
              Northbank Campus
            </summary>
            {[
              "North Tower",
              "West Residences",
              "Central Services",
              "East Exchange",
            ].map((s) => (
              <div className="j5-tree-area" key={s}>
                ⌖ {s}
              </div>
            ))}
          </details>
        </aside>
        <div className="j5-sheet-pane">
          <div className="j5-document-tab">
            <FileText />
            {config.name} <span>• Working copy</span>
          </div>
          {preview ? (
            <div className={"j5-preview " + (mobile ? "mobile" : "")}>
              <div className="j5-pane-caption">
                {mobile ? "Mobile layout" : "Form preview"} · {config.name}
              </div>
              {config.sheet && !mobile ? (
                <SheetForm
                  definition={config}
                  values={values}
                  setValues={setValues}
                />
              ) : (
                <Fields
                  definition={config}
                  values={values}
                  setValues={setValues}
                />
              )}
              <button
                disabled={pending}
                onClick={async () => {
                  setPending(true);
                  try {
                    const result = await api<{ exceptions: string[] }>(
                      "/forms/validate",
                      "POST",
                      { definition: config, values },
                    );
                    setMessage(
                      result.exceptions.length
                        ? "Valid with flags: " + result.exceptions.join("; ")
                        : "Preview submission valid.",
                    );
                  } catch (e) {
                    setMessage((e as Error).message);
                  } finally {
                    setPending(false);
                  }
                }}
              >
                Validate preview submission
              </button>
            </div>
          ) : grid ? (
            <Spreadsheet
              config={config}
              change={change}
              editable={editable}
              selectField={setSelected}
            />
          ) : (
            <>
              <div className="j5-formula">
                <span>B{selected + 2}</span>
                <b>ƒx</b>
                <input
                  aria-label="Selected field label"
                  disabled={!editable}
                  value={field.label}
                  onChange={(e) => update({ label: e.target.value })}
                />
              </div>
              <div className="j5-sheet-scroll">
                <table className="j5-sheet">
                  <thead>
                    <tr>
                      <th />
                      <th>A</th>
                      <th>B</th>
                      <th>C</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="j5-form-title">
                      <th>1</th>
                      <td colSpan={3}>{config.name}</td>
                    </tr>
                    {config.fields.map((f, i) => (
                      <tr
                        key={i}
                        className={field === f ? "selected" : ""}
                        onClick={() => setSelected(i)}
                      >
                        <th>{i + 2}</th>
                        <td>
                          <button onClick={() => setSelected(i)}>
                            {f.label}
                            {f.required ? " *" : ""}
                          </button>
                        </td>
                        <td className="j5-input-cell">
                          {f.type === "checkbox"
                            ? "☐"
                            : f.type === "choice"
                              ? "Select… ▾"
                              : f.type === "date"
                                ? "dd / mm / yyyy"
                                : f.type === "number"
                                  ? `0.0 ${f.unit || ""}`
                                  : "Enter " + f.type + "…"}
                          <small>{f.id}</small>
                        </td>
                        <td>
                          {f.section}
                          <small>
                            {f.max != null
                              ? `Raise flag if > ${f.max}`
                              : f.required
                                ? "Required input"
                                : "Optional input"}
                          </small>
                        </td>
                      </tr>
                    ))}
                    {Array.from(
                      { length: Math.max(5, 14 - config.fields.length) },
                      (_, i) => (
                        <tr className="j5-empty-row" key={"empty" + i}>
                          <th>{config.fields.length + i + 2}</th>
                          <td />
                          <td />
                          <td />
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
              </div>
              <div className="j5-sheet-footer">
                ▤ Form layout{" "}
                <span>
                  {config.fields.length} fields · {sections.length} sections
                </span>
              </div>
            </>
          )}
        </div>
        <aside className="j5-properties">
          <div className="j5-property-tabs">
            {[
              "Properties",
              "Sections",
              "Roles",
              "Form Settings",
              "Tables",
              "Libraries",
            ].map((t) => (
              <button
                key={t}
                className={tab === t ? "active" : ""}
                onClick={() => setTab(t)}
              >
                {t}
              </button>
            ))}
          </div>
          {tab === "Tables" && (
            <TableDesigner
              config={config}
              change={change}
              disabled={!editable}
            />
          )}
          {tab === "Libraries" && (
            <LibraryDesigner
              config={config}
              change={change}
              disabled={!editable}
            />
          )}
          <fieldset disabled={!editable}>
            {tab === "Properties" && (
              <>
                <select
                  aria-label="Select field"
                  value={config.fields.indexOf(field)}
                  onChange={(e) => setSelected(Number(e.target.value))}
                >
                  {config.fields.map((f, i) => (
                    <option value={i} key={i}>
                      {f.label} ({f.id})
                    </option>
                  ))}
                </select>
                <label>
                  Shared option list
                  <select
                    aria-label="Field option list"
                    disabled={field.type !== "choice"}
                    value={field.option_list || ""}
                    onChange={(e) =>
                      update({ option_list: e.target.value || undefined })
                    }
                  >
                    <option value="">Inline options</option>
                    {Object.keys(config.option_lists || {}).map((k) => (
                      <option key={k}>{k}</option>
                    ))}
                  </select>
                </label>
                <h4>Cell properties</h4>
                <label>
                  Cell ID
                  <input
                    value={field.id}
                    onChange={(e) => renameId(e.target.value)}
                  />
                </label>
                <label>
                  Label
                  <input
                    value={field.label}
                    onChange={(e) => update({ label: e.target.value })}
                  />
                </label>
                <label>
                  Input type
                  <select
                    aria-label="Input type"
                    value={field.type}
                    onChange={(e) =>
                      update({
                        type: e.target.value as Field["type"],
                        default: undefined,
                        options:
                          e.target.value === "choice"
                            ? field.options || ["Normal", "Attention required"]
                            : undefined,
                        max:
                          e.target.value === "number" ? field.max : undefined,
                      })
                    }
                  >
                    {[
                      "number",
                      "text",
                      "choice",
                      "checkbox",
                      "date",
                      "datetime",
                      "email",
                    ].map((t) => (
                      <option key={t} value={t}>
                        {t[0].toUpperCase() + t.slice(1)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Section
                  <input
                    list="form-sections"
                    value={field.section}
                    onChange={(e) => update({ section: e.target.value })}
                  />
                  <datalist id="form-sections">
                    {sections.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </datalist>
                </label>
                <label className="j5-check">
                  <input
                    type="checkbox"
                    checked={field.required}
                    onChange={(e) => update({ required: e.target.checked })}
                  />
                  Input is required
                </label>
                <label>
                  Preview width
                  <select
                    aria-label="Preview width"
                    value={field.width || 1}
                    onChange={(e) =>
                      update({ width: Number(e.target.value) as 1 | 2 })
                    }
                  >
                    <option value={1}>One column</option>
                    <option value={2}>Full row</option>
                  </select>
                </label>
                <label>
                  Calculated value formula
                  <input
                    aria-label="Calculated value formula"
                    placeholder='=IF(temperature > 32, "High", "Normal")'
                    value={field.formula || ""}
                    onChange={(e) =>
                      update({ formula: e.target.value || undefined })
                    }
                  />
                </label>
                <label>
                  Help text
                  <input
                    value={field.help || ""}
                    onChange={(e) => update({ help: e.target.value })}
                  />
                </label>
                <label>
                  Default value
                  {field.type === "checkbox" ? (
                    <select
                      aria-label="Default value"
                      value={String(field.default ?? "")}
                      onChange={(e) =>
                        update({
                          default:
                            e.target.value === ""
                              ? undefined
                              : e.target.value === "true",
                        })
                      }
                    >
                      <option value="">No default</option>
                      <option value="true">True</option>
                      <option value="false">False</option>
                    </select>
                  ) : (
                    <input
                      type={
                        field.type === "number"
                          ? "number"
                          : field.type === "datetime"
                            ? "datetime-local"
                            : ["date", "email"].includes(field.type)
                              ? field.type
                              : "text"
                      }
                      value={String(field.default ?? "")}
                      onChange={(e) =>
                        update({
                          default:
                            e.target.value === ""
                              ? undefined
                              : field.type === "number"
                                ? Number(e.target.value)
                                : e.target.value,
                        })
                      }
                    />
                  )}
                </label>
                {field.type === "number" && (
                  <>
                    <label>
                      Unit
                      <input
                        value={field.unit || ""}
                        onChange={(e) => update({ unit: e.target.value })}
                      />
                    </label>
                    <label>
                      Upper operating limit
                      <input
                        type="number"
                        value={field.max ?? ""}
                        onChange={(e) =>
                          update({
                            max:
                              e.target.value === ""
                                ? null
                                : Number(e.target.value),
                          })
                        }
                      />
                    </label>
                  </>
                )}
                {field.type === "choice" && (
                  <label>
                    Options (one per line)
                    <textarea
                      value={(field.options || []).join("\n")}
                      onChange={(e) =>
                        update({ options: e.target.value.split("\n") })
                      }
                    />
                  </label>
                )}
                <Rules
                  title="Invalid If"
                  fields={config.fields}
                  rules={field.invalid_if}
                  change={(r) => update({ invalid_if: r })}
                />
                <Rules
                  title="Raise Flag If"
                  fields={config.fields}
                  rules={field.flag_if}
                  change={(r) => update({ flag_if: r })}
                />
                <Rules
                  title="Visible If"
                  fields={config.fields}
                  rules={field.visible_if}
                  change={(r) => update({ visible_if: r })}
                />
                <p>
                  Invalid If and Raise Flag If match any rule. Visible If
                  requires every rule.
                </p>
              </>
            )}
            {tab === "Sections" && (
              <>
                <h4>Form sections</h4>
                <p>
                  Select a field in the grid to assign it to a section. Field
                  order controls the displayed order within each section.
                </p>
                {sections.map((section) => (
                  <div className="j5-section-item" key={section}>
                    <label>
                      Section name
                      <input
                        aria-label={"Rename " + section}
                        defaultValue={section}
                        onBlur={(e) => {
                          if (
                            e.target.value.trim() &&
                            e.target.value !== section
                          )
                            change({
                              ...config,
                              fields: config.fields.map((f) =>
                                (f.section || "General") === section
                                  ? { ...f, section: e.target.value.trim() }
                                  : f,
                              ),
                            });
                        }}
                      />
                    </label>
                    <small>
                      {
                        config.fields.filter(
                          (f) => (f.section || "General") === section,
                        ).length
                      }{" "}
                      fields
                    </small>
                  </div>
                ))}
              </>
            )}
            {tab === "Roles" && (
              <>
                <h4>Field edit permissions</h4>
                <p>
                  Roles below can edit <strong>{field.label}</strong> while its
                  workflow state permits editing.
                </p>
                {roles.map((role) => (
                  <label className="j5-check" key={role}>
                    <input
                      type="checkbox"
                      checked={(field.edit_roles || roles).includes(role)}
                      onChange={(e) =>
                        update({
                          edit_roles: e.target.checked
                            ? [...(field.edit_roles || roles), role]
                            : (field.edit_roles || roles).filter(
                                (r) => r !== role,
                              ),
                        })
                      }
                    />
                    {role}
                  </label>
                ))}
                <p>
                  Workflow transition permissions are configured in Workflow
                  Editor.
                </p>
              </>
            )}
            {tab === "Form Settings" && (
              <>
                <h4>Form settings</h4>
                <label>
                  Form name
                  <input
                    value={config.name}
                    onChange={(e) =>
                      change({ ...config, name: e.target.value })
                    }
                  />
                </label>
                <label>
                  Description
                  <textarea
                    value={config.description}
                    onChange={(e) =>
                      change({ ...config, description: e.target.value })
                    }
                  />
                </label>
                <label className="j5-check">
                  <input
                    type="checkbox"
                    checked={config.evidence_on_exception}
                    onChange={(e) =>
                      change({
                        ...config,
                        evidence_on_exception: e.target.checked,
                      })
                    }
                  />
                  Require evidence for exceptions
                </label>
                <p>
                  Published versions are immutable. Each new inspection keeps
                  its version for its entire lifecycle.
                </p>
                <a href="#config">Open Configuration controls →</a>
              </>
            )}
          </fieldset>
        </aside>
      </div>
      <div className="j5-status" role="status">
        <Save size={12} />
        {message ||
          "Ready · Select a cell to edit its input, rules and permissions."}
      </div>
    </section>
  );
}
