---
name: run-recovery-reporting
description: Inspect incomplete stages, configuration identity, budget use and final results of a harness experiment. Use after interruption or on status/report requests, keeping failures and observed costs distinct from planned agent work.
---

# Run recovery and reporting

1. Inspect current state before continuing:

   ```bash
   python scripts/harness_workflow.py status --experiment TASK_ID
   ```

   Check task, input, evaluator and environment identity, complete reports and evidence hashes. A directory's presence or a partial artifact is not a completion marker.
2. Reuse only complete compatible evidence. The desktop runner deliberately creates a new run instead of resuming an interrupted subprocess. Keep the failed record; rerun the missing stage under a new run ID and explain retries. Start a new experiment for changed frozen controls.
3. Follow dependencies in workflow.json. Recover the earliest required missing stage, not a later stage whose inputs are absent. Regression labels show validation evidence only; separately inspect probe.md/action traces to verify that actual agent executions occurred.
4. Report planned solver executions 4k and proposal sessions 3k separately from actual agent runs, model calls, retries, wall time and measured costs. Mark unavailable counts/costs unknown. Selector/reflection/judge work is additional, not hidden inside these identities.
5. Write an immutable summary:

   ```bash
   python scripts/harness_workflow.py report --experiment TASK_ID --output harness/experiments/TASK_ID/reports/REPORT_ID.json
   ```

6. Read the output and any detected invalid comparison evidence before claiming completion. A report can be written while the experiment is incomplete; missing labels, unknown agent execution count or unavailable evaluation remain limitations.
7. Summarize selected behavior, outputs, metric changes, selection policy, failed/incomplete stages, adopted lesson and transfer limits. Use `harness/templates/recovery.md` for interrupted-stage decisions. Do not overwrite earlier reports, zero-fill missing scores or claim Windows/GPU/app validation from Linux-only checks.
