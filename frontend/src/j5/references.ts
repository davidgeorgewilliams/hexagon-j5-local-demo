import type { Definition, WorkflowNode } from "../types";
// Rewrite identifier tokens only; quoted text and function names remain untouched.
export function rewriteReference(
  formula: string,
  old: string,
  next: string,
): string {
  return formula
    .split(/("(?:[^"]|"")*")/g)
    .map((part, i) =>
      i % 2
        ? part
        : part.replace(
            /\[[A-Za-z_][A-Za-z0-9_]*\]|\$?[A-Za-z_][A-Za-z0-9_.$]*/g,
            (token, offset) => {
              if (
                part
                  .slice(offset + token.length)
                  .trimStart()
                  .startsWith("(")
              )
                return token;
              return token === old
                ? next
                : token === `[${old}]`
                  ? `[${next}]`
                  : token;
            },
          ),
    )
    .join("");
}
export function renameField(
  config: Definition,
  old: string,
  next: string,
): Definition {
  const formula = (s?: string) => (s ? rewriteReference(s, old, next) : s);
  const rules = (rs: Definition["fields"][number]["invalid_if"]) =>
    rs?.map((r) => ({ ...r, field: r.field === old ? next : r.field }));
  const effects = (es: WorkflowNode["entry_effects"]) =>
    es?.map((e) => ({
      ...e,
      field: e.field === old ? next : e.field,
      formula: formula(e.formula)!,
    }));
  const nodes = (ns: WorkflowNode[]): WorkflowNode[] =>
    ns.map((n) => ({
      ...n,
      entry_effects: effects(n.entry_effects),
      exit_effects: effects(n.exit_effects),
      children: n.children ? nodes(n.children) : undefined,
    }));
  return {
    ...config,
    fields: config.fields.map((f) => ({
      ...f,
      id: f.id === old ? next : f.id,
      formula: formula(f.formula),
      invalid_if: rules(f.invalid_if),
      flag_if: rules(f.flag_if),
      visible_if: rules(f.visible_if),
    })),
    sheet: config.sheet
      ? {
          ...config.sheet,
          cells: Object.fromEntries(
            Object.entries(config.sheet.cells).map(([k, c]) => [
              k,
              {
                ...c,
                field: c.field === old ? next : c.field,
                formula: formula(c.formula),
              },
            ]),
          ),
        }
      : undefined,
    transitions: config.transitions.map((t) => ({
      ...t,
      guards: rules(t.guards),
      guard_formula: formula(t.guard_formula),
      effects: effects(t.effects),
    })),
    state_tree: config.state_tree ? nodes(config.state_tree) : undefined,
  };
}
export function formulaUses(config: Definition, id: string): boolean {
  const all: string[] = [];
  config.fields.forEach((f) => {
    if (f.id !== id && f.formula) all.push(f.formula);
  });
  Object.values(config.sheet?.cells || {}).forEach((c) => {
    if (c.formula) all.push(c.formula);
  });
  let effectTarget = false;
  const effects = (es: WorkflowNode["entry_effects"]) =>
    es?.forEach((e) => {
      all.push(e.formula);
      if (e.field === id) effectTarget = true;
    });
  const nodes = (ns: WorkflowNode[]) =>
    ns.forEach((n) => {
      effects(n.entry_effects);
      effects(n.exit_effects);
      if (n.children) nodes(n.children);
    });
  config.transitions.forEach((t) => {
    if (t.guard_formula) all.push(t.guard_formula);
    effects(t.effects);
  });
  nodes(config.state_tree || []);
  return (
    effectTarget ||
    all.some((f) => rewriteReference(f, id, "__removed_field__") !== f)
  );
}
