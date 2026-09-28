# CODE-01

Standalone independent AI coding employee.

CODE-01 is an independent coding employee inside AION HQ. It does not belong to any website department and reports directly to CEO ATLAS. The Owner remains the ultimate approval authority for production risk, destructive actions, and spending.

## Files
- SYSTEM_PROMPT.md — main engineering brain
- permissions.json — authority and safety boundaries
- WORKFLOW.md — execution pipeline
- brain.mjs — local Ollama planning runner wired to the platform task store

## Run the model connection (phase 1)

Run a local Ollama server with an installed model. The default is the existing
pilot model `qwen2.5:1.5b-instruct`; override with `AION_CODE_MODEL`.
This default is not a claim that the model is sufficient for complex coding.

Create a task through the platform API or `AionPlatform.createTask()` with
`actor_id: ATLAS`, `assigned_to: CODE-01`, and an authorized project (`AION-HQ`
or `TrainingBot`). Include objective, scope, acceptance criteria, and optionally
`inputs.source_context: [{"path":"index.html","content":"..."}]`.
Supply only authorized source excerpts, never secrets. This runner does not
automatically read a repository. Context is capped at 20 excerpts / 60000
serialized characters. `OLLAMA_URL` must point to a loopback endpoint.

From `platform`, set `AION_DATA_DIR` to the same absolute data directory used by
the API runtime, then run `npm run code01 -- TASK_ID`.
Use one process at a time against this pilot file store; it has no multi-process lock.

The runner loads SYSTEM_PROMPT.md, calls Ollama with a JSON schema, validates
the response, and persists `outputs.code_plan`. It sends `CODE_PLAN_READY` to
ATLAS and records audit events. A valid proposal becomes `PLAN_READY`; missing
information becomes `WAITING_CONTEXT`. Model failure becomes `AI_FAILED` and
can be retried. Each request has a 60-second timeout, with at most two attempts.
Tasks with an existing plan are not rerun; create a follow-up task with updated
context when needed.

The planning command produces proposals only. Use the separate phase 2 runner
below for scoped editing and checks. QA/CEO acceptance remains a separate phase.
The existing GitHub encrypted-state workflows do not automatically invoke these
local file-store runners.

## Scoped tools (phase 2)

`npm run code01:execute -- TASK_ID OPERATOR_GRANT.json` runs a bounded model/tool
loop. Set `AION_DATA_DIR` as above. It accepts fresh tasks or `PLAN_READY` tasks.
No GitHub push, commit, deploy, package installation or image pull is performed.

Requirements:
- local Ollama with the selected model already installed;
- a running **Linux Docker engine** with a trusted local image containing the
  required test/build tooling (the runner uses `--pull=never`);
- an operator-owned JSON grant stored outside the model-editable workspace;
- one runner at a time against the pilot task store, with no concurrent writers.

Example grant (replace task ID and absolute paths):

```json
{
  "task_id": "TASK-EXAMPLE",
  "project": "AION-HQ",
  "repo_root": "C:/projects/example",
  "workspace_root": "C:/aion-workspaces",
  "files": ["src/sum.cjs", "tests/sum.test.cjs"],
  "editable": ["src/sum.cjs"],
  "image": "node:24-alpine",
    "commands": [{"id": "test", "argv": ["node", "--test", "tests/sum.test.cjs"]}],
    "acceptance_checks": {"Addition returns the correct sum": ["test"]},
  "command_timeout_ms": 60000
}
```

The operator controls repository, project, task, exact files, editable files,
image and command argument arrays. Never build this grant from model output or
task inputs. Use a trusted image (prefer a pinned digest), include no secret files,
and keep acceptance tests outside `editable`. All command IDs are required checks.
Only UTF-8 text files are supported in this pilot, at most 100 files / 1 MiB total
input, with a 128 KiB per-file limit. New files must be explicitly listed in both
`files` and `editable`. Symlinks, path traversal, `.git`, `.env*` and key files are
denied. This is an explicit source snapshot, not a full Git checkout.

Tools exposed to the model:
- `read_file`: read an approved snapshot file;
- `write_file`: replace/create an approved editable file, reading existing files first;
- `run_check`: select an approved command ID, never arbitrary command text;
- `diff`: inspect before/after content and SHA-256 hashes;
- `finish`: request handoff, subject to backend evidence gates.

Checks run with networking disabled, a read-only root filesystem and source
mount, no host credentials passed into the container, dropped capabilities,
non-root user, and CPU/memory/process limits. Only `/tmp` is writable, capped at
64 MiB. Build configurations that need output directories must use `/tmp`.
Dependencies must already exist in the approved image. The container is explicitly
removed even after timeout. Docker errors do not trigger a host-shell fallback.

Every edit invalidates previous check results. Handoff requires the latest result
of every required check to pass for the final revision, followed by a diff review.
Successful execution becomes `WAITING_QA`, never `COMPLETED` or `QA_PASS`.
Failure, denied tools or the 16-step default budget becoming exhausted produces
`CODE_BLOCKED` with partial changes and evidence retained. Create a new task/grant
to retry a blocked attempt; it is not silently restarted. QA failures can use the
bounded rework cycle below. Result data is stored in
`outputs.code_execution`, task evidence, audit and an ATLAS report. Snapshot paths,
before/after contents and command output remain available for review. The original
repo is not modified. Applying the result is a separate action; QA/CEO acceptance
is supported by phase 3 below.

Existing persisted stores retain their own agent registry. To enable an existing
CODE-01 record, an operator must add `code01_workspace` to its `allowed_tools`
while preserving all other state. New stores load that grant from `agents.json`.
The old TrainingBot `requestExecution()` API remains specific to its executor;
CODE-01 uses this dedicated CLI runner.

Verification: `node --test code-01-execute.test.mjs` from `platform`. Tests include
a real Node fixture check using a test-only process adapter; this does not prove
Docker isolation. Set `CODE01_TEST_IMAGE` to an existing local Node image to also
run the Docker integration test. Model responses in these tests are simulated.

## Independent QA, rework and CEO acceptance (phase 3)

`QA-01` is a separate agent reporting to ATLAS, with a check-only tool and no
source-edit permission. It does not reuse the developer's PASS: it copies the
submitted snapshot into its own workspace and reruns every approved check.
This is deterministic automated QA, not an additional LLM reviewer or a guarantee
that the supplied tests cover all product behavior.

Before execution, define nonempty task `acceptance_criteria` and add
`acceptance_checks` to the operator grant. Each exact criterion string must map
to at least one approved command ID. Keep acceptance test files out of `editable`.
Missing mappings fail QA. The same grant must be used throughout execution,
review and rework; its serialized JSON digest is stored with the execution.

Commands from `platform` with the same `AION_DATA_DIR`:

```text
npm run code01:review -- qa TASK_ID OPERATOR_GRANT.json
npm run code01:review -- cycle TASK_ID OPERATOR_GRANT.json
npm run code01:review -- ceo TASK_ID
npm run code01:review -- ceo TASK_ID --production
```

`qa` reviews an existing `WAITING_QA` execution. `cycle` runs CODE execution and
QA, returning QA feedback to CODE for at most three total execution attempts.
It stops before CEO acceptance. `ceo` is an explicit trusted-controller action.
Set `inputs.requires_production: true` when creating a production-related task;
this also forces the owner gate even if the CLI flag is omitted.

Flow:

```text
CODE_RUNNING → WAITING_QA → QA_RUNNING
  QA PASS → READY_FOR_CEO_REVIEW → CEO → COMPLETED (workspace accepted only)
                                      → WAITING_OWNER_APPROVAL (production)
  QA FAIL → NEEDS_REWORK → CODE_RUNNING → new QA task
  Third failed attempt → REWORK_LIMIT_REACHED
```

Each attempt has a unique execution ID, immutable historical result record and
file hash manifest. QA results bind to that execution and the acceptance criteria.
Rework starts in a new workspace with the prior changes reapplied and QA feedback
provided to the model; previous test passes are not reused. All attempts, child QA
tasks, messages and audit records are retained. CEO acceptance rejects an old QA
result or a source snapshot changed after QA. Generic `qaResult()` cannot mark
these child tasks PASS; they require the dedicated review runner.

`COMPLETED` here means the reviewed workspace deliverable was accepted; it does
not mean merged, pushed or deployed. Owner approval records authorization only;
it does not execute deployment. Existing production hard blocks stay in force.

For older persisted stores, the operator must also add the `QA-01` registry entry
from `agents.json` and allow ATLAS to assign to it, preserving existing tasks and
other agent fields. These commands use the trusted local file-store controller;
they are not wired into the encrypted GitHub workflow or dashboard yet. Do not
give agents the platform API key or direct write access to the state directory.

## Reproducible acceptance pilot (phase 4)

Run from `platform`, using absolute directories:

```text
npm run code01:pilot -- live ABSOLUTE_WORK_DIR ABSOLUTE_OUTPUT_DIR
npm run code01:pilot -- replay ABSOLUTE_WORK_DIR ABSOLUTE_OUTPUT_DIR
```

The pilot creates a disposable cart-total bug and three fixed acceptance cases:
empty cart, quantity multiplication, and multiple products. It must reproduce
the bug first, then runs CODE → independent QA → CEO and exports JSON evidence,
a Markdown report, a unified diff, and before/after/QA logs. It never changes
the application repository. `live` uses Ollama and Docker with no fallback and
requires both services, an installed model and the local Node container image.
Select the model with `AION_CODE_MODEL`, image with `CODE01_TEST_IMAGE`.

`replay` uses scripted model actions and a special fixture-only Node process
adapter. That adapter checks exact source/test contents against constants before
executing them, so it cannot run arbitrary model-written code on the host. This
mode validates real file edits, failing/passing checks, QA and CEO state changes,
but does not validate model reasoning or Docker isolation. Its report always
sets `live_acceptance: false`, even when the simulated task reaches COMPLETED.
Live acceptance is complete only when a `live` run returns `verified: true`.

## Intended operating mode
Give CODE-01 one project/task at a time and grant only the permissions needed for that task.

Recommended default:
- READ: ON
- EDIT: ON
- TEST: ON
- GIT WRITE: OFF until needed
- STAGING DEPLOY: OFF until needed
- PRODUCTION DEPLOY: OFF
- COST: OFF
- DESTRUCTIVE ACTIONS: OFF
