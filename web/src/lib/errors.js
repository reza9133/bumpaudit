// Helpers for the shapes genlayer-js returns and for the contract's tagged revert messages.

/** genlayer-js returns Maps, BigInts and Uint8Arrays; make them plain JSON-friendly values. */
export function normalize(value, depth = 0) {
  if (depth > 12) return null;
  if (typeof value === "bigint") return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value.toString();
  if (value instanceof Uint8Array) {
    const hex = Array.from(value, (b) => b.toString(16).padStart(2, "0")).join("");
    return value.length === 20 ? "0x" + hex : Array.from(value);
  }
  if (value instanceof Map) return Object.fromEntries([...value.entries()].map(([k, v]) => [String(k), normalize(v, depth + 1)]));
  if (Array.isArray(value)) return value.map((v) => normalize(v, depth + 1));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalize(v, depth + 1)]));
  return value;
}

/** Digs the contract's own "[EXPECTED] ..." / "[EXTERNAL] ..." text out of any receipt or error shape. */
export function taggedMessage(value, depth = 0) {
  if (depth > 8 || value == null) return null;
  if (typeof value === "string") {
    const m = value.match(/\[(EXPECTED|EXTERNAL)\]\s*([^"\\\n]*)/);
    return m ? m[2].trim() : null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = taggedMessage(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value === "object") {
    for (const key of Object.keys(value)) {
      const found = taggedMessage(value[key], depth + 1);
      if (found) return found;
    }
    if (value instanceof Error) return taggedMessage(value.message, depth + 1);
  }
  return null;
}

export function taggedKind(value, depth = 0) {
  if (depth > 8 || value == null) return null;
  if (typeof value === "string") {
    const m = value.match(/\[(EXPECTED|EXTERNAL)\]/);
    return m ? m[1] : null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = taggedKind(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value === "object") {
    for (const key of Object.keys(value)) {
      const found = taggedKind(value[key], depth + 1);
      if (found) return found;
    }
    if (value instanceof Error) return taggedKind(value.message, depth + 1);
  }
  return null;
}

export function isUserRejection(err) {
  const code = err?.code ?? err?.cause?.code ?? err?.error?.code;
  const text = String(err?.message ?? err ?? "").toLowerCase();
  return code === 4001 || code === "ACTION_REJECTED" || /user (rejected|denied)|rejected the request|request rejected/.test(text);
}

/** One human sentence for any failure. Returns { message, kind } where kind is user | contract | external | rate | network | other. */
export function explainError(err) {
  if (isUserRejection(err)) return { kind: "user", message: "You rejected the request in your wallet. Nothing was sent." };
  const tagged = taggedMessage(err);
  const tag = taggedKind(err);
  if (tagged) {
    return {
      kind: tag === "EXTERNAL" ? "external" : "contract",
      message: tagged,
      hint:
        tag === "EXTERNAL"
          ? "The problem is with the page or the network, not with your input. Check that the URL is public and contains a heading for the version, then try again."
          : "The contract rejected the input. Nothing was recorded.",
    };
  }
  const chain = [];
  for (let e = err, i = 0; e && i < 5; e = e.cause, i++) chain.push(String(e?.shortMessage ?? ""), String(e?.message ?? e ?? ""), String(e?.details ?? ""));
  const all = chain.join(" ");
  const text = String(err?.shortMessage ?? err?.message ?? err ?? "");
  if (/failed to fetch|networkerror|load failed|network request failed|err_name_not_resolved|unknown rpc error/i.test(all) && !/rate limit/i.test(all))
    return { kind: "network", message: "Could not reach the Studionet RPC. Check your connection; the shared simulator may also be restarting." };
  if (/rate limit/i.test(text)) return { kind: "rate", message: "The public Studionet RPC is rate limited (about 30 requests a minute). Wait a moment and try again." };
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(text))
    return { kind: "network", message: "Could not reach the Studionet RPC. Check your connection; the shared simulator may also be restarting." };
  return { kind: "other", message: text.length > 400 ? text.slice(0, 400) + "…" : text || "Something went wrong." };
}
