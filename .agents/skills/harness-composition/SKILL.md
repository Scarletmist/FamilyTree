---
name: harness-composition
description: Compose a refined harness from supported INV, DOM and earlier checkpoint edits. Use after contrastive analysis in parallel aggregation or a sequential recursion round, resolving interactions and preserving provenance.
---

# Harness composition

1. Read the declared current parent, every relevant candidate artifact and contrast. In parallel mode, compose from the complete 2k candidate pool; produce k independent compositions when the budget requires it. In sequential mode, include accumulated earlier candidates/checkpoints, not only the last two proposals.
2. Use `harness/templates/composition.md` to record kept, revised, dropped and restored edits, each tied to a trace moment or repeated baseline pattern. Do not concatenate all instructions or resolve disagreement by counting votes.
3. Keep one whole candidate, merge supported parts, restore an earlier state, or KEEP_CURRENT. In sequential mode KEEP_CURRENT means retain the current checkpoint; restoring the original base is a separate explicit action.
4. Resolve overlapping triggers, conflicting constraints, duplicate scripts, missing references and context growth. Preserve applicable existing rules and scopes. A valid-looking composition can reintroduce a failure through interaction.
5. Validate the actual file tree with `harness-surface-validation`. Reject off-surface files, evaluator edits or unsupported integrations; repair at most once by default and retain the valid parent if needed.
6. Probe the exact composed version using `candidate-probing` before selecting it. Prior probes of its parts do not verify the combination. Store the resulting aggN/cN identity and evidence.
7. Pass the composed candidates to `candidate-selection`; never claim adoption solely from the composer deciding its own output is best.
