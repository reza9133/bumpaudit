title: Security & limitations
group: Reference
summary: What the design protects against, and what it honestly does not solve.

## What the design protects against

- **Prompt injection.** The model returns entry numbers, never text. Delimiters inside entries are neutralised, an explicit `BREAKING CHANGE` marker cannot be suppressed by any model, the prompt never reveals the declared bump, and entries that talk to the classifier are flagged (`injection_flagged`, informational).
- **A lying leader.** Fabricated or foreign sections, forged labels, invented markers and unreproducible failure claims are rejected by validators. The contract re-validates the agreed result before using it.
- **SSRF-style URLs.** Only `https` on port 443 to domain names. Every IP literal in any spelling, userinfo, internal-looking suffixes, rebinding helpers, dot-segments and encoded dots are refused. The check is applied to the pinned prefix too.
- **Quiet edits.** See [tamper evidence](#/docs/how-it-works).
- **Resource abuse.** Hard caps on every input, page size, entries and per-address and per-package counts.

## What it does not solve

- **Evidence authenticity.** The first audit of a release pins its URL. If the registered prefix includes user-writable pages (issues, comments), someone can audit a release against a page they wrote. Register the narrowest maintainer-only prefix, and always read `source_prefix`. A package name is a claim, not an identity.
- **Selection bias.** A score covers only the releases somebody chose to audit.
- **Judgement.** Whether a change is "breaking" is a judgement. The floor catches explicit markers only; a model can still be wrong or be steered by persuasive wording. That is why the evidence and the section are stored: humans can check.
- **Parser heuristics** and **string-level URL checks.** DNS rebinding to a private address cannot be detected from the text of a URL, so the node's renderer must enforce its own egress policy.
- **Validator agreement is not guaranteed on every real page.** Very dynamic pages may need retries. A failed round reverts without recording anything.

## Frontend security notes

- The site never asks for a private key or a seed phrase. Signing happens inside your wallet.
- Text that comes from the chain (names, URLs, release notes) is only ever inserted as plain text. Links built from chain data are limited to `https:`.
- The site makes requests to the public Studionet RPC only. It throttles itself to stay under that RPC's limit of about 30 requests a minute.
- Always compare the contract address in the footer with the one you expect.

> [!WARN] Studionet is a shared, hosted simulator, not a persistent testnet. State can be reset without notice, and test GEN has no value.
