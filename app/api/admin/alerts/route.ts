import { actorOrError, isAdmin, isSuperAdmin, json } from "@/lib/api";
import { audit, now, sqlite } from "@/lib/db";
import { z } from "zod";

export async function GET() {
  const auth = await actorOrError();
  if ("response" in auth) return auth.response;
  if (!isAdmin(auth.actor) || !auth.actor.permissions.includes("incidents:manage"))
    return Response.json(
      { error: { code: "FORBIDDEN", message: "Behavior alert access is not permitted." } },
      { status: 403 },
    );
  const alerts = isSuperAdmin(auth.actor)
    ? sqlite
        .prepare(
          "SELECT a.*,u.name user_name,u.email,i.status incident_status FROM behavior_alerts a LEFT JOIN users u ON u.id=a.user_id LEFT JOIN incidents i ON i.id=a.incident_id ORDER BY a.created_at DESC LIMIT 100",
        )
        .all()
    : sqlite
        .prepare(
          "SELECT a.*,u.name user_name,u.email,i.status incident_status FROM behavior_alerts a LEFT JOIN users u ON u.id=a.user_id LEFT JOIN incidents i ON i.id=a.incident_id WHERE a.organization_id=? ORDER BY a.created_at DESC LIMIT 100",
        )
        .all(auth.actor.organizationId);
  return json({ alerts });
}

export async function PATCH(req: Request) {
  const auth = await actorOrError();
  if ("response" in auth) return auth.response;
  if (!isAdmin(auth.actor) || !auth.actor.permissions.includes("incidents:manage"))
    return Response.json(
      { error: { code: "FORBIDDEN", message: "Behavior alert access is not permitted." } },
      { status: 403 },
    );
  const parsed = z
    .object({ alertId: z.string().min(1), action: z.enum(["acknowledge", "investigate"]) })
    .safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return Response.json(
      { error: { code: "VALIDATION_ERROR", message: "Select a valid alert action." } },
      { status: 400 },
    );
  const alert = sqlite
    .prepare("SELECT * FROM behavior_alerts WHERE id=? AND (?=1 OR organization_id=?)")
    .get(parsed.data.alertId, isSuperAdmin(auth.actor) ? 1 : 0, auth.actor.organizationId) as
    { id: string; status: string; incident_id: string | null } | undefined;
  if (!alert)
    return Response.json(
      { error: { code: "NOT_FOUND", message: "Alert not found." } },
      { status: 404 },
    );
  if (alert.status === "ESCALATED")
    return Response.json(
      { error: { code: "CONFLICT", message: "This alert is awaiting Super Admin review." } },
      { status: 409 },
    );
  if (["RESOLVED", "BENIGN"].includes(alert.status))
    return Response.json(
      { error: { code: "CONFLICT", message: "This alert is closed." } },
      { status: 409 },
    );
  const status =
    parsed.data.action === "investigate"
      ? "INVESTIGATING"
      : alert.status === "OPEN"
        ? "ACKNOWLEDGED"
        : alert.status;
  sqlite
    .prepare("UPDATE behavior_alerts SET status=?,updated_at=? WHERE id=?")
    .run(status, now(), alert.id);
  if (alert.incident_id && parsed.data.action === "investigate")
    sqlite
      .prepare(
        "UPDATE incidents SET status='INVESTIGATING',updated_at=? WHERE id=? AND status IN ('NEW','INVESTIGATING')",
      )
      .run(now(), alert.incident_id);
  audit(auth.actor.id, `BEHAVIOR_ALERT_${parsed.data.action.toUpperCase()}`, alert.id, {
    incidentId: alert.incident_id,
    previousStatus: alert.status,
    status,
  });
  return json({ updated: true, status });
}
