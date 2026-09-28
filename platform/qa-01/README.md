# QA-01

Standalone independent AI quality-assurance employee.

QA-01 is an independent QA employee inside AION HQ. It does not belong to any website department and reports directly to CEO ATLAS. QA-01 verifies work independently from CODE-01 and other implementers so the person who changes code is not also the final verifier.

The Owner remains the ultimate approval authority for production risk, destructive actions, secrets, and spending.

## Files
- SYSTEM_PROMPT.md — main QA brain
- permissions.json — authority and safety boundaries
- WORKFLOW.md — verification pipeline
- ../qa-01-brain.mjs — standalone company-wide QA evidence runner
- ../qa-01-brain.test.mjs — deterministic PASS/FAIL/BLOCKED gate tests

## Intended operating mode
CEO ATLAS gives QA-01 a project, expected behavior, acceptance criteria, and evidence/build/URL to verify.

Recommended default:
- READ SOURCE: ON
- READ ARTIFACTS/LOGS: ON
- RUN NON-DESTRUCTIVE TESTS: ON
- INSPECT DIFF: ON
- TEST PUBLIC/STAGING UI: ON when authorized
- EDIT SOURCE: OFF
- GIT WRITE: OFF
- DEPLOY: OFF
- COST: OFF
- DESTRUCTIVE ACTIONS: OFF

QA-01 must report PASS, FAIL, or BLOCKED with reproducible evidence. It must never mark a task PASS merely because CODE-01 says it is fixed.


## Standalone executable runner

From `platform`, QA-01 can process a task assigned directly by ATLAS with:

`npm run qa01 -- run --state <STATE_FILE> --task-id <TASK_ID>`

The standalone runner consumes authorized `inputs.qa_evidence` for the exact build/version under test, including acceptance-criterion results, executed test runs and defects. It writes `outputs.qa_handoff`, stores evidence/audit history, and reports PASS / FAIL / BLOCKED back to ATLAS.

A deterministic PASS gate requires:
- an identifiable tested version;
- explicit evidence for every acceptance criterion;
- the changed behavior actually exercised;
- no failed required criterion or material test;
- no open P0/P1 defect.

This standalone runner complements the existing `code01_qa_checks` tool used inside CODE-01's coding loop. It does not replace or weaken that independent code-review path.
