---
name: regression-validation
description: Validate runtime, interface, algorithm and build changes against relevant project checks and acceptance metrics. Use after implementation or before claiming a defect or regression is fixed.
---

# Regression validation

1. Read the acceptance entries affected by the change and inspect `harness/config.json`. Use the repository's actual tests and build commands. Resolve dependency or configuration gaps without fabricating results.
2. For a normal fix, run focused checks first, then the relevant existing regression. For a recorded comparison, create the experiment before collecting baseline evidence and run all compared versions with frozen task, config, data and environment identities.
3. Execute the configured project suites using:

   ```bash
   python scripts/harness.py run --experiment TASK_ID --label LABEL
   ```

   Use `python3` on systems where that is the Python 3 command. Read `docs/CODEX_DESKTOP_SETUP.md` for the evidence adapter contract.
4. Inspect exit codes, executed check counts, failed checks, required metrics and output artifacts. Missing `result.json`, zero checks, non-finite metrics, nonzero exits and timeouts fail validation. A required metric outside its bound fails acceptance even if unit tests pass.
5. Keep harness self-tests separate: `--group harness` verifies orchestration only. Do not claim that these tests validate the application or a real dataset.
6. If a check fails, inspect `output.log` and the suite result. Fix the cause or report the block. Do not edit acceptance thresholds, erase failing tests, relabel real data as test fixtures or overwrite old run evidence.
7. Report the relevant commands, results, metrics and evidence paths. Report unrun hardware, WSL, Windows or container checks as unverified. Expand testing when new evidence warrants it, not by mechanically repeating passing checks.
