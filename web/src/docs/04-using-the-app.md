title: Using the app
group: Guides
summary: Wallet, network, test funds, registering, auditing, re-checking and reading results.

## Connect a wallet (EIP-6963)

Press **Connect wallet**. The site discovers every installed wallet through **EIP-6963**, so each one appears as its own entry with its own icon, and no wallet can hijack another. Browsers or wallets that only inject `window.ethereum` are supported through a fallback entry.

- **Connect** opens your wallet's own approval popup.
- **Disconnect** (wallet menu) really disconnects: the site drops its session, asks the wallet to revoke this site's account permission where the wallet supports it, and does not reconnect on the next visit.
- If you did not disconnect, the site silently reconnects on your next visit without a popup.
- Switching accounts or networks inside the wallet is picked up live.

## Switch to GenLayer Studionet

When your wallet is on another chain, a banner appears under the header and write buttons offer **Switch network**. The site calls `wallet_switchEthereumChain` and, if the wallet does not know the network, `wallet_addEthereumChain` with these values:

::network

## Get test GEN

Studionet has no external faucet. Open the wallet menu and press **Get test GEN**; the node mints balance for your address (the same thing the 💧 button in Studio does).

## Register a package

On [Audit → Register package](#/audit):

1. **Name**: 1 to 80 characters from `A-Z a-z 0-9 . _ - @ / +`, starting with a letter, digit or `@`.
2. **Ecosystem**: npm, pypi, cargo and so on.
3. **Source prefix**: a public `https://` URL **with a path**. Pick the narrowest prefix only maintainers can write to. The field is checked against the contract's URL policy when you leave it.

## Audit a release

1. Enter the **package id** (shown on its page). The site loads its name and prefix.
2. Enter the **previous stable version** and the **audited version**. The declared bump is shown live.
3. Paste the **release notes URL**, below the package's prefix.
4. Press **Request audit** and confirm in your wallet. The live tracker follows the transaction through every consensus stage. A round usually takes one to three minutes.

> [!TIP] Run the [Parser preview](#/tools) first. If you can see your entries there, validators will see them too.

## Re-check a release

Open the release page and press **Re-read the pinned URL**. It is allowed once every 5 minutes per release. The result tells you whether anything changed: unchanged notes only move the "last checked" time.

## Read a result

A release page shows the verdict, the declared and honest bump, the entries that decided it (quoted verbatim), the stored section and its hash, flags for **edited** and **softened** notes, and the full audit history. Use **Show audited text & verify hash** to recompute the Keccak-256 hash in your browser.

## Themes and motion

Pick **Light**, **Dim** or **Dark** from the switch in the header, or on [Settings](#/settings). The choice is remembered. Turn on **Reduce motion** there to freeze the 3D scenes and animations. The system's reduced-motion setting is respected too.
