# MCAC Phase 2.1 Report

**Status:** instrumentation and gating changes implemented and validated by tests/build. No second pilot or full test-seed experiment was run.

## Implemented

- Added an explicit local PEP→PDP timing wrapper with monotonic start/end timestamps and a separate core-evaluator diagnostic.
- Timed local request preparation, in-memory context/PIP lookup (where required), evaluator execution, and pre-response in-memory trace append/hash-chain update. Post-response replay, metric calculation, reporting, serialization and artifact persistence remain outside.
- Added a clock-read-overhead diagnostic. It is reported, not subtracted. Timing uses `performance.now()` and two clock reads per request.
- Added approval gates for the six unresolved experimental decisions, exact protocol seed-set guards (calibration 1–5; test 101–130), and an approval-required throughput-bound helper.
- Created the unresolved decision register and updated experiment status documentation.

## Tested

Focused fixtures cover timing interval inclusions/exclusions, baseline context-collection bypass, timing percentiles, missing approvals, seed controls, and approval-gated throughput calculations. Existing experiment tests also cover baseline distinctions, scenario families, hand-checkable metrics, reference replay and Eq. (18) zero-reference behavior. These are selected regression tests, not exhaustive conformance evidence.

## Empirically measured

No Phase 2.1 timing or throughput measurements have been collected. The historical first pilot's core-evaluator latency is not a Section XVII PEP-to-PDP result. The corrected latency gate has not passed. No corrected p50/p95/p99 values are reported.

## Awaiting author approval

All six items in [the decision register](mcac-experiment-decision-register.md) remain unapproved: Γ scope/S9 semantics, S12 mimic-verification probability, calibration objective/search/constraints/tie-break, Appendix B population distributions, throughput p95 bound/load procedure, and Eq. (18) zero-denominator behavior. Separate formal questions remain in [mcac-author-decisions.md](mcac-author-decisions.md).

## Not yet validated

- The manuscript-defined latency gate under the corrected wrapper.
- Durable trace-store or real network/service PEP-to-PDP timing; current tracing and context lookup are in-memory harness operations.
- Throughput, CPU and memory overhead.
- Approved S9 behavior, S12 probability, calibration, and population-faithful generation.
- The second pilot itself, pending author approval and approved semantics being wired and tested.

## Validation outcomes

- `npm test -- --reporter=dot lib/mcac/experiment`: 4 files, 22 tests passed.
- `npm test -- --reporter=dot`: 8 files, 93 tests passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed with 0 errors and 2 pre-existing warnings in `scripts/research-evaluate.mts` (unused `Family`, unused `chain`). The pilot script warning was removed.
- `npm run build:webpack`: passed on Next.js 16.4.3 with webpack; production compilation, TypeScript and static page generation completed.

The full experiment over seeds 101–130 was not run. The corrected pilot was not run because the required author approvals remain absent. Live authorization routes and application records were not modified.
