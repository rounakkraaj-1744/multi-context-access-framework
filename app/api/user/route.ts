import { actorOrError, json } from "@/lib/api";
import { audit, now, notify, sqlite } from "@/lib/db";
import { z } from "zod";
export async function GET() {
  const r = await actorOrError();
  if ("response" in r) return r.response;
  const user = sqlite
    .prepare(
      "SELECT id,name,email,department,job_title,status,requested_role,created_at FROM users WHERE id=?",
    )
    .get(r.actor.id);
  const sessions = sqlite
    .prepare(
      "SELECT id,login_at,last_seen_at,logout_at,expires_at,status,reason FROM sessions WHERE user_id=? ORDER BY login_at DESC LIMIT 30",
    )
    .all(r.actor.id);
  const decisions = sqlite
    .prepare(
      "SELECT resource,action,decision,reason_codes,explanation,context,created_at FROM authorization_decisions WHERE user_id=? ORDER BY created_at DESC LIMIT 30",
    )
    .all(r.actor.id);
  const contextSnapshots = sqlite
    .prepare(
      "SELECT c.id,c.observed_at,c.source,c.context FROM session_context_snapshots c JOIN sessions s ON s.id=c.session_id WHERE s.user_id=? ORDER BY c.observed_at DESC LIMIT 30",
    )
    .all(r.actor.id);
  const notifications = sqlite
    .prepare("SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 20")
    .all(r.actor.id);
  const permissionRequests = sqlite
    .prepare("SELECT * FROM permission_requests WHERE user_id=? ORDER BY created_at DESC")
    .all(r.actor.id);
  return json({
    user,
    roles: r.actor.roles,
    permissions: r.actor.permissions,
    sessions,
    decisions,
    contextSnapshots,
    notifications,
    permissionRequests,
  });
}
export async function PATCH(req: Request) {
  const r = await actorOrError();
  if ("response" in r) return r.response;
  const parsed = z
    .object({
      name: z.string().trim().min(2).max(100),
      department: z.string().trim().max(100),
      jobTitle: z.string().trim().max(100),
    })
    .strict()
    .safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return Response.json(
      { error: { code: "VALIDATION_ERROR", message: "Provide valid profile details." } },
      { status: 400 },
    );
  const before = sqlite
    .prepare("SELECT name,department,job_title FROM users WHERE id=? AND status='ACTIVE'")
    .get(r.actor.id) as { name: string; department: string; job_title: string } | undefined;
  if (!before)
    return Response.json(
      { error: { code: "ACCOUNT_INACTIVE", message: "Account is not active." } },
      { status: 403 },
    );
  const values = {
    name: parsed.data.name,
    department: parsed.data.department,
    job_title: parsed.data.jobTitle,
  };
  if (
    before.name === values.name &&
    before.department === values.department &&
    before.job_title === values.job_title
  )
    return json({ updated: false });
  const timestamp = now();
  sqlite
    .prepare("UPDATE users SET name=?,department=?,job_title=?,updated_at=? WHERE id=?")
    .run(values.name, values.department, values.job_title, timestamp, r.actor.id);
  const changedFields = Object.keys(values).filter(
    (key) => before[key as keyof typeof before] !== values[key as keyof typeof values],
  );
  audit(r.actor.id, "PROFILE_UPDATED", r.actor.id, {
    changedFields,
    before: { name: before.name, department: before.department, jobTitle: before.job_title },
    after: { name: values.name, department: values.department, jobTitle: values.job_title },
  });
  notify(
    r.actor.id,
    "profile.updated",
    "Profile updated",
    `Updated profile fields: ${changedFields.join(", ")}.`,
    r.actor.id,
  );
  return json({ updated: true, changedFields });
}
