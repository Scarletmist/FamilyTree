import contextlib
import importlib.util
import io
import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
import harness_workflow as wf


class ScheduleTests(unittest.TestCase):
    def test_parallel_budget_identity_and_shared_pool(self):
        plan = wf.make_schedule("parallel", 3)
        stages = {s["id"]: s for s in plan["stages"]}
        self.assertEqual(sum(s["kind"] == "execution" for s in stages.values()), 12)
        self.assertEqual(sum(s["kind"] == "proposal" for s in stages.values()), 9)
        for i in range(1, 4):
            self.assertEqual(stages[f"propose-inv{i}"]["depends_on"], ["base1", "base2", "base3"])
            for p in ("inv", "dom"):
                for n in range(1, 4):
                    self.assertIn(f"{p}{n}", stages[f"compose-agg{i}"]["depends_on"])

    def test_sequential_uses_checkpoint_and_accumulated_history(self):
        plan = wf.make_schedule("sequential", 3)
        stages = {s["id"]: s for s in plan["stages"]}
        self.assertIn("c1", stages["propose-inv2"]["depends_on"])
        self.assertIn("c2", stages["propose-dom3"]["depends_on"])
        self.assertIn("inv1", stages["compose-c3"]["depends_on"])
        self.assertIn("c1", stages["compose-c3"]["depends_on"])
        self.assertEqual(sum(s["kind"] == "execution" for s in stages.values()), 12)

    def test_schedule_is_topological(self):
        for mode in ("parallel", "sequential"):
            seen = set()
            for s in wf.make_schedule(mode, 4)["stages"]:
                self.assertTrue(set(s["depends_on"]).issubset(seen))
                seen.add(s["id"])

    def test_invalid_budget_rejected(self):
        for value in (0, -1, 101, True):
            with self.assertRaises(wf.h.HarnessError):
                wf.make_schedule("parallel", value)


class WorkflowTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "project"
        shutil.copytree(ROOT, self.root, ignore=shutil.ignore_patterns("experiments", "__pycache__", "*.pyc"))
        c = wf.h.read_json(self.root / "harness/config.json")
        result = {"schema_version": 1, "checks_run": 1, "checks_failed": 0, "metrics": {}}
        code = "import os; from pathlib import Path; " + f"Path(os.environ['HARNESS_RUN_DIR'],'result.json').write_text({json.dumps(result)!r})"
        c.update(project_ready=True, data_id="fixture", environment_id="test",
                 suites=[{"id": "fixture", "group": "project", "command": ["{python}", "-c", code], "timeout_seconds": 10}])
        wf.h.write_json(self.root / "harness/config.json", c)
        with contextlib.redirect_stdout(io.StringIO()):
            rc = wf.h.main(["--root", str(self.root), "new", "--task", "test", "--goal", "Fixture"])
        self.assertEqual(rc, 0)

    def cli(self, *args):
        out = io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(io.StringIO()):
            rc = wf.main(["--root", str(self.root), *args])
        return rc, out.getvalue()

    def run_one(self):
        with contextlib.redirect_stdout(io.StringIO()):
            rc = wf.h.main(["--root", str(self.root), "run", "--experiment", "test", "--label", "base1"])
        self.assertEqual(rc, 0)
        return next((self.root / "harness/experiments/test/runs").iterdir())

    def test_complete_catalog(self):
        rc, out = self.cli("catalog")
        self.assertEqual(rc, 0)
        self.assertEqual(json.loads(out)["count"], 18)

    def test_missing_skill_rejected(self):
        (self.root / ".agents/skills/domain-proposal/SKILL.md").unlink()
        self.assertEqual(self.cli("catalog")[0], 2)

    def test_missing_template_rejected(self):
        (self.root / "harness/templates/proposal.md").unlink()
        self.assertEqual(self.cli("catalog")[0], 2)

    def test_missing_linked_document_rejected(self):
        (self.root / "docs/WORKFLOW_COVERAGE.md").unlink()
        self.assertEqual(self.cli("catalog")[0], 2)

    def test_duplicate_skill_rejected(self):
        path = self.root / "harness/skills.json"
        c = wf.h.read_json(path)
        c["skills"].append(c["skills"][0])
        wf.h.write_json(path, c)
        self.assertEqual(self.cli("catalog")[0], 2)

    def test_unknown_handoff_rejected(self):
        path = self.root / "harness/skills.json"
        c = wf.h.read_json(path)
        c["skills"][0]["next"] = ["missing-skill"]
        wf.h.write_json(path, c)
        self.assertEqual(self.cli("catalog")[0], 2)

    def test_schedule_idempotent_and_change_rejected(self):
        args = ("schedule", "--experiment", "test", "--mode", "parallel", "--k", "2")
        self.assertEqual(self.cli(*args)[0], 0)
        self.assertEqual(self.cli(*args)[0], 0)
        self.assertEqual(self.cli("schedule", "--experiment", "test", "--mode", "sequential", "--k", "2")[0], 2)

    def test_context_preserves_full_attachment_and_run_evidence(self):
        folder = self.run_one()
        source = self.root / "trace.md"
        data = b"[OBSERVATION]\n" + b"x" * 75000 + b"\nEND-OF-TRACE\n"
        source.write_bytes(data)
        rc, _ = self.cli("context", "--experiment", "test", "--run", folder.name,
                         "--attach", "trace.md", "--output", "harness/experiments/test/context/base")
        self.assertEqual(rc, 0)
        dest = self.root / "harness/experiments/test/context/base"
        self.assertEqual((dest / "attachments/001-trace.md").read_bytes(), data)
        self.assertTrue((dest / f"rollouts/{folder.name}/report.json").is_file())
        self.assertTrue((dest / "MANIFEST.json").is_file())

    def test_context_does_not_overwrite(self):
        args = ("context", "--experiment", "test", "--output", "harness/experiments/test/context/base")
        self.assertEqual(self.cli(*args)[0], 0)
        self.assertEqual(self.cli(*args)[0], 2)

    def test_changed_run_evidence_cannot_enter_context(self):
        folder = self.run_one()
        (folder / "suites/fixture/result.json").write_text("{}")
        rc, _ = self.cli("context", "--experiment", "test", "--run", folder.name,
                         "--output", "harness/experiments/test/context/invalid")
        self.assertEqual(rc, 2)
        self.assertFalse((self.root / "harness/experiments/test/context/invalid").exists())

    def test_incomplete_run_not_reported_as_finished(self):
        folder = self.root / "harness/experiments/test/runs/base1-partial"
        folder.mkdir(parents=True)
        (folder / "report.json").write_text('{"completed": false}')
        rc, out = self.cli("status", "--experiment", "test")
        self.assertEqual(rc, 1)
        self.assertFalse(json.loads(out)["runs"][0]["evidence_valid"])

    def test_missing_agent_work_is_not_inferred_from_schedule(self):
        self.cli("schedule", "--experiment", "test")
        self.run_one()
        rc, out = self.cli("status", "--experiment", "test")
        value = json.loads(out)
        self.assertEqual(rc, 0)  # Integrity check succeeds, but the method is incomplete.
        self.assertFalse(value["all_planned_execution_labels_have_records"])
        self.assertIn("completion is not verified", value["command_scope"])
        self.assertEqual(value["agent_executions"], "not automatically observed")
        self.assertIn("inv1", value["labels_without_validation_evidence"])

    def test_reports_are_immutable(self):
        args = ("report", "--experiment", "test", "--output", "harness/experiments/test/reports/summary.json")
        self.assertEqual(self.cli(*args)[0], 0)
        self.assertEqual(self.cli(*args)[0], 2)

    def test_changed_controls_visible_during_recovery(self):
        (self.root / "docs/acceptance_criteria.md").write_text("changed")
        rc, out = self.cli("status", "--experiment", "test")
        self.assertEqual(rc, 1)
        self.assertFalse(json.loads(out)["controls_valid"])


if __name__ == "__main__":
    unittest.main()
