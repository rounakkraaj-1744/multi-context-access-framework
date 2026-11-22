import { z } from "zod";
import { sqlite, id, now, audit, notify } from "@/lib/db";
import { error, json } from "@/lib/api";
import bcrypt from "bcryptjs";

const schema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.email().max(254),
  password: z.string().min(12).max(200),
  department: z.string().max(100).optional(),
  jobTitle: z.string().max(100).optional(),
  requestedRole: z.enum(["HR", "Backend Engineer", "DevOps Engineer", "Manager"]).optional(),
});
export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return error("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid registration.");
  const input = parsed.data;
  const timestamp = now();
  const userId = id();
  try {
    const tx = sqlite.transaction(() => {
      sqlite
        .prepare(
          "INSERT INTO users(id,name,email,password_hash,department,job_title,status,requested_role,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          userId,
          input.name,
          input.email,
          bcrypt.hashSync(input.password, 12),
          input.department ?? "",
          input.jobTitle ?? "",
          "PENDING",
          input.requestedRole ?? null,
          timestamp,
          timestamp,
        );
      audit(userId, "REGISTRATION_SUBMITTED", userId, {
        requestedRole: input.requestedRole ?? null,
      });
      for (const admin of sqlite
        .prepare(
          "SELECT DISTINCT u.id FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id WHERE r.name IN ('Admin','Super Admin') AND u.status='ACTIVE'",
        )
        .all() as { id: string }[])
        notify(
          admin.id,
          "registration.new",
          "Registration needs review",
          `${input.name} submitted a registration.`,
          userId,
        );
    });
    tx();
  } catch (e) {
    if (String(e).includes("UNIQUE"))
      return error("EMAIL_EXISTS", "An account with this email already exists.", 409);
    throw e;
  }
  return json(
    { id: userId, status: "PENDING", message: "Registration submitted for review." },
    201,
  );
}
