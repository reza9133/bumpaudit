"""Seeded random histories. After EVERY operation, every counter the contract keeps is
recomputed from the audit history through the public views and compared; every
reverted operation must leave the whole observable state untouched."""
import os
import random

import pytest
from keccak_ref import keccak256

POOL = ["1.1.0", "1.1.1", "1.2.0", "2.0.0", "2.0.1", "2.1.0", "3.0.0-rc.1", "3.0.0"]
PREVIOUS = {v: (POOL[i - 1] if i else "1.0.0") for i, v in enumerate(POOL)}
PREVIOUS["3.0.0-rc.1"] = "2.1.0"
PREVIOUS["3.0.0"] = "2.1.0"

TEMPLATES = {
    "breaking": "Removed legacy thing {n} for good.",
    "marker": "BREAKING CHANGE: replaced thing {n} by another.",
    "feature": "Added new capability {n} to the tool.",
    "fix": "Fixed crash number {n} on startup.",
    "noise": "Thanks to everyone who contributed {n}.",
}


def classify(text):
    if text.startswith("Removed") or text.startswith("BREAKING"):
        return "breaking"
    if text.startswith("Added"):
        return "feature"
    if text.startswith("Fixed"):
        return "fix"
    return None


class World:
    def __init__(self, env, rng):
        self.env, self.rng = env, rng
        self.counter = 0
        self.entries = {}     # pid -> version -> [text]
        self.audited = {}     # pid -> set(version)
        self.release_of = {}  # (pid, version) -> release id
        self.ok_audits = 0
        self.ok_releases = 0

    def text(self, kind):
        self.counter += 1
        return TEMPLATES[kind].format(n=self.counter)

    def fresh_entries(self):
        kinds = self.rng.choices(["breaking", "marker", "feature", "fix", "noise"], weights=[2, 1, 3, 3, 1], k=self.rng.randint(1, 5))
        return [self.text(k) for k in kinds]

    def body(self, pid):
        parts = ["# Changelog\n"]
        for v in reversed(POOL):
            if v in self.entries[pid]:
                parts.append(f"## {v}\n" + "\n".join(f"- {t}" for t in self.entries[pid][v]) + "\n")
        return "\n".join(parts)

    def mock(self, pid, version):
        env = self.env
        env.vm._web_mocks.clear()
        env.vm.mock_web(rf"acme/p{pid}/", {"status": 200, "body": self.body(pid)})
        items = env.c.preview_extraction(self.body(pid), version)["items"]
        groups = {"breaking": [], "feature": [], "fix": []}
        for it in items:
            kind = classify(it["text"])
            if kind:
                groups[kind].append(it["index"] + 1)
        env.llm_numbers(**groups)
        return any(groups.values())


def snapshot(env):
    packages = env.c.list_packages(0, 50)["items"]
    releases = [r for p in packages for r in env.c.list_package_releases(p["id"], 0, 50)["items"]]
    audits = [a for r in releases for a in env.c.list_release_audits(r["id"], 0, 50)["items"]]
    return env.stats(), packages, releases, audits


def check(env, world):
    stats, packages, releases, audits = snapshot(env)
    by_release = {}
    for a in audits:
        by_release.setdefault(a["release_id"], []).append(a)
    totals = dict(compliant=0, under_bumped=0, over_bumped=0, exempt=0, edited=0, softened=0)

    for p in packages:
        mine = [r for r in releases if r["package_id"] == p["id"]]
        assert p["releases"] == len(mine)
        for key, verdict in [("compliant", "COMPLIANT"), ("under_bumped", "UNDER_BUMPED"), ("over_bumped", "OVER_BUMPED"), ("exempt", "EXEMPT")]:
            assert p[key] == sum(1 for r in mine if r["verdict"] == verdict), (p["id"], key)
            totals[key] += p[key]
        assert p["edited"] == sum(1 for r in mine if r["edit_count"] > 0)
        assert p["softened"] == sum(1 for r in mine if r["softened"])
        totals["edited"] += p["edited"]
        totals["softened"] += p["softened"]
        honest, judged = p["compliant"] + p["over_bumped"], p["compliant"] + p["over_bumped"] + p["under_bumped"]
        assert p["judged"] == judged and p["integrity_permille"] == ((honest * 1000 // judged) if judged else None)
        if mine:
            assert p["last_audit_at"] == max(r["last_checked_at"] for r in mine)

    assert stats["packages"] == len(packages) and stats["releases"] == len(releases) == sum(p["releases"] for p in packages)
    assert stats["audits"] == len(audits) == sum(r["audit_count"] for r in releases)
    assert stats["rechecks"] == sum(r["check_count"] for r in releases)
    assert (stats["compliant"], stats["under_bumped"], stats["over_bumped"], stats["exempt"]) == (
        totals["compliant"], totals["under_bumped"], totals["over_bumped"], totals["exempt"])
    assert (stats["edited_releases"], stats["softened_releases"]) == (totals["edited"], totals["softened"])
    assert stats["releases"] == world.ok_releases and stats["audits"] == world.ok_audits
    honest, judged = stats["compliant"] + stats["over_bumped"], stats["compliant"] + stats["over_bumped"] + stats["under_bumped"]
    assert stats["integrity_permille"] == ((honest * 1000 // judged) if judged else None)
    assert sorted(a["id"] for a in audits) == list(range(1, len(audits) + 1))   # no gaps, no reuse
    assert sorted(r["id"] for r in releases) == list(range(1, len(releases) + 1))

    rank = {"NONE": 0, "FIX": 1, "FEATURE": 2, "BREAKING": 3}
    for r in releases:
        history = sorted(by_release[r["id"]], key=lambda a: a["id"])
        assert r["audit_count"] == len(history) <= 30
        assert (r["first_audit_id"], r["latest_audit_id"]) == (history[0]["id"], history[-1]["id"])
        assert r["first_block_hash"] == history[0]["block_hash"] and r["latest_block_hash"] == history[-1]["block_hash"]
        assert (r["verdict"], r["severity"]) == (history[-1]["verdict"], history[-1]["severity"])
        assert r["last_checked_at"] >= history[-1]["created_at"] and r["created_at"] == history[0]["created_at"]
        assert (r["check_count"] == 0) or r["last_checked_at"] >= history[-1]["created_at"]
        assert r["edit_count"] == sum(1 for a in history if a["notes_changed"])
        assert r["verdict_changes"] == sum(1 for x, y in zip(history, history[1:]) if x["verdict"] != y["verdict"])
        assert r["softened"] == any(a["softened"] for a in history)
        for i, a in enumerate(history):
            if i == 0:
                assert (a["notes_changed"], a["softened"]) == (False, False)
            else:
                prev = history[i - 1]
                assert a["notes_changed"] == (a["block_hash"] != prev["block_hash"])
                assert a["softened"] == (a["notes_changed"] and rank[a["severity"]] < rank[prev["severity"]])
            check_audit(env, r, a)
        stamps = [a["created_at"] for a in history]
        assert stamps == sorted(stamps)


def check_audit(env, r, a):
    pv = env.c.preview_verdict(r["previous_version"], r["version"], a["severity"])
    assert (pv["verdict"], pv["required_bump"], pv["declared_bump"]) == (a["verdict"], a["required_bump"], r["declared_bump"])
    assert a["declared_bump"] == r["declared_bump"] and r["prerelease"] == ("-" in r["version"])
    notes = env.c.get_audit_notes(a["id"])
    assert notes["block_hash"] == a["block_hash"] == keccak256(notes["block"].encode("utf-8")).hex()
    assert a["block_len"] == len(notes["block"]) and a["item_count"] == len(notes["items"])
    reparsed = env.c.preview_extraction(notes["block"], r["version"])
    assert reparsed["found"] and [i["text"] for i in reparsed["items"]] == notes["items"]       # stored block re-parses identically
    counts = {"BREAKING": a["breaking_entries"], "FEATURE": a["feature_entries"], "FIX": a["fix_entries"]}
    assert a["breaking_entries"] + a["feature_entries"] + a["fix_entries"] <= a["item_count"]
    assert counts[a["severity"]] >= 1 and len(a["evidence"]) == min(3, counts[a["severity"]])
    assert a["explicit_markers"] <= a["breaking_entries"]
    for e in a["evidence"]:
        assert notes["items"][e["i"]] == e["t"]
    if a["severity"] != "BREAKING":
        assert a["explicit_markers"] == 0
    assert a["requester"].startswith("0x") and len(a["requester"]) == 42


@pytest.mark.parametrize("seed", list(range(int(os.environ.get("BA_SEEDS", "16")))))
def test_random_histories(env, seed):
    rng = random.Random(1000 + seed)
    world = World(env, rng)
    n_packages = 0
    for step in range(48):
        env.vm.sender = rng.choice([env.alice, env.bob, env.carol])
        roll = rng.random()
        before = snapshot(env)
        expect_revert = None

        if roll < 0.18 and n_packages < 4:
            n_packages += 1
            env.c.register_package(f"pkg{n_packages}", "npm", f"https://github.com/acme/p{n_packages}/")
            world.entries[n_packages], world.audited[n_packages] = {}, set()
            check(env, world)
            continue
        if n_packages == 0:
            continue

        pid = rng.randint(1, n_packages)
        url_base = f"https://github.com/acme/p{pid}/blob/main/CHANGELOG.md"
        todo = [v for v in POOL if v not in world.audited[pid]]

        if roll < 0.55 and todo:                                    # audit a new release
            version = rng.choice(todo)
            world.entries[pid][version] = world.fresh_entries()
            classified = world.mock(pid, version)
            mode = rng.random()
            if mode < 0.07:
                env.no_web(); expect_revert = "could not be fetched"
            elif mode < 0.14:
                env.llm_raw("garbage"); expect_revert = "could not be audited"
            elif not classified:
                expect_revert = "none of the release entries"
            if expect_revert:
                with env.revert(expect_revert):
                    env.c.audit_release(pid, version, PREVIOUS[version], url_base)
                assert snapshot(env) == before
                world.entries[pid].pop(version)
            else:
                aid = int(env.c.audit_release(pid, version, PREVIOUS[version], url_base))
                world.audited[pid].add(version)
                world.ok_audits += 1
                world.ok_releases += 1
                assert aid == world.ok_audits
        elif roll < 0.85 and world.audited[pid]:                    # edit the notes, then re-audit
            version = rng.choice(sorted(world.audited[pid]))
            release = env.c.find_release(pid, version)
            if release["audit_count"] >= 30:
                continue
            kept = list(world.entries[pid][version])
            edit = rng.random()
            if edit < 0.12:
                pass                                                    # no edit at all: must be a plain recheck
            elif edit < 0.4 and len(kept) > 1:
                kept.pop(rng.randrange(len(kept)))
            elif edit < 0.65:
                kept.insert(rng.randrange(len(kept) + 1), world.text(rng.choice(["breaking", "feature", "fix", "marker", "noise"])))
            elif edit < 0.85:
                kept[rng.randrange(len(kept))] = world.text(rng.choice(["breaking", "feature", "fix"]))
            old = world.entries[pid][version]
            world.entries[pid][version] = kept
            classified = world.mock(pid, version)
            env.advance(rng.choice([0, 301, 301, 400, 2000]))
            cooling = env.now() - release["last_checked_at"] < 300
            before = snapshot(env)
            expect = "cooldown still active" if cooling else (None if classified else "none of the release entries")
            if expect:
                with env.revert(expect):
                    env.c.reaudit_release(release["id"])
                assert snapshot(env) == before
                world.entries[pid][version] = old
            else:
                returned = int(env.c.reaudit_release(release["id"]))
                after = env.c.get_release(release["id"])
                recorded = after["audit_count"] - release["audit_count"]
                assert recorded in (0, 1)
                world.ok_audits += recorded
                assert returned == after["latest_audit_id"]
                if recorded == 0:                                       # a plain recheck: nothing but the clock moved
                    assert after["check_count"] == release["check_count"] + 1 and after["last_checked_at"] == env.now()
                    assert {**after, "check_count": 0, "last_checked_at": 0} == {**release, "check_count": 0, "last_checked_at": 0}
                else:
                    assert after["check_count"] == release["check_count"]
        else:
            env.advance(rng.randint(0, 500))
        check(env, world)
