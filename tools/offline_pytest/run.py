#!/usr/bin/env python3
"""Tiny pytest-compatible runner for offline use.

    python tools/offline_pytest/run.py [-x] [-q] [-k substr] [-p module] PATH...
"""
import importlib
import importlib.util
import inspect
import itertools
import os
import shutil
import sys
import tempfile
import time
import traceback
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))              # `import pytest` -> the stand-in
sys.path.insert(0, str(ROOT / "tools"))    # offline_sim

import pytest  # noqa: E402


def load_module(path: Path, name: str):
    sys.path.insert(0, str(path.parent))
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def fixtures_of(mod):
    return {n: f for n, f in vars(mod).items() if callable(f) and getattr(f, "_is_fixture", False)}


class Runner:
    def __init__(self, fixtures):
        self.fixtures = fixtures

    def resolve(self, name, cache, teardown, tmp_dirs):
        if name in cache:
            return cache[name]
        if name == "tmp_path":
            d = Path(tempfile.mkdtemp(prefix="bumptest_"))
            tmp_dirs.append(d)
            cache[name] = d
            return d
        if name not in self.fixtures:
            raise RuntimeError(f"fixture {name!r} not found")
        fn = self.fixtures[name]
        args = {p: self.resolve(p, cache, teardown, tmp_dirs) for p in inspect.signature(fn).parameters}
        if inspect.isgeneratorfunction(fn):
            gen = fn(**args)
            value = next(gen)
            teardown.append(gen)
        else:
            value = fn(**args)
        cache[name] = value
        return value

    def run_one(self, fn, bound):
        cache, teardown, tmp_dirs = dict(bound), [], []
        try:
            kwargs = {p: self.resolve(p, cache, teardown, tmp_dirs) for p in inspect.signature(fn).parameters}
            fn(**kwargs)
        finally:
            for gen in reversed(teardown):
                try:
                    next(gen)
                except StopIteration:
                    pass
            for d in tmp_dirs:
                shutil.rmtree(d, ignore_errors=True)


def expand(fn):
    groups = getattr(fn, "_params", [])
    if not groups:
        yield "", {}
        return
    for combo in itertools.product(*[rows for _, rows in groups]):
        bound, label = {}, []
        for (names, _), row in zip(groups, combo):
            for n, v in zip(names, row):
                bound[n] = v
                label.append(f"{n}={str(v)[:30]}")
        yield "[" + "-".join(label) + "]", bound


def main(argv):
    stop, quiet, keyword, plugins, paths = False, False, None, [], []
    it = iter(argv)
    for a in it:
        if a == "-x":
            stop = True
        elif a == "-q":
            quiet = True
        elif a == "-k":
            keyword = next(it)
        elif a == "-p":
            plugins.append(next(it))
        elif a.startswith("-"):
            pass
        else:
            paths.append(Path(a))
    fixtures = {}
    for p in plugins:
        fixtures.update(fixtures_of(importlib.import_module(p)))
    files = []
    for p in paths or [ROOT / "tests" / "contract"]:
        files += sorted(p.rglob("test_*.py")) if p.is_dir() else [p]
    passed = failed = skipped = 0
    failures = []
    started = time.time()
    for f in files:
        local = dict(fixtures)
        conf = f.parent / "conftest.py"
        if conf.exists():
            local.update(fixtures_of(load_module(conf, f"conftest_{abs(hash(str(conf)))}")))
        mod = load_module(f, f"test_{abs(hash(str(f)))}_{f.stem}")
        local.update(fixtures_of(mod))
        runner = Runner(local)
        for name, fn in vars(mod).items():
            if not (name.startswith("test_") and callable(fn)):
                continue
            for label, bound in expand(fn):
                tid = f"{f.name}::{name}{label}"
                if keyword and keyword not in tid:
                    continue
                try:
                    runner.run_one(fn, bound)
                    passed += 1
                    print("." if quiet else f"PASS {tid}", end="" if quiet else "\n", flush=True)
                except pytest.Skipped as s:
                    skipped += 1
                    print("s" if quiet else f"SKIP {tid} ({s})", end="" if quiet else "\n", flush=True)
                except BaseException:
                    failed += 1
                    failures.append((tid, traceback.format_exc()))
                    print("F" if quiet else f"FAIL {tid}", end="" if quiet else "\n", flush=True)
                    if stop:
                        break
            if stop and failed:
                break
        if stop and failed:
            break
    print()
    for tid, tb in failures:
        print("=" * 30, tid)
        print(tb)
    print(f"{passed} passed, {failed} failed, {skipped} skipped in {time.time() - started:.1f}s")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
