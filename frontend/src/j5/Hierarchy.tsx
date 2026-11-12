import { CornerDownRight } from "lucide-react";
import { useState } from "react";
import type { Definition, WorkflowNode, WorkflowEffect } from "../types";
import { tree, flattenNodes, changeNode, initialLeaves } from "./workflowUtils";
export function Effects({
  title,
  effects = [],
  config,
  change,
  disabled = false,
}: {
  title: string;
  effects?: WorkflowEffect[];
  config: Definition;
  change: (effects: WorkflowEffect[]) => void;
  disabled?: boolean;
}) {
  return (
    <div className="j5-effects">
      <h4>{title}</h4>
      <fieldset disabled={disabled}>
        {effects.map((effect, i) => (
          <div className="rule" key={i}>
            <select
              aria-label={`${title} field ${i + 1}`}
              value={effect.field}
              onChange={(e) =>
                change(
                  effects.map((x, n) =>
                    n === i ? { ...x, field: e.target.value } : x,
                  ),
                )
              }
            >
              {config.fields
                .filter((f) => !f.formula)
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
            </select>
            <input
              aria-label={`${title} formula ${i + 1}`}
              value={effect.formula}
              onChange={(e) =>
                change(
                  effects.map((x, n) =>
                    n === i ? { ...x, formula: e.target.value } : x,
                  ),
                )
              }
            />
            <button onClick={() => change(effects.filter((_, n) => n !== i))}>
              Remove effect
            </button>
          </div>
        ))}
        <button
          disabled={!config.fields.some((f) => !f.formula)}
          onClick={() =>
            change([
              ...effects,
              {
                field: config.fields.find((f) => !f.formula)!.id,
                formula: "=WORKFLOW.EVENTUSER()",
              },
            ])
          }
        >
          + Add {title.toLowerCase()}
        </button>
      </fieldset>
    </div>
  );
}
export function HierarchyCanvas({
  config,
  active,
  select,
  selected,
}: {
  config: Definition;
  active: string[];
  select: (id: string) => void;
  selected: string;
}) {
  const render = (node: WorkflowNode): React.ReactNode => (
    <div
      key={node.id}
      className={
        "j5-hnode kind-" +
        node.kind +
        (active.includes(node.id) ? " is-active" : "") +
        (selected === node.id ? " is-selected" : "")
      }
    >
      <button onClick={() => select(node.id)}>
        <strong>{node.label || node.id}</strong>
        <small>
          {node.kind === "parallel"
            ? "Parallel · all regions required"
            : node.kind === "compound"
              ? "Compound state"
              : node.kind === "final"
                ? "◉ Complete"
                : "State"}
        </small>
      </button>
      {node.children && (
        <div className={"j5-hchildren " + node.kind}>
          {node.children.map(render)}
        </div>
      )}
      {config.transitions
        .filter((t) => t.source === node.id)
        .map((t) => (
          <div className="j5-htransition" key={t.id}>
            <CornerDownRight size={11} /> {t.label} → {t.target}
            {t.event === "completion" ? " (automatic)" : ""}
          </div>
        ))}
    </div>
  );
  return <div className="j5-hierarchy-canvas">{tree(config).map(render)}</div>;
}
export function HierarchyEditor({
  config,
  setConfig,
  editable,
  selected,
  onSelect,
}: {
  config: Definition;
  setConfig: (d: Definition) => void;
  editable: boolean;
  selected: string;
  onSelect: (id: string) => void;
}) {
  const nodes = tree(config),
    all = flattenNodes(nodes),
    node = all.find((n) => n.id === selected) || nodes[0],
    [message, setMessage] = useState("");
  const update = (patch: Partial<WorkflowNode>) =>
    setConfig({
      ...config,
      state_tree: changeNode(nodes, node.id, (n) => ({ ...n, ...patch })),
    });
  const unique = (prefix: string) => {
    let i = 1;
    while (
      all.some(
        (n) => n.id === `${prefix}_${i}` || n.id.startsWith(`${prefix}_${i}_`),
      ) ||
      config.transitions.some((t) => t.id.startsWith(`${prefix}_${i}_`))
    )
      i++;
    return `${prefix}_${i}`;
  };
  const convert = (kind: "compound" | "parallel") => {
    if (node.children?.length) {
      setMessage("This state already has children. Edit its structure below.");
      return;
    }
    const id = node.id;
    if (kind === "compound") {
      const child = {
        id: unique("working"),
        label: "Working",
        kind: "atomic" as const,
      };
      update({ kind, children: [child], initial: child.id });
      onSelect(child.id);
    } else {
      const stamp = unique("approval");
      const regions: WorkflowNode[] = [1, 2].map((i) => ({
        id: `${stamp}_region_${i}`,
        label: i === 1 ? "Facilities approval" : "Safety approval",
        kind: "compound",
        initial: `${stamp}_pending_${i}`,
        children: [
          {
            id: `${stamp}_pending_${i}`,
            label: "Awaiting approval",
            kind: "atomic",
          },
          { id: `${stamp}_done_${i}`, label: "Approved", kind: "final" },
        ],
      }));
      const outgoing = config.transitions.find(
        (t) => t.source === id && t.target !== "Draft",
      );
      const transitions = config.transitions.map((t) =>
        t === outgoing
          ? { ...t, event: "completion" as const, require_note: false }
          : t,
      );
      regions.forEach((region, i) =>
        transitions.push({
          id: `${stamp}_approve_${i + 1}`,
          label: `Approve ${i === 0 ? "facilities" : "safety"}`,
          source: region.children![0].id,
          target: region.children![1].id,
          roles: ["supervisor", "administrator"],
          require_note: false,
        }),
      );
      if (!outgoing)
        transitions.push({
          id: `${stamp}_complete`,
          label: "Complete parallel review",
          source: id,
          target: "Closed",
          roles: ["supervisor", "administrator"],
          require_note: false,
          event: "completion",
        });
      setConfig({
        ...config,
        state_tree: changeNode(nodes, id, (n) => ({
          ...n,
          kind,
          children: regions,
          initial: undefined,
        })),
        transitions,
      });
    }
  };
  return (
    <div className="j5-hierarchy-editor">
      <h4>Hierarchy and state effects</h4>
      <fieldset disabled={!editable}>
        <label>
          Hierarchy node
          <select
            aria-label="Hierarchy node"
            value={node.id}
            onChange={(e) => onSelect(e.target.value)}
          >
            {all.map((n) => (
              <option value={n.id} key={n.id}>
                {n.label} · {n.id}
              </option>
            ))}
          </select>
        </label>
        <label>
          Display label
          <input
            value={node.label}
            onChange={(e) => update({ label: e.target.value })}
          />
        </label>
        <div className="j5-tools">
          <button
            disabled={
              !!node.children?.length ||
              node.id === "Closed" ||
              node.kind === "final"
            }
            onClick={() => convert("compound")}
          >
            Make compound
          </button>
          <button
            disabled={
              !!node.children?.length ||
              node.id === "Closed" ||
              node.kind === "final"
            }
            onClick={() => convert("parallel")}
          >
            Make parallel
          </button>
        </div>
        {node.kind === "compound" && (
          <>
            <label>
              Initial child
              <select
                aria-label="Initial child"
                value={node.initial || node.children?.[0]?.id}
                onChange={(e) => update({ initial: e.target.value })}
              >
                {node.children?.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              onClick={() => {
                const id = unique("state");
                update({
                  children: [
                    ...(node.children || []),
                    { id, label: "New state", kind: "atomic" },
                  ],
                });
                onSelect(id);
              }}
            >
              Add child state
            </button>
            <button
              onClick={() => {
                const id = unique("complete");
                update({
                  children: [
                    ...(node.children || []),
                    { id, label: "Complete", kind: "final" },
                  ],
                });
              }}
            >
              Add completion state
            </button>
          </>
        )}
        {node.kind === "parallel" && (
          <button
            disabled={(node.children?.length || 0) >= 6}
            onClick={() => {
              const id = unique("region"),
                pending = `${id}_pending`,
                done = `${id}_done`;
              setConfig({
                ...config,
                state_tree: changeNode(nodes, node.id, (n) => ({
                  ...n,
                  children: [
                    ...(n.children || []),
                    {
                      id,
                      label: "Additional approval",
                      kind: "compound",
                      initial: pending,
                      children: [
                        {
                          id: pending,
                          label: "Awaiting approval",
                          kind: "atomic",
                        },
                        { id: done, label: "Approved", kind: "final" },
                      ],
                    },
                  ],
                })),
                transitions: [
                  ...config.transitions,
                  {
                    id: `${id}_approve`,
                    label: "Approve additional region",
                    source: pending,
                    target: done,
                    roles: ["supervisor", "administrator"],
                    require_note: false,
                  },
                ],
              });
            }}
          >
            Add parallel region
          </button>
        )}
        {!config.states.includes(node.id) && (
          <button
            onClick={() => {
              const removed = new Set(flattenNodes([node]).map((n) => n.id));
              if (
                config.transitions.some(
                  (t) => removed.has(t.source) || removed.has(t.target),
                )
              ) {
                setMessage(
                  "Reconnect or delete transitions referencing this node before deleting it.",
                );
                return;
              }
              const remove = (ns: WorkflowNode[]): WorkflowNode[] =>
                ns
                  .filter((n) => !removed.has(n.id))
                  .map((n) => ({
                    ...n,
                    children: n.children ? remove(n.children) : undefined,
                  }));
              const metadata = Object.fromEntries(
                Object.entries(config.state_settings || {}).filter(
                  ([id]) => !removed.has(id),
                ),
              );
              setConfig({
                ...config,
                state_tree: remove(nodes),
                state_settings: metadata,
              });
              onSelect("Draft");
            }}
          >
            Delete hierarchy node
          </button>
        )}
        <label className="j5-check">
          <input
            type="checkbox"
            checked={config.state_settings?.[node.id]?.editable || false}
            disabled={node.kind === "final"}
            onChange={(e) =>
              setConfig({
                ...config,
                state_settings: {
                  ...config.state_settings,
                  [node.id]: {
                    ...config.state_settings?.[node.id],
                    editable: e.target.checked,
                  },
                },
              })
            }
          />
          Allow form editing while active
        </label>
        {["compound", "parallel"].includes(node.kind) && (
          <label>
            Re-entry history
            <select
              aria-label="State history"
              value={node.history || "none"}
              onChange={(e) =>
                update({ history: e.target.value as WorkflowNode["history"] })
              }
            >
              <option value="none">Initial child</option>
              <option value="shallow">Resume previous child</option>
              <option value="deep">Resume previous nested states</option>
            </select>
          </label>
        )}
        <Effects
          title="Entry effects"
          effects={node.entry_effects}
          config={config}
          change={(entry_effects) => update({ entry_effects })}
        />
        <Effects
          title="Exit effects"
          effects={node.exit_effects}
          config={config}
          change={(exit_effects) => update({ exit_effects })}
        />
        <p>
          Compound parents share actions across descendants. Parallel regions
          enter together and complete independently. Completion transitions run
          automatically after every region finishes.
        </p>
      </fieldset>
      {message && <p role="status">{message}</p>}
    </div>
  );
}
