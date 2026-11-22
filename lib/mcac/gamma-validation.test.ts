import { describe, expect, it } from "vitest";
import { canonicalGammaAstBytes } from "./gamma-canonical";
import { GAMMA_CONTEXT_REFERENCE_IDS, getGammaContextReference } from "./gamma-context";
import {
  GAMMA_LIMITS,
  validateGammaConstraint,
  validateGammaConstraints,
  type GammaValidationErrorCode,
} from "./gamma-validation";
import type { GammaConstraint } from "./gamma-types";
import { validatePolicyGammaConstraints } from "./gamma-policy";

const exists = (reference: string) => ({ kind: "exists", reference });
const literal = (type: string, value: unknown) => ({ kind: "literal", value: { type, value } });
const compare = (left: string, operator: string, right: unknown) => ({
  kind: "compare",
  operator,
  left,
  right,
});
const constraint = (
  expression: unknown,
  items: string[] = ["device", "session"],
  id = "constraint-1",
) => ({ id, items, expression });
const validExpression = () => ({
  kind: "all",
  children: [exists("environmental.device.deviceId"), exists("behavioral.session.method")],
});
const validConstraint = (id = "constraint-1") =>
  constraint(validExpression(), ["device", "session"], id);
const metadataFor = (reference: string) => {
  const metadata = getGammaContextReference(reference);
  if (!metadata) throw new Error(`Missing fixture reference ${reference}`);
  return metadata;
};
const errorCodes = (input: unknown) => {
  const result = validateGammaConstraint(input);
  return result.ok ? [] : result.errors.map((error) => error.code);
};
const expectCode = (input: unknown, code: GammaValidationErrorCode) =>
  expect(errorCodes(input)).toContain(code);

describe("Γ strict constraint validation", () => {
  it("rejects malformed policy-level constraint collections instead of treating them as legacy", () => {
    expect(validatePolicyGammaConstraints({ consistencyConstraints: null })).toMatchObject({
      ok: false,
      errors: [
        {
          code: "INVALID_TYPE",
          path: "$.consistencyConstraints",
        },
      ],
    });
    expect(validatePolicyGammaConstraints({ consistencyConstraints: {} }).ok).toBe(false);
    expect(validatePolicyGammaConstraints({}).ok).toBe(true);
  });

  it("accepts each node family and the exact approved comparison operator set", () => {
    const comparison = compare("environmental.device.registered", "eq", literal("boolean", true));
    expect(validateGammaConstraint(validConstraint()).ok).toBe(true);
    expect(
      validateGammaConstraint(
        constraint(
          {
            kind: "any",
            children: [
              exists("environmental.device.deviceId"),
              exists("behavioral.session.method"),
            ],
          },
          ["device", "session"],
        ),
      ).ok,
    ).toBe(true);
    expect(
      validateGammaConstraint(
        constraint(
          {
            kind: "all",
            children: [
              { kind: "not", child: exists("environmental.device.deviceId") },
              exists("behavioral.session.method"),
            ],
          },
          ["device", "session"],
        ),
      ).ok,
    ).toBe(true);
    expect(
      validateGammaConstraint(
        constraint({ kind: "all", children: [comparison, exists("behavioral.session.method")] }, [
          "device",
          "session",
        ]),
      ).ok,
    ).toBe(true);
    expect(
      validateGammaConstraint(
        constraint(
          {
            kind: "all",
            children: [
              exists("environmental.device.deviceId"),
              exists("behavioral.session.method"),
            ],
          },
          ["device", "session"],
        ),
      ).ok,
    ).toBe(true);

    const operators = ["eq", "neq", "lt", "lte", "gt", "gte", "in"];
    for (const operator of operators) {
      const right =
        operator === "in"
          ? { kind: "set", valueType: "Count", values: [{ type: "Count", value: 1 }] }
          : literal("Count", 1);
      const result = validateGammaConstraint(
        constraint(
          {
            kind: "all",
            children: [
              compare("behavioral.frequency.count", operator, right),
              exists("environmental.device.registered"),
            ],
          },
          ["frequency", "device"],
        ),
      );
      expect(result.ok, operator).toBe(true);
    }
  });

  it("accepts every nominal scalar type and compatible reference pairing", () => {
    const cases: readonly [string, string, unknown][] = [
      ["environmental.location.country", "string", "IN"],
      ["environmental.device.registered", "boolean", true],
      ["environmental.time.hour", "Hour", 1],
      ["environmental.time.weekday", "Weekday", 1],
      ["environmental.device.tokenAgeSeconds", "Seconds", 1],
      ["behavioral.history.windowDays", "Days", 1],
      ["behavioral.frequency.count", "Count", 1],
      ["environmental.network.class", "networkClass", "corporate"],
      ["behavioral.request.actionClass", "actionClass", "read"],
    ];
    for (const [reference, type, value] of cases) {
      const metadata = metadataFor(reference);
      const secondReference =
        metadata.itemKind === "device"
          ? "behavioral.session.method"
          : "environmental.device.registered";
      const items =
        metadata.itemKind === "device" ? ["device", "session"] : [metadata.itemKind, "device"];
      const result = validateGammaConstraint(
        constraint(
          {
            kind: "all",
            children: [compare(reference, "eq", literal(type, value)), exists(secondReference)],
          },
          items,
        ),
      );
      expect(result.ok, reference).toBe(true);
    }

    const compatiblePairs: readonly [string, string][] = [
      ["environmental.location.country", "behavioral.session.method"],
      ["environmental.device.registered", "behavioral.history.enrollmentComplete"],
      ["environmental.time.hour", "environmental.time.hour"],
      ["environmental.time.weekday", "environmental.time.weekday"],
      ["environmental.device.tokenAgeSeconds", "behavioral.session.ageSeconds"],
      ["environmental.device.tokenAgeSeconds", "behavioral.session.ageSeconds"],
      ["behavioral.history.windowDays", "behavioral.history.windowDays"],
      ["behavioral.frequency.count", "behavioral.navigation.transitionCount"],
      ["environmental.network.class", "environmental.network.class"],
      ["behavioral.request.actionClass", "behavioral.request.actionClass"],
    ];
    for (const [left, right] of compatiblePairs) {
      const extra = left.startsWith("environmental.device")
        ? "behavioral.session.method"
        : "environmental.device.registered";
      const kinds = [
        metadataFor(left).itemKind,
        metadataFor(right).itemKind,
        metadataFor(extra).itemKind,
      ];
      const items = [...new Set(kinds)];
      expect(
        validateGammaConstraint(
          constraint(
            {
              kind: "all",
              children: [
                compare(left, "eq", { kind: "reference", reference: right }),
                exists(extra),
              ],
            },
            items,
          ),
        ).ok,
        `${left}=${right}`,
      ).toBe(true);
    }
  });

  it("rejects unknown discriminators, operators, references, and malformed operands", () => {
    expectCode(constraint({ kind: "call", source: "x" }), "INVALID_DISCRIMINATOR");
    expectCode(
      constraint({
        kind: "compare",
        operator: "contains",
        left: "environmental.device.registered",
        right: literal("boolean", true),
      }),
      "UNKNOWN_OPERATOR",
    );
    expectCode(
      constraint({ kind: "exists", reference: "environmental.device.posture" }),
      "UNKNOWN_REFERENCE",
    );
    expectCode(
      constraint({
        kind: "compare",
        operator: "eq",
        left: "environmental.device.registered",
        right: { kind: "literal", value: { type: "boolean" } },
      }),
      "MISSING_FIELD",
    );
    expectCode(
      constraint({
        kind: "compare",
        operator: "eq",
        left: "environmental.device.registered",
        right: { kind: "mystery", reference: "environmental.device.registered" },
      }),
      "INVALID_DISCRIMINATOR",
    );
    expectCode(constraint({ kind: "all", children: [] }), "EMPTY_COLLECTION");
    expectCode(constraint({ kind: "any", children: [] }), "EMPTY_COLLECTION");
  });

  it("rejects missing/extra fields and malformed JSON objects without invoking getters", () => {
    expectCode({ id: "c", items: ["device", "session"] }, "MISSING_FIELD");
    expectCode({ ...validConstraint(), enabled: true }, "UNKNOWN_FIELD");
    expectCode(
      constraint({ kind: "exists", reference: "environmental.device.deviceId", extra: 1 }),
      "UNKNOWN_FIELD",
    );
    expectCode(
      constraint({
        kind: "compare",
        operator: "eq",
        left: "environmental.device.registered",
        right: { kind: "literal", value: { type: "boolean", value: true, extra: 2 } },
      }),
      "UNKNOWN_FIELD",
    );
    let getterCalled = false;
    const accessor = Object.defineProperty(
      { id: "x", items: ["device", "session"], expression: validExpression() },
      "id",
      {
        enumerable: true,
        get: () => {
          getterCalled = true;
          return "x";
        },
      },
    );
    expect(validateGammaConstraint(accessor).ok).toBe(false);
    expect(getterCalled).toBe(false);
    const hostileProxy = new Proxy(
      { id: "x", items: ["device", "session"], expression: validExpression() },
      {
        getOwnPropertyDescriptor(target, property) {
          if (property === "id") throw new Error("trap failure");
          return Reflect.getOwnPropertyDescriptor(target, property);
        },
      },
    );
    expect(validateGammaConstraint(hostileProxy)).toMatchObject({
      ok: false,
      errors: [{ code: "INVALID_TYPE", path: "$" }],
    });
    expect(validateGammaConstraint(null).ok).toBe(false);
    expect(validateGammaConstraint("not JSON object").ok).toBe(false);
  });

  it("enforces enum vocabulary, null rejection, field-specific numeric domains, and Unicode scalar string lengths", () => {
    const make = (reference: string, type: string, value: unknown) => {
      const primaryKind = metadataFor(reference).itemKind;
      const secondaryReference =
        primaryKind === "session" ? "environmental.device.registered" : "behavioral.session.method";
      const secondaryKind = metadataFor(secondaryReference).itemKind;
      return constraint(
        {
          kind: "all",
          children: [compare(reference, "eq", literal(type, value)), exists(secondaryReference)],
        },
        [primaryKind, secondaryKind],
      );
    };
    expectCode(make("environmental.network.class", "networkClass", "CORPORATE"), "INVALID_ENUM");
    expectCode(make("behavioral.request.actionClass", "actionClass", "delete"), "INVALID_ENUM");
    expectCode(make("environmental.device.deviceId", "string", null), "NULL_LITERAL");
    expectCode(make("environmental.device.registered", "boolean", null), "NULL_LITERAL");
    expectCode(make("environmental.time.hour", "Hour", 0), "INVALID_VALUE"); // Current Γ-1 registry mirrors context.ts, which rejects zero.
    expectCode(make("environmental.time.hour", "Hour", 24), "INVALID_VALUE");
    expectCode(make("environmental.time.weekday", "Weekday", 1.5), "INVALID_VALUE");
    expectCode(make("behavioral.frequency.count", "Count", -1), "INVALID_VALUE");
    expectCode(make("behavioral.frequency.count", "Count", 1.5), "INVALID_VALUE");
    expectCode(make("environmental.device.tokenAgeSeconds", "Seconds", 1.5), "INVALID_VALUE");
    expect(
      validateGammaConstraint(make("behavioral.frequency.windowSeconds", "Seconds", 1.5)).ok,
    ).toBe(true);
    expect(validateGammaConstraint(make("behavioral.history.windowDays", "Days", 1.5)).ok).toBe(
      true,
    );
    expectCode(make("behavioral.frequency.windowSeconds", "Seconds", 0), "INVALID_VALUE");
    expect(
      validateGammaConstraint(make("environmental.device.deviceId", "string", "x".repeat(128))).ok,
    ).toBe(true);
    expectCode(make("environmental.device.deviceId", "string", "😀".repeat(129)), "LIMIT_EXCEEDED");
    expect(
      validateGammaConstraint(make("environmental.device.deviceId", "string", "😀".repeat(128))).ok,
    ).toBe(true);
    expectCode(make("environmental.device.deviceId", "string", "\ud800"), "INVALID_VALUE");
  });

  it("rejects incompatible nominal types, invalid ordering, and invalid set forms", () => {
    const extra = exists("environmental.device.registered");
    const withCompare = (node: unknown) =>
      constraint({ kind: "all", children: [node, extra] }, ["device", "session"]);
    expectCode(
      withCompare(compare("environmental.time.hour", "eq", literal("Seconds", 1))),
      "TYPE_MISMATCH",
    );
    expectCode(
      withCompare(compare("environmental.device.registered", "lt", literal("boolean", true))),
      "TYPE_MISMATCH",
    );
    expectCode(
      withCompare(compare("environmental.device.registered", "eq", literal("string", "true"))),
      "TYPE_MISMATCH",
    );
    expectCode(
      withCompare(
        compare("environmental.device.tokenAgeSeconds", "eq", {
          kind: "reference",
          reference: "behavioral.history.windowDays",
        }),
      ),
      "TYPE_MISMATCH",
    );
    expectCode(
      withCompare(
        compare("environmental.network.class", "in", {
          kind: "set",
          valueType: "networkClass",
          values: [
            { type: "networkClass", value: "corporate" },
            { type: "string", value: "vpn" },
          ],
        }),
      ),
      "TYPE_MISMATCH",
    );
    expectCode(
      withCompare(
        compare("environmental.network.class", "in", {
          kind: "set",
          valueType: "networkClass",
          values: [],
        }),
      ),
      "EMPTY_COLLECTION",
    );
    expectCode(
      withCompare(
        compare("environmental.network.class", "eq", {
          kind: "set",
          valueType: "networkClass",
          values: [{ type: "networkClass", value: "corporate" }],
        }),
      ),
      "TYPE_MISMATCH",
    );
    expectCode(
      withCompare(
        compare("environmental.network.class", "in", literal("networkClass", "corporate")),
      ),
      "TYPE_MISMATCH",
    );
    expectCode(
      withCompare(compare("behavioral.frequency.count", "eq", literal("Count", Number.NaN))),
      "NON_FINITE_NUMBER",
    );
    expectCode(
      withCompare(compare("behavioral.frequency.count", "eq", literal("Count", Infinity))),
      "NON_FINITE_NUMBER",
    );
  });

  it("validates declarations as an exact distinct item-kind set and permits same-category relationships", () => {
    const sameCategory = constraint(
      {
        kind: "all",
        children: [exists("environmental.device.deviceId"), exists("environmental.network.class")],
      },
      ["device", "network"],
    );
    expect(validateGammaConstraint(sameCategory).ok).toBe(true);
    expectCode(
      constraint(exists("environmental.device.deviceId"), ["device"]),
      "INSUFFICIENT_ITEM_KINDS",
    );
    expectCode(constraint(validExpression(), ["device"]), "ITEM_REFERENCE_MISMATCH");
    expectCode(
      constraint(validExpression(), ["device", "session", "network"]),
      "ITEM_REFERENCE_MISMATCH",
    );
    expectCode(
      constraint(validExpression(), ["device", "device", "session"]),
      "DUPLICATE_ITEM_KIND",
    );
    expectCode(
      constraint(validExpression(), ["device", "session", "mystery"]),
      "INVALID_ITEM_KIND",
    );
    expectCode(constraint(validExpression(), ["device", "session"], ""), "INVALID_VALUE");
  });

  it("rejects repeated IDs and Γ constraints when the feature switch is disabled", () => {
    const duplicate = validateGammaConstraints(
      [validConstraint("same"), validConstraint("same")],
      true,
    );
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok)
      expect(duplicate.errors.map((error) => error.code)).toContain("DUPLICATE_CONSTRAINT_ID");
    const disabled = validateGammaConstraints([validConstraint()], false);
    expect(disabled.ok).toBe(false);
    if (!disabled.ok)
      expect(disabled.errors[0]).toMatchObject({
        code: "FEATURE_DISABLED",
        path: "$.interactions.crossCategoryConsistency",
      });
    expect(validateGammaConstraints([], false)).toMatchObject({
      ok: true,
      value: { constraints: [], canonicalBytes: 2 },
    });
    expect(validateGammaConstraints([validConstraint()], "true").ok).toBe(false);
  });
});

describe("Γ complexity bounds", () => {
  it("accepts and rejects AST depth at the exact boundary", () => {
    const depthFive = {
      kind: "all",
      children: [
        {
          kind: "not",
          child: {
            kind: "not",
            child: {
              kind: "not",
              child: compare("environmental.device.registered", "eq", literal("boolean", true)),
            },
          },
        },
        exists("behavioral.session.method"),
      ],
    };
    expect(validateGammaConstraint(constraint(depthFive, ["device", "session"])).ok).toBe(true);
    const depthSix = {
      kind: "all",
      children: [
        {
          kind: "not",
          child: {
            kind: "not",
            child: {
              kind: "not",
              child: {
                kind: "not",
                child: compare("environmental.device.registered", "eq", literal("boolean", true)),
              },
            },
          },
        },
        exists("behavioral.session.method"),
      ],
    };
    expectCode(constraint(depthSix, ["device", "session"]), "LIMIT_EXCEEDED");
  });

  it("accepts 32 nodes and rejects node 33", () => {
    const makeTree = () => ({
      kind: "all",
      children: Array.from({ length: 8 }, (_, childIndex) => ({
        kind: "all",
        children: Array.from({ length: childIndex < 7 ? 3 : 2 }, () =>
          exists(childIndex % 2 ? "behavioral.session.method" : "environmental.device.deviceId"),
        ),
      })),
    });
    expect(validateGammaConstraint(constraint(makeTree(), ["device", "session"])).ok).toBe(true);
    const thirtyThreeNodes = {
      kind: "all",
      children: Array.from({ length: 8 }, () => ({
        kind: "all",
        children: Array.from({ length: 3 }, () => exists("environmental.device.deviceId")),
      })),
    };
    expectCode(constraint(thirtyThreeNodes, ["device", "session"]), "LIMIT_EXCEEDED");
  });

  it("accepts eight distinct references and rejects nine", () => {
    const refs = GAMMA_CONTEXT_REFERENCE_IDS.slice(0, 9);
    const expression = (count: number) => ({
      kind: "all",
      children: refs.slice(0, count).map((reference) => exists(reference)),
    });
    const itemsFor = (count: number) => [
      ...new Set(refs.slice(0, count).map((reference) => metadataFor(reference).itemKind)),
    ];
    expect(validateGammaConstraint(constraint(expression(8), itemsFor(8))).ok).toBe(true);
    expectCode(constraint(expression(9), itemsFor(9)), "LIMIT_EXCEEDED");
  });

  it("accepts one and eight logical children and rejects zero and nine", () => {
    const children = Array.from({ length: 9 }, (_, index) =>
      exists(index % 2 ? "behavioral.session.method" : "environmental.device.deviceId"),
    );
    const oneChild = compare("environmental.device.deviceId", "eq", {
      kind: "reference",
      reference: "behavioral.session.method",
    });
    expect(validateGammaConstraint(constraint({ kind: "all", children: [oneChild] })).ok).toBe(
      true,
    );
    expect(
      validateGammaConstraint(constraint({ kind: "all", children: children.slice(0, 8) })).ok,
    ).toBe(true);
    expectCode(constraint({ kind: "all", children }), "LIMIT_EXCEEDED");
    expectCode(constraint({ kind: "any", children: [] }), "EMPTY_COLLECTION");
  });

  it("accepts 16 set values and rejects 17", () => {
    const values = Array.from({ length: 17 }, () => ({ type: "networkClass", value: "corporate" }));
    const make = (length: number) =>
      constraint(
        {
          kind: "all",
          children: [
            compare("environmental.network.class", "in", {
              kind: "set",
              valueType: "networkClass",
              values: values.slice(0, length),
            }),
            exists("behavioral.session.method"),
          ],
        },
        ["network", "session"],
      );
    expect(validateGammaConstraint(make(16)).ok).toBe(true);
    expectCode(make(17), "LIMIT_EXCEEDED");
  });

  it("accepts 128 Unicode scalar values and rejects 129", () => {
    const make = (value: string) =>
      constraint(
        {
          kind: "all",
          children: [
            compare("environmental.device.deviceId", "eq", literal("string", value)),
            exists("behavioral.session.method"),
          ],
        },
        ["device", "session"],
      );
    expect(validateGammaConstraint(make("😀".repeat(128))).ok).toBe(true);
    expectCode(make("😀".repeat(129)), "LIMIT_EXCEEDED");
  });

  it("enforces the policy constraint-count and canonical UTF-8 byte limits at the exact boundary", () => {
    const sixteen = Array.from({ length: 16 }, (_, index) => validConstraint(`c${index}`));
    const seventeen = [...sixteen, validConstraint("c16")];
    expect(validateGammaConstraints(sixteen, true).ok).toBe(true);
    expect(validateGammaConstraints(seventeen, true).ok).toBe(false);

    const sized = (id: string) =>
      constraint(validExpression(), ["device", "session"], id) as GammaConstraint;
    const oneCharBytes = canonicalGammaAstBytes([sized("x")]).byteLength;
    const idAtLimit = "x".repeat(GAMMA_LIMITS.canonicalBytesPerPolicy - oneCharBytes + 1);
    expect(canonicalGammaAstBytes([sized(idAtLimit)]).byteLength).toBe(
      GAMMA_LIMITS.canonicalBytesPerPolicy,
    );
    expect(validateGammaConstraints([sized(idAtLimit)], true)).toMatchObject({
      ok: true,
      value: { canonicalBytes: GAMMA_LIMITS.canonicalBytesPerPolicy },
    });
    const idOverLimit = `${idAtLimit}x`;
    expect(canonicalGammaAstBytes([sized(idOverLimit)]).byteLength).toBe(
      GAMMA_LIMITS.canonicalBytesPerPolicy + 1,
    );
    const over = validateGammaConstraints([sized(idOverLimit)], true);
    expect(over.ok).toBe(false);
    if (!over.ok)
      expect(over.errors).toContainEqual(
        expect.objectContaining({ code: "LIMIT_EXCEEDED", path: "$.consistencyConstraints" }),
      );
  });
});
