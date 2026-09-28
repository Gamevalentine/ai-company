# PERF-01

Performance optimization employee inside AION HQ.

PERF-01 reports directly to CEO ATLAS and is not attached to a website department. Its job is to measure, diagnose, optimize, and verify website/system performance while preserving product behavior.

## Files
- SYSTEM_PROMPT.md — performance engineering brain
- permissions.json — authority and safety boundaries
- WORKFLOW.md — measurement and optimization pipeline
- ../perf-01-brain.mjs — executable performance evidence-analysis runner
- ../perf-01-brain.test.mjs — hard-gate and handoff tests

## Default operating mode
- READ: ON
- BENCHMARK/PROFILE: ON
- RECOMMEND: ON
- EDIT: OFF until authorized for the task
- TEST: ON
- GIT WRITE: OFF until needed
- STAGING DEPLOY: OFF until needed
- PRODUCTION DEPLOY: OFF
- COST: OFF
- DESTRUCTIVE ACTIONS: OFF

## Reporting line
OWNER → CEO ATLAS → PERF-01


## Executable runner

From `platform`, PERF-01 can process an ATLAS-assigned task with:

`npm run perf01 -- run --state <STATE_FILE> --task-id <TASK_ID>`

The runner consumes authorized `inputs.performance_evidence` such as baseline and after measurements. It validates comparability, computes metric deltas, records a structured `outputs.performance_handoff`, stores evidence/audit history, and reports back to ATLAS.

The runner does **not** pretend that it executed Lighthouse, PageSpeed, profiling, or production measurements by itself. When evidence is missing or not comparable, hard gates force `NEEDS_MEASUREMENT`. When comparable evidence shows a regression, hard gates force `NEEDS_ATTENTION`.
