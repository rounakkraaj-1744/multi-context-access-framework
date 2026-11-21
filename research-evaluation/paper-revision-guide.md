# Paper revision guide

## Source availability

No manuscript PDF/source, bibliography, equations, propositions, or Table XI was present in the repository when searched. Exact section numbering and current placeholders therefore cannot be checked. Provide the manuscript source/PDF, exact twelve-family definitions, equations including Proposition 3, and an official bibliographic record for reference [8] for exact reconciliation.

## Abstract — proposed replacement

> We audited a Next.js and TypeScript access-control prototype whose authorization engine evaluates effective RBAC permissions and flat contextual policy conditions. The inspected implementation does not yet implement the paper’s five-state context model, three-valued condition semantics, severity aggregation, cross-category interactions, versioned replay traces, or hash-chained audit records. On twelve fixed synthetic cases from the repository (ten labelled violating and two benign), the existing evaluator produced ten DENY decisions, one ALLOW, and one step-up decision; observed FAR was 0/10 and benign verification burden was 1/2. These small constructed cases characterize implementation behavior only and do not establish comparative or real-world attack-detection effectiveness.

## Contributions

Limit contributions to implemented prototype elements: role/permission administration; deterministic flat conditional evaluation; server-side sessions; password reauthentication step-up; persisted decisions and scenario runner; in-app behavior findings and incident workflows. Remove claims that all formal MCAC semantics are implemented. Treat typed categories, five validity states, severity aggregation/interactions, replay, and hash chaining as design goals unless a complete implementation is added.

## Related work and novelty

Do not claim RBAC, ABAC, or XACML cannot express contextual attributes. Treat these as established models. Describe novelty narrowly as the paper’s proposed combination/formalization (typed environmental/behavioral categories, explicit validity states, score-free severity aggregation, restrictive decisions, cross-category interactions, replay trace) only after checking citations and equations. No local bibliography substantiates the earlier score-based CAAC publication details or a priority claim.

## Research questions and hypotheses

Mark comparative RQs/H1–H5 NOT EVALUATED. There is no matched six-system experiment. Do not accept/reject hypotheses from the 12-case characterization. A later study needs an independent test set, calibration split, actor outcomes, sensitivity labels, and paired comparisons.

## Implementation model

State that the current implementation checks a required permission and Boolean conditions for business hours, registered device, known network, request count, unusual sequence, context availability/freshness, and optional time window. A matched ALLOW policy is required to avoid failure of a required condition; applicable DENY wins; step-up may be requested if otherwise eligible. Concrete decision type is ALLOW | DENY | STEP_UP_AUTH, not ALLOW | VERIFY | DENY. Ordinary requests observe server time/session and derive request counts; device/network classifications are unavailable except as simulated scenario inputs.

## Table VII — Implementation Evidence Status

Replace with implementation-audit.md. Key correction: five-state validity, three-valued evaluation, severity/category aggregation, interactions, replay, and hash-chain are not implemented. “Verified” is limited to specific existing unit/route tests and not general end-to-end security.

## Cryptographic safeguards

Use cryptographic-audit.md. Report opaque random 256-bit session bearer token plus SHA-256 database digest; bcrypt cost factor 12; no signed device token; no audit chain; no verified deployed TLS. State that even a hash chain does not establish newest-tail retention without an externally anchored head.

## Experimental setup

Use experimental-setup.md. Correct “seeded generator” to “12 fixed seed rows”: recorded seed does not drive randomness. Include label assumptions and machine/runtime limits; separate this characterization from any future calibration/test benchmark.

## Baselines B1–B6

B1 predicate exists but was not evaluated as a complete independent benchmark. B2–B6 are not implemented. Remove results attributed to six methods. Do not substitute aliases. Implement only after exact definitions are available, using identical inputs and independent labels.

## Table XI — Experimental Results

No Table XI source exists locally, so exact table number is unverified. Replace planned six-baseline results with results-summary.md and paper-tables tables. Label the measured system “Existing evaluator characterization”; show B1–B6 as NOT RUN/NOT IMPLEMENTED. Never leave missing values blank.

## Results and Discussion

Report observed results only: 12 requests (10 violating, 2 benign); decisions: 10 DENY, 1 ALLOW, 1 STEP_UP_AUTH; FAR 0/10; FRR 0/2; verification burden 1/2; precision 10/11; recall 10/10; F1 20/21; pure decision p50 0.875 µs, p95 1.041 µs, p99 2.333 µs over 10,000 timed calls. The fixed one-per-family synthetic sample is not evidence of real-world detection. No superiority or ablation effect is established.

## Formal properties

- Baseline non-bypass: evaluator checks required permission; example unit/route tests pass; this is not a mathematical proof.
- Determinism: function appears deterministic for fixed explicit inputs; no dedicated property test, and no immutable policy version capture.
- Degradation monotonicity: not implemented/tested because sensitivity-specific semantics and five-state evaluation are absent; exact Proposition 3 is unavailable.

Replace “proved” with “observed in tested examples.” There is no score-free severity aggregation implementation, so do not imply compliance with an equation.

## Limitations

Add: no full MCAC evaluator; no V/S/M/U/X states or three-valued conditions; no severity/category aggregation or cross-category interactions; no B2–B6; fixed 12 synthetic cases; no sensitivity/degradation/actor model; no independent replay; no hash-chain; no verified deployment TLS; ordinary device/network data unavailable; password step-up is not MFA; pure-function latency excludes collection/database/audit/HTTP; one device/runtime; no significance claims.

## Conclusion — proposed replacement

> The repository contains a functioning access-control prototype with RBAC permission checks, deterministic contextual conditions, password reauthentication step-up, persisted decisions, and selected administrative incident workflows. A source audit found that several mechanisms specified by the MCAC design—including five-state context validity, three-valued evaluation, severity aggregation and interactions, replayable traces, and hash-chained audit records—are not implemented in the current evaluator. The twelve fixed synthetic cases produced the recorded outcomes in this study, but their size and construction do not support claims of baseline superiority or real-world attack-detection effectiveness. Future work must implement and independently verify the formal model, baselines, trace integrity, and a reproducible paired evaluation.

## Reference [8]

No local BibTeX, PDF, official publisher record, DOI, venue, year, volume, issue, or pages were found. Do not invent a citation. Author must provide the publication URL or official bibliographic record.

## Additional author inputs required

1. Manuscript source/PDF, exact equations, Proposition 3 assumptions, metric definitions, tables, and twelve-family specification.
2. Official reference [8] publication record or URL.
3. Clarification whether to implement the formal research model once definitions are available.
