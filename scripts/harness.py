#!/usr/bin/env python3
"""Repository harness for a human/Codex driven Propose–Probe–Compose loop.

Python 3.10+, standard library only. This is not an agent/model executor.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import platform
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import uuid
from datetime import datetime, timezone


ROOT = Path(__file__).resolve().parents[1]
NAME = re.compile(r"[a-z0-9][a-z0-9_-]{0,79}\Z")


class HarnessError(Exception):
    pass


def utc():
    return datetime.now(timezone.utc).isoformat()


def digest(data):
    return hashlib.sha256(data).hexdigest()


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, allow_nan=False).encode()


def read_json(path):
    try:
        return json.loads(path.read_text(encoding="utf-8"), parse_constant=lambda x: fail(f"invalid number: {x}"))
    except (OSError, ValueError) as exc:
        raise HarnessError(f"Cannot read {path}: {exc}") from exc


def fail(message):
    raise HarnessError(message)


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp = tempfile.mkstemp(prefix=".harness-", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as out:
            json.dump(value, out, ensure_ascii=False, indent=2, allow_nan=False)
            out.write("\n")
        os.replace(temp, path)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def named(value):
    if not isinstance(value, str) or not NAME.fullmatch(value):
        fail(f"Invalid identifier: {value!r}; use lowercase letters, numbers, - or _")
    return value


def local(root, rel):
    if not isinstance(rel, str) or not rel or Path(rel).is_absolute() or ".." in Path(rel).parts:
        fail(f"Expected a repository-relative path: {rel!r}")
    path = root / rel
    resolved = path.resolve()
    if not resolved.is_relative_to(root.resolve()):
        fail(f"Path escapes repository: {rel}")
    return path


def number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def config(root):
    c = read_json(root / "harness/config.json")
    if not isinstance(c, dict) or c.get("schema_version") != 1:
        fail("config.schema_version must be 1")
    if not isinstance(c.get("project_ready"), bool):
        fail("config.project_ready must be boolean")
    for key in ("data_id", "environment_id"):
        if not isinstance(c.get(key), str) or not c[key].strip():
            fail(f"config.{key} must be a nonempty string")
    for field in ("input_files", "evaluator_files"):
        if not isinstance(c.get(field), list):
            fail(f"config.{field} must be a list of relative file paths")
        for rel in c[field]:
            if not local(root, rel).is_file():
                fail(f"{field} identity file missing: {rel}")
    if "scripts/harness.py" not in c["evaluator_files"]:
        fail("evaluator_files must include scripts/harness.py")
    suites = c.get("suites")
    if not isinstance(suites, list) or not suites:
        fail("Configure at least one suite")
    ids = set()
    for s in suites:
        if not isinstance(s, dict):
            fail("Each suite must be an object")
        sid = named(s.get("id"))
        if sid in ids:
            fail(f"Duplicate suite id: {sid}")
        ids.add(sid)
        if s.get("group") not in ("harness", "project"):
            fail(f"Invalid suite group: {sid}")
        argv = s.get("command")
        if not isinstance(argv, list) or not argv or any(not isinstance(a, str) or not a for a in argv):
            fail(f"command must be a nonempty argv array: {sid}")
        if not number(s.get("timeout_seconds")) or s["timeout_seconds"] <= 0:
            fail(f"Positive timeout required: {sid}")
        cwd = local(root, s.get("cwd", "."))
        if not cwd.is_dir():
            fail(f"Suite cwd is not a directory: {sid}")
    rules = c.get("metrics")
    if not isinstance(rules, dict):
        fail("config.metrics must be an object")
    for key, rule in rules.items():
        if not isinstance(rule, dict) or rule.get("direction") not in ("min", "max"):
            fail(f"Invalid metric rule: {key}")
        for field in ("min", "max", "max_regression", "min_improvement"):
            if field in rule and (not number(rule[field]) or (field in ("max_regression", "min_improvement") and rule[field] < 0)):
                fail(f"Invalid metric tolerance: {key}.{field}")
        if rule.get("min", -math.inf) > rule.get("max", math.inf):
            fail(f"Metric min exceeds max: {key}")
    if c["project_ready"]:
        if c["data_id"] == "UNCONFIGURED" or c["environment_id"] == "UNCONFIGURED":
            fail("Set real data_id and environment_id before project_ready=true")
        if not any(s["group"] == "project" for s in suites):
            fail("project_ready requires at least one project suite")
    return c


def runtime_identity():
    return {"python": platform.python_version(), "system": platform.system(),
            "release": platform.release(), "machine": platform.machine(),
            "executable": str(Path(sys.executable).resolve())}


def controls(root):
    c = config(root)
    files = {"harness/config.json", "docs/acceptance_criteria.md", *c["input_files"], *c["evaluator_files"]}
    fingerprints = {}
    for rel in sorted(files):
        p = local(root, rel)
        if not p.is_file():
            fail(f"Required identity file missing: {rel}")
        fingerprints[rel] = digest(p.read_bytes())
    return {"config": c, "files": fingerprints, "runtime": runtime_identity()}


def git_state(root):
    def run(*args):
        try:
            p = subprocess.run(["git", "-C", str(root), *args], capture_output=True, text=True, timeout=10)
            return p.stdout.strip() if p.returncode == 0 else None
        except (OSError, subprocess.TimeoutExpired):
            return None
    diff = run("diff", "--binary", "HEAD")
    return {"head": run("rev-parse", "HEAD"), "status": run("status", "--porcelain=v1"),
            "tracked_diff_sha256": digest(diff.encode()) if diff is not None else None}


def experiment(root, task):
    return local(root, f"harness/experiments/{named(task)}")


def frozen(root, task):
    exp = experiment(root, task)
    meta = read_json(exp / "experiment.json")
    saved = read_json(exp / "controls.json")
    if digest(canonical(saved)) != meta["controls_sha256"]:
        fail("Frozen controls were changed; create a new experiment")
    if digest((exp / "task.md").read_bytes()) != meta["task_sha256"]:
        fail("Task was changed; create a new experiment")
    if controls(root) != saved:
        fail("Config, inputs, acceptance or runtime changed; create a new experiment")
    return exp, meta, saved


def new_experiment(root, args):
    c = controls(root)
    exp = experiment(root, args.task)
    if not args.goal.strip():
        fail("Goal must be nonempty")
    task = f"# Task: {args.task}\n\n{args.goal.strip()}\n"
    meta = {"schema_version": 1, "id": args.task, "created_at": utc(),
            "agent_context": {"model": args.model, "codex_version": args.codex_version},
            "controls_sha256": digest(canonical(c)), "task_sha256": digest(task.encode()),
            "git_at_creation": git_state(root)}
    # mkdir is exclusive: never overwrite an existing task, even after a partial run.
    try:
        exp.mkdir(parents=True, exist_ok=False)
    except FileExistsError:
        fail(f"Experiment already exists: {args.task}")
    (exp / "task.md").write_text(task, encoding="utf-8")
    write_json(exp / "controls.json", c)
    write_json(exp / "experiment.json", meta)
    for name in ("plan.md", "decision.md", "reflection.md"):
        shutil.copy2(root / "harness/templates" / name, exp / name)
    print(exp)
    return 0


def snapshot(root, dest):
    paths = [root / "AGENTS.md"]
    for dirname in (".agents/skills", "scripts", "docs"):
        base = root / dirname
        paths += [p for p in base.rglob("*") if p.is_file() and "__pycache__" not in p.parts and p.suffix != ".pyc"]
    hashes = {}
    for p in sorted(set(paths)):
        if not p.is_file():
            continue
        rel = p.relative_to(root).as_posix()
        local(root, rel)
        dst = dest / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(p, dst)
        hashes[rel] = digest(p.read_bytes())
    return hashes


def terminate(process):
    if process.poll() is not None:
        return
    if os.name == "nt":
        subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], capture_output=True)
    else:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait()


def validate_result(value):
    if not isinstance(value, dict) or value.get("schema_version") != 1:
        fail("result.json schema_version must be 1")
    for field in ("checks_run", "checks_failed"):
        if not isinstance(value.get(field), int) or isinstance(value[field], bool) or value[field] < 0:
            fail(f"result.json {field} must be a nonnegative integer")
    if value["checks_run"] <= 0 or value["checks_failed"] > value["checks_run"]:
        fail("No checks executed or invalid failure count")
    metrics = value.get("metrics")
    if not isinstance(metrics, dict) or any(not isinstance(k, str) or not number(v) for k, v in metrics.items()):
        fail("result.json metrics must contain finite numbers")
    return value


def metric_issues(metrics, rules):
    errors = []
    for name, rule in rules.items():
        if name not in metrics:
            errors.append(f"Missing metric: {name}")
            continue
        v = metrics[name]
        if not number(v):
            errors.append(f"Invalid metric: {name}")
        elif v < rule.get("min", -math.inf) or v > rule.get("max", math.inf):
            errors.append(f"Metric outside acceptance: {name}={v}")
    return errors


def run_suites(root, args):
    exp, meta, frozen_controls = frozen(root, args.experiment)
    c = frozen_controls["config"]
    if args.group == "project" and not c["project_ready"]:
        fail("Project suites are unconfigured. Harness self-tests do not validate your project.")
    suites = [s for s in c["suites"] if s["group"] == args.group]
    if not suites:
        fail(f"No suites configured for group {args.group}")
    run_id = f"{named(args.label)}-{uuid.uuid4().hex[:12]}"
    out = exp / "runs" / run_id
    out.mkdir(parents=True, exist_ok=False)
    report = {"schema_version": 1, "run_id": run_id, "experiment": args.experiment,
              "label": args.label, "group": args.group, "started_at": utc(),
              "completed": False, "status": "running", "comparison_key": digest(canonical({
                  "controls": meta["controls_sha256"], "task": meta["task_sha256"],
                  "agent_context": meta["agent_context"]})),
              "git": git_state(root), "suites": [], "metrics": {}, "errors": []}
    report["harness_files"] = snapshot(root, out / "harness_snapshot")
    report["harness_sha256"] = digest(canonical(report["harness_files"]))
    write_json(out / "report.json", report)
    overall = "passed"
    for suite in suites:
        d = out / "suites" / suite["id"]
        d.mkdir(parents=True)
        argv = [sys.executable if a == "{python}" else a for a in suite["command"]]
        env = dict(os.environ, HARNESS_RUN_DIR=str(d.resolve()), PYTHONIOENCODING="utf-8")
        item = {"id": suite["id"], "command": argv, "cwd": suite.get("cwd", "."), "status": "running"}
        start = time.monotonic()
        process = None
        try:
            with (d / "output.log").open("wb") as log:
                process = subprocess.Popen(argv, cwd=local(root, suite.get("cwd", ".")), env=env,
                                           stdout=log, stderr=subprocess.STDOUT, shell=False,
                                           start_new_session=(os.name != "nt"))
                item["exit_code"] = process.wait(timeout=suite["timeout_seconds"])
            value = validate_result(read_json(d / "result.json"))
            item["checks_run"] = value["checks_run"]
            item["checks_failed"] = value["checks_failed"]
            item["status"] = "passed" if item["exit_code"] == 0 and value["checks_failed"] == 0 else "failed"
            for key, v in value["metrics"].items():
                if key in report["metrics"]:
                    fail(f"Duplicate metric from multiple suites: {key}")
                report["metrics"][key] = v
        except subprocess.TimeoutExpired:
            terminate(process)
            item.update(status="timeout", error="Suite exceeded configured timeout")
        except KeyboardInterrupt:
            if process:
                terminate(process)
            item.update(status="interrupted", error="Interrupted by user")
        except (OSError, HarnessError) as exc:
            if process:
                terminate(process)
            item.update(status="error", error=str(exc))
        item["elapsed_seconds"] = round(time.monotonic() - start, 4)
        report["suites"].append(item)
        if item["status"] != "passed":
            overall = "failed"
        write_json(out / "report.json", report)
        if item["status"] in ("timeout", "interrupted", "error"):
            break
    if args.group == "project":
        report["errors"].extend(metric_issues(report["metrics"], c["metrics"]))
    try:
        frozen(root, args.experiment)
    except HarnessError as exc:
        report["errors"].append(str(exc))
    if report["errors"]:
        overall = "failed"
    report.update(completed=True, status=overall, ended_at=utc())
    report["evidence_files"] = {p.relative_to(out).as_posix(): digest(p.read_bytes())
        for p in sorted(out.rglob("*")) if p.is_file() and p.name != "report.json"}
    write_json(out / "report.json", report)
    print(json.dumps({"run_id": run_id, "status": overall, "report": str(out / "report.json")}, ensure_ascii=False))
    return 0 if overall == "passed" else 1


def load_run(exp, run_id):
    d = exp / "runs" / named(run_id)
    r = read_json(d / "report.json")
    if r.get("run_id") != run_id or not r.get("completed"):
        fail(f"Run is incomplete or mismatched: {run_id}")
    evidence = r.get("evidence_files")
    if not isinstance(evidence, dict) or not evidence:
        fail(f"Run lacks evidence: {run_id}")
    for rel, expected in evidence.items():
        p = local(d, rel)
        if not p.is_file() or digest(p.read_bytes()) != expected:
            fail(f"Evidence changed: {run_id}/{rel}")
    return r


def compare_records(base, cand, rules):
    reasons, changes = [], {}
    if base.get("comparison_key") != cand.get("comparison_key"):
        reasons.append("Task, configuration or agent context differs")
    if base.get("group") != "project" or cand.get("group") != "project":
        reasons.append("Only project runs can support adoption")
    if base.get("run_id") == cand.get("run_id"):
        reasons.append("Baseline and candidate are the same run")
    if cand.get("status") != "passed":
        reasons.append("Candidate did not pass")
    a, b = base.get("metrics", {}), cand.get("metrics", {})
    reasons += metric_issues(b, rules)
    improved = base.get("status") != "passed" and cand.get("status") == "passed"
    for key, rule in rules.items():
        if key not in a or not number(a[key]) or key not in b or not number(b[key]):
            reasons.append(f"Cannot compare required metric: {key}")
            continue
        gain = (a[key] - b[key]) if rule["direction"] == "min" else (b[key] - a[key])
        changes[key] = {"baseline": a[key], "candidate": b[key], "gain": gain}
        if gain < -rule.get("max_regression", 0):
            reasons.append(f"Metric regressed: {key}")
        if gain > 0 and gain >= rule.get("min_improvement", 0):
            improved = True
    if not improved:
        reasons.append("No measured improvement; keep baseline or gather more evidence")
    return {"eligible": not reasons, "reasons": reasons, "metric_changes": changes}


def compare(root, args):
    exp, _, c = frozen(root, args.experiment)
    base, cand = load_run(exp, args.baseline), load_run(exp, args.candidate)
    result = compare_records(base, cand, c["config"]["metrics"])
    result.update(schema_version=1, baseline=args.baseline, candidate=args.candidate, created_at=utc(),
                  report_sha256={rid: digest((exp / "runs" / rid / "report.json").read_bytes())
                                 for rid in (args.baseline, args.candidate)})
    comparison_id = f"comparison-{uuid.uuid4().hex[:12]}"
    write_json(exp / "comparisons" / f"{comparison_id}.json", result)
    print(json.dumps(dict(result, comparison_id=comparison_id), ensure_ascii=False, indent=2))
    return 0 if result["eligible"] else 1


def record_lesson(root, args):
    exp, _, c = frozen(root, args.experiment)
    path = exp / "comparisons" / f"{named(args.comparison)}.json"
    saved = read_json(path)
    base, cand = load_run(exp, saved["baseline"]), load_run(exp, saved["candidate"])
    for rid, sha in saved["report_sha256"].items():
        if digest((exp / "runs" / named(rid) / "report.json").read_bytes()) != sha:
            fail("Run report changed after comparison")
    checked = compare_records(base, cand, c["config"]["metrics"])
    if not saved.get("eligible") or not checked["eligible"]:
        fail("Comparison does not support a verified lesson")
    for value in (args.cue, args.lesson, args.limits):
        if not value.strip():
            fail("Cue, lesson and limits must be nonempty")
    record = {"id": f"lesson-{uuid.uuid4().hex[:12]}", "created_at": utc(), "cue": args.cue,
              "lesson": args.lesson, "limits": args.limits, "confidence": "task-local",
              "evidence": path.relative_to(root).as_posix(),
              "comparison_sha256": digest(path.read_bytes()), "candidate_harness": cand["harness_sha256"]}
    journal = root / "harness/lessons.jsonl"
    with journal.open("a", encoding="utf-8", newline="\n") as out:
        out.write(json.dumps(record, ensure_ascii=False, allow_nan=False) + "\n")
    # Append-only view: no rewriting user notes and no automatic promotion to AGENTS.
    with (root / "harness/lessons.md").open("a", encoding="utf-8", newline="\n") as out:
        for line in (f"\n## {record['id']}", f"- Cue: {args.cue}", f"- Lesson: {args.lesson}",
                     f"- Limits: {args.limits}", "- Confidence: task-local", f"- Evidence: {record['evidence']}"):
            out.write(line + "\n")
    print(json.dumps(record, ensure_ascii=False, indent=2))
    return 0


def doctor(root, args):
    c = config(root)
    required = ["AGENTS.md", "docs/architecture.md", "docs/acceptance_criteria.md", "docs/decisions.md", "docs/WORKFLOW_COVERAGE.md",
                "harness/lessons.md", "harness/templates/plan.md", "harness/templates/decision.md", "harness/templates/reflection.md"]
    for rel in required:
        if not local(root, rel).is_file():
            fail(f"Required file missing: {rel}")
    skills = []
    for path in sorted((root / ".agents/skills").glob("*/SKILL.md")):
        text = path.read_text(encoding="utf-8")
        match = re.match(r"\A---\r?\n(.*?)\r?\n---(?:\r?\n|\Z)", text, re.S)
        if not match:
            fail(f"Skill frontmatter missing: {path}")
        fields = dict(re.findall(r"^(name|description):\s*(.+)$", match[1], re.M))
        if fields.get("name") != path.parent.name or not fields.get("description"):
            fail(f"Skill name/description invalid: {path}")
        skills.append(path.parent.name)
    catalog = read_json(root / "harness/skills.json")
    entries = catalog.get("skills", [])
    required_skills = {entry["name"] for entry in entries}
    if catalog.get("schema_version") != 1 or not entries or len(required_skills) != len(entries):
        fail("Invalid or duplicate project skill catalog")
    if not required_skills.issubset(skills):
        fail("Required catalog skills are missing: " + ", ".join(sorted(required_skills - set(skills))))
    print(json.dumps({"structure": "ok", "skills": skills, "project_ready": c["project_ready"],
                      "runtime": runtime_identity()}, ensure_ascii=False, indent=2))
    return 0 if c["project_ready"] else 2


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT, help="Repository root (default: script parent)")
    sub = parser.add_subparsers(dest="action", required=True)
    p = sub.add_parser("doctor", help="Validate structure; exit 2 until project suites are configured")
    p = sub.add_parser("new", help="Freeze task, evaluation controls and input identities")
    p.add_argument("--task", required=True)
    p.add_argument("--goal", required=True)
    p.add_argument("--model", default="unrecorded")
    p.add_argument("--codex-version", default="unrecorded")
    p = sub.add_parser("run", help="Execute suites; result.json is mandatory")
    p.add_argument("--experiment", required=True)
    p.add_argument("--label", required=True)
    p.add_argument("--group", choices=("project", "harness"), default="project")
    p = sub.add_parser("compare", help="Evaluate adoption eligibility; never apply code or instructions")
    p.add_argument("--experiment", required=True)
    p.add_argument("--baseline", required=True)
    p.add_argument("--candidate", required=True)
    p = sub.add_parser("lesson", help="Append an evidence-backed task-local lesson")
    p.add_argument("--experiment", required=True)
    p.add_argument("--comparison", required=True)
    p.add_argument("--cue", required=True)
    p.add_argument("--lesson", required=True)
    p.add_argument("--limits", required=True)
    args = parser.parse_args(argv)
    try:
        root = args.root.resolve()
        return {"doctor": doctor, "new": new_experiment, "run": run_suites,
                "compare": compare, "lesson": record_lesson}[args.action](root, args)
    except (HarnessError, OSError, KeyError, TypeError, ValueError) as exc:
        print(f"harness: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
