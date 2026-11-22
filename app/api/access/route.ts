import { actorOrError, isAdmin, json } from "@/lib/api";
import { evaluateBehaviorRules } from "@/lib/behavior";
import { audit, id, now, sqlite } from "@/lib/db";
import {
  evaluateAccess,
  isWithinTimeWindow,
  type AccessContext,
  type Policy,
} from "@/lib/authorization";
import { z } from "zod";

const schema = z.object({
  resourceId: z.string().min(1),
  action: z.enum(["read", "update"]),
  scenario: z.string().optional(),
});
type Resource = {
  id: string;
  title: string;
  required_permission: string;
  content: string;
  resource_type: string;
  classification: string;
};
type StoredPolicy = { id: string; effect: "ALLOW" | "DENY" | "STEP_UP_AUTH"; conditions: string };

export async function POST(req: Request) {
  const start = performance.now();
  const auth = await actorOrError();
  if ("response" in auth) return auth.response;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return Response.json(
      { error: { code: "VALIDATION_ERROR", message: "Provide a resource and action." } },
      { status: 400 },
    );
  const resource = sqlite
    .prepare("SELECT * FROM resources WHERE id=?")
    .get(parsed.data.resourceId) as Resource | undefined;
  if (!resource)
    return Response.json(
      { error: { code: "NOT_FOUND", message: "Resource not found." } },
      { status: 404 },
    );

  const timestamp = now();
  const windowSeconds = Math.max(1, Number(process.env.ANOMALY_REQUEST_WINDOW_SECONDS ?? 300));
  const windowStart = new Date(new Date(timestamp).getTime() - windowSeconds * 1000).toISOString();
  const ip =
    process.env.TRUST_PROXY_HEADERS === "true"
      ? (req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null)
      : null;
  const priorRequests = Number(
    (
      sqlite
        .prepare("SELECT COUNT(*) n FROM access_requests WHERE user_id=? AND created_at>=?")
        .get(auth.actor.id, windowStart) as { n: number }
    ).n,
  );
  const dt = new Date(timestamp);
  const defaultWindow = {
    start: process.env.BUSINESS_HOURS_START ?? "09:00",
    end: process.env.BUSINESS_HOURS_END ?? "18:00",
    timezone: process.env.DISPLAY_TIMEZONE ?? "Asia/Kolkata",
  };
  const context: AccessContext = {
    now: dt,
    businessHours: isWithinTimeWindow(dt, defaultWindow),
    registeredDevice: false,
    networkKnown: false,
    requestsInWindow: priorRequests,
    unusualSequence: false,
    contextAvailable: true,
    contextAgeSeconds: 0,
    stepUpVerified: Boolean(
      sqlite
        .prepare(
          "SELECT 1 FROM step_up_verifications WHERE session_id=? AND resource=? AND action=? AND expires_at>?",
        )
        .get(auth.actor.sessionId, resource.id, parsed.data.action, timestamp),
    ),
  };
  const storedPolicies = sqlite
    .prepare(
      "SELECT id,effect,conditions FROM policies WHERE enabled=1 AND (resource=? OR resource='*') AND (action=? OR action='*')",
    )
    .all(resource.resource_type, parsed.data.action) as StoredPolicy[];
  let synthetic = false;
  if (parsed.data.scenario) {
    if (!isAdmin(auth.actor))
      return Response.json(
        { error: { code: "FORBIDDEN", message: "Scenario Lab is restricted to administrators." } },
        { status: 403 },
      );
    const scenario = sqlite
      .prepare("SELECT input FROM scenarios WHERE id=?")
      .get(parsed.data.scenario) as { input: string } | undefined;
    if (!scenario)
      return Response.json(
        { error: { code: "NOT_FOUND", message: "Scenario not found." } },
        { status: 404 },
      );
    Object.assign(context, JSON.parse(scenario.input));
    synthetic = true;
  }
  const policies: Policy[] = storedPolicies.map((policy) => ({
    id: policy.id,
    effect: policy.effect,
    ...JSON.parse(policy.conditions),
  }));
  const decision = evaluateAccess({
    permissions: auth.actor.permissions,
    requiredPermission: resource.required_permission,
    context,
    policies,
  });
  const requestId = id();
  const safeContext = {
    ...context,
    observedAt: timestamp,
    synthetic,
    environmental: {
      requestTime: {
        value: timestamp,
        source: synthetic ? "SIMULATED" : "SERVER_OBSERVED",
        status: "AVAILABLE",
        timezone: defaultWindow.timezone,
      },
      businessHoursWindow: {
        value: defaultWindow,
        source: "SERVER_POLICY_CONFIGURATION",
        status: "AVAILABLE",
      },
      ipAddress: {
        value: synthetic ? null : ip,
        source: ip ? "TRUSTED_PROXY_HEADER" : "UNAVAILABLE",
        status: ip ? "AVAILABLE" : "UNAVAILABLE",
      },
      networkClassification: { value: "UNKNOWN", source: "NOT_CONFIGURED", status: "UNAVAILABLE" },
      deviceIdentifier: { value: null, source: "NOT_CONFIGURED", status: "UNAVAILABLE" },
      deviceTrust: { value: "UNVERIFIED", source: "NOT_CONFIGURED", status: "UNAVAILABLE" },
      sessionState: { value: "AUTHENTICATED", source: "SERVER_SESSION", status: "AVAILABLE" },
    },
    behavior: {
      requestsInWindow: { value: priorRequests + 1, source: "DERIVED", windowSeconds },
      unusualSequence: { value: false, source: "NOT_CONFIGURED", status: "UNAVAILABLE" },
    },
  };

  const transaction = sqlite.transaction(() => {
    sqlite
      .prepare(
        "INSERT INTO access_requests(id,user_id,session_id,resource,action,created_at,context) VALUES(?,?,?,?,?,?,?)",
      )
      .run(
        requestId,
        auth.actor.id,
        auth.actor.sessionId,
        resource.id,
        parsed.data.action,
        timestamp,
        JSON.stringify(safeContext),
      );
    sqlite
      .prepare(
        "INSERT INTO session_context_snapshots(id,session_id,observed_at,source,context) VALUES(?,?,?,?,?)",
      )
      .run(
        id(),
        auth.actor.sessionId,
        timestamp,
        synthetic ? "SIMULATED" : "SERVER_OBSERVED",
        JSON.stringify(safeContext),
      );
    sqlite
      .prepare(
        "INSERT INTO authorization_decisions(id,request_id,user_id,resource,action,decision,reason_codes,explanation,context,duration_ms,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        id(),
        requestId,
        auth.actor.id,
        resource.id,
        parsed.data.action,
        decision.decision,
        JSON.stringify(decision.reasonCodes),
        decision.explanation,
        JSON.stringify(safeContext),
        performance.now() - start,
        timestamp,
      );
    audit(auth.actor.id, `ACCESS_${decision.decision}`, resource.id, {
      decision: decision.decision,
      reasonCodes: decision.reasonCodes,
      synthetic,
    });
    evaluateBehaviorRules({
      userId: auth.actor.id,
      organizationId: auth.actor.organizationId,
      sessionId: auth.actor.sessionId,
      requestId,
      resource: resource.id,
      action: parsed.data.action,
      decision: decision.decision,
      reasonCodes: decision.reasonCodes,
      createdAt: timestamp,
      synthetic,
    });
  });
  transaction();

  if (decision.decision !== "ALLOW")
    return Response.json(
      {
        data: {
          decision: decision.decision,
          reasonCodes: decision.reasonCodes,
          explanation: decision.explanation,
          requestId,
          stepUpEndpoint: decision.decision === "STEP_UP_AUTH" ? "/api/access/step-up" : undefined,
        },
      },
      { status: decision.decision === "STEP_UP_AUTH" ? 428 : 403 },
    );
  return json({
    decision: decision.decision,
    resource: {
      id: resource.id,
      title: resource.title,
      classification: resource.classification,
      content: resource.content,
    },
    reasonCodes: decision.reasonCodes,
    explanation: decision.explanation,
    requestId,
  });
}
