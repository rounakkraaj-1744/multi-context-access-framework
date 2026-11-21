export type Decision = "ALLOW" | "DENY" | "STEP_UP_AUTH";
export type AccessContext = {
  now: Date;
  businessHours: boolean;
  registeredDevice: boolean;
  networkKnown: boolean;
  requestsInWindow: number;
  unusualSequence: boolean;
  contextAvailable: boolean;
  contextAgeSeconds: number;
  stepUpVerified: boolean;
};
export type Policy = {
  id: string;
  effect: "ALLOW" | "DENY" | "STEP_UP_AUTH";
  businessHoursOnly?: boolean;
  registeredDeviceOnly?: boolean;
  knownNetworkOnly?: boolean;
  maxRequests?: number;
  denyUnusualSequence?: boolean;
  maxContextAgeSeconds?: number;
  allowedTimeWindow?: { start: string; end: string; timezone: string };
};
export type Evaluation = { decision: Decision; reasonCodes: string[]; explanation: string };

export function isWithinTimeWindow(now: Date, window: { start: string; end: string; timezone: string }): boolean {
  let parts: Record<string, string>;
  try {
    parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: window.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now).map((part) => [part.type, part.value]));
  } catch { return false; }
  const current = Number(parts.hour) * 60 + Number(parts.minute);
  const [startHour, startMinute] = window.start.split(":").map(Number);
  const [endHour, endMinute] = window.end.split(":").map(Number);
  const start = startHour * 60 + startMinute;
  const end = endHour * 60 + endMinute;
  if (start === end) return false;
  return start < end ? current >= start && current < end : current >= start || current < end;
}

/** Explicit deny wins, then step-up, then grant. Missing/stale required context is denied. */
export function evaluateAccess(input: {
  permissions: string[]; requiredPermission: string; context: AccessContext; policies: Policy[];
}): Evaluation {
  const reasons: string[] = [];
  const { context, policies } = input;
  if (!input.permissions.includes(input.requiredPermission)) reasons.push("MISSING_PERMISSION");
  // Missing context fails closed regardless of the effect or conditions of any policy.
  const missingContext = !context.contextAvailable;
  if (missingContext) reasons.push("CONTEXT_UNAVAILABLE");
  const matched: Policy[] = [];
  let failedRequiredCondition = missingContext;
  for (const policy of policies) {
    // A policy with no conditions applies unconditionally, including DENY and STEP_UP.
    let valid = true;
    const conditionFailure = (code: string) => { reasons.push(code); valid = false; if (policy.effect !== "DENY") failedRequiredCondition = true; };
    if (policy.businessHoursOnly && !context.businessHours) conditionFailure("OUTSIDE_BUSINESS_HOURS");
    if (policy.allowedTimeWindow && !isWithinTimeWindow(context.now, policy.allowedTimeWindow)) conditionFailure("OUTSIDE_ALLOWED_TIME_WINDOW");
    if (policy.registeredDeviceOnly && !context.registeredDevice) conditionFailure("UNREGISTERED_DEVICE");
    if (policy.knownNetworkOnly && !context.networkKnown) conditionFailure("UNKNOWN_NETWORK");
    if (policy.maxRequests !== undefined && context.requestsInWindow > policy.maxRequests) conditionFailure("REQUEST_RATE_EXCEEDED");
    if (policy.denyUnusualSequence && context.unusualSequence) conditionFailure("UNUSUAL_SEQUENCE");
    if (policy.maxContextAgeSeconds !== undefined && context.contextAgeSeconds > policy.maxContextAgeSeconds) conditionFailure("STALE_CONTEXT");
    if (valid) matched.push(policy);
  }
  const applicableDeny = matched.some((p) => p.effect === "DENY");
  const applicableStepUp = matched.some((p) => p.effect === "STEP_UP_AUTH");
  let decision: Decision;
  if (reasons.includes("MISSING_PERMISSION") || applicableDeny || failedRequiredCondition) decision = "DENY";
  else if (applicableStepUp && !context.stepUpVerified) { decision = "STEP_UP_AUTH"; reasons.push("STEP_UP_REQUIRED"); }
  else decision = "ALLOW";
  if (!reasons.length && decision === "ALLOW") reasons.push("PERMISSION_AND_CONTEXT_VALID");
  return { decision, reasonCodes: [...new Set(reasons)], explanation: decision === "ALLOW" ? "Permission and contextual requirements passed." : decision === "STEP_UP_AUTH" ? "Additional verification is required before access." : "Access was denied by permission or contextual policy." };
}

export function evaluateRbac(permissions: string[], requiredPermission: string): Decision {
  return permissions.includes(requiredPermission) ? "ALLOW" : "DENY";
}

export function sanitizeCsvCell(value: unknown): string {
  const text = String(value ?? "");
  const safe = /^[\s]*[=+@\-]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}
