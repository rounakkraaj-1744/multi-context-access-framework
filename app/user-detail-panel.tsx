"use client";
/* eslint-disable @typescript-eslint/no-explicit-any -- route payload has multiple documented history collections. */
import { useState } from "react";
type Props = {
  detail: any;
  close: () => void;
  superAdmin: boolean;
  message: (s: string) => void;
  refresh: () => void;
};
async function api(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
    cache: "no-store",
  });
  return response.json().catch(() => ({ error: { message: "Request failed." } }));
}
function format(value: string | null | undefined) {
  return value
    ? new Date(value).toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";
}
function sessionEnd(session: any) {
  if (session.reason === "EXPLICIT_LOGOUT") return `Explicit logout ${format(session.logout_at)}`;
  if (session.reason === "INACTIVITY_TIMEOUT")
    return `Expired ${format(session.logout_at ?? session.expires_at)}`;
  return session.logout_at
    ? `Revoked ${format(session.logout_at)} · ${session.reason ?? "administrative action"}`
    : "No explicit logout recorded";
}
export default function UserDetailPanel({ detail, close, superAdmin, message, refresh }: Props) {
  const [role, setRole] = useState("");
  const user = detail.user;
  async function mutate(payload: Record<string, string>) {
    if (
      ["suspend", "deactivate", "revoke-role"].includes(payload.action) &&
      !confirm(`Confirm ${payload.action} for ${user.name}?`)
    )
      return;
    const result = await api("/api/admin/users", {
      method: "PATCH",
      body: JSON.stringify({ userId: user.id, ...payload }),
    });
    message(result.error?.message ?? "Account access updated.");
    if (!result.error) refresh();
  }
  return (
    <div className="panel user-detail">
      <div className="panel-title user-detail-heading">
        <div>
          <div className="eyebrow">ACCOUNT DETAIL · {user.status}</div>
          <h2>{user.name}</h2>
          <p className="panel-subtitle">
            {user.email} · {user.department || "No department"} · {user.organization_id} ·{" "}
            {user.status}
          </p>
        </div>
        <button className="button secondary" onClick={close}>
          Close
        </button>
      </div>
      <div className="detail-metrics"><div className="detail-stat"><span>Today&apos;s sessions</span><b>{detail.daily?.sessions ?? 0}</b><small>{detail.daily?.active_sessions ?? 0} active</small></div><div className="detail-stat"><span>First login</span><b>{format(detail.daily?.first_login)}</b><small>First recorded session</small></div><div className="detail-stat"><span>Last explicit logout</span><b>{format(detail.daily?.last_explicit_logout)}</b><small>Account activity</small></div></div>
      <div className="detail-section">
      <h3>Assigned roles</h3>
      <div className="tag-list">
        {detail.roles.length ? detail.roles.map((item: any) => <span className="tag" key={item.name}>{item.name}{superAdmin && <button aria-label={`Revoke ${item.name}`} onClick={() => void mutate({ action: "revoke-role", role: item.name })}>×</button>}</span>) : <p>No roles assigned.</p>}
      </div>
      <h3>Effective permissions</h3>
      <div className="tag-list">{detail.permissions.length ? detail.permissions.map((item: any) => <span className="tag" key={item.code}>{item.code}</span>) : <p>No permissions assigned.</p>}</div>
      </div>
      {superAdmin && (
        <div className="detail-actions">
          <label>Assign a role<select value={role} onChange={(event) => setRole(event.target.value)}>
            <option value="">Assign role…</option>
            {["HR", "Backend Engineer", "DevOps Engineer", "Manager", "Admin", "Super Admin"].map(
              (name) => (
                <option key={name}>{name}</option>
              ),
            )}
          </select></label>
          <button
            className="button tiny primary"
            disabled={!role}
            onClick={() => void mutate({ action: "assign-role", role })}
          >
            Assign role
          </button>
          <button
            className="button tiny secondary"
            onClick={() =>
              void mutate({
                action: user.status === "ACTIVE" ? "suspend" : "reactivate",
                reason: "Authorized from user detail view",
              })
            }
          >
            {user.status === "ACTIVE" ? "Suspend" : "Reactivate"}
          </button>
          <button
            className="button tiny danger"
            onClick={() =>
              void mutate({ action: "deactivate", reason: "Authorized soft deactivation" })
            }
          >
            Deactivate
          </button>
        </div>
      )}
      <div className="detail-section"><h3>Session history</h3>
      {detail.sessions.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>LOGIN</th>
                <th>LAST SEEN</th>
                <th>LOGOUT / END</th>
                <th>STATUS / REASON</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              {detail.sessions.map((session: any) => (
                <tr key={session.id}>
                  <td>{format(session.login_at)}</td>
                  <td>{format(session.last_seen_at)}</td>
                  <td>{sessionEnd(session)}</td>
                  <td>
                    {session.status} · {session.reason ?? "—"}
                  </td>
                  <td>{session.ip_address ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p>No sessions recorded.</p>
      )}
      </div><div className="detail-section"><h3>Access decisions</h3>
      {detail.decisions.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>TIME</th>
                <th>RESOURCE / ACTION</th>
                <th>DECISION</th>
                <th>REASONS</th>
              </tr>
            </thead>
            <tbody>
              {detail.decisions.map((event: any) => (
                <tr key={event.id}>
                  <td>{format(event.created_at)}</td>
                  <td>
                    {event.resource} / {event.action}
                  </td>
                  <td>{event.decision}</td>
                  <td>{JSON.parse(event.reason_codes || "[]").join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p>No access events recorded.</p>
      )}
      </div><div className="detail-section"><h3>Context snapshots</h3>
      {detail.snapshots.length ? (
        detail.snapshots.map((snapshot: any) => (
          <details key={snapshot.id}>
            <summary>
              {format(snapshot.observed_at)} · {snapshot.source}
            </summary>
            <pre>{JSON.stringify(JSON.parse(snapshot.context), null, 2)}</pre>
          </details>
        ))
      ) : (
        <p>No context recorded.</p>
      )}
      </div><div className="detail-section"><h3>Behavior alerts</h3>
      {detail.behaviorAlerts?.length ? (
        detail.behaviorAlerts.map((alert: any) => (
          <details key={alert.id}>
            <summary>
              {alert.severity} · {alert.rule_id} · {alert.status} · {format(alert.created_at)}
            </summary>
            <p>{alert.trigger_condition}</p>
            <pre>{JSON.stringify(JSON.parse(alert.evidence), null, 2)}</pre>
          </details>
        ))
      ) : (
        <p>No behavior alerts recorded.</p>
      )}
      </div><div className="detail-section"><h3>Related incidents</h3>
      {detail.incidents?.length ? (
        detail.incidents.map((incident: any) => (
          <details key={incident.id}>
            <summary>
              {incident.severity} · {incident.status} · {incident.reason}
            </summary>
            <p>
              Opened {format(incident.created_at)} · Updated {format(incident.updated_at)}
            </p>
            <pre>{JSON.stringify(JSON.parse(incident.evidence), null, 2)}</pre>
            <p>{incident.resolution ?? "No resolution recorded."}</p>
          </details>
        ))
      ) : (
        <p>No incidents recorded.</p>
      )}
      </div><div className="detail-section"><h3>Administrative history</h3>
      {detail.events.map((event: any) => (
        <div className="profile-row" key={event.id}>
          <span>
            {event.event_type} · {format(event.created_at)}
          </span>
          <b>{event.details}</b>
        </div>
      ))}
      </div>
    </div>
  );
}
