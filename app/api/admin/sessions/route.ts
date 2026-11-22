import { actorOrError, isAdmin, json, isSuperAdmin } from "@/lib/api";
import { sqlite, now, audit } from "@/lib/db";
import { z } from "zod";
export async function GET() {
  const r = await actorOrError();
  if ("response" in r) return r.response;
  if (!isAdmin(r.actor))
    return Response.json(
      { error: { code: "FORBIDDEN", message: "Admin access required." } },
      { status: 403 },
    );
  const sessions = isSuperAdmin(r.actor)
    ? sqlite
        .prepare(
          "SELECT s.id,s.user_id,u.name,u.email,s.login_at,s.last_seen_at,s.logout_at,s.expires_at,s.status,s.ip_address,s.user_agent,s.reason FROM sessions s JOIN users u ON u.id=s.user_id ORDER BY s.login_at DESC LIMIT 250",
        )
        .all()
    : sqlite
        .prepare(
          "SELECT s.id,s.user_id,u.name,u.email,s.login_at,s.last_seen_at,s.logout_at,s.expires_at,s.status,s.ip_address,s.user_agent,s.reason FROM sessions s JOIN users u ON u.id=s.user_id WHERE u.organization_id=? ORDER BY s.login_at DESC LIMIT 250",
        )
        .all(r.actor.organizationId);
  return json({ sessions });
}
export async function DELETE(req: Request) {
  const r = await actorOrError();
  if ("response" in r) return r.response;
  if (!isAdmin(r.actor))
    return Response.json(
      { error: { code: "FORBIDDEN", message: "Admin access required." } },
      { status: 403 },
    );
  const p = z
    .object({ sessionId: z.string().min(1) })
    .safeParse(await req.json().catch(() => null));
  if (!p.success)
    return Response.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid session." } },
      { status: 400 },
    );
  const session = sqlite
    .prepare(
      "SELECT s.id,s.user_id,u.organization_id FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=? AND (?=1 OR u.organization_id=?)",
    )
    .get(p.data.sessionId, isSuperAdmin(r.actor) ? 1 : 0, r.actor.organizationId) as
    { id: string; user_id: string } | undefined;
  if (!session)
    return Response.json(
      { error: { code: "NOT_FOUND", message: "Session not found." } },
      { status: 404 },
    );
  if (!isSuperAdmin(r.actor) && !r.actor.permissions.includes("sessions:manage"))
    return Response.json(
      { error: { code: "FORBIDDEN", message: "Session termination permission required." } },
      { status: 403 },
    );
  sqlite
    .prepare(
      "UPDATE sessions SET status='REVOKED',logout_at=?,reason='ADMIN_TERMINATED' WHERE id=? AND status='ACTIVE'",
    )
    .run(now(), session.id);
  audit(r.actor.id, "SESSION_TERMINATED", session.id, { userId: session.user_id });
  return json({ terminated: true });
}
