import { describe, expect, it } from "vitest";
import { GAMMA_CONTEXT_REFERENCE_IDS, getGammaContextReference } from "./gamma-context";
import {
  evaluateGammaConstraint,
  evaluateGammaConstraints,
  GAMMA_EVALUATOR_SEMANTICS_VERSION,
  GammaEvaluationError,
  type GammaConstraintOutcome,
  type GammaContextSnapshot,
  type GammaTruthValue,
} from "./gamma-evaluator";
import type { ContextItem, ContextItemKind, ContextValueMap, ValidityStatus } from "./types";

const values: ContextValueMap = {
  time: { weekday: 1, hour: 12.5, timezone: "UTC" },
  location: { country: "IN", region: "KA" },
  network: "corporate",
  device: { registered: true, deviceId: "device-1", tokenAgeSeconds: 20 },
  session: { method: "password", ageSeconds: 60 },
  frequency: { count: 2, windowSeconds: 3.5 },
  history: { classes: [], windowDays: 1.5, enrollmentComplete: true },
  navigation: {
    previousClass: "home",
    currentClass: "payroll",
    transitionCount: 2,
    enrollmentComplete: true,
  },
  request: { resourceClass: "payroll", actionClass: "export" },
};

const kinds: readonly ContextItemKind[] = [
  "time",
  "location",
  "network",
  "device",
  "session",
  "frequency",
  "history",
  "navigation",
  "request",
];

function makeItem(
  kind: ContextItemKind,
  validityStatus: ValidityStatus = "V",
  valueOverride?: unknown,
): ContextItem {
  const original = values[kind] as unknown;
  const value = valueOverride === undefined ? original : valueOverride;
  if (value === null) {
    return {
      kind,
      value: null,
      observedAt: null,
      sourceClass: null,
      integrityFlag: 0,
      validityStatus,
    } as ContextItem;
  }
  const sourceClass = validityStatus === "U" ? "ext" : "srv";
  const integrityFlag = validityStatus === "U" ? 0 : 1;
  return {
    kind,
    value,
    observedAt: 1_000,
    sourceClass,
    integrityFlag,
    validityStatus,
  } as ContextItem;
}

function snapshot(
  overrides: Partial<Record<ContextItemKind, { status?: ValidityStatus; value?: unknown }>> = {},
): GammaContextSnapshot {
  return kinds.map((kind) => {
    const override = overrides[kind];
    return makeItem(kind, override?.status ?? "V", override?.value);
  });
}

function otherReference(kind: ContextItemKind): string {
  return kind === "device" ? "behavioral.session.method" : "environmental.device.registered";
}

function existsConstraint(reference: string, id = "c1") {
  const primaryKind = getGammaContextReference(reference)!.itemKind;
  const secondary = otherReference(primaryKind);
  const secondaryKind = getGammaContextReference(secondary)!.itemKind;
  return {
    id,
    items: [primaryKind, secondaryKind],
    expression: {
      kind: "all",
      children: [
        { kind: "exists", reference },
        { kind: "exists", reference: secondary },
      ],
    },
  };
}

function compareConstraint(
  left: string,
  operator: string,
  right: unknown,
  extraReference = "environmental.location.country",
  id = "c1",
) {
  const leftKind = getGammaContextReference(left)!.itemKind;
  const extraKind = getGammaContextReference(extraReference)!.itemKind;
  const expression = {
    kind: "all",
    children: [
      { kind: "compare", operator, left, right },
      { kind: "exists", reference: extraReference },
    ],
  };
  return { id, items: [...new Set([leftKind, extraKind])], expression };
}

function expectOutcome(
  constraint: unknown,
  context: GammaContextSnapshot,
  outcome: GammaConstraintOutcome,
) {
  expect(evaluateGammaConstraint(constraint, context).outcome).toBe(outcome);
}

describe("Γ pure AST evaluator", () => {
  it("implements the complete Strong Kleene AND and OR truth tables", () => {
    const states: readonly GammaTruthValue[] = ["TRUE", "FALSE", "INDETERMINATE"];
    const andExpected: readonly GammaTruthValue[][] = [
      ["TRUE", "FALSE", "INDETERMINATE"],
      ["FALSE", "FALSE", "FALSE"],
      ["INDETERMINATE", "FALSE", "INDETERMINATE"],
    ];
    const orExpected: readonly GammaTruthValue[][] = [
      ["TRUE", "TRUE", "TRUE"],
      ["TRUE", "FALSE", "INDETERMINATE"],
      ["TRUE", "INDETERMINATE", "INDETERMINATE"],
    ];
    for (const [i, left] of states.entries()) {
      for (const [j, right] of states.entries()) {
        const context = snapshot({ frequency: { status: "S" } });
        const leaves = [leafForTruth(left), leafForTruth(right)];
        const usedKinds = [
          ...new Set([
            "location",
            "session",
            ...(left === "INDETERMINATE" ? ["frequency"] : ["device"]),
            ...(right === "INDETERMINATE" ? ["frequency"] : ["device"]),
          ]),
        ];
        const and = {
          id: "and",
          items: usedKinds,
          expression: {
            kind: "all",
            children: [
              ...leaves,
              { kind: "exists", reference: "environmental.location.country" },
              { kind: "exists", reference: "behavioral.session.method" },
            ],
          },
        };
        const or = {
          id: "or",
          items: usedKinds,
          expression: {
            kind: "any",
            children: [
              ...leaves,
              {
                kind: "compare",
                operator: "eq",
                left: "environmental.location.country",
                right: { kind: "literal", value: { type: "string", value: "not-IN" } },
              },
              {
                kind: "compare",
                operator: "eq",
                left: "behavioral.session.method",
                right: { kind: "literal", value: { type: "string", value: "not-password" } },
              },
            ],
          },
        };
        expect(truth(evaluateGammaConstraint(and, context).outcome)).toBe(andExpected[i]![j]);
        expect(truth(evaluateGammaConstraint(or, context).outcome)).toBe(orExpected[i]![j]);
      }
    }
  });

  it("implements NOT for true, false, and indeterminate", () => {
    const context = snapshot({ frequency: { status: "S" } });
    const expectations: readonly [GammaTruthValue, GammaConstraintOutcome][] = [
      ["TRUE", "VIOLATED"],
      ["FALSE", "SATISFIED"],
      ["INDETERMINATE", "INDETERMINATE"],
    ];
    for (const [state, expected] of expectations) {
      const target = leafForTruth(state);
      const items = state === "INDETERMINATE" ? ["frequency", "location"] : ["device", "location"];
      const result = evaluateGammaConstraint(
        {
          id: "not",
          items,
          expression: {
            kind: "all",
            children: [
              { kind: "not", child: target },
              { kind: "exists", reference: "environmental.location.country" },
            ],
          },
        },
        context,
      );
      expect(result.outcome).toBe(expected);
    }
  });

  it("evaluates each registered reference with V, M, S, U, and X evidence", () => {
    const statusCases: readonly [ValidityStatus, GammaConstraintOutcome, string?][] = [
      ["V", "SATISFIED"],
      ["M", "INDETERMINATE", "MISSING_ITEM"],
      ["S", "INDETERMINATE", "STALE_ITEM"],
      ["U", "INDETERMINATE", "UNVERIFIABLE_ITEM"],
      ["X", "INDETERMINATE", "CONTRADICTORY_ITEM"],
    ];
    for (const reference of GAMMA_CONTEXT_REFERENCE_IDS) {
      const kind = getGammaContextReference(reference)!.itemKind;
      for (const [status, expected, reasonCode] of statusCases) {
        const result = evaluateGammaConstraint(
          existsConstraint(reference),
          snapshot({ [kind]: { status } }),
        );
        expect(result.outcome, `${reference} / ${status}`).toBe(expected);
        const refTrace = result.trace.referencedItems.find(
          (entry) => entry.reference === reference,
        );
        expect(refTrace?.evidenceStatus).toBe(status);
        expect(refTrace?.reasonCode).toBe(reasonCode);
        expect(
          result.trace.nodes.some((node) =>
            node.references.some((entry) => entry.reference === reference),
          ),
        ).toBe(true);
      }
    }
  });

  it("returns indeterminate for missing referenced items instead of treating absence as null", () => {
    const context = snapshot().filter((item) => item.kind !== "device");
    const result = evaluateGammaConstraint(
      existsConstraint("environmental.device.deviceId"),
      context,
    );
    expect(result.outcome).toBe("INDETERMINATE");
    expect(
      result.trace.referencedItems.find(
        (entry) => entry.reference === "environmental.device.deviceId",
      ),
    ).toMatchObject({ evidenceStatus: "ABSENT", reasonCode: "MISSING_ITEM" });
  });

  it.each([
    [
      "environmental.device.deviceId",
      "device",
      { registered: true, deviceId: null, tokenAgeSeconds: 3 },
    ],
    [
      "behavioral.navigation.previousClass",
      "navigation",
      {
        previousClass: null,
        currentClass: "payroll",
        transitionCount: 1,
        enrollmentComplete: true,
      },
    ],
  ] as const)("handles valid nullable null for %s", (reference, kind, value) => {
    const result = evaluateGammaConstraint(
      existsConstraint(reference),
      snapshot({ [kind]: { value } }),
    );
    expect(result.outcome).toBe("VIOLATED");
    const compare = compareConstraint(reference, "eq", {
      kind: "literal",
      value: { type: "string", value: "x" },
    });
    const compared = evaluateGammaConstraint(compare, snapshot({ [kind]: { value } }));
    expect(compared.outcome).toBe("INDETERMINATE");
    expect(compared.trace.nodes.find((node) => node.nodeType === "compare")?.reasonCodes).toEqual([
      "NULL_FIELD",
    ]);
  });

  it("evaluates every approved comparison operator without coercion", () => {
    const cases: readonly [string, unknown, GammaConstraintOutcome][] = [
      ["eq", { kind: "literal", value: { type: "Count", value: 2 } }, "SATISFIED"],
      ["neq", { kind: "literal", value: { type: "Count", value: 3 } }, "SATISFIED"],
      ["lt", { kind: "literal", value: { type: "Count", value: 3 } }, "SATISFIED"],
      ["lte", { kind: "literal", value: { type: "Count", value: 2 } }, "SATISFIED"],
      ["gt", { kind: "literal", value: { type: "Count", value: 1 } }, "SATISFIED"],
      ["gte", { kind: "literal", value: { type: "Count", value: 2 } }, "SATISFIED"],
      [
        "in",
        {
          kind: "set",
          valueType: "Count",
          values: [
            { type: "Count", value: 1 },
            { type: "Count", value: 2 },
          ],
        },
        "SATISFIED",
      ],
    ];
    for (const [operator, right, expected] of cases) {
      expectOutcome(
        compareConstraint("behavioral.frequency.count", operator, right),
        snapshot(),
        expected,
      );
    }
    expect(() =>
      evaluateGammaConstraint(
        compareConstraint("behavioral.frequency.count", "eq", {
          kind: "literal",
          value: { type: "string", value: "2" },
        }),
        snapshot(),
      ),
    ).toThrowError(expect.objectContaining({ code: "INVALID_GAMMA_POLICY" }));
  });

  it("uses exact string equality, nominal numeric semantics, and numeric negative-zero equality", () => {
    expectOutcome(
      compareConstraint(
        "environmental.location.country",
        "eq",
        { kind: "literal", value: { type: "string", value: "in" } },
        "environmental.device.registered",
      ),
      snapshot(),
      "VIOLATED",
    );
    expectOutcome(
      compareConstraint(
        "environmental.location.country",
        "eq",
        { kind: "literal", value: { type: "string", value: "IN" } },
        "environmental.device.registered",
      ),
      snapshot(),
      "SATISFIED",
    );
    expectOutcome(
      compareConstraint(
        "environmental.location.country",
        "eq",
        { kind: "literal", value: { type: "string", value: "e\u0301" } },
        "environmental.device.registered",
      ),
      snapshot({ location: { value: { country: "é", region: "KA" } } }),
      "VIOLATED",
    );
    const zeroSnapshot = snapshot({ frequency: { value: { count: 0, windowSeconds: 3.5 } } });
    expectOutcome(
      compareConstraint("behavioral.frequency.count", "eq", {
        kind: "literal",
        value: { type: "Count", value: -0 },
      }),
      zeroSnapshot,
      "SATISFIED",
    );
    const badNominal = compareConstraint("environmental.time.hour", "eq", {
      kind: "literal",
      value: { type: "Seconds", value: 12 },
    });
    expect(() => evaluateGammaConstraint(badNominal, snapshot())).toThrowError(
      GammaEvaluationError,
    );
  });

  it("resolves reference-to-reference operands and propagates either referenced status", () => {
    const policy = {
      id: "reference-pair",
      items: ["location", "session", "device"],
      expression: {
        kind: "all",
        children: [
          {
            kind: "compare",
            operator: "eq",
            left: "environmental.location.country",
            right: { kind: "reference", reference: "behavioral.session.method" },
          },
          { kind: "exists", reference: "environmental.device.registered" },
        ],
      },
    };
    const stale = evaluateGammaConstraint(policy, snapshot({ session: { status: "S" } }));
    expect(stale.outcome).toBe("INDETERMINATE");
    const compareTrace = stale.trace.nodes.find((node) => node.nodeType === "compare");
    expect(compareTrace?.references.map((reference) => reference.evidenceStatus)).toEqual([
      "V",
      "S",
    ]);
    expect(compareTrace?.reasonCodes).toEqual(["STALE_ITEM"]);
    const same = evaluateGammaConstraint(
      policy,
      snapshot({ session: { value: { method: "IN", ageSeconds: 60 } } }),
    );
    expect(same.outcome).toBe("SATISFIED");
  });

  it("records every AST node and evaluates all children in serialized order without short-circuiting", () => {
    const policy = {
      id: "ordered",
      items: ["device", "session"],
      expression: {
        kind: "all",
        children: [
          {
            kind: "compare",
            operator: "eq",
            left: "environmental.device.registered",
            right: { kind: "literal", value: { type: "boolean", value: false } },
          },
          {
            kind: "any",
            children: [
              { kind: "exists", reference: "environmental.device.deviceId" },
              { kind: "exists", reference: "behavioral.session.method" },
            ],
          },
          { kind: "not", child: { kind: "exists", reference: "behavioral.session.method" } },
        ],
      },
    };
    const result = evaluateGammaConstraint(policy, snapshot());
    expect(result.outcome).toBe("VIOLATED");
    expect(result.trace.nodes.map((node) => node.nodePath)).toEqual([
      "$.children[0]",
      "$.children[1].children[0]",
      "$.children[1].children[1]",
      "$.children[1]",
      "$.children[2].child",
      "$.children[2]",
      "$",
    ]);
    expect(result.trace.nodes.find((node) => node.nodePath === "$")?.childEvaluationOrder).toEqual([
      "$.children[0]",
      "$.children[1]",
      "$.children[2]",
    ]);
    expect(result.trace.nodes.find((node) => node.nodePath === "$.children[0]")?.outcome).toBe(
      "FALSE",
    );
    expect(result.trace.nodes.some((node) => node.nodePath === "$.children[2]")).toBe(true);
  });

  it("returns deterministic versioned traces and evaluates all constraints against the same snapshot", () => {
    const context = snapshot();
    const before = structuredClone(context);
    const constraints = [
      compareConstraint(
        "behavioral.frequency.count",
        "eq",
        { kind: "literal", value: { type: "Count", value: 2 } },
        "environmental.device.registered",
        "satisfied",
      ),
      compareConstraint(
        "behavioral.frequency.count",
        "eq",
        { kind: "literal", value: { type: "Count", value: 3 } },
        "environmental.device.registered",
        "violated",
      ),
    ];
    const first = evaluateGammaConstraints(constraints, context, true);
    const second = evaluateGammaConstraints(constraints, context, true);
    expect(first.map(({ outcome }) => outcome)).toEqual(["SATISFIED", "VIOLATED"]);
    expect(first).toEqual(second);
    expect(first[0]?.trace.evaluatorSemanticsVersion).toBe(GAMMA_EVALUATOR_SEMANTICS_VERSION);
    expect(first[0]?.trace.astDigest.hex).toMatch(/^[0-9a-f]{64}$/);
    expect(context).toEqual(before);
  });

  it("fails explicitly for invalid policy or malformed context snapshots", () => {
    expect(() =>
      evaluateGammaConstraint(
        { id: "bad", items: ["device", "session"], expression: { kind: "wat" } },
        snapshot(),
      ),
    ).toThrowError(expect.objectContaining({ code: "INVALID_GAMMA_POLICY" }));
    expect(() =>
      evaluateGammaConstraints(
        [existsConstraint("environmental.device.deviceId")],
        snapshot(),
        false,
      ),
    ).toThrowError(expect.objectContaining({ code: "INVALID_GAMMA_POLICY" }));
    expect(() =>
      evaluateGammaConstraint(
        existsConstraint("environmental.time.hour"),
        snapshot({ time: { value: { weekday: 1, hour: 0, timezone: "UTC" } } }),
      ),
    ).toThrowError(expect.objectContaining({ code: "INVALID_GAMMA_CONTEXT_SNAPSHOT" }));
    expect(() =>
      evaluateGammaConstraint(existsConstraint("environmental.device.deviceId"), [
        { ...makeItem("device"), validityStatus: "Q" } as never,
      ]),
    ).toThrowError(expect.objectContaining({ code: "INVALID_GAMMA_CONTEXT_SNAPSHOT" }));
  });
});

function leafForTruth(truth: GammaTruthValue) {
  if (truth === "TRUE") return { kind: "exists", reference: "environmental.device.registered" };
  if (truth === "FALSE")
    return {
      kind: "compare",
      operator: "eq",
      left: "environmental.device.registered",
      right: { kind: "literal", value: { type: "boolean", value: false } },
    };
  return { kind: "exists", reference: "behavioral.frequency.count" };
}

function truth(outcome: GammaConstraintOutcome): GammaTruthValue {
  if (outcome === "SATISFIED") return "TRUE";
  if (outcome === "VIOLATED") return "FALSE";
  return "INDETERMINATE";
}
