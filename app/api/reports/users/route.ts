import { actorOrError, isAdmin, isSuperAdmin } from "@/lib/api";
import { audit, sqlite } from "@/lib/db";
import { sanitizeCsvCell } from "@/lib/authorization";

export async function GET(req: Request) {
  const r = await actorOrError();
  if ("response" in r) return r.response;
  if (!isAdmin(r.actor) || !r.actor.permissions.includes("reports:export")) return Response.json({ error: { code: "FORBIDDEN", message: "Report permission required." } }, { status: 403 });
  const url = new URL(req.url);
  const kind = url.searchParams.get("type") ?? "users";
  const from = url.searchParams.get("from") ?? "0000-01-01T00:00:00.000Z";
  const to = url.searchParams.get("to") ?? "9999-12-31T23:59:59.999Z";
  if (!/^\d{4}-\d\d-\d\d(?:T.*)?$/.test(from) || !/^\d{4}-\d\d-\d\d(?:T.*)?$/.test(to) || from > to) return Response.json({ error: { code: "VALIDATION_ERROR", message: "Invalid date range." } }, { status: 400 });
  const platform = isSuperAdmin(r.actor);
  let columns: string[];
  let rows: Record<string, unknown>[];
  if (kind === "users") {
    columns = ["name", "email", "department", "job_title", "status", "created_at", "roles"];
    rows = sqlite.prepare(`SELECT u.name,u.email,u.department,u.job_title,u.status,u.created_at,group_concat(DISTINCT r.name) roles FROM users u LEFT JOIN user_roles ur ON ur.user_id=u.id LEFT JOIN roles r ON r.id=ur.role_id WHERE u.created_at BETWEEN ? AND ? AND (?=1 OR u.organization_id=?) GROUP BY u.id ORDER BY u.created_at DESC`).all(from,to,platform?1:0,r.actor.organizationId) as Record<string, unknown>[];
  } else if (kind === "sessions") {
    columns = ["name", "email", "login_at", "last_seen_at", "logout_at", "expires_at", "status", "reason", "ip_address"];
    rows = sqlite.prepare(`SELECT u.name,u.email,s.login_at,s.last_seen_at,s.logout_at,s.expires_at,s.status,s.reason,s.ip_address FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.login_at BETWEEN ? AND ? AND (?=1 OR u.organization_id=?) ORDER BY s.login_at DESC`).all(from,to,platform?1:0,r.actor.organizationId) as Record<string, unknown>[];
  } else return Response.json({ error: { code: "VALIDATION_ERROR", message: "Supported reports: users, sessions." } }, { status: 400 });
  const csv = [columns, ...rows.map((row) => columns.map((column) => row[column]))].map((row) => row.map(sanitizeCsvCell).join(",")).join("\r\n");
  audit(r.actor.id, "REPORT_EXPORTED", null, { report: kind, rows: rows.length, from, to, timezone: process.env.DISPLAY_TIMEZONE ?? "Asia/Kolkata" });
  return new Response(`Generated at ${new Date().toISOString()} (${process.env.DISPLAY_TIMEZONE ?? "Asia/Kolkata"})\r\n${csv}`, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename=${kind}.csv`, "Cache-Control": "no-store" } });
}
