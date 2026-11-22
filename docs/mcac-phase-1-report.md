# MCAC Phase 1 Report — Formal Authorization Engine

## Result

Implemented and tested a pure TypeScript MCAC domain engine from the supplied manuscript. The formal engine includes the two typed context categories, five validity states, T/F/I evaluation, score-free severity and max aggregation, the two separately switchable interactions, ALLOW/VERIFY/DENY, RBAC-first restriction, immutable policy snapshots, replayable SHA-256 chained traces, SQLite archival adapters, and a safe application boundary adapter.

The engine is **not activated in the existing authorization routes**. The current flat application policy effects/context cannot be translated losslessly into the paper model, and reliable providers are missing for several signals. Production routes continue to use the existing evaluator until an explicit policy/context conversion and verification workflow are reviewed.

## Manuscript inspected

- Input file: `complete_research_paper.pdf` at repository root, 17 pages. The requested `docs/research/MCAC-research-paper.pdf` path does not exist in this checkout; the supplied root-level manuscript was used.
- Read Sections VIII–XIII, equations (1)–(12), Table VI, Algorithm 1, Propositions 1–3, Appendix A and replay metric Eq. (19). Extracted mathematical symbols and table contents were legible in the PDF text extraction; no equation was filled from prior audit prose.
- The four genuine ambiguities and current safe boundaries are listed in `docs/mcac-formal-specification.md`.

## Files created

- `lib/mcac/types.ts`
- `lib/mcac/context.ts`
- `lib/mcac/conditions.ts`
- `lib/mcac/interactions.ts`
- `lib/mcac/severity.ts`
- `lib/mcac/decision.ts`
- `lib/mcac/trace.ts`
- `lib/mcac/replay.ts`
- `lib/mcac/policy-version.ts`
- `lib/mcac/sqlite-store.ts`
- `lib/mcac/application-adapter.ts`
- `lib/mcac/index.ts`
- `lib/mcac/mcac.test.ts`
- `lib/mcac/sqlite-store.test.ts`
- Updated all four requested `docs/mcac-*.md` reports/specifications.

## Files modified

- `lib/db.ts`: additive `mcac_policy_versions` and `mcac_decision_traces` tables with immutability triggers. Existing tables and records were not rewritten.

## Compatibility and persistence

- Preserved authentication, password hashing, sessions, users/roles/permissions, organization scope, portals, step-up route, policies, audit history, notifications, incidents and Scenario Lab.
- Existing `evaluateAccess` callers remain `app/api/access/route.ts` and `app/api/admin/scenarios/route.ts`.
- Added `evaluateMcacForApplication` as a safe adapter from the already-effective permission list to baseline Eq. (1). Formal VERIFY maps to a generic `VERIFICATION_REQUIRED` instruction; it does not silently rename it to the old password `STEP_UP_AUTH` outcome.
- Existing mutable legacy policy CRUD is not mapped to new policy versions. The separate version store rejects changed content under an existing version and preserves prior snapshots for replay.
- Schema addition is additive and runs through the existing `CREATE TABLE IF NOT EXISTS` initialization. No destructive migration or reset was performed. Persistence tests use a temporary database; no existing SQLite records were modified by this work.

## Validation results

| Command                                                      | Result                                                                                                                                                                                                 |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Baseline before implementation: `npm test -- --reporter=dot` | 2 files, 31 tests passed                                                                                                                                                                               |
| `npm test -- --reporter=dot`                                 | 4 files, 70 tests passed                                                                                                                                                                               |
| `npm run typecheck`                                          | Passed (`tsc --noEmit`)                                                                                                                                                                                |
| `npm run lint`                                               | 0 errors; 2 existing warnings in `scripts/research-evaluate.mts` (`Family`, `chain` unused)                                                                                                            |
| `npm run build`                                              | Turbopack panic in CSS loader: child process/port binding returns `Operation not permitted`; repeated outside sandbox with same outcome                                                                |
| `npm run build:webpack`                                      | Passed production build, TypeScript phase, static generation and route listing                                                                                                                         |
| `bun test`                                                   | Unsupported runner path: existing integration suite fails because Bun lacks `vi.hoisted`; Bun 1.2.17 then panics in the SQLite test worker. Use configured Vitest via `npm test`; no test was skipped. |

Next.js 16 Route Handler documentation was read before route-related implementation planning. The formal engine itself does not import Next.js, React, SQLite, HTTP, environment variables or an implicit clock. SQLite is isolated in `sqlite-store.ts`.

## Feature classification

1. **Implemented and tested:** baseline non-bypass; typed `Ce`/`Cb`; V/S/M/U/X; Eq. (5) three-valued conditions; Eq. (7) severity; Eqs. (8)–(11); core Algorithm 1; Proposition 1/2 sampled checks; high-sensitivity Proposition 3 sampled check; independent interaction switches; immutable policy snapshot/version storage; canonical SHA-256 trace chain; original-version replay through the production evaluator; adapter invocation without route replacement.
2. **Implemented but incompletely tested:** waiver scope/assurance/duration/expiry tests; cross-category Γ application from explicit outcomes; Proposition 3 finite samples (not proof); policy/provider source admissibility.
3. **Partially implemented:** valid network class with no `Θ` entry is rejected pending meaning; Γ predicates are supplied as explicit outcomes because the paper does not define their predicate language; complete comparator grammar is pending; replay currently uses the production evaluator rather than independent `Fref`; hard-condition provider-source registry is not present; live API routes are not yet adapted because context collection/policy translation is incomplete.
4. **Not implemented:** independent reference evaluator and corpus RF Eq. (19) metric; production context provider implementations for reliable device token, coarse-location database, session assurance, access-history enrollment and navigation graph as specified by the paper; integration of new policy snapshots with the existing admin policy editor; external anchoring of the latest hash-chain head. Hash chaining by itself cannot detect tail truncation, as the manuscript notes.
5. **Blocked by author clarification:** (a) whether Γ constraints must span Ce and Cb despite the device/network example; (b) fallback for valid network class absent from Θ; (c) exact expiry endpoint for Δv; (d) exhaustive comparator grammar for ⊕.

## Remaining limitations

The old application routes remain the only active authorization path. The new engine is independently callable through the adapter, but real requests need complete paper-shaped evidence and policy snapshots before route activation. The replay test establishes self-replay and version integrity, not independent replay fidelity. The property tests exercise finite/sample cases and do not prove mathematical propositions. The paper’s four author clarifications should be resolved before final integration and evaluation claims.

## Phase 1.1 audit and validation update

The source-by-source ledger is [mcac-conformance-audit.md](mcac-conformance-audit.md); the ambiguity analysis is [mcac-author-decisions.md](mcac-author-decisions.md). The older classification above is superseded where it says the independent evaluator is absent: `lib/mcac/reference/equation-19.ts` now independently evaluates the clearly specified portion of Eqs. (2), (5), and (7)–(11), without calling the production evaluator. Its differential tests are selected examples only, and a corpus-level Eq. (19) replay-fidelity value is not claimed.

All four ambiguities remain **AUTHOR DECISION REQUIRED**: whether Γ must cross categories, missing valid network class in Θ, exact waiver expiry instant, and exhaustive ⊕ grammar. The independent evaluator explicitly blocks on the latter two relevant semantic gaps rather than choosing a default.

Latest checks: `npm test -- --reporter=dot` passed (4 files, 71 tests); `npm run typecheck` passed; `npm run lint` had 0 errors and 2 existing unused-variable warnings in `scripts/research-evaluate.mts`; `npm run build:webpack` passed. Default `npm run build` failed because the Turbopack CSS loader could not bind a local port (`Operation not permitted`), and an outside-sandbox retry had the same error. No `vi.hoisted` issue occurred under configured Vitest. No tests were skipped or hidden.

Classification: (1) no theorem is claimed formally verified by executable evidence; (2) equations and invariants have implementation plus unit coverage for enumerated cases but are not independently/formally proven; (3) Γ predicate semantics, complete trace replay and reference coverage are partial; (4) the four author questions block final semantics; (5) production providers/integration, Eq. (18), corpus Eq. (19), and external chain-head anchoring are not implemented. Hash chaining alone cannot detect latest-tail removal. SQLite tests use a temporary database and confirm update/delete guards and ordering checks. Live authorization routes and existing records remain untouched.
