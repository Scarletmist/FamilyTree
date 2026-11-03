---
name: candidate-selection
description: Choose a task output and decide whether its harness is supported for adoption after composition probes. Use to inspect eligible artifacts, optionally conduct a blind comparison, or retain baseline on inconclusive evidence.
---

# Candidate selection and adoption decision

1. Confirm the declared selection policy before seeing later scores. The default engineering policy preserves the baseline, unlike the upstream finals-only pool. If reproducing upstream selection, explicitly restrict to agg1..aggk/c1..ck and document k=1 direct selection. Do not silently present one policy as the other.
2. Inspect the complete candidate outputs for correctness, requested shape, usability, internal consistency and missing deliverables. A command succeeding is not artifact quality. Use `harness/templates/selection.md` and link the raw artifacts.
3. For engineering mode, compare each viable final against its corresponding baseline:

   ```bash
   python scripts/harness.py compare --experiment TASK_ID --baseline BASELINE_RUN_ID --candidate FINAL_RUN_ID
   ```

   All required metrics must be present, the candidate must pass absolute bounds, no metric may exceed its regression tolerance, and a measurable improvement is required. Ties retain baseline. An eligible result is a machine condition, not automatic acceptance of a prompt's generality.
4. If blind artifact comparison is useful, create anonymous artifact-only packages and keep their label mapping outside the selector context. Use a fresh independent selector context when available; otherwise declare the review unblinded. The helper does not provide automatic anonymization or independent model sessions.
5. Commit the chosen run, actual artifact paths, reasons, policy, inspection findings and unresolved limitations in selection.md/decision.md. Keep task-output selection separate from a claim that a universal harness improved.
6. On selector failure or no acceptable final, retain a valid delivered baseline or mark the task incomplete; never convert missing delivery into a fabricated choice. An upstream replication may instead need to report no valid final under its policy.
7. Route the committed choice to reflection and separately to post-selection evaluation. Do not use a later hold-out or benchmark score retroactively to rewrite the already recorded decision.
