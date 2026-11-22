# MCAC Implementation Map

## Manuscript and previous blocker

The previous Phase 1 docs marked every formal element blocked because the paper was thought absent. That blocker is resolved using the 17-page `complete_research_paper.pdf` at repository root. The exact recovered model is documented in [mcac-formal-specification.md](./mcac-formal-specification.md). This document keeps the earlier checkout findings about legacy authorization, SQLite, and the test runner while updating their status.

## Equation-to-code and tests

| Manuscript reference                | Implementation                                                                                                  | Executable tests                                                                                    | Status                                                                                             |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Eq. (1), baseline RBAC              | `lib/mcac/application-adapter.ts:evaluateMcacForApplication`; `lib/mcac/decision.ts:evaluateMcac` short circuit | `lib/mcac/mcac.test.ts` baseline non-bypass cases                                                   | Implemented/tested                                                                                 |
| Eqs. (3)–(4), Table VI              | `lib/mcac/types.ts:ContextValueMap`, separate environmental/behavioral records                                  | context tuple and validity cases                                                                    | Implemented/tested                                                                                 |
| Eq. (2), Γ application              | `lib/mcac/context.ts:classifyValidity`; `lib/mcac/interactions.ts:evaluateCrossCategoryConsistency`             | each V/S/M/U/X plus precedence, satisfied/violated/disabled Γ                                       | Implemented/tested; exact Γ predicate syntax remains external because manuscript leaves Γ abstract |
| Eq. (5), conditions                 | `lib/mcac/conditions.ts:evaluateCondition`, `compare`                                                           | T/F/I, missing/stale/unverifiable/contradictory, history/navigation examples, boundary              | Implemented/tested for paper examples; comparator grammar clarification pending                    |
| Eq. (7), condition severity         | `lib/mcac/conditions.ts:conditionSeverity`                                                                      | soft/hard × L/H × T/F/I × strict/fail-open                                                          | Implemented/tested                                                                                 |
| Eqs. (8)–(10), aggregation          | `lib/mcac/severity.ts:aggregateCategory`, `aggregateSeverity`                                                   | category-only and combined conditions, max/conflict behavior, empty maxima                          | Implemented/tested                                                                                 |
| Section IX-B interaction 1          | `lib/mcac/interactions.ts:resolveEnvironmentConditionedThreshold`                                               | applied/degraded/disabled/valid-network threshold lookup                                            | Implemented; no table-key fallback branch throws pending clarification                             |
| Section IX-B interaction 2          | `lib/mcac/interactions.ts:evaluateCrossCategoryConsistency`                                                     | independent toggle, violated item statuses X, unaffected items                                      | Implemented for explicit constraint results; paper’s label/example inconsistency documented        |
| Eq. (11), decisions                 | `lib/mcac/decision.ts:decide`                                                                                   | all ALLOW/VERIFY/DENY branches, sensitivity and ψ cases                                             | Implemented/tested                                                                                 |
| Eq. (12), waiver                    | `lib/mcac/decision.ts:isWaiverValid` and severity-one reduction                                                 | success, hard severity remains, wrong scope/assurance/duration/expiry                               | Implemented/tested; exact expiry endpoint clarification pending                                    |
| Algorithm 1, Propositions 1–3       | `lib/mcac/decision.ts:evaluateMcac`                                                                             | baseline property loop, determinism/order, high sensitivity degradation samples                     | Implemented and sampled-tested; tests do not prove propositions                                    |
| Appendix A, trace/hash              | `lib/mcac/trace.ts`; trace assembled in `decision.ts`                                                           | deterministic SHA-256, mutation detection, replay                                                   | Implemented/tested                                                                                 |
| immutable versioning                | `lib/mcac/policy-version.ts`; `lib/mcac/sqlite-store.ts`; additive SQLite tables in `lib/db.ts`                 | frozen snapshot, same-version mutation rejected, old version loaded, triggers and trace chain tests | Implemented/tested                                                                                 |
| Sec. XVII Eq. (19), replay fidelity | `lib/mcac/replay.ts:replayTrace` replays against exact archived version                                         | same decision/severity and hash checks                                                              | Partial: independent reference implementation and corpus-level RF metric absent                    |

## Domain layout

- `lib/mcac/types.ts`: explicit request, policy, two typed context categories, evidence metadata, outcomes, interactions and trace types.
- `lib/mcac/context.ts`: validity order and runtime evidence validation.
- `lib/mcac/conditions.ts`: three-valued condition evaluation and severity equation.
- `lib/mcac/interactions.ts`: two separate mechanisms with traceable results and independent policy switches.
- `lib/mcac/severity.ts`: score-free maxima.
- `lib/mcac/decision.ts`: RBAC-first Algorithm 1 implementation and deterministic result/trace.
- `lib/mcac/trace.ts`: canonical JSON and SHA-256 hash verification.
- `lib/mcac/replay.ts`: retained-item replay against supplied original policy snapshot.
- `lib/mcac/policy-version.ts`: deep immutable snapshots and version transition check.
- `lib/mcac/sqlite-store.ts`: application persistence boundary; imports SQLite, never imported by the core engine.
- `lib/mcac/application-adapter.ts`: maps the existing effective permission list to Eq. (1), and maps formal VERIFY to a generic `VERIFICATION_REQUIRED` enforcement instruction.

## Existing application interfaces and call sites

Legacy `evaluateAccess` remains active in:

1. `app/api/access/route.ts` — live resource authorization, persistence, incidents and audit effects.
2. `app/api/admin/scenarios/route.ts` — existing fixed-example Scenario Lab runner.

Other current legacy authorization behaviors include `lib/authorization.ts`, `app/api/access/step-up/route.ts`, the portal’s `STEP_UP_AUTH` flow, and mutable policy CRUD in `app/api/admin/policies/route.ts`. They were not rewired. The existing flat policy schema has `ALLOW/DENY/STEP_UP_AUTH` effects and Boolean conditions; it cannot be losslessly translated into the paper’s conjunctive condition severities and `ALLOW/VERIFY/DENY` function. Current context collection also lacks reliable device, network, history, navigation, and assurance evidence. The adapter therefore requires a complete typed MCAC policy/evidence input and does not pretend to convert old Boolean context into valid research evidence.

This is not a silent dual-engine deployment: only the legacy evaluator is called by production routes. The formal domain engine is tested and available through its dedicated adapter but is not yet invoked from either route.

## Additive storage and compatibility

`lib/db.ts` adds `mcac_policy_versions` and `mcac_decision_traces` using `CREATE TABLE IF NOT EXISTS`, plus update/delete prevention triggers. No existing table or row is changed. Policy snapshots are content-hashed and immutable; trace append is transactional and checks the previous hash head. Historical replay loads the exact archived version. The existing `policies` table and decision routes remain as before until a reviewed conversion is possible.

No destructive migration, reset, or database file mutation was performed by the tests; integration storage tests use a temporary SQLite file.

## Phase 1.1 independent audit update

The requirement-by-requirement audit is in [mcac-conformance-audit.md](./mcac-conformance-audit.md); author questions and alternatives are in [mcac-author-decisions.md](./mcac-author-decisions.md). `lib/mcac/reference/equation-19.ts:evaluateReference` independently evaluates the clearly defined core equations without importing production evaluator modules. It blocks on ambiguous comparator semantics and a valid network class absent from Θ. The differential tests compare both implementations for selected defined cases, but do not establish exhaustive conformance.

Persistence tests now cover mutation of a nested source policy after storage, changed trace content, wrong chain order/link, and delete guards for an intermediate and newest record. Database triggers guard deletion in this installation; a hash chain by itself cannot reveal removal of the latest tail without an externally anchored head.

Validation: Vitest 4 files / 71 tests passed; typecheck passed; lint had zero errors and two existing warnings; webpack build passed. Default Turbopack build failed on local port binding (`Operation not permitted`) in the CSS loader, also on retry outside the sandbox. Full outcomes appear in [mcac-phase-1-report.md](./mcac-phase-1-report.md).

## Runner baseline

The earlier attempt used `bun test`, which dispatches Bun’s compatibility runner and fails to provide `vi.hoisted`. The repository’s configured test script is `npm test` → `vitest run`; it executes the integration suite successfully. Baseline before engine changes: **31 tests passed** under `npm test -- --reporter=dot`. Current coverage is recorded in [mcac-test-coverage.md](./mcac-test-coverage.md).
