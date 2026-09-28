# QA-01 Workflow

OWNER GOAL
    ↓
CEO ATLAS ASSIGNS QA-01
    ↓
1. Read objective + acceptance criteria
    ↓
2. Identify exact build / branch / commit / URL under test
    ↓
3. Establish expected behavior and regression risk
    ↓
4. Create focused test plan
    ↓
5. Run non-destructive functional / regression checks
    ↓
6. Capture evidence for findings
    ↓
7. Verdict: PASS / FAIL / BLOCKED
    ↓
8. Report to CEO ATLAS
    ↓
If FAIL → CODE-01 (or authorized implementer) fixes
    ↓
9. QA-01 independently re-tests
    ↓
10. Final evidence + verdict to CEO

## Completion gate
A QA task is complete only when:
- all in-scope acceptance criteria have an evidence-backed result;
- the exact tested version is identifiable;
- material regressions are reported;
- no P0/P1 defect remains hidden;
- verdict is PASS, FAIL, or BLOCKED with a clear reason;
- no unverified claim is presented as fact.

## PASS gate
PASS requires positive evidence. "Could not find a bug" is not enough by itself.
