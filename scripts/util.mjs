// Pure helpers shared by the live scripts. No external imports on purpose, so
// they can be unit-tested anywhere with `node --test scripts/`.

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** genlayer-js returns Maps, BigInts and Uint8Arrays; turn them into plain JSON-friendly values. */
export function normalize(value, depth = 0) {
  if (depth > 12) return null;
  if (typeof value === "bigint") return Number(value) <= Number.MAX_SAFE_INTEGER ? Number(value) : value.toString();
  if (value instanceof Uint8Array) return value.length === 20 ? "0x" + Buffer.from(value).toString("hex") : Array.from(value);
  if (value instanceof Map) return Object.fromEntries([...value.entries()].map(([k, v]) => [String(k), normalize(v, depth + 1)]));
  if (Array.isArray(value)) return value.map((v) => normalize(v, depth + 1));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalize(v, depth + 1)]));
  return value;
}

export function receiptFailed(receipt) {
  return receipt?.txExecutionResultName === "FINISHED_WITH_ERROR";
}

/** Digs the contract's own "[EXPECTED] ..." / "[EXTERNAL] ..." text out of any receipt or error shape. */
export function taggedMessage(value, depth = 0) {
  if (depth > 7 || value == null) return null;
  if (typeof value === "string") {
    const match = value.match(/\[(EXPECTED|EXTERNAL)\]\s*([^"\\]*)/);
    return match ? match[2].trim() : null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = taggedMessage(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value === "object") {
    for (const item of Object.values(value)) {
      const found = taggedMessage(item, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export function findAddress(value, depth = 0) {
  if (depth > 7 || value == null) return null;
  if (typeof value === "string") return ADDRESS.test(value) ? value : null;
  if (typeof value === "object") {
    for (const key of ["contract_address", "contractAddress", "recipient", "to_address"]) {
      if (typeof value[key] === "string" && ADDRESS.test(value[key])) return value[key];
    }
    for (const item of Object.values(value)) {
      const found = findAddress(item, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/** `--name value` / `--flag` command line parsing. Returns { flags: Set, values: Map }. */
export function parseArgs(argv) {
  const flags = new Set();
  const values = new Map();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const name = arg.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      values.set(name, next);
      i++;
    } else {
      flags.add(name);
    }
  }
  return { flags, values };
}

export function describeAudit(audit) {
  const e = audit.evidence ?? [];
  const lines = [
    `  verdict   : ${audit.verdict}`,
    `  severity  : ${audit.severity}   (declared bump ${audit.declared_bump}, honest bump needs ${audit.required_bump})`,
    `  entries   : ${audit.item_count} read, ${audit.breaking_entries} breaking / ${audit.feature_entries} feature / ${audit.fix_entries} fix, ${audit.explicit_markers} explicit marker(s)`,
    `  block hash: ${audit.block_hash}`,
  ];
  for (const item of e) lines.push(`  evidence  : #${item.i} "${item.t}"`);
  if (audit.injection_flagged) lines.push("  warning   : the notes contain text that tries to address the classifier");
  if (audit.notes_changed) lines.push(`  notes     : EDITED since the previous audit${audit.softened ? " and SOFTENED" : ""}`);
  return lines.join("\n");
}
