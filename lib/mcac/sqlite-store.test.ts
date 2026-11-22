import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PolicyVersion } from "./types";
import { hashTrace, verifyTraceHash } from "./trace";
import { digestGammaAst } from "./gamma-canonical";
import { evaluateGammaConstraints } from "./gamma-evaluator";
import { assertGammaVersionMetadata, withGammaVersionMetadata } from "./policy-version";
import type { GammaConstraint } from "./gamma-types";
import type { ContextItem } from "./types";

describe("immutable SQLite MCAC policy and trace persistence", () => {
  let folder = "";
  let sqlite: (typeof import("../db"))["sqlite"];
  let store: typeof import("./sqlite-store");
  let evaluate: (typeof import("./decision"))["evaluateMcac"];
  const basePolicy: PolicyVersion = {
    version: "mcac-1",
    resourceProfiles: {
      payroll: { sensitivity: "H", stepUpAvailable: true, waiverDurationSeconds: 300 },
    },
    freshnessSeconds: {
      time: 300,
      location: 300,
      network: 300,
      device: 300,
      session: 300,
      frequency: 300,
      history: 300,
      navigation: 300,
      request: 300,
    },
    verificationRequired: {
      time: 0,
      location: 0,
      network: 0,
      device: 1,
      session: 0,
      frequency: 0,
      history: 0,
      navigation: 0,
      request: 0,
    },
    consistencyConstraints: [],
    expectedTransitions: [],
    rules: [],
    strictLowSensitivity: false,
    interactions: { environmentConditionedThresholds: true, crossCategoryConsistency: true },
  };
  beforeAll(async () => {
    folder = mkdtempSync(join(tmpdir(), "mcac-version-test-"));
    process.env.DATABASE_PATH = join(folder, "test.sqlite");
    const db = await import("../db");
    sqlite = db.sqlite;
    store = await import("./sqlite-store");
    ({ evaluateMcac: evaluate } = await import("./decision"));
  });
  afterAll(() => {
    if (sqlite?.open) sqlite.close();
    if (folder) rmSync(folder, { recursive: true, force: true });
    delete process.env.DATABASE_PATH;
  });

  it("stores detached immutable versions, requires a new version on change, and loads historical snapshots", () => {
    const nestedPolicy: PolicyVersion = {
      ...basePolicy,
      version: "mcac-nested",
      rules: [
        {
          id: "nested",
          resourceClass: "payroll",
          actions: ["export"],
          environmental: [],
          behavioral: [],
          failOpen: 0,
        },
      ],
    };
    store.storePolicyVersion(nestedPolicy, "2026-01-01T00:00:00.000Z");
    (nestedPolicy.rules[0]!.actions as string[]).push("read");
    store.storePolicyVersion(basePolicy, "2026-01-01T00:00:00.000Z");
    store.storePolicyVersion(basePolicy, "2026-01-01T00:00:00.000Z");
    expect(store.loadPolicyVersion("mcac-nested").rules[0]?.actions).toEqual(["export"]);
    expect(() =>
      store.storePolicyVersion(
        { ...basePolicy, strictLowSensitivity: true },
        "2026-01-02T00:00:00.000Z",
        "mcac-1",
      ),
    ).toThrow(/already exists with different content/);
    const next = { ...basePolicy, version: "mcac-2", strictLowSensitivity: true };
    store.storePolicyVersion(next, "2026-01-02T00:00:00.000Z", "mcac-1");
    expect(store.loadPolicyVersion("mcac-1").strictLowSensitivity).toBe(false);
    expect(store.loadPolicyVersion("mcac-2").strictLowSensitivity).toBe(true);
    expect(() =>
      sqlite.prepare("UPDATE mcac_policy_versions SET snapshot='{}' WHERE version='mcac-1'").run(),
    ).toThrow(/immutable/);
    expect(() =>
      sqlite.prepare("DELETE FROM mcac_policy_versions WHERE version='mcac-1'").run(),
    ).toThrow(/immutable/);
  });

  it("stores Γ digest and semantic versions with detached immutable snapshots", () => {
    const constraint: GammaConstraint = {
      id: "gamma-pair",
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
    };
    const gammaPolicy: PolicyVersion = {
      ...basePolicy,
      version: "mcac-gamma-v1",
      consistencyConstraints: [constraint],
    };
    const originalConstraint = structuredClone(constraint);
    store.storePolicyVersion(gammaPolicy, "2026-01-03T00:00:00.000Z");
    const loaded = store.loadPolicyVersion("mcac-gamma-v1");
    expect(loaded.gammaMetadata).toMatchObject({
      constraintsDigest: digestGammaAst([originalConstraint]),
      evaluatorSemanticsVersion: "mcaf-gamma-eval-v1",
    });
    expect(loaded.consistencyConstraints).toEqual([originalConstraint]);

    const evaluation = evaluateGammaConstraints(
      loaded.consistencyConstraints.filter(
        (entry): entry is GammaConstraint => "expression" in entry,
      ),
      [
        {
          kind: "network",
          value: "corporate",
          observedAt: Date.UTC(2026, 0, 1),
          sourceClass: "srv",
          integrityFlag: 1,
          validityStatus: "V",
        },
        {
          kind: "device",
          value: { registered: true, deviceId: "device-1", tokenAgeSeconds: 1 },
          observedAt: Date.UTC(2026, 0, 1),
          sourceClass: "srv",
          integrityFlag: 1,
          validityStatus: "V",
        },
      ] satisfies ContextItem[],
      true,
    );
    expect(evaluation[0]?.outcome).toBe("SATISFIED");

    const mutableConstraint = constraint as unknown as {
      expression: { children: { right: { value: { value: string } } }[] };
    };
    mutableConstraint.expression.children[0]!.right.value.value = "vpn";
    expect(store.loadPolicyVersion("mcac-gamma-v1").consistencyConstraints).toEqual([
      originalConstraint,
    ]);
    expect(() => store.storePolicyVersion(gammaPolicy, "2026-01-04T00:00:00.000Z")).toThrow(
      /already exists with different content/,
    );
  });

  it("rejects corrupted Γ digest and evaluator-version metadata", () => {
    const constraint: GammaConstraint = {
      id: "gamma-metadata-check",
      items: ["device", "session"],
      expression: {
        kind: "all",
        children: [
          { kind: "exists", reference: "environmental.device.registered" },
          { kind: "exists", reference: "behavioral.session.method" },
        ],
      },
    };
    const valid = withGammaVersionMetadata({
      ...basePolicy,
      version: "mcac-gamma-corrupt-metadata",
      consistencyConstraints: [constraint],
    });
    expect(() =>
      assertGammaVersionMetadata({
        ...valid,
        gammaMetadata: {
          ...valid.gammaMetadata!,
          evaluatorSemanticsVersion: "unknown-evaluator" as never,
        },
      }),
    ).toThrow(/metadata/);
    expect(() =>
      assertGammaVersionMetadata({
        ...valid,
        gammaMetadata: {
          ...valid.gammaMetadata!,
          constraintsDigest: { ...valid.gammaMetadata!.constraintsDigest, hex: "0".repeat(64) },
        },
      }),
    ).toThrow(/metadata/);
  });

  it("persists replayable hash-chained traces and rejects broken links", () => {
    const emptyContext = { environmental: {}, behavioral: {} } as never;
    const first = evaluate({
      request: {
        requestId: "trace-1",
        time: Date.UTC(2026, 0, 1),
        userId: "u",
        sessionId: "s",
        resourceId: "r",
        resourceClass: "payroll",
        action: "export",
      },
      baselinePermission: false,
      policy: basePolicy,
      context: emptyContext,
      consistencyEvidence: [],
      waiver: null,
      previousHash: "GENESIS",
    }).trace;
    store.storeDecisionTrace(first, "2026-01-01T00:00:00.000Z");
    expect(store.loadDecisionTrace("trace-1")).toEqual(first);
    const second = evaluate({
      request: {
        requestId: "trace-2",
        time: Date.UTC(2026, 0, 1),
        userId: "u",
        sessionId: "s",
        resourceId: "r",
        resourceClass: "payroll",
        action: "export",
      },
      baselinePermission: false,
      policy: basePolicy,
      context: emptyContext,
      consistencyEvidence: [],
      waiver: null,
      previousHash: first.hash,
    }).trace;
    expect(() => store.storeDecisionTrace(second, "2026-01-01T00:00:01.000Z")).not.toThrow();
    expect(verifyTraceHash({ ...first, decision: "ALLOW" })).toBe(false);
    const reorderedBody: Record<string, unknown> = { ...second, previousHash: "GENESIS" };
    delete reorderedBody["hash"];
    const reordered = {
      ...reorderedBody,
      hash: hashTrace(reorderedBody as Omit<typeof second, "hash">),
    } as typeof second;
    expect(() => store.storeDecisionTrace(reordered, "2026-01-01T00:00:02.000Z")).toThrow(
      /chain discontinuity/,
    );
    const broken = { ...second, requestId: "trace-3" };
    expect(() => store.storeDecisionTrace(broken, "2026-01-01T00:00:02.000Z")).toThrow(/hash/);
    expect(() =>
      sqlite.prepare("DELETE FROM mcac_decision_traces WHERE request_id='trace-1'").run(),
    ).toThrow(/immutable/);
    expect(() =>
      sqlite.prepare("DELETE FROM mcac_decision_traces WHERE request_id='trace-2'").run(),
    ).toThrow(/immutable/);
  });
});
