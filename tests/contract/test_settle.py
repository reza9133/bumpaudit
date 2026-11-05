"""Defences that run AFTER consensus.

The normal path never produces a malformed agreed result, so these tests replace
gl.vm.run_nondet_unsafe and hand `audit_release` / `reaudit_release` a forged
"consensus result", to prove the contract re-validates what it is given instead
of trusting that the validators did their job.
"""
import contextlib
import copy

import pytest
from helpers import CHANGELOG, NOTES_URL

LEGACY = "legacy `connect()`"


@contextlib.contextmanager
def agreed(result):
    from genlayer import gl

    original = gl.vm.run_nondet_unsafe
    try:
        gl.vm.run_nondet_unsafe = lambda leader_fn, validator_fn: copy.deepcopy(result)
    except (AttributeError, TypeError):
        pytest.skip("this harness does not allow replacing gl.vm.run_nondet_unsafe")
    try:
        yield
    finally:
        gl.vm.run_nondet_unsafe = original


@pytest.fixture
def honest(env):
    env.register()
    env.vm.clear_validators()
    env.audit(breaking=[LEGACY], feature=["--json"])
    leader = copy.deepcopy(env.vm._captured_validators[-1][0])
    env.cooldown()
    return leader


def forged(base, **changes):
    result = copy.deepcopy(base)
    result.update(changes)
    return result


def rejected(env, result, message, version="2.0.0"):
    before = (env.stats(), env.c.get_release(1))
    with agreed(result):
        with env.revert(message):
            env.c.reaudit_release(1)
    assert (env.stats(), env.c.get_release(1)) == before


@pytest.mark.parametrize("junk", ["nope", 7, None, [], True])
def test_a_non_dict_result_is_refused(env, honest, junk):
    rejected(env, junk, "malformed result")


@pytest.mark.parametrize("flag", [None, 1, 0, "yes", "ok"])
def test_the_ok_flag_must_be_a_boolean(env, honest, flag):
    rejected(env, forged(honest, ok=flag), "malformed result")


@pytest.mark.parametrize("reason,message", [
    ("fetch", "could not be fetched"), ("not_found", "no heading for this version"), ("empty", "no change entries"),
    ("model", "could not be audited"), ("boom", "could not be audited"), (None, "could not be audited"),
])
def test_failure_reports_map_to_clear_errors(env, honest, reason, message):
    rejected(env, {"ok": False, "reason": reason}, message)


@pytest.mark.parametrize("block,message", [
    (None, "malformed release section"), ("", "malformed release section"), (5, "malformed release section"),
    ("## [1.5.0]\n- Added streaming uploads for large files.", "malformed release section"),
    ("## [2.0.0] - 2026-03-01", "malformed release section"),
    ("x" * 7000, "malformed release section"),
])
def test_a_malformed_block_is_refused(env, honest, block, message):
    rejected(env, forged(honest, block=block), message)


@pytest.mark.parametrize("changes", [
    {"breaking": None}, {"breaking": [99]}, {"breaking": [-1]}, {"feature": "x"}, {"fix": [True]}, {"breaking": [1, 1]},
    {"feature": [1]}, {"breaking": [1.0]},
])
def test_malformed_labels_are_refused(env, honest, changes):
    rejected(env, forged(honest, **changes), "malformed classifications")


def test_an_agreed_result_without_any_classification_is_refused(env, honest):
    rejected(env, forged(honest, breaking=[], feature=[], fix=[]), "none of the release entries")


def test_the_floor_is_applied_again_after_consensus(env):
    env.register()
    env.page("## 1.4.3\n- BREAKING CHANGE: the config format is now TOML.\n- Fixed a typo in the docs.\n")
    result = {"ok": True, "block": "## 1.4.3\n- BREAKING CHANGE: the config format is now TOML.\n- Fixed a typo in the docs.",
              "breaking": [], "feature": [], "fix": [0, 1]}            # an agreed result that forgot the explicit marker
    with agreed(result):
        env.c.audit_release(1, "1.4.3", "1.4.2", NOTES_URL)
    a = env.c.get_audit(1)
    assert (a["severity"], a["verdict"], a["explicit_markers"], a["breaking_entries"], a["fix_entries"]) == ("BREAKING", "UNDER_BUMPED", 1, 1, 1)


def test_a_well_formed_agreed_result_is_stored_exactly(env, honest):
    block = "## [2.0.0] - 2026-03-01\n- Dropped the old plugin loader for good.\n- Added a new command named doctor."
    with agreed({"ok": True, "block": block, "breaking": [0], "feature": [1], "fix": []}):
        env.c.reaudit_release(1)
    a = env.c.get_audit(2)
    assert (a["severity"], a["item_count"], a["notes_changed"], a["softened"]) == ("BREAKING", 2, True, False)
    assert env.c.get_audit_notes(2)["block"] == block and a["evidence"] == [{"i": 0, "t": "Dropped the old plugin loader for good."}]


def test_the_original_audit_path_is_also_guarded(env):
    env.register()
    with agreed({"ok": True, "block": "## 2.0.0\n- Fixed a crash on startup.", "breaking": [5], "feature": [], "fix": []}):
        with env.revert("malformed classifications"):
            env.c.audit_release(1, "2.0.0", "1.5.0", NOTES_URL)
    assert env.stats()["audits"] == 0 and env.stats()["releases"] == 0
