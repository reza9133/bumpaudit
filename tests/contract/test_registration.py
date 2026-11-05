import pytest
from helpers import PREFIX


def test_register_a_package(env):
    pid = env.register()
    assert pid == 1
    p = env.c.get_package(1)
    assert p["name"] == "widget" and p["ecosystem"] == "npm" and p["source_prefix"] == PREFIX
    assert p["registrant"] == env.alice.as_hex and p["created_at"] == env.now()
    assert (p["releases"], p["judged"], p["integrity_permille"]) == (0, 0, None)
    s = env.stats()
    assert (s["packages"], s["releases"], s["audits"]) == (1, 0, 0) and s["integrity_permille"] is None


def test_ids_are_sequential_and_registrants_are_tracked(env):
    assert env.register("a-one") == 1
    assert env.register("b-two", sender=env.bob) == 2
    assert env.register("c-three", sender=env.alice) == 3
    assert [p["id"] for p in env.c.list_registrant_packages(env.alice.as_hex)["items"]] == [1, 3]
    assert [p["id"] for p in env.c.list_registrant_packages(env.bob.as_hex)["items"]] == [2]
    assert env.c.list_registrant_packages(env.carol.as_hex) == {"total": 0, "offset": 0, "items": []}


def test_name_is_normalised_but_case_is_preserved(env):
    env.register("  @Scope/Pkg-Name_1.2+x  ")
    assert env.c.get_package(1)["name"] == "@Scope/Pkg-Name_1.2+x"


@pytest.mark.parametrize("name", [
    "", "   ", "a b", "bad name", "x\ny", "caf\u00e9", "<<<inject>>>", "pkg;rm", "pkg'", 'pkg"', "-leading", ".leading",
    "_leading", "+++", "@", "a" * 81, "\u202epkg", "pk\x00g", "pkg\u200b", "pkg%20", "pkg?x", "pkg#x", "a=b",
])
def test_bad_names_are_rejected(env, name):
    with env.revert("name must be"):
        env.register(name)
    assert env.stats()["packages"] == 0


@pytest.mark.parametrize("name", ["a", "@s", "@s/p", "a.b_c-d+e/f", "A" * 80, "7zip", "@7/x"])
def test_good_names_are_accepted(env, name):
    assert env.register(name) == 1


@pytest.mark.parametrize("eco", ["npm", "NPM", " pypi ", "Cargo", "go", "maven", "nuget", "rubygems", "composer", "hex", "pub", "swift", "other"])
def test_ecosystems_are_validated_and_lower_cased(env, eco):
    env.register("pkg", eco)
    assert env.c.get_package(1)["ecosystem"] == eco.strip().lower()


@pytest.mark.parametrize("eco", ["", "npmx", "python", "debian", "n pm", "<<<"])
def test_unknown_ecosystems_are_rejected(env, eco):
    with env.revert("ecosystem must be"):
        env.register("pkg", eco)


@pytest.mark.parametrize("prefix", [
    "http://github.com/a/b/", "github.com/a/b", "https://127.0.0.1/a/", "https://github.com:8443/a/", "https://u@github.com/a/",
    "https://github.com/a/b?x=1", "https://github.com/a/b#x", "https://github.com/a/../b/", "", "https://localhost/",
    "https://github.com", "https://github.com/", "https://github.com//",
])
def test_bad_prefixes_are_rejected(env, prefix):
    with env.revert("source_prefix must be"):
        env.register("pkg", "npm", prefix)
    assert env.stats()["packages"] == 0


def test_prefix_is_stored_canonically(env):
    env.register("pkg", "npm", "HTTPS://GitHub.com:443/Acme/Widget/")
    assert env.c.get_package(1)["source_prefix"] == "https://github.com/Acme/Widget/"


def test_duplicates_are_rejected_after_normalisation(env):
    env.register("Widget", "npm", "https://github.com/acme/widget/")
    for name, eco, prefix in [
        ("Widget", "npm", "https://github.com/acme/widget/"),
        ("widget", "NPM", "https://GITHUB.com/acme/widget/"),
        (" WIDGET ", "npm", "https://github.com:443/acme/widget/"),
    ]:
        with env.revert("already registered as package #1"):
            env.register(name, eco, prefix)
    assert env.stats()["packages"] == 1


def test_same_name_with_a_different_source_or_ecosystem_is_a_separate_entry(env):
    env.register("widget", "npm", "https://github.com/acme/widget/")
    assert env.register("widget", "npm", "https://github.com/evil/widget/", sender=env.bob) == 2
    assert env.register("widget", "pypi", "https://github.com/acme/widget/") == 3
    assert env.register("widget", "npm", "https://github.com/acme/widget") == 4  # no trailing slash: different prefix
    found = env.c.find_packages("npm", "WIDGET", 0, 50)
    assert [p["id"] for p in found["items"]] == [1, 2, 4] and found["total"] == 3 and found["offset"] == 0
    assert [p["id"] for p in env.c.find_packages(" PyPI ", "widget", 0, 50)["items"]] == [3]
    assert env.c.find_packages("npm", "nothing", 0, 50) == {"total": 0, "offset": 0, "items": []}
    assert [p["id"] for p in env.c.find_packages("npm", "widget", 1, 1)["items"]] == [2]          # paginated
    assert env.c.find_packages("npm", "widget", 9, 5) == {"total": 3, "offset": 3, "items": []}
    assert env.c.find_packages("npm", "widget", 0, 0)["items"] == []


def test_the_original_record_cannot_be_overwritten_by_a_lookalike(env):
    env.register("widget", "npm", "https://github.com/acme/widget/")
    env.register("widget", "npm", "https://github.com/evil/widget/", sender=env.bob)
    original = env.c.get_package(1)
    assert original["registrant"] == env.alice.as_hex and original["source_prefix"] == "https://github.com/acme/widget/"


def test_per_registrant_cap_and_a_revert_changes_nothing(env):
    for i in range(20):
        env.register(f"pkg{i}")
    before = env.stats()
    with env.revert("maximum number of packages"):
        env.register("one-too-many")
    assert env.stats() == before and env.c.get_package(20)["name"] == "pkg19"
    assert env.register("someone-else", sender=env.bob) == 21  # the cap is per address


def test_a_rejected_registration_does_not_burn_an_id_or_a_slot(env):
    with env.revert("name must be"):
        env.register("bad name")
    assert env.register("good") == 1
    with env.revert("already registered"):
        env.register("good")
    assert env.register("good2") == 2


def test_unknown_package(env):
    with env.revert("package not found"):
        env.c.get_package(1)
    with env.revert("package not found"):
        env.c.get_package(0)


def test_registration_emits_an_event(env):
    if getattr(env.vm, "events", None) is None:
        pytest.skip("this harness does not expose emitted events")
    env.register("widget", "pypi")
    events = [e for e in env.vm.events if e[0] == "PackageRegistered"]
    assert len(events) == 1 and events[0][1] == (1,) and events[0][2] == {"name": "widget", "ecosystem": "pypi"}
