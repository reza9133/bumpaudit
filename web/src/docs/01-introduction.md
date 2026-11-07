title: Introduction
group: Start here
summary: What BumpAudit is, what it records, and the fastest way to try it.

## What is BumpAudit?

[Semantic Versioning](https://semver.org) makes a promise: a PATCH release only fixes bugs, a MINOR release only adds backwards-compatible features, and anything that can break existing users needs a MAJOR bump. Nothing enforces it.

BumpAudit does. It is a **GenLayer Intelligent Contract** that reads a release's notes, lets the validator network decide which entries are breaking changes, features or fixes, and compares that with the bump the maintainers actually shipped.

```
registered:  acme-widget (npm)   notes live under  https://github.com/acme/widget/releases/

audit 1.4.2 -> 1.4.3   declared PATCH
  entry: "Removed the deprecated --legacy flag. Scripts that still pass it now fail."   <- breaking
  verdict: UNDER_BUMPED   (an honest bump needed MAJOR)
```

Every verdict stores the exact text of the release section it was based on, the entries that decided it, and a Keccak-256 hash of that text. A later re-check detects notes that were **edited** after the fact, and notes that were **softened** (a breaking line quietly deleted).

## Try it in two minutes

1. Open the [Tools](#/tools) page and press **Load the demo changelog** in the parser preview. No wallet needed.
2. Connect a wallet from the header. The site asks it to switch to **GenLayer Studionet** and adds the network if needed.
3. Press **Get test GEN** in the wallet menu. Studionet has no external faucet; the node mints balance for you.
4. Go to [Audit](#/audit), register a package, then audit one of its releases.

> [!TIP] Reading never needs a wallet. The Explorer, release pages, evidence and the Tools page all work without connecting.

## What this website is

This site is a read and write frontend for one deployed contract. It never holds keys, never sends anything you did not confirm in your wallet, and talks to the chain through the official `genlayer-js` SDK. The connected contract address is shown in the footer and on the [Settings](#/settings) page.

::network
