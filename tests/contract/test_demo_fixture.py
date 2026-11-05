"""The scenario promised by `npm run demo` and the README, executed on the shipped fixture."""
from helpers import ROOT

FIXTURE = (ROOT / "examples" / "fixtures" / "CHANGELOG.md").read_text(encoding="utf-8")
BASE = "https://raw.githubusercontent.com/acme/demo/main/examples/fixtures"
URL = BASE + "/CHANGELOG.md"


def audit(env, version, previous, **labels):
    env.page(FIXTURE, pattern=r"raw\.githubusercontent\.com/acme/demo")
    env.judge(version, **labels)
    env.c.audit_release(1, version, previous, URL)
    release = env.c.find_release(1, version)
    return env.c.get_audit(release["latest_audit_id"])


def test_the_demo_scenario_produces_the_advertised_verdicts(env):
    env.register("acme-widget", "npm", BASE + "/")
    hidden = audit(env, "1.4.3", "1.4.2", breaking=["--legacy"], fix=["typo"])
    assert (hidden["verdict"], hidden["severity"], hidden["declared_bump"], hidden["required_bump"]) == ("UNDER_BUMPED", "BREAKING", "PATCH", "MAJOR")
    assert hidden["evidence"][0]["t"] == "Removed the deprecated `--legacy` flag. Scripts that still pass it now fail."

    feature = audit(env, "1.5.0", "1.4.3", feature=["streaming"], fix=["crash"])
    assert (feature["verdict"], feature["severity"], feature["declared_bump"]) == ("COMPLIANT", "FEATURE", "MINOR")

    major = audit(env, "2.0.0", "1.5.0", breaking=["legacy `connect()`"], feature=["--json"])
    assert (major["verdict"], major["severity"], major["declared_bump"]) == ("COMPLIANT", "BREAKING", "MAJOR")

    package = env.c.get_package(1)
    assert (package["compliant"], package["under_bumped"], package["releases"], package["integrity_permille"]) == (2, 1, 3, 666)


def test_each_release_section_is_cut_cleanly_from_the_fixture(env):
    for version, expect_in, expect_out in [
        ("2.0.0", "legacy `connect()`", "streaming"),
        ("1.5.0", "streaming uploads", "--legacy"),
        ("1.4.3", "--legacy", "memory leak"),
        ("1.4.2", "memory leak", "typo"),
    ]:
        got = env.c.preview_extraction(FIXTURE, version)
        text = "\n".join(i["text"] for i in got["items"])
        assert got["found"] and expect_in in text and expect_out not in text, version
    assert env.c.preview_extraction(FIXTURE, "3.0.0")["reason"] == "not_found"
    assert env.c.preview_extraction(FIXTURE, "9.9.9")["found"] is False
