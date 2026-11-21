# MCAC Phase 2 Pilot Report

## Decision

**Historical pilot gate: FAIL.** The run recorded below timed only the core evaluator and failed the manuscript's PEP-to-PDP latency requirement. Its timing values are not Section XVII results. Phase 2.1 adds a boundary wrapper and automated approval gates, but the corrected measurement has not been executed. A second pilot and test-seed evaluation were not started in Phase 2.1.

## Run

- Pilot seed: `1` (also a calibration seed; no test seed used).
- Generated: 24 base requests (2 per family across S1–S12), plus 4,800 degradation-sweep requests (1,200 at each rate, including the ρ=0 control); all are persisted as raw inputs.
- Evaluated: 144 rows (24 paired requests × B1–B6).
- S9: 12 rows retained in raw artifacts, excluded from system metric summaries because the Table IX contradiction requires unresolved Γ semantics.
- Artifacts: [`research/experiments/pilot/`](../research/experiments/pilot/), including generator/policy configuration, seed manifest, raw inputs, decisions/traces, latency samples, environment record and run log.

## Technical checks

| Check | Result | Evidence |
|---|---|---|
| All scenario families generated | Pass | All 12 IDs present |
| B1–B6 distinguish predicted differences | Pass | B1/B2 differ on S2; B3/B5 on S6; B4/B5 on S3; B5/B6 on a VPN threshold boundary fixture |
| S7 baseline denial | Pass | All 6 systems DENY both generated requests |
| Independent intent assignment | Pass | Benign S2 with unknown network and violating S1 with normal device context generated; labels are assigned before evaluation |
| Step-up simulation | Pass | Benign pass, violating fail, S12 uses seeded probability; repeated per-request outcomes identical across systems and reruns |
| Degradation operator | Pass | Independently sampled per item; measured rates 0, 0.1050, 0.2083, 0.4073 for targets 0, 0.1, 0.2, 0.4 |
| Operation assignment | Pass | Missing/stale/unverifiable/contradictory counts recorded for every rate in pilot JSON |
| Hand-checkable metrics | Pass | FAR .5, FRR .5, CR .5, precision 1/3, recall .5, F1 .4, end-to-end FAR .5 |
| Independent replay | Pass | 96/96 traces matched the independent Eq. (19) evaluator |
| Trace completeness | Pass | 96/96 MCAC traces complete in this pilot |
| Latency sample collection | Pass | Evaluator invocation only; reference replay and persistence excluded; 2 warmups and 4 measured calls per system |
| Manuscript PEP-to-PDP latency boundary | **Fail** | No PEP/PDP adapter exists in the experiment harness, so the Section XVII interval is not verified |

These are historical first-pilot checks, not evidence of comparative effectiveness. The 24-request pilot is too small for inferential reporting. Historical descriptive metrics in `pilot-report.json` are not paper results. Context coverage is null because Eq. (18) has an undefined zero-reference denominator for baseline-short-circuit decisions. No values from that report should populate manuscript results tables.

## Gate blockers and failures

The latency-boundary check failed. The pilot is also blocked by these unresolved choices:

1. S9's expected Γ violation links device and region, both environmental items under Eq. (3); no unapproved same-category Γ semantics was invented.
2. The S12 mimic verification failure probability is absent from the manuscript. `0.5` was used only to exercise deterministic simulation and is not approved.
3. The calibration objective, parameter search domain and tie-breaking rule are absent. The pilot policy remains provisional; calibration and freezing did not occur.
4. Appendix B population distributions are unspecified, so the current small context generator is a harness fixture, not a manuscript-faithful population generator.
5. No numeric p95 throughput bound/load procedure is stated, so throughput is not measured.
6. Eq. (18) does not define a value for decisions with zero referenced items; context coverage is not reportable until settled.

The core-function latency samples are retained for reproducibility but are not Section XVII decision-latency results. They exclude the local PEP→PDP boundary work and must not be placed in the paper's latency table. Phase 2.1's `callLocalPdp` wrapper now covers the harness's local boundary, but its measured operation scope includes in-memory fixture lookup and in-memory trace append only. No corrected latency samples have been collected, and no latency gate pass is claimed.

Full test seeds `101–130`, 250 instances/family, bootstrapped aggregate metrics, paired comparisons and significance tests were not run. The second pilot is also not run pending explicit approval and wiring of all author-selected semantics. See [the experiment design](mcac-experiment-design.md), [decision register](mcac-experiment-decision-register.md), [author decisions](mcac-author-decisions.md), and [reproducibility notes](mcac-reproducibility.md).

## Phase 2.1 status

Implemented and unit-tested: explicit monotonic PEP→local-PDP boundary timestamps, separate core-evaluator timings, diagnostic clock-read overhead, required author-approval gate, exact calibration/test seed guards and an approval-gated throughput calculation helper. The boundary unit fixtures verify included preparation, context lookup, evaluator and in-memory trace append, and excluded caller setup/reporting.

Not empirically measured or validated: corrected latency percentiles, latency gate, durable trace persistence cost, network/service dispatch, throughput/load, CPU/memory overhead, manuscript population sampling, calibration, approved S9 semantics, S12 probability, or Eq. (18) convention. Author decisions remain open; see the register.
