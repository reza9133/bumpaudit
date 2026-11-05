import json

import pytest
from helpers import CHANGELOG, NOTES_URL, PREFIX

LEGACY = "legacy `connect()`"


def test_version_and_limits(env):
    assert env.c.get_version() == "1.0.0" and env.stats()["version"] == "1.0.0"
    lim = env.c.get_limits()
    assert lim["version"] == "1.0.0" and "npm" in lim["ecosystems"] and lim["ecosystems"][-1] == "other"
    assert (lim["max_page_size"], lim["min_reaudit_interval_seconds"], lim["max_audits_per_release"]) == (50, 300, 30)
    assert (lim["max_block_chars"], lim["max_items"], lim["max_evidence_items"], lim["min_block_similarity_pct"]) == (6000, 60, 3, 80)


def test_every_view_returns_plain_json_types(env):
    env.register()
    env.audit(breaking=[LEGACY], feature=["--json"])
    env.cooldown()
    env.page(CHANGELOG.replace("- Removed the legacy `connect()` API. Use `Client.open()` instead.", "- Tidied the docs a little bit."))
    env.judge("2.0.0", fix=["Tidied"])
    env.c.reaudit_release(1)
    outputs = [
        env.c.get_version(), env.c.get_limits(), env.c.get_stats(), env.c.get_package(1), env.c.list_packages(0, 10),
        env.c.find_packages("npm", "widget", 0, 10), env.c.list_registrant_packages(env.alice.as_hex), env.c.get_release(1),
        env.c.find_release(1, "2.0.0"), env.c.list_package_releases(1, 0, 10), env.c.get_audit(2), env.c.list_release_audits(1, 0, 10),
        env.c.get_audit_notes(2), env.c.describe_version("1.2.3"), env.c.preview_verdict("1.0.0", "2.0.0", "BREAKING"),
        env.c.check_source_url(PREFIX, True), env.c.preview_extraction(CHANGELOG, "1.5.0"),
    ]
    def plain(value, path="out"):
        if value is None or isinstance(value, (bool, int, str)):
            return
        if isinstance(value, list):
            for i, v in enumerate(value):
                plain(v, f"{path}[{i}]")
        elif isinstance(value, dict):
            for k, v in value.items():
                assert isinstance(k, str), (path, k)
                plain(v, f"{path}.{k}")
        else:  # floats, bytes, storage proxies, tuples ... must never leak out of a view
            raise AssertionError(f"{path}: {type(value).__name__}")

    for out in outputs:
        plain(out)
        json.dumps(out)


def test_views_do_not_change_state(env):
    env.register()
    env.audit(breaking=[LEGACY])
    before = (env.stats(), env.c.get_release(1), env.c.get_audit(1), env.c.get_package(1))
    for _ in range(3):
        env.c.get_stats(); env.c.list_packages(0, 50); env.c.get_audit_notes(1); env.c.preview_extraction(CHANGELOG, "2.0.0")
    assert (env.stats(), env.c.get_release(1), env.c.get_audit(1), env.c.get_package(1)) == before


def test_package_pagination(env):
    for sender, count in ((env.alice, 20), (env.bob, 20), (env.carol, 15)):
        for i in range(count):
            env.register(f"pkg-{sender.as_hex[2:6]}-{i}", sender=sender)
    assert env.stats()["packages"] == 55
    page = env.c.list_packages(0, 1000)                      # the page size is capped at 50
    assert (page["total"], page["offset"], len(page["items"])) == (55, 0, 50)
    assert [p["id"] for p in page["items"]] == list(range(1, 51))
    tail = env.c.list_packages(50, 50)
    assert (tail["offset"], [p["id"] for p in tail["items"]]) == (50, [51, 52, 53, 54, 55])
    assert [p["id"] for p in env.c.list_packages(3, 2)["items"]] == [4, 5]
    assert env.c.list_packages(999, 10) == {"total": 55, "offset": 55, "items": []}
    assert env.c.list_packages(0, 0)["items"] == []
    assert [p["id"] for p in env.c.list_packages(54, 10)["items"]] == [55]


def test_empty_contract_views(env):
    assert env.c.list_packages(0, 10) == {"total": 0, "offset": 0, "items": []}
    s = env.stats()
    assert (s["packages"], s["releases"], s["audits"], s["integrity_permille"]) == (0, 0, 0, None)
    assert env.c.find_packages("npm", "x", 0, 10) == {"total": 0, "offset": 0, "items": []}


def test_package_release_listing(env):
    env.register()
    env.audit(version="2.0.0", previous="1.5.0", breaking=[LEGACY])
    env.audit(version="1.5.0", previous="1.4.2", feature=["streaming"])
    env.audit(version="1.4.2", previous="1.4.1", fix=["memory leak"])
    page = env.c.list_package_releases(1, 0, 10)
    assert (page["total"], [r["version"] for r in page["items"]]) == (3, ["2.0.0", "1.5.0", "1.4.2"])   # in audit order
    assert [r["version"] for r in env.c.list_package_releases(1, 1, 1)["items"]] == ["1.5.0"]
    assert env.c.list_package_releases(1, 7, 1) == {"total": 3, "offset": 3, "items": []}
    env.register("empty-one", "pypi")
    assert env.c.list_package_releases(2, 0, 10) == {"total": 0, "offset": 0, "items": []}
    with env.revert("package not found"):
        env.c.list_package_releases(9, 0, 10)


@pytest.mark.parametrize("call,args,message", [
    ("get_release", (1,), "release not found"), ("get_audit", (1,), "audit not found"), ("get_audit_notes", (1,), "audit not found"),
    ("get_package", (1,), "package not found"), ("get_release", (0,), "release not found"),
])
def test_unknown_ids(env, call, args, message):
    with env.revert(message):
        getattr(env.c, call)(*args)


@pytest.mark.parametrize("bad", ["", "nope", "0x12", "0x" + "zz" * 20, "0x" + "ab" * 21])
def test_registrant_listing_validates_the_address(env, bad):
    with env.revert("not a valid address"):
        env.c.list_registrant_packages(bad)


def test_audit_notes_round_trip(env):
    env.register()
    env.audit(breaking=[LEGACY], feature=["--json"])
    notes = env.c.get_audit_notes(1)
    assert notes["audit_id"] == 1 and notes["items"] == [i["text"] for i in env.c.preview_extraction(notes["block"], "2.0.0")["items"]]
    assert [notes["items"][e["i"]] for e in env.c.get_audit(1)["evidence"]] == [e["t"] for e in env.c.get_audit(1)["evidence"]]


def test_find_packages_normalises_its_query(env):
    env.register("Widget")
    assert env.c.find_packages("  NPM ", "  wIdGeT ", 0, 10)["total"] == 1
    assert env.c.find_packages("pypi", "widget", 0, 10)["total"] == 0


def test_stats_aggregate_over_packages(env):
    env.register("one")
    env.register("two", "pypi", "https://github.com/acme/two/")
    env.audit(pid=1, breaking=[LEGACY])
    env.page(CHANGELOG, pattern=r"acme/two")
    env.judge("1.5.0", feature=["streaming"])
    env.c.audit_release(2, "1.5.0", "1.4.2", "https://github.com/acme/two/x")
    s = env.stats()
    assert (s["packages"], s["releases"], s["audits"], s["compliant"], s["integrity_permille"]) == (2, 2, 2, 2, 1000)
