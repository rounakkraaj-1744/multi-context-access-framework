import { actorOrError, json } from "@/lib/api";
import { audit, id, now, sqlite } from "@/lib/db";
import { verifyPassword } from "@/lib/auth";
import { z } from "zod";
export async function POST(req: Request) {
  const r = await actorOrError();

  if ("response" in r) return r.response;
  const p = z
    .object({ requestId: z.string().min(1), password: z.string().min(1).max(200) })
    .safeParse(await req.json().catch(() => null));
  if (!p.success)
    return Response.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Provide the access request and verify your password.",
        },
      },
      { status: 400 },
    );

  const request = sqlite
    .prepare(
      "SELECT ar.resource,ar.action,ar.session_id,d.decision FROM access_requests ar JOIN authorization_decisions d ON d.request_id=ar.id WHERE ar.id=? AND ar.user_id=? AND ar.session_id=? ORDER BY d.created_at DESC LIMIT 1",
    )
    .get(p.data.requestId, r.actor.id, r.actor.sessionId) as
    { resource: string; action: string; session_id: string; decision: string } | undefined;
  if (!request || request.decision !== "STEP_UP_AUTH")
    return Response.json(
      { error: { code: "NOT_FOUND", message: "No pending step-up request was found." } },
      { status: 404 },
    );
  const hash = (
    sqlite
      .prepare("SELECT password_hash FROM users WHERE id=? AND status='ACTIVE'")
      .get(r.actor.id) as { password_hash: string } | undefined
  )?.password_hash;
  if (!hash || !verifyPassword(p.data.password, hash))
    return Response.json(
      { error: { code: "STEP_UP_FAILED", message: "Additional verification failed." } },
      { status: 401 },
    );
  const verifiedAt = now();
  sqlite
    .prepare(
      "INSERT INTO step_up_verifications(id,session_id,resource,action,verified_at,expires_at) VALUES(?,?,?,?,?,?) ON CONFLICT(session_id,resource,action) DO UPDATE SET verified_at=excluded.verified_at,expires_at=excluded.expires_at",
    )
    .run(
      id(),
      r.actor.sessionId,
      request.resource,
      request.action,
      verifiedAt,
      new Date(Date.now() + 5 * 60_000).toISOString(),
    );
  audit(r.actor.id, "STEP_UP_VERIFIED", p.data.requestId, {
    resource: request.resource,
    action: request.action,
    method: "password re-authentication",
  });
  return json({
    verified: true,
    expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    message: "Verification succeeded. Retry the protected request.",
  });
}
