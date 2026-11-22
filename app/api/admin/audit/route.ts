import { actorOrError, isAdmin, isSuperAdmin, json } from "@/lib/api";
import { sqlite } from "@/lib/db";
export async function GET(req: Request) {
  const r = await actorOrError();
  if ("response" in r) return r.response;
  if (!isAdmin(r.actor))
    return Response.json(
      { error: { code: "FORBIDDEN", message: "Admin access required." } },
      { status: 403 },
    );
  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "";
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1);
  const limit = 50;
  const scope =
    "(a.actor_id=? OR a.actor_id IN (SELECT id FROM users WHERE organization_id=?) OR a.target_id IN (SELECT id FROM users WHERE organization_id=?) OR a.target_id IN (SELECT i.id FROM incidents i JOIN users x ON x.id=i.user_id WHERE x.organization_id=?) OR a.target_id IN (SELECT id FROM behavior_alerts WHERE organization_id=?))";
  const events = isSuperAdmin(r.actor)
    ? sqlite
        .prepare(
          "SELECT a.*,u.name actor_name FROM audit_events a LEFT JOIN users u ON u.id=a.actor_id WHERE (a.event_type LIKE ? OR a.target_id LIKE ?) ORDER BY a.created_at DESC LIMIT ? OFFSET ?",
        )
        .all(`%${q}%`, `%${q}%`, limit, (page - 1) * limit)
    : sqlite
        .prepare(
          `SELECT a.*,u.name actor_name FROM audit_events a LEFT JOIN users u ON u.id=a.actor_id WHERE (a.event_type LIKE ? OR a.target_id LIKE ?) AND ${scope} ORDER BY a.created_at DESC LIMIT ? OFFSET ?`,
        )
        .all(
          `%${q}%`,
          `%${q}%`,
          r.actor.id,
          r.actor.organizationId,
          r.actor.organizationId,
          r.actor.organizationId,
          r.actor.organizationId,
          limit,
          (page - 1) * limit,
        );
  return json({ events, page, limit });
}
