title: FAQ & troubleshooting
group: Guides
summary: Common problems and what they mean.

## My wallet is not listed

The site lists wallets that announce themselves through EIP-6963. Make sure the extension is enabled for this site, then press **Rescan** in the connect dialog. A wallet that only injects `window.ethereum` appears as "Browser wallet".

## I see "Wrong network"

Press **Switch to GenLayer Studionet** in the banner. If your wallet refuses, add the network manually with the values on the [Using the app](#/docs/using-the-app) page.

## The transaction is waiting for a long time

A consensus round needs several validators to fetch a page and run a model. One to three minutes is normal; Studionet can be slower when busy. You can leave the page: the transaction continues on-chain and the explorer link shows its status.

## "Accepted" but not "Finalized"

Accepted means validators agreed and the state is updated. Finalized means the appeal window has closed. The site waits for finality by default; press **Continue with the accepted result** to see the data sooner, or turn the wait off in Settings.

## It says the RPC is rate limited

The public Studionet RPC allows about 30 requests a minute. The site queues its own requests below that, so you may see a short "Pausing to respect the public RPC limit" notice. Wait a moment; nothing is lost.

## My audit reverted

Read the message: `[EXPECTED]` means the input was rejected (nothing recorded); `[EXTERNAL]` means the page could not be read or parsed. Use the [Parser preview](#/tools) and see [Release pages](#/docs/release-pages).

## The explorer shows nothing

Studionet is a hosted simulator that can be reset. If the contract at the footer address no longer exists, deploy it again and point the site at the new address.

## Is my score a full picture of a package?

No. It only covers audited releases. Read the evidence, not just the ring.
