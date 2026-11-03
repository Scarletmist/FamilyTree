#!/usr/bin/env python3
"""Copy this template into a project. Dry-run by default; never overwrite a conflict."""
import argparse
import os
from pathlib import Path
import shutil
import sys


def install(source, target, apply=False):
    source, target = source.resolve(), target.resolve()
    if target == source or target.is_relative_to(source) or source.is_relative_to(target):
        raise ValueError("Source and target trees must be separate")
    excluded = {"__pycache__", ".git", ".pytest_cache"}
    files = [p for p in sorted(source.rglob("*")) if p.is_file()
             and not excluded.intersection(p.relative_to(source).parts)
             and p.suffix != ".pyc"
             and not p.relative_to(source).as_posix().startswith("harness/experiments/")]
    actions, conflicts = [], []
    for p in files:
        rel = p.relative_to(source)
        d = target / rel
        # Reject symlinks in existing path components, including dangling links.
        components = [d, *list(d.parents)[:len(rel.parts)]]
        if any(x.is_symlink() for x in components) or not d.resolve().is_relative_to(target):
            conflicts.append(str(rel) + " (symlink/escape)")
        elif d.exists():
            if not d.is_file() or p.read_bytes() != d.read_bytes():
                conflicts.append(str(rel))
        else:
            # Existing parent files would otherwise cause a partial install.
            if any(x.exists() and not x.is_dir() for x in d.parents if x.is_relative_to(target)):
                conflicts.append(str(rel) + " (parent is a file)")
            else:
                actions.append((p, d))
    if conflicts:
        raise ValueError("Conflicts; nothing copied. Merge these files manually:\n" + "\n".join(conflicts))
    for p, d in actions:
        print(("COPY " if apply else "PLAN ") + str(d.relative_to(target)))
    if apply:
        for p, d in actions:
            d.parent.mkdir(parents=True, exist_ok=True)
            # Exclusive creation also protects against a destination appearing after preflight.
            with d.open("xb") as out:
                out.write(p.read_bytes())
            shutil.copymode(p, d)
        (target / "harness/experiments").mkdir(parents=True, exist_ok=True)
    return len(actions)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("target", type=Path)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    try:
        count = install(Path(__file__).resolve().parents[1], args.target, args.apply)
        print(f"{count} files {'copied' if args.apply else 'planned (use --apply to copy)'}")
        return 0
    except (ValueError, OSError) as exc:
        print(str(exc), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
