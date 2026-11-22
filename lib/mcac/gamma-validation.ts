import { canonicalGammaAstBytes } from "./gamma-canonical";
import {
  GAMMA_CONTEXT_REFERENCES,
  getGammaContextReference,
  type GammaContextReferenceMetadata,
} from "./gamma-context";
import type {
  GammaComparisonOperator,
  GammaConstraint,
  GammaContextReference,
  GammaExpression,
  GammaOperand,
  GammaScalarType,
  GammaTypedLiteral,
} from "./gamma-types";
import type { ContextItemKind } from "./types";

export const GAMMA_LIMITS = Object.freeze({
  astDepth: 5,
  nodesPerConstraint: 32,
  distinctReferencesPerConstraint: 8,
  constraintsPerPolicy: 16,
  childrenPerLogicalNode: 8,
  setValues: 16,
  stringLiteralCodePoints: 128,
  canonicalBytesPerPolicy: 65_536,
} as const);

export type GammaValidationErrorCode =
  | "INVALID_TYPE"
  | "UNKNOWN_FIELD"
  | "MISSING_FIELD"
  | "INVALID_DISCRIMINATOR"
  | "UNKNOWN_OPERATOR"
  | "UNKNOWN_REFERENCE"
  | "INVALID_VALUE"
  | "INVALID_ENUM"
  | "NON_FINITE_NUMBER"
  | "NULL_LITERAL"
  | "TYPE_MISMATCH"
  | "EMPTY_COLLECTION"
  | "LIMIT_EXCEEDED"
  | "DUPLICATE_CONSTRAINT_ID"
  | "DUPLICATE_ITEM_KIND"
  | "INVALID_ITEM_KIND"
  | "ITEM_REFERENCE_MISMATCH"
  | "INSUFFICIENT_ITEM_KINDS"
  | "FEATURE_DISABLED";

export type GammaValidationError = Readonly<{
  code: GammaValidationErrorCode;
  path: string;
  message: string;
}>;

export type GammaValidationResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; errors: readonly GammaValidationError[] }>;

export type GammaConstraintsValidation = Readonly<{
  constraints: readonly GammaConstraint[];
  canonicalBytes: number;
}>;

const operators = new Set<GammaComparisonOperator>(["eq", "neq", "lt", "lte", "gt", "gte", "in"]);
const scalarTypes = new Set<GammaScalarType>([
  "string",
  "boolean",
  "Hour",
  "Weekday",
  "Seconds",
  "Days",
  "Count",
  "networkClass",
  "actionClass",
]);
const numericTypes = new Set<GammaScalarType>(["Hour", "Weekday", "Seconds", "Days", "Count"]);
const itemKinds = new Set<ContextItemKind>([
  "time",
  "location",
  "network",
  "device",
  "session",
  "frequency",
  "history",
  "navigation",
  "request",
]);

/** Validates one untrusted Γ constraint. Collection-wide uniqueness/feature/byte limits are checked by validateGammaConstraints. */
export function validateGammaConstraint(input: unknown): GammaValidationResult<GammaConstraint> {
  try {
    return validateGammaConstraintInternal(input);
  } catch {
    return inputInspectionFailure("$");
  }
}

function validateGammaConstraintInternal(input: unknown): GammaValidationResult<GammaConstraint> {
  const errors: GammaValidationError[] = [];
  const parsed = parseConstraint(input, "$", errors);
  if (parsed) {
    validateConstraintReferences(parsed, errors, "$");
  }
  return parsed && errors.length === 0
    ? Object.freeze({ ok: true, value: parsed })
    : Object.freeze({ ok: false, errors: Object.freeze(errors) });
}

/** Validates the complete Γ constraint collection and its feature switch as one policy-level unit. */
export function validateGammaConstraints(
  input: unknown,
  crossCategoryConsistency: unknown,
): GammaValidationResult<GammaConstraintsValidation> {
  try {
    return validateGammaConstraintsInternal(input, crossCategoryConsistency);
  } catch {
    return inputInspectionFailure("$.consistencyConstraints");
  }
}

function validateGammaConstraintsInternal(
  input: unknown,
  crossCategoryConsistency: unknown,
): GammaValidationResult<GammaConstraintsValidation> {
  const errors: GammaValidationError[] = [];
  if (typeof crossCategoryConsistency !== "boolean") {
    addError(
      errors,
      "INVALID_TYPE",
      "$.interactions.crossCategoryConsistency",
      "crossCategoryConsistency must be a Boolean.",
    );
  }
  const rawConstraints = readArray(input, "$.consistencyConstraints", errors);
  if (!rawConstraints) {
    return Object.freeze({ ok: false, errors: Object.freeze(errors) });
  }
  if (rawConstraints.length > GAMMA_LIMITS.constraintsPerPolicy) {
    addError(
      errors,
      "LIMIT_EXCEEDED",
      "$.consistencyConstraints",
      `A policy may contain at most ${GAMMA_LIMITS.constraintsPerPolicy} Γ constraints.`,
    );
  }
  if (rawConstraints.length > 0 && crossCategoryConsistency === false) {
    addError(
      errors,
      "FEATURE_DISABLED",
      "$.interactions.crossCategoryConsistency",
      "A policy with Γ constraints requires crossCategoryConsistency to be true.",
    );
  }

  const constraints: GammaConstraint[] = [];
  const ids = new Set<string>();
  for (
    let index = 0;
    index < rawConstraints.length && index < GAMMA_LIMITS.constraintsPerPolicy + 1;
    index += 1
  ) {
    const path = `$.consistencyConstraints[${index}]`;
    const parsed = parseConstraint(rawConstraints[index], path, errors);
    if (!parsed) continue;
    validateConstraintReferences(parsed, errors, path);
    if (ids.has(parsed.id))
      addError(
        errors,
        "DUPLICATE_CONSTRAINT_ID",
        `${path}.id`,
        `Constraint ID ${JSON.stringify(parsed.id)} is duplicated.`,
      );
    ids.add(parsed.id);
    constraints.push(parsed);
  }

  let canonicalBytes = 0;
  if (
    constraints.length === rawConstraints.length &&
    !errors.some(
      (error) => error.code === "LIMIT_EXCEEDED" && error.path === "$.consistencyConstraints",
    )
  ) {
    try {
      canonicalBytes = canonicalGammaAstBytes(constraints).byteLength;
      if (canonicalBytes > GAMMA_LIMITS.canonicalBytesPerPolicy) {
        addError(
          errors,
          "LIMIT_EXCEEDED",
          "$.consistencyConstraints",
          `Canonical Γ constraint bytes exceed ${GAMMA_LIMITS.canonicalBytesPerPolicy}.`,
        );
      }
    } catch {
      // Parsed values are plain JSON data; this is defensive against future canonicalizer changes.
      addError(
        errors,
        "INVALID_VALUE",
        "$.consistencyConstraints",
        "Γ constraints could not be canonically serialized.",
      );
    }
  }

  return errors.length === 0
    ? Object.freeze({
        ok: true,
        value: Object.freeze({ constraints: Object.freeze(constraints), canonicalBytes }),
      })
    : Object.freeze({ ok: false, errors: Object.freeze(errors) });
}

function parseConstraint(
  input: unknown,
  path: string,
  errors: GammaValidationError[],
): GammaConstraint | undefined {
  const record = readRecord(input, path, errors);
  if (!record) return undefined;
  checkExactFields(record, ["id", "items", "expression"], path, errors);
  if (typeof record["id"] !== "string")
    addError(errors, "INVALID_TYPE", `${path}.id`, "Constraint id must be a string.");
  else if (record["id"].length === 0)
    addError(errors, "INVALID_VALUE", `${path}.id`, "Constraint id must not be empty.");

  const items: ContextItemKind[] = [];
  const rawItems = readArray(record["items"], `${path}.items`, errors);
  if (rawItems) {
    if (rawItems.length === 0)
      addError(
        errors,
        "EMPTY_COLLECTION",
        `${path}.items`,
        "Declared item kinds must not be empty.",
      );
    const seen = new Set<string>();
    for (let index = 0; index < rawItems.length; index += 1) {
      const kind = rawItems[index];
      const itemPath = `${path}.items[${index}]`;
      if (typeof kind !== "string" || !itemKinds.has(kind as ContextItemKind)) {
        addError(
          errors,
          "INVALID_ITEM_KIND",
          itemPath,
          "Declared item kind is not in the closed MCAC context item registry.",
        );
      } else {
        if (seen.has(kind))
          addError(
            errors,
            "DUPLICATE_ITEM_KIND",
            itemPath,
            `Declared item kind ${JSON.stringify(kind)} is duplicated.`,
          );
        seen.add(kind);
        items.push(kind as ContextItemKind);
      }
    }
  }

  const expression = parseExpression(record["expression"], `${path}.expression`, 1, {
    nodes: 0,
    nodeLimitReported: false,
    referenceLimitReported: false,
    referenceOccurrences: new Set(),
    errors,
  });
  if (typeof record["id"] !== "string" || record["id"].length === 0 || !rawItems || !expression)
    return undefined;
  return Object.freeze({ id: record["id"], items: Object.freeze(items), expression });
}

type TraversalState = {
  nodes: number;
  nodeLimitReported: boolean;
  referenceLimitReported: boolean;
  referenceOccurrences: Set<GammaContextReference>;
  errors: GammaValidationError[];
};

function parseExpression(
  input: unknown,
  path: string,
  depth: number,
  state: TraversalState,
): GammaExpression | undefined {
  if (depth > GAMMA_LIMITS.astDepth) {
    addError(
      state.errors,
      "LIMIT_EXCEEDED",
      path,
      `AST depth exceeds ${GAMMA_LIMITS.astDepth} (root depth is 1).`,
    );
    return undefined;
  }
  state.nodes += 1;
  if (state.nodes > GAMMA_LIMITS.nodesPerConstraint) {
    if (!state.nodeLimitReported)
      addError(
        state.errors,
        "LIMIT_EXCEEDED",
        path,
        `AST contains more than ${GAMMA_LIMITS.nodesPerConstraint} nodes.`,
      );
    state.nodeLimitReported = true;
    return undefined;
  }
  const record = readRecord(input, path, state.errors);
  if (!record) return undefined;
  const kind = record["kind"];
  if (kind === "all" || kind === "any") {
    checkExactFields(record, ["kind", "children"], path, state.errors);
    const childrenValue = readArray(record["children"], `${path}.children`, state.errors);
    if (!childrenValue) return undefined;
    if (childrenValue.length === 0)
      addError(
        state.errors,
        "EMPTY_COLLECTION",
        `${path}.children`,
        "Logical nodes require at least one child.",
      );
    if (childrenValue.length > GAMMA_LIMITS.childrenPerLogicalNode)
      addError(
        state.errors,
        "LIMIT_EXCEEDED",
        `${path}.children`,
        `Logical nodes may have at most ${GAMMA_LIMITS.childrenPerLogicalNode} children.`,
      );
    const children: GammaExpression[] = [];
    for (
      let index = 0;
      index < Math.min(childrenValue.length, GAMMA_LIMITS.childrenPerLogicalNode);
      index += 1
    ) {
      const child = parseExpression(
        childrenValue[index],
        `${path}.children[${index}]`,
        depth + 1,
        state,
      );
      if (child) children.push(child);
    }
    if (children.length !== childrenValue.length) return undefined;
    return Object.freeze(
      kind === "all"
        ? { kind, children: Object.freeze(children) }
        : { kind, children: Object.freeze(children) },
    );
  }
  if (kind === "not") {
    checkExactFields(record, ["kind", "child"], path, state.errors);
    const child = parseExpression(record["child"], `${path}.child`, depth + 1, state);
    return child ? Object.freeze({ kind: "not", child }) : undefined;
  }
  if (kind === "exists") {
    checkExactFields(record, ["kind", "reference"], path, state.errors);
    const reference = parseReference(record["reference"], `${path}.reference`, state);
    return reference ? Object.freeze({ kind: "exists", reference }) : undefined;
  }
  if (kind === "compare") {
    checkExactFields(record, ["kind", "operator", "left", "right"], path, state.errors);
    const operator = record["operator"];
    if (typeof operator !== "string" || !operators.has(operator as GammaComparisonOperator)) {
      addError(
        state.errors,
        "UNKNOWN_OPERATOR",
        `${path}.operator`,
        "Comparison operator is not in the approved Γ operator set.",
      );
    }
    const left = parseReference(record["left"], `${path}.left`, state);
    const leftMetadata = left ? getGammaContextReference(left) : undefined;
    const right = parseOperand(record["right"], `${path}.right`, state, leftMetadata);
    if (
      !left ||
      !right ||
      typeof operator !== "string" ||
      !operators.has(operator as GammaComparisonOperator)
    )
      return undefined;
    validateOperandCompatibility(
      left,
      operator as GammaComparisonOperator,
      right,
      `${path}.right`,
      state.errors,
    );
    return Object.freeze({
      kind: "compare",
      operator: operator as GammaComparisonOperator,
      left,
      right,
    });
  }
  addError(
    state.errors,
    "INVALID_DISCRIMINATOR",
    `${path}.kind`,
    "Unknown Γ AST node discriminator.",
  );
  return undefined;
}

function parseOperand(
  input: unknown,
  path: string,
  state: TraversalState,
  expectedReference?: GammaContextReferenceMetadata,
): GammaOperand | undefined {
  const record = readRecord(input, path, state.errors);
  if (!record) return undefined;
  const kind = record["kind"];
  if (kind === "reference") {
    checkExactFields(record, ["kind", "reference"], path, state.errors);
    const reference = parseReference(record["reference"], `${path}.reference`, state);
    return reference ? Object.freeze({ kind: "reference", reference }) : undefined;
  }
  if (kind === "literal") {
    checkExactFields(record, ["kind", "value"], path, state.errors);
    const value = parseLiteral(record["value"], `${path}.value`, state.errors, expectedReference);
    return value ? Object.freeze({ kind: "literal", value }) : undefined;
  }
  if (kind === "set") {
    checkExactFields(record, ["kind", "valueType", "values"], path, state.errors);
    const valueType = record["valueType"];
    if (typeof valueType !== "string" || !scalarTypes.has(valueType as GammaScalarType)) {
      addError(
        state.errors,
        "INVALID_VALUE",
        `${path}.valueType`,
        "Set valueType is not an approved nominal scalar type.",
      );
    }
    const valuesValue = readArray(record["values"], `${path}.values`, state.errors);
    if (!valuesValue) return undefined;
    if (valuesValue.length === 0)
      addError(
        state.errors,
        "EMPTY_COLLECTION",
        `${path}.values`,
        "An in set must contain at least one value.",
      );
    if (valuesValue.length > GAMMA_LIMITS.setValues)
      addError(
        state.errors,
        "LIMIT_EXCEEDED",
        `${path}.values`,
        `An in set may contain at most ${GAMMA_LIMITS.setValues} values.`,
      );
    const values: GammaTypedLiteral[] = [];
    for (let index = 0; index < Math.min(valuesValue.length, GAMMA_LIMITS.setValues); index += 1) {
      const value = parseLiteral(
        valuesValue[index],
        `${path}.values[${index}]`,
        state.errors,
        expectedReference,
      );
      if (value) values.push(value);
    }
    if (
      typeof valueType !== "string" ||
      !scalarTypes.has(valueType as GammaScalarType) ||
      values.length !== valuesValue.length
    )
      return undefined;
    for (let index = 0; index < values.length; index += 1) {
      if (values[index]!.type !== valueType)
        addError(
          state.errors,
          "TYPE_MISMATCH",
          `${path}.values[${index}].type`,
          "Every set member must match the set valueType.",
        );
    }
    return Object.freeze({
      kind: "set",
      valueType: valueType as GammaScalarType,
      values: Object.freeze(values),
    });
  }
  addError(
    state.errors,
    "INVALID_DISCRIMINATOR",
    `${path}.kind`,
    "Unknown Γ operand discriminator.",
  );
  return undefined;
}

function parseLiteral(
  input: unknown,
  path: string,
  errors: GammaValidationError[],
  expectedReference?: GammaContextReferenceMetadata,
): GammaTypedLiteral | undefined {
  const record = readRecord(input, path, errors);
  if (!record) return undefined;
  checkExactFields(record, ["type", "value"], path, errors);
  const type = record["type"];
  const value = record["value"];
  if (value === null) {
    addError(errors, "NULL_LITERAL", `${path}.value`, "Null is not an allowed Γ literal.");
    return undefined;
  }
  if (typeof type !== "string" || !scalarTypes.has(type as GammaScalarType)) {
    addError(
      errors,
      "INVALID_VALUE",
      `${path}.type`,
      "Literal type is not an approved nominal scalar type.",
    );
    return undefined;
  }
  const scalarType = type as GammaScalarType;
  if (scalarType === "string" || scalarType === "networkClass" || scalarType === "actionClass") {
    if (typeof value !== "string") {
      addError(
        errors,
        "INVALID_TYPE",
        `${path}.value`,
        "String and enum literals require string values.",
      );
      return undefined;
    }
    const scalarCount = unicodeScalarCount(value);
    if (scalarCount === undefined)
      addError(
        errors,
        "INVALID_VALUE",
        `${path}.value`,
        "String literals must contain valid Unicode scalar values.",
      );
    else if (scalarCount > GAMMA_LIMITS.stringLiteralCodePoints)
      addError(
        errors,
        "LIMIT_EXCEEDED",
        `${path}.value`,
        `String literals may contain at most ${GAMMA_LIMITS.stringLiteralCodePoints} Unicode scalar values.`,
      );
  } else if (scalarType === "boolean") {
    if (typeof value !== "boolean") {
      addError(errors, "INVALID_TYPE", `${path}.value`, "Boolean literals require Boolean values.");
      return undefined;
    }
  } else {
    if (typeof value !== "number") {
      addError(
        errors,
        "INVALID_TYPE",
        `${path}.value`,
        "Numeric nominal literals require numeric values.",
      );
      return undefined;
    }
    if (!Number.isFinite(value)) {
      addError(errors, "NON_FINITE_NUMBER", `${path}.value`, "Numeric literals must be finite.");
      return undefined;
    }
    if (expectedReference) validateDomain(value, expectedReference, path, errors);
  }
  if (
    scalarType === "networkClass" &&
    !GAMMA_CONTEXT_REFERENCES["environmental.network.class"].domain.values.includes(value as never)
  ) {
    addError(errors, "INVALID_ENUM", `${path}.value`, "Invalid networkClass literal.");
  }
  if (
    scalarType === "actionClass" &&
    !GAMMA_CONTEXT_REFERENCES["behavioral.request.actionClass"].domain.values.includes(
      value as never,
    )
  ) {
    addError(errors, "INVALID_ENUM", `${path}.value`, "Invalid actionClass literal.");
  }
  return Object.freeze({ type: scalarType, value } as GammaTypedLiteral);
}

function parseReference(
  input: unknown,
  path: string,
  state: TraversalState,
): GammaContextReference | undefined {
  if (typeof input !== "string") {
    addError(state.errors, "INVALID_TYPE", path, "Context reference must be a string.");
    return undefined;
  }
  const metadata = getGammaContextReference(input);
  if (!metadata) {
    addError(
      state.errors,
      "UNKNOWN_REFERENCE",
      path,
      "Context reference is not in the closed Γ registry.",
    );
    return undefined;
  }
  state.referenceOccurrences.add(metadata.reference);
  if (
    state.referenceOccurrences.size > GAMMA_LIMITS.distinctReferencesPerConstraint &&
    !state.referenceLimitReported
  ) {
    addError(
      state.errors,
      "LIMIT_EXCEEDED",
      path,
      `A constraint may use at most ${GAMMA_LIMITS.distinctReferencesPerConstraint} distinct context references.`,
    );
    state.referenceLimitReported = true;
  }
  return metadata.reference;
}

function validateOperandCompatibility(
  left: GammaContextReference,
  operator: GammaComparisonOperator,
  right: GammaOperand,
  path: string,
  errors: GammaValidationError[],
): void {
  const leftType = getGammaContextReference(left)!.scalarType;
  if (operator === "in") {
    if (right.kind !== "set") {
      addError(
        errors,
        "TYPE_MISMATCH",
        path,
        "The in operator requires a homogeneous set operand.",
      );
      return;
    }
    if (right.valueType !== leftType)
      addError(
        errors,
        "TYPE_MISMATCH",
        `${path}.valueType`,
        `Set type ${right.valueType} does not match reference type ${leftType}.`,
      );
    return;
  }
  if (right.kind === "set") {
    addError(
      errors,
      "TYPE_MISMATCH",
      path,
      "Set operands are permitted only with the in operator.",
    );
    return;
  }
  const rightType =
    right.kind === "reference"
      ? getGammaContextReference(right.reference)!.scalarType
      : right.value.type;
  if (rightType !== leftType)
    addError(
      errors,
      "TYPE_MISMATCH",
      path,
      `Operand type ${rightType} does not match reference type ${leftType}.`,
    );
  if (["lt", "lte", "gt", "gte"].includes(operator) && !numericTypes.has(leftType)) {
    addError(
      errors,
      "TYPE_MISMATCH",
      path,
      `Operator ${operator} requires a numeric nominal reference; ${leftType} is not numeric.`,
    );
  }
}

function validateDomain(
  value: number,
  reference: GammaContextReferenceMetadata,
  path: string,
  errors: GammaValidationError[],
): void {
  const domain = reference.domain;
  const scalarType = reference.scalarType;
  if (!domain || domain.kind !== "number") return;
  if (
    domain.minimum !== undefined &&
    (domain.minimumInclusive ? value < domain.minimum : value <= domain.minimum)
  ) {
    addError(
      errors,
      "INVALID_VALUE",
      path,
      `Numeric literal is below the valid ${scalarType} domain.`,
    );
  }
  if (
    domain.maximum !== undefined &&
    (domain.maximumInclusive ? value > domain.maximum : value >= domain.maximum)
  ) {
    addError(
      errors,
      "INVALID_VALUE",
      path,
      `Numeric literal is above the valid ${scalarType} domain.`,
    );
  }
  if (domain.integer && !Number.isInteger(value))
    addError(errors, "INVALID_VALUE", path, `${scalarType} literals must be integers.`);
}

function validateConstraintReferences(
  constraint: GammaConstraint,
  errors: GammaValidationError[],
  path: string,
): void {
  const references = new Set<GammaContextReference>();
  walkReferences(constraint.expression, references);
  const derivedKinds = new Set(
    [...references].map((reference) => getGammaContextReference(reference)!.itemKind),
  );
  const declaredKinds = new Set(constraint.items);
  for (const kind of declaredKinds) {
    if (!derivedKinds.has(kind))
      addError(
        errors,
        "ITEM_REFERENCE_MISMATCH",
        `${path}.items`,
        `Declared item kind ${JSON.stringify(kind)} is not referenced by the expression.`,
      );
  }
  for (const kind of derivedKinds) {
    if (!declaredKinds.has(kind))
      addError(
        errors,
        "ITEM_REFERENCE_MISMATCH",
        `${path}.items`,
        `Expression references undeclared item kind ${JSON.stringify(kind)}.`,
      );
  }
  if (derivedKinds.size < 2)
    addError(
      errors,
      "INSUFFICIENT_ITEM_KINDS",
      `${path}.expression`,
      "A Γ expression must reference at least two distinct context item kinds.",
    );
}

function walkReferences(expression: GammaExpression, output: Set<GammaContextReference>): void {
  switch (expression.kind) {
    case "all":
    case "any":
      for (const child of expression.children) walkReferences(child, output);
      return;
    case "not":
      walkReferences(expression.child, output);
      return;
    case "exists":
      output.add(expression.reference);
      return;
    case "compare":
      output.add(expression.left);
      if (expression.right.kind === "reference") output.add(expression.right.reference);
  }
}

function readRecord(
  input: unknown,
  path: string,
  errors: GammaValidationError[],
): Record<string, unknown> | undefined {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    addError(errors, "INVALID_TYPE", path, "Expected a JSON object.");
    return undefined;
  }
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    addError(errors, "INVALID_TYPE", path, "Expected a plain JSON object.");
    return undefined;
  }
  if (Reflect.ownKeys(input).some((key) => typeof key !== "string")) {
    addError(errors, "INVALID_TYPE", path, "Symbol properties are not allowed.");
    return undefined;
  }
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(input) as string[]) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      addError(
        errors,
        "INVALID_TYPE",
        `${path}.${key}`,
        "Only enumerable own data properties are allowed.",
      );
      continue;
    }
    result[key] = descriptor.value;
  }
  return result;
}

function readArray(
  input: unknown,
  path: string,
  errors: GammaValidationError[],
): unknown[] | undefined {
  if (!Array.isArray(input)) {
    addError(errors, "INVALID_TYPE", path, "Expected a JSON array.");
    return undefined;
  }
  if (Object.getPrototypeOf(input) !== Array.prototype) {
    addError(errors, "INVALID_TYPE", path, "Expected a plain JSON array.");
    return undefined;
  }
  const ownKeys = Reflect.ownKeys(input);
  const keys = ownKeys.filter((key) => key !== "length");
  if (keys.length !== input.length || keys.some((key, index) => key !== String(index))) {
    addError(errors, "INVALID_TYPE", path, "Arrays must be dense and have no extra properties.");
    return undefined;
  }
  const values: unknown[] = [];
  for (let index = 0; index < input.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      addError(
        errors,
        "INVALID_TYPE",
        `${path}[${index}]`,
        "Array entries must be enumerable own data properties.",
      );
      return undefined;
    }
    values.push(descriptor.value);
  }
  return values;
}

function checkExactFields(
  record: Record<string, unknown>,
  expected: readonly string[],
  path: string,
  errors: GammaValidationError[],
): void {
  const expectedSet = new Set(expected);
  for (const field of expected) {
    if (!Object.hasOwn(record, field))
      addError(errors, "MISSING_FIELD", `${path}.${field}`, `Required field ${field} is missing.`);
  }
  for (const field of Object.keys(record).sort()) {
    if (!expectedSet.has(field))
      addError(
        errors,
        "UNKNOWN_FIELD",
        `${path}.${field}`,
        `Unknown field ${field} is not permitted.`,
      );
  }
}

function addError(
  errors: GammaValidationError[],
  code: GammaValidationErrorCode,
  path: string,
  message: string,
): void {
  errors.push(Object.freeze({ code, path, message }));
}

function inputInspectionFailure<T>(path: string): GammaValidationResult<T> {
  return Object.freeze({
    ok: false,
    errors: Object.freeze([
      Object.freeze({
        code: "INVALID_TYPE" as const,
        path,
        message: "Input could not be inspected as plain JSON data.",
      }),
    ]),
  });
}

function unicodeScalarCount(value: string): number | undefined {
  let count = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return undefined;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return undefined;
    }
    count += 1;
  }
  return count;
}
