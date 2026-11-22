# MCAC Γ Restricted AST Specification

**Status:** Approved semantic and implementation contract. This document specifies future behavior; it does not implement an evaluator or alter the current policy contract, authorization route, schema, or research paper.

## 1. Scope and invariants

Γ is a restricted, declarative, typed AST over the closed scalar context registry in §3. It supports same-category and cross-category relationships. It never parses or executes arbitrary code. The only node families are `all`, `any`, `not`, `compare`, and `exists`; the only comparison operators are `eq`, `neq`, `lt`, `lte`, `gt`, `gte`, and `in`.

Each valid constraint has an ID, declared participating context item kinds, and one root expression. The complete expression must reference at least two distinct context item kinds. The AST-derived item-kind set must equal the declared set. Γ outcomes are `SATISFIED`, `VIOLATED`, and `INDETERMINATE`, derived by the evaluator from an immutable policy and one validated request-context snapshot. Γ never grants access, bypasses baseline RBAC, or directly produces `ALLOW`, `VERIFY`, or `DENY`.

## 2. Exact AST contract

All object shapes are strict: reject unknown or missing fields and wrong JSON types. These are the exact node forms (fields may appear in any JSON object order; arrays retain their serialized order):

```text
Constraint ::= { "id": NonEmptyString, "items": [ContextItemKind, ...], "expression": Expression }
Expression ::= All | Any | Not | Compare | Exists
All       ::= { "kind": "all", "children": [Expression, ...] }
Any       ::= { "kind": "any", "children": [Expression, ...] }
Not       ::= { "kind": "not", "child": Expression }
Compare   ::= { "kind": "compare", "operator": Operator,
                "left": ContextReference, "right": Operand }
Exists    ::= { "kind": "exists", "reference": ContextReference }
Operand   ::= { "kind": "reference", "reference": ContextReference }
          |  { "kind": "literal", "value": ScalarLiteral }
          |  { "kind": "set", "valueType": ScalarType, "values": [ScalarLiteral, ...] }
ScalarLiteral ::= { "type": ScalarType, "value": string | finite-number | boolean }
ScalarType ::= "string" | "boolean" | "Hour" | "Weekday" | "Seconds" | "Days" | "Count" | "networkClass" | "actionClass"
Operator ::= "eq" | "neq" | "lt" | "lte" | "gt" | "gte" | "in"
```

`all` and `any` require 1–8 children. `not` has exactly one child. `compare.left` is a canonical reference. `in` requires a nonempty set operand; all other operators require a reference or literal operand. `eq`/`neq` allow all identical nominal types. Ordering operators accept only matching numeric nominal types. `in` requires the set value type and every element type to exactly match the left reference. No null literal exists. Unknown references/operators, malformed nodes, invalid enums, heterogeneous sets, incompatible types, non-finite numbers, duplicate constraint IDs, and any limit violation invalidate the policy.

## 3. Closed context reference and nominal type registry

The registry derives only from `ContextValueMap` and `validateContextEvidence` in `lib/mcac/types.ts` and `lib/mcac/context.ts`. `history.classes` is not addressable: it is an array and the AST has no lookup/iteration node.

| Canonical reference                        | Item kind    | Type           | Valid domain / nullable                                                             |
| ------------------------------------------ | ------------ | -------------- | ----------------------------------------------------------------------------------- |
| `environmental.time.weekday`               | `time`       | `Weekday`      | Integer 0–6, Monday=0 through Sunday=6, per existing validator convention; non-null |
| `environmental.time.hour`                  | `time`       | `Hour`         | Finite number, `0 <= x < 24`; fractional permitted; non-null                        |
| `environmental.time.timezone`              | `time`       | `string`       | Any string accepted by existing validator; non-null                                 |
| `environmental.location.country`           | `location`   | `string`       | Any string accepted by existing validator; non-null                                 |
| `environmental.location.region`            | `location`   | `string`       | Any string accepted by existing validator; non-null                                 |
| `environmental.network.class`              | `network`    | `networkClass` | `corporate`, `vpn`, `known`, `unknown`; non-null                                    |
| `environmental.device.registered`          | `device`     | `boolean`      | Non-null                                                                            |
| `environmental.device.deviceId`            | `device`     | `string`       | Nullable                                                                            |
| `environmental.device.tokenAgeSeconds`     | `device`     | `Seconds`      | Finite, non-negative integer per existing validator; non-null                       |
| `behavioral.session.method`                | `session`    | `string`       | Any string accepted by existing validator; non-null                                 |
| `behavioral.session.ageSeconds`            | `session`    | `Seconds`      | Finite, non-negative integer per existing validator; non-null                       |
| `behavioral.frequency.count`               | `frequency`  | `Count`        | Non-negative integer; non-null                                                      |
| `behavioral.frequency.windowSeconds`       | `frequency`  | `Seconds`      | Finite, strictly positive; fractional permitted; non-null                           |
| `behavioral.history.windowDays`            | `history`    | `Days`         | Finite, strictly positive; fractional permitted; non-null                           |
| `behavioral.history.enrollmentComplete`    | `history`    | `boolean`      | Non-null                                                                            |
| `behavioral.navigation.previousClass`      | `navigation` | `string`       | Nullable                                                                            |
| `behavioral.navigation.currentClass`       | `navigation` | `string`       | Any string accepted by existing validator; non-null                                 |
| `behavioral.navigation.transitionCount`    | `navigation` | `Count`        | Non-negative integer; non-null                                                      |
| `behavioral.navigation.enrollmentComplete` | `navigation` | `boolean`      | Non-null                                                                            |
| `behavioral.request.resourceClass`         | `request`    | `string`       | Any string accepted by existing validator; non-null                                 |
| `behavioral.request.actionClass`           | `request`    | `actionClass`  | `read`, `write`, `export`, `admin`; non-null                                        |

Nominal types prohibit comparisons across units/domains even when represented as TypeScript `number`: `Hour`, `Weekday`, `Seconds`, `Days`, and `Count` compare only to the same nominal type. Existing validation is authoritative for each field's accepted numeric range and integer constraint. All numeric literals must be finite. Negative zero is equal to positive zero under numeric equality and membership; ordered comparisons use ordinary finite-number order. No unit conversion occurs.

Strings compare exactly by Unicode scalar sequence: case-sensitive, no Unicode normalization, locale collation, or whitespace normalization. String length is measured in Unicode scalar values. Enum literal spelling and case must match the exact closed vocabulary above; an enum literal cannot be typed as generic `string` to bypass validation.

## 4. Evaluation semantics

Every AST child is evaluated once, in serialized array order, without short-circuiting. Evaluation has no side effects. `all` and `any` use Strong Kleene logic:

| AND | T   | F   | I   |
| --- | --- | --- | --- |
| T   | T   | F   | I   |
| F   | F   | F   | F   |
| I   | I   | F   | I   |

| OR  | T   | F   | I   |
| --- | --- | --- | --- |
| T   | T   | T   | T   |
| F   | T   | F   | I   |
| I   | T   | I   | I   |

`not(T)=F`, `not(F)=T`, `not(I)=I`. Expression truth maps `T→SATISFIED`, `F→VIOLATED`, `I→INDETERMINATE`.

Each constraint is evaluated against the same immutable context snapshot, before any Γ effect is applied. A reference reads its scalar field only when its item status is `V`. Statuses `M`, `S`, `U`, and `X` each yield `INDETERMINATE`; in particular, Γ does not erase or reinterpret an existing `X`. A `V` nullable field whose value is null yields `INDETERMINATE` for comparisons. For `exists`, a valid, non-null field is `T`; a valid nullable field equal to null is `F`; an invalid-status item yields `I`. A `V` item with an invalid field shape is a context-integrity error, not a truth value. Non-nullable fields cannot validly be null.

For valid, available values, `eq`/`neq` use exact typed scalar equality, ordered operators use finite numeric order, and `in` tests exact typed scalar membership. No coercion or structural equality applies.

Stable indeterminate reasons are `MISSING_ITEM` (`M`), `STALE_ITEM` (`S`), `UNVERIFIABLE_ITEM` (`U`), `CONTRADICTORY_ITEM` (`X`), `NULL_FIELD`, and `CONTEXT_INTEGRITY_ERROR` (integrity failure, not an ordinary `I`). For a reference used multiple times, each node records its own outcome; trace reference status is deduplicated by canonical reference.

## 5. Constraint effects and authorization

Constraint outcomes are combined per context item kind using this precedence: if any constraint that declares that item is `VIOLATED`, that item has a Γ contradiction effect; otherwise, if any is `INDETERMINATE`, it has an indeterminate effect; otherwise it has no Γ effect. Preserve every individual constraint outcome in trace. A violated effect feeds the existing contradiction/`X` path subject to existing validity precedence. An indeterminate effect makes dependent authorization conditions evaluate as `I` without changing the original status, including retaining `X`. If both effects exist, violation takes precedence for that item.

Effects are relevant only to conditions that depend on the affected item. A constraint with no applicable dependent authorization condition is still fully evaluated and traced, but cannot change authorization independently. Satisfied constraints have no effect. The existing condition severity, category aggregation, and decision mapping remain the only path from context findings to a decision. A failed baseline RBAC check returns `DENY` before context/Γ evaluation; Γ cannot grant or bypass that result.

When `crossCategoryConsistency` is false, any policy with one or more Γ constraints is invalid. Do not skip evaluation or auto-enable the switch. Invalid policy/configuration is rejected during publication/readiness validation and runtime integrity validation, never converted to request-level `FALSE` or `INDETERMINATE`.

## 6. Complexity bounds

Apply these exact bounds in both future schema/readiness validation and runtime integrity validation:

| Measure                              | Bound and accounting                                  |
| ------------------------------------ | ----------------------------------------------------- |
| AST depth                            | 5; root is depth 1                                    |
| Nodes per constraint                 | 32; every logical and leaf node counts                |
| Distinct references per constraint   | 8; unique canonical field references, not occurrences |
| Constraints per policy               | 16                                                    |
| `all`/`any` children                 | 1–8                                                   |
| `in` values                          | 1–16                                                  |
| String literal length                | 128 Unicode scalar values                             |
| Serialized AST collection per policy | 65,536 UTF-8 bytes                                    |

Aggregate bytes are measured from deterministic canonical serialization defined in §8, including all AST object field names, values, delimiters, and each constraint's `id`, `items`, and `expression`; no whitespace is emitted. If an implementation cannot enforce these exact limits on the chosen serialization/runtime, it must stop and document the concrete incompatibility before changing the limit.

## 7. Policy validation and runtime integrity

Publication/readiness validation must check strict shape, discriminator/field allowlists, closed references and operators, exact operand types, enum values, finite numeric values, nullable behavior, literal/set constraints, unique IDs, exact declared-item derivation, minimum two distinct kinds, enabled Γ switch, and every §6 bound. It must reject malformed policy before publication; a schema or draft validator must not report such a policy as request-level false/indeterminate.

The evaluator must repeat integrity checks after loading the selected immutable policy version. It must bind the exact policy version and canonical bytes/digest; a mismatch is an integrity/configuration failure and must not fall back to caller-provided Boolean `ConsistencyEvidence`, another version, or a legacy policy. Publication and runtime validators must share the same registry, bounds, and accounting definitions to avoid acceptance drift.

## 8. Canonical serialization and trace/replay

Canonical AST bytes are UTF-8 encoding of a deterministic JSON representation: object keys sorted lexicographically by Unicode code-point sequence (not UTF-16 code-unit order); array order preserved; strings use ECMAScript JSON string escaping; numbers must be finite and use ECMAScript `JSON.stringify` number serialization (the JavaScript `Number` shortest round-trip decimal representation), with `-0` normalized to `0`; no insignificant whitespace; booleans/null use JSON tokens. This is the `mcac-gamma-c14n-v1` algorithm and does not claim RFC 8785/JCS conformance. Canonicalization is versioned and has fixed conformance vectors. Ordinary object insertion order is not a canonical hash representation. SHA-256 over the exact UTF-8 bytes is the AST digest; the digest result identifies the canonicalization version. The immutable policy version separately binds the complete policy snapshot.

Versioned Γ trace records must include: trace schema version; constraint ID; immutable policy version; AST digest; evaluator semantics version; deterministic node identity/path and serialized child evaluation order; each node's outcome; constraint outcome; sorted distinct canonical references with their item validity statuses; stable indeterminate reason codes; declared item kinds; and effective per-item violated/indeterminate effect after combination. Records must not claim source-class or integrity flags prove external source authenticity.

A digest does not contain the inputs needed to replay. Reproduction requires the exact immutable policy snapshot plus context values and statuses as observed at evaluation, request time, and the evaluator semantics version. Retain replay inputs in a separately access-controlled, encrypted store with bounded retention and an opaque reference in ordinary audit records; avoid duplicating sensitive raw context in Γ trace records. Access must be audited and restricted to authorized replay purposes. Define retention/deletion and key management before enabling replay storage.

The current `McacTrace` stores Boolean `consistencyEvidence` and raw context items; it has no Γ AST digest, node results, or Γ semantics version. The existing `canonicalJson`/trace hash helper is not by itself this Γ canonicalization contract. Add a versioned trace migration/compatibility design before implementation.

## 9. Existing implementation changes required

The current implementation is not a Γ AST evaluator. `DeclaredConsistencyConstraint` in `lib/mcac/types.ts` contains only `{id, items}`; `ConsistencyEvidence` accepts caller-supplied `{id, violated}`. `evaluateCrossCategoryConsistency` in `lib/mcac/interactions.ts` consumes that Boolean and returns `DISABLED` for disabled Γ. `classifyContext` and `evaluateCondition` do not support Γ-indeterminate effects. `evaluateMcac` validates legacy evidence and applies its interaction after baseline. The policy draft readiness route still blocks Γ policies. Existing context validation currently establishes the field ranges and nullability noted in §3.

Implementation must introduce the AST contract and shared validator, replace Boolean evidence as the Γ outcome source, evaluate Γ only after baseline authorization and context snapshot validation, combine effects without cascading constraints, propagate effects only to dependent conditions, preserve individual traces, and keep the existing severity/decision path. Update policy readiness validation and trace/replay support. Update relevant MCAC tests. No application behavior is changed by this document.

## 10. Implementation Readiness

### Approved semantics

Γ supports same- and cross-category relationships; it is a non-executable typed AST with five node families and seven operators. No coercion. Three outcomes and Strong Kleene logic apply. Constraints need at least two distinct context item kinds overall. Numeric fields use the nominal types in §3. All children execute in serialized order. Every constraint reads the same immutable snapshot. Multiple effects combine with violated precedence, then indeterminate, then no effect. Unused constraints are traced but do not affect authorization. Γ-disabled policies containing Γ are invalid. Existing `X` produces indeterminate when referenced and remains `X`. Γ never grants access or bypasses baseline RBAC.

### Exact AST and type contract

Use the strict grammar in §2, canonical references and field domains in §3, and exact scalar semantics in §4. Enforce all limits and accounting rules in §6. No new context fields are authorized by this registry.

### Validation requirements

Run complete publication/readiness validation and runtime integrity validation as in §7. Both reject unknown properties, malformed shapes, unknown references/operators, invalid enums, incompatible nominal types, non-finite numbers, null literals, heterogeneous/empty/oversized sets, empty logical nodes, ID duplicates, declared/reference mismatch, insufficient item kinds, disabled Γ, and all complexity-limit violations.

### Runtime evaluation requirements

Validate and freeze one request snapshot, evaluate each constraint without short circuit and without shared mutations, combine outcomes per item, feed violation/indeterminate effects only to dependent context conditions, preserve existing validity precedence and severity aggregation, evaluate/trace unused constraints, and retain baseline RBAC denial precedence. Never create a direct Γ decision path.

### Trace/replay requirements

Use a versioned trace with all fields in §8, pin immutable policy and evaluator versions, identify every node deterministically, and retain replay inputs securely by reference. Do not duplicate sensitive raw inputs in routine Γ audit records or claim external authenticity from existing tuple flags.

### Existing implementation changes required

Replace legacy Boolean Γ evidence with AST-derived results; add a shared schema/runtime validator and nominal registry; implement evaluator and deterministic node trace; add effect combination and condition propagation; reject disabled Γ policies at readiness and runtime; version trace/replay storage; update readiness route validation and tests. Keep Θ and existing non-Γ condition semantics unchanged unless separately specified.

### Remaining blockers

No Γ semantic blockers remain. Engineering prerequisites remain: define storage/API compatibility for AST-bearing immutable policy snapshots and a versioned trace/replay-input retention mechanism. These are implementation design tasks, not unresolved Γ truth semantics. The current evaluator, routes, schemas, and policy lifecycle are not ready to execute Γ until those milestones are completed and reviewed. The research PDF remains unmodified; manuscript alignment updates are separate work.
