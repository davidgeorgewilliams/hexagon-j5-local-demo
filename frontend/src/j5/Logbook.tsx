import { useState, useEffect, useRef } from "react";
import {
  Filter,
  PlusCircle,
  Pencil,
  Printer,
  Flag,
  MessageSquare,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Download,
  Save,
  X,
} from "lucide-react";
import type { Bootstrap } from "../types";
import { api } from "../api";
import { RichText } from "./RichText";
type Entry = {
  id: number;
  asset_id: string;
  asset_name: string;
  building_id: string;
  building_name: string;
  category: string;
  status: string;
  priority: string;
  message: string;
  message_html?: string;
  attachments?: {
    id: string;
    filename: string;
    media_type: string;
    size: number;
    sha256: string;
    author: string;
  }[];
  event_time: string;
  add_to_handover: boolean;
  author: string;
  closed_by: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
  revision: number;
  note_count: number;
  flag_count: number;
  notes?: {
    id: number;
    message: string;
    flagged: boolean;
    author: string;
    created_at: string;
  }[];
  history?: {
    id: number;
    action: string;
    actor: string;
    detail: unknown;
    created_at: string;
  }[];
};
const categories = [
  "Operations",
  "Maintenance",
  "Safety",
  "Inspection",
  "Downtime",
  "Lab",
];
const priorities = ["Low", "Normal", "High", "Critical"];
const statuses = ["Open", "On Hold", "Closed"];
const fmt = (d: string) =>
  new Date(d).toLocaleString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
const localInput = (s: string) => {
  const d = new Date(s);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
};
function csvCell(v: unknown) {
  let s = String(v ?? "");
  if (/^[\s]*[=+@-]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}
export function Logbook({ data }: { data: Bootstrap }) {
  const [rows, setRows] = useState<Entry[]>([]),
    [loading, setLoading] = useState(true),
    [total, setTotal] = useState(0),
    [allCount, setAllCount] = useState(0),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [view, setView] = useState("List"),
    [filters, setFilters] = useState(true),
    [advanced, setAdvanced] = useState(false),
    [query, setQuery] = useState(""),
    [search, setSearch] = useState(""),
    [category, setCategory] = useState(""),
    [status, setStatus] = useState(""),
    [priority, setPriority] = useState(""),
    [building, setBuilding] = useState(""),
    [asset, setAsset] = useState(""),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [author, setAuthor] = useState(""),
    [flagged, setFlagged] = useState(false),
    [handover, setHandover] = useState(false),
    [sort, setSort] = useState<keyof Entry>("event_time"),
    [ascending, setAscending] = useState(false),
    [page, setPage] = useState(0),
    [entry, setEntry] = useState<Entry | null>(null),
    [note, setNote] = useState(""),
    [isFlag, setIsFlag] = useState(false),
    [history, setHistory] = useState(false),
    [month, setMonth] = useState(
      new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    ),
    [columns, setColumns] = useState(false),
    [hidden, setHidden] = useState<string[]>([]);
  const loadSequence = useRef(0);
  const queryParams = (exporting = false) => {
    const params = new URLSearchParams({
      search,
      category,
      status,
      priority,
      building,
      asset,
      author,
      flagged: String(flagged),
      handover: String(handover),
      sort,
      ascending: String(ascending),
      limit: String(view === "List" ? 25 : 500),
      offset: String(page * (view === "List" ? 25 : 500)),
    });
    if (from) params.set("from", new Date(from + "T00:00:00").toISOString());
    if (to) {
      const end = new Date(to + "T00:00:00");
      end.setDate(end.getDate() + 1);
      params.set("to", end.toISOString());
    }
    if (view === "Calendar" && !exporting) {
      const first = new Date(
        month.getFullYear(),
        month.getMonth(),
        1 - ((month.getDay() + 6) % 7),
      );
      const end = new Date(first);
      end.setDate(end.getDate() + 42);
      params.set("from", first.toISOString());
      params.set("to", end.toISOString());
    }
    return params.toString();
  };
  const load = async () => {
    const sequence = ++loadSequence.current;
    try {
      const result = await api<{
        values: Entry[];
        total: number;
        all_count: number;
      }>("/logbook/query?" + queryParams());
      if (sequence === loadSequence.current) {
        setRows(result.values);
        setTotal(result.total);
        setAllCount(result.all_count);
        setError("");
      }
    } catch (e) {
      if (sequence === loadSequence.current) setError((e as Error).message);
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  };
  useEffect(() => {
    void load();
    const interval = setInterval(() => {
      if (!entry) void load();
    }, 5000);
    return () => clearInterval(interval);
  }, [
    entry?.id,
    search,
    category,
    status,
    priority,
    building,
    asset,
    from,
    to,
    author,
    flagged,
    handover,
    sort,
    ascending,
    page,
    view,
    month,
  ]);
  useEffect(
    () => setPage(0),
    [
      search,
      category,
      status,
      priority,
      building,
      asset,
      from,
      to,
      author,
      flagged,
      handover,
      view,
      month,
      sort,
      ascending,
    ],
  );
  const perform = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const open = (id: number) =>
    perform(async () => {
      setEntry(await api<Entry>(`/logbook/${id}`));
      setNote("");
      setIsFlag(false);
      setHistory(false);
    });
  const create = (category = "Operations") => {
    setEntry({
      id: 0,
      asset_id: data.assets[0]?.id || "",
      asset_name: "",
      building_id: "",
      building_name: "",
      category,
      status: "Open",
      priority: "Normal",
      message: "",
      event_time: new Date().toISOString(),
      add_to_handover: true,
      author: data.user.name,
      closed_by: null,
      closed_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      revision: 0,
      note_count: 0,
      flag_count: 0,
      notes: [],
      history: [],
    });
    setNotice("");
    setError("");
    setNote("");
    setIsFlag(false);
    setHistory(false);
  };
  const filtered = rows;
  const clear = () => {
    setCategory("");
    setStatus("");
    setPriority("");
    setBuilding("");
    setAsset("");
    setFrom("");
    setTo("");
    setAuthor("");
    setFlagged(false);
    setHandover(false);
    setQuery("");
    setSearch("");
  };
  const exportCsv = () =>
    perform(async () => {
      const response = await fetch(
        "/api/logbook/export.csv?" + queryParams(true),
      );
      if (!response.ok) throw new Error((await response.json()).detail);
      const url = URL.createObjectURL(await response.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = "operations-logbook.csv";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  const sortable = (key: keyof Entry, label: string) => (
    <button
      onClick={() => {
        setAscending(sort === key ? !ascending : true);
        setSort(key);
      }}
    >
      {label}
      {sort === key ? (ascending ? " ▴" : " ▾") : ""}
    </button>
  );
  const formEntry = entry;
  const selectedAsset = data.assets.find((a) => a.id === entry?.asset_id);
  const save = () =>
    perform(async () => {
      if (!formEntry) return;
      const saved = await api<Entry>(
        formEntry.id ? `/logbook/${formEntry.id}` : "/logbook",
        formEntry.id ? "PUT" : "POST",
        formEntry,
      );
      setEntry(saved);
      setNotice("Logbook entry saved.");
      await load();
    });
  const update = (patch: Partial<Entry>) =>
    setEntry((e) => (e ? { ...e, ...patch } : e));
  const renderEntry = (r: Entry) => (
    <button className="j5-event" key={r.id} onClick={() => open(r.id)}>
      <time>
        {new Date(r.event_time).toLocaleTimeString("en-GB", {
          hour: "2-digit",
          minute: "2-digit",
        })}
      </time>
      <b>{r.category}</b>
      <span>{r.message}</span>
      <small>
        {r.building_name} · {r.status}
      </small>
    </button>
  );
  return (
    <section className="j5-logbook">
      {error && (
        <div className="j5-error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="j5-notice" role="status">
          {notice}
        </div>
      )}
      {entry ? (
        <>
          <div className="j5-detail-breadcrumb">
            <button onClick={() => setEntry(null)}>Operations Logbook</button> ›{" "}
            {entry.id
              ? `LOG-${String(entry.id).padStart(4, "0")}`
              : "Adding an entry"}
          </div>
          <div className="j5-tools">
            <strong>Detail</strong>
            <button disabled={busy} onClick={() => setEntry(null)}>
              <X />
              Back to list
            </button>
            <button
              disabled={busy || entry.message.trim().length < 3}
              onClick={save}
            >
              <Save />
              Save entry
            </button>
            <span className="j5-tools-end">
              Revision {entry.revision || "—"}{" "}
              <button onClick={() => window.print()}>
                <Printer />
                Print / PDF
              </button>
            </span>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <div className="j5-section-bar">▾ Operations Logbook</div>
            <div className="j5-entry-form">
              <fieldset disabled={busy} className="j5-entry-left">
                <label>
                  Event Time
                  <input
                    required
                    aria-label="Event Time"
                    type="datetime-local"
                    value={localInput(entry.event_time)}
                    onChange={(e) => {
                      if (e.target.value)
                        update({
                          event_time: new Date(e.target.value).toISOString(),
                        });
                    }}
                  />
                </label>
                <label>
                  Status
                  <select
                    aria-label="Status"
                    value={entry.status}
                    onChange={(e) => update({ status: e.target.value })}
                  >
                    {statuses.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Category
                  <select
                    aria-label="Category"
                    value={entry.category}
                    onChange={(e) => update({ category: e.target.value })}
                  >
                    {categories.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Priority
                  <select
                    aria-label="Priority"
                    value={entry.priority}
                    onChange={(e) => update({ priority: e.target.value })}
                  >
                    {priorities.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Site
                  <input readOnly value="Northbank Campus" />
                </label>
                <label>
                  Area
                  <select
                    aria-label="Area"
                    value={selectedAsset?.building_id || ""}
                    onChange={(e) =>
                      update({
                        asset_id:
                          data.assets.find(
                            (a) => a.building_id === e.target.value,
                          )?.id || "",
                      })
                    }
                  >
                    {data.buildings.map((b) => (
                      <option value={b.id} key={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Equipment
                  <select
                    aria-label="Equipment"
                    value={entry.asset_id}
                    onChange={(e) => update({ asset_id: e.target.value })}
                  >
                    {data.assets
                      .filter(
                        (a) => a.building_id === selectedAsset?.building_id,
                      )
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.id} · {a.name}
                        </option>
                      ))}
                  </select>
                </label>
              </fieldset>
              <div className="j5-entry-message">
                <div className="j5-pane-caption">Operational message</div>
                <RichText
                  html={entry.message_html}
                  text={entry.message}
                  disabled={busy}
                  onChange={(message_html, message) =>
                    update({ message_html, message })
                  }
                />
                {!!entry.id && (
                  <div className="j5-log-attachments">
                    <div className="j5-pane-caption">Attachments</div>
                    <label className="j5-upload-label">
                      Attach photographs or documents
                      <input
                        aria-label="Attach logbook files"
                        type="file"
                        accept=".png,.jpg,.jpeg,.webp,.pdf,.txt,.csv"
                        disabled={busy}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          e.target.value = "";
                          if (!file) return;
                          perform(async () => {
                            const form = new FormData();
                            form.append("file", file);
                            form.append("revision", String(entry.revision));
                            const saved = await api<Entry>(
                              `/logbook/${entry.id}/attachments`,
                              "POST",
                              form,
                            );
                            setEntry({
                              ...entry,
                              revision: saved.revision,
                              attachments: saved.attachments,
                              history: saved.history,
                            });
                            setNotice("Attachment saved.");
                          });
                        }}
                      />
                    </label>
                    <small>
                      PNG, JPEG, WebP, PDF, TXT or CSV · 10 MB per file
                    </small>
                    {entry.attachments?.map((a) => (
                      <div className="j5-attachment" key={a.id}>
                        <a
                          href={`/api/logbook/${entry.id}/attachments/${a.id}`}
                          download={a.filename}
                        >
                          {a.filename}
                        </a>
                        <small>
                          {(a.size / 1024).toFixed(1)} KB · {a.author}
                        </small>
                        <button
                          type="button"
                          disabled={busy}
                          aria-label={"Remove attachment " + a.filename}
                          onClick={() =>
                            perform(async () => {
                              const saved = await api<Entry>(
                                `/logbook/${entry.id}/attachments/${a.id}?revision=${entry.revision}`,
                                "DELETE",
                              );
                              setEntry({
                                ...entry,
                                revision: saved.revision,
                                attachments: saved.attachments,
                                history: saved.history,
                              });
                              setNotice(
                                "Attachment removed; history retained.",
                              );
                            })
                          }
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="j5-entry-meta">
                <dl>
                  <dt>Created By</dt>
                  <dd>{entry.author}</dd>
                  <dt>Group</dt>
                  <dd>Facilities operations</dd>
                  <dt>Time Created</dt>
                  <dd>{fmt(entry.created_at)}</dd>
                  <dt>Closed By</dt>
                  <dd>{entry.closed_by || "—"}</dd>
                  <dt>Time Closed</dt>
                  <dd>{entry.closed_at ? fmt(entry.closed_at) : "—"}</dd>
                </dl>
                <label className="j5-check">
                  <input
                    type="checkbox"
                    checked={entry.add_to_handover}
                    onChange={(e) =>
                      update({ add_to_handover: e.target.checked })
                    }
                  />
                  Add to Handover
                </label>
              </div>
            </div>
          </form>
          {!!entry.id && (
            <>
              <div className="j5-tools">
                <button onClick={() => setHistory(!history)}>
                  {history ? "Hide" : "Show"} Audit History (
                  {entry.history?.length || 0})
                </button>
                <button disabled={busy} onClick={() => open(entry.id)}>
                  <RefreshCw />
                  Reload saved entry
                </button>
              </div>
              {history && (
                <div className="j5-audit">
                  {entry.history?.map((h) => (
                    <details key={h.id}>
                      <summary>
                        {fmt(h.created_at)} · {h.actor} · {h.action}
                      </summary>
                      <pre>{JSON.stringify(h.detail, null, 2)}</pre>
                    </details>
                  ))}
                </div>
              )}
              <div className="j5-section-bar">Notes and flags</div>
              <div className="j5-note-form">
                <label>
                  Add note or flag
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    maxLength={5000}
                  />
                </label>
                <label className="j5-check">
                  <input
                    type="checkbox"
                    checked={isFlag}
                    onChange={(e) => setIsFlag(e.target.checked)}
                  />
                  Raise flag
                </label>
                <button
                  disabled={busy || !note.trim()}
                  onClick={() =>
                    perform(async () => {
                      const saved = await api<Entry>(
                        `/logbook/${entry.id}/notes`,
                        "POST",
                        { message: note, flagged: isFlag },
                      );
                      setEntry({
                        ...entry,
                        notes: saved.notes,
                        history: saved.history,
                      });
                      setNote("");
                      setNotice("Note added to the audit history.");
                      await load();
                    })
                  }
                >
                  <PlusCircle />
                  Add note
                </button>
              </div>
              <div className="j5-notes">
                {entry.notes?.map((n) => (
                  <article key={n.id}>
                    {n.flagged ? (
                      <Flag size={14} />
                    ) : (
                      <MessageSquare size={14} />
                    )}
                    <div>
                      <p>{n.message}</p>
                      <small>
                        {n.author} · {fmt(n.created_at)}
                      </small>
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}
        </>
      ) : (
        <>
          <div className="j5-tools">
            <button
              onClick={() => setFilters(!filters)}
              className={filters ? "active" : ""}
            >
              <Filter />
              Filters
            </button>
            <div className="j5-view-tabs">
              {["List", "Timeline", "Calendar"].map((v) => (
                <button
                  key={v}
                  className={view === v ? "active" : ""}
                  onClick={() => setView(v)}
                >
                  {v}
                </button>
              ))}
            </div>
            <form
              className="j5-search"
              onSubmit={(e) => {
                e.preventDefault();
                setSearch(query);
              }}
            >
              <input
                aria-label="Search logbook"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <button type="submit">Search</button>
            </form>
            <span className="j5-tools-end">
              <button onClick={() => setColumns(!columns)}>Columns ▾</button>
              <button onClick={exportCsv}>
                <Download />
                Export CSV
              </button>
              <button aria-label="Refresh logbook" onClick={load}>
                <RefreshCw />
              </button>
            </span>
          </div>
          {columns && (
            <div className="j5-column-picker">
              {[
                "Event Time",
                "Area",
                "Category",
                "Message",
                "Status",
                "Priority",
                "Notes",
              ].map((c) => (
                <label key={c} className="j5-check">
                  <input
                    type="checkbox"
                    checked={!hidden.includes(c)}
                    onChange={(e) =>
                      setHidden(
                        e.target.checked
                          ? hidden.filter((x) => x !== c)
                          : [...hidden, c],
                      )
                    }
                  />
                  {c}
                </label>
              ))}
            </div>
          )}
          {filters && (
            <>
              <div className="j5-filter-row">
                <button
                  className={!advanced ? "active" : ""}
                  onClick={() => setAdvanced(false)}
                >
                  Simple
                </button>
                <button
                  className={advanced ? "active" : ""}
                  onClick={() => setAdvanced(true)}
                >
                  Advanced
                </button>
                <button onClick={clear}>Clear Filters</button>
                <label>
                  Category
                  <select
                    aria-label="Filter category"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                  >
                    <option value="">All</option>
                    {categories.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Status
                  <select
                    aria-label="Filter status"
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                  >
                    <option value="">All</option>
                    {statuses.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Priority
                  <select
                    aria-label="Filter priority"
                    value={priority}
                    onChange={(e) => setPriority(e.target.value)}
                  >
                    <option value="">All</option>
                    {priorities.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Area
                  <select
                    aria-label="Filter area"
                    value={building}
                    onChange={(e) => {
                      setBuilding(e.target.value);
                      setAsset("");
                    }}
                  >
                    <option value="">All areas</option>
                    {data.buildings.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {advanced && (
                <div className="j5-filter-row j5-advanced">
                  <label>
                    Event time from
                    <input
                      type="date"
                      value={from}
                      onChange={(e) => setFrom(e.target.value)}
                    />
                  </label>
                  <label>
                    Event time to
                    <input
                      type="date"
                      value={to}
                      onChange={(e) => setTo(e.target.value)}
                    />
                  </label>
                  <label>
                    Equipment
                    <select
                      aria-label="Equipment"
                      value={asset}
                      onChange={(e) => setAsset(e.target.value)}
                    >
                      <option value="">All equipment</option>
                      {data.assets
                        .filter((a) => !building || a.building_id === building)
                        .map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.id}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    Created by
                    <input
                      value={author}
                      onChange={(e) => setAuthor(e.target.value)}
                    />
                  </label>
                  <label className="j5-check">
                    <input
                      type="checkbox"
                      checked={flagged}
                      onChange={(e) => setFlagged(e.target.checked)}
                    />
                    Flagged entries
                  </label>
                  <label className="j5-check">
                    <input
                      type="checkbox"
                      checked={handover}
                      onChange={(e) => setHandover(e.target.checked)}
                    />
                    Included in handover
                  </label>
                </div>
              )}
            </>
          )}
          <div className="j5-new-entry">
            {["New Entry", "Maintenance", "Downtime", "Lab"].map((c) => (
              <button
                key={c}
                onClick={() => create(c === "New Entry" ? "Operations" : c)}
              >
                <PlusCircle />
                {c}
              </button>
            ))}
            <a
              href="/j5-references/?category=Operations"
              target="_blank"
              rel="noreferrer"
            >
              Official screenshot ↗
            </a>
          </div>
          {view === "List" && (
            <div className="j5-log-table-scroll">
              <table className="j5-log-table">
                <thead>
                  <tr>
                    <th />
                    {!hidden.includes("Event Time") && (
                      <th>{sortable("event_time", "Event Time")}</th>
                    )}
                    {!hidden.includes("Area") && (
                      <th>{sortable("building_name", "Area")}</th>
                    )}
                    {!hidden.includes("Category") && (
                      <th>{sortable("category", "Category")}</th>
                    )}
                    {!hidden.includes("Message") && (
                      <th>{sortable("message", "Message")}</th>
                    )}
                    {!hidden.includes("Status") && (
                      <th>{sortable("status", "Status")}</th>
                    )}
                    {!hidden.includes("Priority") && (
                      <th>{sortable("priority", "Priority")}</th>
                    )}
                    {!hidden.includes("Notes") && <th>Notes</th>}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr key={r.id}>
                      <td className="j5-row-actions">
                        <button
                          aria-label={`Edit log entry ${r.id}`}
                          onClick={() => open(r.id)}
                        >
                          <Pencil size={14} />
                        </button>
                      </td>
                      {!hidden.includes("Event Time") && (
                        <td className="j5-date">
                          {fmt(r.event_time)}
                          <small>LOG-{String(r.id).padStart(4, "0")}</small>
                        </td>
                      )}
                      {!hidden.includes("Area") && (
                        <td>
                          {r.building_name}
                          <small>{r.asset_id}</small>
                        </td>
                      )}
                      {!hidden.includes("Category") && <td>{r.category}</td>}
                      {!hidden.includes("Message") && (
                        <td
                          className={
                            "j5-message priority-" + r.priority.toLowerCase()
                          }
                        >
                          <button onClick={() => open(r.id)}>
                            {r.message}
                          </button>
                        </td>
                      )}
                      {!hidden.includes("Status") && (
                        <td
                          className={
                            "j5-log-status status-" +
                            r.status.toLowerCase().replace(" ", "-")
                          }
                        >
                          {r.status}
                        </td>
                      )}
                      {!hidden.includes("Priority") && <td>{r.priority}</td>}
                      {!hidden.includes("Notes") && (
                        <td>
                          <button
                            className="j5-counts"
                            onClick={() => open(r.id)}
                          >
                            <Flag size={12} />
                            {r.flag_count}
                            <MessageSquare size={12} />
                            {r.note_count}
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {view === "Timeline" && (
            <div className="j5-timeline">
              {[
                ...new Set(
                  filtered.map((r) => new Date(r.event_time).toDateString()),
                ),
              ].map((day) => (
                <section key={day}>
                  <h3>{day}</h3>
                  {filtered
                    .filter(
                      (r) => new Date(r.event_time).toDateString() === day,
                    )
                    .map(renderEntry)}
                </section>
              ))}
            </div>
          )}
          {view === "Calendar" && (
            <>
              <div className="j5-calendar-tools">
                <button
                  aria-label="Previous month"
                  onClick={() =>
                    setMonth(
                      new Date(month.getFullYear(), month.getMonth() - 1, 1),
                    )
                  }
                >
                  <ChevronLeft />
                </button>
                <strong>
                  {month.toLocaleDateString("en-GB", {
                    month: "long",
                    year: "numeric",
                  })}
                </strong>
                <button
                  aria-label="Next month"
                  onClick={() =>
                    setMonth(
                      new Date(month.getFullYear(), month.getMonth() + 1, 1),
                    )
                  }
                >
                  <ChevronRight />
                </button>
                <button
                  onClick={() =>
                    setMonth(
                      new Date(
                        new Date().getFullYear(),
                        new Date().getMonth(),
                        1,
                      ),
                    )
                  }
                >
                  Today
                </button>
              </div>
              <div className="j5-calendar">
                {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
                  <strong key={d}>{d}</strong>
                ))}
                {Array.from({ length: 42 }, (_, i) => {
                  const d = new Date(
                    month.getFullYear(),
                    month.getMonth(),
                    i - ((month.getDay() + 6) % 7) + 1,
                  );
                  return (
                    <div
                      key={i}
                      className={
                        d.getMonth() === month.getMonth() ? "" : "outside"
                      }
                    >
                      <span>{d.getDate()}</span>
                      {filtered
                        .filter(
                          (r) =>
                            new Date(r.event_time).toDateString() ===
                            d.toDateString(),
                        )
                        .map(renderEntry)}
                    </div>
                  );
                })}
              </div>
            </>
          )}
          {!filtered.length && (
            <div className="j5-empty">
              {loading
                ? "Loading operational records…"
                : allCount
                  ? "No entries match these filters."
                  : "No operational entries yet. Use New Entry to record an event."}
            </div>
          )}
          <div className="j5-status">
            <span>
              {total} entries · {allCount} total
            </span>
            {view === "List" && (
              <span className="j5-tools-end">
                <button disabled={page === 0} onClick={() => setPage(page - 1)}>
                  Previous
                </button>
                Page {page + 1} of{" "}
                {Math.max(1, Math.ceil(total / (view === "List" ? 25 : 500)))}
                <button
                  disabled={(page + 1) * (view === "List" ? 25 : 500) >= total}
                  onClick={() => setPage(page + 1)}
                >
                  Next
                </button>
              </span>
            )}
          </div>
        </>
      )}
    </section>
  );
}
