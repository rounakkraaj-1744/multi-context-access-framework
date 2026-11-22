import type { ContextItemKind } from "./types";

export type GammaScalarType =
  | "string"
  | "boolean"
  | "Hour"
  | "Weekday"
  | "Seconds"
  | "Days"
  | "Count"
  | "networkClass"
  | "actionClass";

export type GammaComparisonOperator = "eq" | "neq" | "lt" | "lte" | "gt" | "gte" | "in";
export type GammaContextReference =
  | "environmental.time.weekday"
  | "environmental.time.hour"
  | "environmental.time.timezone"
  | "environmental.location.country"
  | "environmental.location.region"
  | "environmental.network.class"
  | "environmental.device.registered"
  | "environmental.device.deviceId"
  | "environmental.device.tokenAgeSeconds"
  | "behavioral.session.method"
  | "behavioral.session.ageSeconds"
  | "behavioral.frequency.count"
  | "behavioral.frequency.windowSeconds"
  | "behavioral.history.windowDays"
  | "behavioral.history.enrollmentComplete"
  | "behavioral.navigation.previousClass"
  | "behavioral.navigation.currentClass"
  | "behavioral.navigation.transitionCount"
  | "behavioral.navigation.enrollmentComplete"
  | "behavioral.request.resourceClass"
  | "behavioral.request.actionClass";

export type GammaReferenceOperand = Readonly<{
  kind: "reference";
  reference: GammaContextReference;
}>;
export type GammaTypedLiteral = {
  [T in GammaScalarType]: Readonly<{ type: T; value: GammaScalarValue<T> }>;
}[GammaScalarType];
export type GammaScalarValue<T extends GammaScalarType> = T extends "string"
  ? string
  : T extends "boolean"
    ? boolean
    : T extends "networkClass"
      ? "corporate" | "vpn" | "known" | "unknown"
      : T extends "actionClass"
        ? "read" | "write" | "export" | "admin"
        : number;
export type GammaLiteralOperand = Readonly<{ kind: "literal"; value: GammaTypedLiteral }>;
export type GammaSetOperand = Readonly<{
  kind: "set";
  valueType: GammaScalarType;
  values: readonly GammaTypedLiteral[];
}>;
export type GammaOperand = GammaReferenceOperand | GammaLiteralOperand | GammaSetOperand;

export type GammaAllNode = Readonly<{ kind: "all"; children: readonly GammaExpression[] }>;
export type GammaAnyNode = Readonly<{ kind: "any"; children: readonly GammaExpression[] }>;
export type GammaNotNode = Readonly<{ kind: "not"; child: GammaExpression }>;
export type GammaCompareNode = Readonly<{
  kind: "compare";
  operator: GammaComparisonOperator;
  left: GammaContextReference;
  right: GammaOperand;
}>;
export type GammaExistsNode = Readonly<{ kind: "exists"; reference: GammaContextReference }>;
export type GammaExpression =
  GammaAllNode | GammaAnyNode | GammaNotNode | GammaCompareNode | GammaExistsNode;

export type GammaConstraint = Readonly<{
  id: string;
  items: readonly ContextItemKind[];
  expression: GammaExpression;
}>;
