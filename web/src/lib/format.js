export function shortAddr(address, head = 6, tail = 4) {
  const a = String(address || "");
  return a.length > head + tail + 2 ? `${a.slice(0, head)}…${a.slice(-tail)}` : a;
}

export function shortHash(hash, head = 10, tail = 6) {
  const s = String(hash || "");
  return s.length > head + tail + 1 ? `${s.slice(0, head)}…${s.slice(-tail)}` : s;
}

export function fmtDate(unixSeconds) {
  const n = Number(unixSeconds);
  if (!n) return "—";
  return new Date(n * 1000).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function timeAgo(unixSeconds) {
  const n = Number(unixSeconds);
  if (!n) return "never";
  const diff = Math.max(0, Math.floor(Date.now() / 1000) - n);
  if (diff < 45) return "just now";
  if (diff < 3600) return `${Math.round(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)} h ago`;
  if (diff < 86400 * 30) return `${Math.round(diff / 86400)} d ago`;
  return fmtDate(n);
}

/** integrity_permille (0..1000 | null) -> "66.6%" | "n/a" */
export function pct(permille) {
  if (permille === null || permille === undefined) return "n/a";
  const v = Number(permille) / 10;
  return (Number.isInteger(v) ? v.toFixed(0) : v.toFixed(1)) + "%";
}

export function formatUnits(value, decimals = 18, digits = 4) {
  try {
    const big = BigInt(value);
    const base = 10n ** BigInt(decimals);
    const whole = big / base;
    const frac = (big % base).toString().padStart(decimals, "0").slice(0, digits).replace(/0+$/, "");
    return frac ? `${whole}.${frac}` : whole.toString();
  } catch {
    return "0";
  }
}

export function verdictLabel(verdict) {
  return (
    { COMPLIANT: "Compliant", UNDER_BUMPED: "Under-bumped", OVER_BUMPED: "Over-bumped", EXEMPT: "Exempt" }[verdict] ||
    String(verdict || "Unknown")
  );
}

export function verdictTone(verdict) {
  return { COMPLIANT: "ok", UNDER_BUMPED: "bad", OVER_BUMPED: "warn", EXEMPT: "neutral" }[verdict] || "neutral";
}

export function plural(n, one, many = one + "s") {
  return `${n} ${Number(n) === 1 ? one : many}`;
}
