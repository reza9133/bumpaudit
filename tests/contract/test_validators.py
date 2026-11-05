"""Consensus: what honest validators accept, and every way a leader can lie.

`audit_release` runs the leader once and captures the validator closure;
`run_validator` replays it against the *current* mocks. So: audit first, then
swap the mocks to describe what the validator would see / think.
"""
import json
import copy

import pytest
from helpers import CHANGELOG, NOTES_URL

LEGACY = "legacy `connect()`"


def user_error(message):
    from genlayer import gl

    return gl.vm.UserError(message)


def leader_of(env, body=CHANGELOG, version="2.0.0", previous="1.5.0", **labels):
    env.register()
    env.vm.clear_validators()
    env.audit(version=version, previous=previous, body=body, **labels)
    return env.vm._captured_validators[-1][0]


def validator_sees(env, body, version="2.0.0", **labels):
    env.page(body)
    env.judge(version, **labels)


def entries_page(n=10, extra=(), replace=None, version="2.0.0"):
    items = ["Removed the legacy connect API for good."] + [f"Alpha entry number {i} describing something." for i in range(1, n)]
    for index, text in (replace or {}).items():
        items[index] = text
    items += list(extra)
    return f"## {version}\n" + "\n".join(f"- {t}" for t in items) + "\n"


# ------------------------------------------------------------------ honest validators


def test_the_leader_result_has_the_documented_shape(env):
    leader = leader_of(env, breaking=[LEGACY], feature=["--json"])
    assert set(leader) == {"ok", "block", "breaking", "feature", "fix"} and leader["ok"] is True
    assert leader["breaking"] == [1] and leader["feature"] == [5] and leader["fix"] == []
    assert leader["block"].startswith("## [2.0.0] - 2026-03-01\n")


def test_an_honest_validator_agrees(env):
    leader_of(env, breaking=[LEGACY], feature=["--json"])
    assert env.vm.run_validator() is True


def test_validators_may_label_other_entries_if_severity_and_one_entry_agree(env):
    leader_of(env, breaking=[LEGACY], feature=["--json"])
    validator_sees(env, CHANGELOG, breaking=[LEGACY, "minimum supported"], feature=["--json"])
    assert env.vm.run_validator() is True            # superset of the leader's breaking set


def test_validators_must_agree_on_the_severity(env):
    leader_of(env, breaking=[LEGACY], feature=["--json"])
    validator_sees(env, CHANGELOG, feature=[LEGACY, "--json"])           # sees no breaking change at all
    assert env.vm.run_validator() is False
    validator_sees(env, CHANGELOG, fix=[LEGACY, "--json"])
    assert env.vm.run_validator() is False


def test_same_severity_but_no_shared_entry_is_rejected(env):
    leader_of(env, breaking=[LEGACY], feature=["--json"])
    validator_sees(env, CHANGELOG, breaking=["minimum supported"], feature=["--json"])
    assert env.vm.run_validator() is False


def test_a_feature_verdict_needs_a_shared_feature_entry(env):
    leader_of(env, version="1.5.0", previous="1.4.2", feature=["streaming"], fix=["crash"])
    validator_sees(env, CHANGELOG, version="1.5.0", feature=["streaming"])
    assert env.vm.run_validator() is True
    validator_sees(env, CHANGELOG, version="1.5.0", feature=["crash"], fix=["streaming"])
    assert env.vm.run_validator() is False


def test_a_validators_model_failure_is_a_no(env):
    leader_of(env, breaking=[LEGACY])
    for reply in ("garbage", "{}", "[1]", '{"breaking": "all"}'):
        env.llm_raw(reply)
        assert env.vm.run_validator() is False
    env.vm._llm_mocks.clear()                       # no model at all
    assert env.vm.run_validator() is False


def test_a_validator_that_cannot_read_or_find_the_release_says_no(env):
    leader_of(env, breaking=[LEGACY])
    env.no_web()
    assert env.vm.run_validator() is False
    env.page("# Changelog\n## 1.5.0\n- only an older entry here\n")
    assert env.vm.run_validator() is False
    env.page("## 2.0.0\n## 1.5.0\n- only an older entry here\n")
    assert env.vm.run_validator() is False


# ------------------------------------------------------------------ volatile pages


def test_a_volatile_line_in_the_block_does_not_split_the_vote(env):
    page = "## 2.0.0\n@maintainer released this 3 minutes ago\n" + "\n".join(
        ["- Removed the legacy connect API for good."] + [f"- Alpha entry number {i} describing something." for i in range(1, 9)]) + "\n"
    leader_of(env, body=page, breaking=["legacy"], fix=["Alpha entry number 3"])
    validator_sees(env, page.replace("3 minutes", "4 minutes"), breaking=["legacy"], fix=["Alpha entry number 3"])
    assert env.vm.run_validator() is True            # the leader's old line and my new line: 2 of 11 entries differ
    # ... but the tolerance is finite: a timestamp change AND a new banner line is too much for a 10-entry block
    validator_sees(env, page.replace("3 minutes", "5 minutes") + "- A banner appeared on the page.\n", breaking=["legacy"], fix=["Alpha entry number 3"])
    assert env.vm.run_validator() is False


@pytest.mark.parametrize("extra,ok", [(1, True), (2, True), (3, False)])
def test_similarity_tolerance_for_extra_entries_on_a_ten_entry_block(env, extra, ok):
    leader_of(env, body=entries_page(10), breaking=["legacy"], fix=["Alpha entry number 3"])
    noise = [f"Banner text number {i} appeared." for i in range(extra)]
    validator_sees(env, entries_page(10, extra=noise), breaking=["legacy"], fix=["Alpha entry number 3"])
    assert env.vm.run_validator() is ok


@pytest.mark.parametrize("replaced,ok", [(1, True), (2, False)])
def test_similarity_tolerance_for_changed_entries_on_a_ten_entry_block(env, replaced, ok):
    leader_of(env, body=entries_page(10), breaking=["legacy"], fix=["Alpha entry number 3"])
    swap = {5 + i: f"Different entry number {i} says something else." for i in range(replaced)}
    validator_sees(env, entries_page(10, replace=swap), breaking=["legacy"], fix=["Alpha entry number 3"])
    assert env.vm.run_validator() is ok


@pytest.mark.parametrize("extra,ok", [(10, True), (11, False)])
def test_the_tolerance_grows_with_the_block(env, extra, ok):
    leader_of(env, body=entries_page(40), breaking=["legacy"], fix=["Alpha entry number 3"])
    noise = [f"Banner text number {i} appeared." for i in range(extra)]
    validator_sees(env, entries_page(40, extra=noise), breaking=["legacy"], fix=["Alpha entry number 3"])
    assert env.vm.run_validator() is ok


def test_a_validator_whose_page_has_a_different_release_says_no(env):
    leader_of(env, breaking=[LEGACY], feature=["--json"])
    other = CHANGELOG.replace("Removed the legacy `connect()` API. Use `Client.open()` instead.", "Reworked the whole thing completely.")
    validator_sees(env, other, breaking=["Reworked"], feature=["--json"])
    assert env.vm.run_validator() is False   # the cited evidence is not on my page


def test_cited_evidence_must_exist_on_the_validators_own_page(env):
    """Isolates the grounding check: severity and a shared entry agree, but one cited line is absent."""
    page = entries_page(10, replace={1: "Dropped the old plugin loader for good."})
    leader_of(env, body=page, breaking=["legacy", "old plugin loader"])
    gone = entries_page(10, replace={1: "Something else entirely appears at this position."})
    validator_sees(env, gone, breaking=["legacy"])
    assert env.vm.run_validator() is False
    validator_sees(env, page, breaking=["legacy"])
    assert env.vm.run_validator() is True


def test_only_the_stored_evidence_is_grounded(env):
    """Entries beyond the first three of the deciding class are not stored, so they are not checked."""
    entries = [f"Added capability number {i} to the tool." for i in range(1, 11)]
    page = "## 1.6.0\n" + "\n".join(f"- {e}" for e in entries) + "\n"
    needles = [f"number {i} " for i in range(1, 11)]
    leader_of(env, body=page, version="1.6.0", previous="1.5.0", feature=needles)
    assert [e["t"] for e in env.c.get_audit(1)["evidence"]] == entries[:3]
    # entry 10 is labelled by the leader but is not stored evidence: its absence on my page does not matter
    changed = page.replace("capability number 10 to", "capability number 100 to")
    validator_sees(env, changed, version="1.6.0", feature=needles[:2])
    assert env.vm.run_validator() is True
    # entry 2 IS stored evidence: if my page lacks it, the leader's citation is not grounded
    changed = page.replace("capability number 2 to", "capability number 200 to")
    validator_sees(env, changed, version="1.6.0", feature=needles[:1])
    assert env.vm.run_validator() is False


# ------------------------------------------------------------------ a lying or sloppy leader


def forged(base, **changes):
    result = copy.deepcopy(base)
    result.update(changes)
    return result


@pytest.fixture
def honest(env):
    leader = leader_of(env, breaking=[LEGACY], feature=["--json"])
    return leader


@pytest.mark.parametrize("junk", ["nope", 7, None, [], [1], {}, {"ok": True}, True, False, "", b"bytes"])
def test_malformed_leader_results_are_rejected(env, honest, junk):
    assert env.vm.run_validator(leader_result=junk) is False


def test_a_crashed_leader_is_rejected(env, honest):
    assert env.vm.run_validator(leader_error=user_error("boom")) is False


@pytest.mark.parametrize("block", [
    None, 5, [], {}, "", "   ", "no heading at all\n- some entry here",
    "## [1.5.0] - 2026-01-10\n- Added streaming uploads for large files.",           # a different release
    "## 2.0.0-rc.1\n- Removed the legacy `connect()` API. Use `Client.open()` instead.",   # a different version key
    "## [2.0.0] - 2026-03-01\n- Removed the legacy `connect()` API. Use `Client.open()` instead.\n## 1.5.0\n- smuggled entry",
    "## [2.0.0] - 2026-03-01\n" + "\n".join(["- l"] * 399) + "\n- x",              # more than 400 lines
    "## [2.0.0] - 2026-03-01\n- " + "x" * 6000,                                    # more than 6000 characters
    "## [2.0.0] - 2026-03-01",                                                    # no entries
    "## [2.0.0] - 2026-03-01\n- ok\n- no",                                           # entries too short to count
])
def test_forged_blocks_are_rejected(env, honest, block):
    assert env.vm.run_validator(leader_result=forged(honest, block=block)) is False


def test_the_block_field_may_be_missing_only_if_the_result_says_failure(env, honest):
    no_block = {k: v for k, v in honest.items() if k != "block"}
    assert env.vm.run_validator(leader_result=no_block) is False


@pytest.mark.parametrize("field,value", [
    ("breaking", None), ("breaking", "1"), ("breaking", 1), ("breaking", {"1": 1}),
    ("feature", None), ("fix", None), ("fix", "all"),
    ("breaking", [99]), ("breaking", [-1]), ("breaking", [6]), ("feature", [6]), ("fix", [10 ** 12]),
    ("breaking", [True]), ("breaking", ["1"]), ("breaking", [None]), ("breaking", [[1]]),
    ("breaking", [-1, 1]),                # a negative index would silently address the LAST entry
    ("breaking", [1, 1]),                 # duplicates
    ("feature", [1]),                     # the same entry in two classes
    ("fix", [1, 5]),
    ("fix", [0, 1, 2, 3, 4, 5, 0]),      # more labels than entries
])
def test_forged_label_lists_are_rejected(env, honest, field, value):
    assert env.vm.run_validator(leader_result=forged(honest, **{field: value})) is False


@pytest.mark.parametrize("ok", [1, 0, "yes", "true", None, [True]])
def test_a_success_needs_ok_to_be_exactly_true(env, honest, ok):
    assert env.vm.run_validator(leader_result=forged(honest, ok=ok)) is False
    assert env.vm.run_validator(leader_result=honest) is True       # sanity: only the flag differs


def test_forged_blocks_that_break_exactly_one_rule(env, honest):
    """Each forged block keeps every other property of an honest one, so only the targeted check can reject it."""
    block = honest["block"]
    assert env.vm.run_validator(leader_result=forged(honest, block=block + "\n- One more entry that is fine.")) is True   # sanity
    cases = {
        "longer than 6000 characters": block + "\n- " + "p" * 6100,
        "more than 400 lines": block + "\n" + "\n".join(["x"] * 400),
        "heading names another version": block.replace("## [2.0.0]", "## [1.9.9]", 1),
        "smuggles the heading of another release": block + "\n## 1.5.0",
    }
    for name, forged_block in cases.items():
        assert env.vm.run_validator(leader_result=forged(honest, block=forged_block)) is False, name


def test_a_block_without_entries_is_not_a_block(env):
    env.register()
    env.vm.clear_validators()
    env.page("## 2.0.0\n- Thanks to all contributors for this one.\n")
    env.llm_numbers()
    with env.revert("none of the release entries"):
        env.c.audit_release(1, "2.0.0", "1.5.0", NOTES_URL)
    leader = env.vm._captured_validators[-1][0]
    assert env.vm.run_validator() is True                                              # sanity
    assert env.vm.run_validator(leader_result=forged(leader, block="## 2.0.0")) is False
    env.no_web()                                       # a one-entry block still needs my own reading of the page
    assert env.vm.run_validator() is False


@pytest.mark.parametrize("extra,ok", [(1, True), (2, False)])
def test_a_three_entry_block_tolerates_exactly_one_differing_entry(env, extra, ok):
    leader_of(env, body=entries_page(3), breaking=["legacy"], fix=["Alpha entry number 1"])
    noise = [f"Banner text number {i} appeared." for i in range(extra)]
    validator_sees(env, entries_page(3, extra=noise), breaking=["legacy"], fix=["Alpha entry number 1"])
    assert env.vm.run_validator() is ok


def test_a_missing_label_list_is_rejected(env, honest):
    for field in ("breaking", "feature", "fix"):
        broken = {k: v for k, v in honest.items() if k != field}
        assert env.vm.run_validator(leader_result=broken) is False


def test_a_leader_that_inflates_severity_is_rejected(env, honest):
    # claims the feature entry is breaking and drops the real breaking entry
    assert env.vm.run_validator(leader_result=forged(honest, breaking=[5], feature=[])) is False
    # claims a plain fix where validators see breaking
    assert env.vm.run_validator(leader_result=forged(honest, breaking=[], feature=[], fix=[1])) is False


def test_a_leader_that_invents_an_explicit_marker_is_rejected(env, honest):
    fake_block = honest["block"] + "\n- BREAKING CHANGE: invented by a lying leader."
    leader = forged(honest, block=fake_block, breaking=[1, 6], feature=[5])
    assert env.vm.run_validator(leader_result=leader) is False


def test_a_leader_that_forgets_the_floor_is_still_judged_with_it(env):
    page = "## 1.4.3\n- BREAKING CHANGE: the config format is now TOML.\n- Fixed a typo in the docs.\n"
    leader_of(env, body=page, version="1.4.3", previous="1.4.2", fix=["typo"])
    base = env.vm._captured_validators[-1][0]
    assert base["breaking"] == [0]                       # an honest leader includes the floor entry
    lenient = forged(base, breaking=[], fix=[0, 1])      # a sloppy one does not
    assert env.vm.run_validator(leader_result=lenient) is True    # same final severity once the floor is applied


# ------------------------------------------------------------------ reported failures


def test_reported_failures_are_accepted_only_when_reproduced(env):
    leader_of(env, breaking=[LEGACY])
    # fetch
    assert env.vm.run_validator(leader_result={"ok": False, "reason": "fetch"}) is False   # I can read the page
    env.no_web()
    assert env.vm.run_validator(leader_result={"ok": False, "reason": "fetch"}) is True
    assert env.vm.run_validator(leader_result={"ok": False, "reason": "not_found"}) is False
    assert env.vm.run_validator(leader_result={"ok": False, "reason": "empty"}) is False
    # not_found
    env.page("# Changelog\n## 1.5.0\n- only an older entry here\n")
    assert env.vm.run_validator(leader_result={"ok": False, "reason": "not_found"}) is True
    assert env.vm.run_validator(leader_result={"ok": False, "reason": "fetch"}) is False
    assert env.vm.run_validator(leader_result={"ok": False, "reason": "empty"}) is False
    # empty
    env.page("## 2.0.0\n## 1.5.0\n- only an older entry here\n")
    assert env.vm.run_validator(leader_result={"ok": False, "reason": "empty"}) is True
    assert env.vm.run_validator(leader_result={"ok": False, "reason": "not_found"}) is False


@pytest.mark.parametrize("claim", [
    {"ok": False, "reason": "model"}, {"ok": False, "reason": "boom"}, {"ok": False}, {"ok": False, "reason": None},
    {"ok": False, "reason": ["fetch"]}, {"ok": "yes"}, {"ok": 1, "reason": "fetch"}, {"ok": None, "reason": "fetch"},
    {"reason": "fetch"},
])
def test_other_failure_claims_are_never_accepted(env, claim):
    leader_of(env, breaking=[LEGACY])
    env.no_web()                         # even when the validator can't read the page either
    expected = isinstance(claim.get("reason"), str) and claim.get("reason") == "fetch" and claim.get("ok") is False
    assert env.vm.run_validator(leader_result=claim) is expected


def test_a_model_failure_by_the_leader_is_reported_but_never_accepted(env):
    env.register()
    env.vm.clear_validators()
    env.page(CHANGELOG)
    env.llm_raw("garbage")
    with env.revert("could not be audited"):
        env.c.audit_release(1, "2.0.0", "1.5.0", NOTES_URL)
    assert env.vm._captured_validators[-1][0] == {"ok": False, "reason": "model"}
    assert env.vm.run_validator() is False
    env.judge("2.0.0", breaking=[LEGACY])      # even once the validator's model works
    assert env.vm.run_validator() is False


def test_a_leader_that_could_not_fetch_is_recorded_as_such(env):
    env.register()
    env.vm.clear_validators()
    env.no_web()
    env.llm_numbers(fix=[1])
    with env.revert("could not be fetched"):
        env.c.audit_release(1, "2.0.0", "1.5.0", NOTES_URL)
    assert env.vm._captured_validators[-1][0] == {"ok": False, "reason": "fetch"}
    assert env.vm.run_validator() is True
    env.page(CHANGELOG)
    assert env.vm.run_validator() is False


def test_a_release_that_classifies_to_nothing_is_a_consistent_outcome(env):
    env.register()
    env.vm.clear_validators()
    env.page(CHANGELOG)
    env.llm_numbers()
    with env.revert("none of the release entries"):
        env.c.audit_release(1, "2.0.0", "1.5.0", NOTES_URL)
    assert env.vm._captured_validators[-1][0]["ok"] is True
    assert env.vm.run_validator() is True            # honest validators reach the same "nothing"
    env.judge("2.0.0", breaking=[LEGACY])
    assert env.vm.run_validator() is False           # but not if they see a breaking change


def test_the_leader_result_is_calldata_clean(env, honest):
    json.dumps(honest)                                # plain JSON types only: no floats, sets or storage objects
    assert all(isinstance(i, int) and not isinstance(i, bool) for k in ("breaking", "feature", "fix") for i in honest[k])
