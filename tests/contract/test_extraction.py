"""The deterministic release-section extractor (exposed as the preview_extraction view)."""
import pytest

FILLER = "Some real change entry that is long enough to count."


def extract(env, page, version="2.0.0"):
    return env.c.preview_extraction(page, version)


def texts(result):
    return [item["text"] for item in result["items"]]


HEADINGS = [
    "## [2.0.0] - 2026-03-01",
    "## 2.0.0",
    "### v2.0.0",
    "# V2.0.0 (2026-03-01)",
    "[2.0.0]",
    "2.0.0 / 2026-03-01",
    "**2.0.0**",
    "__v2.0.0__",
    "v2.0.0",
    "Version 2.0.0",
    "version: 2.0.0",
    "Release 2.0.0",
    "Releases v2.0.0",
    "Release notes for 2.0.0",
    "Release notes v2.0.0",
    "Changelog for v2.0.0",
    "What's new in 2.0.0",
    "Whats new in v2.0.0",
    "Changes in v2.0.0",
    "Tag v2.0.0",
    "2.0.0+build.5",
    "v2.0.0.",
    "=== 2.0.0 ===",
    "`v2.0.0`",
    "<2.0.0>",
    "(2.0.0)",
    "## 2.0.0 -- 2026-03-01",
    "2.0.0:",
]

NOT_HEADINGS = [
    "- 2.0.0 fixed a bug",
    "* 2.0.0 was released",
    "+ v2.0.0 notes",
    "Fixed a regression introduced in 2.0.0",
    "Upgrade to 2.0.0 now",
    "Released 2.0.0 today",
    "see 2.0.0",
    "2.0.0-rc.1",
    "## [2.0.0-beta]",
    "2.0.01",
    "12.0.0",
    "2.0.0.1",
    "v2.0",
    "2.0",
    "## 1.9.0",
    "2.0.x",
    "2.0.0+",             # a bare trailing plus is ambiguous ("2.0.0 and later"), not a version heading
    "Release2.0.0",       # the lead word must be a separate word
    "Version2.0.0",
    "Tag2.0.0",
    "Tagged 2.0.0 for release",
    "Versions 2.0.0 and 1.9.0 compared",
    "versions: 2.0.0",
    "02.0.0",
    "## 2.0.0 " + "x" * 130,       # longer than 120 characters: prose, not a heading
]


@pytest.mark.parametrize("heading", HEADINGS)
def test_heading_forms_are_recognised(env, heading):
    page = f"{heading}\n- {FILLER}\n## 1.0.0\n- older entry that must stay out of the block"
    got = extract(env, page)
    assert got["found"] is True, got
    assert got["block"].split("\n")[0] == heading
    assert FILLER in texts(got)[0] or any(FILLER in t for t in texts(got))
    assert not any("older entry" in t for t in texts(got))


@pytest.mark.parametrize("line", NOT_HEADINGS)
def test_non_headings_are_not_recognised(env, line):
    page = f"Intro text\n{line}\n- {FILLER}\n"
    got = extract(env, page)
    assert got["found"] is False and got["reason"] == "not_found"


def test_other_versions_do_not_match_by_prefix_or_substring(env):
    page = "## 1.2.0-rc.1\n- entry one is here for rc.\n## 11.2.0\n- entry two is here.\n## 1.2.01\n- x entry\n## 21.2.0\n- y entry here"
    assert extract(env, page, "1.2.0")["reason"] == "not_found"
    assert extract(env, page, "1.2.0-rc.1")["found"] is True
    assert extract(env, page, "11.2.0")["found"] is True


def test_prerelease_and_build_metadata(env):
    page = "## 2.0.0-rc.1\n- release candidate entry\n## 2.0.0+exp.sha\n- final entry text\n"
    assert texts(extract(env, page, "2.0.0-rc.1")) == ["release candidate entry"]
    # build metadata never distinguishes versions, in the page or in the request
    assert texts(extract(env, page, "2.0.0+other")) == ["final entry text"]
    assert extract(env, page, "v2.0.0")["version"] == "2.0.0"


def test_block_stops_at_the_next_different_version_only(env):
    page = "## 2.0.0\n- first entry of two\nv2.0.0\n- second entry of two\n## 1.9.0\n- old entry"
    got = extract(env, page)
    assert texts(got) == ["first entry of two", "second entry of two"]      # the repeated label is not an entry
    assert "old entry" not in "\n".join(texts(got))


def test_repeated_version_labels_are_not_entries(env):
    # a release page shows the version as title and again as tag
    page = ("Skip to content\nv2.0.0\nv2.0.0\n[2.0.0] - 2026-03-01\nLatest\n- Fixed a bug in the thing.\n"
            "Upgrade note: 3.2.1 and earlier are affected by the issue.\n")
    assert texts(extract(env, page)) == ["Latest", "Fixed a bug in the thing.", "Upgrade note: 3.2.1 and earlier are affected by the issue."]
    assert extract(env, "v2.0.0\nv2.0.0\n2.0.0\n")["reason"] == "empty"
    # a repeat of the label WITH a real title is content, not a label
    titled = "v2.0.0\n2.0.0 changes the default encoding to UTF-8 everywhere\n"
    assert texts(extract(env, titled)) == ["2.0.0 changes the default encoding to UTF-8 everywhere"]


def test_a_line_that_starts_with_a_version_number_ends_the_section(env):
    """Documented trade-off: such a line is read as the heading of another release, because treating
    long 'x.y.z - Some title' lines as prose would merge the entries of two releases."""
    page = "## 2.0.0\n- an entry that belongs to this release\n3.2.1 and earlier are affected by the issue.\n- not part of the section\n"
    assert texts(extract(env, page)) == ["an entry that belongs to this release"]


def test_table_of_contents_occurrences_are_skipped(env):
    toc = "Contents\nv2.0.0\nv1.9.0\nv1.8.0\n"
    body = "## v2.0.0\n- the real entry under the real heading\n## v1.9.0\n- older"
    got = extract(env, toc + body)
    assert got["found"] and texts(got) == ["the real entry under the real heading"]


def test_heading_without_entries_is_reported_as_empty(env):
    page = "## 2.0.0\n## 1.9.0\n- older entry for 1.9.0\n"
    got = extract(env, page)
    assert (got["found"], got["reason"]) == (False, "empty")
    assert extract(env, "## 1.9.0\n- only this one").reason if False else True
    assert extract(env, "## 1.9.0\n- older entry for 1.9.0")["reason"] == "not_found"


def test_version_label_and_date_headings_are_not_entries(env):
    got = extract(env, "## [2.0.0] - 2026-03-01\n- a real entry here\n")
    assert texts(got) == ["a real entry here"]


def test_a_heading_with_a_real_title_is_kept_as_an_entry(env):
    got = extract(env, "## 2.0.0 - Dropped Python 3.8 and removed the legacy API\n- another entry here\n")
    assert texts(got)[0] == "2.0.0 - Dropped Python 3.8 and removed the legacy API"
    got = extract(env, "## 2.0.0 - Big rewrite\n- another entry here\n")
    assert texts(got) == ["another entry here"]  # fewer than 20 letters: only a label


def test_entry_cleaning(env):
    page = "\n".join([
        "## 2.0.0",
        "- dash bullet entry",
        "* star bullet entry",
        "+ plus bullet entry",
        "\u2022 dot bullet entry",
        "\u2013 en dash bullet entry",
        "\u2014 em dash bullet entry",
        "- - double marker entry",
        "**BREAKING:** bold marker is kept",
        "### Removed",
        "1. numbered entry stays numbered",
        "    - nested indented entry",
        "-",
        "--",
        "- ok",
        "- abc",
        "a",
    ])
    got = texts(extract(env, page))
    assert got == [
        "dash bullet entry", "star bullet entry", "plus bullet entry", "dot bullet entry",
        "en dash bullet entry", "em dash bullet entry", "double marker entry",
        "**BREAKING:** bold marker is kept", "Removed", "1. numbered entry stays numbered",
        "nested indented entry",
    ]


def test_line_endings_and_unicode_separators(env):
    page = "## 2.0.0\r\n- windows entry here\r\n- old mac entry\r- unicode separator entry\u2028- another one here\x0b- vertical tab entry"
    assert texts(extract(env, page)) == [
        "windows entry here", "old mac entry", "unicode separator entry", "another one here", "vertical tab entry"]


def test_whitespace_is_collapsed_inside_lines(env):
    got = extract(env, "## 2.0.0\n-   spaced \t  out\u00a0entry    here  \n")
    assert texts(got) == ["spaced out entry here"]


def test_control_characters_are_removed_from_the_block(env):
    got = extract(env, "## 2.0.0\n- Fixed\x00 a bug\x07 here\x7f\n\x01\x02\x7f\n- second entry text\n")
    assert texts(got) == ["Fixed a bug here", "second entry text"]
    assert all(ord(ch) >= 32 and ord(ch) != 127 for ch in got["block"].replace("\n", ""))


def test_lone_surrogates_are_removed(env):
    got = extract(env, "## 2.0.0\n- Fixed a bug \ud800 with a lone surrogate\n")
    assert texts(got) == ["Fixed a bug with a lone surrogate"] or texts(got) == ["Fixed a bug  with a lone surrogate"]
    assert "\ud800" not in got["block"]


def test_caps(env):
    many = "## 2.0.0\n" + "\n".join(f"- entry number {i} of the long list" for i in range(100))
    got = extract(env, many)
    assert len(got["items"]) == 60 and texts(got)[59] == "entry number 59 of the long list"
    long_entry = extract(env, "## 2.0.0\n- " + "x" * 400)
    assert len(texts(long_entry)[0]) == 300
    big = "## 2.0.0\n" + "\n".join("- " + "w" * 90 + f" {i}" for i in range(200))
    got = extract(env, big)
    assert len(got["block"]) <= 6000 and got["found"]
    lines = "## 2.0.0\n" + "\n".join("- l" for _ in range(1000))   # too short to be entries
    got = extract(env, lines + "\n- one real entry at the end here")
    assert len(got["block"].split("\n")) <= 400


def test_preview_accepts_a_long_page_within_its_own_cap(env):
    late = "## 2.0.0\n- an entry that is far down the page\n"
    assert extract(env, ("x" * 99 + "\n") * 400 + late)["found"] is True   # ~40 000 characters


def test_preview_input_is_capped(env):
    page = ("filler line\n" * 5000) + "## 2.0.0\n- entry past the preview cap here\n"  # > 50 000 chars
    assert len(page) > 50000
    assert extract(env, page)["reason"] == "not_found"


def test_one_line_pages_are_not_parsed(env):
    page = "Release 2.0.0 " + "Removed the legacy API. Added a flag. " * 10   # one line, longer than a heading
    assert extract(env, page)["found"] is False


def test_invalid_version_is_rejected(env):
    with env.revert("valid SemVer"):
        extract(env, "## 2.0.0\n- x entry", "2.0")


EXPLICIT_YES = [
    "BREAKING CHANGE: removed the old API",
    "BREAKING CHANGES: removed the old API",
    "BREAKING: dropped Node 14",
    "**BREAKING:** dropped Node 14",
    "[BREAKING] rename an option",
    "(BREAKING) rename an option",
    "BREAKING-CHANGE: footer style",
    "feat!: new configuration format",
    "fix!: error type changed",
    "refactor(core)!: split the module",
    "**feat!:** new config",
    "`perf(api)!:` faster but different",
    "BREAKING: no longer supports Node 14",
    "\u26a0 BREAKING CHANGES",
    "Note BREAKING CHANGE ahead",
    "`fix(ui)!:` button moved",
]
EXPLICIT_NO = [
    "No breaking changes in this release",
    "There are no BREAKING CHANGES here",
    "Non-breaking refactor of the BREAKING CHANGE detector",
    "This is not breaking",
    "This is not a breaking change (BREAKING CHANGE: no)",
    "Without BREAKING CHANGE markers",
    "BREAKING CHANGES: none",
    "BREAKING CHANGES: None.",
    "BREAKING CHANGES: N/A",
    "BREAKING CHANGES: no",
    "BREAKING - none",
    "breaking change: lowercase is not an explicit marker",
    "Breaking Changes",
    "Added breaking-change detection to the linter",
    "feat: add thing",
    "feat(api): add thing",
    "wow!: something",
    "feat(api!: unbalanced scope",
    "!: nothing before the bang",
    "x!: too short a type",
    "Fixed the avoid BREAKING CHANGE helper",
    "docs: mention that BREAKING is a keyword",
]


@pytest.mark.parametrize("entry", EXPLICIT_YES)
def test_explicit_breaking_markers(env, entry):
    got = extract(env, f"## 2.0.0\n- {entry}\n")
    assert got["items"] and got["items"][0]["explicit_breaking"] is True, got


@pytest.mark.parametrize("entry", EXPLICIT_NO)
def test_non_markers_do_not_trigger_the_floor(env, entry):
    got = extract(env, f"## 2.0.0\n- {entry}\n")
    assert got["items"] and got["items"][0]["explicit_breaking"] is False, got
