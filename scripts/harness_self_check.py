#!/usr/bin/env python3
"""Run harness tests and emit the same evidence contract as project adapters."""
import json
import os
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
suite = unittest.defaultTestLoader.discover(str(ROOT / "tests/harness"), pattern="test_*.py")
result = unittest.TextTestRunner(verbosity=2).run(suite)
out = os.environ.get("HARNESS_RUN_DIR")
if out:
    directory = Path(out)
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "result.json").write_text(json.dumps({
        "schema_version": 1, "checks_run": result.testsRun,
        "checks_failed": len(result.failures) + len(result.errors), "metrics": {}
    }, indent=2) + "\n", encoding="utf-8")
raise SystemExit(0 if result.testsRun > 0 and result.wasSuccessful() else 1)
