import { actorOrError, isAdmin, isSuperAdmin, json } from "@/lib/api";
import { audit, id, now, sqlite } from "@/lib/db";
import { thetaPolicyErrors } from "@/lib/mcac/theta-validation";
import { validatePolicyGammaConstraints } from "@/lib/mcac/gamma-policy";
import { z } from "zod";

const actionSchema = z.enum(["read", "write", "export", "admin"]);
const draftSchema = z
  .object({
    name: z.string().trim().min(3).max(120),
    resourceClass: z.string().trim().min(1).max(120),
    action: actionSchema,
    policy: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();

async function superAdmin() {
  const result = await actorOrError();
  if ("response" in result) return result;
  if (!isSuperAdmin(result.actor))
    return {
      response: Response.json(
        { error: { code: "FORBIDDEN", message: "Super Admin access required." } },
        { status: 403 },
      ),
    };
  return result;
}

export async function GET() {
  const auth = await actorOrError();
  if ("response" in auth) return auth.response;
  if (!isAdmin(auth.actor))
    return Response.json(
      { error: { code: "FORBIDDEN", message: "Admin access required." } },
      { status: 403 },
    );
  const drafts = isSuperAdmin(auth.actor)
    ? sqlite
        .prepare(
          "SELECT id,name,resource_class,action,policy_json,status,validation_report,created_by,updated_by,created_at,updated_at FROM mcac_policy_drafts ORDER BY updated_at DESC",
        )
        .all()
    : [];
  const versions = sqlite
    .prepare(
      "SELECT version,parent_version,snapshot_hash,created_at FROM mcac_policy_versions ORDER BY created_at DESC",
    )
    .all();
  return json({
    drafts,
    versions,
    lifecycle:
      "draft editing is available; validation/publication/activation are gated on unresolved formal semantics",
  });
}

export async function POST(req: Request) {
  const auth = await superAdmin();
  if ("response" in auth) return auth.response;
  const parsed = draftSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return Response.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Provide a name, resource class, and supported action for the draft.",
        },
      },
      { status: 400 },
    );
  const gammaValidation = validatePolicyGammaConstraints(parsed.data.policy);
  if (!gammaValidation.ok) return gammaValidationErrorResponse(gammaValidation.errors);
  const draftId = id();
  const timestamp = now();
  sqlite
    .prepare(
      "INSERT INTO mcac_policy_drafts(id,name,resource_class,action,policy_json,status,validation_report,created_by,updated_by,created_at,updated_at) VALUES(?,?,?,?,?,'DRAFT','[]',?,?,?,?)",
    )
    .run(
      draftId,
      parsed.data.name,
      parsed.data.resourceClass,
      parsed.data.action,
      JSON.stringify(parsed.data.policy),
      auth.actor.id,
      auth.actor.id,
      timestamp,
      timestamp,
    );
  audit(auth.actor.id, "MCAC_POLICY_DRAFT_CREATED", draftId, {
    resourceClass: parsed.data.resourceClass,
    action: parsed.data.action,
  });
  return json({ id: draftId, status: "DRAFT" }, 201);
}

export async function PATCH(req: Request) {
  const auth = await superAdmin();
  if ("response" in auth) return auth.response;
  const parsed = z
    .object({
      id: z.string().min(1),
      operation: z.enum(["edit", "validate"]),
      draft: draftSchema.optional(),
    })
    .strict()
    .safeParse(await req.json().catch(() => null));
  if (!parsed.success || (parsed.data.operation === "edit" && !parsed.data.draft))
    return Response.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid draft operation." } },
      { status: 400 },
    );
  const draft = sqlite
    .prepare(
      "SELECT id,status,policy_json,resource_class,action FROM mcac_policy_drafts WHERE id=?",
    )
    .get(parsed.data.id) as
    | { id: string; status: string; policy_json: string; resource_class: string; action: string }
    | undefined;
  if (!draft)
    return Response.json(
      { error: { code: "NOT_FOUND", message: "Formal policy draft not found." } },
      { status: 404 },
    );
  if (draft.status !== "DRAFT")
    return Response.json(
      {
        error: {
          code: "IMMUTABLE_STATE",
          message: "Only DRAFT policies can be edited or revalidated.",
        },
      },
      { status: 409 },
    );
  if (parsed.data.operation === "edit") {
    const update = parsed.data.draft!;
    const gammaValidation = validatePolicyGammaConstraints(update.policy);
    if (!gammaValidation.ok) return gammaValidationErrorResponse(gammaValidation.errors);
    const timestamp = now();
    sqlite
      .prepare(
        "UPDATE mcac_policy_drafts SET name=?,resource_class=?,action=?,policy_json=?,validation_report='[]',updated_by=?,updated_at=? WHERE id=? AND status='DRAFT'",
      )
      .run(
        update.name,
        update.resourceClass,
        update.action,
        JSON.stringify(update.policy),
        auth.actor.id,
        timestamp,
        draft.id,
      );
    audit(auth.actor.id, "MCAC_POLICY_DRAFT_UPDATED", draft.id, {
      resourceClass: update.resourceClass,
      action: update.action,
    });
    return json({ updated: true, status: "DRAFT" });
  }
  let policy: Record<string, unknown>;
  try {
    policy = JSON.parse(draft.policy_json) as Record<string, unknown>;
  } catch {
    policy = {};
  }
  const gammaValidation = validatePolicyGammaConstraints(policy);
  const report = policyReadinessReport(policy, draft.resource_class, draft.action, gammaValidation);
  report.push(
    "BLOCKED: publication is disabled until formal policy validation covers the complete evaluator contract and resolved specification decisions.",
  );
  sqlite
    .prepare(
      "UPDATE mcac_policy_drafts SET validation_report=?,updated_by=?,updated_at=? WHERE id=? AND status='DRAFT'",
    )
    .run(JSON.stringify(report), auth.actor.id, now(), draft.id);
  audit(auth.actor.id, "MCAC_POLICY_DRAFT_VALIDATED", draft.id, { result: "BLOCKED" });
  return json({
    status: "BLOCKED",
    report,
    gammaValidation: {
      valid: gammaValidation.ok,
      canonicalBytes: gammaValidation.canonicalBytes,
      digest: gammaValidation.digest,
      errors: gammaValidation.errors,
    },
  });
}

function gammaValidationErrorResponse(
  errors: ReturnType<typeof validatePolicyGammaConstraints>["errors"],
): Response {
  return Response.json(
    {
      error: {
        code: "GAMMA_VALIDATION_ERROR",
        message: "The formal policy contains invalid Γ constraints.",
        details: errors,
      },
    },
    { status: 400 },
  );
}

function policyReadinessReport(
  policy: Record<string, unknown>,
  resourceClass: string,
  action: string,
  gammaValidation = validatePolicyGammaConstraints(policy),
): string[] {
  const report: string[] = [];
  const required = [
    "version",
    "resourceProfiles",
    "freshnessSeconds",
    "verificationRequired",
    "consistencyConstraints",
    "expectedTransitions",
    "rules",
    "strictLowSensitivity",
    "interactions",
  ];
  for (const field of required)
    if (!(field in policy)) report.push(`Missing formal policy field: ${field}.`);
  const profiles =
    typeof policy.resourceProfiles === "object" && policy.resourceProfiles !== null
      ? (policy.resourceProfiles as Record<string, unknown>)
      : {};
  const profile = profiles[resourceClass] as Record<string, unknown> | undefined;
  if (
    !profile ||
    !["L", "H"].includes(String(profile.sensitivity)) ||
    typeof profile.stepUpAvailable !== "boolean" ||
    typeof profile.waiverDurationSeconds !== "number"
  )
    report.push(`A complete resource profile for ${resourceClass} is required.`);
  if (
    !Array.isArray(policy.rules) ||
    !(policy.rules as Array<Record<string, unknown>>).some(
      (rule) =>
        rule.resourceClass === resourceClass &&
        Array.isArray(rule.actions) &&
        rule.actions.includes(action),
    )
  )
    report.push(`At least one formal rule must explicitly cover ${resourceClass}/${action}.`);
  if (!gammaValidation.ok)
    report.push(
      ...gammaValidation.errors.map(
        (error) => `Γ ${error.code} at ${error.path}: ${error.message}`,
      ),
    );
  else if (gammaValidation.hasLegacyConstraints)
    report.push(
      "BLOCKED: legacy consistency declarations do not contain a Γ AST and remain unsupported for formal readiness.",
    );
  report.push(...thetaPolicyErrors(policy));
  if (
    Array.isArray(policy.rules) &&
    (policy.rules as Array<Record<string, unknown>>).some(
      (rule) =>
        (Array.isArray(rule.environmental) ? rule.environmental : []).length ||
        (Array.isArray(rule.behavioral) ? rule.behavioral : []).length,
    )
  )
    report.push(
      "BLOCKED: the manuscript does not establish that the implemented comparator inventory is the exhaustive grammar for ⊕.",
    );
  if (typeof policy.version !== "string" || !policy.version.trim())
    report.push("A non-empty immutable version identifier is required before publication.");
  return report;
}
