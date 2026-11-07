// Read access to the BumpAudit contract on GenLayer Studionet.
import { CONFIG } from "../config.js";
import { normalize, taggedMessage } from "./errors.js";
import { installRpcThrottle } from "./rpc.js";

installRpcThrottle();

let sdkPromise;
export function loadSdk() {
  sdkPromise ??= Promise.all([import("genlayer-js"), import("genlayer-js/chains")]).then(([sdk, chains]) => ({
    createClient: sdk.createClient,
    studionet: chains.studionet,
  }));
  return sdkPromise;
}

let readerPromise;
export function readClient() {
  readerPromise ??= loadSdk().then(({ createClient, studionet }) => createClient({ chain: studionet }));
  return readerPromise;
}

const cache = new Map(); // key -> { at, value } | { promise }
export function invalidateAll() {
  cache.clear();
}


/**
 * Calls a view method. Results are cached briefly and identical in-flight calls are shared,
 * because the public RPC only allows about 30 requests a minute.
 */
export async function view(functionName, args = [], { ttl = 20_000, force = false } = {}) {
  if (__DEMO__) return (await import("./mock.js")).mockView(functionName, args);
  const address = CONFIG.contractAddress;
  const key = `${address}|${functionName}|${JSON.stringify(args)}`;
  const hit = cache.get(key);
  if (!force && hit) {
    if (hit.promise) return hit.promise;
    if (Date.now() - hit.at < ttl) return hit.value;
  }
  const promise = (async () => {
    const client = await readClient();
    try {
      return normalize(await client.readContract({ address, functionName, args }));
    } catch (err) {
      const tagged = taggedMessage(err);
      const failure = new Error(tagged || String(err?.shortMessage ?? err?.message ?? err));
      failure.tagged = Boolean(tagged);
      failure.cause = err;
      throw failure;
    }
  })();
  cache.set(key, { promise });
  try {
    const value = await promise;
    cache.set(key, { at: Date.now(), value });
    return value;
  } catch (err) {
    cache.delete(key);
    throw err;
  }
}

const LONG = { ttl: 10 * 60_000 };

export const api = {
  version: () => view("get_version", [], LONG),
  limits: () => view("get_limits", [], LONG),
  stats: (opts) => view("get_stats", [], opts),
  listPackages: (offset, limit) => view("list_packages", [offset, limit]),
  findPackages: (ecosystem, name, offset = 0, limit = 50) => view("find_packages", [ecosystem, name, offset, limit]),
  registrantPackages: (address) => view("list_registrant_packages", [address]),
  pkg: (id, opts) => view("get_package", [id], opts),
  releases: (packageId, offset, limit, opts) => view("list_package_releases", [packageId, offset, limit], opts),
  release: (id, opts) => view("get_release", [id], opts),
  findRelease: (packageId, version) => view("find_release", [packageId, version]),
  audits: (releaseId, offset, limit, opts) => view("list_release_audits", [releaseId, offset, limit], opts),
  audit: (id) => view("get_audit", [id], LONG),
  notes: (auditId) => view("get_audit_notes", [auditId], LONG),
  describeVersion: (v) => view("describe_version", [v], LONG),
  previewVerdict: (prev, ver, sev) => view("preview_verdict", [prev, ver, sev], LONG),
  checkUrl: (url, asPrefix) => view("check_source_url", [url, !!asPrefix], LONG),
  previewExtraction: (text, version) => view("preview_extraction", [text, version], LONG),
};

/** Raw JSON-RPC call against the Studionet node (balance, faucet). */
export async function rpc(method, params = []) {
  if (__DEMO__) return (await import("./mock.js")).mockRpc(method, params);
  const client = await readClient();
  return client.request({ method, params });
}
