---
name: outcome-evaluation
description: Evaluate a committed harness result using an independent benchmark judge, held-out tasks or project acceptance after selection. Use to measure final outcome and transfer without leaking evaluation feedback into the prior improvement cycle.
---

# Post-selection outcome evaluation

1. Read the committed selection and identify the measurement protocol. Distinguish project regression already used as public engineering evidence from a hidden benchmark judge or independent held-out evaluation.
2. Execute only a real available evaluator with its actual dependencies and approved inputs. Use `harness/templates/outcome.md` to record evaluator version, task/data identity, model/judge identity where observed, invocation, selected artifact and result location. No benchmark adapter is bundled merely because this skill exists.
3. For benchmarks, keep judge inputs and outputs outside proposal/composition contexts. Apply the same mode, k, subset and seed to refined/base comparisons. A hold-out result is for evaluating this selection, not retroactively choosing its candidate.
4. Preserve failed, interrupted or unavailable judgments as unscored with the error. Do not replace them with zero, omit them silently from an aggregate denominator or claim their absence is evidence of success.
5. If measuring transfer, test different tasks/datasets under declared controls and report sample count and uncertainty. One task-local improvement does not establish generalization or replicate the upstream benchmark gains.
6. Treat feedback used for a later change as new development evidence, requiring a new experiment and a fresh evaluation set when independence matters. Document the boundary explicitly.
7. Link evaluation to reporting. Promote a reusable procedure through `experience-library` only after inspecting valid transfer evidence; otherwise retain the narrower confidence already recorded.
