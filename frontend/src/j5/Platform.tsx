import { Governance } from "./Governance";
import { useEffect, useState } from "react";
import { api } from "../api";
import type { Bootstrap, Definition } from "../types";
type Project = {
  id: number;
  name: string;
  files: Record<string, string>;
  revision: number;
  base_version: number;
};
type Item = {
  id: number;
  name: string;
  definition: Definition;
  scope: string;
  status: string;
  revision: number;
  base_version: number;
  author: string;
  submitted_by: string;
  reviewed_by: string;
  published_version: number | null;
};
type History = {
  id: number;
  item_id: number;
  actor: string;
  action: string;
  detail: Record<string, unknown>;
  created_at: string;
};
export function Platform({
  data,
  config,
  base,
  loadDefinition,
  refresh,
  initialTab = "Workspace",
}: {
  data: Bootstrap;
  config: Definition;
  base: number;
  loadDefinition: (d: Definition) => void;
  refresh: () => Promise<void>;
  initialTab?: string;
}) {
  const [tab, setTab] = useState(initialTab),
    [projects, setProjects] = useState<Project[]>([]),
    [project, setProject] = useState<Project | null>(null),
    [files, setFiles] = useState<Record<string, string>>({}),
    [path, setPath] = useState("forms/inspection.json"),
    [name, setName] = useState("Campus operations project"),
    [items, setItems] = useState<Item[]>([]),
    [history, setHistory] = useState<History[]>([]),
    [bindings, setBindings] = useState<{ scope: string; config_id: number }[]>(
      [],
    ),
    [selected, setSelected] = useState<Item | null>(null),
    [scope, setScope] = useState("*"),
    [note, setNote] = useState(""),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [inventory, setInventory] = useState<
      { path: string; size: number; sha256: string }[]
    >([]),
    [response, setResponse] = useState(""),
    [execution, setExecution] = useState<{
      exit_code: number;
      timed_out: boolean;
      stdout: string;
      stderr: string;
      trace: {
        line: number;
        function: string;
        locals: Record<string, string>;
      }[];
    } | null>(null),
    [traceStep, setTraceStep] = useState(0),
    [apiPath, setApiPath] = useState(
      "/restserver/30/industraform/logbook-query-v2/campus_inspections",
    ),
    [queryOptions, setQueryOptions] = useState("top=25"),
    [nextPage, setNextPage] = useState<string | null>(null),
    [attributes, setAttributes] = useState(
      "EntryNumber,ResponsiblePerson,Priority,State,temperature",
    ),
    [apiArea, setApiArea] = useState("");
  const admin = data.user.role === "administrator",
    reviewer = data.user.role !== "technician";
  const reload = async () => {
    const result = await api<{
      items: Item[];
      history: History[];
      bindings: { scope: string; config_id: number }[];
    }>("/config-items");
    setItems(result.items);
    setSelected((current) =>
      current
        ? result.items.find((item) => item.id === current.id) || null
        : null,
    );
    setHistory(result.history);
    setBindings(result.bindings);
    if (admin) setProjects(await api<Project[]>("/workspace"));
  };
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void run(reload);
  }, [data.user.username]);
  const workspaceBody = () => ({
    name,
    files,
    revision: project?.revision || 0,
    base_version: project?.base_version || base,
  });
  const scaffold = async () => {
    const result = await api<{ files: Record<string, string> }>(
      "/workspace/scaffold",
      "POST",
      { definition: config, name },
    );
    setFiles(result.files);
    setPath("forms/inspection.json");
    setProject(null);
    setMessage(
      "Working definition copied into a new project. Edit files, validate, then save.",
    );
  };
  const choose = (p: Project) => {
    setProject(p);
    setFiles(p.files);
    setName(p.name);
    setPath(
      Object.keys(p.files).includes("forms/inspection.json")
        ? "forms/inspection.json"
        : Object.keys(p.files)[0],
    );
    setMessage("Saved project loaded.");
  };
  const save = async () => {
    const p = await api<Project>(
      project ? `/workspace/${project.id}` : "/workspace",
      project ? "PUT" : "POST",
      workspaceBody(),
    );
    setProject(p);
    await reload();
    setMessage(`Project saved · revision ${p.revision}.`);
  };
  const validate = async (load = false) => {
    const result = await api<{ definition: Definition; message: string }>(
      "/workspace/validate",
      "POST",
      workspaceBody(),
    );
    setMessage(result.message);
    if (load) loadDefinition(result.definition);
  };
  const exportWorking = async () => {
    const r = await fetch("/api/packages/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ definition: config, name }),
    });
    if (!r.ok) throw new Error((await r.json()).detail);
    const url = URL.createObjectURL(await r.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = "campus-project.zip";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage(
      "Working definition exported as a checksummed local project package.",
    );
  };
  const act = async (action: string) => {
    if (!selected) return;
    const result = await api<Item>(
      `/config-items/${selected.id}/${action}`,
      "POST",
      { revision: selected.revision, note },
    );
    setSelected(result);
    await reload();
    await refresh();
    setMessage(`${result.name}: ${result.status}.`);
  };
  const itemPayload = () => ({
    name,
    definition: config,
    scope,
    base_version: base,
    revision: selected?.revision || 0,
  });
  const selectedHistory = history.filter((h) => h.item_id === selected?.id);
  const changes = selected
    ? Object.keys({ ...data.config.definition, ...selected.definition }).filter(
        (k) =>
          JSON.stringify(data.config.definition[k as keyof Definition]) !==
          JSON.stringify(selected.definition[k as keyof Definition]),
      )
    : [];
  return (
    <section className="j5-platform">
      <div className="j5-editor-tabs">
        {[
          "Workspace",
          "Controlled releases",
          "Packages & API",
          "Governance",
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
      <div className="j5-local-notice">
        Local development tools · independent package format and release
        workflow. Native J5 execution and IDE compatibility are not verified.
      </div>
      {error && (
        <div role="alert" className="error">
          {error}
        </div>
      )}
      {message && (
        <div role="status" className="j5-platform-message">
          {message}
        </div>
      )}
      {tab === "Governance" && <Governance data={data} />}
      {tab === "Workspace" && (
        <>
          {!admin ? (
            <p>Sign in as Alex Morgan to edit developer projects.</p>
          ) : (
            <>
              <div className="j5-toolbar">
                <label>
                  Project name
                  <input
                    aria-label="Project name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
                <button disabled={busy} onClick={() => run(scaffold)}>
                  New from working definition
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      const response = await fetch(
                        "/examples/property-handover.json",
                      );
                      if (!response.ok)
                        throw new Error("Example project could not be loaded.");
                      const definition = await response.json();
                      const result = await api<{
                        files: Record<string, string>;
                      }>("/workspace/scaffold", "POST", {
                        definition,
                        name: definition.name,
                      });
                      setFiles(result.files);
                      setName(definition.name);
                      setProject(null);
                      setPath("forms/inspection.json");
                      setMessage(
                        "Property handover example loaded. It includes spreadsheet formulas, a compound preparation state and parallel facilities/safety approvals.",
                      );
                    })
                  }
                >
                  Load property handover example
                </button>
                <select
                  aria-label="Saved developer project"
                  value={project?.id || ""}
                  onChange={(e) => {
                    const p = projects.find(
                      (p) => p.id === Number(e.target.value),
                    );
                    if (p) choose(p);
                  }}
                >
                  <option value="">Saved projects…</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} · r{p.revision}
                    </option>
                  ))}
                </select>
                <button
                  disabled={busy || !Object.keys(files).length}
                  onClick={() => run(save)}
                >
                  Save project
                </button>
                <button
                  disabled={busy || !Object.keys(files).length}
                  onClick={() => run(() => validate())}
                >
                  Validate project
                </button>
                <button
                  disabled={busy || !Object.keys(files).length}
                  onClick={() => run(() => validate(true))}
                >
                  Load into designer
                </button>
                <button
                  disabled={busy || !path.endsWith(".py")}
                  onClick={() =>
                    run(async () => {
                      const result = await api<NonNullable<typeof execution>>(
                        "/workspace/run",
                        "POST",
                        { source: files[path], debug: false },
                      );
                      setExecution(result);
                      setTraceStep(0);
                      setMessage(
                        result.timed_out
                          ? "Execution stopped at the time limit."
                          : `Python exited with code ${result.exit_code}.`,
                      );
                    })
                  }
                >
                  Run Python
                </button>
                <button
                  disabled={busy || !path.endsWith(".py")}
                  onClick={() =>
                    run(async () => {
                      setExecution(
                        await api<NonNullable<typeof execution>>(
                          "/workspace/run",
                          "POST",
                          { source: files[path], debug: true },
                        ),
                      );
                      setTraceStep(0);
                    })
                  }
                >
                  Trace Python
                </button>
                {project && (
                  <a
                    className="button"
                    href={`/api/workspace/${project.id}/package`}
                  >
                    Download saved ZIP
                  </a>
                )}
              </div>
              {execution && (
                <div className="j5-execution">
                  <h3>
                    Execution result · exit {execution.exit_code}
                    {execution.timed_out ? " · timed out" : ""}
                  </h3>
                  <pre aria-label="Python stdout">
                    {execution.stdout || "(no output)"}
                  </pre>
                  {execution.stderr && (
                    <pre className="red" aria-label="Python stderr">
                      {execution.stderr}
                    </pre>
                  )}
                  {execution.trace.length > 0 && (
                    <>
                      <label>
                        Trace step
                        <input
                          aria-label="Trace step"
                          type="range"
                          min={0}
                          max={execution.trace.length - 1}
                          value={traceStep}
                          onChange={(e) => setTraceStep(Number(e.target.value))}
                        />
                      </label>
                      <p>
                        Line {execution.trace[traceStep].line} ·{" "}
                        {execution.trace[traceStep].function}
                      </p>
                      <pre>
                        {JSON.stringify(
                          execution.trace[traceStep].locals,
                          null,
                          2,
                        )}
                      </pre>
                    </>
                  )}
                </div>
              )}
              <div className="j5-workspace">
                <aside>
                  <h3>Project Explorer</h3>
                  {Object.keys(files).map((p) => (
                    <button
                      className={path === p ? "active" : ""}
                      key={p}
                      onClick={() => setPath(p)}
                    >
                      {p}
                    </button>
                  ))}
                  {!Object.keys(files).length && (
                    <p>
                      Create a project from the working definition, or import a
                      local ZIP in Packages & API.
                    </p>
                  )}
                  <small>
                    JSON files define the form and statechart. Python files run
                    in the local execution container. Trace mode records line
                    steps and local variables with a five-second limit.
                  </small>
                </aside>
                <div className="j5-code-pane">
                  <header>
                    {path}
                    {project && (
                      <span>
                        revision {project.revision} · base v
                        {project.base_version}
                      </span>
                    )}
                  </header>
                  <textarea
                    aria-label="Project source"
                    spellCheck={false}
                    disabled={!(path in files)}
                    value={files[path] || ""}
                    onChange={(e) =>
                      setFiles({ ...files, [path]: e.target.value })
                    }
                  />
                  <footer>
                    UTF-8 ·{" "}
                    {path.endsWith(".json")
                      ? "JSON"
                      : path.endsWith(".py")
                        ? "Python"
                        : "Text"}{" "}
                    · semantic validation required before saving
                  </footer>
                </div>
              </div>
            </>
          )}
        </>
      )}
      {tab === "Controlled releases" && (
        <>
          <div className="j5-toolbar">
            <label>
              Release name
              <input
                aria-label="Release name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>
              Scope
              <select
                aria-label="Release scope"
                value={scope}
                onChange={(e) => setScope(e.target.value)}
              >
                <option value="*">All areas · global default</option>
                {data.buildings.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              disabled={!admin || busy}
              onClick={() =>
                run(async () => {
                  const item = await api<Item>(
                    "/config-items",
                    "POST",
                    itemPayload(),
                  );
                  setSelected(item);
                  await reload();
                  setMessage("Draft created from the working definition.");
                })
              }
            >
              Create controlled draft
            </button>
            <button disabled={busy} onClick={() => run(reload)}>
              Refresh releases
            </button>
          </div>
          <div className="j5-release-layout">
            <aside>
              <h3>Configuration items</h3>
              {items.map((item) => (
                <button
                  key={item.id}
                  className={selected?.id === item.id ? "active" : ""}
                  onClick={() => {
                    setSelected(item);
                    setName(item.name);
                    setScope(item.scope);
                    setNote("");
                  }}
                >
                  <strong>{item.name}</strong>
                  <small>
                    {item.status} · r{item.revision} ·{" "}
                    {item.scope === "*" ? "Global" : item.scope}
                  </small>
                </button>
              ))}
              {!items.length && <p>No controlled releases yet.</p>}
              <h3>Area overrides</h3>
              {bindings.map((b) => (
                <p key={b.scope}>
                  {data.buildings.find((x) => x.id === b.scope)?.name ||
                    b.scope}{" "}
                  → v{b.config_id}
                </p>
              ))}
              <small>
                New inspections use their area's published override, falling
                back to the global version. Existing inspections retain their
                version.
              </small>
            </aside>
            <div className="j5-release-detail">
              {selected ? (
                <>
                  <h2>{selected.name}</h2>
                  <p>
                    {selected.status} · revision {selected.revision} · base v
                    {selected.base_version}
                    {selected.published_version
                      ? ` · published v${selected.published_version}`
                      : ""}
                  </p>
                  <p>
                    Submitted by {selected.submitted_by || "—"} · reviewed by{" "}
                    {selected.reviewed_by || "—"}
                  </p>
                  <div className="j5-tools">
                    <button onClick={() => loadDefinition(selected.definition)}>
                      Load release into designer
                    </button>
                    {selected.status === "Draft" && admin && (
                      <>
                        <button
                          disabled={busy}
                          onClick={() =>
                            run(async () => {
                              const item = await api<Item>(
                                `/config-items/${selected.id}`,
                                "PUT",
                                itemPayload(),
                              );
                              setSelected(item);
                              await reload();
                              setMessage(
                                "Draft replaced with the working definition.",
                              );
                            })
                          }
                        >
                          Update from working definition
                        </button>
                        <button
                          disabled={busy}
                          onClick={() => run(() => act("submit"))}
                        >
                          Submit for review
                        </button>
                      </>
                    )}
                    {selected.status === "In Review" && reviewer && (
                      <>
                        <button
                          disabled={
                            busy || selected.submitted_by === data.user.name
                          }
                          onClick={() => run(() => act("approve"))}
                        >
                          Approve release
                        </button>
                        <button
                          disabled={
                            busy || selected.submitted_by === data.user.name
                          }
                          onClick={() => run(() => act("reject"))}
                        >
                          Return to draft
                        </button>
                      </>
                    )}
                    {selected.status === "Approved" && admin && (
                      <button
                        disabled={busy}
                        onClick={() => run(() => act("publish"))}
                      >
                        Publish approved release
                      </button>
                    )}
                  </div>
                  <label>
                    Review comment
                    <textarea
                      aria-label="Review comment"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                    />
                  </label>
                  {selected.status === "In Review" &&
                    selected.submitted_by === data.user.name && (
                      <p>
                        A different person must review this change. James Wilson
                        can approve it.
                      </p>
                    )}
                  <h3>Changes against current global version</h3>
                  {changes.length ? (
                    changes.map((k) => (
                      <details key={k}>
                        <summary>{k}</summary>
                        <div className="j5-diff">
                          <div>
                            <h4>Global v{data.config.id}</h4>
                            <pre>
                              {JSON.stringify(
                                data.config.definition[k as keyof Definition],
                                null,
                                2,
                              ) || "(absent)"}
                            </pre>
                          </div>
                          <div>
                            <h4>Proposed</h4>
                            <pre>
                              {JSON.stringify(
                                selected.definition[k as keyof Definition],
                                null,
                                2,
                              ) || "(absent)"}
                            </pre>
                          </div>
                        </div>
                      </details>
                    ))
                  ) : (
                    <p>Definition matches the current global version.</p>
                  )}
                  <h3>Release history</h3>
                  {selectedHistory.map((h) => (
                    <details key={h.id}>
                      <summary>
                        {new Date(h.created_at).toLocaleString()} · {h.action} ·{" "}
                        {h.actor}
                      </summary>
                      <pre>{JSON.stringify(h.detail, null, 2)}</pre>
                    </details>
                  ))}
                </>
              ) : (
                <p>
                  Select a configuration item to review its definition, history
                  and release actions.
                </p>
              )}
            </div>
          </div>
        </>
      )}
      {tab === "Packages & API" && (
        <div className="j5-api-grid">
          <section>
            <h2>Project packages</h2>
            <p>
              Local ZIP packages contain editable form and workflow JSON,
              project metadata, client examples and SHA-256 checksums.
              Unrecognized archives are inspected without conversion or
              execution.
            </p>
            <button disabled={busy} onClick={() => run(exportWorking)}>
              Export working definition ZIP
            </button>
            {admin && (
              <label>
                Inspect or import ZIP
                <input
                  aria-label="Inspect project ZIP"
                  type="file"
                  accept=".zip"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    void run(async () => {
                      const body = new FormData();
                      body.append("file", file);
                      const result = await api<{
                        importable: boolean;
                        entries: typeof inventory;
                        files: Record<string, string>;
                        message: string;
                      }>("/packages/inspect", "POST", body);
                      setInventory(result.entries);
                      setMessage(result.message);
                      if (result.importable) {
                        setFiles(result.files);
                        setProject(null);
                        setPath("forms/inspection.json");
                        try {
                          setName(
                            JSON.parse(result.files["project.json"]).name ||
                              "Imported project",
                          );
                        } catch {}
                        setMessage(
                          result.message +
                            " Files loaded into Workspace; save to retain the imported project.",
                        );
                      }
                    });
                    e.target.value = "";
                  }}
                />
              </label>
            )}
            {inventory.length > 0 && (
              <table>
                <thead>
                  <tr>
                    <th>Package entry</th>
                    <th>Bytes</th>
                  </tr>
                </thead>
                <tbody>
                  {inventory.map((i) => (
                    <tr key={i.path}>
                      <td title={i.sha256}>{i.path}</td>
                      <td>{i.size.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
          <section>
            <h2>API explorer</h2>
            <p>
              The local adapter implements the documented logbook-query response
              shape over demo data. It has not been verified against a licensed
              J5 server.
            </p>
            <p>
              <a
                href="https://docs.hexagonppm.com/r/en-US/j5-API-Reference/Version-30/1050110"
                target="_blank"
                rel="noreferrer"
              >
                Official query reference ↗
              </a>{" "}
              ·{" "}
              <a href="/api/openapi.json" target="_blank" rel="noreferrer">
                Local OpenAPI JSON ↗
              </a>
            </p>
            <label>
              Documented endpoint
              <select
                aria-label="API endpoint"
                value={apiPath}
                onChange={(e) => {
                  setApiPath(e.target.value);
                  setQueryOptions("");
                  setNextPage(null);
                }}
              >
                {[
                  [
                    "/restserver/30/industraform/logbook-query-v2/campus_inspections",
                    "Inspection query v2",
                  ],
                  [
                    "/restserver/30/industraform/logbook-query-v2/general_logbook",
                    "Operations logbook query v2",
                  ],
                  [
                    "/restserver/30/industraform/logbook-query-v2/operator_rounds",
                    "Operator rounds query v2",
                  ],
                  ["/restserver/30/area_hierarchy/areas", "Operational areas"],
                  [
                    "/restserver/30/asset_register/searchAsset/AHU",
                    "Search assets",
                  ],
                  [
                    "/restserver/30/datapoints/asset/AHU-01",
                    "Asset data points",
                  ],
                  [
                    "/restserver/30/datapoints/history/get/AHU-01.temperature",
                    "Data-point history",
                  ],
                  [
                    "/ssf/datastore/predefined/area_hierarchy",
                    "Area datastore",
                  ],
                  ["/ssf/datastore/predefined/users", "User datastore"],
                ].map(([path, label]) => (
                  <option key={path} value={path}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Request path
              <input
                aria-label="API request path"
                value={apiPath}
                onChange={(e) => setApiPath(e.target.value)}
              />
            </label>
            <label>
              Query parameters
              <input
                aria-label="API query parameters"
                value={queryOptions}
                placeholder="top=25&query_repeating=true"
                onChange={(e) => setQueryOptions(e.target.value)}
              />
            </label>
            <label>
              Attributes
              <input
                aria-label="Query attributes"
                value={attributes}
                onChange={(e) => setAttributes(e.target.value)}
              />
            </label>
            <label>
              Operational area filter
              <select
                value={apiArea}
                onChange={(e) => setApiArea(e.target.value)}
              >
                <option value="">All areas</option>
                {data.buildings.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
            <code className="j5-api-url">GET {apiPath}</code>
            <div className="j5-tools">
              <button
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    if (
                      !apiPath.startsWith("/restserver/") &&
                      !apiPath.startsWith("/ssf/")
                    )
                      throw new Error(
                        "Use a local /restserver/ or /ssf/ path.",
                      );
                    const params = new URLSearchParams(queryOptions);
                    if (apiPath.includes("logbook-query")) {
                      params.set("attribute_names", attributes);
                      if (apiArea) params.set("area", "campus:" + apiArea);
                    }
                    const r = await fetch(apiPath + "?" + params);
                    const result = await r.json();
                    setResponse(JSON.stringify(result, null, 2));
                    setNextPage(
                      result.nextLink || result.meta?.nextLink || null,
                    );
                    if (!r.ok) throw new Error(result.detail);
                    setMessage("Read-only query complete.");
                  })
                }
              >
                Run local query
              </button>
              {nextPage && (
                <button
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      const url = new URL(nextPage, location.origin);
                      if (url.origin !== location.origin)
                        throw Error(
                          "Pagination returned an unexpected origin.",
                        );
                      const r = await fetch(url);
                      const result = await r.json();
                      if (!r.ok) throw Error(result.detail);
                      setResponse(JSON.stringify(result, null, 2));
                      setNextPage(
                        result.nextLink || result.meta?.nextLink || null,
                      );
                    })
                  }
                >
                  Next API page
                </button>
              )}
              <button
                onClick={() =>
                  run(async () =>
                    setResponse(
                      JSON.stringify(await api("/native-contract"), null, 2),
                    ),
                  )
                }
              >
                View compatibility contract
              </button>
            </div>
            <pre aria-label="API response">
              {response || "Run a query to inspect the response."}
            </pre>
          </section>
        </div>
      )}
    </section>
  );
}
