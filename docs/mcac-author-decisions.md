# MCAC Author Decisions

Experimental decision details and approval format are tracked in [mcac-experiment-decision-register.md](mcac-experiment-decision-register.md). No approval records have been supplied. A second pilot remains gated.

Review is based on all occurrences in the 17-page `complete_research_paper.pdf`, including equations, body text, examples, figures, tables, Algorithm 1 and appendices. None of the four questions below has a unique answer in the manuscript. No implementation choice is promoted as the research semantics.

## 1. Must Γ span both context categories?

**Status: AUTHOR DECISION REQUIRED.**

Section VIII-B, Eq. (2), p. 6 defines Γ only as “a set of declared consistency constraints over items.” Section IX-B, p. 7 names the mechanism *Cross-category consistency constraints* and says constraints may relate items across categories. Its example is a registered device and a network class; both are environmental items under Eq. (3), p. 6. Figure 1, p. 7 calls Γ constraints one of the cross-category influences. Algorithm 1, p. 10 simply applies Γ to both categories. No other passage gives a scope restriction.

Alternatives:

- Require every γ to include at least one environmental and one behavioral item. This follows the mechanism’s name and figure, but excludes the manuscript’s device/network example.
- Permit Γ over arbitrary item subsets, including same-category constraints. This follows Eq. (2) and the example, but weakens the ordinary meaning of “cross-category.”
- Treat the device/network example as erroneous and amend the manuscript to a true cross-category example.

Current engine behavior accepts arbitrary declared item sets. This is implementation behavior, not a resolved requirement.

## 2. What if a valid network class is absent from Θ?

**Status: AUTHOR DECISION REQUIRED.**

Section IX-B, p. 7 defines `θ=Θ[xn]` for a finite table Θ and says that a degraded network makes the condition I. It does not state what to do when network status is V but its class is not a Θ key. Example 4 and the example policy on p. 9 give corporate/VPN/known examples but no exhaustive network class/table requirement. Table VI, p. 9 includes unknown as a network class, but does not require every Θ to include it.

Alternatives:

- Treat lookup failure as I (fail-safe degradation). This propagates through Eq. (7) according to sensitivity and fail-open policy.
- Require Θ to be total over the network domain and reject incomplete policy before evaluation. This turns the case into a policy validation error, not an authorization result.
- Define an explicit default threshold entry. This needs a named parameter and policy semantics in the manuscript.

Current engine throws a configuration error at evaluation. No default is inferred.

## 3. Is a waiver valid exactly at expiry?

**Status: AUTHOR DECISION REQUIRED.**

Section XII-E, Eq. (12), p. 9 says the waiver is valid for `Δv` seconds and applies while valid. It binds waiver to session, class and action and requires adequate assurance. Neither Eq. (12), Algorithm 1 (p. 10), nor the examples specify whether validity is `[verifiedAt, expiresAt)`, `[verifiedAt, expiresAt]`, or another interval. The separate assumption of synchronized clocks in Section XV-B, p. 12 does not settle the endpoint.

Alternatives:

- Half-open interval: invalid at exact expiry; a request at expiry returns the unwaived result / invalid-waiver path.
- Closed endpoint: valid at exact expiry; a request one instant later is invalid.

Current engine uses `requestTime < expiresAt`; the application also uses a strict greater-than expiry check, but compatibility does not establish manuscript intent.

## 4. What is the exhaustive comparator grammar for ⊕?

**Status: AUTHOR DECISION REQUIRED.**

Section VIII-D, p. 6 introduces `κ=(k,⊕,θ,s)` but does not enumerate ⊕. Eq. (5) uses it abstractly. Section IX-B, p. 7 adds network table lookup. Section XI-B, p. 7 defines history novelty and expected navigation transitions. The policy fragment and Example 4, p. 9 illustrate `in`, `in_window`, `<=`, `not_novel`, and expected transition behavior. Section XI-C, p. 8 references registered devices. No passage says this list is exhaustive, defines all operand types, equality semantics for structured values, or invalid type behavior. Table VI does not define operators.

Alternatives:

- Publish an explicit finite typed operator table (operator, admissible item kinds, parameter schema, boundary semantics, invalid/missing behavior).
- Declare the examples illustrative and provide a general expression language, with a versioned grammar and evaluator semantics.
- Restrict conditions to the operators currently used in the paper’s examples and revise the claim of general `⊕` accordingly.

The production implementation accepts a finite comparator set (`eq`, `neq`, `in`, `lt`, `lte`, `gt`, `gte`, `in_window`, `registered`, `not_novel`, `expected_transition`). That inventory is code behavior; this audit does not infer that it is the manuscript’s exhaustive grammar. The independent evaluator rejects comparator semantics not explicitly stated well enough to implement.

## Experimental parameters required to freeze Phase 2

These additional gaps are methodological configuration questions, not new interpretations of the formal engine. The pilot configuration records provisional values and is not eligible for test-seed evaluation until the relevant choices are approved.

1. **S9 conflicting-region generator semantics — BLOCKS S9 headline evaluation.** Table IX describes a known device with an inconsistent region and expects a Γ-induced X status. Under Eq. (3), device and location are both environmental items, while the interaction is named cross-category. The pilot generates the stated device/region pattern but does not assert that this is a Γ violation. S9 inputs remain in the raw pilot corpus; S9 is excluded from pilot system metrics. Confirm whether this same-category constraint is permitted or revise the example.
2. **Mimic verification failure probability — BLOCKS end-to-end FAR claims.** Section XVI-F requires a separately configured probability for S12 but supplies no value or distribution. The pilot uses 0.5 only to exercise deterministic simulation plumbing. It is not an approved parameter, and end-to-end FAR is not a reportable result until this value is selected.
3. **Calibration objective and search space — BLOCKS freezing a policy.** Sections XVI-D and XVI-E specify calibration seeds 1–5 and test seeds 101–130, but do not specify the parameter grid, objective, constraints or tie-breaking rule. The existing thresholds are illustrative pilot values only; no calibration has been performed and no policy can be called frozen.
4. **Appendix B population distributions — BLOCKS claiming a manuscript-faithful generator.** Appendix B asks the generator to sample users/roles, work profiles, registered devices, usual networks and enrollment histories, but states that distribution parameters will be listed later. The pilot's small deterministic context fixtures exercise evaluator plumbing and do not implement those population distributions.
5. **Throughput latency bound — BLOCKS throughput measurement.** Section XVII defines throughput under a pre-set p95 bound but states no numeric bound or load-generation procedure. No throughput result is produced.
6. **Context coverage with no applicable conditions.** Eq. (18)'s per-decision ratio is undefined when `n_req(d)=0`; the pilot metric implementation reports null when any traced decision has an undefined item ratio. Confirm whether such decisions should be omitted or assigned a convention before headline coverage is reported.

The pilot also uses and records provisional values for the work window, network frequency table, novelty/transition thresholds, freshness interval, user/resource fixture, sensitivity assignment and degradation seed derivation. These values are configuration examples for the pilot only; the manuscript does not supply them as defaults.
