import argparse
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


def module(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


h = module("harness")
installer = module("install_harness")
GOOD = {"schema_version": 1, "checks_run": 2, "checks_failed": 0, "metrics": {"error": 0.10}}
RULE = {"error": {"direction": "min", "max": 0.15, "max_regression": 0.01, "min_improvement": 0.005}}


class HarnessTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "project"
        self.root.mkdir()
        for rel in ("harness/config.json", "docs/acceptance_criteria.md", "AGENTS.md",
                    "scripts/harness.py", "scripts/harness_self_check.py", "tests/harness/test_harness.py",
                    "harness/templates/plan.md", "harness/templates/decision.md", "harness/templates/reflection.md"):
            dest = self.root / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(ROOT / rel, dest)
        (self.root / "harness/lessons.md").write_text("# Lessons\n", encoding="utf-8")
        self.c = h.read_json(self.root / "harness/config.json")
        # This unit fixture evaluates the core runner in isolation from the full workflow package.
        self.c["evaluator_files"] = ["scripts/harness.py"]
        self.c.update(project_ready=True, data_id="fixture-v1", environment_id="unit-test", metrics=RULE)
        self.set_command("import json, os; from pathlib import Path; "
                         + f"Path(os.environ['HARNESS_RUN_DIR'],'result.json').write_text({json.dumps(GOOD)!r})")

    def set_command(self, code, timeout=10):
        self.c["suites"] = [{"id": "project-test", "group": "project", "command": ["{python}", "-c", code],
                             "timeout_seconds": timeout}]
        h.write_json(self.root / "harness/config.json", self.c)

    def cli(self, *args):
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            return h.main(["--root", str(self.root), *args])

    def new(self, name="test"):
        self.assertEqual(self.cli("new", "--task", name, "--goal", "Fix fixture without regression"), 0)

    def run_one(self, label="baseline"):
        self.assertIn(self.cli("run", "--experiment", "test", "--label", label), (0, 1))
        run_dir = next((self.root / "harness/experiments/test/runs").glob(label + "-*"))
        return h.read_json(run_dir / "report.json"), run_dir

    def test_real_suite_emits_evidence(self):
        self.new()
        report, folder = self.run_one()
        self.assertEqual(report["status"], "passed")
        self.assertEqual(report["metrics"], {"error": 0.1})
        self.assertEqual(report["suites"][0]["checks_run"], 2)
        self.assertTrue((folder / "suites/project-test/output.log").is_file())
        h.load_run(folder.parents[1], report["run_id"])

    def test_unconfigured_project_cannot_pass(self):
        self.c["project_ready"] = False
        h.write_json(self.root / "harness/config.json", self.c)
        self.new()
        self.assertEqual(self.cli("run", "--experiment", "test", "--label", "baseline"), 2)

    def test_config_change_invalidates_experiment(self):
        self.new()
        self.c["data_id"] = "fixture-v2"
        h.write_json(self.root / "harness/config.json", self.c)
        self.assertEqual(self.cli("run", "--experiment", "test", "--label", "baseline"), 2)

    def test_task_cannot_be_overwritten(self):
        self.new()
        self.assertEqual(self.cli("new", "--task", "test", "--goal", "Changed"), 2)
        self.assertIn("Fix fixture", (self.root / "harness/experiments/test/task.md").read_text())

    def test_acceptance_change_invalidates_experiment(self):
        self.new()
        (self.root / "docs/acceptance_criteria.md").write_text("Changed criteria")
        self.assertEqual(self.cli("run", "--experiment", "test", "--label", "baseline"), 2)

    def test_task_edit_invalidates_experiment(self):
        self.new()
        (self.root / "harness/experiments/test/task.md").write_text("Changed task")
        self.assertEqual(self.cli("run", "--experiment", "test", "--label", "baseline"), 2)

    def test_missing_result_does_not_pass(self):
        self.set_command("print('PASS')")
        self.new()
        report, _ = self.run_one()
        self.assertEqual(report["status"], "failed")
        self.assertEqual(report["suites"][0]["status"], "error")

    def test_zero_checks_rejected(self):
        value = dict(GOOD, checks_run=0, checks_failed=0)
        with self.assertRaises(h.HarnessError):
            h.validate_result(value)

    def test_nonfinite_metrics_rejected(self):
        with self.assertRaises(h.HarnessError):
            h.validate_result(dict(GOOD, metrics={"error": float("nan")}))

    def test_nonzero_exit_cannot_pass(self):
        self.set_command("import json, os; from pathlib import Path; "
                         + f"Path(os.environ['HARNESS_RUN_DIR'],'result.json').write_text({json.dumps(GOOD)!r}); "
                         + "raise SystemExit(7)")
        self.new()
        report, _ = self.run_one()
        self.assertEqual(report["status"], "failed")
        self.assertEqual(report["suites"][0]["exit_code"], 7)

    def test_timeout_is_recorded(self):
        self.set_command("import time; time.sleep(10)", timeout=0.1)
        self.new()
        report, _ = self.run_one()
        self.assertEqual(report["status"], "failed")
        self.assertEqual(report["suites"][0]["status"], "timeout")

    def test_evidence_edits_are_detected(self):
        self.new()
        report, folder = self.run_one()
        (folder / "suites/project-test/result.json").write_text("{}")
        with self.assertRaises(h.HarnessError):
            h.load_run(folder.parents[1], report["run_id"])

    def test_paths_cannot_escape(self):
        for path in ("../x", "/tmp/x"):
            with self.assertRaises(h.HarnessError):
                h.local(self.root, path)
        self.assertEqual(self.cli("new", "--task", "../oops", "--goal", "x"), 2)

    def test_lesson_without_comparison_cannot_be_written(self):
        self.new()
        self.assertEqual(self.cli("lesson", "--experiment", "test", "--comparison", "missing",
                                 "--cue", "x", "--lesson", "y", "--limits", "z"), 2)
        self.assertFalse((self.root / "harness/lessons.jsonl").exists())

    def test_input_content_change_invalidates_experiment(self):
        (self.root / "data.json").write_text("{\"revision\": 1}")
        self.c["input_files"] = ["data.json"]
        h.write_json(self.root / "harness/config.json", self.c)
        self.new()
        (self.root / "data.json").write_text("{\"revision\": 2}")
        self.assertEqual(self.cli("run", "--experiment", "test", "--label", "baseline"), 2)

    def test_evaluator_code_change_invalidates_experiment(self):
        self.new()
        with (self.root / "scripts/harness.py").open("a") as out:
            out.write("\n# changed evaluator\n")
        self.assertEqual(self.cli("run", "--experiment", "test", "--label", "baseline"), 2)

    def test_complete_compare_and_lesson_pipeline(self):
        state = self.root / "implementation_metric.json"
        state.write_text("0.12")
        self.set_command("import json, os; from pathlib import Path; "
                         + f"v={GOOD!r}; v['metrics']['error']=json.loads(Path('implementation_metric.json').read_text()); "
                         + "Path(os.environ['HARNESS_RUN_DIR'],'result.json').write_text(json.dumps(v))")
        self.new()
        base, _ = self.run_one()
        state.write_text("0.10")
        cand, _ = self.run_one("compose")
        self.assertEqual(self.cli("compare", "--experiment", "test", "--baseline", base["run_id"],
                                 "--candidate", cand["run_id"]), 0)
        comparison = next((self.root / "harness/experiments/test/comparisons").glob("*.json")).stem
        self.assertEqual(self.cli("lesson", "--experiment", "test", "--comparison", comparison,
                                 "--cue", "Fixture", "--lesson", "Bounded fixture observation", "--limits", "Synthetic only"), 0)
        value = json.loads((self.root / "harness/lessons.jsonl").read_text())
        self.assertEqual(value["confidence"], "task-local")
        self.assertEqual(value["lesson"], "Bounded fixture observation")
        self.assertIn(comparison, (self.root / "harness/lessons.md").read_text())


class ComparisonTests(unittest.TestCase):
    def records(self, a=0.12, b=0.10):
        common = {"comparison_key": "same", "group": "project", "status": "passed"}
        return dict(common, run_id="baseline-1", metrics={"error": a}), dict(common, run_id="candidate-1", metrics={"error": b})

    def check(self, a=0.12, b=0.10):
        return h.compare_records(*self.records(a, b), RULE)

    def test_valid_improvement(self):
        self.assertTrue(self.check()["eligible"])

    def test_unchanged_result_keeps_baseline(self):
        self.assertFalse(self.check(0.10, 0.10)["eligible"])

    def test_worse_candidate_rejected(self):
        self.assertFalse(self.check(0.10, 0.14)["eligible"])

    def test_absolute_acceptance_enforced(self):
        self.assertFalse(self.check(0.30, 0.20)["eligible"])

    def test_different_controls_rejected(self):
        a, b = self.records()
        b["comparison_key"] = "different"
        self.assertFalse(h.compare_records(a, b, RULE)["eligible"])

    def test_harness_checks_not_project_evidence(self):
        a, b = self.records()
        b["group"] = "harness"
        self.assertFalse(h.compare_records(a, b, RULE)["eligible"])

    def test_missing_required_metric_rejected(self):
        a, b = self.records()
        a["metrics"] = {}
        self.assertFalse(h.compare_records(a, b, RULE)["eligible"])

    def test_direction_max_supported(self):
        a, b = self.records(0.9, 0.95)
        rules = {"error": {"direction": "max", "min": 0.8}}
        self.assertTrue(h.compare_records(a, b, rules)["eligible"])

    def test_pass_after_failure_can_improve_without_metrics(self):
        a, b = self.records()
        a.update(status="failed", metrics={})
        b["metrics"] = {}
        self.assertTrue(h.compare_records(a, b, {})["eligible"])


class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        self.src, self.dst = self.base / "source", self.base / "target"
        self.src.mkdir()
        (self.src / "AGENTS.md").write_text("template")

    def call(self, apply=False):
        with contextlib.redirect_stdout(io.StringIO()):
            return installer.install(self.src, self.dst, apply)

    def test_dry_run_writes_nothing(self):
        self.assertEqual(self.call(), 1)
        self.assertFalse(self.dst.exists())

    def test_conflict_blocks_all_writes(self):
        self.dst.mkdir()
        (self.dst / "AGENTS.md").write_text("keep mine")
        (self.src / "new.py").write_text("x=1")
        with self.assertRaises(ValueError):
            self.call(True)
        self.assertEqual((self.dst / "AGENTS.md").read_text(), "keep mine")
        self.assertFalse((self.dst / "new.py").exists())

    def test_repeat_install_is_idempotent(self):
        self.assertEqual(self.call(True), 1)
        self.assertEqual(self.call(True), 0)

    @unittest.skipIf(os.name == "nt", "Symlink creation may require Windows privileges")
    def test_symlink_destination_rejected(self):
        outside = self.base / "outside"
        outside.mkdir()
        self.dst.mkdir()
        (self.dst / "AGENTS.md").symlink_to(outside / "file.md")
        with self.assertRaises(ValueError):
            self.call(True)
        self.assertFalse((outside / "file.md").exists())


if __name__ == "__main__":
    unittest.main()
