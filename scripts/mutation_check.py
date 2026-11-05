#!/usr/bin/env python3
"""Mutation testing for contracts/bump_audit.py.

Every mutation injects one realistic bug (an off-by-one, a dropped check, a flipped
comparison ...) into a temporary copy of the contract and runs the test-suite against
it. A mutant that makes no test fail is a SURVIVOR: either a gap in the tests or an
equivalent mutation. The script exits non-zero if any mutant survives.

    python scripts/mutation_check.py                      # uses `python -m pytest -x -q`
    BA_TEST_CMD="python tools/offline_pytest/run.py -x -q -p offline_sim.plugin" \
        python scripts/mutation_check.py                  # offline runner
    python scripts/mutation_check.py --only floor         # substring filter
"""
import argparse
import ast
import os
import shlex
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "contracts" / "bump_audit.py"
TESTS = ROOT / "tests" / "contract"

# (name, old text, new text). `old` must occur exactly once in the contract.
MUTATIONS = [
    # ---- SemVer ------------------------------------------------------------------
    ("semver/equal-version-allowed", "    if new_core <= prev_core:", "    if new_core < prev_core:"),
    ("semver/major-ge", "    if new_core[0] > prev_core[0]:", "    if new_core[0] >= prev_core[0]:"),
    ("semver/minor-ge", "    if new_core[1] > prev_core[1]:", "    if new_core[1] >= prev_core[1]:"),
    ("semver/leading-zero-allowed", '    return part == "0" or part[0] != "0"', "    return True"),
    ("semver/v-prefix-lower-only", '    if s[:1] in ("v", "V"):\n        s = s[1:]\n    if not s or len(s)', '    if s[:1] in ("v",):\n        s = s[1:]\n    if not s or len(s)'),
    ("semver/two-part-version", "    if len(parts) != 3:", "    if len(parts) < 3:"),
    ("semver/prerelease-dropped-from-key", '    if parsed[3]:\n        key += "-" + parsed[3]', "    if False:\n        key += parsed[3]"),
    ("semver/digit-limit", "MAX_VERSION_DIGITS = 9", "MAX_VERSION_DIGITS = 10"),
    ("semver/prerelease-leading-zero", "        if (\n            forbid_leading_zero\n", "        if (\n            False\n"),
    ("rules/under-includes-equal", "    if shipped < needed:", "    if shipped <= needed:"),
    ("rules/over-in-initial-dev", "    if shipped > needed and not initial_development:", "    if shipped > needed:"),
    ("rules/prerelease-not-exempt", "    if prerelease:\n        return VERDICT_EXEMPT", "    if False:\n        return VERDICT_EXEMPT"),
    ("rules/breaking-initial-dev", "        return BUMP_MINOR if initial_development else BUMP_MAJOR", "        return BUMP_MAJOR"),
    ("rules/feature-initial-dev", "        return BUMP_PATCH if initial_development else BUMP_MINOR", "        return BUMP_MINOR"),
    ("rules/feature-needs-major", "        return BUMP_PATCH if initial_development else BUMP_MINOR", "        return BUMP_PATCH if initial_development else BUMP_MAJOR"),
    # ---- URL policy --------------------------------------------------------------
    ("url/userinfo-allowed", '    for bad in "@%[]":', '    for bad in "%[]":'),
    ("url/port-80", '    if sep and port != "443":', '    if sep and port not in ("443", "80"):'),
    ("url/numeric-tld", "    elif len(tld) < 2 or any(ch not in _LETTERS for ch in tld):", "    elif len(tld) < 2:"),
    ("url/blocked-hosts", "    if host in _BLOCKED_HOSTS:", "    if False:"),
    ("url/suffix-local", '    ".local",\n', '    ".locall",\n'),
    ("url/suffix-internal", '    ".internal",\n', '    ".internall",\n'),
    ("url/suffix-arpa", '    ".arpa",\n', '    ".arpaa",\n'),
    ("url/suffix-nipio", '    ".nip.io",\n', '    ".nip.iox",\n'),
    ("url/encoded-dots", '    if "%2e" in low or "%2f" in low or "%5c" in low:', '    if "%2e" in low:'),
    ("url/dot-segment-single", '    for segment in path.split("/"):\n        if segment == "." or segment == "..":', '    for segment in path.split("/"):\n        if segment == "..":'),
    ("url/backslash", '    if "\\\\" in url:\n        return None', "    if False:\n        return None"),
    ("url/space-allowed", "    if any(ord(ch) < 33 or ord(ch) > 126 for ch in url):", "    if any(ord(ch) < 32 or ord(ch) > 126 for ch in url):"),
    ("url/scheme-prefix", '    if url[:8].lower() != "https://":', '    if url[:7].lower() != "https:/":'),
    ("url/host-case", '    host = host.lower().rstrip(".")', '    host = host.rstrip(".")'),
    ("url/trailing-dot", '    host = host.lower().rstrip(".")', "    host = host.lower()"),
    ("url/prefix-boundary", '    return tail == "" or tail[0] in "/?"', '    return tail == "" or tail[0] in "/?."'),
    ("url/prefix-boundary-dropped", '    return tail == "" or tail[0] in "/?"', "    return True"),
    ("url/fragment-kept", '        remainder = remainder.split("#", 1)[0]', "        pass"),
    ("url/prefix-query", '        if "?" in remainder or "#" in remainder:\n            return None', '        if "#" in remainder:\n            return None'),
    ("url/length", "MAX_URL_CHARS = 500", "MAX_URL_CHARS = 600"),
    ("url/label-hyphen", '    if label[0] == "-" or label[-1] == "-":', '    if label[0] == "-":'),
    ("url/dotless-host", '    if not host or len(host) > 253 or ".." in host or "." not in host:', '    if not host or len(host) > 253 or ".." in host:'),
    # ---- extraction --------------------------------------------------------------
    ("extract/heading-length", "    if len(line) > MAX_HEADING_CHARS:\n        return None", "    if False:\n        return None"),
    ("extract/equals-rule", '    s = s.lstrip("#=").lstrip()', '    s = s.lstrip("#").lstrip()'),
    ("extract/token-validity", "    if not token or _parse_semver(token) is None:\n        return None", "    if not token:\n        return None"),
    ("extract/lead-boundary", '        if low.startswith(lead) and len(s) > len(lead) and s[len(lead)] in " :":', "        if low.startswith(lead):"),
    ("extract/block-stops-at-other-version", "            if other is not None and other != version_key:\n                break", "            if False:\n                break"),
    ("extract/block-stops-at-same-version", "            if other is not None and other != version_key:\n                break", "            if other is not None:\n                break"),
    ("extract/block-chars", "MAX_BLOCK_CHARS = 6000", "MAX_BLOCK_CHARS = 60000"),
    ("extract/block-lines", "MAX_BLOCK_LINES = 400", "MAX_BLOCK_LINES = 4000"),
    ("extract/items", "MAX_ITEMS = 60", "MAX_ITEMS = 600"),
    ("extract/item-chars", "MAX_ITEM_CHARS = 300", "MAX_ITEM_CHARS = 3000"),
    ("extract/min-item", "MIN_ITEM_CHARS = 4", "MIN_ITEM_CHARS = 1"),
    ("extract/heading-letters", "HEADING_KEEP_MIN_LETTERS = 20", "HEADING_KEEP_MIN_LETTERS = 5"),
    ("extract/labels-are-entries", "        if token is not None:\n            rest = text.replace(token, \"\", 1)", "        if False:\n            rest = text.replace(token, \"\", 1)"),
    ("extract/bullet-needs-space", '    while s and s[0] in "-*\\u2022+\\u2013\\u2014" and (len(s) == 1 or s[1] == " "):', '    while s and s[0] in "-*\\u2022+\\u2013\\u2014":'),
    ("extract/hash-strip", '    if s[:1] == "#":\n        s = s.lstrip("#").lstrip()', "    if False:\n        s = s"),
    ("extract/splitlines", "    for chunk in raw[:MAX_PAGE_CHARS].splitlines():", '    for chunk in raw[:MAX_PAGE_CHARS].split("\\n"):'),
    ("extract/page-lines", "MAX_PAGE_LINES = 20000", "MAX_PAGE_LINES = 2000000"),
    ("extract/page-chars", "MAX_PAGE_CHARS = 400000", "MAX_PAGE_CHARS = 4000000"),
    ("extract/skip-empty-sections", '        if items:\n            return {"reason": "", "block": block, "items": items}', '        if True:\n            return {"reason": "", "block": block, "items": items}'),
    ("extract/empty-vs-not-found", '"reason": "empty" if seen_heading else "not_found"', '"reason": "not_found" if seen_heading else "empty"'),
    ("extract/control-chars", '        if ch >= " " and ch != "\\x7f" and not (0xD800 <= ord(ch) <= 0xDFFF)', '        if ch >= " " and ch != "\\x7f"'),
    ("extract/del-char", '        if ch >= " " and ch != "\\x7f" and not', '        if ch >= " " and not'),
    ("extract/preview-cap", "str(page_text)[:MAX_PREVIEW_CHARS]", "str(page_text)"),
    ("extract/whitespace-collapse", '        collapsed = " ".join(chunk.split())', "        collapsed = chunk.strip()"),
    ("extract/trailing-plus", '    while token and token[-1] in ".-":', '    while token and token[-1] in ".-+":'),
    ("extract/heading-bracket", '    while len(s) > 1 and s[0] in "*_[(<`":', '    while len(s) > 1 and s[0] in "*_(<`":'),
    ("consensus/failure-needs-reproduction", '        return (not mine["ok"]) and mine["reason"] == leader.get("reason")', '        return (not mine["ok"])'),
    ("consensus/failure-reason-equality", '        return (not mine["ok"]) and mine["reason"] == leader.get("reason")', '        return (not mine["ok"]) and mine["reason"] != "model"'),
    ("reaudit/pinned-version", "        version_key = str(release.version)", "        version_key = str(release.previous_version)"),
    # ---- explicit-marker floor -----------------------------------------------------
    ("floor/negations", "        if phrase in low:\n            return False", "        if False:\n            return False"),
    ("floor/empty-endings", "        if stripped.endswith(ending):\n            return False", "        if False:\n            return False"),
    ("floor/case-sensitive", "        if marker in text:\n            return True", "        if marker in low:\n            return True"),
    ("floor/conventional-any-type", "        return kind.lower() in _CONVENTIONAL_TYPES", "        return True"),
    ("floor/conventional-scope", '            if not kind.endswith(")"):\n                return False', "            if False:\n                return False"),
    ("floor/conventional-colon", "    if 2 <= colon <= 40 and", "    if 0 <= colon <= 40 and"),
    ("floor/dropped-from-labels", '        list(labels["breaking"]) + floor, labels["feature"], labels["fix"]', '        list(labels["breaking"]), labels["feature"], labels["fix"]'),
    ("labels/feature-vs-breaking", "    middle = set(feature) - top\n", "    middle = set(feature)\n"),
    ("labels/fix-vs-feature", "    low = set(fix) - top - middle\n", "    low = set(fix) - top\n"),
    ("labels/severity-order", '    if labels["breaking"]:\n        return SEV_BREAKING', '    if labels["breaking"] and False:\n        return SEV_BREAKING'),
    ("labels/bool-index", "    if isinstance(value, bool):\n        return None\n    if isinstance(value, float):", "    if isinstance(value, float):"),
    ("labels/zero-index", "    if number < 1 or number > count:", "    if number < 0 or number > count:"),
    ("labels/off-by-one", "    return number - 1", "    return number"),
    ("labels/upper-bound", "    if number < 1 or number > count:", "    if number < 1 or number > count + 1:"),
    ("labels/not-usable", "    if not usable:\n        return None", "    if False:\n        return None"),
    ("labels/model-list-cap", "        for value in raw[: count * 2]:", "        for value in raw:"),
    ("labels/string-digits", "        if not text or len(text) > 6 or any(ch not in _DIGITS for ch in text):", "        if not text or len(text) > 6:"),
    ("labels/float-integer", "        if not value.is_integer():\n            return None", "        if False:\n            return None"),
    ("labels/leader-duplicates", "            if value < 0 or value >= count or value in seen:", "            if value < 0 or value >= count:"),
    ("labels/leader-bool", "            if isinstance(value, bool) or not isinstance(value, int):", "            if not isinstance(value, int):"),
    ("labels/leader-count", "        if not isinstance(values, list) or len(values) > count:", "        if not isinstance(values, list):"),
    ("labels/leader-negative", "            if value < 0 or value >= count or value in seen:", "            if value >= count or value in seen:"),
    ("labels/classify-floor", "    return _apply_floor(items, labels)\n\n\ndef _read_leader_labels", "    return labels\n\n\ndef _read_leader_labels"),
    # ---- prompt hygiene ------------------------------------------------------------
    ("prompt/open-marker", '    return text.replace("<<<", "\\u2039\\u2039\\u2039").replace(">>>", "\\u203a\\u203a\\u203a")', '    return text.replace(">>>", "\\u203a\\u203a\\u203a")'),
    ("prompt/close-marker", '    return text.replace("<<<", "\\u2039\\u2039\\u2039").replace(">>>", "\\u203a\\u203a\\u203a")', '    return text.replace("<<<", "\\u2039\\u2039\\u2039")'),
    ("prompt/numbering", "        for position, item in enumerate(items, 1)", "        for position, item in enumerate(items, 0)"),
    ("prompt/injection-flag", '    return any(marker in low for marker in _INJECTION_MARKERS)', "    return False"),
    ("prompt/injection-flag-settle", '"injection": _injection_flagged("\\n".join(items)),', '"injection": False,'),
    # ---- consensus ------------------------------------------------------------------
    ("consensus/accept-any-result-type", "    if not isinstance(leaders_res, gl.vm.Return):\n        return False", "    if False:\n        return False"),
    ("consensus/ok-must-be-true", '    if leader.get("ok") is not True:\n        return False  # neither', '    if False:\n        return False  # neither'),
    ("consensus/my-page-unreadable", '    if not mine["ok"]:\n        return False\n\n    leader_items', "    leader_items"),
    ("consensus/leader-block-shape", "    if leader_items is None:\n        return False", "    if False:\n        return False"),
    ("consensus/leader-labels-shape", "    if leader_labels is None:\n        return False\n    my_items", "    if False:\n        return False\n    my_items"),
    ("consensus/similarity", "    if not _items_close(leader_items, my_items):\n        return False", "    if False:\n        return False"),
    ("consensus/similarity-pct", "MIN_BLOCK_SIMILARITY_PCT = 80", "MIN_BLOCK_SIMILARITY_PCT = 50"),
    ("consensus/similarity-strict", "    return differing <= allowed", "    return differing < allowed"),
    ("consensus/similarity-floor", "    allowed = max(1, union * (100 - MIN_BLOCK_SIMILARITY_PCT) // 100)", "    allowed = union * (100 - MIN_BLOCK_SIMILARITY_PCT) // 100"),
    ("consensus/floor-on-leader", "    leader_labels = _apply_floor(leader_items, leader_labels)\n    severity", "    severity"),
    ("consensus/evidence-grounding", "        if leader_items[index] not in my_set:\n            return False", "        if False:\n            return False"),
    ("consensus/evidence-cap", "    return list(labels[key][:MAX_EVIDENCE_ITEMS])", "    return list(labels[key][:MAX_EVIDENCE_ITEMS + 1])"),
    ("consensus/my-model-failure", "    if my_labels is None:\n        return False", "    if False:\n        return False"),
    ("consensus/severity-agreement", "    if _severity(my_labels) != severity:\n        return False", "    if False:\n        return False"),
    ("consensus/shared-entry", "        if not (leader_texts & my_texts):\n            return False", "        if False:\n            return False"),
    ("consensus/block-must-be-str", "    if not isinstance(block, str) or not block or len(block) > MAX_BLOCK_CHARS:", "    if not isinstance(block, str) or not block:"),
    ("consensus/block-lines", "    if len(lines) > MAX_BLOCK_LINES:\n        return None", "    if False:\n        return None"),
    ("consensus/block-first-line", "    if _heading_key(lines[0]) != version_key:\n        return None", "    if False:\n        return None"),
    ("consensus/block-other-heading", "        if other is not None and other != version_key:\n            return None", "        if False:\n            return None"),
    ("consensus/block-entries", "    items = _block_items(lines)\n    return items if items else None", "    items = _block_items(lines)\n    return items"),
    ("settle/none-severity", "    if severity == SEV_NONE:\n        raise", "    if False:\n        raise"),
    ("settle/block-shape", "    if items is None:\n        raise", "    if False:\n        raise"),
    ("settle/labels-shape", "    if labels is None:\n        raise", "    if False:\n        raise"),
    ("settle/floor-hits", "    floor_hits = sum(1 for item in items if _explicit_breaking(item))", "    floor_hits = 0"),
    ("settle/failure-text", '    if result.get("ok") is False:\n        raise', '    if False:\n        raise'),
    ("settle/ok-true", '    if result.get("ok") is not True:\n        raise gl.vm.UserError("[EXTERNAL] validators returned a malformed result")', "    pass"),
    ("settle/evidence-index", '    evidence = [{"i": i, "t": items[i]} for i in', '    evidence = [{"i": i + 1, "t": items[i]} for i in'),
    # ---- contract methods ---------------------------------------------------------------
    ("register/name-check", "    if clean_name is None:", "    if False:"),
    ("register/ecosystem-check", "    if eco not in ECOSYSTEMS:", "    if False:"),
    ("register/prefix-check", "        if prefix is None:\n            raise", "        if False:\n            raise"),
    ("register/cap", "    if mine is not None and len(mine) >= MAX_PACKAGES_PER_REGISTRANT:", "    if mine is not None and len(mine) > MAX_PACKAGES_PER_REGISTRANT:"),
    ("register/duplicate", "        existing = self.package_fingerprints.get(fingerprint)\n        if existing is not None:", "        existing = self.package_fingerprints.get(fingerprint)\n        if False:"),
    ("register/fingerprint-case", 'fingerprint = _digest(eco + "\\n" + clean_name.lower() + "\\n" + prefix.lower())', 'fingerprint = _digest(eco + "\\n" + clean_name + "\\n" + prefix.lower())'),
    ("register/fingerprint-prefix", 'fingerprint = _digest(eco + "\\n" + clean_name.lower() + "\\n" + prefix.lower())', 'fingerprint = _digest(eco + "\\n" + clean_name.lower())'),
    ("register/index-case", 'self.name_index.get_or_insert_default(eco + "\\n" + clean_name.lower())', 'self.name_index.get_or_insert_default(eco + "\\n" + clean_name)'),
    ("register/lookup-case", 'key = str(ecosystem).strip().lower() + "\\n" + str(name).strip().lower()', 'key = str(ecosystem).strip().lower() + "\\n" + str(name).strip()'),
    ("audit/previous-stable", "previous_version is not valid SemVer 2.0.0\")\n        if old[3]:", "previous_version is not valid SemVer 2.0.0\")\n        if False:"),
    ("audit/version-order", "        if declared is None:\n            raise gl.vm.UserError(\"[EXPECTED] version must be higher than previous_version\")\n        url = _canonical_url", "        url = _canonical_url"),
    ("audit/url-check", "        if url is None:\n            raise", "        if False:\n            raise"),
    ("audit/prefix-check", "        if not _url_within(prefix, url):", "        if False:"),
    ("audit/duplicate-release", "        existing = self.release_keys.get(release_key)\n        if existing is not None:", "        existing = self.release_keys.get(release_key)\n        if False:"),
    ("audit/release-key-package", 'release_key = str(int(package_id)) + ":" + version_key', "release_key = version_key"),
    ("audit/release-cap", "        if int(package.n_releases) >= MAX_RELEASES_PER_PACKAGE:", "        if int(package.n_releases) > MAX_RELEASES_PER_PACKAGE:"),
    ("audit/initial-dev", "        initial_development = old[0] == 0\n        prerelease", "        initial_development = old[0] == 1\n        prerelease"),
    ("audit/prerelease-flag", "        prerelease = bool(new[3])\n        required", "        prerelease = False\n        required"),
    ("audit/release-count", "        package.n_releases = u256(int(package.n_releases) + 1)", "        pass"),
    ("audit/verdict-count", "        self._count_verdict(package, verdict, 1)\n\n        ReleaseAudited(", "        pass\n\n        ReleaseAudited("),
    ("audit/package-clock", "        package.last_audit_at = u256(now)\n        self._count_verdict", "        self._count_verdict"),
    ("audit/stored-url", "            notes_url=url,", "            notes_url=str(notes_url),"),
    ("audit/stored-version", "            version=version_key,", "            version=str(version),"),
    ("audit/stored-previous", "            previous_version=_semver_key(old),", "            previous_version=str(previous_version),"),
    ("audit/first-audit-id", "        release.first_audit_id = u256(audit_id)\n", ""),
    ("audit/index-releases", "        self.package_releases.get_or_insert_default(u256(int(package_id))).append(u256(release_id))", "        pass"),
    ("audit/release-key-store", "        self.release_keys[release_key] = u256(release_id)\n", ""),
    ("quota/per-address", "        if used >= MAX_AUDITS_PER_ADDRESS:", "        if used > MAX_AUDITS_PER_ADDRESS:"),
    ("quota/counted", "        self.audit_counts[sender] = u256(int(self.audit_counts.get(sender) or 0) + 1)", "        pass"),
    ("reaudit/notes-changed", "        notes_changed = new_hash != old_hash", "        notes_changed = False"),
    ("reaudit/softened-le", '        softened = notes_changed and _SEV_RANK[settled["severity"]] < _SEV_RANK[old_severity]', '        softened = notes_changed and _SEV_RANK[settled["severity"]] <= _SEV_RANK[old_severity]'),
    ("reaudit/softened-needs-change", '        softened = notes_changed and _SEV_RANK[settled["severity"]] < _SEV_RANK[old_severity]', '        softened = _SEV_RANK[settled["severity"]] < _SEV_RANK[old_severity]'),
    ("reaudit/edit-counted-once", "            if int(release.edit_count) == 0:", "            if True:"),
    ("reaudit/edit-count", "            release.edit_count = u256(int(release.edit_count) + 1)", "            pass"),
    ("reaudit/softened-sticky", "        if softened and not release.softened:", "        if softened:"),
    ("reaudit/softened-flag", "            release.softened = True\n", "            pass\n"),
    ("reaudit/verdict-move", "        if verdict != old_verdict:", "        if False:"),
    ("reaudit/verdict-old-decrement", "            self._count_verdict(package, old_verdict, -1)\n", ""),
    ("reaudit/verdict-changes", "            release.verdict_changes = u256(int(release.verdict_changes) + 1)", "            pass"),
    ("reaudit/hash-update", "        release.latest_block_hash = new_hash\n", ""),
    ("reaudit/severity-update", '        release.severity = settled["severity"]\n', ""),
    ("reaudit/latest-id", "        release.latest_audit_id = u256(audit_id)\n        release.latest_block_hash", "        release.latest_block_hash"),
    ("reaudit/audit-count", "        release.audit_count = u256(int(release.audit_count) + 1)", "        pass"),
    ("reaudit/quota", "        self._check_audit_quota(sender)\n        package = self._get_package(int(release.package_id))", "        package = self._get_package(int(release.package_id))"),
    ("count/under-delta", "            self.n_under = u256(int(self.n_under) + delta)", "            self.n_under = u256(int(self.n_under) + abs(delta))"),
    ("count/over-package", "            package.n_over = u256(int(package.n_over) + delta)", "            package.n_over = u256(int(package.n_over) + abs(delta))"),
    ("count/exempt-global", "            self.n_exempt = u256(int(self.n_exempt) + delta)", "            self.n_exempt = u256(int(self.n_exempt) + abs(delta))"),
    ("count/compliant-package", "            package.n_compliant = u256(int(package.n_compliant) + delta)", "            package.n_compliant = u256(int(package.n_compliant) + abs(delta))"),
    ("store/block-len", "            block_len=u256(len(block)),", "            block_len=u256(len(block) + 1),"),
    ("store/item-count", '            item_count=u256(len(settled["items"])),', '            item_count=u256(len(settled["items"]) + 1),'),
    ("store/floor-hits", '            floor_hits=u256(settled["floor_hits"]),', "            floor_hits=u256(0),"),
    ("store/requester", "            requester=sender,", "            requester=Address(b\"\\x00\" * 20),"),
    ("store/block-saved", "        self.audit_blocks[u256(audit_id)] = block\n", ""),
    ("store/audit-indexed", "        self.release_audits.get_or_insert_default(u256(int(release.id))).append(u256(audit_id))\n", ""),
    ("store/hash", "            block_hash=_digest(block),", "            block_hash=_digest(block + ' '),"),
    ("store/injection", "            injection_flagged=bool(settled[\"injection\"]),", "            injection_flagged=False,"),
    ("digest/utf8", '    hasher.update(text.encode("utf-8", "replace"))', '    hasher.update(text.encode("utf-16", "replace"))'),
    ("reaudit/cooldown", "        if now - int(release.last_checked_at) < MIN_REAUDIT_INTERVAL_SECONDS:", "        if now - int(release.last_checked_at) <= MIN_REAUDIT_INTERVAL_SECONDS:"),
    ("reaudit/cooldown-off", "        if now - int(release.last_checked_at) < MIN_REAUDIT_INTERVAL_SECONDS:", "        if False:"),
    ("reaudit/cooldown-from-creation", "        if now - int(release.last_checked_at) < MIN_REAUDIT_INTERVAL_SECONDS:", "        if now - int(release.created_at) < MIN_REAUDIT_INTERVAL_SECONDS:"),
    ("reaudit/clock-update", "        release.last_checked_at = u256(now)\n        package.last_audit_at = u256(now)\n\n        if notes_changed:", "        package.last_audit_at = u256(now)\n\n        if notes_changed:"),
    ("reaudit/max-audits", "        if int(release.audit_count) >= MAX_AUDITS_PER_RELEASE:", "        if int(release.audit_count) > MAX_AUDITS_PER_RELEASE:"),
    ("reaudit/max-audits-off", "        if int(release.audit_count) >= MAX_AUDITS_PER_RELEASE:", "        if False:"),
    ("reaudit/recheck-ignores-hash", '        if not notes_changed and settled["severity"] == old_severity:', '        if settled["severity"] == old_severity:'),
    ("reaudit/recheck-ignores-severity", '        if not notes_changed and settled["severity"] == old_severity:', "        if not notes_changed:"),
    ("reaudit/recheck-never", '        if not notes_changed and settled["severity"] == old_severity:', "        if False:"),
    ("reaudit/recheck-clock", "            release.last_checked_at = u256(now)\n            release.check_count", "            release.check_count"),
    ("reaudit/recheck-count", "            release.check_count = u256(int(release.check_count) + 1)", "            release.check_count = u256(int(release.check_count) + 0)"),
    ("reaudit/recheck-global", "            self.n_rechecks = u256(int(self.n_rechecks) + 1)\n", "            pass\n"),
    ("reaudit/recheck-package-clock", "            package.last_audit_at = u256(now)\n            self.n_rechecks", "            self.n_rechecks"),
    ("reaudit/recheck-quota", "            self._count_request(sender)\n            ReleaseRechecked", "            ReleaseRechecked"),
    ("reaudit/recheck-return", "            return u256(int(release.latest_audit_id))\n\n        if int(release.audit_count)", "            return u256(0)\n\n        if int(release.audit_count)"),
    ("url/prefix-path-required", '        if remainder.strip("/") == "":', "        if False:"),
    ("view/find-packages-window", "[_package_dict(self.packages[ids[i]]) for i in range(start, end)]\n        return {\"total\": total, \"offset\": start, \"items\": items}\n\n    @gl.public.view\n    def list_registrant_packages", "[_package_dict(self.packages[ids[i]]) for i in range(0, total)]\n        return {\"total\": total, \"offset\": start, \"items\": items}\n\n    @gl.public.view\n    def list_registrant_packages"),
    ("view/stats-rechecks", '            "rechecks": int(self.n_rechecks),', '            "rechecks": 0,'),
    ("view/release-check-count", '        "check_count": int(r.check_count),', '        "check_count": 0,'),
    ("view/release-checked-at", '        "last_checked_at": int(r.last_checked_at),', '        "last_checked_at": int(r.created_at),'),
    ("count/request-helper", "        self.audit_counts[sender] = u256(int(self.audit_counts.get(sender) or 0) + 1)\n\n    def _count_verdict", "        pass\n\n    def _count_verdict"),
    # ---- views --------------------------------------------------------------------------
    ("view/window-offset", "    start = min(max(offset, 0), total)", "    start = max(offset, 0)"),
    ("view/window-limit", "    end = min(start + min(max(limit, 0), MAX_PAGE_SIZE), total)", "    end = min(start + max(limit, 0), total)"),
    ("view/window-end", "    end = min(start + min(max(limit, 0), MAX_PAGE_SIZE), total)", "    end = start + min(max(limit, 0), MAX_PAGE_SIZE)"),
    ("view/permille", "        \"integrity_permille\": (honest * 1000 // judged) if judged else None,\n        \"last_audit_at\"", "        \"integrity_permille\": ((honest * 1000 + 1) // judged) if judged else None,\n        \"last_audit_at\""),
    ("view/permille-global", '            "integrity_permille": (honest * 1000 // judged) if judged else None,\n        }\n\n    @gl.public.view\n    def get_package', '            "integrity_permille": (honest * 1000 // (judged + 0)) + 1 if judged else None,\n        }\n\n    @gl.public.view\n    def get_package'),
    ("view/honest-includes-over", "    honest = int(p.n_compliant) + int(p.n_over)", "    honest = int(p.n_compliant)"),
    ("view/stats-packages", '            "packages": int(self.next_package_id) - 1,', '            "packages": int(self.next_package_id),'),
    ("view/stats-audits", '            "audits": int(self.next_audit_id) - 1,', '            "audits": int(self.next_release_id) - 1,'),
    ("view/find-release", '        release_id = self.release_keys.get(str(int(package_id)) + ":" + _semver_key(parsed))', '        release_id = self.release_keys.get("1:" + _semver_key(parsed))'),
    ("view/notes-items", "        items = _items_from_block(text, str(release.version)) or []", "        items = []"),
    ("view/preview-severity", "        if sev not in _SEV_KEY:", "        if False:"),
    ("view/preview-prev-stable", "        if old[3]:\n            raise gl.vm.UserError(\"[EXPECTED] previous_version must be a stable release (no pre-release tag)\")\n        declared = _declared_bump(_core(old), _core(new))\n        if declared is None:\n            raise gl.vm.UserError(\"[EXPECTED] version must be higher than previous_version\")\n        initial_development = old[0] == 0\n        required = _required_bump(sev", "        declared = _declared_bump(_core(old), _core(new))\n        if declared is None:\n            raise gl.vm.UserError(\"[EXPECTED] version must be higher than previous_version\")\n        initial_development = old[0] == 0\n        required = _required_bump(sev"),
    ("view/registrant-address", "        except Exception:\n            raise gl.vm.UserError(\"[EXPECTED] registrant is not a valid address\")", "        except Exception:\n            return {\"total\": 0, \"offset\": 0, \"items\": []}"),
    ("view/audit-evidence", '        "evidence": json.loads(a.evidence),', '        "evidence": [],'),
    ("view/clock-in-package", '        "last_audit_at": int(p.last_audit_at),', '        "last_audit_at": int(p.created_at),'),
    ("view/limits", "            \"min_reaudit_interval_seconds\": MIN_REAUDIT_INTERVAL_SECONDS,", "            \"min_reaudit_interval_seconds\": 60,"),
    ("helper/now", "        return int(datetime.datetime.fromisoformat(raw.replace(\"Z\", \"+00:00\")).timestamp())", "        return int(datetime.datetime.fromisoformat(raw.replace(\"Z\", \"+00:00\")).timestamp()) // 2"),
    ("helper/name-first-char", '    if text[0] not in _ALNUM and text[0] != "@":', "    if False:"),
    ("helper/name-needs-alnum", "    if not any(ch in _ALNUM for ch in text):", "    if False:"),
    ("helper/name-length", "    if not (0 < len(text) <= MAX_NAME_CHARS):", "    if not (0 < len(text) <= MAX_NAME_CHARS + 1):"),
    ("helper/name-charset", '_NAME_CHARS = _ALNUM | frozenset("._-@/+")', '_NAME_CHARS = _ALNUM | frozenset("._-@/+ ")'),
]


# Mutants that cannot be killed because they do not change behaviour. Each one is justified.
EQUIVALENT = {
    "url/userinfo-allowed": "the host-label check also rejects '@', so the explicit '@' test is defence in depth",
    "floor/conventional-colon": "every conventional type is >= 2 characters long, so the type whitelist subsumes the lower bound",
    "labels/leader-count": "pure resource guard: unique in-range integers can never outnumber the entries",
    "count/exempt-global": "a pre-release is always EXEMPT, so the EXEMPT counter is never decremented",
}


def test_command():
    raw = os.environ.get("BA_TEST_CMD") or f"{shlex.quote(sys.executable)} -m pytest -x -q"
    files = sorted(p for p in TESTS.glob("test_*.py") if p.name != "test_invariants.py")
    ordered = files + [TESTS / "test_invariants.py"]   # the slow seeded test runs last
    return shlex.split(raw) + [str(p) for p in ordered]


def run_one(name, old, new, workdir, timeout):
    source = CONTRACT.read_text(encoding="utf-8")
    if source.count(old) != 1:
        return name, "STALE", f"pattern occurs {source.count(old)} times"
    mutated = source.replace(old, new)
    try:
        ast.parse(mutated)
    except SyntaxError as exc:
        return name, "INVALID", str(exc)
    target = workdir / (name.replace("/", "_") + ".py")
    target.write_text(mutated, encoding="utf-8")
    env = dict(os.environ, BA_CONTRACT=str(target), BA_SEEDS=os.environ.get("BA_SEEDS", "3"))
    started = time.time()
    try:
        proc = subprocess.run(test_command(), cwd=ROOT, env=env, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return name, "KILLED", "timeout"
    return name, ("SURVIVED" if proc.returncode == 0 else "KILLED"), f"{time.time() - started:.1f}s"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="", help="substring filter on mutation names")
    ap.add_argument("--timeout", type=int, default=240)
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--limit", type=int, default=0, help="run at most N mutations (use with --start-at)")
    ap.add_argument("--start-at", default="", help="skip every mutation before this name (resume)")
    args = ap.parse_args()
    chosen = [m for m in MUTATIONS if args.only in m[0]]
    if args.start_at:
        names_in_order = [m[0] for m in chosen]
        chosen = chosen[names_in_order.index(args.start_at):]
    if args.limit:
        chosen = chosen[: args.limit]
    if args.list:
        print("\n".join(m[0] for m in chosen))
        return 0
    names = [m[0] for m in MUTATIONS]
    assert len(names) == len(set(names)), "duplicate mutation names"
    results = []
    with tempfile.TemporaryDirectory() as tmp:
        for name, old, new in chosen:
            result = run_one(name, old, new, Path(tmp), args.timeout)
            results.append(result)
            print(f"{result[1]:9} {result[0]:44} {result[2]}", flush=True)
    equivalent = [r for r in results if r[1] == "SURVIVED" and r[0] in EQUIVALENT]
    bad = [r for r in results if r[1] != "KILLED" and r not in equivalent]
    for r in equivalent:
        print(f"EQUIVALENT {r[0]}: {EQUIVALENT[r[0]]}")
    killed = sum(1 for r in results if r[1] == "KILLED")
    print(f"\n{killed}/{len(results)} mutants killed, {len(equivalent)} documented as equivalent" + ("" if not bad else f"; NOT killed: {[r[0] + ':' + r[1] for r in bad]}"))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
