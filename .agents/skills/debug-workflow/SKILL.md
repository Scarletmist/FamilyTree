---
name: debug-workflow
description: Diagnose project bugs, wrong outputs, crashes or regressions using a reproducible case, bounded hypotheses and targeted verification. Use before changing code to fix an observed defect.
---

# Debug workflow

1. Read applicable `AGENTS.md` instructions, `docs/architecture.md`, relevant acceptance criteria and recent decisions. Inspect current code and user changes.
2. Reproduce the smallest useful failure in the correct environment. Record the input revision, command, expected behavior, actual behavior and evidence path. Mark a reproduction unavailable when dependencies or input are missing.
3. Identify the earliest observable divergence. Write a short hypothesis with a check that could falsify it. Distinguish a data problem, environment problem, algorithm problem and interface problem when evidence permits.
4. Run the cheapest discriminating check. Make a bounded fix only when the evidence supports it. Reuse existing diagnostics and tests. Add a regression case for a meaningful bug when the existing suite does not cover it.
5. Run the focused check and the relevant project regression. Use `scripts/harness.py run` for a recorded experiment only after configuring real project suites; use existing verification directly for a small fix.
6. If competing explanations remain or an approach fails, use `experiment-comparison`. Do not keep changing multiple variables without recording them.
7. Report cause, change, verification and remaining uncertainty. Add a durable decision only if it changes a lasting project contract. Add a lesson only with supporting evidence and an applicability limit.

Keep data units, coordinate frames, timestamps and interface schemas explicit when debugging sensor, geometry or mission-ingestion code. A plausible visualization alone does not verify numerical correctness.
