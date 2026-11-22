import { actorOrError, isAdmin, isSuperAdmin, json } from "@/lib/api";
import { sqlite } from "@/lib/db";

export async function GET() {
  const auth = await actorOrError();
  if ("response" in auth) return auth.response;
  if (!isAdmin(auth.actor))
    return Response.json(
      { error: { code: "FORBIDDEN", message: "Admin access required." } },
      { status: 403 },
    );
  const platformWide = isSuperAdmin(auth.actor) ? 1 : 0;
  const organizationId = auth.actor.organizationId;
  const count = (sql: string) =>
    Number((sqlite.prepare(sql).get(platformWide, organizationId) as { n: number }).n);
  const scope = "(?=1 OR u.organization_id=?)";
  return json({
    users: count(`SELECT COUNT(*) n FROM users u WHERE ${scope}`),
    pending: count(`SELECT COUNT(*) n FROM users u WHERE ${scope} AND u.status='PENDING'`),
    pendingPermissionRequests: count(
      `SELECT COUNT(*) n FROM permission_requests p JOIN users u ON u.id=p.user_id WHERE ${scope} AND p.status='PENDING'`,
    ),
    activeSessions: count(
      `SELECT COUNT(*) n FROM sessions s JOIN users u ON u.id=s.user_id WHERE ${scope} AND s.status='ACTIVE'`,
    ),
    denied: count(
      `SELECT COUNT(*) n FROM authorization_decisions d JOIN users u ON u.id=d.user_id WHERE ${scope} AND d.decision='DENY'`,
    ),
    stepUp: count(
      `SELECT COUNT(*) n FROM authorization_decisions d JOIN users u ON u.id=d.user_id WHERE ${scope} AND d.decision='STEP_UP_AUTH'`,
    ),
    incidents: count(
      `SELECT COUNT(*) n FROM incidents i LEFT JOIN users u ON u.id=i.user_id WHERE (?=1 OR u.organization_id=?) AND i.status IN ('NEW','INVESTIGATING','ESCALATED')`,
    ),
    alerts: count(
      `SELECT COUNT(*) n FROM behavior_alerts a LEFT JOIN users u ON u.id=a.user_id WHERE (?=1 OR a.organization_id=?) AND a.status IN ('OPEN','ACKNOWLEDGED','INVESTIGATING','ESCALATED')`,
    ),
    recent: sqlite
      .prepare(
        `SELECT d.*,u.name user_name FROM authorization_decisions d LEFT JOIN users u ON u.id=d.user_id WHERE (?=1 OR u.organization_id=?) ORDER BY d.created_at DESC LIMIT 8`,
      )
      .all(platformWide, organizationId),
    audit: sqlite
      .prepare(
        `SELECT a.*,u.name actor_name FROM audit_events a LEFT JOIN users u ON u.id=a.actor_id WHERE (?=1 OR a.actor_id=? OR a.actor_id IN (SELECT id FROM users WHERE organization_id=?) OR a.target_id IN (SELECT id FROM users WHERE organization_id=?) OR a.target_id IN (SELECT i.id FROM incidents i JOIN users x ON x.id=i.user_id WHERE x.organization_id=?) OR a.target_id IN (SELECT id FROM behavior_alerts WHERE organization_id=?)) ORDER BY a.created_at DESC LIMIT 8`,
      )
      .all(
        platformWide,
        auth.actor.id,
        organizationId,
        organizationId,
        organizationId,
        organizationId,
      ),
  });
}
