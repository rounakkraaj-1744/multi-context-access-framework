# MCAC Experimental Design (Phase 2)

## Scope and gate

This harness is isolated under `lib/mcac/experiment`; no production authorization route imports it. It defines six independently selected evaluators on paired synthetic streams. A second pilot is currently gated: all six author decisions in [the decision register](mcac-experiment-decision-register.md) require explicit approval, and approved S9 semantics still need implementation. The first pilot failed to measure the manuscript latency boundary. Its old timing values are not valid Section XVII results. No test seed has been evaluated.

The complete manuscript was extracted from the supplied PDF and Sections XVI–XVIII, Tables IX–XII and Appendix B were reviewed. The paper labels expected outcomes as design intent and reports no prior experiment results.

## Baselines

| ID  | Evaluator                | Implemented behavior                                                                                                                                                                 |
| --- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| B1  | Static RBAC              | Returns ALLOW iff baseline predicate is true, otherwise DENY. No context evaluation or trace.                                                                                        |
| B2  | Static attribute policy  | Baseline gate, then fixed work-hour, network-class and registered-device predicates. Missing values make the relevant predicate false. Ignores behavior items and validity statuses. |
| B3  | MCAC-E                   | Runs the formal engine with behavioral conditions removed; environmental conditions, validity statuses and configured interactions remain.                                           |
| B4  | MCAC-B                   | Runs the formal engine with environmental conditions removed; behavioral conditions, validity statuses and configured interactions remain.                                           |
| B5  | Full MCAC                | Both condition categories, validity statuses, environment-conditioned thresholds and declared Γ outcomes.                                                                            |
| B6  | MCAC without interaction | Both categories and validity statuses; uses a constant frequency threshold and disables the environment-conditioned threshold and Γ mechanisms.                                      |

Each evaluator is a separate entry in `evaluators`; the ablations construct their own policy snapshots and invoke the shared formal decision engine only where the manuscript specifies MCAC semantics. B5 is not weakened to match another system.

## Scenario families

`FAMILIES` preserves each Table IX description, family-level intent label, primary context category and expected full-framework outcome. Expected outcomes are retained as design intent and are never substituted for measured decisions. Mixed families alternate benign and violating labels by instance index. S1–S3 and S11 also include a fixed 10% counterfactual label assignment; S7 and S12 retain violating labels. Labels are generated before evaluation without inspecting policy outputs. The counterfactual mix creates benign requests with deviant context and violating requests with normal context. Appendix B population sampling distributions remain unresolved, so current generation is a deterministic fixture generator and is not manuscript-faithful population sampling.

The pilot stores all generated inputs, including the blocked S9 family. S9 uses the documented device/region conflict as generated context but does not invent a Γ rule that declares that same-category conflict contradictory. S9 is therefore excluded from reported pilot system metrics until the author resolves the Γ scope/example conflict.

## Seed splits, size and freeze

| Set                                   |   Seeds | Instances per family | Requests per seed |
| ------------------------------------- | ------: | -------------------: | ----------------: |
| Calibration                           |     1–5 |                  250 |             3,000 |
| Test                                  | 101–130 |                  250 |             3,000 |
| Historical first pilot (not repeated) |  seed 1 |                    2 |                24 |

All six systems receive the same request inputs for a seed. Calibration and test manifests are separate. The policy and generator parameters are not frozen: the calibration objective/search space is unspecified, so calibration was not performed and test evaluation did not start.

## Step-up

For VERIFY, benign actors pass and violating actors fail, except S12 mimics pass/fail according to an independent configured failure probability. A deterministic random variate is derived per request and reused across systems, preserving paired outcomes. FAR is computed from decision-stage ALLOW outcomes; end-to-end FAR additionally counts violating requests that pass VERIFY. The pilot probability 0.5 only exercises this simulation and is unresolved. This simulation is not a measurement of MFA effectiveness or user behavior.

## Context degradation

Rates are `0`, `0.1`, `0.2`, and `0.4`. Each of the nine context items is independently selected with probability ρ; selected items receive one of missing, stale, unverifiable or contradictory with uniform draws. A fixed two-draw-per-item generator keeps rate variants paired on the same underlying item stream. Every operation records rate, degradation seed, item kind and operation. Contradictory status is injected through explicit synthetic Γ evidence, and this mechanism does not define the unresolved S9 region/device relation.

The degradation operator independently selects each of nine items with probability ρ, then samples one of missing/stale/unverifiable/contradictory uniformly. A fixed two-draw-per-item PRNG schedule keeps rate variants paired. Each operation records the degradation seed, rate, item and operation. The experiment is configured to report H and L separately. Contradiction evidence currently exercises declared Γ outcomes only; it does not resolve the S9 conflict. Historical pilot degradation checks are reported as historical plumbing evidence, not population estimates.

## Metrics and statistical plan

Metric denominators follow Sections XVII-A/B: violating is positive; FAR is violating ALLOW / violating; FRR is benign DENY / benign; CR is benign VERIFY / benign; precision counts both benign VERIFY and DENY as false positives; recall is 1−FAR; F1 is the harmonic mean. End-to-end FAR additionally counts violating VERIFY requests that pass the configured simulation. Empty denominators yield null. Context coverage follows the per-decision mean in Eq. (18); a decision with no applicable referenced items makes the aggregate null because the manuscript gives no zero-denominator convention. Trace completeness requires every applicable evaluated condition to be present. Replay fidelity uses `lib/mcac/reference/equation-19.ts`, independent of the production evaluator.

Section XVII defines decision latency from the PEP calling the PDP until the decision is returned, measured with a monotonic clock. `callLocalPdp` now starts immediately before request preparation/local dispatch and stops when the decision response returns. In the synthetic harness, this interval includes request preparation for the local PDP call, in-memory PIP/context lookup for baseline-authorized requests (except B1), evaluator execution, and in-process trace append/hash-chain update before response. It excludes scenario generation, policy creation, caller setup, reference replay, metric computation, artifact serialization and persistence. The trace append is in-memory; this is not a durable-store or network-service timing result. Core evaluator latency is recorded separately. `performance.now()` is used with two clock reads per sample; timer overhead is measured diagnostically and not subtracted. The manuscript's planned 2,000 warmups, 20,000 measured requests per system/configuration and 10 runs have not been repeated with this corrected boundary. A second pilot is not yet run, so the corrected latency gate has not passed. Throughput remains blocked pending approved bound and load procedure. CPU/memory sampling remains unmeasured.

`statistics.ts` implements deterministic 10,000-resample percentile bootstrap intervals over seed metrics, paired bootstrap intervals, paired Wilcoxon signed-rank p-values with tie and continuity correction (normal approximation), Holm correction and rank-biserial effect sizes with paired-bootstrap intervals. The full analysis would report per-seed values, test-seed means and intervals, paired system differences, and corrected p-values. No significance claim is made because no test-seed analysis ran.

## Frozen-configuration blockers

See [the unresolved-decision register](mcac-experiment-decision-register.md) and [mcac-author-decisions.md](mcac-author-decisions.md). Experimental blockers include S9 Γ semantics, S12 mimic failure probability, calibration objective/search space/constraints/tie-break, Appendix B population distributions, throughput p95 bound/load procedure, and Eq. (18) zero-reference handling. No provisional values are treated as approved defaults. The pilot script refuses to execute while required approval records are absent.
