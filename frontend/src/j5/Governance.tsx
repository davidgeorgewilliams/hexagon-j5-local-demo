import { useEffect, useState } from "react";
import { api } from "../api";
import type { Bootstrap } from "../types";
type Grant = {
  username: string;
  name: string;
  role: string;
  areas: string[] | null;
  access_revision: number;
};
export function Governance({ data }: { data: Bootstrap }) {
  const [users, setUsers] = useState<Grant[]>([]),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const load = () =>
    api<{ users: Grant[] }>("/access")
      .then((r) => setUsers(r.users))
      .catch((e) => setError(e.message));
  useEffect(() => {
    if (data.user.role === "administrator") void load();
  }, [data.user.username]);
  const patch = (username: string, areas: string[] | null) =>
    setUsers(users.map((u) => (u.username === username ? { ...u, areas } : u)));
  return (
    <div className="j5-governance">
      <h2>Publication policy</h2>
      <p>
        {data.release_policy?.review_required
          ? "Independent review is mandatory. Direct publication is rejected by the API, including administrator requests."
          : "Development mode: direct administrator publication is enabled by the server environment."}
      </p>
      <p>
        Draft → Submit → Review by a different person → Publish. Building-scoped
        releases affect new inspections only.
      </p>
      <h2>Operational area permissions</h2>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {data.user.role !== "administrator" ? (
        <p>Administrator access is required to manage grants.</p>
      ) : (
        <>
          <button onClick={load}>Refresh access grants</button>
          {users.map((u) => (
            <fieldset
              key={u.username}
              disabled={busy || u.role === "administrator"}
            >
              <legend>
                {u.name} · {u.role}
              </legend>
              <label>
                <input
                  aria-label={`${u.username} campus-wide access`}
                  type="checkbox"
                  checked={u.areas === null}
                  onChange={(e) =>
                    patch(u.username, e.target.checked ? null : [])
                  }
                />
                Campus-wide access
              </label>
              {u.areas !== null &&
                data.buildings.map((b) => (
                  <label className="j5-check" key={b.id}>
                    <input
                      aria-label={`${u.username} access ${b.name}`}
                      type="checkbox"
                      checked={u.areas!.includes(b.id)}
                      onChange={(e) =>
                        patch(
                          u.username,
                          e.target.checked
                            ? [...u.areas!, b.id]
                            : u.areas!.filter((id) => id !== b.id),
                        )
                      }
                    />
                    {b.name}
                  </label>
                ))}
              <button
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    const result = await api<Grant>(
                      `/access/${u.username}`,
                      "PUT",
                      { areas: u.areas, revision: u.access_revision },
                    );
                    setUsers((prev) =>
                      prev.map((x) => (x.username === u.username ? result : x)),
                    );
                    setMessage(
                      `Access saved for ${u.name}. Existing sessions use the new grants on their next request.`,
                    );
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Save {u.name} access
              </button>
            </fieldset>
          ))}
        </>
      )}
    </div>
  );
}
