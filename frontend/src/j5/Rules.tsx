import type { Field, Rule } from "../types";
export const operators: [Rule["op"], string][] = [
  ["eq", "equals"],
  ["ne", "does not equal"],
  ["gt", ">"],
  ["gte", "≥"],
  ["lt", "<"],
  ["lte", "≤"],
  ["contains", "contains"],
  ["empty", "is empty"],
  ["not_empty", "is not empty"],
];
export function matches(rule: Rule, values: Record<string, unknown>): boolean {
  const v = values[rule.field],
    e = rule.value;
  switch (rule.op) {
    case "empty":
      return v == null || v === "";
    case "not_empty":
      return v != null && v !== "";
    case "eq":
      return v === e;
    case "ne":
      return v !== e;
    case "contains":
      return (
        typeof v === "string" &&
        v.toLowerCase().includes(String(e).toLowerCase())
      );
    default:
      if (typeof v !== "number" || typeof e !== "number") return false;
      return rule.op === "gt"
        ? v > e
        : rule.op === "gte"
          ? v >= e
          : rule.op === "lt"
            ? v < e
            : v <= e;
  }
}
export function Rules({
  title,
  rules = [],
  fields,
  change,
  disabled = false,
}: {
  title: string;
  rules?: Rule[];
  fields: Field[];
  change: (r: Rule[]) => void;
  disabled?: boolean;
}) {
  const patch = (i: number, p: Partial<Rule>) =>
    change(rules.map((r, n) => (n === i ? { ...r, ...p } : r)));
  return (
    <div className="rule-group">
      <h4>{title}</h4>
      <fieldset disabled={disabled}>
        {rules.map((r, i) => (
          <div className="rule" key={i}>
            <select
              aria-label={`${title} field ${i + 1}`}
              value={r.field}
              onChange={(e) =>
                patch(i, { field: e.target.value, value: undefined })
              }
            >
              {fields.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
            <select
              aria-label={`${title} operator ${i + 1}`}
              value={r.op}
              onChange={(e) =>
                patch(i, {
                  op: e.target.value as Rule["op"],
                  value: ["gt", "gte", "lt", "lte"].includes(e.target.value)
                    ? 0
                    : r.value,
                })
              }
            >
              {operators.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
            {!["empty", "not_empty"].includes(r.op) &&
              (fields.find((f) => f.id === r.field)?.type === "checkbox" ? (
                <select
                  aria-label={`${title} value ${i + 1}`}
                  value={String(r.value ?? false)}
                  onChange={(e) =>
                    patch(i, { value: e.target.value === "true" })
                  }
                >
                  <option value="true">True</option>
                  <option value="false">False</option>
                </select>
              ) : (
                <input
                  aria-label={`${title} value ${i + 1}`}
                  placeholder="Comparison value"
                  type={
                    ["gt", "gte", "lt", "lte"].includes(r.op) ||
                    fields.find((f) => f.id === r.field)?.type === "number"
                      ? "number"
                      : "text"
                  }
                  value={String(r.value ?? "")}
                  onChange={(e) =>
                    patch(i, {
                      value:
                        e.target.type === "number"
                          ? Number(e.target.value)
                          : e.target.value,
                    })
                  }
                />
              ))}
            <input
              aria-label={`${title} message ${i + 1}`}
              placeholder="Message shown to the operator"
              value={r.message || ""}
              onChange={(e) => patch(i, { message: e.target.value })}
            />
            <button
              type="button"
              aria-label={`Remove ${title} rule ${i + 1}`}
              onClick={() => change(rules.filter((_, n) => n !== i))}
            >
              Remove rule
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() =>
            change([
              ...rules,
              { field: fields[0].id, op: "not_empty", message: "" },
            ])
          }
        >
          + Add {title} rule
        </button>
      </fieldset>
    </div>
  );
}
