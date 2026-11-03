---
name: harness-orchestration
description: Coordinate a complete Harness2 task-level and cross-task improvement cycle. Use when starting or continuing recursive harness improvement, selecting parallel versus sequential recursion, or coordinating the other stage skills.
---

# Harness orchestration

1. Read project instructions and `docs/WORKFLOW_COVERAGE.md`. Distinguish application implementation, harness improvement and a mixed experiment. Use a direct fix for a small ordinary bug; do not force every edit through all stages.
2. Follow `.agents/skills/experiment-setup/SKILL.md` to freeze the task, domain, starting application revision, evaluator, data, model identity and budget. Default to sequential k=1 unless the task authorizes a larger budget. An explicit request for parallel work controls delegation; otherwise retain independent candidate contexts through fresh tasks or isolated copies where available.
3. Generate the dependency plan after `new`:

   ```bash
   python scripts/harness_workflow.py schedule --experiment TASK_ID --mode sequential --k 1
   ```

4. Obtain k reference executions of the same base harness. Build evidence using `evidence-context`. Route INV and DOM to `invariant-proposal` and `domain-proposal`; validate their edits with `harness-surface-validation`, then execute each using `candidate-probing`.
5. For parallel mode, all 2k proposals start from the same base and k compositions see the full probe pool. Do not let one proposal read its peer's proposal before producing its own. For sequential mode, round t edits the current checkpoint, reads the unchanged original baseline set and accumulated history, and records KEEP_CURRENT distinctly from restoring the original base.
6. Use `contrastive-analysis`, then `harness-composition`; probe every composed version. Selecting text without running the composition leaves it unverified.
7. Use `candidate-selection` to commit the task outcome. Use `adoption-reflection`, then `experience-library`, for supported knowledge. Run `outcome-evaluation` after selection when a separate held-out or benchmark evaluation exists. Finish through `run-recovery-reporting`.
8. Respect dependency and budget boundaries. The planned solver identity is 4k and the proposal identity is 3k, excluding selector, reflection and retries. The helper produces a plan, not model executions. Regression invocations are not automatically equivalent to agent rollouts.
9. Preserve a valid current harness when a proposal is invalid or evidence is inconclusive. Retry an invalid proposal at most once by default, record the rejected artifact and feedback, and stop when the agreed budget or an actual environment block is reached. Do not invent missing capability or require redundant permission for already-authorized reversible work.
