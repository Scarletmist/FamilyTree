---
name: experiment-comparison
description: Compare alternative harness instructions, debugging procedures, parameters or algorithms using a frozen task and baseline evidence. Use for multiple plausible approaches, repeated failed fixes or a proposed change to persistent project workflows.
---

# Experiment comparison

For the complete recursive method, use `.agents/skills/harness-orchestration/SKILL.md`. This skill is the convenient engineering comparison entry; INV/DOM generation, evidence construction, probing, composition, selection, reflection, experience and evaluation each have their own stage skill in `harness/skills.json`.

1. Read `docs/architecture.md`, acceptance criteria and matching lessons. Declare the experiment type: **workflow** (change agent procedure) or **implementation** (change code or parameters). Record mixed changes as mixed; do not attribute their effect to the harness alone.
2. Configure actual project suites and numerical acceptance rules. Freeze data, environment, acceptance, evaluator and task using:

   ```bash
   python scripts/harness.py new --task TASK_ID --goal "CONCRETE_GOAL" --model "OBSERVED_MODEL" --codex-version "OBSERVED_VERSION"
   ```

   Complete `harness/experiments/TASK_ID/plan.md` with scope, seed/repetition policy, hypotheses and budget. Default to one round, one INV proposal and one DOM proposal.
3. Capture baseline before applying the change. For a workflow comparison, run the identical task from the same starting application commit in separate fresh Codex threads and isolated project copies/worktrees. Re-running tests on already-fixed code does not measure whether a workflow improved the agent. Record actual model and instruction sources; do not imply the runner can discover hidden prompts or token usage.
4. Propose INV: a general workflow change, such as testing input identity before tuning a threshold. Propose DOM: a change specific to the task family, such as checking timestamp units for a sensor pipeline. Change one main factor per proposal when feasible. Keep each proposal's instructions, starting revision, artifacts, commands and result separate.
5. Probe each candidate with the same task and controls. Use the regression command to capture measurable application outcomes. Record agent actions, effort and rejected hypotheses in the plan or linked evidence; the script does not collect desktop conversation traces.
6. Compose only changes supported by the contrasts. Run the composed candidate again; do not assume two good edits combine well. Compare it against baseline:

   ```bash
   python scripts/harness.py compare --experiment TASK_ID --baseline BASELINE_RUN_ID --candidate COMPOSED_RUN_ID
   ```

7. Treat `eligible: true` as a deterministic check of the configured metrics. Inspect its limits, output artifacts and the actual task outcome before adoption. Keep baseline on rejection or a tie. A current-task fix may be kept under existing authorization even when a proposed general workflow is not adopted.
8. Record the decision and reflection. After supported adoption, run `lesson` with the comparison ID and a cue, lesson and limits. A single comparison supports task-local confidence only; validate on different tasks or held-out datasets before adding a general rule to `AGENTS.md` or a skill.
9. Apply adopted procedure edits explicitly to the repository, review the diff and verify them in a fresh thread. The harness script does not hot-swap instructions, invoke nested agents or install personal skills.
