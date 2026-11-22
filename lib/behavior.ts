import { audit, id, notify, sqlite } from "@/lib/db";

type BehaviorInput = {
  userId: string;
  organizationId: string;
  sessionId: string;
  requestId: string;
  resource: string;
  action: string;
  decision: "ALLOW" | "DENY" | "STEP_UP_AUTH";
  reasonCodes: string[];
  createdAt: string;
  synthetic: boolean;
};

type EvidenceEvent = {
  requestId: string;
  resource: string;
  action: string;
  decision: string;
  reasonCodes: string[];
  createdAt: string;
};

function configuredInteger(name: string, fallback: number, minimum = 1) {
  const value = Number(process.env[name] ?? fallback);
  return Number.isSafeInteger(value) && value >= minimum ? value : fallback;
}

function evidenceFor(userId: string, since: string, limit: number): EvidenceEvent[] {
  const rows = sqlite
    .prepare(
      `SELECT d.request_id requestId,d.resource,d.action,d.decision,d.reason_codes reasonCodes,d.created_at createdAt
    FROM authorization_decisions d WHERE d.user_id=? AND d.created_at>=? ORDER BY d.created_at DESC LIMIT ?`,
    )
    .all(userId, since, limit) as Array<
    Omit<EvidenceEvent, "reasonCodes"> & { reasonCodes: string }
  >;
  return rows.map((row) => ({ ...row, reasonCodes: JSON.parse(row.reasonCodes) as string[] }));
}

function scopedRecipients(organizationId: string, includeSuperAdmins: boolean) {
  return sqlite
    .prepare(
      `SELECT DISTINCT u.id FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id
    WHERE u.status='ACTIVE' AND (r.name='Admin' AND u.organization_id=? OR (?=1 AND r.name='Super Admin'))`,
    )
    .all(organizationId, includeSuperAdmins ? 1 : 0) as { id: string }[];
}

/** Persist deterministic rule findings from an already-recorded access decision. Call inside the access transaction. */
export function evaluateBehaviorRules(input: BehaviorInput) {
  if (input.synthetic) return [];
  const findings: Array<{
    ruleId: string;
    label: string;
    severity: "WARNING" | "HIGH";
    observed: number | string;
    threshold: number | string;
    windowSeconds: number | null;
    evidence: EvidenceEvent[];
    autoEscalate: boolean;
  }> = [];
  const denialWindow = configuredInteger("ANOMALY_DENIAL_WINDOW_SECONDS", 120);
  const denialLimit = configuredInteger("ANOMALY_DENIAL_LIMIT", 5);
  const denialSince = new Date(
    new Date(input.createdAt).getTime() - denialWindow * 1000,
  ).toISOString();
  const denials = Number(
    (
      sqlite
        .prepare(
          "SELECT COUNT(*) n FROM authorization_decisions WHERE user_id=? AND decision='DENY' AND created_at>=?",
        )
        .get(input.userId, denialSince) as { n: number }
    ).n,
  );
  if (input.decision === "DENY" && denials >= denialLimit) {
    const autoEscalateLimit = configuredInteger(
      "ANOMALY_AUTO_ESCALATE_DENIAL_LIMIT",
      Number.MAX_SAFE_INTEGER,
    );
    findings.push({
      ruleId: "REPEATED_AUTHORIZATION_DENIALS",
      label: "Repeated authorization failures",
      severity: denials >= autoEscalateLimit ? "HIGH" : "WARNING",
      observed: denials,
      threshold: denialLimit,
      windowSeconds: denialWindow,
      evidence: evidenceFor(input.userId, denialSince, denialLimit + 10),
      autoEscalate: denials >= autoEscalateLimit,
    });
  }

  const requestWindow = configuredInteger("ANOMALY_REQUEST_WINDOW_SECONDS", 300);
  const requestLimit = configuredInteger("ANOMALY_REQUEST_LIMIT", 30);
  const requestSince = new Date(
    new Date(input.createdAt).getTime() - requestWindow * 1000,
  ).toISOString();
  const requestCount = Number(
    (
      sqlite
        .prepare("SELECT COUNT(*) n FROM access_requests WHERE user_id=? AND created_at>=?")
        .get(input.userId, requestSince) as { n: number }
    ).n,
  );
  if (requestCount > requestLimit)
    findings.push({
      ruleId: "REQUEST_VOLUME",
      label: "Excessive access requests (high request volume)",
      severity: "WARNING",
      observed: requestCount,
      threshold: requestLimit,
      windowSeconds: requestWindow,
      evidence: evidenceFor(input.userId, requestSince, 20),
      autoEscalate: false,
    });

  const contextualReasons = [
    "OUTSIDE_BUSINESS_HOURS",
    "OUTSIDE_ALLOWED_TIME_WINDOW",
    "UNREGISTERED_DEVICE",
    "UNKNOWN_NETWORK",
    "STALE_CONTEXT",
    "CONTEXT_UNAVAILABLE",
  ];
  const contextReason = input.reasonCodes.find((reason) => contextualReasons.includes(reason));
  if (contextReason)
    findings.push({
      ruleId: `CONTEXT_${contextReason}`,
      label: "Context policy condition failed",
      severity: "WARNING",
      observed: contextReason,
      threshold: "Policy condition must pass",
      windowSeconds: null,
      evidence: evidenceFor(input.userId, input.createdAt, 1),
      autoEscalate: false,
    });

  const alertIds: string[] = [];
  for (const finding of findings) {
    const openStatuses = "('OPEN','ACKNOWLEDGED','INVESTIGATING','ESCALATED')";
    let alert = sqlite
      .prepare(
        `SELECT id,incident_id,status FROM behavior_alerts WHERE user_id=? AND rule_id=? AND status IN ${openStatuses} ORDER BY created_at DESC LIMIT 1`,
      )
      .get(input.userId, finding.ruleId) as
      { id: string; incident_id: string | null; status: string } | undefined;
    const reason = `${finding.label}: ${finding.observed} observed; configured threshold ${finding.threshold}${finding.windowSeconds ? ` in ${finding.windowSeconds} seconds` : ""}`;
    const incidentReason = `${finding.label} (${finding.ruleId})`;
    let incident = sqlite
      .prepare(
        "SELECT id,status FROM incidents WHERE user_id=? AND reason=? AND status IN ('NEW','INVESTIGATING','ESCALATED') ORDER BY created_at DESC LIMIT 1",
      )
      .get(input.userId, incidentReason) as { id: string; status: string } | undefined;
    const evidence = JSON.stringify({
      ruleId: finding.ruleId,
      ruleVersion: 1,
      observed: finding.observed,
      threshold: finding.threshold,
      windowSeconds: finding.windowSeconds,
      events: finding.evidence,
    });
    if (!incident) {
      const incidentId = id();
      const shouldEscalate = finding.autoEscalate;
      sqlite
        .prepare(
          "INSERT INTO incidents(id,user_id,session_id,severity,status,reason,evidence,created_at,updated_at,escalated_by) VALUES(?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          incidentId,
          input.userId,
          input.sessionId,
          finding.severity,
          shouldEscalate ? "ESCALATED" : "NEW",
          incidentReason,
          evidence,
          input.createdAt,
          input.createdAt,
          null,
        );
      incident = { id: incidentId, status: shouldEscalate ? "ESCALATED" : "NEW" };
    }
    if (alert) {
      sqlite
        .prepare(
          "UPDATE behavior_alerts SET incident_id=?,severity=?,status=?,trigger_condition=?,observed_value=?,threshold_value=?,window_seconds=?,evidence=?,updated_at=? WHERE id=?",
        )
        .run(
          incident.id,
          finding.severity,
          finding.autoEscalate ? "ESCALATED" : alert.status,
          reason,
          String(finding.observed),
          String(finding.threshold),
          finding.windowSeconds,
          evidence,
          input.createdAt,
          alert.id,
        );
      if (finding.autoEscalate && incident.status !== "ESCALATED") {
        sqlite
          .prepare(
            "UPDATE incidents SET status='ESCALATED',severity='HIGH',updated_at=? WHERE id=?",
          )
          .run(input.createdAt, incident.id);
        for (const recipient of scopedRecipients(input.organizationId, true))
          notify(
            recipient.id,
            "incident.escalated",
            "High-severity incident escalated",
            reason,
            incident.id,
          );
        audit(null, "INCIDENT_AUTO_ESCALATED", incident.id, {
          ruleId: finding.ruleId,
          observed: finding.observed,
          threshold: finding.threshold,
        });
      }
    } else {
      alert = {
        id: id(),
        incident_id: incident.id,
        status: finding.autoEscalate ? "ESCALATED" : "OPEN",
      };
      sqlite
        .prepare(
          "INSERT INTO behavior_alerts(id,user_id,organization_id,incident_id,rule_id,rule_version,severity,status,trigger_condition,observed_value,threshold_value,window_seconds,evidence,synthetic,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?,?,?,?,?,?,0,?,?)",
        )
        .run(
          alert.id,
          input.userId,
          input.organizationId,
          incident.id,
          finding.ruleId,
          finding.severity,
          finding.autoEscalate ? "ESCALATED" : "OPEN",
          reason,
          String(finding.observed),
          String(finding.threshold),
          finding.windowSeconds,
          evidence,
          input.createdAt,
          input.createdAt,
        );
      for (const recipient of scopedRecipients(input.organizationId, finding.autoEscalate)) {
        notify(
          recipient.id,
          "behavior.alert",
          `${finding.severity === "HIGH" ? "High-priority" : "Behavior"} alert`,
          reason,
          alert.id,
        );
      }
      audit(null, "BEHAVIOR_ALERT_CREATED", alert.id, {
        ruleId: finding.ruleId,
        incidentId: incident.id,
        userId: input.userId,
        severity: finding.severity,
      });
      if (finding.autoEscalate) {
        for (const recipient of scopedRecipients(input.organizationId, true))
          notify(
            recipient.id,
            "incident.escalated",
            "High-severity incident escalated",
            reason,
            incident.id,
          );
      }
    }
    alertIds.push(alert.id);
  }
  return alertIds;
}
