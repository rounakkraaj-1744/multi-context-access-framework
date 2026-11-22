import { describe, expect, it } from "vitest";
import {
  evaluateAccess,
  evaluateRbac,
  isWithinTimeWindow,
  sanitizeCsvCell,
  type AccessContext,
  type Policy,
} from "./authorization";
const base: AccessContext = {
  now: new Date("2026-01-01T10:00:00Z"),
  businessHours: true,
  registeredDevice: true,
  networkKnown: true,
  requestsInWindow: 1,
  unusualSequence: false,
  contextAvailable: true,
  contextAgeSeconds: 1,
  stepUpVerified: false,
};
const grant: Policy = {
  id: "grant",
  effect: "ALLOW",
  businessHoursOnly: true,
  registeredDeviceOnly: true,
  knownNetworkOnly: true,
  maxRequests: 20,
  denyUnusualSequence: true,
  maxContextAgeSeconds: 300,
};
describe("multi-context access evaluation", () => {
  it("allows a user with the required grant and valid context", () =>
    expect(
      evaluateAccess({
        permissions: ["resource:read"],
        requiredPermission: "resource:read",
        context: base,
        policies: [grant],
      }).decision,
    ).toBe("ALLOW"));
  it("denies a user without the required permission", () =>
    expect(
      evaluateAccess({
        permissions: [],
        requiredPermission: "resource:read",
        context: base,
        policies: [grant],
      }).reasonCodes,
    ).toContain("MISSING_PERMISSION"));
  it.each([
    [{ businessHours: false }, "OUTSIDE_BUSINESS_HOURS"],
    [{ registeredDevice: false }, "UNREGISTERED_DEVICE"],
    [{ networkKnown: false }, "UNKNOWN_NETWORK"],
    [{ requestsInWindow: 21 }, "REQUEST_RATE_EXCEEDED"],
    [{ unusualSequence: true }, "UNUSUAL_SEQUENCE"],
    [{ contextAvailable: false }, "CONTEXT_UNAVAILABLE"],
    [{ contextAgeSeconds: 301 }, "STALE_CONTEXT"],
  ] as const)("denies failed contextual condition %s", (delta, reason) => {
    const result = evaluateAccess({
      permissions: ["resource:read"],
      requiredPermission: "resource:read",
      context: { ...base, ...delta },
      policies: [grant],
    });
    expect(result.decision).toBe("DENY");
    expect(result.reasonCodes).toContain(reason);
  });
  it("applies explicit deny before grant", () =>
    expect(
      evaluateAccess({
        permissions: ["resource:read"],
        requiredPermission: "resource:read",
        context: base,
        policies: [
          { id: "a", effect: "ALLOW" },
          { id: "d", effect: "DENY" },
        ],
      }).decision,
    ).toBe("DENY"));
  it("applies an unconditional deny even when no grant policy matches", () =>
    expect(
      evaluateAccess({
        permissions: ["resource:read"],
        requiredPermission: "resource:read",
        context: base,
        policies: [{ id: "d", effect: "DENY" }],
      }).decision,
    ).toBe("DENY"));
  it("fails closed on missing context even if a conditional deny does not match", () => {
    const result = evaluateAccess({
      permissions: ["resource:read"],
      requiredPermission: "resource:read",
      context: { ...base, contextAvailable: false },
      policies: [{ id: "d", effect: "DENY", businessHoursOnly: false }],
    });
    expect(result.decision).toBe("DENY");
    expect(result.reasonCodes).toContain("CONTEXT_UNAVAILABLE");
  });
  it("does not apply a conditional deny when its condition is not met", () =>
    expect(
      evaluateAccess({
        permissions: ["resource:read"],
        requiredPermission: "resource:read",
        context: { ...base, businessHours: false },
        policies: [{ id: "d", effect: "DENY", businessHoursOnly: true }],
      }).decision,
    ).toBe("ALLOW"));
  it("requires step up before access", () => {
    const policies: Policy[] = [{ id: "step", effect: "STEP_UP_AUTH" }];
    expect(
      evaluateAccess({
        permissions: ["resource:read"],
        requiredPermission: "resource:read",
        context: base,
        policies,
      }).decision,
    ).toBe("STEP_UP_AUTH");
    expect(
      evaluateAccess({
        permissions: ["resource:read"],
        requiredPermission: "resource:read",
        context: { ...base, stepUpVerified: true },
        policies,
      }).decision,
    ).toBe("ALLOW");
  });
  it("evaluates local-time policy windows using the configured timezone", () => {
    const window = { start: "09:00", end: "18:00", timezone: "Asia/Kolkata" };
    expect(isWithinTimeWindow(new Date("2026-01-01T04:00:00Z"), window)).toBe(true);
    expect(isWithinTimeWindow(new Date("2026-01-01T00:00:00Z"), window)).toBe(false);
  });
  it("supports overnight policy windows and fails closed for an invalid timezone", () => {
    expect(
      isWithinTimeWindow(new Date("2026-01-01T23:00:00Z"), {
        start: "22:00",
        end: "06:00",
        timezone: "UTC",
      }),
    ).toBe(true);
    expect(
      isWithinTimeWindow(base.now, { start: "09:00", end: "18:00", timezone: "invalid/zone" }),
    ).toBe(false);
  });
  it("denies outside a configured local-time policy and explains the condition", () => {
    const result = evaluateAccess({
      permissions: ["resource:read"],
      requiredPermission: "resource:read",
      context: { ...base, now: new Date("2026-01-01T00:00:00Z") },
      policies: [
        {
          id: "hours",
          effect: "ALLOW",
          allowedTimeWindow: { start: "09:00", end: "18:00", timezone: "Asia/Kolkata" },
        },
      ],
    });
    expect(result.decision).toBe("DENY");
    expect(result.reasonCodes).toContain("OUTSIDE_ALLOWED_TIME_WINDOW");
  });
  it("provides an RBAC-only baseline", () => {
    expect(evaluateRbac(["x"], "x")).toBe("ALLOW");
    expect(evaluateRbac([], "x")).toBe("DENY");
  });
  it("neutralizes spreadsheet formula prefixes", () =>
    expect(sanitizeCsvCell("=1+1")).toBe('"\'=1+1"'));
});
