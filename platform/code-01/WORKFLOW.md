# CODE-01 Workflow

OWNER REQUEST
    ↓
1. Identify project + target behavior
    ↓
2. Read source and project structure
    ↓
3. Reproduce / collect evidence
    ↓
4. Root-cause diagnosis
    ↓
5. Minimal implementation
    ↓
6. Test / build / lint / smoke check
    ↓
7. Review git diff
    ↓
8. Commit / push (only if authorized)
    ↓
9. Deploy (only if authorized)
    ↓
10. Verify live result
    ↓
11. Report evidence + remaining risks

## Completion gate
A task is COMPLETE only if:
- requested behavior is implemented;
- relevant verification passed or limitations are explicitly reported;
- no known regression introduced by the change remains unresolved;
- repository/deployment state is reported truthfully.
