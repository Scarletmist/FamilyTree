---
name: candidate-probing
description: Execute a fixed task under a declared baseline, INV, DOM or composed harness and capture observable traces and artifacts. Use when a proposal requires behavioral evidence, not merely another test run on completed code.
---

# Candidate probe execution

1. Verify the exact candidate tree, declared parent/checkpoint and fixed task. Read `harness/templates/probe.md`. Reuse the same starting application revision and inputs when evaluating workflow changes; isolate application edits and outputs across candidates.
2. Start the task in a fresh supported agent context. Record its actual instruction paths, candidate digest, application start/end revision, model, seed where available, context identity and limits. If only one contaminated context is available, label the observation non-independent instead of claiming a controlled agent probe.
3. Execute the assigned task with the candidate's intended instructions. Save the real artifacts and available action/observation/error trace. Do not insert the expected solution or later judge feedback into a solver prompt.
4. Run the fixed project verification against the produced implementation:

   ```bash
   python scripts/harness.py run --experiment TASK_ID --label inv1
   ```

   Use the schedule's actual label: base1, inv1, dom1, agg1 or c1, etc. A label does not switch source or instructions. Use `regression-validation` for result inspection.
5. Record missing delivery, exception, timeout and empty output explicitly. Preserve partial output as partial evidence; it is not a completed rollout. A valid failed regression can still show the baseline defect. Capture runtime and costs only when measured, not inferred from planned session counts.
6. Bind the run ID to the candidate artifact and task trace in probe.md. Before pooling results, verify copied records against frozen controls and content hashes. Do not combine outputs with different tasks, models, datasets or evaluator revisions silently.
7. Return evidence to `contrastive-analysis`. Resume a failed probe with a new run ID; do not overwrite failure records or silently replace them with a passing retry.
