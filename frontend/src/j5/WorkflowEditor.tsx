import { useState, useRef, useEffect } from "react";
import {
  Workflow,
  Plus,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Play,
  RefreshCw,
  Trash2,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import type { Definition, Role, Transition } from "../types";
import type { EditorProps } from "./Designer";
import { Rules } from "./Rules";
import { Fields, type Values } from "./Fields";
import { api } from "../api";
import { HierarchyEditor, HierarchyCanvas, Effects } from "./Hierarchy";
import {
  tree,
  flattenNodes,
  initialLeaves,
  sourceActive,
  renameNode,
} from "./workflowUtils";
const roles: Role[] = ["technician", "supervisor", "administrator"];
export function WorkflowEditor({
  config,
  setConfig: rawSetConfig,
  editable,
}: EditorProps) {
  const setConfig = (d: Definition) =>
    rawSetConfig({ ...d, state_tree: d.state_tree ? tree(d) : undefined });
  const allNodes = flattenNodes(tree(config));
  const [selected, setSelected] = useState(config.transitions[0]?.id || ""),
    [state, setState] = useState("Draft"),
    [tab, setTab] = useState("Transition"),
    [zoom, setZoom] = useState(1),
    [sim, setSim] = useState("Draft"),
    [active, setActive] = useState<string[]>([]),
    [hierarchyNode, setHierarchyNode] = useState("Draft"),
    [role, setRole] = useState<Role>("technician"),
    [note, setNote] = useState(""),
    [values, setValues] = useState<Values>({}),
    [evidence, setEvidence] = useState(0),
    [tasks, setTasks] = useState(0),
    [elapsed, setElapsed] = useState(0),
    [simHistory, setSimHistory] = useState<Record<string, string[]>>({}),
    [message, setMessage] = useState(""),
    [pending, setPending] = useState(false),
    [showValues, setShowValues] = useState(false);
  useEffect(() => {
    if (!config.states.includes(state)) setState("Draft");
    if (!config.states.includes(sim)) setSim("Draft");
  }, [config.states, state, sim]);
  const leaves =
    active.length && active.every((id) => allNodes.some((n) => n.id === id))
      ? active
      : initialLeaves(
          tree(config).find((n) => n.id === sim) || tree(config)[0],
        );
  const drag = useRef<{
    name: string;
    x: number;
    y: number;
    startX: number;
    startY: number;
  } | null>(null);
  const t =
    config.transitions.find((t) => t.id === selected) || config.transitions[0];
  const update = (patch: Partial<Transition>) =>
    setConfig({
      ...config,
      transitions: config.transitions.map((x) =>
        x.id === t?.id ? { ...x, ...patch } : x,
      ),
    });
  const pos = (s: string) => {
    const i = config.states.indexOf(s);
    return {
      x: config.state_settings?.[s]?.x ?? 60 + (i % 4) * 230,
      y: config.state_settings?.[s]?.y ?? 100 + Math.floor(i / 4) * 230,
    };
  };
  const settings = config.state_settings?.[state] || {};
  const setStateSettings = (p: typeof settings) =>
    setConfig({
      ...config,
      state_settings: {
        ...config.state_settings,
        [state]: { ...settings, ...p },
      },
    });
  const rename = (name: string) => {
    if (!name.trim() || config.states.includes(name)) return;
    const metadata = { ...config.state_settings };
    metadata[name] = metadata[state] || {};
    delete metadata[state];
    setConfig({
      ...config,
      states: config.states.map((s) => (s === state ? name : s)),
      state_tree: config.state_tree
        ? renameNode(config.state_tree, state, name)
        : undefined,
      state_settings: metadata,
      transitions: config.transitions.map((t) => ({
        ...t,
        source: t.source === state ? name : t.source,
        target: t.target === state ? name : t.target,
      })),
    });
    setState(name);
    if (sim === state) setSim(name);
  };
  const reorder = (direction: number) => {
    const i = config.states.indexOf(state),
      j = i + direction;
    if (
      i <= 0 ||
      i >= config.states.length - 1 ||
      j <= 0 ||
      j >= config.states.length - 1
    )
      return;
    const states = [...config.states];
    [states[i], states[j]] = [states[j], states[i]];
    setConfig({ ...config, states });
  };
  const simulate = async (tr: Transition) => {
    setPending(true);
    try {
      const result = await api<{
        state: string;
        message: string;
        active_states: string[];
        values: Values;
        open_tasks: number;
        history: Record<string, string[]>;
      }>("/workflow/simulate", "POST", {
        definition: config,
        transition_id: tr.id,
        state: sim,
        active_states: leaves,
        role,
        values,
        note,
        evidence_count: evidence,
        open_tasks: tasks,
        elapsed_seconds: elapsed,
        history: simHistory,
      });
      setSim(result.state);
      setSimHistory(result.history);
      setElapsed(0);
      setActive(result.active_states);
      setTasks(result.open_tasks);
      setValues(result.values);
      setMessage(result.message);
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setPending(false);
    }
  };
  const width = Math.max(1020, ...config.states.map((s) => pos(s).x + 210)),
    height = Math.max(360, ...config.states.map((s) => pos(s).y + 180));
  return (
    <section className="j5-workbench">
      <div className="j5-window-title">
        <Workflow size={14} />
        <strong>Workflow Editor</strong>
        <span>{config.name}</span>
        <a
          href="/j5-references/?category=Workflow"
          target="_blank"
          rel="noreferrer"
        >
          Source references ↗
        </a>
      </div>
      <div className="j5-tools">
        <button
          disabled={!editable || config.states.length >= 20}
          onClick={() => {
            let n = config.states.length;
            while (config.states.includes(`State ${n}`)) n++;
            const name = `State ${n}`;
            setConfig({
              ...config,
              states: [...config.states.slice(0, -1), name, "Closed"],
            });
            setState(name);
            setTab("State");
            setMessage(
              "State added. Connect incoming and outgoing transitions before publishing.",
            );
          }}
        >
          <Plus /> Add state
        </button>
        <button
          disabled={!editable}
          onClick={() => {
            let n = config.transitions.length + 1;
            while (config.transitions.some((t) => t.id === `transition_${n}`))
              n++;
            const tr: Transition = {
              id: `transition_${n}`,
              label: "New transition",
              source: state === "Closed" ? "Draft" : state,
              target:
                state === "Closed"
                  ? "Closed"
                  : config.states.find((s) => s !== state) || "Closed",
              roles: ["supervisor", "administrator"],
              require_note: false,
              guards: [],
            };
            setConfig({ ...config, transitions: [...config.transitions, tr] });
            setSelected(tr.id);
            setTab("Transition");
          }}
        >
          <Plus /> Add transition
        </button>
        <i />
        <button
          aria-label="Zoom out"
          onClick={() => setZoom(Math.max(0.4, zoom - 0.1))}
        >
          <ZoomOut />
        </button>
        <span>{Math.round(zoom * 100)}%</span>
        <button
          aria-label="Zoom in"
          onClick={() => setZoom(Math.min(1.6, zoom + 0.1))}
        >
          <ZoomIn />
        </button>
        <button onClick={() => setZoom(1)}>
          <Maximize2 />
          Actual size
        </button>
        <button
          disabled={!editable}
          onClick={() =>
            setConfig({
              ...config,
              state_settings: Object.fromEntries(
                config.states.map((s, i) => [
                  s,
                  {
                    ...config.state_settings?.[s],
                    x: 60 + (i % 4) * 230,
                    y: 100 + Math.floor(i / 4) * 230,
                  },
                ]),
              ),
            })
          }
        >
          Arrange states
        </button>
      </div>
      {!editable && (
        <div className="j5-notice">
          Read-only configuration. Simulation is available for every demo
          account.
        </div>
      )}
      <div className="j5-workflow-layout">
        <div className="j5-workflow-body">
          {config.state_tree?.some((n) => n.children?.length) ? (
            <HierarchyCanvas
              config={config}
              active={leaves}
              selected={hierarchyNode}
              select={(id) => {
                setHierarchyNode(id);
                setTab("Hierarchy");
              }}
            />
          ) : (
            <div className="j5-graph-scroll">
              <div
                className="j5-graph"
                style={{ width: width * zoom, height: height * zoom }}
              >
                <div
                  style={{
                    width,
                    height,
                    transform: `scale(${zoom})`,
                    transformOrigin: "top left",
                    position: "relative",
                  }}
                >
                  <svg
                    width={width}
                    height={height}
                    className="j5-connectors"
                    aria-label="Workflow transitions"
                  >
                    <defs>
                      <marker
                        id="j5-arrow"
                        viewBox="0 0 10 10"
                        refX="9"
                        refY="5"
                        markerWidth="7"
                        markerHeight="7"
                        orient="auto-start-reverse"
                      >
                        <path d="M0 0L10 5L0 10Z" fill="#687985" />
                      </marker>
                    </defs>
                    {config.transitions.map((tr, i) => {
                      const a = pos(tr.source),
                        b = pos(tr.target);
                      const forward = b.x > a.x;
                      const x1 = a.x + 80,
                        y1 = a.y + (forward ? 70 : 0),
                        x2 = b.x + 80,
                        y2 = b.y + (forward ? 70 : 0),
                        bend = (forward ? 1 : -1) * (70 + (i % 3) * 22);
                      const path = `M${x1} ${y1} C${x1} ${y1 + bend},${x2} ${y2 + bend},${x2} ${y2}`;
                      return (
                        <g
                          key={tr.id}
                          className={
                            t?.id === tr.id && tab === "Transition"
                              ? "selected"
                              : ""
                          }
                          onClick={() => {
                            setSelected(tr.id);
                            setTab("Transition");
                          }}
                        >
                          <path
                            d={path}
                            fill="none"
                            markerEnd="url(#j5-arrow)"
                          />
                          <text
                            x={(x1 + x2) / 2}
                            y={(y1 + y2) / 2 + bend * 0.75 - 6}
                            textAnchor="middle"
                          >
                            {tr.label}
                          </text>
                        </g>
                      );
                    })}
                  </svg>
                  {config.states.map((s) => (
                    <button
                      key={s}
                      className={
                        "j5-state " +
                        (s === sim ? "sim-current " : "") +
                        (s === state && tab === "State" ? "selected " : "") +
                        (s === "Closed" ? "final" : "")
                      }
                      style={{ left: pos(s).x, top: pos(s).y }}
                      onClick={() => {
                        setState(s);
                        setTab("State");
                      }}
                      onPointerDown={(e) => {
                        if (!editable) return;
                        e.currentTarget.setPointerCapture(e.pointerId);
                        drag.current = {
                          name: s,
                          ...pos(s),
                          startX: e.clientX,
                          startY: e.clientY,
                        };
                      }}
                      onPointerMove={(e) => {
                        const d = drag.current;
                        if (!d || d.name !== s) return;
                        setConfig({
                          ...config,
                          state_settings: {
                            ...config.state_settings,
                            [s]: {
                              ...config.state_settings?.[s],
                              x: Math.min(
                                5000,
                                Math.max(
                                  0,
                                  Math.round(
                                    d.x + (e.clientX - d.startX) / zoom,
                                  ),
                                ),
                              ),
                              y: Math.min(
                                5000,
                                Math.max(
                                  0,
                                  Math.round(
                                    d.y + (e.clientY - d.startY) / zoom,
                                  ),
                                ),
                              ),
                            },
                          },
                        });
                      }}
                      onPointerUp={() => (drag.current = null)}
                      onPointerCancel={() => (drag.current = null)}
                    >
                      <small>
                        {s === "Draft"
                          ? "INITIAL STATE"
                          : s === "Closed"
                            ? "FINAL STATE"
                            : "STATE"}
                      </small>
                      <strong>{s}</strong>
                      <span>
                        {s === "Closed"
                          ? "Read only"
                          : (config.state_settings?.[s]?.editable ??
                              s === "Draft")
                            ? "Editing allowed"
                            : "Editing locked"}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
          <div className="j5-transition-list">
            <div className="j5-pane-caption">Transitions</div>
            {config.transitions.map((tr) => (
              <button
                key={tr.id}
                className={selected === tr.id ? "active" : ""}
                onClick={() => {
                  setSelected(tr.id);
                  setTab("Transition");
                }}
              >
                <span>{tr.label}</span>
                <small>
                  {tr.source} → {tr.target}
                </small>
              </button>
            ))}
          </div>
          <section className="j5-simulation">
            <div className="j5-pane-caption">
              <Play size={13} /> Event simulation <strong>{sim}</strong>
              <button
                onClick={() => {
                  setSim("Draft");
                  setActive([]);
                  setSimHistory({});
                  setElapsed(0);
                  setNote("");
                  setMessage("Simulation reset. No records were changed.");
                }}
              >
                {" "}
                <RefreshCw size={12} />
                Reset
              </button>
            </div>
            <div className="j5-active-branches">
              <strong>Active branches</strong>
              {leaves.map((s) => (
                <span key={s}>
                  {allNodes.find((n) => n.id === s)?.label} · {s}
                </span>
              ))}
            </div>
            <div className="j5-sim-controls">
              <label>
                Acting role
                <select
                  aria-label="Acting role"
                  value={role}
                  onChange={(e) => setRole(e.target.value as Role)}
                >
                  {roles.map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
              </label>
              <label>
                Comment
                <input value={note} onChange={(e) => setNote(e.target.value)} />
              </label>
              <label>
                Evidence count
                <input
                  type="number"
                  min="0"
                  value={evidence}
                  onChange={(e) =>
                    setEvidence(Math.max(0, Number(e.target.value)))
                  }
                />
              </label>
              <label>
                Open tasks
                <input
                  type="number"
                  min="0"
                  value={tasks}
                  onChange={(e) =>
                    setTasks(Math.max(0, Number(e.target.value)))
                  }
                />
              </label>
            </div>
            <label>
              Simulated elapsed seconds
              <input
                aria-label="Simulated elapsed seconds"
                type="number"
                min={0}
                value={elapsed}
                onChange={(e) => setElapsed(Number(e.target.value))}
              />
            </label>
            <button onClick={() => setShowValues(!showValues)}>
              {showValues ? "Hide" : "Edit"} simulation field values
            </button>
            {showValues && (
              <Fields
                definition={config}
                values={values}
                setValues={setValues}
              />
            )}
            <div className="j5-sim-actions">
              {config.transitions
                .filter(
                  (tr) =>
                    tr.event !== "completion" &&
                    sourceActive(config, tr.source, leaves),
                )
                .map((tr) => (
                  <button
                    key={tr.id}
                    disabled={pending}
                    onClick={() => simulate(tr)}
                  >
                    {tr.label} →
                  </button>
                ))}
              {sim === "Closed" && <strong>Final state reached</strong>}
            </div>
            <p>
              Runs the same server checks as live records. Field values,
              evidence counts and task counts are simulation inputs.
            </p>
          </section>
        </div>
        <aside className="j5-properties">
          <div className="j5-property-tabs">
            {["Transition", "State", "Hierarchy"].map((x) => (
              <button
                key={x}
                className={tab === x ? "active" : ""}
                onClick={() => setTab(x)}
              >
                {x}
              </button>
            ))}
          </div>
          {tab === "Hierarchy" && (
            <HierarchyEditor
              config={config}
              setConfig={setConfig}
              editable={editable}
              selected={hierarchyNode}
              onSelect={setHierarchyNode}
            />
          )}
          <fieldset disabled={!editable}>
            {tab === "Transition" && t && (
              <>
                <h4>Transition properties</h4>
                <label>
                  Action label
                  <input
                    value={t.label}
                    onChange={(e) => update({ label: e.target.value })}
                  />
                </label>
                <label>
                  Transition ID
                  <input
                    value={t.id}
                    onChange={(e) => {
                      const id = e.target.value;
                      update({ id });
                      setSelected(id);
                    }}
                  />
                </label>
                <label>
                  Source
                  <select
                    aria-label="Source"
                    value={t.source}
                    onChange={(e) => update({ source: e.target.value })}
                  >
                    {allNodes
                      .filter((n) => n.kind !== "final")
                      .map((n) => (
                        <option key={n.id} value={n.id}>
                          {n.label} · {n.id}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Target
                  <select
                    aria-label="Target"
                    value={t.target}
                    onChange={(e) => update({ target: e.target.value })}
                  >
                    {allNodes.map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.label} · {n.id}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Trigger
                  <select
                    aria-label="Transition trigger"
                    value={t.event || "manual"}
                    onChange={(e) =>
                      update({
                        event: e.target.value as
                          "manual" | "completion" | "timer",
                        after_seconds:
                          e.target.value === "timer"
                            ? t.after_seconds || 60
                            : undefined,
                      })
                    }
                  >
                    <option value="manual">User action</option>
                    <option value="timer">Timer deadline</option>
                    <option value="completion">Automatic completion</option>
                  </select>
                </label>
                <h4>Permissions</h4>
                {roles.map((r) => (
                  <label className="j5-check" key={r}>
                    <input
                      type="checkbox"
                      checked={t.roles.includes(r)}
                      onChange={(e) =>
                        update({
                          roles: e.target.checked
                            ? [...t.roles, r]
                            : t.roles.filter((x) => x !== r),
                        })
                      }
                    />
                    {r}
                  </label>
                ))}
                {t.event === "timer" && (
                  <label>
                    Delay in seconds
                    <input
                      aria-label="Timer delay seconds"
                      type="number"
                      min={1}
                      max={31536000}
                      value={t.after_seconds || 60}
                      onChange={(e) =>
                        update({ after_seconds: Number(e.target.value) })
                      }
                    />
                  </label>
                )}
                <label className="j5-check">
                  <input
                    type="checkbox"
                    checked={t.use_history || false}
                    onChange={(e) => update({ use_history: e.target.checked })}
                  />
                  Resume target history
                </label>
                <h4>User prompt</h4>
                <label>
                  Prompt text
                  <input
                    value={t.prompt || ""}
                    onChange={(e) => update({ prompt: e.target.value })}
                  />
                </label>
                <label className="j5-check">
                  <input
                    type="checkbox"
                    checked={t.require_note}
                    onChange={(e) => update({ require_note: e.target.checked })}
                  />
                  Require transition comment
                </label>
                <Rules
                  title="Guard conditions"
                  fields={config.fields}
                  rules={t.guards}
                  change={(guards) => update({ guards })}
                />
                <label>
                  Guard formula
                  <input
                    aria-label="Guard formula"
                    placeholder="=temperature &lt;= 32"
                    value={t.guard_formula || ""}
                    onChange={(e) =>
                      update({ guard_formula: e.target.value || undefined })
                    }
                  />
                </label>
                <p>
                  All guard conditions must pass. A guard formula must return
                  TRUE or FALSE.
                </p>
                <Effects
                  title="Transition effects"
                  effects={t.effects}
                  config={config}
                  change={(effects) => update({ effects })}
                />
                <h4>Validation & effects</h4>
                {(
                  [
                    [
                      "validate_required",
                      "Validate required fields",
                      t.target === "Submitted",
                    ],
                    [
                      "require_evidence",
                      "Require photographic evidence",
                      false,
                    ],
                    [
                      "require_no_tasks",
                      "Require all corrective tasks complete",
                      t.target === "Closed",
                    ],
                    [
                      "create_exception_task",
                      "Create corrective task for exceptions",
                      t.target === "Submitted",
                    ],
                  ] as const
                ).map(([key, label, fallback]) => (
                  <label className="j5-check" key={key}>
                    <input
                      type="checkbox"
                      disabled={
                        key === "require_no_tasks" && t.target === "Closed"
                      }
                      checked={
                        key === "require_no_tasks" && t.target === "Closed"
                          ? true
                          : (t[key] ?? fallback)
                      }
                      onChange={(e) => update({ [key]: e.target.checked })}
                    />
                    {label}
                  </label>
                ))}
                <p>
                  Every transition records the actor, time, source, target and
                  comment. Closed always requires completed tasks.
                </p>
                <button
                  disabled={config.transitions.length <= 1}
                  onClick={() => {
                    setConfig({
                      ...config,
                      transitions: config.transitions.filter((x) => x !== t),
                    });
                    setSelected(
                      config.transitions.find((x) => x !== t)?.id || "",
                    );
                  }}
                >
                  <Trash2 size={13} />
                  Delete transition
                </button>
              </>
            )}
            {tab === "State" && (
              <>
                <h4>State properties</h4>
                <button
                  onClick={() => {
                    setHierarchyNode(state);
                    setTab("Hierarchy");
                  }}
                >
                  Configure compound / parallel states
                </button>
                <label>
                  Selected state
                  <select
                    aria-label="Selected state"
                    value={state}
                    onChange={(e) => setState(e.target.value)}
                  >
                    {config.states.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </label>
                <label>
                  State name
                  <input
                    key={state}
                    defaultValue={state}
                    disabled={["Draft", "Closed"].includes(state)}
                    onBlur={(e) => rename(e.target.value)}
                  />
                </label>
                <label className="j5-check">
                  <input
                    type="checkbox"
                    disabled={state === "Closed"}
                    checked={
                      state === "Closed"
                        ? false
                        : (settings.editable ?? state === "Draft")
                    }
                    onChange={(e) =>
                      setStateSettings({ editable: e.target.checked })
                    }
                  />
                  Allow form editing in this state
                </label>
                <div className="j5-tools">
                  <button
                    aria-label="Move state earlier"
                    onClick={() => reorder(-1)}
                    disabled={
                      config.states.indexOf(state) <= 1 || state === "Closed"
                    }
                  >
                    <ArrowUp />
                  </button>
                  <button
                    aria-label="Move state later"
                    onClick={() => reorder(1)}
                    disabled={
                      state === "Draft" ||
                      config.states.indexOf(state) >= config.states.length - 2
                    }
                  >
                    <ArrowDown />
                  </button>
                </div>
                <p>
                  Drag states to arrange the diagram. The order above also
                  controls the record lifecycle display. Draft is the initial
                  state; Closed is the final state.
                </p>
                <button
                  disabled={["Draft", "Closed"].includes(state)}
                  onClick={() => {
                    if (
                      config.transitions.some(
                        (t) => t.source === state || t.target === state,
                      )
                    ) {
                      setMessage(
                        "Delete or reconnect transitions using this state before removing it.",
                      );
                      return;
                    }
                    const metadata = { ...config.state_settings };
                    delete metadata[state];
                    setConfig({
                      ...config,
                      states: config.states.filter((s) => s !== state),
                      state_settings: metadata,
                    });
                    setState("Draft");
                  }}
                >
                  <Trash2 size={13} />
                  Delete state
                </button>
              </>
            )}
          </fieldset>
        </aside>
      </div>
      <div className="j5-status" role="status">
        {message ||
          `${config.states.length} states · ${config.transitions.length} transitions · Drag states, select transitions to configure.`}
      </div>
    </section>
  );
}
