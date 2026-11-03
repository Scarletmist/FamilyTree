---
name: adoption-reflection
description: Distill evidence-supported lessons after a task output and harness choice has been committed. Use to analyze which edits survived, why alternatives failed and what can safely transfer to future tasks.
---

# Adoption reflection

1. Read the committed selection, base/current/chosen trees, candidate probes and per-edit decisions. Resolve anonymous IDs through the coordinator mapping after selection. Reflection must explain the actual chosen state, including KEEP_CURRENT or baseline retention.
2. Use `harness/templates/reflection.md` to state which edits were kept/revised/dropped/restored and their observed effects. Distinguish the selector's reason from evidence of actual correctness; neither is a hidden ground truth.
3. Extract a cue, actionable lesson, precise evidence locations, confidence and applicability limits. Record contradictions and unsuccessful approaches. Do not invent causal success where no fresh workflow probe was run.
4. Separate verified task facts from transferable procedure. Keep task facts in task-local artifacts; later retrieval must reverify them. A single task gives task-local confidence, even when the output is accepted.
5. When default engineering comparison supports adoption, append through the runner:

   ```bash
   python scripts/harness.py lesson --experiment TASK_ID --comparison COMPARISON_ID --cue "TRIGGER" --lesson "SUPPORTED_PROCEDURE" --limits "APPLICABILITY_LIMITS"
   ```

6. A rejected or inconclusive candidate can yield a useful hypothesis or failure observation. Preserve it in reflection.md with its uncertainty; the runner correctly refuses to mark it as a verified adopted lesson without eligible comparison. Do not bypass that guard by editing the journal.
7. Hand the supported reflection to `experience-library`. Do not automatically add more always-on rules or change the task's selected output during reflection.
