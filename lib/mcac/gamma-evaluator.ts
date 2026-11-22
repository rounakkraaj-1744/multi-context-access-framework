import { digestGammaAst } from "./gamma-canonical";
import { getGammaContextReference } from "./gamma-context";
import type { GammaContextReferenceMetadata } from "./gamma-context";
import type {
  GammaComparisonOperator,
  GammaConstraint,
  GammaContextReference,
  GammaExpression,
  GammaOperand,
} from "./gamma-types";
import {
  validateGammaConstraint,
  validateGammaConstraints,
  type GammaValidationError,
} from "./gamma-validation";
import type { ContextItem, ContextItemKind, ValidityStatus } from "./types";

export const GAMMA_EVALUATOR_SEMANTICS_VERSION = "mcaf-gamma-eval-v1" as const;

export type GammaTruthValue = "TRUE" | "FALSE" | "INDETERMINATE";
export type GammaConstraintOutcome = "SATISFIED" | "VIOLATED" | "INDETERMINATE";
export type GammaIndeterminateReasonCode =
  "MISSING_ITEM" | "STALE_ITEM" | "UNVERIFIABLE_ITEM" | "CONTRADICTORY_ITEM" | "NULL_FIELD";
export type GammaEvidenceStatus = ValidityStatus | "ABSENT";
export type GammaNodeKind = GammaExpression["kind"];

export type GammaTraceReference = Readonly<{
  reference: GammaContextReference;
  itemKind: ContextItemKind;
  evidenceStatus: GammaEvidenceStatus;
  reasonCode?: GammaIndeterminateReasonCode;
}>;

export type GammaNodeEvaluationTrace = Readonly<{
  nodeId: string;
  nodePath: string;
  nodeType: GammaNodeKind;
  outcome: GammaTruthValue;
  references: readonly GammaTraceReference[];
  reasonCodes: readonly GammaIndeterminateReasonCode[];
  childEvaluationOrder: readonly string[];
}>;

export type GammaConstraintEvaluationTrace = Readonly<{
  traceSchemaVersion: 1;
  constraintId: string;
  astDigest: ReturnType<typeof digestGammaAst>;
  evaluatorSemanticsVersion: typeof GAMMA_EVALUATOR_SEMANTICS_VERSION;
  outcome: GammaConstraintOutcome;
  nodes: readonly GammaNodeEvaluationTrace[];
  referencedItems: readonly GammaTraceReference[];
}>;

export type GammaConstraintEvaluation = Readonly<{
  constraintId: string;
  outcome: GammaConstraintOutcome;
  trace: GammaConstraintEvaluationTrace;
}>;

export type GammaContextSnapshot = readonly ContextItem[];

export type GammaEvaluationErrorCode = "INVALID_GAMMA_POLICY" | "INVALID_GAMMA_CONTEXT_SNAPSHOT";
export type GammaEvaluationIssue =
  | GammaValidationError
  | Readonly<{ code: "INVALID_GAMMA_CONTEXT_SNAPSHOT"; path: string; message: string }>;

/** Stable configuration/integrity failure; invalid policy is never converted to a Γ outcome. */
export class GammaEvaluationError extends Error {
  readonly code: GammaEvaluationErrorCode;
  readonly issues: readonly GammaEvaluationIssue[];

  constructor(code: GammaEvaluationErrorCode, issues: readonly GammaEvaluationIssue[]) {
    super(
      code === "INVALID_GAMMA_POLICY"
        ? "Invalid Γ policy configuration."
        : "Invalid Γ context snapshot.",
    );
    this.name = "GammaEvaluationError";
    this.code = code;
    this.issues = Object.freeze([...issues]);
  }
}

type ResolvedEvidence = Readonly<{
  reference: GammaContextReference;
  itemKind: ContextItemKind;
  evidenceStatus: GammaEvidenceStatus;
  value?: unknown;
  reasonCode?: GammaIndeterminateReasonCode;
}>;

type NodeResult = Readonly<{
  outcome: GammaTruthValue;
  trace: GammaNodeEvaluationTrace;
}>;

const itemKindSet = new Set<ContextItemKind>([
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
const validityStatuses = new Set<ValidityStatus>(["V", "S", "M", "U", "X"]);
const objectItemFields = [
  "kind",
  "value",
  "observedAt",
  "sourceClass",
  "integrityFlag",
  "validityStatus",
] as const;

/** Validates one untrusted constraint and evaluates it without mutating the supplied snapshot. */
export function evaluateGammaConstraint(
  constraint: unknown,
  snapshot: GammaContextSnapshot,
): GammaConstraintEvaluation {
  const validation = validateGammaConstraint(constraint);
  if (!validation.ok) throw new GammaEvaluationError("INVALID_GAMMA_POLICY", validation.errors);
  const resolved = prepareSnapshot([validation.value], snapshot);
  return evaluateValidatedConstraint(validation.value, resolved);
}

/** Validates a complete constraint collection once, resolves one shared snapshot, then evaluates in policy order. */
export function evaluateGammaConstraints(
  constraints: unknown,
  snapshot: GammaContextSnapshot,
  crossCategoryConsistency: boolean,
): readonly GammaConstraintEvaluation[] {
  const validation = validateGammaConstraints(constraints, crossCategoryConsistency);
  if (!validation.ok) throw new GammaEvaluationError("INVALID_GAMMA_POLICY", validation.errors);
  const resolved = prepareSnapshot(validation.value.constraints, snapshot);
  return Object.freeze(
    validation.value.constraints.map((constraint) =>
      evaluateValidatedConstraint(constraint, resolved),
    ),
  );
}

function evaluateValidatedConstraint(
  constraint: GammaConstraint,
  resolved: ReadonlyMap<GammaContextReference, ResolvedEvidence>,
): GammaConstraintEvaluation {
  const nodeTraces: GammaNodeEvaluationTrace[] = [];
  const root = evaluateNode(constraint.expression, "$", resolved, nodeTraces);
  const outcome = truthToOutcome(root.outcome);
  const referencedIds = collectReferenceIds(constraint.expression);
  const referencedItems = Object.freeze(
    [...referencedIds].sort().map((reference) => traceReference(resolved.get(reference)!)),
  );
  const trace: GammaConstraintEvaluationTrace = Object.freeze({
    traceSchemaVersion: 1,
    constraintId: constraint.id,
    astDigest: digestGammaAst(constraint),
    evaluatorSemanticsVersion: GAMMA_EVALUATOR_SEMANTICS_VERSION,
    outcome,
    nodes: Object.freeze(nodeTraces),
    referencedItems,
  });
  return Object.freeze({ constraintId: constraint.id, outcome, trace });
}

function evaluateNode(
  expression: GammaExpression,
  path: string,
  resolved: ReadonlyMap<GammaContextReference, ResolvedEvidence>,
  output: GammaNodeEvaluationTrace[],
): NodeResult {
  let outcome: GammaTruthValue;
  let references: readonly GammaTraceReference[] = Object.freeze([]);
  let reasonCodes: readonly GammaIndeterminateReasonCode[] = Object.freeze([]);
  let childEvaluationOrder: readonly string[] = Object.freeze([]);

  switch (expression.kind) {
    case "all": {
      const childPaths = expression.children.map((_, index) => `${path}.children[${index}]`);
      const children = expression.children.map((child, index) =>
        evaluateNode(child, childPaths[index]!, resolved, output),
      );
      outcome = kleeneAnd(children.map((child) => child.outcome));
      reasonCodes = propagatedReasons(outcome, children);
      childEvaluationOrder = Object.freeze(childPaths);
      break;
    }
    case "any": {
      const childPaths = expression.children.map((_, index) => `${path}.children[${index}]`);
      const children = expression.children.map((child, index) =>
        evaluateNode(child, childPaths[index]!, resolved, output),
      );
      outcome = kleeneOr(children.map((child) => child.outcome));
      reasonCodes = propagatedReasons(outcome, children);
      childEvaluationOrder = Object.freeze(childPaths);
      break;
    }
    case "not": {
      const childPath = `${path}.child`;
      const child = evaluateNode(expression.child, childPath, resolved, output);
      outcome = kleeneNot(child.outcome);
      reasonCodes = outcome === "INDETERMINATE" ? child.trace.reasonCodes : Object.freeze([]);
      childEvaluationOrder = Object.freeze([childPath]);
      break;
    }
    case "exists": {
      const evidence = resolved.get(expression.reference)!;
      references = Object.freeze([traceReference(evidence)]);
      if (evidence.reasonCode) {
        outcome = "INDETERMINATE";
        reasonCodes = Object.freeze([evidence.reasonCode]);
      } else {
        outcome = evidence.value === null ? "FALSE" : "TRUE";
      }
      break;
    }
    case "compare": {
      const left = resolved.get(expression.left)!;
      const right =
        expression.right.kind === "reference"
          ? resolved.get(expression.right.reference)!
          : undefined;
      references = Object.freeze(
        right ? [traceReference(left), traceReference(right)] : [traceReference(left)],
      );
      const unavailableReasons = [left.reasonCode, right?.reasonCode].filter(isReasonCode);
      if (unavailableReasons.length > 0) {
        outcome = "INDETERMINATE";
        reasonCodes = uniqueReasons(unavailableReasons);
      } else {
        const leftValue = left.value;
        const rightValue = resolveOperand(expression.right, resolved);
        if (leftValue === null || rightValue === null) {
          outcome = "INDETERMINATE";
          reasonCodes = Object.freeze(["NULL_FIELD"]);
        } else {
          outcome = compareValues(expression.operator, leftValue, rightValue) ? "TRUE" : "FALSE";
        }
      }
      break;
    }
  }

  const trace: GammaNodeEvaluationTrace = Object.freeze({
    nodeId: path,
    nodePath: path,
    nodeType: expression.kind,
    outcome,
    references,
    reasonCodes,
    childEvaluationOrder,
  });
  output.push(trace);
  return Object.freeze({ outcome, trace });
}

function resolveOperand(
  operand: GammaOperand,
  resolved: ReadonlyMap<GammaContextReference, ResolvedEvidence>,
): unknown {
  if (operand.kind === "literal") return operand.value.value;
  if (operand.kind === "reference") return resolved.get(operand.reference)!.value;
  return operand.values.map((value) => value.value);
}

function compareValues(operator: GammaComparisonOperator, left: unknown, right: unknown): boolean {
  switch (operator) {
    case "eq":
      return scalarEquals(left, right);
    case "neq":
      return !scalarEquals(left, right);
    case "lt":
      return (left as number) < (right as number);
    case "lte":
      return (left as number) <= (right as number);
    case "gt":
      return (left as number) > (right as number);
    case "gte":
      return (left as number) >= (right as number);
    case "in":
      return (right as readonly unknown[]).some((candidate) => scalarEquals(left, candidate));
  }
}

function scalarEquals(left: unknown, right: unknown): boolean {
  // Strict equality gives exact string/enum/Boolean equality and numeric -0 === +0.
  return left === right;
}

function kleeneAnd(values: readonly GammaTruthValue[]): GammaTruthValue {
  if (values.includes("FALSE")) return "FALSE";
  if (values.includes("INDETERMINATE")) return "INDETERMINATE";
  return "TRUE";
}

function kleeneOr(values: readonly GammaTruthValue[]): GammaTruthValue {
  if (values.includes("TRUE")) return "TRUE";
  if (values.includes("INDETERMINATE")) return "INDETERMINATE";
  return "FALSE";
}

function kleeneNot(value: GammaTruthValue): GammaTruthValue {
  if (value === "TRUE") return "FALSE";
  if (value === "FALSE") return "TRUE";
  return "INDETERMINATE";
}

function truthToOutcome(value: GammaTruthValue): GammaConstraintOutcome {
  if (value === "TRUE") return "SATISFIED";
  if (value === "FALSE") return "VIOLATED";
  return "INDETERMINATE";
}

function propagatedReasons(
  outcome: GammaTruthValue,
  children: readonly NodeResult[],
): readonly GammaIndeterminateReasonCode[] {
  if (outcome !== "INDETERMINATE") return Object.freeze([]);
  return uniqueReasons(
    children
      .filter((child) => child.outcome === "INDETERMINATE")
      .flatMap((child) => child.trace.reasonCodes),
  );
}

function uniqueReasons(
  reasons: readonly GammaIndeterminateReasonCode[],
): readonly GammaIndeterminateReasonCode[] {
  return Object.freeze([...new Set(reasons)]);
}

function isReasonCode(value: unknown): value is GammaIndeterminateReasonCode {
  return (
    value === "MISSING_ITEM" ||
    value === "STALE_ITEM" ||
    value === "UNVERIFIABLE_ITEM" ||
    value === "CONTRADICTORY_ITEM" ||
    value === "NULL_FIELD"
  );
}

function indexContextSnapshot(
  snapshot: GammaContextSnapshot,
): ReadonlyMap<ContextItemKind, Readonly<Record<string, unknown>>> {
  if (!Array.isArray(snapshot))
    throw snapshotError("$", "Context snapshot must be an array of classified context items.");
  const items = new Map<ContextItemKind, Readonly<Record<string, unknown>>>();
  const snapshotItems = readSnapshotArray(snapshot);
  for (let index = 0; index < snapshotItems.length; index += 1) {
    const item = snapshotItems[index];
    const path = `$[${index}]`;
    const fields = readExactDataObject(item, path, objectItemFields);
    const kind = fields["kind"];
    if (typeof kind !== "string" || !itemKindSet.has(kind as ContextItemKind)) {
      throw snapshotError(`${path}.kind`, "Context item kind is not in the MCAC context registry.");
    }
    if (items.has(kind as ContextItemKind))
      throw snapshotError(`${path}.kind`, "Context snapshot contains a duplicate item kind.");
    const status = fields["validityStatus"];
    if (typeof status !== "string" || !validityStatuses.has(status as ValidityStatus)) {
      throw snapshotError(`${path}.validityStatus`, "Context item has an unknown validity status.");
    }
    validateTupleMetadata(fields, path);
    items.set(kind as ContextItemKind, Object.freeze({ ...fields }));
  }
  return items;
}

function resolveReferences(
  constraints: readonly GammaConstraint[],
  contextItems: ReadonlyMap<ContextItemKind, Readonly<Record<string, unknown>>>,
): ReadonlyMap<GammaContextReference, ResolvedEvidence> {
  const references = new Set<GammaContextReference>();
  for (const constraint of constraints) collectReferenceIds(constraint.expression, references);
  const resolved = new Map<GammaContextReference, ResolvedEvidence>();
  for (const reference of references) {
    const metadata = getGammaContextReference(reference)!;
    const item = contextItems.get(metadata.itemKind);
    if (!item) {
      resolved.set(
        reference,
        Object.freeze({
          reference,
          itemKind: metadata.itemKind,
          evidenceStatus: "ABSENT",
          reasonCode: "MISSING_ITEM",
        }),
      );
      continue;
    }
    const status = item["validityStatus"] as ValidityStatus;
    if (status !== "V") {
      resolved.set(
        reference,
        Object.freeze({
          reference,
          itemKind: metadata.itemKind,
          evidenceStatus: status,
          reasonCode: statusReason(status),
        }),
      );
      continue;
    }
    const value = readRegisteredValue(
      item["value"],
      metadata,
      `context.${metadata.itemKind}.${metadata.sourceField ?? "value"}`,
    );
    if (value === null && !metadata.nullable) {
      throw snapshotError(
        `context.${metadata.itemKind}.${metadata.sourceField ?? "value"}`,
        "A non-nullable Γ context field is null in valid evidence.",
      );
    }
    if (value !== null && !validValue(value, metadata)) {
      throw snapshotError(
        `context.${metadata.itemKind}.${metadata.sourceField ?? "value"}`,
        "Valid evidence does not match the registered Γ field type/domain.",
      );
    }
    resolved.set(
      reference,
      Object.freeze({ reference, itemKind: metadata.itemKind, evidenceStatus: status, value }),
    );
  }
  return resolved;
}

function readRegisteredValue(
  itemValue: unknown,
  metadata: GammaContextReferenceMetadata,
  path: string,
): unknown {
  if (metadata.sourceField === null) return itemValue;
  if (typeof itemValue !== "object" || itemValue === null || Array.isArray(itemValue)) {
    throw snapshotError(
      path,
      "Valid context item value does not contain the registered field object.",
    );
  }
  const descriptor = Object.getOwnPropertyDescriptor(itemValue, metadata.sourceField);
  if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
    throw snapshotError(
      path,
      "Registered context field is missing or is not an own data property.",
    );
  }
  return descriptor.value;
}

function validValue(value: unknown, metadata: GammaContextReferenceMetadata): boolean {
  const domain = metadata.domain;
  if (domain.kind === "string") return typeof value === "string";
  if (domain.kind === "boolean") return typeof value === "boolean";
  if (domain.kind === "enum") return typeof value === "string" && domain.values.includes(value);
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  if (
    domain.minimum !== undefined &&
    (domain.minimumInclusive ? value < domain.minimum : value <= domain.minimum)
  )
    return false;
  if (
    domain.maximum !== undefined &&
    (domain.maximumInclusive ? value > domain.maximum : value >= domain.maximum)
  )
    return false;
  return domain.integer !== true || Number.isInteger(value);
}

function statusReason(status: ValidityStatus): GammaIndeterminateReasonCode | undefined {
  if (status === "M") return "MISSING_ITEM";
  if (status === "S") return "STALE_ITEM";
  if (status === "U") return "UNVERIFIABLE_ITEM";
  if (status === "X") return "CONTRADICTORY_ITEM";
}

function traceReference(evidence: ResolvedEvidence): GammaTraceReference {
  return Object.freeze({
    reference: evidence.reference,
    itemKind: evidence.itemKind,
    evidenceStatus: evidence.evidenceStatus,
    ...(evidence.reasonCode ? { reasonCode: evidence.reasonCode } : {}),
  });
}

function collectReferenceIds(
  expression: GammaExpression,
  output = new Set<GammaContextReference>(),
): Set<GammaContextReference> {
  switch (expression.kind) {
    case "all":
    case "any":
      for (const child of expression.children) collectReferenceIds(child, output);
      break;
    case "not":
      collectReferenceIds(expression.child, output);
      break;
    case "exists":
      output.add(expression.reference);
      break;
    case "compare":
      output.add(expression.left);
      if (expression.right.kind === "reference") output.add(expression.right.reference);
      break;
  }
  return output;
}

function readExactDataObject(
  input: unknown,
  path: string,
  expectedFields: readonly string[],
): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw snapshotError(path, "Context item must be a plain object.");
  }
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null)
    throw snapshotError(path, "Context item must be a plain object.");
  if (Reflect.ownKeys(input).some((key) => typeof key !== "string"))
    throw snapshotError(path, "Context item cannot contain symbol properties.");
  const keys = Reflect.ownKeys(input) as string[];
  if (keys.length !== expectedFields.length || expectedFields.some((key) => !keys.includes(key))) {
    throw snapshotError(path, "Context item has missing or extra fields.");
  }
  const values: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of expectedFields) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable)
      throw snapshotError(
        `${path}.${key}`,
        "Context item fields must be enumerable own data properties.",
      );
    values[key] = descriptor.value;
  }
  return values;
}

function readSnapshotArray(snapshot: readonly ContextItem[]): readonly unknown[] {
  if (Object.getPrototypeOf(snapshot) !== Array.prototype)
    throw snapshotError("$", "Context snapshot must be a plain array.");
  const keys = Reflect.ownKeys(snapshot).filter((key) => key !== "length");
  if (keys.length !== snapshot.length || keys.some((key, index) => key !== String(index))) {
    throw snapshotError(
      "$",
      "Context snapshot must be dense and contain no extra array properties.",
    );
  }
  const values: unknown[] = [];
  for (let index = 0; index < snapshot.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(snapshot, String(index));
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw snapshotError(
        `$[${index}]`,
        "Context snapshot entries must be enumerable own data properties.",
      );
    }
    values.push(descriptor.value);
  }
  return values;
}

function validateTupleMetadata(item: Readonly<Record<string, unknown>>, path: string): void {
  const value = item["value"];
  const observedAt = item["observedAt"];
  const sourceClass = item["sourceClass"];
  const integrityFlag = item["integrityFlag"];
  if (integrityFlag !== 0 && integrityFlag !== 1)
    throw snapshotError(`${path}.integrityFlag`, "Context integrity flag must be 0 or 1.");
  if (value === null) {
    if (observedAt !== null || sourceClass !== null || integrityFlag !== 0)
      throw snapshotError(path, "Absent context evidence must use the null tuple representation.");
    if (item["validityStatus"] !== "M")
      throw snapshotError(
        `${path}.validityStatus`,
        "Absent context evidence must have M validity status.",
      );
  } else {
    if (typeof observedAt !== "number" || !Number.isFinite(observedAt))
      throw snapshotError(
        `${path}.observedAt`,
        "Present context evidence requires a finite observation time.",
      );
    if (sourceClass !== "srv" && sourceClass !== "ext")
      throw snapshotError(
        `${path}.sourceClass`,
        "Present context evidence requires a recognized source class.",
      );
    if (sourceClass === "srv" && integrityFlag !== 1)
      throw snapshotError(
        `${path}.integrityFlag`,
        "Server-classified context evidence requires integrity flag 1.",
      );
  }
}

function prepareSnapshot(
  constraints: readonly GammaConstraint[],
  snapshot: GammaContextSnapshot,
): ReadonlyMap<GammaContextReference, ResolvedEvidence> {
  try {
    return resolveReferences(constraints, indexContextSnapshot(snapshot));
  } catch (error) {
    if (error instanceof GammaEvaluationError) throw error;
    throw snapshotError(
      "$",
      "Context snapshot could not be inspected as validated immutable evidence.",
    );
  }
}

function snapshotError(path: string, message: string): GammaEvaluationError {
  return new GammaEvaluationError("INVALID_GAMMA_CONTEXT_SNAPSHOT", [
    Object.freeze({ code: "INVALID_GAMMA_CONTEXT_SNAPSHOT", path, message }),
  ]);
}
