import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

type TestActor = {
  id: string;
  sessionId: string;
  name: string;
  email: string;
  status: string;
  organizationId: string;
  roles: string[];
  permissions: string[];
};
const auth = vi.hoisted(() => ({ actor: null as TestActor | null }));
vi.mock("@/lib/api", () => ({
  actorOrError: async () =>
    auth.actor
      ? { actor: auth.actor }
      : {
          response: Response.json(
            { error: { code: "UNAUTHENTICATED", message: "Sign in." } },
            { status: 401 },
          ),
        },
  isAdmin: (actor: TestActor) =>
    actor.roles.includes("Admin") || actor.roles.includes("Super Admin"),
  isSuperAdmin: (actor: TestActor) => actor.roles.includes("Super Admin"),
  json: (data: unknown, status = 200) =>
    Response.json({ data }, { status, headers: { "Cache-Control": "no-store" } }),
  error: (code: string, message: string, status = 400) =>
    Response.json(
      { error: { code, message } },
      { status, headers: { "Cache-Control": "no-store" } },
    ),
}));

describe("SQLite route integration workflows", () => {
  let folder: string;
  let db: typeof import("./db");
  let seed: typeof import("./seed");
  let registration: typeof import("../app/api/auth/register/route");
  let login: typeof import("../app/api/auth/login/route");
  let users: typeof import("../app/api/admin/users/route");
  let userProfile: typeof import("../app/api/user/route");
  let userDetail: typeof import("../app/api/admin/users/[id]/route");
  let policies: typeof import("../app/api/admin/policies/route");
  let mcacPolicies: typeof import("../app/api/admin/mcac-policies/route");
  let mcacResearch: typeof import("../app/api/admin/mcac-research/route");
  let access: typeof import("../app/api/access/route");
  let stepUp: typeof import("../app/api/access/step-up/route");
  let permissionRequests: typeof import("../app/api/user/permission-requests/route");
  let incidents: typeof import("../app/api/admin/incidents/route");
  let alerts: typeof import("../app/api/admin/alerts/route");
  let sessions: typeof import("../app/api/admin/sessions/route");
  let bcrypt: typeof import("bcryptjs");
  let sa: TestActor;
  let admin: TestActor;
  let employeeId: string;
  let outsiderId: string;
  let sessionId: string;
  beforeAll(async () => {
    folder = mkdtempSync(join(tmpdir(), "mcaf-vitest-"));
    process.env.DATABASE_PATH = join(folder, `test-${randomUUID()}.sqlite`);
    db = await import("./db");
    seed = await import("./seed");
    process.env.SEED_SUPERADMIN_EMAIL = "seed-root@test.example";
    process.env.SEED_SUPERADMIN_PASSWORD = "TestSeedSuperAdminPassword!";
    process.env.SEED_ORG_ADMIN_EMAIL = "seed-admin@test.example";
    process.env.SEED_ORG_ADMIN_PASSWORD = "TestSeedAdminPassword!";
    await seed.initialize();
    registration = await import("../app/api/auth/register/route");
    users = await import("../app/api/admin/users/route");
    userDetail = await import("../app/api/admin/users/[id]/route");
    policies = await import("../app/api/admin/policies/route");
    mcacPolicies = await import("../app/api/admin/mcac-policies/route");
    mcacResearch = await import("../app/api/admin/mcac-research/route");
    access = await import("../app/api/access/route");
    stepUp = await import("../app/api/access/step-up/route");
    permissionRequests = await import("../app/api/user/permission-requests/route");
    incidents = await import("../app/api/admin/incidents/route");
    sessions = await import("../app/api/admin/sessions/route");
    bcrypt = await import("bcryptjs");
    alerts = await import("../app/api/admin/alerts/route");
    login = await import("../app/api/auth/login/route");
    userProfile = await import("../app/api/user/route");
    const timestamp = db.now();
    const insert = db.sqlite.prepare(
      "INSERT INTO users(id,name,email,password_hash,status,organization_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
    );
    const saId = randomUUID(),
      adminId = randomUUID();
    employeeId = randomUUID();
    outsiderId = randomUUID();
    sessionId = randomUUID();
    insert.run(
      saId,
      "Super Root",
      "root@demo.test",
      bcrypt.hashSync("SuperSecurePassword!234", 4),
      "ACTIVE",
      "default",
      timestamp,
      timestamp,
    );
    insert.run(
      adminId,
      "Scoped Admin",
      "admin@demo.test",
      bcrypt.hashSync("AdminSecurePassword!234", 4),
      "ACTIVE",
      "default",
      timestamp,
      timestamp,
    );
    insert.run(
      employeeId,
      "Employee One",
      "one@demo.test",
      bcrypt.hashSync("EmployeeSecurePassword!234", 4),
      "ACTIVE",
      "default",
      timestamp,
      timestamp,
    );
    insert.run(
      outsiderId,
      "Employee Two",
      "two@demo.test",
      bcrypt.hashSync("EmployeeSecurePassword!234", 4),
      "ACTIVE",
      "other",
      timestamp,
      timestamp,
    );
    db.sqlite
      .prepare("INSERT INTO user_roles(user_id,role_id,assigned_at) VALUES(?,?,?)")
      .run(saId, "Super Admin", timestamp);
    db.sqlite
      .prepare("INSERT INTO user_roles(user_id,role_id,assigned_at) VALUES(?,?,?)")
      .run(adminId, "Admin", timestamp);
    db.sqlite
      .prepare("INSERT INTO user_roles(user_id,role_id,assigned_at) VALUES(?,?,?)")
      .run(employeeId, "Backend Engineer", timestamp);
    db.sqlite
      .prepare("INSERT INTO user_roles(user_id,role_id,assigned_at) VALUES(?,?,?)")
      .run(outsiderId, "Backend Engineer", timestamp);
    const token = "not-a-real-token-hash";
    db.sqlite
      .prepare(
        "INSERT INTO sessions(id,token_hash,user_id,login_at,last_seen_at,expires_at,status) VALUES(?,?,?,?,?,?,?)",
      )
      .run(
        sessionId,
        token,
        employeeId,
        timestamp,
        timestamp,
        new Date(Date.now() + 3600000).toISOString(),
        "ACTIVE",
      );
    sa = {
      id: saId,
      sessionId: "sa-session",
      name: "Super Root",
      email: "root@demo.test",
      status: "ACTIVE",
      organizationId: "default",
      roles: ["Super Admin"],
      permissions: db.sqlite
        .prepare("SELECT code FROM permissions")
        .all()
        .map((row) => String((row as { code: string }).code)),
    };
    admin = {
      id: adminId,
      sessionId: "admin-session",
      name: "Scoped Admin",
      email: "admin@demo.test",
      status: "ACTIVE",
      organizationId: "default",
      roles: ["Admin"],
      permissions: [
        "registrations:review",
        "permissions:manage",
        "incidents:manage",
        "reports:export",
        "users:read",
      ],
    };
  });
  afterAll(() => {
    if (db?.sqlite?.open) db.sqlite.close();
    if (folder) rmSync(folder, { recursive: true, force: true });
    delete process.env.DATABASE_PATH;
    delete process.env.SEED_SUPERADMIN_EMAIL;
    delete process.env.SEED_SUPERADMIN_PASSWORD;
    delete process.env.SEED_ORG_ADMIN_EMAIL;
    delete process.env.SEED_ORG_ADMIN_PASSWORD;
  });

  it("registers a pending user, rejects duplicates, and approval grants the requested role", async () => {
    auth.actor = null;
    const body = {
      name: "New Worker",
      email: "new-worker@demo.test",
      password: "LongRegistrationPassword!23",
      requestedRole: "DevOps Engineer",
    };
    const created = await registration.POST(
      new Request("http://localhost/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
    expect(created.status).toBe(201);
    const data = (await created.json()) as { data: { id: string; status: string } };
    expect(data.data.status).toBe("PENDING");
    auth.actor = admin;
    const directory = await users.GET(new Request("http://localhost/api/admin/users"));
    const directoryData = (await directory.json()) as { data: { users: { id: string }[] } };
    expect(directoryData.data.users.some((user) => user.id === data.data.id)).toBe(true);
    auth.actor = sa;
    const overview = await (await import("../app/api/admin/overview/route")).GET();
    const overviewData = (await overview.json()) as { data: { users: number; pending: number } };
    expect(overviewData.data.users).toBeGreaterThan(0);
    expect(overviewData.data.pending).toBeGreaterThan(0);
    const duplicate = await registration.POST(
      new Request("http://localhost/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
    expect(duplicate.status).toBe(409);
    auth.actor = admin;
    const approved = await users.PATCH(
      new Request("http://localhost/api/admin/users", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: data.data.id, action: "approve" }),
      }),
    );
    expect(approved.status).toBe(200);
    expect(
      (
        db.sqlite.prepare("SELECT status FROM users WHERE id=?").get(data.data.id) as {
          status: string;
        }
      ).status,
    ).toBe("ACTIVE");
    expect(
      db.sqlite
        .prepare(
          "SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=? AND r.name='DevOps Engineer'",
        )
        .get(data.data.id),
    ).toBeTruthy();
    expect(
      db.sqlite
        .prepare(
          "SELECT 1 FROM audit_events WHERE target_id=? AND event_type='REGISTRATION_APPROVE'",
        )
        .get(data.data.id),
    ).toBeTruthy();
    const userSession = randomUUID();
    const timestamp = db.now();
    db.sqlite
      .prepare(
        "INSERT INTO sessions(id,token_hash,user_id,login_at,last_seen_at,expires_at,status) VALUES(?,?,?,?,?,?,?)",
      )
      .run(
        userSession,
        randomUUID(),
        data.data.id,
        timestamp,
        timestamp,
        new Date(Date.now() + 3600000).toISOString(),
        "ACTIVE",
      );
    const permissions = db.sqlite
      .prepare(
        "SELECT p.code FROM user_roles ur JOIN role_permissions rp ON rp.role_id=ur.role_id JOIN permissions p ON p.id=rp.permission_id WHERE ur.user_id=?",
      )
      .all(data.data.id) as { code: string }[];
    auth.actor = {
      id: data.data.id,
      sessionId: userSession,
      name: "New Worker",
      email: "new-worker@demo.test",
      status: "ACTIVE",
      organizationId: "default",
      roles: ["DevOps Engineer"],
      permissions: permissions.map((item) => item.code),
    };
    const resourceAccess = await access.POST(
      new Request("http://localhost/api/access", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resourceId: "d-deploy", action: "read" }),
      }),
    );
    expect(resourceAccess.status).toBe(200);
    expect(
      db.sqlite
        .prepare(
          "SELECT 1 FROM authorization_decisions WHERE user_id=? AND resource='d-deploy' AND decision='ALLOW'",
        )
        .get(data.data.id),
    ).toBeTruthy();
  });
  it("audits failed login outcomes without recording passwords and distinguishes session expiry", async () => {
    const failed = await login.POST(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "one@demo.test", password: "wrong-and-secret-password" }),
      }),
    );
    expect(failed.status).toBe(401);
    const event = db.sqlite
      .prepare(
        "SELECT details FROM audit_events WHERE event_type='LOGIN_FAILED' AND target_id=? ORDER BY created_at DESC LIMIT 1",
      )
      .get(employeeId) as { details: string };
    expect(event).toBeTruthy();
    expect(event.details).not.toContain("wrong-and-secret-password");
    const expiredId = randomUUID();
    const expiredAt = new Date(Date.now() - 60_000).toISOString();
    db.sqlite
      .prepare(
        "INSERT INTO sessions(id,token_hash,user_id,login_at,last_seen_at,expires_at,status) VALUES(?,?,?,?,?,?,?)",
      )
      .run(expiredId, randomUUID(), employeeId, expiredAt, expiredAt, expiredAt, "ACTIVE");
    expect(db.expireActiveSessions()).toBeGreaterThanOrEqual(1);
    const session = db.sqlite
      .prepare("SELECT status,logout_at,reason FROM sessions WHERE id=?")
      .get(expiredId) as { status: string; logout_at: string; reason: string };
    expect(session).toEqual({
      status: "EXPIRED",
      logout_at: expiredAt,
      reason: "INACTIVITY_TIMEOUT",
    });
  });
  it("allows safe profile changes but rejects role or permission mass assignment", async () => {
    auth.actor = {
      id: employeeId,
      sessionId,
      name: "Employee One",
      email: "one@demo.test",
      status: "ACTIVE",
      organizationId: "default",
      roles: ["Backend Engineer"],
      permissions: ["resources:engineering:read"],
    };
    const payload = {
      name: "Employee Updated",
      department: "Engineering",
      jobTitle: "Backend Developer",
    };
    expect(
      (
        await userProfile.PATCH(
          new Request("http://localhost/api/user", {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          }),
        )
      ).status,
    ).toBe(200);
    expect(
      db.sqlite
        .prepare("SELECT name,department,job_title FROM users WHERE id=?")
        .get(employeeId) as { name: string; department: string; job_title: string },
    ).toEqual({ name: payload.name, department: payload.department, job_title: payload.jobTitle });
    expect(
      (
        await userProfile.PATCH(
          new Request("http://localhost/api/user", {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ ...payload, role: "Super Admin" }),
          }),
        )
      ).status,
    ).toBe(400);
    const auditEvent = db.sqlite
      .prepare(
        "SELECT details FROM audit_events WHERE event_type='PROFILE_UPDATED' AND target_id=?",
      )
      .get(employeeId) as { details: string };
    expect(auditEvent.details).toContain("jobTitle");
    expect(auditEvent.details).not.toContain("password");
  });
  it("creates development starter identities without overwriting existing passwords", async () => {
    const root = db.sqlite
      .prepare("SELECT id,password_hash FROM users WHERE email='seed-root@test.example'")
      .get() as { id: string; password_hash: string };
    const oldHash = root.password_hash;
    const adminRow = db.sqlite
      .prepare("SELECT id FROM users WHERE email='seed-admin@test.example'")
      .get();
    expect(bcrypt.compareSync("TestSeedSuperAdminPassword!", root.password_hash)).toBe(true);
    expect(adminRow).toBeTruthy();
    db.sqlite
      .prepare("UPDATE users SET password_hash='preserve-this-hash' WHERE id=?")
      .run(root.id);
    seed.initialize();
    expect(
      (
        db.sqlite.prepare("SELECT password_hash FROM users WHERE id=?").get(root.id) as {
          password_hash: string;
        }
      ).password_hash,
    ).toBe("preserve-this-hash");
    expect(oldHash).not.toBe("preserve-this-hash");
  });
  it("enforces organization scope and rejects self-escalation and elevated Admin grants", async () => {
    auth.actor = admin;
    const response = await userDetail.GET(
      new Request(`http://localhost/api/admin/users/${outsiderId}`),
      { params: Promise.resolve({ id: outsiderId }) },
    );
    expect(response.status).toBe(404);
    const self = await users.PATCH(
      new Request("http://localhost/api/admin/users", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: admin.id, action: "assign-role", role: "Super Admin" }),
      }),
    );
    expect(self.status).toBe(409);
    const elevated = await users.PATCH(
      new Request("http://localhost/api/admin/users", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: employeeId, action: "assign-role", role: "Super Admin" }),
      }),
    );
    expect(elevated.status).toBe(403);
  });
  it("allows role/policy writes only to Super Admin and records policy changes", async () => {
    auth.actor = admin;
    expect((await policies.GET()).status).toBe(403);
    auth.actor = sa;
    const response = await policies.POST(
      new Request("http://localhost/api/admin/policies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Password step-up",
          resource: "engineering",
          action: "read",
          effect: "STEP_UP_AUTH",
          conditions: {},
          enabled: true,
        }),
      }),
    );
    expect(response.status).toBe(201);
    const invalidTime = await policies.POST(
      new Request("http://localhost/api/admin/policies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Invalid timezone policy",
          resource: "engineering",
          action: "read",
          effect: "ALLOW",
          conditions: {
            allowedTimeWindow: { start: "09:00", end: "18:00", timezone: "not-a-timezone" },
          },
          enabled: true,
        }),
      }),
    );
    expect(invalidTime.status).toBe(400);
    const localTime = await policies.POST(
      new Request("http://localhost/api/admin/policies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Local-hours policy",
          resource: "unused-test-engineering",
          action: "read",
          effect: "ALLOW",
          conditions: {
            allowedTimeWindow: { start: "09:00", end: "18:00", timezone: "Asia/Kolkata" },
          },
          enabled: true,
        }),
      }),
    );
    expect(localTime.status).toBe(201);
    expect(
      db.sqlite.prepare("SELECT 1 FROM audit_events WHERE event_type='POLICY_CREATED'").get(),
    ).toBeTruthy();
  });
  it("keeps formal MCAC drafts separate, Super Admin-only, and blocked from publication", async () => {
    const legacyBefore = Number(
      (db.sqlite.prepare("SELECT COUNT(*) n FROM policies").get() as { n: number }).n,
    );
    const versionsBefore = Number(
      (db.sqlite.prepare("SELECT COUNT(*) n FROM mcac_policy_versions").get() as { n: number }).n,
    );
    auth.actor = admin;
    const adminView = await mcacPolicies.GET();
    expect(adminView.status).toBe(200);
    expect(((await adminView.json()) as { data: { drafts: unknown[] } }).data.drafts).toEqual([]);
    expect(
      (
        await mcacPolicies.POST(
          new Request("http://localhost/api/admin/mcac-policies", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              name: "Blocked draft",
              resourceClass: "engineering",
              action: "read",
              policy: {},
            }),
          }),
        )
      ).status,
    ).toBe(403);
    auth.actor = sa;
    const created = await mcacPolicies.POST(
      new Request("http://localhost/api/admin/mcac-policies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Formal draft",
          resourceClass: "engineering",
          action: "read",
          policy: {},
        }),
      }),
    );
    expect(created.status).toBe(201);
    const body = (await created.json()) as { data: { id: string; status: string } };
    expect(body.data.status).toBe("DRAFT");
    const checked = await mcacPolicies.PATCH(
      new Request("http://localhost/api/admin/mcac-policies", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: body.data.id, operation: "validate" }),
      }),
    );
    const checkedBody = (await checked.json()) as { data: { status: string; report: string[] } };
    expect(checked.status).toBe(200);
    expect(checkedBody.data.status).toBe("BLOCKED");
    expect(
      checkedBody.data.report.some((line) => line.includes("Missing formal policy field")),
    ).toBe(true);
    expect(checkedBody.data.report.some((line) => line.includes("publication is disabled"))).toBe(
      true,
    );
    const thetaDraft = await mcacPolicies.POST(
      new Request("http://localhost/api/admin/mcac-policies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Incomplete Theta",
          resourceClass: "engineering",
          action: "read",
          policy: {
            interactions: { environmentConditionedThresholds: true },
            rules: [
              {
                id: "r1",
                behavioral: [
                  {
                    id: "f1",
                    comparator: "lte",
                    parameter: { by: "network", values: { corporate: 20, vpn: 10, known: 5 } },
                  },
                ],
              },
            ],
          },
        }),
      }),
    );
    const thetaDraftBody = (await thetaDraft.json()) as { data: { id: string } };
    const thetaCheck = await mcacPolicies.PATCH(
      new Request("http://localhost/api/admin/mcac-policies", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: thetaDraftBody.data.id, operation: "validate" }),
      }),
    );
    const thetaCheckBody = (await thetaCheck.json()) as {
      data: { status: string; report: string[] };
    };
    expect(thetaCheckBody.data.status).toBe("BLOCKED");
    expect(
      thetaCheckBody.data.report.some((line) =>
        line.includes("missing required network class unknown"),
      ),
    ).toBe(true);
    const listing = await mcacPolicies.GET();
    const listingBody = (await listing.json()) as {
      data: { drafts: { id: string; status: string }[] };
    };
    expect(
      listingBody.data.drafts.some(
        (draft) => draft.id === body.data.id && draft.status === "DRAFT",
      ),
    ).toBe(true);
    expect(
      Number((db.sqlite.prepare("SELECT COUNT(*) n FROM policies").get() as { n: number }).n),
    ).toBe(legacyBefore);
    expect(
      Number(
        (db.sqlite.prepare("SELECT COUNT(*) n FROM mcac_policy_versions").get() as { n: number }).n,
      ),
    ).toBe(versionsBefore);
    expect(
      Number(
        (
          db.sqlite
            .prepare(
              "SELECT COUNT(*) n FROM mcac_policy_drafts WHERE status IN ('PUBLISHED','ACTIVE','RETIRED')",
            )
            .get() as { n: number }
        ).n,
      ),
    ).toBe(0);
  });
  it("validates Γ drafts and readiness without enabling publication", async () => {
    auth.actor = sa;
    const constraint = (id: string) => ({
      id,
      items: ["network", "device"],
      expression: {
        kind: "all",
        children: [
          {
            kind: "compare",
            operator: "eq",
            left: "environmental.network.class",
            right: { kind: "literal", value: { type: "networkClass", value: "corporate" } },
          },
          { kind: "exists", reference: "environmental.device.registered" },
        ],
      },
    });
    const formalPolicy = (consistencyConstraints: unknown[], enabled = true) => ({
      version: "draft-policy-v1",
      resourceProfiles: {
        engineering: { sensitivity: "L", stepUpAvailable: true, waiverDurationSeconds: 300 },
      },
      freshnessSeconds: Object.fromEntries(
        [
          "time",
          "location",
          "network",
          "device",
          "session",
          "frequency",
          "history",
          "navigation",
          "request",
        ].map((kind) => [kind, 300]),
      ),
      verificationRequired: Object.fromEntries(
        [
          "time",
          "location",
          "network",
          "device",
          "session",
          "frequency",
          "history",
          "navigation",
          "request",
        ].map((kind) => [kind, 0]),
      ),
      consistencyConstraints,
      expectedTransitions: [],
      rules: [
        {
          id: "r1",
          resourceClass: "engineering",
          actions: ["read"],
          environmental: [],
          behavioral: [],
          failOpen: 0,
        },
      ],
      strictLowSensitivity: false,
      interactions: { environmentConditionedThresholds: true, crossCategoryConsistency: enabled },
    });
    const request = (body: unknown, method = "POST") =>
      new Request("http://localhost/api/admin/mcac-policies", {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

    const validPolicy = formalPolicy([constraint("gamma-1")]);
    const created = await mcacPolicies.POST(
      request({
        name: "Γ formal draft",
        resourceClass: "engineering",
        action: "read",
        policy: validPolicy,
      }),
    );
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as { data: { id: string } };
    const persisted = db.sqlite
      .prepare("SELECT policy_json FROM mcac_policy_drafts WHERE id=?")
      .get(createdBody.data.id) as { policy_json: string };
    expect(JSON.parse(persisted.policy_json).consistencyConstraints).toEqual([
      constraint("gamma-1"),
    ]);

    const updatedPolicy = formalPolicy([constraint("gamma-2")]);
    const updated = await mcacPolicies.PATCH(
      request(
        {
          id: createdBody.data.id,
          operation: "edit",
          draft: {
            name: "Γ formal draft updated",
            resourceClass: "engineering",
            action: "read",
            policy: updatedPolicy,
          },
        },
        "PATCH",
      ),
    );
    expect(updated.status).toBe(200);
    const malformedUpdate = await mcacPolicies.PATCH(
      request(
        {
          id: createdBody.data.id,
          operation: "edit",
          draft: {
            name: "Γ formal draft broken",
            resourceClass: "engineering",
            action: "read",
            policy: formalPolicy([{ ...constraint("invalid-update"), extra: true }]),
          },
        },
        "PATCH",
      ),
    );
    const malformedUpdateBody = (await malformedUpdate.json()) as {
      error: { code: string; details: { code: string; path: string }[] };
    };
    expect(malformedUpdate.status).toBe(400);
    expect(malformedUpdateBody.error.code).toBe("GAMMA_VALIDATION_ERROR");
    expect(malformedUpdateBody.error.details).toContainEqual(
      expect.objectContaining({ code: "UNKNOWN_FIELD", path: "$.consistencyConstraints[0].extra" }),
    );
    const persistedAfterInvalidUpdate = db.sqlite
      .prepare("SELECT policy_json FROM mcac_policy_drafts WHERE id=?")
      .get(createdBody.data.id) as { policy_json: string };
    expect(JSON.parse(persistedAfterInvalidUpdate.policy_json).consistencyConstraints).toEqual([
      constraint("gamma-2"),
    ]);
    const checked = await mcacPolicies.PATCH(
      request({ id: createdBody.data.id, operation: "validate" }, "PATCH"),
    );
    const checkedBody = (await checked.json()) as {
      data: {
        status: string;
        report: string[];
        gammaValidation: {
          valid: boolean;
          canonicalBytes: number;
          digest: { canonicalizationVersion: string; hex: string } | null;
          errors: unknown[];
        };
      };
    };
    expect(checkedBody.data.status).toBe("BLOCKED");
    expect(checkedBody.data.gammaValidation).toMatchObject({
      valid: true,
      canonicalBytes: expect.any(Number),
      digest: {
        canonicalizationVersion: "mcac-gamma-c14n-v1",
        hex: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
      errors: [],
    });
    expect(
      checkedBody.data.report.some((line) => line.includes("Γ predicate comparison operators")),
    ).toBe(false);
    expect(checkedBody.data.report.some((line) => line.includes("publication is disabled"))).toBe(
      true,
    );

    const malformed = formalPolicy([{ ...constraint("broken"), extra: true }]);
    const malformedCreate = await mcacPolicies.POST(
      request({
        name: "Malformed Γ draft",
        resourceClass: "engineering",
        action: "read",
        policy: malformed,
      }),
    );
    const malformedBody = (await malformedCreate.json()) as {
      error: { code: string; details: { code: string; path: string }[] };
    };
    expect(malformedCreate.status).toBe(400);
    expect(malformedBody.error.code).toBe("GAMMA_VALIDATION_ERROR");
    expect(malformedBody.error.details).toContainEqual(
      expect.objectContaining({ code: "UNKNOWN_FIELD", path: "$.consistencyConstraints[0].extra" }),
    );

    const disabled = await mcacPolicies.POST(
      request({
        name: "Disabled Γ draft",
        resourceClass: "engineering",
        action: "read",
        policy: formalPolicy([constraint("disabled")], false),
      }),
    );
    const disabledBody = (await disabled.json()) as { error: { details: { code: string }[] } };
    expect(disabled.status).toBe(400);
    expect(disabledBody.error.details).toContainEqual(
      expect.objectContaining({ code: "FEATURE_DISABLED" }),
    );

    const duplicate = await mcacPolicies.POST(
      request({
        name: "Duplicate Γ draft",
        resourceClass: "engineering",
        action: "read",
        policy: formalPolicy([constraint("same"), constraint("same")]),
      }),
    );
    const duplicateBody = (await duplicate.json()) as { error: { details: { code: string }[] } };
    expect(duplicate.status).toBe(400);
    expect(duplicateBody.error.details).toContainEqual(
      expect.objectContaining({ code: "DUPLICATE_CONSTRAINT_ID" }),
    );

    const overLimit = {
      ...constraint("too-wide"),
      expression: {
        kind: "all",
        children: Array.from({ length: 9 }, (_, index) =>
          index % 2 === 0
            ? { kind: "exists", reference: "environmental.network.class" }
            : { kind: "exists", reference: "environmental.device.registered" },
        ),
      },
    };
    const complexity = await mcacPolicies.POST(
      request({
        name: "Complex Γ draft",
        resourceClass: "engineering",
        action: "read",
        policy: formalPolicy([overLimit]),
      }),
    );
    const complexityBody = (await complexity.json()) as { error: { details: { code: string }[] } };
    expect(complexity.status).toBe(400);
    expect(complexityBody.error.details).toContainEqual(
      expect.objectContaining({ code: "LIMIT_EXCEEDED" }),
    );

    const invalidId = randomUUID();
    db.sqlite
      .prepare(
        "INSERT INTO mcac_policy_drafts(id,name,resource_class,action,policy_json,status,validation_report,created_by,updated_by,created_at,updated_at) VALUES(?,?,?,?,?,'DRAFT','[]',?,?,?,?)",
      )
      .run(
        invalidId,
        "Invalid persisted Γ",
        "engineering",
        "read",
        JSON.stringify(formalPolicy([{ ...constraint("stored-bad"), extra: true }])),
        sa.id,
        sa.id,
        db.now(),
        db.now(),
      );
    const invalidReadiness = await mcacPolicies.PATCH(
      request({ id: invalidId, operation: "validate" }, "PATCH"),
    );
    const invalidReadinessBody = (await invalidReadiness.json()) as {
      data: {
        status: string;
        gammaValidation: { valid: boolean; errors: { code: string; path: string }[] };
      };
    };
    expect(invalidReadinessBody.data.status).toBe("BLOCKED");
    expect(invalidReadinessBody.data.gammaValidation.valid).toBe(false);
    expect(invalidReadinessBody.data.gammaValidation.errors).toContainEqual(
      expect.objectContaining({ code: "UNKNOWN_FIELD", path: "$.consistencyConstraints[0].extra" }),
    );

    const legacyNoGamma = await mcacPolicies.POST(
      request({
        name: "Legacy compatible draft",
        resourceClass: "engineering",
        action: "read",
        policy: formalPolicy([], false),
      }),
    );
    expect(legacyNoGamma.status).toBe(201);
    const legacyBody = (await legacyNoGamma.json()) as { data: { id: string } };
    const legacyReadiness = await mcacPolicies.PATCH(
      request({ id: legacyBody.data.id, operation: "validate" }, "PATCH"),
    );
    const legacyReadinessBody = (await legacyReadiness.json()) as {
      data: { gammaValidation: { valid: boolean; errors: unknown[] } };
    };
    expect(legacyReadinessBody.data.gammaValidation).toEqual(
      expect.objectContaining({ valid: true, errors: [] }),
    );
    const legacyDeclaration = await mcacPolicies.POST(
      request({
        name: "Legacy declaration with Γ disabled",
        resourceClass: "engineering",
        action: "read",
        policy: formalPolicy([{ id: "legacy-only", items: ["network"] }], false),
      }),
    );
    expect(legacyDeclaration.status).toBe(201);
  });
  it("routes permission requests for review and applies approved direct grants", async () => {
    auth.actor = {
      id: employeeId,
      sessionId,
      name: "Employee One",
      email: "one@demo.test",
      status: "ACTIVE",
      organizationId: "default",
      roles: ["Backend Engineer"],
      permissions: ["resources:engineering:read"],
    };
    expect((await alerts.GET()).status).toBe(403);
    const submitted = await permissionRequests.POST(
      new Request("http://localhost/api/user/permission-requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          permissionCode: "resources:team:read",
          reason: "Required to review shared team delivery updates.",
        }),
      }),
    );
    expect(submitted.status).toBe(201);
    const body = (await submitted.json()) as { data: { id: string } };
    auth.actor = admin;
    const unauthorized = await permissionRequests.PATCH(
      new Request("http://localhost/api/user/permission-requests", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ requestId: body.data.id, decision: "approve" }),
      }),
    );
    expect(unauthorized.status).toBe(403);
    auth.actor = sa;
    const approved = await permissionRequests.PATCH(
      new Request("http://localhost/api/user/permission-requests", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ requestId: body.data.id, decision: "approve" }),
      }),
    );
    expect(approved.status).toBe(200);
    expect(
      db.sqlite
        .prepare(
          "SELECT 1 FROM user_permissions up JOIN permissions p ON p.id=up.permission_id WHERE up.user_id=? AND p.code='resources:team:read'",
        )
        .get(employeeId),
    ).toBeTruthy();
    expect(
      db.sqlite
        .prepare(
          "SELECT 1 FROM audit_events WHERE target_id=? AND event_type='PERMISSION_REQUEST_APPROVE'",
        )
        .get(body.data.id),
    ).toBeTruthy();
  });
  it("requires a reason to mark an incident benign and records the transition", async () => {
    const incidentId = randomUUID();
    const timestamp = db.now();
    db.sqlite
      .prepare(
        "INSERT INTO incidents(id,user_id,severity,status,reason,evidence,created_at,updated_at) VALUES(?,?,?,'NEW',?,?,?,?)",
      )
      .run(
        incidentId,
        employeeId,
        "WARNING",
        "Review a contextual mismatch",
        "{}",
        timestamp,
        timestamp,
      );
    auth.actor = admin;
    expect(
      (
        await incidents.POST(
          new Request("http://localhost/api/admin/incidents", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ incidentId, action: "benign" }),
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await incidents.POST(
          new Request("http://localhost/api/admin/incidents", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              incidentId,
              action: "benign",
              reason: "Verified approved work and expected context change.",
            }),
          }),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        db.sqlite.prepare("SELECT status,resolution FROM incidents WHERE id=?").get(incidentId) as {
          status: string;
          resolution: string;
        }
      ).status,
    ).toBe("BENIGN");
    expect(
      db.sqlite
        .prepare("SELECT 1 FROM audit_events WHERE event_type='INCIDENT_BENIGN' AND target_id=?")
        .get(incidentId),
    ).toBeTruthy();
  });
  it("enforces protected data and requires password verification before step-up access", async () => {
    const resourceId = "test-confidential";
    db.sqlite
      .prepare(
        "INSERT INTO resources(id,title,resource_type,required_permission,classification,content) VALUES(?,?,?,?,?,?)",
      )
      .run(
        resourceId,
        "Test confidential",
        "confidential-test",
        "resources:engineering:read",
        "Confidential",
        "SECRET",
      );
    auth.actor = {
      id: employeeId,
      sessionId,
      name: "Employee One",
      email: "one@demo.test",
      status: "ACTIVE",
      organizationId: "default",
      roles: ["Backend Engineer"],
      permissions: ["resources:engineering:read"],
    };
    const create = await policies.POST(
      new Request("http://localhost/api/admin/policies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Step-up resource policy",
          resource: "confidential-test",
          action: "read",
          effect: "STEP_UP_AUTH",
          conditions: {},
          enabled: true,
        }),
      }),
    );
    expect(create.status).toBe(403);
    auth.actor = sa;
    await policies.POST(
      new Request("http://localhost/api/admin/policies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Step-up resource policy",
          resource: "confidential-test",
          action: "read",
          effect: "STEP_UP_AUTH",
          conditions: {},
          enabled: true,
        }),
      }),
    );
    auth.actor = {
      id: employeeId,
      sessionId,
      name: "Employee One",
      email: "one@demo.test",
      status: "ACTIVE",
      organizationId: "default",
      roles: ["Backend Engineer"],
      permissions: ["resources:engineering:read"],
    };
    const req = () =>
      new Request("http://localhost/api/access", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resourceId, action: "read" }),
      });
    const first = await access.POST(req());
    expect(first.status).toBe(428);
    const firstBody = (await first.json()) as { data: { requestId: string } };
    const failed = await stepUp.POST(
      new Request("http://localhost/api/access/step-up", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ requestId: firstBody.data.requestId, password: "wrong" }),
      }),
    );
    expect(failed.status).toBe(401);
    const verified = await stepUp.POST(
      new Request("http://localhost/api/access/step-up", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          requestId: firstBody.data.requestId,
          password: "EmployeeSecurePassword!234",
        }),
      }),
    );
    expect(verified.status).toBe(200);
    const allowed = await access.POST(req());
    expect(allowed.status).toBe(200);
    expect(
      ((await allowed.json()) as { data: { resource: { content: string } } }).data.resource.content,
    ).toBe("SECRET");
  });
  it("records ordinary access and triggers one scoped alert only after repeated denials", async () => {
    process.env.ANOMALY_DENIAL_LIMIT = "2";
    process.env.ANOMALY_DENIAL_WINDOW_SECONDS = "120";
    process.env.ANOMALY_REQUEST_LIMIT = "10000";
    const resourceId = "test-denied-resource";
    db.sqlite
      .prepare(
        "INSERT INTO resources(id,title,resource_type,required_permission,classification,content) VALUES(?,?,?,?,?,?)",
      )
      .run(
        resourceId,
        "Restricted HR file",
        "private-hr-test",
        "resources:hr:read",
        "Restricted",
        "MUST NOT LEAK",
      );
    auth.actor = {
      id: employeeId,
      sessionId,
      name: "Employee One",
      email: "one@demo.test",
      status: "ACTIVE",
      organizationId: "default",
      roles: ["Backend Engineer"],
      permissions: ["resources:engineering:read"],
    };
    const request = () =>
      new Request("http://localhost/api/access", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resourceId, action: "read" }),
      });
    const normalResourceId = "test-normal-resource";
    db.sqlite
      .prepare(
        "INSERT INTO resources(id,title,resource_type,required_permission,classification,content) VALUES(?,?,?,?,?,?)",
      )
      .run(
        normalResourceId,
        "Engineering handbook",
        "test-engineering",
        "resources:engineering:read",
        "Internal",
        "OK",
      );
    const allowed = await access.POST(
      new Request("http://localhost/api/access", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resourceId: normalResourceId, action: "read" }),
      }),
    );
    expect(allowed.status).toBe(200);
    expect((await access.POST(request())).status).toBe(403);
    expect(
      Number(
        (
          db.sqlite
            .prepare(
              "SELECT COUNT(*) n FROM behavior_alerts WHERE user_id=? AND rule_id='REPEATED_AUTHORIZATION_DENIALS'",
            )
            .get(employeeId) as { n: number }
        ).n,
      ),
    ).toBe(0);
    expect((await access.POST(request())).status).toBe(403);
    expect((await access.POST(request())).status).toBe(403);
    const alertRows = db.sqlite
      .prepare(
        "SELECT id,incident_id,observed_value,evidence FROM behavior_alerts WHERE user_id=? AND rule_id='REPEATED_AUTHORIZATION_DENIALS'",
      )
      .all(employeeId) as {
      id: string;
      incident_id: string;
      observed_value: string;
      evidence: string;
    }[];
    expect(alertRows).toHaveLength(1);
    expect(Number(alertRows[0].observed_value)).toBeGreaterThanOrEqual(2);
    expect(JSON.parse(alertRows[0].evidence).events.length).toBeGreaterThanOrEqual(2);
    expect(
      Number(
        (
          db.sqlite
            .prepare(
              "SELECT COUNT(*) n FROM incidents WHERE user_id=? AND reason LIKE '%REPEATED_AUTHORIZATION_DENIALS%' AND status IN ('NEW','INVESTIGATING')",
            )
            .get(employeeId) as { n: number }
        ).n,
      ),
    ).toBe(1);
    auth.actor = admin;
    const scoped = await alerts.GET();
    const scopedBody = (await scoped.json()) as { data: { alerts: { id: string }[] } };
    expect(scopedBody.data.alerts.some((row) => row.id === alertRows[0].id)).toBe(true);
    const acknowledged = await alerts.PATCH(
      new Request("http://localhost/api/admin/alerts", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ alertId: alertRows[0].id, action: "acknowledge" }),
      }),
    );
    expect(acknowledged.status).toBe(200);
    expect(
      (
        db.sqlite.prepare("SELECT status FROM behavior_alerts WHERE id=?").get(alertRows[0].id) as {
          status: string;
        }
      ).status,
    ).toBe("ACKNOWLEDGED");
    const outsiderAlertId = randomUUID();
    db.sqlite
      .prepare(
        "INSERT INTO behavior_alerts(id,user_id,organization_id,rule_id,severity,status,trigger_condition,observed_value,threshold_value,evidence,synthetic,created_at,updated_at) VALUES(?,?,?,'TEST','WARNING','OPEN','test','1','1','{}',0,?,?)",
      )
      .run(outsiderAlertId, outsiderId, "other", db.now(), db.now());
    const scopedAgain = await alerts.GET();
    expect(
      ((await scopedAgain.json()) as { data: { alerts: { id: string }[] } }).data.alerts.some(
        (row) => row.id === outsiderAlertId,
      ),
    ).toBe(false);
    const outsiderIncidentId = randomUUID();
    const timestamp = db.now();
    db.sqlite
      .prepare(
        "INSERT INTO incidents(id,user_id,severity,status,reason,evidence,created_at,updated_at) VALUES(?,?,?,'NEW','Other organization finding','{}',?,?)",
      )
      .run(outsiderIncidentId, outsiderId, "WARNING", timestamp, timestamp);
    auth.actor = admin;
    const scopedIncidents = await incidents.GET();
    expect(
      (
        (await scopedIncidents.json()) as { data: { incidents: { id: string }[] } }
      ).data.incidents.some((row) => row.id === outsiderIncidentId),
    ).toBe(false);
    auth.actor = sa;
    const global = await alerts.GET();
    expect(
      ((await global.json()) as { data: { alerts: { id: string }[] } }).data.alerts.some(
        (row) => row.id === outsiderAlertId,
      ),
    ).toBe(true);
    const globalIncidents = await incidents.GET();
    expect(
      (
        (await globalIncidents.json()) as { data: { incidents: { id: string }[] } }
      ).data.incidents.some((row) => row.id === outsiderIncidentId),
    ).toBe(true);
    delete process.env.ANOMALY_DENIAL_LIMIT;
    delete process.env.ANOMALY_DENIAL_WINDOW_SECONDS;
    delete process.env.ANOMALY_REQUEST_LIMIT;
  });
  it("detects request bursts, notifies scoped admins, supports escalation, and revokes sessions", async () => {
    process.env.ANOMALY_REQUEST_LIMIT = "2";
    auth.actor = {
      id: employeeId,
      sessionId,
      name: "Employee One",
      email: "one@demo.test",
      status: "ACTIVE",
      organizationId: "default",
      roles: ["Backend Engineer"],
      permissions: ["resources:engineering:read"],
    };
    await access.POST(
      new Request("http://localhost/api/access", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resourceId: "e-guide", action: "read" }),
      }),
    );
    const incident = db.sqlite
      .prepare(
        "SELECT id FROM incidents WHERE user_id=? AND reason LIKE 'Excessive access requests%' ORDER BY created_at DESC LIMIT 1",
      )
      .get(employeeId) as { id: string } | undefined;
    expect(incident).toBeTruthy();
    expect(
      db.sqlite
        .prepare("SELECT 1 FROM notifications WHERE user_id=? AND event_type='behavior.alert'")
        .get(admin.id),
    ).toBeTruthy();
    auth.actor = admin;
    const escalated = await incidents.POST(
      new Request("http://localhost/api/admin/incidents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          incidentId: incident!.id,
          action: "escalate",
          reason: "Repeated requests require platform review.",
        }),
      }),
    );
    expect(escalated.status).toBe(200);
    auth.actor = sa;
    const resolved = await incidents.POST(
      new Request("http://localhost/api/admin/incidents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          incidentId: incident!.id,
          action: "resolve",
          reason: "Reviewed evidence; closed after investigation.",
        }),
      }),
    );
    expect(resolved.status).toBe(200);
    expect(
      (
        db.sqlite.prepare("SELECT status FROM incidents WHERE id=?").get(incident!.id) as {
          status: string;
        }
      ).status,
    ).toBe("RESOLVED");
    expect(
      db.sqlite
        .prepare("SELECT 1 FROM audit_events WHERE target_id=? AND event_type='INCIDENT_RESOLVE'")
        .get(incident!.id),
    ).toBeTruthy();
    const terminated = await sessions.DELETE(
      new Request("http://localhost/api/admin/sessions", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId }),
      }),
    );
    expect(terminated.status).toBe(200);
    const row = db.sqlite
      .prepare("SELECT status,reason,logout_at FROM sessions WHERE id=?")
      .get(sessionId) as { status: string; reason: string; logout_at: string };
    expect(row.status).toBe("REVOKED");
    expect(row.reason).toBe("ADMIN_TERMINATED");
    expect(row.logout_at).toBeTruthy();
    delete process.env.ANOMALY_REQUEST_LIMIT;
  });
  it("runs stored synthetic scenarios through the evaluator and persists the actual results", async () => {
    auth.actor = admin;
    const scenarios = await import("../app/api/admin/scenarios/route");
    const response = await scenarios.POST();
    expect(response.status).toBe(200);
    const result = (await response.json()) as {
      data: {
        results: { actual: string; matchesExpected: boolean }[];
        metrics: { synthetic: boolean };
      };
    };
    expect(result.data.metrics.synthetic).toBe(true);
    expect(result.data.results.length).toBe(12);
    expect(
      result.data.results.every(
        (row) => typeof row.actual === "string" && typeof row.matchesExpected === "boolean",
      ),
    ).toBe(true);
    expect(
      Number((db.sqlite.prepare("SELECT COUNT(*) n FROM scenario_runs").get() as { n: number }).n),
    ).toBe(12);
  });

  it("runs isolated formal research fixtures as admin without persisting authorization records", async () => {
    auth.actor = null;
    expect((await mcacResearch.GET()).status).toBe(401);
    auth.actor = { ...admin, roles: ["Employee"] };
    expect((await mcacResearch.GET()).status).toBe(403);
    const forbidden = await mcacResearch.POST(
      new Request("http://localhost/api/admin/mcac-research", {
        method: "POST",
        body: JSON.stringify({ action: "run", scenarioId: "normal-access" }),
      }),
    );
    expect(forbidden.status).toBe(403);

    auth.actor = admin;
    const before = {
      access: Number((db.sqlite.prepare("SELECT COUNT(*) n FROM access_requests").get() as { n: number }).n),
      decisions: Number((db.sqlite.prepare("SELECT COUNT(*) n FROM authorization_decisions").get() as { n: number }).n),
      audits: Number((db.sqlite.prepare("SELECT COUNT(*) n FROM audit_events").get() as { n: number }).n),
    };
    const unknown = await mcacResearch.POST(
      new Request("http://localhost/api/admin/mcac-research", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "run", scenarioId: "not-a-fixture" }),
      }),
    );
    expect(unknown.status).toBe(404);

    const listing = await mcacResearch.GET();
    const listingBody = (await listing.json()) as { data: { scenarios: { id: string }[] } };
    expect(listingBody.data.scenarios).toHaveLength(11);
    const { evaluateMcac } = await import("./mcac/decision");
    const { getResearchScenario } = await import("./mcac/research-fixtures");
    for (const scenario of listingBody.data.scenarios) {
      const response = await mcacResearch.POST(
        new Request("http://localhost/api/admin/mcac-research", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "run", scenarioId: scenario.id }),
        }),
      );
      expect(response.status, scenario.id).toBe(200);
      const body = (await response.json()) as {
        data: {
          synthetic: boolean;
          evaluator: string;
          runId: string;
          result: ReturnType<typeof evaluateMcac>;
        };
      };
      expect(body.data.synthetic).toBe(true);
      expect(body.data.evaluator).toBe("lib/mcac/decision.ts:evaluateMcac");
      expect(body.data.result.trace.requestId).toBe(`synthetic-${scenario.id}`);
      expect(body.data.result).toEqual(evaluateMcac(getResearchScenario(scenario.id)!.input));
    }

    const initial = await mcacResearch.POST(
      new Request("http://localhost/api/admin/mcac-research", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "run", scenarioId: "normal-access" }),
      }),
    );
    const initialBody = (await initial.json()) as {
      data: {
        runId: string;
        policy: import("./mcac/types").PolicyVersion;
        result: ReturnType<typeof evaluateMcac>;
      };
    };
    const replay = await mcacResearch.POST(
      new Request("http://localhost/api/admin/mcac-research", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "replay",
          scenarioId: "normal-access",
          runId: initialBody.data.runId,
          policyVersion: initialBody.data.policy.version,
        }),
      }),
    );
    expect(replay.status).toBe(200);
    const replayBody = (await replay.json()) as {
      data: {
        replay: {
          verified: boolean;
          originalDecision: string;
          replayedDecision: string;
          reasons: string[];
          gammaTraceComparison: { matches: boolean };
        };
      };
    };
    expect(replayBody.data.replay).toMatchObject({
      verified: true,
      originalDecision: "ALLOW",
      replayedDecision: "ALLOW",
      reasons: [],
      gammaTraceComparison: { matches: true },
    });

    const { replayResearchRun, rememberResearchRun } = await import("./mcac/research-run-store");
    const { replayTrace } = await import("./mcac/replay");
    const { hashTrace } = await import("./mcac/trace");
    const oldTraceRecord = Object.fromEntries(
      Object.entries(initialBody.data.result.trace).filter(([key]) => key !== "hash"),
    ) as Omit<typeof initialBody.data.result.trace, "hash">;
    const changedTraceRecord = { ...oldTraceRecord, decision: "DENY" as const };
    const changedTrace = { ...changedTraceRecord, hash: hashTrace(changedTraceRecord) };
    const originalRun = rememberResearchRun("normal-access", initialBody.data.result.trace);
    const failedReplay = replayResearchRun(
      originalRun,
      initialBody.data.policy,
      (_trace, policy) => replayTrace(changedTrace, policy).trace,
    );
    expect(failedReplay.verified).toBe(false);
    expect(failedReplay.reasons).toContain(
      "REPLAY_VERIFICATION_FAILED: Replay did not reproduce the recorded authorization result",
    );
    expect(failedReplay.gammaTraceMatches).toBe(false);

    const unsupportedPolicy = await mcacResearch.POST(
      new Request("http://localhost/api/admin/mcac-research", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "replay",
          scenarioId: "normal-access",
          runId: initialBody.data.runId,
          policyVersion: "unpublished-or-unknown-policy",
        }),
      }),
    );
    expect(unsupportedPolicy.status).toBe(409);
    const unknownReplayScenario = await mcacResearch.POST(
      new Request("http://localhost/api/admin/mcac-research", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "replay",
          scenarioId: "not-a-fixture",
          runId: initialBody.data.runId,
          policyVersion: initialBody.data.policy.version,
        }),
      }),
    );
    expect(unknownReplayScenario.status).toBe(404);
    const arbitraryInput = await mcacResearch.POST(
      new Request("http://localhost/api/admin/mcac-research", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "replay",
          scenarioId: "normal-access",
          runId: initialBody.data.runId,
          policyVersion: initialBody.data.policy.version,
          context: { injected: true },
        }),
      }),
    );
    expect(arbitraryInput.status).toBe(400);
    expect(Number((db.sqlite.prepare("SELECT COUNT(*) n FROM access_requests").get() as { n: number }).n)).toBe(before.access);
    expect(Number((db.sqlite.prepare("SELECT COUNT(*) n FROM authorization_decisions").get() as { n: number }).n)).toBe(before.decisions);
    expect(Number((db.sqlite.prepare("SELECT COUNT(*) n FROM audit_events").get() as { n: number }).n)).toBe(before.audits);
  });

  it("does not read live session state for the isolated research route", async () => {
    auth.actor = admin;
    const actorSpy = vi.spyOn(await import("./auth"), "currentActor");
    await mcacResearch.GET();
    const post = await mcacResearch.POST(
      new Request("http://localhost/api/admin/mcac-research", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "run", scenarioId: "normal-access" }),
      }),
    );
    expect(post.status).toBe(200);
    const runBody = (await post.json()) as { data: { runId: string; policy: { version: string } } };
    const replay = await mcacResearch.POST(
      new Request("http://localhost/api/admin/mcac-research", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "replay",
          scenarioId: "normal-access",
          runId: runBody.data.runId,
          policyVersion: runBody.data.policy.version,
        }),
      }),
    );
    expect(replay.status).toBe(200);
    expect(actorSpy).not.toHaveBeenCalled();
    actorSpy.mockRestore();
  });

  it("compares only selected server fixtures and derives metrics from actual evaluator results", async () => {
    auth.actor = admin;
    const actorSpy = vi.spyOn(await import("./auth"), "currentActor");
    const before = {
      access: Number((db.sqlite.prepare("SELECT COUNT(*) n FROM access_requests").get() as { n: number }).n),
      decisions: Number((db.sqlite.prepare("SELECT COUNT(*) n FROM authorization_decisions").get() as { n: number }).n),
    };
    const response = await mcacResearch.POST(
      new Request("http://localhost/api/admin/mcac-research", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "compare", scenarioIds: ["normal-access", "gamma-violated"] }),
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: {
        results: {
          rbac: { decision: string };
          mcac: { trace: { baseline: boolean }; policyVersion: string; gamma: { constraints: { outcome: string }[] } };
        }[];
        metrics: { totalScenarios: number; decisionDifferenceCount: number; mcacRestrictionCount: number; synthetic: boolean };
      };
    };
    expect(body.data.results).toHaveLength(2);
    expect(body.data.results[0].rbac.decision).toBe("ALLOW");
    expect(body.data.results[0].mcac.trace.baseline).toBe(true);
    expect(body.data.results[0].mcac.policyVersion).toBe("mcac-fixed-synthetic-research-policy-v1");
    expect(body.data.results[1].mcac.gamma.constraints[0].outcome).toBe("VIOLATED");
    expect(body.data.metrics).toMatchObject({ totalScenarios: 2, decisionDifferenceCount: 1, mcacRestrictionCount: 1 });
    expect(body.data.metrics.synthetic).toBe(true);
    expect(actorSpy).not.toHaveBeenCalled();
    expect(Number((db.sqlite.prepare("SELECT COUNT(*) n FROM access_requests").get() as { n: number }).n)).toBe(before.access);
    expect(Number((db.sqlite.prepare("SELECT COUNT(*) n FROM authorization_decisions").get() as { n: number }).n)).toBe(before.decisions);

    const invalid = await mcacResearch.POST(
      new Request("http://localhost/api/admin/mcac-research", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "compare", scenarioIds: ["normal-access", "injected-context"] }),
      }),
    );
    expect(invalid.status).toBe(404);
    actorSpy.mockRestore();
  });

  it("surfaces changed replay decisions and Γ traces as failed route results", async () => {
    auth.actor = admin;
    const { getResearchScenario } = await import("./mcac/research-fixtures");
    const { evaluateMcac } = await import("./mcac/decision");
    const { rememberResearchRun } = await import("./mcac/research-run-store");
    const scenario = getResearchScenario("gamma-satisfied")!;
    const original = evaluateMcac(scenario.input);
    const run = rememberResearchRun(scenario.id, original.trace);
    const replayModule = await import("./mcac/replay");
    const replaySpy = vi.spyOn(replayModule, "replayTrace");
    const changedDecision = {
      ...original,
      decision: "DENY" as const,
      trace: { ...original.trace, decision: "DENY" as const, hash: "changed-decision-hash" },
    };
    replaySpy.mockReturnValueOnce(changedDecision);
    const decisionResponse = await mcacResearch.POST(
      new Request("http://localhost/api/admin/mcac-research", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "replay",
          scenarioId: scenario.id,
          runId: run.runId,
          policyVersion: scenario.input.policy.version,
        }),
      }),
    );
    const decisionBody = (await decisionResponse.json()) as {
      data: { replay: { verified: boolean; originalDecision: string; replayedDecision: string; reasons: string[] } };
    };
    expect(decisionBody.data.replay).toMatchObject({
      verified: false,
      originalDecision: original.decision,
      replayedDecision: "DENY",
    });
    expect(decisionBody.data.replay.reasons).toContain("ORIGINAL_DECISION_MISMATCH");
    expect(decisionBody.data.replay.reasons).toContain("ORIGINAL_TRACE_HASH_MISMATCH");

    const gammaRun = rememberResearchRun(scenario.id, original.trace);
    const changedGamma = {
      ...original.trace.gamma!,
      constraints: original.trace.gamma!.constraints.map((constraint, index) =>
        index === 0 ? { ...constraint, outcome: "VIOLATED" as const } : constraint,
      ),
    };
    replaySpy.mockReturnValueOnce({
      ...original,
      trace: { ...original.trace, gamma: changedGamma, hash: "changed-gamma-hash" },
    });
    const gammaResponse = await mcacResearch.POST(
      new Request("http://localhost/api/admin/mcac-research", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "replay",
          scenarioId: scenario.id,
          runId: gammaRun.runId,
          policyVersion: scenario.input.policy.version,
        }),
      }),
    );
    const gammaBody = (await gammaResponse.json()) as {
      data: {
        replay: {
          verified: boolean;
          reasons: string[];
          gammaTraceComparison: { matches: boolean; replayed: unknown };
        };
      };
    };
    expect(gammaBody.data.replay.verified).toBe(false);
    expect(gammaBody.data.replay.reasons).toContain("GAMMA_TRACE_MISMATCH");
    expect(gammaBody.data.replay.reasons).toContain("ORIGINAL_TRACE_HASH_MISMATCH");
    expect(gammaBody.data.replay.gammaTraceComparison.matches).toBe(false);
    expect(gammaBody.data.replay.gammaTraceComparison.replayed).toEqual(changedGamma);
    replaySpy.mockRestore();
  });
});
