// Sends a write transaction through the connected EIP-6963 wallet and follows it to the end.
import { CONFIG } from "../config.js";
import { loadSdk, invalidateAll } from "./chain.js";
import { explainError, isUserRejection, taggedMessage, taggedKind } from "./errors.js";
import { getProvider, onRightChain, switchNetwork, wallet, refreshBalance } from "./wallet.js";
import { prefs } from "./store.js";

export const STAGES = ["PENDING", "PROPOSING", "COMMITTING", "REVEALING", "ACCEPTED", "FINALIZED"];
const DECIDED = new Set(["ACCEPTED", "READY_TO_FINALIZE", "FINALIZED"]);
const DEAD = new Set(["UNDETERMINED", "CANCELED", "LEADER_TIMEOUT", "VALIDATORS_TIMEOUT"]);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const waitForFinality = () => prefs.get("waitFinal", "1") !== "0";

async function writer() {
  const { createClient, studionet } = await loadSdk();
  const { account } = wallet.get();
  return createClient({ chain: studionet, account, provider: getProvider() });
}

class TxError extends Error {
  constructor(message, extra = {}) {
    super(message);
    Object.assign(this, extra);
  }
}

/**
 * Runs one contract write.
 * onUpdate({ phase, status, hash, message }) is called as things progress.
 * Resolves when the transaction is ACCEPTED (validators agreed) with { hash, tx, finalized }.
 * `finalized` is a promise that resolves to true once the status is FINALIZED (or false if it gave up).
 */
export async function runWrite({ fn, args, onUpdate = () => {}, signal }) {
  const state = wallet.get();
  if (state.status !== "connected") throw new TxError("Connect a wallet first.", { kind: "user" });
  if (!onRightChain(state)) {
    onUpdate({ phase: "network", message: `Switching your wallet to ${CONFIG.chain.name}…` });
    await switchNetwork();
    if (!onRightChain()) throw new TxError(`Your wallet is not on ${CONFIG.chain.name}.`, { kind: "user" });
  }

  const client = await writer();
  onUpdate({ phase: "wallet", message: "Confirm the transaction in your wallet…" });

  let hash;
  try {
    hash = await client.writeContract({ address: CONFIG.contractAddress, functionName: fn, args, value: 0n });
  } catch (err) {
    const info = explainError(err);
    throw new TxError(info.message, { kind: info.kind, cause: err, rejected: isUserRejection(err) });
  }
  onUpdate({ phase: "submitted", hash, status: "PENDING", message: "Submitted. Validators pick it up in a moment." });

  const getTx = async () => client.getTransaction({ hash });

  // Phase 1: wait for validators to decide.
  let tx;
  let delay = 3500;
  const started = Date.now();
  for (;;) {
    if (signal?.aborted) throw new TxError("Stopped watching this transaction. It may still complete on-chain.", { kind: "other", hash });
    try {
      tx = await getTx();
    } catch (err) {
      tx = null;
      if (Date.now() - started > 120_000 && !String(err?.message).match(/not found/i)) throw new TxError(explainError(err).message, { kind: "network", hash });
    }
    const status = tx?.statusName || "PENDING";
    onUpdate({ phase: "consensus", hash, status });
    if (DEAD.has(status)) {
      throw new TxError(
        status === "CANCELED"
          ? "The transaction was cancelled."
          : "The validators could not reach consensus on this request (for example, a page they could not all read the same way). Nothing was recorded. Try again.",
        { kind: "external", hash, status },
      );
    }
    if (DECIDED.has(status)) break;
    if (Date.now() - started > 15 * 60_000) throw new TxError("Timed out waiting for validators. The transaction may still complete; check the explorer.", { kind: "network", hash });
    await sleep(delay);
    delay = Math.min(delay + 500, 6000);
  }

  if (tx?.txExecutionResultName === "FINISHED_WITH_ERROR") {
    const message = taggedMessage(tx) || "The contract reverted this call. See the explorer for details.";
    throw new TxError(message, { kind: taggedKind(tx) === "EXTERNAL" ? "external" : "contract", hash });
  }

  invalidateAll();
  refreshBalance();
  onUpdate({ phase: "accepted", hash, status: tx?.statusName === "FINALIZED" ? "FINALIZED" : "ACCEPTED" });

  // Phase 2: finality. Runs in the background; the UI decides whether to wait for it.
  const finalized = (async () => {
    if (tx?.statusName === "FINALIZED") return true;
    const until = Date.now() + 45 * 60_000;
    let wait = 6000;
    while (Date.now() < until && !signal?.aborted) {
      await sleep(wait);
      wait = Math.min(wait + 2000, 20_000);
      try {
        const next = await getTx();
        if (next?.statusName === "FINALIZED") {
          invalidateAll();
          onUpdate({ phase: "finalized", hash, status: "FINALIZED" });
          return true;
        }
        if (next && DEAD.has(next.statusName)) return false;
      } catch {
        /* keep trying */
      }
    }
    return false;
  })();

  return { hash, tx, finalized };
}
