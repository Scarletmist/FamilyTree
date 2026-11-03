---
name: experiment-setup
description: Define reproducible task, domain, acceptance, evaluation adapter and recursion budget before baseline collection. Use at the start of a new harness experiment or when its frozen controls must change.
---

# Experiment setup

1. Read current architecture, acceptance and relevant decisions. Identify domain, deliverables, permitted edits and observable completion. Inspect the actual code before naming commands or interfaces.
2. Set `harness/config.json` with real project suites and adapters. Record dataset identities and content manifests; list evaluator dependencies in `evaluator_files`. Keep subject application code outside the frozen evaluator set. Follow `regression-validation` for its result contract.
3. Use `executor-adaptation` to identify available tools, isolated task contexts, dependency environment and any proposed plugin or role configuration. Do not change global settings to fit this template.
4. Retrieve only earlier applicable experience through `experience-library`; reverify any task facts. Freeze the task before collecting baseline:

   ```bash
   python scripts/harness.py new --task TASK_ID --goal "CONCRETE_GOAL" --model "OBSERVED_MODEL" --codex-version "OBSERVED_VERSION"
   python scripts/harness_workflow.py schedule --experiment TASK_ID --mode sequential --k 1
   ```

5. Fill `harness/templates/plan.md` in the created experiment. Record domain and chronological position, experiment type, initial application commit/patch, source identity, task contexts, seeds, repetitions, k, mode and stop conditions. Keep unseen hold-out outcomes out of proposal evidence.
6. Use k base agent executions for a faithful recursion experiment, not k test reruns on one completed implementation. Declare a lower-cost engineering approximation when using fewer executions.
7. A changed task, metric, evaluator, input identity or environment requires a new experiment. A different mode or k requires a new schedule/experiment rather than silently reusing incompatible work. `project_ready=false` is a setup block, not an invitation to report harness self-tests as project success.
