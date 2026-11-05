"""Shared helpers for the BumpAudit direct-mode contract tests."""
import datetime as dt
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CONTRACT = os.environ.get("BA_CONTRACT") or str(ROOT / "contracts" / "bump_audit.py")

PREFIX = "https://github.com/acme/widget/"
NOTES_URL = PREFIX + "blob/main/CHANGELOG.md"
PAGE_PATTERN = r"github\.com/acme/widget"

# A Keep-a-Changelog style page with four releases.
CHANGELOG = """# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

## [2.0.0] - 2026-03-01

### Removed
- Removed the legacy `connect()` API. Use `Client.open()` instead.

### Changed
- The minimum supported Python version is now 3.10.

### Added
- New `--json` output flag for the command line tool.

## [1.5.0] - 2026-01-10

### Added
- Added streaming uploads for large files.

### Fixed
- Fixed a crash when uploading empty files.

## [1.4.2] - 2025-12-01

### Fixed
- Fixed a memory leak in the uploader.
- Corrected the retry delay calculation.

## [0.9.0] - 2025-06-01

### Added
- First public beta of the command line tool.
"""

# Pages that describe a single release (GitHub "release" page style).
RELEASE_PAGE_FIX = """v1.4.2
Latest
Fixed a memory leak in the uploader.
Corrected the retry delay calculation.
"""


def iso(ts: int) -> str:
    return dt.datetime.fromtimestamp(ts, dt.timezone.utc).isoformat().replace("+00:00", "Z")


def numbered(page_text: str, version: str, contract) -> list:
    """The entries a validator would see, as given by the contract's own dry-run parser."""
    return list(contract.preview_extraction(page_text, version)["items"])


class Env:
    """A deployed BumpAudit plus the VM and a few conveniences."""

    def __init__(self, vm, contract, accounts):
        self.vm = vm
        self.c = contract
        self.alice, self.bob, self.carol = accounts
        self.body = CHANGELOG

    # ---- time -------------------------------------------------------------
    def now(self) -> int:
        raw = self.vm._datetime
        return int(dt.datetime.fromisoformat(raw.replace("Z", "+00:00")).timestamp())

    def warp_to(self, ts: int):
        # gltest's warp() updates the VM clock but does not refresh the cached
        # gl.message_raw["datetime"] the contract reads, so do it here too.
        import sys

        self.vm.warp(iso(ts))
        gl = sys.modules.get("genlayer.gl")
        if gl is not None and getattr(gl, "message_raw", None) is not None:
            gl.message_raw["datetime"] = iso(ts)

    def advance(self, seconds: int):
        self.warp_to(self.now() + seconds)

    def cooldown(self):
        self.advance(301)

    # ---- mocks ------------------------------------------------------------
    def page(self, body: str, pattern: str = PAGE_PATTERN):
        self.body = body
        self.vm._web_mocks.clear()
        self.vm.mock_web(pattern, {"status": 200, "body": body})

    def no_web(self):
        self.vm._web_mocks.clear()

    def numbers(self, version: str, needles) -> list:
        """1-based entry numbers (as the model sees them) whose text contains a needle."""
        items = self.c.preview_extraction(self.body, version)["items"]
        found = []
        for needle in needles:
            hits = [it["index"] + 1 for it in items if needle in it["text"]]
            assert hits, f"no entry containing {needle!r} in {[it['text'] for it in items]}"
            found.append(hits[0])
        return found

    def llm_numbers(self, breaking=(), feature=(), fix=()):
        self.vm._llm_mocks.clear()
        self.vm.mock_llm(r".*", json.dumps({"breaking": list(breaking), "feature": list(feature), "fix": list(fix)}))

    def judge(self, version: str, breaking=(), feature=(), fix=()):
        """Make the mocked model classify entries identified by a text needle."""
        self.llm_numbers(
            self.numbers(version, breaking),
            self.numbers(version, feature),
            self.numbers(version, fix),
        )

    def llm_raw(self, text: str):
        self.vm._llm_mocks.clear()
        self.vm.mock_llm(r".*", text)

    # ---- actions ----------------------------------------------------------
    def register(self, name="widget", ecosystem="npm", prefix=PREFIX, sender=None) -> int:
        if sender is not None:
            self.vm.sender = sender
        return int(self.c.register_package(name, ecosystem, prefix))

    def audit(self, pid=1, version="2.0.0", previous="1.5.0", url=NOTES_URL, body=None,
              sender=None, breaking=(), feature=(), fix=()) -> int:
        if sender is not None:
            self.vm.sender = sender
        if body is not None:
            self.page(body)
        else:
            self.page(self.body)
        self.judge(version, breaking, feature, fix)
        return int(self.c.audit_release(pid, version, previous, url))

    def audit_breaking(self, pid=1, version="2.0.0", previous="1.5.0", **kw):
        return self.audit(pid, version, previous, breaking=["legacy `connect()`"], **kw)

    def stats(self) -> dict:
        return dict(self.c.get_stats())

    def revert(self, text):
        return self.vm.expect_revert(text)
