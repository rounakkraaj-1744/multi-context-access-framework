# Experimental setup and scope

## Environment observed

- Hardware: Apple MacBook Air, Apple Silicon ARM64 (model identifier and memory/core counts not recorded).
- OS: macOS Darwin 27.0.0, arm64.
- Runtime: Node.js v24.11.0 for the characterization process; Bun 1.2.17; Next.js 16.4.3; React 19.3.0; TypeScript package range ^5.
- Database: characterization did not connect to a database. Application source uses SQLite via better-sqlite3, foreign keys ON, WAL mode. Existing route tests use unique temporary SQLite files.
- No server or deployed endpoint was measured; deployment TLS was not inspected.

## Dataset and procedure

The repository contains 12 fixed cases in lib/seed.ts: normal, device, hours, network, rate, sequence, missing, stale, conflict, no-perm, failed, stepup. The characterization script labels normal and stepup BENIGN and the other ten VIOLATING based on their specified access-risk or permission condition. This is an evaluation assumption, not independent author-supplied ground truth. One case exists per family. “conflict” refers to conflicting ALLOW and DENY policies, not contradictory context. No case models unverifiable context, sensitivity, or step-up actor completion.

Command: bunx tsx scripts/research-evaluate.mts. The recorded seed is 20261031; the cases are fixed, so this seed does not drive generation. No calibration was run and no thresholds were tuned. Outputs are in raw-results/. The script evaluates the existing pure function and records 1,000 warm-up calls followed by 10,000 timed calls cycling the cases. It excludes context collection, SQLite, audit writes, HTTP, network, and step-up completion. Existing test suite: bun run test, 2 files / 31 tests passed.

## Statistical interpretation

Dataset n=12 (10 violating, 2 benign). Exact counts are in raw-results/evaluation.json; zero-denominator metrics are N/A. No inferential test or confidence interval is reported: one request per family and no matched six-system benchmark do not support the planned comparisons. Zero FAR among ten constructed violations is not evidence of zero real-world FAR. Latency percentiles apply only to in-process calls. Throughput is sample count divided by summed function timings, not server capacity.

## Threats to validity

The set is fixed, small, synthetic, and evaluator-adjacent. There is no independent full MCAC evaluator, baseline parity, calibration/test separation, randomized generation, actor outcome model, or external replay reference. Only one runtime/device/process run was used. No HTTP/database latency or production TLS was measured. Findings characterize only the implementation on listed inputs.
