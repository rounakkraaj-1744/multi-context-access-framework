# Formal MCAC policy lifecycle (Phase 1A)

## Implemented boundary

Formal policy drafts are stored separately from the mutable legacy `policies` table. A draft has an explicit resource-class/action scope, author, status, JSON policy document, and readiness report. Only a Super Admin may list or create drafts, edit a draft, or request a readiness check; these checks are enforced in `app/api/admin/mcac-policies/route.ts`. Draft create/edit and readiness now select AST-bearing Γ entries and use the shared `validateGammaConstraints` validator. The JSON AST is stored without normalization or field dropping; legacy `{id,items}` declarations remain distinguishable and are not treated as AST constraints.

The implemented status column admits the proposed states (`DRAFT`, `VALIDATED`, `PUBLISHED`, `ACTIVE`, `RETIRED`) so future transitions can be added without conflating drafts and immutable snapshots. Current API operations create/edit only `DRAFT` records. Readiness checks persist a report and return `BLOCKED`; they never promote a draft. Γ readiness results include structured validator codes/paths, canonical byte count, and digest when valid, but a valid Γ AST does not make the complete policy ready. The low-level immutable version store now records a Γ AST digest, canonicalization identifier, and evaluator semantics version in AST-bearing snapshots. There is no draft-to-version conversion API and no publish, activate, retire, delete, or decision-time selection operation.

## Proposed lifecycle and authority

- Super Admin creates and edits drafts and is the only role allowed to administer global formal policy.
- A Super Admin requests validation. A separate validator identity is not represented in the current account model; adding a four-eyes rule would require an explicit governance decision and schema support.
- Publication should create an immutable `PolicyVersion` snapshot in `mcac_policy_versions`; the published row must never be edited or deleted.
- Activation should be a separate, serialized binding from the exact resource-class/action pair to one published version. A single SQLite transaction should retire the previous binding and set the new one, guarded by a unique key on `(resource_class, action)` and an expected-current-version compare-and-swap. A concurrent stale activation must fail with conflict and leave the current binding unchanged.
- Reversal should activate a previously published version through the same compare-and-swap operation, recording the operator and transition. It must not mutate history or change existing snapshots.
- Historical replay should continue to load the trace's exact `policyVersion`, independent of which version is currently active.

These publication/activation mechanics are design only. No activation table or transition API was added because no policy can safely reach `VALIDATED` yet.

## Binding and selection

The existing formal model locates a profile by `request.resourceClass` and applicable rules by exact resource class plus action. It has no top-level policy scope field or active-version selector. A future binding must therefore explicitly store the resource class and one supported action and point to an immutable version. Authorization must perform an exact lookup and fail closed when absent. It must not select by creation time, use a wildcard resource class, choose another action, or fall back to legacy `policies`.

## Validation blockers

The engine performs runtime checks in `lib/mcac/decision.ts:validateModelPolicy` and `validateCondition`, but those checks are private and are not a complete publication validator. `lib/mcac/types.ts` declares the supported comparator union; `lib/mcac/conditions.ts` implements those operators. However, `docs/mcac-author-decisions.md` records that the paper does not say this list is exhaustive or fully define operand and boundary semantics. The readiness check therefore blocks conditional policies pending a comparator grammar decision.

The approved Γ AST, shared strict validator, evaluator, and effect propagation are implemented in the MCAC library. Draft create/edit rejects malformed AST-bearing constraints with stable validation codes and paths; readiness repeats validation and reports its result, including the feature switch and canonical size. Legacy `{id,items}` declarations remain distinct from AST Γ entries. Publication remains unavailable, and the legacy `evaluateAccess` path is unchanged.

Θ mappings are validated in `lib/mcac/theta-validation.ts` at draft readiness and evaluator boundaries. Dynamic thresholds require Θ enabled, finite numeric values, canonical keys only, and complete coverage of `corporate`, `vpn`, `known`, and `unknown`. Degraded network evidence still makes the condition indeterminate; an impossible missing runtime entry raises an explicit policy-integrity error without fallback.

The current readiness report is explicitly a gate, not a complete formal validator. It does not return `VALIDATED`; publication and activation remain unavailable until validation covers the complete policy/evaluator contract and remaining formal prerequisites, including the exhaustive condition comparator grammar, are resolved. A successful Γ-specific validation result is only one input to this gate.

## Minimum future activation schema

When publication is unblocked, the minimum additional table should bind an exact `(resource_class, action)` to a `policy_version`, with active transition metadata and a uniqueness constraint for the active pair. A transition-history table is also needed if activation/reversal actors and timestamps must be retained. Draft identity and scope are already stored in `mcac_policy_drafts`; immutable policy bodies remain in `mcac_policy_versions`. No such activation schema is present or introduced in Phase 1A.
