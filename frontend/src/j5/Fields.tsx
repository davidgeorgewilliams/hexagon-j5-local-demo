import { useState, useEffect } from "react";
import { api } from "../api";
import type { Definition, Role } from "../types";
import { matches } from "./Rules";
export type Values = import("../types").FormValues;
export function Fields({
  definition,
  values,
  setValues,
  disabled = false,
  role,
  renderIds,
  calculate = true,
}: {
  definition: Definition;
  values: Values;
  setValues: (v: Values) => void;
  disabled?: boolean;
  role?: Role;
  renderIds?: string[];
  calculate?: boolean;
}) {
  const [computed, setComputed] = useState<Values>({}),
    [errors, setErrors] = useState<Record<string, string>>({});
  const supplied = values;
  useEffect(() => {
    if (!calculate || !definition.fields.some((f) => f.formula)) {
      setComputed({});
      setErrors({});
      return;
    }
    let active = true;
    const timer = setTimeout(
      () =>
        api<{ computed: Values; errors: Record<string, string> }>(
          "/forms/calculate",
          "POST",
          { definition, values: supplied },
        )
          .then((r) => {
            if (active) {
              setComputed(r.computed);
              setErrors(r.errors);
            }
          })
          .catch((e) => {
            if (active) setErrors({ _form: e.message });
          }),
      180,
    );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [definition, supplied, calculate]);
  values = { ...values, ...computed };
  const visible = definition.fields
    .filter((f) => !renderIds || renderIds.includes(f.id))
    .filter(
      (f) =>
        !f.visible_if?.length || f.visible_if.every((r) => matches(r, values)),
    );
  return (
    <>
      {Object.entries(errors).map(([key, message]) => (
        <p className="red" role="alert" key={key}>
          {key}: {message}
        </p>
      ))}
      {[...new Set(visible.map((f) => f.section || "General"))].map(
        (section) => (
          <section className="form-section" key={section}>
            <h3>{section}</h3>
            <div className="field-grid">
              {visible
                .filter((f) => (f.section || "General") === section)
                .map((f) => {
                  const v = values[f.id],
                    locked =
                      disabled ||
                      Boolean(f.formula) ||
                      (!!role &&
                        !!f.edit_roles &&
                        !f.edit_roles.includes(role));
                  const flag =
                    (f.type === "number" &&
                      typeof v === "number" &&
                      f.max != null &&
                      v > f.max) ||
                    f.flag_if?.some((r) => matches(r, values));
                  return (
                    <label
                      key={f.id}
                      className={
                        (f.width === 2 || (!f.width && f.type === "text")
                          ? "field-wide "
                          : "") + (flag ? "flagged" : "")
                      }
                    >
                      {f.type !== "checkbox" && (
                        <span>
                          {f.label}
                          {f.required && <b className="required"> *</b>}
                        </span>
                      )}
                      {f.type === "number" ? (
                        <div className="unit-input">
                          <input
                            aria-label={f.label}
                            type="number"
                            step="any"
                            disabled={locked}
                            value={v == null ? "" : String(v)}
                            onChange={(e) =>
                              setValues({
                                ...values,
                                [f.id]:
                                  e.target.value === ""
                                    ? null
                                    : Number(e.target.value),
                              })
                            }
                          />
                          <span>{f.unit || "—"}</span>
                        </div>
                      ) : f.type === "choice" ? (
                        <select
                          aria-label={f.label}
                          disabled={locked}
                          value={String(v ?? "")}
                          onChange={(e) =>
                            setValues({ ...values, [f.id]: e.target.value })
                          }
                        >
                          <option value="">Select an option…</option>
                          {(f.option_list
                            ? listOptions(definition, f.option_list)
                            : f.options
                          )?.map((o) => (
                            <option key={o}>{o}</option>
                          ))}
                        </select>
                      ) : f.type === "checkbox" ? (
                        <span className="checkbox-row">
                          <input
                            type="checkbox"
                            disabled={locked}
                            checked={v === true}
                            onChange={(e) =>
                              setValues({ ...values, [f.id]: e.target.checked })
                            }
                          />
                          {f.label}
                          {f.required && <b className="required"> *</b>}
                        </span>
                      ) : f.type === "text" ? (
                        <textarea
                          aria-label={f.label}
                          rows={3}
                          disabled={locked}
                          value={String(v ?? "")}
                          onChange={(e) =>
                            setValues({ ...values, [f.id]: e.target.value })
                          }
                        />
                      ) : (
                        <input
                          aria-label={f.label}
                          type={
                            f.type === "datetime" ? "datetime-local" : f.type
                          }
                          disabled={locked}
                          value={String(v ?? "")}
                          onChange={(e) =>
                            setValues({ ...values, [f.id]: e.target.value })
                          }
                        />
                      )}
                      {f.help && <small>{f.help}</small>}
                      {f.max != null && (
                        <small className={flag ? "red" : ""}>
                          {flag ? "Exception · " : ""}Upper operating limit:{" "}
                          {f.max}
                          {f.unit}
                        </small>
                      )}
                      {f.flag_if
                        ?.filter((r) => matches(r, values))
                        .map((r, i) => (
                          <small className="red" key={i}>
                            {r.message || "Flag raised"}
                          </small>
                        ))}
                    </label>
                  );
                })}
            </div>
          </section>
        ),
      )}
    </>
  );
}

function listOptions(
  config: Definition,
  name: string,
  path: string[] = [],
): string[] {
  if (path.includes(name)) return [];
  const list = config.option_lists?.[name];
  if (!list) return [];
  return [
    ...new Set([
      ...(list.extends
        ? listOptions(config, list.extends, [...path, name])
        : []),
      ...list.values,
    ]),
  ];
}
