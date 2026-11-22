import { actorOrError, isAdmin, isSuperAdmin, json } from "@/lib/api";
import { sqlite } from "@/lib/db";

export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  const r = await actorOrError();
  if ("response" in r) return r.response;
  if (!isAdmin(r.actor))
    return Response.json(
      { error: { code: "FORBIDDEN", message: "Admin access required." } },
      { status: 403 },
    );
  const { id } = await context.params;
  const user = sqlite
    .prepare(
      "SELECT id,name,email,department,job_title,organization_id,status,requested_role,created_at,approved_at,rejection_reason FROM users WHERE id=? AND (?=1 OR organization_id=?)",
    )
    .get(id, isSuperAdmin(r.actor) ? 1 : 0, r.actor.organizationId);
  if (!user)
    return Response.json(
      { error: { code: "NOT_FOUND", message: "User not found." } },
      { status: 404 },
    );
  const page = Math.max(1, Number(new URL(req.url).searchParams.get("page") ?? 1) || 1);
  const roles = sqlite
    .prepare(
      "SELECT r.name,ur.assigned_at,ur.assigned_by FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=?",
    )
    .all(id);
  const permissions = sqlite
    .prepare(
      "SELECT DISTINCT p.code,p.description FROM user_roles ur JOIN role_permissions rp ON rp.role_id=ur.role_id JOIN permissions p ON p.id=rp.permission_id WHERE ur.user_id=? UNION SELECT p.code,p.description FROM user_permissions up JOIN permissions p ON p.id=up.permission_id WHERE up.user_id=?",
    )
    .all(id, id);
  const sessions = sqlite
    .prepare(
      "SELECT id,login_at,last_seen_at,logout_at,expires_at,status,ip_address,reason FROM sessions WHERE user_id=? ORDER BY login_at DESC LIMIT 30 OFFSET ?",
    )
    .all(id, (page - 1) * 30);
  const decisions = sqlite
    .prepare(
      "SELECT id,resource,action,decision,reason_codes,explanation,context,created_at FROM authorization_decisions WHERE user_id=? ORDER BY created_at DESC LIMIT 50 OFFSET ?",
    )
    .all(id, (page - 1) * 50);
  const snapshots = sqlite
    .prepare(
      "SELECT c.id,c.observed_at,c.source,c.context FROM session_context_snapshots c JOIN sessions s ON s.id=c.session_id WHERE s.user_id=? ORDER BY c.observed_at DESC LIMIT 50",
    )
    .all(id);
  const events = sqlite
    .prepare(
      "SELECT id,event_type,details,created_at FROM audit_events WHERE target_id=? ORDER BY created_at DESC LIMIT 50",
    )
    .all(id);
  const notifications = sqlite
    .prepare(
      "SELECT id,event_type,title,summary,created_at,read_at FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 50",
    )
    .all(id);
  const permissionRequests = sqlite
    .prepare(
      "SELECT id,permission_code,reason,status,review_reason,created_at,reviewed_at FROM permission_requests WHERE user_id=? ORDER BY created_at DESC LIMIT 50",
    )
    .all(id);
  const timezone = process.env.DISPLAY_TIMEZONE ?? "Asia/Kolkata";
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const startOfLocalDay = (value: string) => {
    const [year, month, date] = value.split("-").map(Number);
    let result = Date.UTC(year, month - 1, date);
    for (let attempt = 0; attempt < 3; attempt++) {
      const parts = Object.fromEntries(
        new Intl.DateTimeFormat("en-CA", {
          timeZone: timezone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hourCycle: "h23",
        })
          .formatToParts(new Date(result))
          .map((part) => [part.type, part.value]),
      );
      const represented = Date.UTC(
        Number(parts.year),
        Number(parts.month) - 1,
        Number(parts.day),
        Number(parts.hour),
        Number(parts.minute),
        Number(parts.second),
      );
      result += Date.UTC(year, month - 1, date) - represented;
    }
    return new Date(result).toISOString();
  };
  const nextDay = new Date(
    Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)) + 1),
  );
  const nextDayLabel = new Intl.DateTimeFormat("en-CA", {
    timeZone: "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(nextDay);
  const daily = sqlite
    .prepare(
      "SELECT MIN(login_at) first_login,MAX(logout_at) last_explicit_logout,COUNT(*) sessions,SUM(CASE WHEN status='ACTIVE' THEN 1 ELSE 0 END) active_sessions FROM sessions WHERE user_id=? AND login_at>=? AND login_at<?",
    )
    .get(id, startOfLocalDay(day), startOfLocalDay(nextDayLabel));
  const behaviorAlerts = sqlite
    .prepare(
      "SELECT id,rule_id,severity,status,trigger_condition,observed_value,threshold_value,window_seconds,evidence,created_at,updated_at FROM behavior_alerts WHERE user_id=? ORDER BY created_at DESC LIMIT 50",
    )
    .all(id);
  const incidents = sqlite
    .prepare(
      "SELECT id,severity,status,reason,evidence,created_at,updated_at,resolution,escalated_by FROM incidents WHERE user_id=? ORDER BY created_at DESC LIMIT 50",
    )
    .all(id);
  return json({
    user,
    roles,
    permissions,
    sessions,
    daily,
    decisions,
    snapshots,
    events,
    notifications,
    permissionRequests,
    behaviorAlerts,
    incidents,
    page,
    limit: 30,
    timezone,
  });
}
