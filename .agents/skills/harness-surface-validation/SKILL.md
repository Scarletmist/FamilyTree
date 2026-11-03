---
name: harness-surface-validation
description: Validate proposed harness paths, instructions, skills, scripts and integration files before execution or adoption. Use after generating or composing a candidate, or when a proposal fails structural validation.
---

# Harness surface validation

1. Review the candidate diff against its declared parent. Check editable paths and preserve unrelated project changes. Reject absolute paths, traversal, unexpected symlink destinations, missing helper files and edits outside the authorized scope.
2. Keep frozen evaluator/input/acceptance files unchanged within the experiment. Changing runner logic or evaluator dependencies is a new experiment even if the command string stays identical. Harness helper improvements must be evaluated under a separately fixed evaluator.
3. Validate skill frontmatter, matching names, concise descriptions, explicit inputs/outputs, triggers and reference paths. Run the catalog check for the installed template:

   ```bash
   python scripts/harness_workflow.py catalog
   ```

   Proposed additional skills need not be in the core catalog, but validate their structure and explicit routing. Remove references to scripts that were read in a prior experience entry but never copied into this candidate.
4. Use syntax checks on scripts before execution; do not execute unreviewed candidate code merely to inspect it. Check shell quoting, platform assumptions and error behavior. Validate plugin/hook/role schemas only against the host's observed support through `executor-adaptation`.
5. Keep AGENTS short and route conditional guidance to skills. Check for conflicting completion rules, stale workspace facts, acceptance weakening, answer leakage, unsupported commands and unbounded retries.
6. Record concrete errors and return them to the proposing/composing stage. Default to one repair attempt; retain the valid parent on persistent rejection. Validation success means a candidate is structurally eligible to probe, not that its task output improved.
