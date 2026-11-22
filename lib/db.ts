import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const file = resolve(process.env.DATABASE_PATH || "./data/mcaf.sqlite");
mkdirSync(dirname(file), { recursive: true });
const globalDb = globalThis as typeof globalThis & { mcafSqlite?: Database.Database };
export const sqlite = globalDb.mcafSqlite ?? new Database(file);
globalDb.mcafSqlite = sqlite;
sqlite.pragma("foreign_keys = ON");
sqlite.pragma("journal_mode = WAL");
sqlite.exec(`
CREATE TABLE IF NOT EXISTS users (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
 password_hash TEXT NOT NULL, department TEXT NOT NULL DEFAULT '', job_title TEXT NOT NULL DEFAULT '',
 organization_id TEXT NOT NULL DEFAULT 'default',
 status TEXT NOT NULL CHECK(status IN ('PENDING','ACTIVE','SUSPENDED','REJECTED','DEACTIVATED')),
 requested_role TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 approved_by TEXT REFERENCES users(id), approved_at TEXT, rejection_reason TEXT
);
CREATE TABLE IF NOT EXISTS roles (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT NOT NULL DEFAULT '', scope TEXT NOT NULL DEFAULT 'organization');
CREATE TABLE IF NOT EXISTS permissions (id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, description TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS user_roles (user_id TEXT NOT NULL REFERENCES users(id), role_id TEXT NOT NULL REFERENCES roles(id), assigned_by TEXT REFERENCES users(id), assigned_at TEXT NOT NULL, PRIMARY KEY(user_id,role_id));
CREATE TABLE IF NOT EXISTS role_permissions (role_id TEXT NOT NULL REFERENCES roles(id), permission_id TEXT NOT NULL REFERENCES permissions(id), PRIMARY KEY(role_id,permission_id));
CREATE TABLE IF NOT EXISTS user_permissions (user_id TEXT NOT NULL REFERENCES users(id), permission_id TEXT NOT NULL REFERENCES permissions(id), assigned_by TEXT REFERENCES users(id), assigned_at TEXT NOT NULL, PRIMARY KEY(user_id,permission_id));
CREATE TABLE IF NOT EXISTS session_context_snapshots (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), observed_at TEXT NOT NULL, source TEXT NOT NULL, context TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS context_session_time ON session_context_snapshots(session_id,observed_at DESC);
CREATE TABLE IF NOT EXISTS step_up_verifications (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), resource TEXT NOT NULL, action TEXT NOT NULL, verified_at TEXT NOT NULL, expires_at TEXT NOT NULL, UNIQUE(session_id,resource,action));
CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, user_id TEXT NOT NULL REFERENCES users(id), login_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, logout_at TEXT, expires_at TEXT NOT NULL, status TEXT NOT NULL, ip_address TEXT, user_agent TEXT, reason TEXT);
CREATE INDEX IF NOT EXISTS sessions_user_login ON sessions(user_id, login_at DESC);
CREATE TABLE IF NOT EXISTS policies (id TEXT PRIMARY KEY, name TEXT NOT NULL, resource TEXT NOT NULL, action TEXT NOT NULL, effect TEXT NOT NULL, conditions TEXT NOT NULL DEFAULT '{}', enabled INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS access_requests (id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id), session_id TEXT REFERENCES sessions(id), resource TEXT NOT NULL, action TEXT NOT NULL, created_at TEXT NOT NULL, context TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS authorization_decisions (id TEXT PRIMARY KEY, request_id TEXT REFERENCES access_requests(id), user_id TEXT REFERENCES users(id), resource TEXT NOT NULL, action TEXT NOT NULL, decision TEXT NOT NULL, reason_codes TEXT NOT NULL, explanation TEXT NOT NULL, context TEXT NOT NULL, duration_ms REAL NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS decisions_created ON authorization_decisions(created_at DESC);
CREATE TABLE IF NOT EXISTS mcac_policy_versions (version TEXT PRIMARY KEY, parent_version TEXT REFERENCES mcac_policy_versions(version), snapshot TEXT NOT NULL, snapshot_hash TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TRIGGER IF NOT EXISTS mcac_policy_versions_no_update BEFORE UPDATE ON mcac_policy_versions BEGIN SELECT RAISE(ABORT,'MCAC policy versions are immutable'); END;
CREATE TRIGGER IF NOT EXISTS mcac_policy_versions_no_delete BEFORE DELETE ON mcac_policy_versions BEGIN SELECT RAISE(ABORT,'MCAC policy versions are immutable'); END;
CREATE TABLE IF NOT EXISTS mcac_decision_traces (trace_hash TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, policy_version TEXT NOT NULL REFERENCES mcac_policy_versions(version), trace_json TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TRIGGER IF NOT EXISTS mcac_decision_traces_no_update BEFORE UPDATE ON mcac_decision_traces BEGIN SELECT RAISE(ABORT,'MCAC decision traces are immutable'); END;
CREATE TRIGGER IF NOT EXISTS mcac_decision_traces_no_delete BEFORE DELETE ON mcac_decision_traces BEGIN SELECT RAISE(ABORT,'MCAC decision traces are immutable'); END;
CREATE TABLE IF NOT EXISTS mcac_policy_drafts (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, resource_class TEXT NOT NULL,
 action TEXT NOT NULL CHECK(action IN ('read','write','export','admin')),
 policy_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','VALIDATED','PUBLISHED','ACTIVE','RETIRED')),
 validation_report TEXT NOT NULL DEFAULT '[]', created_by TEXT NOT NULL REFERENCES users(id),
 updated_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS mcac_policy_drafts_scope ON mcac_policy_drafts(resource_class,action,status,updated_at DESC);
CREATE TABLE IF NOT EXISTS audit_events (id TEXT PRIMARY KEY, actor_id TEXT REFERENCES users(id), event_type TEXT NOT NULL, target_id TEXT, details TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS audit_created ON audit_events(created_at DESC);
CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), event_type TEXT NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL, related_id TEXT, created_at TEXT NOT NULL, read_at TEXT, UNIQUE(user_id,event_type,related_id));
CREATE TABLE IF NOT EXISTS permission_requests (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), permission_code TEXT NOT NULL, reason TEXT NOT NULL, status TEXT NOT NULL, reviewed_by TEXT REFERENCES users(id), review_reason TEXT, created_at TEXT NOT NULL, reviewed_at TEXT);
CREATE TABLE IF NOT EXISTS incidents (id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id), session_id TEXT REFERENCES sessions(id), severity TEXT NOT NULL, status TEXT NOT NULL, reason TEXT NOT NULL, evidence TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, resolution TEXT, escalated_by TEXT REFERENCES users(id));
CREATE TABLE IF NOT EXISTS incident_notes (id TEXT PRIMARY KEY, incident_id TEXT NOT NULL REFERENCES incidents(id), author_id TEXT REFERENCES users(id), note TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS behavior_alerts (id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id), organization_id TEXT NOT NULL DEFAULT 'default', incident_id TEXT REFERENCES incidents(id), rule_id TEXT NOT NULL, rule_version INTEGER NOT NULL DEFAULT 1, severity TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'OPEN', trigger_condition TEXT NOT NULL, observed_value TEXT NOT NULL, threshold_value TEXT, window_seconds INTEGER, evidence TEXT NOT NULL, synthetic INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS behavior_alerts_scope_status ON behavior_alerts(organization_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS behavior_alerts_user_rule ON behavior_alerts(user_id,rule_id,status,created_at DESC);
CREATE TABLE IF NOT EXISTS resources (id TEXT PRIMARY KEY, title TEXT NOT NULL, resource_type TEXT NOT NULL, required_permission TEXT NOT NULL, classification TEXT NOT NULL, content TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS scenarios (id TEXT PRIMARY KEY, name TEXT NOT NULL, synthetic INTEGER NOT NULL DEFAULT 1, input TEXT NOT NULL, expected TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS scenario_runs (id TEXT PRIMARY KEY, scenario_id TEXT REFERENCES scenarios(id), actual TEXT NOT NULL, matches_expected INTEGER NOT NULL, latency_ms REAL NOT NULL, created_at TEXT NOT NULL);
`);
// Additive upgrades preserve databases created by earlier prototype versions.
const userColumns = sqlite.prepare("PRAGMA table_info(users)").all() as { name: string }[];
if (!userColumns.some((column) => column.name === "organization_id")) {
  sqlite.exec("ALTER TABLE users ADD COLUMN organization_id TEXT NOT NULL DEFAULT 'default'");
}
const accessColumns = sqlite.prepare("PRAGMA table_info(access_requests)").all() as {
  name: string;
}[];
if (!accessColumns.some((column) => column.name === "session_id"))
  sqlite.exec("ALTER TABLE access_requests ADD COLUMN session_id TEXT REFERENCES sessions(id)");
export const db = drizzle(sqlite);
export const now = () => new Date().toISOString();
export const id = () => crypto.randomUUID();
export function audit(
  actor: string | null,
  event: string,
  target: string | null,
  details: unknown = {},
) {
  sqlite
    .prepare(
      "INSERT INTO audit_events(id,actor_id,event_type,target_id,details,created_at) VALUES(?,?,?,?,?,?)",
    )
    .run(id(), actor, event, target, JSON.stringify(details), now());
}
export function notify(
  userId: string,
  type: string,
  title: string,
  summary: string,
  relatedId: string | null,
) {
  sqlite
    .prepare(
      "INSERT OR IGNORE INTO notifications(id,user_id,event_type,title,summary,related_id,created_at) VALUES(?,?,?,?,?,?,?)",
    )
    .run(id(), userId, type, title, summary, relatedId, now());
}
export function expireActiveSessions(at = now()) {
  return sqlite
    .prepare(
      "UPDATE sessions SET status='EXPIRED',logout_at=expires_at,reason='INACTIVITY_TIMEOUT' WHERE status='ACTIVE' AND expires_at<=?",
    )
    .run(at).changes;
}
