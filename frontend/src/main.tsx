import React, { useState, useEffect, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  ArrowLeft,
  AlertTriangle,
  Bell,
  Building2,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Clock,
  Database,
  FileText,
  Folder,
  GitBranch,
  Grid2X2,
  History,
  Home,
  ImagePlus,
  Info,
  Layers,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Maximize2,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Square,
  Table2,
  Trash2,
  Upload,
  UserRound,
  Workflow,
  X,
  Zap,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { api, ApiError } from "./api";
import type {
  Bootstrap,
  Definition,
  Detail,
  Field,
  RecordRow,
  Role,
  Task,
  Transition,
  User,
  Config,
} from "./types";
import { Fields } from "./j5/Fields";
import { SheetForm } from "./j5/SheetForm";
import { Designer } from "./j5/Designer";
import { WorkflowEditor } from "./j5/WorkflowEditor";
import { Platform } from "./j5/Platform";
import { Logbook } from "./j5/Logbook";
import "./styles.css";
import "./j5/classic.css";

const NAV = [
  { id: "overview", label: "Campus overview", icon: LayoutDashboard },
  { id: "logbook", label: "Operations logbook", icon: Table2 },
  { id: "rounds", label: "Operator rounds", icon: ClipboardCheck },
  { id: "tasks", label: "Corrective actions", icon: ListChecks },
  { id: "handovers", label: "Shift handover", icon: CheckCheck },
  { id: "assets", label: "Equipment register", icon: Building2 },
];
const ADMIN = [
  { id: "designer", label: "Form designer", icon: Grid2X2 },
  { id: "workflow", label: "Workflow editor", icon: Workflow },
  { id: "workspace", label: "Developer workspace", icon: FileText },
  { id: "config", label: "Configuration controls", icon: Layers },
  { id: "integrations", label: "Integrations", icon: Zap },
  { id: "audit", label: "Audit trail", icon: History },
];
const ALL = [...NAV, ...ADMIN];
const fmt = (s: string) =>
  new Date(s).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
const rid = (id: number) => `INS-${String(id).padStart(4, "0")}`;
const roles: Role[] = ["technician", "supervisor", "administrator"];
const Badge = ({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone?: string;
}) => (
  <span
    className={
      "badge " + (tone || String(children).toLowerCase().replaceAll(" ", "-"))
    }
  >
    <span className="badge-dot" />
    {children}
  </span>
);
const Empty = ({ text }: { text: string }) => (
  <div className="empty">
    <ClipboardCheck size={30} />
    <p>{text}</p>
  </div>
);
function Modal({
  title,
  children,
  close,
}: {
  title: string;
  children: React.ReactNode;
  close: () => void;
}) {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const f = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
      if (e.key === "Tab" && dialog) {
        const elements = Array.from(
          dialog.querySelectorAll<HTMLElement>(
            "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]",
          ),
        );
        const first = elements[0],
          last = elements[elements.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        }
        if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", f);
    const el = document.querySelector<HTMLElement>(
      '[role="dialog"] input, [role="dialog"] select, [role="dialog"] textarea',
    );
    el?.focus();
    return () => {
      window.removeEventListener("keydown", f);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header>
          <h2>{title}</h2>
          <button
            className="icon-button"
            aria-label="Close dialog"
            onClick={close}
          >
            <X size={19} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
function Login({ onLogin }: { onLogin: (u: User) => void }) {
  const [name, setName] = useState("james"),
    [password, setPassword] = useState("campus-demo"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <div className="login">
      <div className="login-brand">
        <Building2 size={36} />
        <div>
          CAMPUS<span>OPERATIONS</span>
        </div>
      </div>
      <section className="login-card">
        <div className="eyebrow">NORTHBANK CAMPUS · LOCAL DEMO</div>
        <h1>
          Operational clarity.
          <br />
          Across every building.
        </h1>
        <p>
          Inspections, corrective actions and shift continuity in one connected
          workspace.
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              onLogin(
                await api<User>("/session", "POST", {
                  username: name,
                  password,
                }),
              );
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Demo account
            <select value={name} onChange={(e) => setName(e.target.value)}>
              <option value="maya">Maya Chen · Technician</option>
              <option value="james">James Wilson · Supervisor</option>
              <option value="alex">Alex Morgan · Administrator</option>
            </select>
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="primary wide" disabled={busy}>
            {busy ? "Signing in…" : "Open operations workspace"}
            <ArrowRight size={17} />
          </button>
        </form>
        <div className="login-note">
          <Info size={16} />
          <span>
            All three accounts use <code>campus-demo</code> by default. Use the
            administrator account to publish forms and workflows.
          </span>
        </div>
      </section>
      <footer>
        Independent demonstration · Based on documented J5 concepts · Not an
        Octave product
      </footer>
    </div>
  );
}
function App() {
  const [data, setData] = useState<Bootstrap | null>(null),
    [auth, setAuth] = useState<boolean | null>(null),
    [page, setPage] = useState(
      ALL.some((n) => n.id === location.hash.slice(1))
        ? location.hash.slice(1)
        : "overview",
    ),
    [area, setArea] = useState("all"),
    [search, setSearch] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [create, setCreate] = useState(false),
    [detail, setDetail] = useState<number | null>(null),
    [config, setConfig] = useState<Definition | null>(null),
    [base, setBase] = useState(0),
    [mobileNav, setMobileNav] = useState(false);
  useEffect(() => {
    if (config && base) {
      try {
        localStorage.setItem(
          "campus-working-definition",
          JSON.stringify({ base, definition: config }),
        );
      } catch {
        /* Editing continues if browser storage is unavailable. */
      }
    }
  }, [config, base]);
  const load = useCallback(async () => {
    try {
      const d = await api<Bootstrap>("/bootstrap");
      setData(d);
      setAuth(true);
      setConfig((c) => {
        if (c) return c;
        try {
          const saved = JSON.parse(
            localStorage.getItem("campus-working-definition") || "null",
          );
          if (
            saved?.base === d.config.id &&
            saved.definition?.fields?.length &&
            saved.definition?.states?.length
          )
            return saved.definition;
        } catch {
          /* An unreadable local draft falls back to the published version. */
        }
        return structuredClone(d.config.definition);
      });
      setBase((v) => v || d.config.id);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setAuth(false);
      else setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    load();
    const i = setInterval(load, 5000);
    return () => clearInterval(i);
  }, [load]);
  useEffect(() => {
    const f = () => {
      setPage(
        ALL.some((n) => n.id === location.hash.slice(1))
          ? location.hash.slice(1)
          : "overview",
      );
      setDetail(null);
    };
    window.addEventListener("hashchange", f);
    return () => window.removeEventListener("hashchange", f);
  }, []);
  useEffect(() => {
    if (notice) {
      const t = setTimeout(() => setNotice(""), 5000);
      return () => clearTimeout(t);
    }
  }, [notice]);
  const run = async (fn: () => Promise<void>, success?: string) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      await load();
      if (success) setNotice(success);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const nav = (p: string) => {
    location.hash = p;
    setPage(p);
    setDetail(null);
    setMobileNav(false);
    setSearch("");
  };
  if (auth === false)
    return (
      <Login
        onLogin={() => {
          setAuth(true);
          load();
        }}
      />
    );
  if (!data || !config)
    return (
      <div className="boot">
        <Building2 size={40} />
        <h2>Connecting to campus operations…</h2>
        {error && <p role="alert">{error}</p>}
        <button onClick={load}>
          <RefreshCw size={16} />
          Retry connection
        </button>
      </div>
    );
  const records = data.records.filter(
    (r) =>
      (area === "all" || r.building_id === area) &&
      (!search ||
        `${r.title} ${r.asset_id} ${r.category} ${rid(r.id)}`
          .toLowerCase()
          .includes(search.toLowerCase())),
  );
  const tasks = data.tasks.filter(
    (t) =>
      (area === "all" || t.building_id === area) &&
      (!search ||
        `${t.title} ${t.record_title} ${rid(t.record_id)}`
          .toLowerCase()
          .includes(search.toLowerCase())),
  );
  const isAdmin = data.user.role === "administrator";
  const publish = () =>
    run(
      async () => {
        if (data.release_policy?.review_required) {
          const item = await api<{ id: number; revision: number }>(
            "/config-items",
            "POST",
            {
              name: config.name,
              definition: config,
              scope: "*",
              base_version: base,
            },
          );
          await api(`/config-items/${item.id}/submit`, "POST", {
            revision: item.revision,
          });
          nav("config");
          return;
        }
        const c = await api<Config>("/config", "POST", {
          definition: config,
          base_version: base,
        });
        setConfig(structuredClone(c.definition));
        setBase(c.id);
      },
      data.release_policy?.review_required
        ? "Configuration submitted for independent review."
        : "Configuration published. New inspections will use this version.",
    );
  const openRecord = (id: number) => {
    setDetail(id);
    window.scrollTo(0, 0);
  };
  const title = ALL.find((n) => n.id === page)?.label || "Campus overview";
  return (
    <div
      className={
        "shell " +
        (["designer", "workflow", "logbook", "workspace"].includes(page)
          ? "classic-shell"
          : "")
      }
    >
      <header className="topbar">
        <button className="brand" onClick={() => nav("overview")}>
          <Building2 size={26} />
          <span>
            CAMPUS <b>OPERATIONS</b>
          </span>
        </button>
        <div className="top-links">
          <button
            className={NAV.some((n) => n.id === page) ? "active" : ""}
            onClick={() => nav("overview")}
          >
            Operations
            <ChevronDown size={13} />
          </button>
          <button
            className={ADMIN.some((n) => n.id === page) ? "active" : ""}
            onClick={() => nav("designer")}
          >
            Configuration
            <ChevronDown size={13} />
          </button>
        </div>
        <div className="top-right">
          <span className="environment">LOCAL DEMO</span>
          <button
            title="View audit trail"
            aria-label="View audit trail"
            onClick={() => nav("audit")}
          >
            <Bell size={18} />
          </button>
          <span className="avatar">{data.user.initials}</span>
          <span className="user-name">
            {data.user.name}
            <small>{data.user.role}</small>
          </span>
          <button
            title="Switch account"
            aria-label="Switch account"
            onClick={() =>
              run(async () => {
                await api("/session", "DELETE");
                setAuth(false);
              })
            }
          >
            <LogOut size={17} />
          </button>
        </div>
      </header>
      <aside className={"sidebar " + (mobileNav ? "open" : "")}>
        <div className="site-switch">
          <span className="site-icon">
            <Building2 size={21} />
          </span>
          <div>
            <strong>Northbank Campus</strong>
            <small>Property operations</small>
          </div>
        </div>
        <div className="nav-label">WORKSPACE</div>
        {NAV.map((n) => (
          <button
            key={n.id}
            className={"nav-item " + (page === n.id ? "selected" : "")}
            onClick={() => nav(n.id)}
          >
            <n.icon size={17} />
            {n.label}
            {n.id === "tasks" && (
              <span className="nav-count">
                {data.tasks.filter((t) => t.status === "Open").length}
              </span>
            )}
          </button>
        ))}
        <div className="nav-label configuration-label">CONFIGURATION</div>
        {ADMIN.map((n) => (
          <button
            key={n.id}
            className={"nav-item " + (page === n.id ? "selected" : "")}
            onClick={() => nav(n.id)}
          >
            <n.icon size={17} />
            {n.label}
          </button>
        ))}
        <div className="sidebar-bottom">
          <span
            className={"status-dot " + (!data.worker?.healthy ? "offline" : "")}
          />
          <div>
            {data.worker?.healthy
              ? "All services operational"
              : "Worker unavailable"}
            <small>Python API · PostgreSQL · Worker</small>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <div className="contextbar">
          <button
            className="mobile-menu"
            aria-label="Toggle navigation"
            onClick={() => setMobileNav(!mobileNav)}
          >
            <Layers size={18} />
          </button>
          <Home size={14} />
          <span>Northbank Campus</span>
          <ChevronRight size={13} />
          <span>{title}</span>
          {detail && (
            <>
              <ChevronRight size={13} />
              <strong>{rid(detail)}</strong>
            </>
          )}
          <div className="context-right">
            <span className="status-dot" />
            Live data
            <span className="divider" />
            {new Date().toLocaleDateString("en-GB", {
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </div>
        </div>
        {error && (
          <div className="message error" role="alert">
            <AlertTriangle size={18} />
            {error}
            <button aria-label="Dismiss error" onClick={() => setError("")}>
              <X size={16} />
            </button>
          </div>
        )}
        {notice && (
          <div className="toast" role="status">
            <Check size={18} />
            {notice}
          </div>
        )}
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {detail
                  ? "INSPECTION RECORD"
                  : ADMIN.some((n) => n.id === page)
                    ? "APPLICATION CONFIGURATION"
                    : "OPERATIONS MANAGEMENT"}
              </div>
              <h1>{detail ? rid(detail) : title}</h1>
              <p>
                {detail
                  ? "Complete, review and track this equipment inspection."
                  : (
                      {
                        overview:
                          "A connected view of safety, equipment and work across your campus.",
                        logbook:
                          "Record, track and resolve operational events.",
                        rounds:
                          "Execute configured inspections and capture evidence in the field.",
                        tasks:
                          "Follow every exception through to a verified resolution.",
                        handovers:
                          "Carry outstanding work and operational context into the next shift.",
                        assets:
                          "The equipment and operational areas behind every inspection.",
                        designer:
                          "Configure the fields, validation rules and layout of your inspection.",
                        workflow:
                          "Define how work moves between people and operational states.",
                        config:
                          "Publish, inspect and restore versioned application configuration.",
                        integrations:
                          "Trace sensor events and maintenance synchronization through the worker.",
                        audit:
                          "An accountable record of changes, decisions and system activity.",
                      } as Record<string, string>
                    )[page]}
              </p>
            </div>
            <div className="heading-actions">
              {detail ? (
                <button onClick={() => setDetail(null)}>
                  <ArrowLeft size={16} />
                  Back to list
                </button>
              ) : ["designer", "workflow"].includes(page) ? (
                <>
                  <span className="version-label">Based on v{base}</span>
                  <button
                    onClick={() => {
                      setConfig(structuredClone(data.config.definition));
                      setBase(data.config.id);
                      setNotice(
                        "Latest published configuration loaded into the editor.",
                      );
                    }}
                    title="Replace the working definition with the latest published version"
                  >
                    <RefreshCw size={15} />
                    Reload published
                  </button>
                  <button
                    className="primary"
                    disabled={!isAdmin || busy}
                    onClick={publish}
                  >
                    <Upload size={15} />
                    {data.release_policy?.review_required
                      ? "Submit for review"
                      : "Publish version"}
                  </button>
                </>
              ) : (
                <>
                  <button
                    aria-label="Refresh data"
                    title="Refresh data"
                    onClick={() => run(load)}
                    disabled={busy}
                  >
                    <RefreshCw size={16} />
                  </button>
                  {["overview", "rounds"].includes(page) && (
                    <button className="primary" onClick={() => setCreate(true)}>
                      <Plus size={17} />
                      New inspection
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
          {!detail &&
            ![
              "logbook",
              "designer",
              "workflow",
              "config",
              "workspace",
              "integrations",
              "audit",
              "handovers",
            ].includes(page) && (
              <div className="filterbar">
                <label>
                  <Building2 size={15} />
                  <select
                    aria-label="Filter by building"
                    value={area}
                    onChange={(e) => setArea(e.target.value)}
                  >
                    <option value="all">All operational areas</option>
                    {data.buildings.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </label>
                <span className="filter-divider" />
                <div className="search">
                  <Search size={16} />
                  <input
                    aria-label="Search inspections"
                    placeholder="Search inspections, equipment…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <span className="filter-info">
                  {records.length} records in scope
                </span>
              </div>
            )}
          {detail ? (
            <RecordDetail
              key={detail}
              id={detail}
              data={data}
              run={run}
              busy={busy}
            />
          ) : (
            <>
              {page === "overview" && (
                <Overview
                  data={data}
                  records={records}
                  tasks={tasks}
                  area={area}
                  open={openRecord}
                  nav={nav}
                />
              )}
              {page === "logbook" && <Logbook data={data} />}
              {page === "rounds" && (
                <RecordList records={records} open={openRecord} mode={page} />
              )}
              {page === "tasks" && (
                <TaskList tasks={tasks} run={run} open={openRecord} />
              )}
              {page === "handovers" && (
                <Handovers data={data} run={run} open={openRecord} />
              )}
              {page === "assets" && (
                <Assets
                  data={data}
                  area={area}
                  search={search}
                  open={openRecord}
                />
              )}
              {page === "designer" && (
                <Designer
                  config={config}
                  setConfig={setConfig}
                  editable={isAdmin}
                />
              )}
              {page === "workflow" && (
                <WorkflowEditor
                  config={config}
                  setConfig={setConfig}
                  editable={isAdmin}
                />
              )}
              {["workspace", "config"].includes(page) && (
                <Platform
                  key={page}
                  data={data}
                  config={config}
                  base={base}
                  initialTab={
                    page === "config" ? "Controlled releases" : "Workspace"
                  }
                  refresh={load}
                  loadDefinition={(d) => {
                    setConfig(structuredClone(d));
                    setBase(data.config.id);
                    nav("designer");
                  }}
                />
              )}
              {page === "config" && (
                <Configuration
                  data={data}
                  config={config}
                  setConfig={setConfig}
                  nav={nav}
                  run={run}
                />
              )}
              {page === "integrations" && (
                <Integrations data={data} run={run} />
              )}
              {page === "audit" && <AuditTrail data={data} open={openRecord} />}
            </>
          )}
        </main>
        <footer className="footer">
          <span>
            Campus Operations{" "}
            <span className="muted">
              / Independent J5-inspired demonstration
            </span>
          </span>
          <span>
            Configuration v{data.config.id}
            <span className="divider" />
            Local environment
          </span>
        </footer>
      </div>
      {create && (
        <NewInspection
          data={data}
          close={() => setCreate(false)}
          submit={(title, asset_id, category) =>
            run(async () => {
              const r = await api<RecordRow>("/records", "POST", {
                title,
                asset_id,
                category,
              });
              setCreate(false);
              openRecord(r.id);
            }, "Inspection created.")
          }
          busy={busy}
        />
      )}
    </div>
  );
}
function Overview({
  data,
  records,
  tasks,
  area,
  open,
  nav,
}: {
  data: Bootstrap;
  records: RecordRow[];
  tasks: Task[];
  area: string;
  open: (id: number) => void;
  nav: (s: string) => void;
}) {
  const openTasks = tasks.filter((t) => t.status === "Open"),
    overdue = openTasks.filter((t) => new Date(t.due_at) < new Date()),
    closed = records.filter((r) => r.state === "Closed").length;
  return (
    <>
      <div className="kpis">
        {[
          {
            label: "Active inspections",
            value: records.filter((r) => r.state !== "Closed").length,
            sub: "Across selected operational areas",
            icon: ClipboardCheck,
            tone: "blue",
          },
          {
            label: "Awaiting review",
            value: records.filter((r) => r.state === "Submitted").length,
            sub: "Ready for supervisor approval",
            icon: ShieldCheck,
            tone: "amber",
          },
          {
            label: "Open corrective actions",
            value: openTasks.length,
            sub: `${overdue.length} overdue · require attention`,
            icon: AlertTriangle,
            tone: "red",
          },
          {
            label: "Completed inspections",
            value: closed,
            sub: `${records.length ? Math.round((closed / records.length) * 100) : 0}% of inspections in scope`,
            icon: CheckCheck,
            tone: "green",
          },
        ].map((k) => (
          <section className="kpi" key={k.label}>
            <div>
              <span>{k.label}</span>
              <k.icon size={19} />
            </div>
            <strong className={k.tone}>
              {k.value.toString().padStart(2, "0")}
            </strong>
            <small>{k.sub}</small>
          </section>
        ))}
      </div>
      <div className="dashboard-grid">
        <section className="panel campus-panel">
          <div className="panel-title">
            <h2>
              <Building2 size={17} />
              Operational areas
            </h2>
            <button className="text-button" onClick={() => nav("assets")}>
              Equipment register
              <ArrowUpRight size={14} />
            </button>
          </div>
          <div className="campus-cards">
            {data.buildings
              .filter((b) => area === "all" || b.id === area)
              .map((b, i) => {
                const rs = records.filter((r) => r.building_id === b.id),
                  flags = rs.filter(
                    (r) => r.priority === "High" && r.state !== "Closed",
                  ).length;
                return (
                  <button
                    className="building-card"
                    key={b.id}
                    onClick={() => nav("assets")}
                  >
                    <div className={"building-illustration building-" + i}>
                      <svg viewBox="0 0 200 92" aria-hidden="true">
                        <path d="M12 83H188" stroke="#c9d5db" />
                        <path
                          d={
                            i % 2
                              ? "M45 83V30L85 12L125 30V83M125 44L155 31V83"
                              : "M56 83V19L102 5L143 21V83M30 83V45L56 36"
                          }
                          fill="#edf3f5"
                          stroke="#93acb7"
                        />
                        <path d="M102 5V83M85 12V83" stroke="#bccdd5" />
                        {[30, 43, 56, 69].map((y) => (
                          <g key={y} stroke="#a3bac4" strokeWidth="3">
                            <path
                              d={`M65 ${y}l23 -5M110 ${y}l23 5M65 ${y + 5}l23 -5`}
                            />
                          </g>
                        ))}
                      </svg>
                      <span
                        className={
                          "building-status " + (flags ? "attention" : "")
                        }
                      >
                        <span className="status-dot" />
                        {flags ? "Attention required" : "Normal operation"}
                      </span>
                    </div>
                    <div className="building-body">
                      <strong>{b.name}</strong>
                      <small>
                        {b.kind} · {b.floors} floors
                      </small>
                      <div>
                        <span>
                          {
                            data.assets.filter((a) => a.building_id === b.id)
                              .length
                          }{" "}
                          assets
                        </span>
                        <span className={flags ? "red" : ""}>
                          {flags} exceptions
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })}
          </div>
          <div className="panel-foot">
            <Info size={14} />
            Status reflects open inspections and recorded equipment exceptions.
          </div>
        </section>
        <section className="panel attention-panel">
          <div className="panel-title">
            <h2>
              <AlertTriangle size={17} />
              Needs attention
            </h2>
            <span className="count">{openTasks.length}</span>
          </div>
          {openTasks.slice(0, 4).map((t) => (
            <button
              className="attention-item"
              key={t.id}
              onClick={() => open(t.record_id)}
            >
              <span
                className={
                  "priority-line " +
                  (new Date(t.due_at) < new Date() ? "urgent" : "")
                }
              />
              <div>
                <strong>{t.title}</strong>
                <small>
                  {rid(t.record_id)} · {t.assignee}
                </small>
                <span
                  className={new Date(t.due_at) < new Date() ? "red" : "muted"}
                >
                  <Clock size={12} />
                  {new Date(t.due_at) < new Date()
                    ? "Overdue"
                    : "Due " + fmt(t.due_at)}
                </span>
              </div>
              <ChevronRight size={16} />
            </button>
          ))}
          {!openTasks.length && (
            <Empty text="No outstanding corrective actions." />
          )}
          <button className="panel-link" onClick={() => nav("tasks")}>
            View all corrective actions
            <ArrowRight size={15} />
          </button>
        </section>
      </div>
      <section className="panel">
        <div className="panel-title">
          <h2>
            <Table2 size={17} />
            Recent operational activity
          </h2>
          <button className="text-button" onClick={() => nav("logbook")}>
            Open logbook
            <ArrowUpRight size={14} />
          </button>
        </div>
        <RecordsTable records={records.slice(0, 6)} open={open} />
      </section>
    </>
  );
}
function RecordsTable({
  records,
  open,
}: {
  records: RecordRow[];
  open: (id: number) => void;
}) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Reference / Event time</th>
            <th>Operational area</th>
            <th>Category</th>
            <th>Message</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {records.map((r) => (
            <tr key={r.id} onClick={() => open(r.id)}>
              <td>
                <button
                  className="link"
                  onClick={(e) => {
                    e.stopPropagation();
                    open(r.id);
                  }}
                >
                  {rid(r.id)}
                </button>
                <small>{fmt(r.created_at)}</small>
              </td>
              <td>
                {r.building_name}
                <small>{r.asset_id}</small>
              </td>
              <td>
                <span className="category-label">{r.category}</span>
              </td>
              <td>
                <div className="record-message">
                  {r.priority === "High" && (
                    <AlertTriangle size={15} className="red" />
                  )}
                  <strong>{r.title}</strong>
                </div>
                <small>{r.owner_name}</small>
              </td>
              <td>
                <Badge>{r.state}</Badge>
              </td>
              <td>
                <span className="table-count">{r.open_tasks || "—"}</span>
                <ChevronRight size={14} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!records.length && (
        <Empty text="No inspections match the current filters." />
      )}
    </div>
  );
}
function RecordList({
  records,
  open,
  mode,
}: {
  records: RecordRow[];
  open: (id: number) => void;
  mode: string;
}) {
  const [status, setStatus] = useState("All"),
    [sort, setSort] = useState("new");
  const rs = records
    .filter((r) => status === "All" || r.state === status)
    .slice()
    .sort((a, b) => (sort === "new" ? b.id - a.id : a.id - b.id));
  return (
    <section className="panel">
      <div className="list-toolbar">
        <div className="tabs">
          {["All", ...new Set(records.map((r) => r.state))].map((s) => (
            <button
              className={status === s ? "active" : ""}
              key={s}
              onClick={() => setStatus(s)}
            >
              {s}
              <span>
                {records.filter((r) => s === "All" || r.state === s).length}
              </span>
            </button>
          ))}
        </div>
        <select
          aria-label="Sort records"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
        >
          <option value="new">Newest first</option>
          <option value="old">Oldest first</option>
        </select>
      </div>
      {mode === "rounds" ? (
        <div className="round-grid">
          {rs.map((r) => (
            <button
              className="round-card"
              key={r.id}
              onClick={() => open(r.id)}
            >
              <div>
                <span className="round-icon">
                  <ClipboardCheck size={21} />
                </span>
                <Badge>{r.state}</Badge>
              </div>
              <small>
                {rid(r.id)} · {r.asset_id}
              </small>
              <h3>{r.title}</h3>
              <p>{r.building_name}</p>
              <div className="round-bottom">
                <span>{r.owner_name}</span>
                <ArrowRight size={16} />
              </div>
            </button>
          ))}
          {!rs.length && <Empty text="No inspections in this state." />}
        </div>
      ) : (
        <RecordsTable records={rs} open={open} />
      )}
      <div className="panel-foot">
        {rs.length} inspections · All times shown in your local timezone
      </div>
    </section>
  );
}
function NewInspection({
  data,
  close,
  submit,
  busy,
}: {
  data: Bootstrap;
  close: () => void;
  submit: (title: string, asset: string, category: string) => void;
  busy: boolean;
}) {
  const [title, setTitle] = useState(""),
    [asset, setAsset] = useState(data.assets[0].id),
    [category, setCategory] = useState("Inspection");
  return (
    <Modal title="New equipment inspection" close={close}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(title, asset, category);
        }}
      >
        <div className="modal-body">
          <div className="info-strip">
            <FileText size={18} />
            <div>
              <strong>{data.config.definition.name}</strong>
              <small>
                Published version {data.config.id} · Configuration is pinned
                when created
              </small>
            </div>
          </div>
          <label>
            Inspection title
            <input
              required
              minLength={3}
              maxLength={180}
              placeholder="e.g. North Tower morning equipment check"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label>
            Equipment
            <select value={asset} onChange={(e) => setAsset(e.target.value)}>
              {data.assets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.id} · {a.name} / {a.building_name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Category
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {["Inspection", "Maintenance", "Safety", "Operations"].map(
                (x) => (
                  <option key={x}>{x}</option>
                ),
              )}
            </select>
          </label>
        </div>
        <div className="modal-actions">
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button className="primary" disabled={busy}>
            <Plus size={15} />
            Create inspection
          </button>
        </div>
      </form>
    </Modal>
  );
}
function RecordDetail({
  id,
  data,
  run,
  busy,
}: {
  id: number;
  data: Bootstrap;
  run: (fn: () => Promise<void>, s?: string) => Promise<void>;
  busy: boolean;
}) {
  const [record, setRecord] = useState<Detail | null>(null),
    [values, setValues] = useState<import("./types").FormValues>({}),
    [note, setNote] = useState(""),
    [tab, setTab] = useState("Inspection"),
    [task, setTask] = useState<Task | null>(null),
    [failure, setFailure] = useState("");
  const fetchRecord = async () => {
    const r = await api<Detail>(`/records/${id}`);
    setRecord(r);
    setValues(r.values_json);
    return r;
  };
  useEffect(() => {
    fetchRecord().catch((e) => setFailure(e.message));
  }, [id]);
  if (!record)
    return (
      <div className="panel loading">{failure || "Loading inspection…"}</div>
    );
  const asset = data.assets.find((a) => a.id === record.asset_id)!;
  const draft = record.editable ?? record.state === "Draft";
  const visitedStates = new Set(
    record.audit
      .flatMap((a) => [a.detail.source, a.detail.target])
      .filter(Boolean),
  );
  const dirty = JSON.stringify(values) !== JSON.stringify(record.values_json);
  const save = async () => {
    const r = await api<Detail>(`/records/${id}`, "PUT", {
      values,
      revision: record.revision,
    });
    setRecord(r);
    setValues(r.values_json);
    return r;
  };
  return (
    <>
      <div className="record-summary">
        <div>
          <h2>{record.title}</h2>
          <span>
            {asset.building_name}
            <ChevronRight size={13} />
            {asset.location}
            <ChevronRight size={13} />
            <strong>{asset.id}</strong>
          </span>
        </div>
        <Badge>{record.state}</Badge>
      </div>
      <div className="lifecycle">
        {record.definition.states.map((s, i) => (
          <React.Fragment key={s}>
            <div
              className={
                record.state === s
                  ? "current"
                  : s !== record.state && visitedStates.has(s)
                    ? "done"
                    : ""
              }
            >
              <span>
                {s !== record.state && visitedStates.has(s) ? (
                  <Check size={14} />
                ) : (
                  i + 1
                )}
              </span>
              {s}
            </div>
            {i < record.definition.states.length - 1 && (
              <div className="life-line" />
            )}
          </React.Fragment>
        ))}
      </div>
      <div className="record-layout">
        <section className="panel record-form">
          <div className="list-toolbar">
            <div className="tabs">
              {["Inspection", "Evidence", "Activity"].map((t) => (
                <button
                  key={t}
                  className={tab === t ? "active" : ""}
                  onClick={() => setTab(t)}
                >
                  {t}
                  {t === "Evidence" && <span>{record.evidence.length}</span>}
                </button>
              ))}
            </div>
            <span className="version-label">Form v{record.config_id}</span>
          </div>
          {tab === "Inspection" && (
            <>
              <div className="record-meta">
                <div>
                  <small>INSPECTED BY</small>
                  <strong>{record.owner_name}</strong>
                </div>
                <div>
                  <small>CREATED</small>
                  <strong>{fmt(record.created_at)}</strong>
                </div>
                <div>
                  <small>CATEGORY</small>
                  <strong>{record.category}</strong>
                </div>
              </div>
              <SheetForm
                role={data.user.role}
                definition={record.definition}
                values={values}
                setValues={setValues}
                disabled={!draft}
              />
              {record.exceptions.length > 0 && (
                <div className="exception-list">
                  <AlertTriangle size={17} />
                  <div>
                    <strong>Recorded exceptions</strong>
                    {record.exceptions.map((x) => (
                      <p key={x}>{x}</p>
                    ))}
                  </div>
                </div>
              )}
              {draft && (
                <div className="form-actions">
                  <span className="muted">
                    {dirty ? "Unsaved changes" : "All changes saved"}
                  </span>
                  <button
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        await save();
                      }, "Draft saved.")
                    }
                  >
                    <Save size={16} />
                    Save draft
                  </button>
                </div>
              )}
            </>
          )}
          {tab === "Evidence" && (
            <div className="evidence-panel">
              <div className="info-strip">
                <Info size={16} />
                <span>
                  {record.definition.evidence_on_exception
                    ? "Photographic evidence is required before submitting an exception."
                    : "Attach photographs to support the inspection."}
                </span>
              </div>
              {draft && (
                <label className="upload-zone">
                  <ImagePlus size={29} />
                  <strong>Add inspection photographs</strong>
                  <span>JPEG, PNG or WebP · up to 10 MB per image</span>
                  <input
                    aria-label="Upload photographic evidence"
                    disabled={busy}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file)
                        run(async () => {
                          if (dirty) await save();
                          const form = new FormData();
                          form.append("file", file);
                          await api(`/records/${id}/evidence`, "POST", form);
                          await fetchRecord();
                        }, "Evidence attached.");
                      e.target.value = "";
                    }}
                  />
                </label>
              )}
              <div className="evidence-grid">
                {record.evidence.map((e) => (
                  <a
                    href={"/api/evidence/" + e.id}
                    target="_blank"
                    rel="noreferrer"
                    key={e.id}
                  >
                    <img src={"/api/evidence/" + e.id} alt={e.filename} />
                    <strong>{e.filename}</strong>
                    <small>
                      {(e.size / 1024).toFixed(1)} KB · SHA-256 recorded
                    </small>
                  </a>
                ))}
              </div>
              {!record.evidence.length && !draft && (
                <Empty text="No photographic evidence was attached to this sample record." />
              )}
            </div>
          )}
          {tab === "Activity" && (
            <div className="timeline">
              {record.audit.map((a) => (
                <div key={a.id}>
                  <span className="timeline-dot" />
                  <strong>{a.action}</strong>
                  <small>
                    {a.actor} · {fmt(a.created_at)}
                  </small>
                  {a.detail.note ? <p>{String(a.detail.note)}</p> : null}
                  <details>
                    <summary>Event details</summary>
                    <pre>{JSON.stringify(a.detail, null, 2)}</pre>
                  </details>
                </div>
              ))}
            </div>
          )}
        </section>
        <aside className="record-aside">
          <section className="panel">
            <div className="panel-title">
              <h2>
                <GitBranch size={17} />
                Workflow actions
              </h2>
            </div>
            <div className="aside-body">
              <p>
                Available to <strong>{data.user.name}</strong> as{" "}
                {data.user.role}.
              </p>
              <label>
                Transition comment
                <textarea
                  rows={3}
                  placeholder="Add context for the next person…"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>
              {record.active_states && (
                <div className="j5-active-branches">
                  <strong>Active workflow states</strong>
                  {record.active_states.map((s) => (
                    <span key={s}>{s}</span>
                  ))}
                </div>
              )}
              {record.definition.transitions
                .filter((t) =>
                  record.available_transitions
                    ? record.available_transitions.includes(t.id)
                    : t.source === record.state,
                )
                .map((t) => (
                  <div key={t.id}>
                    {t.prompt && <p className="permission-note">{t.prompt}</p>}
                    <button
                      className={
                        "wide " + (t.target === "Draft" ? "" : "primary")
                      }
                      disabled={busy || !t.roles.includes(data.user.role)}
                      onClick={() =>
                        run(async () => {
                          const r = dirty ? await save() : record;
                          const next = await api<Detail>(
                            `/records/${id}/transition`,
                            "POST",
                            { transition_id: t.id, revision: r.revision, note },
                          );
                          setRecord(next);
                          setValues(next.values_json);
                          setNote("");
                        }, "Workflow transition recorded.")
                      }
                    >
                      <ArrowRight size={15} />
                      {t.label}
                    </button>
                    {!t.roles.includes(data.user.role) && (
                      <small className="permission-note">
                        Requires {t.roles.join(" or ")}
                      </small>
                    )}
                    {t.require_note && (
                      <small className="permission-note">
                        A comment is required
                      </small>
                    )}
                  </div>
                ))}
              {record.timers
                ?.filter((t) => ["Pending", "Blocked"].includes(t.status))
                .map((t) => (
                  <div className="j5-timer" key={t.id}>
                    <strong>
                      {record.definition.transitions.find(
                        (x) => x.id === t.transition_id,
                      )?.label || t.transition_id}
                    </strong>
                    <p>
                      {t.status} · {fmt(t.due_at)}
                    </p>
                    {t.last_error && <p className="red">{t.last_error}</p>}
                    {t.status === "Blocked" &&
                      data.user.role !== "technician" && (
                        <button
                          onClick={() =>
                            run(async () => {
                              await api(
                                `/records/${id}/timers/${t.id}/retry`,
                                "POST",
                              );
                              setRecord(await api<Detail>(`/records/${id}`));
                            })
                          }
                        >
                          Retry timer
                        </button>
                      )}
                  </div>
                ))}
              {record.state === "Closed" && (
                <div className="complete-state">
                  <ShieldCheck size={25} />
                  <strong>Inspection closed</strong>
                  <span>This record is read-only.</span>
                </div>
              )}
            </div>
          </section>
          <section className="panel">
            <div className="panel-title">
              <h2>
                <ListChecks size={17} />
                Corrective actions
              </h2>
              <span className="count">{record.tasks.length}</span>
            </div>
            <div className="aside-body">
              {record.tasks.map((t) => (
                <div className="mini-task" key={t.id}>
                  <Badge>{t.status}</Badge>
                  <p>{t.title}</p>
                  {t.status === "Open" && (
                    <button className="text-button" onClick={() => setTask(t)}>
                      Record completion
                      <ArrowRight size={13} />
                    </button>
                  )}
                </div>
              ))}
              {!record.tasks.length && (
                <p className="muted">
                  Exceptions generate corrective tasks when the inspection is
                  submitted.
                </p>
              )}
            </div>
          </section>
          <div className="version-note">
            <ShieldCheck size={17} />
            <p>
              Using published configuration <strong>v{record.config_id}</strong>
              . Changes and transitions are recorded in the audit trail.
            </p>
          </div>
        </aside>
      </div>
      {task && (
        <CompleteTask
          task={task}
          close={() => setTask(null)}
          submit={(note) =>
            run(async () => {
              await api(`/tasks/${task.id}/complete`, "POST", { note });
              setTask(null);
              await fetchRecord();
            }, "Corrective action completed.")
          }
        />
      )}
    </>
  );
}
function CompleteTask({
  task,
  close,
  submit,
}: {
  task: Task;
  close: () => void;
  submit: (note: string) => void;
}) {
  const [note, setNote] = useState("");
  return (
    <Modal title="Complete corrective action" close={close}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(note);
        }}
      >
        <div className="modal-body">
          <p>{task.title}</p>
          <label>
            Resolution and verification notes
            <textarea
              required
              minLength={3}
              rows={4}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Describe the repair and how you verified it…"
            />
          </label>
        </div>
        <div className="modal-actions">
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button className="primary">
            <CheckCheck size={16} />
            Complete action
          </button>
        </div>
      </form>
    </Modal>
  );
}
function TaskList({
  tasks,
  run,
  open,
}: {
  tasks: Task[];
  run: (f: () => Promise<void>, s?: string) => Promise<void>;
  open: (id: number) => void;
}) {
  const [filter, setFilter] = useState("Open"),
    [task, setTask] = useState<Task | null>(null);
  return (
    <section className="panel">
      <div className="list-toolbar">
        <div className="tabs">
          {["Open", "Completed", "All"].map((s) => (
            <button
              key={s}
              className={s === filter ? "active" : ""}
              onClick={() => setFilter(s)}
            >
              {s}
              <span>
                {tasks.filter((t) => s === "All" || t.status === s).length}
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Action</th>
              <th>Related inspection</th>
              <th>Assigned team</th>
              <th>Due</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {tasks
              .filter((t) => filter === "All" || t.status === filter)
              .map((t) => (
                <tr key={t.id}>
                  <td>
                    <strong>{t.title}</strong>
                    <small>ACT-{String(t.id).padStart(4, "0")}</small>
                  </td>
                  <td>
                    <button className="link" onClick={() => open(t.record_id)}>
                      {rid(t.record_id)}
                    </button>
                  </td>
                  <td>{t.assignee}</td>
                  <td
                    className={
                      t.status === "Open" && new Date(t.due_at) < new Date()
                        ? "red"
                        : ""
                    }
                  >
                    {fmt(t.due_at)}
                    {t.escalated && <small>Escalated to supervisor</small>}
                  </td>
                  <td>
                    <Badge>{t.status}</Badge>
                  </td>
                  <td>
                    {t.status === "Open" && (
                      <button onClick={() => setTask(t)}>
                        <Check size={15} />
                        Complete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {!tasks.filter((t) => filter === "All" || t.status === filter).length && (
        <Empty text="No actions in this view." />
      )}
      {task && (
        <CompleteTask
          task={task}
          close={() => setTask(null)}
          submit={(note) =>
            run(async () => {
              await api(`/tasks/${task.id}/complete`, "POST", { note });
              setTask(null);
            }, "Corrective action completed.")
          }
        />
      )}
    </section>
  );
}
function Handovers({
  data,
  run,
  open,
}: {
  data: Bootstrap;
  run: (f: () => Promise<void>, s?: string) => Promise<void>;
  open: (id: number) => void;
}) {
  const [note, setNote] = useState(""),
    [shift, setShift] = useState("Day shift → Night shift");
  return (
    <div className="handover-layout">
      <section className="panel">
        <div className="panel-title">
          <h2>
            <CheckCheck size={18} />
            Prepare shift handover
          </h2>
          <Badge tone="draft">Draft report</Badge>
        </div>
        <div className="aside-body">
          <div className="info-strip">
            <Info size={17} />
            <span>
              The issued report captures a fixed snapshot of outstanding work
              across the whole campus.
            </span>
          </div>
          <label>
            Shift
            <select value={shift} onChange={(e) => setShift(e.target.value)}>
              <option>Day shift → Night shift</option>
              <option>Night shift → Day shift</option>
              <option>Weekend team → Weekday team</option>
            </select>
          </label>
          <label>
            Handover briefing
            <textarea
              rows={5}
              placeholder="Key risks, temporary measures and priorities for the incoming team…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <div className="handover-counts">
            <span>
              <strong>
                {data.records.filter((r) => r.state !== "Closed").length}
              </strong>{" "}
              active inspections
            </span>
            <span>
              <strong>
                {data.tasks.filter((t) => t.status === "Open").length}
              </strong>{" "}
              outstanding tasks
            </span>
          </div>
          <button
            className="primary wide"
            disabled={data.user.role === "technician" || note.trim().length < 3}
            onClick={() =>
              run(async () => {
                await api("/handovers", "POST", { shift, note });
                setNote("");
              }, "Shift handover issued.")
            }
          >
            <CheckCheck size={16} />
            Issue handover report
          </button>
          {data.user.role === "technician" && (
            <small className="permission-note">
              A supervisor or administrator can issue the report.
            </small>
          )}
        </div>
      </section>
      <div>
        <section className="panel">
          <div className="panel-title">
            <h2>
              <History size={17} />
              Issued handovers
            </h2>
            <span className="count">{data.handovers.length}</span>
          </div>
          {!data.handovers.length && (
            <Empty text="No handovers issued yet. Prepare the first briefing." />
          )}
          {data.handovers.map((h) => (
            <article className="handover-card" key={h.id}>
              <div>
                <h3>{h.shift}</h3>
                <Badge tone={h.acknowledged_by ? "completed" : "submitted"}>
                  {h.acknowledged_by
                    ? "Acknowledged"
                    : "Awaiting acknowledgement"}
                </Badge>
              </div>
              <small>
                HND-{String(h.id).padStart(4, "0")} · {h.author} ·{" "}
                {fmt(h.created_at)}
              </small>
              <p className="preserve-lines">{h.note}</p>
              <details>
                <summary>
                  {h.snapshot.records.length} inspections ·{" "}
                  {h.snapshot.tasks.length} outstanding tasks ·{" "}
                  {h.snapshot.logbook?.length || 0} logbook entries at issue
                </summary>
                {h.snapshot.records.map((r) => (
                  <button
                    key={r.id}
                    className="handover-record"
                    onClick={() => open(r.id)}
                  >
                    <span>
                      {rid(r.id)} · {r.title}
                    </span>
                    <Badge>{r.state}</Badge>
                  </button>
                ))}
                {h.snapshot.logbook?.map((entry) => (
                  <div className="snapshot-task" key={"log-" + entry.id}>
                    LOG-{String(entry.id).padStart(4, "0")} · {entry.message}
                    <small>
                      {entry.status} · {entry.priority} ·{" "}
                      {fmt(entry.event_time)}
                    </small>
                  </div>
                ))}
                {h.snapshot.tasks.map((t) => (
                  <div className="snapshot-task" key={t.id}>
                    ACT-{t.id} · {t.title}
                    <small>
                      {t.assignee} · Due {fmt(t.due_at)}
                    </small>
                  </div>
                ))}
              </details>
              {h.acknowledged_by ? (
                <p className="green">
                  <CheckCheck size={14} />
                  Acknowledged by {h.acknowledged_by} ·{" "}
                  {fmt(h.acknowledged_at!)}
                </p>
              ) : (
                <button
                  onClick={() =>
                    run(async () => {
                      await api(`/handovers/${h.id}/acknowledge`, "POST");
                    }, "Handover acknowledged.")
                  }
                >
                  <Check size={15} />
                  Acknowledge receipt
                </button>
              )}
            </article>
          ))}
        </section>
      </div>
    </div>
  );
}
function Assets({
  data,
  area,
  search,
  open,
}: {
  data: Bootstrap;
  area: string;
  search: string;
  open: (id: number) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <section className="panel">
      <div className="panel-title">
        <h2>
          <Building2 size={17} />
          Campus equipment
        </h2>
        <span className="muted">{data.assets.length} registered assets</span>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Equipment ID</th>
              <th>Description</th>
              <th>Operational area</th>
              <th>Location</th>
              <th>Class</th>
              <th>Active exceptions</th>
            </tr>
          </thead>
          <tbody>
            {data.assets
              .filter(
                (a) =>
                  (area === "all" || a.building_id === area) &&
                  (!search ||
                    `${a.id} ${a.name} ${a.building_name}`
                      .toLowerCase()
                      .includes(search.toLowerCase())),
              )
              .map((a) => {
                const rs = data.records.filter(
                  (r) =>
                    r.asset_id === a.id &&
                    r.state !== "Closed" &&
                    r.priority === "High",
                );
                return (
                  <React.Fragment key={a.id}>
                    <tr
                      className={selected === a.id ? "selected-row" : ""}
                      onClick={() =>
                        setSelected(selected === a.id ? null : a.id)
                      }
                    >
                      <td>
                        <button className="link">{a.id}</button>
                      </td>
                      <td>
                        <strong>{a.name}</strong>
                      </td>
                      <td>{a.building_name}</td>
                      <td>{a.location}</td>
                      <td>{a.kind}</td>
                      <td>
                        <Badge tone={rs.length ? "high" : "normal"}>
                          {rs.length ? `${rs.length} exceptions` : "Normal"}
                        </Badge>
                      </td>
                    </tr>
                    {selected === a.id && (
                      <tr>
                        <td colSpan={6}>
                          <div className="asset-history">
                            <h3>Inspection history · {a.id}</h3>
                            {data.records
                              .filter((r) => r.asset_id === a.id)
                              .map((r) => (
                                <button key={r.id} onClick={() => open(r.id)}>
                                  <FileText size={15} />
                                  {rid(r.id)} · {r.title}
                                  <Badge>{r.state}</Badge>
                                </button>
                              ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
function Configuration({
  data,
  config,
  setConfig,
  nav,
  run,
}: {
  data: Bootstrap;
  config: Definition;
  setConfig: (d: Definition) => void;
  nav: (s: string) => void;
  run: (f: () => Promise<void>, s?: string) => Promise<void>;
}) {
  const [view, setView] = useState<Config | null>(null);
  const download = () => {
    const blob = new Blob(
      [
        JSON.stringify(
          { format: "campus-demo/v1", definition: config },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "campus-inspection.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <>
      <div className="info-strip configuration-info">
        <Info size={18} />
        <span>
          Published versions are immutable. Inspections retain their original
          version. Import and export use this demo’s own JSON format.
        </span>
      </div>
      <section className="panel">
        <div className="panel-title">
          <h2>
            <Layers size={18} />
            Equipment inspection configuration
          </h2>
          <div className="button-row">
            <button onClick={download}>
              <ArrowDownToLine size={15} />
              Export working definition
            </button>
            <label
              className={
                "button " +
                (data.user.role !== "administrator" ? "disabled" : "")
              }
            >
              <Upload size={15} />
              Import JSON
              <input
                type="file"
                accept="application/json,.json"
                disabled={data.user.role !== "administrator"}
                className="file-hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f)
                    run(async () => {
                      if (f.size > 256 * 1024)
                        throw new Error(
                          "Configuration files must be 256 KB or smaller.",
                        );
                      const parsed = JSON.parse(await f.text());
                      if (
                        parsed.format !== "campus-demo/v1" ||
                        !Array.isArray(parsed.definition?.fields) ||
                        !Array.isArray(parsed.definition?.states) ||
                        !Array.isArray(parsed.definition?.transitions)
                      )
                        throw new Error(
                          "Use a campus-demo/v1 definition exported by this demo.",
                        );
                      await api("/config/validate", "POST", {
                        definition: parsed.definition,
                        base_version: data.config.id,
                      });
                      setConfig(parsed.definition);
                      nav("designer");
                    }, "Definition imported into the editor. Review and publish to activate.");
                  e.target.value = "";
                }}
              />
            </label>
          </div>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Version</th>
                <th>Template</th>
                <th>Published by</th>
                <th>Published at</th>
                <th>Availability</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.versions.map((v, i) => (
                <tr key={v.id}>
                  <td>
                    <strong>v{v.id}</strong>
                  </td>
                  <td>{v.name}</td>
                  <td>{v.published_by}</td>
                  <td>{fmt(v.created_at)}</td>
                  <td>
                    <Badge tone={i === 0 ? "completed" : "draft"}>
                      {i === 0 ? "Current" : "Archived"}
                    </Badge>
                  </td>
                  <td>
                    <button
                      onClick={() =>
                        run(async () => {
                          setView(await api<Config>("/config/" + v.id));
                        })
                      }
                    >
                      Inspect
                      <ChevronRight size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <div className="config-explainer">
        <section>
          <ShieldCheck size={24} />
          <h3>Controlled publication</h3>
          <p>
            Only administrators can publish. Concurrent changes are rejected
            until the editor reloads the latest version.
          </p>
        </section>
        <section>
          <History size={24} />
          <h3>Traceable changes</h3>
          <p>
            Every published version records its author and timestamp. Historical
            definitions remain available for inspection.
          </p>
        </section>
        <section>
          <GitBranch size={24} />
          <h3>Stable work in progress</h3>
          <p>
            New inspections use the latest version. Existing inspections
            continue with their original fields and workflow.
          </p>
        </section>
      </div>
      {view && (
        <Modal
          title={`Configuration version ${view.id}`}
          close={() => setView(null)}
        >
          <div className="modal-body">
            <p>
              {view.definition.name} · Published by {view.published_by}
            </p>
            <pre className="json-preview">
              {JSON.stringify(view.definition, null, 2)}
            </pre>
          </div>
          <div className="modal-actions">
            <button onClick={() => setView(null)}>Close</button>
            <button
              disabled={data.user.role !== "administrator"}
              className="primary"
              onClick={() => {
                setConfig(structuredClone(view.definition));
                setView(null);
                nav("designer");
              }}
            >
              <History size={15} />
              Use as working definition
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
function Integrations({
  data,
  run,
}: {
  data: Bootstrap;
  run: (f: () => Promise<void>, s?: string) => Promise<void>;
}) {
  const [asset, setAsset] = useState("CH-01"),
    [temperature, setTemperature] = useState(39);
  return (
    <>
      <div className="integration-cards">
        {[
          {
            name: "Sensor gateway",
            icon: Activity,
            desc: "Inject a temperature reading into the persistent queue.",
            status: "Local simulator",
          },
          {
            name: "Maintenance service",
            icon: Settings2,
            desc: "HTTP work-order delivery with idempotency and retries.",
            status: "Local simulator",
          },
          {
            name: "Background worker",
            icon: Database,
            desc: data.worker
              ? "Last heartbeat " + fmt(data.worker.last_seen)
              : "Waiting for a heartbeat",
            status: data.worker?.healthy ? "Operational" : "Unavailable",
          },
        ].map((x) => (
          <section className="panel integration-card" key={x.name}>
            <x.icon size={25} />
            <h3>{x.name}</h3>
            <p>{x.desc}</p>
            <Badge tone={x.status === "Unavailable" ? "high" : "normal"}>
              {x.status}
            </Badge>
          </section>
        ))}
      </div>
      <section className="panel">
        <div className="panel-title">
          <h2>
            <Zap size={17} />
            Inject sensor event
          </h2>
          <span className="muted">Supervisors and administrators</span>
        </div>
        <form
          className="sensor-form"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              await api("/sensor-events", "POST", {
                asset_id: asset,
                temperature,
              });
            }, "Sensor event queued. The worker will process it shortly.");
          }}
        >
          <label>
            Equipment
            <select value={asset} onChange={(e) => setAsset(e.target.value)}>
              {data.assets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.id} · {a.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Temperature (°C)
            <input
              required
              type="number"
              min={-50}
              max={200}
              value={temperature}
              onChange={(e) => setTemperature(Number(e.target.value))}
            />
          </label>
          <button
            className="primary"
            disabled={data.user.role === "technician"}
          >
            <Zap size={15} />
            Send sensor event
          </button>
        </form>
        <div className="panel-foot">
          <Info size={14} />
          Above-limit readings create a draft inspection and corrective task.
          The maintenance simulator rejects the first delivery to demonstrate
          automatic retry.
        </div>
      </section>
      <section className="panel integration-jobs">
        <div className="panel-title">
          <h2>
            <Activity size={17} />
            Event & delivery queue
          </h2>
          <span className="muted">Refreshes every 5 seconds</span>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Job</th>
                <th>Type</th>
                <th>Payload</th>
                <th>Status</th>
                <th>Attempts</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {data.jobs.map((j) => (
                <tr key={j.id}>
                  <td>JOB-{String(j.id).padStart(4, "0")}</td>
                  <td className="capitalize">{j.kind}</td>
                  <td>
                    <code>
                      {j.kind === "sensor"
                        ? `${j.payload.asset_id} · ${j.payload.temperature}°C`
                        : `ACT-${j.payload.task_id}`}
                    </code>
                    {j.last_error && (
                      <details>
                        <summary className="red">Delivery error</summary>
                        <p className="job-error">{j.last_error}</p>
                      </details>
                    )}
                  </td>
                  <td>
                    <Badge>{j.status}</Badge>
                  </td>
                  <td>{j.attempts}</td>
                  <td>{fmt(j.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!data.jobs.length && (
          <Empty text="Send a sensor event to trace processing and delivery." />
        )}
      </section>
    </>
  );
}
function AuditTrail({
  data,
  open,
}: {
  data: Bootstrap;
  open: (id: number) => void;
}) {
  const [query, setQuery] = useState("");
  const entries = data.audit.filter((a) =>
    `${a.actor} ${a.action} ${JSON.stringify(a.detail)}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <section className="panel">
      <div className="panel-title">
        <h2>
          <History size={17} />
          Activity history
        </h2>
        <div className="search">
          <Search size={15} />
          <input
            aria-label="Search audit trail"
            placeholder="Search actors, actions or details…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Event time</th>
              <th>Actor</th>
              <th>Action</th>
              <th>Record</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((a) => (
              <tr key={a.id}>
                <td>
                  {fmt(a.created_at)}
                  <small>EVT-{a.id}</small>
                </td>
                <td>
                  <span className="actor">
                    <UserRound size={14} />
                    {a.actor}
                  </span>
                </td>
                <td>
                  <strong>{a.action}</strong>
                </td>
                <td>
                  {a.record_id ? (
                    <button className="link" onClick={() => open(a.record_id!)}>
                      {rid(a.record_id)}
                    </button>
                  ) : (
                    "System"
                  )}
                </td>
                <td>
                  <details>
                    <summary>View details</summary>
                    <pre>{JSON.stringify(a.detail, null, 2)}</pre>
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="panel-foot">
        Latest {entries.length} matching events (up to 150). The database
        retains the full audit history.
      </div>
    </section>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
