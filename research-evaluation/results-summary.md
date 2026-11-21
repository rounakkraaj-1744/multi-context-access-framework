# Results summary

**Scope:** values characterize the existing simple policy evaluator on twelve fixed synthetic cases. They are not a comparison of six paper methods and do not establish real-world detection effectiveness.

## Table A — Baseline comparison

| System | FAR | FRR | CR | Verification burden | End-to-end FAR | Precision | Recall | F1 | p50 | p95 | p99 | Replay fidelity |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| B1 — Static RBAC | NOT RUN as pooled benchmark | NOT RUN | NOT RUN | N/A | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT IMPLEMENTED |
| B2 — Static attribute | NOT IMPLEMENTED | NOT IMPLEMENTED | NOT IMPLEMENTED | NOT IMPLEMENTED | NOT IMPLEMENTED | NOT IMPLEMENTED | NOT IMPLEMENTED | NOT IMPLEMENTED | NOT RUN | NOT RUN | NOT RUN | NOT IMPLEMENTED |
| B3 — MCAC-E | NOT IMPLEMENTED | NOT IMPLEMENTED | NOT IMPLEMENTED | NOT IMPLEMENTED | NOT IMPLEMENTED | NOT IMPLEMENTED | NOT IMPLEMENTED | NOT IMPLEMENTED | NOT RUN | NOT RUN | NOT RUN | NOT IMPLEMENTED |
| B4 — MCAC-B | NOT IMPLEMENTED | NOT IMPLEMENTED | NOT IMPLEMENTED | NOT IMPLEMENTED | NOT IMPLEMENTED | NOT IMPLEMENTED | NOT IMPLEMENTED | NOT IMPLEMENTED | NOT RUN | NOT RUN | NOT RUN | NOT IMPLEMENTED |
| B5 — Full MCAC | NOT IMPLEMENTED | NOT IMPLEMENTED | NOT IMPLEMENTED | NOT IMPLEMENTED | NOT IMPLEMENTED | NOT IMPLEMENTED | NOT IMPLEMENTED | NOT IMPLEMENTED | NOT RUN | NOT RUN | NOT RUN | NOT IMPLEMENTED |
| B6 — MCAC without interaction | NOT IMPLEMENTED | NOT IMPLEMENTED | NOT IMPLEMENTED | NOT IMPLEMENTED | NOT IMPLEMENTED | NOT IMPLEMENTED | NOT IMPLEMENTED | NOT IMPLEMENTED | NOT RUN | NOT RUN | NOT RUN | NOT IMPLEMENTED |
| Existing evaluator characterization (not B1–B6) | 0/10 (0%) | 0/2 (0%) | 1/2 (50%) | 1/2 (50%) | 0/10 (0%; actor outcome not modeled) | 10/11 (90.91%) | 10/10 (100%) | 20/21 (95.24%) | 0.875 µs | 1.041 µs | 2.333 µs | NOT IMPLEMENTED |

Positive class is VIOLATING. A contained violating request is a true positive; the benign step-up is an adverse predicted positive, so TP=10, FP=1, FN=0. End-to-end FAR equals decision FAR only because no violating case requests step-up; the actor model was not run.

## Table B — Per-family characterization

| Family | Intent | n | FAR | FRR | Verification burden | ALLOW | VERIFY/STEP_UP | DENY |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| normal | BENIGN | 1 | N/A | 0/1 | 0/1 | 1 | 0 | 0 |
| device | VIOLATING | 1 | 0/1 | N/A | N/A | 0 | 0 | 1 |
| hours | VIOLATING | 1 | 0/1 | N/A | N/A | 0 | 0 | 1 |
| network | VIOLATING | 1 | 0/1 | N/A | N/A | 0 | 0 | 1 |
| rate | VIOLATING | 1 | 0/1 | N/A | N/A | 0 | 0 | 1 |
| sequence | VIOLATING | 1 | 0/1 | N/A | N/A | 0 | 0 | 1 |
| missing | VIOLATING | 1 | 0/1 | N/A | N/A | 0 | 0 | 1 |
| stale | VIOLATING | 1 | 0/1 | N/A | N/A | 0 | 0 | 1 |
| conflict (policy conflict) | VIOLATING | 1 | 0/1 | N/A | N/A | 0 | 0 | 1 |
| no-perm | VIOLATING | 1 | 0/1 | N/A | N/A | 0 | 0 | 1 |
| failed | VIOLATING | 1 | 0/1 | N/A | N/A | 0 | 0 | 1 |
| stepup | BENIGN | 1 | N/A | 0/1 | 1/1 | 0 | 1 | 0 |

## Table C — Context degradation

| Rates | Sensitivity | FAR | FRR | Containment | Verification burden | Status |
|---|---|---|---|---|---|---|
| 0%, 10%, 20%, 30%, 40%, 50% | High and low | NOT RUN | NOT RUN | NOT RUN | NOT RUN | No degradation generator, sensitivity field, or matched MCAC evaluator |

## Table D — Latency breakdown

| System | Sample count | Mean | p50 | p95 | p99 | Throughput |
|---|---:|---:|---:|---:|---:|---:|
| Existing evaluateAccess pure decision component | 10,000 | 1.010 µs | 0.875 µs | 1.041 µs | 2.333 µs | 990,011 calls/s (summed measured function time) |
| Context collection | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN |
| Audit recording | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN |
| End-to-end HTTP authorization | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN |

Apple Silicon ARM64 MacBook Air, Darwin 27.0.0; Node v24.11.0. Warm-up 1,000; timed calls 10,000. Raw timing data in raw-results/latency-samples.csv.

## Table E — Trace and audit verification

| Measure | Result |
|---|---|
| Trace completeness | NOT IMPLEMENTED as replayable/versioned trace |
| Independent replay fidelity | NOT IMPLEMENTED |
| Hash-chain verification | NOT IMPLEMENTED |
| Existing record modification detection | NOT APPLICABLE — no production chain |
| Previous hash modification detection | NOT APPLICABLE — no production chain |
| Intermediate deletion/reordering detection | NOT APPLICABLE — no production chain |
| Latest-tail truncation | No chain/head anchor exists; no detection claim |

## Table F — Step-up verification

| Measure | Result |
|---|---|
| Step-up decisions in characterization | 1 STEP_UP_AUTH of 12 |
| Successful / failed / expired challenges | Not measured in characterization; route tests verify one wrong and one correct password reauthentication |
| Benign verification burden | 1/2 (50%) |
| End-to-end false acceptance after step-up | NOT RUN; no violating step-up actor outcome |
| Mechanism | Password reauthentication bound to request user/session/resource/action; five-minute record; request retry required |

This is not MFA. Existing integration tests are correctness checks, not usability measurements.

## Table G — Administrative workflow

| Measure | Result |
|---|---|
| Alert / notification / escalation latency | NOT RUN |
| Incident correlation accuracy | NOT RUN; no ground truth |
| Audit completeness of transitions | Selected functional integration tests pass; completeness benchmark NOT RUN |
| Workflow | In-app notifications, alert and incident persistence implemented; no external email provider |

Paired ablations and hypotheses are NOT RUN because distinct B2–B6 evaluators and specified MCAC mechanisms do not exist. No performance superiority claim is supported. Exact raw counts are in raw-results/evaluation.json.
