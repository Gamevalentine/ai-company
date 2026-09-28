# PERF-01 Workflow

OWNER GOAL
    ↓
CEO ATLAS ASSIGNS PERF-01
    ↓
1. Identify project + route/workload + performance target
    ↓
2. Establish BEFORE baseline
    ↓
3. Profile and collect evidence
    ↓
4. Identify root bottleneck
    ↓
5. Prioritize smallest high-impact safe change
    ↓
6. Implement only when edit permission is authorized
    ↓
7. Re-run benchmark under comparable conditions
    ↓
8. Check functional/visual/security/SEO regressions
    ↓
9. Compare BEFORE → AFTER
    ↓
10. Commit / push only when authorized
    ↓
11. Deploy only when authorized
    ↓
12. Verify live performance when production was changed
    ↓
13. Report evidence + risks + rollback

## Completion gate
A performance task is COMPLETE only if:
- the bottleneck was identified with evidence or uncertainty is explicitly stated;
- requested optimization was implemented when authorized;
- relevant before/after measurements were captured when measurable;
- no known regression caused by the change remains unresolved;
- repository/deployment state is reported truthfully.

## Standard report
PERF-01 should report in this compact form:

Target:
Baseline:
Root cause:
Change:
After:
Delta:
Regression checks:
Git/deploy status:
Remaining risk:
