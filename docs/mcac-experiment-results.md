# MCAC Experimental Results

## Status: no full results

No second pilot or test-seed experiment has run. The historical first pilot failed the latency-boundary gate; Phase 2.1 repaired the instrumentation but has not executed it. Unresolved manuscript semantics and parameters remain. This document therefore contains no baseline ranking, hypothesis result, statistical significance claim, or paper-ready empirical figure.

The historical pilot used seed `1`, 2 requests per family (24 requests total) and paired all six evaluators (144 evaluator rows). Its core-only timing failed to implement Section XVII's PEP-to-PDP measurement. No pilot metrics are copied into the results table below. Historical artifacts under [`research/experiments/pilot/`](../research/experiments/pilot/) are retained for audit and must not be presented as research findings.

## Table XI placeholder

| System | FAR | FRR | CR | Precision | F1 | End-to-end FAR | p50 / p95 / p99 (ms) | Replay fidelity |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| B1 | Pending | Pending | Pending | Pending | Pending | Pending | Pending | n/a |
| B2 | Pending | Pending | Pending | Pending | Pending | Pending | Pending | n/a |
| B3 | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| B4 | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| B5 | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |
| B6 | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending |

Context coverage, corrected Section XVII PEP-to-PDP latency, CPU/memory overhead and throughput remain unreported. The new timing wrapper is unit-tested, but corrected p50/p95/p99 have not been empirically measured and the latency gate has not passed. Context coverage has an unresolved zero-denominator case; throughput lacks an approved p95 bound/load procedure. Degradation results must be stratified by resource sensitivity in a future authorized run.

## Required analysis after the gate opens

Run calibration seeds 1–5, freeze policy and generator configuration, then run test seeds 101–130 with 250 requests per family. Report per-seed metrics, means and 95% percentile bootstrap intervals, paired bootstrap intervals for differences, Wilcoxon signed-rank tests with Holm correction and effect sizes with intervals. Report H/L sensitivity strata, degradation curves, all per-family results, latency percentiles over the planned repeated runs, and every B5 false accept. The statistical helpers are implemented in `lib/mcac/experiment/statistics.ts`; they have unit coverage but have not been applied to test-seed data.

No paper-ready figure or significance result is generated. Figures and paper tables remain pending until decisions are approved, the corrected pilot passes, configuration is frozen, and authorized test-run data exist.
