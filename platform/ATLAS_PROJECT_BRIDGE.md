# ATLAS CEO ↔ AION Runtime Bridge

## Purpose

This bridge lets the ATLAS CEO chat delegate TrainingBot work to the real AION runtime through GitHub Issues.

Flow:

ATLAS Project Chat → GitHub issue → ATLAS CEO Dispatch Bridge → TB-01 AI → DEV-TB-01 → TrainingBot Safe Executor → QA-TB-01 AI → TB-01 → GitHub issue result → ATLAS reads result.

## Repository

Gamevalentine/ai-company

## Dispatch contract

When ATLAS decides a TrainingBot task should be delegated and the GitHub connector is available, ATLAS creates one GitHub issue in `Gamevalentine/ai-company`.

Title must start with:

`[ATLAS] `

Issue body must be valid JSON:

```json
{
  "project": "TrainingBot",
  "objective": "Natural-language goal for TB-01.",
  "scope": "TrainingBot aion-sandbox only",
  "acceptance_criteria": [
    "Concrete acceptance criterion 1",
    "Concrete acceptance criterion 2"
  ],
  "risk_level": "low",
  "execution_mode": "sandbox-only"
}
```

## Mandatory CEO rules

- ATLAS delegates only to TB-01, never directly to DEV-TB-01 or QA-TB-01.
- The bridge currently supports only TrainingBot.
- The bridge accepts only `sandbox-only` execution.
- Production deploy, merge, DNS, secrets, deletion, paid services, and other owner-gated actions must not be dispatched through this bridge.
- ATLAS must not claim the task ran unless the GitHub issue receives an AION Runtime result comment.
- After dispatch, ATLAS reads the issue comments and finds the machine-readable marker:
  `AION_RESULT`
- `READY_FOR_CEO_REVIEW` means TB-01 + DEV + QA finished the sandbox workflow and returned evidence to CEO. It does not authorize production.
- QA PASS is not production approval.

## Result contract

The runtime comments back on the same issue with a visible summary plus:

`<!-- AION_RESULT {...} -->`

ATLAS should read:
- task_id
- status
- dev_task_id / dev_status
- qa_task_id / qa_status
- manager_status

Then ATLAS performs CEO review and reports to the Owner.

## If GitHub connector is unavailable

ATLAS must say it cannot dispatch the task yet. It must not pretend that TB-01 or other Agents received the task.


## Operational hardening

The bridge now supports resilient multi-task operation.

### Completion

When the runtime returns `READY_FOR_CEO_REVIEW`, the workflow:
1. writes one `AION_RESULT` comment;
2. persists the encrypted per-task state;
3. closes the GitHub Issue as completed.

### Duplicate handling

If an Issue already contains `AION_RESULT`, the runtime must not execute the task again. The guard skips model, DEV, QA and Safe Executor work, and closes the Issue if it was reopened.

### Retry handling

A task that failed before producing `AION_RESULT` may be retried by:
- closing and reopening the same Issue; or
- manually running `ATLAS CEO Dispatch Bridge` with the Issue number.

Failures are reported with `AION_RUNTIME_FAILURE`, not `AION_RESULT`.

### Timeouts and transient retry

- Local AI calls: 120-second timeout per call, one automatic retry.
- Safe Executor dispatch: up to two dispatch attempts.
- Safe Executor watch: 12-minute timeout; timeout is converted into FAIL evidence and production remains blocked.
- State push: up to three push/rebase attempts.

### Parallel tasks

Each ATLAS issue owns an encrypted state shard:

`aion-runtime-state/tasks/ATLAS-ISSUE-N.enc.json`

Concurrency is scoped by Issue number, so different ATLAS tasks may run at the same time while duplicate runs for the same Issue remain serialized.

ATLAS should continue to treat `READY_FOR_CEO_REVIEW` as a CEO-review state, not production approval.
