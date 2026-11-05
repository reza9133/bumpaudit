"""SemVer parsing and the deterministic bump rules (pure views, no network)."""
import random
import re

import pytest

# The official regular expression from https://semver.org (numeric parts limited to 9 digits here).
OFFICIAL = re.compile(
    r"^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})"
    r"(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?"
    r"(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$",
    re.ASCII,
)

VALID = [
    ("1.2.3", "1.2.3"),
    ("v1.2.3", "1.2.3"),
    ("V1.2.3", "1.2.3"),
    ("0.0.0", "0.0.0"),
    ("10.20.30", "10.20.30"),
    ("1.2.3-alpha", "1.2.3-alpha"),
    ("1.2.3-alpha.1", "1.2.3-alpha.1"),
    ("1.2.3-0.3.7", "1.2.3-0.3.7"),
    ("1.2.3-x.7.z.92", "1.2.3-x.7.z.92"),
    ("1.0.0-alpha-beta", "1.0.0-alpha-beta"),
    ("1.2.3-0A.is.legal", "1.2.3-0A.is.legal"),
    ("1.2.3+build.5", "1.2.3"),
    ("1.2.3-rc.1+build.5", "1.2.3-rc.1"),
    ("1.2.3+build-5", "1.2.3"),
    ("1.2.3--", "1.2.3--"),  # "-" is a legal alphanumeric identifier in the SemVer grammar
    ("  1.2.3  ", "1.2.3"),
    ("999999999.999999999.999999999", "999999999.999999999.999999999"),
]

INVALID = [
    "", " ", "v", "vv1.2.3", "1", "1.2", "1.2.3.4", "01.2.3", "1.02.3", "1.2.03",
    "1.2.3-", "1.2.3+", "1.2.3-01", "1.2.3-rc.01", "1.2.3-a..b", "1.2.3-.a", "1.2.3-@",
    "a.b.c", "1.2.x", "-1.2.3", "1.2.3+b+c", "1.2.3+a..b", "1.2.3 4",
    "1.2.3-rc 1", "1_2_3", "1.2.3\n", "1.2.3-\u0661", "\u0661.\u0662.\u0663", "1.2.3-\u00e9",
    "1000000000.0.0", "1.2.-3", "1..3", ".1.2.3", "1.2.3.",
]


@pytest.mark.parametrize("raw,normalized", VALID)
def test_valid_versions(env, raw, normalized):
    got = env.c.describe_version(raw)
    assert got["valid"] is True and got["normalized"] == normalized


@pytest.mark.parametrize("raw", INVALID)
def test_invalid_versions(env, raw):
    # "1.2.3\n" strips to a valid version; everything else here must be rejected
    expected_valid = raw.strip() == "1.2.3"
    assert env.c.describe_version(raw)["valid"] is expected_valid


def test_fields_are_exposed(env):
    got = env.c.describe_version("v3.14.159-rc.2+exp.sha.5114f85")
    assert (got["major"], got["minor"], got["patch"]) == (3, 14, 159)
    assert got["prerelease"] == "rc.2" and got["build"] == "exp.sha.5114f85"


# (previous, version, severity, declared, required, initial_dev, verdict)
MATRIX = [
    # from 1.0.0 on SemVer applies as written
    ("1.4.2", "1.4.3", "FIX", "PATCH", "PATCH", False, "COMPLIANT"),
    ("1.4.2", "1.5.0", "FIX", "MINOR", "PATCH", False, "OVER_BUMPED"),
    ("1.4.2", "2.0.0", "FIX", "MAJOR", "PATCH", False, "OVER_BUMPED"),
    ("1.4.2", "1.4.3", "FEATURE", "PATCH", "MINOR", False, "UNDER_BUMPED"),
    ("1.4.2", "1.5.0", "FEATURE", "MINOR", "MINOR", False, "COMPLIANT"),
    ("1.4.2", "2.0.0", "FEATURE", "MAJOR", "MINOR", False, "OVER_BUMPED"),
    ("1.4.2", "1.4.3", "BREAKING", "PATCH", "MAJOR", False, "UNDER_BUMPED"),
    ("1.4.2", "1.5.0", "BREAKING", "MINOR", "MAJOR", False, "UNDER_BUMPED"),
    ("1.4.2", "2.0.0", "BREAKING", "MAJOR", "MAJOR", False, "COMPLIANT"),
    # a jump bigger than one step is still judged by its most significant part
    ("1.4.2", "1.9.7", "FEATURE", "MINOR", "MINOR", False, "COMPLIANT"),
    ("1.4.2", "3.0.0", "BREAKING", "MAJOR", "MAJOR", False, "COMPLIANT"),
    ("1.4.2", "2.7.1", "BREAKING", "MAJOR", "MAJOR", False, "COMPLIANT"),
    # initial development (0.y.z): MINOR is the breaking boundary, nothing is "over"
    ("0.4.2", "0.4.3", "FIX", "PATCH", "PATCH", True, "COMPLIANT"),
    ("0.4.2", "0.5.0", "FIX", "MINOR", "PATCH", True, "COMPLIANT"),
    ("0.4.2", "0.4.3", "FEATURE", "PATCH", "PATCH", True, "COMPLIANT"),
    ("0.4.2", "0.5.0", "FEATURE", "MINOR", "PATCH", True, "COMPLIANT"),
    ("0.4.2", "0.4.3", "BREAKING", "PATCH", "MINOR", True, "UNDER_BUMPED"),
    ("0.4.2", "0.5.0", "BREAKING", "MINOR", "MINOR", True, "COMPLIANT"),
    ("0.4.2", "1.0.0", "BREAKING", "MAJOR", "MINOR", True, "COMPLIANT"),
    ("0.9.0", "1.0.0", "FIX", "MAJOR", "PATCH", True, "COMPLIANT"),  # stabilisation
    # pre-releases are exempt, whatever they contain
    ("1.4.2", "2.0.0-rc.1", "BREAKING", "MAJOR", "MAJOR", False, "EXEMPT"),
    ("1.4.2", "1.4.3-beta", "BREAKING", "PATCH", "MAJOR", False, "EXEMPT"),
]


@pytest.mark.parametrize("prev,new,severity,declared,required,initial,verdict", MATRIX)
def test_verdict_matrix(env, prev, new, severity, declared, required, initial, verdict):
    got = env.c.preview_verdict(prev, new, severity)
    assert (got["declared_bump"], got["required_bump"], got["initial_development"], got["verdict"]) == (
        declared, required, initial, verdict)


def test_severity_is_case_insensitive_and_validated(env):
    assert env.c.preview_verdict("1.0.0", "1.0.1", "fix")["verdict"] == "COMPLIANT"
    with env.revert("severity must be"):
        env.c.preview_verdict("1.0.0", "1.0.1", "NONE")
    with env.revert("severity must be"):
        env.c.preview_verdict("1.0.0", "1.0.1", "")


@pytest.mark.parametrize("prev,new,message", [
    ("1.0.0", "1.0.0", "must be higher"),
    ("1.0.1", "1.0.0", "must be higher"),
    ("2.0.0", "1.9.9", "must be higher"),
    ("1.0.0", "1.0.0-rc.1", "must be higher"),   # a pre-release of an already shipped version
    ("1.0.0", "1.0.0+build", "must be higher"),  # build metadata is not a new version
    ("1.0.0-rc.1", "1.0.0", "stable release"),
    ("nope", "1.0.0", "valid SemVer"),
    ("1.0.0", "nope", "valid SemVer"),
])
def test_preview_verdict_rejects_bad_pairs(env, prev, new, message):
    with env.revert(message):
        env.c.preview_verdict(prev, new, "FIX")


def _random_candidate(rng):
    alphabet = ["0", "1", "2", "9", "00", "01", ".", ".", ".", "-", "-", "+", "a", "Z", "rc", "x", "_", " ", "v"]
    parts = [str(rng.choice([0, 1, 2, 10, 99, 123456789, 1234567890])) for _ in range(3)]
    base = ".".join(parts)
    for _ in range(rng.randint(0, 6)):
        base += rng.choice(alphabet)
    if rng.random() < 0.15:
        base = rng.choice(alphabet) * rng.randint(0, 3) + base
    return base


def test_parser_agrees_with_the_official_semver_regex(env):
    """Differential test over 4000 seeded random strings (valid and invalid alike)."""
    rng = random.Random(20261029)
    checked = valid = 0
    for _ in range(4000):
        raw = _random_candidate(rng)
        text = raw.strip()
        if text[:1] in ("v", "V"):
            text = text[1:]
        expected = bool(OFFICIAL.match(text)) and "\n" not in text
        got = env.c.describe_version(raw)["valid"]
        assert got is expected, f"{raw!r}: contract says {got}, official regex says {expected}"
        checked += 1
        valid += expected
    assert valid > 300  # the fuzzer must actually reach the valid space
