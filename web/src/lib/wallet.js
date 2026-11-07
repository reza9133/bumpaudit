// EIP-6963 wallet discovery, connection, real disconnect and network switching.
import { CONFIG, explorerAddress } from "../config.js";
import { createStore, prefs } from "./store.js";
import { explainError, isUserRejection } from "./errors.js";
import { formatUnits } from "./format.js";
import { rpc } from "./chain.js";
import { toast } from "../components/toast.js";

export const wallet = createStore({
  status: "disconnected", // disconnected | connecting | connected
  providers: [], // [{ uuid, name, icon, rdns }]
  active: null, // { uuid, name, icon, rdns }
  account: null,
  chainId: null,
  balance: null,
  switching: false,
});

const found = new Map(); // uuid -> { info, provider }
let current = null; // the EIP-1193 provider in use
let detach = null;

export const onRightChain = (s = wallet.get()) => s.status === "connected" && s.chainId === CONFIG.chain.id;
export const getProvider = () => current;

function announce(event) {
  const detail = event?.detail;
  if (!detail?.info?.uuid || !detail?.provider || typeof detail.provider.request !== "function") return;
  found.set(detail.info.uuid, detail);
  publishProviders();
}

function publishProviders() {
  wallet.set({
    providers: [...found.values()].map(({ info }) => ({ uuid: info.uuid, name: info.name, icon: info.icon, rdns: info.rdns || "" })),
  });
}

/** Listens for EIP-6963 announcements and asks wallets to announce themselves. */
export function startDiscovery() {
  window.addEventListener("eip6963:announceProvider", announce);
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  // Legacy fallback: a wallet that only injects window.ethereum and never announces itself.
  setTimeout(() => {
    if (!found.size && window.ethereum && typeof window.ethereum.request === "function") {
      found.set("legacy-injected", {
        info: { uuid: "legacy-injected", name: "Browser wallet", icon: "", rdns: "injected.legacy" },
        provider: window.ethereum,
      });
      publishProviders();
    }
  }, 700);
}

export function refreshDiscovery() {
  window.dispatchEvent(new Event("eip6963:requestProvider"));
}

const parseChain = (hex) => (typeof hex === "string" ? parseInt(hex, 16) : Number(hex));

function attach(provider) {
  const onAccounts = (accounts) => {
    if (!accounts || !accounts.length) {
      cleanup(true);
      toast({ type: "info", title: "Wallet disconnected", message: "The wallet no longer shares an account with this site." });
      return;
    }
    wallet.set({ account: accounts[0], balance: null });
    refreshBalance();
  };
  const onChain = (hex) => {
    const id = parseChain(hex);
    wallet.set({ chainId: id });
    if (id !== CONFIG.chain.id) {
      toast({
        type: "warn",
        title: "Wrong network",
        message: `Your wallet moved to chain ${id}. Switch back to ${CONFIG.chain.name} to send transactions.`,
        action: { label: "Switch network", run: () => switchNetwork() },
      });
    } else {
      refreshBalance();
    }
  };
  const onDisconnect = () => {
    cleanup(true);
    toast({ type: "info", title: "Wallet disconnected", message: "The wallet connection was closed." });
  };
  provider.on?.("accountsChanged", onAccounts);
  provider.on?.("chainChanged", onChain);
  provider.on?.("disconnect", onDisconnect);
  return () => {
    provider.removeListener?.("accountsChanged", onAccounts);
    provider.removeListener?.("chainChanged", onChain);
    provider.removeListener?.("disconnect", onDisconnect);
  };
}

function cleanup(clearSaved) {
  detach?.();
  detach = null;
  current = null;
  wallet.set({ status: "disconnected", active: null, account: null, chainId: null, balance: null, switching: false });
  if (clearSaved) prefs.set("wallet", null);
}

async function finishConnect(entry, accounts) {
  current = entry.provider;
  detach?.();
  detach = attach(entry.provider);
  let chainId = null;
  try {
    chainId = parseChain(await entry.provider.request({ method: "eth_chainId" }));
  } catch {
    chainId = null;
  }
  wallet.set({
    status: "connected",
    active: { uuid: entry.info.uuid, name: entry.info.name, icon: entry.info.icon, rdns: entry.info.rdns || "" },
    account: accounts[0],
    chainId,
    balance: null,
  });
  prefs.set("wallet", entry.info.rdns || entry.info.uuid);
  prefs.set("wallet.off", null);
  refreshBalance();
}

/** Opens the wallet's own approval popup. */
export async function connect(uuid) {
  const entry = found.get(uuid);
  if (!entry) throw new Error("That wallet is no longer available. Reload the page and try again.");
  wallet.set({ status: "connecting" });
  try {
    const accounts = await entry.provider.request({ method: "eth_requestAccounts" });
    if (!accounts?.length) throw new Error("The wallet did not share any account.");
    await finishConnect(entry, accounts);
    toast({ type: "success", title: `Connected to ${entry.info.name}`, message: "You can now register packages and request audits." });
    if (wallet.get().chainId !== CONFIG.chain.id) {
      toast({ type: "warn", title: "Switch network", message: `Approve the request in your wallet to move to ${CONFIG.chain.name}.` });
      await switchNetwork().catch(() => {});
    }
    return true;
  } catch (err) {
    wallet.set({ status: "disconnected" });
    const info = explainError(err);
    toast({ type: isUserRejection(err) ? "info" : "error", title: isUserRejection(err) ? "Connection cancelled" : "Could not connect", message: info.message });
    return false;
  }
}

/**
 * Real disconnect: drops our listeners and session, asks the wallet to revoke this site's
 * account permission (EIP-2255, where supported) and stops auto-reconnecting.
 */
export async function disconnect() {
  const provider = current;
  cleanup(true);
  prefs.set("wallet.off", "1");
  if (provider) {
    try {
      await provider.request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] });
    } catch {
      /* not every wallet supports revoking; the site-side session is already closed */
    }
  }
  toast({ type: "info", title: "Disconnected", message: "This site can no longer see your account." });
}

/** Silent reconnect (no popup) for a wallet the user connected before and did not disconnect. */
export async function autoReconnect() {
  const saved = prefs.get("wallet");
  if (!saved || prefs.get("wallet.off")) return;
  await new Promise((resolve) => setTimeout(resolve, 450));
  const entry = [...found.values()].find((e) => e.info.rdns === saved || e.info.uuid === saved);
  if (!entry) return;
  try {
    const accounts = await entry.provider.request({ method: "eth_accounts" });
    if (accounts?.length) await finishConnect(entry, accounts);
  } catch {
    /* stay disconnected */
  }
}

export async function switchNetwork() {
  const provider = current;
  if (!provider) throw new Error("Connect a wallet first.");
  wallet.set({ switching: true });
  const params = {
    chainId: CONFIG.chain.hex,
    chainName: CONFIG.chain.name,
    nativeCurrency: { name: CONFIG.chain.currency.name, symbol: CONFIG.chain.currency.symbol, decimals: CONFIG.chain.currency.decimals },
    rpcUrls: [CONFIG.chain.rpc],
    blockExplorerUrls: [CONFIG.chain.explorer],
  };
  try {
    try {
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CONFIG.chain.hex }] });
    } catch (err) {
      if (isUserRejection(err)) throw err;
      // 4902 = chain not added (MetaMask); other wallets use different codes, so try adding for any non-rejection.
      await provider.request({ method: "wallet_addEthereumChain", params: [params] });
    }
    const id = parseChain(await provider.request({ method: "eth_chainId" }));
    wallet.set({ chainId: id });
    if (id === CONFIG.chain.id) {
      toast({ type: "success", title: "Network switched", message: `You are on ${CONFIG.chain.name}.` });
      refreshBalance();
    }
  } catch (err) {
    if (isUserRejection(err)) toast({ type: "info", title: "Network switch cancelled", message: `Transactions need ${CONFIG.chain.name} (chain ${CONFIG.chain.id}).` });
    else toast({ type: "error", title: "Could not switch network", message: explainError(err).message });
    throw err;
  } finally {
    wallet.set({ switching: false });
  }
}

export async function refreshBalance() {
  const { account } = wallet.get();
  if (!account) return;
  try {
    const hex = await rpc("eth_getBalance", [account, "latest"]);
    if (wallet.get().account === account) wallet.set({ balance: formatUnits(BigInt(hex), 18, 4) });
  } catch {
    /* the balance is informational only */
  }
}

/** Studionet has no external faucet: the node mints balance for any address. */
export async function fundAccount() {
  const { account } = wallet.get();
  if (!account) return false;
  try {
    await rpc("sim_fundAccount", [account, 10 ** 20]);
    toast({ type: "success", title: "Test GEN added", message: "Your Studionet balance was topped up." });
    await refreshBalance();
    return true;
  } catch (err) {
    toast({ type: "error", title: "Funding failed", message: explainError(err).message });
    return false;
  }
}

export { explorerAddress };
