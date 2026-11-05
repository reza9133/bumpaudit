"""Minimal stand-in for the subset of pytest this project's tests use.

Only on PYTHONPATH for offline runs (see run.py). With real pytest installed, none of this is loaded.
Supported: @pytest.fixture (function scope, generator teardown), @pytest.mark.parametrize (stackable),
pytest.raises(exc, match=), pytest.skip, pytest.fail, built-in tmp_path.
"""
import contextlib
import re


class Skipped(Exception):
    pass


class Failed(AssertionError):
    pass


def skip(reason=""):
    raise Skipped(reason)


def fail(reason=""):
    raise Failed(reason)


def fixture(fn=None, **_kw):
    def mark(f):
        f._is_fixture = True
        return f

    return mark(fn) if fn is not None else mark


class _Mark:
    @staticmethod
    def parametrize(argnames, argvalues):
        names = [n.strip() for n in argnames.split(",")] if isinstance(argnames, str) else list(argnames)
        rows = []
        for v in argvalues:
            rows.append(tuple(v) if len(names) > 1 else (v,))

        def deco(fn):
            fn.__dict__.setdefault("_params", []).append((names, rows))
            return fn

        return deco


mark = _Mark()


class _ExcInfo:
    value = None


@contextlib.contextmanager
def raises(expected, match=None):
    info = _ExcInfo()
    try:
        yield info
    except expected as err:
        if match is not None and not re.search(match, str(err)):
            raise Failed(f"raised {err!r}, which does not match {match!r}") from err
        info.value = err
        return
    raise Failed(f"DID NOT RAISE {expected}")
