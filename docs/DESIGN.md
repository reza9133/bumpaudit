# BumpAudit: design notes

## 1. Goal

Make the sentence "this release is a PATCH" checkable against the release's own notes, with a record that
cannot be rewritten quietly. Non-goals: judging code, fetching package registries, scoring maintainers beyond what the
audited notes say, handling funds.

## 2. Data model

```
Package   id, registrant, name, ecosystem, source_prefix, counters (compliant / under / over / exempt / edited / softened)
Release   id, package, version, previous_version, declared_bump, notes_url (pinned), current verdict + severity,
          audit_count, edit_count, verdict_changes, softened (sticky), check_count, first/latest block hash, last_checked_at
Audit     id, release, requester, block_hash, entry counts, severity, required/declared bump, verdict,
          evidence [{i, t}], notes_changed, softened, injection_flagged         (+ the stored section text)
```

Counters (global, per package, per release) are kept incrementally and verified by a seeded random test that recomputes
every one of them from the audit history after every operation. A reverted call never changes anything: the test suite
asserts the whole observable state is identical before and after each expected revert.

## 3. The deterministic core

All of this is identical on every node and uses no regular expressions, floats or third-party modules.

* **SemVer** is parsed by hand against the 2.0.0 grammar (leading `v` tolerated, build metadata dropped). A differential
  test compares the parser with the official regular expression on 4000 seeded random strings.
* **Heading recognition.** A line is the heading of version `V` when, after stripping markup (`#`, `=`, `*`, `_`, `[`, `(`,
  `<`, backticks) and an optional lead phrase (`Version`, `Release notes for`, `What's new in` ...), it starts with a valid
  SemVer token equal to `V` (build metadata ignored). Lines longer than 120 characters are never headings. Bullets are not
  headings because a list marker blocks the version parse.
* **Section.** From the first heading of `V` that has at least one entry, up to the next heading of a different version, at
  most 400 lines / 6000 characters, control characters removed. Duplicate labels of `V` (a page title and a tag line) are
  not entries.
* **Entries.** Each line, list marker and heading hashes stripped, at least 4 characters, at most 300 (truncated), at most 60 per section.
  A line that is only a version label plus a date is not an entry; one with a real title (>= 20 letters) is.
* **Floor.** An entry is explicitly breaking when it contains `BREAKING CHANGE`, `BREAKING:`, `BREAKING-CHANGE`, `[BREAKING]` or
  `(BREAKING)` (case-sensitive, so ordinary prose does not trigger it), or has the Conventional Commits form `type!:` /
  `type(scope)!:` with a known type. Negations (`no breaking`, `non-breaking` ...) and "none" endings cancel it.
* **Verdict** from (declared bump, severity, initial development, pre-release): see the README table.

## 4. Consensus protocol for `audit_release`

The leader result is `{ok, block, breaking[], feature[], fix[]}` (indexes into the entries derived from `block`) or
`{ok: false, reason}` with `reason` in `fetch | not_found | empty | model`.

A validator computes `mine` (its own fetch and extraction) and accepts a success result only if **all** hold:

| # | Check | Why |
|---|---|---|
| 1 | result is a `Return` carrying a dict, and `ok` is exactly `True` | no malformed or ambiguous claims |
| 2 | my page is readable and contains the section | a leader cannot invent a page |
| 3 | `block` is a well-formed section of this very version: <= 6000 chars and <= 400 lines, first line is the heading, no later heading of another release, has entries | a leader cannot smuggle another release's text |
| 4 | label lists are disjoint, in-range, non-negative, non-boolean integers | no negative-index tricks, no duplicate classes |
| 5 | the leader's entries and mine are near-identical (differing entries <= max(1, 20% of the union)) | volatile page chrome must not split the vote; invention must |
| 6 | the explicit-marker floor is applied to the leader's labels | a lenient leader gains nothing |
| 7 | every cited evidence entry (the first 3 of the deciding class) exists **verbatim in my entries** | quotes are grounded in my own copy of the page |
| 8 | my own model run over my own entries gives the same severity | the judgement is reproduced independently |
| 9 | at least one entry of the deciding class is shared | the stored evidence is endorsed |

A failure result is accepted only if the validator reproduces the same deterministic failure. A `model` failure can never be
reproduced, so it is never accepted: the round fails and the network retries with another leader.

After consensus the contract **re-validates** the agreed result (steps 3, 4 and the floor again), derives everything else
itself and reverts on anything malformed. These defences are tested by replacing `gl.vm.run_nondet_unsafe` with a forger.

## 5. Re-checks

`reaudit_release` runs the same consensus on the same URL. If the section hash **and** the severity are unchanged, it only
sets `last_checked_at` and increments `check_count`; no audit is stored. Otherwise a new audit is recorded with
`notes_changed` (hash differs) and `softened` (hash differs **and** severity decreased). A different model opinion on
identical text is recorded as an audit but is not "softening", because the maintainers did nothing.

Why not store every re-check? The first design capped re-audits per release. That let anyone burn all slots right after the
first audit and then edit the notes unnoticed. Recording only changes removes the attack: slots are consumed only by real
changes (and the cap of 30 leaves an unmistakable trace if a maintainer flips the notes that often).

## 6. Threat model

| Threat | Mitigation | Residual risk |
|---|---|---|
| Page text addresses the classifier | numbers-only model output; neutralised delimiters; floor; hidden declared bump; informational flag | a persuasive entry can still bias a judgement; evidence is stored for humans |
| Leader fabricates evidence | verbatim grounding on each validator, similarity, severity reproduction | collusion of a validator majority is out of scope (it is GenLayer's own assumption) |
| SSRF via `notes_url` / prefix | domain names only, https:443, no IPs/userinfo/internal suffixes/dot-segments, checked on both prefix and URL | DNS rebinding needs egress policy in the renderer |
| Evidence hijack under a broad prefix | prefix must have a path; URL pinned at first audit; README advice to use maintainer-only prefixes | first auditor chooses the page; consumers must read `source_prefix` |
| Name squatting / look-alikes | prefix is part of the identity; duplicates are separate entries | users must pick the right entry |
| Edit after the fact | stored section + hash; edit / soften flags; recheck cannot change URL | the page may be edited before the first audit |
| Slot exhaustion | rechecks consume nothing; caps apply to real changes | a maintainer flipping notes 30 times is visible, not prevented |
| Spam / storage growth | caps per address, package and release; sections capped at 6000 chars | Sybil addresses (cost is the attacker's fee on a real network) |
| Non-determinism between nodes | no floats, regexes, dict/set iteration order dependence, or storage access inside non-deterministic blocks | untested against the real VM, see below |

## 7. Rejected alternatives

* **Hash equality of the whole page** between leader and validators: breaks on any dynamic element. Section-level, entry-set
  similarity is robust and keeps the "same evidence" guarantee where it matters.
* **Model-written evidence or summaries**: free text in state is the injection channel. Index-only answers close it.
* **Storing the whole page**: expensive and unnecessary; the audited section (<= 6000 chars) plus its hash is the evidence.
* **Letting a re-audit supply a new URL**: it would let the party who wants a different verdict choose the page.
* **A lenient (case-insensitive) breaking floor**: "no breaking changes" and "Breaking Changes" headings would flip verdicts.
* **One model call by the leader only**: then validators would only check form. Each validator reproduces the judgement.

## 8. What was verified, and how

| Claim | Evidence |
|---|---|
| Logic of every function, verdict matrix, counters, quotas | ~690 direct-mode tests, a seeded random-history test, fuzzing with hostile input, static checks |
| A revert never leaves partial state, even if the VM did not roll back | every check runs before the first write; the whole suite also passes with the emulator's rollback switched off (`BA_SIM_NO_ROLLBACK=1`) |
| No unexpected exception on any input | fuzz tests: random pages, model answers, versions, URLs and forged leader results only ever produce a tagged revert or a bool |
| Tests really detect bugs | mutation testing: ~220 injected bugs, all killed except 4 documented equivalent mutants |
| Contract uses only SDK constructs known to work on Studionet | the same API surface as the live-verified PromiseLedger, plus AST checks (`tests/contract/test_hygiene.py`) |
| Runs under the real GenVM / real validators | **not verified by the author**; run `npm run demo` |

During development the tests ran on a strict offline emulator (`tools/offline_sim`) because `genlayer-test` could not be
installed there. It is stricter than GenVM in several places but it is not GenVM: run `pytest` with `genlayer-test` and a live
deployment before relying on the contract.

## 9. Ideas for later

A small web UI (paste a changelog URL, see the audit); ecosystem-aware evidence providers (registry metadata for the
declared versions); weighting the score by release size; a `challenge` call by the package registrant to dispute a verdict.
