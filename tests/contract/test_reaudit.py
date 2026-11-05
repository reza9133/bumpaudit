"""reaudit_release: rechecks, edited / softened release notes, counters, cooldown, pinned URL."""
import pytest
from helpers import CHANGELOG, NOTES_URL

LEGACY = "legacy `connect()`"
REMOVED_SECTION = "### Removed\n- Removed the legacy `connect()` API. Use `Client.open()` instead.\n\n"
SOFT = CHANGELOG.replace(REMOVED_SECTION, "")                                   # the breaking line vanished
NOISY = CHANGELOG.replace("### Added\n- New `--json`", "### Added\n- Added shell completion for bash.\n- New `--json`")  # more text, same severity
HARD = CHANGELOG.replace(REMOVED_SECTION, "### Removed\n- BREAKING CHANGE: the legacy `connect()` API is gone.\n\n")


def setup(env):
    env.register()
    env.audit(breaking=[LEGACY], feature=["--json"])
    env.cooldown()


def reaudit(env, body, **labels):
    env.page(body)
    env.judge("2.0.0", **labels)
    return int(env.c.reaudit_release(1))


# ------------------------------------------------------------------ unchanged notes: a recheck, not a record


def test_unchanged_notes_only_move_the_checked_clock(env):
    setup(env)
    first_checked = env.c.get_release(1)["last_checked_at"]
    assert reaudit(env, CHANGELOG, breaking=[LEGACY], feature=["--json"]) == 1      # the audit that still holds
    with env.revert("audit not found"):
        env.c.get_audit(2)
    r = env.c.get_release(1)
    assert (r["audit_count"], r["check_count"], r["edit_count"], r["verdict_changes"], r["softened"]) == (1, 1, 0, 0, False)
    assert (r["first_audit_id"], r["latest_audit_id"]) == (1, 1)
    assert r["last_checked_at"] == env.now() and r["last_checked_at"] > first_checked
    assert r["first_block_hash"] == r["latest_block_hash"]
    s = env.stats()
    assert (s["audits"], s["releases"], s["rechecks"], s["edited_releases"], s["softened_releases"], s["compliant"]) == (1, 1, 1, 0, 0, 1)
    assert env.c.get_package(1)["last_audit_at"] == env.now() and env.c.list_release_audits(1, 0, 10)["total"] == 1


def test_cooldown_boundary(env):
    env.register()
    env.audit(breaking=[LEGACY])
    env.judge("2.0.0", breaking=[LEGACY])
    env.advance(299)
    with env.revert("cooldown still active"):
        env.c.reaudit_release(1)
    env.advance(1)
    assert env.c.reaudit_release(1) == 1
    with env.revert("cooldown still active"):   # the clock restarts after every check, recorded or not
        env.c.reaudit_release(1)
    env.advance(300)
    assert env.c.reaudit_release(1) == 1 and env.c.get_release(1)["check_count"] == 2


def test_spamming_rechecks_cannot_block_edit_detection(env):
    """The attack the audit cap used to allow: burn every slot, then edit the notes in peace."""
    setup(env)
    for sender in [env.bob, env.carol, env.alice] * 4:
        env.vm.sender = sender
        assert reaudit(env, CHANGELOG, breaking=[LEGACY], feature=["--json"]) == 1
        env.cooldown()
    r = env.c.get_release(1)
    assert (r["audit_count"], r["check_count"]) == (1, 12) and env.stats()["rechecks"] == 12
    env.vm.sender = env.carol                                     # the maintainer finally edits the notes ...
    reaudit(env, SOFT, feature=["--json"])                        # ... and anyone's next check records it
    a = env.c.get_audit(2)
    assert (a["notes_changed"], a["softened"], a["requester"]) == (True, True, env.carol.as_hex)
    assert env.c.get_release(1)["softened"] is True


def test_recorded_audits_are_capped_but_rechecks_still_work_at_the_cap(env):
    setup(env)
    for i in range(29):
        reaudit(env, CHANGELOG.replace("### Added\n- New `--json`", f"### Added\n- Added tidy-up number {i}.\n- New `--json`"),
                breaking=[LEGACY], feature=["--json"])
        env.cooldown()
    assert env.c.get_release(1)["audit_count"] == 30 and env.c.get_release(1)["edit_count"] == 29
    env.page(CHANGELOG.replace("### Added\n- New `--json`", "### Added\n- Added tidy-up number 999.\n- New `--json`"))
    env.judge("2.0.0", breaking=[LEGACY], feature=["--json"])
    before = env.stats()
    with env.revert("maximum number of recorded audits"):
        env.c.reaudit_release(1)
    assert env.stats() == before
    # an unchanged check is still possible at the cap
    env.page(CHANGELOG.replace("### Added\n- New `--json`", "### Added\n- Added tidy-up number 28.\n- New `--json`"))
    env.judge("2.0.0", breaking=[LEGACY], feature=["--json"])
    assert env.c.reaudit_release(1) == 30 and env.c.get_release(1)["check_count"] == 1


# ------------------------------------------------------------------ changed notes: a new record


def test_an_edit_with_the_same_severity_is_detected(env):
    setup(env)
    assert reaudit(env, NOISY, breaking=[LEGACY], feature=["--json"]) == 2
    a = env.c.get_audit(2)
    assert (a["notes_changed"], a["softened"], a["verdict"]) == (True, False, "COMPLIANT")
    r = env.c.get_release(1)
    assert (r["edit_count"], r["verdict_changes"], r["softened"], r["audit_count"], r["check_count"]) == (1, 0, False, 2, 0)
    assert r["first_block_hash"] != r["latest_block_hash"] and r["latest_block_hash"] == a["block_hash"]
    assert env.c.get_package(1)["edited"] == 1 and env.stats()["edited_releases"] == 1
    assert env.c.get_package(1)["softened"] == 0 and env.stats()["rechecks"] == 0


def test_removing_a_breaking_line_is_flagged_as_softening_and_flips_the_verdict(env):
    setup(env)
    reaudit(env, SOFT, feature=["--json", "minimum supported"])
    a = env.c.get_audit(2)
    assert (a["notes_changed"], a["softened"], a["severity"], a["verdict"]) == (True, True, "FEATURE", "OVER_BUMPED")
    r = env.c.get_release(1)
    assert (r["verdict"], r["severity"], r["edit_count"], r["verdict_changes"], r["softened"]) == ("OVER_BUMPED", "FEATURE", 1, 1, True)
    p = env.c.get_package(1)
    assert (p["compliant"], p["over_bumped"], p["under_bumped"], p["releases"], p["edited"], p["softened"]) == (0, 1, 0, 1, 1, 1)
    s = env.stats()
    assert (s["compliant"], s["over_bumped"], s["edited_releases"], s["softened_releases"]) == (0, 1, 1, 1)
    # the original audit is untouched: the ledger keeps both readings
    first = env.c.get_audit(1)
    assert (first["severity"], first["verdict"], first["notes_changed"]) == ("BREAKING", "COMPLIANT", False)
    assert env.c.get_audit_notes(1)["block"] != env.c.get_audit_notes(2)["block"]
    assert "legacy" in env.c.get_audit_notes(1)["block"] and "legacy" not in env.c.get_audit_notes(2)["block"]


def test_hardening_is_an_edit_but_not_softening(env):
    env.register()
    page = "## 1.4.3\n- Fixed a typo in the documentation.\n"
    env.audit(version="1.4.3", previous="1.4.2", body=page, fix=["typo"])
    assert env.c.get_audit(1)["verdict"] == "COMPLIANT"
    env.cooldown()
    env.page(page + "- BREAKING CHANGE: the config format changed to TOML.\n")
    env.llm_numbers(fix=[1])
    env.c.reaudit_release(1)
    a = env.c.get_audit(2)
    assert (a["notes_changed"], a["softened"], a["severity"], a["verdict"], a["explicit_markers"]) == (True, False, "BREAKING", "UNDER_BUMPED", 1)
    p = env.c.get_package(1)
    assert (p["compliant"], p["under_bumped"], p["edited"], p["softened"]) == (0, 1, 1, 0)


def test_softening_is_sticky_and_counted_once(env):
    setup(env)
    reaudit(env, SOFT, feature=["--json"])                 # softened -> flagged
    env.cooldown()
    reaudit(env, HARD, breaking=[LEGACY], feature=["--json"])   # restored (stricter): edit, not softened
    a3 = env.c.get_audit(3)
    assert (a3["notes_changed"], a3["softened"], a3["severity"], a3["verdict"]) == (True, False, "BREAKING", "COMPLIANT")
    r = env.c.get_release(1)
    assert (r["softened"], r["edit_count"], r["verdict_changes"], r["verdict"]) == (True, 2, 2, "COMPLIANT")
    env.cooldown()
    reaudit(env, SOFT, feature=["--json"])                 # softened again
    a4 = env.c.get_audit(4)
    assert a4["softened"] is True
    s, p = env.stats(), env.c.get_package(1)
    assert (s["softened_releases"], p["softened"], s["edited_releases"], p["edited"]) == (1, 1, 1, 1)   # per release, not per event
    assert (s["compliant"], s["over_bumped"], p["compliant"], p["over_bumped"]) == (0, 1, 0, 1)
    assert env.c.get_release(1)["edit_count"] == 3 and env.c.get_release(1)["verdict_changes"] == 3


def test_a_different_model_opinion_on_unchanged_notes_is_recorded_but_is_not_softening(env):
    setup(env)
    assert reaudit(env, CHANGELOG, feature=[LEGACY, "--json"]) == 2     # same page; the model now sees no breaking change
    a = env.c.get_audit(2)
    assert (a["notes_changed"], a["softened"], a["severity"], a["verdict"]) == (False, False, "FEATURE", "OVER_BUMPED")
    r = env.c.get_release(1)
    assert (r["softened"], r["edit_count"], r["verdict_changes"], r["verdict"], r["check_count"]) == (False, 0, 1, "OVER_BUMPED", 0)
    s = env.stats()
    assert (s["softened_releases"], s["edited_releases"], s["compliant"], s["over_bumped"], s["rechecks"]) == (0, 0, 0, 1, 0)


def test_a_verdict_can_improve_and_every_counter_follows(env):
    env.register()
    page = "## 1.4.3\n- BREAKING CHANGE: the config format changed to TOML.\n- Fixed a typo in the documentation.\n"
    env.audit(version="1.4.3", previous="1.4.2", body=page, fix=["typo"])
    assert env.c.get_audit(1)["verdict"] == "UNDER_BUMPED"
    assert (env.stats()["under_bumped"], env.c.get_package(1)["under_bumped"]) == (1, 1)
    env.cooldown()
    env.page("## 1.4.3\n- Fixed a typo in the documentation.\n")
    env.llm_numbers(fix=[1])
    env.c.reaudit_release(1)
    a = env.c.get_audit(2)
    assert (a["verdict"], a["severity"], a["softened"], a["notes_changed"]) == ("COMPLIANT", "FIX", True, True)
    s, p = env.stats(), env.c.get_package(1)
    assert (s["under_bumped"], s["compliant"], s["over_bumped"], s["exempt"]) == (0, 1, 0, 0)
    assert (p["under_bumped"], p["compliant"], p["over_bumped"], p["exempt"], p["integrity_permille"]) == (0, 1, 0, 0, 1000)


# ------------------------------------------------------------------ failures, pinning, access


def test_failed_reaudits_revert_and_leave_the_record_alone(env):
    setup(env)
    before = (env.stats(), env.c.get_release(1), env.c.get_package(1))
    env.no_web()
    with env.revert("could not be fetched"):
        env.c.reaudit_release(1)
    env.page("## 2.0.0\n## 1.5.0\n- older entry text that is long enough\n")
    env.llm_numbers(fix=[1])
    with env.revert("no change entries"):
        env.c.reaudit_release(1)
    env.page("# Changelog\n## 1.5.0\n- older entry text that is long enough\n")
    with env.revert("no heading for this version"):
        env.c.reaudit_release(1)
    env.page(CHANGELOG)
    env.llm_raw("garbage")
    with env.revert("could not be audited"):
        env.c.reaudit_release(1)
    env.llm_numbers()                                   # nothing classifiable (an emptied section)
    with env.revert("none of the release entries"):
        env.c.reaudit_release(1)
    assert (env.stats(), env.c.get_release(1), env.c.get_package(1)) == before
    # failed attempts neither reset the cooldown nor use up a slot: the next good check goes through
    env.judge("2.0.0", breaking=[LEGACY], feature=["--json"])
    assert env.c.reaudit_release(1) == 1 and env.c.get_release(1)["check_count"] == 1


def test_the_url_is_pinned_to_the_original_release_url(env):
    env.register()
    env.audit(breaking=[LEGACY])
    env.cooldown()
    env.vm._web_mocks.clear()
    env.vm.mock_web(r"acme/widget/releases/tag/friendly", {"status": 200, "body": SOFT})   # a friendlier page elsewhere
    env.llm_numbers(fix=[1])
    with env.revert("could not be fetched"):    # only NOTES_URL is ever read
        env.c.reaudit_release(1)
    assert env.c.get_release(1)["notes_url"] == NOTES_URL


def test_anyone_can_reaudit_and_the_requester_is_recorded(env):
    setup(env)
    env.vm.sender = env.bob
    reaudit(env, NOISY, breaking=[LEGACY])
    assert env.c.get_audit(2)["requester"] == env.bob.as_hex


def test_prerelease_stays_exempt(env):
    env.register()
    body = CHANGELOG.replace("[2.0.0]", "[2.0.0-rc.1]")
    env.audit(version="2.0.0-rc.1", previous="1.5.0", body=body, breaking=[LEGACY])
    env.cooldown()
    env.page(body.replace("- Removed the legacy `connect()` API. Use `Client.open()` instead.", "- Added a small thing in the tool."))
    env.llm_numbers(feature=[2])
    env.c.reaudit_release(1)
    r, a = env.c.get_release(1), env.c.get_audit(2)
    assert (r["verdict"], r["verdict_changes"], a["softened"], a["severity"]) == ("EXEMPT", 0, True, "FEATURE")
    assert env.c.get_package(1)["exempt"] == 1 and env.stats()["exempt"] == 1


def test_unknown_release(env):
    with env.revert("release not found"):
        env.c.reaudit_release(1)
    with env.revert("release not found"):
        env.c.reaudit_release(0)


def test_release_audit_history_and_pagination(env):
    setup(env)
    reaudit(env, NOISY, breaking=[LEGACY])
    env.cooldown()
    reaudit(env, CHANGELOG, breaking=[LEGACY])
    page = env.c.list_release_audits(1, 0, 50)
    assert (page["total"], [a["id"] for a in page["items"]]) == (3, [1, 2, 3])
    assert [a["notes_changed"] for a in page["items"]] == [False, True, True]
    assert [a["id"] for a in env.c.list_release_audits(1, 1, 1)["items"]] == [2]
    assert env.c.list_release_audits(1, 5, 10) == {"total": 3, "offset": 3, "items": []}
    assert env.c.list_release_audits(1, 0, 0)["items"] == []
    with env.revert("release not found"):
        env.c.list_release_audits(9, 0, 10)


def test_per_address_quota_counts_rechecks_too(env):
    env.register()
    versions = [f"1.{i}.0" for i in range(1, 60)]
    page = "# Changelog\n" + "".join(f"## {v}\n- Added capability number {i} to the tool.\n" for i, v in enumerate(versions))
    env.page(page)
    env.llm_numbers(feature=[1])
    prev = "1.0.0"
    for v in versions:
        env.c.audit_release(1, v, prev, NOTES_URL)
        prev = v
    env.cooldown()
    assert env.c.reaudit_release(1) == 1                 # an unchanged recheck: the 60th request by this address
    with env.revert("maximum number of audits"):
        env.c.reaudit_release(2)


def test_reaudit_events(env):
    if getattr(env.vm, "events", None) is None:
        pytest.skip("this harness does not expose emitted events")
    setup(env)
    reaudit(env, CHANGELOG, breaking=[LEGACY], feature=["--json"])
    assert [e for e in env.vm.events if e[0] == "ReleaseRechecked"][-1][1:] == ((1,), {"audit_id": "1"})
    assert len([e for e in env.vm.events if e[0] == "ReleaseAudited"]) == 1       # a recheck is not an audit
    env.cooldown()
    reaudit(env, SOFT, feature=["--json"])
    ev = [e for e in env.vm.events if e[0] == "ReleaseAudited"][-1]
    assert ev[1] == (2, 1) and ev[2]["notes_changed"] == "true" and ev[2]["softened"] == "true" and ev[2]["verdict"] == "OVER_BUMPED"
