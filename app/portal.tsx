"use client";
/* eslint-disable @typescript-eslint/no-explicit-any -- role-specific API payloads are rendered in this compact portal component. */
import { useState } from "react";
import Link from "next/link";
import UserDetailPanel from "@/app/user-detail-panel";
type Actor = {
  id: string;
  name: string;
  email: string;
  status: string;
  roles: string[];
  permissions: string[];
} | null;
type Resource = { id: string; title: string; resource_type: string; classification: string };
type Notice = {
  id: string;
  title: string;
  summary: string;
  created_at: string;
  read_at: string | null;
};
type ApiResult = { data?: any; error?: { code: string; message: string } };
const glyph: Record<string, string> = {
  Overview: "◫",
  People: "♙",
  Approvals: "✓",
  Sessions: "◷",
  Decisions: "⌁",
  Alerts: "!",
  Incidents: "⚑",
  "Context lab": "⌘",
  Audit: "≡",
  Resources: "▤",
  Profile: "◎",
  Notifications: "♧",
  "Access history": "⌁",
  Roles: "♙",
  Permissions: "✓",
  Policies: "⌘",
  "MCAC drafts": "⌘",
  "Permission requests": "✓",
};
const adminNav = [
  "Overview",
  "People",
  "Approvals",
  "Permission requests",
  "Sessions",
  "Decisions",
  "Alerts",
  "Incidents",
  "Context lab",
  "Audit",
];
const superNav = [
  "Overview",
  "People",
  "Approvals",
  "Permission requests",
  "Sessions",
  "Decisions",
  "Alerts",
  "Incidents",
  "Roles",
  "Permissions",
  "Policies",
  "MCAC drafts",
  "Context lab",
  "Audit",
];
const userNav = ["Overview", "Resources", "Access history", "Profile", "Notifications"];
async function api(url: string, init?: RequestInit): Promise<ApiResult> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
    cache: "no-store",
  });
  return res.json().catch(() => ({ error: { code: "ERROR", message: "Request failed." } }));
}
export default function Portal({
  actor,
  resources,
  notices,
}: {
  actor: Actor;
  resources: Resource[];
  notices: Notice[];
}) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [section, setSection] = useState("Overview");
  const [data, setData] = useState<any>(null);
  const [flash, setFlash] = useState("");
  const [busy, setBusy] = useState(false);
  const role = actor?.roles.includes("Super Admin")
    ? "Super Admin"
    : actor?.roles.includes("Admin")
      ? "Admin"
      : "User";
  const nav = role === "Super Admin" ? superNav : role === "Admin" ? adminNav : userNav;
  function message(m: string) {
    setFlash(m);
    setTimeout(() => setFlash(""), 4500);
  }
  async function load(target = section) {
    setBusy(true);
    let endpoint = "/api/user";
    if (target === "Overview" && role !== "User") endpoint = "/api/admin/overview";
    else if (target === "People" || target === "Approvals") endpoint = "/api/admin/users";
    else if (target === "Permission requests") endpoint = "/api/user/permission-requests";
    else if (target === "Sessions") endpoint = "/api/admin/sessions";
    else if (target === "Decisions") endpoint = "/api/admin/overview";
    else if (target === "Alerts") endpoint = "/api/admin/alerts";
    else if (target === "Incidents") endpoint = "/api/admin/incidents";
    else if (target === "Audit") endpoint = "/api/admin/audit";
    else if (target === "Context lab") endpoint = "/api/admin/scenarios";
    else if (target === "Roles") endpoint = "/api/admin/roles";
    else if (target === "Permissions") endpoint = "/api/admin/permissions";
    else if (target === "Policies") endpoint = "/api/admin/policies";
    else if (target === "MCAC drafts") endpoint = "/api/admin/mcac-policies";
    const result = await api(endpoint);
    setData(result.data ?? null);
    if (result.error) message(result.error.message);
    setBusy(false);
  }
  async function enter(name: string) {
    setSection(name);
    setData(null);
    void load(name);
  }
  async function submitAuth(form: FormData) {
    setBusy(true);
    const url = mode === "login" ? "/api/auth/login" : "/api/auth/register";
    const payload = Object.fromEntries(form.entries());
    const result = await api(url, { method: "POST", body: JSON.stringify(payload) });
    setBusy(false);
    message(result.data?.message ?? result.error?.message ?? "Done");
    if (mode === "login" && !result.error) location.reload();
  }
  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    location.reload();
  }
  async function markRead(notificationId: string) {
    const result = await api("/api/notifications", {
      method: "PATCH",
      body: JSON.stringify({ id: notificationId }),
    });
    if (result.error) message(result.error.message);
    else void load();
  }
  async function decide(userId: string, action: "approve" | "reject") {
    const reason = action === "reject" ? (prompt("Reason for rejection (required):") ?? "") : "";
    if (action === "reject" && !reason.trim()) return;
    const result = await api("/api/admin/users", {
      method: "PATCH",
      body: JSON.stringify({ userId, action, reason, role: "Backend Engineer" }),
    });
    message(result.error?.message ?? `Registration ${action}d.`);
    void load();
  }
  async function access(resourceId: string, scenario?: string) {
    const payload = { resourceId, action: "read", scenario };
    let result = await api("/api/access", { method: "POST", body: JSON.stringify(payload) });
    if (result.data?.decision === "STEP_UP_AUTH" && result.data?.requestId) {
      const password = prompt(
        "Additional verification is required. Re-enter your password to continue:",
      );
      if (!password) return;
      const verified = await api("/api/access/step-up", {
        method: "POST",
        body: JSON.stringify({ requestId: result.data.requestId, password }),
      });
      if (verified.error) {
        message(verified.error.message);
        return;
      }
      result = await api("/api/access", { method: "POST", body: JSON.stringify(payload) });
    }
    if (result.data?.decision === "ALLOW") message(`Allowed: ${result.data.resource.title}`);
    else
      message(
        `${result.data?.decision ?? result.error?.code}: ${result.data?.explanation ?? result.error?.message ?? "Access unavailable"}`,
      );
  }
  async function scenarios() {
    setBusy(true);
    const result = await api("/api/admin/scenarios", { method: "POST" });
    setData((old: any) => ({ ...old, ...result.data }));
    setBusy(false);
    message(result.error?.message ?? "Scenario run completed.");
  }
  if (!actor)
    return (
      <main className="auth-shell">
        <aside className="auth-aside">
          <Link href="/" className="brand">
            <span className="brand-mark">M</span>
            <span>
              MCAF <small>ACCESS FRAMEWORK</small>
            </span>
          </Link>
          <div className="auth-pitch">
            <div className="eyebrow">IDENTITY · CONTEXT · ACCESS</div>
            <h1>Access that understands the moment.</h1>
            <p>
              One secure workspace for identity, permissions, and contextual decisions across your
              organization.
            </p>
            <div className="trust-row">
              <span className="trust-dot" /> Policy engine online{" "}
              <span className="trust-sep">·</span> SQLite connected
            </div>
          </div>
          <div className="auth-footer">
            ADAPTIVE MULTI-CONTEXT ACCESS FRAMEWORK <span>v1.0.0</span>
          </div>
        </aside>
        <section className="auth-main">
          <div className="auth-card">
            <div className="mobile-brand">
              <span className="brand-mark">M</span> MCAF
            </div>
            <div className="eyebrow">WELCOME TO MCAF</div>
            <h2>{mode === "login" ? "Sign in to your workspace" : "Request an account"}</h2>
            <p className="muted">
              {mode === "login"
                ? "Enter your details to continue securely."
                : "Your access will be reviewed by an administrator."}
            </p>
            <form action={(fd) => void submitAuth(fd)} className="stack-form">
              {mode === "register" && (
                <label>
                  Full name
                  <input name="name" required minLength={2} placeholder="Alex Morgan" />
                </label>
              )}
              <label>
                Work email
                <input name="email" type="email" required placeholder="you@company.com" />
              </label>
              {mode === "register" && (
                <>
                  <label>
                    Department
                    <input name="department" placeholder="Engineering" />
                  </label>
                  <label>
                    Job title
                    <input name="jobTitle" placeholder="Software Engineer" />
                  </label>
                  <label>
                    Requested role
                    <select name="requestedRole">
                      <option value="">Select a role (optional)</option>
                      <option>HR</option>
                      <option>Backend Engineer</option>
                      <option>DevOps Engineer</option>
                      <option>Manager</option>
                    </select>
                  </label>
                </>
              )}
              <label>
                Password
                <input
                  name="password"
                  type="password"
                  required
                  minLength={mode === "register" ? 12 : 1}
                  placeholder={mode === "register" ? "At least 12 characters" : "Enter password"}
                />
              </label>
              <button className="button primary full" disabled={busy}>
                {busy
                  ? "Please wait…"
                  : mode === "login"
                    ? "Sign in securely"
                    : "Submit registration"}
                <span>→</span>
              </button>
            </form>
            <div className="switch-auth">
              {mode === "login" ? "New to the workspace?" : "Already have access?"}{" "}
              <button onClick={() => setMode(mode === "login" ? "register" : "login")}>
                {mode === "login" ? "Request access" : "Sign in"}
              </button>
            </div>
            <div className="auth-note">
              <span>◈</span> Protected by server-side session verification
            </div>
          </div>
        </section>
        {flash && (
          <div className="toast">
            {flash}
            <button onClick={() => setFlash("")}>×</button>
          </div>
        )}
      </main>
    );
  const content = () => {
    if (section === "Overview" && role === "User")
      return (
        <>
          <header className="page-heading">
            <div>
              <div className="eyebrow">YOUR WORKSPACE</div>
              <h1>Good day, {actor.name.split(" ")[0]}</h1>
              <p>Here’s the latest on your account and access.</p>
            </div>
            <div className="heading-chip">
              <span className="trust-dot" /> Account {actor.status.toLowerCase()}
            </div>
          </header>
          <div className="metric-grid">
            <Metric label="Account status" value={actor.status} icon="◎" tone="green" />
            <Metric
              label="Active sessions"
              value={String(data?.sessions?.filter((s: any) => s.status === "ACTIVE").length ?? 0)}
              icon="◷"
            />
            <Metric label="Your roles" value={String(actor.roles.length)} icon="♙" />
            <Metric
              label="Notifications"
              value={String(notices.filter((n) => !n.read_at).length)}
              icon="♧"
              tone="blue"
            />
          </div>
          <div className="two-col">
            <div className="panel">
              <PanelTitle
                title="Effective permissions"
                action="View profile"
                onAction={() => enter("Profile")}
              />
              <div className="permission-list">
                {actor.permissions.length ? (
                  actor.permissions.map((p) => (
                    <div className="permission-row" key={p}>
                      <span className="permission-check">✓</span>
                      <span>{p.replaceAll(":", " · ")}</span>
                      <span className="status-pill approved">Active</span>
                    </div>
                  ))
                ) : (
                  <Empty text="No permissions have been assigned yet." />
                )}
              </div>
            </div>
            <div className="panel">
              <PanelTitle
                title="Recent notifications"
                action="View all"
                onAction={() => enter("Notifications")}
              />
              <NoticeList notices={notices.slice(0, 4)} onRead={markRead} />
            </div>
          </div>
          <div className="panel">
            <PanelTitle
              title="Protected resources"
              action="Browse all"
              onAction={() => enter("Resources")}
            />
            <ResourceCards resources={resources} onAccess={access} />
          </div>
        </>
      );
    if (section === "Resources")
      return (
        <>
          <PageHeading
            label="SECURE CONTENT"
            title="Protected resources"
            subtitle="Each request is evaluated against your permissions and current context."
          />
          <div className="resource-grid">
            <ResourceCards resources={resources} onAccess={access} />
          </div>
          <div className="info-callout">
            <span>ⓘ</span>
            <div>
              <b>Context-aware access</b>
              <p>
                Your access decision uses your role permissions and server-observed session context.
                Decisions are recorded for review.
              </p>
            </div>
          </div>
        </>
      );
    if (section === "Profile")
      return (
        <>
          <PageHeading
            label="ACCOUNT"
            title="Your profile"
            subtitle="Your identity, approved roles, and effective access."
          />
          <div className="two-col">
            <div className="panel">
              <PanelTitle title="Profile details" />
              <ProfileRow label="Email address" value={actor.email} />
              <ProfileRow label="Account status" value={actor.status} />
              <ProfileRow label="Assigned roles" value={actor.roles.join(", ") || "None"} />
              <form
                className="request-form"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const form = e.currentTarget;
                  const result = await api("/api/user", {
                    method: "PATCH",
                    body: JSON.stringify(Object.fromEntries(new FormData(form))),
                  });
                  message(result.error?.message ?? "Profile updated.");
                  if (!result.error) location.reload();
                }}
              >
                <label>
                  Full name
                  <input
                    name="name"
                    required
                    minLength={2}
                    maxLength={100}
                    defaultValue={data?.user?.name ?? actor.name}
                  />
                </label>
                <label>
                  Department
                  <input
                    name="department"
                    maxLength={100}
                    defaultValue={data?.user?.department ?? ""}
                  />
                </label>
                <label>
                  Job title
                  <input
                    name="jobTitle"
                    maxLength={100}
                    defaultValue={data?.user?.job_title ?? ""}
                  />
                </label>
                <button className="button secondary">Save profile</button>
              </form>
            </div>
            <div className="panel">
              <PanelTitle title="Effective permissions" />
              {actor.permissions.map((p) => (
                <div className="tag" key={p}>
                  {p}
                </div>
              ))}
              <form
                className="request-form"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  const result = await api("/api/user/permission-requests", {
                    method: "POST",
                    body: JSON.stringify(Object.fromEntries(f)),
                  });
                  message(result.error?.message ?? "Permission request submitted.");
                  e.currentTarget.reset();
                }}
              >
                <label>
                  Request another permission
                  <select name="permissionCode" required>
                    <option value="">Choose permission</option>
                    {[
                      "resources:project:read",
                      "resources:engineering:read",
                      "resources:hr:read",
                      "resources:deployment:read",
                      "resources:team:read",
                    ].map((p) => (
                      <option key={p}>{p}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Business reason
                  <textarea
                    name="reason"
                    minLength={10}
                    required
                    placeholder="Explain the work this access supports…"
                  />
                </label>
                <button className="button secondary">Submit request</button>
              </form>
            </div>
          </div>
          <div className="panel">
            <PanelTitle title="Session history" />
            {data?.sessions?.length ? (
              <SessionTable rows={data.sessions} />
            ) : (
              <Empty text="Your session history will appear here." />
            )}
          </div>
        </>
      );
    if (section === "Notifications")
      return (
        <>
          <PageHeading
            label="UPDATES"
            title="Notifications"
            subtitle="Messages and decisions related to your account."
          />
          <div className="panel">
            <NoticeList notices={data?.notifications ?? notices} onRead={markRead} />
          </div>
        </>
      );
    if (section === "Access history" && role === "User")
      return (
        <>
          <PageHeading
            label="ACCOUNT ACTIVITY"
            title="Your access history"
            subtitle="Your own authorization requests and their server-side explanations."
          />
          <div className="panel">
            <PanelTitle title="Recent access decisions" />
            <DecisionTable
              rows={(data?.decisions ?? []).map((item: any) => ({ ...item, user_name: "You" }))}
            />
          </div>
          <div className="panel">
            <PanelTitle title="Permission request status" />
            {data?.permissionRequests?.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>PERMISSION</th>
                      <th>BUSINESS REASON</th>
                      <th>STATUS</th>
                      <th>REVIEW</th>
                      <th>SUBMITTED</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.permissionRequests.map((item: any) => (
                      <tr key={item.id}>
                        <td>{item.permission_code}</td>
                        <td>{item.reason}</td>
                        <td>
                          <span
                            className={`status-pill ${item.status === "APPROVED" ? "approved" : item.status === "PENDING" ? "pending" : "muted-pill"}`}
                          >
                            {item.status}
                          </span>
                        </td>
                        <td>{item.review_reason ?? "—"}</td>
                        <td>{date(item.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty text="You have not requested additional permissions." />
            )}
          </div>
        </>
      );
    if (section === "Overview") return <AdminOverview data={data} onAction={enter} />;
    if (section === "People" || section === "Approvals")
      return (
        <PeoplePanel
          data={data}
          section={section}
          onDecision={decide}
          onLoad={load}
          superAdmin={role === "Super Admin"}
          message={message}
        />
      );
    if (section === "Sessions")
      return (
        <>
          <PageHeading
            label="IDENTITY OPERATIONS"
            title="Session monitoring"
            subtitle="Explicit logout and inactivity expiry are recorded separately."
          />
          <div className="panel">
            <PanelTitle title="Recent sessions" />
            <SessionTable rows={data?.sessions ?? []} />
          </div>
        </>
      );
    if (section === "Decisions")
      return (
        <>
          <PageHeading
            label="AUTHORIZATION"
            title="Access decisions"
            subtitle="Server-side contextual evaluations across protected resources."
          />
          <div className="panel">
            <PanelTitle title="Recent evaluations" />
            <DecisionTable rows={data?.recent ?? []} />
          </div>
        </>
      );
    if (section === "Incidents")
      return (
        <IncidentsPanel
          data={data}
          message={message}
          reload={load}
          superAdmin={role === "Super Admin"}
        />
      );
    if (section === "Alerts")
      return <AlertsPanel data={data} message={message} reload={load} onAction={enter} />;
    if (section === "Permission requests")
      return <PermissionRequestsPanel data={data} message={message} reload={() => load(section)} />;
    if (["Roles", "Permissions", "Policies"].includes(section))
      return (
        <ManagementPanel
          section={section}
          data={data}
          message={message}
          reload={() => load(section)}
        />
      );
    if (section === "Audit")
      return (
        <>
          <PageHeading
            label="GOVERNANCE"
            title="Audit trail"
            subtitle="Append-only record of administrative and access actions."
          />
          <div className="panel">
            <PanelTitle title="Recent activity" />
            <AuditTable rows={data?.events ?? []} />
          </div>
        </>
      );
    if (section === "MCAC drafts")
      return <McacDraftPanel data={data} message={message} reload={() => load(section)} />;
    return <ScenarioPanel data={data} onRun={scenarios} busy={busy} />;
  };
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link href="/" className="brand">
          <span className="brand-mark">M</span>
          <span>
            MCAF <small>ACCESS FRAMEWORK</small>
          </span>
        </Link>
        <div className="workspace-label">WORKSPACE</div>
        <div className="nav-list">
          {nav.map((n) => (
            <button
              key={n}
              onClick={() => void enter(n)}
              className={`nav-item ${section === n ? "selected" : ""}`}
            >
              <span className="nav-icon">{glyph[n]}</span>
              {n}
              {n === "Approvals" && data?.pending > 0 && (
                <span className="nav-count">{data.pending}</span>
              )}
            </button>
          ))}
        </div>
        <div className="sidebar-bottom">
          <div className="sidebar-secure">
            <div className="secure-icon">◈</div>
            <b>Protected workspace</b>
            <p>Your activity is secured and audited.</p>
            <span>
              <i /> ALL SYSTEMS OPERATIONAL
            </span>
          </div>
          <div className="profile-mini">
            <div className="avatar">
              {actor.name
                .split(" ")
                .map((s) => s[0])
                .slice(0, 2)
                .join("")}
            </div>
            <div className="profile-label">
              <b>{actor.name}</b>
              <span>{role}</span>
            </div>
            <button onClick={() => void logout()} aria-label="Sign out" className="icon-button">
              ↗
            </button>
          </div>
        </div>
      </aside>
      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumb">
            <span>MCAF</span>
            <b>/</b> {section}
          </div>
          <div className="topbar-right">
            <span className="environment-badge">
              <i /> Live workspace
            </span>
            <button
              className="icon-button notification-button"
              onClick={() => void enter("Notifications")}
            >
              ♧{notices.some((n) => !n.read_at) && <i />}
            </button>
            <div className="top-avatar">{actor.name[0]}</div>
          </div>
        </header>
        <div className="page-content">{content()}</div>
      </main>
    </div>
  );
}
function Metric({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: string;
  icon: string;
  tone?: string;
}) {
  return (
    <div className="metric-card">
      <div className={`metric-icon ${tone ?? ""}`}>{icon}</div>
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      <div className="metric-foot">
        Updated just now <span>↗</span>
      </div>
    </div>
  );
}
function PageHeading({
  label,
  title,
  subtitle,
}: {
  label: string;
  title: string;
  subtitle: string;
}) {
  return (
    <header className="page-heading">
      <div>
        <div className="eyebrow">{label}</div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      <div className="heading-date">
        ◷ &nbsp;
        {new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" }).format(
          new Date(),
        )}
      </div>
    </header>
  );
}
function PanelTitle({
  title,
  action,
  onAction,
}: {
  title: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="panel-title">
      <h2>{title}</h2>
      {action && (
        <button className="text-action" onClick={onAction}>
          {action} <span>→</span>
        </button>
      )}
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return (
    <div className="empty-state">
      <span>⌁</span>
      <b>Nothing to show yet</b>
      <p>{text}</p>
    </div>
  );
}
function NoticeList({ notices, onRead }: { notices: Notice[]; onRead?: (id: string) => void }) {
  return notices.length ? (
    <div className="notice-list">
      {notices.map((n) => (
        <div className="notice-row" key={n.id}>
          <span className="notice-icon">♧</span>
          <div>
            <b>{n.title}</b>
            <p>{n.summary}</p>
            <time>
              {new Date(n.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}
            </time>
          </div>
          {!n.read_at && (
            <>
              {onRead && (
                <button className="text-action" onClick={() => onRead(n.id)}>
                  Mark read
                </button>
              )}
              <i className="unread-dot" />
            </>
          )}
        </div>
      ))}
    </div>
  ) : (
    <Empty text="You're all caught up." />
  );
}
function ResourceCards({
  resources,
  onAccess,
}: {
  resources: Resource[];
  onAccess: (id: string) => void;
}) {
  return resources.length ? (
    <div className="resource-cards">
      {resources.map((r) => (
        <div className="resource-card" key={r.id}>
          <div className="resource-card-top">
            <span className="resource-icon">▤</span>
            <span className="classification">{r.classification}</span>
          </div>
          <h3>{r.title}</h3>
          <p>{r.resource_type} resource · evaluated per request</p>
          <button className="resource-open" onClick={() => onAccess(r.id)}>
            Request access <span>→</span>
          </button>
        </div>
      ))}
    </div>
  ) : (
    <Empty text="No protected resources have been configured." />
  );
}
function ProfileRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="profile-row">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}
function sessionEnd(s: any) {
  if (s.reason === "EXPLICIT_LOGOUT") return `Explicit logout ${date(s.logout_at)}`;
  if (s.reason === "INACTIVITY_TIMEOUT") return `Expired ${date(s.logout_at ?? s.expires_at)}`;
  if (s.logout_at) return `Revoked ${date(s.logout_at)} · ${s.reason ?? "administrative action"}`;
  return s.status === "ACTIVE" ? "No explicit logout" : "No explicit logout recorded";
}
function SessionTable({ rows }: { rows: any[] }) {
  return rows.length ? (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>SESSION</th>
            <th>LOGIN</th>
            <th>LAST SEEN</th>
            <th>LOGOUT / END</th>
            <th>STATUS</th>
            <th>IP ADDRESS</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.id}>
              <td className="mono">{s.id.slice(0, 8)}</td>
              <td>{date(s.login_at)}</td>
              <td>{date(s.last_seen_at)}</td>
              <td>{sessionEnd(s)}</td>
              <td>
                <span
                  className={`status-pill ${s.status === "ACTIVE" ? "approved" : "muted-pill"}`}
                >
                  {s.status}
                </span>
              </td>
              <td className="mono">{s.ip_address ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <Empty text="No session records are available." />
  );
}
function DecisionTable({ rows }: { rows: any[] }) {
  return rows.length ? (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>USER</th>
            <th>RESOURCE</th>
            <th>ACTION</th>
            <th>DECISION</th>
            <th>REASON</th>
            <th>TIME</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((d: any) => (
            <tr key={d.id}>
              <td>{d.user_name ?? d.user_id?.slice(0, 8) ?? "Unknown"}</td>
              <td>{d.resource}</td>
              <td>{d.action}</td>
              <td>
                <span className={`status-pill ${d.decision === "ALLOW" ? "approved" : "denied"}`}>
                  {d.decision}
                </span>
              </td>
              <td>{JSON.parse(d.reason_codes || "[]").join(", ")}</td>
              <td>{date(d.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <Empty text="Access decisions will appear as users request protected resources." />
  );
}
function AuditTable({ rows }: { rows: any[] }) {
  return rows.length ? (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>EVENT</th>
            <th>ACTOR</th>
            <th>TARGET</th>
            <th>DETAILS</th>
            <th>TIME</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e: any) => (
            <tr key={e.id}>
              <td>
                <span className="event-name">{e.event_type}</span>
              </td>
              <td>{e.actor_name ?? "System"}</td>
              <td className="mono">{e.target_id?.slice(0, 12) ?? "—"}</td>
              <td className="muted-cell">{e.details}</td>
              <td>{date(e.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <Empty text="Administrative and authorization events will be recorded here." />
  );
}
function PeoplePanel({
  data,
  section,
  onDecision,
  onLoad,
  superAdmin,
  message,
}: {
  data: any;
  section: string;
  onDecision: (id: string, a: "approve" | "reject") => void;
  onLoad: () => void;
  superAdmin: boolean;
  message: (s: string) => void;
}) {
  const [q, setQ] = useState("");
  const [detail, setDetail] = useState<any>(null);
  async function inspect(userId: string) {
    const result = await api(`/api/admin/users/${userId}`);
    setDetail(result.data ?? null);
    if (result.error) message(result.error.message);
  }
  const rows = (data?.users ?? [])
    .filter((u: any) =>
      `${u.name} ${u.email} ${u.department}`.toLowerCase().includes(q.toLowerCase()),
    )
    .filter((u: any) => section !== "Approvals" || u.status === "PENDING");
  return (
    <>
      <PageHeading
        label={section === "Approvals" ? "REVIEW QUEUE" : "IDENTITY OPERATIONS"}
        title={section === "Approvals" ? "Registration approvals" : "People directory"}
        subtitle={
          section === "Approvals"
            ? "Review requested access and approve only roles within your authority."
            : "Search users and review their account state and assigned roles."
        }
      />
      {detail && (
        <UserDetailPanel
          detail={detail}
          close={() => setDetail(null)}
          superAdmin={superAdmin}
          message={message}
          refresh={async () => {
            await inspect(detail.user.id);
            onLoad();
          }}
        />
      )}
      <div className="panel">
        <div className="table-controls">
          <div className="search-box">
            <span>⌕</span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search people or department…"
            />
          </div>
          <select
            className="filter-select"
            onChange={async (e) => {
              await api(`/api/admin/users?status=${e.target.value}`);
              onLoad();
            }}
          >
            <option value="">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="PENDING">Pending</option>
            <option value="SUSPENDED">Suspended</option>
          </select>
          <button className="button secondary" onClick={onLoad}>
            ↻ Refresh
          </button>
        </div>
        {rows.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>PERSON</th>
                  <th>DEPARTMENT</th>
                  <th>REQUESTED / ASSIGNED ROLE</th>
                  <th>STATUS</th>
                  <th>REGISTERED</th>
                  <th>DETAILS</th>
                  {section === "Approvals" && <th>ACTION</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((u: any) => (
                  <tr key={u.id}>
                    <td>
                      <div className="person-cell">
                        <div className="avatar small">
                          {u.name
                            .split(" ")
                            .map((x: string) => x[0])
                            .slice(0, 2)
                            .join("")}
                        </div>
                        <div>
                          <b>{u.name}</b>
                          <span>{u.email}</span>
                        </div>
                      </div>
                    </td>
                    <td>{u.department || "—"}</td>
                    <td>
                      {u.status === "PENDING"
                        ? u.requested_role || "No request"
                        : u.roles || "No assigned role"}
                    </td>
                    <td>
                      <span
                        className={`status-pill ${u.status === "ACTIVE" ? "approved" : u.status === "PENDING" ? "pending" : "muted-pill"}`}
                      >
                        {u.status}
                      </span>
                    </td>
                    <td>{date(u.created_at)}</td>
                    <td>
                      <button className="button tiny secondary" onClick={() => void inspect(u.id)}>
                        View
                      </button>
                    </td>
                    {section === "Approvals" && (
                      <td>
                        <div className="row-actions">
                          <button
                            className="button tiny primary"
                            onClick={() => onDecision(u.id, "approve")}
                          >
                            Approve
                          </button>
                          <button
                            className="button tiny danger"
                            onClick={() => onDecision(u.id, "reject")}
                          >
                            Reject
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            text={
              section === "Approvals"
                ? "No registrations are awaiting review."
                : "No matching users found."
            }
          />
        )}
        <div className="table-footer">
          Showing {rows.length} {rows.length === 1 ? "person" : "people"}
          <span>Shared organization directory</span>
        </div>
      </div>
    </>
  );
}
function AdminOverview({ data, onAction }: { data: any; onAction: (section: string) => void }) {
  return (
    <>
      <PageHeading
        label="ADMINISTRATION · OVERVIEW"
        title="Workspace overview"
        subtitle="A live view of identity activity and authorization health."
      />
      <div className="metric-grid">
        <Metric label="Total users" value={String(data?.users ?? 0)} icon="♙" />
        <Metric
          label="Pending registrations"
          value={String(data?.pending ?? 0)}
          icon="◷"
          tone="amber"
        />
        <Metric
          label="Active sessions"
          value={String(data?.activeSessions ?? 0)}
          icon="⌁"
          tone="blue"
        />
        <Metric label="Open incidents" value={String(data?.incidents ?? 0)} icon="⚑" tone="red" />
      </div>
      <div className="metric-grid compact-metrics">
        <Metric label="Denied requests" value={String(data?.denied ?? 0)} icon="⊘" tone="red" />
        <Metric label="Step-up required" value={String(data?.stepUp ?? 0)} icon="⤴" tone="amber" />
        <Metric
          label="Open behavior alerts"
          value={String(data?.alerts ?? 0)}
          icon="!"
          tone="amber"
        />
      </div>
      <div className="two-col">
        <div className="panel">
          <PanelTitle
            title="Recent access decisions"
            action="View decisions"
            onAction={() => onAction("Decisions")}
          />
          <DecisionTable rows={data?.recent ?? []} />
        </div>
        <div className="panel">
          <PanelTitle
            title="Administrative activity"
            action="View audit log"
            onAction={() => onAction("Audit")}
          />
          <AuditTable rows={data?.audit ?? []} />
        </div>
      </div>
    </>
  );
}
function AlertsPanel({
  data,
  message,
  reload,
  onAction,
}: {
  data: any;
  message: (s: string) => void;
  reload: () => void;
  onAction: (section: string) => void;
}) {
  const alerts = data?.alerts ?? [];
  async function act(alertId: string, action: "acknowledge" | "investigate") {
    const result = await api("/api/admin/alerts", {
      method: "PATCH",
      body: JSON.stringify({ alertId, action }),
    });
    message(result.error?.message ?? `Alert ${action}d.`);
    reload();
  }
  return (
    <>
      <PageHeading
        label="BEHAVIOR MONITORING"
        title="Behavior alerts"
        subtitle="Deterministic findings with persisted evidence. Alerts are investigation signals, not conclusions."
      />
      <div className="panel">
        <PanelTitle
          title="Recent rule findings"
          action="View incidents"
          onAction={() => onAction("Incidents")}
        />
        {alerts.length ? (
          <div className="incident-list">
            {alerts.map((a: any) => (
              <article className="incident-item" key={a.id}>
                <div className="incident-severity">
                  !<small>{a.severity}</small>
                </div>
                <div className="incident-body">
                  <div className="incident-top">
                    <b>{a.trigger_condition}</b>
                    <span
                      className={`status-pill ${a.status === "RESOLVED" || a.status === "BENIGN" ? "approved" : a.status === "ESCALATED" ? "denied" : "pending"}`}
                    >
                      {a.status}
                    </span>
                  </div>
                  <p>
                    {a.user_name ?? "Synthetic scenario"} · rule {a.rule_id} · {date(a.created_at)}
                  </p>
                  <p>
                    Observed <b>{a.observed_value}</b> against threshold{" "}
                    <b>{a.threshold_value ?? "policy condition"}</b>
                    {a.window_seconds ? ` · ${a.window_seconds}s window` : ""}
                  </p>
                  <details>
                    <summary>Evidence and triggered rule</summary>
                    <pre className="incident-evidence">
                      {JSON.stringify(JSON.parse(a.evidence), null, 2)}
                    </pre>
                  </details>
                  <div className="incident-actions">
                    <button
                      className="button tiny secondary"
                      disabled={a.status !== "OPEN"}
                      onClick={() => void act(a.id, "acknowledge")}
                    >
                      Acknowledge
                    </button>
                    <button
                      className="button tiny primary"
                      disabled={["RESOLVED", "BENIGN", "ESCALATED"].includes(a.status)}
                      onClick={() => void act(a.id, "investigate")}
                    >
                      Investigate
                    </button>
                    <span className="muted-cell">Incident: {a.incident_status ?? "—"}</span>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <Empty text="No configured behavior rules have triggered." />
        )}
      </div>
    </>
  );
}
function IncidentsPanel({
  data,
  message,
  reload,
  superAdmin,
}: {
  data: any;
  message: (s: string) => void;
  reload: () => void;
  superAdmin: boolean;
}) {
  const items = data?.incidents ?? [];
  async function act(id: string, action: string) {
    const reason =
      action === "investigate"
        ? "Review opened by administrator"
        : (prompt(`Reason for ${action}:`) ?? "");
    if (action !== "investigate" && !reason.trim()) return;
    const result = await api("/api/admin/incidents", {
      method: "POST",
      body: JSON.stringify({ incidentId: id, action, reason }),
    });
    message(result.error?.message ?? `Incident ${action}d.`);
    reload();
  }
  return (
    <>
      <PageHeading
        label="THREAT RESPONSE"
        title={superAdmin ? "Platform incident review" : "Security incidents"}
        subtitle="Investigate anomaly signals. A detection is an indicator, not proof of malicious activity."
      />
      <div className="panel">
        <PanelTitle title="Incident queue" />
        {items.length ? (
          <div className="incident-list">
            {items.map((i: any) => (
              <article className="incident-item" key={i.id}>
                <div className="incident-severity">
                  ⚑<small>{i.severity}</small>
                </div>
                <div className="incident-body">
                  <div className="incident-top">
                    <b>{i.reason}</b>
                    <span
                      className={`status-pill ${["RESOLVED", "BENIGN"].includes(i.status) ? "approved" : i.status === "ESCALATED" ? "denied" : "pending"}`}
                    >
                      {i.status}
                    </span>
                  </div>
                  <p>
                    {i.user_name ?? "Unknown user"} · opened {date(i.created_at)}
                  </p>
                  <div className="incident-evidence">{i.evidence}</div>
                  <details>
                    <summary>Investigation history</summary>
                    {(data?.notes ?? [])
                      .filter((note: any) => note.incident_id === i.id)
                      .map((note: any) => (
                        <p key={note.id}>
                          {note.author_name ?? "System"} · {date(note.created_at)}: {note.note}
                        </p>
                      ))}
                  </details>
                  <div className="incident-actions">
                    {superAdmin && i.status === "ESCALATED" ? (
                      <>
                        <button
                          className="button tiny secondary"
                          onClick={() => void act(i.id, "request-investigation")}
                        >
                          Request investigation
                        </button>
                        <button
                          className="button tiny primary"
                          onClick={() => void act(i.id, "resolve")}
                        >
                          Resolve with reason
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          className="button tiny secondary"
                          disabled={["RESOLVED", "BENIGN", "ESCALATED"].includes(i.status)}
                          onClick={() => void act(i.id, "investigate")}
                        >
                          Investigate
                        </button>
                        <button
                          className="button tiny secondary"
                          onClick={() => void act(i.id, "note")}
                        >
                          Add note
                        </button>
                        <button
                          className="button tiny secondary"
                          disabled={["RESOLVED", "BENIGN", "ESCALATED"].includes(i.status)}
                          onClick={() => void act(i.id, "benign")}
                        >
                          Mark benign
                        </button>
                        <button
                          className="button tiny danger"
                          disabled={["RESOLVED", "BENIGN", "ESCALATED"].includes(i.status)}
                          onClick={() => void act(i.id, "escalate")}
                        >
                          Escalate
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <Empty text="No incidents have been detected." />
        )}
      </div>
    </>
  );
}
function ScenarioPanel({ data, onRun, busy }: { data: any; onRun: () => void; busy: boolean }) {
  const scenarios = data?.scenarios ?? [];
  const results = data?.results ?? [];
  return (
    <>
      <PageHeading
        label="RESEARCH MODE · SYNTHETIC DATA"
        title="Context scenario lab"
        subtitle="Run controlled cases through the same authorization evaluator used for protected resource requests."
      />
      <div className="lab-banner">
        <span>ⓘ</span>
        <div>
          <b>Simulation values are synthetic</b>
          <p>
            Device trust, network status, and activity patterns here are test inputs. They are not
            real employee observations.
          </p>
        </div>
      </div>
      <div className="panel">
        <div className="panel-title">
          <div>
            <h2>Evaluation scenarios</h2>
            <p className="panel-subtitle">
              12 labelled cases · deterministic rules · no production traffic
            </p>
          </div>
          <button className="button primary" onClick={onRun} disabled={busy}>
            {busy ? "Running…" : "▶ Run all scenarios"}
          </button>
        </div>
        {scenarios.length ? (
          <div className="scenario-grid">
            {scenarios.map((s: any) => (
              <div className="scenario-card" key={s.id}>
                <div>
                  <span className="scenario-code">{s.id}</span>
                  {s.synthetic === 1 && <span className="synthetic-pill">SYNTHETIC</span>}
                </div>
                <h3>{s.name}</h3>
                <div className="scenario-expect">
                  Expected outcome{" "}
                  <b className={s.expected === "ALLOW" ? "text-green" : "text-red"}>{s.expected}</b>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Empty text="Initialize the development database to load sample scenarios." />
        )}
      </div>
      {results.length > 0 && (
        <div className="panel">
          <div className="panel-title">
            <div>
              <h2>Latest run</h2>
              <p className="panel-subtitle">
                Accuracy: {Math.round((data.metrics?.accuracy ?? 0) * 100)}% · Median latency:{" "}
                {data.metrics?.medianLatencyMs?.toFixed(2)} ms
              </p>
            </div>
            <span className="status-pill approved">
              {results.filter((r: any) => r.matchesExpected).length}/{results.length} matched
            </span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>SCENARIO</th>
                  <th>EXPECTED</th>
                  <th>ACTUAL</th>
                  <th>RBAC BASELINE</th>
                  <th>EXPLANATION</th>
                  <th>LATENCY</th>
                </tr>
              </thead>
              <tbody>
                {results.map((x: any) => (
                  <tr key={x.id}>
                    <td>{x.name}</td>
                    <td>{x.expected}</td>
                    <td>
                      <span className={`status-pill ${x.matchesExpected ? "approved" : "denied"}`}>
                        {x.actual}
                      </span>
                    </td>
                    <td>{x.rbacBaseline}</td>
                    <td>{x.explanation}</td>
                    <td>{x.latencyMs.toFixed(2)} ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
function ManagementPanel({
  section,
  data,
  message,
  reload,
}: {
  section: string;
  data: any;
  message: (s: string) => void;
  reload: () => void;
}) {
  const [selected, setSelected] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const endpoint = section === "Roles" ? "roles" : section.toLowerCase();
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const form = new FormData(event.currentTarget);
    const body: any = Object.fromEntries(form.entries());
    if (section === "Roles")
      body.permissionCodes = String(body.permissionCodes ?? "")
        .split(",")
        .map((x: string) => x.trim())
        .filter(Boolean);
    if (section === "Policies") {
      body.enabled = form.get("enabled") === "on";
      const start = String(form.get("windowStart") ?? "");
      const end = String(form.get("windowEnd") ?? "");
      const timezone = String(form.get("windowTimezone") ?? "");
      if (Boolean(start) !== Boolean(end) || ((start || end) && !timezone)) {
        setBusy(false);
        message("Provide both a start and end time plus a timezone.");
        return;
      }
      body.conditions = {
        businessHoursOnly: form.get("businessHoursOnly") === "on",
        registeredDeviceOnly: form.get("registeredDeviceOnly") === "on",
        knownNetworkOnly: form.get("knownNetworkOnly") === "on",
        denyUnusualSequence: form.get("denyUnusualSequence") === "on",
        ...(start && end && timezone ? { allowedTimeWindow: { start, end, timezone } } : {}),
        ...(form.get("maxRequests") ? { maxRequests: Number(form.get("maxRequests")) } : {}),
        ...(form.get("maxContextAgeSeconds")
          ? { maxContextAgeSeconds: Number(form.get("maxContextAgeSeconds")) }
          : {}),
      };
    }
    if (selected) body.id = selected.id;
    const result = await api(`/api/admin/${endpoint}`, {
      method: selected ? "PATCH" : "POST",
      body: JSON.stringify(body),
    });
    setBusy(false);
    message(result.error?.message ?? `${section.slice(0, -1)} saved.`);
    if (!result.error) {
      setSelected(null);
      event.currentTarget.reset();
      reload();
    }
  }
  async function remove(item: any) {
    if (!confirm(`Delete ${item.name ?? item.code}? This action is audited.`)) return;
    const result = await api(`/api/admin/${endpoint}`, {
      method: "DELETE",
      body: JSON.stringify({ id: item.id }),
    });
    message(result.error?.message ?? "Deleted.");
    if (!result.error) reload();
  }
  const rows =
    section === "Roles"
      ? (data?.roles ?? [])
      : section === "Permissions"
        ? (data?.permissions ?? [])
        : (data?.policies ?? []);
  return (
    <>
      <PageHeading
        label="PLATFORM CONFIGURATION"
        title={`${section} management`}
        subtitle="Changes are validated server-side and recorded in the platform audit trail."
      />
      <div className="two-col">
        <div className="panel">
          <PanelTitle title={`Create or update ${section.toLowerCase()}`} />
          <form
            className="request-form"
            onSubmit={save}
            key={`${section}-${selected?.id ?? "new"}`}
          >
            {section === "Roles" && (
              <>
                <label>
                  Role name
                  <input name="name" required minLength={2} defaultValue={selected?.name ?? ""} />
                </label>
                <label>
                  Description
                  <input name="description" defaultValue={selected?.description ?? ""} />
                </label>
                <label>
                  Permission codes (comma separated)
                  <input
                    name="permissionCodes"
                    placeholder="resources:engineering:read"
                    defaultValue={selected?.permission_codes ?? ""}
                  />
                </label>
              </>
            )}
            {section === "Permissions" && (
              <>
                <label>
                  Permission code
                  <input
                    name="code"
                    required
                    pattern="[a-z][a-z0-9_-]*(:[a-z0-9_-]+)+"
                    defaultValue={selected?.code ?? ""}
                  />
                </label>
                <label>
                  Description
                  <input
                    name="description"
                    required
                    minLength={3}
                    defaultValue={selected?.description ?? ""}
                  />
                </label>
              </>
            )}
            {section === "Policies" && (
              <>
                <label>
                  Policy name
                  <input name="name" required minLength={3} defaultValue={selected?.name ?? ""} />
                </label>
                <label>
                  Resource type or *
                  <input name="resource" required defaultValue={selected?.resource ?? "*"} />
                </label>
                <label>
                  Action
                  <select name="action" defaultValue={selected?.action ?? "read"}>
                    <option>read</option>
                    <option>update</option>
                    <option>*</option>
                  </select>
                </label>
                <label>
                  Effect
                  <select name="effect" defaultValue={selected?.effect ?? "ALLOW"}>
                    <option>ALLOW</option>
                    <option>DENY</option>
                    <option>STEP_UP_AUTH</option>
                  </select>
                </label>
                <label>
                  <input
                    type="checkbox"
                    name="enabled"
                    defaultChecked={selected ? Boolean(selected.enabled) : true}
                  />{" "}
                  Enabled
                </label>
                {[
                  "businessHoursOnly",
                  "registeredDeviceOnly",
                  "knownNetworkOnly",
                  "denyUnusualSequence",
                ].map((key) => (
                  <label key={key}>
                    <input
                      type="checkbox"
                      name={key}
                      defaultChecked={Boolean(
                        selected && JSON.parse(selected.conditions || "{}")[key],
                      )}
                    />{" "}
                    Require{" "}
                    {key
                      .replace("Only", "")
                      .replace("denyUnusualSequence", "normal access sequence")}
                  </label>
                ))}
                <div className="info-callout">
                  <span>◷</span>
                  <div>
                    <b>Allowed time window</b>
                    <p>
                      Optional local time window. Overnight ranges are supported; timezones use IANA
                      names.
                    </p>
                  </div>
                </div>
                <label>
                  Window start
                  <input
                    type="time"
                    name="windowStart"
                    defaultValue={
                      selected
                        ? (JSON.parse(selected.conditions || "{}").allowedTimeWindow?.start ?? "")
                        : ""
                    }
                  />
                </label>
                <label>
                  Window end
                  <input
                    type="time"
                    name="windowEnd"
                    defaultValue={
                      selected
                        ? (JSON.parse(selected.conditions || "{}").allowedTimeWindow?.end ?? "")
                        : ""
                    }
                  />
                </label>
                <label>
                  Timezone
                  <input
                    name="windowTimezone"
                    placeholder="Asia/Kolkata"
                    defaultValue={
                      selected
                        ? (JSON.parse(selected.conditions || "{}").allowedTimeWindow?.timezone ??
                          "Asia/Kolkata")
                        : "Asia/Kolkata"
                    }
                  />
                </label>
                <label>
                  Maximum requests
                  <input
                    type="number"
                    name="maxRequests"
                    min="1"
                    max="10000"
                    defaultValue={
                      selected ? (JSON.parse(selected.conditions || "{}").maxRequests ?? "") : ""
                    }
                  />
                </label>
                <label>
                  Maximum context age (seconds)
                  <input
                    type="number"
                    name="maxContextAgeSeconds"
                    min="1"
                    max="86400"
                    defaultValue={
                      selected
                        ? (JSON.parse(selected.conditions || "{}").maxContextAgeSeconds ?? "")
                        : ""
                    }
                  />
                </label>
              </>
            )}
            <div className="row-actions">
              <button className="button primary" disabled={busy}>
                {busy ? "Saving…" : selected ? "Save changes" : "Create"}
              </button>
              {selected && (
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => setSelected(null)}
                >
                  Cancel edit
                </button>
              )}
            </div>
          </form>
        </div>
        <div className="panel">
          <PanelTitle title={`Configured ${section.toLowerCase()}`} />
          {rows.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>NAME</th>
                    <th>DETAIL</th>
                    <th>ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((item: any) => (
                    <tr key={item.id}>
                      <td>{item.name ?? item.code}</td>
                      <td>
                        {section === "Roles"
                          ? (item.permission_codes ?? "No permissions")
                          : section === "Permissions"
                            ? item.description
                            : `${item.effect} · ${item.resource} · ${item.action} · ${item.enabled ? "enabled" : "disabled"}`}
                      </td>
                      <td>
                        <div className="row-actions">
                          <button
                            className="button tiny secondary"
                            onClick={() => setSelected(item)}
                          >
                            Edit
                          </button>
                          <button className="button tiny danger" onClick={() => void remove(item)}>
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty text={`No ${section.toLowerCase()} configured.`} />
          )}
        </div>
      </div>
    </>
  );
}
function McacDraftPanel({
  data,
  message,
  reload,
}: {
  data: any;
  message: (s: string) => void;
  reload: () => void;
}) {
  const [selected, setSelected] = useState<any>(null);
  const [name, setName] = useState("");
  const [resourceClass, setResourceClass] = useState("");
  const [action, setAction] = useState("read");
  const [policyText, setPolicyText] = useState("{}");
  const [report, setReport] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  function selectDraft(draft: any) {
    setSelected(draft);
    setName(draft.name);
    setResourceClass(draft.resource_class);
    setAction(draft.action);
    setPolicyText(JSON.stringify(JSON.parse(draft.policy_json), null, 2));
    setReport(JSON.parse(draft.validation_report || "[]"));
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    let policy: Record<string, unknown>;
    try {
      policy = JSON.parse(policyText);
    } catch {
      message("Policy JSON must be valid.");
      return;
    }
    setBusy(true);
    const draft = { name, resourceClass, action, policy };
    const result = await api(selected ? "/api/admin/mcac-policies" : "/api/admin/mcac-policies", {
      method: selected ? "PATCH" : "POST",
      body: JSON.stringify(selected ? { id: selected.id, operation: "edit", draft } : { ...draft }),
    });
    setBusy(false);
    if (result.error) {
      message(result.error.message);
      return;
    }
    message(selected ? "Draft saved." : "Draft created.");
    setSelected(null);
    setReport([]);
    if (!selected) {
      setName("");
      setResourceClass("");
      setAction("read");
      setPolicyText("{}");
    }
    reload();
  }
  async function validate() {
    if (!selected) return;
    setBusy(true);
    const result = await api("/api/admin/mcac-policies", {
      method: "PATCH",
      body: JSON.stringify({ id: selected.id, operation: "validate" }),
    });
    setBusy(false);
    setReport(result.data?.report ?? []);
    message(result.error?.message ?? "Readiness check completed; publishing remains gated.");
    reload();
  }
  return (
    <>
      <PageHeading
        label="FORMAL POLICY LIFECYCLE"
        title="MCAC policy drafts"
        subtitle="Drafts are stored separately from legacy policies. Publishing and activation are disabled until formal validation decisions are resolved."
      />
      <div className="info-callout">
        <span>ⓘ</span>
        <div>
          <b>No production policy changes</b>
          <p>
            This workspace does not convert legacy policies or activate formal versions. A readiness
            check reports unresolved specification issues.
          </p>
        </div>
      </div>
      <div className="two-col">
        <div className="panel">
          <PanelTitle title={selected ? "Edit draft" : "Create draft"} />
          <form className="request-form" onSubmit={submit} key={selected?.id ?? "new"}>
            <label>
              Draft name
              <input
                required
                minLength={3}
                maxLength={120}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>
              Resource class
              <input
                required
                value={resourceClass}
                onChange={(e) => setResourceClass(e.target.value)}
              />
            </label>
            <label>
              Action scope
              <select value={action} onChange={(e) => setAction(e.target.value)}>
                <option value="read">read</option>
                <option value="write">write</option>
                <option value="export">export</option>
                <option value="admin">admin</option>
              </select>
            </label>
            <label>
              Formal PolicyVersion JSON
              <textarea
                value={policyText}
                onChange={(e) => setPolicyText(e.target.value)}
                rows={14}
                spellCheck={false}
              />
            </label>
            <div className="row-actions">
              <button className="button primary" disabled={busy}>
                {busy ? "Saving…" : selected ? "Save draft" : "Create draft"}
              </button>
              {selected && (
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => {
                    setSelected(null);
                    setName("");
                    setResourceClass("");
                    setAction("read");
                    setPolicyText("{}");
                    setReport([]);
                  }}
                >
                  New draft
                </button>
              )}
              {selected && (
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy}
                  onClick={() => void validate()}
                >
                  Check readiness
                </button>
              )}
            </div>
          </form>
          {report.length > 0 && (
            <div className="info-callout">
              <div>
                <b>BLOCKED</b>
                <ul>
                  {report.map((line, index) => (
                    <li key={index}>{line}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
        <div className="panel">
          <PanelTitle title="Drafts and immutable versions" />
          {data?.drafts?.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>NAME</th>
                    <th>SCOPE</th>
                    <th>STATE</th>
                    <th>ACTION</th>
                  </tr>
                </thead>
                <tbody>
                  {data.drafts.map((draft: any) => (
                    <tr key={draft.id}>
                      <td>{draft.name}</td>
                      <td>
                        {draft.resource_class} / {draft.action}
                      </td>
                      <td>{draft.status}</td>
                      <td>
                        <button
                          className="button tiny secondary"
                          onClick={() => selectDraft(draft)}
                        >
                          Open
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty text="No formal policy drafts yet." />
          )}
          {data?.versions?.length > 0 && (
            <>
              <h3>Published snapshots</h3>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>VERSION</th>
                      <th>PARENT</th>
                      <th>HASH</th>
                      <th>CREATED</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.versions.map((version: any) => (
                      <tr key={version.version}>
                        <td>{version.version}</td>
                        <td>{version.parent_version ?? "—"}</td>
                        <td className="mono">{version.snapshot_hash}</td>
                        <td>{date(version.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
function PermissionRequestsPanel({
  data,
  message,
  reload,
}: {
  data: any;
  message: (s: string) => void;
  reload: () => void;
}) {
  const requests = data?.requests ?? [];
  async function review(requestId: string, decision: "approve" | "reject") {
    const reason = decision === "reject" ? (prompt("Reason for rejection (required):") ?? "") : "";
    if (decision === "reject" && !reason.trim()) return;
    const result = await api("/api/user/permission-requests", {
      method: "PATCH",
      body: JSON.stringify({ requestId, decision, reason }),
    });
    message(result.error?.message ?? `Request ${decision}d.`);
    reload();
  }
  return (
    <>
      <PageHeading
        label="DELEGATED ACCESS"
        title="Permission requests"
        subtitle="Review requested capabilities within your administrative scope."
      />
      <div className="panel">
        <PanelTitle title="Review queue" />
        {requests.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>REQUESTER</th>
                  <th>PERMISSION</th>
                  <th>REASON</th>
                  <th>STATUS</th>
                  <th>SUBMITTED</th>
                  <th>ACTION</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((item: any) => (
                  <tr key={item.id}>
                    <td>
                      {item.user_name}
                      <small>{item.email}</small>
                    </td>
                    <td>{item.permission_code}</td>
                    <td>{item.reason}</td>
                    <td>
                      <span
                        className={`status-pill ${item.status === "PENDING" ? "pending" : "muted-pill"}`}
                      >
                        {item.status}
                      </span>
                    </td>
                    <td>{date(item.created_at)}</td>
                    <td>
                      {item.status === "PENDING" && (
                        <div className="row-actions">
                          <button
                            className="button tiny primary"
                            onClick={() => void review(item.id, "approve")}
                          >
                            Approve
                          </button>
                          <button
                            className="button tiny danger"
                            onClick={() => void review(item.id, "reject")}
                          >
                            Reject
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty text="No permission requests have been submitted." />
        )}
      </div>
    </>
  );
}
function date(value: string) {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  });
}
