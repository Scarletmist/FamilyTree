#!/usr/bin/env python3
"""Exercise the full loop with a deterministic toy bug in a separate directory."""
import argparse
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
ADAPTER = '''import importlib.util, json, os
from pathlib import Path
root = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("demo_app", root / "demo_app.py")
app = importlib.util.module_from_spec(spec)
spec.loader.exec_module(app)
cases = [(-3, 0), (0, 0), (2, 2), (99, 10)]
failed = sum(app.clamp(v) != expected for v, expected in cases)
out = Path(os.environ["HARNESS_RUN_DIR"])
(out / "result.json").write_text(json.dumps({"schema_version": 1,
    "checks_run": len(cases), "checks_failed": failed,
    "metrics": {"cases_passed": len(cases) - failed}}))
raise SystemExit(1 if failed else 0)
'''


def demo(destination):
    if destination.exists():
        raise ValueError("Demo destination must not exist")
    shutil.copytree(ROOT, destination, ignore=shutil.ignore_patterns("__pycache__", ".git", "experiments", "*.pyc"))
    (destination / "demo_app.py").write_text("def clamp(value):\n    return min(10, value)\n", encoding="utf-8")
    (destination / "scripts/demo_project_suite.py").write_text(ADAPTER, encoding="utf-8")
    c = json.loads((destination / "harness/config.json").read_text())
    c["evaluator_files"].append("scripts/demo_project_suite.py")
    c.update(project_ready=True, data_id="synthetic-clamp-four-cases-v1", environment_id="deterministic-demo",
             metrics={"cases_passed": {"direction": "max", "min": 4, "max_regression": 0}},
             suites=[{"id": "clamp", "group": "project", "command": ["{python}", "scripts/demo_project_suite.py"],
                      "timeout_seconds": 20}])
    (destination / "harness/config.json").write_text(json.dumps(c, indent=2) + "\n")

    def call(*args, expected=0):
        p = subprocess.run([sys.executable, "scripts/harness.py", *args], cwd=destination,
                           capture_output=True, text=True)
        if p.returncode != expected:
            raise RuntimeError(f"Demo command failed ({p.returncode}): {args}\n{p.stdout}\n{p.stderr}")
        return p.stdout

    call("new", "--task", "demo", "--goal", "Clamp values into [0,10]; check four fixed cases",
         "--model", "deterministic-demo-no-llm", "--codex-version", "not-used")
    base = json.loads(call("run", "--experiment", "demo", "--label", "baseline", expected=1))["run_id"]
    # Rewrite a source file instead of a config or an acceptance rule.
    (destination / "demo_app.py").write_text("def clamp(value):\n    return max(0, min(10, value))\n", encoding="utf-8")
    cache = destination / "__pycache__"
    if cache.exists():
        shutil.rmtree(cache)
    cand = json.loads(call("run", "--experiment", "demo", "--label", "compose"))["run_id"]
    comparison = json.loads(call("compare", "--experiment", "demo", "--baseline", base, "--candidate", cand))
    call("lesson", "--experiment", "demo", "--comparison", comparison["comparison_id"],
         "--cue", "A bounded scalar clamp is being fixed",
         "--lesson", "Check both lower and upper limits before accepting this clamp implementation",
         "--limits", "Four synthetic cases only; no evidence about agent workflow quality")
    print(json.dumps({"demo": "passed", "baseline": base, "candidate": cand,
                      "comparison": comparison["comparison_id"], "project": str(destination),
                      "scope": "Synthetic implementation test; no Codex model or real project executed"}, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    target = args.output or Path(tempfile.mkdtemp(prefix="codex-harness-demo-")) / "project"
    demo(target.resolve())
