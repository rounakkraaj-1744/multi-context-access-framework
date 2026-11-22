import {
  CANONICAL_NETWORK_CLASSES,
  type ActionClass,
  type ContextItemKind,
  type ContextValueMap,
} from "./types";
import type { GammaContextReference, GammaScalarType } from "./gamma-types";

export type GammaValueDomain =
  | Readonly<{ kind: "string" }>
  | Readonly<{ kind: "boolean" }>
  | Readonly<{
      kind: "number";
      minimum?: number;
      minimumInclusive?: boolean;
      maximum?: number;
      maximumInclusive?: boolean;
      integer?: boolean;
    }>
  | Readonly<{ kind: "enum"; values: readonly string[] }>;

export type GammaContextReferenceMetadata = Readonly<{
  reference: GammaContextReference;
  itemKind: ContextItemKind;
  sourceField: string | null;
  scalarType: GammaScalarType;
  nullable: boolean;
  domain: GammaValueDomain;
}>;

const stringDomain = Object.freeze({ kind: "string" } as const);
const booleanDomain = Object.freeze({ kind: "boolean" } as const);
const weekdayDomain = Object.freeze({
  kind: "number",
  minimum: 0,
  minimumInclusive: true,
  maximum: 6,
  maximumInclusive: true,
  integer: true,
} as const);
// Existing context.ts uses finiteBetween(hour, 0, 24, false), so zero is currently rejected.
const hourDomain = Object.freeze({
  kind: "number",
  minimum: 0,
  minimumInclusive: false,
  maximum: 24,
  maximumInclusive: false,
} as const);
const positiveNumberDomain = Object.freeze({
  kind: "number",
  minimum: 0,
  minimumInclusive: false,
} as const);
const nonnegativeIntegerDomain = Object.freeze({
  kind: "number",
  minimum: 0,
  minimumInclusive: true,
  integer: true,
} as const);
const nonnegativeIntegerSecondsDomain = Object.freeze({
  kind: "number",
  minimum: 0,
  minimumInclusive: true,
  integer: true,
} as const);
const networkDomain = Object.freeze({ kind: "enum", values: CANONICAL_NETWORK_CLASSES } as const);
const canonicalActionClasses = [
  "read",
  "write",
  "export",
  "admin",
] as const satisfies readonly ActionClass[];
const actionDomain = Object.freeze({ kind: "enum", values: canonicalActionClasses } as const);

/** Closed, compile-time checked Γ scalar-field registry. `classes` is intentionally excluded. */
export const GAMMA_CONTEXT_REFERENCES = {
  "environmental.time.weekday": {
    reference: "environmental.time.weekday",
    itemKind: "time",
    sourceField: "weekday",
    scalarType: "Weekday",
    nullable: false,
    domain: weekdayDomain,
  },
  "environmental.time.hour": {
    reference: "environmental.time.hour",
    itemKind: "time",
    sourceField: "hour",
    scalarType: "Hour",
    nullable: false,
    domain: hourDomain,
  },
  "environmental.time.timezone": {
    reference: "environmental.time.timezone",
    itemKind: "time",
    sourceField: "timezone",
    scalarType: "string",
    nullable: false,
    domain: stringDomain,
  },
  "environmental.location.country": {
    reference: "environmental.location.country",
    itemKind: "location",
    sourceField: "country",
    scalarType: "string",
    nullable: false,
    domain: stringDomain,
  },
  "environmental.location.region": {
    reference: "environmental.location.region",
    itemKind: "location",
    sourceField: "region",
    scalarType: "string",
    nullable: false,
    domain: stringDomain,
  },
  "environmental.network.class": {
    reference: "environmental.network.class",
    itemKind: "network",
    sourceField: null,
    scalarType: "networkClass",
    nullable: false,
    domain: networkDomain,
  },
  "environmental.device.registered": {
    reference: "environmental.device.registered",
    itemKind: "device",
    sourceField: "registered",
    scalarType: "boolean",
    nullable: false,
    domain: booleanDomain,
  },
  "environmental.device.deviceId": {
    reference: "environmental.device.deviceId",
    itemKind: "device",
    sourceField: "deviceId",
    scalarType: "string",
    nullable: true,
    domain: stringDomain,
  },
  "environmental.device.tokenAgeSeconds": {
    reference: "environmental.device.tokenAgeSeconds",
    itemKind: "device",
    sourceField: "tokenAgeSeconds",
    scalarType: "Seconds",
    nullable: false,
    domain: nonnegativeIntegerSecondsDomain,
  },
  "behavioral.session.method": {
    reference: "behavioral.session.method",
    itemKind: "session",
    sourceField: "method",
    scalarType: "string",
    nullable: false,
    domain: stringDomain,
  },
  "behavioral.session.ageSeconds": {
    reference: "behavioral.session.ageSeconds",
    itemKind: "session",
    sourceField: "ageSeconds",
    scalarType: "Seconds",
    nullable: false,
    domain: nonnegativeIntegerSecondsDomain,
  },
  "behavioral.frequency.count": {
    reference: "behavioral.frequency.count",
    itemKind: "frequency",
    sourceField: "count",
    scalarType: "Count",
    nullable: false,
    domain: nonnegativeIntegerDomain,
  },
  "behavioral.frequency.windowSeconds": {
    reference: "behavioral.frequency.windowSeconds",
    itemKind: "frequency",
    sourceField: "windowSeconds",
    scalarType: "Seconds",
    nullable: false,
    domain: positiveNumberDomain,
  },
  "behavioral.history.windowDays": {
    reference: "behavioral.history.windowDays",
    itemKind: "history",
    sourceField: "windowDays",
    scalarType: "Days",
    nullable: false,
    domain: positiveNumberDomain,
  },
  "behavioral.history.enrollmentComplete": {
    reference: "behavioral.history.enrollmentComplete",
    itemKind: "history",
    sourceField: "enrollmentComplete",
    scalarType: "boolean",
    nullable: false,
    domain: booleanDomain,
  },
  "behavioral.navigation.previousClass": {
    reference: "behavioral.navigation.previousClass",
    itemKind: "navigation",
    sourceField: "previousClass",
    scalarType: "string",
    nullable: true,
    domain: stringDomain,
  },
  "behavioral.navigation.currentClass": {
    reference: "behavioral.navigation.currentClass",
    itemKind: "navigation",
    sourceField: "currentClass",
    scalarType: "string",
    nullable: false,
    domain: stringDomain,
  },
  "behavioral.navigation.transitionCount": {
    reference: "behavioral.navigation.transitionCount",
    itemKind: "navigation",
    sourceField: "transitionCount",
    scalarType: "Count",
    nullable: false,
    domain: nonnegativeIntegerDomain,
  },
  "behavioral.navigation.enrollmentComplete": {
    reference: "behavioral.navigation.enrollmentComplete",
    itemKind: "navigation",
    sourceField: "enrollmentComplete",
    scalarType: "boolean",
    nullable: false,
    domain: booleanDomain,
  },
  "behavioral.request.resourceClass": {
    reference: "behavioral.request.resourceClass",
    itemKind: "request",
    sourceField: "resourceClass",
    scalarType: "string",
    nullable: false,
    domain: stringDomain,
  },
  "behavioral.request.actionClass": {
    reference: "behavioral.request.actionClass",
    itemKind: "request",
    sourceField: "actionClass",
    scalarType: "actionClass",
    nullable: false,
    domain: actionDomain,
  },
} as const satisfies Record<GammaContextReference, GammaContextReferenceMetadata>;

export const GAMMA_CONTEXT_REFERENCE_IDS = Object.freeze(
  Object.keys(GAMMA_CONTEXT_REFERENCES) as GammaContextReference[],
);

/** Lookup accepts only the closed identifier union at compile time and returns undefined for untrusted runtime strings. */
export function getGammaContextReference(
  reference: string,
): GammaContextReferenceMetadata | undefined {
  return Object.hasOwn(GAMMA_CONTEXT_REFERENCES, reference)
    ? GAMMA_CONTEXT_REFERENCES[reference as GammaContextReference]
    : undefined;
}

// Type-level links make removed/renamed source fields fail compilation.
type SourceField<K extends ContextItemKind> = K extends "network"
  ? null
  : keyof ContextValueMap[K] & string;
type _RegistrySourceFieldsAreValid = {
  [
    R in GammaContextReference
  ]: (typeof GAMMA_CONTEXT_REFERENCES)[R]["sourceField"] extends SourceField<
    (typeof GAMMA_CONTEXT_REFERENCES)[R]["itemKind"]
  >
    ? true
    : never;
};
const _sourceFieldTypeCheck: _RegistrySourceFieldsAreValid | undefined = undefined;
void _sourceFieldTypeCheck;

type ScalarFieldKeys<K extends ContextItemKind> = K extends "network"
  ? null
  : {
      [F in keyof ContextValueMap[K]]: ContextValueMap[K][F] extends
        string | number | boolean | null
        ? F
        : never;
    }[keyof ContextValueMap[K]] &
      string;
type RegisteredFields<K extends ContextItemKind> = {
  [R in GammaContextReference]: (typeof GAMMA_CONTEXT_REFERENCES)[R]["itemKind"] extends K
    ? (typeof GAMMA_CONTEXT_REFERENCES)[R]["sourceField"]
    : never;
}[GammaContextReference];
type SameSet<A, B> = [Exclude<A, B>, Exclude<B, A>] extends [never, never] ? true : never;
type _ScalarRegistryIsExhaustive = {
  [K in ContextItemKind]: SameSet<RegisteredFields<K>, ScalarFieldKeys<K>>;
};
const _exhaustiveRegistryTypeCheck: _ScalarRegistryIsExhaustive | undefined = undefined;
void _exhaustiveRegistryTypeCheck;
type _ActionVocabularyIsExhaustive = SameSet<ActionClass, (typeof canonicalActionClasses)[number]>;
const _actionVocabularyTypeCheck: _ActionVocabularyIsExhaustive | undefined = undefined;
void _actionVocabularyTypeCheck;
