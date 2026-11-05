// Shared helpers for the live Studionet scripts (deploy + demo).
import "./throttle.mjs"; // must stay first: wraps fetch before genlayer-js / viem load
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createAccount, createClient, generatePrivateKey } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";
import { findAddress, normalize, receiptFailed, taggedMessage } from "./util.mjs";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const CONTRACT_PATH = resolve(ROOT, "contracts", "bump_audit.py");
export const EXPLORER = "https://explorer-studio.genlayer.com";
export { createAccount, generatePrivateKey, normalize, TransactionStatus };

export function makeClient(account) {
  return createClient({ chain: studionet, account });
}

/** Studionet has no external faucet: the node can mint balance for any address. */
export async function fund(client, address, amount = 10 ** 20) {
  try {
    await client.request({ method: "sim_fundAccount", params: [address, amount] });
    return true;
  } catch (err) {
    return String(err?.message ?? err);
  }
}

export async function deployContract(client, log = console.log) {
  const code = readFileSync(CONTRACT_PATH, "utf8");
  log("deploying contracts/bump_audit.py to Studionet ...");
  const hash = await client.deployContract({ code, args: [], leaderOnly: false });
  log(`deploy tx ${hash}`);
  const receipt = await client.waitForTransactionReceipt({ hash, status: TransactionStatus.ACCEPTED, interval: 3000, retries: 120 });
  if (receiptFailed(receipt)) throw new Error("deployment failed: " + (taggedMessage(receipt) ?? "see the explorer"));
  const address = findAddress(receipt?.data) ?? findAddress(receipt?.txDataDecoded) ?? findAddress(receipt);
  if (!address) throw new Error(`deployed (tx ${hash}) but the address could not be read from the receipt; copy it from ${EXPLORER}/tx/${hash}`);
  return { address, hash };
}

export async function view(client, address, functionName, args = []) {
  return normalize(await client.readContract({ address, functionName, args }));
}

/** Sends a write transaction and waits until validators accepted it. Throws the contract's own error text on a revert. */
export async function send(client, address, functionName, args, log = console.log) {
  let hash;
  try {
    hash = await client.writeContract({ address, functionName, args, value: 0n });
  } catch (err) {
    throw new Error(taggedMessage(err) ?? String(err?.shortMessage ?? err?.message ?? err));
  }
  log(`  tx ${hash}  (validators are reading the page and classifying; this can take a minute or two)`);
  const receipt = await client.waitForTransactionReceipt({ hash, status: TransactionStatus.ACCEPTED, interval: 5000, retries: 200 });
  if (receiptFailed(receipt)) throw new Error(taggedMessage(receipt) ?? "the contract reverted (see the explorer for the reason)");
  return { hash, receipt };
}
