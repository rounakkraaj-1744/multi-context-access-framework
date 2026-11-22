import { actorOrError, isSuperAdmin, json } from "@/lib/api";
import { audit, id, sqlite } from "@/lib/db";
import { z } from "zod";

const roleSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().max(500).default(""),
  permissionCodes: z.array(z.string().min(2)).max(100).default([]),
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
    roles: sqlite
      .prepare(
        "SELECT r.id,r.name,r.description,r.scope,group_concat(p.code) permission_codes FROM roles r LEFT JOIN role_permissions rp ON rp.role_id=r.id LEFT JOIN permissions p ON p.id=rp.permission_id GROUP BY r.id ORDER BY r.name",
      )
      .all(),
    permissions: sqlite.prepare("SELECT code,description FROM permissions ORDER BY code").all(),
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
  const p = roleSchema.safeParse(await req.json().catch(() => null));
  if (!p.success)
    return Response.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid role definition." } },
      { status: 400 },
    );
  const roleId = id();
  try {
    sqlite.transaction(() => {
      sqlite
        .prepare("INSERT INTO roles(id,name,description,scope) VALUES(?,?,?,'organization')")
        .run(roleId, p.data.name, p.data.description);
      for (const code of p.data.permissionCodes) {
        if (!sqlite.prepare("SELECT 1 FROM permissions WHERE code=?").get(code))
          throw new Error("UNKNOWN_PERMISSION");
        sqlite
          .prepare("INSERT INTO role_permissions(role_id,permission_id) VALUES(?,?)")
          .run(roleId, code);
      }
      audit(r.actor.id, "ROLE_CREATED", roleId, {
        name: p.data.name,
        permissions: p.data.permissionCodes,
      });
    })();
  } catch (e) {
    return Response.json(
      {
        error: {
          code: "CONFLICT",
          message:
            e instanceof Error && e.message === "UNKNOWN_PERMISSION"
              ? "Unknown permission."
              : "Role name already exists.",
        },
      },
      { status: 409 },
    );
  }
  return json({ id: roleId }, 201);
}
export async function PATCH(req: Request) {
  const r = await actorOrError();
  if ("response" in r) return r.response;
  if (!isSuperAdmin(r.actor))
    return Response.json(
      { error: { code: "FORBIDDEN", message: "Super Admin access required." } },
      { status: 403 },
    );
  const p = roleSchema
    .extend({ id: z.string().min(1) })
    .safeParse(await req.json().catch(() => null));
  if (!p.success)
    return Response.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid role definition." } },
      { status: 400 },
    );
  const exists = sqlite.prepare("SELECT id,name FROM roles WHERE id=?").get(p.data.id) as
    { id: string; name: string } | undefined;
  if (!exists)
    return Response.json(
      { error: { code: "NOT_FOUND", message: "Role not found." } },
      { status: 404 },
    );
  if (exists.name === "Super Admin")
    return Response.json(
      { error: { code: "PROTECTED_ROLE", message: "The platform root role cannot be edited." } },
      { status: 409 },
    );
  try {
    sqlite.transaction(() => {
      sqlite
        .prepare("UPDATE roles SET name=?,description=? WHERE id=?")
        .run(p.data.name, p.data.description, p.data.id);
      sqlite.prepare("DELETE FROM role_permissions WHERE role_id=?").run(p.data.id);
      for (const code of p.data.permissionCodes) {
        if (!sqlite.prepare("SELECT 1 FROM permissions WHERE code=?").get(code))
          throw new Error("UNKNOWN_PERMISSION");
        sqlite
          .prepare("INSERT INTO role_permissions(role_id,permission_id) VALUES(?,?)")
          .run(p.data.id, code);
      }
      audit(r.actor.id, "ROLE_UPDATED", p.data.id, {
        name: p.data.name,
        permissions: p.data.permissionCodes,
      });
    })();
  } catch (e) {
    return Response.json(
      {
        error: {
          code: "CONFLICT",
          message:
            e instanceof Error && e.message === "UNKNOWN_PERMISSION"
              ? "Unknown permission."
              : "Could not update role.",
        },
      },
      { status: 409 },
    );
  }
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
      { error: { code: "VALIDATION_ERROR", message: "Invalid role." } },
      { status: 400 },
    );
  const role = sqlite.prepare("SELECT name FROM roles WHERE id=?").get(p.data.id) as
    { name: string } | undefined;
  if (!role)
    return Response.json(
      { error: { code: "NOT_FOUND", message: "Role not found." } },
      { status: 404 },
    );
  if (
    ["Super Admin", "Admin"].includes(role.name) ||
    sqlite.prepare("SELECT 1 FROM user_roles WHERE role_id=?").get(p.data.id)
  )
    return Response.json(
      {
        error: {
          code: "ROLE_IN_USE",
          message: "Core or assigned roles cannot be deleted. Remove assignments first.",
        },
      },
      { status: 409 },
    );
  sqlite.transaction(() => {
    sqlite.prepare("DELETE FROM role_permissions WHERE role_id=?").run(p.data.id);
    sqlite.prepare("DELETE FROM roles WHERE id=?").run(p.data.id);
    audit(r.actor.id, "ROLE_DELETED", p.data.id, { name: role.name });
  })();
  return json({ deleted: true });
}
