import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  GAMMA_CONTEXT_REFERENCES,
  GAMMA_CONTEXT_REFERENCE_IDS,
  getGammaContextReference,
} from "./gamma-context";
import {
  canonicalGammaAstBytes,
  canonicalizeGammaAst,
  digestGammaAst,
  GAMMA_CANONICALIZATION_VERSION,
} from "./gamma-canonical";
import type {
  GammaAllNode,
  GammaAnyNode,
  GammaComparisonOperator,
  GammaCompareNode,
  GammaConstraint,
  GammaExistsNode,
  GammaLiteralOperand,
  GammaNotNode,
  GammaReferenceOperand,
  GammaScalarType,
  GammaSetOperand,
  GammaTypedLiteral,
} from "./gamma-types";

describe("Γ AST types and canonical context-reference registry", () => {
  it("constructs every approved node and operand form with the closed types", () => {
    const reference = "environmental.time.hour" as const;
    const nodes = [
      { kind: "all", children: [{ kind: "exists", reference }] },
      { kind: "any", children: [{ kind: "not", child: { kind: "exists", reference } }] },
      { kind: "compare", operator: "eq", left: reference, right: { kind: "reference", reference } },
      {
        kind: "compare",
        operator: "eq",
        left: reference,
        right: { kind: "literal", value: { type: "Hour", value: 8 } },
      },
      {
        kind: "compare",
        operator: "in",
        left: reference,
        right: { kind: "set", valueType: "Hour", values: [{ type: "Hour", value: 8 }] },
      },
    ] as const;
    const all: GammaAllNode = nodes[0];
    const any: GammaAnyNode = nodes[1];
    const not: GammaNotNode = any.children[0] as GammaNotNode;
    const compare: GammaCompareNode = nodes[2];
    const exists: GammaExistsNode = all.children[0] as GammaExistsNode;
    const refOperand: GammaReferenceOperand = compare.right as GammaReferenceOperand;
    const literalOperand: GammaLiteralOperand = nodes[3].right;
    const setOperand: GammaSetOperand = nodes[4].right;
    const constraint: GammaConstraint = { id: "c1", items: ["time"], expression: all };
    expect([
      all.kind,
      any.kind,
      not.kind,
      compare.kind,
      exists.kind,
      refOperand.kind,
      literalOperand.kind,
      setOperand.kind,
      constraint.id,
    ]).toEqual(["all", "any", "not", "compare", "exists", "reference", "literal", "set", "c1"]);

    const operators = [
      "eq",
      "neq",
      "lt",
      "lte",
      "gt",
      "gte",
      "in",
    ] as const satisfies readonly GammaComparisonOperator[];
    const types = [
      "string",
      "boolean",
      "Hour",
      "Weekday",
      "Seconds",
      "Days",
      "Count",
      "networkClass",
      "actionClass",
    ] as const satisfies readonly GammaScalarType[];
    const literals: readonly GammaTypedLiteral[] = [
      { type: "string", value: "x" },
      { type: "boolean", value: true },
      { type: "Hour", value: 1 },
      { type: "Weekday", value: 1 },
      { type: "Seconds", value: 1 },
      { type: "Days", value: 1 },
      { type: "Count", value: 1 },
      { type: "networkClass", value: "corporate" },
      { type: "actionClass", value: "read" },
    ];
    expect(operators).toHaveLength(7);
    expect(types).toHaveLength(9);
    expect(literals).toHaveLength(types.length);
  });

  it("covers exactly the 21 approved references with their item, source-field, type, nullability, and domains", () => {
    const expected: Record<string, readonly [string, string, string, boolean]> = {
      "environmental.time.weekday": ["time", "weekday", "Weekday", false],
      "environmental.time.hour": ["time", "hour", "Hour", false],
      "environmental.time.timezone": ["time", "timezone", "string", false],
      "environmental.location.country": ["location", "country", "string", false],
      "environmental.location.region": ["location", "region", "string", false],
      "environmental.network.class": ["network", "", "networkClass", false],
      "environmental.device.registered": ["device", "registered", "boolean", false],
      "environmental.device.deviceId": ["device", "deviceId", "string", true],
      "environmental.device.tokenAgeSeconds": ["device", "tokenAgeSeconds", "Seconds", false],
      "behavioral.session.method": ["session", "method", "string", false],
      "behavioral.session.ageSeconds": ["session", "ageSeconds", "Seconds", false],
      "behavioral.frequency.count": ["frequency", "count", "Count", false],
      "behavioral.frequency.windowSeconds": ["frequency", "windowSeconds", "Seconds", false],
      "behavioral.history.windowDays": ["history", "windowDays", "Days", false],
      "behavioral.history.enrollmentComplete": ["history", "enrollmentComplete", "boolean", false],
      "behavioral.navigation.previousClass": ["navigation", "previousClass", "string", true],
      "behavioral.navigation.currentClass": ["navigation", "currentClass", "string", false],
      "behavioral.navigation.transitionCount": ["navigation", "transitionCount", "Count", false],
      "behavioral.navigation.enrollmentComplete": [
        "navigation",
        "enrollmentComplete",
        "boolean",
        false,
      ],
      "behavioral.request.resourceClass": ["request", "resourceClass", "string", false],
      "behavioral.request.actionClass": ["request", "actionClass", "actionClass", false],
    };
    expect(GAMMA_CONTEXT_REFERENCE_IDS).toHaveLength(21);
    expect([...GAMMA_CONTEXT_REFERENCE_IDS].sort()).toEqual(Object.keys(expected).sort());
    for (const [id, [itemKind, sourceField, scalarType, nullable]] of Object.entries(expected)) {
      const entry = getGammaContextReference(id)!;
      expect([
        entry.reference,
        entry.itemKind,
        entry.sourceField ?? "",
        entry.scalarType,
        entry.nullable,
      ]).toEqual([id, itemKind, sourceField, scalarType, nullable]);
      expect(GAMMA_CONTEXT_REFERENCES[id as keyof typeof GAMMA_CONTEXT_REFERENCES]).toBe(entry);
    }
    expect(GAMMA_CONTEXT_REFERENCES["environmental.time.weekday"].domain).toMatchObject({
      minimum: 0,
      maximum: 6,
      integer: true,
    });
    expect(GAMMA_CONTEXT_REFERENCES["environmental.time.hour"].domain).toMatchObject({
      minimum: 0,
      minimumInclusive: false,
      maximum: 24,
      maximumInclusive: false,
    });
    expect(GAMMA_CONTEXT_REFERENCES["environmental.device.tokenAgeSeconds"].domain).toMatchObject({
      minimumInclusive: true,
      integer: true,
    });
    expect(GAMMA_CONTEXT_REFERENCES["behavioral.frequency.windowSeconds"].domain).toMatchObject({
      minimum: 0,
      minimumInclusive: false,
    });
    expect(GAMMA_CONTEXT_REFERENCES["behavioral.history.windowDays"].domain).toMatchObject({
      minimum: 0,
      minimumInclusive: false,
    });
    expect(GAMMA_CONTEXT_REFERENCES["environmental.network.class"].domain).toEqual({
      kind: "enum",
      values: ["corporate", "vpn", "known", "unknown"],
    });
    expect(GAMMA_CONTEXT_REFERENCES["behavioral.request.actionClass"].domain).toEqual({
      kind: "enum",
      values: ["read", "write", "export", "admin"],
    });
    expect(getGammaContextReference("environmental.device.unknown")).toBeUndefined();
    expect(getGammaContextReference("behavioral.history.classes")).toBeUndefined();
  });
});

describe("Γ canonical JSON v1", () => {
  it("has a fixed serialization vector and emits the corresponding UTF-8 bytes", () => {
    const ast: GammaExistsNode = { kind: "exists", reference: "environmental.device.deviceId" };
    const serialized = '{"kind":"exists","reference":"environmental.device.deviceId"}';
    expect(canonicalizeGammaAst(ast)).toBe(serialized);
    expect(new TextDecoder().decode(canonicalGammaAstBytes(ast))).toBe(serialized);
    expect(Array.from(canonicalGammaAstBytes(ast))).toEqual(
      Array.from(new TextEncoder().encode(serialized)),
    );
  });

  it("is independent of object insertion order and sorts keys by Unicode code point", () => {
    const left = { z: 1, "\u{10000}": 3, "\uE000": 2, a: 0 } as unknown as GammaConstraint;
    const right = { a: 0, "\uE000": 2, z: 1, "\u{10000}": 3 } as unknown as GammaConstraint;
    expect(canonicalizeGammaAst(left)).toBe('{"a":0,"z":1,"":2,"𐀀":3}');
    expect(canonicalizeGammaAst(left)).toBe(canonicalizeGammaAst(right));
  });

  it("preserves array order", () => {
    const first: GammaAnyNode = {
      kind: "any",
      children: [
        { kind: "exists", reference: "environmental.device.deviceId" },
        { kind: "exists", reference: "behavioral.navigation.previousClass" },
      ],
    };
    const second: GammaAnyNode = { kind: "any", children: [...first.children].reverse() };
    expect(canonicalizeGammaAst(first)).not.toBe(canonicalizeGammaAst(second));
    expect(canonicalizeGammaAst(first)).toContain(
      '"children":[{"kind":"exists","reference":"environmental.device.deviceId"},{"kind":"exists","reference":"behavioral.navigation.previousClass"}]',
    );
  });

  it("escapes quotation marks, backslashes, and control characters deterministically", () => {
    const ast = {
      value: 'quote " slash \\ controls \u0000\b\t\n\f\r\u001f',
    } as unknown as GammaConstraint;
    expect(canonicalizeGammaAst(ast)).toBe(
      '{"value":"quote \\" slash \\\\ controls \\u0000\\b\\t\\n\\f\\r\\u001f"}',
    );
  });

  it("uses finite ECMAScript number rendering and normalizes negative zero", () => {
    const value = {
      values: [-0, 1, 1e-7, 1e21, Number.MIN_VALUE, Number.MAX_VALUE],
    } as unknown as GammaConstraint;
    expect(canonicalizeGammaAst(value)).toBe(
      '{"values":[0,1,1e-7,1e+21,5e-324,1.7976931348623157e+308]}',
    );
    expect(() => canonicalizeGammaAst({ value: Number.NaN } as unknown as GammaConstraint)).toThrow(
      /non-finite/,
    );
    expect(() => canonicalizeGammaAst({ value: Infinity } as unknown as GammaConstraint)).toThrow(
      /non-finite/,
    );
    expect(() => canonicalizeGammaAst({ value: -Infinity } as unknown as GammaConstraint)).toThrow(
      /non-finite/,
    );
  });

  it("rejects values outside JSON's data model", () => {
    expect(() => canonicalizeGammaAst({ value: undefined } as unknown as GammaConstraint)).toThrow(
      /undefined/,
    );
    const cyclic: Record<string, unknown> = {};
    cyclic["self"] = cyclic;
    expect(() => canonicalizeGammaAst(cyclic as unknown as GammaConstraint)).toThrow(/cyclic/);
    let getterCalled = false;
    const accessor = Object.defineProperty({}, "value", {
      enumerable: true,
      get: () => {
        getterCalled = true;
        return "unsafe";
      },
    });
    expect(() => canonicalizeGammaAst(accessor as GammaConstraint)).toThrow(/data properties/);
    expect(getterCalled).toBe(false);
  });

  it("returns a versioned fixed SHA-256 vector over the canonical UTF-8 bytes", () => {
    const ast: GammaExistsNode = { kind: "exists", reference: "environmental.device.deviceId" };
    const expected = "e4ba34b06357604df20b732b2280db87c67fc84328ea741bb80c402326b23e2c";
    const digest = digestGammaAst(ast);
    expect(digest).toEqual({
      canonicalizationVersion: "mcac-gamma-c14n-v1",
      algorithm: "SHA-256",
      hex: expected,
    });
    expect(createHash("sha256").update(canonicalGammaAstBytes(ast)).digest("hex")).toBe(expected);
    expect(GAMMA_CANONICALIZATION_VERSION).toBe("mcac-gamma-c14n-v1");
    expect(
      digestGammaAst({
        reference: "environmental.device.deviceId",
        kind: "exists",
      } as GammaExistsNode),
    ).toEqual(digest);
  });

  it("changes the digest when semantic content or meaningful array order changes", () => {
    const original: GammaAllNode = {
      kind: "all",
      children: [
        { kind: "exists", reference: "environmental.device.deviceId" },
        { kind: "exists", reference: "behavioral.navigation.previousClass" },
      ],
    };
    const changed: GammaAllNode = {
      kind: "all",
      children: [
        { kind: "exists", reference: "behavioral.navigation.previousClass" },
        { kind: "exists", reference: "environmental.device.deviceId" },
      ],
    };
    const changedValue: GammaExistsNode = {
      kind: "exists",
      reference: "behavioral.navigation.previousClass",
    };
    expect(digestGammaAst(original).hex).not.toBe(digestGammaAst(changed).hex);
    expect(digestGammaAst(original.children[0]!).hex).not.toBe(digestGammaAst(changedValue).hex);
  });
});
