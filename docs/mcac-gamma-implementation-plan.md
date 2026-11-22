# MCAC Γ Implementation Plan

This plan implements the contract in [mcac-gamma-ast-spec.md](mcac-gamma-ast-spec.md). It is intentionally staged so the evaluator remains isolated until validation and integration behavior are reviewable. No milestone is complete merely because its code compiles; use the acceptance criteria below.

## Milestone 1 — Registry, AST types, and canonicalization

**Scope:** Add Γ-only TypeScript types and a closed reference registry derived from the existing context types. Add deterministic canonical JSON bytes and SHA-256 AST digest support with an explicit canonicalization version. Do not change `PolicyVersion` consumers yet.

**Tests:** Every reference resolves to exactly one field, context item kind, nominal type, nullability, and range; unknown references fail. Canonicalization vectors cover key ordering, preserved child-array order, escaping, finite number rendering, negative-zero normalization, and digest stability independent of object insertion order.

**Acceptance:** Registry matches §3 of the specification; canonicalization is deterministic across equivalent object-key orderings and changes when array order or semantic values change.

## Milestone 2 — Shared strict Γ validator

**Scope:** Implement one validator reusable by draft/readiness validation and the runtime integrity boundary. Validate exact shapes, operators, nominal compatibility, enums, numeric domain, declarations, IDs, switch state, and every complexity bound. Return structured policy errors; do not interpret invalid policies as request outcomes.

**Tests:** Positive and negative cases for every AST form; unknown/missing/extra fields; every operator/type pairing; nullable references; enum case/value errors; null/non-finite/heterogeneous set errors; child and collection bounds; duplicate IDs; item derivation exactness; at least two kinds; `crossCategoryConsistency=false`; exact inclusive/exclusive limits for depth, nodes, references, constraints, sets, string scalar count, and canonical UTF-8 aggregate bytes.

**Acceptance:** Readiness and runtime paths invoke the same validator implementation and agree on all fixtures. Boundary fixtures demonstrate exact stated maxima are accepted and maxima plus one rejected.

## Milestone 3 — Pure AST evaluator and node trace

**Scope:** Build a pure evaluator that receives a validated constraint and immutable classified context snapshot. It returns the Γ outcome, ordered per-node results, reference statuses, and stable indeterminate reasons. Do not mutate context or policy and do not connect outcomes to decisions yet.

**Tests:** Exhaustive Strong Kleene tables; each operator; exact string and enum equality; nominal numeric mismatch; negative zero; nullable compare/exists; each `V/M/S/U/X` state; malformed runtime values; full child evaluation order including decisive early children; nested expressions and maximum-size ASTs.

**Acceptance:** Evaluator emits the same result and trace for the same policy bytes, snapshot, and evaluator semantics version. All children are evaluated exactly once in serialized order. Existing `X` remains `X` and yields Γ `INDETERMINATE` when referenced.

## Milestone 4 — Constraint effect combination and condition propagation

**Scope:** Evaluate all constraints against one pre-effect snapshot. Combine per item with violation precedence, then indeterminate, then unchanged. Propagate effects into existing condition evaluation only when that condition depends on the item. Keep Γ out of severity and decision functions.

**Tests:** Two or more constraints sharing an item in every outcome combination; violation plus indeterminate precedence; unrelated conditions unaffected; unused constraint evaluated/traced without decision impact; baseline false denies before context/Γ; no scenario where Γ changes an otherwise denied baseline to allow; sensitivity/fail-open behavior continues through current condition severity.

**Acceptance:** Existing severity aggregation and decision mapping remain the sole decision path. Effects are order-independent because every constraint sees the same snapshot.

## Milestone 5 — Policy lifecycle and readiness integration

**Scope:** Add AST fields to the appropriate draft/immutable policy representation and policy hash. Integrate the shared validator into publication/readiness and runtime loading. Reject Γ-bearing policies when the feature switch is false. Keep draft invalidity separate from request authorization responses.

**Tests:** Readiness errors for each invalidity; valid complete Γ draft accepted for readiness; disabled Γ rejected; immutable snapshot hash includes AST semantics; runtime tampering or version mismatch is an integrity error; no fallback to legacy Boolean evidence or another policy version.

**Acceptance:** No Γ policy can be published/loaded unless it passes the shared validator and is bound to an immutable version. Existing non-Γ policies remain readable through the planned compatibility adapter.

## Milestone 6 — Versioned trace and secure replay inputs

**Scope:** Add versioned Γ trace records, deterministic node paths/order, per-constraint outcomes, effective item effects, policy/AST/evaluator version binding, and opaque references to separately protected replay inputs. Define migration/compatibility behavior for old trace records before changing stored trace shapes.

**Tests:** Trace schema validation; stable hash vectors; replay against retained exact policy and input snapshot; replay fails on missing/unauthorized/tampered input; ordinary audit row excludes raw replay context; sensitive fields are not copied into Γ-specific trace; integrity flags/source class are not treated as external authenticity proof.

**Acceptance:** Authorized replay reproduces each node and final outcome, while routine trace records contain only the specified statuses/reasons and protected-input reference. Retention, access audit, deletion, and key handling are documented before activation.

## Milestone 7 — End-to-end regression and staged enablement readiness

**Scope:** Update MCAC unit/integration fixtures and policy draft validation. Verify interactions with Θ, condition severity, waivers, aggregation, trace hashing, replay, and baseline RBAC. Do not activate or publish policies as part of this milestone without a separate authorized release action.

**Tests:** Full relevant MCAC suite; old non-Γ decisions have unchanged results and traces except for explicitly versioned trace format; Γ scenarios cover same-category and cross-category constraints, all outcomes, statuses, overlap, unused constraints, and disabled-policy rejection. Add deterministic property/table-driven tests for truth tables and validator boundaries.

**Acceptance:** Reviewers can trace each Γ result from immutable policy AST and context snapshot through node results, effects, dependent conditions, severity, and the existing decision function. No direct Γ-to-ALLOW/VERIFY/DENY path exists. Publication/activation remains gated until operational replay retention and compatibility are approved.

## Cross-milestone implementation safeguards

- Keep AST evaluation pure and side-effect-free.
- Preserve existing user changes and isolate changes to MCAC types, validators, evaluator, readiness path, trace/replay, and relevant tests.
- Do not modify the research PDF as an implementation shortcut; manuscript revision is a separate work item.
- Treat malformed policy as configuration failure at validation/load boundaries, never as a request-level Γ result.
- Do not claim source authenticity or benchmark outcomes that are not independently established.
