import { actorOrError, isSuperAdmin, json } from "@/lib/api";
import { audit, id, sqlite } from "@/lib/db";
import { z } from "zod";
const schema = z.object({
  code: z
    .string()
    .regex(/^[a-z][a-z0-9_-]*(?::[a-z0-9_-]+)+$/)
    .max(120),
  description: z.string().trim().min(3).max(500),
});
export async function GET() {
  const r = await actorOrError();
  if ("response" in r) return r.response;
  if (!isSuperAdmin(r.actor))
    return Response.json(
      { error: { code: "FORBIDDEN", message: "Super Admin access required." } },
      { status: 403 },
    );
  return json({
    permissions: sqlite
      .prepare(
        "SELECT p.*,count(DISTINCT rp.role_id) role_count FROM permissions p LEFT JOIN role_permissions rp ON rp.permission_id=p.id GROUP BY p.id ORDER BY p.code",
      )
      .all(),
  });
}
export async function POST(req: Request) {
  const r = await actorOrError();
  if ("response" in r) return r.response;
  if (!isSuperAdmin(r.actor))
    return Response.json(
      { error: { code: "FORBIDDEN", message: "Super Admin access required." } },
      { status: 403 },
    );
  const p = schema.safeParse(await req.json().catch(() => null));
  if (!p.success)
    return Response.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid permission." } },
      { status: 400 },
    );
  const permissionId = id();
  try {
    sqlite
      .prepare("INSERT INTO permissions(id,code,description) VALUES(?,?,?)")
      .run(permissionId, p.data.code, p.data.description);
  } catch {
    return Response.json(
      { error: { code: "CONFLICT", message: "Permission already exists." } },
      { status: 409 },
    );
  }
  audit(r.actor.id, "PERMISSION_CREATED", permissionId, p.data);
  return json({ id: permissionId }, 201);
}
export async function PATCH(req: Request) {
  const r = await actorOrError();
  if ("response" in r) return r.response;
  if (!isSuperAdmin(r.actor))
    return Response.json(
      { error: { code: "FORBIDDEN", message: "Super Admin access required." } },
      { status: 403 },
    );
  const p = schema.extend({ id: z.string().min(1) }).safeParse(await req.json().catch(() => null));
  if (!p.success)
    return Response.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid permission." } },
      { status: 400 },
    );
  sqlite
    .prepare("UPDATE permissions SET code=?,description=? WHERE id=?")
    .run(p.data.code, p.data.description, p.data.id);
  audit(r.actor.id, "PERMISSION_UPDATED", p.data.id, {
    code: p.data.code,
    description: p.data.description,
  });
  return json({ updated: true });
}
export async function DELETE(req: Request) {
  const r = await actorOrError();
  if ("response" in r) return r.response;
  if (!isSuperAdmin(r.actor))
    return Response.json(
      { error: { code: "FORBIDDEN", message: "Super Admin access required." } },
      { status: 403 },
    );
  const p = z.object({ id: z.string().min(1) }).safeParse(await req.json().catch(() => null));
  if (!p.success)
    return Response.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid permission." } },
      { status: 400 },
    );
  if (
    sqlite
      .prepare(
        "SELECT 1 FROM role_permissions WHERE permission_id=? UNION SELECT 1 FROM user_permissions WHERE permission_id=?",
      )
      .get(p.data.id, p.data.id)
  )
    return Response.json(
      {
        error: {
          code: "PERMISSION_IN_USE",
          message: "Remove this permission from roles and users first.",
        },
      },
      { status: 409 },
    );
  const result = sqlite.prepare("DELETE FROM permissions WHERE id=?").run(p.data.id);
  if (!result.changes)
    return Response.json(
      { error: { code: "NOT_FOUND", message: "Permission not found." } },
      { status: 404 },
    );
  audit(r.actor.id, "PERMISSION_DELETED", p.data.id, {});
  return json({ deleted: true });
}
