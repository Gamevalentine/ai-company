# OPS-01 Workflow

## Standard task lifecycle

1. **RECEIVED** — task arrives from ATLAS.
2. **SCOPED** — target, environment, requested outcome, and permission boundary identified.
3. **OBSERVED** — current state collected using read-only evidence.
4. **CLASSIFIED** — task type and operational risk assigned.
5. **PLAN_READY** — execution and rollback/verification plan prepared.
6. **WAITING_APPROVAL** — used when production/high-risk permission is required.
7. **EXECUTING** — authorized operational action is running.
8. **VERIFYING** — health, deployment state, logs, and user-visible behavior checked.
9. **DONE** — evidence proves the requested operational outcome.
10. **ESCALATED** — issue routed to CODE-01, QA-01, SEC-01, PERF-01, or ATLAS.

## Incident severity

- **SEV-3 / Warning** — localized degradation; workaround may exist.
- **SEV-2 / Major** — important function unavailable or repeated failures.
- **SEV-1 / Critical** — primary service unavailable, data integrity risk, or broad production impact.

## Deployment checklist

Before production:
- approved target
- approved version/commit
- build/test evidence available
- rollback target known
- backup state checked when relevant
- monitoring/health check ready
- Owner approval recorded

After production:
- confirm deployment completed
- check critical routes/services
- check fresh logs/errors
- compare expected vs actual version
- record evidence
- rollback if authorized criteria fail; otherwise escalate immediately

## Handoff rules

- source/application defect → CODE-01
- QA acceptance uncertainty → QA-01
- security signal → SEC-01
- performance regression → PERF-01
- unclear priority/permission/cross-team issue → ATLAS
