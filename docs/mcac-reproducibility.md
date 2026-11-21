# MCAC Experiment Reproducibility

## Current reproducible run

The historical first-pilot command was:

```sh
bunx tsx scripts/run-mcac-pilot.mts
```

It writes to `research/experiments/pilot/`. Phase 2.1 added an early author-approval gate before directory creation or experiment work. The current configuration has no approval records, so this command now exits with an approval-required error. Do not execute it to simulate a pass. Existing checked-in artifacts are from the historical first pilot and contain its inputs, decisions, traces, core-only latency samples, environment details and report. They are retained as historical evidence.

The protocol seed sets are calibration 1–5 and test 101–130; guards require those exact ordered sets and prevent overlap. A generated request records its scenario seed. Degradation records the derived seed (`scenario seed XOR 0x5eed`), rate, item and operation. Step-up random values are derived from request ID and seed and paired across systems. Family labels do not depend on policy decisions. S12's current fixture probability is not approved and cannot be used for an experiment.

## Environment and timing

The pilot records OS/kernel, CPU model, cores, host memory and Node version. The recorded host was Apple M4, 10 cores, macOS 27.2.0, arm64, Node v24.11.0, 16 GiB. The working tree was uncommitted, so no build commit identifier was available. TypeScript version is declared in the project package metadata.

Phase 2.1 instruments the local harness PEP→PDP call using `performance.now()`. Start is immediately before local PDP request preparation/dispatch; end is after the decision response returns. Included: request preparation in the local adapter, in-memory context/PIP lookup when required, evaluation, and in-memory trace append/hash-chain update before response. Excluded: scenario/policy setup, post-return reference replay and metrics, result reporting, serialization and durable artifact writes. Core evaluator time is a separate diagnostic. Each latency sample reads the monotonic clock twice; clock-read overhead is reported separately and not subtracted. Warmup, repetition counts follow the manuscript for the planned full measurement (2,000 warmups, 20,000 measured requests/system/configuration, 10 runs); the phase-2.1 wrapper itself has not been run on a pilot, so no corrected latency percentile or gate result exists. In-memory trace append does not measure durable storage. Throughput, CPU and memory overhead are unmeasured.

## Statistical reproducibility

`lib/mcac/experiment/statistics.ts` uses an explicit seed for bootstrap resampling. The percentile interval uses linear interpolation of the empirical 2.5th and 97.5th percentiles. Paired comparisons resample matched seed pairs. Wilcoxon signed-rank uses a two-sided normal approximation with tie correction and continuity correction; Holm adjusts p-values across the provided comparison family. Rank-biserial effect sizes receive paired-bootstrap percentile intervals. The helpers are deterministic for fixed inputs/seeds; no full-run statistical results exist.

## Configuration status

`research/experiments/pilot/policy-config-provisional.json` is explicitly provisional. It is not a frozen policy and must not be used to label a test run as preregistered. Required approvals are recorded in [the decision register](mcac-experiment-decision-register.md): S9 Γ scope/contradiction semantics, S12 mimic probability, calibration objective/search/constraints/tie-break, Appendix B population distributions, throughput p95 bound/load procedure, and Eq. (18) zero denominator. Additional formal-engine questions remain in `docs/mcac-author-decisions.md`.

## Isolation and data safety

The experiment package imports the pure MCAC domain evaluator and independent reference evaluator. No live authorization route was changed or connected. Pilot artifacts are newly written research outputs. The script does not initialize the application database, mutate application records, or reset data.
