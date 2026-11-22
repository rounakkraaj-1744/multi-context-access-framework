# MCAC Formal Semantics Addendum: Γ and Θ

**Status:** Approved decisions A–G are recorded here as requirements. Θ policy validation is implemented in this repository. Γ outcome derivation is not implemented because the approved decisions do not enumerate the comparison operators, operand grammar, or typed AST node contract needed to evaluate its predicates without inventing semantics. This document does not claim the research manuscript has been updated.

## Γ: general context consistency

A Γ constraint may reference environmental items in `Ce`, behavioral items in `Cb`, or items from both categories. Scope is determined by the constraint's declared references; a constraint is not required to span both categories.

Γ has exactly three outcomes:

| Outcome         | Meaning                                                | Condition-evaluation effect                                                                                      |
| --------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `SATISFIED`     | Available evidence establishes the predicate as true.  | No degradation.                                                                                                  |
| `VIOLATED`      | Available evidence establishes the predicate as false. | Every participating context item is classified `X` (contradictory), subject to the existing validity precedence. |
| `INDETERMINATE` | Evidence cannot establish true or false.               | Participating items are treated as indeterminate for conditions that reference them. They are not marked `X`.    |

Only an established contradiction yields `X`. Missing, stale, unverifiable, or internally contradictory source evidence cannot by itself establish a Γ violation. These evidence states yield `INDETERMINATE` unless a separately defined predicate can still resolve its result under the approved logic.

### Predicate evaluation requirements

The evaluator must derive Γ outcomes server-side from a validated declarative expression and the declared context references. Caller-supplied Boolean values are not evidence of a Γ result. The expression language must be a bounded typed AST; it must not evaluate JavaScript, SQL, strings, user functions, imports, or executable policy code. Its approved comparison-operator set, node field names, operand grammar, reference syntax, depth limit, and complexity limit remain to be specified before implementation.

Boolean composition uses Strong Kleene three-valued logic:

| `AND`           |          `TRUE` | `FALSE` | `INDETERMINATE` |
| --------------- | --------------: | ------: | --------------: |
| `TRUE`          |          `TRUE` | `FALSE` | `INDETERMINATE` |
| `FALSE`         |         `FALSE` | `FALSE` |         `FALSE` |
| `INDETERMINATE` | `INDETERMINATE` | `FALSE` | `INDETERMINATE` |

| `OR`            | `TRUE` |         `FALSE` | `INDETERMINATE` |
| --------------- | -----: | --------------: | --------------: |
| `TRUE`          | `TRUE` |          `TRUE` |          `TRUE` |
| `FALSE`         | `TRUE` |         `FALSE` | `INDETERMINATE` |
| `INDETERMINATE` | `TRUE` | `INDETERMINATE` | `INDETERMINATE` |

| `NOT` input     | Result          |
| --------------- | --------------- |
| `TRUE`          | `FALSE`         |
| `FALSE`         | `TRUE`          |
| `INDETERMINATE` | `INDETERMINATE` |

Expression result maps `TRUE → SATISFIED`, `FALSE → VIOLATED`, and `INDETERMINATE → INDETERMINATE`. Indeterminate participation must flow through ordinary condition severity, resource sensitivity, and fail-open rules; it is not an authorization success or a separate bypass.

The existing `M, U, X, S, V` validity precedence remains unchanged. Γ is applied before status classification: established violations provide the contradiction set used by the existing `X` case; indeterminate Γ results must influence condition evaluation without being translated into `X`. Trace evidence should record constraint identity/version, declared references, participating evidence validity states, result, and an indeterminate reason without copying unnecessary raw context values or secrets.

## Θ: network-conditioned thresholds

The canonical network vocabulary is exactly `corporate`, `vpn`, `known`, and `unknown`. Aliases such as `corp`, capitalization changes, and fallback class interpretation are not defined.

When Θ is enabled and a behavioral condition has a dynamic network threshold:

1. The policy must explicitly provide a finite numeric threshold for every canonical network class.
2. Extra/noncanonical keys are invalid.
3. A valid network item selects only the exact matching key.
4. Missing, stale, unverifiable, contradictory, or otherwise degraded network evidence makes the condition indeterminate.
5. A missing mapping encountered at runtime despite validation is a policy configuration/integrity error; there is no fallback.

A network-dependent threshold while Θ is disabled is invalid policy configuration. Authors must remove the dynamic threshold or explicitly enable Θ; the evaluator must not ignore it or substitute a value. A constant threshold remains valid with Θ enabled or disabled.

## Validation, publication, and replay invariants

- Draft validation must reject Θ mappings that are incomplete, empty, nonnumeric/nonfinite, or contain noncanonical keys, and reject dynamic Θ while the Θ switch is disabled.
- The evaluator repeats Θ checks at its untrusted policy boundary. These checks do not make the draft publishable by themselves; other formal validation requirements remain.
- No policy is published or activated by this addendum. Immutable version storage and activation behavior are unchanged.
- A decision/replay must pin the exact immutable policy version, normalized evidence inputs, evidence validity metadata, evaluator version, Γ result and Γ evaluation inputs that are sufficient to reproduce supported semantics. Replay must not resolve an active/latest policy implicitly.
- This document defines no new condition comparator semantics, waiver semantics, context-source authenticity claims, or production authorization integration.

## Implementation status

- **Θ completeness and configuration checks:** implemented in `lib/mcac/theta-validation.ts`, called by `lib/mcac/decision.ts:validateModelPolicy` and `app/api/admin/mcac-policies/route.ts:policyReadinessReport`.
- **Θ exact lookup and degraded evidence:** implemented in `lib/mcac/interactions.ts:resolveEnvironmentConditionedThreshold`; impossible missing mappings raise a policy integrity error.
- **Γ general scope / caller Boolean rejection / predicate outcomes:** blocked. The existing `ConsistencyEvidence` Boolean contract in `lib/mcac/types.ts` and `lib/mcac/interactions.ts:evaluateCrossCategoryConsistency` has not been replaced in this change because the expression contract is incomplete. Existing Γ evaluation therefore remains unsuitable for authoritative publication or production use.
- **Publication and activation:** remain blocked; the draft route still returns `BLOCKED` and does not publish or activate versions.
