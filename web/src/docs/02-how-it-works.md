title: How it works
group: Concepts
summary: The audit pipeline, consensus between validators, and tamper evidence.

## Three write methods

```
register_package(name, ecosystem, source_prefix)        pins WHERE release notes may come from
audit_release(package, version, previous_version, url)  one consensus round per release
reaudit_release(release)                                re-reads the pinned URL: edit / softening detection
```

## The pipeline: the AI proposes, plain code disposes

| Step | Who | What |
|---|---|---|
| 1 | contract | strict SemVer 2.0.0 parsing of both versions. The declared bump is arithmetic. |
| 2 | every validator | fetches the page, finds the heading of the audited version and cuts the section up to the next release heading |
| 3 | every validator | splits the section into numbered entries (list markers and heading hashes stripped) |
| 4 | one model call per validator | classifies each numbered entry as `breaking`, `feature` or `fix`. It answers with **entry numbers only**. |
| 5 | contract | applies an **explicit-marker floor**: an entry that literally says `BREAKING CHANGE`, `BREAKING:` or uses `feat!:` is breaking whatever any model says |
| 6 | contract | derives the severity (the highest class present) and the verdict from [the rules](#/docs/rules) |

Because the model can only return entry numbers, it can never write its own text, or text smuggled in by the page, into contract state. Evidence is always quoted from the page.

## Consensus

`audit_release` uses a custom leader and validator pair. A validator re-fetches the page itself and agrees only when:

1. the leader's section is a well-formed block for exactly this version and is (almost) the same set of entries the validator sees. Volatile page chrome such as "released 3 minutes ago" cannot split the vote;
2. every entry the leader cites as evidence exists **verbatim on the validator's own copy** of the page (a plain Python check);
3. the validator's own model run reaches the **same severity** and agrees on at least one entry of the deciding class.

A reported fetch, not-found or empty-section failure is accepted only when the validator reproduces it. A model failure is never rubber-stamped.

## Tamper evidence

- The audit stores the audited section (`get_audit_notes`) and its `keccak256`, so anyone can re-check a verdict offline. The release page has a **Verify hash in this browser** button, and the [Hash verifier](#/tools?tool=hash) tool does the same for pasted text.
- `reaudit_release` always re-reads the **same pinned URL**. It cannot be pointed at friendlier evidence.
- If nothing changed, only the "last checked" time moves: **no record is created and no audit slot is used**, so nobody can exhaust a release's audit history by spamming re-checks.
- If the section changed, a new audit is recorded and flagged `notes_changed`. If it also reads less severe than before it is flagged `softened`, and the release keeps that flag forever.

## Transaction stages you will see

| Stage | Meaning |
|---|---|
| Sign | You confirm the transaction in your wallet. |
| Queued | Waiting for a validator slot. |
| Proposing | The leader validator fetches the page and classifies entries. |
| Voting | Every other validator re-fetches the page itself and votes. |
| Revealing | Votes are revealed and compared. |
| Accepted | Consensus reached and the result is stored. |
| Finalized | The appeal window closed. The result is final. |

By default the site waits for **Finalized** before showing a result as confirmed. You can continue with the accepted result at any time, or change the default in [Settings](#/settings).
