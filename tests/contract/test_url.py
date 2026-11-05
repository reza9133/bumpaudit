"""URL policy: public https domain names only; canonical form; no SSRF tricks."""
import pytest

# (input, as_prefix, canonical)
ACCEPT = [
    ("https://github.com/acme/widget/releases", False, "https://github.com/acme/widget/releases"),
    ("HTTPS://GitHub.COM/Acme/Widget", False, "https://github.com/Acme/Widget"),
    ("https://github.com:443/acme/widget", False, "https://github.com/acme/widget"),
    ("https://github.com./acme/widget", False, "https://github.com/acme/widget"),
    ("https://github.com/acme/widget#readme", False, "https://github.com/acme/widget"),
    ("https://github.com/acme/widget?tab=readme#x", False, "https://github.com/acme/widget?tab=readme"),
    ("https://github.com/x?next=../up", False, "https://github.com/x?next=../up"),   # dots in a query are harmless
    ("https://github.com/a/..hidden/x", False, "https://github.com/a/..hidden/x"),
    ("https://raw.githubusercontent.com/acme/widget/main/CHANGELOG.md", False,
     "https://raw.githubusercontent.com/acme/widget/main/CHANGELOG.md"),
    ("https://sub.domain.co.uk/path", False, "https://sub.domain.co.uk/path"),
    ("https://xn--bcher-kva.example.org/x", False, "https://xn--bcher-kva.example.org/x"),
    ("https://a.io", False, "https://a.io"),
    ("https://github.com/acme/widget/", True, "https://github.com/acme/widget/"),
    ("https://github.com/acme/widget", True, "https://github.com/acme/widget"),
    ("https://GITHUB.com:443/acme/", True, "https://github.com/acme/"),
]

REJECT = [
    # scheme / shape
    "", " ", "github.com/x", "//github.com/x", "http://github.com/x", "ftp://github.com/x", "javascript:alert(1)",
    "https:", "https://", "https:///x", "https:/xgithub.com/x", "https:/github.com/x", "https:x//github.com/x", "https:/ /github.com/x", "https;//github.com/x", "https://github.com/x y", " https://github.com/x", "https://github.com/x ",
    "https://github.com/x\tz", "https://github.com/\x00", "https://github.com/\u00fc", "https://github\u00fc.com/",
    "https://github.com\\@evil.com/", "https://github.com/a\\b",
    # userinfo, ports
    "https://user@github.com/x", "https://user:pw@github.com/x", "https://github.com@evil.com/x",
    "https://github.com:8443/x", "https://github.com:80/x", "https://github.com:/x", "https://github.com:443:443/x",
    # IP literals in every spelling (public ones too)
    "https://127.0.0.1/", "https://10.0.0.1/x", "https://192.168.1.1/", "https://172.16.0.1/", "https://100.64.0.1/",
    "https://169.254.169.254/latest/meta-data", "https://8.8.8.8/", "https://0.0.0.0/", "https://255.255.255.255/",
    "https://0x7f000001/", "https://2130706433/", "https://127.1/", "https://0177.0.0.1/", "https://127.0.0.0x1/",
    "https://1.2.3.4.5/", "https://[::1]/", "https://[2001:db8::1]/", "https://[::ffff:127.0.0.1]/",
    # internal-looking names
    "https://localhost/", "https://localhost./", "https://intranet/x", "https://wiki.corp/x", "https://printer.local/",
    "https://metadata.google.internal/", "https://foo.internal/", "https://router.lan/", "https://x.home.arpa/",
    "https://a.test/", "https://x.invalid/", "https://x.example/", "https://hidden.onion/", "https://x.localhost/",
    "https://1.0.0.127.in-addr.arpa/", "https://box.home/", "https://x.private/", "https://x.intranet/",
    # rebinding helpers
    "https://127.0.0.1.nip.io/", "https://foo.sslip.io/", "https://nip.io/", "https://lvh.me/", "https://app.localtest.me/",
    "https://a.traefik.me/", "https://foo.xip.io/",
    # malformed hosts
    "https://-bad.com/", "https://bad-.com/", "https://ba_d.com/", "https://bad..com/", "https://.com/", "https://x.c/",
    "https://x.123/", "https://x.1a/", "https://x.xn--/", "https://" + "a" * 64 + ".com/", "https://" + "a." * 130 + "com/",
    "https://git%68ub.com/x", "https://gith ub.com/",
    # path tricks that could escape a registered prefix
    "https://github.com/acme/../evil", "https://github.com/acme/./x", "https://github.com/a/%2e%2e/b",
    "https://github.com/a/%2E%2e/b", "https://github.com/a%2fb", "https://github.com/a%2Fb", "https://github.com/a%5cb",
    "https://github.com/acme/widget/..", "https://github.com/acme/widget/.", "https://github.com/..",
    # too long
    "https://github.com/" + "a" * 500,
]


@pytest.mark.parametrize("url,as_prefix,canonical", ACCEPT)
def test_accepted_urls_and_their_canonical_form(env, url, as_prefix, canonical):
    got = env.c.check_source_url(url, as_prefix)
    assert got == {"valid": True, "canonical": canonical}


@pytest.mark.parametrize("url", REJECT)
def test_rejected_urls(env, url):
    assert env.c.check_source_url(url, False) == {"valid": False, "canonical": ""}
    assert env.c.check_source_url(url, True) == {"valid": False, "canonical": ""}


@pytest.mark.parametrize("url", [
    "https://github.com/acme/widget?tab=1",
    "https://github.com/acme/widget#top",
    "https://github.com/acme/widget/?x",
])
def test_a_prefix_has_no_query_or_fragment(env, url):
    assert env.c.check_source_url(url, True)["valid"] is False
    assert env.c.check_source_url(url, False)["valid"] is True


def test_canonicalisation_is_idempotent(env):
    for url, as_prefix, canonical in ACCEPT:
        again = env.c.check_source_url(canonical, as_prefix)
        assert again == {"valid": True, "canonical": canonical}


@pytest.mark.parametrize("url", ["https://github.com", "https://github.com/", "https://github.com//", "https://GITHUB.com:443", "https://a.io///"])
def test_a_prefix_must_name_something_below_the_host(env, url):
    assert env.c.check_source_url(url, True) == {"valid": False, "canonical": ""}
    assert env.c.check_source_url(url, False)["valid"] is True      # as a plain page URL the bare host is fine


def test_url_length_boundary(env):
    ok = "https://github.com/" + "a" * (500 - len("https://github.com/"))
    assert len(ok) == 500 and env.c.check_source_url(ok, False)["valid"] is True
    assert env.c.check_source_url(ok + "a", False)["valid"] is False
