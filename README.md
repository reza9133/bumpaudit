# BumpAudit

**An on-chain audit of whether version numbers tell the truth.**

[Semantic Versioning](https://semver.org) makes a promise: a PATCH release only fixes bugs, a MINOR release only adds
backwards-compatible features, and anything that can break existing users needs a MAJOR bump. Nothing enforces it.
BumpAudit does: it is a GenLayer Intelligent Contract that reads a release's notes, lets the validator network decide
which entries are breaking changes, features or fixes, and compares that with the bump the maintainers actually shipped.

```
registered:  acme-widget  (npm)   notes live under  https://github.com/acme/widget/releases/

audit 1.4.2 -> 1.4.3          declared PATCH
  entry: "Removed the deprecated --legacy flag. Scripts that still pass it now fail."   <- breaking
  verdict: UNDER_BUMPED   (an honest bump needed MAJOR)

audit 1.4.3 -> 1.5.0          declared MINOR     entry: "Added streaming uploads ..."  -> COMPLIANT
audit 1.5.0 -> 2.0.0          declared MAJOR     entry: "Removed the legacy connect() API ..." -> COMPLIANT
```

Every verdict stores the exact text of the release section it was based on, the entries that decided it, and a
Keccak-256 hash of that text. A later re-check detects notes that were **edited** after the fact, and notes that were
**softened** (a breaking line quietly deleted).

- Contract: [`contracts/bump_audit.py`](contracts/bump_audit.py), one self-contained file for GenLayer Studionet
- Design notes: [`docs/DESIGN.md`](docs/DESIGN.md)

## Contents

1. [How it works](#how-it-works)
2. [The rules](#the-rules)
3. [Contract API](#contract-api)
4. [What the parser expects from a release page](#what-the-parser-expects-from-a-release-page)
5. [Deploy to Studionet](#deploy-to-studionet)
6. [Testing](#testing)
7. [Security model and honest limitations](#security-model-and-honest-limitations)
8. [Limits](#limits)
9. [Project layout](#project-layout)

## How it works

```
register_package(name, ecosystem, source_prefix)        pins WHERE release notes may come from
audit_release(package, version, previous_version, url)  one consensus round per release
reaudit_release(release)                                re-reads the pinned URL: edit / softening detection
```

An audit is a pipeline in which **the AI proposes and plain code disposes**:

| Step | Who | What |
|---|---|---|
| 1 | contract | strict SemVer 2.0.0 parsing of both versions; the declared bump is arithmetic |
| 2 | every validator | fetches the page; finds the heading of the audited version (`## [2.0.0] - date`, `v2.0.0`, `Version 2.0.0` ...) and cuts the section up to the next release heading |
| 3 | every validator | splits the section into numbered entries (list markers and heading hashes stripped) |
| 4 | one model call per validator | classifies each numbered entry as `breaking`, `feature` or `fix`; it answers with **entry numbers only** |
| 5 | contract | applies an **explicit-marker floor**: an entry that literally says `BREAKING CHANGE`, `BREAKING:` or uses the Conventional Commits form `feat!:` is breaking whatever any model says |
| 6 | contract | derives the severity (the highest class present) and the verdict from the rules below |

Because the model can only return entry numbers, it can never write its own text, or text smuggled in by the page, into
contract state. Evidence is always quoted from the page.

### Consensus

`audit_release` uses a custom leader / validator pair. A validator re-fetches the page itself and agrees only when:

1. the leader's section is a well-formed block for exactly this version and is (almost) the same set of entries the
   validator sees. Volatile page chrome such as "released 3 minutes ago" cannot split the vote;
2. every entry the leader cites as evidence exists **verbatim on the validator's own copy** of the page (plain Python check);
3. the validator's own model run reaches the **same severity** and agrees on at least one entry of the deciding class.

A reported fetch / not-found / empty-section failure is accepted only when the validator reproduces it. A model failure
is never rubber-stamped. See [`docs/DESIGN.md`](docs/DESIGN.md) for the full protocol and the threat model.

### Tamper evidence

* The audit stores the audited section (`get_audit_notes`) and its `keccak256`, so anyone can re-check a verdict offline.
* `reaudit_release` always re-reads the **same pinned URL**; it cannot be pointed at friendlier evidence.
* If nothing changed, only the "last checked" time moves: **no record is created and no audit slot is used**, so nobody
  can exhaust a release's audit history by spamming re-checks.
* If the section changed, a new audit is recorded and flagged `notes_changed`; if it also reads less severe than before it is
  flagged `softened`, and the release keeps that flag forever.

## The rules

| Previous version | Release contains | Honest bump | Verdict if you shipped less | If you shipped more |
|---|---|---|---|---|
| `>= 1.0.0` | a breaking change | MAJOR | `UNDER_BUMPED` | `COMPLIANT` (exact) |
| `>= 1.0.0` | a new feature | MINOR | `UNDER_BUMPED` | `OVER_BUMPED` |
| `>= 1.0.0` | only fixes | PATCH | n/a | `OVER_BUMPED` |
| `0.y.z` (initial development) | a breaking change | MINOR | `UNDER_BUMPED` | `COMPLIANT` |
| `0.y.z` | a feature or a fix | PATCH | n/a | `COMPLIANT` (never "over") |

* The 0.y.z row follows the convention of npm and Cargo (the MINOR number is the breaking boundary); strict SemVer says
  "anything may change" there.
* **Pre-releases** (`2.0.0-rc.1`) are `EXEMPT`: SemVer allows them to be unstable. They are audited and stored but not scored.
* `previous_version` must be a stable release lower than `version`. Build metadata (`+build.5`) and a leading `v` are ignored.
* **Integrity score** = `(COMPLIANT + OVER_BUMPED) * 1000 / (COMPLIANT + OVER_BUMPED + UNDER_BUMPED)`.
  `OVER_BUMPED` is harmless (a maintainer may always be more cautious), `EXEMPT` is neutral.

## Contract API

All ids are `u256`. Views return plain JSON-friendly dicts. Pages are `{ "total", "offset", "items": [...] }` and are
capped at 50 items.

### Write methods

| Method | Description |
|---|---|
| `register_package(name, ecosystem, source_prefix) -> package_id` | Registers a package. `source_prefix` is a public `https://` URL **with a path** (for example `https://github.com/acme/widget/releases/`); every audit must cite a page below it. Several packages may share a name with different prefixes: a look-alike is a separate, clearly labelled entry, never a way to overwrite someone else's record. |
| `audit_release(package_id, version, previous_version, notes_url) -> audit_id` | Audits one release. Reverts with a tagged message if the page cannot be read, has no section for the version, or nothing in it can be classified. The URL is pinned to this release. |
| `reaudit_release(release_id) -> audit_id` | Re-reads the pinned URL (at most once every 5 minutes per release). Returns the audit that currently describes the notes: a new one if something changed, the existing one if not. |

### Read methods

| Method | Description |
|---|---|
| `get_version`, `get_limits`, `get_stats` | Metadata, every limit, and global counters (`packages`, `releases`, `audits`, verdict counts, `edited_releases`, `softened_releases`, `rechecks`, `integrity_permille`). |
| `get_package(id)`, `list_packages(offset, limit)`, `find_packages(ecosystem, name, offset, limit)`, `list_registrant_packages(address)` | Package records with their counters and integrity score. |
| `get_release(id)`, `find_release(package_id, version)`, `list_package_releases(package_id, offset, limit)` | Release records: current verdict and severity, `edit_count`, `softened`, `check_count`, hashes of the first and latest section. |
| `get_audit(id)`, `list_release_audits(release_id, offset, limit)` | Audits: severity, declared and honest bump, verdict, counts, **evidence** (`[{i, t}]`), `notes_changed`, `softened`, `injection_flagged`. |
| `get_audit_notes(audit_id)` | The exact release section that was audited, its entries, and its hash. |
| `describe_version(version)` | Parses a version string. |
| `preview_verdict(previous, version, severity)` | What the rules would conclude, without auditing anything. |
| `check_source_url(url, as_prefix)` | Whether a URL is acceptable, and its canonical form. |
| `preview_extraction(page_text, version)` | **Dry run of the parser** on pasted page text: shows the section and the numbered entries validators would see. Free and instant: use it when an audit reverts with "no heading". |

Error messages are tagged: `[EXPECTED]` is a mistake by the caller, `[EXTERNAL]` is about the page or the network.

## What the parser expects from a release page

The audited version must appear as a **heading-like line**. All of these work for `2.0.0`:

```
## [2.0.0] - 2026-03-01      v2.0.0            Version 2.0.0          2.0.0 / 2026-03-01
### 2.0.0 (2026-03-01)       **2.0.0**         Release notes for 2.0.0   What's new in v2.0.0
```

Good evidence pages: a GitHub release page (`.../releases/tag/v2.0.0`), a `CHANGELOG.md` (raw or rendered), a docs-site
changelog. Rules of thumb:

* The section runs from the heading to the next heading of **a different version**. A line that merely *begins* with a
  version number (`3.2.1 and earlier are affected ...`) is read as the next heading. That is a deliberate trade-off:
  titled headings (`## 2.0.0 - Big rewrite`) must end the previous section.
* Prose that merely mentions a version (`Fixed a regression from 2.0.0`) and bullets (`- 2.0.0 shipped`) are not headings.
* At most 60 entries (300 characters each) and 6000 characters of a section are audited. `get_audit_notes` shows exactly
  what was read, so truncation is never hidden.
* A page that renders as a single long line cannot be parsed.
* Paste the page text into `preview_extraction` before auditing. If you see your entries there, validators will see them.

**Pick the narrowest prefix only maintainers can write to**, such as `https://github.com/acme/widget/releases/` or the raw
`CHANGELOG.md` path, not the whole repository: issue and pull-request pages under a repository are user-writable.

## Deploy to Studionet

**With the Studio UI.** Open [studio.genlayer.com](https://studio.genlayer.com), create a new contract file, paste
[`contracts/bump_audit.py`](contracts/bump_audit.py), select Studionet and deploy (the constructor takes no arguments).
Studionet has no external faucet: fund the wallet you connect from with the 💧 button in the account selector. Then use the
Studio's read / write panel to call the methods above.

**With the scripts** (Node 20+):

```bash
npm install
npm run deploy                                   # prints the contract address and explorer links
export BA_CONTRACT_ADDRESS=0x...
# push examples/fixtures/ to a repository of yours so the page is publicly reachable, then:
npm run demo -- --base https://raw.githubusercontent.com/<you>/<repo>/main/examples/fixtures
npm run demo -- --preview-only                   # free dry run of the parser on the local fixture
```

The demo registers a package, audits three releases of the fixture changelog (a PATCH that hides a removed flag, a MINOR with a
feature, a MAJOR that removes an API) and prints verdicts and evidence. Copy `.env.example` to `.env` to set a key or an address.
The public Studionet RPC allows about 30 requests per minute; `scripts/throttle.mjs` keeps the scripts under it.

> Studionet is a shared, hosted simulator, not a persistent testnet. State can be reset without notice.

## Testing

```bash
pip install -r requirements-dev.txt     # genlayer-test (direct mode: no node, no network)
pytest -q                               # the whole contract suite
npm run test:js                         # unit tests of the script helpers
npm run mutation                        # mutation testing (see below)
```

The suite (about 690 tests) covers: SemVer parsing (differentially against the official regular expression), the URL
policy, the parser, every verdict, the explicit-marker floor, prompt hygiene, the consensus protocol (honest validators and
every way a leader can lie), post-consensus re-validation, re-checks, edit and softening detection, quotas, views, a
**seeded random-history test** that recomputes every counter from the audit history after every operation, **fuzzing** with hostile
pages, model answers, versions, URLs and forged leader results, static checks
that the contract uses only constructs known to work inside GenVM, and the shipped demo scenario.

**Mutation testing** (`scripts/mutation_check.py`) injects about 220 realistic bugs into a copy of the contract and
requires the suite to fail for each. Four mutants cannot be killed because they do not change behaviour; each is
documented with its reason in the script.

The tests only use the direct-mode API that `genlayer-test` provides (`direct_vm`, `direct_deploy`, `mock_web`,
`mock_llm`, `run_validator`, ...). A few tests use emulator-only introspection (`vm.events`, `vm.llm_prompts`) and skip
themselves when the harness does not expose it.

### Offline emulator

`tools/offline_sim` and `tools/offline_pytest` are a strict, offline stand-in for the SDK and for pytest, used to develop the
contract where `genlayer-test` could not be downloaded:

```bash
python tools/offline_pytest/run.py -q -p offline_sim.plugin tests/contract      # or: npm run test:offline
```

It is deliberately **stricter** than GenVM (a revert rolls every write back; storage is unreadable inside non-deterministic
blocks; views cannot write; raw `int` into a `u256` slot, floats, sets and iteration over storage containers are rejected)
but it is **not** the real GenVM. Treat `pytest` with `genlayer-test` as the authority, and a live run as the final gate.

## Security model and honest limitations

What the design protects against:

* **Prompt injection.** The model returns entry numbers, never text. Delimiters inside entries are neutralised, an
  explicit `BREAKING CHANGE` marker cannot be suppressed by any model, the prompt never reveals the declared bump, and
  entries that talk to the classifier are flagged (`injection_flagged`, informational).
* **A lying leader.** Fabricated or foreign sections, forged labels, invented markers and unreproducible failure claims are
  rejected by validators; the contract re-validates the agreed result before using it.
* **SSRF-style URLs.** Only `https` on port 443 to domain names. Every IP literal in any spelling, userinfo, internal-looking
  suffixes, rebinding helpers, dot-segments and encoded dots are refused, and the check is applied to the pinned prefix too.
* **Quiet edits.** See [Tamper evidence](#tamper-evidence).
* **Resource abuse.** Hard caps on every input, page size, entries and per-address / per-package counts.

What it does **not** solve:

* **Evidence authenticity.** The first audit of a release pins its URL. If the registered prefix includes user-writable
  pages (issues, comments), someone can audit a release against a page they wrote. Register the narrowest maintainer-only
  prefix; consumers should always read `source_prefix`. A package name is a claim, not an identity: look-alikes are separate entries.
* **Selection bias.** A score covers only the releases somebody chose to audit. The ledger is permissionless so anyone can
  audit a release, but nothing guarantees completeness.
* **Judgement.** Whether a change is "breaking" is a judgement. The floor catches explicit markers only; a model can still be
  wrong or be steered by persuasive wording (that is why the evidence and the section are stored, so humans can check).
* **Parser heuristics** (see above) and **string-level URL checks**: DNS rebinding to a private address cannot be detected
  from the text of a URL, so the node's renderer must enforce its own egress policy.
* **Validator agreement is not guaranteed on every real page.** Tolerance for volatile chrome is built in, but very
  dynamic pages may need retries. This is why a failed round reverts without recording anything.
* **Not yet run against live validators by the author** of this repository. Run `npm run demo` before relying on it.

## Limits

| Limit | Value |
|---|---|
| max name chars | 80 |
| max url chars | 500 |
| max entries per section | 60 |
| max entry chars | 300 |
| max section chars | 6000 |
| max evidence entries | 3 |
| max page size | 50 |
| max packages per registrant | 20 |
| max releases per package | 60 |
| max audits per address | 60 |
| max audits per release | 30 |
| min re-audit interval seconds | 300 |

`get_limits()` returns the live values.

## Project layout

```
contracts/bump_audit.py        the Intelligent Contract (single file)
tests/contract/                direct-mode tests, fixtures and shared helpers
examples/fixtures/             demo changelog used by `npm run demo` and by a test
scripts/deploy.mjs, demo.mjs   live Studionet scripts (+ lib.mjs, throttle.mjs, util.mjs and its tests)
scripts/mutation_check.py      mutation testing
tools/offline_sim, offline_pytest   strict offline stand-ins for the SDK and pytest
docs/DESIGN.md                 protocol, threat model, rejected alternatives
```
