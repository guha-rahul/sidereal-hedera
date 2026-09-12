#!/usr/bin/env python3
"""Install exact reviewed revisions; never reset an existing dependency checkout."""
import json
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parents[1]
lock = json.loads((root / "dependencies.lock.json").read_text())
for item in lock["dependencies"]:
    destination = root / item["path"]
    if not destination.exists():
        destination.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(["git", "clone", "--depth", "1", "--branch", item["ref"], item["url"], str(destination)], check=True)
    revision = subprocess.check_output(["git", "-C", str(destination), "rev-parse", "HEAD"], text=True).strip()
    dirty = subprocess.check_output(["git", "-C", str(destination), "status", "--porcelain"], text=True).strip()
    if revision != item["commit"] or dirty:
        raise SystemExit(f"Dependency {item['path']} differs from the lock. Preserve your changes and resolve manually.")
    print(f"Verified {item['path']} at {revision}")
